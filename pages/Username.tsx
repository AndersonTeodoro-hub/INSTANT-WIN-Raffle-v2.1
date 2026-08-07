import React, { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, USERNAME_ABI } from '../constants';
import { Button } from '../components/Button';
import { Check, X, Loader2, Search, UserCircle } from 'lucide-react';

export const Username: React.FC = () => {
  const { isConnected, address } = useAccount();
  const [inputName, setInputName] = useState('');
  const [debouncedName, setDebouncedName] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedName(inputName), 500);
    return () => clearTimeout(timer);
  }, [inputName]);

  // CORRIGIDO: isUsernameAvailable em vez de isAvailable
  const { data: isAvailable, isLoading: checkingAvailability } = useReadContract({
    address: CONTRACTS.USERNAME_REGISTRY,
    abi: USERNAME_ABI,
    functionName: 'isUsernameAvailable',
    args: debouncedName.length >= 3 ? [debouncedName] : undefined,
    query: { enabled: debouncedName.length >= 3 }
  });

  // CORRIGIDO: walletToUsername em vez de addressToUsername
  const { data: currentUsername, refetch: refetchUsername } = useReadContract({
    address: CONTRACTS.USERNAME_REGISTRY,
    abi: USERNAME_ABI,
    functionName: 'walletToUsername',
    args: address ? [address] : undefined,
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      refetchUsername();
      setInputName('');
    }
  }, [isSuccess, refetchUsername]);

  const handleRegister = () => {
    if (!inputName || !isAvailable) return;
    writeContract({
      address: CONTRACTS.USERNAME_REGISTRY,
      abi: USERNAME_ABI,
      functionName: 'registerUsername',
      args: [inputName],
    });
  };

  // Verificar se já tem username registado
  const hasRegisteredUsername = currentUsername && currentUsername !== '';

  if (!isConnected) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <h2 className="text-2xl font-bold text-white mb-4">Your Identity</h2>
        <p className="text-gray-500">Connect wallet to register.</p>
    </div>
  );

  return (
    <div className="flex flex-col items-center pt-6 sm:pt-16">
      
      <div className="text-center mb-8 sm:mb-12 px-1">
        <h1 className="font-display font-bold text-4xl sm:text-5xl text-white mb-3 uppercase tracking-tight">Your Identity</h1>
        <p className="text-gray-500 text-sm sm:text-base">Register a unique username on Arbitrum One to identify yourself across the suite.</p>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-3xl p-5 sm:p-10 w-full max-w-xl">
        
        {/* Current Identity */}
        {hasRegisteredUsername && (
             <div className="mb-8 p-4 bg-dark-input rounded-xl border border-dark-border flex items-center gap-4">
                 <UserCircle className="w-10 h-10 text-brand" />
                 <div>
                     <p className="text-xs text-gray-500 uppercase font-bold">Current Alias</p>
                     <p className="text-xl font-bold text-white">@{currentUsername}</p>
                 </div>
             </div>
        )}

        {/* Se já tem username, mostrar mensagem */}
        {hasRegisteredUsername ? (
          <div className="text-center py-8">
            <p className="text-gray-400">Your username is already registered and cannot be changed.</p>
          </div>
        ) : (
          <div className="space-y-6">
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Choose Username</label>
                  <div className="relative group">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                          <Search className="w-5 h-5 text-gray-600 group-focus-within:text-white transition-colors" />
                      </div>
                      <input
                          type="text"
                          value={inputName}
                          onChange={(e) => setInputName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                          className={`w-full bg-dark-input border rounded-xl py-4 pl-12 pr-12 text-white placeholder:text-gray-700 focus:outline-none transition-all ${
                              inputName.length >= 3 
                                  ? isAvailable ? 'border-green-500/50 focus:border-green-500' : 'border-red-500/50 focus:border-red-500'
                                  : 'border-dark-border focus:border-brand'
                          }`}
                          placeholder="yourname"
                          maxLength={20}
                      />
                      
                      {/* Status Indicator */}
                      <div className="absolute inset-y-0 right-4 flex items-center">
                          {inputName.length >= 3 && (
                              checkingAvailability ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                              ) : isAvailable ? (
                                  <div className="flex items-center bg-green-500/20 px-2 py-1 rounded text-xs font-bold text-green-500 gap-1">
                                      <Check className="w-3 h-3" /> Available
                                  </div>
                              ) : (
                                  <div className="flex items-center bg-red-500/20 px-2 py-1 rounded text-xs font-bold text-red-500 gap-1">
                                      <X className="w-3 h-3" /> Taken
                                  </div>
                              )
                          )}
                      </div>
                  </div>
                  <p className="mt-2 text-[10px] text-gray-600">Must be between 3 and 20 characters. Only letters, numbers and underscore.</p>
              </div>

              <Button 
                  variant="primary"
                  className="w-full py-4 text-lg bg-[#1E2030] hover:bg-[#2A2C40] text-gray-300 shadow-none border border-dark-border"
                  onClick={handleRegister}
                  disabled={!isAvailable || inputName.length < 3 || isPending || isConfirming}
                  isLoading={isPending || isConfirming}
              >
                  + Register Username
              </Button>
          </div>
        )}
      </div>
    </div>
  );
};
