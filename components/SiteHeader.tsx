import React from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { LangSwitch } from './LangSwitch';
import { KeptraLogo } from './KeptraLogo';

/**
 * O cabeçalho da plataforma — um só, para a landing, o jogo, o Event Center, a
 * /giveaways, a /roadmap e o Keptra.
 *
 * Uma marca, a Keptra, e uma lógica de botões:
 * - à esquerda, a marca; na área de um módulo, a marca e o nome do módulo
 *   (KeptraBrand), que leva ao início do módulo;
 * - ao centro, a navegação — que desce para uma segunda linha abaixo de lg;
 * - à direita, o idioma e UMA acção do contexto, sempre `secondary`. O âmbar
 *   não entra no cabeçalho: pertence ao botão principal de cada ecrã.
 *
 * Abaixo de sm a acção fica só com o ícone (o rótulo continua no aria-label) e
 * o idioma estreita os alvos para 40×44px: a 390px a linha leva a marca inteira,
 * o idioma, a partilha e a acção. `extras` (partilha, "os meus sorteios") vivem
 * sempre na linha de cima; quem não cabe no telemóvel esconde-se no chamador.
 */
export const SiteHeader: React.FC<{
  brand?: React.ReactNode;
  nav?: React.ReactNode;
  actions?: React.ReactNode;
  extras?: React.ReactNode;
  lang?: boolean;
  /** Por baixo da barra (o menu do Keptra no telemóvel). */
  children?: React.ReactNode;
}> = ({ brand = <KeptraBrand />, nav, actions, extras, lang = true, children }) => (
  <header className="iw-header">
    <div className="container mx-auto flex min-h-[64px] flex-wrap items-center gap-x-3 px-4 sm:px-6 lg:h-[72px] lg:flex-nowrap">
      <div className="mr-auto flex min-h-[64px] min-w-0 items-center lg:min-h-0">{brand}</div>

      {nav && (
        <div className="order-last flex w-full items-center justify-center pb-2 lg:order-none lg:w-auto lg:pb-0">{nav}</div>
      )}

      <div className="flex shrink-0 items-center gap-2">
        {lang && <LangSwitch />}
        {extras}
        {actions}
      </div>
    </div>
    {children}
  </header>
);

/**
 * A marca: o logo da Keptra e, na área de um módulo (Instant Win, Giveaways,
 * Event Center), o nome do módulo a seguir, na mesma linha de base. O traço
 * entre os dois tem a inclinação do braço de cima do K. `tag` é o rótulo de
 * área do Keptra (T0: "Business").
 */
export const KeptraBrand: React.FC<{ module?: { to: string; label: string }; tag?: string }> = ({ module, tag }) => (
  <div className="flex min-w-0 items-baseline gap-x-2.5 sm:gap-x-3">
    <Link to="/" className="inline-flex min-h-[44px] shrink-0 items-center text-white" aria-label="Keptra, home">
      <KeptraLogo className="h-[18px] w-auto sm:h-[21px]" />
    </Link>
    {module && (
      <>
        <span aria-hidden="true" className="h-5 w-px shrink-0 self-center rotate-[17deg] bg-gray-500" />
        <Link
          to={module.to}
          className="inline-flex min-h-[44px] min-w-0 items-center font-display text-[1.2rem] font-bold leading-none tracking-tight text-gray-300 transition-colors duration-200 hover:text-white sm:text-[1.4rem]"
        >
          <span className="truncate">{module.label}</span>
        </Link>
      </>
    )}
    {tag && <span className="self-center rounded-md border border-dark-line px-2 py-0.5 text-xs font-medium text-gray-300">{tag}</span>}
  </div>
);

/**
 * A acção do cabeçalho. Rota interna (`to`), link externo (`href`) ou botão
 * (`onClick`) — o aspecto é sempre o mesmo.
 */
export const HeaderAction: React.FC<{
  label: string;
  icon: LucideIcon;
  to?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}> = ({ label, icon: Icon, to, href, onClick, className }) => {
  const style = clsx('iw-btn iw-btn-secondary min-w-[44px] px-3 text-sm sm:px-4', className);
  const body = (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={style} title={label}>
        {body}
      </Link>
    );
  }
  if (href) {
    const external = /^https?:\/\//i.test(href);
    return (
      <a href={href} className={style} title={label} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={style} title={label}>
      {body}
    </button>
  );
};
