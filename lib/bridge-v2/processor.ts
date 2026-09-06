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
  markSwept,
  touch,
  type Entry,
} from './entries.js';
import { proofForAddress, publishBatch } from './eligibility.js';
import {
  ChainError,
  claimableFor,
  claimDeadlineSeconds,
  fundDerivedWallet,
  hasEntered,
  prizeAlreadyClaimed,
  prizeDelivery,
  quoteClaim,
  quoteDelivery,
  quoteEntryCost,
  readGiveaway,
  slotsRemaining,
  submitAsDerived,
  sweepRemainder,
  waitForReceipt,
  type GasPlan,
} from './chain.js';
import {
  beginCustody,
  custodyExpiryFrom,
  listPendingPrizes,
  markDelivered,
  touchCustody,
  type PendingPrize,
} from './custody.js';
import { GIVEAWAY_MANAGER_V2 } from './config.js';
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
    // Not confirmed on chain: nothing was recorded, so nothing is promoted. The
    // entries stay VERIFIED and the next run publishes again against a freshly
    // read index (eligibility.ts).
    if (root === null) continue;

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

    const fundingHash = await fundDerivedWallet(
      lease,
      entry.walletAddress,
      quote.plan.worstCaseWei,
      signAsFunder,
      // G6: recorded when the signed transaction is sent, not when the RPC
      // answers. If the send throws, control goes to the catch and then to the
      // finally below, which releases the funder with the nonce already spent.
      (spent) => {
        nextNonce = spent;
      },
    );

    // The funding must be mined before the wallet can pay for its own entry.
    const fundingReceipt = await waitForReceipt(fundingHash);
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

    const hash = await submitAsDerived(
      participant.walletIndex,
      entry.walletAddress,
      GIVEAWAY_MANAGER_V2,
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
      continue;
    }

    // Still in the mempool. Nothing about the entry changes, but its place in
    // the queue must: the list is the oldest SUBMITTED entries by updated_at,
    // and leaving the row untouched keeps it at the head of every subsequent
    // run. One transaction that never confirms would then stop every entry
    // behind it from ever being reconciled.
    await touch(entry.id);
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
    if (participant === null) {
      // No participant row means no derivation index, so this wallet can never
      // be signed for. Marked, or it holds the head of the queue for ever.
      await markSwept(entry.id);
      continue;
    }

    try {
      const hash = await sweepRemainder(
        participant.walletIndex,
        entry.walletAddress,
        destination,
        signAsDerived,
      );
      if (hash !== null) {
        swept += 1;
        await log.event('sweep.done', { giveaway_id: entry.giveawayId.toString() });
      }
      // Marked either way. A null means the remainder is below what the sweep
      // itself costs, and nothing will ever fund this wallet again, so there is
      // no later run in which the answer changes. Leaving it unmarked is what
      // made the batch return the same rows for ever and never reach the
      // entries behind them.
      await markSwept(entry.id);
    } catch (error) {
      // A wallet that cannot be swept is not a failure of the entry, which has
      // already confirmed. Recorded, marked, and not retried: the batch is a
      // queue and a row that throws must not be the head of it for ever.
      await log.failure('sweep.done', error);
      await markSwept(entry.id);
    }
  }

  return swept;
}

// -----------------------------------------------------------------------------
// Prizes — E1 to E4, and claimPrize(uint256)
// -----------------------------------------------------------------------------

/** How many prizes one scheduled run touches. */
const PRIZE_BATCH = 10;

/**
 * Funds a derived wallet for one call and sends it, under a funder lease.
 *
 * The claim and the delivery need exactly what an entry needs — a wallet with no
 * balance has to be given the gas for its own transaction first — so this is the
 * same sequence processEligible runs, with the same G3 renewal across the slow
 * half and the same G6 nonce accounting in the finally.
 *
 * Returns null when the transaction could not be sent; the caller decides what
 * that means for its own state.
 */
