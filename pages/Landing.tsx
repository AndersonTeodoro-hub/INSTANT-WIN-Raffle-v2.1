import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ArrowRight, Wallet, Zap, Check, X, ExternalLink, ShieldCheck, ChevronDown, Ticket, Gift, Award } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS, PRELAUNCH, TELEGRAM_URL } from '../constants';
import { useLang, translations } from './landing.i18n';
import { ShareButton } from '../components/ShareButton';
import { SiteHeader, HeaderAction } from '../components/SiteHeader';
import { LiveProof } from '../components/LiveProof';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';

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

/**
 * Os três módulos do Event Center. Emparelham posicionalmente com
 * `copy.modules.items`, que só tem o que se traduz — aqui fica a identidade do
 * módulo: nome, rota, ícone e estado.
 *
 * `live` é a única autorização de verde nesta secção. Os outros dois módulos
 * têm badge cinzento porque ainda não há nada vivo para verificar neles, e a
 * regra da casa é que verde significa "verificável agora", não "em breve".
 */
const MODULES = [
  { name: 'LOTTERY', to: '/play', icon: Ticket, live: true },
  { name: 'GIVEAWAYS', to: '/giveaways', icon: Gift, live: false },
  { name: 'REWARDS & COMPETITIONS', to: '/roadmap', icon: Award, live: false },
] as const;

const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

/**
 * Botão da lista de espera (modo PRELAUNCH). Herda o estilo do CTA primário:
 * âmbar, o único do ecrã, sem glow, rounded-lg.
 *
 * `target="_blank"` só quando o destino já é um link a sério — com o placeholder
 * "#" abriria um separador em branco a cada clique.
 */
const WaitlistButton: React.FC<{ label: string; className?: string }> = ({ label, className = '' }) => {
  const isExternal = /^https?:\/\//i.test(TELEGRAM_URL);
  return (
    <a
      href={TELEGRAM_URL}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={clsx(
        'iw-btn iw-btn-primary gap-3 font-extrabold px-10 sm:px-12 h-14 md:h-16',
        className,
      )}
    >
      {label} <ArrowRight className="w-6 h-6" aria-hidden="true" />
    </a>
  );
};

/*
 * Eyebrow em cinzento mono, não em âmbar: depois da reposição o âmbar ficou
 * reservado a valores de prémio e ao único CTA primário do ecrã. Seis eyebrows
 * âmbar espalhados pela página gastavam a cor que devia destacar o prémio.
 */
const SectionHeading: React.FC<{ eyebrow: string; title: string; sub?: string }> = ({ eyebrow, title, sub }) => (
  <div className="text-center mb-12 md:mb-16">
    <p className="font-mono text-gray-400 text-[11px] font-bold uppercase tracking-[0.2em] mb-3">{eyebrow}</p>
    <h2 className="font-display font-bold text-3xl md:text-5xl text-white">{title}</h2>
    {sub && <p className="text-gray-400 leading-relaxed max-w-2xl mx-auto mt-4">{sub}</p>}
  </div>
);

