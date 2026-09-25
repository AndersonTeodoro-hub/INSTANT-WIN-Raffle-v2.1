import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Check, ArrowRight, CalendarOff, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS, INVESTOR_EMAIL, TELEGRAM_URL } from '../constants';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { useRoadmapCopy } from './roadmap.i18n';
import { Film, FilmAnchor, FilmSection, useFilmMode, type KeySpec } from '../components/film/Film';
import { ProofMark } from '../components/proof/ProofMark';
import { ProofSeal } from '../components/Proof';
import { useLatestDraw, type SettledDraw } from '../components/proof/useLatestDraw';
import { shortProof } from '../lib/proof/mark';
import { useLang, translations } from './landing.i18n';
import { useAppCopy } from './app.i18n';
import { useEventsCopy } from './events.i18n';

/*
 * A /roadmap é leitura: a cena abre a página e fecha-a, e sai de cena enquanto
 * se lêem os degraus. Ao lado deles, um carril que se preenche com o scroll; um
 * degrau vivo leva a forma do seu último sorteio liquidado, um degrau pretendido
 * um anel tracejado — ainda não há prova, portanto ainda não há forma.
 */
const KEYS = {
  hero: [{ at: 0, shape: 'rosette', zoom: 0.8, pitch: -0.42, yaw: 0.18, spin: 0.06 }],
  reading: [
    { at: 0, shape: 'rings', alpha: 0 },
    { at: 1, shape: 'rings', alpha: 0 },
  ],
  close: [{ at: 0.4, shape: 'rosette', zoom: 0.92, pitch: -0.3, spin: 0.05 }],
} satisfies Record<string, KeySpec[]>;

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

