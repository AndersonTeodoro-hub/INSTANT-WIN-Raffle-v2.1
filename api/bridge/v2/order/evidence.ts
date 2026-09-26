import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { accountsOf } from '../../../../lib/bridge-v2/accounts.js';
import { OrderState } from '../../../../lib/bridge-v2/abi.js';
import { readOrder, type OrderWithTerms } from '../../../../lib/bridge-v2/escrowChain.js';
import {
  evidenceDocument,
  evidenceOf,
  ordersConfigured,
  parseEvidence,
  writeEvidence,
  type EvidenceParty,
} from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/order/evidence {orderId, text?} -> {recipient, store, document}
 *
 * SPEC-BLOCO-03 T9, 10.3, P17. While an order is contested, each party writes one
 * text of at most 2 000 characters — the recipient from the participant account
 * that paid or redeemed, the store from its creator account (P2) — encrypted at
 * rest and never rewritten, so the hash the arbiter passes to decide() does not
 * move once both are in. Both parties read both texts, and the hash, at any time
 * until they are erased with the address (10.3). The arbiter reads them through
 * arbiter/evidence.
 */
const route = handle('order/evidence', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  if (!ordersConfigured()) return refuse(503, 'Orders are not available yet.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const orderId = parseUint256(body.orderId);
  const text = body.text === undefined ? null : parseEvidence(body.text);
  if (orderId === null || (body.text !== undefined && text === null)) return refuse(400, 'Invalid evidence.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'order/evidence' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  let found: OrderWithTerms;
  try {
    found = await readOrder(orderId);
  } catch {
    return refuse(409, 'No order of yours with that number.');
  }
  const accounts = await accountsOf(session.participantId);
  const safe = (role: 'PARTICIPANT' | 'CREATOR') => accounts.find((a) => a.role === role)?.safe.toLowerCase();
  const party: EvidenceParty | null =
    found.order.payer.toLowerCase() === safe('PARTICIPANT')
      ? 'RECIPIENT'
      : found.terms.store.toLowerCase() === safe('CREATOR')
        ? 'STORE'
        : null;
  if (party === null || found.order.state === OrderState.NONE) return refuse(409, 'No order of yours with that number.');

  if (text !== null) {
    if (found.order.state !== OrderState.CONTESTED) return refuse(409, 'Evidence is written while the order is contested.');
    if (!(await writeEvidence(orderId, party, text))) return refuse(409, 'Your evidence for this order is already written.');
    await log.event('order.evidence_written', { order_id: orderId.toString(), party });
  }

  const evidence = await evidenceOf(orderId);
  return ok({ ...evidence, document: evidenceDocument(evidence.recipient, evidence.store) });
});

export async function POST(request: Request): Promise<Response> {
  return route(request);
}
