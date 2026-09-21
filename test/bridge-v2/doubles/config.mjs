/**
 * The configuration, as the real module, with the three contract addresses of
 * SPEC-BLOCO-03 piece 5 settable by a test. Adenda P24 keeps them literals in
 * config.ts, zero until the owner fills them in after the deploy; the suites
 * need them pointed at the contracts a test deployed on the fork (or at any
 * non-zero address, for the doubled chain).
 *
 * Every other export is the real module's. A local export shadows the star
 * re-export of the same name, and an imported binding is live, so a module that
 * imported KEPTRA_ESCROW before setKeptraContracts ran sees the new value.
 */

import * as real from '../../../lib/bridge-v2/config.ts';

export * from '../../../lib/bridge-v2/config.ts';

/** What config.ts itself says: zero until the owner fills them in (P24). */
export const REAL_KEPTRA = {
  escrow: real.KEPTRA_ESCROW,
  guarantee: real.KEPTRA_GUARANTEE,
  voucher: real.KEPTRA_VOUCHER,
};

export let KEPTRA_ESCROW = real.KEPTRA_ESCROW;
export let KEPTRA_GUARANTEE = real.KEPTRA_GUARANTEE;
export let KEPTRA_VOUCHER = real.KEPTRA_VOUCHER;

export function setKeptraContracts({ escrow, guarantee, voucher }) {
  KEPTRA_ESCROW = escrow;
  KEPTRA_GUARANTEE = guarantee;
  KEPTRA_VOUCHER = voucher;
}

export function resetKeptraContracts() {
  setKeptraContracts(REAL_KEPTRA);
}
