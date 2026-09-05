import { EMAIL_CODE_TTL_MINUTES, issueEmailCode } from '../../../../lib/bridge-v2/codes.js';
import { canonicalizeEmail, screenEmail } from '../../../../lib/bridge-v2/identity.js';
import { accepted, handle, methodGuard, padTo, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseEmail } from '../../../../lib/bridge-v2/validate.js';
import { sendCodeEmail } from '../../../../lib/bridge-v2/mail.js';
import { claimSpend } from '../../../../lib/bridge-v2/spend.js';
import { getWriter, checkedMaybe } from '../../../../lib/bridge-v2/db.js';

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
 * D3: the reply is padded to a floor, so what the body refuses to distinguish
 * cannot be distinguished by timing either.
 *
 * B5: an address that has never interacted with the platform is limited on its
 * own tight axis, so the bridge cannot be aimed at a third party's inbox.
 */
export const POST = handle('session/request-code', async ({ request, log, startedAt }) => {
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
  const db = await getWriter();
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
    { axis: known === null ? 'UNKNOWN_EMAIL' : 'EMAIL', value: canonical },
    { axis: 'ROUTE_GLOBAL', value: 'session/request-code' },
  ]);
  if (!verdict.allowed) {
    await log.event('ratelimit.denied', { axis: verdict.deniedAxis ?? 'unknown' });
    await padTo(startedAt);
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // C2 and C8: screening happens before anything is issued or sent, and its
  // outcome never reaches the client.
  const screening = await screenEmail(canonical);
  if (screening !== 'OK') {
    await log.event('sybil.rejected', { reason: screening });
    await padTo(startedAt);
    return accepted();
  }

  // B8: the email budget is claimed before the provider is called.
  if (!(await claimSpend('email', 1, log))) {
    await padTo(startedAt);
    return accepted();
  }

  const code = await issueEmailCode(canonical);
  const result = await sendCodeEmail(canonical, code, EMAIL_CODE_TTL_MINUTES);
  await log.event(result.sent ? 'code.issued' : 'code.failed');

  await padTo(startedAt);
  return accepted();
});
