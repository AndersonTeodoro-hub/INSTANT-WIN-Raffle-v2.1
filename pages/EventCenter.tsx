import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useReadContract, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status } from '../lib/giveaway-v2-abi';
import { EventShell } from '../components/EventShell';
import { Button } from '../components/Button';
import { ShareButton } from '../components/ShareButton';
import { useEventsCopy } from './events.i18n';
import { Check, Loader2, ExternalLink } from 'lucide-react';

const MAX_LISTED = 30;
const ARBISCAN = 'https://arbiscan.io/address/';

type GiveawayTuple = {
  creator: `0x${string}`;
  startTime: bigint;
  winnersCount: number;
  prizeModule: `0x${string}`;
  endTime: bigint;
  status: number;
  prizeKind: number;
  cancelReason: number;
  feeToken: `0x${string}`;
  slotCap: number;
  nextAttempt: number;
  pausedOffset: bigint;
  closedAt: bigint;
  drawRequestedAt: bigint;
  settledAt: bigint;
  prizeAmount: bigint;
  declaredValue: bigint;
  feeAmount: bigint;
  slotsPaid: bigint;
  prizeDelivered: bigint;
  vrfRequestId: bigint;
  seed: bigint;
};

const STATUS_KEY = ['NONE', 'OPEN', 'CLOSED', 'DRAW_REQUESTED', 'SEED_RECEIVED', 'SETTLED', 'CANCELLED'] as const;

function EventCard({ id }: { id: bigint }) {
  const c = useEventsCopy();

  const { data: giveaway } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getGiveaway',
    args: [id],
  });

  const { data: slotsRemaining } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'slotsRemaining',
    args: [id],
  });

  const g = giveaway as GiveawayTuple | undefined;

  const feeTokenAddress = (g?.feeToken ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { data: meta } = useReadContracts({
    contracts: [
      { address: feeTokenAddress, abi: ERC20_META_ABI, functionName: 'decimals' },
      { address: feeTokenAddress, abi: ERC20_META_ABI, functionName: 'symbol' },
    ],
    query: { enabled: !!g },
  });

  if (!g || g.status === GiveawayV2Status.NONE) return null;

  const decimals = g.prizeKind === 1 ? 6 : ((meta?.[0]?.result as number | undefined) ?? 18);
  const symbol = g.prizeKind === 1 ? 'USDC' : ((meta?.[1]?.result as string | undefined) ?? '?');
  const displayAmount = g.prizeKind === 1 ? g.declaredValue : g.prizeAmount;
  const statusLabel = c.list.status[STATUS_KEY[g.status] as keyof typeof c.list.status] ?? STATUS_KEY[g.status];

  /*
   * Hierarquia sem mudar uma única leitura: a campanha aberta é a que o
   * visitante ainda pode apanhar, por isso é a que se destaca. As restantes
   * recuam de cor em vez de serem filtradas — filtrar obrigaria a saber o
   * estado de todas antes de desenhar qualquer uma, e isso mudava o padrão de
   * leituras da página.
   */
  const isOpen = g.status === GiveawayV2Status.OPEN;
  const left = slotsRemaining as bigint | undefined;
  const taken = left !== undefined ? g.slotCap - Number(left) : null;
  const filledPct = taken !== null && g.slotCap > 0 ? Math.min(100, (taken / g.slotCap) * 100) : 0;

  return (
    <Link
      to={`/events/${id.toString()}`}
      className={`group flex flex-col rounded-xl border p-5 transition-colors ${
        isOpen
          ? 'border-brand/25 bg-dark-ticket hover:border-brand/50'
          : 'border-dark-border bg-dark-card hover:border-gray-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
            isOpen ? 'text-success' : 'text-gray-400'
          }`}
        >
          {statusLabel}
        </span>
        <span onClick={(e) => e.preventDefault()} className="-mt-2 -mr-2">
          <ShareButton
            className="!min-h-[36px] !min-w-[36px] border-0 text-gray-400 hover:text-gray-300"
            url={`${window.location.origin}/events/${id.toString()}`}
          />
        </span>
      </div>

      <p className="mt-4 text-sm text-gray-400">{c.list.card.prize}</p>
      <p
        className={`font-mono text-3xl font-bold leading-tight truncate ${
          isOpen ? 'text-brand' : 'text-gray-300'
        }`}
      >
        {formatUnits(displayAmount, decimals)}
      </p>
      <p className="font-mono text-xs text-gray-400">{symbol}</p>

      {/* Quanto falta para esgotar. Dois números que já estavam lidos. */}
      <div className="mt-5 pt-4 border-t border-dark-border/80">
        {isOpen && left !== undefined && taken !== null ? (
          <>
            <div aria-hidden="true" className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-brand/70" style={{ width: `${filledPct}%` }} />
            </div>
            <p className="mt-2 font-mono text-xs text-gray-400 tabular-nums">
              {left === 0n ? (
                c.list.card.full
              ) : (
                <>
                  {left.toString()} {c.list.card.slotsLeft}
                </>
              )}
            </p>
          </>
        ) : (
          <p className="font-mono text-xs text-gray-400 tabular-nums">
            {c.list.card.winners} {g.winnersCount}
          </p>
        )}
      </div>
    </Link>
  );
}

