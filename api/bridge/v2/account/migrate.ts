import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseClientDataJson, parseCredentialId, parseHexBytes } from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { getParticipant } from '../../../../lib/bridge-v2/participants.js';
import { findCreatorByParticipant } from '../../../../lib/bridge-v2/creators.js';
import { authorizeMigration, findAccount, findPasskey } from '../../../../lib/bridge-v2/accounts.js';
import { isValidPasskeySignature } from '../../../../lib/bridge-v2/keptraChain.js';
import { assertionToSignature, migrationChallenge } from '../../../../lib/bridge-v2/keptra.js';
import { readAccount } from '../../../../lib/bridge-v2/relay.js';

/**
 * POST /api/bridge/v2/account/migrate
 *   {kind}                                                          -> the challenge to sign
 *   {kind, credentialId, authenticatorData, clientDataJSON, signature} -> authorised
 *
 * SPEC-BLOCO-03 6.6.2 and 6.6.3: an existing participant or creator authorises,
 * with the passkey of their account, the move of their derived wallet's balances
 * into it. The authorisation is checked ON-CHAIN, by the signer factory running
 * the account's own code (isValidSignatureForSigner, M32), before the row that
 * records it is written. The move itself is made by the maintenance pass, under
 * the pipeline's lock (migration.ts), because it signs as the derived wallet.
 *
 * A6: the derived wallet and the account are both the session's own, found from
 * the cookie. The body names only which of the two roles (A10).
 */
const route = handle('account/migrate', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');
  const kind = body.kind === 'CREATOR' ? 'CREATOR' : body.kind === 'PARTICIPANT' ? 'PARTICIPANT' : null;
  if (kind === null) return refuse(400, 'Invalid request.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'account/migrate' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  let walletIndex: number | null = null;
  let derived: `0x${string}` | null = null;
  if (kind === 'PARTICIPANT') {
    const participant = await getParticipant(session.participantId);
    walletIndex = participant?.walletIndex ?? null;
    derived = participant?.walletAddress ?? null;
  } else {
    const creator = await findCreatorByParticipant(session.participantId);
    walletIndex = creator?.walletIndex ?? null;
    derived = walletIndex === null ? null : (creator?.walletAddress ?? null);
  }
  if (walletIndex === null || derived === null) return refuse(404, 'There is no earlier wallet to move.');

  const account = await findAccount(session.participantId, kind);
  if (account === null) return refuse(409, 'Create your passkey first.');

  // C4: the account is where the balances will go. Until it exists on-chain with
  // its module and guardian, its address is not shown and nothing is authorised;
  // the page has the account set up first (account/relay, kind "configure").
  // E3 and E10: read from the chain, and marked deployed if it holds it configured.
  const { state, usable } = await readAccount(account);
  if (!usable) return refuse(409, 'Set up your account first.');

  const challenge = migrationChallenge(derived, account.safe);
  if (body.signature === undefined) return ok({ challenge });

  const credentialId = parseCredentialId(body.credentialId);
  const authenticatorData = parseHexBytes(body.authenticatorData, 512);
  const clientDataJSON = parseClientDataJson(body.clientDataJSON);
  const signature = parseHexBytes(body.signature, 80);
  if (credentialId === null || authenticatorData === null || clientDataJSON === null || signature === null) {
    return refuse(400, 'Invalid signature.');
  }

  const passkey = await findPasskey(session.participantId, credentialId);
  if (passkey === null) return refuse(404, 'This passkey is not registered to your account.');

  // The passkey has to be one of the account's owners.
  if (!state.owners.some((owner) => owner.toLowerCase() === passkey.signer.toLowerCase())) {
    return refuse(403, 'This passkey has no access to this account.');
  }

  const parsed = assertionToSignature(challenge, authenticatorData, clientDataJSON, signature);
  if (parsed === null || !(await isValidPasskeySignature(challenge, parsed, passkey.x, passkey.y))) {
    return refuse(401, 'That signature is not valid for this request.');
  }

  const outcome = await authorizeMigration(walletIndex, derived, account.id, kind);
  await log.event('migration.authorized', { kind, outcome });
  return ok({ status: outcome });
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
