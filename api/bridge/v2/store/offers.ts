import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findAccount } from '../../../../lib/bridge-v2/accounts.js';
import { descriptionsOfStore } from '../../../../lib/bridge-v2/descriptions.js';
import { keptraContractsConfigured } from '../../../../lib/bridge-v2/orders.js';

/**
 * POST /api/bridge/v2/store/offers -> the offers and obligations the store published
 *
 * SPEC-BLOCO-03 T4 and T5: there is no catalogue, so the business console finds
 * its own offers and obligations by their descriptions — every one it created
 * through the page carries one (T4). Ids and texts only; the conditions, the
 * state and the numbers are read from the chain by the page.
 *
 * P2: the store is the session's creator account.
 */
const route = handle('store/offers', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  if (!keptraContractsConfigured()) return refuse(503, 'Offers are not available yet.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'store/offers' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const account = await findAccount(session.participantId, 'CREATOR');
  if (account === null) return ok({ offers: [] });

  const offers = (await descriptionsOfStore(account.safe)).map((row) => ({
    termsId: row.termsId.toString(),
    obligationId: row.obligationId === null ? null : row.obligationId.toString(),
    title: row.title,
  }));
  await log.event('route.ok', { offers: offers.length });
  return ok({ offers });
});

/**
 * 8.10: exported as a named async function declaration.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
