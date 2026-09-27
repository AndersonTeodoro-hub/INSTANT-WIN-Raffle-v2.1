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

export function escrowFrame(phase: number): EscrowFrame {
  const p = ((phase % 1) + 1) % 1;
  return {
    pay: span(p, 0.04, 0.26),
    held: span(p, 0.26, 0.36),
    proven: span(p, 0.42, 0.54),
    release: span(p, 0.58, 0.8),
    shown: 1 - span(p, 0.93, 1),
  };
}
