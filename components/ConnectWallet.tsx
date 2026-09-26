import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { Button } from './Button';
import { Wallet, LogOut, AlertTriangle, Smartphone, Monitor } from 'lucide-react';
import { useAppCopy } from '../pages/app.i18n';

/**
 * `inPage`: o mesmo componente como acção principal de um ecrã que precisa da
 * carteira (criar um sorteio, os meus sorteios, identidade) — âmbar e com o
 * rótulo sempre visível. No cabeçalho continua secundário e só com o ícone no telemóvel.
 */
export const ConnectWallet: React.FC<{ inPage?: boolean }> = ({ inPage = false }) => {
  const { address, isConnected } = useAccount();
  const c = useAppCopy();
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
        className="min-h-[44px] px-4 py-0 text-sm"
      >
        <AlertTriangle className="w-4 h-4" />
        {c.wallet.wrongNet}
      </Button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        aria-label={c.wallet.ariaDisconnect}
        className="iw-btn iw-btn-secondary w-11 px-0 text-gray-400 hover:!border-red-500/50 hover:!text-red-300"
      >
        <LogOut className="w-5 h-5" />
      </button>
    );
  }

  return (
    <>
      {/* Acção do cabeçalho: secundária, como todas (SiteHeader). Só o ícone abaixo de sm. */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        title={c.wallet.connect}
        className={inPage ? 'iw-btn iw-btn-primary px-6 text-sm font-bold' : 'iw-btn iw-btn-secondary min-w-[44px] px-3 text-sm sm:px-4'}
      >
        <Wallet className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className={inPage ? undefined : 'sr-only sm:not-sr-only'}>{c.wallet.connect}</span>
      </button>

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
            aria-label={c.wallet.selectWallet}
            onClick={() => setShowModal(false)}
            className="iw-sheet-backdrop fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="iw-surface-raised iw-swap p-6 w-full max-w-sm"
            >
              <h3 className="font-display text-2xl font-bold tracking-tight mb-6 text-white text-center">{c.wallet.selectWallet}</h3>
              <div className="flex flex-col gap-3">
                {connectors.map((connector) => (
                  <button
                    key={connector.uid}
                    onClick={() => handleConnect(connector)}
                    className="iw-btn iw-btn-secondary justify-between p-4 group"
                  >
                    <span className="font-bold text-gray-200">{connector.name}</span>
                    {connector.name.toLowerCase().includes('walletconnect') ? (
                      <Smartphone className="w-5 h-5 text-gray-400" />
                    ) : (
                      <Monitor className="w-5 h-5 text-gray-400" />
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="mt-6 min-h-[44px] text-sm text-gray-400 hover:text-white w-full text-center"
              >
                {c.wallet.cancel}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
/** O estado de um ecrã que precisa da carteira: diz porquê e oferece ligá-la ali mesmo. */
export const ConnectPrompt: React.FC<{ message: string }> = ({ message }) => (
  <div className="iw-surface-raised flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
    <p className="flex items-center gap-3 text-base text-gray-200">
      <Wallet className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
      {message}
    </p>
    <ConnectWallet inPage />
  </div>
);
