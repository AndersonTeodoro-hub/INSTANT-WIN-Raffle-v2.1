import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useReadContract, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status } from '../lib/giveaway-v2-abi';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { LangSwitch } from '../components/LangSwitch';
import { Button } from '../components/Button';
import { ShareButton } from '../components/ShareButton';
import { useEventsCopy } from './events.i18n';
import { Loader2, ExternalLink } from 'lucide-react';

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

  return (
    <Link
      to={`/events/${id.toString()}`}
      className="block rounded-xl border border-dark-border bg-dark-card p-5 hover:border-gray-600 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[11px] uppercase tracking-widest text-gray-500">#{id.toString()}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-300 border border-dark-border rounded px-2 py-0.5">
            {statusLabel}
          </span>
          <span onClick={(e) => e.preventDefault()}>
            <ShareButton
              className="!min-h-[32px] !min-w-[32px] border-0"
              url={`${window.location.origin}/events/${id.toString()}`}
            />
          </span>
        </div>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-1">{c.list.card.prize}</p>
      <p className="font-mono text-2xl font-bold text-brand mb-4 truncate">
        {formatUnits(displayAmount, decimals)} {symbol}
      </p>
      <div className="flex justify-between text-sm text-gray-400">
        <span>
          {c.list.card.winners}: <span className="text-white font-mono">{g.winnersCount}</span>
        </span>
        <span>
          {c.list.card.slots}:{' '}
          <span className="text-white font-mono">
            {slotsRemaining !== undefined ? (slotsRemaining as bigint).toString() : '…'}/{g.slotCap}
          </span>
        </span>
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
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <header className="sticky top-0 z-20 border-b border-dark-border/60 bg-black/70 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 min-h-[64px] md:h-20 flex flex-wrap md:flex-nowrap items-center justify-between md:justify-end gap-3">
          <Link to="/" className="flex items-baseline gap-2 min-w-0 min-h-[44px] py-2 md:mr-auto">
            <span className="font-display font-bold text-xl sm:text-2xl text-white tracking-tight leading-none truncate">
              INSTANT WIN
            </span>
          </Link>
          <PublicNavLinks />
          <div className="flex items-center gap-2">
            <LangSwitch />
            <Link to="/events/mine" className="hidden sm:inline-flex px-4 h-11 items-center text-sm font-bold text-gray-300 hover:text-white">
              {c.list.myEventsCta}
            </Link>
            <Link to="/events/create">
              <Button variant="connect" className="h-11 px-5 text-sm">
                {c.list.createCta}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10 container mx-auto px-4 sm:px-6 max-w-5xl py-10 sm:py-16">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-4">{c.list.eyebrow}</p>
        <h1 className="font-display font-bold text-[clamp(2.2rem,8vw,3.5rem)] leading-[1.05] mb-4">{c.list.title}</h1>
        <p className="text-gray-400 text-base sm:text-lg leading-relaxed max-w-2xl mb-6">{c.list.intro}</p>

        <a
          href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-10 flex items-center justify-between gap-3 min-h-[44px] max-w-2xl rounded-lg border border-dark-border bg-dark-card/60 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="uppercase tracking-widest text-gray-500 shrink-0">{c.list.contractLabel}</span>
            <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
          </span>
          <ExternalLink className="w-4 h-4 shrink-0" />
        </a>

        {isLoading && (
          <div className="flex items-center gap-3 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> {c.list.loading}
          </div>
        )}
        {isError && <p className="text-red-400">{c.list.error}</p>}
        {!isLoading && !isError && ids.length === 0 && <p className="text-gray-500">{c.list.empty}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ids.map((id) => (
            <EventCard key={id.toString()} id={id} />
          ))}
        </div>
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 space-y-4 text-center">
          <PublicFooterNav />
          <p className="font-mono text-[10px] text-gray-700">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};
