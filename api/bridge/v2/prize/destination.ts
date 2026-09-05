import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseAddress, parseGiveawayId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findEntry } from '../../../../lib/bridge-v2/entries.js';
import { confirmDestination, proposeDestination, readCustody } from '../../../../lib/bridge-v2/custody.js';

/**
 * POST /api/bridge/v2/prize/destination   {giveawayId, address, confirm?}
 *
 * E4: naming the wallet a prize should go to requires a session and a second,
 * explicit confirmation.
 *
 * Two calls, deliberately. The first proposes the address and gets it echoed
 * back; the page shows it to the participant; the second confirms that same
 * address. A single call that stored and accepted at once would leave nothing to
 * show, and the requirement is that the destination is confirmed to the
 * participant before anything moves.
 *
 * The confirming call repeats the address rather than confirming whatever is on
 * file. Confirming by reference would accept a value the participant never saw
 * if anything had changed it in between.
 */
const route = handle('prize/destination', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const giveawayId = parseGiveawayId(body.giveawayId);
  const address = parseAddress(body.address);
  if (giveawayId === null || address === null) return refuse(400, 'Invalid giveaway id or address.');
  const isConfirmation = body.confirm === true;

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'prize/destination' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const entry = await findEntry(session.participantId, giveawayId);
  if (entry === null) return refuse(404, 'No entry for this event.');

  const custody = await readCustody(entry.id);
  if (custody === null) return refuse(404, 'No entry for this event.');

  if (isConfirmation) {
    const confirmed = await confirmDestination(entry.id, address);
    if (!confirmed) {
      // The address does not match what was proposed, so there is nothing this
      // call can be confirming.
      return refuse(409, 'Confirm the address that was shown to you.');
    }
    await log.event('route.ok', { step: 'confirmed' });
    return ok({ destinationAddress: address, destinationConfirmed: true });
  }

  const proposed = await proposeDestination(entry.id, address);
  if (!proposed) return refuse(409, 'The destination could not be recorded.');

  await log.event('route.ok', { step: 'proposed' });
  // Echoed back so the page can show exactly what will be confirmed.
  return ok({ destinationAddress: address, destinationConfirmed: false });
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
