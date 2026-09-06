/**
 * The on-chain half of the bridge. H1 to H8, plus G4 and G6.
 *
 * H1 bounds what this module can sign. Six shapes, and no seventh:
 *
 *   1. a value transfer that funds a derived wallet,
 *   2. enter(),
 *   3. addEligibilityRoot(), under a different key and a different role,
 *   4. the sweep that brings the unspent remainder back to the pool,
 *   5. claimPrize(), as the derived wallet a settled campaign drew,
 *   6. handing that prize on to the address the winner confirmed (E2, E4).
 *
 * The last two are section 7 and are not optional additions: the contract pays
 * msg.sender and the Merkle leaf is keccak256(msg.sender), so the winner is the
 * derived wallet and only the derived wallet can collect. Delivery is a separate
 * transaction for the same reason — claimPrize has no recipient parameter.
 *
 * The contract address and every function name below are literals from config
 * and abi — never read from an environment variable, never taken from input. A
 * configurable contract address is a configurable place to send money. The token
 * and collection of a delivery are read from the chain, and the destination from
 * a row the participant confirmed under a session; neither reaches here from a
 * request.
 *
 * NO TRANSACTION CARRIES A CONSTANT GAS LIMIT. Every one of the six takes its
 * limit from eth_estimateGas and the margin in config. The 21_000 that used to be
 * written into the two value transfers was wrong on this chain as well as
 * against the rule: Arbitrum One answers eth_estimateGas with 21_299 for a
 * zero-value transfer and 21_305 with a value (measured 2026-09-06), because the
 * L1 data component is inside the number. Both transfers would have run out of
 * gas.
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
  type Hex,
  type TransactionSerializable,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ERC20_ABI,
  ERC721_ABI,
  ERC721_PRIZE_MODULE_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  GiveawayStatus,
  PrizeKind,
  VRF_COORDINATOR_V2_PLUS_ABI,
} from './abi.js';
import {
  CHAIN_ID,
  DEFAULT_RPC_URL,
  GAS_BANDS,
  GAS_MARGIN_DENOMINATOR,
  GAS_MARGIN_NUMERATOR,
  GIVEAWAY_MANAGER_V2,
  MAX_GAS_COST_WEI,
  RECEIPT_TIMEOUT_MS,
  RPC_TIMEOUT_MS,
  type GasBand,
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
  /** SETTLED is the only state in which a prize can be claimed (section 7). */
  readonly isSettled: boolean;
  readonly endTime: bigint;
  readonly prizeModule: `0x${string}`;
  readonly prizeKind: number;
  readonly prizeAmount: bigint;
  readonly declaredValue: bigint;
  readonly winnersCount: number;
  /** For a TOKEN campaign this is the prize token; for an NFT one it is USDC. */
  readonly feeToken: `0x${string}`;
  /** Start of the CLAIM_DEADLINE window. Zero until the campaign settles. */
  readonly settledAt: bigint;
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
    feeToken: `0x${string}`;
    settledAt: bigint;
  };

  return {
    status: Number(g.status),
    isOpen: Number(g.status) === GiveawayStatus.OPEN,
    isSettled: Number(g.status) === GiveawayStatus.SETTLED,
    endTime: g.endTime,
    prizeModule: g.prizeModule,
    prizeKind: Number(g.prizeKind),
    prizeAmount: g.prizeAmount,
    declaredValue: g.declaredValue,
    winnersCount: Number(g.winnersCount),
    feeToken: g.feeToken,
    settledAt: g.settledAt,
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

/**
 * H8: the LINK left in the VRF 2.5 subscription the contract draws from.
 *
 * The coordinator address and the subscription id are public immutables on
 * GiveawayManagerV2, so neither is configured here and neither can drift from
 * the deployment. Read only — the bridge holds no LINK and funds no subscription.
 *
 * A subscription with no LINK is the one failure this side cannot retry: the
 * draw is requested, the fulfilment never arrives, and the campaign sits in
 * DRAW_REQUESTED. That is why it is monitored rather than discovered.
 */
export async function vrfSubscriptionLink(): Promise<bigint> {
  const client = publicClient();
  const [coordinator, subscriptionId] = await Promise.all([
    client.readContract({
      address: GIVEAWAY_MANAGER_V2,
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'vrfCoordinator',
      args: [],
    }) as Promise<`0x${string}`>,
    client.readContract({
      address: GIVEAWAY_MANAGER_V2,
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'subscriptionId',
      args: [],
    }) as Promise<bigint>,
  ]);

  const subscription = (await client.readContract({
    address: coordinator,
    abi: VRF_COORDINATOR_V2_PLUS_ABI,
    functionName: 'getSubscription',
    args: [subscriptionId],
  })) as readonly [bigint, bigint, bigint, `0x${string}`, readonly `0x${string}`[]];

  // The first element is the LINK balance in juels; nativeBalance is the
  // second and is not what this subscription pays with (nativePayment: false).
  return subscription[0];
}

/** The address the bridge role key holds, so H8 can compare it with the contract. */
export function roleAddress(): `0x${string}` {
  // F6: the account is created, its address taken, and it is dropped here.
  return privateKeyToAccount(requireEnv('BRIDGE_V2_ROLE_KEY') as Hex).address;
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
 * The band is chosen by the caller because the plausible range for a bare value
 * transfer and for a call into the manager have no overlap worth sharing: one
 * pair of numbers wide enough for both would check nothing.
 *
 * H3: the worst case is computed and compared against an absolute ceiling. A
 * plan that would cost more than the ceiling fails here, before anything is
 * signed, and the entry is left for a later attempt rather than paid for at an
 * absurd price.
 */
export function planGas(
  estimatedGas: bigint,
  maxFeePerGas: bigint,
  priorityFee: bigint,
  band: GasBand,
): GasPlan {
  if (estimatedGas < band.min || estimatedGas > band.max) {
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
// The six signed actions
// -----------------------------------------------------------------------------

async function broadcast(signed: Hex): Promise<Hex> {
  return publicClient().sendRawTransaction({ serializedTransaction: signed });
}

/**
 * Prices one call, from one sender, against one band.
 *
 * Every signed call in this module goes through here, so there is one place that
 * asks the chain what a transaction costs and one place that refuses an answer
 * it does not believe. A caller cannot skip the estimate by supplying a number,
 * because there is no parameter through which it could.
 *
 * The sender matters and is never a convenience. enter() and claimPrize() revert
 * unless msg.sender is the address the contract drew, so estimating either from
 * a funder would be estimating a revert. Both are estimated from the derived
 * wallet, which holds nothing at that point; verified against Arbitrum One on
 * 2026-09-06, eth_estimateGas from a zero-balance sender is accepted as long as
 * no value is attached, and viem attaches none for a call.
 */
async function quoteCall(
  from: `0x${string}`,
  to: `0x${string}`,
  data: Hex,
  band: GasBand,
): Promise<GasPlan> {
  const client = publicClient();
  const [fees, estimate] = await Promise.all([
    currentFees(),
    client.estimateGas({ account: from, to, data }),
  ]);
  return planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas, band);
}

/**
 * Signs and broadcasts one call as a derived wallet.
 *
 * enter(), claimPrize() and the prize delivery are the same transaction shape
 * with different calldata, so they are the same function. The nonce is read from
 * the chain rather than held anywhere: a derived wallet is used by one entry at a
 * time, which is not true of a funder, and G6 is about the pool.
 */
export async function submitAsDerived(
  walletIndex: number,
  wallet: `0x${string}`,
  to: `0x${string}`,
  data: Hex,
  plan: GasPlan,
  signAsDerived: (index: number, tx: TransactionSerializable) => Promise<Hex>,
): Promise<Hex> {
  const nonce = await publicClient().getTransactionCount({ address: wallet });

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to,
    data,
    nonce,
    gas: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  };

  return broadcast(await signAsDerived(walletIndex, transaction));
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

  const plan = planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas, GAS_BANDS.MANAGER);

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
 * It is reported as spent through onNonceSpent as soon as the signed bytes are
 * handed to the RPC, so the caller records the advance whatever comes back.
 */
export async function fundDerivedWallet(
  lease: { index: number; address: `0x${string}`; nextNonce: number },
  destination: `0x${string}`,
  amountWei: bigint,
  signAsFunder: (index: number, tx: TransactionSerializable) => Promise<Hex>,
  onNonceSpent: (nextNonce: number) => void,
): Promise<Hex> {
  if (amountWei <= 0n || amountWei > MAX_GAS_COST_WEI) {
    throw new ChainError('funding_amount_out_of_band');
  }

  // Estimated, never assumed. A value transfer is 21_000 on a bare EVM and is
  // not 21_000 here: Arbitrum One folds the L1 data component into the number
  // and answers 21_305 for exactly this call (measured 2026-09-06), so the
  // constant that used to sit on this line was a limit below the intrinsic cost
  // of the transaction it was signing.
  //
  // Estimated WITH the value, so an RPC that refuses for insufficient funds says
  // so before a funder signs a transfer it cannot pay for.
  const [fees, estimate] = await Promise.all([
    currentFees(),
    publicClient().estimateGas({ account: lease.address, to: destination, value: amountWei }),
  ]);

  const plan = planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas, GAS_BANDS.TRANSFER);
  if (plan.worstCaseWei + amountWei > MAX_GAS_COST_WEI) {
    throw new ChainError('funding_cost_above_ceiling');
  }

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: destination,
    value: amountWei,
    nonce: lease.nextNonce,
    gas: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  };

  const signed = await signAsFunder(lease.index, transaction);

  // G6: the nonce is spent the moment the signed transaction leaves this
  // process, and what the RPC answers decides nothing. A network error, a
  // timeout, or a duplicate-transaction rejection all describe a transaction
  // that may already be in the mempool; returning the nonce to the pool in any
  // of those cases hands the next caller a nonce that will collide, and one of
  // the two transactions will be silently replaced.
  //
  // The callback rather than the return value because the return value only
  // exists on the path where the RPC answered.
  onNonceSpent(lease.nextNonce + 1);

  // Only the hash comes back. The nonce left through the callback above and
  // returning it here as well would be a second source of truth for it, which
  // is how a caller ends up reading the one that was not updated.
  return broadcast(signed);
}