export const Landing: React.FC = () => {
  const [lang] = useLang();
  const t = translations[lang];

  return (
    <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-hidden">

      {/* O cabeçalho da plataforma. A acção do contexto aqui é entrar no jogo. */}
      <SiteHeader
        nav={<PublicNavLinks />}
        actions={<HeaderAction to="/play" icon={ArrowRight} label={t.header.enterApp} />}
      />

      <main className="flex-1">

        {/*
          1. HERO — a promessa e, ao lado, a prova: a ronda em curso e o último
          sorteio, lidos da cadeia. A 390px a primeira vista leva a manchete, a
          prova e o botão sem deslizar; a descrição desce para depois do botão.
        */}
        <section className="container mx-auto max-w-6xl px-4 sm:px-6 pt-6 pb-14 md:pt-20 md:pb-28">
          {/* No telemóvel a coluna de texto dissolve-se (`contents`) para a prova
              ficar entre a manchete e o botão; no computador volta a ser coluna. */}
          <div className="flex flex-col items-center text-center lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:items-center lg:gap-14 lg:text-left">
            <div className="contents lg:flex lg:flex-col lg:items-start">
              <div className="order-1 inline-flex items-center gap-2 border border-dark-line bg-dark-card/60 text-gray-300 text-[11px] sm:text-xs font-bold px-3 py-1.5 rounded-full mb-4 sm:mb-8 max-w-full">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> <span className="truncate">{t.hero.badge}</span>
              </div>
              <h1 className="order-2 font-display font-bold text-[clamp(2.3rem,9.6vw,3.25rem)] sm:text-6xl lg:text-7xl leading-[1.02] tracking-tight">
                <span className="block">{t.hero.headlineTop}</span>
                {/* Segunda linha em cinzento, não em âmbar: é a assinatura da marca,
                    não um valor de prémio. O contraste de tom chega para a separar. */}
                <span className="block text-gray-400">{t.hero.headlineBottom}</span>
              </h1>
              <p className="order-5 lg:order-3 text-gray-400 text-base sm:text-lg md:text-xl max-w-2xl mt-8 lg:mt-6">{t.hero.sub}</p>

              <div className="order-4 mt-5 sm:mt-8 lg:mt-10 flex flex-col items-center lg:items-start">
                {PRELAUNCH ? (
                  <>
                    <p className="font-display font-bold text-2xl md:text-3xl text-white mb-3 sm:mb-5">
                      {t.prelaunch.headline}
                    </p>
                    <WaitlistButton label={t.prelaunch.cta} className="text-lg md:text-2xl" />
                  </>
                ) : (
                  <Link
                    to="/play"
                    className="iw-btn iw-btn-primary gap-3 font-extrabold text-xl md:text-2xl px-12 h-14 md:h-16"
                  >
                    {t.hero.cta} <ArrowRight className="w-6 h-6" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>

            <LiveProof className="order-3 mt-5 sm:mt-8 lg:mt-0 w-full max-w-md lg:max-w-none" />
          </div>
        </section>

        {/* 2. THE EVENT CENTER — os três módulos */}
        <section className="px-5 sm:px-6 py-16 md:py-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-6xl">
            <SectionHeading eyebrow={t.modules.eyebrow} title={t.modules.title} sub={t.modules.sub} />

            {/*
              Hierarquia sem cor: o módulo vivo distingue-se por borda mais clara,
              fundo mais presente e título maior. O verde fica só no badge, que é
              a única coisa aqui que se pode verificar on-chain hoje.
            */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              {MODULES.map((m, i) => {
                const copy = t.modules.items[i];
                const Icon = m.icon;
                const badge = m.live && PRELAUNCH ? `${copy.badge} · ${t.modules.prelaunchTag}` : copy.badge;

                return (
                  <Link
                    key={m.to}
                    to={m.to}
                    className={clsx(
                      'group flex flex-col p-6 sm:p-8',
                      m.live ? 'iw-surface-raised' : 'iw-surface !bg-dark-bg/60',
                    )}
                  >
                    <div className="flex items-center justify-between mb-6">
                      <Icon className={clsx('w-5 h-5', m.live ? 'text-gray-200' : 'text-gray-400')} />
                      <span aria-hidden="true" className="font-display font-bold text-4xl text-gray-400">{`0${i + 1}`}</span>
                    </div>

                    <span
                      className={clsx(
                        'inline-flex items-center gap-2 font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.15em] mb-3',
                        m.live ? 'text-success' : 'text-gray-400',
                      )}
                    >
                      {m.live && <span className="iw-live" aria-hidden="true" />}
                      {badge}
                    </span>

                    <h3
                      className={clsx(
                        'font-display font-bold mb-3',
                        m.live ? 'text-2xl sm:text-3xl text-white' : 'text-xl sm:text-2xl text-gray-200',
                      )}
                    >
                      {m.name}
                    </h3>

                    <p className="text-gray-400 leading-relaxed flex-1">{copy.body}</p>

                    <span
                      className={clsx(
                        'inline-flex items-center gap-2 min-h-[44px] mt-5 font-bold text-sm',
                        m.live ? 'text-white' : 'text-gray-400 group-hover:text-white',
                      )}
                    >
                      {copy.cta}
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/*
          3. MÓDULO 01 — a partir daqui é tudo prova da lottery: mecânica,
          comparação, contratos e FAQ. Nada foi apagado na reposição; o bloco
          passou a ter um cabeçalho que diz de que módulo está a falar.
        */}
        <section className="px-5 sm:px-6 pt-16 md:pt-24 border-t border-dark-border/50">
          <div className="container mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-success mb-4">
              <span className="iw-live" aria-hidden="true" />
              {t.lottery.eyebrow}
            </p>
            <h2 className="font-display font-bold text-3xl md:text-5xl text-white mb-5">{t.lottery.title}</h2>
            <p className="text-gray-400 leading-relaxed">{t.lottery.intro}</p>
          </div>
        </section>

        {/* 3a. HOW IT WORKS */}
        <section className="px-6 py-12 md:py-16">
          <div className="container mx-auto max-w-6xl">
            <SectionHeading eyebrow={t.how.eyebrow} title={t.how.title} />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {t.how.steps.map((step, i) => {
                const Icon = STEP_ICONS[i] ?? Trophy;
                return (
                  <div key={i} className="iw-surface p-8 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <Icon className="w-5 h-5 text-gray-300" />
                      <span aria-hidden="true" className="font-display font-bold text-4xl text-gray-400">{`0${i + 1}`}</span>
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
            <div className="iw-surface overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[520px]">
                <thead>
                  <tr className="bg-dark-card">
                    <th className="p-5 text-xs font-bold uppercase tracking-wider text-gray-400"></th>
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
                          <Check className="w-4 h-4 text-success shrink-0 mt-0.5" /> {row.instant}
                        </span>
                      </td>
                      <td className="p-5 text-sm text-gray-400 align-top">
                        <span className="inline-flex items-start gap-2">
                          <X className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" /> {row.traditional}
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
                  className="iw-surface p-5 min-h-[44px] hover:!border-success/40 group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">{c.label}</span>
                    <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-success transition-colors" />
                  </div>
                  <span className="font-mono text-xs text-success">{short(c.address)}</span>
                </a>
              ))}
            </div>

            <div className="iw-surface p-6 flex flex-col sm:flex-row sm:items-center gap-4">
              <ShieldCheck className="w-5 h-5 text-gray-300 shrink-0" />
              <p className="text-gray-400 text-sm leading-relaxed flex-1">
                {t.transparency.vrfPre}
                <a href={CHAINLINK_VRF} target="_blank" rel="noopener noreferrer" className="text-white underline decoration-gray-600 underline-offset-4 hover:decoration-white font-medium">
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
                  className="group iw-surface px-6 open:border-dark-line"
                >
                  <summary className="flex items-center justify-between gap-4 cursor-pointer list-none py-5 font-display font-bold text-white [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown className="w-5 h-5 text-gray-400 shrink-0 transition-transform duration-200 ease-out group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="text-gray-400 leading-relaxed pb-6 pr-6">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-6 py-20 md:py-28 border-t border-dark-border/50 text-center">
          {/* Em pré-lançamento a manchete passa a ser a da lista de espera: anunciar
              um sorteio "já a rolar" ao lado de um botão de espera seria contraditório. */}
          <h2 className="font-display font-bold text-3xl md:text-5xl text-white mb-8 max-w-2xl mx-auto">
            {PRELAUNCH ? t.prelaunch.headline : t.finalCta.title}
          </h2>
          {/* O CTA primário continua a ser o único âmbar deste ecrã; o Share é secundário. */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {PRELAUNCH ? (
              <WaitlistButton label={t.prelaunch.cta} className="text-xl" />
            ) : (
              <Link
                to="/play"
                className="iw-btn iw-btn-primary gap-3 font-extrabold text-xl px-12 h-16"
              >
                {t.hero.cta} <ArrowRight className="w-6 h-6" />
              </Link>
            )}
            <ShareButton variant="full" label={t.finalCta.share} className="h-16 text-lg" />
          </div>
        </section>
      </main>

      {/* 6. FOOTER */}
      <footer className="border-t border-dark-border py-10 bg-black/80">
        <div className="container mx-auto px-6 space-y-6">
          {/* Contracts */}
          <div>
            <p className="text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-4">
              {t.footer.contractsLabel}
            </p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs font-mono text-gray-400">
              {contractLinks.map((c) => (
                <a
                  key={c.address}
                  href={`${ARBISCAN}${c.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center min-h-[44px] hover:text-success transition-colors"
                >
                  <span className="font-sans font-medium text-gray-400">{c.label}:</span> {short(c.address)}
                </a>
              ))}
            </div>
          </div>

          {/* Navegação para telemóvel, onde a do header não cabe. */}
          <PublicFooterNav />

          {/* Responsible play */}
          <div className="border-t border-dark-border/60 pt-6 max-w-2xl mx-auto text-center space-y-2">
            <p className="text-xs text-gray-400 font-medium">{t.footer.responsible}</p>
            <p className="text-[11px] text-gray-400">{t.footer.disclaimer}</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
