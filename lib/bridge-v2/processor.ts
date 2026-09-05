/**
 * The on-chain pipeline: VERIFIED to ELIGIBLE to FUNDING to SUBMITTED to
 * CONFIRMED.
 *
 * This runs on a schedule rather than inside the Telegram webhook. Telegram
 * retries a delivery it does not see acknowledged, so doing minutes of chain
 * work inside a webhook would replay funding and entry attempts on every retry.
 * The webhook records the verified fact and returns; the pipeline below does the
 * work that can be slow, and can be run again safely because every step is
 * conditional on the state it expects (G5).
 *
 * OPEN POINT, recorded rather than decided: the specification does not say when
 * the on-chain entry happens relative to the Telegram confirmation. A queue
 * processed on a schedule is the only shape that satisfies G3, G4 and G5 in a
 * serverless runtime, but the timing itself is the owner's to fix.
 */

import { SWEEP_MIN_WEI } from './config.js';
import { claimSpend } from './spend.js';
import { alert } from './alert.js';
import type { Logger } from './log.js';
import {
  advance,
  campaignsWithVerified,
  listConfirmed,
  listEligible,
  listSubmitted,
  listVerified,
  type Entry,
} from './entries.js';
import { proofForAddress, publishBatch } from './eligibility.js';
import {
  ChainError,
  hasEntered,
  quoteEntryCost,
  readGiveaway,
  slotsRemaining,
  submitEnter,
  sweepRemainder,
  waitForReceipt,
  fundDerivedWallet,
} from './chain.js';
import {
  acquireFunder,
  disableFunder,
  releaseFunder,
  renewLease,
  signAsFunder,
} from './funders.js';
import { signAsDerived } from './wallet.js';
import { getParticipant } from './participants.js';

/** How many campaigns and entries one scheduled run touches. */
const CAMPAIGN_BATCH = 20;
const ROOT_BATCH = 200;
const ENTRY_BATCH = 25;

/**
 * Publishes one root per campaign covering everything verified so far.
 *
 * H6: the slot ledger is consulted before anything is published. A campaign with
 * no slots left admits nobody, because admitting an address that can never enter
 * would put it in a root for ever with no way to use it.
 *
 * The campaign must also still be OPEN — the contract only accepts roots while
 * it is (4.2), so publishing later would revert and waste the gas.
 */
export async function publishPendingRoots(log: Logger): Promise<number> {
  let published = 0;

  for (const giveawayId of await campaignsWithVerified(CAMPAIGN_BATCH)) {
    const pending = await listVerified(giveawayId, ROOT_BATCH);
    if (pending.length === 0) continue;

    const campaign = await readGiveaway(giveawayId);
    if (!campaign.isOpen) {
      for (const entry of pending) {
        await advance(entry.id, 'VERIFIED', 'FAILED');
      }
      await log.event('entry.failed', {
        giveaway_id: giveawayId.toString(),
        reason: 'campaign_not_open',
        count: pending.length,
      });
      continue;
    }

    const slots = await slotsRemaining(giveawayId);
    const admit = pending.slice(0, Number(slots > BigInt(pending.length) ? pending.length : slots));
    if (admit.length === 0) {
      await log.event('entry.failed', {
        giveaway_id: giveawayId.toString(),
        reason: 'slots_exhausted',
        count: pending.length,
      });
      continue;
    }

    const root = await publishBatch(giveawayId, admit.map((entry) => entry.walletAddress), log);

    for (const entry of admit) {
      await advance(entry.id, 'VERIFIED', 'ELIGIBLE', { root_index: root.rootIndex.toString() });
      await log.event('entry.eligible', {
        giveaway_id: giveawayId.toString(),
        root_index: root.rootIndex.toString(),
      });
    }
    published += 1;
  }

  return published;
}

