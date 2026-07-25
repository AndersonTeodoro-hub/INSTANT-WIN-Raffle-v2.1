import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ArrowRight, Wallet, Zap, Check, X, ExternalLink, ShieldCheck, ChevronDown } from 'lucide-react';
import { CONTRACTS } from '../constants';

const ARBISCAN = 'https://arbiscan.io/address/';
const CHAINLINK_VRF = 'https://docs.chain.link/vrf';

// Public landing: only these contracts may be surfaced (regulatory).
// Do not add internal-only registries here.
const contractLinks = [
  { label: 'Raffle Manager', address: CONTRACTS.RAFFLE_MANAGER },
  { label: 'Username Registry', address: CONTRACTS.USERNAME_REGISTRY },
  { label: 'USDC', address: CONTRACTS.USDC },
];

// --- Copy (kept as data to make a future i18n pass trivial; no i18n lib yet) ---
const HERO = {
  badge: 'Powered by Chainlink VRF',
  headlineTop: 'Provably fair.',
  headlineBottom: 'Instantly paid.',
  sub: '3 winners every 30 minutes. Tickets from 1 USDC. Live on Arbitrum One.',
  cta: 'PLAY NOW',
};

const STEPS = [
  {
    icon: Wallet,
    title: 'Connect & grab tickets',
    body: 'Connect your wallet and buy tickets. 1 ticket = 1 USDC.',
  },
  {
    icon: Zap,
    title: 'VRF draws 3 winners',
    body: 'Chainlink VRF draws 3 winners every 30 minutes — pure verifiable randomness, no human hands.',
  },
  {
    icon: Trophy,
    title: 'Paid automatically',
    body: "Prizes hit winners' wallets automatically. No claims, no waiting.",
  },
];

const COMPARISON = [
  { label: 'Draws', instant: 'Every 30 minutes', traditional: 'Weekly' },
  { label: 'Randomness', instant: 'Chainlink VRF, on-chain proof', traditional: 'Trust the operator' },
  { label: 'Payout', instant: 'Automatic smart contract', traditional: 'Manual claim process' },
  { label: 'Rules', instant: 'Open-source contracts anyone can read', traditional: 'Closed systems' },
];

const FAQ = [
  {
    q: 'What do I need to play?',
    a: 'An Arbitrum One wallet (such as MetaMask) with some USDC for tickets and a little ETH for gas.',
  },
  {
    q: 'What is USDC and where do I get it?',
    a: 'USDC is a US-dollar stablecoin. You can buy it on most exchanges and move it to the Arbitrum One network.',
  },
  {
    q: 'How are winners picked?',
    a: 'Chainlink VRF produces verifiable on-chain randomness. Each draw selects 3 winners and the proof is public — anyone can check it.',
  },
  {
    q: 'When do I get paid?',
    a: 'Automatically. When a round ends the smart contract sends prizes straight to the winning wallets. There is no claim step.',
  },
  {
    q: 'What are the odds?',
    a: 'Your chance in a round depends only on how many tickets you hold versus the total tickets in that round. It is luck, not strategy.',
  },
  {
    q: 'Is this available in my country?',
    a: 'Access depends on the rules of your own jurisdiction. It is your responsibility to check whether you are allowed to participate where you live.',
  },
  {
    q: 'Who runs this?',
    a: 'The game runs entirely on-chain through open-source smart contracts. This website is only an open interface to them.',
  },
];

const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const SectionHeading: React.FC<{ eyebrow: string; title: string }> = ({ eyebrow, title }) => (
  <div className="text-center mb-12 md:mb-16">
    <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">{eyebrow}</p>
    <h2 className="font-display font-bold text-3xl md:text-5xl text-white">{title}</h2>
  </div>
);

