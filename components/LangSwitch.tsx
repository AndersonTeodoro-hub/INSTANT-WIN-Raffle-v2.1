import React from 'react';
import { clsx } from 'clsx';
import { useLang, translations, LANGS, LANG_LABEL } from '../pages/landing.i18n';

/**
 * Selector de idioma das páginas públicas (Landing, Roadmap, Event Center).
 *
 * Mesmo mecanismo da Landing (`useLang`, mesma chave de localStorage) — aqui
 * extraído para não repetir o markup em cada página que precisa dele.
 */
export const LangSwitch: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [lang, setLang] = useLang();

  return (
    <div
      role="group"
      aria-label={translations[lang].header.ariaLanguage}
      className={clsx(
        'inline-flex items-center rounded-lg border border-dark-border bg-dark-card/60 p-0.5',
        className,
      )}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={clsx(
            'flex items-center justify-center min-w-[44px] min-h-[44px] font-mono text-xs font-bold rounded-md transition-colors',
            lang === l ? 'bg-dark-input text-white' : 'text-gray-400 hover:text-white',
          )}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
};
