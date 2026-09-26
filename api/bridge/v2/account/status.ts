import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { emailOf, getParticipant } from '../../../../lib/bridge-v2/participants.js';
import { findCreatorByParticipant } from '../../../../lib/bridge-v2/creators.js';
import { hasVerifiedPhone } from '../../../../lib/bridge-v2/phone.js';
import { accountsOf, migrationStatus, passkeyCredentialIds } from '../../../../lib/bridge-v2/accounts.js';
import { guardianAddress } from '../../../../lib/bridge-v2/guardian.js';
import { recoveryActive } from '../../../../lib/bridge-v2/keptra.js';
import { readAccount } from '../../../../lib/bridge-v2/relay.js';

/**
 * POST /api/bridge/v2/account/status -> the session's own account state
 *
 * SPEC-BLOCO-03 T3 (AMB-3): the read the account page needs and account/register
 * could not give it — register wants the passkey's public key, which the browser
 * only knows at the moment it creates one, so a second device, or the same one
 * after a reload, had no way to ask. This reads; it registers nothing.
 *
 * What it says, each read where the decision is made elsewhere:
 * - the accounts, with an address only once usable (C4 as D1 reads it), and
 *   "recovery active" against the chain's current guardian (A6, C6);
 * - a change of access pending on-chain — what cancelRecovery cancels (6.3.3,
 *   U12);
 * - the passkeys' credential ids, for navigator.credentials.get;
 * - where the migration of each derived wallet stands (6.6, U14);
 * - whether the phone is verified (a voucher campaign needs it, AQ5).
 *
 * A6 and D1: the identity is the cookie; the body carries nothing.
 */
const route = handle('account/status', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'account/status' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const [email, phoneVerified, passkeys, accounts, participant, creator] = await Promise.all([
    emailOf(session.participantId),
    hasVerifiedPhone(session.participantId),
    passkeyCredentialIds(session.participantId),
    accountsOf(session.participantId),
    getParticipant(session.participantId),
    findCreatorByParticipant(session.participantId),
  ]);
  // E3 and E10: read from the chain, and marked deployed if it holds them configured.
  const views = await Promise.all(accounts.map((account) => readAccount(account)));

  const migration = async (walletIndex: number | null | undefined) =>
    walletIndex == null ? 'NONE' : ((await migrationStatus(walletIndex)) ?? 'PENDING');

  await log.event('route.ok');
  return ok({
    email,
    phoneVerified,
    passkeys,
    accounts: views.map(({ account, state, usable }) => ({
      role: account.role,
      address: usable ? account.safe : null,
      configured: usable,
      recoveryEnabled: recoveryActive(state, guardianAddress()),
      // 6.3.3: a change of access this account's passkey can still cancel, with when it would take effect.
      recoveryPendingUntil: state.recoveryExecuteAfter === 0n ? null : new Date(Number(state.recoveryExecuteAfter) * 1000).toISOString(),
    })),
    migration: {
      PARTICIPANT: await migration(participant?.walletIndex),
      CREATOR: await migration(creator?.walletIndex),
    },
  });
});

/**
 * 8.10: exported as a named async function declaration.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
