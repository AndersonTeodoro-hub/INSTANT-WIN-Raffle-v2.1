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
  encodeAbiParameters,
  encodeFunctionData,
  http,
  parseEventLogs,
  TransactionNotFoundError,
  type Hex,
  type Log,
  type TransactionSerializable,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CREATOR_APPROVAL_ABI,
  CREATOR_CAMPAIGN_MANAGER_ABI,
  ERC1155_ABI,
  ERC1155_PRIZE_MODULE_ABI,
  ERC1155_RECEIVER_INTERFACE_ID,
  ERC20_ABI,
  ERC721_ABI,
  ERC721_PRIZE_MODULE_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  GiveawayStatus,
  PRIZE_MODULE_KIND_ABI,
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
  /**
   * When entries really close, pause time included (contract C5).
   *
   * Not the same as endTime and not derivable from it on this side: the core
   * adds the platform's accrued pause time to every campaign's end, and a pause
   * in force keeps adding to it while it lasts. Read from the contract for the
   * same reason CLAIM_DEADLINE is — a local copy of a number that decides
   * whether a transaction reverts is a copy that will one day be wrong.
   */
  readonly effectiveEndTime: bigint;
  /**
   * Whether enter() would be accepted right now.
   *
   * OPEN alone was never the condition. GiveawayManagerV2.enter (line 705)
   * checks the status AND `block.timestamp >= effectiveEndTime` (line 709), and
   * a campaign stays OPEN past its end until somebody calls closeGiveaway — a
   * permissionless call that may not happen for hours. Every entry funded in
   * that gap was gas paid for a transaction that reverts with EntriesClosed.
   */
  readonly acceptsEntries: boolean;
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
  const client = publicClient();
  // Two reads rather than one because the second is not a field of the first.
  // effectiveEndTime folds in the platform's accrued pause time, which lives on
  // the contract and not on the campaign, so no arithmetic over getGiveaway
  // produces it.
  const [raw, effectiveEnd] = await Promise.all([
    client.readContract({
      address: GIVEAWAY_MANAGER_V2,
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'getGiveaway',
      args: [giveawayId],
    }),
    client.readContract({
      address: GIVEAWAY_MANAGER_V2,
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'effectiveEndTime',
      args: [giveawayId],
    }) as Promise<bigint>,
  ]);

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

  const isOpen = Number(g.status) === GiveawayStatus.OPEN;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  return {
    status: Number(g.status),
    isOpen,
    isSettled: Number(g.status) === GiveawayStatus.SETTLED,
    endTime: g.endTime,
    effectiveEndTime: effectiveEnd,
    // The contract's own comparison, in the contract's own direction: enter()
    // reverts when block.timestamp >= effectiveEndTime, so this is strictly
    // less. The clock is this side's rather than the chain's, which can differ
    // by a block; that is why the estimate still runs before any gas moves.
    acceptsEntries: isOpen && nowSeconds < effectiveEnd,
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

/** What a mined transaction tells this side: how it ended, and what it emitted. */
export interface MinedReceipt {
  readonly status: 'success' | 'reverted';
  /**
   * The logs of the transaction, as the node returned them.
   *
   * Here so a caller can read a value the contract assigned rather than guess it.
   * rootIndexFromLogs below is the only reader, and it lives in this module so
   * that no viem log type crosses out of it.
   */
  readonly logs: readonly Log[];
}

/**
 * Waits for a receipt, bounded.
 *
 * Returns null on timeout rather than throwing, because a timeout is not a
 * failure of the transaction — it was broadcast and may still confirm. The
 * caller records the hash and lets a later pass reconcile, which is what finding
 * K3 asked for: the V1 lost the hash entirely when the function died.
 */
export async function waitForReceipt(hash: Hex): Promise<MinedReceipt | null> {
  try {
    const receipt = await publicClient().waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    return { status: receipt.status, logs: receipt.logs };
  } catch {
    return null;
  }
}

/**
 * Whether the node still knows this transaction at all — mined or pending.
 *
 * I8. A transaction that is neither is dropped: evicted from the mempool, or
 * replaced, and in both cases it will never be mined and no amount of waiting
 * changes that. Without this question there was no way to tell "not confirmed
 * yet" from "will never confirm", so an entry whose transaction had been dropped
 * sat in SUBMITTED for ever.
 *
 * A node that cannot answer is treated as a node that still has it. The honest
 * reading of an RPC failure is that nothing was learned, and the expensive
 * mistake here is the other one: declaring a live transaction dropped puts the
 * entry back in the queue and buys a second funding for a transaction that was
 * about to be mined.
 */
export async function transactionKnown(hash: Hex): Promise<boolean> {
  try {
    await publicClient().getTransaction({ hash });
    return true;
  } catch (error) {
    // viem throws TransactionNotFoundError for a hash the node does not have and
    // something else for a transport failure. Only the first is an answer.
    return !(error instanceof TransactionNotFoundError);
  }
}

/**
 * The index the contract assigned to a root, read from the event it emitted.
 *
 * §1.1/G5. The index used to be read with getEligibilityRootsCount at `latest`
 * BEFORE the transaction was broadcast, which is the number of roots already
 * mined and not the index this publication would be given. One publication for
 * the same campaign still in the mempool — the ordinary case, because a run
 * publishes for several campaigns and its receipt wait is bounded — and the two
 * agreed on a number only one of them could have. The entries were then promoted
 * with an index pointing at somebody else's root, every proof built against it
 * failed to verify, and enter() reverted with NotEligible on each of them for as
 * long as the row existed.
 *
 * addEligibilityRoot emits EligibilityRootAdded(giveawayId, rootIndex, root) with
 * roots.length - 1 (GiveawayManagerV2.sol:679), so the receipt carries the answer
 * the contract itself decided. Filtered on the campaign and on the manager
 * address as well as on the event: one transaction is one campaign here, but
 * nothing in the decoding says so.
 *
 * Returns null when the receipt carries no such event, which is not a number to
 * guess at — the caller records nothing and lets the next run publish again.
 */
export function rootIndexFromLogs(logs: readonly Log[], giveawayId: bigint): bigint | null {
  const events = parseEventLogs({
    abi: GIVEAWAY_MANAGER_V2_ABI,
    eventName: 'EligibilityRootAdded',
    logs: logs as Log[],
  });

  for (const event of events) {
    if (event.address.toLowerCase() !== (GIVEAWAY_MANAGER_V2 as string).toLowerCase()) continue;
    const args = event.args as { giveawayId: bigint; rootIndex: bigint };
    if (args.giveawayId !== giveawayId) continue;
    return args.rootIndex;
  }
  return null;
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
 * with different calldata, so they are the same function.
 *
 * G6, AND THE REASON THE BLOCK TAG IS NOT THE DEFAULT. A derived wallet is used
 * by one entry at a time, so the pool's problem does not arise here — but "at a
 * time" is a claim about the scheduler, and the scheduler was firing a new run
 * every minute over work bounded at sixty seconds a receipt. A claim broadcast
 * by one run and not yet mined is invisible at `latest`, so the next run read
 * the same count and signed a second transaction on the same nonce: not a second
 * claim but a replacement of the first, one of the two silently discarded.
 *
 * `pending` is what the account has actually committed to, mempool included, and
 * it is safe to depend on here in a way it is not for a funder: the run lock
 * means no other run is reading it at the same moment, which is precisely the
 * concurrent pending read G6 forbids.
 */
export async function submitAsDerived(
  walletIndex: number,
  wallet: `0x${string}`,
  to: `0x${string}`,
  data: Hex,
  plan: GasPlan,
  signAsDerived: (index: number, tx: TransactionSerializable) => Promise<Hex>,
): Promise<Hex> {
  const nonce = await publicClient().getTransactionCount({
    address: wallet,
    blockTag: 'pending',
  });

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
    // G6, at `pending`. One run publishes a root per campaign in a loop and
    // waits for each receipt, and that wait is bounded: a publication that has
    // not been mined when the wait gives up is still in the mempool, still
    // holding its nonce, and invisible at `latest`. The next campaign in the
    // same loop then signed on the same number and replaced it — so the first
    // campaign's root was never published, its entries stayed VERIFIED, and
    // nothing on this side recorded why.
    client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
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
 *
 * H3/H7: WHAT IS SENT IS THE SHORTFALL, NOT THE REQUIREMENT. Every attempt used
 * to transfer the full worst case without ever asking what the wallet already
 * held, and the wallet is very often not empty: the previous attempt's gas is
 * still sitting there whenever enter() reverted, whenever a receipt was never
 * seen, whenever the run was killed between the funding and the call. Each retry
 * moved a second full worst case into the same address, the sweep recovered one
 * transfer's worth at a time, and the difference was gas the pool paid twice for
 * one entry — a cost that grows with exactly the conditions that cause retries.
 * What the wallet holds is a number the chain has and this side did not ask for.
 *
 * Returns null when the wallet already holds what the transaction needs. Nothing
 * is signed and nothing is broadcast, so the funder's nonce does not move: there
 * is no transaction to consume it.
 */
export async function fundDerivedWallet(
  lease: { index: number; address: `0x${string}`; nextNonce: number },
  destination: `0x${string}`,
  amountWei: bigint,
  signAsFunder: (index: number, tx: TransactionSerializable) => Promise<Hex>,
  onNonceSpent: (nextNonce: number) => void,
): Promise<Hex | null> {
  if (amountWei <= 0n || amountWei > MAX_GAS_COST_WEI) {
    throw new ChainError('funding_amount_out_of_band');
  }

  // Read before the estimate rather than beside it, because the estimate is of
  // the transfer this call will actually make and that is not known until the
  // balance is. One extra round trip, weighed against a transfer of real value on
  // every retry of every entry and of every prize.
  const balance = await publicClient().getBalance({ address: destination });
  if (balance >= amountWei) return null;

  const shortfall = amountWei - balance;

  // Estimated, never assumed. A value transfer is 21_000 on a bare EVM and is
  // not 21_000 here: Arbitrum One folds the L1 data component into the number
  // and answers 21_305 for exactly this call (measured 2026-09-06), so the
  // constant that used to sit on this line was a limit below the intrinsic cost
  // of the transaction it was signing.
  //
  // Estimated WITH the value, so an RPC that refuses for insufficient funds says
  // so before a funder signs a transfer it cannot pay for — and with the value
  // actually being sent, so that check is made against the real transfer.
  const [fees, estimate] = await Promise.all([
    currentFees(),
    publicClient().estimateGas({ account: lease.address, to: destination, value: shortfall }),
  ]);

  const plan = planGas(estimate, fees.maxFeePerGas, fees.maxPriorityFeePerGas, GAS_BANDS.TRANSFER);
  if (plan.worstCaseWei + shortfall > MAX_GAS_COST_WEI) {
    throw new ChainError('funding_cost_above_ceiling');
  }

  const transaction: TransactionSerializable = {
    chainId: CHAIN_ID,
    type: 'eip1559',
    to: destination,
    value: shortfall,
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
    // G6, at `pending`, for the same reason as the two above: the sweep runs on
    // the maintenance schedule against a wallet whose last entry transaction may
    // still be unmined, and a sweep signed on that transaction's nonce replaces
    // the entry rather than following it.
    client.getTransactionCount({ address: wallet, blockTag: 'pending' }),
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
 * Whether a prize module is the ERC-1155 one.
 *
 * PrizeKind cannot answer this. Both NFT modules report PrizeKind.NFT and the
 * core freezes that value at creation without recording which module produced
 * it, so the kind says "not fungible" and stops there. The two modules do not
 * share an item interface — one has itemsOf and a token id per position, the
 * other has lotsOf and units of an id — and they do not share a transfer
 * encoding either.
 *
 * ERC-165 is the discriminator. ERC1155PrizeModule declares supportsInterface
 * for IERC1155Receiver; ERC721PrizeModule declares no supportsInterface at all,
 * and neither does PrizeModuleBase, so the call reverts there rather than
 * answering false. Both outcomes mean the same thing and are read the same way,
 * which is what OpenZeppelin's own ERC-165 checker does.
 */
async function isErc1155Module(module: `0x${string}`): Promise<boolean> {
  try {
    return (await publicClient().readContract({
      address: module,
      abi: ERC1155_PRIZE_MODULE_ABI,
      functionName: 'supportsInterface',
      args: [ERC1155_RECEIVER_INTERFACE_ID],
    })) as boolean;
  } catch {
    // A module without the function, not a module that is unreachable: every
    // read here goes through the same bounded client, and an RPC that is down
    // fails the reads that follow just as visibly.
    return false;
  }
}

/**
 * Builds the delivery that empties the derived wallet of the prize.
 *
 * E2 decides whether there is a destination at all; this decides what the
 * transaction has to be once there is one. THREE shapes, not two — the prize
 * kind has two values and the prize modules have three interfaces between them —
 * and all three take their subject from the chain:
 *
 * TOKEN — the prize token is getGiveaway().feeToken, which the core bound at
 * creation. The amount is the balance the derived wallet actually holds rather
 * than the amount that was claimable, so a delivery retried after a failed
 * broadcast moves what is there instead of what was expected to be there.
 *
 * NFT, ERC-721 — the core stores the winner's position, the module stores the
 * items, and section 8.3 pairs them: the n-th winner is owed the n-th deposited
 * item.
 *
 * NFT, ERC-1155 — the same pairing over a different unit. The module stores lots
 * of (id, total), the flattened positions of those lots are the prize positions,
 * and the winner's position falls in exactly one lot whose id is what they are
 * owed. This walk is the module's own _lotIndexOf, done on this side because the
 * module publishes the lots rather than the mapping. It accumulates `total` and
 * never `remaining`, which is what makes a position mean the same thing on the
 * last claim as on the first.
 *
 * Every address comes from the core (prizeModule, feeToken) or from the module
 * (the collection). Nothing here is configurable and nothing arrives from a
 * request.
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
    return (await isErc1155Module(campaign.prizeModule))
      ? erc1155Delivery(giveawayId, campaign.prizeModule, wallet, destination)
      : erc721Delivery(giveawayId, campaign.prizeModule, wallet, destination);
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

/** The winner's flattened prize position, as the core hands it to the module. */
async function winnerPosition(giveawayId: bigint, wallet: `0x${string}`): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'winnerIndex',
    args: [giveawayId, wallet],
  })) as bigint;
}

/** Section 8.3 over an ERC-721 module: position n is the n-th deposited item. */
async function erc721Delivery(
  giveawayId: bigint,
  module: `0x${string}`,
  wallet: `0x${string}`,
  destination: `0x${string}`,
): Promise<PrizeDelivery | null> {
  const client = publicClient();
  const [slot, items, custody] = await Promise.all([
    winnerPosition(giveawayId, wallet),
    client.readContract({
      address: module,
      abi: ERC721_PRIZE_MODULE_ABI,
      functionName: 'itemsOf',
      args: [giveawayId],
    }) as Promise<readonly bigint[]>,
    client.readContract({
      address: module,
      abi: ERC721_PRIZE_MODULE_ABI,
      functionName: 'custodyOf',
      args: [giveawayId],
    }) as Promise<readonly [`0x${string}`, bigint]>,
  ]);

  const tokenId = items[Number(slot)];
  const collection = custody[0];
  if (tokenId === undefined) return null;

  // The module keeps its item list after delivering, so unlike a token balance
  // the list alone cannot say whether the item has already gone. The owner can.
  // Without this a delivery whose receipt was never seen would be retried for
  // ever against a token the wallet no longer holds, and every retry is a revert
  // the estimate refuses before it costs anything — but also a prize that is
  // never marked delivered.
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

/**
 * Section 8.3 over an ERC-1155 module: position n falls in one lot, and that
 * lot's id is the unit the winner is owed.
 *
 * The walk mirrors ERC1155PrizeModule._lotIndexOf exactly — accumulate each
 * lot's `total`, and the first cursor the position is below is the lot. `total`
 * and not `remaining`, deliberately: `remaining` falls as units are handed out,
 * so walking it would move every later winner's position each time an earlier
 * one claimed, and the module's own delivery would then disagree with what this
 * side thinks it delivered.
 *
 * The holding check is balanceOf rather than an owner comparison, because units
 * of one id are interchangeable and the wallet either has at least one or has
 * none. Zero is the second pass over a delivery whose receipt was never seen.
 */
async function erc1155Delivery(
  giveawayId: bigint,
  module: `0x${string}`,
  wallet: `0x${string}`,
  destination: `0x${string}`,
): Promise<PrizeDelivery | null> {
  const client = publicClient();
  const [slot, lots, custody] = await Promise.all([
    winnerPosition(giveawayId, wallet),
    client.readContract({
      address: module,
      abi: ERC1155_PRIZE_MODULE_ABI,
      functionName: 'lotsOf',
      args: [giveawayId],
    }) as Promise<readonly { id: bigint; total: bigint; remaining: bigint }[]>,
    client.readContract({
      address: module,
      abi: ERC1155_PRIZE_MODULE_ABI,
      functionName: 'custodyOf',
      args: [giveawayId],
    }) as Promise<readonly [`0x${string}`, bigint]>,
  ]);

  let cursor = 0n;
  let tokenId: bigint | null = null;
  for (const lot of lots) {
    cursor += lot.total;
    if (slot < cursor) {
      tokenId = lot.id;
      break;
    }
  }
  // A position past the last lot is what the module itself rejects with
  // UnknownItem. There is nothing to build and nothing a retry would fix.
  if (tokenId === null) return null;

  const collection = custody[0];
  const held = (await client.readContract({
    address: collection,
    abi: ERC1155_ABI,
    functionName: 'balanceOf',
    args: [wallet, tokenId],
  })) as bigint;
  if (held <= 0n) return null;

  return {
    to: collection,
    amount: tokenId,
    data: encodeFunctionData({
      abi: ERC1155_ABI,
      functionName: 'safeTransferFrom',
      // One unit, because the core hands out one prize position per winner and
      // the module refuses any other amount (InvalidAmount). Empty data: the
      // destination is the address the winner confirmed, and there is nothing
      // for a receiver hook to be told.
      args: [wallet, destination, tokenId, 1n, '0x'],
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

// -----------------------------------------------------------------------------
// Creator-without-wallet campaigns — 07/09/2026 owner decision
// -----------------------------------------------------------------------------
// A creator with no wallet of their own has the bridge create their campaign
// and deposit its prize. TOKEN prizes only in this pass (see PRIZE_MODULE_KIND_ABI
// in abi.ts for why); the module, the fee token and the slot cost are still
// read from the chain and never assumed, exactly as H1 asks everywhere else.

/** Whether the contract will accept this module at all. */
export async function isModuleRegistered(module: `0x${string}`): Promise<boolean> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: CREATOR_CAMPAIGN_MANAGER_ABI,
    functionName: 'isModuleRegistered',
    args: [module],
  })) as boolean;
}

/**
 * What kind of prize a module hands out. Read before anything is drafted, so
 * an NFT module is refused with a clear reason rather than discovered when
 * takeCustody's prizeData turns out to be the wrong shape.
 */
export async function modulePrizeKind(module: `0x${string}`): Promise<number> {
  return Number(
    await publicClient().readContract({
      address: module,
      abi: PRIZE_MODULE_KIND_ABI,
      functionName: 'prizeKind',
      args: [],
    }),
  );
}

/** The fee this campaign would owe, in the units currentFee itself declares. */
export async function currentCreationFee(kind: number, amount: bigint): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: CREATOR_CAMPAIGN_MANAGER_ABI,
    functionName: 'currentFee',
    args: [kind, amount],
  })) as bigint;
}

