import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status, GiveawayV2PrizeKind } from '../lib/giveaway-v2-abi';
import { Button } from '../components/Button';
import { EventShell } from '../components/EventShell';
import { ShareButton } from '../components/ShareButton';
import { useEventsCopy } from './events.i18n';

const MAX_SCANNED = 200;

/** Um botão que assina, espera confirmação, e volta a ler o estado da campanha. */
function ActionButton({
  functionName,
  args,
  label,
  onDone,
}: {
  functionName: string;
  args: readonly unknown[];
  label: string;
  onDone: () => void;
}) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        className="min-h-[40px] px-4 py-2 text-sm"
        isLoading={isPending || confirming}
        onClick={() =>
          writeContract({
            address: CONTRACTS.GIVEAWAY_MANAGER_V2,
            abi: GIVEAWAY_MANAGER_V2_ABI,
            functionName: functionName as never,
            args: args as never,
          })
        }
      >
        {label}
      </Button>
      {error && <span className="max-w-[220px] text-[11px] text-red-400">{error.message.slice(0, 100)}</span>}
    </div>
  );
}

function ReloadAction({ id, onDone }: { id: bigint; onDone: () => void }) {
  const c = useEventsCopy().dashboard;
  const [amount, setAmount] = useState('100');
  return (
    <div className="flex items-center gap-2">
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="numeric"
        className="w-20 min-h-[40px] rounded-lg border border-dark-border bg-dark-input px-3 font-mono text-sm text-white tabular-nums"
        aria-label={c.reloadPrompt}
      />
      <ActionButton functionName="reloadSlots" args={[id, Number(amount) || 0]} label={c.actions.reload} onDone={onDone} />
    </div>
  );
}

