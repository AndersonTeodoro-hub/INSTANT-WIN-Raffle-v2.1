/**
 * The chain double.
 *
 * Stands in for lib/bridge-v2/chain.ts everywhere the processor, the
 * eligibility publisher, the funder pool and the two cron routes import it, so
 * no test signs or broadcasts anything.
 *
 * The pure half of the real module is re-exported rather than reimplemented:
 * planGas is H3 and H4 themselves, rootIndexFromLogs is the fix for the root
 * index that used to be guessed, and ChainError is what the processor branches
 * on. Testing a reimplementation of any of those would test this file.
 *
 * Everything that would touch an RPC is programmable through `behaviour`, and
 * every call is recorded in `calls`, so a test can assert what the pipeline
 * asked the chain as well as what it did with the answer.
 */

import {
  ChainError,
  planGas,
  rootIndexFromLogs,
} from '../../../lib/bridge-v2/chain.ts';

export { ChainError, planGas, rootIndexFromLogs };

export const calls = [];

/** Defaults chosen so a pipeline run does nothing rather than something wrong. */
const DEFAULTS = () => ({
  readGiveaway: {
    status: 1,
    isOpen: true,
    isSettled: false,
    endTime: 0n,
    effectiveEndTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
    acceptsEntries: true,
    prizeModule: '0x0000000000000000000000000000000000000000',
    prizeKind: 0,
    prizeAmount: 0n,
    declaredValue: 0n,
    winnersCount: 1,
    feeToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    settledAt: 0n,
  },
  slotsRemaining: 10n,
  hasEntered: false,
  registeredBridge: '0x0000000000000000000000000000000000000000',
  vrfSubscriptionLink: 10n ** 19n,
  isPaused: false,
  roleAddress: '0x0000000000000000000000000000000000000000',
  waitForReceipt: { status: 'success', logs: [] },
  transactionKnown: true,
  submitAsDerived: '0x'.padEnd(66, '1'),
  publishEligibilityRoot: '0x'.padEnd(66, '2'),
  fundDerivedWallet: '0x'.padEnd(66, '3'),
  sweepRemainder: '0x'.padEnd(66, '4'),
  quoteEntryCost: { plan: plan(100_000n), data: '0xdeadbeef' },
  quoteClaim: { plan: plan(100_000n), data: '0xfeedface' },
  quoteDelivery: plan(80_000n),
  claimableFor: 0n,
  prizeAlreadyClaimed: false,
  claimDeadlineSeconds: 90n * 24n * 60n * 60n,
  prizeDelivery: null,
  balanceOf: 0n,
  transactionCount: { latest: 0, pending: 0 },
});

function plan(gasLimit) {
  return {
    gasLimit,
    maxFeePerGas: 100_000_000n,
    maxPriorityFeePerGas: 0n,
    worstCaseWei: gasLimit * 100_000_000n,
  };
}

export { plan as gasPlan };

export let behaviour = DEFAULTS();

export function reset() {
  calls.length = 0;
  behaviour = DEFAULTS();
}

/** Overrides one or more behaviours for the current test. */
export function set(overrides) {
  Object.assign(behaviour, overrides);
}

/**
 * Resolves a programmed behaviour: a function is called with the arguments, an
 * Error is thrown, anything else is returned as the value.
 */
async function answer(name, args) {
  calls.push({ name, args });
  const value = behaviour[name];
  const resolved = typeof value === 'function' ? await value(...args) : value;
  if (resolved instanceof Error) throw resolved;
  return resolved;
}

export const readGiveaway = (...args) => answer('readGiveaway', args);
export const slotsRemaining = (...args) => answer('slotsRemaining', args);
export const hasEntered = (...args) => answer('hasEntered', args);
export const registeredBridge = (...args) => answer('registeredBridge', args);
export const vrfSubscriptionLink = (...args) => answer('vrfSubscriptionLink', args);
export const isPaused = (...args) => answer('isPaused', args);
export const waitForReceipt = (...args) => answer('waitForReceipt', args);
export const transactionKnown = (...args) => answer('transactionKnown', args);
export const publishEligibilityRoot = (...args) => answer('publishEligibilityRoot', args);
export const sweepRemainder = (...args) => answer('sweepRemainder', args);
export const quoteEntryCost = (...args) => answer('quoteEntryCost', args);
export const quoteClaim = (...args) => answer('quoteClaim', args);
export const quoteDelivery = (...args) => answer('quoteDelivery', args);
export const claimableFor = (...args) => answer('claimableFor', args);
export const prizeAlreadyClaimed = (...args) => answer('prizeAlreadyClaimed', args);
export const claimDeadlineSeconds = (...args) => answer('claimDeadlineSeconds', args);
export const prizeDelivery = (...args) => answer('prizeDelivery', args);

/** roleAddress is synchronous in the real module. */
export function roleAddress() {
  calls.push({ name: 'roleAddress', args: [] });
  return behaviour.roleAddress;
}

/**
 * submitAsDerived and fundDerivedWallet keep the real signatures, including the
 * signer callbacks and the nonce callback, because what the processor does with
 * them is G6 and has to stay observable.
 */
export async function submitAsDerived(walletIndex, wallet, to, data, planIn, signAsDerived) {
  calls.push({ name: 'submitAsDerived', args: [walletIndex, wallet, to, data, planIn] });
  if (behaviour.signOnSubmit === true) await signAsDerived(walletIndex, { chainId: 42161, to, data });
  const value = behaviour.submitAsDerived;
  const resolved = typeof value === 'function' ? await value(walletIndex, wallet, to, data, planIn) : value;
  if (resolved instanceof Error) throw resolved;
  return resolved;
}

export async function fundDerivedWallet(lease, destination, amountWei, signAsFunder, onNonceSpent) {
  calls.push({ name: 'fundDerivedWallet', args: [lease, destination, amountWei] });
  const value = behaviour.fundDerivedWallet;
  const resolved =
    typeof value === 'function' ? await value(lease, destination, amountWei) : value;
  if (resolved instanceof Error) throw resolved;
  // The real module reports the nonce spent the moment the signed bytes leave
  // the process, and reports nothing when it sent nothing (the wallet was
  // already funded). The double keeps that ordering, because it is G6.
  if (resolved !== null) onNonceSpent(lease.nextNonce + 1);
  return resolved;
}

/** funders.ts reads a transaction count through this to reconcile a nonce (G6). */
export function publicClient() {
  return {
    getTransactionCount: async ({ address, blockTag }) => {
      calls.push({ name: 'getTransactionCount', args: [address, blockTag] });
      const counts = behaviour.transactionCount;
      const resolved = typeof counts === 'function' ? await counts(address, blockTag) : counts;
      if (resolved instanceof Error) throw resolved;
      return blockTag === 'pending' ? resolved.pending : resolved.latest;
    },
    getBalance: async ({ address }) => {
      calls.push({ name: 'getBalance', args: [address] });
      const value = behaviour.balanceOf;
      const resolved = typeof value === 'function' ? await value(address) : value;
      if (resolved instanceof Error) throw resolved;
      return resolved;
    },
  };
}
