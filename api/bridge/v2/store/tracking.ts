import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findAccount } from '../../../../lib/bridge-v2/accounts.js';
import { claimSpend } from '../../../../lib/bridge-v2/spend.js';
import { OrderMode, OrderState } from '../../../../lib/bridge-v2/abi.js';
import { readOrder, trackingHashUsed, type OrderWithTerms } from '../../../../lib/bridge-v2/escrowChain.js';
import { createTracker } from '../../../../lib/bridge-v2/ship24.js';
import {
  addressOfOrder,
  normaliseTrackingNumber,
  ordersConfigured,
  registerShipment,
  setTracker,
  stopTrackerRetry,
  trackingHashOf,
} from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/store/tracking {orderId, trackingNumber} -> {trackingHash}
 *
 * SPEC-BLOCO-03 9.1.1, H17, I6, M9, P7. The store gives the bridge the tracking
 * number of an order it ships by carrier. The bridge:
 *   - computes the keyed hash (H17) that ship() puts on-chain — never the number;
 *   - refuses a number that already serves an order (I6), here and on-chain,
 *     before the store signs a ship() the escrow would refuse;
 *   - registers the shipment with the tracking provider, with the destination
 *     post code and country and nothing else (M9, P7), and keeps its identifier.
 *
 * 9.5.5: a provider that does not answer blocks nothing. The hash is returned
 * and the store ships; the maintenance pass asks the provider again, and until it
 * answers the order is simply not in the oracle's list.
 *
 * P2: the store is the session's creator account, and it must be the store the
 * order's terms name.
 */
const route = handle('store/tracking', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const orderId = parseUint256(body.orderId);
  const trackingNumber = normaliseTrackingNumber(body.trackingNumber);
  if (orderId === null || trackingNumber === null) return refuse(400, 'Invalid tracking number.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'store/tracking' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const account = await findAccount(session.participantId, 'CREATOR');
  if (account === null) return refuse(409, 'No order of yours with that number.');

  let found: OrderWithTerms;
  try {
    found = await readOrder(orderId);
  } catch {
    return refuse(409, 'No order of yours with that number.');
  }
  if (found.terms.store.toLowerCase() !== account.safe.toLowerCase()) return refuse(409, 'No order of yours with that number.');
  if (found.terms.mode !== OrderMode.CARRIER || found.order.state !== OrderState.PAID) {
    return refuse(409, 'This order does not take a tracking number now.');
  }
  const address = await addressOfOrder(orderId);
  if (address === null) return refuse(409, 'The delivery address of this order is not registered yet.');

  const trackingHash = await trackingHashOf(trackingNumber);
  if (await trackingHashUsed(trackingHash)) return refuse(409, 'This tracking number already serves another order.');
  const registered = await registerShipment(orderId, trackingHash, trackingNumber);
  if (registered === 'hash_used') return refuse(409, 'This tracking number already serves another order.');
  if (registered === 'order_has_shipment') return refuse(409, 'A tracking number is already registered for this order.');
  await log.event('order.tracking_registered', { order_id: orderId.toString() });

  let tracked = false;
  if (await claimSpend('tracking', 1, log)) {
    const result = await createTracker(trackingNumber, address.postCode, address.country);
    if (result.kind === 'created') {
      await setTracker(orderId, result.trackerId);
      await log.event('order.tracker_created', { order_id: orderId.toString() });
      tracked = true;
    } else if (result.kind === 'refused') {
      // P5-3: refused for what it is — never asked again (the maintenance retries skip it).
      await stopTrackerRetry(orderId, 'REFUSED');
      await log.event('order.tracker_stopped', { order_id: orderId.toString(), reason: 'refused' });
    }
  }
  return ok({ trackingHash, tracked });
});

export async function POST(request: Request): Promise<Response> {
  return route(request);
}
