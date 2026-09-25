import React, { useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import { ExternalLink } from 'lucide-react';
import { ProofMark } from './ProofMark';
import { ProofSeal } from '../Proof';
import { shortProof } from '../../lib/proof/mark';

/**
 * Whether this device has already watched a proof's reveal. The celebration
 * belongs to the first time a draw is seen; after that the result is simply
 * there, at once. localStorage may be unavailable (private mode): then every
 * visit is the first, which is harmless.
 */
export function useFirstSight(proof: string | null): boolean {
  const key = proof === null ? null : `iw-seen:${proof.toLowerCase()}`;
  // Read during render, written after commit: a render that is thrown away writes nothing.
  const first = useMemo(() => {
    if (key === null) return false;
    try {
      return window.localStorage.getItem(key) === null;
    } catch {
      return true;
    }
  }, [key]);
  useEffect(() => {
    if (key === null) return;
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* not kept: the next visit celebrates again */
    }
  }, [key]);
  return first;
}

export interface RevealRow {
  readonly key: string;
  readonly rank: number;
  readonly who: React.ReactNode;
  readonly amount?: React.ReactNode;
  readonly mine?: boolean;
  readonly mineLabel?: string;
}

/**
 * The result of a draw, as a moment and not a list. It is only ever given a
 * draw the chain has settled (the callers read SETTLED and the draw's own proof
 * first); what it shows is why the result is true: the mark drawn from that
 * proof, the seal, and the proof itself with the link to check it.
 *
 * Order, the first time: the mark engraves itself, the seal draws, then the
 * winners arrive one by one. Reduced motion: all at once (index.css).
 */
export function DrawReveal({
  proof,
  markLabel,
  title,
  seal,
  rows,
  proofLabel,
  proofHref,
  children,
  animate,
  className,
}: {
  proof: string;
  markLabel: string;
  title: React.ReactNode;
  seal: string;
  rows: readonly RevealRow[];
  proofLabel: string;
  proofHref: string;
  children?: React.ReactNode;
  /** The first sight of this draw (useFirstSight). */
  animate: boolean;
  className?: string;
}) {
  return (
    <div className={clsx('iw-reveal-moment grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start', animate && 'is-first', className)}>
      <div className="flex justify-center sm:block">
        <ProofMark proof={proof} size={176} draw={animate} label={markLabel} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
          <span className="iw-reveal-seal inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/[0.07] px-2.5 py-1 text-xs font-medium text-success">
            <ProofSeal className="h-3.5 w-3.5" />
            {seal}
          </span>
        </div>

        {rows.length > 0 && (
          <ol className="mt-4 divide-y divide-dark-border border-y border-dark-border">
            {rows.map((row, index) => (
              <li
                key={row.key}
                style={{ ['--i' as string]: index }}
                className={clsx(
                  'iw-reveal-row flex min-h-[48px] flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5',
                  row.mine && '-mx-3 bg-brand/[0.07] px-3',
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 font-mono text-xs text-gray-400 tabular-nums">{row.rank}</span>
                  <span className={clsx('min-w-0 break-all font-mono text-sm', row.mine ? 'text-brand' : 'text-gray-200')}>{row.who}</span>
                  {row.mine && row.mineLabel && (
                    <span className="shrink-0 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold text-black">{row.mineLabel}</span>
                  )}
                </span>
                {row.amount !== undefined && <span className="shrink-0 font-mono text-sm font-bold text-brand tabular-nums">{row.amount}</span>}
              </li>
            ))}
          </ol>
        )}

        {children}

        <a
          href={proofHref}
          target="_blank"
          rel="noopener noreferrer"
          className="iw-reveal-proof mt-4 inline-flex min-h-[44px] max-w-full items-center gap-2 text-sm text-gray-300 transition-colors duration-200 hover:text-success"
        >
          <span>{proofLabel}</span>
          <span className="truncate font-mono text-success">{shortProof(proof)}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
