import React, { useMemo, useEffect, useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, RAFFLE_ABI, USDC_ABI, USERNAME_ABI, RoundState } from '../constants';
import { formatUnits } from 'viem';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { ClaimPanel, PreviousRound } from '../components/RoundPanels';
import { RecentWinners } from '../components/RecentWinners';
import { Clock, Ticket, Info, AlertTriangle, CheckCircle2, ExternalLink, Sprout } from 'lucide-react';
import { useAppCopy } from './app.i18n';

const ARBISCAN = 'https://arbiscan.io/address/';

/** Último minuto: o relógio do talão passa a âmbar. Puramente visual. */
const CLOSING_WINDOW_SECONDS = 60;

export const Raffle: React.FC = () => {
  const { address, isConnected } = useAccount();
  const c = useAppCopy();
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
    if (state === undefined) return c.raffle.statusLoading;
    if (state === RoundState.OPEN) return isTransitioning ? c.raffle.statusEnded : c.raffle.statusLive;
    if (state === RoundState.DRAWING) return c.raffle.statusDrawing;
    if (state === RoundState.SETTLED) return c.raffle.statusSettled;
    if (state === RoundState.CANCELLED) return c.raffle.statusCancelled;
    return c.raffle.statusIdle;
  }, [state, isTransitioning, c]);

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
      ? c.raffle.ctaRegisterFirst
      : alreadyEntered
        ? c.raffle.ctaAlreadyEntered
        : fallback;

  /*
   * Derivações só de apresentação, a partir do estado que já existe acima.
   * Nenhuma delas lê nada: o relógio é o mesmo, a ronda é a mesma.
   */
  const closingSoon = canBuy && timeLeft > 0 && timeLeft <= CLOSING_WINDOW_SECONDS;
  const qty = parseInt(ticketAmount) || 0;
  const holder = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';

  /** Rótulo impresso no talão onde um bilhete de papel traria a data do sorteio. */
  const drawLabel = isTransitioning
    ? c.raffle.ticket.drawing
    : closingSoon
      ? c.raffle.ticket.closing
      : c.raffle.ticket.drawIn;

  return (
    <div className="max-w-3xl mx-auto pt-2 pb-8">

      {/* ============ O PRÉMIO: o que uma lotaria anuncia primeiro ============ */}

      <div className="text-center">
        <p className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.16em] uppercase text-gray-400">
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full ${
              isTransitioning ? 'bg-gray-600' : 'bg-success animate-pulse'
            }`}
          />
          {roundId !== undefined && (
            <span className="text-gray-400">
              {c.raffle.ticket.round} {roundId.toString()}
            </span>
          )}
          {statusLabel}
        </p>

        <h1 className="mt-5 font-mono font-bold text-brand tracking-tighter leading-[0.9] tabular-nums text-[clamp(3.5rem,17vw,7.5rem)]">
          {formatUnits(totalPool, 6)}
        </h1>
        <p className="mt-1 font-display text-2xl font-bold tracking-wide text-gray-400">USDC</p>
        <p className="mt-3 text-sm text-gray-400">{c.raffle.currentPrizePool}</p>

        {seed > 0n && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-success/25 bg-success/[0.06] px-3 py-1.5 max-w-full">
            <Sprout className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            {/* "Seeded round" é selo de marca: fica em inglês nos três idiomas. */}
            <span className="font-mono text-[11px] font-medium text-success truncate">
              Seeded round · {formatUnits(seed, 6)} {c.raffle.seededCarriedIn}
            </span>
          </p>
        )}
      </div>

      {/* ==================== O BILHETE ==================== */}

      <section aria-label={c.raffle.ticket.title} className="mt-10 sm:mt-12 mx-auto max-w-[30rem]">
        <div className="rounded-2xl border border-brand/20 bg-dark-ticket shadow-[0_1px_0_0_rgba(245,158,11,0.06)_inset]">

          {/* Cabeça do talão: marca impressa à esquerda, série à direita. */}
          <div className="flex items-baseline justify-between gap-3 px-6 pt-5">
            <span className="font-display text-lg font-bold tracking-tight text-white">Instant Win</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400 tabular-nums">
              {c.raffle.ticket.round} {roundId?.toString() ?? '—'}
            </span>
          </div>

          <div className="px-6 pt-4 pb-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
              {c.raffle.ticket.holder}
            </p>
            {needsUsername ? (
              <Link
                to="/play/identity"
                className="mt-1 inline-flex items-center gap-2 font-mono text-base text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand"
              >
                {c.raffle.ticket.holderNone}
              </Link>
            ) : (
              <p className="mt-1 font-mono text-base text-white tabular-nums">{holder}</p>
            )}
          </div>

          {/* O rasgão. As meias-luas mordem as duas margens do talão. */}
          <div className="ticket-tear" />

          <div className="px-6 pt-6 pb-6">

            {alreadyEntered && (
              <p className="mb-5 flex items-start gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0 text-gray-300">
                  <span className="font-bold text-white">{c.raffle.alreadyEnteredTitle}</span>{' '}
                  {((myTickets ?? 0n) as bigint).toString()}{' '}
                  {((myTickets ?? 0n) as bigint) === 1n ? c.raffle.ticketOne : c.raffle.ticketMany}{' '}
                  {c.raffle.inRound} {roundId?.toString()}. {c.raffle.onePerWallet}
                </span>
              </p>
            )}

            {needsUsername && (
              <p className="mb-5 flex items-start gap-3 text-sm">
                <AlertTriangle className="w-4 h-4 text-brand shrink-0 mt-0.5" aria-hidden="true" />
                <span className="min-w-0 text-gray-300">
                  <span className="font-bold text-white">{c.raffle.needUsernameTitle}</span>{' '}
                  {c.raffle.needUsernameBody}{' '}
                  <Link to="/play/identity" className="text-brand font-medium underline underline-offset-2">
                    {c.raffle.needUsernameLink}
                  </Link>
                  .
                </span>
              </p>
            )}

            {/* Quantidade: o número que o jogador escreve no bilhete. */}
            <div className="flex items-end justify-between gap-4 border-b border-dark-border pb-5">
              <label className="min-w-0">
                <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
                  {c.raffle.tickets}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={ticketAmount}
                  onChange={(e) => setTicketAmount(e.target.value)}
                  aria-label={c.raffle.ariaTicketCount}
                  className="mt-1 w-full bg-transparent font-mono text-5xl font-bold text-white outline-none tabular-nums placeholder:text-gray-600 focus-visible:text-brand disabled:text-gray-400"
                  placeholder="0"
                  min="1"
                  max="100"
                  disabled={!canPurchase}
                />
              </label>
              <p className="shrink-0 pb-3 font-mono text-[11px] text-gray-400">{c.raffle.priceLine}</p>
            </div>

            {/* Total e chances, lado a lado como num talão. */}
            <dl className="grid grid-cols-2 gap-4 py-5">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
                  {c.raffle.ticket.total}
                </dt>
                <dd className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                  {formatUnits(totalCost, 6)}{' '}
                  <span className="text-xs font-normal text-gray-400">USDC</span>
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
                  {c.raffle.yourOdds}
                </dt>
                <dd className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                  {isConnected && !needsUsername
                    ? `${(Number((oddsBps ?? 0n) as bigint) / 100).toFixed(1)}%`
                    : '—'}
                </dd>
              </div>
            </dl>

            {needsApproval() ? (
              <Button
                variant="connect"
                className="w-full min-h-[56px] rounded-xl text-base"
                onClick={handleApprove}
                isLoading={isApproving || approvingTx}
                disabled={!isConnected || !canPurchase}
              >
                {ctaLabel(`${c.raffle.ctaApprovePre} ${formatUnits(totalCost, 6)} USDC`)}
              </Button>
            ) : (
              <Button
                variant="connect"
                className="w-full min-h-[56px] rounded-xl text-base"
                onClick={handleBuy}
                isLoading={isBuying || buyingTx}
                disabled={!isConnected || !canPurchase}
              >
                {ctaLabel(
                  !canBuy
                    ? c.raffle.ctaWaitNextRound
                    : `${c.raffle.ctaBuyPre} ${ticketAmount} ${
                        qty === 1 ? c.raffle.ticketOne : c.raffle.ticketMany
                      }`,
                )}
              </Button>
            )}

            {/* O relógio, onde um bilhete de papel traz a data do sorteio. */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
                <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {drawLabel}
              </span>
              <span
                className={`font-mono text-xl font-bold tabular-nums ${
                  isTransitioning
                    ? 'text-gray-400'
                    : closingSoon
                      ? 'text-brand animate-pulse'
                      : 'text-white'
                }`}
              >
                {isTransitioning ? '00:00:00' : formatTime(timeLeft)}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-gray-400">
          {c.raffle.ticket.footnote}
        </p>
      </section>

      {/* Quem mais está nesta ronda, e o que a próxima já tem dentro. */}
      <div className="mt-8 mx-auto max-w-[30rem] space-y-2">
        <p className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-dark-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-gray-400">
            <Ticket className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />
            {c.raffle.tickets}
          </span>
          <span className="font-mono text-gray-300 tabular-nums">
            {ticketCount.toString()}
            <span className="text-gray-400">
              {' / '}
              {participantCount.toString()}{' '}
              {Number(participantCount) === 1 ? c.raffle.playerOne : c.raffle.playerMany}
            </span>
          </span>
        </p>

        {((pendingCarry ?? 0n) as bigint) > 0n && (
          <p className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-dark-card px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-gray-400">
              <Sprout className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
              {c.raffle.nextRoundStartsWith}
            </span>
            <span className="font-mono font-bold text-brand tabular-nums">
              {formatUnits((pendingCarry ?? 0n) as bigint, 6)} USDC
            </span>
          </p>
        )}

        <p className="pt-1 text-center text-xs text-gray-400">{c.raffle.ticket.oddsHint}</p>
      </div>

      {/* ================= O QUE ACONTECEU E O QUE É SEU ================= */}

      <div className="mt-12 space-y-4 sm:space-y-5">
        <ClaimPanel currentRoundId={roundId} />
        <PreviousRound currentRoundId={roundId} />
        <RecentWinners />

        {/* A prova. Uma lotaria em papel não tem esta secção. */}
        <section className="rounded-xl border border-dark-border bg-dark-card p-5 sm:p-7">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white">
            {c.raffle.roundFacts}
          </h2>
          <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-gray-400">
            {c.raffle.proof.line}
          </p>

          <dl className="mt-6 divide-y divide-dark-border border-y border-dark-border">
            {/* Valores de protocolo (Arbitrum One, Chainlink VRF) não se traduzem. */}
            {([
              [c.raffle.factNetwork, 'Arbitrum One'],
              [c.raffle.factRandomness, 'Chainlink VRF'],
              [c.raffle.factRounds, c.raffle.factRoundsValue],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-3">
                <dt className="text-sm text-gray-400">{k}</dt>
                <dd className="font-mono text-sm text-white">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
            {c.raffle.prizeSplit}
          </p>
          <dl className="mt-2 space-y-1.5">
            {([
              [c.raffle.first, 50n],
              [c.raffle.second, 18n],
              [c.raffle.third, 7n],
            ] as const).map(([label, pct]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="text-gray-400">
                  {label} <span className="font-mono text-xs text-gray-400">{pct.toString()}%</span>
                </dt>
                <dd className="font-mono font-bold text-brand tabular-nums">
                  {formatUnits((totalPool * pct) / 100n, 6)} USDC
                </dd>
              </div>
            ))}
          </dl>

          <a
            href={`${ARBISCAN}${CONTRACTS.RAFFLE_MANAGER}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 min-h-[44px] text-sm font-medium text-success hover:text-success-hover transition-colors"
          >
            {c.raffle.proof.verifyCta}
            <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
          </a>
        </section>

        <p className="flex items-start gap-3 px-1 text-xs leading-relaxed text-gray-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="max-w-[70ch]">{c.raffle.disclaimer}</span>
        </p>
      </div>
    </div>
  );
};
