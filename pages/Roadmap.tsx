import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS } from '../constants';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { WaitlistLink } from '../components/WaitlistLink';
import { useRoadmapCopy } from './roadmap.i18n';

const ARBISCAN = 'https://arbiscan.io/address/';

/**
 * Índice do degrau que já está on-chain. Emparelha posicionalmente com
 * `copy.steps` — é estado visual, portanto fora do i18n (mesma convenção dos
 * STEP_ICONS da Landing).
 *
 * É o único sítio desta página onde o verde é permitido, além do link para o
 * Arbiscan logo abaixo: verde aqui significa "verificável agora", não decoração.
 * Âmbar não aparece em lado nenhum — nesta página não há valores de prémio.
 */
const LIVE_STEP = 0;

export const Roadmap: React.FC = () => {
  const c = useRoadmapCopy();

  /*
   * SEO desta rota. O site é uma SPA com um único index.html, por isso o title e
   * a description mudam aqui e são repostos à saída — sem isso, navegar
   * /roadmap → / deixava o título do roadmap na aba da home.
   *
   * As tags Open Graph ficam as do index.html: os scrapers do X e do Telegram
   * não correm JS, portanto reescrevê-las aqui só criaria a ilusão de um card
   * próprio. O preview partilhado continua a ser o og-image do site.
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

      {/* Um só glow ambiente, azul. O âmbar da Landing não entra aqui. */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />

      {/*
        Header fixo: é também a presença persistente da waitlist — o link
        acompanha o scroll em vez de haver uma segunda barra a competir com o
        conteúdo. Abaixo de sm fica só a marca (não há espaço para dois alvos de
        44px); no telemóvel o CTA grande do fim da página faz esse trabalho.
      */}
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
        <section className="pt-12 pb-10 sm:pt-20 sm:pb-16">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-4">
            {c.hero.eyebrow}
          </p>
          <h1 className="font-display font-bold text-[clamp(2.5rem,11vw,4rem)] leading-[1.05] mb-5">
            {c.hero.title}
          </h1>
          <p className="text-gray-400 text-base sm:text-lg leading-relaxed">{c.hero.intro}</p>
        </section>

        {/* Os 4 degraus */}
        <ol className="space-y-4 sm:space-y-6 pb-4">
          {c.steps.map((step, i) => {
            const isLive = i === LIVE_STEP;
            return (
              <li key={step.num} className="bg-dark-card border border-dark-border rounded-xl p-6 sm:p-8">

                <div className="flex items-center gap-4 mb-4">
                  <span className="font-display font-bold text-4xl sm:text-5xl leading-none text-white/10">
                    {step.num}
                  </span>
                  <span
                    className={clsx(
                      'inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em]',
                      isLive ? 'text-success' : 'text-gray-500',
                    )}
                  >
                    {isLive && <span className="w-2 h-2 rounded-full bg-success animate-pulse" />}
                    {step.status}
                  </span>
                </div>

                <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-4">{step.title}</h2>

                <div className="space-y-4">
                  {step.body.map((p) => (
                    <p key={p.pre} className="text-gray-400 leading-relaxed">
                      {p.pre}
                      {p.strong && <strong className="font-semibold text-gray-200">{p.strong}</strong>}
                      {p.post}
                    </p>
                  ))}
                </div>

                {step.bulletsIntro && (
                  <p className="text-gray-400 leading-relaxed mt-5">{step.bulletsIntro}</p>
                )}

                {step.bullets && (
                  <ul className="mt-4 space-y-3">
                    {step.bullets.map((b) => (
                      <li key={b.lead} className="flex gap-3 text-gray-400 leading-relaxed">
                        <span className="font-mono text-gray-600 shrink-0" aria-hidden="true">&middot;</span>
                        <span>
                          <strong className="font-semibold text-gray-200">{b.lead}</strong>
                          {b.rest}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Prova verificável: o único link verde da página. */}
                {step.verify && (
                  <div className="mt-6">
                    <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">
                      {step.verify}
                    </p>
                    <a
                      href={`${ARBISCAN}${CONTRACTS.RAFFLE_MANAGER}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 min-h-[44px] rounded-lg border border-dark-border bg-black/40 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors"
                    >
                      <span className="break-all">{CONTRACTS.RAFFLE_MANAGER}</span>
                      <ExternalLink className="w-4 h-4 shrink-0" />
                    </a>
                  </div>
                )}

                {step.note && (
                  <p className="text-gray-500 text-sm leading-relaxed mt-6 pt-5 border-t border-dark-border">
                    {step.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {/* CTA final */}
        <section className="py-14 sm:py-20 text-center">
          <p className="font-display font-bold text-2xl sm:text-3xl text-white mb-6">{c.outro.closing}</p>
          <WaitlistLink
            label={c.waitlist.cta}
            withArrow
            className="inline-flex w-full sm:w-auto px-10 h-14 sm:h-16 text-lg sm:text-xl"
          />
        </section>
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 text-center space-y-2">
          <PublicFooterNav />
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] font-mono text-[11px] uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
          >
            &larr; {c.outro.back}
          </Link>
          <p className="font-mono text-[10px] text-gray-700 mt-2">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};
