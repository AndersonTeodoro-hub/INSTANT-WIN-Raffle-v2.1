import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Zap, Ticket, User } from 'lucide-react';
import { clsx } from 'clsx';
import { useAccount } from 'wagmi';
import { ConnectWallet } from './ConnectWallet';
import { ShareButton } from './ShareButton';
import { SiteHeader, KeptraBrand } from './SiteHeader';
import { PublicNavLinks, MODULES } from './PublicNav';
import { useAppCopy } from '../pages/app.i18n';

/**
 * Cabeçalho das páginas do jogo (/play/*): o mesmo SiteHeader do resto da
 * plataforma. A acção do contexto é a carteira; a partilha é um extra.
 *
 * O estado da ligação fica ao lado, no computador. O ponto só acende quando há
 * mesmo uma wallet ligada — antes pulsava sempre, o que dizia "ligado" a quem
 * não estava.
 */
export const Navbar: React.FC = () => {
  const { isConnected, address } = useAccount();
  const c = useAppCopy();
  const connected = isConnected && !!address;

  return (
    <SiteHeader
      brand={<KeptraBrand module={MODULES.instantWin} />}
      nav={<PublicNavLinks />}
      // A partilha sai abaixo de sm: a 390px a linha leva a marca com o módulo, o idioma e a carteira.
      extras={<ShareButton variant="icon" className="hidden sm:inline-flex" />}
      actions={
        <>
          <div className="mr-1 hidden flex-col items-end xl:flex">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">{c.nav.status}</span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className={clsx('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-gray-600')} />
              <span className="font-mono text-xs text-gray-400">
                {connected ? `${address!.slice(0, 6)}…${address!.slice(-4)}` : c.nav.notConnected}
              </span>
            </span>
          </div>
          <ConnectWallet />
        </>
      }
    />
  );
};

/**
 * As três vistas do jogo, como separadores logo abaixo do cabeçalho. Eram a
 * navegação do cabeçalho do jogo — que agora é o da plataforma — e o menu
 * hambúrguer no telemóvel; como separadores ficam à vista em todos os tamanhos.
 */
export const GameTabs: React.FC = () => {
  const c = useAppCopy();
  const tabs = [
    { path: '/play', label: c.nav.overview, icon: Zap, end: true },
    { path: '/play/raffle', label: c.nav.raffle, icon: Ticket, end: false },
    { path: '/play/identity', label: c.nav.identity, icon: User, end: false },
  ];

  // O separador diz a página, o módulo e a marca: "Raffle · Instant Win · Keptra".
  const { pathname } = useLocation();
  const current = tabs.find((tab) => (tab.end ? pathname.replace(/\/$/, '') === tab.path : pathname.startsWith(tab.path)));
  const title = current ? `${current.label} · Instant Win · Keptra` : 'Instant Win · Keptra';
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <nav aria-label="Lottery" className="mx-auto mb-8 flex w-full max-w-6xl justify-center sm:mb-10 sm:justify-start">
      <div className="inline-flex rounded-control border border-dark-border bg-dark-card/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.end}
            className={({ isActive }) =>
              clsx(
                'inline-flex min-h-[44px] items-center gap-2 rounded-[8px] px-4 text-sm font-medium transition-colors duration-200',
                isActive ? 'bg-dark-line/70 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-gray-400 hover:text-white',
              )
            }
          >
            <tab.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};
