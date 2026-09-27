import React, { useCallback, useRef } from 'react';
import { Store, User } from 'lucide-react';
import { useFilmTimeline } from '../film/Film';
import { POOL_FINAL, POOL_PERIOD, poolFrame } from '../../lib/proof/flow';
import { INK, NODE, RAIL, W, ease } from './EscrowFlow';

/**
 * Chapter 04's diagram: the guarantee pool (the owner's decision of 27/09/2026,
 * commit B). The providers' capital flows into the pool; the pool covers brands'
 * guarantees up to its limit; a brand pays back what the pool paid for it. The same
 * language as the first screen's diagram, and no figure of its own: the bar's
 * proportion — guarantees active against what is still free up to the limit — is
 * drawn from the two amounts read on-chain beside it (Landing usePoolFigures); while
 * they are not read, or if their read failed, the bar is drawn empty, never guessed.
 *
 * The drawing is hidden from assistive technology; its steps are an ordered list
 * for it (the figures themselves are read in the chapter's text). The timeline is
 * lib/proof/flow.ts poolFrame.
 */

// A little taller than the first screen's: the brands' way back runs under the bar.
const H = 290;
const PROVIDERS_Y = [78, 136, 194] as const;
const PV = { x: 48, r: 12 };
const PL = { x: 176, y: 136, r: 34 };
const BAR = { x: 240, y: 136, w: 212, h: 14 };
const BR = { x: 346, y: 214, r: 16 };
const place = (x: number, y: number): React.CSSProperties => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });

const inflow = (y: number) => `M ${PV.x + PV.r} ${y} C ${110} ${y}, ${120} ${PL.y}, ${PL.x - PL.r} ${PL.y}`;
const returnPath = `M ${BR.x - BR.r} ${BR.y} C ${280} ${BR.y + 18}, ${210} ${BR.y + 10}, ${PL.x + 6} ${PL.y + PL.r}`;
const RETURN_POINTS = [BR.x - BR.r, BR.y, 280, BR.y + 18, 210, BR.y + 10, PL.x + 6, PL.y + PL.r] as const;
const INFLOW_POINTS = PROVIDERS_Y.map((y) => [PV.x + PV.r, y, 110, y, 120, PL.y, PL.x - PL.r, PL.y] as const);
const pointOn = (c: readonly number[], t: number): [number, number] => {
  const u = 1 - t;
  return [
    u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
    u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7],
  ];
};

export interface PoolFlowCopy {
  providers: string;
  capital: string;
  covered: string;
  limit: string;
  repay: string;
  /** Read by assistive technology, in order. */
  steps: readonly string[];
}

type Amount = bigint | 'loading' | 'failed';

