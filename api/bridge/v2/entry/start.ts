import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { getParticipant } from '../../../../lib/bridge-v2/participants.js';
import { openEntry } from '../../../../lib/bridge-v2/entries.js';
import { issueLinkCode } from '../../../../lib/bridge-v2/linkcodes.js';
import { largestWinnerShare, policyFor, recordPolicy } from '../../../../lib/bridge-v2/custody.js';
import { readGiveaway, slotsRemaining } from '../../../../lib/bridge-v2/chain.js';
import { requireEnv } from '../../../../lib/bridge-v2/env.js';

/**
 * POST /api/bridge/v2/entry/start   {giveawayId}
 *
 * Step 1 of the 05/09/2026 decision: the campaign form has been filled, and this
 * returns the link the green button opens.
 *
 * A6: the campaign is a parameter but the person is not. The participant comes
 * from the session cookie, so nobody can start an entry on somebody else's
 * behalf.
 *
 * H6: slots are checked here as well as in the processor. Handing out a link for
 * a campaign that cannot accept the entry would end in a confirmation that
 * cannot be honoured, and the participant has already given a phone number by
 * then.
 */
const route = handle('entry/start', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const giveawayId = parseGiveawayId(body.giveawayId);
  if (giveawayId === null) return refuse(400, 'Invalid giveaway id.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    // C7: the burst signals are applied here because this is the last route
    // before an address can reach an eligibility root, and C8 is absolute — once
    // an address is inside a published root nobody can take it out again.
    { axis: 'CLIENT', value: signals.clientHash },
    { axis: 'SUBNET', value: signals.subnetHash },
    { axis: 'GIVEAWAY', value: giveawayId.toString() },
    { axis: 'ROUTE_GLOBAL', value: 'entry/start' },
  ]);
  if (!verdict.allowed) {
    await log.event('ratelimit.denied', { axis: verdict.deniedAxis ?? 'unknown' });
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const campaign = await readGiveaway(giveawayId);
  // H5/H6: the condition enter() actually applies, not half of it. A campaign
  // stays OPEN past its end until somebody calls the permissionless
  // closeGiveaway, and enter() refuses on block.timestamp >= effectiveEndTime
  // (GiveawayManagerV2 line 709) whatever the status says. Handing out a link in
  // that gap sends the participant to a bot, asks them for a phone number, and
  // ends in an entry the contract was always going to reject.
  if (!campaign.acceptsEntries) return refuse(409, 'This event is not open for entries.');
  if ((await slotsRemaining(giveawayId)) <= 0n) {
    return refuse(409, 'This event is full.');
  }

  const participant = await getParticipant(session.participantId);
  if (participant === null) return refuse(401, 'Sign in to continue.');

  const entry = await openEntry(participant, giveawayId);
  if (entry.status !== 'AWAITING_CONTACT') {
    // Already confirmed or already moving. Nothing to re-issue.
    return ok({ status: entry.status });
  }

  // E2 is recorded at entry time so the rule the participant is subject to is
  // visible from the start. It is PROVISIONAL and says so here, because at this
  // moment neither input is final: the contract clamps winnersCount down to the
  // entrant count when the campaign closes, which can only raise what each
  // winner receives. The prize path recomputes it from claimable() before
  // anything moves and rewrites the row.
  //
  // The largest share the campaign could pay is used rather than the mean, so
  // the provisional answer errs towards the stricter branch. The previous
  // arithmetic erred the other way — it divided by a winner count that had not
  // been clamped yet — which is the direction that leaves a prize over the
  // threshold sitting in a derived wallet.
  //
  // D1: feeToken is what decides whether the threshold applies at all. For an
  // NFT campaign the core sets it to USDC and the NFT branch runs first, so it
  // is never consulted there.
  await recordPolicy(
    entry.id,
    policyFor(
      campaign.prizeKind,
      largestWinnerShare(campaign.prizeAmount, campaign.winnersCount),
      campaign.feeToken,
    ),
  );

  const code = await issueLinkCode(participant.id, giveawayId);
  await log.event('entry.created', { giveaway_id: giveawayId.toString() });

  // R1: a plain t.me link that opens a chat with a bot. Not a Web App, not a
  // Mini App, and not an inline button that opens either. The username is read
  // from configuration because the owner chooses it.
  return ok({
    status: entry.status,
    url: `https://t.me/${requireEnv('TELEGRAM_BOT_USERNAME')}?start=${code}`,
  });
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
