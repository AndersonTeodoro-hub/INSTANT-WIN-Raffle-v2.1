/**
 * The orders, the on-chain half — reads only. SPEC-BLOCO-03 piece 5.
 *
 * What the bridge reads of KeptraEscrow, KeptraGuarantee and KeptraVoucher
 * (pieces 2 and 3, commit 183a2b4). Nothing here signs: the keeper's exits and
 * the bridge role's mark and attestation live in chain.ts with the keys (H1, §18
 * M2), and everything a Keptra account does is built by the relay and signed by
 * its passkey. The addresses are config.ts's literals (P24).
 */

import { hexToString, parseEventLogs, type Hex, type Log } from 'viem';
import { publicClient } from './chain.js';
import {
  ERC721_PRIZE_MODULE_ABI,
  KEPTRA_ESCROW_ABI,
  KEPTRA_GUARANTEE_ABI,
  KEPTRA_REPUTATION_ABI,
  KEPTRA_VOUCHER_ABI,
} from './abi.js';
import { ERC721_PRIZE_MODULE, KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_VOUCHER, ORDER_LOG_SPAN_BLOCKS } from './config.js';

/** KeptraEscrow.Terms (section 7). */
export interface TermsView {
  readonly store: `0x${string}`;
  readonly price: bigint;
  readonly payout: `0x${string}`;
  readonly shipping: bigint;
  readonly returnCost: bigint;
  readonly refusalFeeBps: number;
  readonly shipDays: number;
  readonly deliveryDays: number;
  readonly mode: number;
  readonly prize: boolean;
  readonly active: boolean;
}

/** KeptraEscrow.Order, with its id. */
export interface OrderView {
  readonly orderId: bigint;
  readonly termsId: bigint;
  readonly quantity: number;
  readonly state: number;
  readonly flags: number;
  readonly payer: `0x${string}`;
  readonly paid: bigint;
  readonly paidAt: bigint;
  readonly shippedAt: bigint;
  readonly windowEndsAt: bigint;
  readonly contestedAt: bigint;
  readonly voucherId: bigint;
  readonly codeCommit: Hex;
}

export interface OrderWithTerms {
  readonly order: OrderView;
  readonly terms: TermsView;
}

/** What one pass over the orders reads first: how many there are, and the chain's clock. */
export interface OrdersHead {
  readonly orderCount: bigint;
  readonly now: bigint;
  readonly block: bigint;
}

const toTerms = (t: Record<string, unknown>): TermsView => ({
  store: t.store as `0x${string}`,
  price: t.price as bigint,
  payout: t.payout as `0x${string}`,
  shipping: t.shipping as bigint,
  returnCost: t.returnCost as bigint,
  refusalFeeBps: Number(t.refusalFeeBps),
  shipDays: Number(t.shipDays),
  deliveryDays: Number(t.deliveryDays),
  mode: Number(t.mode),
  prize: t.prize as boolean,
  active: t.active as boolean,
});

const toOrder = (orderId: bigint, o: Record<string, unknown>): OrderView => ({
  orderId,
  termsId: o.termsId as bigint,
  quantity: Number(o.quantity),
  state: Number(o.state),
  flags: Number(o.flags),
  payer: o.payer as `0x${string}`,
  paid: o.paid as bigint,
  paidAt: o.paidAt as bigint,
  shippedAt: o.shippedAt as bigint,
  windowEndsAt: o.windowEndsAt as bigint,
  contestedAt: o.contestedAt as bigint,
  voucherId: o.voucherId as bigint,
  codeCommit: o.codeCommit as Hex,
});

export async function ordersHead(): Promise<OrdersHead> {
  const client = publicClient();
  const [orderCount, block] = await Promise.all([
    client.readContract({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'orderCount' }),
    client.getBlock({ blockTag: 'latest' }),
  ]);
  return { orderCount, now: block.timestamp, block: block.number };
}

export async function readTerms(termsId: bigint): Promise<TermsView> {
  return toTerms(
    (await publicClient().readContract({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'getTerms', args: [termsId] })) as unknown as Record<string, unknown>,
  );
}

/** One order and the terms it runs under: the order, then its terms. */
export async function readOrder(orderId: bigint): Promise<OrderWithTerms> {
  const [page] = await readOrders([orderId]);
  return page;
}

/**
 * Orders by id, with their terms, in two multicalls: the orders, then the terms
 * they point at. The ids come from this side (the count the escrow reports), and
 * an id past it makes the call revert rather than answer something.
 */
export async function readOrders(ids: readonly bigint[]): Promise<OrderWithTerms[]> {
  if (ids.length === 0) return [];
  const client = publicClient();
  const orders = (await client.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'getOrder', args: [id] }) as const),
  })) as unknown as Record<string, unknown>[];
  const views = ids.map((id, i) => toOrder(id, orders[i]));
  const terms = (await client.multicall({
    allowFailure: false,
    contracts: views.map((order) => ({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'getTerms', args: [order.termsId] }) as const),
  })) as unknown as Record<string, unknown>[];
  return views.map((order, i) => ({ order, terms: toTerms(terms[i]) }));
}

