/**
 * The orders pass. SPEC-BLOCO-03 piece 5 — J5, P11, P12, 8.3, P4, P22, 13.1, P5.
 *
 * Runs inside the pipeline's advanceLifecycle phase, every minute, under the
 * pipeline's lock: the keeper and the bridge role sign here, and that lock is
 * what serialises their `pending` nonces with the lifecycle's and the roots'
 * (§18 M4, P14). Not a seventh phase, for the reason config.ts gives for
 * SETTLEMENT_NOTICE_MS.
 *
 * One run:
 *   1. reads every order whose close is not yet recorded, and the new ones, into
 *      bridge_v2_orders — all of them, the least recently read first (P5-4), each
 *      under a reservation of its own (P5-5), and a new one that cannot be read
 *      kept aside with an alert, holding up none after it (P5-12); then binds to
 *      its order every address a relayed payment claimed whose receipt the relay
 *      never saw (P5-2);
 *   2. fires the exits by time whose deadline passed (J5: "when the deadlines
 *      pass"), and voids the vouchers the core can no longer deliver (H8, H9,
 *      J1) — signed by the keeper, never from the shared ceiling (P11);
 *   3. sends the notices that are due, by email only (8.3, P3, P4, P22);
 *   4. closes, on this side, the orders seen in their final state: erasure date,
 *      outcome, mark settled, and then the close recorded (10.3, P5, Adenda R1);
 *   5. marks recipients verified and distinct (13.1, P5), from the shared
 *      ceiling (P14).
 *
 * P12 asks the exits and the 24-hour notice to happen within an hour of their
 * moment. The pipeline runs every minute and every phase leads a run within six
 * (PHASE_STARVATION_BOUND_RUNS), so the bound is minutes, not the hour. The
 * closes come after the exits and the notices because their search of the log
 * may take whatever time is left, and go on in the next pass (Adenda R2); and
 * before the marks, so a mark a close releases frees its (store, number) pair
 * for another order in the same pass (P5).
 *
 * Adenda R2: an order's failure is its own. It is logged and alerted, and every
 * other order still gets its exit, its notices, its mark and its close. It never
 * throws, as advanceLifecycle never does: a failed first read ends this pass and
 * alerts, and the phases behind it still run.
 */

import { alert } from './alert.js';
import { claimSpend } from './spend.js';
import { contractErrorName, OrderFlag, OrderOutcome, OrderState } from './abi.js';
import {
  ESCROW_ARBITER_WINDOW_SECONDS,
  KEPTRA_GUARANTEE,
  ORDER_CLAIM_MS,
  ORDER_CLOSE_MS,
  ORDER_ERASURE_MS,
  ORDER_EXIT_MS,
  ORDER_LOG_CHUNK_MS,
  ORDER_MARK_MS,
  ORDER_NOTICE_MS,
  ORDER_SCAN_MS,
  ORDER_SCAN_PAGE,
  ORDER_SYNC_MS,
  RELAYED_CAMPAIGN_STALE_MS,
  TRACKER_RETRY_MS,
  VOUCHER_CHECK_MS,
  VOUCHER_SCAN_MS,
  WINDOW_CLOSING_NOTICE_SECONDS,
} from './config.js';
import { ChainError, keeperAccount, receiptOf, sendKeeperExit, sendRecipientMark, transactionKnown, waitForReceipt, type KeeperExit } from './chain.js';
import {
  campaignItems,
  latestBlock,
  orderIdFromLogs,
  orderOutcome,
  ordersHead,
  readOrders,
  readVouchers,
  voucherLastId,
  voucherReleasable,
  type OrdersHead,
  type OrderView,
  type OrderWithTerms,
  type TermsView,
} from './escrowChain.js';
import {
  addressOfOrder,
  bindAddress,
  claimsAwaitingBind,
  clearUnreadOrder,
  eraseExpired,
  finishedVouchers,
  keptraContractsConfigured,
  lastKnownOrderId,
  markOf,
  openOrders,
  orderHasAddress,
  hasPendingClaim,
  orderRow,
  ordersConfigured,
  recordFinishedVoucher,
  recordOrderNotice,
  recordUnreadOrder,
  releaseClaim,
  reserveMark,
  saveOrder,
  scheduleErasure,
  sentOrderNotices,
  setMarkStatus,
  setTracker,
  shipmentsWithoutTracker,
  skipMark,
  stopTrackerRetry,
  unboundAddress,
  unreadOrderIds,
  type OrderNoticeKind,
  type OrderRow,
} from './orders.js';
import { accountBySafe } from './accounts.js';
import { participantEmail } from './entries.js';
import { livePhoneHash } from './phone.js';
import { requireKeptraEnv } from './env.js';
import { createTracker } from './ship24.js';
import {
  sendArbiterContestEmail,
  sendOrderClosingEmail,
  sendOrderRefusedEmail,
  sendOrderWindowEmail,
  sendStoreOrderEmail,
  type MailResult,
  type WindowReason,
} from './mail.js';
import type { Detail, Logger } from './log.js';
import type { RunDeadline } from './runlock.js';

