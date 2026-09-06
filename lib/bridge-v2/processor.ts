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
  listStale,
  listSubmitted,
  listVerified,
  markSwept,
  touch,
  type Entry,
} from './entries.js';
import {
  ENTRY_WORST_CASE_MS,
  FUNDING_STALE_MS,
  PRIZE_WORST_CASE_MS,
  RECEIPT_TIMEOUT_MS,
  RPC_TIMEOUT_MS,
} from './config.js';
import type { RunDeadline } from './runlock.js';
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
  transactionKnown,
  waitForReceipt,
  type GasPlan,
} from './chain.js';
import {
  beginCustody,
  claimCustodyExpiredAlert,
  closeNoPrize,
  custodyExpiryFrom,
  largestWinnerShare,
  listPendingPrizes,
  markDelivered,
  policyFor,
  touchCustody,
  updatePolicy,
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
 * The campaign must also still be accepting entries. OPEN is not that condition
 * on its own: enter() also requires block.timestamp < effectiveEndTime, and a
 * campaign stays OPEN past its end until somebody calls the permissionless
 * closeGiveaway. Publishing a root in that gap costs the role key a transaction
 * for an admission nobody can use, and then promotes the entries to ELIGIBLE so
 * the funding stage pays for a revert on each of them.
 *
 * G4: ONE CAMPAIGN IS ONE UNIT OF WORK AND ITS FAILURE ENDS ONLY ITSELF. Every
 * await in the body below is a bare RPC or database call, and one of them
 * throwing took the whole loop with it and then the whole run — the funding
 * stage, both reconciliations and the prize stage all skipped because a single
 * campaign's readGiveaway timed out. Every other stage of this pipeline already
 * isolates per item; this one did not, and it is the first stage that touches
 * the chain, so it was the likeliest place for a bad RPC minute to stop
 * everything behind it.
 */
export async function publishPendingRoots(log: Logger, deadline: RunDeadline): Promise<number> {
  let published = 0;

  for (const giveawayId of await campaignsWithVerified(CAMPAIGN_BATCH)) {
    // G4: one publication is a manager transaction plus a bounded receipt wait.
    // Starting another with less than that left is starting work the platform
    // will interrupt.
    if (!deadline.hasTimeFor(RECEIPT_TIMEOUT_MS + 2 * RPC_TIMEOUT_MS)) break;

    try {
      if (await publishForCampaign(giveawayId, log)) published += 1;
    } catch (error) {
      // Nothing to put back: this stage takes no claim on a row, so an entry it
      // failed to publish for is still VERIFIED and is reached again by the next
      // run. What must not happen is the throw leaving this loop.
      await log.failure('root.published', error);
    }
  }

  return published;
}

/**
 * One campaign's publication. True when a root was actually published.
 *
 * Split out of the loop above so the per-campaign catch wraps a body rather than
 * the loop's own control flow.
 */
async function publishForCampaign(giveawayId: bigint, log: Logger): Promise<boolean> {
  const pending = await listVerified(giveawayId, ROOT_BATCH);
  if (pending.length === 0) return false;

  const campaign = await readGiveaway(giveawayId);
  if (!campaign.acceptsEntries) {
    for (const entry of pending) {
      await advance(entry.id, 'VERIFIED', 'FAILED');
    }
    await log.event('entry.failed', {
      giveaway_id: giveawayId.toString(),
      // The two are distinguished because they mean different things to an
      // operator: one is a campaign that ended, the other is one that was
      // cancelled or never opened.
      reason: campaign.isOpen ? 'entries_closed' : 'campaign_not_open',
      count: pending.length,
    });
    return false;
  }

  const slots = await slotsRemaining(giveawayId);
  const admit = pending.slice(0, Number(slots > BigInt(pending.length) ? pending.length : slots));
  if (admit.length === 0) {
    // C8/G4: FAILED, not left VERIFIED. The campaign is full, so enter() reverts
    // with SlotsExhausted for every one of these addresses and no root may admit
    // them — which was already true and already logged, but the rows were left in
    // exactly the state the campaign queue is built from. campaignsWithVerified
    // then returned this campaign on every run for as long as its entry window
    // lasted, spending a place in a batch of twenty and three chain reads on a
    // campaign with nothing left to give, while these entries had no exit of
    // their own until that window closed.
    //
    // The one case this forecloses is a creator calling reloadSlots afterwards,
    // which the contract allows only inside the first part of the entry window
    // (GiveawayManagerV2.reloadSlots). A participant refused here has spent no
    // gas and holds no slot, and the honest record is that they did not get one.
    for (const entry of pending) {
      await advance(entry.id, 'VERIFIED', 'FAILED');
    }
    await log.event('entry.failed', {
      giveaway_id: giveawayId.toString(),
      reason: 'slots_exhausted',
      count: pending.length,
    });
    return false;
  }

  const root = await publishBatch(giveawayId, admit.map((entry) => entry.walletAddress), log);
  // Not confirmed on chain: nothing was recorded, so nothing is promoted. The
  // entries stay VERIFIED and the next run publishes again against a freshly
  // read index (eligibility.ts).
  if (root === null) return false;

  for (const entry of admit) {
    await advance(entry.id, 'VERIFIED', 'ELIGIBLE', { root_index: root.rootIndex.toString() });
    await log.event('entry.eligible', {
      giveaway_id: giveawayId.toString(),
      root_index: root.rootIndex.toString(),
    });
  }
  return true;
}

/**
 * Funds one derived wallet and submits its entry.
 *
 * THE ORDER IS THE WHOLE OF IT, and it was wrong in a way that only showed up
 * under failure. Four chain reads, a budget claim, a funder acquisition and a
 * gas quote all ran while the entry was still ELIGIBLE, and the quote ran
 * outside the try. A quote throws for ordinary reasons — the RPC is slow, the
 * campaign just closed, the fee estimate came back unusable — and when it did,
 * the entry was left ELIGIBLE with its updated_at untouched. listEligible orders
 * by updated_at, so that entry was the first row of the next run, and of the run
 * after that, for as long as the condition lasted. One participant's bad minute
 * became every participant's, because nothing behind them was ever reached. The
 * throw also escaped processEligibleEntries, which had no per-entry catch, so a
 * single entry aborted the run's remaining stages as well.
 *
 * Now the state moves first and everything else happens inside the try. FUNDING
 * is a claim on the entry, and taking it rewrites updated_at, which by itself
 * sends the entry to the back of the queue whatever happens next. Every exit
 * below either advances the entry or returns it to ELIGIBLE through a write, so
 * there is no path that leaves a row exactly as it found it.
 *
 * The reads that decide whether to spend anything at all still come first,
 * because they are cheap, they are terminal, and none of them costs gas:
 *
 * G5: if the contract already says this address entered, the work is done and
 * repeating it would fund a wallet for a transaction that must revert.
 *
 * H5/H6: the slot ledger, and the campaign's real deadline. Slots bound what a
 * hostile creator can make the pool spend; effectiveEndTime is the other half of
 * the condition enter() actually checks, and without it the bridge funded
 * entries into campaigns whose entry window had closed while their status was
 * still OPEN.
 *
 * G3: the funder lease is renewed after the funding transaction and before the
 * entry, so a slow confirmation cannot let the lease lapse while this operation
 * is still using the nonce.
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

  // H5/H6. enter() checks the status AND the effective end (contract line 709),
  // and a campaign stays OPEN past its end until somebody calls closeGiveaway.
  // Funding an entry inside that gap buys a certain EntriesClosed revert.
  const campaign = await readGiveaway(entry.giveawayId);
  if (!campaign.acceptsEntries) {
    await advance(entry.id, 'ELIGIBLE', 'FAILED');
    await log.event('entry.failed', {
      reason: campaign.isOpen ? 'entries_closed' : 'campaign_not_open',
    });
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

  // The claim on the entry, taken before anything that can fail transiently. A
  // false here means another run took it, which under the pipeline lock should
  // not happen and is still the only safe reading of it.
  if (!(await advance(entry.id, 'ELIGIBLE', 'FUNDING'))) return;

  // B8: the gas budget is claimed before any of it is spent. Inside the claim,
  // so a refusal returns the entry to ELIGIBLE — at the back of the queue,
  // because the transition wrote updated_at — rather than leaving it FUNDING
  // with nothing holding it.
  if (!(await claimSpend('chain', 1, log))) {
    await advance(entry.id, 'FUNDING', 'ELIGIBLE');
    return;
  }

  const lease = await acquireFunder();
  if (lease === null) {
    await advance(entry.id, 'FUNDING', 'ELIGIBLE');
    await log.event('funder.exhausted');
    await alert(log, 'no funder available');
    return;
  }

  let nextNonce = lease.nextNonce;
  try {
    // Inside the try, and after the transition. This is the call that reverts
    // when the campaign closed a block ago, when the proof does not verify, or
    // when the RPC is having a bad minute — every one of them a reason to put
    // the entry back, and none of them a reason to stop the run.
    const quote = await quoteEntryCost(
      entry.giveawayId,
      entry.walletAddress,
      proof.rootIndex,
      proof.proof,
    );

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
    //
    // G2: and the write is checked, because it is the ONLY record that this
    // transaction was ever broadcast. Ignoring its result meant a failed write
    // left the entry in FUNDING with a live transaction against it and no hash
    // anywhere — a state nothing listed and nothing could reconcile. The throw
    // reaches the catch below, which returns the entry to ELIGIBLE; hasEntered
    // at the top of the next attempt is what makes that safe, since it reads the
    // fact this row failed to record.
    if (!(await advance(entry.id, 'FUNDING', 'SUBMITTED', { tx_hash: hash }))) {
      await log.event('entry.failed', { reason: 'submitted_not_recorded' });
      return;
    }
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

/**
 * Runs the funding and entry step for a bounded number of entries.
 *
 * Two guarantees live here rather than in the function above, because both are
 * about the run and not about the entry.
 *
 * No transient failure aborts the run. The catch is per entry: an RPC timeout,
 * a database error, a fee estimate that came back nonsense — each of those ends
 * one entry's attempt and the loop moves to the next. Without it the first throw
 * escaped to the cron handler, which then skipped the prize stage entirely,
 * so one unlucky entry stopped the delivery of somebody else's prize.
 *
 * No entry holds the head of the queue. Whatever happened, the row is written
 * before the loop moves on — by the transitions inside processEligible on every
 * path it takes, and by the touch below on the path where it threw before any of
 * them. listEligible orders by updated_at, so a row that is never written is a
 * row that is first for ever.
 *
 * G4: the deadline is checked between entries, so a run stops between units of
 * work rather than inside one. A killed run is what leaves an entry in FUNDING
 * and a broadcast transaction with no hash recorded anywhere.
 */
export async function processEligibleEntries(log: Logger, deadline: RunDeadline): Promise<number> {
  const entries = await listEligible(ENTRY_BATCH);
  let attempted = 0;

  for (const entry of entries) {
    if (!deadline.hasTimeFor(ENTRY_WORST_CASE_MS)) break;
    attempted += 1;

    try {
      await processEligible(entry, log);
    } catch (error) {
      await log.failure('entry.failed', error);
      try {
        // The entry is wherever the throw left it — ELIGIBLE if it failed before
        // the claim, FUNDING if after. Either way it must not be the head of the
        // queue again, and FUNDING has reconcileFunding to bring it back.
        await touch(entry.id);
      } catch {
        // Nothing further to try: the database that failed the write above is
        // the database this would use. The failure is already recorded.
      }
    }
  }

  return attempted;
}

/**
 * I8: brings back entries left in FUNDING by a run that no longer exists.
 *
 * FUNDING is the only state with no query behind it, and that was survivable
 * exactly as long as the invocation holding it always reached one of its own
 * exits. It does not: the platform kills a function at its duration limit
 * wherever it happens to be, and a container can simply go away. What was left
 * behind was an entry in a state nothing listed, for a participant who had
 * verified a phone number and been given a slot — a terminal state reached by
 * accident, which is what I8 forbids.
 *
 * The chain decides which way it goes. hasEntered is the fact that matters and
 * is true whether or not this side ever saw a receipt; anything else goes back
 * to ELIGIBLE, where the first thing the next attempt does is read hasEntered
 * again. The gas already in the wallet is not lost — the sweep recovers whatever
 * a successful entry did not spend.
 *
 * The staleness threshold is what keeps this from racing a live run: FUNDING is
 * only held inside a scheduled run, a run cannot outlive its maxDuration, and
 * one run at a time holds the pipeline lock.
 */
export async function reconcileFunding(log: Logger, deadline: RunDeadline): Promise<number> {
  const entries = await listStale('FUNDING', FUNDING_STALE_MS, ENTRY_BATCH);
  let recovered = 0;

  for (const entry of entries) {
    if (!deadline.hasTimeFor(2 * RPC_TIMEOUT_MS)) break;

    try {
      if (await hasEntered(entry.giveawayId, entry.walletAddress)) {
        await advance(entry.id, 'FUNDING', 'CONFIRMED');
        await log.event('entry.confirmed', { reason: 'recovered_from_funding' });
      } else {
        await advance(entry.id, 'FUNDING', 'ELIGIBLE');
        await log.event('entry.failed', { reason: 'funding_abandoned' });
      }
      recovered += 1;
    } catch (error) {
      await log.failure('entry.failed', error);
      try {
        await touch(entry.id);
      } catch {
        // As above: the write that would record this is the one that failed.
      }
    }
  }

  return recovered;
}

/**
 * Finishes entries whose receipt was never seen.
 *
 * K3 and G4 together: a bounded wait means some transactions outlive the
 * function that sent them, which is correct but leaves the row saying SUBMITTED
 * when the chain has moved on. The chain is asked directly rather than the
 * receipt being awaited again, because hasEntered is the fact that actually
 * matters and it is true whether or not this process ever saw the receipt.
 *
 * I8: AND THE THIRD ANSWER IS THE ONE THAT WAS MISSING. Mined-and-successful and
 * mined-and-reverted both had exits. The third — not mined, and no longer in the
 * mempool — had none: the row was touched, moved to the back of the queue, and
 * read again on the next run, for ever. A transaction is dropped for ordinary
 * reasons, a fee that stopped clearing or a node that evicted it, and once it is
 * gone nothing will ever mine it, so waiting is waiting on an event that cannot
 * happen. That is a terminal state reached by accident, which is exactly what I8
 * forbids, and the participant it belonged to had verified a number and been
 * given a slot.
 *
 * transactionKnown is what separates the third case from the second. A node that
 * has never heard of the hash is a node where the transaction is neither mined
 * nor pending; the entry goes back to ELIGIBLE and the next attempt reads
 * hasEntered first, so a transaction that turns out to have landed after all
 * costs a read and not a second entry.
 *
 * G4: each entry is isolated, like every other stage. Four bare awaits against
 * the chain and the database ran here with nothing around them, and one RPC
 * timeout ended the whole reconciliation — which is the first stage of the run,
 * so it ended the run.
 */
export async function reconcileSubmitted(log: Logger, deadline: RunDeadline): Promise<number> {
  const entries = await listSubmitted(ENTRY_BATCH);
  let seen = 0;

  for (const entry of entries) {
    // G4: one of these can wait a full receipt timeout, and asks the node about
    // the hash afterwards.
    if (!deadline.hasTimeFor(RECEIPT_TIMEOUT_MS + 2 * RPC_TIMEOUT_MS)) break;
    seen += 1;

    try {
      await reconcileOneSubmitted(entry, log);
    } catch (error) {
      await log.failure('entry.failed', error);
      try {
        // The entry is untouched by a throw here — nothing above takes a claim on
        // it — so the only thing left to do is stop it holding the head of the
        // queue.
        await touch(entry.id);
      } catch {
        // The database that failed the write above is the one this would use.
      }
    }
  }

  return seen;
}

/** One SUBMITTED entry, taken to whichever of its three answers the chain gives. */
async function reconcileOneSubmitted(entry: Entry, log: Logger): Promise<void> {
  if (await hasEntered(entry.giveawayId, entry.walletAddress)) {
    await advance(entry.id, 'SUBMITTED', 'CONFIRMED');
    await log.event('entry.confirmed', { reason: 'reconciled' });
    return;
  }

  // No hash recorded and the contract does not have the entry: there is nothing
  // to wait for and nothing to ask the node about. Back to ELIGIBLE, which is
  // where an entry whose broadcast was never recorded belongs.
  if (entry.txHash === null) {
    await advance(entry.id, 'SUBMITTED', 'ELIGIBLE');
    await log.event('entry.failed', { reason: 'no_transaction_recorded' });
    return;
  }

  const hash = entry.txHash as `0x${string}`;
  const receipt = await waitForReceipt(hash);
  if (receipt?.status === 'reverted') {
    // The transaction was mined and failed. Back to ELIGIBLE so it is retried
    // with a fresh quote; the wallet keeps whatever gas is left, which the
    // sweep will recover if the entry never succeeds.
    await advance(entry.id, 'SUBMITTED', 'ELIGIBLE');
    await log.event('entry.failed', { reason: 'reverted' });
    return;
  }

  // I8: not mined, and the node has never heard of it. Dropped, and no later run
  // changes that answer.
  if (!(await transactionKnown(hash))) {
    await advance(entry.id, 'SUBMITTED', 'ELIGIBLE');
    await log.event('entry.failed', { reason: 'transaction_dropped' });
    return;
  }

  // Still in the mempool. Nothing about the entry changes, but its place in
  // the queue must: the list is the oldest SUBMITTED entries by updated_at,
  // and leaving the row untouched keeps it at the head of every subsequent
  // run. One transaction that never confirms would then stop every entry
  // behind it from ever being reconciled.
  await touch(entry.id);
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
export async function sweepConfirmed(
  log: Logger,
  destination: `0x${string}`,
  deadline: RunDeadline,
): Promise<number> {
  const entries = await listConfirmed(ENTRY_BATCH);
  let swept = 0;

  for (const entry of entries) {
    // G4: a sweep is four reads and a broadcast, with no receipt wait.
    if (!deadline.hasTimeFor(5 * RPC_TIMEOUT_MS)) break;

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

  // -------------------------------------------------------------- E2 under D1
  // The rule recorded at entry time was provisional twice over: the share came
  // from a winnersCount the contract had not yet clamped, and it was compared
  // against a USDC threshold in the base units of whatever token the creator
  // chose. Both are settled now — the campaign has closed, so winnersCount is
  // final, and feeToken names the token the prize is actually paid in.
  //
  // claimable() is the contract's own answer to "what is this wallet owed", and
  // it is the number the threshold is about. It reads zero once a claim has
  // landed, so for a prize already in the wallet the largest share the campaign
  // can pay stands in — which errs strict, and only ever strict.
  const claimableNow = await claimableFor(giveawayId, walletAddress);
  const winnerShare =
    claimableNow > 0n
      ? claimableNow
      : largestWinnerShare(campaign.prizeAmount, campaign.winnersCount);
  const policy = policyFor(campaign.prizeKind, winnerShare, campaign.feeToken);
  const requiresOwnWallet = policy.requiresOwnWallet;

  // Written before anything moves, so the branch the transaction takes is the
  // branch the row records. A run that dies after this reads the same answer.
  if (requiresOwnWallet !== custody.requiresOwnWallet) {
    await updatePolicy(custody.entryId, requiresOwnWallet);
  }

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
      requiresOwnWallet ? null : custodyExpiryFrom(new Date()),
    );
    await log.event('prize.claimed', {
      giveaway_id: giveawayId.toString(),
      prize_kind: custody.prizeKind,
      reason: 'already_on_chain',
    });
  } else if (custody.claimedAt === null) {
    if (claimClosed) {
      // §7/G4: out of the queue, not back to the end of it. Past CLAIM_DEADLINE
      // claimPrize reverts with ClaimExpired and the creator may reclaim, so no
      // later run reaches a different answer, and a row nothing can move is a row
      // ahead of every prize that can still be delivered.
      await log.event('prize.expired', { giveaway_id: giveawayId.toString() });
      await closeNoPrize(custody.entryId);
      return false;
    }

    // E2 under D1: a prize that must go to a wallet the winner owns is not
    // claimed until there is one to send it to. The flag is the one computed
    // above from what the contract says this winner is owed, not the provisional
    // one written at entry time.
    if (requiresOwnWallet && destination === null) {
      await touchCustody(custody.entryId);
      return false;
    }

    if (claimableNow <= 0n) {
      // §7/G4: this entrant did not win, and there is no later state in which
      // they might. The campaign has settled — checked at the top of this
      // function — so the draw has happened and claimable() is zero for the
      // rest of time; claimed_at is null, so this is not a prize that was
      // already collected. Both halves have to hold, and closeNoPrize insists
      // on the second one itself.
      //
      // It used to be touched instead, which put it at the back of a queue it
      // could never leave. Every entry that confirms gets a custody row, so a
      // campaign with a thousand entrants and three winners left nine hundred
      // and ninety-seven of these, for ever, ordered ahead of every real prize
      // behind them and costing two chain reads apiece on every single run.
      await closeNoPrize(custody.entryId);
      await log.event('prize.expired', {
        giveaway_id: giveawayId.toString(),
        reason: 'not_a_winner',
      });
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
      requiresOwnWallet ? null : custodyExpiryFrom(new Date()),
    );
    await log.event('prize.claimed', {
      giveaway_id: giveawayId.toString(),
      prize_kind: custody.prizeKind,
    });
  }

  // ------------------------------------------------------------- the delivery
  if (destination === null) {
    // E3, and OWNER DECISION D2 of 06/09/2026.
    //
    // Past the expiry with no destination given, somebody's money is sitting in
    // a wallet the specification says is not a vault. D2 settles what happens
    // next: the value stays where it is, the bridge takes no automatic action on
    // it, and one alert is raised — once, for this custody, ever.
    //
    // Once is the part that needed a write. The condition "the expiry is in the
    // past" stays true for as long as the prize is unclaimed, so alerting on it
    // meant one message a minute about one prize for as long as it sat there.
    // The claim below is conditional on the column still being null and the
    // database decides which pass wins, so the alert belongs to the custody and
    // not to the schedule.
    const expiry = custody.custodyExpiresAt;
    if (
      expiry !== null &&
      new Date(expiry).getTime() <= Date.now() &&
      custody.custodyExpiredAlertAt === null &&
      (await claimCustodyExpiredAlert(custody.entryId))
    ) {
      await log.event('prize.custody_expired', { giveaway_id: giveawayId.toString() });
      await alert(log, 'temporary custody expired with no destination', {
        giveaway_id: giveawayId.toString(),
      });
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
export async function processPrizes(log: Logger, deadline: RunDeadline): Promise<number> {
  const pending = await listPendingPrizes(PRIZE_BATCH);
  if (pending.length === 0) return 0;

  // Read once per run rather than once per prize: it is a constant in the
  // deployed bytecode, and a second read would only be a second chance for the
  // RPC to fail.
  const deadlineSeconds = await claimDeadlineSeconds();

  let delivered = 0;
  for (const prize of pending) {
    // G4: a prize can be a claim and a delivery, each with its own funding and
    // its own receipt wait, so it is the most expensive unit the pipeline runs.
    //
    // The size of that unit is PRIZE_WORST_CASE_MS and is defined in config.ts
    // beside the budget it has to fit inside, which is the whole of the fix: the
    // reservation written here was 2 * ENTRY_WORST_CASE_MS = 300_000 ms against a
    // budget of 280_000 ms, so it was false on the first millisecond of every run
    // and this loop never ran its body once. No prize was ever claimed and none
    // was ever delivered, and nothing said so — the stage returned 0 and looked
    // like a stage with no work to do.
    if (!deadline.hasTimeFor(PRIZE_WORST_CASE_MS)) break;

    try {
      if (await processPrize(prize, log, deadlineSeconds)) delivered += 1;
    } catch (error) {
      await log.failure('prize.failed', error);
      try {
        await touchCustody(prize.custody.entryId);
      } catch {
        // The database that failed above is the one this would use.
      }
    }
  }
  return delivered;
}
