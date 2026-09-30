import React from 'react';
import { clsx } from 'clsx';

/*
 * As peças de prova partilhadas pela landing, pela Keptra e pelo Event Center.
 * Só apresentação: recebem valores já lidos, não lêem nada.
 */

/** O selo de prova: o visto verde que se desenha quando um facto fica provado on-chain. */
export const ProofSeal: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={clsx('iw-seal shrink-0', className)}>
    <path d="M4 12.5 L9.5 18 L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
