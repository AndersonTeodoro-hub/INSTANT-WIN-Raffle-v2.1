import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';

/**
 * Navegação das páginas públicas (/, /giveaways, /roadmap).
 *
 * Um só array para header e rodapé das três páginas — antes desta reposição
 * havia uma entrada "Roadmap" copiada à mão em dois sítios da Landing, e com
 * três módulos passariam a ser seis cópias a divergir à primeira alteração.
 *
 * Os rótulos ficam em inglês nos três idiomas, pela mesma razão que "Roadmap"
 * já ficava: são os nomes dos módulos da Keptra (como Chainlink VRF), não
 * frases. O que muda por idioma é a descrição dos cartões na Landing, essa sim
 * traduzida.
 *
 * `/play` é a lotaria, o Instant Win: a rota do jogo não muda.
 */
/** Os módulos da Keptra. O cabeçalho da área de cada um mostra-o a seguir à marca (KeptraBrand). */
export const MODULES = {
  instantWin: { to: '/play', label: 'Instant Win' },
  giveaways: { to: '/giveaways', label: 'Giveaways' },
  eventCenter: { to: '/events', label: 'Event Center' },
} as const;

export const PUBLIC_NAV = [MODULES.instantWin, MODULES.giveaways, MODULES.eventCenter, { to: '/roadmap', label: 'Roadmap' }] as const;

/**
 * Entradas do header, visíveis em todos os tamanhos.
 *
 * Abaixo de lg passam para uma segunda linha do próprio header, a toda a
 * largura e centradas: na primeira linha vão a marca (com o nome do módulo), o
 * idioma e as acções, e as quatro entradas não cabem ao lado sem descer os
 * alvos abaixo dos 44px. Abaixo de sm juntam-se (sem intervalo, 6px de cada
 * lado) para caberem nos 343px úteis de um ecrã de 390px. Entre lg e xl, com
 * "Keptra / Event Center" e três acções na mesma linha, o mesmo aperto.
 *
 * O rodapé mantém as mesmas entradas: em páginas longas é mais perto do polegar
 * do que voltar ao topo.
 */
export const PublicNavLinks: React.FC = () => {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Sections"
      className="flex items-center justify-center gap-0 sm:gap-1 lg:justify-start"
    >
      {PUBLIC_NAV.map((item) => {
        const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={clsx(
              // O sítio onde se está leva uma aresta clara por baixo: posição, não cor de estado.
              'relative inline-flex items-center min-h-[44px] px-1.5 sm:px-3 lg:px-2 xl:px-3 whitespace-nowrap text-sm font-medium transition-colors duration-200',
              'after:absolute after:inset-x-1.5 sm:after:inset-x-3 lg:after:inset-x-2 xl:after:inset-x-3 after:bottom-1.5 after:h-px after:origin-center after:bg-white/70 after:transition-transform after:duration-200',
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
 */
export const PublicFooterNav: React.FC = () => {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Sections" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
      {PUBLIC_NAV.map((item) => {
        const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
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