async function fundAndSubmit(
  walletIndex: number,
  wallet: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`,
  plan: GasPlan,
  log: Logger,
): Promise<`0x${string}` | null> {
  // B8: the gas budget is claimed before any of it is spent, exactly as on the
  // entry path. A settled campaign gets no free pass to the pool.
  if (!(await claimSpend('chain', 1, log))) return null;

  const lease = await acquireFunder();
  if (lease === null) {
    await log.event('funder.exhausted');
    await alert(log, 'no funder available');
    return null;
  }

  let nextNonce = lease.nextNonce;
  try {
    const fundingHash = await fundDerivedWallet(
      lease,
      wallet,
      plan.worstCaseWei,
      signAsFunder,
      (spent) => {
        nextNonce = spent;
      },
    );

    const funded = await waitForReceipt(fundingHash);
    if (funded === null || funded.status !== 'success') {
      await log.event('prize.failed', { reason: 'funding_not_mined' });
      return null;
    }

    // G3: the lease is extended before the second, slower half rather than left
    // to lapse under a running operation.
    if (!(await renewLease(lease))) {
      await log.event('prize.failed', { reason: 'lease_lost' });
      return null;
    }

    return await submitAsDerived(walletIndex, wallet, to, data, plan, signAsDerived);
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

/**
 * Collects and delivers one prize.
 *
 * The premise, stated once, because both branches below follow from it: a prize
 * can only ever be collected by the derived wallet. claimPrize pays msg.sender,
 * and the winner the contract drew is the address that entered, so there is no
 * arrangement in which the participant claims for themselves and no parameter
 * anywhere that would deliver the prize elsewhere in a single step.
 *
 * TEMPORARY CUSTODY — a token prize whose per-winner share is under the E2
 * threshold. The claim is made as soon as the campaign settles, which puts the
 * value beyond the reach of the ninety-day deadline and makes it the winner's;
 * the thirty-day clock starts at that moment and not before (E3). When the
 * participant confirms a destination the prize is handed on; past the expiry
 * with none given, the bridge stops and raises an alert instead of holding it
 * silently for ever.
 *
 * OWN WALLET — every NFT, and any token share at or above the threshold. Nothing
 * is claimed until a destination is confirmed, because claiming early would park
 * a large prize in the one place E1 says value must never rest. Once it is
 * confirmed, the claim and the delivery are two transactions back to back and
 * the prize is in the derived wallet only between them.
 *
 * Both branches record the same two facts, so a run that dies between them is
 * picked up by the next: claimed_at says the prize is in the wallet,
 * delivered_at says it has left.
 */
async function processPrize(
  pending: PendingPrize,
  log: Logger,
  deadlineSeconds: bigint,
): Promise<boolean> {
  const { custody, giveawayId, walletAddress } = pending;

  const campaign = await readGiveaway(giveawayId);
  if (!campaign.isSettled) {
    // Not drawn yet, or cancelled. Either way there is nothing to collect now.
    await touchCustody(custody.entryId);
    return false;
  }

  const participant = await getParticipant(pending.participantId);
  if (participant === null) {
    await touchCustody(custody.entryId);
    return false;
  }

  // E4: only a destination the participant confirmed counts. A merely proposed
  // one is an address they have been shown and have not yet agreed to.
  const destination = custody.destinationConfirmedAt === null ? null : custody.destinationAddress;

  // The contract's own window, read from the contract rather than copied here.
  // Past it claimPrize reverts with ClaimExpired and the creator may reclaim, so
  // there is nothing left for this side to attempt.
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const claimClosed = nowSeconds > campaign.settledAt + deadlineSeconds;

  // ---------------------------------------------------------------- the claim
  if (custody.claimedAt === null && (await prizeAlreadyClaimed(giveawayId, walletAddress))) {
    // The contract says this wallet has been paid and this side has no record of
    // it, which is what a claim broadcast by a run that died before its receipt
    // arrived looks like. The prize is in the wallet; custody began when that
    // transaction was mined and the row has to say so, or the delivery below is
    // never reached and the value stays where E1 says nothing may rest.
    await beginCustody(
      custody.entryId,
      custody.claimTxHash,
      custody.requiresOwnWallet ? null : custodyExpiryFrom(new Date()),
    );
    await log.event('prize.claimed', {
      giveaway_id: giveawayId.toString(),
      prize_kind: custody.prizeKind,
      reason: 'already_on_chain',
    });
  } else if (custody.claimedAt === null) {
    if (claimClosed) {
      await log.event('prize.expired', { giveaway_id: giveawayId.toString() });
      await touchCustody(custody.entryId);
      return false;
    }

    // E2: a prize that must go to a wallet the winner owns is not claimed until
    // there is one to send it to.
    if (custody.requiresOwnWallet && destination === null) {
      await touchCustody(custody.entryId);
      return false;
    }

    if ((await claimableFor(giveawayId, walletAddress)) <= 0n) {
      // Not a winner, or the prize is already collected. Neither is an error,
      // and neither becomes one by being looked at again.
      await touchCustody(custody.entryId);
      return false;
    }

    const quote = await quoteClaim(giveawayId, walletAddress);
    const claimHash = await fundAndSubmit(
      participant.walletIndex,
      walletAddress,
      GIVEAWAY_MANAGER_V2,
      quote.data,
      quote.plan,
      log,
    );
    if (claimHash === null) {
      await touchCustody(custody.entryId);
      return false;
    }

    const claimed = await waitForReceipt(claimHash);
    if (claimed === null || claimed.status !== 'success') {
      // Nothing recorded, so the next run sees an unclaimed prize and tries
      // again — which is right either way, because claimableFor above reads zero
      // once a claim has landed and turns the retry into a no-op rather than a
      // second attempt.
      await log.event('prize.failed', { reason: 'claim_not_mined' });
      await touchCustody(custody.entryId);
      return false;
    }

    // E3: the prize is in the derived wallet now. This is the moment custody
    // begins and therefore the only moment at which its expiry may be set. The
    // own-wallet branch gets none, because it holds nothing: the delivery below
    // runs in the same pass.
    await beginCustody(
      custody.entryId,
      claimHash,
      custody.requiresOwnWallet ? null : custodyExpiryFrom(new Date()),
    );
    await log.event('prize.claimed', {
      giveaway_id: giveawayId.toString(),
      prize_kind: custody.prizeKind,
    });
  }

  // ------------------------------------------------------------- the delivery
  if (destination === null) {
    // E3: temporary custody is bounded. Past the expiry with no destination
    // given, somebody's money is sitting in a wallet the specification says is
    // not a vault, and that is worth waking somebody up for.
    const expiry = custody.custodyExpiresAt;
    if (expiry !== null && new Date(expiry).getTime() <= Date.now()) {
      await log.event('prize.custody_expired', { giveaway_id: giveawayId.toString() });
      await alert(log, 'temporary custody expired with no destination');
    }
    await touchCustody(custody.entryId);
    return false;
  }

  const delivery = await prizeDelivery(campaign, giveawayId, walletAddress, destination);
  if (delivery === null) {
    // Nothing left in the wallet to hand on, which is what an earlier delivery
    // mined after this side stopped waiting looks like.
    await markDelivered(custody.entryId, custody.deliveryTxHash);
    return false;
  }

  const plan = await quoteDelivery(walletAddress, delivery);
  // H2: the destination is the address confirmed under a session (E4) and read
  // from the row; the token or collection comes from the chain. Neither reaches
  // here from a request.
  const deliveryHash = await fundAndSubmit(
    participant.walletIndex,
    walletAddress,
    delivery.to,
    delivery.data,
    plan,
    log,
  );
  if (deliveryHash === null) {
    await touchCustody(custody.entryId);
    return false;
  }

  const receipt = await waitForReceipt(deliveryHash);
  if (receipt?.status !== 'success') {
    // Not marked delivered. The next run reads the wallet balance again, so a
    // transfer that confirms late is seen as nothing left to send rather than
    // sent a second time.
    await log.event('prize.failed', { reason: 'delivery_not_mined' });
    await touchCustody(custody.entryId);
    return false;
  }

  await markDelivered(custody.entryId, deliveryHash);
  await log.event('prize.delivered', {
    giveaway_id: giveawayId.toString(),
    prize_kind: custody.prizeKind,
  });
  return true;
}

/**
 * Runs the prize path for a bounded number of entries.
 *
 * Every row the pass looks at is written, moved along or not, so the queue
 * advances and a prize waiting on a destination does not shadow the ones behind
 * it.
 */
export async function processPrizes(log: Logger): Promise<number> {
  const pending = await listPendingPrizes(PRIZE_BATCH);
  if (pending.length === 0) return 0;

  // Read once per run rather than once per prize: it is a constant in the
  // deployed bytecode, and a second read would only be a second chance for the
  // RPC to fail.
  const deadlineSeconds = await claimDeadlineSeconds();

  let delivered = 0;
  for (const prize of pending) {
    try {
      if (await processPrize(prize, log, deadlineSeconds)) delivered += 1;
    } catch (error) {
      await log.failure('prize.failed', error);
      await touchCustody(prize.custody.entryId);
    }
  }
  return delivered;
}
