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
 * Tensão do fim da ronda: 1 no último minuto, 2 nos últimos dez segundos.
 * Uma batida por segundo, nunca mais — nada pisca acima de 3 por segundo.
 */
export const clockTension = (seconds: number): 0 | 1 | 2 => (seconds > 0 && seconds <= 10 ? 2 : seconds > 0 && seconds <= 60 ? 1 : 0);

/**
 * O relógio da ronda, como instrumento: horas, minutos e segundos em três
 * mostradores. `closing` troca os dígitos pela palavra do fecho com um desfoque
 * curto, para a mudança de estado não teleportar. No último minuto cada segundo
 * cai no seu mostrador (a tensão do fim); `plain` é o mesmo relógio sem
 * mostradores, para o talão do bilhete.
 */
export const RoundClock: React.FC<{ seconds: number; closing?: React.ReactNode; className?: string; plain?: boolean }> = ({
  seconds,
  closing,
  className,
  plain = false,
}) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const parts = [pad(Math.floor(safe / 3600)), pad(Math.floor((safe % 3600) / 60)), pad(safe % 60)];
  const tension = clockTension(safe);

  if (closing) {
    return (
      <p key="closing" className={clsx('iw-swap font-display font-bold uppercase tracking-tight text-gray-300', className)}>
        {closing}
      </p>
    );
  }

  return (
    <p
      key="clock"
      data-tension={tension || undefined}
      className={clsx('iw-clock iw-swap flex items-center font-mono font-bold leading-none text-white', className)}
    >
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span aria-hidden="true" className={clsx('text-gray-400', !plain && 'px-[0.06em]')}>
              :
            </span>
          )}
          <span
            // Na tensão, o mostrador que muda é outro elemento a cada valor: a batida corre de novo.
            key={tension && index > 0 ? `${index}-${part}` : index}
            className={clsx(
              'iw-clock-cell inline-block',
              tension && index > 0 && 'iw-tick',
              !plain && 'rounded-[0.14em] border border-dark-border bg-white/[0.035] px-[0.12em] py-[0.1em] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
            )}
          >
            {part}
          </span>
        </React.Fragment>
      ))}
    </p>
  );
};

/**
 * Quanto da ronda já passou: uma linha que avança um segundo de cada vez. No
 * último minuto a ponta da linha bate com cada segundo.
 */
export const RoundMeter: React.FC<{ seconds: number; closing?: boolean; className?: string }> = ({ seconds, closing, className }) => {
  const elapsed = closing ? 1 : Math.min(1, Math.max(0, 1 - seconds / ROUND_SECONDS));
  const tension = closing ? 0 : clockTension(seconds);
  return (
    <div aria-hidden="true" className={clsx('relative h-1 w-full rounded-full bg-white/[0.07]', className)}>
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div
          className={clsx('h-full origin-left rounded-full', closing ? 'bg-gray-500' : 'bg-success/80')}
          style={{ transform: `scaleX(${elapsed})`, transition: 'transform 1000ms linear' }}
        />
      </div>
      {tension > 0 && (
        <div className="absolute inset-0" style={{ transform: `translateX(${(elapsed - 1) * 100}%)`, transition: 'transform 1000ms linear' }}>
          <span key={Math.floor(seconds)} className="iw-meter-tip absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-success" data-tension={tension} />
        </div>
      )}
    </div>
  );
};

/** O selo de prova: o visto verde que se desenha quando um facto fica provado on-chain. */
export const ProofSeal: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={clsx('iw-seal shrink-0', className)}>
    <path d="M4 12.5 L9.5 18 L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
