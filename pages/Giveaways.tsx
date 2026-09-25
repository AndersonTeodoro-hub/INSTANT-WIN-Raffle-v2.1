import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ExternalLink, Send, Coins, Shuffle, Users } from 'lucide-react';
import { CONTRACTS, GIVEAWAY_LIMITS, TELEGRAM_URL } from '../constants';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { WaitlistLink } from '../components/WaitlistLink';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { GiveawayWizard } from '../components/GiveawayWizard';
import { ProofSeal } from '../components/Proof';
import { useGiveawaysCopy } from './giveaways.i18n';
import type { GiveawaysCopy } from './giveaways.i18n';
import { Film, FilmAnchor, FilmSection, useFilmMode, type KeySpec } from '../components/film/Film';
import { Chapter, ChapterHead, SceneCaption } from '../components/film/Chapter';
import { useLatestCampaignDraw } from '../components/proof/useLatestDraw';
import { shortProof } from '../lib/proof/mark';
import { useLang, translations, type SceneCaptionKey } from './landing.i18n';

/*
 * O filme da /giveaways: a forma é a da última campanha liquidada do Event
 * Center (a semente do VRF); cada afirmação do herói é um capítulo, com a peça
 * que a prova ao lado do texto.
 */
const KEYS = {
  hero: [{ at: 0, shape: 'rosette', zoom: 0.8, pitch: -0.42, yaw: 0.18, spin: 0.06 }],
  bullets: [
    [{ at: 0.2, shape: 'ticket', yaw: -0.32, pitch: -0.55, roll: 0.06, zoom: 1.02 }],
    [{ at: 0.2, shape: 'rings', pitch: -1.05, yaw: 0.45, zoom: 0.9 }],
    [
      { at: 0.06, shape: 'chaos', zoom: 0.95, spin: 0.02 },
      { at: 0.6, shape: 'reveal', tint: 0.3, zoom: 1, spin: 0.015, still: true },
    ],
    [{ at: 0.2, shape: 'payout', flow: 1, zoom: 0.86, pitch: -0.28 }],
    [{ at: 0.2, shape: 'modules', zoom: 0.84, pitch: -0.3 }],
  ],
  reading: [
    { at: 0, shape: 'rings', alpha: 0 },
    { at: 1, shape: 'rings', alpha: 0 },
  ],
  close: [{ at: 0.4, shape: 'rosette', zoom: 0.92, pitch: -0.3, spin: 0.05 }],
} satisfies Record<string, KeySpec[] | KeySpec[][]>;

/** Capítulos com a cena larga (o fluxo do prémio, os vários sorteios). */
const WIDE = [false, false, false, true, true];

/** A legenda de cada forma, posicional com KEYS.bullets. */
const CAPTIONS: readonly SceneCaptionKey[] = ['entry', 'prize', 'pick', 'payout', 'modules'];

