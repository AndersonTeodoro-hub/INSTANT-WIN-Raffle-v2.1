import React, { useMemo } from 'react';
import { usePublicClient, useReadContracts } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import {
  CONTRACTS,
  USERNAME_ABI,
  RAFFLE_DEPLOY_BLOCK,
  PRIZE_AWARDED_EVENT,
} from '../constants';
import { Trophy, Check } from 'lucide-react';
import { useAppCopy } from '../pages/app.i18n';
import type { AppCopy } from '../pages/app.i18n';

/** Blocos por pedido. Pequeno o bastante para o RPC público não recusar. */
const LOG_CHUNK = 9_000n;
/** Tecto de pedidos por varrimento: ~270k blocos ≈ 19h em Arbitrum. */
const MAX_CHUNKS = 30;
/** Rondas liquidadas a mostrar. Três prémios por ronda. */
const ROUNDS_SHOWN = 5;

const ARBISCAN_TX = 'https://arbiscan.io/tx/';

type Winner = {
  roundId: bigint;
  winner: `0x${string}`;
  rank: number;
  amount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  timestamp?: number;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "2h ago", "5m ago", "just now" — e os equivalentes em PT-BR e ES. Sem dependências de datas. */
function relativeTime(ts: number | undefined, t: AppCopy['winners']): string {
  if (!ts) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return t.justNow;
  if (diff < 3600) return `${Math.floor(diff / 60)}${t.minutesAgo}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t.hoursAgo}`;
  return `${Math.floor(diff / 86400)}${t.daysAgo}`;
}

/**
 * Painel "Recent Winners".
 *
 * Alimentado exclusivamente pelos eventos `PrizeAwarded` do contrato — é a razão
 * de existir do painel: a prova está on-chain e cada linha leva ao Arbiscan.
 *
 * O `getLogs` varre para trás em blocos pequenos até ao bloco de deploy, parando
 * assim que junta rondas suficientes. Uma janela única e larga é recusada pelo RPC
 * público da Arbitrum — foi a lição registada na migração do V2.
 */
export const RecentWinners: React.FC = () => {
  const client = usePublicClient();
  const c = useAppCopy();

  const { data: winners, isLoading } = useQuery({
    queryKey: ['recentWinners'],
    enabled: !!client,
    retry: 2,
    staleTime: 60_000,
    queryFn: async (): Promise<Winner[]> => {
      const latest = await client!.getBlockNumber();
      const found: Winner[] = [];
      const rounds = new Set<string>();
      let to = latest;

      for (let i = 0; i < MAX_CHUNKS && to >= RAFFLE_DEPLOY_BLOCK; i++) {
        const candidate = to > LOG_CHUNK ? to - LOG_CHUNK + 1n : 0n;
        const from = candidate > RAFFLE_DEPLOY_BLOCK ? candidate : RAFFLE_DEPLOY_BLOCK;

        const logs = await client!.getLogs({
          address: CONTRACTS.RAFFLE_MANAGER,
          event: PRIZE_AWARDED_EVENT,
          fromBlock: from,
          toBlock: to,
        });

        for (const l of logs) {
          found.push({
            roundId: l.args.roundId as bigint,
            winner: l.args.winner as `0x${string}`,
            rank: Number(l.args.rank),
            amount: l.args.amount as bigint,
            txHash: l.transactionHash as `0x${string}`,
            blockNumber: l.blockNumber as bigint,
          });
          rounds.add((l.args.roundId as bigint).toString());
        }

        if (rounds.size >= ROUNDS_SHOWN) break;
        if (from <= RAFFLE_DEPLOY_BLOCK) break;
        to = from - 1n;
      }

      // Timestamps: um pedido por bloco distinto de liquidação (um por ronda).
      const blocks = [...new Set(found.map((w) => w.blockNumber.toString()))];
      const stamps = new Map<string, number>();
      for (const b of blocks) {
        try {
          const blk = await client!.getBlock({ blockNumber: BigInt(b) });
          stamps.set(b, Number(blk.timestamp));
        } catch {
          /* sem timestamp, a linha fica sem tempo relativo */
        }
      }

      return found
        .map((w) => ({ ...w, timestamp: stamps.get(w.blockNumber.toString()) }))
        .sort((a, b) =>
          a.roundId === b.roundId ? a.rank - b.rank : Number(b.roundId - a.roundId),
        );
    },
  });

  // Usernames numa só multicall; cai para o endereço truncado quando não há.
  const uniqueAddrs = useMemo(
    () => [...new Set((winners ?? []).map((w) => w.winner))],
    [winners],
  );

  const { data: names } = useReadContracts({
    contracts: uniqueAddrs.map((a) => ({
      address: CONTRACTS.USERNAME_REGISTRY,
      abi: USERNAME_ABI,
      functionName: 'walletToUsername' as const,
      args: [a] as const,
    })),
    query: { enabled: uniqueAddrs.length > 0, staleTime: 300_000 },
  });

  const nameOf = (addr: string) => {
    const i = uniqueAddrs.indexOf(addr as `0x${string}`);
    const n = i >= 0 ? (names?.[i]?.result as string | undefined) : undefined;
    return n && n.length > 0 ? `@${n}` : short(addr);
  };

  return (
    <section className="bg-dark-card border border-dark-border rounded-xl p-5 sm:p-8">
      <div className="flex items-center justify-between gap-3 mb-5">
        <h3 className="font-display text-2xl sm:text-3xl font-bold text-white uppercase tracking-tight flex items-center gap-2">
          <Trophy className="w-5 h-5 text-brand shrink-0" /> {c.winners.title}
        </h3>
        <span className="font-mono text-[10px] text-gray-500 uppercase tracking-widest shrink-0">
          {c.winners.onChain}
        </span>
      </div>

      {isLoading && (
        <p className="font-mono text-sm text-gray-500">{c.winners.reading}</p>
      )}

      {!isLoading && (!winners || winners.length === 0) && (
        <p className="font-mono text-sm text-gray-500">{c.winners.empty}</p>
      )}

      {winners && winners.length > 0 && (
        <ul className="divide-y divide-dark-border">
          {winners.map((w) => (
            <li
              key={`${w.txHash}-${w.rank}`}
              className="flex items-center justify-between gap-3 py-3 min-h-[44px]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-xs text-gray-600 w-6 shrink-0">#{w.rank}</span>
                <div className="min-w-0">
                  <p className="font-mono text-sm text-white truncate">{nameOf(w.winner)}</p>
                  <p className="font-mono text-[11px] text-gray-500">
                    {c.winners.round} {w.roundId.toString()} · {relativeTime(w.timestamp, c.winners)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-sm sm:text-base font-bold text-brand tabular-nums">
                  {formatUnits(w.amount, 6)}
                </span>
                <a
                  href={`${ARBISCAN_TX}${w.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${c.winners.ariaVerifyPre} ${w.roundId} ${c.winners.ariaVerifyPost}`}
                  className="flex items-center justify-center w-11 h-11 -mr-2 text-success hover:text-success-hover transition-colors"
                >
                  <Check className="w-4 h-4" strokeWidth={3} />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