const DAY = 86_400n;

/** P11: a refusal that means the exit was already made by somebody else between the read and the estimate. */
const ALREADY_DONE = new Set(['WrongState', 'DeadlineNotReached', 'VoucherNotRedeemable', 'NotReleasable', 'AlreadyVoided']);
/** §18 M7: what the price or the estimate does not allow right now. */
const DEFERRABLE = new Set(['gas_cost_above_ceiling', 'gas_estimate_out_of_band']);

export async function advanceOrders(log: Logger, deadline: RunDeadline): Promise<number> {
  // P24: nothing runs, not even a read, until the addresses and KEPTRA_ENV are in.
  // Silent here, every minute; the maintenance pass alerts a half configuration.
  if (!ordersConfigured()) return 0;
  if (!deadline.hasTimeFor(ORDER_SCAN_MS)) return 0;

  // P5-2: first the addresses whose claim's receipt the relay never saw, so the
  // orders those transactions opened have theirs before the scan meets them.
  let done = 0;
  try {
    done += await bindClaimedAddresses(log, deadline);
  } catch (error) {
    await log.failure('orders.failed', error, { stage: 'bind' });
    await alert(log, 'orders step failed');
  }

  let head: OrdersHead;
  let rows: OrderRow[];
  try {
    ({ head, rows } = await syncOrders(log, deadline));
  } catch (error) {
    await log.failure('orders.failed', error, { stage: 'scan' });
    await alert(log, 'orders scan failed');
    return 0;
  }

  for (const step of [
    () => fireExits(rows, head, log, deadline),
    () => sendNotices(rows, head, log, deadline),
    () => closeOrders(rows, head, log, deadline),
    () => markRecipients(rows, log, deadline),
  ]) {
    try {
      done += await step();
    } catch (error) {
      await log.failure('orders.failed', error);
      await alert(log, 'orders step failed');
    }
  }
  return done;
}

// -----------------------------------------------------------------------------
// 1. the index
// -----------------------------------------------------------------------------

/**
 * Every order whose close is not yet recorded and every new one, read from the
 * chain and written down as the chain shows it.
 *
 * P5-4: all of them, whatever their number. The known ones come least recently
 * read first, and their pages alternate with the pages of the new ones, so a pass
 * the clock cuts short leaves the rest at the front of the next one and neither
 * kind is ever held behind the other.
 *
 * P5-5: a page of the chain is read under ORDER_SCAN_MS, and every order of it is
 * written under ORDER_SYNC_MS of its own.
 *
 * Adenda R2 and P5-12: an order that fails is logged and alerted, and the rest are
 * read. A page the chain does not answer is read one order at a time, so one
 * order holds up no other. A new order that cannot be read or written is kept
 * aside (bridge_v2_order_unread), with an alert, and read again every pass —
 * which is what lets the discovery of the ones after it go on: lastKnownOrderId
 * may pass it, because it is no longer the only place that order is remembered.
 * Only a failure to keep it aside stops the discovery there, as before.
 */
async function syncOrders(log: Logger, deadline: RunDeadline): Promise<{ head: OrdersHead; rows: OrderRow[] }> {
  const head = await ordersHead();
  const knownRows = await openOrders();
  const known = new Map(knownRows.map((row) => [row.orderId, row]));
  const aside = new Set((await unreadOrderIds()).map(String));
  const fresh = new Set<string>(aside);
  for (let id = (await lastKnownOrderId()) + 1n; id < head.orderCount; id += 1n) fresh.add(id.toString());
  const newIds = [...fresh].map(BigInt).filter((id) => !known.has(id) && id < head.orderCount).sort((a, b) => (a < b ? -1 : 1));
  const knownIds = knownRows.map((row) => row.orderId);

  const pages: bigint[][] = [];
  for (let k = 0, n = 0; k < knownIds.length || n < newIds.length; k += ORDER_SCAN_PAGE, n += ORDER_SCAN_PAGE) {
    if (k < knownIds.length) pages.push(knownIds.slice(k, k + ORDER_SCAN_PAGE));
    if (n < newIds.length) pages.push(newIds.slice(n, n + ORDER_SCAN_PAGE));
  }

  const rows: OrderRow[] = [];
  let discovering = true;
  for (const [index, ids] of pages.entries()) {
    // Out of time mid-scan: act on what was read.
    if (index > 0 && !deadline.hasTimeFor(ORDER_SCAN_MS)) break;
    const page = await readPage(ids, known, log);
    for (const failed of page.failed) {
      if (!deadline.hasTimeFor(ORDER_SYNC_MS)) return { head, rows };
      if (!known.has(failed) && discovering) discovering = await keepAside(failed, log);
    }
    for (const { order, terms } of page.read) {
      const previous = known.get(order.orderId);
      if (previous === undefined && !discovering) continue;
      // P5-5: every order of the page is written under its own reservation.
      if (!deadline.hasTimeFor(ORDER_SYNC_MS)) return { head, rows };
      try {
        rows.push(await syncOne(order, terms, previous, head, log));
        if (aside.has(order.orderId.toString())) await clearUnreadOrder(order.orderId);
      } catch (error) {
        const detail: Detail = { order_id: order.orderId.toString() };
        await log.failure('orders.failed', error, { ...detail, stage: 'scan' });
        await alert(log, 'order scan failed', detail);
        if (previous === undefined) discovering = await keepAside(order.orderId, log);
      }
    }
  }
  return { head, rows };
}

