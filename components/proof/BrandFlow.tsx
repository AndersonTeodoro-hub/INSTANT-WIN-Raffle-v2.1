import React, { useCallback, useMemo, useRef } from 'react';
import { Box, Store, Truck, User } from 'lucide-react';
import { useFilmTimeline } from '../film/Film';
import { BRAND_FINAL, BRAND_PERIOD, brandFrame } from '../../lib/proof/flow';
import { markParams, markPaths, proofBytes } from '../../lib/proof/mark';
import { INK, NODE, PROOF, RAIL, W, ease, lerp } from './EscrowFlow';

/**
 * Chapter 02's diagram: a brand's sale through Keptra (the owner's decision of
 * 27/09/2026, commit B). The brand publishes the offer; the customer pays, and the
 * payment stops at Keptra, in escrow; the brand ships, with tracking; the
 * independent oracle proves the delivery, and that proof stays on-chain, beside it;
 * only then is the brand paid. The same language as the first screen's diagram
 * (EscrowFlow): one-pixel lines, white for the payment, green only for what is
 * proven, the guilloché of the latest draw in Keptra's node as a signature.
 *
 * The drawing and its labels are hidden from assistive technology; the steps under
 * it are an ordered list, read in order, and each lights as the drawing reaches it.
 * The timeline is lib/proof/flow.ts brandFrame, on the film's clock.
 */

// A taller box than the first screen's: the shipment runs along its own lane at the foot.
const H = 300;
const Y = 140;
const B = { x: 64, r: 22 };
const K = { x: 240, r: 40, ring: 47 };
const C = { x: 416, r: 22 };
const O = { y: 34, r: 14 };
const P = { x: 352, size: 26 };
const LANE = 262;
const place = (x: number, y: number): React.CSSProperties => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });

export interface BrandFlowCopy {
  brand: string;
  customer: string;
  escrow: string;
  oracle: string;
  proven: string;
  proof: string;
  proofKept: string;
  shipped: string;
  /** The five steps, in order: published, paid, shipped, proven, paid out. */
  steps: readonly string[];
}

