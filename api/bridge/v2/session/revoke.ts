import { clearedCookie, resolveSession, revokeAllSessions } from '../../../../lib/bridge-v2/session.js';
import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';

/**
 * POST /api/bridge/v2/session/revoke
 *
 * A5: invalidates every session of the caller, not just the one presenting the
 * cookie. The requirement exists for incident response, and a caller who has to
 * enumerate their sessions will miss one.
 *
 * Takes no body. The identity comes from the cookie (A6), so there is no
 * parameter through which one account could revoke another.
 */
const route = handle('session/revoke', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'session/revoke' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const session = await resolveSession(request);
  if (session === null) {
    // Clearing the cookie regardless keeps the answer uniform for a caller whose
    // session had already expired.
    return ok({}, { 'Set-Cookie': clearedCookie() });
  }

  const revoked = await revokeAllSessions(session.participantId);
  await log.event('route.ok', { revoked });
  return ok({}, { 'Set-Cookie': clearedCookie() });
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
