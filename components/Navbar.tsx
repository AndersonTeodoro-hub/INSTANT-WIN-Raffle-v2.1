import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectWallet } from './ConnectWallet';
import { Trophy, Menu, Zap, Ticket, User, PieChart } from 'lucide-react';
import { clsx } from 'clsx';
import { useAccount } from 'wagmi';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const { isConnected, address } = useAccount();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const navItems = [
    { path: '/', label: 'Overview', icon: Zap },
    { path: '/raffle', label: 'Raffle', icon: Ticket },
    { path: '/shares', label: 'Shares', icon: PieChart },
    { path: '/username', label: 'Identity', icon: User },
  ];

  return (
    <nav className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3">
          <div className="bg-brand p-2 rounded-lg">
            <Trophy className="w-6 h-6 text-black fill-black" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
                <span className="font-display font-bold text-xl text-white tracking-tight">INSTANT WIN</span>
                <span className="bg-brand/20 text-brand text-[10px] font-bold px-1.5 py-0.5 rounded border border-brand/20">ARB</span>
            </div>
          </div>
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
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-xs font-mono text-gray-400">
                        {isConnected && address ? `${address.slice(0,6)}...${address.slice(-4)}` : 'Not Connected'}
                    </span>
                </div>
            </div>

            <ConnectWallet />
            
            <button 
                className="md:hidden p-2 text-gray-400"
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
                    className="block py-3 px-4 text-gray-300 hover:bg-white/5 rounded-lg mb-1"
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