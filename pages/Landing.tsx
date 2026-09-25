import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { ArrowRight, Check, X, ExternalLink, ShieldCheck, ChevronDown, Ticket, Gift, CalendarDays } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS, RAFFLE_ABI, RoundState } from '../constants';
import { useLang, translations } from './landing.i18n';
import { useAppCopy } from './app.i18n';
import { ShareButton } from '../components/ShareButton';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { Film, FilmAnchor, FilmSection, useFilmMode, type KeySpec } from '../components/film/Film';
import { Chapter, ChapterHead, SceneCaption } from '../components/film/Chapter';
import { ProofSeal, RoundClock, RoundMeter } from '../components/Proof';
import { CountUp } from '../components/proof/CountUp';
import { useLatestDraw, type SettledDraw } from '../components/proof/useLatestDraw';
import { shortProof } from '../lib/proof/mark';

const ARBISCAN = 'https://arbiscan.io/address/';
const ARBISCAN_TX = 'https://arbiscan.io/tx/';
const CHAINLINK_VRF = 'https://docs.chain.link/vrf';

// Public landing: only these contracts may be surfaced (regulatory).
// Do not add internal-only registries here. Names stay as on-chain identifiers.
const contractLinks = [
  { label: 'Raffle Manager', address: CONTRACTS.RAFFLE_MANAGER },
  { label: 'Username Registry', address: CONTRACTS.USERNAME_REGISTRY },
  { label: 'USDC', address: CONTRACTS.USDC },
];

/**
 * Os três módulos da Keptra. Emparelham posicionalmente com
 * `copy.modules.items`, que só tem o que se traduz — aqui fica a identidade do
 * módulo: nome, rota, ícone e estado.
 *
 * `live` é a única autorização de verde nesta secção: verde significa
 * "verificável agora". Lido na cadeia a 25/09/2026: a RaffleManagerV3 não está
 * pausada e tem uma ronda aberta; a GiveawayManagerV2 (Giveaways e Event
 * Center) não está pausada e tem a campanha 2 liquidada.
 */
const MODULES = [
  { name: 'INSTANT WIN', to: '/play', icon: Ticket, live: true },
  { name: 'GIVEAWAYS', to: '/giveaways', icon: Gift, live: true },
  { name: 'EVENT CENTER', to: '/events', icon: CalendarDays, live: true },
] as const;

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/*
 * O filme: onde a cena está em cada capítulo e que forma mostra
 * (components/film/Film.tsx, lib/proof/scene.ts). A cena desliza de âncora em
 * âncora com o scroll; a versão parada desenha a forma de cada capítulo no sítio.
 */
const KEYS = {
  hero: [{ at: 0, shape: 'rosette', zoom: 0.8, pitch: -0.42, yaw: 0.18, spin: 0.06 }],
  ticket: [{ at: 0.2, shape: 'ticket', yaw: -0.32, pitch: -0.55, roll: 0.06, zoom: 1.02 }],
  draw: [
    { at: 0.08, shape: 'chaos', zoom: 0.95, spin: 0.02 },
    { at: 0.62, shape: 'rosette', pitch: -0.18, zoom: 0.95, spin: 0.05, still: true },
  ],
  seal: [{ at: 0.2, shape: 'block', yaw: 0.62, pitch: -0.5, zoom: 0.88, tint: 0.12 }],
  reveal: [{ at: 0.2, shape: 'reveal', tint: 0.32, zoom: 1, spin: 0.015 }],
  payout: [{ at: 0.2, shape: 'payout', flow: 1, zoom: 0.86, pitch: -0.28 }],
  escrow: [{ at: 0.2, shape: 'escrow', flow: 1, zoom: 0.86, pitch: -0.32 }],
  modules: [{ at: 0.25, shape: 'modules', zoom: 0.84, pitch: -0.3 }],
  reading: [
    { at: 0, shape: 'rings', alpha: 0 },
    { at: 1, shape: 'rings', alpha: 0 },
  ],
  close: [{ at: 0.4, shape: 'rosette', zoom: 0.92, pitch: -0.3, spin: 0.05 }],
} satisfies Record<string, KeySpec[]>;

/*
 * O rótulo de uma secção (o texto que antes era um eyebrow em mono e caixa
 * alta): fica, na fonte de texto, porque é texto e não um dado.
 */
