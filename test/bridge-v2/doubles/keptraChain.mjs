/**
 * The double of lib/bridge-v2/keptraChain.ts, for the suites that run under the
 * loader. The on-chain behaviour of the real module is exercised against real
 * contracts in the fork suite (test/bridge-v2/fork); here only what the relay,
 * the recovery pass and the routes DO with its answers is under test.
 *
 * The pure half is re-exported from the real module, as chain.mjs does, so the
 * configuration check (R-4) and the call encoders are the code under test.
 */

import {
  FALLBACK_HANDLER_SLOT,
  configurationRefusal,
  confirmRecoveryCall,
  finalizeRecoveryCall,
  relayerCall,
} from '../../../lib/bridge-v2/keptraChain.ts';

export { FALLBACK_HANDLER_SLOT, configurationRefusal, confirmRecoveryCall, finalizeRecoveryCall, relayerCall };

export const calls = [];

const EMPTY_STATE = {
  deployed: false,
  nonce: 0n,
  owners: [],
  threshold: 0n,
  modules: [],
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guardians: [],
  guardianThreshold: 0n,
  recoveryExecuteAfter: 0n,
  recoveryNewOwners: [],
};

const DEFAULTS = () => ({
  signerAddressOf: '0x5151515151515151515151515151515151515151',
  hasCode: false,
  isValidPasskeySignature: false,
  accountState: EMPTY_STATE,
  recoveryHash: `0x${'ab'.repeat(32)}`,
  chainNow: BigInt(Math.floor(Date.now() / 1000)),
  sendRelayed: `0x${'cd'.repeat(32)}`,
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

export const signerAddressOf = (...args) => answer('signerAddressOf', args);
export const hasCode = (...args) => answer('hasCode', args);
export const isValidPasskeySignature = (...args) => answer('isValidPasskeySignature', args);
export const accountState = (...args) => answer('accountState', args);
export const recoveryHash = (...args) => answer('recoveryHash', args);
export const chainNow = (...args) => answer('chainNow', args);

/** The real signature, including the nonce callback: what the relay does with it is G6. */
export async function sendRelayed(lease, call, signAsFunder, onNonceSpent) {
  calls.push({ name: 'sendRelayed', args: [lease, call] });
  const value = behaviour.sendRelayed;
  const resolved = typeof value === 'function' ? await value(lease, call) : value;
  if (resolved instanceof Error) throw resolved;
  onNonceSpent(lease.nextNonce + 1);
  return resolved;
}
