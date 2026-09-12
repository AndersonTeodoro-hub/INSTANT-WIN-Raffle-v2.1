import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectWallet } from './ConnectWallet';
import { ShareButton } from './ShareButton';
import { Menu, Zap, Ticket, User } from 'lucide-react';
import { clsx } from 'clsx';
import { useAccount } from 'wagmi';
import { LangSwitch } from './LangSwitch';
import { useAppCopy } from '../pages/app.i18n';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const { isConnected, address } = useAccount();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const c = useAppCopy();

  const navItems = [
    { path: '/play', label: c.nav.overview, icon: Zap },
    { path: '/play/raffle', label: c.nav.raffle, icon: Ticket },
    { path: '/play/identity', label: c.nav.identity, icon: User },
  ];

  return (
    <nav className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 sm:h-20 flex items-center justify-between gap-2">

        {/* Brand — wordmark em HTML puro, sem imagem. Abaixo de 400px fica só o
            check verde como marca mínima, para o header não transbordar.
            Liga a "/": é a saída do jogo para o Event Center, e a única em app
            instalada, que corre sem barra de endereço. */}
        <Link to="/" className="flex items-baseline gap-2 min-w-0 min-h-[44px] py-2">
          <span className="hidden min-[400px]:inline font-display font-bold text-xl sm:text-2xl text-white tracking-tight leading-none truncate">
            Instant Win
          </span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0 translate-y-[1px]"
          >
            <path
              d="M4 12.5 L9.5 18 L20 6"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="hidden min-[400px]:inline font-mono text-gray-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-gray-700 shrink-0">
            ARB
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
            {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={clsx(
                            "text-sm font-medium transition-colors hover:text-brand",
                            isActive ? "text-white" : "text-gray-400"
                        )}
                    >
                        {item.label}
                    </Link>
                )
            })}
        </div>

        {/* Right Side: Status & Wallet */}
        <div className="flex items-center gap-4">
            {/* Network Status Indicator (Visual only as per screenshot) */}
            {/* Estado da ligação. O ponto verde só acende quando há mesmo uma
                wallet ligada — antes pulsava sempre, o que dizia "ligado" a
                quem não estava. */}
            <div className="hidden lg:flex flex-col items-end mr-2">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">{c.nav.status}</span>
                <div className="flex items-center gap-1.5">
                    <span
                        aria-hidden="true"
                        className={clsx(
                            'w-1.5 h-1.5 rounded-full',
                            isConnected && address ? 'bg-success' : 'bg-gray-600',
                        )}
                    />
                    <span className="text-xs font-mono text-gray-400 tabular-nums">
                        {isConnected && address ? `${address.slice(0,6)}…${address.slice(-4)}` : c.nav.notConnected}
                    </span>
                </div>
            </div>

            {/* Abaixo de sm a barra não tem espaço para um quarto alvo de 44px:
                o selector passa para a tira própria, logo abaixo da barra. */}
            <LangSwitch className="hidden sm:inline-flex" />

            <ShareButton variant="icon" />

            <ConnectWallet />

            <button
                className="md:hidden flex items-center justify-center w-11 h-11 -mr-2 text-gray-400"
                aria-label={c.nav.ariaOpenMenu}
                aria-expanded={isMobileMenuOpen}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
                <Menu className="w-6 h-6" />
            </button>
        </div>
      </div>

      {/*
        Selector de idioma em telemóvel.

        Vivia dentro do menu hambúrguer, o que o tornava inalcançável sem abrir
        um menu — e o idioma tem de estar ao alcance em todas as páginas, sem
        abrir nada. Não cabe na barra abaixo de sm (a 390px a linha já leva
        marca, partilha, wallet e o botão do menu), por isso desce para uma tira
        própria. É o mesmo padrão de duas linhas que o header do Event Center já
        usa em telemóvel, e é o mesmo componente — não há segunda implementação.
      */}
      <div className="sm:hidden flex justify-center border-t border-dark-border/60 py-1">
        <LangSwitch />
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-dark-card border-b border-dark-border p-4">
            {navItems.map((item) => (
                <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center min-h-[44px] py-3 px-4 text-gray-300 hover:bg-white/5 rounded-lg mb-1"
                >
                    <div className="flex items-center gap-3">
                        <item.icon className="w-5 h-5 text-brand" />
                        {item.label}
                    </div>
                </Link>
            ))}
        </div>
      )}
    </nav>
  );
};
