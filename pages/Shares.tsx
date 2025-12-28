import React, { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, SHARES_ABI, USDC_ABI } from '../constants';
import { formatUnits } from 'viem';
import { Button } from '../components/Button';
import { PieChart, TrendingUp, ShieldCheck, AlertCircle } from 'lucide-react';

export const Shares: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState<string>('1');

  // Reads
  const { data: sharePrice } = useReadContract({
    address: CONTRACTS.SHARES_REGISTRY,
    abi: SHARES_ABI,
    functionName: 'sharePrice',
  });

  // (Removed unused userShares hook)

  const { data: claimable } = useReadContract({
    address: CONTRACTS.SHARES_REGISTRY,
    abi: SHARES_ABI,
    functionName: 'getClaimableRewards',
    args: address ? [address] : undefined,
    query: { refetchInterval: 10000 }
  });

  const { data: totalSupply } = useReadContract({
    address: CONTRACTS.SHARES_REGISTRY,
    abi: SHARES_ABI,
    functionName: 'totalSupply',
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.SHARES_REGISTRY] : undefined,
  });

  const { data: usdcBalance } = useReadContract({
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Writes
  const { writeContract: writeApprove, data: approveHash, isPending: isApproving } = useWriteContract();
  const { writeContract: writeBuy, data: buyHash, isPending: isBuying } = useWriteContract();
  const { writeContract: writeClaim, data: claimHash, isPending: isClaiming } = useWriteContract();

  const { isLoading: approvingTx } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: buyingTx, isSuccess: boughtSuccess } = useWaitForTransactionReceipt({ hash: buyHash });
  const { isLoading: claimingTx } = useWaitForTransactionReceipt({ hash: claimHash });

  useEffect(() => {
    if (boughtSuccess) setAmount('1');
    if (!approvingTx && approveHash) refetchAllowance();
  }, [boughtSuccess, approvingTx, approveHash, refetchAllowance]);

  const cost = amount && sharePrice ? BigInt(amount) * (sharePrice as bigint) : 0n;
  
  const needsApproval = () => {
    if (!amount || !allowance) return true;
    return (allowance as bigint) < cost;
  };

  const handleApprove = () => {
    writeApprove({
      address: CONTRACTS.USDC,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [CONTRACTS.SHARES_REGISTRY, cost],
    });
  };

  const handleBuy = () => {
    writeBuy({
      address: CONTRACTS.SHARES_REGISTRY,
      abi: SHARES_ABI,
      functionName: 'buyShares',
      args: [BigInt(amount)],
    });
  };

  const handleClaim = () => {
    writeClaim({
      address: CONTRACTS.SHARES_REGISTRY,
      abi: SHARES_ABI,
      functionName: 'claimRewards',
    });
  };

  return (
    <div className="max-w-6xl mx-auto py-8">
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* LEFT COLUMN: Actions */}
        <div className="space-y-8">
            
            {/* 1. Buy Card */}
            <div className="bg-dark-card border border-dark-border rounded-3xl p-8">
                <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
                        <PieChart className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Buy Protocol Shares</h2>
                        <p className="text-gray-500 text-sm">Convert USDC to protocol shares and participate in growth.</p>
                    </div>
                </div>

                <div className="flex justify-between text-xs text-gray-500 mb-2 font-bold uppercase">
                    <span>Amount to Purchase</span>
                    <span>Balance: {usdcBalance ? formatUnits(usdcBalance as bigint, 6) : '0'} USDC</span>
                </div>

                <div className="relative mb-6">
                    <input 
                        type="number" 
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full bg-dark-input border border-dark-border rounded-xl px-4 py-4 text-white text-xl font-bold outline-none focus:border-action transition-colors"
                        placeholder="0"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-600">SHARES</span>
                </div>

                {needsApproval() ? (
                    <Button 
                        variant="primary" 
                        className="w-full py-4 text-lg"
                        onClick={handleApprove}
                        isLoading={isApproving || approvingTx}
                        disabled={!isConnected}
                    >
                        <ShieldCheck className="w-5 h-5" /> Approve USDC Spending
                    </Button>
                ) : (
                    <Button 
                        variant="primary" 
                        className="w-full py-4 text-lg"
                        onClick={handleBuy}
                        isLoading={isBuying || buyingTx}
                        disabled={!isConnected}
                    >
                        Buy Shares
                    </Button>
                )}
            </div>

            {/* 2. Claim Card */}
            <div className="bg-dark-card border border-dark-border rounded-3xl p-8 flex items-center justify-between">
                <div>
                     <div className="flex items-center gap-2 mb-1">
                         <div className="p-2 bg-green-500/10 rounded text-green-500">
                             <TrendingUp className="w-5 h-5" />
                         </div>
                         <h3 className="text-lg font-bold text-white">Claim Rewards</h3>
                     </div>
                     <p className="text-gray-500 text-sm">Collect your portion of protocol earnings.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-dark-input border border-dark-border px-4 py-3 rounded-xl min-w-[100px] text-center">
                        <span className="text-xl font-bold text-white block">
                            {claimable ? formatUnits(claimable as bigint, 6) : '0'}
                        </span>
                    </div>
                    <Button 
                        variant="success" 
                        className="px-8"
                        onClick={handleClaim}
                        disabled={!claimable || (claimable as bigint) === 0n || !isConnected}
                        isLoading={isClaiming || claimingTx}
                    >
                        Claim
                    </Button>
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: Stats */}
        <div className="space-y-8">
            <div className="bg-dark-card border border-dark-border rounded-3xl p-8 h-full">
                <h3 className="text-lg font-bold text-white mb-8 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-500" /> Market Insights
                </h3>

                <div className="space-y-8">
                    <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Available Supply</span>
                            <span className="text-gray-600 text-xs">Shares remaining</span>
                        </div>
                        <span className="text-2xl font-bold text-white">
                            {totalSupply ? totalSupply.toString() : '0'}
                        </span>
                    </div>
                    
                    <div className="w-full h-px bg-gray-900"></div>

                    <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Pool Health</span>
                            <span className="text-gray-600 text-xs">Optimal</span>
                        </div>
                        <span className="text-2xl font-bold text-white">100%</span>
                    </div>

                    <div className="w-full h-px bg-gray-900"></div>

                    <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Network Fee</span>
                            <span className="text-gray-600 text-xs">Arbitrum Standard</span>
                        </div>
                        <span className="text-2xl font-bold text-white">Low</span>
                    </div>
                </div>
            </div>

             <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-6 flex gap-4">
                <AlertCircle className="w-6 h-6 text-gray-500 shrink-0" />
                <p className="text-xs text-gray-500 leading-relaxed">
                    Shares are non-refundable through the protocol. Rewards are distributed periodically based on round snapshots. 
                </p>
             </div>
        </div>

      </div>
    </div>
  );
};