/**
 * Funds one derived wallet and submits its entry.
 *
 * The order matters and is the correction to several V1 findings at once.
 *
 * G5 first: if the contract already says this address entered, the work is done
 * and repeating it would fund a wallet for a transaction that must revert.
 *
 * H6 next: slots are read before gas moves. H5 follows from it — a creator who
 * writes an expensive enter() cannot drain the pool, because the number of times
 * the bridge is willing to pay is the number of slots they bought.
 *
 * G3 then: the funder lease is renewed after the funding transaction and before
 * the entry, so a slow confirmation cannot let the lease lapse while this
 * operation is still using the nonce.
 */
async function processEligible(entry: Entry, log: Logger): Promise<void> {
  if (entry.rootIndex === null) {
    await advance(entry.id, 'ELIGIBLE', 'FAILED');
    return;
  }

  if (await hasEntered(entry.giveawayId, entry.walletAddress)) {
    await advance(entry.id, 'ELIGIBLE', 'CONFIRMED');
    await log.event('entry.confirmed', { reason: 'already_on_chain' });
    return;
  }

  if ((await slotsRemaining(entry.giveawayId)) <= 0n) {
    await advance(entry.id, 'ELIGIBLE', 'FAILED');
    await log.event('entry.failed', { reason: 'slots_exhausted' });
    return;
  }

  const participant = await getParticipant(entry.participantId);
  if (participant === null) {
    await advance(entry.id, 'ELIGIBLE', 'FAILED');
    return;
  }

  const proof = await proofForAddress(entry.giveawayId, entry.walletAddress, entry.rootIndex);
  if (proof === null) {
    // A proof that cannot be rebuilt is not something a retry fixes.
    await advance(entry.id, 'ELIGIBLE', 'FAILED');
    await log.event('entry.failed', { reason: 'proof_unavailable' });
    return;
  }

  // B8: the gas budget is claimed before any of it is spent.
  if (!(await claimSpend('chain', 1, log))) return;

  const lease = await acquireFunder();
  if (lease === null) {
    await log.event('funder.exhausted');
    await alert(log, 'no funder available');
    return;
  }

  let nextNonce = lease.nextNonce;
  try {
    const quote = await quoteEntryCost(
      entry.giveawayId,
      entry.walletAddress,
      proof.rootIndex,
      proof.proof,
    );

    if (!(await advance(entry.id, 'ELIGIBLE', 'FUNDING'))) return;

    const funding = await fundDerivedWallet(
      lease,
      entry.walletAddress,
      quote.plan.worstCaseWei,
      signAsFunder,
    );
    nextNonce = funding.nextNonce;

    // The funding must be mined before the wallet can pay for its own entry.
    const fundingReceipt = await waitForReceipt(funding.hash);
    if (fundingReceipt === null || fundingReceipt.status !== 'success') {
      await advance(entry.id, 'FUNDING', 'ELIGIBLE');
      await log.event('entry.failed', { reason: 'funding_not_mined' });
      return;
    }
    await log.event('entry.funded', { giveaway_id: entry.giveawayId.toString() });

    // G3: the lease is extended before the second, slower half.
    if (!(await renewLease(lease))) {
      await advance(entry.id, 'FUNDING', 'ELIGIBLE');
      await log.event('entry.failed', { reason: 'lease_lost' });
      return;
    }

    const hash = await submitEnter(
      participant.walletIndex,
      entry.walletAddress,
      quote.data,
      quote.plan,
      signAsDerived,
    );

    // K3: the hash is written before the wait, so a function that dies here
    // leaves a reconcilable record instead of a lost transaction.
    await advance(entry.id, 'FUNDING', 'SUBMITTED', { tx_hash: hash });
    await log.event('entry.submitted', { giveaway_id: entry.giveawayId.toString() });

    const receipt = await waitForReceipt(hash);
    if (receipt?.status === 'success') {
      await advance(entry.id, 'SUBMITTED', 'CONFIRMED');
      await log.event('entry.confirmed', { giveaway_id: entry.giveawayId.toString() });
    }
    // A timeout leaves the entry SUBMITTED for reconcileSubmitted to finish.
  } catch (error) {
    if (error instanceof ChainError && error.code === 'gas_cost_above_ceiling') {
      // H3: refusing is the correct outcome, and it is not the entry's fault.
      await advance(entry.id, 'FUNDING', 'ELIGIBLE');
      await log.event('gas.rejected', { reason: error.code });
      await alert(log, 'gas cost above ceiling', { reason: error.code });
    } else {
      await advance(entry.id, 'FUNDING', 'ELIGIBLE');
      await log.failure('entry.failed', error);
    }
  } finally {
    // G6: the nonce advances whether or not the transaction succeeded, because a
    // broadcast transaction consumes its nonce either way.
    const released = await releaseFunder(lease, nextNonce);
    if (!released) {
      await disableFunder(lease.index);
      await log.event('funder.disabled', { funder_index: lease.index });
      await alert(log, 'funder lease could not be released', { funder_index: lease.index });
    }
  }
}

