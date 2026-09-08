import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status, GiveawayV2PrizeKind } from '../lib/giveaway-v2-abi';
import { Button } from '../components/Button';
import { ShareButton } from '../components/ShareButton';
import { ConnectWallet } from '../components/ConnectWallet';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { LangSwitch } from '../components/LangSwitch';
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
        className="text-xs px-3 py-2"
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
      {error && <span className="text-[10px] text-red-400 max-w-[200px]">{error.message.slice(0, 100)}</span>}
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
        className="w-20 min-h-[36px] rounded border border-dark-border bg-dark-input px-2 text-white text-xs font-mono"
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
  const canCancelStuckFromRequested =
    status === GiveawayV2Status.DRAW_REQUESTED &&
    drawOpensAt !== undefined &&
    rw !== undefined &&
    now > drawOpensAt &&
    now <= drawOpensAt + rw;
  const canExpireDraw = status === GiveawayV2Status.DRAW_REQUESTED && drawOpensAt !== undefined && rw !== undefined && now > drawOpensAt + rw;
  const canFinalize = status === GiveawayV2Status.SEED_RECEIVED;
  const canReclaimSurplus = status === GiveawayV2Status.SETTLED && isNft && g.prizeAmount > BigInt(g.winnersCount) && clampReclaimed === false;
  const canReclaimUnclaimed = status === GiveawayV2Status.SETTLED && cd !== undefined && now > (g.settledAt as bigint) + cd;
  const canClaimRefund = status === GiveawayV2Status.CANCELLED && refunded === false;
  const canReload = status === GiveawayV2Status.OPEN;

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Link to={`/events/${id.toString()}`} className="font-mono text-sm text-gray-300 hover:text-white">
          #{id.toString()} · {formatUnits(displayAmount, decimals)} {symbol}
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-300 border border-dark-border rounded px-2 py-0.5">
            {c.list.status[statusKey as keyof typeof c.list.status] ?? statusKey}
          </span>
          <ShareButton className="!min-h-[32px] !min-w-[32px] border-0" url={`${window.location.origin}/events/${id.toString()}`} />
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {c.list.card.winners}: {winnersDrawn !== undefined ? String(winnersDrawn) : '…'}/{g.winnersCount} · {c.list.card.slots}:{' '}
        {slotsRemaining !== undefined ? String(slotsRemaining) : '…'}/{g.slotCap}
      </p>
      <div className="flex flex-wrap gap-2">
        {canReload && <ReloadAction id={id} onDone={bump} />}
        {canClose && <ActionButton functionName="closeGiveaway" args={[id]} label={c.dashboard.actions.close} onDone={bump} />}
        {canCancel && <ActionButton functionName="cancelByCreator" args={[id]} label={c.dashboard.actions.cancelByCreator} onDone={bump} />}
        {canRequestDraw && <ActionButton functionName="requestDraw" args={[id]} label={c.dashboard.actions.requestDraw} onDone={bump} />}
        {canCancelStuckFromClosed && (
          <ActionButton functionName="cancelStuckDraw" args={[id]} label={c.dashboard.actions.cancelStuckDraw} onDone={bump} />
        )}
        {canCancelStuckFromRequested && (
          <ActionButton functionName="cancelStuckDraw" args={[id]} label={c.dashboard.actions.cancelStuckDraw} onDone={bump} />
        )}
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
      </div>
    </div>
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
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <header className="sticky top-0 z-20 border-b border-dark-border/60 bg-black/70 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 min-h-[64px] flex items-center justify-between gap-3">
          <Link to="/events" className="text-sm text-gray-400 hover:text-white">
            ← {c.nav.link}
          </Link>
          <div className="flex items-center gap-3">
            <PublicNavLinks />
            <LangSwitch />
            <ConnectWallet />
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10 container mx-auto px-4 sm:px-6 max-w-3xl py-10 space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl mb-2">{c.dashboard.title}</h1>
          <p className="text-gray-400">{c.dashboard.intro}</p>
        </div>

        {!isConnected && <p className="text-gray-500">{c.dashboard.connectPrompt}</p>}

        {isConnected && isLoading && (
          <div className="flex items-center gap-3 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> {c.dashboard.loading}
          </div>
        )}

        {isConnected && !isLoading && address && (
          <div key={refreshNonce} className="space-y-4">
            {ids.map((id) => (
              <MyEventRow key={id.toString()} id={id} creator={address} refreshAll={() => setRefreshNonce((n) => n + 1)} />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 text-center">
          <PublicFooterNav />
        </div>
      </footer>
    </div>
  );
};
