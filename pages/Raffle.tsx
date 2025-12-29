import React, { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, RAFFLE_ABI, USDC_ABI } from '../constants';
import { parseUnits, formatUnits } from 'viem';
import { Button } from '../components/Button';
import { Clock, Ticket, Activity, Info } from 'lucide-react';

export const Raffle: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState<string>('5');
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Dynamic Polling for rapid updates during round transitions
  const pollInterval = timeLeft <= 10 || isTransitioning ? 1000 : 5000;

  // Queries
  const { data: currentRoundId, refetch: refetchRoundId } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'currentRoundId',
    query: { refetchInterval: pollInterval }
  });

  const { data: roundInfo, refetch: refetchInfo } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'getRoundInfo',
    args: currentRoundId !== undefined ? [currentRoundId] : undefined,
    query: { 
        enabled: currentRoundId !== undefined, 
        refetchInterval: pollInterval 
    }
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.RAFFLE_MANAGER] : undefined,
  });

  // Writes
  const { writeContract: writeApprove, data: approveHash, isPending: isApproving } = useWriteContract();
  const { writeContract: writeBuy, data: buyHash, isPending: isBuying } = useWriteContract();

  const { isLoading: approvingTx } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: buyingTx, isSuccess: boughtSuccess } = useWaitForTransactionReceipt({ hash: buyHash });

  // Effects
  useEffect(() => {
    if (boughtSuccess) {
      refetchInfo();
      refetchAllowance();
      setAmount('5');
    }
  }, [boughtSuccess, refetchInfo, refetchAllowance]);

  useEffect(() => {
    if (!approvingTx && approveHash) refetchAllowance(); 
  }, [approvingTx, approveHash, refetchAllowance]);

  // Robust endTime resolver (handles object or tuple/array returns)
  const resolveEndTime = (ri: any): number | null => {
    if (!ri) return null;

    const toNum = (v: any) => {
      try { return Number(v); } catch { return NaN; }
    };

    // 1) Try by name
    const byName = ri.endTime ?? ri.endTimestamp ?? ri.endAt;
    const n1 = toNum(byName);
    if (Number.isFinite(n1) && n1 > 1_600_000_000 && n1 < 2_400_000_000) return n1;

    // 2) Try by expected tuple index (ABI: [status, endTime, totalPot, ticketsSold, participantCount])
    const idx = Array.isArray(ri) ? ri : [ri.status, ri.endTime, ri.totalPot, ri.ticketsSold, ri.participantCount];
    const n2 = toNum(idx[1]);
    if (Number.isFinite(n2) && n2 > 1_600_000_000 && n2 < 2_400_000_000) return n2;

    // 3) Fallback: scan values for a plausible unix timestamp (seconds)
    const candidates = Array.isArray(ri) ? ri : Object.values(ri);
    for (const v of candidates) {
      const n = toNum(v);
      if (Number.isFinite(n) && n > 1_600_000_000 && n < 2_400_000_000) return n;
    }

    return null;
  };

  // Timer Logic (fixed)
  useEffect(() => {
    if (!roundInfo) return;

    const endTime = resolveEndTime(roundInfo);

    if (!endTime) {
      setTimeLeft(0);
      setIsTransitioning(true);
      refetchRoundId();
      setTimeout(() => refetchInfo(), 1200);
      return;
    }

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = endTime - now;
      
      if (diff <= 0) {
        setTimeLeft(0);
        setIsTransitioning(true);
        refetchRoundId();
        setTimeout(() => refetchInfo(), 1200);
      } else {
        setIsTransitioning(false);
        setTimeLeft(diff);
      }
    };

    tick();

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [roundInfo, refetchRoundId, refetchInfo]);

  const handleApprove = () => {
    if (!amount) return;
    writeApprove({
      address: CONTRACTS.USDC,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [CONTRACTS.RAFFLE_MANAGER, parseUnits(amount, 6)],
    });
  };

  const handleBuy = () => {
    if (!amount) return;
    writeBuy({
      address: CONTRACTS.RAFFLE_MANAGER,
      abi: RAFFLE_ABI,
      functionName: 'buyTickets',
      args: [parseUnits(amount, 6)],
    });
  };

  // Helpers
  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const needsApproval = () => {
    if (!amount || !allowance) return true;
    return (allowance as bigint) < parseUnits(amount, 6);
  };

  return (
    <div className="max-w-6xl mx-auto py-8">
      
      {/* 1. Centered Pool Status */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-[#1A1A1D] border border-gray-800 px-4 py-1.5 rounded-full mb-6">
            <div className={`w-2 h-2 rounded-full ${isTransitioning ? 'bg-gray-500' : 'bg-brand animate-pulse'}`}></div>
            <span className={`text-xs font-bold tracking-widest uppercase ${isTransitioning ? 'text-gray-500' : 'text-brand'}`}>
                {isTransitioning ? 'Finalizing Round' : 'Live Pool Arbitrum'}
            </span>
        </div>
        
        <p className="text-gray-500 font-mono text-sm uppercase tracking-widest mb-2">Current Prize Pool</p>
        <h1 className="text-8xl md:text-9xl font-bold text-white tracking-tighter mb-8">
            {roundInfo ? formatUnits((roundInfo as any).totalPot, 6).replace('.', ',') : '0,00'} <span className="text-3xl text-gray-600 font-normal">USDC</span>
        </h1>

        {/* Timer Capsules */}
        <div className="flex justify-center gap-6">
            <div className="bg-dark-card border border-dark-border px-8 py-4 rounded-full flex flex-col items-center min-w-[180px]">
                <div className="flex items-center gap-2 text-blue-500 text-xs font-bold uppercase mb-1">
                    <Clock className="w-3 h-3" /> Time Left
                </div>
                <span className="text-2xl font-mono font-bold text-white">
                    {isTransitioning ? (
                        <span className="text-brand text-lg animate-pulse">STARTING...</span>
                    ) : (
                        formatTime(timeLeft)
                    )}
                </span>
            </div>
            
            <div className="bg-dark-card border border-dark-border px-8 py-4 rounded-full flex flex-col items-center min-w-[180px]">
                <div className="flex items-center gap-2 text-purple-500 text-xs font-bold uppercase mb-1">
                    <Ticket className="w-3 h-3" /> Tickets Sold
                </div>
                <span className="text-2xl font-mono font-bold text-white">
                    {roundInfo ? (roundInfo as any).ticketsSold.toString() : '0'}
                </span>
            </div>
        </div>
      </div>

      {/* 2. Bottom Section: Buy + Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Buy Card (Left 2 Cols) */}
        <div className="lg:col-span-2 bg-dark-card border border-dark-border rounded-3xl p-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gray-700 to-transparent"></div>
            
            <h2 className="text-2xl font-bold text-white mb-8 uppercase">Buy Your Chance</h2>
            
            <div className="bg-dark-input rounded-2xl p-6 border border-dark-border mb-6">
                 <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-bold text-gray-500 uppercase">Total Cost (1 Ticket = 1 USDC)</span>
                    <span className="text-xs font-bold text-brand uppercase">Receive: {amount || 0} Tickets</span>
                 </div>
                 
                 <div className="flex items-center gap-4">
                    <input 
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="bg-transparent text-4xl font-bold text-white outline-none w-full placeholder:text-gray-800"
                        placeholder="0"
                        min="1"
                        disabled={isTransitioning}
                    />
                    <div className="flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded border border-gray-800">
                        <span className="text-white font-bold">USDC</span>
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
                        Approve {amount} USDC
                    </Button>
                ) : (
                    <Button 
                        variant="primary" 
                        className="w-full py-4 text-lg"
                        onClick={handleBuy}
                        isLoading={isBuying || buyingTx}
                        disabled={!isConnected || isTransitioning}
                    >
                        {isTransitioning ? 'Wait for Next Round' : `Buy ${amount} Tickets Now`}
                    </Button>
                )}
            </div>
            
            <div className="mt-4 flex items-start gap-2 text-xs text-gray-500">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <p>By buying tickets, you agree that the prize distribution is handled automatically by the smart contract on Arbitrum One. 100% On-chain.</p>
            </div>
        </div>

        {/* Status Card (Right 1 Col) */}
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
                        <span className="text-brand font-mono">{roundInfo ? formatUnits((roundInfo as any).totalPot * 50n / 100n, 6) : '0'} USDC</span>
                     </div>
                     <div className="flex justify-between text-sm">
                        <span className="text-gray-400">2nd Place (18%)</span>
                        <span className="text-white font-mono">{roundInfo ? formatUnits((roundInfo as any).totalPot * 18n / 100n, 6) : '0'} USDC</span>
                     </div>
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};
