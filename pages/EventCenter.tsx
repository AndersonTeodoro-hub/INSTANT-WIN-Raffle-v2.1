import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status } from '../lib/giveaway-v2-abi';
import { EventShell } from '../components/EventShell';
import { ShareButton } from '../components/ShareButton';
import { BrandByline, IdentityBanner, useCampaignIdentity } from '../components/CampaignIdentity';
import { useEventsCopy } from './events.i18n';
import { Check, Loader2, ExternalLink, ArrowRight, Ban, Plus } from 'lucide-react';
import { HeaderAction } from '../components/SiteHeader';
import { ProofMark } from '../components/proof/ProofMark';
import { CountUp } from '../components/proof/CountUp';
import { shortProof, uintHex } from '../lib/proof/mark';

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

function EventCard({ id, index }: { id: bigint; index: number }) {
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

  // §17: a identidade publicada pelo criador, se houver. Sem ela o cartão é o de
  // sempre (L9). Leitura à ponte, em lote com os outros cartões; nenhuma leitura
  // da cadeia muda.
  const { data: identity } = useCampaignIdentity(id);

  // A ler: o lugar do cartão fica marcado, para a grelha não saltar quando chega.
  if (!g) return <div aria-hidden="true" className="iw-surface h-[232px] animate-pulse opacity-60" />;
  if (g.status === GiveawayV2Status.NONE) return null;

  const decimals = g.prizeKind === 1 ? 6 : ((meta?.[0]?.result as number | undefined) ?? 18);
  const symbol = g.prizeKind === 1 ? 'USDC' : ((meta?.[1]?.result as string | undefined) ?? '?');
  const displayAmount = g.prizeKind === 1 ? g.declaredValue : g.prizeAmount;
  const statusLabel = c.list.status[STATUS_KEY[g.status] as keyof typeof c.list.status] ?? STATUS_KEY[g.status];

  /*
   * Um só modelo de cartão para todos os estados. O que muda é o selo do estado
   * (EventStatus) e a tinta: a campanha aberta é a que o visitante ainda pode
   * apanhar; a cancelada recua (tracejado, prémio riscado). Nenhuma leitura muda.
   */
  const isOpen = g.status === GiveawayV2Status.OPEN;
  const isCancelled = g.status === GiveawayV2Status.CANCELLED;
  const left = slotsRemaining as bigint | undefined;
  const taken = left !== undefined ? g.slotCap - Number(left) : null;
  const filledPct = taken !== null && g.slotCap > 0 ? Math.min(100, (taken / g.slotCap) * 100) : 0;

  // Liquidada: a forma do sorteio, desenhada da semente que o Chainlink VRF entregou ao contrato.
  const seedProof = g.status === GiveawayV2Status.SETTLED ? uintHex(g.seed) : null;

  return (
    <Link
      to={`/events/${id.toString()}`}
      style={{ ['--i' as string]: Math.min(index, 8) }}
      className={`iw-surface iw-rise group flex flex-col overflow-hidden ${isCancelled ? '!border-dashed !bg-dark-bg' : ''} ${isOpen ? '!border-dark-line' : ''}`}
    >
      {identity && (
        <div className="border-b border-dark-border/80">
          <IdentityBanner identity={identity} />
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <EventStatus status={g.status} label={statusLabel} />
          <span onClick={(e) => e.preventDefault()} className="-my-2 -mr-2">
            <ShareButton
              className="!min-h-[40px] !min-w-[40px] border-0 text-gray-400 hover:text-gray-300"
              url={`${window.location.origin}/events/${id.toString()}`}
            />
          </span>
        </div>

        {/* O nome e a marca vêm primeiro: é por eles que o participante reconhece a campanha. */}
        {identity && (
          <div className="mt-3 min-w-0">
            <p className="font-display text-xl font-bold leading-tight tracking-tight text-white line-clamp-2 break-words">
              {identity.name}
            </p>
            <div className="mt-1.5">
              <BrandByline identity={identity} by={c.list.card.byBrand} newTab={c.detail.identity.opensNewTab} plain />
            </div>
          </div>
        )}

        {seedProof !== null && (
          <div className="mt-4 flex items-center gap-3">
            <ProofMark proof={seedProof} size={56} label={`${c.detail.proof.markCampaign} ${id.toString()}`} className="transition-transform duration-500 ease-out group-hover:rotate-12" />
            <p className="min-w-0 text-xs text-gray-400">
              {c.detail.proof.vrfSeed}
              <span className="mt-0.5 block truncate font-mono text-success">{shortProof(seedProof)}</span>
            </p>
          </div>
        )}

        <div className="mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-gray-400">{c.list.card.prize}</p>
            <p
              className={`font-mono text-4xl font-bold leading-none tracking-tight truncate mt-1.5 ${
                isCancelled ? 'text-gray-400 line-through decoration-gray-600' : 'text-brand'
              }`}
            >
              <CountUp value={displayAmount} decimals={decimals} />
            </p>
          </div>
          <p className="shrink-0 pb-0.5 font-mono text-xs text-gray-400">{symbol}</p>
        </div>

        {/* Vagas ocupadas: os dois números que já estavam lidos, em todos os estados. */}
        <div className="mt-auto pt-6">
          <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`iw-meter h-full rounded-full ${isOpen ? 'bg-white/80' : 'bg-white/25'}`}
              style={{ transform: `scaleX(${filledPct / 100})` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs text-gray-400">
            <span>
              {isOpen && left !== undefined
                ? left === 0n
                  ? c.list.card.full
                  : `${left.toString()} ${c.list.card.slotsLeft}`
                : taken !== null
                  ? `${taken} / ${g.slotCap}`
                  : '…'}
            </span>
            <span className="flex items-center gap-2">
              {c.list.card.winners} {g.winnersCount}
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/**
 * O estado de uma campanha, com o sinal que lhe cabe:
 * - aberta ou em sorteio: ao vivo on-chain → ponto verde a pulsar;
 * - liquidada: o sorteio está provado on-chain → visto verde;
 * - cancelada: recua, com o ícone de cancelado;
 * - a fechar: neutra.
 */
export function EventStatus({ status, label }: { status: number; label: string }) {
  const live = status === GiveawayV2Status.OPEN || status === GiveawayV2Status.DRAW_REQUESTED || status === GiveawayV2Status.SEED_RECEIVED;
  const settled = status === GiveawayV2Status.SETTLED;
  const cancelled = status === GiveawayV2Status.CANCELLED;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${
        live || settled ? 'border-success/30 bg-success/[0.07] text-success' : 'border-dark-line text-gray-400'
      }`}
    >
      {live && <span className="iw-live" aria-hidden="true" />}
      {settled && <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />}
      {cancelled && <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {label}
    </span>
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
      extras={
        <Link
          to="/events/mine"
          className="hidden sm:inline-flex items-center px-3 min-h-[44px] text-sm text-gray-300 hover:text-white transition-colors"
        >
          {c.list.myEventsCta}
        </Link>
      }
      actions={<HeaderAction to="/events/create" icon={Plus} label={c.list.createCta} />}
    >
      <h1 className="font-display font-bold text-[clamp(2.4rem,7vw,3.75rem)] leading-[1.02] tracking-tight">
        {c.list.title}
      </h1>
      <p className="mt-5 max-w-[62ch] text-base sm:text-lg leading-relaxed text-gray-400">
        {c.list.intro}
      </p>

      {/* As três garantias, à entrada. Factos do contrato, não argumentos. */}
      <ul className="iw-surface mt-8 grid divide-y divide-dark-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[c.list.trust.free, c.list.trust.draw, c.list.trust.custody].map((line) => (
          <li key={line} className="flex items-start gap-2.5 p-4 text-sm leading-snug text-gray-300 sm:p-5">
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
        {isError && <p role="alert" className="iw-surface border-red-500/40 p-5 text-red-300">{c.list.error}</p>}
        {!isLoading && !isError && ids.length === 0 && (
          <p className="rounded-card border border-dashed border-dark-line p-8 text-center text-gray-400">{c.list.empty}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ids.map((id, index) => (
            <EventCard key={id.toString()} id={id} index={index} />
          ))}
        </div>
      </div>

      <a
        href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
        target="_blank"
        rel="noopener noreferrer"
        className="iw-surface mt-12 flex items-center justify-between gap-3 min-h-[44px] px-4 py-3 font-mono text-[11px] text-gray-400 hover:!border-success/40 hover:text-success"
      >
        <span className="flex flex-wrap items-baseline gap-x-2 min-w-0">
          <span className="font-sans text-gray-400">{c.list.contractLabel}</span>
          <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
        </span>
        <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
      </a>
    </EventShell>
  );
};
