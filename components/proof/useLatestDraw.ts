import { useMemo } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS } from '../../constants';
import { GIVEAWAY_MANAGER_V2_ABI, GiveawayV2Status } from '../../lib/giveaway-v2-abi';
import { uintHex } from '../../lib/proof/mark';

/**
 * The latest settled draw on the platform — a GiveawayManagerV2 campaign (Giveaways
 * and the Event Center) — with the proof its mark is drawn from: the campaign's
 * Chainlink VRF seed.
 *
 * No new kind of chain read: lastGiveawayId, getGiveaway and getWinners, the reads
 * the Event Center pages make, over the last few campaigns only.
 */

export interface DrawWinner {
  readonly address: `0x${string}`;
  readonly rank: number;
}

export interface SettledDraw {
  readonly id: bigint;
  /** The campaign's VRF seed, as 32-byte hex. */
  readonly proof: `0x${string}`;
  readonly winners: readonly DrawWinner[];
  /** How many winners the draw had (a campaign's list is capped below). */
  readonly winnersCount: number;
}

/** Campaigns looked at, newest first, to find the latest settled one. */
const CAMPAIGNS_SCANNED = 8;
/** Winners read for the page; the mark lights one strand per winner up to 12. */
const WINNERS_READ = 12;

export function useLatestCampaignDraw(enabled = true): { draw: SettledDraw | null; loading: boolean } {
  const { data: lastId, isLoading: idLoading } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'lastGiveawayId',
    query: { enabled, staleTime: 60_000 },
  });
  const ids = useMemo(() => {
    const out: bigint[] = [];
    for (let id = (lastId as bigint | undefined) ?? 0n; id >= 1n && out.length < CAMPAIGNS_SCANNED; id--) out.push(id);
    return out;
  }, [lastId]);
  const { data: campaigns, isLoading: campaignsLoading } = useReadContracts({
    contracts: ids.map((id) => ({ address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'getGiveaway' as const, args: [id] as const })),
    query: { enabled: enabled && ids.length > 0, staleTime: 60_000 },
  });
  const settled = useMemo(() => {
    if (!campaigns) return null;
    for (let i = 0; i < ids.length; i++) {
      const g = campaigns[i]?.result as { status: number; seed: bigint; winnersCount: number } | undefined;
      if (g && g.status === GiveawayV2Status.SETTLED) return { id: ids[i], seed: g.seed, winnersCount: Number(g.winnersCount) };
    }
    return null;
  }, [campaigns, ids]);
  const { data: winners, isLoading: winnersLoading } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getWinners',
    args: settled ? [settled.id, 0n, BigInt(Math.min(settled.winnersCount, WINNERS_READ))] : undefined,
    query: { enabled: enabled && settled !== null, staleTime: 60_000 },
  });

  const draw = useMemo((): SettledDraw | null => {
    if (!settled) return null;
    return {
      id: settled.id,
      proof: uintHex(settled.seed),
      winners: ((winners as readonly `0x${string}`[] | undefined) ?? []).map((address, index) => ({ address, rank: index + 1 })),
      winnersCount: settled.winnersCount,
    };
  }, [settled, winners]);

  const loading = enabled && (idLoading || campaignsLoading || (settled !== null && winnersLoading));
  return { draw, loading };
}
