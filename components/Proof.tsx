import React from 'react';
import { clsx } from 'clsx';

/*
 * As peças de prova partilhadas pela landing, pelo jogo e pelo Event Center.
 * Só apresentação: recebem valores já lidos, não lêem nada.
 */

/**
 * Duração de uma ronda da lotaria, em segundos — o "30 min" que a própria página
 * declara em `raffle.factRoundsValue`. Serve só para desenhar quanto da ronda já
 * passou; o relógio e o fecho continuam a vir do `endTime` do contrato.
 */
export const ROUND_SECONDS = 30 * 60;

const pad = (n: number) => n.toString().padStart(2, '0');

/**
 * O relógio da ronda, como instrumento: horas, minutos e segundos em três
 * mostradores. `closing` troca os dígitos pela palavra do fecho com um desfoque
 * curto, para a mudança de estado não teleportar.
 */
export const RoundClock: React.FC<{ seconds: number; closing?: React.ReactNode; className?: string }> = ({
  seconds,
  closing,
  className,
}) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const parts = [pad(Math.floor(safe / 3600)), pad(Math.floor((safe % 3600) / 60)), pad(safe % 60)];

  if (closing) {
    return (
      <p key="closing" className={clsx('iw-swap font-display font-bold uppercase tracking-tight text-gray-300', className)}>
        {closing}
      </p>
    );
  }

  return (
    <p key="clock" className={clsx('iw-swap flex items-center justify-center font-mono font-bold leading-none text-white', className)}>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span aria-hidden="true" className="px-[0.06em] text-gray-400">
              :
            </span>
          )}
          <span className="rounded-[0.14em] border border-dark-border bg-white/[0.035] px-[0.12em] py-[0.1em] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            {part}
          </span>
        </React.Fragment>
      ))}
    </p>
  );
};

/** Quanto da ronda já passou: uma linha que avança um segundo de cada vez. */
export const RoundMeter: React.FC<{ seconds: number; closing?: boolean; className?: string }> = ({ seconds, closing, className }) => {
  const elapsed = closing ? 1 : Math.min(1, Math.max(0, 1 - seconds / ROUND_SECONDS));
  return (
    <div aria-hidden="true" className={clsx('h-1 w-full overflow-hidden rounded-full bg-white/[0.07]', className)}>
      <div
        className={clsx('h-full origin-left rounded-full', closing ? 'bg-gray-500' : 'bg-success/80')}
        style={{ transform: `scaleX(${elapsed})`, transition: 'transform 1000ms linear' }}
      />
    </div>
  );
};

/** O selo de prova: o visto verde que se desenha quando um facto fica provado on-chain. */
export const ProofSeal: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={clsx('iw-seal shrink-0', className)}>
    <path d="M4 12.5 L9.5 18 L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
