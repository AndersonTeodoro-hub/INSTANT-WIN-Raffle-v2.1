import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { getParticipant } from '../../../../lib/bridge-v2/participants.js';
import { openEntry } from '../../../../lib/bridge-v2/entries.js';
import { issueLinkCode } from '../../../../lib/bridge-v2/linkcodes.js';
import { policyFor, recordPolicy } from '../../../../lib/bridge-v2/custody.js';
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
export const POST = handle('entry/start', async ({ request, log }) => {
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
    { axis: 'GIVEAWAY', value: giveawayId.toString() },
    { axis: 'ROUTE_GLOBAL', value: 'entry/start' },
  ]);
  if (!verdict.allowed) {
    await log.event('ratelimit.denied', { axis: verdict.deniedAxis ?? 'unknown' });
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const campaign = await readGiveaway(giveawayId);
  if (!campaign.isOpen) return refuse(409, 'This event is not open for entries.');
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
  // the rule that was in force when they entered, and is visible from the start.
  await recordPolicy(
    entry.id,
    policyFor(campaign.prizeKind, campaign.prizeAmount, campaign.winnersCount),
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