function MyEventRow({ id, creator, refreshAll }: { id: bigint; creator: `0x${string}`; refreshAll: () => void }) {
  const c = useEventsCopy();
  const bump = refreshAll;

  const { data: giveaway } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getGiveaway',
    args: [id],
    query: { staleTime: 0 },
  });
  const g = giveaway as any;

  const { data: extra } = useReadContracts({
    contracts: [
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'getParticipantsCount', args: [id] },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'slotsRemaining', args: [id] },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'getWinnersCount', args: [id] },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'effectiveEndTime', args: [id] },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'creatorRefunded', args: [id] },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'clampSurplusReclaimed', args: [id] },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'DRAW_TIMEOUT' },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'RESCUE_WINDOW' },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'CLAIM_DEADLINE' },
    ],
    query: { staleTime: 0 },
  });
  const [participants, slotsRemaining, winnersDrawn, effectiveEnd, refunded, clampReclaimed, drawTimeout, rescueWindow, claimDeadline] = (
    extra ?? []
  ).map((r) => r?.result);

  const feeTokenAddress = (g?.feeToken ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { data: meta } = useReadContracts({
    contracts: [
      { address: feeTokenAddress, abi: ERC20_META_ABI, functionName: 'decimals' },
      { address: feeTokenAddress, abi: ERC20_META_ABI, functionName: 'symbol' },
    ],
    query: { enabled: !!g },
  });

  if (!g || g.status === GiveawayV2Status.NONE || g.creator?.toLowerCase() !== creator.toLowerCase()) return null;

  const isNft = g.prizeKind === GiveawayV2PrizeKind.NFT;
  const decimals = isNft ? 6 : ((meta?.[0]?.result as number | undefined) ?? 18);
  const symbol = isNft ? 'USDC' : ((meta?.[1]?.result as string | undefined) ?? '?');
  const displayAmount = isNft ? g.declaredValue : g.prizeAmount;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const status = g.status as number;
  const statusKey = (['NONE', 'OPEN', 'CLOSED', 'DRAW_REQUESTED', 'SEED_RECEIVED', 'SETTLED', 'CANCELLED'] as const)[status];
  const dt = drawTimeout as bigint | undefined;
  const rw = rescueWindow as bigint | undefined;
  const cd = claimDeadline as bigint | undefined;

  const canClose = status === GiveawayV2Status.OPEN && effectiveEnd !== undefined && now >= (effectiveEnd as bigint);
  const canCancel = status === GiveawayV2Status.OPEN && participants !== undefined && (participants as bigint) === 0n;
  const canRequestDraw = status === GiveawayV2Status.CLOSED;
  const canCancelStuckFromClosed = status === GiveawayV2Status.CLOSED && dt !== undefined && now > (g.closedAt as bigint) + dt;
  const drawOpensAt = dt !== undefined ? (g.drawRequestedAt as bigint) + dt : undefined;
  const canExpireDraw = status === GiveawayV2Status.DRAW_REQUESTED && drawOpensAt !== undefined && rw !== undefined && now > drawOpensAt + rw;
  const canFinalize = status === GiveawayV2Status.SEED_RECEIVED;
  const canReclaimSurplus = status === GiveawayV2Status.SETTLED && isNft && g.prizeAmount > BigInt(g.winnersCount) && clampReclaimed === false;
  const canReclaimUnclaimed = status === GiveawayV2Status.SETTLED && cd !== undefined && now > (g.settledAt as bigint) + cd;
  const canClaimRefund = status === GiveawayV2Status.CANCELLED && refunded === false;
  const canReload = status === GiveawayV2Status.OPEN;

  /*
   * Há alguma transição de ciclo de vida à espera do criador?
   *
   * É a disjunção das condições acima que têm botão neste cartão: serve
   * só para decidir se o cartão lidera com "próximo passo" ou com "nada precisa
   * de você". `canReload` fica de fora de propósito — comprar mais slots é uma
   * opção enquanto a campanha corre, não um passo em falta.
   *
   * cancelStuckDraw não tem botão (decisão do owner, 12/09). Em DRAW_REQUESTED a
   * sua janela não coincide com nenhuma outra acção, por isso sai daqui; em
   * CLOSED fica, porque `canRequestDraw` já é verdadeiro sempre que ela é.
   */
  const hasLifecycleAction =
    canClose ||
    canCancel ||
    canRequestDraw ||
    canCancelStuckFromClosed ||
    canExpireDraw ||
    canFinalize ||
    canReclaimSurplus ||
    canReclaimUnclaimed ||
    canClaimRefund;

  const left = slotsRemaining !== undefined ? Number(slotsRemaining) : null;
  const taken = left !== null ? g.slotCap - left : null;
  const filledPct = taken !== null && g.slotCap > 0 ? Math.min(100, (taken / g.slotCap) * 100) : 0;
  const isOpen = status === GiveawayV2Status.OPEN;

  return (
    <article
      className={`rounded-xl border p-5 ${
        hasLifecycleAction ? 'border-brand/30 bg-dark-ticket' : 'border-dark-border bg-dark-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
              isOpen ? 'text-success' : 'text-gray-400'
            }`}
          >
            {c.list.status[statusKey as keyof typeof c.list.status] ?? statusKey}
          </p>
          <Link
            to={`/events/${id.toString()}`}
            className="mt-1 block font-mono text-xl font-bold text-white hover:text-brand transition-colors tabular-nums truncate"
          >
            {formatUnits(displayAmount, decimals)} <span className="text-sm font-normal text-gray-400">{symbol}</span>
          </Link>
          <p className="mt-1 font-mono text-xs text-gray-400 tabular-nums">#{id.toString()}</p>
        </div>
        <ShareButton
          className="shrink-0 !min-h-[36px] !min-w-[36px] border-0 text-gray-400 hover:text-gray-300"
          url={`${window.location.origin}/events/${id.toString()}`}
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-gray-400">{c.list.card.winners}</dt>
          <dd className="font-mono text-white tabular-nums">
            {winnersDrawn !== undefined ? String(winnersDrawn) : '…'}
            <span className="text-gray-400"> / {g.winnersCount}</span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">{c.detail.entriesLabel}</dt>
          <dd className="font-mono text-white tabular-nums">
            {taken !== null ? taken.toLocaleString('en-US') : '…'}
            <span className="text-gray-400"> / {g.slotCap.toLocaleString('en-US')}</span>
          </dd>
        </div>
      </dl>

      <div aria-hidden="true" className="mt-3 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full ${isOpen ? 'bg-brand/70' : 'bg-gray-700'}`}
          style={{ width: `${filledPct}%` }}
        />
      </div>

      {/* O criador quer saber o que falta fazer, não o nome do estado. */}
      <div className="mt-5 pt-4 border-t border-dark-border">
        <p
          className={`text-xs ${hasLifecycleAction ? 'text-brand' : 'text-gray-400'}`}
        >
          {hasLifecycleAction ? c.dashboard.nextStep : c.dashboard.noActions}
        </p>

        <div className="mt-3 flex flex-wrap items-start gap-2">
          {canClose && <ActionButton functionName="closeGiveaway" args={[id]} label={c.dashboard.actions.close} onDone={bump} />}
          {canCancel && <ActionButton functionName="cancelByCreator" args={[id]} label={c.dashboard.actions.cancelByCreator} onDone={bump} />}
          {canRequestDraw && <ActionButton functionName="requestDraw" args={[id]} label={c.dashboard.actions.requestDraw} onDone={bump} />}
          {canExpireDraw && (
            <ActionButton functionName="expireDrawRequest" args={[id]} label={c.dashboard.actions.expireDrawRequest} onDone={bump} />
          )}
          {canFinalize && <ActionButton functionName="finalizeWinners" args={[id]} label={c.dashboard.actions.finalize} onDone={bump} />}
          {canReclaimSurplus && (
            <ActionButton functionName="reclaimClampSurplus" args={[id]} label={c.dashboard.actions.reclaimSurplus} onDone={bump} />
          )}
          {canReclaimUnclaimed && (
            <ActionButton functionName="reclaimUnclaimedPrize" args={[id]} label={c.dashboard.actions.reclaimUnclaimed} onDone={bump} />
          )}
          {canClaimRefund && <ActionButton functionName="claimCreatorRefund" args={[id]} label={c.dashboard.actions.claimRefund} onDone={bump} />}
          {canReload && <ReloadAction id={id} onDone={bump} />}
        </div>
      </div>
    </article>
  );
}

