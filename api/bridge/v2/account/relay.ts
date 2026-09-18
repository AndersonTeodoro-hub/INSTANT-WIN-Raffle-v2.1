import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import {
  parseAddress,
  parseClientDataJson,
  parseCredentialId,
  parseGiveawayId,
  parseHexBytes,
  parseUint256,
} from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { ChainError } from '../../../../lib/bridge-v2/chain.js';
import { prepareAction, RelayRefusal, submitAction, type Action } from '../../../../lib/bridge-v2/relay.js';
import type { AccountRole } from '../../../../lib/bridge-v2/keptra.js';

/**
 * POST /api/bridge/v2/account/relay
 *   {kind, giveawayId?, to?, amount?, credentialId?, role?}        -> the hash to sign
 *   {..., nonce, credentialId, authenticatorData, clientDataJSON, signature} -> relayed
 *
 * SPEC-BLOCO-03 6.2.2 and 6.1.5: every action that moves value or rights is
 * signed by the passkey at the moment, and the bridge only submits it and pays.
 *
 * A6 and M36: the account is the session's own, found from the cookie. No
 * address of an account is read from the body: `to` is a prize destination the
 * owner chooses, and the passkey signs over it.
 *
 * The same body is built twice, once to be signed and once to be sent, and the
 * second build must produce the hash the passkey signed (relay.ts). A signature
 * over anything else is refused before the relayer is touched (M10).
 */
const route = handle('account/relay', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const action = parseAction(body);
  if (action === null) return refuse(400, 'Invalid action.');
  // Which of the participant's own two accounts (A10). Never an address.
  const role: AccountRole | null = body.role === 'CREATOR' ? 'CREATOR' : null;

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'account/relay' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  try {
    if (body.signature === undefined) {
      const prepared = await prepareAction(session.participantId, action, role);
      return ok({
        safeTxHash: prepared.hash,
        nonce: prepared.tx.nonce.toString(),
        deployed: prepared.state.deployed,
      });
    }

    // The account's nonce as prepare returned it. Zero is the first transaction,
    // which parseUint256 (positive values only) would refuse.
    const nonce = typeof body.nonce === 'string' && /^\d{1,20}$/.test(body.nonce) ? BigInt(body.nonce) : null;
    const credentialId = parseCredentialId(body.credentialId);
    const authenticatorData = parseHexBytes(body.authenticatorData, 512);
    const clientDataJSON = parseClientDataJson(body.clientDataJSON);
    const signature = parseHexBytes(body.signature, 80);
    if (nonce === null || credentialId === null || authenticatorData === null || clientDataJSON === null || signature === null) {
      return refuse(400, 'Invalid signature.');
    }

    const submitted = await submitAction(
      session.participantId,
      action,
      role,
      nonce,
      { credentialId, authenticatorData, clientDataJSON, signature },
      log,
    );
    return ok({
      txHash: submitted.txHash,
      status: submitted.receipt === null ? 'PENDING' : submitted.receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED',
      giveawayId: submitted.giveawayId === null ? null : submitted.giveawayId.toString(),
    });
  } catch (error) {
    if (error instanceof RelayRefusal) {
      await log.event('account.refused', { reason: error.reason });
      return refuse(error.reason === 'bad_signature' ? 401 : 409, REFUSALS[error.reason] ?? 'This action cannot be done now.');
    }
    if (error instanceof ChainError) {
      await log.event('account.refused', { reason: error.code });
      return refuse(503, 'The network cannot take this right now. Try again shortly.');
    }
    throw error;
  }
});

/** What the page is told, per refusal. The participant's own account, so the reason is theirs to know. */
const REFUSALS: Record<string, string> = {
  no_account: 'Create your passkey first.',
  no_entry: 'No entry of yours for this event.',
  not_eligible_yet: 'Your place is not ready to confirm yet.',
  nothing_to_claim: 'There is nothing to claim.',
  nothing_to_transfer: 'There is nothing to send.',
  no_campaign: 'No campaign waiting for your signature.',
  deposit_missing: 'The deposit has not arrived at your account yet.',
  unknown_passkey: 'This passkey is not registered to your account.',
  already_owner: 'This passkey already has access.',
  owner_count: 'An account can have two passkeys at most.',
  no_recovery: 'There is no change of access to cancel.',
  not_deployed: 'Your account does not exist yet.',
  stale_nonce: 'Your account moved on. Sign again.',
  bad_signature: 'That signature is not valid for this request.',
  not_owner: 'This passkey has no access to this account.',
  relayer_unavailable: 'The bridge cannot send this right now. Try again shortly.',
  configuration_incomplete: 'Your account needs to finish its setup first. Confirm it with your passkey.',
  already_configured: 'Your account is already set up.',
  destination_not_ready: 'That account is not set up yet and cannot receive anything.',
  amount: 'That amount cannot be sent.',
  guardian_change_limit: 'Recovery settings were changed too often today. Try again tomorrow.',
};

/** The Action a body names, or null. A closed list, like the union it builds. */
function parseAction(body: Record<string, unknown>): Action | null {
  switch (body.kind) {
    case 'enter':
    case 'claim': {
      const giveawayId = parseGiveawayId(body.giveawayId);
      return giveawayId === null ? null : { kind: body.kind, giveawayId };
    }
    case 'transfer': {
      // C7: the amount is the participant's, stated; there is no "everything".
      const giveawayId = parseGiveawayId(body.giveawayId);
      const to = parseAddress(body.to);
      const amount = parseUint256(body.amount);
      return giveawayId === null || to === null || amount === null ? null : { kind: 'transfer', giveawayId, to, amount };
    }
    case 'addPasskey': {
      const credentialId = parseCredentialId(body.newCredentialId);
      return credentialId === null ? null : { kind: 'addPasskey', credentialId };
    }
    case 'createCampaign':
    case 'cancelRecovery':
    case 'revokeGuardian':
    case 'configure':
      return { kind: body.kind };
    default:
      return null;
  }
}

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
