import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectWallet } from './ConnectWallet';
import { ShareButton } from './ShareButton';
import { Menu, Zap, Ticket, User } from 'lucide-react';
import { clsx } from 'clsx';
import { useAccount } from 'wagmi';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const { isConnected, address } = useAccount();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const navItems = [
    { path: '/play', label: 'Overview', icon: Zap },
    { path: '/play/raffle', label: 'Raffle', icon: Ticket },
    { path: '/play/identity', label: 'Identity', icon: User },
  ];

  return (
    <nav className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 sm:h-20 flex items-center justify-between gap-2">

        {/* Brand — wordmark em HTML puro, sem imagem. Abaixo de 400px fica só o
            check verde como marca mínima, para o header não transbordar. */}
        <Link to="/play" className="flex items-baseline gap-2 min-w-0 min-h-[44px] py-2">
          <span className="hidden min-[400px]:inline font-display font-bold text-xl sm:text-2xl text-white tracking-tight leading-none truncate">
            INSTANT WIN
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
                            isActive ? "text-white" : "text-gray-500"
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
            <div className="hidden lg:flex flex-col items-end mr-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</span>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></span>
                    <span className="text-xs font-mono text-gray-400">
                        {isConnected && address ? `${address.slice(0,6)}...${address.slice(-4)}` : 'Not Connected'}
                    </span>
                </div>
            </div>

            <ShareButton variant="icon" />

            <ConnectWallet />
            
            <button
                className="md:hidden flex items-center justify-center w-11 h-11 -mr-2 text-gray-400"
                aria-label="Open menu"
                aria-expanded={isMobileMenuOpen}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
                <Menu className="w-6 h-6" />
            </button>
        </div>
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