/**
 * P5-12: one page of orders, read together; if the chain does not answer the
 * page, read one order at a time, so the ones it does answer are not held up by
 * the one it does not.
 */
async function readPage(
  ids: readonly bigint[],
  known: ReadonlyMap<bigint, OrderRow>,
  log: Logger,
): Promise<{ read: OrderWithTerms[]; failed: bigint[] }> {
  try {
    return { read: await readOrders(ids), failed: [] };
  } catch (error) {
    await log.failure('orders.failed', error, { stage: 'scan' });
    await alert(log, 'orders scan failed');
  }
  const read: OrderWithTerms[] = [];
  const failed: bigint[] = [];
  for (const id of ids) {
    try {
      read.push(...(await readOrders([id])));
    } catch (error) {
      failed.push(id);
      if (known.has(id)) {
        const detail: Detail = { order_id: id.toString() };
        await log.failure('orders.failed', error, { ...detail, stage: 'scan' });
        await alert(log, 'order scan failed', detail);
      }
    }
  }
  return { read, failed };
}

/**
 * P5-12: a new order kept aside, with an alert — read again every pass until it
 * can be. False when even that could not be written: then the discovery stops
 * there, so lastKnownOrderId never passes an order this side has no record of.
 */
async function keepAside(orderId: bigint, log: Logger): Promise<boolean> {
  const detail: Detail = { order_id: orderId.toString() };
  try {
    const attempts = await recordUnreadOrder(orderId);
    await log.event('order.read_aside', { ...detail, attempts });
    await alert(log, 'order read aside', { ...detail, attempts });
    return true;
  } catch (error) {
    await log.failure('orders.failed', error, { ...detail, stage: 'aside' });
    return false;
  }
}

/**
 * One order as the chain shows it now, written down. An order in its final state
 * is written with its close still to record: it keeps the block its search for
 * OrderClosed starts from, the last one it was seen open at (closeOrders).
 */
async function syncOne(order: OrderView, terms: TermsView, previous: OrderRow | undefined, head: OrdersHead, log: Logger): Promise<OrderRow> {
  const row: OrderRow = {
    orderId: order.orderId,
    termsId: order.termsId,
    voucherId: order.voucherId,
    store: terms.store,
    payer: order.payer,
    mode: terms.mode,
    prize: terms.prize,
    shipDays: terms.shipDays,
    deliveryDays: terms.deliveryDays,
    state: order.state,
    flags: order.flags,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    windowEndsAt: order.windowEndsAt,
    contestedAt: order.contestedAt,
    seenBlock: order.state === OrderState.CLOSED && previous !== undefined ? previous.seenBlock : head.block,
    outcome: null,
    closedAt: null,
  };
  if (previous === undefined) await bindRecipientAddress(row, log);
  await saveOrder(row);
  return row;
}

/**
 * Q14 and E3, for an order no claim is waiting on — one its payer's account
 * opened outside the relay: it takes the oldest address its recipient registered
 * for it that no submission claimed. P5-2: while a claim of that recipient for the
 * same offer or voucher is pending, the binding is that claim's, from its own
 * receipt (bindClaimedAddresses), and nothing is taken here.
 */
async function bindRecipientAddress(row: OrderRow, log: Logger): Promise<void> {
  if (await orderHasAddress(row.orderId)) return;
  const account = await accountBySafe(row.payer);
  if (account === null) return;
  const purpose = row.prize ? { voucherId: row.voucherId } : { termsId: row.termsId };
  if (await hasPendingClaim(account.participantId, purpose)) return;
  const draft = await unboundAddress(account.participantId, purpose);
  if (draft !== null && (await bindAddress(draft.id, row.orderId))) {
    await log.event('order.address_bound', { order_id: row.orderId.toString(), reconciled: true });
  }
}

