import React, { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, USERNAME_ABI, USDC_ABI, RAFFLE_ABI, RoundState } from '../constants';
import { formatUnits } from 'viem';
import { User, Wallet, Coins, Ticket, ArrowRight, Zap, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { RoundClock, RoundMeter } from '../components/Proof';
import { CountUp } from '../components/proof/CountUp';
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

  /*
   * Os quatro factos da conta e da rede. Eram quatro cartões iguais por cima do
   * relógio, a disputar a primeira vista com a ronda; passam a ser uma só régua
   * por baixo dela, com a ronda como o objecto principal do ecrã.
   */
  const MiniCard = ({ label, value, icon: Icon, to, prize }: any) => (
    <Link
      to={to}
      className="group flex min-w-0 items-center gap-3 bg-dark-card px-4 py-4 transition-colors duration-200 hover:bg-dark-raised sm:px-5"
    >
      <Icon className="h-5 w-5 shrink-0 text-gray-400 transition-colors duration-200 group-hover:text-white" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-400">{label}</p>
        <p className={`truncate font-mono text-sm font-bold ${prize ? 'text-brand' : 'text-white'}`}>{value}</p>
      </div>
    </Link>
  );

  const live = isOpen && !isTransitioning;

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-12">
      <section className="iw-surface-raised relative overflow-hidden">
        <div className="flex flex-col items-center px-4 py-10 text-center sm:px-6 sm:py-14">
          {/* A ronda: ao vivo on-chain, portanto verde e a pulsar; cinzenta enquanto fecha. */}
          <p
            className={`inline-flex items-center gap-2.5 rounded-full border px-4 py-1.5 text-xs font-semibold ${
              live ? 'border-success/30 bg-success/[0.07] text-success' : 'border-dark-line text-gray-400'
            }`}
          >
            <span className="iw-live" data-idle={!live} aria-hidden="true" />
            {isTransitioning
              ? c.dashboard.finalizing
              : `${c.dashboard.roundPre}${roundId?.toString() ?? '...'}${c.dashboard.roundPost}`}
          </p>

          <h1 className="mt-8 w-full">
            <RoundClock
              seconds={timeLeft}
              closing={isTransitioning ? c.dashboard.closing : undefined}
              className="justify-center text-[clamp(2.4rem,13vw,8.5rem)]"
            />
          </h1>

          <div className="mt-6 w-full max-w-xl">
            <RoundMeter seconds={timeLeft} closing={isTransitioning} />
            <p className="mt-3 text-xs text-gray-400 sm:text-sm">
              {isTransitioning ? c.dashboard.endedAwaitingClose : c.dashboard.timeRemaining}
            </p>
          </div>

          <dl className="mt-10 grid w-full max-w-xl grid-cols-[minmax(0,1fr)_auto] items-end gap-6 border-y border-dark-border py-6 text-left">
            <div className="min-w-0">
              <dt className="text-xs font-medium text-gray-400">{c.dashboard.totalPrizePool}</dt>
              <dd className="mt-2 flex items-baseline gap-2 font-mono font-bold text-brand">
                {/* O prémio conta até ao valor lido da cadeia, e de um valor ao seguinte quando entra um bilhete. */}
                <CountUp value={totalPool as bigint} decimals={6} from0 className="truncate text-4xl sm:text-5xl" />
                <span className="text-base text-gray-400">USDC</span>
              </dd>
            </div>
            <div className="text-right">
              <dt className="text-xs font-medium text-gray-400">{c.dashboard.ticketsSold}</dt>
              <dd className="mt-2 flex items-center justify-end gap-2 font-mono text-4xl font-bold text-white sm:text-5xl">
                <Ticket className="h-6 w-6 text-gray-400" aria-hidden="true" />
                <CountUp value={ticketCount} decimals={0} />
              </dd>
            </div>
          </dl>

          <div className="mt-8 w-full max-w-md">
            <Link to="/play/raffle">
              <Button
                variant="connect"
                disabled={isTransitioning}
                className="group h-16 w-full text-lg md:h-20 md:text-2xl"
              >
                {isTransitioning ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> {c.dashboard.processing}
                  </>
                ) : (
                  <>
                    {c.dashboard.enterRound}{' '}
                    <ArrowRight className="h-6 w-6 transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true" />
                  </>
                )}
              </Button>
            </Link>
            <p className="mt-4 text-xs text-gray-400">{c.dashboard.vrfNote}</p>
          </div>
        </div>
      </section>

      <div className="iw-surface grid grid-cols-2 gap-px overflow-hidden !bg-dark-border md:grid-cols-4">
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
          prize
        />
        <MiniCard label={c.dashboard.network} value="Arbitrum One" icon={Zap} to="/play" />
      </div>
    </div>
  );
};
