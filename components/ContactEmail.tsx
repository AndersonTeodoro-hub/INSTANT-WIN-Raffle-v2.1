import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import { INVESTOR_EMAIL } from '../constants';
import { useLang, translations } from '../pages/landing.i18n';

/** Quanto tempo "Copiado" fica à vista. */
export const COPIED_MS = 2000;

/**
 * O endereço de contacto, escrito e seleccionável, ao lado do botão mailto: nos
 * dois pontos de contacto do site público (decisão do owner de 27/09/2026) —
 * para quem não tem um programa de email no aparelho. "Copy" põe-no na área de
 * transferência e diz "Copied" durante 2 s. Se o browser não deixar copiar, o
 * endereço fica seleccionado, para o copiar à mão, e o botão di-lo.
 */
export function ContactEmail({ className }: { className?: string }) {
  const [lang] = useLang();
  const t = translations[lang].contact;
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const address = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INVESTOR_EMAIL);
      setState('copied');
    } catch {
      const selection = window.getSelection();
      if (address.current && selection) selection.selectAllChildren(address.current);
      setState('selected');
    }
  };

  const said = state === 'copied' ? t.copied : state === 'selected' ? t.selected : '';
  return (
    <span className={clsx('inline-flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2', className)}>
      <span ref={address} translate="no" className="min-w-0 select-all break-all font-mono text-[13px] text-gray-200 sm:text-sm">
        {INVESTOR_EMAIL}
      </span>
      {/* "Copy" e "Copied" no mesmo lugar: o botão tem a largura do maior e não empurra o endereço. */}
      <button type="button" onClick={copy} className="iw-btn iw-btn-secondary h-11 min-h-0 gap-2 px-3 text-sm">
        {state === 'copied' ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        <span className="grid">
          <span className={clsx('col-start-1 row-start-1', state === 'copied' && 'invisible')}>{t.copy}</span>
          <span className={clsx('col-start-1 row-start-1', state !== 'copied' && 'invisible')}>{t.copied}</span>
        </span>
      </button>
      <span aria-live="polite" className="sr-only">
        {said}
      </span>
      {state === 'selected' && <span className="text-xs text-gray-400">{t.selected}</span>}
    </span>
  );
}
