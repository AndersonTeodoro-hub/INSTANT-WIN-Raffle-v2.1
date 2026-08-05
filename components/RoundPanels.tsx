import React, { useEffect, useMemo } from 'react';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import { CONTRACTS, RAFFLE_ABI, RAFFLE_DEPLOY_BLOCK, RoundState, PRIZE_AWARDED_EVENT } from '../constants';
import { Button } from './Button';
import { Gift, Undo2, Trophy, Dices, Ban } from 'lucide-react';

const TICKET_PRICE = 1_000_000n;

// ponytail: procura refunds só nas últimas 10 rondas (1 multicall, ~5h de histórico).
// Rondas mais antigas continuam reclamáveis on-chain via claimRefund(roundId) directo.
const REFUND_WINDOW = 10;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usdc = (v: bigint) => formatUnits(v, 6);

// ============================================================
// Claim: prémios (pull-payment) + refunds de rondas canceladas
// ============================================================
export const ClaimPanel: React.FC<{ currentRoundId?: bigint }> = ({ currentRoundId }) => {
  const { address, isConnected } = useAccount();

  const { data: claimable, refetch: refetchClaimable } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'claimable',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15000 },
  });

  const ids = useMemo(() => {
    if (!currentRoundId) return [] as bigint[];
    const out: bigint[] = [];
    for (let i = 1n; i <= BigInt(REFUND_WINDOW); i++) {
      const id = currentRoundId - i;
      if (id >= 1n) out.push(id);
    }
    return out;
  }, [currentRoundId]);

  const { data: scan, refetch: refetchScan } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: CONTRACTS.RAFFLE_MANAGER, abi: RAFFLE_ABI, functionName: 'rounds', args: [id] },
      { address: CONTRACTS.RAFFLE_MANAGER, abi: RAFFLE_ABI, functionName: 'ticketsOf', args: [id, address!] },
      { address: CONTRACTS.RAFFLE_MANAGER, abi: RAFFLE_ABI, functionName: 'refunded', args: [id, address!] },
    ]),
    query: { enabled: !!address && ids.length > 0, refetchInterval: 15000 },
  });

  const refundables = useMemo(() => {
    if (!scan) return [] as { id: bigint; amount: bigint }[];
    const out: { id: bigint; amount: bigint }[] = [];
    ids.forEach((id, i) => {
      const round = scan[i * 3]?.result as readonly [number, number, number, bigint, bigint] | undefined;
      const tickets = scan[i * 3 + 1]?.result as bigint | undefined;
      const done = scan[i * 3 + 2]?.result as boolean | undefined;
      if (!round || tickets === undefined || done === undefined) return;
      if (round[0] === RoundState.CANCELLED && tickets > 0n && !done) {
        out.push({ id, amount: tickets * TICKET_PRICE });
      }
    });
    return out;
  }, [scan, ids]);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      refetchClaimable();
      refetchScan();
    }
  }, [isSuccess, refetchClaimable, refetchScan]);

  if (!isConnected) return null;

  const prize = (claimable as bigint | undefined) ?? 0n;
  const busy = isPending || confirming;

  return (
    <div className="bg-dark-card border border-dark-border rounded-3xl p-8">
      <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
        <Gift className="w-5 h-5 text-brand" /> Your Winnings
      </h3>

      <div className="bg-dark-input rounded-2xl p-6 border border-dark-border mb-4">
        <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1">Claimable</p>
        <p className="text-4xl font-bold text-white font-mono">
          {usdc(prize)} <span className="text-lg text-gray-600 font-normal">USDC</span>
        </p>
      </div>

      <Button
        variant="success"
        className="w-full py-4"
        disabled={prize === 0n || busy}
        isLoading={busy}
        onClick={() =>
          writeContract({
            address: CONTRACTS.RAFFLE_MANAGER,
            abi: RAFFLE_ABI,
            functionName: 'claim',
          })
        }
      >
        {prize === 0n ? 'Nothing to Claim' : `Claim ${usdc(prize)} USDC`}
      </Button>

      {refundables.length > 0 && (
        <div className="mt-6 space-y-3">
          <p className="text-xs text-gray-500 font-bold uppercase tracking-wider flex items-center gap-2">
            <Undo2 className="w-3 h-3" /> Refunds (cancelled rounds)
          </p>
          {refundables.map((r) => (
            <div
              key={r.id.toString()}
              className="flex items-center justify-between gap-3 bg-dark-input rounded-xl p-3 border border-dark-border"
            >
              <div>
                <p className="text-xs text-gray-500 font-bold uppercase">Round #{r.id.toString()}</p>
                <p className="text-white font-mono font-bold">{usdc(r.amount)} USDC</p>
              </div>
              <Button
                variant="outline"
                className="px-4 py-2 text-sm"
                disabled={busy}
                onClick={() =>
                  writeContract({
                    address: CONTRACTS.RAFFLE_MANAGER,
                    abi: RAFFLE_ABI,
                    functionName: 'claimRefund',
                    args: [r.id],
                  })
                }
              >
                Refund
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Ronda anterior: DRAWING / SETTLED (+vencedores) / CANCELLED
// A ronda corrente abre logo no fecho da anterior, por isso os
// estados não-OPEN vivem sempre em currentRoundId - 1.
// ============================================================
export const PreviousRound: React.FC<{ currentRoundId?: bigint }> = ({ currentRoundId }) => {
  const prevId = currentRoundId && currentRoundId > 1n ? currentRoundId - 1n : undefined;

  const { data: round } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'rounds',
    args: prevId ? [prevId] : undefined,
    query: { enabled: !!prevId, refetchInterval: 10000 },
  });

  const state = round?.[0];
  const pool = round?.[4] ?? 0n;
  const client = usePublicClient();

  const { data: winners } = useQuery({
    queryKey: ['prizeAwarded', prevId?.toString()],
    enabled: !!client && !!prevId && state === RoundState.SETTLED,
    retry: false,
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      // ponytail: janela de 100k blocos (~7h em Arbitrum) cobre a ronda anterior de 30 min.
      const window = 100_000n;
      const from = latest > window && latest - window > RAFFLE_DEPLOY_BLOCK ? latest - window : RAFFLE_DEPLOY_BLOCK;
      const logs = await client!.getLogs({
        address: CONTRACTS.RAFFLE_MANAGER,
        event: PRIZE_AWARDED_EVENT,
        args: { roundId: prevId },
        fromBlock: from,
        toBlock: latest,
      });
      return logs
        .map((l) => ({
          winner: l.args.winner as `0x${string}`,
          rank: Number(l.args.rank),
          amount: l.args.amount as bigint,
        }))
        .sort((a, b) => a.rank - b.rank);
    },
  });

  if (!prevId || state === undefined || state === RoundState.NONE || state === RoundState.OPEN) return null;

  return (
    <div className="bg-dark-card border border-dark-border rounded-3xl p-8">
      <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
        {state === RoundState.DRAWING && <Dices className="w-5 h-5 text-blue-500 animate-pulse" />}
        {state === RoundState.SETTLED && <Trophy className="w-5 h-5 text-brand" />}
        {state === RoundState.CANCELLED && <Ban className="w-5 h-5 text-gray-500" />}
        Round #{prevId.toString()}
      </h3>

      {state === RoundState.DRAWING && (
        <p className="text-blue-400 font-bold uppercase tracking-wider text-sm animate-pulse">
          Drawing winners… (Chainlink VRF)
        </p>
      )}

      {state === RoundState.CANCELLED && (
        <p className="text-sm text-gray-400">
          Round cancelled — fewer than 3 participants or VRF timeout. Ticket holders can claim a full refund above.
        </p>
      )}

      {state === RoundState.SETTLED && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">
            Settled · pool {usdc(pool)} USDC
          </p>
          {winners && winners.length > 0 ? (
            winners.map((w) => (
              <div key={w.rank} className="flex items-center justify-between text-sm">
                <span className="text-gray-400">
                  #{w.rank} <span className="font-mono text-gray-500">{short(w.winner)}</span>
                </span>
                <span className="text-brand font-mono font-bold">{usdc(w.amount)} USDC</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">Winners settled on-chain. Claim above if you won.</p>
          )}
        </div>
      )}
    </div>
  );
};
