import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findAccount } from '../../../../lib/bridge-v2/accounts.js';
import { OrderState } from '../../../../lib/bridge-v2/abi.js';
import { addressOfOrder, ordersConfigured, ordersOfStore, publicOrder, shipmentOf } from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/store/orders -> the store's orders, with the addresses to ship to
 *
 * SPEC-BLOCO-03 10.2 and P2: an address is read by the store of its order and by
 * the post-code comparison, and nobody else. The store is the session's creator
 * account, which must be the store the terms name — the only orders listed are
 * the ones whose terms name it. The address comes with an order still open, the
 * only time the store has a use for it; a final order shows none.
 *
 * SPEC-BLOCO-03 V1 (A1): with an open order comes whether its tracking number is
 * registered, so the store declares the shipment from any session — after a
 * reload, from the notice's link, or after an answer that never arrived — and is
 * never asked for a number the bridge already holds (store/tracking refuses a
 * second one).
 */
const route = handle('store/orders', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'store/orders' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const account = await findAccount(session.participantId, 'CREATOR');
  if (account === null) return ok({ orders: [] });

  const orders = [];
  for (const row of await ordersOfStore(account.safe)) {
    const open = row.state !== OrderState.CLOSED;
    orders.push({
      ...publicOrder(row),
      address: open ? await addressOfOrder(row.orderId) : null,
      trackingRegistered: open && (await shipmentOf(row.orderId)) !== null,
    });
  }
  await log.event('route.ok', { orders: orders.length });
  return ok({ orders });
});

export async function POST(request: Request): Promise<Response> {
  return route(request);
}
