/**
 * A read the Keptra pages show, from the bridge or the chain. SPEC-BLOCO-03 V3.
 *
 * Three states and no fourth: still loading, failed, or read. A read that failed
 * is an error the page shows with "Try again" — never an empty list, and never a
 * sentence that states a fact nobody read ("No order", "No provider"). The screens
 * decide from this, so a refusal cannot slip into a list as `[]`.
 */

import type { BridgeResult } from './api.js';

export type Read<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: string }
  | { readonly status: 'ready'; readonly value: T };

export const LOADING: Read<never> = { status: 'loading' };

/** What the page says when a chain read fails: the chain did not answer, so nothing is claimed about it. */
export const CHAIN_FAILED = 'The Arbitrum One network did not answer.';

/** A bridge answer as a read: its refusal is the error, with the bridge's own sentence. */
export function fromBridge<T>(result: BridgeResult<T>): Read<{ readonly ok: true } & T> {
  return result.ok ? { status: 'ready', value: result } : { status: 'failed', error: result.error };
}

/** One wagmi query, single or batched, and whether it is done. */
export interface ChainQuery {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data?: unknown;
}

/** A batch fails when the query failed or any one call in it did (wagmi keeps a per-call status). */
export function chainFailed(query: ChainQuery): boolean {
  if (query.isError) return true;
  return Array.isArray(query.data) && query.data.some((item) => (item as { status?: string } | null)?.status === 'failure');
}

/**
 * Whether a call failed because the contract reverted — an answer, not a failed
 * read: KeptraEscrow.getTerms reverts for an id it never issued (an array read out
 * of range), which says there is no such offer. viem nests the revert under the
 * error it throws; a node that did not answer has none.
 */
export function reverted(error: unknown): boolean {
  for (let at = error as { name?: string; cause?: unknown } | null | undefined, depth = 0; at && depth < 8; at = at.cause as typeof at, depth += 1) {
    if (at.name === 'ContractFunctionRevertedError') return true;
  }
  return false;
}

/** Several chain queries behind one figure or one card: loading while any loads, failed when any failed. */
export function chainRead<T>(queries: readonly ChainQuery[], value: () => T): Read<T> {
  if (queries.some(chainFailed)) return { status: 'failed', error: CHAIN_FAILED };
  if (queries.some((query) => query.isLoading)) return LOADING;
  return { status: 'ready', value: value() };
}