/**
 * Q14, E3 and P5-2: the address a relayed payment or redemption claimed is bound
 * to the order its transaction opened, whether or not the relay saw the receipt.
 * The relay binds it at once when it did; this is the path when it did not. The
 * order is read from that transaction's own receipt, so a claim is bound to the
 * order it paid for and to no other. A transaction that reverted, opened no order
 * (the account's call failed inside it), or was dropped, gives its claim back.
 */
async function bindClaimedAddresses(log: Logger, deadline: RunDeadline): Promise<number> {
  let bound = 0;
  for (const claim of await claimsAwaitingBind(50)) {
    if (!deadline.hasTimeFor(ORDER_CLAIM_MS)) break;
    try {
      const receipt = await receiptOf(claim.claimTx);
      if (receipt === null) {
        // Still pending, or dropped: given back only once it is old and the node does not know it.
        const stale = Date.parse(claim.claimedAt) + RELAYED_CAMPAIGN_STALE_MS < Date.now();
        if (stale && !(await transactionKnown(claim.claimTx))) {
          await releaseClaim(claim.id);
          await log.event('order.address_released', { reason: 'dropped' });
        }
        continue;
      }
      const orderId = receipt.status === 'success' ? orderIdFromLogs(receipt.logs) : null;
      if (orderId === null || (await orderHasAddress(orderId))) {
        await releaseClaim(claim.id);
        await log.event('order.address_released', { reason: receipt.status === 'success' ? 'no_order' : 'reverted' });
        continue;
      }
      if (await bindAddress(claim.id, orderId)) {
        bound += 1;
        await log.event('order.address_bound', { order_id: orderId.toString(), reconciled: true });
      }
    } catch (error) {
      await log.failure('orders.failed', error, { stage: 'bind' });
      await alert(log, 'order address bind failed');
    }
  }
  return bound;
}

/**
 * P5 at the final state: a mark counts once per store only if its delivery was
 * counted — the order was marked on-chain and closed to the store. Anything else
 * releases the (store, number) pair for a later order. An outcome the log did not
 * give leaves a mark as it is: counting once too few is the safe side of H33.
 */
async function settleMark(row: OrderRow): Promise<void> {
  const mark = await markOf(row.orderId);
  if (mark === null || (mark.status !== 'RESERVED' && mark.status !== 'MARKED')) return;
  const verified = (row.flags & OrderFlag.VERIFIED) !== 0;
  if (!verified || (row.outcome !== null && row.outcome !== OrderOutcome.STORE)) {
    await setMarkStatus(row.orderId, 'RELEASED');
  } else if (mark.status === 'RESERVED') {
    await setMarkStatus(row.orderId, 'MARKED');
  }
}

// -----------------------------------------------------------------------------
// 2. the exits by time — J5, P11
// -----------------------------------------------------------------------------

interface DueExit {
  readonly exit: KeeperExit;
  readonly id: bigint;
  readonly itemIndex: bigint;
}

/**
 * The exit an order is due for at `now`, or null. The escrow's own comparisons,
 * in its own direction: each exit reverts while block.timestamp <= the deadline
 * (KeptraEscrow.sol:847, :850, :864, :873).
 */
export function dueExit(row: OrderRow, now: bigint): KeeperExit | null {
  switch (row.state) {
    case OrderState.PAID:
      return now > row.paidAt + BigInt(row.shipDays) * DAY ? 'expire' : null;
    case OrderState.SHIPPED:
      return now > row.shippedAt + BigInt(row.deliveryDays) * DAY ? 'expire' : null;
    case OrderState.WINDOW:
      return now > row.windowEndsAt ? 'closeWindow' : null;
    case OrderState.CONTESTED:
      return now > row.contestedAt + BigInt(ESCROW_ARBITER_WINDOW_SECONDS) ? 'resolveAbsentArbiter' : null;
    default:
      return null;
  }
}

