import React, { useCallback, useMemo, useRef } from 'react';
import { ArrowRight, Store, User } from 'lucide-react';
import { useFilmTimeline } from '../film/Film';
import { ESCROW_FINAL, ESCROW_PERIOD, escrowFrame } from '../../lib/proof/flow';
import { markParams, markPaths, proofBytes } from '../../lib/proof/mark';

/**
 * The first screen's diagram: an order through Keptra. Customer, Keptra, store;
 * the payment leaves the customer and stops at Keptra, in escrow; the independent
 * oracle's seal lights — delivery proven — and only then does the line go on to
 * the store. Under it, quietly, who pays back when a delivery is not proven: the
 * bond, the reserve, the pool.
 *
 * The timeline is lib/proof/flow.ts; the film's clock drives it (scroll through
 * the chapter, and a slow loop while it is on screen). The markup is the whole
 * picture, which is what reduced motion and the still film keep.
 *
 * Colour keeps the site's meanings: the payment is white, green is only what is
 * proven (the seal, the way to the store once it opens). Every line is about one
 * CSS pixel at any width. The guilloché in Keptra's node is the brand's signature,
 * drawn from the latest settled draw's proof — it explains nothing here.
 *
 * The drawing is hidden from assistive technology — the subtitle beside it says
 * the same in words; the refund order under it is read, since no other text on
 * the page names the three layers.
 */

// The drawing's own units; the labels are HTML, placed in the same units, so they keep a readable size.
const W = 480;
const H = 272;
const Y = 150;
const C = { x: 64, r: 22 };
const K = { x: 240, r: 40, ring: 47 };
const S = { x: 416, r: 22 };
const O = { y: 40, r: 14 };
const PAY = [C.x + C.r, K.x - K.ring] as const;
const RELEASE = [K.x + K.ring, S.x - S.r] as const;
const ORACLE = [O.y + O.r, Y - K.ring] as const;

const RAIL = '#2a2a31';
const NODE = '#4b5563';
const INK = '#e5e7eb';
const PROOF = '#22c55e';

