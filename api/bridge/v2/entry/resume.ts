import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { advance, findEntry } from '../../../../lib/bridge-v2/entries.js';
import { hasEntered, readGiveaway, slotsRemaining } from '../../../../lib/bridge-v2/chain.js';

/**
 * POST /api/bridge/v2/entry/resume   {giveawayId}
 *
 * Path 3 of the 07/09/2026 decision: an entry in FAILED can be resumed once
 * the cause of the failure no longer holds.
 *
 * FAILED is reached from two places (processor.ts), and each names a
 * different way back in:
 *
 *   rootIndex === null   the entry never reached a published root — it failed
 *                         at publication (slots exhausted, or the campaign
 *                         closed). If the campaign still accepts entries and
 *                         has a slot free — a creator can reloadSlots inside
 *                         the reload window (contract section 7.2) — the
 *                         cause can be gone. Resume goes back to VERIFIED, so
 *                         the next publication considers it again.
 *
 *   rootIndex !== null    the address IS inside a published root (C8: that
 *                         never changes) and the entry failed after that —
 *                         at funding or submission, usually because the
 *                         campaign's entry window closed in the meantime, or
 *                         because a funding transaction was never mined.
 *                         Resume goes back to ELIGIBLE, so the pipeline
 *                         retries funding and submission directly; there is
 *                         no root to re-earn.
 *
 * Both branches re-check the SAME conditions the pipeline itself checks
 * before moving the row (H5/H6), so a resume that cannot actually succeed is
 * refused here rather than costing a wasted attempt in the next run. hasEntered
 * is checked first and independently of both: if the address is on chain after
 * all — a submission that landed after this side gave up — resuming means
 * recognising that instead of retrying a transaction that would only revert.
 *
 * A6/D1: the entry is found through the session's own participant id. D1 also
 * covers what this route is willing to say back: it is the caller's own
 * entry, so naming why a resume was refused (closed, full) is not the internal
 * state D5 protects against revealing to a stranger.
 */
const route = handle('entry/resume', async ({ request, log }) => {
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
    { axis: 'ROUTE_GLOBAL', value: 'entry/resume' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const entry = await findEntry(session.participantId, giveawayId);
  if (entry === null) return refuse(404, 'No entry for this event.');
  if (entry.status !== 'FAILED') {
    return ok({ status: entry.status });
  }

  if (await hasEntered(giveawayId, entry.walletAddress)) {
    const moved = await advance(entry.id, 'FAILED', 'CONFIRMED');
    await log.event('entry.confirmed', { reason: 'resumed_already_on_chain' });
    return ok({ status: moved ? 'CONFIRMED' : entry.status });
  }

  const campaign = await readGiveaway(giveawayId);
  if (!campaign.acceptsEntries || (await slotsRemaining(giveawayId)) <= 0n) {
    return refuse(409, 'This event cannot accept this entry any more.');
  }

  const to = entry.rootIndex === null ? 'VERIFIED' : 'ELIGIBLE';
  const moved = await advance(entry.id, 'FAILED', to);
  if (!moved) return refuse(409, 'This entry could not be resumed.');

  await log.event('entry.resumed', { giveaway_id: giveawayId.toString(), to });
  return ok({ status: to });
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
