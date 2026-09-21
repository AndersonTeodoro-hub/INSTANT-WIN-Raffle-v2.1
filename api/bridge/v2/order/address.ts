import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findAccount } from '../../../../lib/bridge-v2/accounts.js';
import { readObligation, readTerms, readVouchers, regionsOf } from '../../../../lib/bridge-v2/escrowChain.js';
import { ordersConfigured, parsePostalAddress, registerAddress, type AddressPurpose } from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/order/address
 *   {termsId | voucherId, name, street, postCode, city, country, phone?} -> registered
 *
 * SPEC-BLOCO-03 section 10, P15, P19, H7. The recipient registers where an order
 * is to be delivered BEFORE it exists: for an offer, before paying (COMPRA); for
 * a voucher it holds, before redeeming (PRÉMIO). The order that opens takes the
 * address (relay.ts, keptraOrders.ts). An address in a country the store or the
 * brand does not accept is refused here, before any money moves (P15, 11.5).
 *
 * P21: Keptra accounts only — the session's own participant account, never an
 * address from the body (M36). Stored encrypted; nothing of it goes on-chain (I7).
 */
const route = handle('order/address', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  // P24.
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const address = parsePostalAddress(body);
  const termsId = body.termsId === undefined ? null : parseUint256(body.termsId);
  const voucherId = body.voucherId === undefined ? null : parseUint256(body.voucherId);
  if (address === null || (termsId === null) === (voucherId === null)) return refuse(400, 'Invalid address.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'order/address' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const account = await findAccount(session.participantId, 'PARTICIPANT');
  if (account === null) return refuse(409, 'Create your passkey first.');

  let regions: string[];
  let purpose: AddressPurpose;
  try {
    if (termsId !== null) {
      const terms = await readTerms(termsId);
      if (!terms.active || terms.prize) return refuse(409, 'This offer is not available.');
      purpose = { termsId };
      regions = await regionsOf(termsId);
    } else {
      const id = voucherId as bigint;
      const [voucher] = await readVouchers([id]);
      // 11.4 and 11.10: a voucher this account won and still holds, claimed and not voided.
      if (voucher.owner === null || voucher.owner.toLowerCase() !== account.safe.toLowerCase() || voucher.voided || voucher.claimedAt === 0n) {
        return refuse(409, 'This voucher is not yours to redeem.');
      }
      purpose = { voucherId: id };
      regions = await regionsOf((await readObligation(voucher.obligationId)).termsId);
    }
  } catch {
    // An id past the escrow's count reverts; so does a node that cannot answer.
    return refuse(409, 'This cannot be delivered right now.');
  }
  // P15 (COMPRA) and H7 (PRÉMIO): only a country the terms accept.
  if (!regions.includes(address.country)) return refuse(409, 'This is not delivered to that country.');

  await registerAddress(session.participantId, purpose, address);
  await log.event('order.address_registered', { kind: termsId !== null ? 'offer' : 'voucher' });
  return ok({ registered: true });
});

export async function POST(request: Request): Promise<Response> {
  return route(request);
}
