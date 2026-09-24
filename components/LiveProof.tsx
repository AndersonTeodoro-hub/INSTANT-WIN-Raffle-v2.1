import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, RAFFLE_ABI, RoundState } from '../constants';
import { useAppCopy } from '../pages/app.i18n';
import { useRecentWinners } from './RecentWinners';
import { ProofSeal, RoundClock, RoundMeter } from './Proof';

const ARBISCAN_TX = 'https://arbiscan.io/tx/';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * A prova viva da página inicial: "Proof, not promise" a mostrar prova.
 *
 * Em cima, a ronda em curso (ao vivo on-chain: ponto verde a pulsar, relógio,
 * prémio em âmbar); em baixo, o último sorteio liquidado, cada vencedor com o
 * visto que leva à transacção no Arbiscan. O talão com o picotado é o mesmo
 * objecto do bilhete da /play/raffle.
 *
 * Sem leituras novas à cadeia: `getCurrentRound` é a mesma leitura da vista
 * geral do jogo, e os vencedores vêm de `useRecentWinners`, a mesma consulta (e
 * a mesma cache) do painel "Recent winners".
 */
export const LiveProof: React.FC<{ className?: string }> = ({ className = '' }) => {
  const c = useAppCopy();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const { data: round } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'getCurrentRound',
    query: { refetchInterval: 5000 },
  });
  const { data: winners, isLoading } = useRecentWinners();

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const roundId = round?.[0] as bigint | undefined;
  const endTime = round?.[2] as bigint | undefined;
  const pool = (round?.[5] ?? 0n) as bigint;
  const left = endTime !== undefined ? Number(endTime) - now : 0;
  const live = round?.[1] === RoundState.OPEN && left > 0;
  const closing = round !== undefined && !live;

  const lastRound = winners?.[0]?.roundId;
  const last = (winners ?? []).filter((w) => w.roundId === lastRound).slice(0, 3);

  return (
    <section className={`iw-surface-raised overflow-hidden text-left ${className}`}>
      {/* A ronda em curso. */}
      <Link to="/play" className="block p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-gray-300">
            <span className="iw-live" data-idle={!live} aria-hidden="true" />
            {closing
              ? c.dashboard.finalizing
              : `${c.dashboard.roundPre}${roundId?.toString() ?? '…'}${c.dashboard.roundPost}`}
          </p>
          <span className="font-mono text-[11px] text-gray-400">Arbitrum One</span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-400">{c.dashboard.timeRemaining}</p>
            <RoundClock
              seconds={left}
              closing={closing ? c.dashboard.closing : undefined}
              className="mt-2 justify-start text-[clamp(1.5rem,7vw,2.25rem)]"
            />
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-gray-400">{c.dashboard.totalPrizePool}</p>
            <p className="mt-2 font-mono text-[clamp(1.5rem,7vw,2.25rem)] font-bold leading-none text-brand">
              {formatUnits(pool, 6)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-gray-400">USDC</p>
          </div>
        </div>
        <RoundMeter seconds={left} closing={closing} className="mt-4" />
      </Link>

      <div className="ticket-tear" />

      {/* O último resultado, com a transacção que o prova. */}
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-lg font-bold tracking-tight text-white">
            {c.winners.title}
            {lastRound !== undefined && (
              <span className="ml-2 font-mono text-xs font-normal text-gray-400">
                {c.winners.round} {lastRound.toString()}
              </span>
            )}
          </p>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/25 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
            <ProofSeal className="h-3 w-3" />
            {c.winners.onChain}
          </span>
        </div>

        {isLoading && <p className="mt-3 font-mono text-sm text-gray-400">{c.winners.reading}</p>}
        {!isLoading && last.length === 0 && <p className="mt-3 font-mono text-sm text-gray-400">{c.winners.empty}</p>}
        {last.length > 0 && (
          <ul className="mt-2 divide-y divide-dark-border">
            {last.map((w, i) => (
              <li
                key={`${w.txHash}-${w.rank}`}
                style={{ ['--i' as string]: i }}
                className="iw-rise flex min-h-[44px] items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-3 font-mono text-sm">
                  <span className="w-3 text-xs text-gray-400">{w.rank}</span>
                  <span className="truncate text-gray-200">{short(w.winner)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-mono text-sm font-bold text-brand">{formatUnits(w.amount, 6)}</span>
                  <a
                    href={`${ARBISCAN_TX}${w.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${c.winners.ariaVerifyPre} ${w.roundId} ${c.winners.ariaVerifyPost}`}
                    className="-mr-2 flex h-11 w-11 items-center justify-center text-success hover:text-success-hover"
                  >
                    <ProofSeal className="h-4 w-4" />
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