/** The current price of one entry slot, in USDC base units. */
export async function slotPrice(): Promise<bigint> {
  return (await publicClient().readContract({
    address: GIVEAWAY_MANAGER_V2,
    abi: CREATOR_CAMPAIGN_MANAGER_ABI,
    functionName: 'pricePerSlot',
    args: [],
  })) as bigint;
}

/** What an address currently holds of a token. */
export async function erc20BalanceOf(token: `0x${string}`, address: `0x${string}`): Promise<bigint> {
  return (await publicClient().readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  })) as bigint;
}

export interface Erc20Meta {
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * A token's symbol, reduced to something that can be put in a sentence.
 *
 * THE SYMBOL IS ATTACKER-CONTROLLED: the campaign creator chooses the prize
 * token, symbol() returns whatever that contract wants, and the string goes into
 * the body of a plain-text email — no markup to escape, so nothing would have
 * caught it. A symbol carrying newlines appends paragraphs of its own to a
 * message whose authority is the platform's.
 *
 * REFUSED, NOT REPAIRED. Sanitising kept whatever survived the edit, and a
 * sentence cut to sixteen printable characters is still sixteen characters of
 * somebody else's text inside our email — room enough for a shortened URL. A
 * real symbol is a short alphanumeric word; anything else returns '', which
 * makes the whole read count as a failure and takes the degraded path the
 * notice already has.
 */
export function cleanSymbol(raw: string): string {
  const symbol = raw.trim();
  return /^[A-Za-z0-9.-]{1,16}$/.test(symbol) ? symbol : '';
}

/**
 * A token's own name for itself and its scale, for the settlement notice. Read
 * once per campaign, never per winner.
 *
 * NEITHER CALL IS REQUIRED TO SUCCEED: symbol() and decimals() are conventions,
 * not part of the interface a token must implement. A failure here degrades the
 * sentence that says what was won, never the notice that says somebody won it.
 */
export async function erc20Meta(token: `0x${string}`): Promise<Erc20Meta | null> {
  const client = publicClient();
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);
    const clean = cleanSymbol(String(symbol));
    if (clean === '') return null;
    return { symbol: clean, decimals: Number(decimals) };
  } catch {
    return null;
  }
}

