/**
 * One action through the relay, as the page drives it. SPEC-BLOCO-03 6.2.2, C12, T2.
 *
 *   prepare  ->  show what it does  ->  the person confirms  ->  the passkey signs  ->  submit
 *
 * C12 and T2: what is shown — the action, the amounts and the destination — is the
 * summary the bridge computed while it built the transaction, returned with the
 * hash; the page formats it and computes none of it. The passkey is asked for only
 * after the person has seen it and said yes; saying no, or closing the passkey
 * prompt, sends nothing.
 *
 * A transaction that landed in between moves the account's nonce on, and the
 * bridge refuses the old signature (stale_nonce): the flow prepares again, shows
 * the new summary, and asks again — once.
 */

import { call, type Assertion, type BridgeFailure } from './api.js';
import { isCancelled } from './webauthn.js';

/** The body the relay reads for one action (account/relay.ts parseAction): its kind, its ids, and the role for the creator account. */
export type RelayAction = { readonly kind: string; readonly role?: 'CREATOR' } & Record<string, unknown>;

export type SummaryAmount =
  /** V4: `meta`, the decimals and symbol the bridge read from a token other than USDC; null when the token did not say. */
  | { readonly kind: 'ERC20'; readonly token: `0x${string}`; readonly value: string; readonly meta?: { readonly decimals: number; readonly symbol: string } | null }
  | { readonly kind: 'NFT'; readonly token: `0x${string}`; readonly tokenIds: readonly string[] }
  | { readonly kind: 'ITEMS'; readonly token: `0x${string}`; readonly count: string };

export type DestinationRole = 'ESCROW' | 'GUARANTEE' | 'GIVEAWAY' | 'THIS_ACCOUNT' | 'STORE' | 'RECIPIENT' | 'ADDRESS';

export interface ActionSummary {
  readonly action: string;
  readonly amounts: readonly SummaryAmount[];
  readonly destination: { readonly address: `0x${string}`; readonly role: DestinationRole } | null;
}

interface Prepared {
  readonly safeTxHash: `0x${string}`;
  readonly nonce: string;
  readonly deployed: boolean;
  readonly summary: ActionSummary;
  readonly deadline?: string;
}

export interface Relayed {
  readonly txHash: string;
  readonly status: 'CONFIRMED' | 'PENDING' | 'REVERTED';
  readonly giveawayId: string | null;
  readonly orderId: string | null;
  readonly termsId: string | null;
  readonly obligationId: string | null;
  readonly voucherIds: readonly string[];
}

export type RelayOutcome =
  | { readonly status: 'done'; readonly result: Relayed }
  | { readonly status: 'cancelled' }
  | { readonly status: 'refused'; readonly error: string; readonly code: number };

export interface RelayDeps {
  /** Shows the summary and resolves with the person's answer. Nothing is signed before it resolves true. */
  readonly confirm: (summary: ActionSummary) => Promise<boolean>;
  /** The passkey's signature over the hash (webauthn.signHash, bound to navigator.credentials). */
  readonly sign: (hash: `0x${string}`) => Promise<Assertion>;
}

/** The bridge's sentence for a signature over a transaction that no longer exists (account/relay.ts, stale_nonce). */
const STALE_NONCE = 'Your account moved on. Sign again.';

const refused = (failure: BridgeFailure): RelayOutcome => ({ status: 'refused', error: failure.error, code: failure.status });

export async function runAction(action: RelayAction, deps: RelayDeps, retries = 1): Promise<RelayOutcome> {
  const prepared = await call<Prepared>('account/relay', action);
  if (!prepared.ok) return refused(prepared);

  if (!(await deps.confirm(prepared.summary))) return { status: 'cancelled' };

  let assertion: Assertion;
  try {
    assertion = await deps.sign(prepared.safeTxHash);
  } catch (error) {
    if (isCancelled(error)) return { status: 'cancelled' };
    return { status: 'refused', error: error instanceof Error ? error.message : 'The passkey did not sign.', code: 0 };
  }

  const submitted = await call<Relayed>('account/relay', {
    ...action,
    // H7: the redemption attestation's deadline, echoed so both builds are the same bytes.
    ...(prepared.deadline === undefined ? {} : { deadline: prepared.deadline }),
    nonce: prepared.nonce,
    ...assertion,
  });
  if (submitted.ok) return { status: 'done', result: submitted };
  if (submitted.error === STALE_NONCE && retries > 0) return runAction(action, deps, retries - 1);
  return refused(submitted);
}
