import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ArrowRight } from 'lucide-react';
import { CONTRACTS } from '../constants';

const ARBISCAN = 'https://arbiscan.io/address/';

// Public landing: only these contracts may be surfaced (regulatory).
// Do not add internal-only registries here.
const contractLinks = [
  { label: 'Raffle Manager', address: CONTRACTS.RAFFLE_MANAGER },
  { label: 'Username Registry', address: CONTRACTS.USERNAME_REGISTRY },
  { label: 'USDC', address: CONTRACTS.USDC },
];

const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

export const Landing: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-hidden selection:bg-brand/30 selection:text-white">

      {/* Premium Ambient Background Glows (Gold & Blue) */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-brand/5 rounded-full blur-[120px] pointer-events-none z-0" />

      {/* Minimal public header — no wallet connect here, only inside /play */}
      <header className="relative z-10 border-b border-dark-border/60 backdrop-blur-sm">
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-brand p-2 rounded-lg">
              <Trophy className="w-5 h-5 text-black fill-black" />
            </div>
            <span className="font-display font-bold text-lg text-white tracking-tight">INSTANT WIN</span>
          </div>
          <Link
            to="/play"
            className="inline-flex items-center gap-2 bg-brand/10 hover:bg-brand/20 text-brand font-bold text-sm px-5 py-2.5 rounded-xl border border-brand/20 transition-colors"
          >
            Entrar na App <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div className="bg-brand p-3 rounded-xl">
            <Trophy className="w-8 h-8 text-black fill-black" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-3xl md:text-4xl text-white tracking-tight">INSTANT WIN</span>
            <span className="bg-brand/20 text-brand text-xs font-bold px-2 py-0.5 rounded border border-brand/20">ARB</span>
          </div>
        </div>

        {/* Tagline */}
        <h1 className="font-display font-bold text-4xl md:text-6xl leading-tight max-w-3xl mb-12">
          Loteria descentralizada na Arbitrum.
          <span className="block text-brand">3 vencedores a cada 30 minutos.</span>
        </h1>

        {/* CTA */}
        <Link
          to="/play"
          className="inline-flex items-center justify-center gap-3 bg-brand hover:bg-amber-400 text-black font-extrabold text-xl md:text-2xl px-12 h-16 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.3)] hover:shadow-[0_0_60px_rgba(245,158,11,0.5)] hover:scale-105 transition-all duration-300"
        >
          JOGAR AGORA <ArrowRight className="w-6 h-6" />
        </Link>
      </main>

      {/* Footer: on-chain contracts */}
      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4">
          <p className="text-center text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-4">
            Verified Contracts · Arbitrum One
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs font-mono text-gray-500">
            {contractLinks.map((c) => (
              <a
                key={c.address}
                href={`${ARBISCAN}${c.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand transition-colors"
              >
                <span className="font-sans font-medium text-gray-400">{c.label}:</span> {short(c.address)}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
};