export function BrandFlow({ copy, proof, className }: { copy: BrandFlowCopy; proof: string | undefined; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const published = useRef<SVGCircleElement>(null);
  const offerDot = useRef<SVGGElement>(null);
  const payLine = useRef<SVGLineElement>(null);
  const payDot = useRef<SVGGElement>(null);
  const held = useRef<SVGCircleElement>(null);
  const truck = useRef<SVGGElement>(null);
  const laneLine = useRef<SVGPathElement>(null);
  const seal = useRef<SVGGElement>(null);
  const check = useRef<SVGPathElement>(null);
  const oracleLine = useRef<SVGLineElement>(null);
  const provenLabel = useRef<HTMLSpanElement>(null);
  const keptLine = useRef<SVGLineElement>(null);
  const kept = useRef<SVGGElement>(null);
  const keptLabel = useRef<HTMLSpanElement>(null);
  const releaseLine = useRef<SVGLineElement>(null);
  const releaseDot = useRef<SVGGElement>(null);
  const paid = useRef<SVGCircleElement>(null);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  const draw = useCallback((phase: number) => {
    const f = brandFrame(phase);
    const set = (el: SVGElement | HTMLElement | null, dash: number | null, opacity: number) => {
      if (!el) return;
      if (dash !== null) el.style.strokeDashoffset = String(1 - dash);
      el.style.opacity = String(opacity);
    };
    set(published.current, f.publish, f.shown);
    // The offer reaches the customer: a faint point along the rail, gone once it arrives.
    offerDot.current?.setAttribute('transform', `translate(${lerp(B.x + B.r, C.x - C.r, f.publish)} ${Y})`);
    set(offerDot.current, null, Math.min(1, f.publish * 10) * (1 - ease(f.publish, 0.8, 1)) * 0.6 * f.shown);
    set(payLine.current, f.pay, f.shown);
    payDot.current?.setAttribute('transform', `translate(${lerp(C.x - C.r, K.x + K.ring, f.pay)} ${Y})`);
    set(payDot.current, null, Math.min(1, f.pay * 12) * (1 - f.held) * f.shown);
    set(held.current, f.held, f.shown);
    set(laneLine.current, f.ship, f.shown);
    truck.current?.setAttribute('transform', `translate(${lerp(B.x, C.x, f.ship) - 10} ${LANE - 10})`);
    set(truck.current, null, Math.min(1, f.ship * 12) * (1 - ease(f.ship, 0.9, 1)) * f.shown);
    set(oracleLine.current, f.proven, f.shown);
    set(check.current, f.proven, 1);
    set(seal.current, null, f.proven * f.shown);
    if (provenLabel.current) provenLabel.current.style.opacity = String(f.proven * f.shown);
    set(keptLine.current, f.kept, f.shown);
    set(kept.current, null, f.kept * f.shown);
    if (keptLabel.current) keptLabel.current.style.opacity = String(f.kept * f.shown);
    set(releaseLine.current, f.paid, f.shown);
    releaseDot.current?.setAttribute('transform', `translate(${lerp(K.x - K.ring, B.x + B.r, f.paid)} ${Y})`);
    set(releaseDot.current, null, Math.min(1, f.paid * 12) * (1 - ease(f.paid, 0.85, 1)) * f.shown);
    set(paid.current, null, ease(f.paid, 0.9, 1) * f.shown);
    // Each step lights once the drawing reaches it, and stays lit until the cycle clears.
    [f.publish, f.pay, f.ship, f.proven, f.paid].forEach((value, index) => {
      const item = steps.current[index];
      if (item) item.dataset.on = String(value > 0.02 && f.shown > 0.5);
    });
  }, []);
  useFilmTimeline(root, BRAND_PERIOD, BRAND_FINAL, draw);

  const mark = useMemo(() => (proof === undefined ? null : markPaths(markParams(proofBytes(proof)), 14, 180)), [proof]);
  const inner = K.r - 5;
  const drawn = { pathLength: 1, strokeDasharray: 1, fill: 'none' };
  const hair = { vectorEffect: 'non-scaling-stroke' as const };
  const lanePath = `M ${B.x} ${LANE} L ${C.x} ${LANE}`;

  return (
    <div ref={root} className={className}>
      <div aria-hidden="true" className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" fill="none">
          {/* The rails: the payment's way, the oracle's, the proof's, and the shipment's lane with its two drops. */}
          <g stroke={RAIL} strokeWidth={1} {...hair}>
            <line x1={B.x + B.r} y1={Y} x2={C.x - C.r} y2={Y} {...hair} />
            <line x1={K.x} y1={O.y + O.r} x2={K.x} y2={Y - K.ring} strokeDasharray="3 4" {...hair} />
            <line x1={K.x + O.r} y1={O.y} x2={P.x - P.size / 2} y2={O.y} strokeDasharray="2 4" {...hair} />
            <line x1={B.x} y1={Y + B.r} x2={B.x} y2={LANE} strokeDasharray="3 4" {...hair} />
            <line x1={C.x} y1={Y + C.r} x2={C.x} y2={LANE} strokeDasharray="3 4" {...hair} />
            <path d={lanePath} strokeDasharray="3 4" {...hair} />
          </g>

          {/* The brand, and the ring that closes round it once the offer is published; the customer. */}
          <circle cx={B.x} cy={Y} r={B.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <circle ref={paid} cx={B.x} cy={Y} r={B.r} fill={PROOF} fillOpacity={0.1} stroke={PROOF} {...hair} />
          <circle ref={published} cx={B.x} cy={Y} r={B.r + 6} stroke={INK} strokeOpacity={0.7} transform={`rotate(-90 ${B.x} ${Y})`} {...drawn} strokeDashoffset={0} />
          <Store x={B.x - 10} y={Y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />
          <circle cx={C.x} cy={Y} r={C.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <User x={C.x - 10} y={Y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />

          {/* Keptra: the node, its signature, and the ring that closes when the payment is held. */}
          <circle cx={K.x} cy={Y} r={K.r} stroke={NODE} {...hair} />
          {mark && (
            <g style={{ animation: 'iw-fade 700ms var(--ease-out) both' }}>
              <g transform={`translate(${K.x} ${Y}) scale(${inner / 80}) translate(-100 -100)`} stroke="#9ca3af" strokeOpacity={0.5} strokeWidth={1}>
                {mark.map((path, index) => (
                  <path key={index} d={path.d} {...hair} />
                ))}
              </g>
            </g>
          )}
          <circle ref={held} cx={K.x} cy={Y} r={K.ring} stroke={INK} strokeOpacity={0.9} transform={`rotate(-90 ${K.x} ${Y})`} {...drawn} strokeDashoffset={0} />

          {/* The oracle and its seal; beside it, the proof that stays on-chain. */}
          <circle cx={K.x} cy={O.y} r={O.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <g ref={seal}>
            <circle cx={K.x} cy={O.y} r={O.r} fill={PROOF} fillOpacity={0.12} stroke={PROOF} {...hair} />
          </g>
          <path ref={check} d="M4 12.5 L9.5 18 L20 6" transform={`translate(${K.x - 8.4} ${O.y - 8.4}) scale(0.7)`} stroke={PROOF} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...drawn} strokeDashoffset={0} />
          <line ref={oracleLine} x1={K.x} y1={O.y + O.r} x2={K.x} y2={Y - K.ring} stroke={PROOF} {...drawn} strokeDashoffset={0} />
          <rect x={P.x - P.size / 2} y={O.y - P.size / 2} width={P.size} height={P.size} rx={5} fill="#0f0f11" stroke={NODE} {...hair} />
          <line ref={keptLine} x1={K.x + O.r} y1={O.y} x2={P.x - P.size / 2} y2={O.y} stroke={PROOF} {...drawn} strokeDashoffset={0} />
          <g ref={kept}>
            <rect x={P.x - P.size / 2} y={O.y - P.size / 2} width={P.size} height={P.size} rx={5} fill={PROOF} fillOpacity={0.12} stroke={PROOF} {...hair} />
            <Box x={P.x - 8} y={O.y - 8} size={16} strokeWidth={1.6} className="text-success" />
          </g>

          {/* The payment: white on its way in, green once a proven delivery releases it to the brand. */}
          <line ref={payLine} x1={C.x - C.r} y1={Y} x2={K.x + K.ring} y2={Y} stroke={INK} strokeOpacity={0.9} {...drawn} strokeDashoffset={0} />
          <line ref={releaseLine} x1={K.x - K.ring} y1={Y} x2={B.x + B.r} y2={Y} stroke={PROOF} {...drawn} strokeDashoffset={0} />
          <path ref={laneLine} d={lanePath} stroke={INK} strokeOpacity={0.6} {...drawn} strokeDashoffset={0} />
          <g ref={offerDot} opacity={0} transform={`translate(${C.x - C.r} ${Y})`}>
            <circle r={3} fill={INK} />
          </g>
          <g ref={payDot} opacity={0} transform={`translate(${K.x + K.ring} ${Y})`}>
            <circle r={9} fill={INK} fillOpacity={0.14} />
            <circle r={3.5} fill="#ffffff" />
          </g>
          <g ref={releaseDot} opacity={0} transform={`translate(${B.x + B.r} ${Y})`}>
            <circle r={9} fill={PROOF} fillOpacity={0.18} />
            <circle r={3.5} fill={PROOF} />
          </g>
          <g ref={truck} opacity={0} transform={`translate(${C.x - 10} ${LANE - 10})`}>
            <rect x={-2} y={-2} width={24} height={24} rx={6} fill="#0f0f11" />
            <Truck size={20} strokeWidth={1.5} className="text-gray-200" />
          </g>
        </svg>

        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={place(B.x, Y + B.r + 10)}>
          {copy.brand}
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={place(C.x, Y + C.r + 10)}>
          {copy.customer}
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs sm:text-sm" style={place(K.x, Y + K.ring + 8)}>
          <span className="font-semibold text-white" translate="no">
            Keptra
          </span>{' '}
          <span className="text-gray-400">{copy.escrow}</span>
        </span>
        {/* The oracle's words on its left (the proof's are on its right), wrapping on a narrow screen rather than leaving the drawing. */}
        <span className="absolute w-max max-w-[44%] -translate-x-full -translate-y-[0.7rem] pr-3 text-right text-xs leading-snug sm:text-sm" style={place(K.x - O.r, O.y)}>
          <span className="block text-gray-300">{copy.oracle}</span>
          <span ref={provenLabel} className="block font-medium text-success">
            {copy.proven}
          </span>
        </span>
        <span ref={keptLabel} className="absolute -translate-x-1/2 whitespace-nowrap text-center text-xs leading-snug text-success sm:text-sm" style={place(P.x, O.y + P.size / 2 + 6)}>
          <span className="block font-medium">{copy.proof}</span>
          <span className="block text-gray-400">{copy.proofKept}</span>
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-400 sm:text-sm" style={place(K.x, LANE + 8)}>
          {copy.shipped}
        </span>
      </div>

      {/*
        The five steps, in order: read by assistive technology, and lit as the drawing
        reaches each. On a short screen they are only read — the drawing's own labels
        say the same, and the chapter's text has to fit beside it.
      */}
      <ol className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-xs [@media(max-height:720px)]:sr-only">
        {copy.steps.map((step, index) => (
          <li
            key={step}
            ref={(element) => {
              steps.current[index] = element;
            }}
            data-on="true"
            className="inline-flex items-center gap-1.5 rounded-full border border-dark-line bg-black/50 px-2.5 py-1 text-gray-400 transition-colors duration-300 data-[on=true]:border-gray-500 data-[on=true]:text-gray-100"
          >
            <span className="font-mono text-gray-400" aria-hidden="true">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
