import { useEffect, useState } from 'react';
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
import { offerDescription, type Description } from '../../lib/keptra/api';

/*
 * The chain reads the Keptra screens share. T0: every figure shown is one of
 * these, or a bridge answer — never a number computed on the page.
 */

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

/** Section 7: an offer's or an obligation's conditions, its countries, and the escrow's fee and pause. */
export function useTerms(termsId: bigint | null) {
  const enabled = termsId !== null && keptraConfigured();
  const result = useReadContracts({
    contracts: [
      { address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'getTerms', args: [termsId ?? 0n] },
      { address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'regionsOf', args: [termsId ?? 0n] },
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'feeBps' },
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'paused' },
    ],
    query: { enabled },
  });
  const [terms, regions, fee, paused] = result.data ?? [];
  const found = terms?.status === 'success' ? (terms.result as unknown as TermsRead) : null;
  return {
    loading: enabled && result.isLoading,
    error: result.isError || terms?.status === 'failure',
    terms: found !== null && found.store !== '0x0000000000000000000000000000000000000000' ? found : null,
    regions: regions?.status === 'success' ? decodeRegions(regions.result as string) : [],
    feeBps: fee?.status === 'success' ? Number(fee.result) : null,
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
  return { loading: enabled && result.isLoading, order: (result.data as unknown as OrderRead | undefined) ?? null, refetch: result.refetch };
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
  return { balance: (result.data as bigint | undefined) ?? null, refetch: result.refetch };
}

/** T4: the product description behind an offer or an obligation, from the bridge. */
export function useDescription(termsId: string | null) {
  const [state, setState] = useState<{ loading: boolean; description: Description | null; missing: boolean }>({ loading: termsId !== null, description: null, missing: false });
  useEffect(() => {
    if (termsId === null || !keptraConfigured()) {
      setState({ loading: false, description: null, missing: false });
      return;
    }
    let live = true;
    setState((current) => ({ ...current, loading: true }));
    void offerDescription(termsId).then((result) => {
      if (!live) return;
      setState({ loading: false, description: result.ok ? result : null, missing: !result.ok && result.status === 404 });
    });
    return () => {
      live = false;
    };
  }, [termsId]);
  return state;
}