/** How far the reader is through the steps, drawn on the rail's fill (a transform, once per frame). */
function useRail() {
  const list = useRef<HTMLOListElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      if (!list.current || !fill.current) return;
      const rect = list.current.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.55 - rect.top) / rect.height));
      fill.current.style.transform = `scaleY(${progress})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return { list, fill };
}

/**
 * O nó de um degrau no carril: a forma do último sorteio do módulo quando há um;
 * vivo sem sorteio recente, o selo; pretendido, um anel tracejado.
 */
function StepNode({ live, draw, label }: { live: boolean; draw: SettledDraw | null; label: string }) {
  if (live && draw) return <ProofMark proof={draw.proof} size={56} label={label} className="bg-black" />;
  if (live)
    return (
      <span className="grid h-14 w-14 place-items-center rounded-full border border-success/40 bg-black text-success">
        <ProofSeal className="h-5 w-5" />
      </span>
    );
  return <ProofMark proof={null} size={56} label={label} className="bg-black" />;
}

export const Roadmap: React.FC = () => {
  const c = useRoadmapCopy();
  const [lang] = useLang();
  const t = translations[lang];
  const app = useAppCopy();
  const events = useEventsCopy();
  const { latest, round, campaign, loading } = useLatestDraw();
  const rail = useRail();
  /** A prova de cada degrau vivo, pela ordem de `copy.steps`: a lotaria, o Event Center. */
  const stepDraws = [round, campaign];

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
    <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-clip">
      {/* O cabeçalho da plataforma; a acção do contexto é a lista de espera. */}
      <SiteHeader
        nav={<PublicNavLinks />}
        actions={<HeaderAction href={TELEGRAM_URL} icon={Send} label={c.waitlist.short} />}
      />

      <Film
        proof={latest?.proof ?? (loading ? undefined : CONTRACTS.RAFFLE_MANAGER)}
        fallback={CONTRACTS.RAFFLE_MANAGER}
        winners={latest?.winnersCount ?? 3}
        lottery={round?.proof ?? null}
        campaign={campaign?.proof ?? null}
        pauseLabel={t.film.pause}
        playLabel={t.film.play}
      >
        <main className="iw-screen relative z-10 flex-1">
          {/* Herói: a regra da página, e ao lado a forma do último sorteio liquidado. */}
          <FilmSection id="rm-hero" pinned={false} label={c.hero.title}>
            <div className="container mx-auto max-w-5xl px-4 sm:px-6 pt-12 pb-10 sm:pt-20 sm:pb-16 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center lg:gap-14">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-4">{c.hero.eyebrow}</p>
                <h1 className="font-display font-bold text-[clamp(2.5rem,11vw,4.5rem)] leading-[1.02] tracking-tight mb-5">{c.hero.title}</h1>
                <p className="max-w-[56ch] text-gray-400 text-base sm:text-lg leading-relaxed">{c.hero.intro}</p>
              </div>
              <div className="mx-auto mt-10 w-full max-w-[20rem] lg:mt-0 lg:max-w-none">
                <FilmAnchor keys={KEYS.hero} className="aspect-square w-full" />
                <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-gray-400 lg:justify-start">
                  {latest ? (
                    <>
                      <ProofSeal className="h-3.5 w-3.5 text-success" />
                      <span>
                        {latest.kind === 'round' ? t.film.markOfRound : t.film.markOfCampaign} <span className="font-mono text-gray-300">{latest.id.toString()}</span>
                      </span>
                      <span className="font-mono text-success">{shortProof(latest.proof)}</span>
                    </>
                  ) : loading ? (
                    app.winners.reading
                  ) : (
                    t.film.markPending
                  )}
                </p>
              </div>
            </div>
          </FilmSection>

          <FilmSection id="rm-reading" pinned={false} label={c.overview.onchainLabel}>
            <FilmAnchor keys={KEYS.reading} ghost className="pointer-events-none absolute left-1/2 top-0 h-[40vh] w-[40vh] -translate-x-1/2" />
            <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
              {/* Síntese das quatro fases lado a lado — mesmo conteúdo da lista
                  abaixo, em formato de relance. Ícone + texto (não só cor) marcam
                  a distinção entre "verificado on-chain" e "pretendido nesta ordem",
                  para não depender de percepção de cor. */}
              <section className="mb-12 sm:mb-16">
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
                          <span className={clsx('text-xs font-medium truncate', onchain ? 'text-success' : 'text-gray-400')}>{step.status}</span>
                        </div>
                        <p className="font-display font-bold text-sm sm:text-base text-white leading-snug">{step.title}</p>
                      </li>
                    );
                  })}
                </ul>

                <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-gray-400 mt-4">
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

              {/* Os 4 degraus, num carril que se preenche com a leitura. */}
              <ol ref={rail.list} className="relative space-y-4 sm:space-y-6 pb-4 sm:pl-20">
                <span aria-hidden="true" className="absolute bottom-8 left-7 top-8 hidden w-px overflow-hidden bg-dark-line sm:block">
                  <span ref={rail.fill} className="block h-full w-full origin-top bg-success/70" style={{ transform: 'scaleY(0)' }} />
                </span>
                {c.steps.map((step, i) => {
                  const isLive = i < ONCHAIN_STEPS;
                  const draw = isLive ? (stepDraws[i] ?? null) : null;
                  const nodeLabel = draw ? `${draw.kind === 'round' ? app.proof.markRound : events.detail.proof.markCampaign} ${draw.id.toString()}` : step.status;
                  return (
                    <li key={step.num} className={clsx('relative p-6 sm:p-8', isLive ? 'iw-surface-raised' : 'iw-surface')}>
                      <span className="absolute -left-20 top-8 hidden sm:block">
                        <StepNode live={isLive} draw={draw} label={nodeLabel} />
                      </span>

                      <div className="flex items-center gap-4 mb-4">
                        <span className="font-display font-bold text-4xl sm:text-5xl leading-none text-gray-400">{step.num}</span>
                        <span className={clsx('inline-flex items-center gap-2 text-sm font-medium', isLive ? 'text-success' : 'text-gray-400')}>
                          {isLive && <span className="iw-live" aria-hidden="true" />}
                          {step.status}
                        </span>
                        <span className="ml-auto sm:hidden">
                          <StepNode live={isLive} draw={draw} label={nodeLabel} />
                        </span>
                      </div>

                      <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-4">{step.title}</h2>

                      <div className="space-y-4">
                        {step.body.map((para) => (
                          <p key={para.pre} className="text-gray-400 leading-relaxed">
                            {para.pre}
                            {para.strong && <strong className="font-semibold text-gray-200">{para.strong}</strong>}
                            {para.post}
                          </p>
                        ))}
                      </div>

                      {step.bulletsIntro && <p className="text-gray-400 leading-relaxed mt-5">{step.bulletsIntro}</p>}

                      {step.bullets && (
                        <ul className="mt-4 space-y-3">
                          {step.bullets.map((b) => (
                            <li key={b.lead} className="flex gap-3 text-gray-400 leading-relaxed">
                              <span className="text-gray-400 shrink-0" aria-hidden="true">&middot;</span>
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
                          <p className="text-xs text-gray-400 mb-2">{step.verify}</p>
                          <a
                            href={`${ARBISCAN}${VERIFY_ADDRESSES[i]}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-3 min-h-[44px] rounded-control border border-dark-border bg-black/40 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors duration-200"
                          >
                            <span className="break-all">{VERIFY_ADDRESSES[i]}</span>
                            <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                          </a>
                        </div>
                      )}

                      {step.note && <p className="text-gray-400 text-sm leading-relaxed mt-6 pt-5 border-t border-dark-border">{step.note}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          </FilmSection>

          {/* Fecho: a forma volta, e o convite — investidores e parceiros. */}
          <FilmSection id="rm-close" length="150svh" label={c.outro.ctaLine1}>
            <RoadmapClose c={c} />
          </FilmSection>
        </main>
      </Film>

      <footer className="relative z-10 border-t border-dark-border py-8 bg-black/80">
        <div className="container mx-auto px-4 text-center space-y-2">
          <PublicFooterNav />
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            &larr; {c.outro.back}
          </Link>
          <p className="text-xs text-gray-400 mt-2">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};

