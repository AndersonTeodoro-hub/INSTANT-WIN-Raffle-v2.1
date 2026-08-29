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
 * já ficava: são os nomes dos módulos do Event Center (como INSTANT WIN ou
 * Chainlink VRF), não frases. O que muda por idioma é a descrição dos cartões
 * na Landing, essa sim traduzida.
 *
 * `/play` é a lottery: a rota do jogo não muda com esta reposição.
 */
export const PUBLIC_NAV = [
  { to: '/play', label: 'Lottery' },
  { to: '/giveaways', label: 'Giveaways' },
  { to: '/roadmap', label: 'Roadmap' },
] as const;

/**
 * Entradas do header, visíveis em todos os tamanhos.
 *
 * Abaixo de md passam para uma segunda linha do próprio header, a toda a
 * largura e centradas. Medido a 390px: a barra tem 343px úteis e a Landing já
 * gasta 257px (marca 18 + selector de idioma 138 + "Enter App" 93), enquanto
 * estas três entradas precisam de 264px. Não cabem na mesma linha sem descer os
 * alvos abaixo dos 44px — por isso descem de linha em vez de encolher.
 *
 * O rodapé mantém as mesmas entradas: em páginas longas é mais perto do polegar
 * do que voltar ao topo.
 */
export const PublicNavLinks: React.FC = () => {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Sections"
      className="flex w-full order-last justify-center items-center gap-1 pb-2 md:w-auto md:order-none md:justify-start md:pb-0"
    >
      {PUBLIC_NAV.map((item) => {
        const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? 'page' : undefined}
            className={clsx(
              'inline-flex items-center min-h-[44px] px-3 text-sm font-medium transition-colors',
              isActive ? 'text-white' : 'text-gray-400 hover:text-white',
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
              'inline-flex items-center min-h-[44px] px-1 font-mono text-[11px] uppercase tracking-widest transition-colors',
              isActive ? 'text-gray-300' : 'text-gray-500 hover:text-white',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};