/**
 * What one entry needs in the derived wallet, worst case.
 *
 * Computed rather than guessed, and capped by H3. The margin is the same one the
 * gas plan applies, so the wallet is funded for the plan that will actually be
 * signed rather than for a cheaper one that no longer applies by the time it
 * runs.
 */
/**
 * Estimated from the derived wallet, which holds nothing at this point.
 *
 * Verified against Arbitrum One on 2026-09-06 rather than assumed. eth_estimateGas
 * with `from` set to an address of zero balance and no value field is accepted
 * and returns an estimate; the balance check only fires once `value` is greater
 * than zero, and viem sends no value and no gas price for this call. Estimating
 * from a funder instead would measure the wrong sender: enter() reverts unless
 * msg.sender is the eligible address, so a funder-side estimate would be an
 * estimate of a revert.
 */
export async function quoteEntryCost(
  giveawayId: bigint,
  wallet: `0x${string}`,
  rootIndex: bigint,
  proof: readonly Hex[],
): Promise<{ plan: GasPlan; data: Hex }> {
  const data = encodeFunctionData({
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'enter',
    args: [giveawayId, rootIndex, proof as Hex[]],
  });

  return { plan: await quoteCall(wallet, GIVEAWAY_MANAGER_V2, data, GAS_BANDS.MANAGER), data };
}

