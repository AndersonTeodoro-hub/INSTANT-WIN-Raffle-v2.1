import React, { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, USERNAME_ABI, USDC_ABI, RAFFLE_ABI, RoundState } from '../constants';
import { formatUnits } from 'viem';
import { User, Wallet, Coins, Ticket, ArrowRight, Zap, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAppCopy } from './app.i18n';

export const Dashboard: React.FC = () => {
  const { address } = useAccount();
  const c = useAppCopy();

  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { data: username } = useReadContract({
    address: CONTRACTS.USERNAME_REGISTRY,
    abi: USERNAME_ABI,
    functionName: 'walletToUsername',
    args: address ? [address] : undefined,
  });

  const { data: usdcBalance } = useReadContract({
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // O V3 devolve os 12,5% ex-investidores ao pool: este é o valor com que a
  // próxima ronda vai abrir. Substitui o cartão "Shares", que já não existe.
  const { data: pendingCarry } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'pendingCarry',
    query: { refetchInterval: 15000 },
  });

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

  // RaffleManagerV2.getCurrentRound() → (roundId, state, endTime, participantCount, totalTickets, pool)
  const roundId = currentRoundData?.[0] as bigint | undefined;
  const state = currentRoundData?.[1] as number | undefined;
  const endTime = currentRoundData?.[2] as bigint | undefined;
  const ticketCount = (currentRoundData?.[4] ?? 0n) as bigint;
  const totalPool = (currentRoundData?.[5] ?? 0n) as bigint;
  const isOpen = state === RoundState.OPEN;

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

  const formatTime = (seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const MiniCard = ({ label, value, icon: Icon, to }: any) => (
    <Link
      to={to}
      className="bg-dark-card border border-dark-border p-4 rounded-xl flex items-center gap-4 hover:border-gray-600 transition-colors group"
    >
      <Icon className="w-5 h-5 shrink-0 text-gray-400 group-hover:text-white transition-colors" />
      <div>
        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{label}</p>
        <p className="text-white font-bold truncate max-w-[120px]">{value}</p>
      </div>
    </Link>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniCard
          label={c.dashboard.identity}
          value={username ? `@${username}` : c.dashboard.register}
          icon={User}
          to="/play/identity"
        />
        <MiniCard
          label={c.dashboard.wallet}
          value={usdcBalance ? `${formatUnits(usdcBalance as bigint, 6)} USDC` : '0.00'}
          icon={Wallet}
          to="/play"
        />
        <MiniCard
          label={c.dashboard.nextPool}
          value={`${formatUnits((pendingCarry ?? 0n) as bigint, 6)} USDC`}
          icon={Coins}
          to="/play/raffle"
        />
        <MiniCard label={c.dashboard.network} value="Arbitrum One" icon={Zap} to="/play" />
      </div>

      <div className="relative rounded-xl overflow-hidden border border-brand/20">
        <div className="absolute inset-0 bg-dark-card z-0"></div>
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 z-0 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 z-0 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center justify-center py-10 px-4 sm:py-16 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 border border-gray-700 px-4 py-1.5 rounded-lg mb-8 animate-fade-in-up">
            <span className="relative flex h-3 w-3">
              <span
                className={`absolute inline-flex h-full w-full rounded-full bg-gray-400 opacity-75 ${
                  !isTransitioning && 'animate-ping'
                }`}
              ></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isTransitioning ? 'bg-gray-600' : 'bg-gray-400'}`}></span>
            </span>
            <span className={`font-mono text-xs font-bold tracking-[0.2em] uppercase ${isTransitioning ? 'text-gray-500' : 'text-gray-300'}`}>
              {isTransitioning
                ? c.dashboard.finalizing
                : `${c.dashboard.roundPre}${roundId?.toString() ?? '...'}${c.dashboard.roundPost}`}
            </span>
          </div>

          {/* clamp() em vez de text-7xl: 8 dígitos mono a 72px transbordam a 360px. */}
          <h1 className="font-mono font-bold text-white leading-none tracking-tighter tabular-nums mb-4 drop-shadow-2xl text-[clamp(2.75rem,15vw,10rem)]">
            {isTransitioning ? (
              <span className="animate-pulse text-gray-400 text-[clamp(1.75rem,9vw,6rem)]">{c.dashboard.closing}</span>
            ) : (
              formatTime(timeLeft)
            )}
          </h1>

          <p className="font-mono text-gray-500 text-xs sm:text-base uppercase tracking-widest mb-8 sm:mb-10">
            {isTransitioning ? c.dashboard.endedAwaitingClose : c.dashboard.timeRemaining}
          </p>

          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-12 mb-12 bg-black/30 p-6 rounded-xl border border-white/5 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-xs text-gray-500 font-bold uppercase mb-1">{c.dashboard.totalPrizePool}</p>
              <p className="font-mono text-4xl font-bold text-brand tabular-nums">
                {formatUnits(totalPool as bigint, 6)} <span className="text-lg text-gray-600">USDC</span>
              </p>
            </div>
            <div className="w-px h-12 bg-white/10 hidden md:block"></div>
            <div className="text-center">
              <p className="text-xs text-gray-500 font-bold uppercase mb-1">{c.dashboard.ticketsSold}</p>
              <p className="text-4xl font-bold text-white flex items-center gap-2 justify-center">
                <Ticket className="w-6 h-6 text-purple-500" />
                {ticketCount.toString()}
              </p>
            </div>
          </div>

          <div className="w-full max-w-md">
            <Link to="/play/raffle">
              <Button
                variant="connect"
                disabled={isTransitioning}
                className="w-full h-20 text-xl md:text-2xl rounded-lg transition-colors relative overflow-hidden group disabled:opacity-50"
              >
                <span className="relative z-10 flex items-center gap-3">
                  {isTransitioning ? (
                    <>
                      <Loader2 className="animate-spin w-6 h-6" /> {c.dashboard.processing}
                    </>
                  ) : (
                    <>
                      {c.dashboard.enterRound} <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
                {!isTransitioning && (
                  <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent z-0"></div>
                )}
              </Button>
            </Link>
            <p className="mt-4 text-xs text-gray-500">{c.dashboard.vrfNote}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