export const EventDashboard: React.FC = () => {
  const c = useEventsCopy();
  const { address, isConnected } = useAccount();

  useEffect(() => {
    document.title = c.dashboard.metaTitle;
  }, [c]);

  const { data: lastId, isLoading } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'lastGiveawayId',
  });

  const ids = useMemo(() => {
    if (lastId === undefined) return [] as bigint[];
    const last = lastId as bigint;
    const first = last > BigInt(MAX_SCANNED) ? last - BigInt(MAX_SCANNED) + 1n : 1n;
    const out: bigint[] = [];
    for (let i = last; i >= first; i--) out.push(i);
    return out;
  }, [lastId]);

  const [refreshNonce, setRefreshNonce] = useState(0);

  return (
    <EventShell back={{ to: '/events', label: c.nav.link }} wallet>
      <h1 className="font-display font-bold text-[clamp(2.1rem,6vw,3rem)] leading-tight tracking-tight">
        {c.dashboard.title}
      </h1>
      <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-gray-400">{c.dashboard.intro}</p>

      <div className="mt-10">
        {!isConnected && <p className="text-gray-400">{c.dashboard.connectPrompt}</p>}

        {isConnected && isLoading && (
          <p className="flex items-center gap-3 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" /> {c.dashboard.loading}
          </p>
        )}

        {isConnected && !isLoading && address && (
          <div key={refreshNonce} className="grid gap-4 sm:grid-cols-2">
            {ids.map((id) => (
              <MyEventRow key={id.toString()} id={id} creator={address} refreshAll={() => setRefreshNonce((n) => n + 1)} />
            ))}
          </div>
        )}
      </div>
    </EventShell>
  );
};
