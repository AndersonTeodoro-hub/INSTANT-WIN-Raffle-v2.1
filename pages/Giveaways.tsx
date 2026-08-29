import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { CONTRACTS, GIVEAWAY_LIMITS } from '../constants';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { WaitlistLink } from '../components/WaitlistLink';
import { GiveawayWizard } from '../components/GiveawayWizard';
import { useGiveawaysCopy } from './giveaways.i18n';

const ARBISCAN = 'https://arbiscan.io/address/';

/**
 * Valores das constantes do contrato, compostos a partir de GIVEAWAY_LIMITS.
 *
 * Emparelham posicionalmente com `copy.proof.specs`, que só tem os rótulos —
 * mesma convenção dos STEP_ICONS da Landing. Assim um número só existe num
 * sítio: se o contrato mudar, muda em constants.ts e a página acompanha.
 */
const SPECS = [
  `${Number(GIVEAWAY_LIMITS.FEE_BPS) / 100}%`,
  `Up to ${GIVEAWAY_LIMITS.MAX_WINNERS.toLocaleString('en-US')}`,
  `Up to ${GIVEAWAY_LIMITS.MAX_PARTICIPANTS.toLocaleString('en-US')}`,
  'Any ERC-20',
  `${GIVEAWAY_LIMITS.MIN_DURATION_HOURS} hour – ${GIVEAWAY_LIMITS.MAX_DURATION_HOURS / 24} days`,
];

export const Giveaways: React.FC = () => {
  const c = useGiveawaysCopy();

  /*
   * SEO desta rota, mesmo mecanismo da /roadmap: o site é uma SPA com um só
   * index.html, por isso o title e a description mudam aqui e são repostos à
   * saída. As tags Open Graph ficam as do index.html — os scrapers do X e do
   * Telegram não correm JS, reescrevê-las aqui só criava a ilusão de um card
   * próprio.
   */
  useEffect(() => {
    const prevTitle = document.title;
    const tag = document.querySelector('meta[name="description"]');
    const prevDesc = tag?.getAttribute('content') ?? '';

    document.title = c.meta.title;
    tag?.setAttribute('content', c.meta.description);

    return () => {
      document.title = prevTitle;
      tag?.setAttribute('content', prevDesc);
    };
  }, [c]);

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden">

      {/* Um só glow ambiente, azul — como a /roadmap. */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <header className="sticky top-0 z-20 border-b border-dark-border/60 bg-black/70 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-baseline gap-2 min-w-0 min-h-[44px] py-2">
            <span className="font-display font-bold text-xl sm:text-2xl text-white tracking-tight leading-none truncate">
              INSTANT WIN
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 translate-y-[1px]">
              <path d="M4 12.5 L9.5 18 L20 6" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>

          <div className="flex items-center gap-2">
            <PublicNavLinks />
            <WaitlistLink label={c.waitlist.short} className="hidden sm:inline-flex px-5 text-sm" />
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10 container mx-auto px-4 sm:px-6 max-w-3xl">

        {/* Herói */}
        <section className="pt-12 pb-10 sm:pt-20 sm:pb-14">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-4">
            {c.hero.eyebrow}
          </p>
          <h1 className="font-display font-bold text-[clamp(2.5rem,11vw,4rem)] leading-[1.05] mb-5">
            {c.hero.title}
          </h1>
          <p className="text-gray-400 text-base sm:text-lg leading-relaxed">{c.hero.intro}</p>

          <ul className="mt-8 space-y-3">
            {c.hero.bullets.map((b) => (
              <li key={b.lead} className="flex gap-3 text-gray-400 leading-relaxed">
                <span className="font-mono text-gray-600 shrink-0" aria-hidden="true">&middot;</span>
                <span>
                  <strong className="font-semibold text-gray-200">{b.lead}</strong>
                  {b.rest}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Prova — o único verde da página vive neste bloco. */}
        <section className="pb-12 sm:pb-16">
          <div className="bg-dark-card border border-dark-border rounded-xl p-6 sm:p-8">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-3">
              {c.proof.eyebrow}
            </p>
            <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-6">{c.proof.title}</h2>

            <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">
              {c.proof.verifyLabel}
            </p>
            <a
              href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 min-h-[44px] rounded-lg border border-dark-border bg-black/40 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors"
            >
              <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER}</span>
              <ExternalLink className="w-4 h-4 shrink-0" />
            </a>

            <p className="mt-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-success">
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              {c.proof.matchLabel}
            </p>

            {/* Constantes reais do contrato. Duas colunas já em telemóvel:
                são pares rótulo/valor curtos e uma coluna só desperdiçava altura. */}
            <dl className="mt-8 grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-6 gap-y-5">
              {c.proof.specs.map((label, i) => (
                <div key={label}>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</dt>
                  <dd className="font-mono text-lg sm:text-xl font-bold text-white">{SPECS[i]}</dd>
                </div>
              ))}
            </dl>

            <p className="text-gray-500 text-sm leading-relaxed mt-8 pt-6 border-t border-dark-border">
              {c.proof.discipline}
            </p>
          </div>
        </section>

        {/* Fluxo de criação em preview */}
        <section className="pb-14 sm:pb-20">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-3">
            {c.wizard.eyebrow}
          </p>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-white mb-4">{c.wizard.title}</h2>
          <p className="text-gray-400 leading-relaxed mb-8">{c.wizard.intro}</p>

          <GiveawayWizard />
        </section>

        {/* CTA de participante: uma só lista de espera para todo o Event Center. */}
        <section className="pb-16 sm:pb-24 text-center">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-3">
            {c.participants.eyebrow}
          </p>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-4">{c.participants.title}</h2>
          <p className="text-gray-400 leading-relaxed max-w-xl mx-auto mb-8">{c.participants.body}</p>
          <WaitlistLink
            label={c.waitlist.cta}
            withArrow
            className="inline-flex w-full sm:w-auto px-10 h-14 sm:h-16 text-lg sm:text-xl"
          />
        </section>
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 space-y-4 text-center">
          <PublicFooterNav />
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] font-mono text-[11px] uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
          >
            &larr; {c.outro.back}
          </Link>
          <p className="font-mono text-[10px] text-gray-700">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};