async function fireExits(rows: readonly OrderRow[], head: OrdersHead, log: Logger, deadline: RunDeadline): Promise<number> {
  const due: DueExit[] = [];
  for (const row of rows) {
    const exit = dueExit(row, head.now);
    if (exit !== null) due.push({ exit, id: row.orderId, itemIndex: 0n });
  }
  if (deadline.hasTimeFor(VOUCHER_SCAN_MS)) {
    try {
      due.push(...(await dueVouchers(head, deadline)));
    } catch (error) {
      // Adenda R2: a voucher scan that fails leaves the orders' exits to go.
      await log.failure('orders.failed', error, { stage: 'vouchers' });
      await alert(log, 'voucher scan failed');
    }
  }
  if (due.length === 0) return 0;

  // §18 M4: one keeper transaction in flight at a time — the lifecycle's included.
  const account = await keeperAccount();
  if (account.pendingNonce > account.latestNonce) {
    await log.event('orders.deferred', { reason: 'keeper_transaction_pending', pending: due.length });
    await alert(log, 'keeper transaction not mined yet', { pending: due.length });
    return 0;
  }

  let confirmed = 0;
  for (const item of due) {
    if (!deadline.hasTimeFor(ORDER_EXIT_MS)) break;
    const detail: Detail = { exit: item.exit, id: item.id.toString() };
    try {
      const outcome = await exitOne(item, detail, log);
      if (outcome === 'confirmed') confirmed += 1;
      // §18 M3: a receipt not seen means the next nonce is taken; nothing more this run.
      if (outcome === 'unconfirmed') break;
    } catch (error) {
      await log.failure('orders.failed', error, detail);
      await alert(log, 'order exit failed', detail);
    }
  }
  return confirmed;
}

async function exitOne(item: DueExit, detail: Detail, log: Logger): Promise<'confirmed' | 'unconfirmed' | 'settled'> {
  let hash: `0x${string}`;
  try {
    hash = await sendKeeperExit(item.exit, item.id, item.itemIndex);
  } catch (error) {
    if (error instanceof ChainError && DEFERRABLE.has(error.code)) {
      await log.event('orders.deferred', { ...detail, reason: error.code });
      await alert(log, 'order exit deferred', { ...detail, reason: error.code });
      return 'settled';
    }
    const revert = contractErrorName(error);
    if (revert !== null && ALREADY_DONE.has(revert)) {
      await log.event('orders.skipped', { ...detail, reason: revert });
      return 'settled';
    }
    throw error;
  }
  await log.event('orders.sent', { ...detail, tx_hash: hash });
  const receipt = await waitForReceipt(hash);
  if (receipt === null) {
    await log.event('orders.unconfirmed', { ...detail, tx_hash: hash });
    return 'unconfirmed';
  }
  if (receipt.status === 'reverted') {
    await log.event('orders.failed', { ...detail, tx_hash: hash, reason: 'reverted' });
    await alert(log, 'order exit reverted', detail);
    return 'settled';
  }
  await log.event('orders.confirmed', { ...detail, tx_hash: hash });
  return 'confirmed';
}

/**
 * H8, H9, J1, 11.9, 11.10: the vouchers the core can no longer deliver, which
 * anybody may void (voidVoucher). The voucher contract decides (releasable); the
 * bridge only finds the candidates and, for one still owed by a campaign, its
 * position in the deposit list (the clamp case). Burned and voided ones are
 * written down and never read again.
 *
 * ponytail: one releasable call per live voucher per run; a page of multicalls
 * if the number of vouchers ever makes that slow.
 */
async function dueVouchers(head: OrdersHead, deadline: RunDeadline): Promise<DueExit[]> {
  const finished = await finishedVouchers();
  const last = await voucherLastId();
  const ids: bigint[] = [];
  for (let id = 1n; id <= last; id += 1n) if (!finished.has(id.toString())) ids.push(id);

  const due: DueExit[] = [];
  const items = new Map<bigint, bigint[]>();
  for (let start = 0; start < ids.length; start += ORDER_SCAN_PAGE) {
    if (start > 0 && !deadline.hasTimeFor(VOUCHER_SCAN_MS)) break;
    for (const voucher of await readVouchers(ids.slice(start, start + ORDER_SCAN_PAGE))) {
      // P5-5: each voucher of the page decides under a reservation of its own.
      if (!deadline.hasTimeFor(VOUCHER_CHECK_MS)) return due;
      if (voucher.owner === null || voucher.voided) {
        await recordFinishedVoucher(voucher.voucherId);
        continue;
      }
      // Held by the guarantee: inside a live order, which settles its unit (KeptraGuarantee.sol:355).
      if (voucher.owner.toLowerCase() === KEPTRA_GUARANTEE.toLowerCase()) continue;
      // Claimed and inside its thirty days: nothing to ask the contract.
      if (voucher.claimedAt !== 0n && head.now <= voucher.claimedAt + 30n * DAY) continue;
      let itemIndex = 0n;
      if (voucher.claimedAt === 0n && voucher.giveawayId !== 0n) {
        if (!items.has(voucher.giveawayId)) items.set(voucher.giveawayId, await campaignItems(voucher.giveawayId));
        const position = (items.get(voucher.giveawayId) as bigint[]).indexOf(voucher.voucherId);
        itemIndex = BigInt(Math.max(position, 0));
      }
      if (await voucherReleasable(voucher.voucherId, itemIndex)) due.push({ exit: 'voidVoucher', id: voucher.voucherId, itemIndex });
    }
  }
  return due;
}

