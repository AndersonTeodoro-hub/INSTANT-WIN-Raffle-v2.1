import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useReadContract, useReadContracts } from 'wagmi';
import { ArrowRight, ExternalLink, Ticket, Gift, CalendarDays } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS, INVESTOR_EMAIL } from '../constants';
import { useLang, translations, type Lang } from './landing.i18n';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { Film, FilmAnchor, FilmSection, useFilmMode, type KeySpec } from '../components/film/Film';
import { Chapter, ChapterHead, SceneCaption } from '../components/film/Chapter';
import { EscrowFlow } from '../components/proof/EscrowFlow';
import { useLatestDraw } from '../components/proof/useLatestDraw';
import { GUARANTEE_READ_ABI, KEPTRA_GUARANTEE, POOL_READ_ABI, USDC_DECIMALS, keptraConfigured } from '../lib/keptra/contracts';

const ARBISCAN = 'https://arbiscan.io/address/';

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

/**
 * Tornar-se provedor é um pedido, nunca um depósito: os provedores do pool são
 * uma lista do owner (KeptraPool.isProvider) e ninguém entra sozinho. O pedido vai
 * para o contacto público da casa, o mesmo da /roadmap.
 */
const PROVIDER_REQUEST = `mailto:${INVESTOR_EMAIL}?subject=${encodeURIComponent('Keptra pool provider request')}`;

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/*
 * O filme: onde a cena está em cada capítulo e que forma mostra
 * (components/film/Film.tsx, lib/proof/scene.ts). A primeira tela é do diagrama
 * (components/proof/EscrowFlow.tsx): a cena espera debaixo dele, escondida, e
 * entra com o capítulo 02. O guilloché fica como assinatura — no nó da Keptra do diagrama, e
 * nos capítulos — não como explicação.
 */
const KEYS = {
  hero: [{ at: 0, shape: 'rosette', alpha: 0, zoom: 0.8 }],
  brands: [{ at: 0.2, shape: 'block', yaw: 0.62, pitch: -0.5, zoom: 0.88, tint: 0.12 }],
  customers: [{ at: 0.2, shape: 'escrow', flow: 1, zoom: 0.86, pitch: -0.32 }],
  pool: [{ at: 0.2, shape: 'rings', zoom: 0.78, pitch: -0.5, spin: 0.03 }],
  modules: [{ at: 0.25, shape: 'modules', zoom: 0.84, pitch: -0.3 }],
  close: [{ at: 0.4, shape: 'rosette', zoom: 0.92, pitch: -0.3, spin: 0.05 }],
} satisfies Record<string, KeySpec[]>;

type Copy = (typeof translations)['en'];

/** Um número do pool: o valor lido, ainda a ler, ou uma leitura que falhou — nunca um número inventado. */
type Figure = bigint | 'loading' | 'failed';

const ZERO = '0x0000000000000000000000000000000000000000';
const POOL_FIGURES = ['totalAssets', 'reservedTotal', 'freeCapacity'] as const;

/**
 * O pool que a garantia nomeia e três dos seus números: as mesmas leituras que a
 * /pool faz (pages/keptra/PoolPage.tsx) — capital, garantias activas, capacidade
 * livre. A faixa da primeira tela e o capítulo 04 só mostram o que daqui vier.
 */
function usePoolFigures() {
  const configured = keptraConfigured();
  const source = useReadContract({ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'defaultSource', query: { enabled: configured } });
  const pool = source.data as `0x${string}` | undefined;
  const named = pool !== undefined && pool.toLowerCase() !== ZERO;
  const figures = useReadContracts({
    contracts: POOL_FIGURES.map((functionName) => ({ address: pool ?? KEPTRA_GUARANTEE, abi: POOL_READ_ABI, functionName })),
    query: { enabled: named, refetchInterval: 30_000 },
  });
  const figure = (index: number): Figure => {
    const read = figures.data?.[index];
    if (read?.status === 'success') return read.result as bigint;
    if (!configured || source.isError || (pool !== undefined && !named) || figures.isError || read?.status === 'failure') return 'failed';
    return 'loading';
  };
  return { pool: named ? pool : undefined, capital: figure(0), active: figure(1), free: figure(2) };
}

// Os números na língua da página (o português dos textos do owner é o de
// Portugal), com as casas que a /pool mostra: duas pelo menos, as seis do USDC no
// máximo, sem zeros à direita — o mesmo valor nas duas páginas, nunca arredondado.
const NUMBER_LOCALE: Record<Lang, string> = { en: 'en-US', pt: 'pt-PT', es: 'es-ES' };
const usdc = (value: bigint, lang: Lang) =>
  new Intl.NumberFormat(NUMBER_LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: USDC_DECIMALS }).format(Number(value) / 10 ** USDC_DECIMALS);

