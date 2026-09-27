import { useCallback, useMemo, useRef } from 'react';
import { PackageCheck, Scale, Store, User } from 'lucide-react';
import { useFilmMode, useFilmTimeline } from '../film/Film';
import { CONTEST_DAY, PURCHASE_FINAL, PURCHASE_PERIOD, purchaseFrame } from '../../lib/proof/flow';
import { markParams, markPaths, proofBytes } from '../../lib/proof/mark';
import { H, INK, NODE, RAIL, W, at, ease, lerp } from './EscrowFlow';

/**
 * Chapter 03's diagram: a purchase through Keptra (the owner's decision of
 * 27/09/2026, commit B8). The customer's payment stops at Keptra, in escrow; the
 * delivery arrives, and the five days to contest open round the escrow, one segment
 * a day, while the money stays inside; a contest, inside the window, goes to the
 * arbiter; the arbiter decides, and only then does the money leave the escrow — to
 * the store, or back to the customer. Moving, the two take turns, one cycle each;
 * the still picture draws both ways out, since the arbiter may decide either. No
 * bond, reserve or pool: a purchase never calls them.
 *
 * The same language as the first screen's diagram (EscrowFlow): one-pixel lines,
 * white for the money, the guilloché of the latest draw in Keptra's node; nothing is
 * green, since nothing here is an oracle's proof. The drawing and its labels are
 * hidden from assistive technology; the steps under it are an ordered list, read in
 * order, lit as the drawing reaches each. The timeline is lib/proof/flow.ts
 * purchaseFrame, on the film's clock.
 */

const Y = 150;
const C = { x: 64, r: 22 };
const K = { x: 240, r: 40, ring: 47 };
const S = { x: 416, r: 22 };
const A = { y: 40, r: 14 };
/** The contest window round the escrow: five days, a segment each. */
const WIN = 56;
const DAYS = 5;
const PAY = [C.x + C.r, K.x - WIN] as const;
const TO_STORE = [K.x + WIN, S.x - S.r] as const;
const ARBITER = [A.y + A.r, Y - WIN] as const;
/** The way back to the customer: from the window's upper left, over the payment's rail, into the customer's upper right (a cubic Bézier). */
const BACK = [198, 108, 172, 74, 106, 74, 80, 134] as const;
const BACK_PATH = `M ${BACK[0]} ${BACK[1]} C ${BACK[2]} ${BACK[3]}, ${BACK[4]} ${BACK[5]}, ${BACK[6]} ${BACK[7]}`;
const onBack = (t: number): [number, number] => {
  const u = 1 - t;
  const x = u * u * u * BACK[0] + 3 * u * u * t * BACK[2] + 3 * u * t * t * BACK[4] + t * t * t * BACK[6];
  const y = u * u * u * BACK[1] + 3 * u * u * t * BACK[3] + 3 * u * t * t * BACK[5] + t * t * t * BACK[7];
  return [x, y];
};
/** Each day's arc, clockwise from the top, with a gap either side. */
const DAY_ARCS = Array.from({ length: DAYS }, (_unused, day) => {
  const point = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return `${(K.x + WIN * Math.cos(radians)).toFixed(2)} ${(Y + WIN * Math.sin(radians)).toFixed(2)}`;
  };
  const from = -90 + (360 / DAYS) * day + 5;
  return `M ${point(from)} A ${WIN} ${WIN} 0 0 1 ${point(from + 360 / DAYS - 10)}`;
});

export interface PurchaseFlowCopy {
  customer: string;
  store: string;
  escrow: string;
  delivered: string;
  window: string;
  arbiter: string;
  decides: string;
  /** The owner's five steps, in order: payment in escrow, delivery, 5 days to contest, arbiter, out of escrow. */
  steps: readonly string[];
}