/**
 * H7: recovers what an entry did not spend.
 *
 * Every entry funds the wallet with a margin, and the margin stays there. The V1
 * had no mechanism at all, so the unspent remainder of every entry ever made was
 * stranded across as many addresses as there were participants.
 *
 * The threshold is the cost of this very transaction, computed here and now, and
 * is no longer a constant. A fixed floor is a guess about a gas price, and a
 * guess about a gas price is wrong in both directions: too high and real value
 * is abandoned in a wallet nobody will open again, too low and the pool pays
 * more to recover the remainder than the remainder is worth. What decides
 * whether a sweep is worth making is whether it recovers more than it costs, and
 * that is a number the chain has and this side does not.
 *
 * Estimated with no value attached, because the value is what the estimate is
 * needed to compute. A transfer's gas follows the bytes, not the amount.
 *
 * Returns null when there is nothing worth recovering.
 */
export async function sweepRemainder(
  walletIndex: number,
  wallet: `0x${string}`,
  destination: `0x${string}`,
  signAsDerived: (index: number, tx: TransactionSerializable) => Promise<Hex>,
): Promise<Hex | null> {
  const client = publicClient();
  const [balance, fees, nonce, estimate] = await Promise.all([
    client.getBalance({ address: wallet }),
    currentFees(),
    client.getTransactionCount({ address: wallet }),
    client.estimateGas({ account: wallet, to: destination }),
  ]);

  const plan = planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas, GAS_BANDS.TRANSFER);
  const cost = plan.worstCaseWei;
  if (balance <= cost) return null;

  const value = balance - cost;
  // The threshold, in runtime terms: a sweep that recovers less than it costs
  // loses money for the pool it exists to refill.
  if (value < cost) return null;

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: destination,
    value,
    nonce,
    gas: plan.gasLimit,
    maxFeePerGas: plan.maxFeePerGas,
    maxPriorityFeePerGas: plan.maxPriorityFeePerGas,
  };

  return broadcast(await signAsDerived(walletIndex, transaction));
}