// -----------------------------------------------------------------------------
// 3. the notices — 8.3, P3, P4, P22
// -----------------------------------------------------------------------------

interface DueNotice {
  readonly row: OrderRow;
  readonly kind: OrderNoticeKind;
}

/** The notices an order is due for at `now` (P3: all by email). */
export function dueNotices(row: OrderRow, now: bigint): OrderNoticeKind[] {
  switch (row.state) {
    case OrderState.PAID:
      // P22, as the owner answered it: every order that opens, paid or redeemed.
      return ['STORE_ORDER'];
    case OrderState.WINDOW: {
      // 8.3 at T5 and at 9.4, and P4 for a refusal's window, with the same rules.
      const kinds: OrderNoticeKind[] = ['WINDOW_OPENED'];
      if (now >= row.windowEndsAt - BigInt(WINDOW_CLOSING_NOTICE_SECONDS) && now <= row.windowEndsAt) kinds.push('WINDOW_CLOSING');
      return kinds;
    }
    case OrderState.CONTESTED:
      return ['ARBITER_CONTEST'];
    default:
      return [];
  }
}

async function sendNotices(rows: readonly OrderRow[], head: OrdersHead, log: Logger, deadline: RunDeadline): Promise<number> {
  const sent = await sentOrderNotices(rows.map((row) => row.orderId));
  const due: DueNotice[] = [];
  for (const row of rows) {
    for (const kind of dueNotices(row, head.now)) if (!sent.has(`${row.orderId}:${kind}`)) due.push({ row, kind });
  }
  let count = 0;
  for (const { row, kind } of due) {
    if (!deadline.hasTimeFor(ORDER_NOTICE_MS)) break;
    const detail: Detail = { order_id: row.orderId.toString(), kind };
    try {
      const to = await recipientOf(row, kind);
      if (to === null) continue;
      if (!(await claimSpend('email', 1, log))) break;
      const result = await sendNotice(to, row, kind);
      if (!result.sent) continue;
      await recordOrderNotice(row.orderId, kind);
      await log.event('order.notified', detail);
      count += 1;
    } catch (error) {
      // Adenda R2: this notice is tried again next pass; the others go now.
      await log.failure('orders.failed', error, { ...detail, stage: 'notice' });
      await alert(log, 'order notice failed', detail);
    }
  }
  return count;
}

/** Who a notice goes to: the recipient, the store, or the arbiter's configured address (P22). */
async function recipientOf(row: OrderRow, kind: OrderNoticeKind): Promise<string | null> {
  if (kind === 'ARBITER_CONTEST') return requireKeptraEnv('BRIDGE_V2_ARBITER_EMAIL');
  const account = await accountBySafe(kind === 'STORE_ORDER' ? row.store : row.payer);
  if (account === null) return null;
  const email = await participantEmail(account.participantId);
  // erase.ts leaves `erased-<hex>@invalid`: nobody is behind it.
  return email === null || email.endsWith('@invalid') ? null : email;
}

function sendNotice(to: string, row: OrderRow, kind: OrderNoticeKind): Promise<MailResult> {
  const refusal = (row.flags & OrderFlag.REFUSAL) !== 0;
  switch (kind) {
    case 'STORE_ORDER':
      return sendStoreOrderEmail(to, row.orderId, row.paidAt + BigInt(row.shipDays) * DAY);
    case 'WINDOW_OPENED': {
      const reason: WindowReason = refusal ? 'refusal' : (row.flags & OrderFlag.PROOF) !== 0 ? 'proof' : 'declared';
      return sendOrderWindowEmail(to, row.orderId, reason, row.windowEndsAt);
    }
    case 'WINDOW_CLOSING':
      return sendOrderClosingEmail(to, row.orderId, refusal, row.windowEndsAt);
    case 'ARBITER_CONTEST':
      return sendArbiterContestEmail(to, row.orderId, row.contestedAt + BigInt(ESCROW_ARBITER_WINDOW_SECONDS));
    case 'WINDOW_REFUSED':
      return sendOrderRefusedEmail(to, row.orderId, row.windowEndsAt);
  }
}

// -----------------------------------------------------------------------------
// 4. the closes — 10.3, P5, Adenda R1
// -----------------------------------------------------------------------------

/**
 * Adenda R1: an order the chain shows in its final state is closed on this side
 * in steps that can each be done again — its erasure date set, its outcome read,
 * its mark settled — and only then is the close recorded (closed_at). A close cut
 * short by a failure, or by the clock in the middle of the log, is read again and
 * finished by a later pass; it never stays final without its erasure date or
 * with its mark unresolved.
 */
