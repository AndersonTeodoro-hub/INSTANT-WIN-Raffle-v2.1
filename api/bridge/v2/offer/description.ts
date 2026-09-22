import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { descriptionOf } from '../../../../lib/bridge-v2/descriptions.js';
import { keptraContractsConfigured } from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/offer/description {termsId} -> {termsId, title, text, obligationId, createdAt}
 *
 * SPEC-BLOCO-03 T4 and T5: the product description behind an offer's link (or a
 * voucher's obligation), read by anyone who opens it — there is no catalogue, the
 * store shares one link per offer. Public by nature: it is what the store
 * published. The conditions themselves are read from the chain by the page.
 *
 * No session, and no chain: the database only. A description the store has not
 * written answers 404, and the page says so and does not let anyone pay (T4).
 */
const route = handle('offer/description', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;
  if (!keptraContractsConfigured()) return refuse(503, 'Offers are not available yet.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const termsId = parseUint256(body.termsId);
  if (termsId === null) return refuse(400, 'Invalid offer.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'offer/description' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const description = await descriptionOf(termsId);
  if (description === null) return refuse(404, 'This offer has no description yet.');
  await log.event('route.ok');
  return ok({
    termsId: description.termsId.toString(),
    title: description.title,
    text: description.text,
    obligationId: description.obligationId === null ? null : description.obligationId.toString(),
    createdAt: description.createdAt,
  });
});

/**
 * 8.10: exported as a named async function declaration.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
