import React from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { LangSwitch } from './LangSwitch';

/**
 * O cabeçalho da plataforma — um só, para a landing, o jogo, o Event Center, a
 * /giveaways, a /roadmap e o Keptra.
 *
 * Havia três marcas ("INSTANT WIN", "Instant Win" com selo ARB, "Instant Win"
 * sem visto) e quatro estilos de botão no mesmo sítio. Passa a haver uma marca
 * por produto e uma lógica de botões:
 * - à esquerda, a marca (ou o regresso, numa página de detalhe);
 * - ao centro, a navegação — que desce para uma segunda linha abaixo de md;
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
}> = ({ brand = <InstantWinMark />, nav, actions, extras, lang = true, children }) => (
  <header className="iw-header">
    <div className="container mx-auto flex min-h-[64px] flex-wrap items-center gap-x-3 px-4 sm:px-6 md:h-[72px] md:flex-nowrap">
      <div className="mr-auto flex min-h-[64px] min-w-0 items-center md:min-h-0">{brand}</div>

      {nav && (
        <div className="order-last flex w-full items-center justify-center pb-2 md:order-none md:w-auto md:pb-0">{nav}</div>
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

/** A marca do Instant Win: a palavra em Big Shoulders e o visto verde da prova. */
export const InstantWinMark: React.FC = () => (
  <Link to="/" className="flex min-h-[44px] min-w-0 items-center gap-2" aria-label="Instant Win, home">
    <span className="truncate font-display text-xl font-bold leading-none tracking-tight text-white sm:text-2xl">Instant Win</span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M4 12.5 L9.5 18 L20 6" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </Link>
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
