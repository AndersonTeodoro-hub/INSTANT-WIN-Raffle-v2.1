import React, { useMemo, useEffect, useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, RAFFLE_ABI, USDC_ABI, USERNAME_ABI, RoundState } from '../constants';
import { formatUnits } from 'viem';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { ClaimPanel, PreviousRound } from '../components/RoundPanels';
import { RecentWinners } from '../components/RecentWinners';
import { Clock, Ticket, Activity, Info, AlertTriangle, CheckCircle2, Percent, Sprout } from 'lucide-react';

export const Raffle: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [ticketAmount, setTicketAmount] = useState<string>('1');
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const pollInterval = useMemo(() => {
    if (isTransitioning) return 1000;
    if (timeLeft <= 10) return 1000;
    return 5000;
  }, [timeLeft, isTransitioning]);

  const { data: currentRoundData, refetch: refetchRound } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'getCurrentRound',
    query: {
      refetchInterval: pollInterval,
      gcTime: 0,
      staleTime: 0,
    },
  });

  // RaffleManagerV3.getCurrentRound() → (roundId, state, endTime, buyers, totalTickets, pool)
  const roundId = currentRoundData?.[0] as bigint | undefined;
  const state = currentRoundData?.[1] as number | undefined;
  const endTime = currentRoundData?.[2] as bigint | undefined;
  const participantCount = (currentRoundData?.[3] ?? 0n) as bigint;
  const ticketCount = (currentRoundData?.[4] ?? 0n) as bigint;
  const totalPool = (currentRoundData?.[5] ?? 0n) as bigint;
  const isOpen = state === RoundState.OPEN;
  const canBuy = isOpen && !isTransitioning;

  // A ronda corrente é sempre OPEN (uma nova abre no fecho da anterior); o
  // caso real a distinguir é OPEN-mas-expirada, à espera de closeRound().
  const statusLabel = useMemo(() => {
    if (state === undefined) return 'Loading Round';
    if (state === RoundState.OPEN) return isTransitioning ? 'Round Ended · Awaiting Close' : 'Live Pool Arbitrum';
    if (state === RoundState.DRAWING) return 'Drawing Winners…';
    if (state === RoundState.SETTLED) return 'Round Settled';
    if (state === RoundState.CANCELLED) return 'Round Cancelled · Refunds Open';
    return 'Idle';
  }, [state, isTransitioning]);

  const ticketPrice = 1_000_000n;
  const totalCost = useMemo(() => {
    const qty = parseInt(ticketAmount) || 0;
    return BigInt(qty) * ticketPrice;
  }, [ticketAmount]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.RAFFLE_MANAGER] : undefined,
  });

  // Sem username o contrato reverte com NoUsername(). Ler antes de deixar comprar,
  // em vez de mandar o jogador contra um revert.
  const { data: hasName, refetch: refetchHasName } = useReadContract({
    address: CONTRACTS.USERNAME_REGISTRY,
    abi: USERNAME_ABI,
    functionName: 'hasUsername',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // V3: uma compra por wallet por ronda. ticketsOf > 0 significa "já entrou".
  const { data: myTickets, refetch: refetchMyTickets } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'ticketsOf',
    args: roundId !== undefined && address ? [roundId, address] : undefined,
    query: { enabled: roundId !== undefined && !!address, refetchInterval: 10000 },
  });

  const { data: oddsBps, refetch: refetchOdds } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'winOddsBps',
    args: roundId !== undefined && address ? [roundId, address] : undefined,
    query: { enabled: roundId !== undefined && !!address, refetchInterval: 10000 },
  });

  const { data: pendingCarry } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'pendingCarry',
    query: { refetchInterval: 15000 },
  });

  const needsUsername = isConnected && hasName === false;
  const alreadyEntered = ((myTickets ?? 0n) as bigint) > 0n;
  /** Ronda aberta E o jogador está em condições de entrar. */
  const canPurchase = canBuy && !needsUsername && !alreadyEntered;

  // O seed é derivável, tal como no contrato: pool menos o valor dos bilhetes.
  // Evita uma chamada extra a seedOf().
  const seed = totalPool > ticketCount * ticketPrice ? totalPool - ticketCount * ticketPrice : 0n;

  // Trocar de conta no MetaMask (accountsChanged) muda `address`; forçar a
  // re-leitura de tudo o que é por-wallet para não ficar estado da conta anterior.
  useEffect(() => {
    refetchAllowance();
    refetchHasName();
    refetchMyTickets();
    refetchOdds();
  }, [address, refetchAllowance, refetchHasName, refetchMyTickets, refetchOdds]);

  const { writeContract: writeApprove, data: approveHash, isPending: isApproving } = useWriteContract();
  const { writeContract: writeBuy, data: buyHash, isPending: isBuying } = useWriteContract();

  const { isLoading: approvingTx } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: buyingTx, isSuccess: boughtSuccess } = useWaitForTransactionReceipt({ hash: buyHash });

  useEffect(() => {
    if (boughtSuccess) {
      // Multiple refetches to beat RPC cache
      refetchRound();
      refetchAllowance();
      refetchMyTickets();
      refetchOdds();
      setTimeout(() => refetchRound(), 1000);
      setTimeout(() => {
        refetchRound();
        refetchMyTickets();
        refetchOdds();
      }, 3000);
      setTimeout(() => refetchRound(), 5000);
      setTicketAmount('1');
    }
  }, [boughtSuccess, refetchRound, refetchAllowance, refetchMyTickets, refetchOdds]);

  useEffect(() => {
    if (!approvingTx && approveHash) refetchAllowance();
  }, [approvingTx, approveHash, refetchAllowance]);

  useEffect(() => {
    if (endTime === undefined) return;

    const endTimeSec = Number(endTime);

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = endTimeSec - now;

      if (diff <= 0 || !isOpen) {
        setTimeLeft(0);
        setIsTransitioning(true);
        setTimeout(() => refetchRound(), 1500);
      } else {
        setIsTransitioning(false);
        setTimeLeft(diff);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endTime, isOpen, refetchRound]);

  const handleApprove = () => {
    if (!ticketAmount || totalCost <= 0n) return;
    writeApprove({
      address: CONTRACTS.USDC,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [CONTRACTS.RAFFLE_MANAGER, totalCost],
    });
  };

  const handleBuy = () => {
    const qty = parseInt(ticketAmount) || 0;
    if (qty <= 0) return;

    writeBuy({
      address: CONTRACTS.RAFFLE_MANAGER,
      abi: RAFFLE_ABI,
      functionName: 'buyTickets',
      args: [BigInt(qty)],
    });
  };

  const formatTime = (seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const needsApproval = () => {
    if (!ticketAmount || !allowance || totalCost <= 0n) return true;
    return (allowance as bigint) < totalCost;
  };

  const ctaLabel = (fallback: string) =>
    needsUsername
      ? 'Register a Username First'
      : alreadyEntered
        ? 'Already Entered This Round'
        : fallback;

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-8">

      {/* ================= PRIMEIRA DOBRA ================= */}

      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 bg-dark-input border border-dark-border px-3 py-1.5 rounded-full mb-4">
          <span className={`w-2 h-2 rounded-full ${isTransitioning ? 'bg-gray-500' : 'bg-brand animate-pulse'}`} />
          <span className={`font-mono text-[10px] sm:text-xs font-bold tracking-widest uppercase ${isTransitioning ? 'text-gray-500' : 'text-brand'}`}>
            {statusLabel}
          </span>
        </div>

        <p className="font-mono text-[10px] sm:text-xs text-gray-500 uppercase tracking-[0.2em] mb-1">
          Current Prize Pool
        </p>

        {/* Herói absoluto. clamp() escala de 360px ao desktop sem overflow. */}
        <h1 className="font-mono font-bold text-white tracking-tighter leading-none tabular-nums text-[clamp(3.25rem,16vw,7rem)]">
          {formatUnits(totalPool, 6)}
          <span className="block font-sans text-base sm:text-xl text-gray-600 font-normal tracking-normal mt-2">
            USDC
          </span>
        </h1>

        {seed > 0n && (
          <div className="mt-4 inline-flex items-center gap-2 border border-success/30 bg-success/5 px-3 py-1.5 rounded-full max-w-full">
            <Sprout className="w-3 h-3 text-success shrink-0" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-success truncate">
              Seeded round · {formatUnits(seed, 6)} carried in
            </span>
          </div>
        )}
      </div>

      {/* Relógio e bilhetes, colados ao bloco de compra */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-dark-card border border-dark-border rounded-2xl px-3 py-3 flex flex-col items-center">
          <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-gray-500 mb-1">
            <Clock className="w-3 h-3 shrink-0" /> Time left
          </span>
          <span className="font-mono text-xl sm:text-2xl font-bold text-white tabular-nums">
            {isTransitioning ? <span className="text-brand text-sm animate-pulse">CLOSING…</span> : formatTime(timeLeft)}
          </span>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-2xl px-3 py-3 flex flex-col items-center">
          <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase text-gray-500 mb-1">
            <Ticket className="w-3 h-3 shrink-0" /> Tickets
          </span>
          <span className="font-mono text-xl sm:text-2xl font-bold text-white tabular-nums">
            {ticketCount.toString()}
          </span>
          <span className="font-mono text-[10px] text-gray-500">
            {participantCount.toString()} player{Number(participantCount) !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Bloco de compra — CTA único e dominante */}
      <section className="bg-dark-card border border-dark-border rounded-3xl p-5 sm:p-8 mb-3">
        {needsUsername && (
          <div className="mb-4 flex items-start gap-3 bg-dark-input border border-brand/30 rounded-2xl p-4">
            <AlertTriangle className="w-5 h-5 text-brand shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              <p className="text-white font-bold">You need a username to enter</p>
              <p className="text-gray-400">
                Every ticket is tied to a registered identity.{' '}
                <Link to="/play/identity" className="text-brand font-bold underline hover:text-amber-400">
                  Register one here
                </Link>
                .
              </p>
            </div>
          </div>
        )}

        {alreadyEntered && (
          <div className="mb-4 flex items-start gap-3 bg-dark-input border border-success/30 rounded-2xl p-4">
            <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              <p className="text-white font-bold">You already entered this round</p>
              <p className="text-gray-400">
                {((myTickets ?? 0n) as bigint).toString()} ticket
                {((myTickets ?? 0n) as bigint) !== 1n ? 's' : ''} in round {roundId?.toString()}. One entry
                per wallet per round.
              </p>
            </div>
          </div>
        )}

        <div className="bg-dark-input rounded-2xl p-4 sm:p-6 border border-dark-border mb-4">
          <div className="flex justify-between items-center gap-2 mb-3">
            <span className="font-mono text-[10px] sm:text-xs font-bold text-gray-500 uppercase">
              1 ticket = 1 USDC
            </span>
            <span className="font-mono text-[10px] sm:text-xs font-bold text-brand uppercase tabular-nums">
              Cost: {formatUnits(totalCost, 6)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="number"
              inputMode="numeric"
              value={ticketAmount}
              onChange={(e) => setTicketAmount(e.target.value)}
              aria-label="Number of tickets"
              className="bg-transparent font-mono text-3xl sm:text-4xl font-bold text-white outline-none w-full min-w-0 tabular-nums placeholder:text-gray-800"
              placeholder="0"
              min="1"
              max="100"
              disabled={!canPurchase}
            />
            <span className="font-mono text-xs font-bold text-white bg-black/50 px-3 py-2 rounded border border-dark-border shrink-0">
              TICKETS
            </span>
          </div>
        </div>

        {needsApproval() ? (
          <Button
            variant="primary"
            className="w-full min-h-[56px] py-4 text-base sm:text-lg"
            onClick={handleApprove}
            isLoading={isApproving || approvingTx}
            disabled={!isConnected || !canPurchase}
          >
            {ctaLabel(`Approve ${formatUnits(totalCost, 6)} USDC`)}
          </Button>
        ) : (
          <Button
            variant="primary"
            className="w-full min-h-[56px] py-4 text-base sm:text-lg"
            onClick={handleBuy}
            isLoading={isBuying || buyingTx}
            disabled={!isConnected || !canPurchase}
          >
            {ctaLabel(
              !canBuy
                ? 'Wait for Next Round'
                : `Buy ${ticketAmount} Ticket${parseInt(ticketAmount) !== 1 ? 's' : ''}`,
            )}
          </Button>
        )}

        {/* Odds live, imediatamente a seguir ao CTA */}
        {isConnected && !needsUsername && (
          <div className="mt-4 flex items-center justify-between gap-3 bg-dark-input border border-dark-border rounded-2xl px-4 py-3 min-h-[44px]">
            <span className="flex items-center gap-2 font-mono text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider">
              <Percent className="w-3 h-3 shrink-0" /> Your odds
            </span>
            <span className="font-mono text-lg sm:text-xl font-bold text-brand tabular-nums">
              {(Number((oddsBps ?? 0n) as bigint) / 100).toFixed(1)}%
            </span>
          </div>
        )}
      </section>

      {/* Gancho: a próxima ronda já tem dinheiro dentro */}
      {((pendingCarry ?? 0n) as bigint) > 0n && (
        <div className="mb-6 flex items-center gap-3 bg-dark-card border border-dark-border rounded-2xl px-4 py-3">
          <Sprout className="w-4 h-4 text-success shrink-0" />
          <p className="font-mono text-xs sm:text-sm text-gray-300">
            Next round already starts with{' '}
            <span className="text-brand font-bold tabular-nums">
              {formatUnits((pendingCarry ?? 0n) as bigint, 6)} USDC
            </span>
          </p>
        </div>
      )}

      {/* ================= ABAIXO DA DOBRA ================= */}

      <div className="space-y-4 sm:space-y-6">
        <RecentWinners />

        <ClaimPanel currentRoundId={roundId} />
        <PreviousRound currentRoundId={roundId} />

        <section className="bg-dark-card border border-dark-border rounded-3xl p-5 sm:p-8">
          <h3 className="font-display text-2xl sm:text-3xl font-bold text-white uppercase tracking-tight mb-5 flex items-center gap-2">
            <Activity className="w-5 h-5 text-success shrink-0" /> Round facts
          </h3>

          <dl className="space-y-4">
            {([
              ['Network', 'Arbitrum One'],
              ['Randomness', 'Chainlink VRF'],
              ['Rounds', '30 min'],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between items-center gap-3">
                <dt className="font-mono text-xs sm:text-sm text-gray-500 uppercase tracking-wider">{k}</dt>
                <dd className="font-mono text-sm text-white font-bold text-right">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 bg-dark-input rounded-xl p-4 border border-dark-border">
            <p className="font-mono text-[10px] text-gray-500 mb-3 font-bold uppercase tracking-widest">
              Prize split
            </p>
            <div className="space-y-2">
              {([
                ['1st', 50n, 'text-brand'],
                ['2nd', 18n, 'text-white'],
                ['3rd', 7n, 'text-white'],
              ] as const).map(([label, pct, cls]) => (
                <div key={label} className="flex justify-between gap-3 text-sm">
                  <span className="font-mono text-gray-400">
                    {label} ({pct.toString()}%)
                  </span>
                  <span className={`font-mono tabular-nums ${cls}`}>
                    {formatUnits((totalPool * pct) / 100n, 6)} USDC
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <p className="flex items-start gap-2 font-mono text-[11px] leading-relaxed text-gray-600 px-1">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Prizes are credited on-chain the moment a round settles and stay yours until you claim
            them. Draws are settled by Chainlink VRF on Arbitrum One. 100% on-chain.
          </span>
        </p>
      </div>
    </div>
  );
};
