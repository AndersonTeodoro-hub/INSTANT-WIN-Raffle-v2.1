import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseAddress, parseGiveawayId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { declareOwnAddress, findEntry } from '../../../../lib/bridge-v2/entries.js';

/**
 * POST /api/bridge/v2/entry/address   {giveawayId, address}
 *
 * 07/09/2026 owner decision, path 2 of 4: a participant with their own wallet
 * connects it, and that address — not the derived one — is what enters the
 * eligibility root. They sign enter() and claimPrize() themselves, with their
 * own gas; the platform never holds their prize (E1's own reasoning, extended
 * to a wallet the bridge does not control at all).
 *
 * A6/D1: the entry is found through the session's own participant id, never a
 * parameter. C8, applied to why the window closes at ELIGIBLE: once an
 * address sits inside a published root nobody can take it out again, so a
 * declaration has to land before that — declareOwnAddress enforces the same
 * thing again in the WHERE clause (G1: the check and the write are one
 * statement).
 *
 * The uniqueness rule of the decision — an address already used by another
 * participant in this campaign cannot be accepted — is a database constraint
 * (bridge_v2_entries_giveaway_address_unique, 0007), not a read this route
 * does first; a read-then-write here would be exactly the race G1 forbids.
 */
const route = handle('entry/address', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const giveawayId = parseGiveawayId(body.giveawayId);
  const address = parseAddress(body.address);
  if (giveawayId === null || address === null) {
    return refuse(400, 'Invalid giveaway id or address.');
  }

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'entry/address' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const entry = await findEntry(session.participantId, giveawayId);
  if (entry === null) return refuse(404, 'No entry for this event.');

  const outcome = await declareOwnAddress(entry.id, address);

  if (outcome === 'ADDRESS_TAKEN') {
    return refuse(409, 'This address is already used by another participant in this event.');
  }
  if (outcome === 'NOT_DECLARABLE') {
    // Already past ELIGIBLE (the root is published), or already this address.
    // D1: this is the caller's own entry, so the real reason is fine to give.
    return refuse(409, 'This entry can no longer change its address.');
  }

  await log.event('route.ok', { step: 'address_declared' });
  return ok({ walletAddress: address, selfCustody: true });
});

/**
 * 8.10: exported as a named async function declaration.
 *
 * The V1 routes reached this shape by incident — commit cea0c09 renamed a
 * default export to POST because the runtime would not otherwise answer — and
 * the form the three surviving V1 routes use is the declaration. The V2 routes
 * differed from it for no reason, and a route file that does not look like the
 * one known to work is a difference nobody wants to be debugging in production.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
