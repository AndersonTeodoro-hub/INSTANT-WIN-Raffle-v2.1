import { useCallback, useEffect, useState } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import {
  ERC20_ABI,
  ESCROW_READ_ABI,
  KEPTRA_ESCROW,
  KEPTRA_ESCROW_ABI,
  REPUTATION_READ_ABI,
  USDC,
  keptraConfigured,
} from '../../lib/keptra/contracts';
import { decodeRegions } from '../../lib/keptra/format';
import { offerDescription, type BridgeResult, type Description } from '../../lib/keptra/api';
import { LOADING, chainFailed, fromBridge, reverted, type Read } from '../../lib/keptra/reads';

/*
 * The chain reads the Keptra screens share. T0: every figure shown is one of
 * these, or a bridge answer — never a number computed on the page. V3: each says
 * when it failed and how to read it again, and a screen shows that as an error
 * with "Try again", never as nothing there.
 */

/**
 * V3: one bridge read, as a Read. `retry` after a failure shows the loading state
 * again; `reload` after an action keeps what is shown until the new answer lands.
 */
export function useBridgeRead<T>(load: () => Promise<BridgeResult<T>>, deps: readonly unknown[]) {
  const [read, setRead] = useState<Read<{ readonly ok: true } & T>>(LOADING);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void load().then((result) => {
      if (live) setRead(fromBridge(result));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const retry = useCallback(() => {
    setRead(LOADING);
    setAttempt((n) => n + 1);
  }, []);
  return { read, retry, reload };
}

export interface TermsRead {
  readonly store: `0x${string}`;
  readonly price: bigint;
  readonly payout: `0x${string}`;
  readonly shipping: bigint;
  readonly returnCost: bigint;
  readonly refusalFeeBps: number;
  readonly shipDays: number;
  readonly deliveryDays: number;
  readonly mode: number;
  readonly prize: boolean;
  readonly active: boolean;
}

/** Section 7: an offer's or an obligation's conditions, its countries, and the escrow's pause. */
export function useTerms(termsId: bigint | null) {
  const enabled = termsId !== null && keptraConfigured();
  const result = useReadContracts({
    contracts: [
      { address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'getTerms', args: [termsId ?? 0n] },
      { address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'regionsOf', args: [termsId ?? 0n] },
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'paused' },
    ],
    query: { enabled },
  });
  const [terms, regions, paused] = result.data ?? [];
  const found = terms?.status === 'success' ? (terms.result as unknown as TermsRead) : null;
  // An id the escrow never issued reverts: the chain's answer is that there is no such offer.
  const unknownId = terms?.status === 'failure' && reverted(terms.error);
  return {
    loading: enabled && result.isLoading,
    failed: enabled && !unknownId && chainFailed(result),
    retry: () => void result.refetch(),
    terms: found !== null && found.store !== '0x0000000000000000000000000000000000000000' ? found : null,
    regions: regions?.status === 'success' ? decodeRegions(regions.result as string) : [],
    paused: paused?.status === 'success' ? (paused.result as boolean) : null,
  };
}

export interface OrderRead {
  readonly termsId: bigint;
  readonly quantity: number;
  readonly state: number;
  readonly flags: number;
  readonly feeBps: number;
  readonly payer: `0x${string}`;
  readonly paid: bigint;
  readonly paidAt: bigint;
  readonly shippedAt: bigint;
  readonly windowEndsAt: bigint;
  readonly contestedAt: bigint;
  readonly voucherId: bigint;
  readonly codeCommit: `0x${string}`;
}

/** One order as the escrow holds it: what it holds (paid), its commitment (9.2), its clocks. */
export function useOrderOnChain(orderId: bigint | null) {
  const enabled = orderId !== null && keptraConfigured();
  const result = useReadContract({
    address: KEPTRA_ESCROW,
    abi: KEPTRA_ESCROW_ABI,
    functionName: 'getOrder',
    args: [orderId ?? 0n],
    query: { enabled, refetchInterval: 15_000 },
  });
  return {
    loading: enabled && result.isLoading,
    failed: enabled && result.isError,
    order: (result.data as unknown as OrderRead | undefined) ?? null,
    refetch: result.refetch,
  };
}

/** T15: the store's tier, from the reputation contract the escrow names. */
export function useTier(store: `0x${string}` | null) {
  const reputation = useReadContract({
    address: KEPTRA_ESCROW,
    abi: ESCROW_READ_ABI,
    functionName: 'reputation',
    query: { enabled: store !== null && keptraConfigured() },
  });
  const tier = useReadContracts({
    contracts: [
      { address: (reputation.data ?? KEPTRA_ESCROW) as `0x${string}`, abi: REPUTATION_READ_ABI, functionName: 'tierOf', args: [store ?? KEPTRA_ESCROW] },
      { address: (reputation.data ?? KEPTRA_ESCROW) as `0x${string}`, abi: REPUTATION_READ_ABI, functionName: 'countersOf', args: [store ?? KEPTRA_ESCROW] },
    ],
    query: { enabled: store !== null && reputation.data !== undefined },
  });
  const [tierOf, counters] = tier.data ?? [];
  const c = counters?.status === 'success' ? (counters.result as readonly [number, number, number, number, number, number, boolean]) : null;
  return {
    failed: store !== null && (reputation.isError || chainFailed(tier)),
    retry: () => void (reputation.isError ? reputation.refetch() : tier.refetch()),
    tier: tierOf?.status === 'success' ? Number(tierOf.result) : null,
    delivered: c === null ? null : Number(c[0]),
    materialFailures: c === null ? null : Number(c[2]),
  };
}

/** USDC an account holds, for the account page and the checkout (the ramp is out, P8). */
export function useUsdcBalance(address: `0x${string}` | null) {
  const result = useReadContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address ?? USDC],
    query: { enabled: address !== null, refetchInterval: 20_000 },
  });
  return { balance: (result.data as bigint | undefined) ?? null, failed: address !== null && result.isError, refetch: result.refetch };
}

/**
 * T4: the product description behind an offer or an obligation, from the bridge.
 * `missing` is the bridge's answer that none was written (404) — a fact, which the
 * page may state; `failed` is a read that did not work (V3), which it may not.
 */
export function useDescription(termsId: string | null) {
  const enabled = termsId !== null && keptraConfigured();
  const [state, setState] = useState<{ loading: boolean; description: Description | null; missing: boolean; failed: string | null }>({
    loading: enabled,
    description: null,
    missing: false,
    failed: null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || termsId === null) {
      setState({ loading: false, description: null, missing: false, failed: null });
      return;
    }
    let live = true;
    setState((current) => ({ ...current, loading: true, failed: null }));
    void offerDescription(termsId).then((result) => {
      if (!live) return;
      const missing = !result.ok && result.status === 404;
      setState({ loading: false, description: result.ok ? result : null, missing, failed: result.ok || missing ? null : result.error });
    });
    return () => {
      live = false;
    };
  }, [termsId, enabled, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
