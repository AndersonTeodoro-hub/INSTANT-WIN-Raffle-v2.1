/**
 * The double of lib/bridge-v2/escrowChain.ts, for the suites that run under the
 * loader. SPEC-BLOCO-03 piece 5. The real reads run against the contracts of
 * 183a2b4 on the fork (test/bridge-v2/fork/orders.fork.mjs); here only what the
 * relay, the routes and the orders pass DO with the answers is under test.
 *
 * The pure half (orderIdFromLogs) is the real module's.
 */

import { orderIdFromLogs } from '../../../lib/bridge-v2/escrowChain.ts';

export { orderIdFromLogs };

export const calls = [];

const ZERO = '0x0000000000000000000000000000000000000000';

/** Nothing exists unless a test says so: no order, no voucher. */
const DEFAULTS = () => ({
  ordersHead: { orderCount: 1n, now: BigInt(Math.floor(Date.now() / 1000)), block: 1_000n },
  readOrders: [],
  readTerms: new Error('no terms'),
  regionsOf: [],
  trackingHashUsed: false,
  escrowArbiter: ZERO,
  orderOutcome: null,
  readObligation: new Error('no obligation'),
  voucherLastId: 0n,
  readVouchers: [],
  campaignItems: [],
  voucherReleasable: false,
  brandParams: { bondBps: 5_000, protectionBps: 300, canCreate: true, debt: 0n },
});

export let behaviour = DEFAULTS();

export function reset() {
  calls.length = 0;
  behaviour = DEFAULTS();
}

export function set(overrides) {
  Object.assign(behaviour, overrides);
}

async function answer(name, args) {
  calls.push({ name, args });
  const value = behaviour[name];
  const resolved = typeof value === 'function' ? await value(...args) : value;
  if (resolved instanceof Error) throw resolved;
  return resolved;
}

export const ordersHead = (...args) => answer('ordersHead', args);
export const readOrders = (...args) => answer('readOrders', args);
export const readTerms = (...args) => answer('readTerms', args);
export const regionsOf = (...args) => answer('regionsOf', args);
export const trackingHashUsed = (...args) => answer('trackingHashUsed', args);
export const escrowArbiter = (...args) => answer('escrowArbiter', args);
export const orderOutcome = (...args) => answer('orderOutcome', args);
export const readObligation = (...args) => answer('readObligation', args);
export const voucherLastId = (...args) => answer('voucherLastId', args);
export const readVouchers = (...args) => answer('readVouchers', args);
export const campaignItems = (...args) => answer('campaignItems', args);
export const voucherReleasable = (...args) => answer('voucherReleasable', args);
export const brandParams = (...args) => answer('brandParams', args);

/** readOrder is readOrders of one, as in the real module. */
export async function readOrder(orderId) {
  const [found] = await readOrders([orderId]);
  if (found === undefined) throw new Error('no order');
  return found;
}
