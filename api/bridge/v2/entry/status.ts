import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { findEntry } from '../../../../lib/bridge-v2/entries.js';
import { readCustody } from '../../../../lib/bridge-v2/custody.js';

/**
 * POST /api/bridge/v2/entry/status   {giveawayId}
 *
 * What the Event Center page reads to show where an entry stands (step 4 of the
 * 05/09/2026 decision).
 *
 * This is the route that replaces the V1 status endpoint, which is finding #2:
 * a GET taking an email in the query string and returning that person's wallet
 * address, transaction hash and timestamps to anyone who asked. It was a
 * de-anonymisation oracle linking a real identity to an on-chain address and to
 * everything that address has ever done.
 *
 * Three requirements close it. D1: state is returned only to a session that
 * proved the address. A6: the identity is the cookie, never a parameter. D4: it
 * is a POST, so nothing personal is in a URL, a browser history, or a Referer.
 *
 * B1: rate limited even though it only reads. An unlimited read endpoint is an
 * unlimited budget for whatever it does reveal.
 */
export const POST = handle('entry/status', async ({ request, log }) => {
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
    { axis: 'ROUTE_GLOBAL', value: 'entry/status' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // Scoped to the caller's own participant id, which came from the cookie. There
  // is no query here that could name somebody else.
  const entry = await findEntry(session.participantId, giveawayId);
  if (entry === null) return ok({ status: 'NONE' });

  const custody = await readCustody(entry.id);
  await log.event('route.ok');

  // The transaction hash is the participant's own and is public on the chain
  // once submitted, so returning it to the person it belongs to reveals nothing
  // they cannot already see. It is returned to nobody else.
  return ok({
    status: entry.status,
    walletAddress: entry.walletAddress,
    txHash: entry.txHash,
    custody:
      custody === null
        ? null
        : {
            prizeKind: custody.prizeKind,
            requiresOwnWallet: custody.requiresOwnWallet,
            destinationAddress: custody.destinationAddress,
            destinationConfirmed: custody.destinationConfirmedAt !== null,
            custodyExpiresAt: custody.custodyExpiresAt,
          },
  });
});
