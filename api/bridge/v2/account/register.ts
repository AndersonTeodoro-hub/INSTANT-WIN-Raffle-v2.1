import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseCredentialId, parseUint256 } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { accountState, signerAddressOf } from '../../../../lib/bridge-v2/keptraChain.js';
import { ensureAccounts, liveRecovery, registerPasskey } from '../../../../lib/bridge-v2/accounts.js';
import { guardianAddress } from '../../../../lib/bridge-v2/guardian.js';
import { accountUsable, recoveryActive } from '../../../../lib/bridge-v2/keptra.js';

/** The P-256 field prime: a public key coordinate is below it. */
const P256_P = BigInt('0xffffffff00000001000000000000000000000000' + 'ffffffffffffffffffffffff');

/**
 * POST /api/bridge/v2/account/register   {x, y, credentialId}
 *
 * SPEC-BLOCO-03 6.2.1 (M9): the passkey is created in the browser at the
 * participant's first action and registered here, under the email session the
 * participant already has — never without one. What is stored is the PUBLIC key
 * and the signer address the factory derives from it; the private key never
 * leaves the device.
 *
 * The first passkey fixes the participant's two accounts (A10): their addresses
 * are computed and written now (6.1.6), and the accounts come into existence
 * with the first action that needs one (relay.ts). A later passkey — a second
 * device (6.2.4), or the new one a recovery installs (6.3) — is recorded and
 * becomes an owner only through the account itself or the 7-day recovery.
 *
 * A6: the identity is the cookie. The key is the participant's own claim about
 * their own device, and a public key already registered by anybody is refused.
 */
const route = handle('account/register', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const x = parseUint256(body.x);
  const y = parseUint256(body.y);
  const credentialId = parseCredentialId(body.credentialId);
  if (x === null || y === null || credentialId === null || x === 0n || y === 0n || x >= P256_P || y >= P256_P) {
    return refuse(400, 'Invalid passkey.');
  }

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'account/register' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const signer = await signerAddressOf(x, y);
  const passkey = await registerPasskey(session.participantId, credentialId, x, y, signer);
  if (passkey === 'TAKEN') return refuse(409, 'This passkey is already registered.');

  const accounts = await ensureAccounts(session.participantId, signer, guardianAddress());
  const states = await Promise.all(accounts.map((account) => accountState(account.safe)));
  const recovery = await liveRecovery(session.participantId);
  await log.event('account.registered');

  const usable = accounts.map((account, i) => accountUsable(states[i], account.deployedAt !== null));

  return ok({
    signer,
    accounts: accounts.map((account, i) => ({
      role: account.role,
      // C4 as D1 reads it: an account's address is shown only once it exists
      // on-chain with its configuration; before that it is not a place to send
      // anything. The page asks for `configure` (account/relay) and reads it
      // again. A configured account whose guardian was revoked stays usable.
      address: usable[i] ? account.safe : null,
      deployed: states[i].deployed,
      configured: usable[i],
      // A6 and C6: read from the chain against the CURRENT guardian, so an account
      // that revoked its guardian, or still holds one rotated away, shows no
      // recovery until it adds the new one.
      recoveryEnabled: recoveryActive(states[i], guardianAddress()),
    })),
    recovery: recovery === null ? null : { status: recovery.status, executeAfter: recovery.executeAfter },
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
