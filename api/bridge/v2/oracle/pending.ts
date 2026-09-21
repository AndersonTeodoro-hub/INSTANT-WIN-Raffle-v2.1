import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { timingSafeEqualHex } from '../../../../lib/bridge-v2/crypto.js';
import { requireKeptraEnv } from '../../../../lib/bridge-v2/env.js';
import { oraclePending, ordersConfigured } from '../../../../lib/bridge-v2/orders.js';

/**
 * GET /api/bridge/v2/oracle/pending -> {pending: [{orderId, trackerId, postCode}]}
 *
 * SPEC-BLOCO-03 M9, N7, O4 — the list the delivery oracle (piece 4, instant-win-cre
 * 43032c9, workflow.ts fetchPendingList) reads every fifteen minutes: the
 * orders of the TRANSPORTADORA mode waiting for a proof, with the provider's
 * identifier and the destination post code (L1: the DON nodes are the post-code
 * comparison of 10.2). Nothing else of an address, and no tracking number (M6).
 *
 * Its own credential (O4): Authorization: Bearer <BRIDGE_V2_ORACLE_TOKEN>, the
 * value the CRE holds as KEPTRA_BRIDGE_TOKEN, compared in constant time (J5).
 * The format is the oracle's parsePendingList (tracking.ts:273-330); order ids
 * are strings, because a uint256 does not survive a JSON number.
 */
const route = handle('oracle/pending', async ({ request, log }) => {
  const guard = methodGuard(request, 'GET');
  if (guard !== null) return guard;
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const token = requireKeptraEnv('BRIDGE_V2_ORACLE_TOKEN');
  if (!timingSafeEqualHex(request.headers.get('authorization') ?? '', `Bearer ${token}`)) return refuse(401, 'Unauthorized.');

  // Every node of the DON asks; one axis over all of them bounds a runaway caller.
  const verdict = await enforce([{ axis: 'ROUTE_GLOBAL', value: 'oracle/pending' }]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const pending = await oraclePending(Math.floor(Date.now() / 1000));
  await log.event('route.ok', { pending: pending.length });
  return ok({ pending });
});

export async function GET(request: Request): Promise<Response> {
  return route(request);
}
