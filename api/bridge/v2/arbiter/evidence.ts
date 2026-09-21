import { recoverMessageAddress, type Hex } from 'viem';
import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseHexBytes, parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { ARBITER_SIGNATURE_MAX_AGE_MS } from '../../../../lib/bridge-v2/config.js';
import { escrowArbiter } from '../../../../lib/bridge-v2/escrowChain.js';
import { arbiterChallenge, evidenceDocument, evidenceOf, ordersConfigured } from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/arbiter/evidence {orderId, issuedAt, signature} -> {recipient, store, document}
 *
 * SPEC-BLOCO-03 P17 and P22, as the owner answered them: the arbiter reads both
 * parties' texts by signing, with its own key, a challenge that names the order
 * and an instant no older than five minutes. The signer is compared with the
 * arbiter the escrow names at that moment (escrow.arbiter()), so a rotation by
 * the owner (H5) reaches this route with no change here. The response carries
 * the hash decide() is to be given (P17).
 *
 * ponytail: an EOA arbiter only (EIP-191); a contract arbiter would need ERC-1271.
 */
const route = handle('arbiter/evidence', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const orderId = parseUint256(body.orderId);
  const issuedAt = typeof body.issuedAt === 'number' && Number.isInteger(body.issuedAt) ? body.issuedAt : null;
  const signature = parseHexBytes(body.signature, 65);
  if (orderId === null || issuedAt === null || signature === null) return refuse(400, 'Invalid request.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'arbiter/evidence' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  // Stale or from the future: a signature found later in a log is worth nothing.
  if (Math.abs(Date.now() - issuedAt) > ARBITER_SIGNATURE_MAX_AGE_MS) return refuse(401, 'Unauthorized.');
  let signer: `0x${string}`;
  try {
    signer = await recoverMessageAddress({ message: arbiterChallenge(orderId, issuedAt), signature: signature as Hex });
  } catch {
    return refuse(401, 'Unauthorized.');
  }
  if (signer.toLowerCase() !== (await escrowArbiter()).toLowerCase()) return refuse(401, 'Unauthorized.');

  const evidence = await evidenceOf(orderId);
  await log.event('order.evidence_read', { order_id: orderId.toString(), party: 'ARBITER' });
  return ok({ ...evidence, document: evidenceDocument(evidence.recipient, evidence.store) });
});

export async function POST(request: Request): Promise<Response> {
  return route(request);
}
