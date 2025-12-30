import React, { useMemo, useEffect, useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, RAFFLE_ABI, USDC_ABI } from '../constants';
import { formatUnits } from 'viem';
import { Button } from '../components/Button';
import { Clock, Ticket, Activity, Info } from 'lucide-react';

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
    query: { refetchInterval: pollInterval },
  });

  const totalPool = currentRoundData?.[1] ?? 0n;
  const endTime = currentRoundData?.[2];
  const ticketCount = currentRoundData?.[4] ?? 0n;
  const isActive = currentRoundData?.[5] ?? false;

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

  const { writeContract: writeApprove, data: approveHash, isPending: isApproving } = useWriteContract();
  const { writeContract: writeBuy, data: buyHash, isPending: isBuying } = useWriteContract();

  const { isLoading: approvingTx } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: buyingTx, isSuccess: boughtSuccess } = useWaitForTransactionReceipt({ hash: buyHash });

  useEffect(() => {
    if (boughtSuccess) {
      refetchRound();
      refetchAllowance();
      setTicketAmount('1');
    }
  }, [boughtSuccess, refetchRound, refetchAllowance]);

  useEffect(() => {
    if (!approvingTx && approveHash) refetchAllowance();
  }, [approvingTx, approveHash, refetchAllowance]);

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

  return (
    <div className="max-w-6xl mx-auto py-8">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-[#1A1A1D] border border-gray-800 px-4 py-1.5 rounded-full mb-6">
          <div className={`w-2 h-2 rounded-full ${isTransitioning ? 'bg-gray-500' : 'bg-brand animate-pulse'}`}></div>
          <span className={`text-xs font-bold tracking-widest uppercase ${isTransitioning ? 'text-gray-500' : 'text-brand'}`}>
            {isTransitioning ? 'Finalizing Round' : 'Live Pool Arbitrum'}
          </span>
        </div>

        <p className="text-gray-500 font-mono text-sm uppercase tracking-widest mb-2">Current Prize Pool</p>
        <h1 className="text-8xl md:text-9xl font-bold text-white tracking-tighter mb-8">
          {formatUnits(totalPool as bigint, 6).replace('.', ',')} <span className="text-3xl text-gray-600 font-normal">USDC</span>
        </h1>

        <div className="flex justify-center gap-6">
          <div className="bg-dark-card border border-dark-border px-8 py-4 rounded-full flex flex-col items-center min-w-[180px]">
            <div className="flex items-center gap-2 text-blue-500 text-xs font-bold uppercase mb-1">
              <Clock className="w-3 h-3" /> Time Left
            </div>
            <span className="text-2xl font-mono font-bold text-white">
              {isTransitioning ? <span className="text-brand text-lg animate-pulse">STARTING...</span> : formatTime(timeLeft)}
            </span>
          </div>

          <div className="bg-dark-card border border-dark-border px-8 py-4 rounded-full flex flex-col items-center min-w-[180px]">
            <div className="flex items-center gap-2 text-purple-500 text-xs font-bold uppercase mb-1">
              <Ticket className="w-3 h-3" /> Tickets Sold
            </div>
            <span className="text-2xl font-mono font-bold text-white">{ticketCount.toString()}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-dark-card border border-dark-border rounded-3xl p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>

          <h2 className="text-2xl font-bold text-white mb-8 uppercase">Buy Your Chance</h2>

          <div className="bg-dark-input rounded-2xl p-6 border border-dark-border mb-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-bold text-gray-500 uppercase">Tickets (1 Ticket = 1 USDC)</span>
              <span className="text-xs font-bold text-brand uppercase">Cost: {formatUnits(totalCost, 6)} USDC</span>
            </div>

            <div className="flex items-center gap-4">
              <input
                type="number"
                value={ticketAmount}
                onChange={(e) => setTicketAmount(e.target.value)}
                className="bg-transparent text-4xl font-bold text-white outline-none w-full placeholder:text-gray-800"
                placeholder="0"
                min="1"
                max="100"
                disabled={isTransitioning}
              />
              <div className="flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded border border-gray-800">
                <span className="text-white font-bold">TICKETS</span>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            {needsApproval() ? (
              <Button
                variant="primary"
                className="w-full py-4 text-lg"
                onClick={handleApprove}
                isLoading={isApproving || approvingTx}
                disabled={!isConnected || isTransitioning}
              >
                Approve {formatUnits(totalCost, 6)} USDC
              </Button>
            ) : (
              <Button
                variant="primary"
                className="w-full py-4 text-lg"
                onClick={handleBuy}
                isLoading={isBuying || buyingTx}
                disabled={!isConnected || isTransitioning}
              >
                {isTransitioning ? 'Wait for Next Round' : `Buy ${ticketAmount} Ticket${parseInt(ticketAmount) !== 1 ? 's' : ''}`}
              </Button>
            )}
          </div>

          <div className="mt-4 flex items-start gap-2 text-xs text-gray-500">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>By buying tickets, you agree that the prize distribution is handled automatically by the smart contract on Arbitrum One. 100% On-chain.</p>
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-3xl p-8">
          <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-500" /> Status
          </h3>

          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">Network</span>
              <span className="text-white font-bold">Arbitrum One</span>
            </div>
            <div className="w-full h-px bg-gray-900"></div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">Security</span>
              <span className="text-white font-bold">Chainlink VRF</span>
            </div>
            <div className="w-full h-px bg-gray-900"></div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">Automation</span>
              <span className="text-white font-bold">Every 30 Mins</span>
            </div>
          </div>

          <div className="mt-8 bg-dark-input rounded-xl p-4 border border-dark-border">
            <p className="text-xs text-gray-500 mb-2 font-bold uppercase">Prize Logic</p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">1st Place (50%)</span>
                <span className="text-brand font-mono">{formatUnits((totalPool * 50n) / 100n, 6)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">2nd Place (18%)</span>
                <span className="text-white font-mono">{formatUnits((totalPool * 18n) / 100n, 6)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">3rd Place (7%)</span>
                <span className="text-white font-mono">{formatUnits((totalPool * 7n) / 100n, 6)} USDC</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
