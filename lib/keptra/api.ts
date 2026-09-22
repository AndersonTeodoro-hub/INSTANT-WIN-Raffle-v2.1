/**
 * The Keptra pages' client of the bridge (api/bridge/v2/*).
 *
 * One call(): every route answers the same envelope ({ok:true,...} or
 * {ok:false,error}), the session is an HttpOnly cookie the browser carries
 * (credentials: 'include'), and nothing goes in a query string (D4). The fetch
 * is replaceable so the tests drive the real routes in the same process (T8).
 *
 * Every number the pages show comes from here or from the chain (T0): the bridge
 * sends amounts and ids as strings, and they stay strings until they are shown.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Tests only: route every call through `impl` (the real route handlers, in process). */
export function setFetch(impl: FetchLike): void {
  fetchImpl = impl;
}

export interface BridgeFailure {
  readonly ok: false;
  /** The bridge's sentence for the person, or ours when there was no answer. */
  readonly error: string;
  readonly status: number;
  /** Anything else the refusal carried (T13's `left`). */
  readonly data: Record<string, unknown>;
}

export type BridgeResult<T> = ({ readonly ok: true } & T) | BridgeFailure;

export async function call<T>(path: string, body: Record<string, unknown> = {}): Promise<BridgeResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/bridge/v2/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'The network did not answer. Check your connection and try again.', status: 0, data: {} };
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (json === null) return { ok: false, error: 'The service answered in a way this page does not understand. Try again shortly.', status: response.status, data: {} };
  if (json.ok !== true) {
    return {
      ok: false,
      error: typeof json.error === 'string' ? json.error : 'Something went wrong. Try again shortly.',
      status: response.status,
      data: json,
    };
  }
  return json as { ok: true } & T;
}

// ---------------------------------------------------------------------------
// session (SPEC-BRIDGE-V2 A1)
// ---------------------------------------------------------------------------

export const requestCode = (email: string) => call<Record<string, never>>('session/request-code', { email });
export const verifyCode = (email: string, code: string) => call<Record<string, never>>('session/verify', { email, code });
export const signOut = () => call<Record<string, never>>('session/revoke');

// ---------------------------------------------------------------------------
// the account (6, T3)
// ---------------------------------------------------------------------------

export type Role = 'PARTICIPANT' | 'CREATOR';
export type MigrationState = 'NONE' | 'PENDING' | 'AUTHORIZED' | 'DONE';

export interface AccountView {
  readonly role: Role;
  /** C4: null until the account exists on-chain with its configuration. */
  readonly address: `0x${string}` | null;
  readonly deployed: boolean;
  readonly configured: boolean;
  readonly recoveryEnabled: boolean;
  /** 6.3.3: a change of access pending on-chain, and when it takes effect. */
  readonly recoveryPendingUntil: string | null;
}

export interface AccountStatus {
  readonly email: string | null;
  readonly phoneVerified: boolean;
  readonly passkeys: readonly string[];
  readonly accounts: readonly AccountView[];
  readonly recovery: { readonly status: string; readonly executeAfter: string | null } | null;
  readonly migration: { readonly PARTICIPANT: MigrationState; readonly CREATOR: MigrationState };
}

export const accountStatus = () => call<AccountStatus>('account/status');

export const registerPasskey = (key: { x: string; y: string; credentialId: string }) =>
  call<{ signer: string; accounts: readonly Omit<AccountView, 'recoveryPendingUntil'>[] }>('account/register', key);

export interface VoucherHeld {
  readonly voucherId: string;
  readonly role: Role;
  readonly obligationId: string;
  readonly giveawayId: string | null;
  readonly claimedAt: string | null;
  readonly redeemBy: string | null;
}

export const accountVouchers = () => call<{ vouchers: readonly VoucherHeld[]; complete: boolean }>('account/vouchers');

export interface Assertion {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
}

export const migrationChallenge = (kind: Role) => call<{ challenge: `0x${string}` }>('account/migrate', { kind });
export const authorizeMigration = (kind: Role, assertion: Assertion) =>
  call<{ status: 'AUTHORIZED' | 'ALREADY' }>('account/migrate', { kind, ...assertion });

// ---------------------------------------------------------------------------
// orders, offers, vouchers (sections 7 to 11, T4, T5)
// ---------------------------------------------------------------------------

export interface PublicOrder {
  readonly orderId: string;
  readonly termsId: string;
  readonly voucherId: string | null;
  readonly store: `0x${string}`;
  readonly mode: 'CARRIER' | 'OWN_MEANS';
  readonly prize: boolean;
  readonly state: number;
  readonly flags: number;
  readonly shipBy: string;
  readonly deliverBy: string | null;
  readonly windowEndsAt: string | null;
  readonly contestedAt: string | null;
  readonly outcome: number | null;
}

export interface PostalAddress {
  readonly name: string;
  readonly street: string;
  readonly postCode: string;
  readonly city: string;
  readonly country: string;
  readonly phone: string | null;
}

export const myOrders = () => call<{ orders: readonly (PublicOrder & { hasAddress: boolean })[] }>('order/list');

export const registerAddress = (purpose: { termsId: string } | { voucherId: string }, address: PostalAddress) =>
  call<{ registered: true }>('order/address', { ...purpose, ...address, phone: address.phone ?? undefined });

export interface Evidence {
  readonly recipient: string | null;
  readonly store: string | null;
  readonly document: string;
}
export const orderEvidence = (orderId: string, text?: string) =>
  call<Evidence>('order/evidence', text === undefined ? { orderId } : { orderId, text });

export const storeOrders = () => call<{ orders: readonly (PublicOrder & { address: PostalAddress | null })[] }>('store/orders');
export const registerTracking = (orderId: string, trackingNumber: string) =>
  call<{ trackingHash: string; tracked: boolean }>('store/tracking', { orderId, trackingNumber });

export interface OfferListed {
  readonly termsId: string;
  readonly obligationId: string | null;
  readonly title: string;
  readonly createdAt: string;
}
export const myOffers = () => call<{ offers: readonly OfferListed[] }>('store/offers');

export interface Description {
  readonly termsId: string;
  readonly title: string;
  readonly text: string;
  readonly obligationId: string | null;
  readonly createdAt: string;
}
export const offerDescription = (termsId: string) => call<Description>('offer/description', { termsId });
export const writeDescription = (entry: { termsId: string; obligationId?: string; title: string; text: string }) =>
  call<{ written: true }>('store/description', entry);

// ---------------------------------------------------------------------------
// privacy (SPEC-BRIDGE-V2 D7, T13)
// ---------------------------------------------------------------------------

export const privacyExport = () => call<Record<string, unknown>>('privacy/export');

export interface ErasureDone {
  readonly erased: true;
  readonly addressesErased: number;
  readonly addressesDeferred: number;
  readonly deferredNote?: string;
}
export const privacyErase = () => call<ErasureDone>('privacy/erase');
