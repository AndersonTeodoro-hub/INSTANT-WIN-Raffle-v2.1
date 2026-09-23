import { clearedCookie, resolveSession, revokeAllSessions } from '../../../../lib/bridge-v2/session.js';
import { handle, json, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { releasePhone } from '../../../../lib/bridge-v2/phone.js';
import { checked, getDb } from '../../../../lib/bridge-v2/db.js';
import { randomBytes, toHex } from '../../../../lib/bridge-v2/crypto.js';
import { DB_TIMEOUT_MS, ERASE_ADDRESSES_NOW_MAX, ORDER_SCAN_PAGE, USDC } from '../../../../lib/bridge-v2/config.js';
import { eraseAddressesOf, keptraContractsConfigured, lastKnownOrderId, ordersOfPayer, ordersOfStore } from '../../../../lib/bridge-v2/orders.js';
import { accountsOf, eraseAccountData, LIVE_RECOVERY_STATUSES, recoveriesOf } from '../../../../lib/bridge-v2/accounts.js';
import { erc20BalanceOf } from '../../../../lib/bridge-v2/chain.js';
import { ordersHead, readOrders, voucherBalanceOf } from '../../../../lib/bridge-v2/escrowChain.js';
import { OrderState } from '../../../../lib/bridge-v2/abi.js';

/**
 * SPEC-BLOCO-03 T13: what still has to be resolved before a Keptra participant's
 * data can be erased — USDC in either account, a voucher held by either, an order
 * open as the recipient or as the store. Erasing the email would end the session
 * that is the only way into those accounts through the platform, and leave the
 * value where only a direct transaction could reach it (2.3 holds; the platform
 * path would not). Null when nothing is left.
 */
/** P6-6: more orders to read than one page of the chain — the answer cannot be given now. */
class TooManyToRead extends Error {}

async function whatIsLeft(participantId: string): Promise<{ usdc: bigint; vouchers: bigint; openOrders: number } | null> {
  const accounts = await accountsOf(participantId);
  if (accounts.length === 0) return null;
  const contracts = keptraContractsConfigured();
  // One stage of the chain: the balances, and (P6-6) how many orders the escrow holds.
  const [usdc, vouchers, head] = await Promise.all([
    Promise.all(accounts.map((account) => erc20BalanceOf(USDC, account.safe))),
    contracts ? Promise.all(accounts.map((account) => voucherBalanceOf(account.safe))) : Promise.resolve([0n]),
    contracts ? ordersHead() : Promise.resolve(null),
  ]);
  let openOrders = 0;
  if (contracts) {
    const participant = accounts.find((account) => account.role === 'PARTICIPANT');
    const creator = accounts.find((account) => account.role === 'CREATOR');
    // P6-6: whether an order is open is the chain's answer, never the index's —
    // which may not have read a close yet, or an order paid a moment ago. The
    // index only says which orders to read, and every order newer than the index
    // holds is read as well.
    const [asRecipient, asStore, lastIndexed] = await Promise.all([
      participant ? ordersOfPayer(participant.safe) : Promise.resolve([]),
      creator ? ordersOfStore(creator.safe) : Promise.resolve([]),
      lastKnownOrderId(),
    ]);
    const ids = new Set([...asRecipient, ...asStore].map((row) => row.orderId.toString()));
    for (let id = lastIndexed + 1n; id < (head?.orderCount ?? 0n); id += 1n) ids.add(id.toString());
    if (ids.size > ORDER_SCAN_PAGE) throw new TooManyToRead();
    const same = (a: string, b: string | undefined) => b !== undefined && a.toLowerCase() === b.toLowerCase();
    for (const { order, terms } of await readOrders([...ids].map(BigInt))) {
      if (order.state === OrderState.CLOSED || order.state === OrderState.NONE) continue;
      if (same(order.payer, participant?.safe) || same(terms.store, creator?.safe)) openOrders += 1;
    }
  }
  const left = { usdc: usdc.reduce((a, b) => a + b, 0n), vouchers: vouchers.reduce((a, b) => a + b, 0n), openOrders };
  return left.usdc === 0n && left.vouchers === 0n && left.openOrders === 0 ? null : left;
}

/** The refusal's sentence: each thing still to resolve, named. */
function leftSentence(left: { usdc: bigint; vouchers: bigint; openOrders: number }): string {
  const parts: string[] = [];
  if (left.usdc > 0n) {
    const whole = left.usdc / 1_000_000n;
    const cents = ((left.usdc % 1_000_000n) / 10_000n).toString().padStart(2, '0');
    parts.push(`${whole}.${cents} USDC in your Keptra account`);
  }
  if (left.vouchers > 0n) parts.push(`${left.vouchers} voucher${left.vouchers === 1n ? '' : 's'}`);
  if (left.openOrders > 0) parts.push(`${left.openOrders} open order${left.openOrders === 1 ? '' : 's'}`);
  return `Your data cannot be erased yet: there is still ${parts.join(', ')}. Move the funds out, redeem or let the vouchers lapse, and let the orders finish first.`;
}

/**
 * POST /api/bridge/v2/privacy/erase
 *
 * D7: erasure at the request of the data subject.
 *
 * Erasure here is pseudonymisation, and the reason is structural rather than a
 * convenience. An entry records that a particular address was admitted to a
 * particular campaign, and that address is in an eligibility root on a public
 * chain where nothing can be removed (SPEC-GIVEAWAY-V2 3.4). Deleting this side
 * would not unpublish the chain; it would only leave an address in a root with
 * nothing explaining how it got there, which serves nobody and destroys the
 * platform's own audit trail.
 *
 * So what is destroyed is the link between a person and that record: the address
 * is replaced by an irreversible tombstone, the phone binding is released, and
 * every session is revoked. What remains is the participation record, which
 * after this is no longer personal data because nothing connects it to a person.
 *
 * OPEN POINT, recorded rather than decided: the specification requires an
 * erasure path but does not say what becomes of the participation record. This
 * implements the reading that preserves the on-chain audit trail; whether the
 * owner wants a stronger erasure is not a decision this session may take.
 */
const route = handle('privacy/erase', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'privacy/erase' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // SPEC-BLOCO-03 T13: refused while the Keptra accounts still hold something, and the answer says what.
  let left: Awaited<ReturnType<typeof whatIsLeft>>;
  try {
    left = await whatIsLeft(session.participantId);
  } catch (error) {
    if (!(error instanceof TooManyToRead)) throw error;
    return refuse(503, 'Your orders cannot be checked right now. Try again in a few minutes.');
  }
  if (left !== null) {
    await log.event('privacy.erase_refused', { usdc: left.usdc > 0n, vouchers: Number(left.vouchers), open_orders: left.openOrders });
    return json(
      {
        ok: false,
        error: leftSentence(left),
        left: { usdc: left.usdc.toString(), vouchers: left.vouchers.toString(), openOrders: left.openOrders },
      },
      409,
    );
  }

  // SPEC-BLOCO-03 P1-11: a change of access still alive needs the passkeys and
  // the request the erasure removes — the pass that confirms, notifies and
  // finishes it reads them. Refused until it has finished or been cancelled.
  const recoveries = await recoveriesOf(session.participantId);
  if (recoveries.some((request) => LIVE_RECOVERY_STATUSES.includes(request.status))) {
    await log.event('privacy.erase_refused', { recovery: true });
    return json(
      {
        ok: false,
        error: 'Your data cannot be erased yet: a change of access to your account is in progress. It can be erased once that change has finished or been cancelled.',
        left: { recovery: true },
      },
      409,
    );
  }

  // Released first. C6 puts the number into its cooling period, so erasure does
  // not become a way to recycle a number between accounts on demand.
  const released = await releasePhone(session.participantId);

  // The tombstone is random, so it cannot be reversed to the address it replaced
  // and cannot collide with a real one. The column stays unique and not null, so
  // no constraint has to be relaxed to make erasure possible.
  const tombstone = `erased-${toHex(randomBytes(16))}@invalid`;

  // SPEC-BLOCO-03 Adenda C5: the Telegram chat kept for security notices (A5) is
  // encrypted but reversible, so it goes too, in the same statement.
  const db = getDb();
  checked(
    'privacy.erase',
    await db
      .from('bridge_v2_participants')
      .update({ email_canonical: tombstone, telegram_chat_enc: null, updated_at: new Date().toISOString() })
      .eq('id', session.participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );

  // SPEC-BLOCO-03 P1-11, as the owner answered on 23/09/2026: the passkeys and
  // the history of the changes of access, with their notices. The accounts and
  // what the relay counted stay, as the participation record does.
  const accountData = await eraseAccountData(session.participantId, recoveries.map((request) => request.id));

  // SPEC-BLOCO-03 10.3 and Adenda P18: the delivery addresses, with the tracking
  // numbers and evidence that travel with them. Those of orders still open are
  // erased after the order's final state, and the participant is told so.
  const addresses = await eraseAddressesOf(session.participantId, ERASE_ADDRESSES_NOW_MAX);

  const revoked = await revokeAllSessions(session.participantId);

  await log.event('route.ok', {
    released,
    revoked,
    addresses_erased: addresses.erased,
    addresses_deferred: addresses.deferred,
    passkeys_erased: accountData.passkeys,
    recoveries_erased: accountData.recoveries,
  });
  return ok(
    {
      erased: true,
      phoneReleased: released > 0,
      sessionsRevoked: revoked,
      retained: 'participation record, no longer linked to an identity',
      addressesErased: addresses.erased,
      addressesDeferred: addresses.deferred,
      passkeysErased: accountData.passkeys,
      recoveriesErased: accountData.recoveries,
      ...(addresses.deferred === 0
        ? {}
        : { deferredNote: 'The delivery address of an order still open is erased within 30 days of that order ending.' }),
    },
    { 'Set-Cookie': clearedCookie() },
  );
});

/**
 * 8.10: exported as a named async function declaration.
 *
 * The V1 routes reached this shape by incident — commit cea0c09 renamed a
 * default export to POST because the runtime would not otherwise answer — and
 * the form the three surviving V1 routes use is the declaration. The V2 routes
 * differed from it for no reason, and a route file that does not look like the
 * one known to work is a difference nobody wants to be debugging in production.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
