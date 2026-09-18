/**
 * Keptra accounts, the on-chain half. SPEC-BLOCO-03 section 6.
 *
 * Reads of an account and of its recovery module, the on-chain check of a
 * passkey signature, and the one transaction shape the relayer signs: a call it
 * pays for and that authorises nothing by itself (6.1.5, section 5). Every
 * transaction here is either permissionless (createSigner, createProxyWithNonce,
 * finalizeRecovery, multiConfirmRecovery with a guardian signature) or carries a
 * passkey signature the account checks itself (execTransaction).
 *
 * The relayer is the funder pool (A15): the same lease, the same nonce
 * accounting (G6) and the same gas ceiling (H3/H4) as every other transaction
 * the bridge pays for.
 */

import { encodeFunctionData, keccak256, toHex, type Hex, type TransactionSerializable } from 'viem';
import { ChainError, planGas, publicClient } from './chain.js';
import { CHAIN_ID, GAS_BANDS } from './config.js';
import {
  FALLBACK_HANDLER,
  MULTI_SEND_CALL_ONLY,
  RECOVERY_MODULE,
  RECOVERY_MODULE_ABI,
  SAFE_ABI,
  SENTINEL,
  SIGNER_FACTORY,
  SIGNER_FACTORY_ABI,
  VERIFIERS,
  encodeMultiSend,
  encodeWebAuthnSignature,
  type SafeCall,
  type WebAuthnSignature,
} from './keptra.js';

/** The four bytes a Safe signer returns for a signature it accepts (ERC-1271). */
const ERC1271_MAGIC = '0x1626ba7e';

/** FallbackManager's storage slot, derived rather than written as a 32-byte literal. */
export const FALLBACK_HANDLER_SLOT = BigInt(keccak256(toHex('fallback_manager.handler.address')));

/** The passkey signer a public key produces. A view on the factory; nothing is deployed. */
export async function signerAddressOf(x: bigint, y: bigint): Promise<`0x${string}`> {
  return (await publicClient().readContract({
    address: SIGNER_FACTORY,
    abi: SIGNER_FACTORY_ABI,
    functionName: 'getSigner',
    args: [x, y, VERIFIERS],
  })) as `0x${string}`;
}

export async function hasCode(address: `0x${string}`): Promise<boolean> {
  const code = await publicClient().getCode({ address });
  return code !== undefined && code !== '0x';
}

/**
 * M10: whether the passkey (x, y) signed `challenge`, asked of the factory,
 * which runs the very code the account will run. Nothing has to be deployed.
 */
export async function isValidPasskeySignature(
  challenge: Hex,
  signature: WebAuthnSignature,
  x: bigint,
  y: bigint,
): Promise<boolean> {
  try {
    const answer = await publicClient().readContract({
      address: SIGNER_FACTORY,
      abi: SIGNER_FACTORY_ABI,
      functionName: 'isValidSignatureForSigner',
      args: [challenge, encodeWebAuthnSignature(signature), x, y, VERIFIERS],
    });
    return String(answer).toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
}

/** Everything about an account the relay and the guardian decide on. */
export interface AccountState {
  readonly deployed: boolean;
  readonly nonce: bigint;
  readonly owners: readonly `0x${string}`[];
  readonly threshold: bigint;
  readonly modules: readonly `0x${string}`[];
  readonly fallbackHandler: `0x${string}`;
  readonly guardians: readonly `0x${string}`[];
  readonly guardianThreshold: bigint;
  /** Zero when no recovery is pending. Seconds, the chain's clock. */
  readonly recoveryExecuteAfter: bigint;
  readonly recoveryNewOwners: readonly `0x${string}`[];
}

const address = (word: Hex): `0x${string}` => `0x${word.slice(-40)}` as `0x${string}`;

/** One read per field, concurrently; an account that does not exist yet reads as empty. */
export async function accountState(safe: `0x${string}`): Promise<AccountState> {
  const client = publicClient();
  if (!(await hasCode(safe))) {
    return {
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
  }
  const [nonce, owners, threshold, modules, handlerWord, guardians, guardianThreshold, request] = await Promise.all([
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'nonce' }),
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'getOwners' }),
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'getThreshold' }),
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'getModulesPaginated', args: [SENTINEL, 10n] }),
    client.readContract({ address: safe, abi: SAFE_ABI, functionName: 'getStorageAt', args: [FALLBACK_HANDLER_SLOT, 1n] }),
    client.readContract({ address: RECOVERY_MODULE, abi: RECOVERY_MODULE_ABI, functionName: 'getGuardians', args: [safe] }),
    client.readContract({ address: RECOVERY_MODULE, abi: RECOVERY_MODULE_ABI, functionName: 'threshold', args: [safe] }),
    client.readContract({ address: RECOVERY_MODULE, abi: RECOVERY_MODULE_ABI, functionName: 'getRecoveryRequest', args: [safe] }),
  ]);

  return {
    deployed: true,
    nonce,
    owners,
    threshold,
    modules: modules[0],
    fallbackHandler: address(handlerWord),
    guardians,
    guardianThreshold,
    recoveryExecuteAfter: BigInt(request.executeAfter),
    recoveryNewOwners: request.newOwners,
  };
}

