import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findAccount } from '../../../../lib/bridge-v2/accounts.js';
import { readObligation, readTerms, type TermsView } from '../../../../lib/bridge-v2/escrowChain.js';
import { writeDescription } from '../../../../lib/bridge-v2/descriptions.js';
import { keptraContractsConfigured } from '../../../../lib/bridge-v2/orders.js';
import { checkDescription } from '../../../../lib/keptra-description.js';

/**
 * POST /api/bridge/v2/store/description {termsId, title, text, obligationId?} -> {written}
 *
 * SPEC-BLOCO-03 T4: the store or brand writes the description of what it just
 * created — the offer the relay returned the id of (T5), or the obligation, whose
 * terms carry it. Once: a second write for the same terms is refused, whoever
 * sends it, and the table grants no UPDATE (0014), so a description a buyer read
 * is the description the arbiter reads.
 *
 * Who may write is the chain's answer, not the database's: the terms must name
 * the session's creator account as their store (P2), and an obligation named
 * with them must be that brand's, over those terms.
 */
const route = handle('store/description', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  if (!keptraContractsConfigured()) return refuse(503, 'Offers are not available yet.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const termsId = parseUint256(body.termsId);
  const obligationId = body.obligationId === undefined || body.obligationId === null ? null : parseUint256(body.obligationId);
  const checked = checkDescription({ title: body.title, text: body.text });
  if (termsId === null || (body.obligationId != null && obligationId === null)) return refuse(400, 'Invalid offer.');
  if (!checked.ok) return refuse(400, checked.field === 'title' ? 'Invalid title.' : 'Invalid description.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'store/description' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const account = await findAccount(session.participantId, 'CREATOR');
  if (account === null) return refuse(409, 'No offer of yours with that number.');

  let terms: TermsView;
  try {
    terms = await readTerms(termsId);
  } catch {
    return refuse(409, 'No offer of yours with that number.');
  }
  if (terms.store.toLowerCase() !== account.safe.toLowerCase()) return refuse(409, 'No offer of yours with that number.');
  // An offer is written as an offer; the terms of an obligation only with the obligation that holds them.
  if (terms.prize !== (obligationId !== null)) return refuse(409, 'No offer of yours with that number.');
  if (obligationId !== null) {
    try {
      const obligation = await readObligation(obligationId);
      if (obligation.termsId !== termsId || obligation.brand.toLowerCase() !== account.safe.toLowerCase()) {
        return refuse(409, 'No obligation of yours with that number.');
      }
    } catch {
      return refuse(409, 'No obligation of yours with that number.');
    }
  }

  const written = await writeDescription({ termsId, store: account.safe, obligationId, ...checked.value });
  if (written === 'exists') return refuse(409, 'This description is already written and cannot be changed.');
  await log.event('offer.description_written', { kind: obligationId === null ? 'offer' : 'obligation' });
  return ok({ written: true });
});

/**
 * 8.10: exported as a named async function declaration.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