export function PoolFlow({ copy, active, free, className }: { copy: PoolFlowCopy; active: Amount; free: Amount; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const inLines = useRef<(SVGPathElement | null)[]>([]);
  const inDots = useRef<(SVGGElement | null)[]>([]);
  const vessel = useRef<SVGCircleElement>(null);
  const fill = useRef<SVGRectElement>(null);
  const backLine = useRef<SVGPathElement>(null);
  const backDot = useRef<SVGGElement>(null);
  // The proportion the bar fills to: guarantees active over active plus free, both read on-chain. null draws no fill.
  const share = typeof active === 'bigint' && typeof free === 'bigint' && active + free > 0n ? Number((active * 10_000n) / (active + free)) / 10_000 : null;
  const shareRef = useRef(share);
  shareRef.current = share;

  const draw = useCallback((phase: number) => {
    const f = poolFrame(phase);
    INFLOW_POINTS.forEach((points, index) => {
      // The three providers' capital arrives one after the other within the deposit.
      const own = Math.min(1, Math.max(0, f.deposit * 1.5 - index * 0.25));
      const line = inLines.current[index];
      if (line) {
        line.style.strokeDashoffset = String(1 - own);
        line.style.opacity = String(f.shown);
      }
      const dot = inDots.current[index];
      if (dot) {
        const [x, y] = pointOn(points, own);
        dot.setAttribute('transform', `translate(${x} ${y})`);
        dot.style.opacity = String(Math.min(1, own * 12) * (1 - ease(own, 0.85, 1)) * f.shown);
      }
    });
    if (vessel.current) {
      vessel.current.style.strokeDashoffset = String(1 - f.capital);
      vessel.current.style.opacity = String(f.shown);
    }
    if (fill.current) {
      const target = shareRef.current ?? 0;
      fill.current.setAttribute('width', String(Math.max(0, BAR.w * target * f.cover)));
      fill.current.style.opacity = String(f.shown);
    }
    if (backLine.current) {
      backLine.current.style.strokeDashoffset = String(1 - f.repay);
      backLine.current.style.opacity = String(f.shown);
    }
    if (backDot.current) {
      const [x, y] = pointOn(RETURN_POINTS, f.repay);
      backDot.current.setAttribute('transform', `translate(${x} ${y})`);
      backDot.current.style.opacity = String(Math.min(1, f.repay * 12) * (1 - ease(f.repay, 0.85, 1)) * f.shown);
    }
  }, []);
  useFilmTimeline(root, POOL_PERIOD, POOL_FINAL, draw);

  const drawn = { pathLength: 1, strokeDasharray: 1, fill: 'none' };
  const hair = { vectorEffect: 'non-scaling-stroke' as const };

  return (
    <div ref={root} className={className}>
      <div aria-hidden="true" className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" fill="none">
          {/* The rails: capital in, the pool to its guarantees, a brand's repayment back. */}
          <g stroke={RAIL} strokeWidth={1}>
            {PROVIDERS_Y.map((y) => (
              <path key={y} d={inflow(y)} {...hair} />
            ))}
            <line x1={PL.x + PL.r} y1={PL.y} x2={BAR.x} y2={BAR.y} {...hair} />
            <path d={returnPath} strokeDasharray="3 4" {...hair} />
          </g>

          {/* The providers. */}
          {PROVIDERS_Y.map((y) => (
            <g key={y}>
              <circle cx={PV.x} cy={y} r={PV.r} fill="#0f0f11" stroke={NODE} {...hair} />
              <User x={PV.x - 7} y={y - 7} size={14} strokeWidth={1.5} className="text-gray-300" />
            </g>
          ))}

          {/* The pool: capital, ring on ring, and the ring that closes once the capital is in. */}
          <circle cx={PL.x} cy={PL.y} r={PL.r} fill="#0f0f11" stroke={NODE} {...hair} />
          {[10, 18, 26].map((r) => (
            <circle key={r} cx={PL.x} cy={PL.y} r={r} stroke="#9ca3af" strokeOpacity={0.45} {...hair} />
          ))}
          <circle ref={vessel} cx={PL.x} cy={PL.y} r={PL.r + 6} stroke={INK} strokeOpacity={0.85} transform={`rotate(-90 ${PL.x} ${PL.y})`} {...drawn} strokeDashoffset={0} />

          {/* The guarantees it covers, up to the limit: the bar's whole length is the limit, its fill what is active. */}
          <rect x={BAR.x} y={BAR.y - BAR.h / 2} width={BAR.w} height={BAR.h} rx={BAR.h / 2} fill="#0f0f11" stroke={NODE} strokeDasharray={share === null ? '3 4' : undefined} {...hair} />
          <rect ref={fill} x={BAR.x} y={BAR.y - BAR.h / 2} width={0} height={BAR.h} rx={BAR.h / 2} fill={INK} fillOpacity={0.8} />
          <line x1={BAR.x + BAR.w} y1={BAR.y - 16} x2={BAR.x + BAR.w} y2={BAR.y + 16} stroke="#d1d5db" {...hair} />

          {/* A brand, paying back what the pool paid for it. */}
          <circle cx={BR.x} cy={BR.y} r={BR.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <Store x={BR.x - 8} y={BR.y - 8} size={16} strokeWidth={1.5} className="text-gray-300" />
          <path ref={backLine} d={returnPath} stroke={INK} strokeOpacity={0.8} {...drawn} strokeDashoffset={0} />

          {INFLOW_POINTS.map((points, index) => (
            <path
              key={`line-${points[1]}`}
              ref={(element) => {
                inLines.current[index] = element;
              }}
              d={inflow(points[1])}
              stroke={INK}
              strokeOpacity={0.9}
              {...drawn}
              strokeDashoffset={0}
            />
          ))}
          {INFLOW_POINTS.map((points, index) => (
            <g
              key={`dot-${points[1]}`}
              ref={(element) => {
                inDots.current[index] = element;
              }}
              opacity={0}
            >
              <circle r={7} fill={INK} fillOpacity={0.14} />
              <circle r={3} fill="#ffffff" />
            </g>
          ))}
          <g ref={backDot} opacity={0}>
            <circle r={9} fill={INK} fillOpacity={0.14} />
            <circle r={3.5} fill="#ffffff" />
          </g>
        </svg>

        {/* From the providers' left edge, not centred on them: the word is wider than their column. */}
        <span className="absolute whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={place(PV.x - PV.r - 4, 36)}>
          {copy.providers}
        </span>
        {/* Above the pool: under it runs the brands' way back. */}
        <span className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={place(PL.x, PL.y - PL.r - 10)}>
          {copy.capital}
        </span>
        {/* Above the bar, growing upwards when it wraps on a narrow screen. */}
        <span className="absolute w-max max-w-[50%] -translate-y-full text-xs leading-snug text-gray-300 sm:text-sm" style={place(BAR.x, BAR.y - 16)}>
          {copy.covered}
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-400 sm:text-sm" style={place(BAR.x + BAR.w, BAR.y + 20)}>
          {copy.limit}
        </span>
        <span className="absolute max-w-[46%] -translate-x-1/2 text-center text-xs leading-snug text-gray-400 sm:text-sm" style={place(BR.x + 40, BR.y + BR.r + 8)}>
          {copy.repay}
        </span>
      </div>
      <ol className="sr-only">
        {copy.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