/** "— the creator funds…" → "The creator funds…": o resto da frase, como parágrafo do capítulo. */
const asParagraph = (rest: string) => {
  const text = rest.replace(/^\s*—\s*/, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const ARBISCAN = 'https://arbiscan.io/address/';

/**
 * Valores das constantes do contrato, compostos a partir de GIVEAWAY_LIMITS.
 *
 * Emparelham posicionalmente com `copy.proof.specs`, que só tem os rótulos —
 * mesma convenção dos STEP_ICONS da Landing. Assim um número só existe num
 * sítio: se o contrato mudar, muda em constants.ts e a página acompanha.
 *
 * As palavras à volta vêm do i18n (`specWords`) e os números não: os limites
 * são o que o contrato faz e ficam idênticos nas três línguas; o "Up to" é que
 * tem de dizer "Até" em português. Em inglês o resultado é byte a byte o mesmo
 * de antes.
 */
const specValues = (w: GiveawaysCopy['proof']['specWords']) => [
  `${Number(GIVEAWAY_LIMITS.FEE_BPS) / 100}%`,
  `${w.upTo} ${GIVEAWAY_LIMITS.MAX_WINNERS.toLocaleString('en-US')}`,
  `${w.upTo} ${GIVEAWAY_LIMITS.MAX_PARTICIPANTS.toLocaleString('en-US')}`,
  w.anyErc20,
  `${GIVEAWAY_LIMITS.MIN_DURATION_HOURS} ${w.hour} – ${GIVEAWAY_LIMITS.MAX_DURATION_HOURS / 24} ${w.days}`,
];

/**
 * A prova ou a ilustração de cada afirmação do herói, pela ordem de
 * `hero.bullets`: entrada a zero, qualquer ERC-20, o sorteio do Chainlink VRF,
 * o contrato de onde se reclama (verde: é verificável agora) e quem pode criar.
 */
const BulletEvidence: React.FC<{ index: number; upTo: string }> = ({ index, upTo }) => {
  const tile = 'flex h-14 items-center gap-3 rounded-control border border-dark-border bg-black/40 px-4';
  switch (index) {
    case 0:
      return (
        <div className={tile}>
          <span className="font-mono text-2xl font-bold text-white">0.00</span>
          <span className="font-mono text-xs text-gray-400">USDC</span>
        </div>
      );
    case 1:
      return (
        <div className={tile}>
          <Coins className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
          <span className="font-mono text-sm text-white">ERC-20</span>
        </div>
      );
    case 2:
      return (
        <div className={tile}>
          <Shuffle className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
          <span className="font-mono text-sm text-white">Chainlink VRF</span>
        </div>
      );
    case 3:
      return (
        <a
          href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${tile} justify-between font-mono text-sm text-success transition-colors duration-200 hover:border-success/40`}
        >
          <span className="flex items-center gap-2">
            <ProofSeal className="h-4 w-4" />
            {`${CONTRACTS.GIVEAWAY_MANAGER_V2.slice(0, 6)}…${CONTRACTS.GIVEAWAY_MANAGER_V2.slice(-4)}`}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a>
      );
    default:
      return (
        <div className={tile}>
          <Users className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
          <span className="font-mono text-sm text-white">{`${upTo} ${GIVEAWAY_LIMITS.MAX_PARTICIPANTS.toLocaleString('en-US')}`}</span>
        </div>
      );
  }
};

export const Giveaways: React.FC = () => {
  const c = useGiveawaysCopy();
  const specs = specValues(c.proof.specWords);
  const [lang] = useLang();
  const t = translations[lang];
  const campaign = useLatestCampaignDraw();

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
    <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-clip">
      {/* O cabeçalho da plataforma; a acção do contexto é a lista de espera. */}
      <SiteHeader
        nav={<PublicNavLinks />}
        actions={<HeaderAction href={TELEGRAM_URL} icon={Send} label={c.waitlist.short} />}
      />

      <Film
        proof={campaign.draw?.proof ?? (campaign.loading ? undefined : CONTRACTS.GIVEAWAY_MANAGER_V2)}
        fallback={CONTRACTS.GIVEAWAY_MANAGER_V2}
        winners={campaign.draw?.winnersCount ?? 3}
        campaign={campaign.draw?.proof ?? null}
        pauseLabel={t.film.pause}
        playLabel={t.film.play}
      >
        <main className="iw-screen relative z-10 flex-1">
          {/* Herói: a promessa, e ao lado a forma da última campanha liquidada. */}
          <FilmSection id="gw-hero" pinned={false} label={c.hero.title}>
            <div className="container mx-auto max-w-6xl px-4 sm:px-6 pt-12 pb-12 sm:pt-20 sm:pb-16 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-14">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-4">{c.hero.eyebrow}</p>
                <h1 className="font-display font-bold text-[clamp(2.5rem,11vw,4.5rem)] leading-[1.02] tracking-tight mb-5">{c.hero.title}</h1>
                <p className="max-w-[60ch] text-gray-400 text-base sm:text-lg leading-relaxed">{c.hero.intro}</p>
              </div>
              <div className="mx-auto mt-10 w-full max-w-[24rem] lg:mt-0 lg:max-w-none">
                <FilmAnchor keys={KEYS.hero} className="aspect-square w-full" />
                <SceneCaption text={t.film.captions.mark} className="lg:mx-0 lg:text-left" />
                <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-gray-400 lg:justify-start">
                  {campaign.draw ? (
                    <>
                      <ProofSeal className="h-3.5 w-3.5 text-success" />
                      <span>
                        {t.film.markOfCampaign} <span className="font-mono text-gray-300">{campaign.draw.id.toString()}</span>
                      </span>
                      <Link
                        to={`/events/${campaign.draw.id.toString()}`}
                        className="inline-flex min-h-[32px] items-center font-mono text-success underline decoration-success/30 underline-offset-4 hover:decoration-success"
                      >
                        {shortProof(campaign.draw.proof)}
                      </Link>
                    </>
                  ) : (
                    t.film.markPending
                  )}
                </p>
              </div>
            </div>
          </FilmSection>

          {/*
            Cada afirmação leva a peça que a prova ou ilustra — um número, o nome
            do protocolo, o contrato — e a cena que lhe corresponde.
          */}
          {c.hero.bullets.map((b, i) => (
            <Chapter key={b.lead} id={`gw-claim-${i + 1}`} keys={KEYS.bullets[i]} wide={WIDE[i]} label={b.lead} caption={t.film.captions[CAPTIONS[i]]}>
              <ChapterHead index={i + 1} label={c.hero.eyebrow} title={b.lead} />
              <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{asParagraph(b.rest)}</p>
              <div className="mt-6 max-w-sm">
                <BulletEvidence index={i} upTo={c.proof.specWords.upTo} />
              </div>
            </Chapter>
          ))}

          {/* Leitura: a prova do contrato e o fluxo de criação. A cena sai de cena. */}
          <FilmSection id="gw-reading" pinned={false} label={c.proof.title}>
            <FilmAnchor keys={KEYS.reading} ghost className="pointer-events-none absolute left-1/2 top-0 h-[40vh] w-[40vh] -translate-x-1/2" />
            <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
              {/* Prova — o único verde da página vive neste bloco. */}
              <section className="pt-16 pb-12 sm:pt-24 sm:pb-16">
                <div className="iw-surface-raised p-6 sm:p-8">
                  <p className="text-sm font-medium text-gray-400 mb-3">{c.proof.eyebrow}</p>
                  <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-6">{c.proof.title}</h2>

                  <p className="text-xs text-gray-400 mb-2">{c.proof.verifyLabel}</p>
                  <a
                    href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 min-h-[44px] rounded-control border border-dark-border bg-black/40 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors duration-200"
                  >
                    <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
                    <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </a>

                  <p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-success">
                    <ProofSeal className="w-4 h-4" />
                    {c.proof.matchLabel}
                  </p>

                  {/* Constantes reais do contrato. Duas colunas já em telemóvel:
                      são pares rótulo/valor curtos e uma coluna só desperdiçava altura. */}
                  <dl className="mt-8 grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-6 gap-y-5">
                    {c.proof.specs.map((label, i) => (
                      <div key={label}>
                        <dt className="text-xs text-gray-400 mb-1">{label}</dt>
                        <dd className="font-mono text-lg sm:text-xl font-bold text-white">{specs[i]}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="text-gray-400 text-sm leading-relaxed mt-8 pt-6 border-t border-dark-border">{c.proof.discipline}</p>
                </div>
              </section>

              {/* Fluxo de criação em preview */}
              <section className="pb-14 sm:pb-20">
                <p className="text-sm font-medium text-gray-400 mb-3">{c.wizard.eyebrow}</p>
                <h2 className="font-display font-bold text-3xl sm:text-4xl text-white mb-4">{c.wizard.title}</h2>
                <p className="text-gray-400 leading-relaxed mb-8">{c.wizard.intro}</p>
                <GiveawayWizard />
              </section>
            </div>
          </FilmSection>

          {/* Fecho: a forma volta, e a lista de espera — o botão principal da página. */}
          <FilmSection id="gw-close" length="150svh" label={c.participants.title}>
            <GiveawaysClose c={c} caption={t.film.captions.again} />
          </FilmSection>
        </main>
      </Film>

      <footer className="relative z-10 border-t border-dark-border py-8 bg-black/80">
        <div className="container mx-auto px-4 space-y-4 text-center">
          <PublicFooterNav />
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            &larr; {c.outro.back}
          </Link>
          <p className="text-xs text-gray-400">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};

/** O fecho: a forma da campanha ao centro, e a lista de espera para quem quer entrar. */
function GiveawaysClose({ c, caption }: { c: GiveawaysCopy; caption: string }) {
  const live = useFilmMode() === 'live';
  return (
    <div className={clsx('container mx-auto flex max-w-2xl flex-col items-center px-6 text-center', live ? 'h-full justify-center pt-24 pb-16' : 'py-16 sm:py-24')}>
      <FilmAnchor keys={KEYS.close} className="aspect-square w-full max-w-[min(66vw,calc(100svh_-_26rem))] sm:max-w-[min(20rem,calc(100svh_-_26rem))]" />
      <SceneCaption text={caption} />
      <div data-film-panel className="mt-8">
        <p className="text-sm font-medium text-gray-400 mb-3">{c.participants.eyebrow}</p>
        <h2 className="font-display font-bold text-2xl sm:text-4xl text-white mb-4">{c.participants.title}</h2>
        <p className="text-gray-400 leading-relaxed max-w-xl mx-auto mb-8">{c.participants.body}</p>
        <WaitlistLink primary label={c.waitlist.cta} withArrow className="inline-flex w-full sm:w-auto px-10 h-14 sm:h-16 text-lg sm:text-xl" />
      </div>
    </div>
  );
}
