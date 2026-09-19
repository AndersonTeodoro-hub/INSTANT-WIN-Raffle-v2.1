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
  cleanSymbol,
  encodeTokenPrizeData,
  giveawayIdFromLogs,
  planGas,
  rootIndexFromLogs,
} from '../../../lib/bridge-v2/chain.ts';

export { ChainError, cleanSymbol, encodeTokenPrizeData, giveawayIdFromLogs, planGas, rootIndexFromLogs };

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
    prizeDelivered: 0n,
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
  // SPEC-BLOCO-03 Adenda F6: what a derived wallet holds in ETH and what sweeping it costs.
  sweepQuote: { balance: 0n, cost: 1_000_000_000_000n },
  // Adenda F6: the migration's last sweep, and what it cost.
  sweepAboveCost: { hash: '0x'.padEnd(66, '6'), cost: 1_000_000_000_000n },
  // SPEC-BLOCO-03 Adenda F5: the campaigns a creator account created since an instant.
  campaignsCreatedBy: [],
  // SPEC-BLOCO-03 A8: whether a cancelled campaign's creator took the refund.
  creatorRefunded: false,
  quoteEntryCost: { plan: plan(100_000n), data: '0xdeadbeef' },
  quoteClaim: { plan: plan(100_000n), data: '0xfeedface' },
  quoteDelivery: plan(80_000n),
  claimableFor: 0n,
  prizeAlreadyClaimed: false,
  claimDeadlineSeconds: 90n * 24n * 60n * 60n,
  prizeDelivery: null,
  balanceOf: 0n,
  transactionCount: { latest: 0, pending: 0 },
  // 07/09/2026 decision — creator-without-wallet campaigns.
  isModuleRegistered: true,
  modulePrizeKind: 0, // PrizeKind.TOKEN
  currentCreationFee: 1_000_000n,
  slotPrice: 100_000n,
  erc20Allowance: 0n,
  erc20BalanceOf: 0n,
  // The settlement notice's "what you won". null is the honest default for a
  // token that implements neither, which mail.ts degrades around.
  erc20Meta: { symbol: 'USDC', decimals: 6 },
  quoteApprove: { plan: plan(60_000n), data: '0xapprove' },
  quoteCreateGiveaway: { plan: plan(300_000n), data: '0xcreatecall' },
  // SPEC-BRIDGE-V2 §17 — campaign identity. No campaign exists and no contract
  // wallet accepts anything unless a test says so.
  giveawayCreator: null,
  isValidContractSignature: false,
  // SPEC-BRIDGE-V2 §18 — the keeper. No campaign exists unless a test says so,
  // so a pipeline run in any other suite reaches the lifecycle phase and finds
  // nothing to do.
  lifecycleHead: { lastGiveawayId: 0n, now: BigInt(Math.floor(Date.now() / 1000)), paused: false },
  readLifecyclePage: [],
  keeperAccount: { balance: 10n ** 18n, latestNonce: 0, pendingNonce: 0, maxFeePerGas: 100_000_000n },
  sendLifecycleCall: '0x'.padEnd(66, '5'),
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

// SPEC-BRIDGE-V2 §18 — the keeper.
export const lifecycleHead = (...args) => answer('lifecycleHead', args);
export const readLifecyclePage = (...args) => answer('readLifecyclePage', args);
export const keeperAccount = (...args) => answer('keeperAccount', args);
export const sendLifecycleCall = (...args) => answer('sendLifecycleCall', args);
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
export const sweepQuote = (...args) => answer('sweepQuote', args);
export const sweepAboveCost = (...args) => answer('sweepAboveCost', args);
export const campaignsCreatedBy = (...args) => answer('campaignsCreatedBy', args);
export const creatorRefunded = (...args) => answer('creatorRefunded', args);
export const quoteEntryCost = (...args) => answer('quoteEntryCost', args);
export const quoteClaim = (...args) => answer('quoteClaim', args);
export const quoteDelivery = (...args) => answer('quoteDelivery', args);
export const claimableFor = (...args) => answer('claimableFor', args);
export const prizeAlreadyClaimed = (...args) => answer('prizeAlreadyClaimed', args);
export const claimDeadlineSeconds = (...args) => answer('claimDeadlineSeconds', args);
export const prizeDelivery = (...args) => answer('prizeDelivery', args);
// 07/09/2026 decision — creator-without-wallet campaigns.
export const isModuleRegistered = (...args) => answer('isModuleRegistered', args);
export const modulePrizeKind = (...args) => answer('modulePrizeKind', args);
export const currentCreationFee = (...args) => answer('currentCreationFee', args);
export const slotPrice = (...args) => answer('slotPrice', args);
export const erc20Allowance = (...args) => answer('erc20Allowance', args);
export const erc20BalanceOf = (...args) => answer('erc20BalanceOf', args);
export const erc20Meta = (...args) => answer('erc20Meta', args);
export const quoteApprove = (...args) => answer('quoteApprove', args);
export const quoteCreateGiveaway = (...args) => answer('quoteCreateGiveaway', args);
// SPEC-BRIDGE-V2 §17 — campaign identity.
export const giveawayCreator = (...args) => answer('giveawayCreator', args);
export const isValidContractSignature = (...args) => answer('isValidContractSignature', args);

/** roleAddress is synchronous in the real module. */
export function roleAddress() {
  calls.push({ name: 'roleAddress', args: [] });
  return behaviour.roleAddress;
}

/** keeperAddress too. SPEC-BLOCO-03 M39 compares it with the other roles. */
export function keeperAddress() {
  calls.push({ name: 'keeperAddress', args: [] });
  return behaviour.keeperAddress ?? '0x000000000000000000000000000000000000beef';
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