/** What `spender` may already move of `token` on `owner`'s behalf. */
export async function erc20Allowance(
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return (await publicClient().readContract({
    address: token,
    abi: CREATOR_APPROVAL_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint;
}

/** Prices an ERC-20 approve() from the creator's derived wallet. */
export async function quoteApprove(
  from: `0x${string}`,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
): Promise<{ plan: GasPlan; data: Hex }> {
  const data = encodeFunctionData({ abi: CREATOR_APPROVAL_ABI, functionName: 'approve', args: [spender, amount] });
  return { plan: await quoteCall(from, token, data, GAS_BANDS.DELIVERY), data };
}

/**
 * ERC20PrizeModule's own prizeData shape (its NatSpec, line 21):
 * abi.encode(address token, uint256 amount). H1: the module is a parameter of
 * createGiveaway itself, chosen and validated (isModuleRegistered,
 * modulePrizeKind) before this is ever built — never a second, unchecked path
 * to the same call.
 */
export function encodeTokenPrizeData(token: `0x${string}`, amount: bigint): Hex {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [token, amount],
  );
}

/** Prices createGiveaway() from the creator's derived wallet. */
export async function quoteCreateGiveaway(
  from: `0x${string}`,
  module: `0x${string}`,
  prizeData: Hex,
  prizeAmount: bigint,
  declaredValue: bigint,
  duration: bigint,
  winnersCount: number,
  slotCap: number,
): Promise<{ plan: GasPlan; data: Hex }> {
  const data = encodeFunctionData({
    abi: CREATOR_CAMPAIGN_MANAGER_ABI,
    functionName: 'createGiveaway',
    args: [module, prizeData, prizeAmount, declaredValue, duration, winnersCount, slotCap],
  });
  return { plan: await quoteCall(from, GIVEAWAY_MANAGER_V2, data, GAS_BANDS.MANAGER), data };
}

/**
 * The id the contract assigned to a new campaign, read from the event it
 * emitted. Same reasoning as rootIndexFromLogs: createGiveaway returns the id,
 * but a return value is only visible to a caller that reads it via eth_call,
 * and this side only ever broadcasts and waits for a receipt. The event is
 * the only place the assigned id reaches this process.
 */
export function giveawayIdFromLogs(logs: readonly Log[]): bigint | null {
  const events = parseEventLogs({ abi: CREATOR_CAMPAIGN_MANAGER_ABI, eventName: 'GiveawayCreated', logs: logs as Log[] });
  for (const event of events) {
    if (event.address.toLowerCase() !== (GIVEAWAY_MANAGER_V2 as string).toLowerCase()) continue;
    return (event.args as { giveawayId: bigint }).giveawayId;
  }
  return null;
}