export const EventCenter: React.FC = () => {
  const c = useEventsCopy();

  const { data: lastId, isLoading, isError } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'lastGiveawayId',
  });

  useEffect(() => {
    const prevTitle = document.title;
    document.title = c.list.metaTitle;
    return () => {
      document.title = prevTitle;
    };
  }, [c]);

  const ids = useMemo(() => {
    if (lastId === undefined) return [] as bigint[];
    const last = lastId as bigint;
    const first = last > BigInt(MAX_LISTED) ? last - BigInt(MAX_LISTED) + 1n : 1n;
    const out: bigint[] = [];
    for (let i = last; i >= first; i--) out.push(i);
    return out;
  }, [lastId]);

  return (
    <EventShell
      width="wide"
      actions={
        <>
          <Link
            to="/events/mine"
            className="hidden sm:inline-flex items-center px-4 h-11 text-sm text-gray-300 hover:text-white transition-colors"
          >
            {c.list.myEventsCta}
          </Link>
          <Link to="/events/create">
            <Button variant="connect" className="h-11 px-5 text-sm">
              {c.list.createCta}
            </Button>
          </Link>
        </>
      }
    >
      <h1 className="font-display font-bold text-[clamp(2.4rem,7vw,3.75rem)] leading-[1.02] tracking-tight">
        {c.list.title}
      </h1>
      <p className="mt-5 max-w-[62ch] text-base sm:text-lg leading-relaxed text-gray-400">
        {c.list.intro}
      </p>

      {/* As três garantias, à entrada. Factos do contrato, não argumentos. */}
      <ul className="mt-8 grid gap-3 sm:grid-cols-3">
        {[c.list.trust.free, c.list.trust.draw, c.list.trust.custody].map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-sm leading-snug text-gray-300">
            <Check className="w-4 h-4 shrink-0 mt-0.5 text-success" strokeWidth={3} aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>

      <div className="mt-12">
        {isLoading && (
          <p className="flex items-center gap-3 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" /> {c.list.loading}
          </p>
        )}
        {isError && <p className="text-red-300">{c.list.error}</p>}
        {!isLoading && !isError && ids.length === 0 && <p className="text-gray-400">{c.list.empty}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ids.map((id) => (
            <EventCard key={id.toString()} id={id} />
          ))}
        </div>
      </div>

      <a
        href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-12 flex items-center justify-between gap-3 min-h-[44px] rounded-lg border border-dark-border px-4 py-3 font-mono text-[11px] text-gray-400 hover:border-success/40 hover:text-success transition-colors"
      >
        <span className="flex flex-wrap items-baseline gap-x-2 min-w-0">
          <span className="text-gray-400">{c.list.contractLabel}</span>
          <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
        </span>
        <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
      </a>
    </EventShell>
  );
};
