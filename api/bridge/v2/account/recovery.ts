import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseCredentialId } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { hasVerifiedPhone } from '../../../../lib/bridge-v2/phone.js';
import { hashRecoveryCode, newRecoveryCode } from '../../../../lib/bridge-v2/linkcodes.js';
import { accountsOf, findPasskey, openRecovery } from '../../../../lib/bridge-v2/accounts.js';
import { LINK_CODE_TTL_MS } from '../../../../lib/bridge-v2/config.js';
import { requireEnv } from '../../../../lib/bridge-v2/env.js';

/**
 * POST /api/bridge/v2/account/recovery   {credentialId}
 *
 * SPEC-BLOCO-03 6.3 and A14: the start of a change of access, for a participant
 * who lost their passkey. BOTH factors, and the second one fresh: the email
 * session this route resolves, and — through the link it returns — the number
 * Telegram confirms now, which must be the number this account already holds
 * (api/bridge/v2/telegram/webhook.ts). Only then does the guardian confirm, and
 * only after R-1; the change then waits the module's seven days, with notices,
 * and the old passkey can cancel it at any moment (recovery.ts).
 *
 * `credentialId` names the NEW passkey, registered first through
 * account/register under the same session. It is looked up among this
 * participant's own passkeys, never anybody else's.
 */
const route = handle('account/recovery', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const credentialId = parseCredentialId(body.credentialId);
  if (credentialId === null) return refuse(400, 'Invalid passkey.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'account/recovery' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // A14: the number is compared with this one; without it there is no second factor.
  if (!(await hasVerifiedPhone(session.participantId))) {
    return refuse(403, 'This account has no confirmed phone number, so its access cannot be changed this way.');
  }

  const passkey = await findPasskey(session.participantId, credentialId);
  if (passkey === null) return refuse(404, 'Register the new passkey first.');

  const deployed = (await accountsOf(session.participantId)).filter((account) => account.deployedAt !== null);
  if (deployed.length === 0) return refuse(409, 'There is no account to recover yet.');

  const code = newRecoveryCode();
  const opened = await openRecovery(
    session.participantId,
    passkey.id,
    await hashRecoveryCode(code),
    new Date(Date.now() + LINK_CODE_TTL_MS),
  );
  if (opened === 'ALREADY_OPEN') return refuse(409, 'A change of access is already in progress.');

  await log.event('recovery.requested');
  // R1: the same plain t.me start link an entry uses; the bot asks for the contact.
  return ok({
    status: opened.status,
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
