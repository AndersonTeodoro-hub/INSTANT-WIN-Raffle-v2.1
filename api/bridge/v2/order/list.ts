import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findAccount } from '../../../../lib/bridge-v2/accounts.js';
import { orderHasAddress, ordersConfigured, ordersOfPayer, publicOrder } from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/order/list -> the recipient's own orders
 *
 * SPEC-BLOCO-03 piece 5, for the frontend (piece 6): the orders of the
 * session's participant account, as the orders pass last read them — state,
 * deadlines and outcome — and whether each has its delivery address. Nothing of
 * the address itself, and nothing of anybody else's (M36).
 *
 * Adenda R4: not asked for by the spec, and kept as part of the boundary with
 * piece 6, which reads it.
 */
const route = handle('order/list', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'order/list' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const account = await findAccount(session.participantId, 'PARTICIPANT');
  if (account === null) return ok({ orders: [] });

  const orders = [];
  for (const row of await ordersOfPayer(account.safe)) orders.push({ ...publicOrder(row), hasAddress: await orderHasAddress(row.orderId) });
  await log.event('route.ok', { orders: orders.length });
  return ok({ orders });
});

export async function POST(request: Request): Promise<Response> {
  return route(request);
}