/** 7.5 and I14: the countries an offer or an obligation accepts, as the escrow holds them (ISO pairs). */
export async function regionsOf(termsId: bigint): Promise<string[]> {
  const raw = (await publicClient().readContract({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'regionsOf', args: [termsId] })) as Hex;
  const text = hexToString(raw);
  const out: string[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) out.push(text.slice(i, i + 2));
  return out;
}

/** I6: whether a tracking hash already serves an order. */
export async function trackingHashUsed(hash: Hex): Promise<boolean> {
  return (await publicClient().readContract({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'usedTrackingHash', args: [hash] })) as boolean;
}

/** H5: the arbiter as the escrow names it now — a rotation reaches every order. */
export async function escrowArbiter(): Promise<`0x${string}`> {
  return (await publicClient().readContract({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'arbiter' })) as `0x${string}`;
}

/**
 * How an order ended, from its OrderClosed event, searched from the last block
 * the order was seen open up to `toBlock`. The Order struct keeps no outcome, and
 * 13.1 (P5) needs to know whether the delivery counted.
 *
 * Adenda R2: at most ORDER_LOG_SPAN_BLOCKS per request, and a refused request is
 * asked again over half the range, down to one block — so a provider that limits
 * the range per request is read too. Before every request after the first,
 * `hasTime` says whether the run can afford another; when it cannot, the search
 * stops and `searchedTo` says how far it got, for the next pass to go on from.
 * `outcome` is null with `searchedTo === toBlock` when the log is not there.
 */
export async function orderOutcome(
  orderId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
  hasTime: () => boolean,
): Promise<{ outcome: number | null; searchedTo: bigint }> {
  let span = ORDER_LOG_SPAN_BLOCKS;
  let first = true;
  for (let from = fromBlock; from <= toBlock; ) {
    if (!first && !hasTime()) return { outcome: null, searchedTo: from - 1n };
    first = false;
    const to = from + span - 1n < toBlock ? from + span - 1n : toBlock;
    let logs: readonly unknown[];
    try {
      logs = await publicClient().getContractEvents({
        address: KEPTRA_ESCROW,
        abi: KEPTRA_ESCROW_ABI,
        eventName: 'OrderClosed',
        args: { orderId },
        fromBlock: from,
        toBlock: to,
      });
    } catch (error) {
      if (span === 1n) throw error;
      span /= 2n;
      continue;
    }
    const found = logs[0] as { args: { outcome?: number } } | undefined;
    if (found !== undefined) return { outcome: Number(found.args.outcome), searchedTo: to };
    from = to + 1n;
  }
  return { outcome: null, searchedTo: toBlock };
}

/** The order a relayed pay or redeem opened, from its receipt (the escrow assigned the id, E3). */
export function orderIdFromLogs(logs: readonly Log[]): bigint | null {
  const events = parseEventLogs({ abi: KEPTRA_ESCROW_ABI, eventName: 'OrderOpened', logs: logs as Log[] });
  for (const event of events) {
    if (event.address.toLowerCase() !== KEPTRA_ESCROW.toLowerCase()) continue;
    return (event.args as { orderId: bigint }).orderId;
  }
  return null;
}

/** SPEC-BLOCO-03 T5: the offer a relayed createOffer published, from its receipt. */
export function offerIdFromLogs(logs: readonly Log[]): bigint | null {
  const events = parseEventLogs({ abi: KEPTRA_ESCROW_ABI, eventName: 'OfferCreated', logs: logs as Log[] });
  for (const event of events) {
    if (event.address.toLowerCase() !== KEPTRA_ESCROW.toLowerCase()) continue;
    return (event.args as { termsId: bigint }).termsId;
  }
  return null;
}

/** SPEC-BLOCO-03 T5: the obligation a relayed createObligation opened, and the terms it runs under. */
export function obligationFromLogs(logs: readonly Log[]): { obligationId: bigint; termsId: bigint } | null {
  const events = parseEventLogs({ abi: KEPTRA_GUARANTEE_ABI, eventName: 'ObligationCreated', logs: logs as Log[] });
  for (const event of events) {
    if (event.address.toLowerCase() !== KEPTRA_GUARANTEE.toLowerCase()) continue;
    const args = event.args as { obligationId: bigint; termsId: bigint };
    return { obligationId: args.obligationId, termsId: args.termsId };
  }
  return null;
}

/** SPEC-BLOCO-03 T5: the vouchers that obligation minted, in the order they were minted. */
export function voucherIdsFromLogs(logs: readonly Log[]): bigint[] {
  return parseEventLogs({ abi: KEPTRA_VOUCHER_ABI, eventName: 'VoucherMinted', logs: logs as Log[] })
    .filter((event) => event.address.toLowerCase() === KEPTRA_VOUCHER.toLowerCase())
    .map((event) => (event.args as { tokenId: bigint }).tokenId);
}

