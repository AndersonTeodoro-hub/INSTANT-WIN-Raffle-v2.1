import { EMAIL_CODE_DIGITS } from '../../../../lib/bridge-v2/config.js';
import { verifyEmailCode } from '../../../../lib/bridge-v2/codes.js';
import { canonicalizeEmail } from '../../../../lib/bridge-v2/identity.js';
import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseCode, parseEmail } from '../../../../lib/bridge-v2/validate.js';
import { createSession, sessionCookie } from '../../../../lib/bridge-v2/session.js';
import { getOrCreateParticipant } from '../../../../lib/bridge-v2/participants.js';

/**
 * POST /api/bridge/v2/session/verify   {email, code}
 *
 * Proves control of the address and issues a session. This is the only place a
 * session is created, and the only place an email is turned into an identity.
 *
 * A1: everything downstream requires the cookie this sets. A6: no other route
 * accepts an email, an address, or a participant id from the client, so there is
 * no second way to claim to be somebody.
 *
 * D2: a wrong code and a non-existent code produce the same answer. Distinguish
 * them and the route becomes the oracle that request-code refuses to be.
 *
 * D3: uniformTiming holds every exit to the same floor, the 500 included, so the
 * two answers D2 makes identical are identical in latency as well.
 */
const route = handle('session/verify', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const email = parseEmail(body.email);
  const code = parseCode(body.code, EMAIL_CODE_DIGITS);
  if (email === null || code === null) return refuse(400, 'Invalid email or code.');

  const canonical = canonicalizeEmail(email);
  const signals = await extractSignals(request);

  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'SUBNET', value: signals.subnetHash },
    { axis: 'EMAIL', value: canonical },
    { axis: 'ROUTE_GLOBAL', value: 'session/verify' },
  ]);
  if (!verdict.allowed) {
    await log.event('ratelimit.denied', { axis: verdict.deniedAxis ?? 'unknown' });
    return refuse(429, 'Too many attempts. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // J4 and G1: the attempt is spent inside the database before the comparison,
  // so concurrent guesses cannot share one increment (finding #5).
  const result = await verifyEmailCode(canonical, code);
  if (result !== 'OK') {
    await log.event('code.failed', { outcome: result });
    return refuse(401, 'That code is not valid.');
  }

  // The participant is created here, on first proof of control, and never
  // earlier: an unverified address must not produce a wallet.
  const participant = await getOrCreateParticipant(canonical);
  const token = await createSession(participant.id, signals);

  await log.event('route.ok');
  // A3: the token travels in the cookie only. It is never in the body, so it is
  // never in a log, a history entry, or a Referer header.
  return ok({}, { 'Set-Cookie': sessionCookie(token) });
}, { uniformTiming: true });

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