/** O fecho: a forma volta, a nota sem datas, e o convite a falar connosco — o botão principal da página. */
function RoadmapClose({ c }: { c: ReturnType<typeof useRoadmapCopy> }) {
  const live = useFilmMode() === 'live';
  return (
    <div className={clsx('container mx-auto flex max-w-3xl flex-col items-center px-4 sm:px-6 text-center', live ? 'h-full justify-center pt-24 pb-16' : 'py-16 sm:py-24')}>
      <FilmAnchor keys={KEYS.close} className="aspect-square w-full max-w-[min(56vw,calc(100svh_-_30rem))] sm:max-w-[min(16rem,calc(100svh_-_30rem))]" />
      <div data-film-panel className="mt-6 w-full">
        {/* Nota antes do CTA: sem datas, sem promessa de calendário. */}
        <p className="text-gray-400 text-sm leading-relaxed max-w-xl mx-auto">{c.outro.note}</p>
        <div className="iw-surface mt-8 p-8 sm:p-10">
          <p className="font-display font-bold text-xl sm:text-2xl text-white mb-2">{c.outro.ctaLine1}</p>
          <p className="text-gray-400 leading-relaxed mb-8">{c.outro.ctaLine2}</p>
          {/* O botão principal da página: âmbar, o único dela. Era branco cheio, fora do sistema. */}
          <a href={`mailto:${INVESTOR_EMAIL}`} className="iw-btn iw-btn-primary w-full sm:w-auto px-10 h-14 sm:h-16 font-extrabold text-lg sm:text-xl">
            {c.outro.ctaButton}
          </a>
        </div>
      </div>
    </div>
  );
}
