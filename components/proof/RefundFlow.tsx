import { useCallback, useRef } from 'react';
import { User } from 'lucide-react';
import { useFilmTimeline } from '../film/Film';
import { REFUND_FINAL, REFUND_PERIOD, refundFrame } from '../../lib/proof/flow';
import { H, INK, NODE, RAIL, W, at, ease } from './EscrowFlow';

/**
 * Chapter 03's diagram: a delivery that is not proven, and the refund (the owner's
 * decision of 27/09/2026, commit B) — from the brand's bond first, then the risk
 * reserve, then the pool, in that order. Each layer lights and sends its part to
 * the customer only once the one before it has; the customer is repaid at the end.
 * The same language as the first screen's diagram: one-pixel lines, the money in
 * white; nothing here is green, since nothing is proven.
 *
 * The drawing is hidden from assistive technology; the three layers' names are an
 * ordered list, read in order. The timeline is lib/proof/flow.ts refundFrame.
 */

const C = { x: 420, y: 136, r: 22 };
const X = { y: 40, r: 14 };
// Wide enough for "Reserva de riesgo" on a 320px drawing (a 360px phone).
const BAR = { x: 20, w: 210, h: 34 };
const LAYERS_Y = [70, 136, 202] as const;

/** The curve from a layer's end to the customer, and the point at t along it (a cubic Bézier). */
const curve = (y: number) => [BAR.x + BAR.w, y, 300, y, 330, C.y, C.x - C.r, C.y] as const;
const pointOn = (c: readonly number[], t: number): [number, number] => {
  const u = 1 - t;
  const x = u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6];
  const y = u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7];
  return [x, y];
};
const pathOf = (c: readonly number[]) => `M ${c[0]} ${c[1]} C ${c[2]} ${c[3]}, ${c[4]} ${c[5]}, ${c[6]} ${c[7]}`;
const CURVES = LAYERS_Y.map(curve);

export interface RefundFlowCopy {
  failed: string;
  customer: string;
  repaid: string;
  /** Bond, risk reserve, pool — in the order they pay. */
  layers: readonly [string, string, string];
}

