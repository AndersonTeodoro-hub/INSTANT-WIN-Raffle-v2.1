import React from 'react';
import { ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { TELEGRAM_URL } from '../constants';

/**
 * Link da lista de espera, variante neutra.
 *
 * Nasceu dentro da /roadmap e mudou-se para aqui quando a /giveaways passou a
 * precisar do mesmo botão: duas cópias à mão do mesmo CTA divergem à primeira
 * alteração. O markup é o mesmo, ao pixel — nada muda na /roadmap.
 *
 * Neutro de propósito: herda o estilo do CTA de pré-lançamento do banner de
 * /play, não o âmbar da Landing, que pertence a valores de prémio.
 *
 * `target="_blank"` só quando o destino é mesmo um link externo — com um
 * placeholder abriria um separador em branco a cada clique.
 */
export const WaitlistLink: React.FC<{ label: string; className?: string; withArrow?: boolean }> = ({
  label,
  className = '',
  withArrow = false,
}) => {
  const isExternal = /^https?:\/\//i.test(TELEGRAM_URL);
  return (
    <a
      href={TELEGRAM_URL}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={clsx(
        // Sem `display` aqui de propósito: o header esconde-o abaixo de sm e um
        // `inline-flex` na base ficava a competir com o `hidden` do call site.
        'items-center justify-center gap-2 min-h-[44px] rounded-lg border border-dark-border',
        'font-bold text-gray-200 hover:text-white hover:border-gray-600 transition-colors',
        className,
      )}
    >
      {label}
      {withArrow && <ArrowRight className="w-5 h-5" />}
    </a>
  );
};
