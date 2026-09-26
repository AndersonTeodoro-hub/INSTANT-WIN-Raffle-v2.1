import { useMemo } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS } from '../../constants';
import { GIVEAWAY_MANAGER_V2_ABI, GiveawayV2Status } from '../../lib/giveaway-v2-abi';
import { uintHex } from '../../lib/proof/mark';
import { useRecentWinners } from '../RecentWinners';

/**
 * The latest settled draw on the platform, with the proof its mark is drawn from.
 *
 * No new kind of chain read: the lottery side is useRecentWinners (the same query
 * and cache as the "Recent winners" panel — PrizeAwarded logs, whose transaction
 * is the Chainlink VRF fulfilment that settled the round); the Event Center side
 * is lastGiveawayId, getGiveaway and getWinners, the reads the Event Center pages
 * make, over the last few campaigns only.
 */

export interface DrawWinner {
  readonly address: `0x${string}`;
  readonly rank: number;
  readonly amount?: bigint;
}

export interface SettledDraw {
  readonly kind: 'round' | 'campaign';
  readonly id: bigint;
  /** The VRF fulfilment transaction (round) or the VRF seed (campaign), as 32-byte hex. */
  readonly proof: `0x${string}`;
  readonly winners: readonly DrawWinner[];
  /** How many winners the draw had (a campaign's list is capped below). */
  readonly winnersCount: number;
  /** Seconds, when the chain said. */
  readonly settledAt?: number;
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
      const g = campaigns[i]?.result as { status: number; seed: bigint; winnersCount: number; settledAt: bigint } | undefined;
      if (g && g.status === GiveawayV2Status.SETTLED) return { id: ids[i], seed: g.seed, winnersCount: Number(g.winnersCount), settledAt: Number(g.settledAt) };
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
      kind: 'campaign',
      id: settled.id,
      proof: uintHex(settled.seed),
      winners: ((winners as readonly `0x${string}`[] | undefined) ?? []).map((address, index) => ({ address, rank: index + 1 })),
      winnersCount: settled.winnersCount,
      settledAt: settled.settledAt || undefined,
    };
  }, [settled, winners]);

  const loading = enabled && (idLoading || campaignsLoading || (settled !== null && winnersLoading));
  return { draw, loading };
}

export function useLatestRoundDraw(): { draw: SettledDraw | null; loading: boolean } {
  const { data, isLoading } = useRecentWinners();
  const draw = useMemo((): SettledDraw | null => {
    const first = data?.[0];
    if (!first) return null;
    const round = data!.filter((w) => w.roundId === first.roundId).sort((a, b) => a.rank - b.rank);
    return {
      kind: 'round',
      id: first.roundId,
      proof: first.txHash,
      winners: round.map((w) => ({ address: w.winner, rank: w.rank, amount: w.amount })),
      winnersCount: round.length,
      settledAt: first.timestamp,
    };
  }, [data]);
  return { draw, loading: isLoading };
}

/** The newest of the two, and each side on its own (the landing shows both modules). */
export function useLatestDraw() {
  const round = useLatestRoundDraw();
  const campaign = useLatestCampaignDraw();
  const latest =
    round.draw && campaign.draw
      ? (campaign.draw.settledAt ?? 0) > (round.draw.settledAt ?? 0)
        ? campaign.draw
        : round.draw
      : (round.draw ?? campaign.draw);
  return { latest, round: round.draw, campaign: campaign.draw, loading: round.loading || campaign.loading };
}