export const Landing: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden selection:bg-brand/30 selection:text-white">

      {/* Premium Ambient Background Glows (Gold & Blue) */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-brand/5 rounded-full blur-[120px] pointer-events-none z-0" />

      {/* Minimal public header — no wallet connect here, only inside /play */}
      <header className="relative z-20 border-b border-dark-border/60 backdrop-blur-sm sticky top-0 bg-black/70">
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
            Enter App <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1 relative z-10">

        {/* 1. HERO */}
        <section className="flex flex-col items-center text-center px-6 pt-20 pb-24 md:pt-28 md:pb-32">
          <div className="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 text-brand text-xs font-bold px-4 py-1.5 rounded-full mb-8">
            <ShieldCheck className="w-4 h-4" /> {HERO.badge}
          </div>
          <h1 className="font-display font-bold text-5xl md:text-7xl leading-[1.05] max-w-4xl mb-6">
            {HERO.headlineTop}
            <span className="block text-brand">{HERO.headlineBottom}</span>
          </h1>
          <p className="text-gray-400 text-lg md:text-xl max-w-2xl mb-10">{HERO.sub}</p>
          <Link
            to="/play"
            className="inline-flex items-center justify-center gap-3 bg-brand hover:bg-amber-400 text-black font-extrabold text-xl md:text-2xl px-12 h-16 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.3)] hover:shadow-[0_0_60px_rgba(245,158,11,0.5)] hover:scale-105 transition-all duration-300"
          >
            {HERO.cta} <ArrowRight className="w-6 h-6" />
          </Link>
        </section>

        {/* 2. HOW IT WORKS */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-6xl">
            <SectionHeading eyebrow="How it works" title="Three steps. That's it." />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {STEPS.map((step, i) => (
                <div key={step.title} className="bg-dark-card border border-dark-border rounded-3xl p-8 flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <div className="bg-brand/10 text-brand p-3 rounded-xl border border-brand/20">
                      <step.icon className="w-6 h-6" />
                    </div>
                    <span className="font-display font-bold text-4xl text-white/10">{`0${i + 1}`}</span>
                  </div>
                  <h3 className="font-display font-bold text-xl text-white mb-3">{step.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. WHY IT'S DIFFERENT */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-4xl">
            <SectionHeading eyebrow="Why it's different" title="On-chain, not on trust." />
            <div className="overflow-x-auto rounded-3xl border border-dark-border">
              <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-dark-card">
                    <th className="p-5 text-xs font-bold uppercase tracking-wider text-gray-500"></th>
                    <th className="p-5 text-sm font-display font-bold text-brand">Instant Win</th>
                    <th className="p-5 text-sm font-display font-bold text-gray-400">Traditional lottery</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.label} className="border-t border-dark-border">
                      <td className="p-5 text-sm font-bold text-white align-top">{row.label}</td>
                      <td className="p-5 text-sm text-gray-200 align-top">
                        <span className="inline-flex items-start gap-2">
                          <Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> {row.instant}
                        </span>
                      </td>
                      <td className="p-5 text-sm text-gray-500 align-top">
                        <span className="inline-flex items-start gap-2">
                          <X className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" /> {row.traditional}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 4. TRANSPARENCY / PROOF */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-4xl">
            <SectionHeading eyebrow="Transparency" title="Don't trust. Verify." />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {contractLinks.map((c) => (
                <a
                  key={c.address}
                  href={`${ARBISCAN}${c.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-dark-card border border-dark-border rounded-2xl p-5 hover:border-brand/40 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">{c.label}</span>
                    <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-brand transition-colors" />
                  </div>
                  <span className="font-mono text-xs text-gray-500">{short(c.address)}</span>
                </a>
              ))}
            </div>

            <div className="bg-dark-card/50 border border-dark-border rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="bg-brand/10 text-brand p-3 rounded-xl border border-brand/20 w-fit">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p className="text-gray-400 text-sm leading-relaxed flex-1">
                Every draw is settled by{' '}
                <a href={CHAINLINK_VRF} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline font-medium">
                  Chainlink VRF
                </a>
                , which provides cryptographically verifiable randomness that no one — not even us — can predict or tamper with.
                This website is only an interface: the game itself lives on-chain.
              </p>
            </div>
          </div>
        </section>

        {/* 5. FAQ */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-3xl">
            <SectionHeading eyebrow="FAQ" title="Good questions." />
            <div className="space-y-3">
              {FAQ.map((item) => (
                <details
                  key={item.q}
                  className="group bg-dark-card/50 border border-dark-border rounded-2xl px-6 open:bg-dark-card transition-colors"
                >
                  <summary className="flex items-center justify-between gap-4 cursor-pointer list-none py-5 font-display font-bold text-white [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="w-5 h-5 text-brand shrink-0 transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <p className="text-gray-400 leading-relaxed pb-6 pr-6">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-6 py-20 md:py-28 border-t border-dark-border/50 text-center">
          <h2 className="font-display font-bold text-3xl md:text-5xl text-white mb-8 max-w-2xl mx-auto">
            The next draw is already running.
          </h2>
          <Link
            to="/play"
            className="inline-flex items-center justify-center gap-3 bg-brand hover:bg-amber-400 text-black font-extrabold text-xl px-12 h-16 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.3)] hover:shadow-[0_0_60px_rgba(245,158,11,0.5)] hover:scale-105 transition-all duration-300"
          >
            {HERO.cta} <ArrowRight className="w-6 h-6" />
          </Link>
        </section>
      </main>

      {/* 6. FOOTER */}
      <footer className="border-t border-dark-border py-10 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-6 space-y-6">
          {/* Contracts */}
          <div>
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

          {/* Responsible play */}
          <div className="border-t border-dark-border/60 pt-6 max-w-2xl mx-auto text-center space-y-2">
            <p className="text-xs text-gray-400 font-medium">
              18+. Play responsibly. This is a game of chance — never play with funds you can't afford to lose.
            </p>
            <p className="text-[11px] text-gray-600">
              Nothing on this page is financial advice. This site is an open-source interface to on-chain smart contracts.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};
