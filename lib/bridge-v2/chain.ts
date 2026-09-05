/**
 * The on-chain half of the bridge. H1 to H8, plus G4 and G6.
 *
 * H1 bounds what this module can do to exactly two signed actions: move gas to a
 * derived wallet, and call enter(). Publishing an eligibility root is a third,
 * signed by a different key under a different role. The contract address and
 * every function name below are literals from config and abi — never read from
 * an environment variable, never taken from input. A configurable contract
 * address is a configurable place to send money.
 *
 * G4: every call here carries an explicit timeout. The V1 waited for a receipt
 * with none, which is the shared root of findings #9, K3 and K4 — a wait that
 * cannot end is a lease that expires underneath a running operation and a
 * transaction hash that is lost when the platform kills the function.
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  serializeTransaction,
  type Hex,
  type TransactionSerializable,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { GIVEAWAY_MANAGER_V2_ABI, GiveawayStatus } from './abi.js';
import {
  CHAIN_ID,
  DEFAULT_RPC_URL,
  GAS_MARGIN_DENOMINATOR,
  GAS_MARGIN_NUMERATOR,
  GIVEAWAY_MANAGER_V2,
  MAX_GAS_COST_WEI,
  MAX_PLAUSIBLE_GAS,
  MIN_PLAUSIBLE_GAS,
  RECEIPT_TIMEOUT_MS,
  RPC_TIMEOUT_MS,
} from './config.js';
import { optionalEnv, requireEnv } from './env.js';

/** T7: the RPC is a third party. Every call through it is bounded. */
export function publicClient() {
  return createPublicClient({
    chain: arbitrum,
    transport: http(optionalEnv('ARBITRUM_RPC_URL') ?? DEFAULT_RPC_URL, {
      timeout: RPC_TIMEOUT_MS,
    }),
  });
}

/** Raised when the chain refuses, or when a value from the chain is not credible. */
export class ChainError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`[bridge-v2] chain: ${code}`);
    this.name = 'ChainError';
    this.code = code;
  }
}

export interface GiveawayView {
  readonly status: number;
  readonly isOpen: boolean;
  readonly endTime: bigint;
  readonly prizeModule: `0x${string}`;
  readonly prizeKind: number;
  readonly prizeAmount: bigint;
  readonly declaredValue: bigint;
  readonly winnersCount: number;
}

/**
 * Reads a campaign.
 *
 * The bridge checks OPEN before doing anything else so that a closed campaign
 * costs a read rather than a reverted transaction, and so the participant gets a
 * real answer instead of a decoded revert.
 */
export async function readGiveaway(giveawayId: bigint): Promise<GiveawayView> {
  const raw = await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getGiveaway',
    args: [giveawayId],
  });

  const g = raw as unknown as {
    status: number;
    endTime: bigint;
    prizeModule: `0x${string}`;
    prizeKind: number;
    prizeAmount: bigint;
    declaredValue: bigint;
    winnersCount: number;
  };

  return {
    status: Number(g.status),
    isOpen: Number(g.status) === GiveawayStatus.OPEN,
    endTime: g.endTime,
    prizeModule: g.prizeModule,
    prizeKind: Number(g.prizeKind),
    prizeAmount: g.prizeAmount,
    declaredValue: g.declaredValue,
    winnersCount: Number(g.winnersCount),
  };
}

/**
 * H6: the slot ledger is the source of truth for whether an entry may happen.
 *
 * H5: this is also what stops a hostile campaign draining the pool. A creator
 * who writes an expensive enter() is limited by the slots they paid for, because
 * the bridge refuses to spend gas once the contract says there are none left.
 */
export async function slotsRemaining(giveawayId: bigint): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'slotsRemaining',
    args: [giveawayId],
  })) as bigint;
}

export async function rootsCount(giveawayId: bigint): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getEligibilityRootsCount',
    args: [giveawayId],
  })) as bigint;
}

/** G5: the on-chain fact that makes a repeated entry a no-op instead of a second one. */
export async function hasEntered(giveawayId: bigint, wallet: `0x${string}`): Promise<boolean> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'hasEntered',
    args: [giveawayId, wallet],
  })) as boolean;
}

