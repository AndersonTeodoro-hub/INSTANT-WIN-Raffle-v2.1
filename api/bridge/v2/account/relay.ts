import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import {
  parseAddress,
  parseClientDataJson,
  parseCredentialId,
  parseGiveawayId,
  parseHexBytes,
  parseIntInRange,
  parseUint256,
} from '../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { runDeadline } from '../../../../lib/bridge-v2/runlock.js';
import { ChainError } from '../../../../lib/bridge-v2/chain.js';
import { prepareAction, RelayRefusal, submitAction, summaryJson, withTokenMeta, type Action, type OfferTerms } from '../../../../lib/bridge-v2/relay.js';
import { OrderMode } from '../../../../lib/bridge-v2/abi.js';
import { encodeRegions } from '../../../../lib/bridge-v2/orders.js';
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
  // SPEC-BLOCO-03 Adenda F7: the route's own budget, from the moment the request
  // arrived. Its stages add up past the platform's ceiling, so the part that
  // cannot be taken back starts only when it fits (relay.ts, RELAY_SEND_MS).
  const deadline = runDeadline();
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
        // SPEC-BLOCO-03 C12 and T2: what the transaction does, computed here, shown by the page before the passkey;
        // V4: a token other than USDC with its own decimals and symbol.
        summary: summaryJson(await withTokenMeta(prepared.summary)),
        // SPEC-BLOCO-03 H7: the redemption attestation's deadline, which the submit sends back.
        ...(prepared.redeemDeadline === null ? {} : { deadline: prepared.redeemDeadline.toString() }),
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
      deadline,
    );
    return ok({
      txHash: submitted.txHash,
      status: submitted.receipt === null ? 'PENDING' : submitted.receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED',
      giveawayId: submitted.giveawayId === null ? null : submitted.giveawayId.toString(),
      orderId: submitted.orderId === null ? null : submitted.orderId.toString(),
      // SPEC-BLOCO-03 T5: the offer or the obligation this created, and the obligation's vouchers.
      termsId: submitted.created?.termsId == null ? null : submitted.created.termsId.toString(),
      obligationId: submitted.created?.obligationId == null ? null : submitted.created.obligationId.toString(),
      voucherIds: (submitted.created?.voucherIds ?? []).map(String),
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
  destination: 'Choose an address other than this account.',
  // SPEC-BLOCO-03 V5 (B11).
  platform_destination: 'That address is a contract of the platform. USDC sent there would not come back; choose another address.',
  destination_unchecked: 'The destination cannot be checked right now. Try again shortly.',
  amount: 'That amount cannot be sent.',
  guardian_change_limit: 'Recovery settings were changed too often today. Try again tomorrow.',
  guardian_incident: 'Recovery cannot be set up while its key is being replaced. Try again later.',
  relay_limit: 'Your account reached its limit of transactions for the last 24 hours. Try again later.',
  campaign_in_flight: 'This campaign was already sent. Wait for it to be confirmed.',
  // SPEC-BLOCO-03 piece 5.
  orders_not_configured: 'Orders are not available yet.',
  unknown_action: 'Invalid action.',
  no_offer: 'This offer is not available.',
  no_address: 'Add a delivery address for this first.',
  code_commit: 'The delivery code does not match how this is delivered.',
  no_voucher: 'This voucher cannot be used from your account.',
  voucher_expired: 'This voucher can no longer be redeemed.',
  stale_attestation: 'This request expired. Prepare it again.',
  no_order: 'No order of yours with that number.',
  order_state: 'This cannot be done at this stage of the order.',
  terms: 'Those conditions are not allowed.',
  no_tracking: 'Register the tracking number first.',
  code: 'That delivery code does not match this order.',
  brand_blocked: 'Your brand cannot create obligations right now.',
  no_obligation: 'No obligation of yours with that number.',
  phone_required: 'Verify your phone first.',
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
    case 'transferUsdc': {
      // SPEC-BLOCO-03 T12 (U17): from either account (`role`), the amount stated (C7).
      const to = parseAddress(body.to);
      const amount = parseUint256(body.amount);
      return to === null || amount === null ? null : { kind: 'transferUsdc', to, amount };
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
    // SPEC-BLOCO-03 piece 5, P1.
    case 'pay': {
      const termsId = parseUint256(body.termsId);
      const quantity = parseIntInRange(body.quantity, 1, 1_000_000);
      const codeCommit = parseBytes32(body.codeCommit ?? ZERO_HASH);
      return termsId === null || quantity === null || codeCommit === null ? null : { kind: 'pay', termsId, quantity, codeCommit };
    }
    case 'redeem': {
      const voucherId = parseUint256(body.voucherId);
      const codeCommit = parseBytes32(body.codeCommit ?? ZERO_HASH);
      const deadline = body.deadline === undefined ? null : parseUint256(body.deadline);
      if (voucherId === null || codeCommit === null || (body.deadline !== undefined && deadline === null)) return null;
      return { kind: 'redeem', voucherId, codeCommit, deadline };
    }
    case 'cancelOrder':
    case 'confirm':
    case 'contest':
    case 'ship':
    case 'declareDelivered':
    case 'declareRefusal': {
      const orderId = parseUint256(body.orderId);
      return orderId === null ? null : { kind: body.kind, orderId };
    }
    case 'deactivateOffer': {
      const termsId = parseUint256(body.termsId);
      return termsId === null ? null : { kind: 'deactivateOffer', termsId };
    }
    case 'submitCode': {
      const orderId = parseUint256(body.orderId);
      const code = parseBytes32(body.code);
      return orderId === null || code === null ? null : { kind: 'submitCode', orderId, code };
    }
    case 'refund': {
      const orderId = parseUint256(body.orderId);
      const amount = parseUint256(body.amount);
      return orderId === null || amount === null ? null : { kind: 'refund', orderId, amount };
    }
    case 'createOffer': {
      const terms = parseTerms(body);
      return terms === null ? null : { kind: 'createOffer', terms };
    }
    case 'createObligation': {
      const terms = parseTerms({ ...body, refusalFeeBps: 0, payout: '0x0000000000000000000000000000000000000001' });
      const units = parseIntInRange(body.units, 1, 1_000);
      return terms === null || units === null ? null : { kind: 'createObligation', terms, units };
    }
    case 'createVoucherCampaign': {
      const obligationId = parseUint256(body.obligationId);
      const voucherIds = Array.isArray(body.voucherIds) && body.voucherIds.length <= 100 ? body.voucherIds.map(parseUint256) : null;
      const durationSeconds = parseIntInRange(body.durationSeconds, 1, 10 ** 9);
      const slotCap = parseIntInRange(body.slotCap, 1, 10 ** 9);
      if (obligationId === null || voucherIds === null || voucherIds.some((id) => id === null) || durationSeconds === null || slotCap === null) return null;
      return { kind: 'createVoucherCampaign', obligationId, voucherIds: voucherIds as bigint[], durationSeconds, slotCap };
    }
    default:
      return null;
  }
}

const ZERO_HASH = `0x${'0'.repeat(64)}`;

/** A 32-byte value (a commitment, a delivery code), or null. Zero is a value: "none" by carrier (9.2). */
function parseBytes32(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value.toLowerCase() as `0x${string}`) : null;
}

