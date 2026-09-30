import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { useLang, translations } from '../pages/landing.i18n';

/**
 * Navegação das páginas públicas (/, /giveaways, /roadmap e o Event Center).
 *
 * Um só array para header e rodapé de todas — antes desta reposição havia uma
 * entrada "Roadmap" copiada à mão em dois sítios da Landing, e com três módulos
 * passariam a ser seis cópias a divergir à primeira alteração.
 *
 * À frente vai o módulo principal, a entrega verificada da página inicial
 * (decisão do owner de 27/09/2026): o único rótulo traduzido, porque o owner lhe
 * deu nome nas três línguas. Os outros ficam em inglês nos três idiomas, pela
 * mesma razão que "Roadmap" já ficava: são os nomes dos módulos da Keptra (como
 * Chainlink VRF), não frases.
 */
/** Os módulos da Keptra. O cabeçalho da área de cada um mostra-o a seguir à marca (KeptraBrand). */
export const MODULES = {
  giveaways: { to: '/giveaways', label: 'Giveaways' },
  eventCenter: { to: '/events', label: 'Event Center' },
} as const;

export const PUBLIC_NAV = [MODULES.giveaways, MODULES.eventCenter, { to: '/roadmap', label: 'Roadmap' }] as const;

/** As entradas na língua da página: o módulo principal, com link para "/", e depois PUBLIC_NAV. */
function usePublicNav(): readonly { to: string; label: string }[] {
  const [lang] = useLang();
  return [{ to: '/', label: translations[lang].header.mainModule }, ...PUBLIC_NAV];
}

const isCurrent = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * Entradas do header, visíveis em todos os tamanhos.
 *
 * Abaixo de lg passam para uma segunda linha do próprio header, a toda a
 * largura e centradas: na primeira linha vão a marca (com o nome do módulo), o
 * idioma e as acções. Abaixo de sm as quatro entradas não cabem nos 343px úteis
 * de um ecrã de 390px sem descer os alvos abaixo dos 44px, e duas linhas fariam
 * o cabeçalho fixo tapar os capítulos do filme: a linha desliza na horizontal,
 * de ponta a ponta do ecrã e esbatida nas pontas para se ver que continua, e a
 * entrada da página onde se está é trazida à vista. Entre lg e xl, com três acções na mesma linha, as
 * entradas apertam (e o nome do módulo sai da marca, SiteHeader.tsx) para a
 * navegação não colar ao logo.
 *
 * O rodapé mantém as mesmas entradas: em páginas longas é mais perto do polegar
 * do que voltar ao topo.
 */
export const PublicNavLinks: React.FC = () => {
  const { pathname } = useLocation();
  const items = usePublicNav();
  const ref = useRef<HTMLElement>(null);

  // Só quando a linha desliza (abaixo de sm): a entrada da página ao centro, sem mexer no scroll da página.
  useEffect(() => {
    const nav = ref.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);

  return (
    <nav
      ref={ref}
      aria-label="Sections"
      className={clsx(
        // Abaixo de sm: de ponta a ponta do ecrã, a deslizar, esbatida nas duas pontas — em repouso a primeira entrada alinha com o logo.
        'relative -mx-4 flex w-[calc(100%+2rem)] shrink-0 items-center justify-start gap-0 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'max-sm:[-webkit-mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%_-_1rem),transparent)] max-sm:[mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%_-_1rem),transparent)]',
        'sm:mx-0 sm:w-auto sm:shrink sm:justify-center sm:gap-1 sm:overflow-visible sm:px-0 lg:justify-start',
      )}
    >
      {items.map((item) => {
        const isActive = isCurrent(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={clsx(
              // O sítio onde se está leva uma aresta clara por baixo: posição, não cor de estado.
              'relative inline-flex shrink-0 items-center min-h-[44px] px-1.5 sm:px-3 lg:px-1.5 xl:px-3 whitespace-nowrap text-sm font-medium transition-colors duration-200',
              'after:absolute after:inset-x-1.5 sm:after:inset-x-3 lg:after:inset-x-1.5 xl:after:inset-x-3 after:bottom-1.5 after:h-px after:origin-center after:bg-white/70 after:transition-transform after:duration-200',
              isActive ? 'text-white after:scale-x-100' : 'text-gray-400 hover:text-white after:scale-x-0',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};

/**
 * Mesmas entradas no rodapé, em mono e caixa alta como o resto do rodapé.
 * Aqui aparecem em todos os tamanhos: é a única navegação em telemóvel.
 * Abaixo de sm, duas colunas (2 + 2); a partir de sm as quatro cabem numa linha.
 * Nunca uma entrada sozinha.
 */
export const PublicFooterNav: React.FC = () => {
  const { pathname } = useLocation();
  const items = usePublicNav();

  return (
    <nav aria-label="Sections" className="grid grid-cols-[auto_auto] justify-center justify-items-center gap-x-6 gap-y-1 sm:flex sm:flex-wrap sm:items-center">
      {items.map((item) => {
        const isActive = isCurrent(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={clsx(
              'inline-flex items-center min-h-[44px] px-1 text-xs font-medium transition-colors',
              isActive ? 'text-gray-300' : 'text-gray-400 hover:text-white',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};
