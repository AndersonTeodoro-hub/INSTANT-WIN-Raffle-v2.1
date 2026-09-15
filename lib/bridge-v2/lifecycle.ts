/**
 * The campaign lifecycle. SPEC-BRIDGE-V2 §18.
 *
 * GiveawayManagerV2 moves no campaign forward on its own. Somebody has to call
 * closeGiveaway when the entry window ends, requestDraw once it is closed,
 * finalizeWinners once the seed lands, and expireDrawRequest when a draw request
 * has outlived its rescue window. All four are permissionless, and until this
 * phase existed the only somebody was the creator pressing buttons — on #2 within
 * a minute of the end, on #1 never. A campaign left in CLOSED for DRAW_TIMEOUT can
 * be cancelled by anyone, which hands the creator everything back and gives the
 * participants no draw at all.
 *
 * No table and no stored state. What a campaign needs next is a fact of the
 * contract, read in this run; a transition already made is refused by the
 * contract and recognised here before any gas moves (M4).
 */

import { alert } from './alert.js';
import { contractErrorName, GiveawayStatus } from './abi.js';
import {
  CONTRACT_DRAW_TIMEOUT_SECONDS,
  CONTRACT_RESCUE_WINDOW_SECONDS,
  LIFECYCLE_GAS_RESERVE,
  LIFECYCLE_SCAN_PAGE,
  PHASE_RESERVATION_MS,
  type LifecycleAction,
} from './config.js';
import {
  ChainError,
  keeperAccount,
  lifecycleHead,
  readLifecyclePage,
  sendLifecycleCall,
  waitForReceipt,
  type KeeperAccount,
  type LifecycleCampaign,
} from './chain.js';
import type { Detail, Logger } from './log.js';
import type { RunDeadline } from './runlock.js';

/**
 * M1: what a campaign needs next, or null.
 *
 * `now` is the latest block's timestamp. The comparisons are the contract's own,
 * in its own direction: closeGiveaway reverts while block.timestamp <
 * effectiveEndTime (GiveawayManagerV2.sol:753), and expireDrawRequest while
 * block.timestamp <= drawRequestedAt + DRAW_TIMEOUT + RESCUE_WINDOW (:831).
 *
 * A paused contract closes nothing, because closeGiveaway is whenNotPaused; it is
 * still drawn and finalized, because neither of those is (:787, :898).
 */
export function nextTransition(
  campaign: LifecycleCampaign,
  now: bigint,
  paused: boolean,
): LifecycleAction | null {
  switch (campaign.status) {
    case GiveawayStatus.OPEN:
      return !paused && now >= campaign.effectiveEndTime ? 'closeGiveaway' : null;
    case GiveawayStatus.CLOSED:
      return 'requestDraw';
    case GiveawayStatus.DRAW_REQUESTED:
      return now >
        campaign.drawRequestedAt + BigInt(CONTRACT_DRAW_TIMEOUT_SECONDS + CONTRACT_RESCUE_WINDOW_SECONDS)
        ? 'expireDrawRequest'
        : null;
    case GiveawayStatus.SEED_RECEIVED:
      return 'finalizeWinners';
    default:
      return null;
  }
}

/** M8: the transitions with a deadline first, the heaviest last. */
const PRIORITY: Record<LifecycleAction, number> = {
  requestDraw: 0,
  expireDrawRequest: 1,
  closeGiveaway: 2,
  finalizeWinners: 3,
};

/**
 * M4: the refusals that mean somebody else made this transition between the read
 * and the estimate — the creator's dashboard still has the buttons. Nothing is
 * wrong and nothing was spent, so there is nothing to alert.
 */
const ALREADY_ADVANCED = new Set(['GiveawayNotOpen', 'NotClosed', 'NotDrawRequested', 'NotSeedReceived']);

/** M7: what the price or the estimate does not allow right now, as ChainError codes. */
const DEFERRABLE = new Set(['gas_cost_above_ceiling', 'gas_estimate_out_of_band']);

interface Due {
  readonly campaign: LifecycleCampaign;
  readonly action: LifecycleAction;
}

/**
 * The phase. Returns how many transitions were confirmed by their receipt.
 *
 * M5: IT NEVER THROWS. process.ts runs the phases one after another with nothing
 * between them to catch, so a throw here would end every phase behind it — and
 * the likeliest throw, an RPC having a bad minute, is exactly what a stage that
 * reads every campaign on every run will meet. A failed read ends this phase,
 * alerts, and leaves the rest of the run alone.
 */
