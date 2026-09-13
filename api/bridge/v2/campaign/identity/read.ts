import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../../../../lib/bridge-v2/validate.js';
import { readIdentities } from '../../../../../lib/bridge-v2/campaignIdentity.js';
import { IDENTITY_READ_MAX_IDS } from '../../../../../lib/bridge-v2/config.js';

/**
 * POST /api/bridge/v2/campaign/identity/read   {giveawayIds: string[]}
 *
 * L7: the one public read of campaign identity, and the path the Event Center
 * pages use. Everything it returns is what a creator published for everybody
 * to see, so there is no session: a visitor who has never signed in is exactly
 * who the list and the campaign page are for.
 *
 * What stays true of every other route stays true here. A POST, so the ids are
 * not in a URL (D4, for consistency rather than privacy). A bounded list, so one
 * request cannot ask for the whole table. Rate limited (B1, B2), because an
 * unlimited read is an unlimited budget for whatever it costs the database.
 *
 * A campaign with no identity is simply absent from the answer (L9). The page
 * falls back to what it showed before identities existed.
 */
const route = handle('campaign/identity/read', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const raw = body.giveawayIds;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > IDENTITY_READ_MAX_IDS) {
    return refuse(400, 'Invalid giveaway ids.');
  }
  const ids: bigint[] = [];
  for (const value of raw) {
    const id = parseGiveawayId(value);
    if (id === null) return refuse(400, 'Invalid giveaway ids.');
    if (!ids.includes(id)) ids.push(id);
  }

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'campaign/identity/read' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const identities = await readIdentities(ids);
  await log.event('route.ok', { found: identities.size });
  return ok({ identities: Object.fromEntries(identities) });
});

/** 8.10: exported as a named async function declaration, like every V2 route. */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
