import React, { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, USERNAME_ABI, USDC_ABI, RAFFLE_ABI, SHARES_ABI } from '../constants';
import { formatUnits } from 'viem';
import { User, Wallet, PieChart, Ticket, ArrowRight, Zap, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';

export const Dashboard: React.FC = () => {
  const { address } = useAccount();

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

  const { data: sharesBalance } = useReadContract({
    address: CONTRACTS.SHARES_REGISTRY,
    abi: SHARES_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
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

  const roundId = currentRoundData?.[0];
  const totalPool = currentRoundData?.[1] ?? 0n;
  const endTime = currentRoundData?.[2];
  const ticketCount = currentRoundData?.[4] ?? 0n;
  const isActive = currentRoundData?.[5] ?? false;

  useEffect(() => {
    if (endTime === undefined) return;

    const endTimeSec = Number(endTime);

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = endTimeSec - now;

      if (diff <= 0 || !isActive) {
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
  }, [endTime, isActive, refetchRound]);

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
      className="bg-dark-card border border-dark-border p-4 rounded-2xl flex items-center gap-4 hover:border-gray-600 transition-colors group"
    >
      <div className="bg-dark-input p-2 rounded-lg text-gray-400 group-hover:text-white transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{label}</p>
        <p className="text-white font-bold truncate max-w-[120px]">{value}</p>
      </div>
    </Link>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniCard label="Identity" value={username ? `@${username}` : 'Register'} icon={User} to="/username" />
        <MiniCard
          label="Wallet"
          value={usdcBalance ? `${formatUnits(usdcBalance as bigint, 6)} USDC` : '0.00'}
          icon={Wallet}
          to="/"
        />
        <MiniCard label="Shares" value={sharesBalance ? sharesBalance.toString() : '0'} icon={PieChart} to="/shares" />
        <MiniCard label="Network" value="Arbitrum One" icon={Zap} to="/" />
      </div>

      <div className="relative rounded-[40px] overflow-hidden border border-brand/20 shadow-[0_0_50px_rgba(245,158,11,0.1)]">
        <div className="absolute inset-0 bg-dark-card z-0"></div>
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand/5 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 z-0 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[100px] translate-y-1/2 -translate-x-1/2 z-0 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 px-4 py-1.5 rounded-full mb-8 animate-fade-in-up">
            <span className="relative flex h-3 w-3">
              <span
                className={`absolute inline-flex h-full w-full rounded-full bg-brand opacity-75 ${
                  !isTransitioning && 'animate-ping'
                }`}
              ></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isTransitioning ? 'bg-gray-500' : 'bg-brand'}`}></span>
            </span>
            <span className={`text-xs font-bold tracking-[0.2em] uppercase ${isTransitioning ? 'text-gray-400' : 'text-brand'}`}>
              {isTransitioning ? 'Finalizing Round...' : `Round #${roundId?.toString() ?? '...'} Live`}
            </span>
          </div>

          <h1 className="text-7xl md:text-[10rem] font-bold text-white leading-none font-mono tracking-tighter mb-4 drop-shadow-2xl">
            {isTransitioning ? (
              <span className="text-5xl md:text-8xl animate-pulse text-gray-400">STARTING...</span>
            ) : (
              formatTime(timeLeft)
            )}
          </h1>

          <p className="text-gray-500 font-medium text-lg uppercase tracking-widest mb-10">
            {isTransitioning ? 'Automating New Round (30 min)' : 'Time Remaining'}
          </p>

          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-12 mb-12 bg-black/30 p-6 rounded-3xl border border-white/5 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-xs text-gray-500 font-bold uppercase mb-1">Total Prize Pool</p>
              <p className="text-4xl font-bold text-white">
                {formatUnits(totalPool as bigint, 6)} <span className="text-lg text-gray-600">USDC</span>
              </p>
            </div>
            <div className="w-px h-12 bg-white/10 hidden md:block"></div>
            <div className="text-center">
              <p className="text-xs text-gray-500 font-bold uppercase mb-1">Tickets Sold</p>
              <p className="text-4xl font-bold text-white flex items-center gap-2 justify-center">
                <Ticket className="w-6 h-6 text-purple-500" />
                {ticketCount.toString()}
              </p>
            </div>
          </div>

          <div className="w-full max-w-md">
            <Link to="/raffle">
              <Button
                variant="connect"
                disabled={isTransitioning}
                className="w-full h-20 text-xl md:text-2xl rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.3)] hover:shadow-[0_0_60px_rgba(245,158,11,0.5)] hover:scale-105 transition-all duration-300 relative overflow-hidden group disabled:opacity-50 disabled:shadow-none"
              >
                <span className="relative z-10 flex items-center gap-3">
                  {isTransitioning ? (
                    <>
                      <Loader2 className="animate-spin w-6 h-6" /> Processing...
                    </>
                  ) : (
                    <>
                      ENTER ROUND NOW <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </span>
                {!isTransitioning && (
                  <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent z-0"></div>
                )}
              </Button>
            </Link>
            <p className="mt-4 text-xs text-gray-500">Smart Contract verifies winner automatically via Chainlink VRF.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