/**
 * 6.1 checked on the account as it exists, not as it was asked to be built.
 * Returns the first thing that is wrong, or null.
 *
 * R-4 is the reason this exists at all: the module must never be the fallback
 * handler, and this is run on every account right after it is created (A2 says
 * what the handler must be instead).
 */
export function configurationRefusal(
  state: AccountState,
  guardian: `0x${string}`,
  owners: readonly `0x${string}`[],
): string | null {
  const lower = (list: readonly string[]) => list.map((item) => item.toLowerCase()).sort();
  if (!state.deployed) return 'not_deployed';
  if (state.fallbackHandler.toLowerCase() === RECOVERY_MODULE.toLowerCase()) return 'module_is_fallback_handler';
  if (state.fallbackHandler.toLowerCase() !== FALLBACK_HANDLER.toLowerCase()) return 'fallback_handler';
  if (JSON.stringify(lower(state.modules)) !== JSON.stringify(lower([RECOVERY_MODULE]))) return 'modules';
  if (JSON.stringify(lower(state.guardians)) !== JSON.stringify(lower([guardian]))) return 'guardians';
  if (state.guardianThreshold !== 1n) return 'guardian_threshold';
  if (state.threshold !== 1n) return 'threshold';
  if (JSON.stringify(lower(state.owners)) !== JSON.stringify(lower(owners))) return 'owners';
  return null;
}

/** The hash the guardian signs for (safe, newOwners, threshold 1), at the module's current nonce. */
export async function recoveryHash(safe: `0x${string}`, newOwners: readonly `0x${string}`[]): Promise<Hex> {
  const client = publicClient();
  const nonce = (await client.readContract({
    address: RECOVERY_MODULE,
    abi: RECOVERY_MODULE_ABI,
    functionName: 'nonce',
    args: [safe],
  })) as bigint;
  return (await client.readContract({
    address: RECOVERY_MODULE,
    abi: RECOVERY_MODULE_ABI,
    functionName: 'getRecoveryHash',
    args: [safe, [...newOwners], 1n, nonce],
  })) as Hex;
}

/** multiConfirmRecovery with the one guardian signature, executed at once (the 7 days start). */
export function confirmRecoveryCall(
  safe: `0x${string}`,
  newOwners: readonly `0x${string}`[],
  guardian: `0x${string}`,
  signature: Hex,
): SafeCall {
  return {
    to: RECOVERY_MODULE,
    data: encodeFunctionData({
      abi: RECOVERY_MODULE_ABI,
      functionName: 'multiConfirmRecovery',
      args: [safe, [...newOwners], 1n, [{ signer: guardian, signature }], true],
    }),
  };
}

/** R-6: anyone may finalise once the period is over; the relayer does. */
export function finalizeRecoveryCall(safe: `0x${string}`): SafeCall {
  return {
    to: RECOVERY_MODULE,
    data: encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'finalizeRecovery', args: [safe] }),
  };
}

/**
 * What the relayer sends for a list of calls: the call itself, or MultiSendCallOnly
 * called directly — not by delegatecall — so each call keeps its own target and
 * the batch is atomic. Used for creating an account in the same transaction as its
 * first operation.
 */
export function relayerCall(calls: readonly SafeCall[]): SafeCall {
  if (calls.length === 1) return calls[0];
  return { to: MULTI_SEND_CALL_ONLY, data: encodeMultiSend(calls) };
}

/** The block's timestamp, which is the clock the module compares against. */
export async function chainNow(): Promise<bigint> {
  return (await publicClient().getBlock({ blockTag: 'latest' })).timestamp;
}

/**
 * Signs and broadcasts one relayed call from a funder lease.
 *
 * The same shape as fundDerivedWallet, deliberately: priced by eth_estimateGas
 * against a band and an absolute ceiling (H3/H4), the nonce from the lease
 * (G6) and reported spent the moment the signed bytes leave the process. The
 * estimate is also the first line of defence: a call the account would refuse
 * — a signature over another hash (GS024), a signer that is not an owner
 * (GS026) — reverts here and nothing is sent.
 */
export async function sendRelayed(
  lease: { index: number; address: `0x${string}`; nextNonce: number },
  call: SafeCall,
  signAsFunder: (index: number, tx: TransactionSerializable) => Promise<Hex>,
  onNonceSpent: (nextNonce: number) => void,
): Promise<Hex> {
  const client = publicClient();
  const [fees, estimate] = await Promise.all([
    client.estimateFeesPerGas(),
    client.estimateGas({ account: lease.address, to: call.to, data: call.data }),
  ]);
  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  if (maxFeePerGas <= 0n) throw new ChainError('fee_estimate_unusable');
  const plan = planGas(estimate, maxFeePerGas, fees.maxPriorityFeePerGas ?? 0n, GAS_BANDS.ACCOUNT);

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: call.to,
    data: call.data,
    nonce: lease.nextNonce,
    gas: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  };
  const signed = await signAsFunder(lease.index, transaction);
  onNonceSpent(lease.nextNonce + 1);
  return client.sendRawTransaction({ serializedTransaction: signed });
}