// -----------------------------------------------------------------------------
// Prizes — section 7, E1 to E4
// -----------------------------------------------------------------------------

/**
 * What a settled campaign owes this wallet, right now.
 *
 * Zero covers every case that is not a live claim: the campaign has not settled,
 * the wallet was not drawn, or the prize has already been taken. The bridge does
 * not need to tell them apart — all three mean there is nothing to do.
 */
export async function claimableFor(
  giveawayId: bigint,
  wallet: `0x${string}`,
): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'claimable',
    args: [giveawayId, wallet],
  })) as bigint;
}

/**
 * Whether this wallet has already taken its prize.
 *
 * Needed because claimable() answers zero for two very different situations —
 * never a winner, and a winner who has been paid — and the difference decides
 * whether the bridge should be looking for a prize in the derived wallet. A
 * claim broadcast by a run that died before its receipt arrived is invisible
 * from this side and identical to a claim that never happened, except here.
 */
export async function prizeAlreadyClaimed(
  giveawayId: bigint,
  wallet: `0x${string}`,
): Promise<boolean> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'prizeClaimed',
    args: [giveawayId, wallet],
  })) as boolean;
}

/**
 * The contract's own claim window, in seconds, read rather than copied.
 *
 * CLAIM_DEADLINE is ninety days in the deployed bytecode. Reading it means the
 * bridge cannot hold a stale copy of a number that decides whether a winner
 * still has a prize, and E3's thirty-day custody is measured against a window
 * this side did not invent.
 */
export async function claimDeadlineSeconds(): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'CLAIM_DEADLINE',
    args: [],
  })) as bigint;
}

/**
 * Prices claimPrize() for one derived wallet.
 *
 * Estimated from that wallet and no other. claimable() is read inside
 * claimPrize, and the whole call reverts with NothingToClaim unless msg.sender
 * is the address the contract drew — so an estimate from anywhere else measures
 * a revert, not a claim.
 */
export async function quoteClaim(
  giveawayId: bigint,
  wallet: `0x${string}`,
): Promise<{ plan: GasPlan; data: Hex }> {
  const data = encodeFunctionData({
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'claimPrize',
    args: [giveawayId],
  });

  return { plan: await quoteCall(wallet, GIVEAWAY_MANAGER_V2, data, GAS_BANDS.MANAGER), data };
}