const QUIET_LINK = 'inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-white underline decoration-gray-600 underline-offset-4 transition-colors duration-200 hover:decoration-white';

export const Landing: React.FC = () => {
  const [lang] = useLang();
  const t = translations[lang];
  const pool = usePoolFigures();
  const { latest, round: lotteryDraw, campaign, loading } = useLatestDraw();

  // A forma (a assinatura) desenha-se da prova do último sorteio liquidado; sem
  // nenhum, do endereço do contrato da lotaria.
  const proof = latest?.proof ?? (loading ? undefined : CONTRACTS.RAFFLE_MANAGER);
  const [brandsWho, brandsWhat] = t.hero.ctaBrands.split(' — ');
  const [customersWho] = t.hero.ctaCustomers.split(' — ');

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
            01 — A KEPTRA. A promessa e, ao lado, como se cumpre: o diagrama de
            uma encomenda. No telemóvel o diagrama desce para depois do texto,
            dos dois botões e da faixa do pool.
          */}
          <FilmSection id="film-hero" pinned={false} label={t.hero.title}>
            <div className="container mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-16 md:pt-14 lg:pb-24">
              <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:items-center lg:gap-14">
                <div className="min-w-0">
                  <h1 className="font-display font-bold text-[clamp(2.6rem,11vw,3.5rem)] sm:text-6xl lg:text-7xl leading-[1.02] tracking-tight">{t.hero.title}</h1>
                  <p className="mt-6 max-w-[58ch] text-base leading-relaxed text-gray-300 sm:text-lg">{t.hero.sub}</p>
                  {/* Duas entradas, uma por público; o âmbar é das marcas, o único do ecrã. */}
                  <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:max-w-[28rem] lg:grid-cols-1">
                    <AudienceCta text={t.hero.ctaBrands} to="/business" primary />
                    <AudienceCta text={t.hero.ctaCustomers} href="#for-customers" />
                  </div>
                  <PoolBand capital={pool.capital} t={t} lang={lang} />
                </div>

                <div className="relative min-w-0">
                  <EscrowFlow copy={t.flow} proof={proof} className="mx-auto w-full max-w-[34rem]" />
                  {/* Onde a cena espera, escondida: debaixo do diagrama, no vazio — ao entrar com o capítulo 02 não passa por trás de nenhum rótulo. */}
                  <FilmAnchor keys={KEYS.hero} ghost className="pointer-events-none absolute left-1/2 top-full h-64 w-64 -translate-x-1/2" />
                </div>
              </div>
            </div>
          </FilmSection>

          {/* 02 — Para marcas. */}
          <Chapter id="for-brands" keys={KEYS.brands} label={brandsWho} caption={t.film.captions.brand}>
            <ChapterHead index={2} label={brandsWho} title={t.brands.title} sentence />
            <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{t.brands.body}</p>
            <Link to="/business" className={clsx(QUIET_LINK, 'mt-4')}>
              {brandsWhat} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Chapter>

          {/* 03 — Para clientes: o destino do segundo botão da primeira tela. */}
          <Chapter id="for-customers" keys={KEYS.customers} wide label={customersWho} caption={t.film.captions.escrow}>
            <ChapterHead index={3} label={customersWho} title={t.customers.title} sentence />
            <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{t.customers.body}</p>
            <Link to="/pool" className={clsx(QUIET_LINK, 'mt-4')}>
              {t.hero.seePool} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Chapter>

          {/* 04 — O pool de garantia: discreto, e cada número lido da cadeia. */}
          <Chapter id="film-pool" keys={KEYS.pool} dense label={t.pool.label} caption={t.film.captions.pool}>
            <ChapterHead index={4} label={t.pool.label} title={t.pool.title} sentence />
            <dl className="mt-5 grid max-w-md grid-cols-3 gap-4 border-y border-dark-border py-3">
              <PoolStat label={t.pool.capital} value={pool.capital} t={t} lang={lang} />
              <PoolStat label={t.pool.active} value={pool.active} t={t} lang={lang} />
              <PoolStat label={t.pool.free} value={pool.free} t={t} lang={lang} />
            </dl>
            <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-gray-400">{t.pool.body}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-6">
              {pool.pool && (
                <a href={`${ARBISCAN}${pool.pool}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-300 transition-colors duration-200 hover:text-white">
                  {t.pool.contract}
                  <span className="font-mono text-success">{short(pool.pool)}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                </a>
              )}
              <Link to="/pool" className={QUIET_LINK}>
                {t.hero.seePool} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          </Chapter>

          {/* 05 — Os módulos, com a frase da obrigação tokenizada. */}
          <Chapter id="film-modules" keys={KEYS.modules} wide label={t.modules.title} caption={t.film.captions.modules}>
            <ChapterHead index={5} label={t.modules.eyebrow} title={t.modules.title} sentence />
            <p className="mt-5 max-w-[46ch] text-base sm:text-lg leading-relaxed text-gray-300">{t.modules.obligation}</p>
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

          {/* 06 — O fecho: a forma volta, e o convite a provedores. */}
          <FilmSection id="film-close" length="150svh" label={t.providers.title}>
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

/**
 * Um botão por público: "<a quem> — <a acção>" do owner, em duas linhas — a quem
 * pequeno, a acção a cheio — e lido como a frase inteira (o travessão fica para os
 * leitores de ecrã).
 */
function AudienceCta({ text, to, href, primary = false }: { text: string; to?: string; href?: string; primary?: boolean }) {
  const [who, what] = text.split(' — ');
  const style = clsx('iw-btn min-h-[64px] justify-between gap-4 whitespace-normal px-5 py-3 text-left', primary ? 'iw-btn-primary' : 'iw-btn-secondary');
  const body = (
    <>
      <span className="min-w-0">
        <span className={clsx('block text-xs font-medium', primary ? 'text-black/70' : 'text-gray-400')}>
          {who}
          <span className="sr-only"> — </span>
        </span>
        <span className="block text-base font-bold leading-snug">{what}</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
    </>
  );
  return to ? (
    <Link to={to} className={style}>
      {body}
    </Link>
  ) : (
    <a href={href} className={style}>
      {body}
    </a>
  );
}

/**
 * A faixa: o pool de garantia público, com o capital lido na cadeia. Enquanto se
 * lê, "…"; se a leitura falhar, a frase não aparece — fica só o caminho para o
 * conferir. Nunca um número que a cadeia não deu.
 */
function PoolBand({ capital, t, lang }: { capital: Figure; t: Copy; lang: Lang }) {
  const [before, after] = t.hero.band.split('{capital}');
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dark-border pt-4 text-sm leading-relaxed text-gray-400 lg:max-w-xl">
      {capital !== 'failed' && (
        <p className="inline-flex min-w-0 items-baseline gap-2.5">
          <span className="iw-live shrink-0" data-idle={capital === 'loading'} aria-hidden="true" />
          <span>
            {before}
            <span className="font-mono text-white" translate="no">
              {capital === 'loading' ? '…' : usdc(capital, lang)}
            </span>
            {after}
          </span>
        </p>
      )}
      <Link to="/pool" className={QUIET_LINK}>
        {t.hero.seePool} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/** Um número do capítulo 04, lido na cadeia; "…" enquanto se lê, "não lido" se a leitura falhou. */
function PoolStat({ label, value, t, lang }: { label: string; value: Figure; t: Copy; lang: Lang }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-1 font-mono text-base text-white sm:text-lg">
        {value === 'loading' ? '…' : value === 'failed' ? <span className="font-sans text-sm text-gray-400">{t.pool.notRead}</span> : (
          <>
            {usdc(value, lang)}
            <span className="block text-xs text-gray-400">USDC</span>
          </>
        )}
      </dd>
    </div>
  );
}

/** 06 — o fecho: a forma volta ao centro, e o convite a provedores, que é um pedido. */
function CloseChapter({ t }: { t: Copy }) {
  const live = useFilmMode() === 'live';
  return (
    <div className={clsx('container mx-auto flex max-w-3xl flex-col items-center px-6 text-center', live ? 'h-full justify-center pt-24 pb-16' : 'py-20 md:py-28')}>
      <FilmAnchor keys={KEYS.close} className="aspect-square w-full max-w-[min(56vw,calc(100svh_-_32rem))] sm:max-w-[min(18rem,calc(100svh_-_32rem))]" />
      <SceneCaption text={t.film.captions.again} />
      <div data-film-panel className="mt-8">
        <ChapterHead index={6} label={t.providers.label} title={t.providers.title} center />
        <p className="mx-auto mt-5 max-w-[48ch] text-base leading-relaxed text-gray-300 sm:text-lg">{t.providers.body}</p>
        {/* O botão principal deste ecrã: âmbar, o único dele. Abre um pedido, não um depósito. */}
        <a href={PROVIDER_REQUEST} className="iw-btn iw-btn-primary mt-8 h-14 gap-3 px-10 text-lg font-extrabold">
          {t.providers.cta} <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </a>
        <p className="mx-auto mt-4 max-w-[44ch] text-balance text-xs leading-relaxed text-gray-400">{t.providers.note}</p>
      </div>
    </div>
  );
}
