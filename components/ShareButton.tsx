import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';

const SHARE_URL = 'https://instntwin.com';

/**
 * Partilha do site. Secundário por desenho: neutro, nunca âmbar — o âmbar está
 * reservado a valores de prémio e ao único CTA primário de cada ecrã.
 *
 * `navigator.share` só existe em contexto seguro e sobretudo em mobile; quando
 * falta, copia o link para a área de transferência. Sem dependências novas e
 * sem qualquer tracking.
 */
export const ShareButton: React.FC<{
  /** "icon" para a navbar, "full" com texto para a landing. */
  variant?: 'icon' | 'full';
  /** Rótulo da variante "full", vindo do i18n da landing. */
  label?: string;
  className?: string;
}> = ({ variant = 'icon', label = 'Share', className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        // Só `url`, deliberadamente. Testado em Android: com `text` acompanhado,
        // o WhatsApp trata a partilha como mensagem de texto e não gera o cartão
        // de pré-visualização; com o link sozinho, o og-image aparece.
        await navigator.share({ url: SHARE_URL });
        return;
      }
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* partilha cancelada pelo utilizador, ou clipboard indisponível: sem estado de erro */
    }
  };

  const base =
    'inline-flex items-center justify-center gap-2 border border-dark-border text-gray-300 ' +
    'hover:text-white hover:border-gray-600 rounded-lg transition-colors ' +
    'min-h-[44px] min-w-[44px]';

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={copied ? 'Link copied' : label}
      className={`${base} ${variant === 'full' ? 'px-6 font-bold' : ''} ${className}`}
    >
      {copied ? <Check className="w-4 h-4 shrink-0" /> : <Share2 className="w-4 h-4 shrink-0" />}
      {variant === 'full' && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
};
