import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { Button } from './Button';
import { Wallet, LogOut, AlertTriangle, Smartphone, Monitor } from 'lucide-react';

export const ConnectWallet: React.FC = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [showModal, setShowModal] = useState(false);

  const isWrongNetwork = isConnected && chainId !== arbitrum.id;

  const handleConnect = (connector: any) => {
    connect({ connector });
    setShowModal(false);
  };

  if (isWrongNetwork) {
    return (
      <Button 
        variant="danger" 
        onClick={() => switchChain({ chainId: arbitrum.id })}
        className="h-10 px-4"
      >
        <AlertTriangle className="w-4 h-4" />
        Wrong Net
      </Button>
    );
  }

  if (isConnected && address) {
    return (
      <button 
        onClick={() => disconnect()}
        className="h-10 w-10 flex items-center justify-center rounded-xl bg-dark-input border border-dark-border hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-500 transition-all text-gray-400"
      >
        <LogOut className="w-5 h-5" />
      </button>
    );
  }

  return (
    <>
      <Button 
        variant="connect"
        onClick={() => setShowModal(true)}
        className="h-10 px-6 text-sm"
      >
        <Wallet className="w-4 h-4" />
        CONNECT
      </Button>

      {/*
        Portal para o body: o <nav> que contém este componente tem `backdrop-blur-md`,
        e um backdrop-filter cria um containing block para descendentes `position: fixed`.
        Dentro da nav, `fixed inset-0` dimensionava-se à barra de 64–80px em vez do
        viewport (modal cortado no topo), e o z-[100] ficava preso no stacking context
        do z-50 da nav. Montar no body resolve as duas coisas.
      */}
      {showModal &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Select Wallet"
            onClick={() => setShowModal(false)}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-dark-card border border-dark-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-6 text-white text-center">Select Wallet</h3>
              <div className="flex flex-col gap-3">
                {connectors.map((connector) => (
                  <button
                    key={connector.uid}
                    onClick={() => handleConnect(connector)}
                    className="flex items-center justify-between p-4 rounded-xl bg-dark-input hover:bg-white/10 border border-dark-border transition-all group"
                  >
                    <span className="font-bold text-gray-200">{connector.name}</span>
                    {connector.name.toLowerCase().includes('walletconnect') ? (
                      <Smartphone className="w-5 h-5 text-brand" />
                    ) : (
                      <Monitor className="w-5 h-5 text-action" />
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="mt-6 min-h-[44px] text-sm text-gray-500 hover:text-white w-full text-center"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};