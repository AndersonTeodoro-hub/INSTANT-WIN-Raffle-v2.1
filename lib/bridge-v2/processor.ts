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
import { formatUnits } from 'viem';
import {
  advance,
  campaignsAwaitingOutcome,
  campaignsWithVerified,
  claimNotice,
  fundingMark,
  listAwaitingOutcome,
  listEligible,
  listStale,
  listSubmitted,
  listSweepable,
  listVerified,
  markFunded,
  markSwept,
  recordOutcome,
  releaseNotice,
  touch,
  type Entry,
  type EntryOutcome,
  type OutcomeTarget,
} from './entries.js';
import {
  FUNDING_STALE_MS,
  PHASE_RESERVATION_MS,
  SELF_CUSTODY_RECONCILE_MS,
  SETTLEMENT_NOTICE_MS,
  SWEEP_WORST_CASE_MS,
} from './config.js';
import { sendSettlementEmail } from './mail.js';
import { GiveawayStatus, PrizeKind } from './abi.js';
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
  erc20Meta,
  quoteEntryCost,
  readGiveaway,
  slotsRemaining,
  type Erc20Meta,
  type GiveawayView,
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
  randomFunderAddress,
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
    // will interrupt. The size is declared in config.ts beside the budget it has
    // to fit inside, which is where it is checked.
    if (!deadline.hasTimeFor(PHASE_RESERVATION_MS.publishRoots)) break;

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
  //
  // H7: and the mark that says gas is about to enter this wallet, written in the
  // same statement as the claim. Nothing below can fund a wallet whose row does
  // not already say it was funded, whatever kills this invocation between the two
  // — because there is no "between the two". An attempt that ends before the
  // transfer costs the sweep one look at an empty address, which is the side to
  // be wrong on: the other one strands value where nothing lists it.
  if (!(await advance(entry.id, 'ELIGIBLE', 'FUNDING', fundingMark()))) return;

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

    // H3/H7: null is "the wallet already holds what the entry needs", which is
    // the ordinary shape of a retry — the previous attempt's gas is still there.
    // Nothing was sent, so there is nothing to wait for.
    if (fundingHash === null) {
      await log.event('entry.funded', {
        giveaway_id: entry.giveawayId.toString(),
        reason: 'already_funded',
      });
    } else {
      // The funding must be mined before the wallet can pay for its own entry.
      const fundingReceipt = await waitForReceipt(fundingHash);
      if (fundingReceipt === null || fundingReceipt.status !== 'success') {
        await advance(entry.id, 'FUNDING', 'ELIGIBLE');
        await log.event('entry.failed', { reason: 'funding_not_mined' });
        return;
      }
      await log.event('entry.funded', { giveaway_id: entry.giveawayId.toString() });
    }

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
    // 07/09/2026 decision: a self_custody entry costs SELF_CUSTODY_RECONCILE_MS
    // — no funding, no signing, just a chain read — while every other entry
    // costs the full processEntries reservation. Checked per row, against
    // whichever budget this row is actually about to spend, rather than one
    // reservation guarding two different costs.
    const reservation = entry.selfCustody ? SELF_CUSTODY_RECONCILE_MS : PHASE_RESERVATION_MS.processEntries;
    if (!deadline.hasTimeFor(reservation)) break;
    attempted += 1;

    try {
      if (entry.selfCustody) {
        await reconcileSelfCustodyEntry(entry, log);
      } else {
        await processEligible(entry, log);
      }
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
 * 07/09/2026 decision: a self-custody entry confirms itself.
 *
 * Its address sits inside a published root, exactly like any other ELIGIBLE
 * entry, but the bridge holds no key for it — the participant connected their
 * own wallet, signs enter() with their own gas, and the platform never
 * touches it. This does the one thing the bridge still can: ask the chain
 * whether they have, and record CONFIRMED when they have. It never funds,
 * never signs, and an entry it cannot yet confirm is simply asked again next
 * run — there is no funding claim to hold, so there is nothing to put back on
 * failure.
 */
async function reconcileSelfCustodyEntry(entry: Entry, log: Logger): Promise<void> {
  if (await hasEntered(entry.giveawayId, entry.walletAddress)) {
    if (await advance(entry.id, 'ELIGIBLE', 'CONFIRMED')) {
      await log.event('entry.confirmed', { reason: 'self_custody' });
    }
  } else {
    // Nothing to do yet; only the queue position changes, so the next run
    // does not read the same entry first for ever while others wait.
    await touch(entry.id);
  }
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
    if (!deadline.hasTimeFor(PHASE_RESERVATION_MS.reconcileFunding)) break;

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
    if (!deadline.hasTimeFor(PHASE_RESERVATION_MS.reconcileSubmitted)) break;
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
 * H7: recovers the gas a derived wallet was given and did not spend.
 *
 * Every funding sends the wallet the margin the plan uses, and whatever the
 * transaction did not consume stays there. The V1 had no mechanism at all, so the
 * remainder of every entry ever made was stranded, one address at a time.
 *
 * WHAT IT LOOKS AT IS NOW EVERY WALLET THAT WAS PAID, and the two things that
 * narrowed it are recorded on listSweepable: it read only CONFIRMED entries, so a
 * wallet funded for an entry that ended FAILED kept its gas for ever, and the
 * mark it wrote was terminal, so the two prize fundings that come months later
 * left remainders no pass would look at. The queue is the wallets that have been
 * funded and not swept since, whatever the entry ended as and whichever phase did
 * the funding.
 *
 * D6: the destination is drawn from the funder pool rather than fixed. It is
 * still a funder and still nothing a request can name (H2) — but it is no longer
 * the same funder for every participant, which is an edge the random funding had
 * deliberately refused to draw.
 *
 * G6, ON MEETING A PRIZE IN FLIGHT, which a queue that outlives the entry stage
 * can now do. This pass holds the pipeline lock, so it never runs beside the
 * stage that claims and delivers; what it can meet is a claim broadcast by an
 * earlier run and not yet mined. sweepRemainder reads the derived wallet's nonce
 * at `pending`, so the sweep is signed one past that claim and cannot be mined
 * before it — the claim's gas cannot be taken out from under it. What can happen
 * instead is that the sweep is refused, because the value it computed from the
 * balance at `latest` no longer exists once the claim has paid for itself. That
 * is a failed sweep and not a lost prize, and the catch below puts the wallet
 * back in the queue rather than closing it.
 */
export async function sweepConfirmed(
  log: Logger,
  poolSize: number,
  deadline: RunDeadline,
): Promise<number> {
  const entries = await listSweepable(ENTRY_BATCH);
  let swept = 0;

  for (const entry of entries) {
    // G4: a sweep is four reads and a broadcast, with no receipt wait.
    if (!deadline.hasTimeFor(SWEEP_WORST_CASE_MS)) break;

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
        randomFunderAddress(poolSize),
        signAsDerived,
      );
      if (hash !== null) {
        swept += 1;
        await log.event('sweep.done', { giveaway_id: entry.giveawayId.toString() });
      }
      // Marked either way. A null means the remainder is below what the sweep
      // itself costs, and nothing about the wallet changes until it is funded
      // again — at which point the funding clears this mark and the wallet comes
      // back. Leaving it unmarked is what made the batch return the same rows for
      // ever and never reach the entries behind them.
      await markSwept(entry.id);
    } catch (error) {
      // TOUCHED, NOT MARKED. A throw here is a sweep that could not be made now —
      // an RPC having a bad minute, or a transaction of the wallet's own still in
      // the mempool — and none of those is an answer about the remainder. Marking
      // it closed the wallet permanently, which for the last funding a wallet
      // ever receives, the prize delivery, meant the remainder of the whole prize
      // path was abandoned on one transient error with nothing left to reopen it.
      // The row still has to leave the head of the queue, and touch is what does
      // that: this list is ordered by updated_at, so the wallet goes to the back
      // and is tried again rather than given up on.
      await log.failure('sweep.done', error);
      await touch(entry.id);
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
  entryId: string,
  walletIndex: number,
  wallet: `0x${string}`,
  to: `0x${string}`,
  data: `0x${string}`,
  plan: GasPlan,
  log: Logger,
): Promise<`0x${string}` | null> {
  // H7: the same mark the entry path writes into its FUNDING transition, and for
  // the same reason — before anything is spent, so no gas reaches this wallet
  // that the sweep queue does not already know about. It matters more here than
  // there: this is the second and third time this wallet is funded, months after
  // the sweep decided it was finished with, and the mark clearing swept_at is the
  // only thing that brings it back.
  await markFunded(entryId);

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

    // H3/H7: null is "the wallet already holds what this call needs" — the gas a
    // previous attempt sent and this one would otherwise send again. Nothing was
    // broadcast, so there is no receipt to wait for.
    if (fundingHash !== null) {
      const funded = await waitForReceipt(fundingHash);
      if (funded === null || funded.status !== 'success') {
        await log.event('prize.failed', { reason: 'funding_not_mined' });
        return null;
      }
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
      custody.entryId,
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
    custody.entryId,
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

// ---------------------------------------------------------------------------
// settlement notices
// ---------------------------------------------------------------------------

/**
 * How much of the notice queue one run takes. Small, because every campaign in
 * the batch costs a readGiveaway whether or not it has settled. What is left is
 * at the head of the queue on the next run.
 */
const NOTICE_CAMPAIGN_BATCH = 5;
const NOTICE_ENTRY_BATCH = 25;

/**
 * What the campaign did to one wallet, and what it is owed, in one answer.
 *
 * TWO READS ARE NEEDED: claimable() answers zero for a wallet that never won and
 * for a winner already paid (GiveawayManagerV2.sol:1458-1464), and prizeClaimed
 * is the permanent mapping that separates them.
 *
 * Only ever called inside the claim window. Past it the creator may reclaim and
 * claimable() reads zero for a winner who never claimed, so "not claimable and
 * not claimed" would write LOST — once, and for ever — against somebody who won.
 * notifySettlements retires those campaigns before reaching here.
 */
async function readOutcome(
  giveawayId: bigint,
  wallet: `0x${string}`,
): Promise<{ outcome: EntryOutcome; claimable: bigint }> {
  const claimable = await claimableFor(giveawayId, wallet);
  if (claimable > 0n) return { outcome: 'WON', claimable };
  const paid = await prizeAlreadyClaimed(giveawayId, wallet);
  return { outcome: paid ? 'WON' : 'LOST', claimable: 0n };
}

/**
 * What the winner won, in words, or null when it cannot be said precisely.
 *
 * feeToken IS the prize token for a TOKEN campaign (GiveawayManagerV2.sol:566),
 * which is why GiveawayView has no separate prizeToken field. The amount is
 * claimable() when there is one; once the prize is collected that reads zero and
 * the even share stands in, within one base unit for every winner but the first.
 *
 * null is a deliberate answer: mail.ts turns it into "a share of the prize", and
 * a notice that names no amount is worth far more than no notice at all.
 */
function prizeWords(
  campaign: GiveawayView,
  claimable: bigint,
  meta: Erc20Meta | null,
): string | null {
  if (campaign.prizeKind === PrizeKind.NFT) return '1 item';
  if (meta === null) return null;

  const amount =
    claimable > 0n
      ? claimable
      : largestWinnerShare(campaign.prizeAmount, campaign.winnersCount);

  return `${formatUnits(amount, meta.decimals)} ${meta.symbol}`;
}

/**
 * A participant whose data was erased has no address to write to: privacy/
 * erase.ts writes `erased-<hex>@invalid`, a domain RFC 2606 reserves so that
 * nothing tries to deliver to it. Without this, one refused post per erased
 * entrant per run, for ever.
 */
function deliverable(email: string): boolean {
  return email.length > 0 && !email.toLowerCase().endsWith('@invalid');
}

/**
 * Records one entry's result and, if it has not been sent, sends it.
 *
 * THE ORDER IS THE POINT. The result is written first and independently of the
 * email, because it is what entry/status reads to decide whether this
 * participant is shown a prize panel — so a provider outage delays a notice and
 * never leaves the page telling a loser that a prize is theirs.
 *
 * Then the provider budget (B8), then the notice, then the send: a denied spend
 * must leave the row where it was, and a claim taken after the send would let
 * two passes both send.
 *
 * 'denied' is told apart from 'skipped' because it is not about this entry: the
 * ceiling belongs to the whole run, and the caller has to stop rather than ask
 * again with the next one.
 */
async function notifyOutcome(
  target: OutcomeTarget,
  giveawayId: bigint,
  campaign: GiveawayView,
  meta: Erc20Meta | null,
  log: Logger,
): Promise<'sent' | 'skipped' | 'denied'> {
  const detail = { giveaway_id: giveawayId.toString() };

  // A result already on the row is not read again. It was written from the same
  // contract state and cannot have changed.
  let outcome = target.outcome;
  let claimable = 0n;
  if (outcome === null) {
    const read = await readOutcome(giveawayId, target.walletAddress);
    outcome = read.outcome;
    claimable = read.claimable;
    if (await recordOutcome(target.entryId, outcome)) {
      await log.event('outcome.recorded', { ...detail, outcome });
    }
  } else if (outcome === 'WON') {
    // Retrying a notice recorded by an earlier run. The amount is not on the
    // row, so it is read again — winners only, on the rare retry path.
    claimable = await claimableFor(giveawayId, target.walletAddress);
  }

  if (!deliverable(target.email)) {
    // Nothing to send and nothing to retry. Claimed so the row leaves the queue
    // rather than being reconsidered on every run for ever.
    await claimNotice(target.entryId);
    await log.event('outcome.failed', { ...detail, reason: 'no_deliverable_address' });
    return 'skipped';
  }

  // B8: the one outbound provider call in the pipeline that counted against no
  // ceiling, and the one that fans out per entrant — a settled campaign with a
  // thousand entries is a thousand posts nothing was metering.
  if (!(await claimSpend('email', 1, log))) return 'denied';

  if (!(await claimNotice(target.entryId))) return 'skipped';

  // E2 under D1, from the one function that decides it. Two places that both
  // answer "may this prize rest in temporary custody" is two places that can
  // disagree, and the one the participant would act on is this email.
  const winnerShare =
    claimable > 0n ? claimable : largestWinnerShare(campaign.prizeAmount, campaign.winnersCount);

  const result = await sendSettlementEmail(target.email, {
    giveawayId,
    won: outcome === 'WON',
    prize: outcome === 'WON' ? prizeWords(campaign, claimable, meta) : null,
    requiresOwnWallet: policyFor(campaign.prizeKind, winnerShare, campaign.feeToken)
      .requiresOwnWallet,
    selfCustody: target.selfCustody,
  });

  if (!result.sent) {
    await releaseNotice(target.entryId);
    await log.event('outcome.failed', { ...detail, reason: 'mail_rejected' });
    return 'skipped';
  }

  await log.event('outcome.notified', { ...detail, outcome });
  return 'sent';
}

/**
 * Retires the entries of a campaign that will never have a result worth sending:
 * a cancelled one, which never settles, or one whose ninety-day claim window has
 * closed, where claimable() reads zero for a winner who never claimed as well as
 * for a loser and any answer would be a guess written once.
 *
 * Both columns, because they do different work: outcome gives the row a terminal
 * value so the page stops waiting for one, outcome_notified_at is what takes it
 * out of the queue. Nothing is sent — an email about a prize whose window has
 * closed is worse than silence.
 */
async function retire(
  targets: OutcomeTarget[],
  giveawayId: bigint,
  reason: string,
  log: Logger,
): Promise<void> {
  for (const target of targets) {
    if (target.outcome === null) await recordOutcome(target.entryId, 'VOID');
    await claimNotice(target.entryId);
  }
  if (targets.length > 0) {
    await log.event('outcome.recorded', {
      giveaway_id: giveawayId.toString(),
      outcome: 'VOID',
      reason,
      entries: targets.length,
    });
  }
}

/**
 * Tells every entrant of a settled campaign what happened to their entry.
 *
 * WHY THIS EXISTS. Until it did, the only outbound email was a verification
 * code and R3 forbids the bot from mentioning a prize, so a winner was never
 * told; they found out by returning to the page of their own accord, or the
 * ninety-day claim deadline ran down.
 *
 * WHY IT IS NOT A PHASE: SELF_CUSTODY_RECONCILE_MS in config.ts records the same
 * decision. A sixth name in PIPELINE_PHASES changes the bound the G4 tests fix
 * at five.
 *
 * WHY EVERY CAMPAIGN IS ACTED ON OR TOUCHED, never merely skipped: the queue
 * holds campaigns that have not settled, and nothing else writes those rows, so
 * one left alone stays at the head of a five-campaign batch for ever and the
 * winners behind it are never told. The touch moves it to the back; 0010 orders
 * on max(updated_at) so one write is enough.
 */
export async function notifySettlements(log: Logger, deadline: RunDeadline): Promise<number> {
  const campaigns = await campaignsAwaitingOutcome(NOTICE_CAMPAIGN_BATCH);
  if (campaigns.length === 0) return 0;

  // Read at most once per pass, and only if a campaign gets as far as needing
  // it. It is a constant in the deployed bytecode.
  let claimWindowSeconds: bigint | null = null;

  let sent = 0;
  for (const giveawayId of campaigns) {
    if (!deadline.hasTimeFor(SETTLEMENT_NOTICE_MS)) break;

    // G4: one campaign's failure is not the pass's. Without this a single
    // unreadable campaign ends the pass at the head of the queue, on every run.
    let targets: OutcomeTarget[] = [];
    try {
      targets = await listAwaitingOutcome(giveawayId, NOTICE_ENTRY_BATCH);
      if (targets.length === 0) continue;

      const campaign = await readGiveaway(giveawayId);

      if (campaign.status === GiveawayStatus.CANCELLED) {
        await retire(targets, giveawayId, 'cancelled', log);
        continue;
      }

      // OPEN, CLOSED, or mid-draw. No result yet, so the rows stay in the queue
      // and the campaign goes to the back of it.
      if (!campaign.isSettled) {
        await touch(targets[0].entryId);
        continue;
      }

      // Past CLAIM_DEADLINE the creator may reclaim and claimable() reads zero
      // for a winner who never claimed, so the chain can no longer say who won.
      // The same window processPrize refuses to act inside (claimClosed).
      claimWindowSeconds ??= await claimDeadlineSeconds();
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      if (nowSeconds > campaign.settledAt + claimWindowSeconds) {
        await retire(targets, giveawayId, 'claim_closed', log);
        continue;
      }

      // Once per campaign, not once per winner: every winner is paid in the same
      // token.
      const meta =
        campaign.prizeKind === PrizeKind.NFT ? null : await erc20Meta(campaign.feeToken);

      let advanced = 0;
      let denied = false;
      for (const target of targets) {
        if (!deadline.hasTimeFor(SETTLEMENT_NOTICE_MS)) break;
        try {
          const result = await notifyOutcome(target, giveawayId, campaign, meta, log);
          // B8: the ceiling is the run's and not this entry's, and every entry
          // that asks again after it is reached costs a denial event, an alert,
          // and the webhook post behind the alert — which is under no ceiling of
          // its own. Twenty-five entries by five campaigns, once a minute.
          if (result === 'denied') {
            denied = true;
            break;
          }
          advanced += 1;
          if (result === 'sent') sent += 1;
        } catch (error) {
          // One entrant's failure is not the campaign's. The row keeps whatever
          // state it reached and the next run picks it up again.
          await log.failure('outcome.failed', error, { giveaway_id: giveawayId.toString() });
        }
      }

      // Nothing here was claimed, so nothing is moved: the queue is where this
      // campaign should be when the ceiling lifts.
      if (denied) break;

      // G4 through the error path. A settled campaign whose entries all failed
      // keeps its old timestamp and its place at the head of a batch of five, and
      // the campaigns behind it are never reached — the same starvation the order
      // key exists to prevent. One touch is enough; 0010 orders on max().
      if (advanced === 0) await touch(targets[0].entryId);
    } catch (error) {
      await log.failure('outcome.failed', error, { giveaway_id: giveawayId.toString() });
      // Out of the way as well as logged. A campaign that cannot be read holds a
      // slot in a five-campaign batch, and a handful of them is the whole batch
      // — the same starvation the order key exists to prevent, reached through
      // the error path instead.
      if (targets.length > 0) {
        try {
          await touch(targets[0].entryId);
        } catch {
          // The database that failed above is the one this would use.
        }
      }
    }
  }

  return sent;
}

/**
 * Runs the prize path for a bounded number of entries, then reports results.
 *
 * Every row the pass looks at is written, moved along or not, so the queue
 * advances and a prize waiting on a destination does not shadow the ones behind
 * it.
 *
 * THE PRIZE QUEUE GOES FIRST, AND THE ORDER IS ARITHMETIC RATHER THAN TASTE.
 * 240_000 ms for a prize plus 52_000 ms for a notice is more than the 280_000 ms
 * budget, so the two cannot both be guaranteed in one run and whichever runs
 * first decides. Notices first meant 40_000 ms of notices was enough to make the
 * prize guard false for the rest of the run — on the very run the rotation had
 * given the prize stage the whole budget. Prizes first cannot do the same in
 * reverse: the loop below stops as soon as fewer than 240_000 ms remain, so it
 * always hands the notices a remainder far larger than one notice costs.
 */
export async function processPrizes(log: Logger, deadline: RunDeadline): Promise<number> {
  let delivered = 0;
  const pending = await listPendingPrizes(PRIZE_BATCH);

  if (pending.length > 0) {
    // Read once per run rather than once per prize: it is a constant in the
    // deployed bytecode, and a second read would only be a second chance for the
    // RPC to fail.
    const deadlineSeconds = await claimDeadlineSeconds();

    for (const prize of pending) {
      // G4: a claim and a delivery, each funded and each awaited — the most
      // expensive unit the pipeline runs. The reservation lives in config.ts
      // beside the budget it has to fit inside, because written here it was
      // 300_000 ms against 280_000 and this loop never ran its body once, and
      // nothing said so. The cron rotates which stage leads (§7/G4), so one run
      // in PHASE_STARVATION_BOUND_RUNS gives this loop the whole budget.
      if (!deadline.hasTimeFor(PHASE_RESERVATION_MS.processPrizes)) break;

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
  }

  // Outside the prize queue entirely: a campaign whose winners all entered with
  // their own wallets has no custody rows at all, so an early return on an empty
  // prize queue would leave every entrant of it never told anything.
  //
  // Caught, because cron/process.ts runs phases without a try of its own and
  // every database helper throws (G2). Unprotected, one failed notice pass took
  // the prize stage down with it.
  try {
    await notifySettlements(log, deadline);
  } catch (error) {
    await log.failure('outcome.failed', error);
  }

  return delivered;
}