// -----------------------------------------------------------------------------
// the guarantee and the voucher
// -----------------------------------------------------------------------------

export interface ObligationView {
  readonly brand: `0x${string}`;
  readonly termsId: bigint;
}

export async function readObligation(obligationId: bigint): Promise<ObligationView> {
  const o = (await publicClient().readContract({
    address: KEPTRA_GUARANTEE,
    abi: KEPTRA_GUARANTEE_ABI,
    functionName: 'getObligation',
    args: [obligationId],
  })) as unknown as Record<string, unknown>;
  return { brand: o.brand as `0x${string}`, termsId: o.termsId as bigint };
}

/** One voucher as the bridge decides on it. `owner` is null for a voucher that no longer exists (burned when its unit settled). */
export interface VoucherView {
  readonly voucherId: bigint;
  readonly owner: `0x${string}` | null;
  readonly voided: boolean;
  readonly claimedAt: bigint;
  readonly giveawayId: bigint;
  readonly obligationId: bigint;
}

export async function voucherLastId(): Promise<bigint> {
  return (await publicClient().readContract({ address: KEPTRA_VOUCHER, abi: KEPTRA_VOUCHER_ABI, functionName: 'lastId' })) as bigint;
}

/** SPEC-BLOCO-03 T13: how many vouchers an address holds (ERC-721 balanceOf). */
export async function voucherBalanceOf(owner: `0x${string}`): Promise<bigint> {
  return (await publicClient().readContract({ address: KEPTRA_VOUCHER, abi: KEPTRA_VOUCHER_ABI, functionName: 'balanceOf', args: [owner] })) as bigint;
}

/** Vouchers by id, five reads each in one multicall; ownerOf is allowed to fail, and a burned voucher reads as owner null. */
export async function readVouchers(ids: readonly bigint[]): Promise<VoucherView[]> {
  if (ids.length === 0) return [];
  const read = (functionName: 'ownerOf' | 'voided' | 'claimedAt' | 'giveawayOf' | 'obligationOf', id: bigint) =>
    ({ address: KEPTRA_VOUCHER, abi: KEPTRA_VOUCHER_ABI, functionName, args: [id] }) as const;
  const results = await publicClient().multicall({
    allowFailure: true,
    contracts: ids.flatMap((id) => [read('ownerOf', id), read('voided', id), read('claimedAt', id), read('giveawayOf', id), read('obligationOf', id)]),
  });
  return ids.map((voucherId, i) => {
    const at = (k: number) => results[5 * i + k];
    const owner = at(0).status === 'success' ? (at(0).result as `0x${string}`) : null;
    for (let k = 1; k < 5; k += 1) if (at(k).status !== 'success') throw new Error('[bridge-v2] voucher read failed');
    return {
      voucherId,
      owner,
      voided: at(1).result as boolean,
      claimedAt: BigInt(at(2).result as bigint | number),
      giveawayId: at(3).result as bigint,
      obligationId: at(4).result as bigint,
    };
  });
}

/** H8: the positions of a campaign's deposit list, which the clamp case of releasable reads. */
export async function campaignItems(giveawayId: bigint): Promise<bigint[]> {
  return [
    ...((await publicClient().readContract({ address: ERC721_PRIZE_MODULE, abi: ERC721_PRIZE_MODULE_ABI, functionName: 'itemsOf', args: [giveawayId] })) as readonly bigint[]),
  ];
}

/** H8, H9, J1, 11.10: whether the core can no longer deliver this voucher, as the voucher contract decides it. */
export async function voucherReleasable(voucherId: bigint, itemIndex: bigint): Promise<boolean> {
  return (await publicClient().readContract({
    address: KEPTRA_VOUCHER,
    abi: KEPTRA_VOUCHER_ABI,
    functionName: 'releasable',
    args: [voucherId, itemIndex],
  })) as boolean;
}

/** 13.2 and H11: what an obligation of this brand costs now — its tier's bond and fee, and whether it may create at all. */
export async function brandParams(
  brand: `0x${string}`,
): Promise<{ bondBps: number; protectionBps: number; canCreate: boolean; debt: bigint }> {
  const client = publicClient();
  const reputation = (await client.readContract({ address: KEPTRA_ESCROW, abi: KEPTRA_ESCROW_ABI, functionName: 'reputation' })) as `0x${string}`;
  const [[, params], debt] = (await Promise.all([
    client.readContract({ address: reputation, abi: KEPTRA_REPUTATION_ABI, functionName: 'termsFor', args: [brand] }),
    client.readContract({ address: KEPTRA_GUARANTEE, abi: KEPTRA_GUARANTEE_ABI, functionName: 'totalDebtOf', args: [brand] }),
  ])) as [readonly [number, { bondBps: number; protectionBps: number; canCreate: boolean }], bigint];
  return { bondBps: Number(params.bondBps), protectionBps: Number(params.protectionBps), canCreate: params.canCreate, debt };
}