/** The call that hands a prize on to the address the winner confirmed. */
export interface PrizeDelivery {
  /** The prize token, or the collection. Read from the chain, never configured. */
  readonly to: `0x${string}`;
  readonly data: Hex;
  /** For the ops record: base units for a token, the item id for an NFT. */
  readonly amount: bigint;
}

/**
 * Builds the delivery that empties the derived wallet of the prize.
 *
 * E2 decides whether there is a destination at all; this decides what the
 * transaction has to be once there is one. Two shapes, because there are two
 * prize kinds, and both take their subject from the chain:
 *
 * TOKEN — the prize token is getGiveaway().feeToken, which the core bound at
 * creation. The amount is the balance the derived wallet actually holds rather
 * than the amount that was claimable, so a delivery retried after a failed
 * broadcast moves what is there instead of what was expected to be there.
 *
 * NFT — the core stores the winner's position, the module stores the items, and
 * section 8.3 pairs them: the n-th winner is owed the n-th deposited item. Both
 * reads come from addresses the core already published (prizeModule) so nothing
 * here is configurable.
 *
 * Returns null when the wallet holds nothing to deliver, which is what a second
 * pass over an already-delivered prize looks like.
 */
export async function prizeDelivery(
  campaign: GiveawayView,
  giveawayId: bigint,
  wallet: `0x${string}`,
  destination: `0x${string}`,
): Promise<PrizeDelivery | null> {
  const client = publicClient();

  if (campaign.prizeKind === PrizeKind.NFT) {
    const [slot, items, custody] = await Promise.all([
      client.readContract({
        address: GIVEAWAY_MANAGER_V2,
        abi: GIVEAWAY_MANAGER_V2_ABI,
        functionName: 'winnerIndex',
        args: [giveawayId, wallet],
      }) as Promise<bigint>,
      client.readContract({
        address: campaign.prizeModule,
        abi: ERC721_PRIZE_MODULE_ABI,
        functionName: 'itemsOf',
        args: [giveawayId],
      }) as Promise<readonly bigint[]>,
      client.readContract({
        address: campaign.prizeModule,
        abi: ERC721_PRIZE_MODULE_ABI,
        functionName: 'custodyOf',
        args: [giveawayId],
      }) as Promise<readonly [`0x${string}`, bigint]>,
    ]);

    const tokenId = items[Number(slot)];
    const collection = custody[0];
    if (tokenId === undefined) return null;

    // The module keeps its item list after delivering, so unlike a token balance
    // the list alone cannot say whether the item has already gone. The owner
    // can. Without this a delivery whose receipt was never seen would be retried
    // for ever against a token the wallet no longer holds, and every retry is a
    // revert the estimate refuses before it costs anything — but also a prize
    // that is never marked delivered.
    const owner = (await client.readContract({
      address: collection,
      abi: ERC721_ABI,
      functionName: 'ownerOf',
      args: [tokenId],
    })) as `0x${string}`;
    if (owner.toLowerCase() !== wallet.toLowerCase()) return null;

    return {
      to: collection,
      amount: tokenId,
      data: encodeFunctionData({
        abi: ERC721_ABI,
        functionName: 'safeTransferFrom',
        args: [wallet, destination, tokenId],
      }),
    };
  }

  const balance = (await client.readContract({
    address: campaign.feeToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [wallet],
  })) as bigint;
  if (balance <= 0n) return null;

  return {
    to: campaign.feeToken,
    amount: balance,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [destination, balance],
    }),
  };
}

/** Prices a delivery from the wallet that holds the prize. */
export async function quoteDelivery(
  wallet: `0x${string}`,
  delivery: PrizeDelivery,
): Promise<GasPlan> {
  return quoteCall(wallet, delivery.to, delivery.data, GAS_BANDS.DELIVERY);
}
