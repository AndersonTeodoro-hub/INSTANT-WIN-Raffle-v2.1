import React, { useMemo } from 'react';
import { clsx } from 'clsx';
import { markParams, markPaths, proofBytes, rimPath } from '../../lib/proof/mark';

/**
 * The proof mark of one settled draw, flat, as SVG (lib/proof/mark.ts has the
 * geometry and where the bytes come from). Green, because it is a fact proven
 * on-chain; the rim carries the proof's 64 hex digits as ticks.
 *
 * `draw` is the celebration: the strands engrave themselves once, after the chain
 * has confirmed the draw (the callers only pass a proof they read from it). With
 * `proof` null there is no mark to show — a dashed ring says the draw is not
 * proven yet, and nothing is drawn in its place.
 */
export const ProofMark: React.FC<{
  proof: string | null;
  size?: number;
  draw?: boolean;
  label: string;
  className?: string;
}> = ({ proof, size = 160, draw = false, label, className }) => {
  // Fewer, finer strands as the mark gets smaller, so it never turns to felt.
  const [strands, points] = size >= 140 ? [26, 220] : size >= 72 ? [16, 180] : [10, 140];
  const geometry = useMemo(() => {
    if (proof === null) return null;
    const params = markParams(proofBytes(proof));
    return { paths: markPaths(params, strands, points), rim: rimPath(params) };
  }, [proof, strands, points]);
  // One CSS pixel of line at any size (the box is 200 units wide).
  const line = (200 / size) * 0.9;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={clsx('iw-mark shrink-0 overflow-visible', draw && 'iw-mark-draw', className)}
    >
      <circle cx="100" cy="100" r="98" fill="none" stroke="#2a2a31" strokeWidth={line} />
      {geometry === null ? (
        <circle cx="100" cy="100" r="60" fill="none" stroke="#6b7280" strokeWidth={line * 1.2} strokeDasharray={`${line * 4} ${line * 6}`} />
      ) : (
        <>
          {size >= 72 && <path className="iw-mark-rim" d={geometry.rim} fill="none" stroke="#9ca3af" strokeOpacity="0.55" strokeWidth={line} strokeLinecap="round" />}
          <g className="iw-mark-rosette" fill="none" stroke="#22c55e" strokeWidth={line} strokeLinejoin="round">
            {geometry.paths.map((path, index) => (
              <path
                key={index}
                d={path.d}
                pathLength={1}
                strokeOpacity={path.band === 0 ? 0.72 : 0.5}
                style={{ ['--i' as string]: index }}
              />
            ))}
          </g>
        </>
      )}
    </svg>
  );
};