async function closeOrders(rows: readonly OrderRow[], head: OrdersHead, log: Logger, deadline: RunDeadline): Promise<number> {
  let closed = 0;
  // P5-1: read once, after the orders were — the block every search of this pass goes to.
  let tip: bigint | null = null;
  for (const row of rows) {
    if (row.state !== OrderState.CLOSED) continue;
    if (!deadline.hasTimeFor(ORDER_CLOSE_MS)) break;
    const detail: Detail = { order_id: row.orderId.toString() };
    try {
      tip ??= await latestBlock();
      if (await closeOne(row, tip, head.block, deadline, detail, log)) closed += 1;
    } catch (error) {
      await log.failure('orders.failed', error, { ...detail, stage: 'close' });
      await alert(log, 'order close failed', detail);
    }
  }
  return closed;
}

/**
 * P5-1: the search for OrderClosed goes to `tip`, a block read after the order
 * was seen closed — never only to the head block the pass read before it, which a
 * close landing between the two reads is past. P5-13: a node that answers with a
 * block before the one the order was last seen open at — or before the head this
 * pass read — has searched nothing, and that is never taken for "closed with no
 * outcome": the close waits for a pass whose node has caught up.
 */
async function closeOne(row: OrderRow, tip: bigint, headBlock: bigint, deadline: RunDeadline, detail: Detail, log: Logger): Promise<boolean> {
  // 10.3: the clock starts at the first attempt; a later one leaves a date already set.
  await scheduleErasure(row.orderId, new Date());
  if (tip < row.seenBlock || tip < headBlock) {
    await log.event('orders.deferred', { ...detail, reason: 'close_search_behind' });
    return false;
  }
  const found = await orderOutcome(row.orderId, row.seenBlock, tip, () => deadline.hasTimeFor(ORDER_LOG_CHUNK_MS));
  if (found.outcome === null && found.searchedTo < tip) {
    // Adenda R2: out of time in the middle of the log. The next pass goes on from here.
    await saveOrder({ ...row, seenBlock: found.searchedTo });
    await log.event('orders.deferred', { ...detail, reason: 'close_search_unfinished' });
    return false;
  }
  const final: OrderRow = { ...row, outcome: found.outcome, closedAt: new Date().toISOString() };
  await settleMark(final);
  // Y5: a window the store's declaration opened, closed by the carrier's refusal
  // before its end, is told to the recipient. Until it is, the close is not
  // recorded, so a notice the ceiling or the provider refused is tried again.
  if (refusedDeclaredWindow(final) && !(await noticeRefusedWindow(final, detail, log))) return false;
  // P5-3: the order is final; a shipment the provider never took leaves the retries.
  await stopTrackerRetry(row.orderId, 'CLOSED');
  await saveOrder(final);
  return true;
}

/**
 * Y5 (X10): how the escrow of 5d85a46 ends a window the store's declaration opened
 * when the oracle attests a refusal before its end — T8, the split, from a window
 * with no proof, no refusal of the store's and no contest. No other path reaches
 * SPLIT from such a window: the store's own refusal (9.3) carries F_REFUSAL, a
 * refusal before the window opens has no window, and a contest is decided by the
 * arbiter from CONTESTED.
 */
export function refusedDeclaredWindow(row: OrderRow): boolean {
  return (
    row.outcome === OrderOutcome.SPLIT &&
    row.windowEndsAt !== 0n &&
    row.contestedAt === 0n &&
    (row.flags & (OrderFlag.PROOF | OrderFlag.REFUSAL)) === 0
  );
}

/** Y5: the recipient told; true once there is nothing left to send (sent now or before, or nobody to send to). */
async function noticeRefusedWindow(row: OrderRow, detail: Detail, log: Logger): Promise<boolean> {
  if ((await sentOrderNotices([row.orderId])).has(`${row.orderId}:WINDOW_REFUSED`)) return true;
  const to = await recipientOf(row, 'WINDOW_REFUSED');
  if (to === null) return true;
  if (!(await claimSpend('email', 1, log))) return false;
  if (!(await sendNotice(to, row, 'WINDOW_REFUSED')).sent) return false;
  await recordOrderNotice(row.orderId, 'WINDOW_REFUSED');
  await log.event('order.notified', { ...detail, kind: 'WINDOW_REFUSED' });
  return true;
}

// -----------------------------------------------------------------------------
// the maintenance steps — 10.3 and 9.5.5
// -----------------------------------------------------------------------------

/** 10.3: the hourly erasure of what outlived its orders. Returns rows erased, or null when not configured. */
export async function eraseOrderData(log: Logger, deadline: RunDeadline): Promise<number | null> {
  if (!keptraContractsConfigured() || !deadline.hasTimeFor(ORDER_ERASURE_MS)) return null;
  const erased = await eraseExpired();
  if (erased > 0) await log.event('order.erased', { rows: erased });
  return erased;
}