/** An amount in USDC base units that may be zero (shipping, return cost), or null. */
function parseAmount(value: unknown): bigint | null {
  return typeof value === 'string' && /^\d{1,29}$/.test(value) ? BigInt(value) : null;
}

/** Section 7 from a body. The relay checks the ceilings (relay.ts checkTerms); this only reads. */
function parseTerms(body: Record<string, unknown>): OfferTerms | null {
  const payout = parseAddress(body.payout);
  const price = parseUint256(body.price);
  const shipping = parseAmount(body.shipping);
  const returnCost = parseAmount(body.returnCost);
  const refusalFeeBps = parseIntInRange(body.refusalFeeBps, 0, 10_000);
  const shipDays = parseIntInRange(body.shipDays, 1, 365);
  const deliveryDays = parseIntInRange(body.deliveryDays, 1, 365);
  const mode = body.mode === 'CARRIER' ? OrderMode.CARRIER : body.mode === 'OWN_MEANS' ? OrderMode.OWN_MEANS : null;
  const regions = encodeRegions(body.regions);
  if (payout === null || price === null || shipping === null || returnCost === null || refusalFeeBps === null) return null;
  if (shipDays === null || deliveryDays === null || mode === null || regions === null) return null;
  return { payout, price, shipping, returnCost, refusalFeeBps, shipDays, deliveryDays, mode, regions };
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
