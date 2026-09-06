import { EMAIL_CODE_TTL_MINUTES, issueEmailCode } from '../../../../lib/bridge-v2/codes.js';
import { canonicalizeEmail, screenEmail } from '../../../../lib/bridge-v2/identity.js';
import { accepted, handle, methodGuard, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseEmail } from '../../../../lib/bridge-v2/validate.js';
import { sendCodeEmail } from '../../../../lib/bridge-v2/mail.js';
import { claimSpend } from '../../../../lib/bridge-v2/spend.js';
import { getDb, checkedMaybe } from '../../../../lib/bridge-v2/db.js';

/**
 * POST /api/bridge/v2/session/request-code   {email}
 *
 * Sends a verification code so the caller can prove they control the address.
 * This is the only route that accepts an email, and it does not reveal anything
 * about it.
 *
 * D2 and finding #10: the response is identical whether the address is new, is
 * known, is disposable, or has no MX record. The V1 answered 409 "This email has
 * already entered", which turned the endpoint into a membership oracle.
 *
 * D3: uniformTiming holds every exit of this route to the same floor — the
 * refusals, the accepted answers, and the 500 the wrapper produces if anything
 * throws. Padding only the exits a route remembers to pad leaves the thrown one
 * as the fast path, and the thrown one is the one worth timing.
 *
 * B5: an address that has never interacted with the platform is limited on its
 * own tight axis, so the bridge cannot be aimed at a third party's inbox.
 */
const route = handle('session/request-code', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const email = parseEmail(body.email);
  if (email === null) return refuse(400, 'Enter a valid email address.');

  const canonical = canonicalizeEmail(email);
  const signals = await extractSignals(request);

  // Whether the address is already known decides which limit applies (B5), and
  // is the only thing this route learns before the limits are enforced.
  const db = getDb();
  const known = checkedMaybe(
    'participant.exists',
    await db
      .from('bridge_v2_participants')
      .select('id')
      .eq('email_canonical', canonical)
      .maybeSingle(),
  ) as { id: string } | null;

  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'SUBNET', value: signals.subnetHash },
    // C7: the device fingerprint, applied rather than only collected. A machine
    // registering account after account looks identical on every other axis
    // once it rotates addresses and moves through a residential proxy pool.
    { axis: 'CLIENT', value: signals.clientHash },
    { axis: known === null ? 'UNKNOWN_EMAIL' : 'EMAIL', value: canonical },
    { axis: 'ROUTE_GLOBAL', value: 'session/request-code' },
  ]);
  if (!verdict.allowed) {
    await log.event('ratelimit.denied', { axis: verdict.deniedAxis ?? 'unknown' });
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // C2 and C8: screening happens before anything is issued or sent, and its
  // outcome never reaches the client.
  const screening = await screenEmail(canonical);
  if (screening !== 'OK') {
    await log.event('sybil.rejected', { reason: screening });
    return accepted();
  }

  // B8: the email budget is claimed before the provider is called.
  if (!(await claimSpend('email', 1, log))) return accepted();

  const code = await issueEmailCode(canonical);
  const result = await sendCodeEmail(canonical, code, EMAIL_CODE_TTL_MINUTES);
  await log.event(result.sent ? 'code.issued' : 'code.failed');

  return accepted();
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
