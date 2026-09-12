import React from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, Info, ShieldAlert } from 'lucide-react';

/**
 * Aviso em linha, uma só implementação.
 *
 * Nasceu de duas cópias idênticas de `ErrorBanner` — uma em EventDetail.tsx,
 * outra em EventCreate.tsx — que o redesenho teria de mudar em dois sítios para
 * dar o mesmo resultado. O redesenho acrescentou o caso `notice` (informação que
 * não é falha, como a plataforma pausada ou o evento esgotado), que antes era
 * dito em vermelho por não haver outro tom disponível.
 *
 * Sem fundo saturado: o vermelho a 10% chega para distinguir e não compete com o
 * âmbar do prémio, que é o único destaque forte autorizado em cada ecrã.
 */
export const Banner: React.FC<{
  message: string;
  tone?: 'error' | 'notice' | 'success';
  className?: string;
}> = ({ message, tone = 'error', className = '' }) => {
  const Icon = tone === 'error' ? ShieldAlert : tone === 'success' ? CheckCircle2 : Info;

  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={clsx(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed',
        tone === 'error' && 'border-red-500/30 bg-red-500/[0.07] text-red-200',
        tone === 'notice' && 'border-dark-border bg-white/[0.03] text-gray-300',
        tone === 'success' && 'border-success/30 bg-success/[0.07] text-green-200',
        className,
      )}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span className="min-w-0">{message}</span>
    </div>
  );
};