const SectionHeading: React.FC<{ eyebrow: string; title: string; sub?: string }> = ({ eyebrow, title, sub }) => (
  <div className="text-center mb-12 md:mb-16">
    <p className="text-sm font-medium text-gray-400 mb-3">{eyebrow}</p>
    <h2 className="font-display font-bold text-3xl md:text-5xl text-white">{title}</h2>
    {sub && <p className="text-gray-400 leading-relaxed max-w-2xl mx-auto mt-4">{sub}</p>}
  </div>
);

/** A ronda em curso: a mesma leitura (getCurrentRound) da vista geral do jogo. */
function useLiveRound() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const { data: round } = useReadContract({
    address: CONTRACTS.RAFFLE_MANAGER,
    abi: RAFFLE_ABI,
    functionName: 'getCurrentRound',
    query: { refetchInterval: 5000 },
  });
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const endTime = round?.[2] as bigint | undefined;
  const left = endTime !== undefined ? Number(endTime) - now : 0;
  const live = round?.[1] === RoundState.OPEN && left > 0;
  return {
    loaded: round !== undefined,
    roundId: round?.[0] as bigint | undefined,
    pool: (round?.[5] ?? 0n) as bigint,
    left,
    live,
    closing: round !== undefined && !live,
  };
}

export const Landing: React.FC = () => {
  const [lang] = useLang();
  const t = translations[lang];
  const c = useAppCopy();
  const round = useLiveRound();
  const { latest, round: lotteryDraw, campaign, loading } = useLatestDraw();

  // Sem nenhum sorteio liquidado, as rosetas desenham-se do endereço do contrato
  // da lotaria — e a legenda di-lo: é uma espera, não uma prova.
  const proof = latest?.proof ?? (loading ? undefined : CONTRACTS.RAFFLE_MANAGER);

  // O separador diz o produto e a página, como na /giveaways e na /roadmap; o do
  // index.html (Keptra) volta à saída.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = t.metaTitle;
    return () => {
      document.title = prevTitle;
    };
  }, [t]);

  return (
    // overflow-x-clip e não hidden: hidden faz da raiz um contentor de scroll e os capítulos deixavam de fixar.
    <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-clip">
      {/* O cabeçalho da plataforma. A acção do contexto aqui é entrar no jogo. */}
      <SiteHeader
        nav={<PublicNavLinks />}
        actions={<HeaderAction to="/play" icon={ArrowRight} label={t.header.enterApp} />}
      />

      <Film
        proof={proof}
        fallback={CONTRACTS.RAFFLE_MANAGER}
        winners={latest?.winnersCount ?? 3}
        lottery={lotteryDraw?.proof ?? null}
        campaign={campaign?.proof ?? null}
        pauseLabel={t.film.pause}
        playLabel={t.film.play}
      >
        <main className="iw-screen relative z-10 flex-1">
          {/*
            ABERTURA — a promessa e, ao lado, a prova: a forma do último sorteio
            liquidado, viva, com a ronda em curso à volta dela como num
            instrumento. A 390px a manchete, a cena e o botão cabem na primeira
            vista; a descrição desce para depois do botão.
          */}
          <FilmSection id="film-hero" pinned={false} label={t.hero.headlineTop}>
            <div className="container mx-auto max-w-6xl px-4 sm:px-6 pt-6 pb-16 md:pt-14 lg:pb-24">
              <div className="flex flex-col items-center text-center lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:items-center lg:gap-12 lg:text-left">
                <div className="contents lg:flex lg:flex-col lg:items-start">
                  <div className="order-1 inline-flex items-center gap-2 border border-dark-line bg-dark-card/60 text-gray-300 text-xs font-medium px-3 py-1.5 rounded-full mb-4 sm:mb-8 max-w-full">
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> <span className="truncate">{t.hero.badge}</span>
                  </div>
                  <h1 className="order-2 font-display font-bold text-[clamp(2.3rem,9.6vw,3.25rem)] sm:text-6xl lg:text-7xl leading-[1.02] tracking-tight">
                    <span className="block">{t.hero.headlineTop}</span>
                    {/* Segunda linha em cinzento, não em âmbar: é a assinatura da marca,
                        não um valor de prémio. O contraste de tom chega para a separar. */}
                    <span className="block text-gray-400">{t.hero.headlineBottom}</span>
                  </h1>
                  <p className="order-5 lg:order-3 text-gray-400 text-base sm:text-lg md:text-xl max-w-2xl mt-8 lg:mt-6">{t.hero.sub}</p>

                  <div className="order-4 mt-6 sm:mt-8 lg:mt-10 flex flex-col items-center lg:items-start">
                    <Link to="/play" className="iw-btn iw-btn-primary gap-3 font-extrabold text-xl md:text-2xl px-12 h-14 md:h-16">
                      {t.hero.cta} <ArrowRight className="w-6 h-6" aria-hidden="true" />
                    </Link>
                  </div>
                </div>

                <div className="order-3 mt-4 w-full max-w-[26rem] lg:mt-0 lg:max-w-none">
                  <FilmAnchor keys={KEYS.hero} className="aspect-square w-full">
                    <HeroReadouts round={round} c={c} />
                  </FilmAnchor>
                  <SceneCaption text={t.film.captions.mark} className="lg:mx-0 lg:text-left" />
                  <MarkCaption draw={latest} loading={loading} t={t} c={c} />
                </div>
              </div>
            </div>
          </FilmSection>

          {/* O prólogo: o módulo que está vivo, e a promessa dos três passos. */}
          <section className="relative z-10 px-5 sm:px-6 pt-10 pb-6 md:pt-16 text-center">
            <div className="container mx-auto max-w-3xl">
              <p className="inline-flex items-center gap-2 text-sm font-medium text-success mb-4">
                <span className="iw-live" aria-hidden="true" />
                {t.lottery.eyebrow}
              </p>
              <h2 className="font-display font-bold text-3xl md:text-5xl text-white mb-5">{t.lottery.title}</h2>
              <p className="text-gray-400 leading-relaxed">{t.lottery.intro}</p>
              <p className="mt-14 text-sm font-medium text-gray-400">{t.how.eyebrow}</p>
              <p className="mt-2 font-display font-bold text-2xl md:text-4xl text-white">{t.how.title}</p>
            </div>
          </section>

          {/* a) O bilhete materializa-se. */}
          <Chapter id="film-ticket" keys={KEYS.ticket} label={t.how.steps[0].title} caption={t.film.captions.ticket}>
            <ChapterHead index={1} label={t.how.eyebrow} title={t.how.steps[0].title} />
            <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{t.how.steps[0].body}</p>
          </Chapter>

          {/* b) A aleatoriedade do Chainlink VRF resolve-se a partir do caos. */}
          <Chapter id="film-draw" keys={KEYS.draw} label={t.how.steps[1].title} caption={t.film.captions.draw}>
            <ChapterHead index={2} label={t.how.eyebrow} title={t.how.steps[1].title} />
            <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{t.how.steps[1].body}</p>
          </Chapter>

          {/* c) A cadeia sela a prova. */}
          <Chapter id="film-seal" keys={KEYS.seal} label={t.transparency.title} caption={t.film.captions.seal}>
            <ChapterHead index={3} label={t.transparency.eyebrow} title={t.transparency.title} />
            <p className="mt-5 max-w-[50ch] text-sm sm:text-base leading-relaxed text-gray-300">
              {t.transparency.vrfPre}
              <a href={CHAINLINK_VRF} target="_blank" rel="noopener noreferrer" className="text-white underline decoration-gray-600 underline-offset-4 hover:decoration-white font-medium">
                Chainlink VRF
              </a>
              {t.transparency.vrfPost}
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {contractLinks.map((link) => (
                <li key={link.address}>
                  <a
                    href={`${ARBISCAN}${link.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-control border border-dark-border bg-black/50 px-3 text-xs text-gray-300 transition-colors duration-200 hover:border-success/40 hover:text-white"
                  >
                    {link.label}
                    <span className="font-mono text-success">{short(link.address)}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </Chapter>

          {/* d) Os vencedores são revelados, com a forma do sorteio. */}
          <Chapter id="film-reveal" keys={KEYS.reveal} label={t.film.revealTitle} caption={t.film.captions.reveal}>
            <ChapterHead index={4} label={c.winners.title} title={t.film.revealTitle} />
            <p className="mt-4 max-w-[46ch] text-sm sm:text-base leading-relaxed text-gray-300">{t.film.markLine}</p>
            <RevealList draw={latest} loading={loading} t={t} c={c} />
          </Chapter>

          {/* e) O prémio sai do contrato para quem ganhou. */}
          <Chapter id="film-payout" keys={KEYS.payout} wide label={t.how.steps[2].title} caption={t.film.captions.payout}>
            <ChapterHead index={5} label={t.how.eyebrow} title={t.how.steps[2].title} />
            <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{t.how.steps[2].body}</p>
          </Chapter>

          {/* f) Keptra: o escrow, a entrega provada, e o pool quando uma marca falha. */}
          <Chapter id="film-keptra" keys={KEYS.escrow} wide label={t.film.keptra.title} caption={t.film.captions.escrow}>
            <ChapterHead index={6} label="Keptra" title={t.film.keptra.title} />
            <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-gray-300">{t.film.keptra.body}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-gray-400" aria-hidden="true">
              {t.film.keptra.path.map((node, i) => (
                <React.Fragment key={node}>
                  {i > 0 && <ArrowRight className="h-3 w-3" />}
                  <span className={i === 2 ? 'text-success' : undefined}>{node}</span>
                </React.Fragment>
              ))}
            </p>
            <p className="mt-5 max-w-[46ch] text-sm leading-relaxed text-gray-400">{t.film.keptra.failure}</p>
            <ol className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-300">
              {t.film.keptra.layers.map((layer, i) => (
                <li key={layer} className="inline-flex items-center gap-2 rounded-full border border-dark-line bg-black/50 px-3 py-1.5">
                  <span className="font-mono text-gray-400">{i + 1}</span>
                  {layer}
                </li>
              ))}
            </ol>
            <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-gray-400">{t.film.keptra.status}</p>
            <Link to="/pool" className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-white underline decoration-gray-600 underline-offset-4 hover:decoration-white">
              {t.film.keptra.cta} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Chapter>

          {/* g) Os módulos da Keptra. */}
          <Chapter id="film-modules" keys={KEYS.modules} wide label={t.modules.title} caption={t.film.captions.modules}>
            <ChapterHead index={7} label={t.modules.eyebrow} title={t.modules.title} />
            <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-gray-300">{t.modules.sub}</p>
          </Chapter>

          <section className="relative z-10 px-5 sm:px-6 pb-16 md:pb-24">
            <div className="container mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              {MODULES.map((m, i) => {
                const copy = t.modules.items[i];
                const Icon = m.icon;
                return (
                  <Link
                    key={m.to}
                    to={m.to}
                    className={clsx('group flex flex-col p-6 sm:p-8', m.live ? 'iw-surface-raised' : 'iw-surface !bg-dark-bg/60')}
                  >
                    <div className="flex items-center justify-between mb-6">
                      <Icon className={clsx('w-5 h-5', m.live ? 'text-gray-200' : 'text-gray-400')} aria-hidden="true" />
                      <span aria-hidden="true" className="font-display font-bold text-4xl text-gray-400">{`0${i + 1}`}</span>
                    </div>
                    <span className={clsx('inline-flex items-center gap-2 text-xs font-medium mb-3', m.live ? 'text-success' : 'text-gray-400')}>
                      {m.live && <span className="iw-live" aria-hidden="true" />}
                      {copy.badge}
                    </span>
                    <h3 className={clsx('font-display font-bold mb-3', m.live ? 'text-2xl sm:text-3xl text-white' : 'text-xl sm:text-2xl text-gray-200')}>{m.name}</h3>
                    <p className="text-gray-400 leading-relaxed flex-1">{copy.body}</p>
                    <span className={clsx('inline-flex items-center gap-2 min-h-[44px] mt-5 font-bold text-sm', m.live ? 'text-white' : 'text-gray-400 group-hover:text-white')}>
                      {copy.cta}
                      <ArrowRight className="w-4 h-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          {/*
            Leitura: a comparação e as perguntas. A cena sai de cena (alpha 0)
            enquanto se lê, e volta para o fecho.
          */}
          <FilmSection id="film-reading" pinned={false} label={t.why.title}>
            <FilmAnchor keys={KEYS.reading} ghost className="pointer-events-none absolute left-1/2 top-0 h-[40vh] w-[40vh] -translate-x-1/2" />
            <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
              <div className="container mx-auto max-w-4xl">
                <SectionHeading eyebrow={t.why.eyebrow} title={t.why.title} />
                <div className="iw-surface overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[520px]">
                    <thead>
                      <tr className="bg-dark-card">
                        <th className="p-5 text-xs font-bold text-gray-400"></th>
                        <th className="p-5 text-sm font-display font-bold text-white">{t.why.colInstant}</th>
                        <th className="p-5 text-sm font-display font-bold text-gray-400">{t.why.colTraditional}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.why.rows.map((row) => (
                        <tr key={row.label} className="border-t border-dark-border">
                          <td className="p-5 text-sm font-bold text-white align-top">{row.label}</td>
                          <td className="p-5 text-sm text-gray-200 align-top">
                            <span className="inline-flex items-start gap-2">
                              <Check className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden="true" /> {row.instant}
                            </span>
                          </td>
                          <td className="p-5 text-sm text-gray-400 align-top">
                            <span className="inline-flex items-start gap-2">
                              <X className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" /> {row.traditional}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="px-6 py-16 md:py-24 border-t border-dark-border/50">
              <div className="container mx-auto max-w-3xl">
                <SectionHeading eyebrow={t.faq.eyebrow} title={t.faq.title} />
                <div className="space-y-3">
                  {t.faq.items.map((item) => (
                    <details key={item.q} className="group iw-surface px-6 open:border-dark-line">
                      <summary className="flex items-center justify-between gap-4 cursor-pointer list-none min-h-[56px] py-4 font-display text-lg font-bold text-white [&::-webkit-details-marker]:hidden">
                        {item.q}
                        <ChevronDown className="w-5 h-5 text-gray-400 shrink-0 transition-transform duration-200 ease-out group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <p className="text-gray-400 leading-relaxed pb-6 pr-6">{item.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            </section>
          </FilmSection>

          {/* h) O fecho: a forma volta, e a acção principal da página. */}
          <FilmSection id="film-close" length="150svh" label={t.finalCta.title}>
            <CloseChapter t={t} />
          </FilmSection>
        </main>
      </Film>

      {/* Rodapé */}
      <footer className="relative z-10 border-t border-dark-border py-10 bg-black/80">
        <div className="container mx-auto px-6 space-y-6">
          <div>
            <p className="text-center text-xs text-gray-400 font-medium mb-4">{t.footer.contractsLabel}</p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs font-mono text-gray-400">
              {contractLinks.map((link) => (
                <a
                  key={link.address}
                  href={`${ARBISCAN}${link.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 min-h-[44px] hover:text-success transition-colors"
                >
                  <span className="font-sans font-medium text-gray-400">{link.label}:</span> {short(link.address)}
                </a>
              ))}
            </div>
          </div>

          {/* Navegação para telemóvel, onde a do header não cabe. */}
          <PublicFooterNav />

          <div className="border-t border-dark-border/60 pt-6 max-w-2xl mx-auto text-center space-y-2">
            <p className="text-xs text-gray-400 font-medium">{t.footer.responsible}</p>
            <p className="text-xs text-gray-400">{t.footer.disclaimer}</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

type Copy = (typeof translations)['en'];
type AppCopy = ReturnType<typeof useAppCopy>;

/**
 * A ronda em curso, à volta da forma, como os mostradores de um instrumento:
 * a ronda e a rede em cima, o relógio e o prémio em baixo. O prémio conta até
 * ao valor lido da cadeia; o relógio ganha tensão no último minuto.
 */
function HeroReadouts({ round, c }: { round: ReturnType<typeof useLiveRound>; c: AppCopy }) {
  return (
    <div className="absolute inset-0 text-left">
      <Link
        to="/play"
        className="absolute left-0 top-0 inline-flex min-h-[44px] items-center gap-2 text-xs text-gray-300 transition-colors hover:text-white sm:text-sm"
      >
        <span className="iw-live" data-idle={!round.live} aria-hidden="true" />
        {round.closing ? (
          c.dashboard.finalizing
        ) : (
          <span>
            {c.dashboard.roundPre}
            <span className="font-mono tabular-nums">{round.roundId?.toString() ?? '…'}</span>
            {c.dashboard.roundPost}
          </span>
        )}
      </Link>
      <p className="absolute right-0 top-0 inline-flex min-h-[44px] items-center text-xs text-gray-400">Arbitrum One</p>
      <div className="absolute bottom-0 left-0">
        <p className="text-xs text-gray-400">{c.dashboard.timeRemaining}</p>
        <RoundClock seconds={round.left} plain closing={round.closing ? c.dashboard.closing : undefined} className="mt-1 justify-start text-lg sm:text-2xl" />
        <RoundMeter seconds={round.left} closing={round.closing} className="mt-2 w-28 sm:w-40" />
      </div>
      <div className="absolute bottom-0 right-0 text-right">
        <p className="text-xs text-gray-400">{c.dashboard.totalPrizePool}</p>
        <p className="mt-1 font-mono text-2xl font-bold leading-none text-brand sm:text-4xl">
          {round.loaded ? <CountUp value={round.pool} decimals={6} from0 delay={250} duration={1500} /> : '…'}
        </p>
        <p className="mt-1 font-mono text-xs text-gray-400">USDC</p>
      </div>
    </div>
  );
}

/** De onde vem a forma: o sorteio, e a sua prova com o caminho para a verificar. */
function MarkCaption({ draw, loading, t, c }: { draw: SettledDraw | null; loading: boolean; t: Copy; c: AppCopy }) {
  return (
    <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-gray-400 lg:justify-start">
      {draw ? (
        <>
          <ProofSeal className="h-3.5 w-3.5 text-success" />
          <span>
            {draw.kind === 'round' ? t.film.markOfRound : t.film.markOfCampaign} <span className="font-mono text-gray-300">{draw.id.toString()}</span>
          </span>
          <ProofLink draw={draw} />
        </>
      ) : loading ? (
        c.winners.reading
      ) : (
        t.film.markPending
      )}
    </p>
  );
}

/** A prova de um sorteio, com o caminho para a ver: a transacção no Arbiscan, ou a página da campanha. */
function ProofLink({ draw }: { draw: SettledDraw }) {
  const style = 'inline-flex min-h-[32px] items-center gap-1 font-mono text-success underline decoration-success/30 underline-offset-4 hover:decoration-success';
  return draw.kind === 'round' ? (
    <a href={`${ARBISCAN_TX}${draw.proof}`} target="_blank" rel="noopener noreferrer" className={style}>
      {shortProof(draw.proof)}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  ) : (
    <Link to={`/events/${draw.id.toString()}`} className={style}>
      {shortProof(draw.proof)}
    </Link>
  );
}

/** Os vencedores do último sorteio liquidado, lidos da cadeia; nunca um espaço vazio. */
function RevealList({ draw, loading, t, c }: { draw: SettledDraw | null; loading: boolean; t: Copy; c: AppCopy }) {
  if (!draw) return <p className="mt-6 max-w-[46ch] text-sm leading-relaxed text-gray-400">{loading ? c.winners.reading : c.winners.empty}</p>;
  const shown = draw.winners.slice(0, 3);
  return (
    <div className="mt-6 max-w-md">
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
        <ProofSeal className="h-3.5 w-3.5 text-success" />
        {draw.kind === 'round' ? c.winners.round : t.film.campaignLabel}
        <span className="font-mono text-gray-300">{draw.id.toString()}</span>
        <ProofLink draw={draw} />
      </p>
      <ol className="mt-2 divide-y divide-dark-border border-y border-dark-border">
        {shown.map((w) => (
          <li key={`${w.address}-${w.rank}`} className="flex min-h-[44px] items-center justify-between gap-3 bg-black/40 px-1 text-sm">
            <span className="flex min-w-0 items-center gap-3 font-mono">
              <span className="w-4 text-xs text-gray-400">{w.rank}</span>
              <span className="truncate text-gray-200">{short(w.address)}</span>
            </span>
            {w.amount !== undefined && <span className="shrink-0 font-mono font-bold text-brand">{formatUnits(w.amount, 6)} USDC</span>}
          </li>
        ))}
      </ol>
      {draw.kind === 'campaign' && (
        <Link to={`/events/${draw.id.toString()}`} className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-white underline decoration-gray-600 underline-offset-4 hover:decoration-white">
          {t.film.seeCampaign} {draw.winnersCount > shown.length && <span className="font-mono text-gray-400">+{draw.winnersCount - shown.length}</span>}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** O fecho: a forma volta ao centro, e a acção principal da página. */
function CloseChapter({ t }: { t: Copy }) {
  const live = useFilmMode() === 'live';
  return (
    <div className={clsx('container mx-auto flex max-w-3xl flex-col items-center px-6 text-center', live ? 'h-full justify-center pt-24 pb-16' : 'py-20 md:py-28')}>
      <FilmAnchor keys={KEYS.close} className="aspect-square w-full max-w-[min(70vw,calc(100svh_-_24rem))] sm:max-w-[min(22rem,calc(100svh_-_24rem))]" />
      <SceneCaption text={t.film.captions.again} />
      <div data-film-panel className="mt-8">
        <h2 className="font-display font-bold text-3xl md:text-5xl text-white mb-8 max-w-2xl mx-auto">{t.finalCta.title}</h2>
        {/* O CTA primário continua a ser o único âmbar deste ecrã; o Share é secundário. */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/play" className="iw-btn iw-btn-primary gap-3 font-extrabold text-xl px-12 h-16">
            {t.hero.cta} <ArrowRight className="w-6 h-6" aria-hidden="true" />
          </Link>
          <ShareButton variant="full" label={t.finalCta.share} className="h-16 text-lg" />
        </div>
      </div>
    </div>
  );
}
