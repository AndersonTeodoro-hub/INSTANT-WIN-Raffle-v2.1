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
import { WinCard } from './WinCard';
import { Gift, Undo2, Trophy, Ban } from 'lucide-react';
import { useAppCopy } from '../pages/app.i18n';

const TICKET_PRICE = 1_000_000n;

// ponytail: procura refunds só nas últimas 10 rondas (1 multicall, ~5h de histórico).
// Rondas mais antigas continuam reclamáveis on-chain via claimRefund(roundId) directo.
const REFUND_WINDOW = 10;

/** Blocos por pedido de getLogs. Pequeno o bastante para o RPC público aceitar. */
const LOG_CHUNK = 9_000n;
/** Tecto de pedidos por consulta: ~90k blocos ≈ 6h em Arbitrum. */
const MAX_LOG_CHUNKS = 10;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usdc = (v: bigint) => formatUnits(v, 6);

// ============================================================
// Claim: prémios (pull-payment) + refunds de rondas canceladas
// ============================================================
export const ClaimPanel: React.FC<{ currentRoundId?: bigint }> = ({ currentRoundId }) => {
  const { address, isConnected } = useAccount();
  const c = useAppCopy();

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
    <div className="bg-dark-card border border-dark-border rounded-xl p-5 sm:p-7">
      <h2 className="font-display text-2xl font-bold text-white tracking-tight mb-5 flex items-center gap-2">
        <Gift className="w-5 h-5 text-brand shrink-0" aria-hidden="true" /> {c.claim.title}
      </h2>

      {/* Recibo de vitória: há prémio por reclamar, ou um claim acabou de confirmar. */}
      {(prize > 0n || isSuccess) && <WinCard fallbackAmount={prize} claimTxHash={isSuccess ? hash : undefined} />}

      <div className="flex items-baseline justify-between gap-3 border-y border-dark-border py-4 mb-4">
        <p className="text-sm text-gray-400">{c.claim.claimable}</p>
        <p className="font-mono text-3xl font-bold text-brand tabular-nums">
          {usdc(prize)} <span className="text-sm text-gray-400 font-normal">USDC</span>
        </p>
      </div>

      <Button
        variant="success"
        className="w-full min-h-[52px] rounded-xl"
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
        {prize === 0n ? c.claim.nothingToClaim : `${c.claim.claimPre} ${usdc(prize)} USDC`}
      </Button>

      {refundables.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-sm text-gray-400 flex items-center gap-2">
            <Undo2 className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" /> {c.claim.refundsTitle}
          </p>
          {refundables.map((r) => (
            <div
              key={r.id.toString()}
              className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-white/[0.02] px-4 py-3"
            >
              <div>
                <p className="font-mono text-xs text-gray-400 tabular-nums">{c.claim.round}{r.id.toString()}</p>
                <p className="font-mono font-bold text-brand tabular-nums">{usdc(r.amount)} USDC</p>
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
                {c.claim.refund}
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
  const c = useAppCopy();
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
    retry: 2,
    queryFn: async () => {
      // O RPC público da Arbitrum rejeita intervalos largos de getLogs, e uma janela
      // única e fixa também perde a ronda se ela tiver liquidado há mais tempo do que
      // a janela. Varremos para trás em pedaços pequenos e paramos assim que houver
      // resultados — na prática o primeiro pedaço chega, porque a ronda anterior
      // acabou de fechar.
      const latest = await client!.getBlockNumber();
      let to = latest;

      for (let i = 0; i < MAX_LOG_CHUNKS && to >= RAFFLE_DEPLOY_BLOCK; i++) {
        const candidate = to > LOG_CHUNK ? to - LOG_CHUNK + 1n : 0n;
        const from = candidate > RAFFLE_DEPLOY_BLOCK ? candidate : RAFFLE_DEPLOY_BLOCK;

        const logs = await client!.getLogs({
          address: CONTRACTS.RAFFLE_MANAGER,
          event: PRIZE_AWARDED_EVENT,
          args: { roundId: prevId },
          fromBlock: from,
          toBlock: to,
        });

        if (logs.length > 0) {
          return logs
            .map((l) => ({
              winner: l.args.winner as `0x${string}`,
              rank: Number(l.args.rank),
              amount: l.args.amount as bigint,
            }))
            .sort((a, b) => a.rank - b.rank);
        }

        if (from <= RAFFLE_DEPLOY_BLOCK) break;
        to = from - 1n;
      }

      return [] as { winner: `0x${string}`; rank: number; amount: bigint }[];
    },
  });

  if (!prevId || state === undefined || state === RoundState.NONE || state === RoundState.OPEN) return null;

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-5 sm:p-7">
      <h2 className="font-display text-2xl font-bold text-white tracking-tight mb-5 flex items-center gap-2">
        {/* Sem dados nem roleta: o ícone do sorteio a decorrer é a taça apagada. */}
        {state === RoundState.DRAWING && <Trophy className="w-5 h-5 text-action shrink-0 animate-pulse" aria-hidden="true" />}
        {state === RoundState.SETTLED && <Trophy className="w-5 h-5 text-brand shrink-0" aria-hidden="true" />}
        {state === RoundState.CANCELLED && <Ban className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />}
        {c.previousRound.round}{prevId.toString()}
      </h2>

      {state === RoundState.DRAWING && (
        <p className="text-sm text-action animate-pulse">{c.previousRound.drawing}</p>
      )}

      {state === RoundState.CANCELLED && (
        <p className="max-w-[62ch] text-sm leading-relaxed text-gray-400">{c.previousRound.cancelled}</p>
      )}

      {state === RoundState.SETTLED && (
        <div>
          <p className="text-sm text-gray-400">
            {c.previousRound.settledPoolPre}{' '}
            <span className="font-mono text-gray-300 tabular-nums">{usdc(pool)} USDC</span>
          </p>
          {winners && winners.length > 0 ? (
            <ol className="mt-4 divide-y divide-dark-border border-y border-dark-border">
              {winners.map((w) => (
                <li key={w.rank} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-gray-400 tabular-nums">{w.rank}</span>
                    <span className="font-mono text-gray-300 truncate">{short(w.winner)}</span>
                  </span>
                  <span className="font-mono font-bold text-brand tabular-nums shrink-0">
                    {usdc(w.amount)} USDC
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-gray-400">{c.previousRound.winnersSettled}</p>
          )}
        </div>
      )}
    </div>
  );
};