/** Runs the funding and entry step for a bounded number of entries. */
export async function processEligibleEntries(log: Logger): Promise<number> {
  const entries = await listEligible(ENTRY_BATCH);
  for (const entry of entries) await processEligible(entry, log);
  return entries.length;
}

/**
 * Finishes entries whose receipt was never seen.
 *
 * K3 and G4 together: a bounded wait means some transactions outlive the
 * function that sent them, which is correct but leaves the row saying SUBMITTED
 * when the chain has moved on. The chain is asked directly rather than the
 * receipt being awaited again, because hasEntered is the fact that actually
 * matters and it is true whether or not this process ever saw the receipt.
 */
export async function reconcileSubmitted(log: Logger): Promise<number> {
  const entries = await listSubmitted(ENTRY_BATCH);

  for (const entry of entries) {
    if (await hasEntered(entry.giveawayId, entry.walletAddress)) {
      await advance(entry.id, 'SUBMITTED', 'CONFIRMED');
      await log.event('entry.confirmed', { reason: 'reconciled' });
      continue;
    }

    const receipt = entry.txHash === null ? null : await waitForReceipt(entry.txHash as `0x${string}`);
    if (receipt?.status === 'reverted') {
      // The transaction was mined and failed. Back to ELIGIBLE so it is retried
      // with a fresh quote; the wallet keeps whatever gas is left, which the
      // sweep will recover if the entry never succeeds.
      await advance(entry.id, 'SUBMITTED', 'ELIGIBLE');
      await log.event('entry.failed', { reason: 'reverted' });
    }
    // Still pending: left alone for the next run.
  }

  return entries.length;
}

/**
 * H7: recovers the gas an entry did not spend.
 *
 * Every entry funds the wallet with the same margin the plan uses, and whatever
 * the transaction did not consume stays in the derived wallet. The V1 had no
 * mechanism at all, so the remainder of every entry ever made was stranded, one
 * address at a time.
 *
 * The destination is a funder address, so the gas returns to the pool it came
 * from. Nothing here can send anywhere else: the destination is not a parameter
 * of any route (H2).
 */
export async function sweepConfirmed(log: Logger, destination: `0x${string}`): Promise<number> {
  const entries = await listConfirmed(ENTRY_BATCH);
  let swept = 0;

  for (const entry of entries) {
    const participant = await getParticipant(entry.participantId);
    if (participant === null) continue;

    try {
      const hash = await sweepRemainder(
        participant.walletIndex,
        entry.walletAddress,
        destination,
        SWEEP_MIN_WEI,
        signAsDerived,
      );
      if (hash !== null) {
        swept += 1;
        await log.event('sweep.done', { giveaway_id: entry.giveawayId.toString() });
      }
    } catch (error) {
      // A wallet that cannot be swept is not a failure of the entry, which has
      // already confirmed. Recorded and left for the next run.
      await log.failure('sweep.done', error);
    }
  }

  return swept;
}
