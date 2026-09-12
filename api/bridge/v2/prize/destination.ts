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

  // A KNOWN NON-WINNER IS REFUSED, NOT "ANYBODY NOT YET A KNOWN WINNER", and the
  // difference is a prize. The custody row below exists for every entrant from
  // the moment they enter — it records the rule that would apply on a win — so
  // reading it as permission let a loser write a destination, and the route is
  // reachable whether or not the page shows the panel.
  //
  // But outcome is written by a scheduled pass, so between the draw landing and
  // that pass a real winner's row still says nothing. `!== 'WON'` closed the one
  // route they have to name a wallet during that window, and for every prize
  // that requires their own wallet (custody.ts: every NFT, every token but USDC)
  // the pipeline will not claim without one. NULL therefore keeps the behaviour
  // this route already had; LOST and VOID are what is new.
  if (entry.outcome === 'LOST' || entry.outcome === 'VOID') {
    return refuse(404, 'No prize to send for this event.');
  }

  // The bridge holds no key for a self-custody entry and never claims or
  // delivers for one, so a destination stored here would be read by nothing.
  if (entry.selfCustody) return refuse(404, 'No prize to send for this event.');

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