const at = (x: number, y: number): React.CSSProperties => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (v: number, from: number, to: number) => {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export interface EscrowFlowCopy {
  customer: string;
  store: string;
  escrow: string;
  oracle: string;
  proven: string;
  refund: string;
  layers: readonly [string, string, string];
}

export function EscrowFlow({ copy, proof, className }: { copy: EscrowFlowCopy; proof: string | undefined; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const payLine = useRef<SVGLineElement>(null);
  const payDot = useRef<SVGGElement>(null);
  const held = useRef<SVGCircleElement>(null);
  const oracleLine = useRef<SVGLineElement>(null);
  const seal = useRef<SVGGElement>(null);
  const check = useRef<SVGPathElement>(null);
  const provenLabel = useRef<HTMLSpanElement>(null);
  const releaseLine = useRef<SVGLineElement>(null);
  const releaseDot = useRef<SVGGElement>(null);
  const paid = useRef<SVGCircleElement>(null);

  const draw = useCallback((phase: number) => {
    const f = escrowFrame(phase);
    const set = (el: SVGElement | HTMLElement | null, dash: number | null, opacity: number) => {
      if (!el) return;
      if (dash !== null) el.style.strokeDashoffset = String(1 - dash);
      el.style.opacity = String(opacity);
    };
    set(payLine.current, f.pay, f.shown);
    set(held.current, f.held, f.shown);
    set(oracleLine.current, f.proven, f.shown);
    set(check.current, f.proven, 1);
    set(seal.current, null, f.proven * f.shown);
    set(releaseLine.current, f.release, f.shown);
    set(paid.current, null, ease(f.release, 0.9, 1) * f.shown);
    // The payment travels as a point: it appears at the customer, merges into the ring as it is held.
    payDot.current?.setAttribute('transform', `translate(${lerp(PAY[0], PAY[1], f.pay)} ${Y})`);
    set(payDot.current, null, Math.min(1, f.pay * 12) * (1 - f.held) * f.shown);
    releaseDot.current?.setAttribute('transform', `translate(${lerp(RELEASE[0], RELEASE[1], f.release)} ${Y})`);
    set(releaseDot.current, null, Math.min(1, f.release * 12) * (1 - ease(f.release, 0.85, 1)) * f.shown);
    if (provenLabel.current) {
      provenLabel.current.style.opacity = String(f.proven * f.shown);
      provenLabel.current.style.transform = `translateY(${(1 - f.proven) * 4}px)`;
    }
  }, []);
  useFilmTimeline(root, ESCROW_PERIOD, ESCROW_FINAL, draw);

  // Fewer strands than the full mark: at this size more would read as felt.
  const mark = useMemo(() => (proof === undefined ? null : markPaths(markParams(proofBytes(proof)), 14, 180)), [proof]);
  const inner = K.r - 5;

  // Rails and nodes: one CSS pixel at every width. The lines that draw themselves
  // have a length of 1, so a dash offset draws them; they scale with the drawing
  // (0.75 to 1.1 px), because Chrome lays a non-scaling stroke's dashes out in
  // screen pixels and a line would then never quite finish, or never quite clear.
  const drawn = { pathLength: 1, strokeDasharray: 1, fill: 'none' };
  const hair = { vectorEffect: 'non-scaling-stroke' as const };

  return (
    <div ref={root} className={className}>
      <div aria-hidden="true" className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" fill="none">
          {/* The rails: where the payment can go. */}
          <g stroke={RAIL} strokeWidth={1} {...hair}>
            <line x1={PAY[0]} y1={Y} x2={PAY[1]} y2={Y} {...hair} />
            <line x1={RELEASE[0]} y1={Y} x2={RELEASE[1]} y2={Y} {...hair} />
            <line x1={K.x} y1={ORACLE[0]} x2={K.x} y2={ORACLE[1]} strokeDasharray="3 4" {...hair} />
          </g>

          {/* The customer and the store. */}
          <circle cx={C.x} cy={Y} r={C.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <User x={C.x - 10} y={Y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />
          <circle cx={S.x} cy={Y} r={S.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <circle ref={paid} cx={S.x} cy={Y} r={S.r} fill={PROOF} fillOpacity={0.1} stroke={PROOF} {...hair} />
          <Store x={S.x - 10} y={Y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />

          {/* Keptra: the node, its signature, and the ring that closes when the payment is held. */}
          <circle cx={K.x} cy={Y} r={K.r} stroke={NODE} {...hair} />
          {mark && (
            // It fades in once the proof is read; the transform stays on the inner group, the fade on the outer.
            <g style={{ animation: 'iw-fade 700ms var(--ease-out) both' }}>
              <g transform={`translate(${K.x} ${Y}) scale(${inner / 80}) translate(-100 -100)`} stroke="#9ca3af" strokeOpacity={0.5} strokeWidth={1}>
                {mark.map((path, index) => (
                  <path key={index} d={path.d} {...hair} />
                ))}
              </g>
            </g>
          )}
          <circle ref={held} cx={K.x} cy={Y} r={K.ring} stroke={INK} strokeOpacity={0.9} transform={`rotate(-90 ${K.x} ${Y})`} {...drawn} strokeDashoffset={0} />

          {/* The independent oracle, and its seal: the delivery is proven. */}
          <circle cx={K.x} cy={O.y} r={O.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <g ref={seal}>
            <circle cx={K.x} cy={O.y} r={O.r} fill={PROOF} fillOpacity={0.12} stroke={PROOF} {...hair} />
          </g>
          {/* The platform's check (components/Proof.tsx ProofSeal), drawn in the oracle's node. */}
          <path ref={check} d="M4 12.5 L9.5 18 L20 6" transform={`translate(${K.x - 8.4} ${O.y - 8.4}) scale(0.7)`} stroke={PROOF} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...drawn} strokeDashoffset={0} />
          <line ref={oracleLine} x1={K.x} y1={ORACLE[0]} x2={K.x} y2={ORACLE[1]} stroke={PROOF} {...drawn} strokeDashoffset={0} />

          {/* The payment: white on its way in, green once a proven delivery releases it. */}
          <line ref={payLine} x1={PAY[0]} y1={Y} x2={PAY[1]} y2={Y} stroke={INK} strokeOpacity={0.9} {...drawn} strokeDashoffset={0} />
          <line ref={releaseLine} x1={RELEASE[0]} y1={Y} x2={RELEASE[1]} y2={Y} stroke={PROOF} {...drawn} strokeDashoffset={0} />
          <g ref={payDot} opacity={0} transform={`translate(${PAY[1]} ${Y})`}>
            <circle r={9} fill={INK} fillOpacity={0.14} />
            <circle r={3.5} fill="#ffffff" />
          </g>
          <g ref={releaseDot} opacity={0} transform={`translate(${RELEASE[1]} ${Y})`}>
            <circle r={9} fill={PROOF} fillOpacity={0.18} />
            <circle r={3.5} fill={PROOF} />
          </g>
        </svg>

        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={at(C.x, Y + C.r + 10)}>
          {copy.customer}
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-center text-xs leading-snug sm:text-sm" style={at(K.x, Y + K.ring + 8)}>
          <span className="block font-semibold text-white" translate="no">
            Keptra
          </span>
          <span className="block text-gray-400">{copy.escrow}</span>
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={at(S.x, Y + S.r + 10)}>
          {copy.store}
        </span>
        <span className="absolute -translate-y-[0.7rem] whitespace-nowrap text-xs leading-snug sm:text-sm" style={at(K.x + O.r + 12, O.y)}>
          <span className="block text-gray-300">{copy.oracle}</span>
          <span ref={provenLabel} className="block font-medium text-success">
            {copy.proven}
          </span>
        </span>
      </div>

      {/* When a delivery is not proven: who pays back, in order. Quiet, under Keptra. */}
      <div className="mt-3 flex flex-col items-center gap-2 text-xs">
        <p className="text-gray-400">{copy.refund}</p>
        <ol className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-gray-300">
          {copy.layers.map((layer, index) => (
            <li key={layer} className="flex items-center gap-1.5">
              {index > 0 && <ArrowRight className="h-3 w-3 text-gray-500" aria-hidden="true" />}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dark-line bg-black/50 px-2.5 py-1">
                <span className="font-mono text-gray-400" aria-hidden="true">
                  {index + 1}
                </span>
                {layer}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
