/**
 * The first screen's diagram as a timeline (components/proof/EscrowFlow.tsx draws
 * it): one order, phase 0 to 1. The payment leaves the customer and stops at
 * Keptra, in escrow; the independent oracle's seal, "delivery proven", lights;
 * only then does the line go on to the store. The end of the cycle holds the
 * whole picture, then clears it for the next order.
 *
 * Pure, no DOM, so the order of the story is checked in a test
 * (test/bridge-v2/suites/frontend.test.mjs, LK5): the store is never paid before
 * the seal.
 */

export interface EscrowFrame {
  /** The payment's way from the customer to Keptra. */
  readonly pay: number;
  /** The payment held: the ring round Keptra closes. */
  readonly held: number;
  /** The oracle's seal: the delivery is proven. */
  readonly proven: number;
  /** The payment released, from Keptra to the store. */
  readonly release: number;
  /** How much of all that is on screen: 1, falling to 0 as the cycle clears. */
  readonly shown: number;
}

/** Seconds of one cycle when nobody scrolls: slow enough to read each step. */
export const ESCROW_PERIOD = 12;

/** The whole picture, still: what reduced motion and the still film show, and where the loop starts. */
export const ESCROW_FINAL = 0.86;

const clamp = (v: number) => Math.min(1, Math.max(0, v));
// The film's own ease (components/film/Film.tsx): moving between two states on screen.
const smooth = (t: number) => t * t * (3 - 2 * t);
const span = (phase: number, from: number, to: number) => smooth(clamp((phase - from) / (to - from)));

const wrap = (phase: number) => ((phase % 1) + 1) % 1;

export function escrowFrame(phase: number): EscrowFrame {
  const p = wrap(phase);
  return {
    pay: span(p, 0.04, 0.26),
    held: span(p, 0.26, 0.36),
    proven: span(p, 0.42, 0.54),
    release: span(p, 0.58, 0.8),
    shown: 1 - span(p, 0.93, 1),
  };
}

/*
 * The diagrams of chapters 02 to 04 (the owner's decision of 27/09/2026, commit B),
 * the same kind of timeline: each step starts only once the one before it is whole
 * (LK14 checks it at every phase), the end holds the whole picture — what the still
 * film and reduced motion show — and the cycle clears for the next one.
 */

/** 02 — a brand's sale: the offer, the payment into escrow, the shipment, the proof, the payout, and the proof that stays. */
export interface BrandFrame {
  /** The brand publishes the offer. */
  readonly publish: number;
  /** The customer's payment on its way to the escrow. */
  readonly pay: number;
  /** Held: the ring round Keptra closes. */
  readonly held: number;
  /** The brand ships, with tracking. */
  readonly ship: number;
  /** The oracle proves the delivery. */
  readonly proven: number;
  /** The on-chain proof, which stays. */
  readonly kept: number;
  /** The brand is paid. */
  readonly paid: number;
  readonly shown: number;
}

export const BRAND_PERIOD = 14;
export const BRAND_FINAL = 0.9;

export function brandFrame(phase: number): BrandFrame {
  const p = wrap(phase);
  return {
    publish: span(p, 0.02, 0.14),
    pay: span(p, 0.16, 0.3),
    held: span(p, 0.3, 0.36),
    ship: span(p, 0.38, 0.54),
    proven: span(p, 0.56, 0.66),
    kept: span(p, 0.66, 0.74),
    paid: span(p, 0.7, 0.86),
    shown: 1 - span(p, 0.95, 1),
  };
}

/**
 * 03 — a purchase (the owner's decision of 27/09/2026, commit B8): the payment into
 * escrow, the delivery, the 5 days to contest, the arbiter, and the money out of the
 * escrow to whoever the arbiter decides (KeptraEscrow at 5d85a46: a contest only
 * inside the window, :644-654; the arbiter's decision, :854-871). Guarantee and pool
 * play no part in a purchase.
 */
export interface PurchaseFrame {
  /** The customer's payment on its way to the escrow. */
  readonly pay: number;
  /** Held: the ring round Keptra closes. */
  readonly held: number;
  /** The delivery reaches the customer, and the 5-day window opens. */
  readonly delivered: number;
  /** The days that pass before the contest: three of the five, since a contest is only ever inside the window. */
  readonly window: number;
  /** The contest reaches the arbiter, who decides. */
  readonly arbiter: number;
  /** The money leaves the escrow, to whoever the arbiter decided. */
  readonly out: number;
  /** Where it goes: the store and the customer take turns, one cycle each. */
  readonly toStore: boolean;
  readonly shown: number;
}

export const PURCHASE_PERIOD = 14;
export const PURCHASE_FINAL = 0.9;
/** How many of the window's five days pass before the contest in the drawing. */
export const CONTEST_DAY = 3;

export function purchaseFrame(phase: number): PurchaseFrame {
  const p = wrap(phase);
  return {
    pay: span(p, 0.03, 0.17),
    held: span(p, 0.17, 0.23),
    delivered: span(p, 0.26, 0.36),
    window: span(p, 0.38, 0.56),
    arbiter: span(p, 0.58, 0.68),
    out: span(p, 0.7, 0.86),
    toStore: (Math.floor(phase) & 1) === 0,
    shown: 1 - span(p, 0.95, 1),
  };
}

/** 04 — providers' capital into the pool, guarantees covered up to its limit, and the brands paying back what it paid. */
export interface PoolFrame {
  /** The providers' capital on its way in. */
  readonly deposit: number;
  /** The pool's capital, whole. */
  readonly capital: number;
  /** The guarantees it covers, up to its limit. */
  readonly cover: number;
  /** A brand pays back what the pool paid for it. */
  readonly repay: number;
  readonly shown: number;
}

export const POOL_PERIOD = 12;
export const POOL_FINAL = 0.9;

export function poolFrame(phase: number): PoolFrame {
  const p = wrap(phase);
  return {
    deposit: span(p, 0.02, 0.24),
    capital: span(p, 0.24, 0.32),
    cover: span(p, 0.34, 0.56),
    repay: span(p, 0.62, 0.84),
    shown: 1 - span(p, 0.95, 1),
  };
}