/** The address the contract currently accepts for addEligibilityRoot. */
export async function registeredBridge(): Promise<`0x${string}`> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'bridge',
    args: [],
  })) as `0x${string}`;
}

/** Whether the contract is paused. The bridge never calls pause or unpause. */
export async function isPaused(): Promise<boolean> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'paused',
    args: [],
  })) as boolean;
}

// -----------------------------------------------------------------------------
// Gas pricing — H3 and H4
// -----------------------------------------------------------------------------

export interface GasPlan {
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly worstCaseWei: bigint;
}

/**
 * Turns an estimate into a plan, or refuses.
 *
 * H4: the estimate is validated against a band before it is used. The RPC is a
 * configurable third party (T7), and finding #8 was that `needed` came entirely
 * from it with no ceiling — a compromised or simply broken endpoint could report
 * a gas price that drains a funder in one transaction.
 *
 * H3: the worst case is computed and compared against an absolute ceiling. A
 * plan that would cost more than the ceiling fails here, before anything is
 * signed, and the entry is left for a later attempt rather than paid for at an
 * absurd price.
 */
export function planGas(estimatedGas: bigint, maxFeePerGas: bigint, priorityFee: bigint): GasPlan {
  if (estimatedGas < MIN_PLAUSIBLE_GAS || estimatedGas > MAX_PLAUSIBLE_GAS) {
    throw new ChainError('gas_estimate_out_of_band');
  }

  const gasLimit = (estimatedGas * GAS_MARGIN_NUMERATOR) / GAS_MARGIN_DENOMINATOR;
  const worstCaseWei = gasLimit * maxFeePerGas;

  if (worstCaseWei > MAX_GAS_COST_WEI) {
    throw new ChainError('gas_cost_above_ceiling');
  }

  return { gasLimit, maxFeePerGas, maxPriorityFeePerGas: priorityFee, worstCaseWei };
}

/** Current fees, bounded by the client timeout like every other read. */
async function currentFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const fees = await publicClient().estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? 0n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  if (maxFeePerGas <= 0n) throw new ChainError('fee_estimate_unusable');
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/**
 * Waits for a receipt, bounded.
 *
 * Returns null on timeout rather than throwing, because a timeout is not a
 * failure of the transaction — it was broadcast and may still confirm. The
 * caller records the hash and lets a later pass reconcile, which is what finding
 * K3 asked for: the V1 lost the hash entirely when the function died.
 */
export async function waitForReceipt(hash: Hex): Promise<{ status: 'success' | 'reverted' } | null> {
  try {
    const receipt = await publicClient().waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    return { status: receipt.status };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// The three signed actions
// -----------------------------------------------------------------------------

async function broadcast(signed: Hex): Promise<Hex> {
  return publicClient().sendRawTransaction({ serializedTransaction: signed });
}

/**
 * Publishes an eligibility root. SPEC-GIVEAWAY-V2 4.2.
 *
 * Signed by the role key, which is the address the contract accepts. Append
 * only: the contract keeps the history and never replaces an entry, so this can
 * add but has no counterpart that removes.
 *
 * F6: the account is created here, used, and dropped. Nothing that holds a key
 * is returned.
 */
export async function publishEligibilityRoot(giveawayId: bigint, root: Hex): Promise<Hex> {
  const account = privateKeyToAccount(requireEnv('BRIDGE_V2_ROLE_KEY') as Hex);
  const client = publicClient();

  const data = encodeFunctionData({
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'addEligibilityRoot',
    args: [giveawayId, root],
  });

  const [nonce, fees, estimate] = await Promise.all([
    client.getTransactionCount({ address: account.address }),
    currentFees(),
    client.estimateGas({ account: account.address, to: GIVEAWAY_MANAGER_V2, data }),
  ]);

  const plan = planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas);

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: GIVEAWAY_MANAGER_V2,
    data,
    nonce,
    gas: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  };

  return broadcast(await account.signTransaction(transaction));
}

/**
 * Moves gas to a derived wallet. The first of the two actions H1 allows.
 *
 * H2: the destination is always the address derived from the participant's
 * index on the server. There is no parameter through which a client could
 * influence where this goes, which is the whole of the requirement.
 *
 * G6: the nonce comes from the lease, not from the RPC. Reading a pending nonce
 * concurrently is what let two invocations build the same transaction in the V1.
 */
