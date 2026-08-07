import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ArrowRight, Wallet, Zap, Check, X, ExternalLink, ShieldCheck, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS } from '../constants';
import { useLang, translations, LANGS, LANG_LABEL } from './landing.i18n';

const ARBISCAN = 'https://arbiscan.io/address/';
const CHAINLINK_VRF = 'https://docs.chain.link/vrf';

// Public landing: only these contracts may be surfaced (regulatory).
// Do not add internal-only registries here. Names stay as on-chain identifiers.
const contractLinks = [
  { label: 'Raffle Manager', address: CONTRACTS.RAFFLE_MANAGER },
  { label: 'Username Registry', address: CONTRACTS.USERNAME_REGISTRY },
  { label: 'USDC', address: CONTRACTS.USDC },
];

// Icons pair positionally with copy.how.steps (kept out of i18n).
const STEP_ICONS = [Wallet, Zap, Trophy];

const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

const SectionHeading: React.FC<{ eyebrow: string; title: string }> = ({ eyebrow, title }) => (
  <div className="text-center mb-12 md:mb-16">
    <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">{eyebrow}</p>
    <h2 className="font-display font-bold text-3xl md:text-5xl text-white">{title}</h2>
  </div>
);

export const Landing: React.FC = () => {
  const [lang, setLang] = useLang();
  const t = translations[lang];

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden selection:bg-brand/30 selection:text-white">

      {/* Premium Ambient Background Glows (Gold & Blue) */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-brand/5 rounded-full blur-[120px] pointer-events-none z-0" />

      {/* Minimal public header — language selector + Enter App. No wallet connect here. */}
      <header className="relative z-20 border-b border-dark-border/60 backdrop-blur-sm sticky top-0 bg-black/70">
        <div className="container mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-2">
          {/* Mesma marca da navbar: wordmark em HTML puro + check verde inline.
              Abaixo de 400px fica só o check. */}
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="hidden min-[400px]:inline font-display font-bold text-xl text-white tracking-tight leading-none truncate">
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
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Language selector */}
            <div role="group" aria-label="Language" className="inline-flex items-center rounded-lg border border-dark-border bg-dark-card/60 p-0.5">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={clsx(
                    // 44px de alvo de toque: os px-2/py-1 anteriores davam ~28×24px.
                    'flex items-center justify-center min-w-[44px] min-h-[44px] font-mono text-xs font-bold rounded-md transition-colors',
                    lang === l ? 'bg-brand text-black' : 'text-gray-400 hover:text-white'
                  )}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>

            <Link
              to="/play"
              className="inline-flex items-center gap-2 bg-brand/10 hover:bg-brand/20 text-brand font-bold text-sm px-3 sm:px-5 py-2.5 rounded-xl border border-brand/20 transition-colors whitespace-nowrap"
            >
              {t.header.enterApp} <ArrowRight className="w-4 h-4 hidden sm:block" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10">

        {/* 1. HERO */}
        <section className="flex flex-col items-center text-center px-5 sm:px-6 pt-12 pb-16 md:pt-28 md:pb-32">
          <div className="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 text-brand text-[11px] sm:text-xs font-bold px-3 sm:px-4 py-1.5 rounded-full mb-6 sm:mb-8 max-w-full">
            <ShieldCheck className="w-4 h-4 shrink-0" /> <span className="truncate">{t.hero.badge}</span>
          </div>
          <h1 className="font-display font-bold text-[clamp(2.75rem,13vw,4.5rem)] md:text-7xl leading-[1.05] max-w-4xl mb-5 sm:mb-6">
            {t.hero.headlineTop}
            <span className="block text-brand">{t.hero.headlineBottom}</span>
          </h1>
          <p className="text-gray-400 text-base sm:text-lg md:text-xl max-w-2xl mb-8 sm:mb-10">{t.hero.sub}</p>
          <Link
            to="/play"
            className="inline-flex items-center justify-center gap-3 bg-brand hover:bg-amber-400 text-black font-extrabold text-xl md:text-2xl px-12 h-16 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.3)] hover:shadow-[0_0_60px_rgba(245,158,11,0.5)] hover:scale-105 transition-all duration-300"
          >
            {t.hero.cta} <ArrowRight className="w-6 h-6" />
          </Link>
        </section>

        {/* 2. HOW IT WORKS */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-6xl">
            <SectionHeading eyebrow={t.how.eyebrow} title={t.how.title} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {t.how.steps.map((step, i) => {
                const Icon = STEP_ICONS[i] ?? Trophy;
                return (
                  <div key={i} className="bg-dark-card border border-dark-border rounded-3xl p-8 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <div className="bg-brand/10 text-brand p-3 rounded-xl border border-brand/20">
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="font-display font-bold text-4xl text-white/10">{`0${i + 1}`}</span>
                    </div>
                    <h3 className="font-display font-bold text-xl text-white mb-3">{step.title}</h3>
                    <p className="text-gray-400 leading-relaxed">{step.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 3. WHY IT'S DIFFERENT */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-4xl">
            <SectionHeading eyebrow={t.why.eyebrow} title={t.why.title} />
            <div className="overflow-x-auto rounded-3xl border border-dark-border">
              <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-dark-card">
                    <th className="p-5 text-xs font-bold uppercase tracking-wider text-gray-500"></th>
                    <th className="p-5 text-sm font-display font-bold text-brand">{t.why.colInstant}</th>
                    <th className="p-5 text-sm font-display font-bold text-gray-400">{t.why.colTraditional}</th>
                  </tr>
                </thead>
                <tbody>
                  {t.why.rows.map((row) => (
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
            <SectionHeading eyebrow={t.transparency.eyebrow} title={t.transparency.title} />

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
                {t.transparency.vrfPre}
                <a href={CHAINLINK_VRF} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline font-medium">
                  Chainlink VRF
                </a>
                {t.transparency.vrfPost}
              </p>
            </div>
          </div>
        </section>

        {/* 5. FAQ */}
        <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-3xl">
            <SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} />
            <div className="space-y-3">
              {t.faq.items.map((item) => (
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
            {t.finalCta.title}
          </h2>
          <Link
            to="/play"
            className="inline-flex items-center justify-center gap-3 bg-brand hover:bg-amber-400 text-black font-extrabold text-xl px-12 h-16 rounded-2xl shadow-[0_0_40px_rgba(245,158,11,0.3)] hover:shadow-[0_0_60px_rgba(245,158,11,0.5)] hover:scale-105 transition-all duration-300"
          >
            {t.hero.cta} <ArrowRight className="w-6 h-6" />
          </Link>
        </section>
      </main>

      {/* 6. FOOTER */}
      <footer className="border-t border-dark-border py-10 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-6 space-y-6">
          {/* Contracts */}
          <div>
            <p className="text-center text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-4">
              {t.footer.contractsLabel}
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
            <p className="text-xs text-gray-400 font-medium">{t.footer.responsible}</p>
            <p className="text-[11px] text-gray-600">{t.footer.disclaimer}</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