export function PurchaseFlow({ copy, proof, className }: { copy: PurchaseFlowCopy; proof: string | undefined; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const payLine = useRef<SVGLineElement>(null);
  const payDot = useRef<SVGGElement>(null);
  const held = useRef<SVGCircleElement>(null);
  const parcel = useRef<SVGGElement>(null);
  const deliveredLabel = useRef<HTMLSpanElement>(null);
  const days = useRef<SVGGElement>(null);
  const daysLit = useRef<(SVGPathElement | null)[]>([]);
  const windowLabel = useRef<HTMLSpanElement>(null);
  const arbiterLine = useRef<SVGLineElement>(null);
  const arbiterRing = useRef<SVGCircleElement>(null);
  const decidesLabel = useRef<HTMLSpanElement>(null);
  const storeLine = useRef<SVGLineElement>(null);
  const backLine = useRef<SVGPathElement>(null);
  const outDot = useRef<SVGGElement>(null);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const live = useFilmMode() === 'live';
  const liveRef = useRef(live);
  liveRef.current = live;

  const draw = useCallback((phase: number) => {
    const f = purchaseFrame(phase);
    const set = (el: SVGElement | HTMLElement | null, dash: number | null, opacity: number) => {
      if (!el) return;
      if (dash !== null) el.style.strokeDashoffset = String(1 - dash);
      el.style.opacity = String(opacity);
    };
    set(payLine.current, f.pay, f.shown);
    payDot.current?.setAttribute('transform', `translate(${lerp(PAY[0], PAY[1], f.pay)} ${Y})`);
    set(payDot.current, null, Math.min(1, f.pay * 12) * (1 - f.held) * f.shown);
    set(held.current, f.held, f.shown);
    // The parcel settles on the customer; the window opens with it.
    set(parcel.current, null, f.delivered * f.shown);
    if (parcel.current) parcel.current.style.transform = `translateY(${(1 - f.delivered) * -6}px)`;
    set(deliveredLabel.current, null, f.delivered * f.shown);
    set(days.current, null, f.delivered * f.shown);
    set(windowLabel.current, null, f.delivered * f.shown);
    // One day after the other, up to the contest.
    daysLit.current.forEach((arc, day) => set(arc, Math.min(1, Math.max(0, f.window * CONTEST_DAY - day)), f.shown));
    set(arbiterLine.current, f.arbiter, f.shown);
    set(arbiterRing.current, null, f.arbiter * f.shown);
    set(decidesLabel.current, null, f.arbiter * f.shown);
    // Out of the escrow: one way per cycle while it moves; both ways in the still picture.
    const both = !liveRef.current;
    set(storeLine.current, f.toStore || both ? f.out : 0, f.shown);
    set(backLine.current, !f.toStore || both ? f.out : 0, f.shown);
    const [x, y] = f.toStore ? [lerp(TO_STORE[0], TO_STORE[1], f.out), Y] : onBack(f.out);
    outDot.current?.setAttribute('transform', `translate(${x} ${y})`);
    set(outDot.current, null, both ? 0 : Math.min(1, f.out * 12) * (1 - ease(f.out, 0.85, 1)) * f.shown);
    [f.pay, f.delivered, f.window, f.arbiter, f.out].forEach((value, index) => {
      const item = steps.current[index];
      if (item) item.dataset.on = String(value > 0.02 && f.shown > 0.5);
    });
  }, []);
  useFilmTimeline(root, PURCHASE_PERIOD, PURCHASE_FINAL, draw);

  const mark = useMemo(() => (proof === undefined ? null : markPaths(markParams(proofBytes(proof)), 14, 180)), [proof]);
  const inner = K.r - 5;
  const drawn = { pathLength: 1, strokeDasharray: 1, fill: 'none' };
  const hair = { vectorEffect: 'non-scaling-stroke' as const };

  return (
    <div ref={root} className={className}>
      <div aria-hidden="true" className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" fill="none">
          {/* The rails: the payment's way in, the arbiter's, and the two ways out — to the store, back to the customer. */}
          <g stroke={RAIL} strokeWidth={1} {...hair}>
            <line x1={PAY[0]} y1={Y} x2={PAY[1]} y2={Y} {...hair} />
            <line x1={TO_STORE[0]} y1={Y} x2={TO_STORE[1]} y2={Y} {...hair} />
            <line x1={K.x} y1={ARBITER[0]} x2={K.x} y2={ARBITER[1]} strokeDasharray="3 4" {...hair} />
            <path d={BACK_PATH} strokeDasharray="3 4" {...hair} />
          </g>

          {/* The customer, with the parcel once delivered; the store. */}
          <circle cx={C.x} cy={Y} r={C.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <User x={C.x - 10} y={Y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />
          <g ref={parcel}>
            <rect x={C.x - 34} y={Y - 38} width={20} height={20} rx={5} fill="#0f0f11" stroke={INK} strokeOpacity={0.7} {...hair} />
            <PackageCheck x={C.x - 31} y={Y - 35} size={14} strokeWidth={1.6} className="text-gray-100" />
          </g>
          <circle cx={S.x} cy={Y} r={S.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <Store x={S.x - 10} y={Y - 10} size={20} strokeWidth={1.5} className="text-gray-300" />

          {/* Keptra: the node, its signature, the ring that closes when the payment is held, and the window's five days round it. */}
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
          <g ref={days} stroke={NODE}>
            {DAY_ARCS.map((d) => (
              <path key={d} d={d} {...hair} />
            ))}
          </g>
          {DAY_ARCS.slice(0, CONTEST_DAY).map((d, day) => (
            <path
              key={`lit-${d}`}
              ref={(element) => {
                daysLit.current[day] = element;
              }}
              d={d}
              stroke={INK}
              strokeOpacity={0.9}
              strokeWidth={2}
              strokeLinecap="round"
              {...drawn}
              strokeDashoffset={0}
            />
          ))}

          {/* The arbiter, above the escrow: the contest reaches them, and they decide. */}
          <circle cx={K.x} cy={A.y} r={A.r} fill="#0f0f11" stroke={NODE} {...hair} />
          <circle ref={arbiterRing} cx={K.x} cy={A.y} r={A.r} stroke={INK} {...hair} />
          <Scale x={K.x - 8} y={A.y - 8} size={16} strokeWidth={1.6} className="text-gray-200" />
          <line ref={arbiterLine} x1={K.x} y1={ARBITER[0]} x2={K.x} y2={ARBITER[1]} stroke={INK} strokeOpacity={0.8} {...drawn} strokeDashoffset={0} />

          {/* The money: in, then out of the escrow — to the store, or back to the customer. */}
          <line ref={payLine} x1={PAY[0]} y1={Y} x2={PAY[1]} y2={Y} stroke={INK} strokeOpacity={0.9} {...drawn} strokeDashoffset={0} />
          <line ref={storeLine} x1={TO_STORE[0]} y1={Y} x2={TO_STORE[1]} y2={Y} stroke={INK} strokeOpacity={0.9} {...drawn} strokeDashoffset={0} />
          <path ref={backLine} d={BACK_PATH} stroke={INK} strokeOpacity={0.9} {...drawn} strokeDashoffset={0} />
          <g ref={payDot} opacity={0} transform={`translate(${PAY[1]} ${Y})`}>
            <circle r={9} fill={INK} fillOpacity={0.14} />
            <circle r={3.5} fill="#ffffff" />
          </g>
          <g ref={outDot} opacity={0} transform={`translate(${TO_STORE[1]} ${Y})`}>
            <circle r={9} fill={INK} fillOpacity={0.14} />
            <circle r={3.5} fill="#ffffff" />
          </g>
        </svg>

        <span className="absolute -translate-x-1/2 whitespace-nowrap text-center text-xs leading-snug sm:text-sm" style={at(C.x, Y + C.r + 10)}>
          <span className="block text-gray-300">{copy.customer}</span>
          <span ref={deliveredLabel} className="block font-medium text-white">
            {copy.delivered}
          </span>
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-center text-xs leading-snug sm:text-sm" style={at(K.x, Y + WIN + 8)}>
          <span className="block">
            <span className="font-semibold text-white" translate="no">
              Keptra
            </span>{' '}
            <span className="text-gray-400">{copy.escrow}</span>
          </span>
          <span ref={windowLabel} className="block text-gray-300">
            {copy.window}
          </span>
        </span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs text-gray-300 sm:text-sm" style={at(S.x, Y + S.r + 10)}>
          {copy.store}
        </span>
        <span className="absolute -translate-y-[0.7rem] whitespace-nowrap text-xs leading-snug sm:text-sm" style={at(K.x + A.r + 12, A.y)}>
          <span className="block text-gray-300">{copy.arbiter}</span>
          <span ref={decidesLabel} className="block font-medium text-white">
            {copy.decides}
          </span>
        </span>
      </div>

      {/*
        The owner's five steps, in order: read by assistive technology, and lit as the
        drawing reaches each. Below the side-by-side layout, or on a short screen, they
        are only read — the drawing's own labels say the same, and the chapter's text has
        to fit with it.
      */}
      <ol className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-xs max-lg:sr-only [@media(max-height:720px)]:sr-only">
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