export function RefundFlow({ copy, className }: { copy: RefundFlowCopy; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const cross = useRef<SVGGElement>(null);
  const failedLabel = useRef<HTMLSpanElement>(null);
  const lines = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGGElement | null)[]>([]);
  const bars = useRef<(SVGRectElement | null)[]>([]);
  const labels = useRef<(HTMLLIElement | null)[]>([]);
  const repaid = useRef<SVGCircleElement>(null);
  const repaidLabel = useRef<HTMLSpanElement>(null);

  const draw = useCallback((phase: number) => {
    const f = refundFrame(phase);
    if (cross.current) {
      cross.current.style.opacity = String(f.failed * f.shown);
      cross.current.querySelectorAll('path').forEach((stroke) => {
        stroke.style.strokeDashoffset = String(1 - f.failed);
      });
    }
    if (failedLabel.current) failedLabel.current.style.opacity = String(f.failed * f.shown);
    [f.bond, f.reserve, f.pool].forEach((value, index) => {
      const line = lines.current[index];
      if (line) {
        line.style.strokeDashoffset = String(1 - value);
        line.style.opacity = String(f.shown);
      }
      const dot = dots.current[index];
      if (dot) {
        const [x, y] = pointOn(CURVES[index], value);
        dot.setAttribute('transform', `translate(${x} ${y})`);
        dot.style.opacity = String(Math.min(1, value * 12) * (1 - ease(value, 0.85, 1)) * f.shown);
      }
      const on = value > 0.02 && f.shown > 0.5;
      const bar = bars.current[index];
      if (bar) bar.style.stroke = on ? INK : NODE;
      const label = labels.current[index];
      if (label) label.dataset.on = String(on);
    });
    if (repaid.current) repaid.current.style.opacity = String(f.repaid * f.shown);
    if (repaidLabel.current) repaidLabel.current.style.opacity = String(f.repaid * f.shown);
  }, []);
  useFilmTimeline(root, REFUND_PERIOD, REFUND_FINAL, draw);

  const drawn = { pathLength: 1, strokeDasharray: 1, fill: 'none' };
  const hair = { vectorEffect: 'non-scaling-stroke' as const };

  return (
    <div ref={root} className={className}>
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" fill="none">
          {/* The rails: from each layer to the customer, and from the unproven delivery down to them. */}
          <g stroke={RAIL} strokeWidth={1}>
            {CURVES.map((c) => (
              <path key={c[1]} d={pathOf(c)} {...hair} />
            ))}
            <line x1={C.x} y1={X.y + X.r} x2={C.x} y2={C.y - C.r} strokeDasharray="3 4" {...hair} />
          </g>

          {/* The three layers, in the order they pay. */}
          {LAYERS_Y.map((y, index) => (
            <rect
              key={y}
              ref={(element) => {
                bars.current[index] = element;
              }}
              x={BAR.x}
              y={y - BAR.h / 2}
              width={BAR.w}
              height={BAR.h}
              rx={BAR.h / 2}
              fill="#0f0f11"
              stroke={NODE}
              style={{ transition: 'stroke 300ms' }}
              {...hair}
            />
          ))}

          {/* The delivery, not proven: a cross, in the neutral grey — a failure is not a proof. */}
          <circle cx={C.x} cy={X.y} r={X.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <g ref={cross} stroke="#d1d5db" strokeWidth={2} strokeLinecap="round">
            <path d={`M ${C.x - 5} ${X.y - 5} L ${C.x + 5} ${X.y + 5}`} {...drawn} strokeDashoffset={0} />
            <path d={`M ${C.x + 5} ${X.y - 5} L ${C.x - 5} ${X.y + 5}`} {...drawn} strokeDashoffset={0} />
          </g>

          {/* The customer, and the ring round them once they are repaid. */}
          <circle cx={C.x} cy={C.y} r={C.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <circle ref={repaid} cx={C.x} cy={C.y} r={C.r + 6} stroke={INK} strokeOpacity={0.8} {...hair} />
          <User x={C.x - 10} y={C.y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />

          {/* The refund, in white, from each layer in turn. */}
          {CURVES.map((c, index) => (
            <path
              key={`line-${c[1]}`}
              ref={(element) => {
                lines.current[index] = element;
              }}
              d={pathOf(c)}
              stroke={INK}
              strokeOpacity={0.9}
              {...drawn}
              strokeDashoffset={0}
            />
          ))}
          {CURVES.map((c, index) => (
            <g
              key={`dot-${c[1]}`}
              ref={(element) => {
                dots.current[index] = element;
              }}
              opacity={0}
              transform={`translate(${c[6]} ${c[7]})`}
            >
              <circle r={9} fill={INK} fillOpacity={0.14} />
              <circle r={3.5} fill="#ffffff" />
            </g>
          ))}
        </svg>

        {/* The layers' names, as a list: the order is the point. */}
        <ol>
          {copy.layers.map((layer, index) => (
            <li
              key={layer}
              ref={(element) => {
                labels.current[index] = element;
              }}
              data-on="true"
              className="absolute flex -translate-y-1/2 items-center gap-2 whitespace-nowrap pl-4 text-xs text-gray-400 transition-colors duration-300 data-[on=true]:text-gray-100 sm:text-sm"
              style={at(BAR.x, LAYERS_Y[index])}
            >
              <span className="font-mono text-gray-400" aria-hidden="true">
                {index + 1}
              </span>
              {layer}
            </li>
          ))}
        </ol>
        <span
          ref={failedLabel}
          aria-hidden="true"
          className="absolute -translate-x-full -translate-y-1/2 whitespace-nowrap pr-3 text-xs text-gray-300 sm:text-sm"
          style={at(C.x - X.r, X.y)}
        >
          {copy.failed}
        </span>
        <span aria-hidden="true" className="absolute -translate-x-1/2 whitespace-nowrap text-center text-xs leading-snug sm:text-sm" style={at(C.x, C.y + C.r + 10)}>
          <span className="block text-gray-300">{copy.customer}</span>
          <span ref={repaidLabel} className="block font-medium text-white">
            {copy.repaid}
          </span>
        </span>
      </div>
    </div>
  );
}
