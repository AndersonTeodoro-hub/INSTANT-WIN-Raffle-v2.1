import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Send, Coins, Shuffle, Users } from 'lucide-react';
import { CONTRACTS, GIVEAWAY_LIMITS, TELEGRAM_URL } from '../constants';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { WaitlistLink } from '../components/WaitlistLink';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { GiveawayWizard } from '../components/GiveawayWizard';
import { ProofSeal } from '../components/Proof';
import { useGiveawaysCopy } from './giveaways.i18n';
import type { GiveawaysCopy } from './giveaways.i18n';

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
    <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-hidden">


      {/* O cabeçalho da plataforma; a acção do contexto é a lista de espera. */}
      <SiteHeader
        nav={<PublicNavLinks />}
        actions={<HeaderAction href={TELEGRAM_URL} icon={Send} label={c.waitlist.short} />}
      />

      <main className="flex-1 container mx-auto px-4 sm:px-6 max-w-4xl">

        {/* Herói */}
        <section className="pt-12 pb-10 sm:pt-20 sm:pb-14">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-4">
            {c.hero.eyebrow}
          </p>
          <h1 className="font-display font-bold text-[clamp(2.5rem,11vw,4rem)] leading-[1.05] mb-5">
            {c.hero.title}
          </h1>
          <p className="text-gray-400 text-base sm:text-lg leading-relaxed">{c.hero.intro}</p>

          {/*
            Cada afirmação leva a peça que a prova ou ilustra — um número, o nome
            do protocolo, o contrato. Emparelham posicionalmente com
            `hero.bullets` (mesma convenção dos STEP_ICONS da Landing).
          */}
          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {c.hero.bullets.map((b, i) => (
              <li key={b.lead} className={`iw-surface flex flex-col gap-4 p-5 ${i === c.hero.bullets.length - 1 && c.hero.bullets.length % 2 === 1 ? 'sm:col-span-2' : ''}`}>
                <BulletEvidence index={i} upTo={c.proof.specWords.upTo} />
                <p className="text-sm leading-relaxed text-gray-400">
                  <strong className="font-semibold text-gray-200">{b.lead}</strong>
                  {b.rest}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Prova — o único verde da página vive neste bloco. */}
        <section className="pb-12 sm:pb-16">
          <div className="iw-surface-raised p-6 sm:p-8">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-3">
              {c.proof.eyebrow}
            </p>
            <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-6">{c.proof.title}</h2>

            <p className="font-mono text-[11px] uppercase tracking-widest text-gray-400 mb-2">
              {c.proof.verifyLabel}
            </p>
            <a
              href={`${ARBISCAN}${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 min-h-[44px] rounded-control border border-dark-border bg-black/40 px-4 py-3 font-mono text-[11px] sm:text-sm text-success hover:border-success/40 transition-colors duration-200"
            >
              <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
              <ExternalLink className="w-4 h-4 shrink-0" />
            </a>

            <p className="mt-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-success">
              <ProofSeal className="w-4 h-4" />
              {c.proof.matchLabel}
            </p>

            {/* Constantes reais do contrato. Duas colunas já em telemóvel:
                são pares rótulo/valor curtos e uma coluna só desperdiçava altura. */}
            <dl className="mt-8 grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-6 gap-y-5">
              {c.proof.specs.map((label, i) => (
                <div key={label}>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-400 mb-1">{label}</dt>
                  <dd className="font-mono text-lg sm:text-xl font-bold text-white">{specs[i]}</dd>
                </div>
              ))}
            </dl>

            <p className="text-gray-400 text-sm leading-relaxed mt-8 pt-6 border-t border-dark-border">
              {c.proof.discipline}
            </p>
          </div>
        </section>

        {/* Fluxo de criação em preview */}
        <section className="pb-14 sm:pb-20">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-3">
            {c.wizard.eyebrow}
          </p>
          <h2 className="font-display font-bold text-3xl sm:text-4xl text-white mb-4">{c.wizard.title}</h2>
          <p className="text-gray-400 leading-relaxed mb-8">{c.wizard.intro}</p>

          <GiveawayWizard />
        </section>

        {/* CTA de participante: uma só lista de espera para todo o Event Center. */}
        <section className="pb-16 sm:pb-24 text-center">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-3">
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

      <footer className="border-t border-dark-border py-8 bg-black/80">
        <div className="container mx-auto px-4 space-y-4 text-center">
          <PublicFooterNav />
          <Link
            to="/"
            className="inline-flex items-center min-h-[44px] font-mono text-[11px] uppercase tracking-widest text-gray-400 hover:text-white transition-colors"
          >
            &larr; {c.outro.back}
          </Link>
          <p className="font-mono text-[10px] text-gray-400">&copy; 2026 Instant Win Protocol</p>
        </div>
      </footer>
    </div>
  );
};