/**
 * 9.5.5 and M9: the shipments the provider did not take when the store registered
 * them, asked again — each with its own unit of spend, the post code and country
 * of its address, and nothing else (P7).
 */
export async function retryTrackers(log: Logger, deadline: RunDeadline): Promise<number | null> {
  if (!ordersConfigured() || !deadline.hasTimeFor(TRACKER_RETRY_MS)) return null;
  let created = 0;
  for (const shipment of await shipmentsWithoutTracker(20)) {
    if (!deadline.hasTimeFor(TRACKER_RETRY_MS)) break;
    const detail: Detail = { order_id: shipment.orderId.toString() };
    // P5-3: a closed order's shipment is nothing the oracle will ever read: out of the queue.
    const order = await orderRow(shipment.orderId);
    if (order !== null && order.state === OrderState.CLOSED) {
      await stopTrackerRetry(shipment.orderId, 'CLOSED');
      await log.event('order.tracker_stopped', { ...detail, reason: 'closed' });
      continue;
    }
    const address = await addressOfOrder(shipment.orderId);
    if (address === null || shipment.trackingNumber === null) continue;
    if (!(await claimSpend('tracking', 1, log))) break;
    const result = await createTracker(shipment.trackingNumber, address.postCode, address.country);
    // P5-3: refused for what it is, it will be refused every time: out of the queue, with an alert.
    if (result.kind === 'refused') {
      await stopTrackerRetry(shipment.orderId, 'REFUSED');
      await log.event('order.tracker_stopped', { ...detail, reason: 'refused' });
      await alert(log, 'tracking provider refused a shipment', detail);
      continue;
    }
    if (result.kind !== 'created') continue;
    const trackerId = result.trackerId;
    await setTracker(shipment.orderId, trackerId);
    await log.event('order.tracker_created', { order_id: shipment.orderId.toString(), reconciled: true });
    created += 1;
  }
  return created;
}

// -----------------------------------------------------------------------------
// 5. the recipient marks — 13.1, P5, P14
// -----------------------------------------------------------------------------

/**
 * P5: the same number counts once per store, and a recipient who is the store
 * itself never counts. "Verified by telephone" is the live number Telegram
 * verified (bridge_v2_phones); "the same person" is the same participant, or
 * the same number. A payer without a number yet is looked at again next run.
 */
async function markRecipients(rows: readonly OrderRow[], log: Logger, deadline: RunDeadline): Promise<number> {
  let marked = 0;
  for (const row of rows) {
    if (row.state === OrderState.CLOSED || (row.flags & OrderFlag.VERIFIED) !== 0) continue;
    if (!deadline.hasTimeFor(ORDER_MARK_MS)) break;
    const detail: Detail = { order_id: row.orderId.toString() };
    try {
      const result = await markOne(row, detail, log);
      if (result === 'ceiling') break;
      if (result === 'marked') marked += 1;
    } catch (error) {
      // Adenda R2: this order is looked at again next pass; the others go now.
      await log.failure('orders.failed', error, { ...detail, stage: 'mark' });
      await alert(log, 'order mark failed', detail);
    }
  }
  return marked;
}

async function markOne(row: OrderRow, detail: Detail, log: Logger): Promise<'marked' | 'ceiling' | 'not_marked'> {
  const existing = await markOf(row.orderId);
  if (existing !== null && existing.status !== 'RESERVED') return 'not_marked';
  if (existing === null) {
    const payer = await accountBySafe(row.payer);
    if (payer === null || payer.role !== 'PARTICIPANT') {
      await skipMark(row.orderId, row.store);
      return 'not_marked';
    }
    const store = await accountBySafe(row.store);
    if (store !== null && store.participantId === payer.participantId) {
      await skipMark(row.orderId, row.store);
      return 'not_marked';
    }
    const phone = await livePhoneHash(payer.participantId);
    if (phone === null) return 'not_marked';
    if (store !== null && (await livePhoneHash(store.participantId)) === phone) {
      await skipMark(row.orderId, row.store);
      return 'not_marked';
    }
    if (!(await reserveMark(row.orderId, row.store, phone))) return 'not_marked';
  }
  // P14: the marks count against the shared ceiling.
  if (!(await claimSpend('chain', 1, log))) return 'ceiling';
  const hash = await sendRecipientMark(row.orderId);
  const receipt = await waitForReceipt(hash);
  if (receipt?.status === 'success') {
    await setMarkStatus(row.orderId, 'MARKED');
    await log.event('order.recipient_marked', { ...detail, tx_hash: hash });
    return 'marked';
  }
  // The order closed in between, or the escrow does not name this key as its bridge (H5).
  if (receipt?.status === 'reverted') await alert(log, 'recipient mark reverted', detail);
  // Reverted or not seen: the reservation stays, and the close settles it (settleMark).
  return 'not_marked';
}
