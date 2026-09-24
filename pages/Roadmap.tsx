import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Check, ArrowRight, CalendarOff, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS, INVESTOR_EMAIL, TELEGRAM_URL } from '../constants';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { useRoadmapCopy } from './roadmap.i18n';

const ARBISCAN = 'https://arbiscan.io/address/';

/**
 * Quantos degraus iniciais entram no grupo "ao vivo / verificado on-chain"
 * (Lotaria + Event Center: ambos têm contratos implementados, verificados e
 * despausados). Emparelha posicionalmente com `copy.steps`. Governa tanto a
 * síntese (Check verde vs. seta cinzenta) como o estado "live" de cada cartão
 * na lista detalhada — é estado visual, portanto fora do i18n (mesma
 * convenção dos STEP_ICONS da Landing).
 *
 * É o único sítio desta página onde o verde é permitido, além do link para o
 * Arbiscan logo abaixo: verde aqui significa "verificável agora", não decoração.
 * Âmbar não aparece em lado nenhum — nesta página não há valores de prémio.
 */
const ONCHAIN_STEPS = 2;

/** Endereço a verificar por degrau, posicional com `copy.steps`. */
const VERIFY_ADDRESSES = [CONTRACTS.RAFFLE_MANAGER, CONTRACTS.GIVEAWAY_MANAGER_V2];

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
    <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-hidden">


      {/*
        Header fixo: é também a presença persistente da waitlist — o link
        acompanha o scroll em vez de haver uma segunda barra a competir com o
        conteúdo. Abaixo de sm fica só a marca (não há espaço para dois alvos de
        44px); no telemóvel o CTA grande do fim da página faz esse trabalho.
      */}
      {/* O cabeçalho da plataforma; a acção do contexto é a lista de espera. */}
      <SiteHeader
        nav={<PublicNavLinks />}
        actions={<HeaderAction href={TELEGRAM_URL} icon={Send} label={c.waitlist.short} />}
      />

      <main className="flex-1 container mx-auto px-4 sm:px-6 max-w-3xl">

        {/* Herói */}
        <section className="pt-12 pb-10 sm:pt-20 sm:pb-16">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-4">
            {c.hero.eyebrow}
          </p>
          <h1 className="font-display font-bold text-[clamp(2.5rem,11vw,4rem)] leading-[1.05] mb-5">
            {c.hero.title}
          </h1>
          <p className="text-gray-400 text-base sm:text-lg leading-relaxed">{c.hero.intro}</p>
        </section>

        {/* Síntese das quatro fases lado a lado — mesmo conteúdo da lista
            abaixo, em formato de relance. Ícone + texto (não só cor) marcam
            a distinção entre "verificado on-chain" e "pretendido nesta ordem",
            para não depender de percepção de cor. */}
        <section className="mb-10 sm:mb-16">
          <ul role="list" className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {c.steps.map((step, i) => {
              const onchain = i < ONCHAIN_STEPS;
              return (
                <li
                  key={step.num}
                  className={clsx(
                    'rounded-card border p-3 sm:p-4',
                    onchain ? 'border-success/40 bg-success/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' : 'border-dark-border border-dashed bg-dark-card',
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {onchain ? (
                      <Check className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 shrink-0" aria-hidden="true" />
                    )}
                    <span
                      className={clsx(
                        'font-mono text-[10px] font-bold uppercase tracking-wider truncate',
                        onchain ? 'text-success' : 'text-gray-400',
                      )}
                    >
                      {step.status}
                    </span>
                  </div>
                  <p className="font-display font-bold text-sm sm:text-base text-white leading-snug">
                    {step.title}
                  </p>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-4">
            <span className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success shrink-0" aria-hidden="true" />
              {c.overview.onchainLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" aria-hidden="true" />
              {c.overview.intendedLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarOff className="w-3 h-3 text-gray-400 shrink-0" aria-hidden="true" />
              {c.overview.note}
            </span>
          </div>
        </section>

        {/* Os 4 degraus */}
        <ol className="space-y-4 sm:space-y-6 pb-4">
          {c.steps.map((step, i) => {
            const isLive = i < ONCHAIN_STEPS;
            return (
              <li key={step.num} className={clsx('p-6 sm:p-8', isLive ? 'iw-surface-raised' : 'iw-surface')}>

                <div className="flex items-center gap-4 mb-4">
                  <span className="font-display font-bold text-4xl sm:text-5xl leading-none text-gray-400">
                    {step.num}
                  </span>
                  <span
                    className={clsx(
                      'inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em]',
                      isLive ? 'text-success' : 'text-gray-400',
                    )}
                  >
                    {isLive && <span className="iw-live" aria-hidden="true" />}
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
                        <span className="font-mono text-gray-400 shrink-0" aria-hidden="true">&middot;</span>
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
                    <p className="font-mono text-[11px] uppercase tracking-widest text-gray-400 mb-2">
                      {step.verify}
                    </p>
                    <a
                      href={`${ARBISCAN}${VERIFY_ADDRESSES[i]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 min-h-[44px] rounded-control border border-dark-border bg-black/40 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors duration-200"
                    >
                      <span className="break-all">{VERIFY_ADDRESSES[i]}</span>
                      <ExternalLink className="w-4 h-4 shrink-0" />
                    </a>
                  </div>
                )}

                {step.note && (
                  <p className="text-gray-400 text-sm leading-relaxed mt-6 pt-5 border-t border-dark-border">
                    {step.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {/* Nota antes do CTA: sem datas, sem promessa de calendário. */}
        <p className="text-gray-400 text-sm leading-relaxed text-center max-w-xl mx-auto pt-10 sm:pt-14">
          {c.outro.note}
        </p>

        {/* CTA final — investidores e parceiros, não a waitlist. Sem âmbar
            nem verde: esta página reserva ambos para outro significado. */}
        <section className="py-8 sm:py-12 pb-14 sm:pb-20 text-center">
          <div className="iw-surface p-8 sm:p-10">
            <p className="font-display font-bold text-xl sm:text-2xl text-white mb-2">{c.outro.ctaLine1}</p>
            <p className="text-gray-400 leading-relaxed mb-8">{c.outro.ctaLine2}</p>
            <a
              href={`mailto:${INVESTOR_EMAIL}`}
              className="iw-btn w-full sm:w-auto px-10 h-14 sm:h-16 bg-white text-black font-extrabold text-lg sm:text-xl hover:bg-gray-200"
            >
              {c.outro.ctaButton}
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80">
        <div className="container mx-auto px-4 text-center space-y-2">
          <PublicFooterNav />
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] font-mono text-[11px] uppercase tracking-widest text-gray-400 hover:text-white transition-colors"
          >
            &larr; {c.outro.back}
          </Link>
          <p className="font-mono text-[10px] text-gray-400 mt-2">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};