export async function advanceLifecycle(log: Logger, deadline: RunDeadline): Promise<number> {
  const reservation = PHASE_RESERVATION_MS.advanceLifecycle;
  if (!deadline.hasTimeFor(reservation)) return 0;

  const due: Due[] = [];
  let account: KeeperAccount;
  try {
    const head = await lifecycleHead();
    const page = BigInt(LIFECYCLE_SCAN_PAGE);
    for (let from = 1n; from <= head.lastGiveawayId; from += page) {
      // Out of time mid-scan: act on what was read. The oldest campaigns come first.
      if (!deadline.hasTimeFor(reservation)) break;
      const to = from + page - 1n < head.lastGiveawayId ? from + page - 1n : head.lastGiveawayId;
      for (const campaign of await readLifecyclePage(from, to)) {
        const action = nextTransition(campaign, head.now, head.paused);
        if (action !== null) due.push({ campaign, action });
      }
    }
    if (due.length === 0) return 0;
    account = await keeperAccount();
  } catch (error) {
    await log.failure('lifecycle.failed', error, { stage: 'scan' });
    await alert(log, 'lifecycle scan failed');
    return 0;
  }

  // M4: one transaction in flight at a time. A transaction still in the mempool
  // holds the next nonce, and sending behind it either queues a second transition
  // on something that has not happened yet or replaces it. The run lock means
  // nobody else is sending from this account, so waiting is enough.
  if (account.pendingNonce > account.latestNonce) {
    await log.event('lifecycle.deferred', { reason: 'keeper_transaction_pending', pending: due.length });
    await alert(log, 'keeper transaction not mined yet', { pending: due.length });
    return 0;
  }

  // M6: before spending, whether the balance covers what is waiting.
  const reserved = due.reduce((sum, item) => sum + LIFECYCLE_GAS_RESERVE[item.action], 0n);
  const required = reserved * account.maxFeePerGas;
  if (account.balance < required) {
    await alert(log, 'keeper balance does not cover pending lifecycle calls', {
      pending: due.length,
      required_wei: required.toString(),
      balance_wei: account.balance.toString(),
    });
  }

  due.sort(
    (a, b) =>
      PRIORITY[a.action] - PRIORITY[b.action] ||
      Number(a.campaign.giveawayId - b.campaign.giveawayId),
  );

  let confirmed = 0;
  for (const { campaign, action } of due) {
    if (!deadline.hasTimeFor(reservation)) break;
    const detail: Detail = { giveaway_id: campaign.giveawayId.toString(), action };
    try {
      const outcome = await advanceOne(action, campaign.giveawayId, detail, log);
      if (outcome === 'confirmed') confirmed += 1;
      // M3: a receipt not seen means the next nonce is taken; nothing more this run.
      if (outcome === 'unconfirmed') break;
    } catch (error) {
      // M5: one campaign's failure is recorded and ends only itself.
      await log.failure('lifecycle.failed', error, detail);
      await alert(log, 'lifecycle transition failed', detail);
    }
  }
  return confirmed;
}

/**
 * One transition: sign, broadcast, wait. M3 is the order of the events —
 * `confirmed` is written only after a successful receipt.
 */
async function advanceOne(
  action: LifecycleAction,
  giveawayId: bigint,
  detail: Detail,
  log: Logger,
): Promise<'confirmed' | 'unconfirmed' | 'settled'> {
  let hash: `0x${string}`;
  try {
    hash = await sendLifecycleCall(action, giveawayId);
  } catch (error) {
    // M7: never signed. Deferred, alerted on every run it happens, retried on the
    // next — and the campaigns behind it still go.
    if (error instanceof ChainError && DEFERRABLE.has(error.code)) {
      await log.event('lifecycle.deferred', { ...detail, reason: error.code });
      await alert(log, 'lifecycle transition deferred', { ...detail, reason: error.code });
      return 'settled';
    }
    const revert = contractErrorName(error);
    if (revert !== null && ALREADY_ADVANCED.has(revert)) {
      await log.event('lifecycle.skipped', { ...detail, reason: revert });
      return 'settled';
    }
    throw error;
  }

  await log.event('lifecycle.sent', { ...detail, tx_hash: hash });
  const receipt = await waitForReceipt(hash);
  if (receipt === null) {
    await log.event('lifecycle.unconfirmed', { ...detail, tx_hash: hash });
    return 'unconfirmed';
  }
  if (receipt.status === 'reverted') {
    await log.event('lifecycle.failed', { ...detail, tx_hash: hash, reason: 'reverted' });
    await alert(log, 'lifecycle transition reverted', detail);
    return 'settled';
  }
  await log.event('lifecycle.confirmed', { ...detail, tx_hash: hash });
  return 'confirmed';
}