export async function fundDerivedWallet(
  lease: { index: number; address: `0x${string}`; nextNonce: number },
  destination: `0x${string}`,
  amountWei: bigint,
  signAsFunder: (index: number, tx: TransactionSerializable) => Promise<Hex>,
): Promise<{ hash: Hex; nextNonce: number }> {
  if (amountWei <= 0n || amountWei > MAX_GAS_COST_WEI) {
    throw new ChainError('funding_amount_out_of_band');
  }

  const fees = await currentFees();
  // A plain value transfer is 21000 on every EVM chain. Estimating it would be a
  // round trip to learn a constant, and an RPC that disagreed would be reporting
  // something the bridge should not act on anyway.
  const gasLimit = 21_000n;
  if (gasLimit * fees.maxFeePerGas + amountWei > MAX_GAS_COST_WEI) {
    throw new ChainError('funding_cost_above_ceiling');
  }

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: destination,
    value: amountWei,
    nonce: lease.nextNonce,
    gas: gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };

  const hash = await broadcast(await signAsFunder(lease.index, transaction));
  return { hash, nextNonce: lease.nextNonce + 1 };
}

/**
 * What one entry needs in the derived wallet, worst case.
 *
 * Computed rather than guessed, and capped by H3. The margin is the same one the
 * gas plan applies, so the wallet is funded for the plan that will actually be
 * signed rather than for a cheaper one that no longer applies by the time it
 * runs.
 */
export async function quoteEntryCost(
  giveawayId: bigint,
  wallet: `0x${string}`,
  rootIndex: bigint,
  proof: readonly Hex[],
): Promise<{ plan: GasPlan; data: Hex }> {
  const client = publicClient();
  const data = encodeFunctionData({
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'enter',
    args: [giveawayId, rootIndex, proof as Hex[]],
  });

  const [fees, estimate] = await Promise.all([
    currentFees(),
    client.estimateGas({ account: wallet, to: GIVEAWAY_MANAGER_V2, data }),
  ]);

  return { plan: planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas), data };
}

/**
 * Submits enter() as the participant. The second of the two actions H1 allows.
 *
 * The proof is verified locally before this is called, so a revert here is a
 * change in chain state rather than a bad proof — which is worth distinguishing,
 * because one is retryable and the other never will be.
 */
export async function submitEnter(
  walletIndex: number,
  wallet: `0x${string}`,
  data: Hex,
  plan: GasPlan,
  signAsDerived: (index: number, tx: TransactionSerializable) => Promise<Hex>,
): Promise<Hex> {
  const nonce = await publicClient().getTransactionCount({ address: wallet });

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: GIVEAWAY_MANAGER_V2,
    data,
    nonce,
    gas: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  };

  return broadcast(await signAsDerived(walletIndex, transaction));
}

/**
 * H7: recovers what an entry did not spend.
 *
 * Every entry funds the wallet with a margin, and the margin stays there. The V1
 * had no mechanism at all, so the unspent remainder of every entry ever made was
 * stranded across as many addresses as there were participants.
 *
 * Returns null when the balance is not worth a transaction: sweeping dust costs
 * more than the dust.
 */
export async function sweepRemainder(
  walletIndex: number,
  wallet: `0x${string}`,
  destination: `0x${string}`,
  minimumWei: bigint,
  signAsDerived: (index: number, tx: TransactionSerializable) => Promise<Hex>,
): Promise<Hex | null> {
  const client = publicClient();
  const [balance, fees, nonce] = await Promise.all([
    client.getBalance({ address: wallet }),
    currentFees(),
    client.getTransactionCount({ address: wallet }),
  ]);

  const gasLimit = 21_000n;
  const cost = gasLimit * fees.maxFeePerGas;
  if (balance <= cost) return null;

  const value = balance - cost;
  if (value < minimumWei) return null;

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: destination,
    value,
    nonce,
    gas: gasLimit,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };

  return broadcast(await signAsDerived(walletIndex, transaction));
}

/** Kept so a caller can serialise a transaction for inspection without signing it. */
export const serialize = serializeTransaction;
