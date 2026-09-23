/**
 * The orders, the database half. SPEC-BLOCO-03 piece 5.
 *
 * Addresses (section 10, P15, P18, P19), shipments (9.1.1, H17, M9), the
 * evidence of a contest (P17), the notices (8.3, P4, P22), the recipient marks
 * (13.1, P5) and the index of orders the cron passes read. No chain here: what an
 * order IS comes from escrowChain.ts, and this file keeps what the bridge knows
 * about it.
 *
 * Section 10: an address never goes near the chain, and at rest it is ciphertext
 * under a key derived from an existing root with a label of its own (P20, as B3
 * did for the Telegram chat). So is the tracking number, which travels with it,
 * and the evidence. The tracking hash is keyed too (H17): a plain hash of a
 * tracking number is a lookup table away from the number.
 */

import { encodeAbiParameters, getAddress, keccak256, stringToHex, type Hex } from 'viem';
import { checked, checkedMaybe, getDb } from './db.js';
import { decryptUnder, encryptUnder, keyedHash } from './crypto.js';
import {
  ADDRESS_FIELD_MAX_CHARS,
  DB_TIMEOUT_MS,
  ERASE_AFTER_CLOSE_DAYS,
  EVIDENCE_MAX_CHARS,
  KEPTRA_ESCROW,
  KEPTRA_GUARANTEE,
  KEPTRA_VOUCHER,
  ORACLE_PENDING_PAGE,
  ORACLE_ROTATION_OFFSET_SECONDS,
  ORACLE_ROTATION_SECONDS,
  REGIONS_MAX,
} from './config.js';
import { missingKeptraEnv } from './env.js';
import { OrderFlag, OrderMode, OrderState } from './abi.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DAY_MS = 24 * 60 * 60 * 1000;
const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);

/** P24: the three contract addresses are filled in. The general rehearsal fails while this is false. */
export function keptraContractsConfigured(): boolean {
  return [KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_VOUCHER].every((address) => address.toLowerCase() !== ZERO_ADDRESS);
}

/** P24: the orders run only with the addresses filled in and KEPTRA_ENV set; otherwise "configuration incomplete". */
export function ordersConfigured(): boolean {
  return keptraContractsConfigured() && missingKeptraEnv().length === 0;
}

// P20: one root, three labels of their own.
const ROOT = 'BRIDGE_V2_PHONE_HMAC_KEY' as const;
const ADDRESS_LABEL = 'order-address-enc-v1';
const EVIDENCE_LABEL = 'order-evidence-enc-v1';
const TRACKING_LABEL = 'order-tracking-hmac-v1';

// -----------------------------------------------------------------------------
// what arrives from a request, checked
// -----------------------------------------------------------------------------

/** P19: name, address, post code, city, country, and an optional phone for the carrier. */
export interface PostalAddress {
  readonly name: string;
  readonly street: string;
  readonly postCode: string;
  readonly city: string;
  readonly country: string;
  readonly phone: string | null;
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // No control characters: a field is one line of an address label.
  if (trimmed.length === 0 || trimmed.length > ADDRESS_FIELD_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
};

/**
 * P19, checked. The post code keeps to what the tracking provider accepts for it
 * (at most 32 of letters, digits, space, _ - . /) because it is sent there (M9);
 * the country is ISO-3166-1 alpha-2, as the regions on-chain are (I14).
 */
export function parsePostalAddress(body: Record<string, unknown>): PostalAddress | null {
  const name = text(body.name);
  const street = text(body.street);
  const city = text(body.city);
  const postCode = typeof body.postCode === 'string' ? body.postCode.trim() : '';
  const country = typeof body.country === 'string' ? body.country.trim() : '';
  const phone = body.phone === undefined || body.phone === null || body.phone === '' ? null : typeof body.phone === 'string' ? body.phone.trim() : undefined;
  if (name === null || street === null || city === null) return null;
  if (!/^[A-Za-z0-9 _\-./]{1,32}$/.test(postCode) || !/[A-Za-z0-9]/.test(postCode)) return null;
  if (!/^[A-Z]{2}$/.test(country)) return null;
  if (phone === undefined || (phone !== null && !/^\+?[0-9 ()-]{6,20}$/.test(phone))) return null;
  return { name, street, postCode, city, country, phone };
}

/** P23-3 and I14: a list of distinct ISO-3166-1 alpha-2 codes as the escrow takes them — ASCII pairs, as bytes. */
export function encodeRegions(value: unknown): Hex | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > REGIONS_MAX) return null;
  if (!value.every((code) => typeof code === 'string' && /^[A-Z]{2}$/.test(code))) return null;
  if (new Set(value).size !== value.length) return null;
  return stringToHex(value.join(''));
}

/**
 * A tracking number as the hash is taken over it: upper case, letters and digits
 * only, so "1Z 999-AA1" and "1z999aa1" are the one parcel I6 means.
 */
export function normaliseTrackingNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalised = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalised.length >= 5 && normalised.length <= 40 ? normalised : null;
}

/** H17: the keyed hash of a tracking number, as the escrow stores it (bytes32). */
export async function trackingHashOf(normalised: string): Promise<Hex> {
  return `0x${await keyedHash(ROOT, TRACKING_LABEL, normalised)}` as Hex;
}

/** P17 as the owner answered it: the document the arbiter passes to decide() covers both texts, an absent one as empty. */
export function evidenceDocument(recipientText: string | null, storeText: string | null): Hex {
  return keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'string' }], [recipientText ?? '', storeText ?? '']));
}

/** The text the arbiter signs (EIP-191) to read one order's evidence. */
export function arbiterChallenge(orderId: bigint, issuedAt: number): string {
  return `Keptra arbiter: read the evidence of order ${orderId} at ${issuedAt}`;
}

/** P17: one text, at most EVIDENCE_MAX_CHARS, or null. */
export function parseEvidence(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= EVIDENCE_MAX_CHARS ? trimmed : null;
}

// -----------------------------------------------------------------------------
// addresses — section 10
// -----------------------------------------------------------------------------

/** What an address is registered for: an offer, before paying (COMPRA), or a voucher, before redeeming (PRÉMIO). */
export type AddressPurpose = { readonly termsId: bigint } | { readonly voucherId: bigint };

interface AddressRow {
  id: string;
  participant_id: string;
  terms_id: number | string | null;
  voucher_id: number | string | null;
  order_id: number | string | null;
  address_enc: string;
}

const purposeColumn = (purpose: AddressPurpose): ['terms_id' | 'voucher_id', string] =>
  'termsId' in purpose ? ['terms_id', purpose.termsId.toString()] : ['voucher_id', purpose.voucherId.toString()];

/** 10.2: written as ciphertext, never in clear, and never with the order it will serve until that order exists. */
export async function registerAddress(participantId: string, purpose: AddressPurpose, address: PostalAddress): Promise<void> {
  const [column, id] = purposeColumn(purpose);
  checked(
    'order.address_insert',
    await getDb()
      .from('bridge_v2_order_addresses')
      .insert({ participant_id: participantId, [column]: id, address_enc: await encryptUnder(ROOT, ADDRESS_LABEL, JSON.stringify(address)) })
      .abortSignal(timeout()),
  );
}

/**
 * P5-2: the address one relayed payment or redemption takes — the one its
 * prepare found unbound and unclaimed — claimed for it alone before the
 * transaction is sent. One conditional statement, so two submissions never take
 * the same address, and a submission whose address was taken in between is
 * refused before anything is signed: one address opens one order, and an order
 * the relay opens always has one.
 *
 * A claim whose transaction was never broadcast, or reverted, is given back
 * (releaseClaim); one whose transaction was dropped is given back by the orders
 * pass (bindClaimedAddresses), which also binds every claim the relay did not.
 */
export async function claimAddress(addressId: string): Promise<boolean> {
  const claimed = checked(
    'order.address_claim',
    await getDb()
      .from('bridge_v2_order_addresses')
      .update({ claimed_at: new Date().toISOString(), claim_tx: null })
      .eq('id', addressId)
      .is('order_id', null)
      .is('claimed_at', null)
      .select('id')
      .abortSignal(timeout()),
  ) as { id: string }[] | null;
  return (claimed ?? []).length === 1;
}

/** P5-2: the relayer transaction a claim was sent in, written the moment it is broadcast (K3). */
export async function setClaimTx(addressId: string, txHash: Hex): Promise<void> {
  checked(
    'order.address_claim_tx',
    await getDb().from('bridge_v2_order_addresses').update({ claim_tx: txHash.toLowerCase() }).eq('id', addressId).is('order_id', null).abortSignal(timeout()),
  );
}

/** P5-2: a claim whose transaction opened nothing goes back to the participant. */
export async function releaseClaim(addressId: string): Promise<void> {
  checked(
    'order.address_release',
    await getDb().from('bridge_v2_order_addresses').update({ claimed_at: null, claim_tx: null }).eq('id', addressId).is('order_id', null).abortSignal(timeout()),
  );
}

/** P5-2: the claims whose transaction was sent and whose order is not bound yet — the receipts the relay did not see. */
export async function claimsAwaitingBind(limit: number): Promise<Array<{ id: string; claimTx: Hex; claimedAt: string }>> {
  const rows = checked(
    'order.address_claims',
    await getDb()
      .from('bridge_v2_order_addresses')
      .select('id, claim_tx, claimed_at')
      .is('order_id', null)
      .not('claim_tx', 'is', null)
      .order('claimed_at', { ascending: true })
      .limit(limit)
      .abortSignal(timeout()),
  ) as { id: string; claim_tx: string; claimed_at: string }[] | null;
  return (rows ?? []).map((row) => ({ id: row.id, claimTx: row.claim_tx as Hex, claimedAt: row.claimed_at }));
}

/**
 * P5-2: whether a claim of this participant for this purpose is still waiting
 * for its order — the pass then leaves the binding to the claim's own receipt.
 */
export async function hasPendingClaim(participantId: string, purpose: AddressPurpose): Promise<boolean> {
  const [column, id] = purposeColumn(purpose);
  const rows = checked(
    'order.address_pending_claim',
    await getDb()
      .from('bridge_v2_order_addresses')
      .select('id')
      .eq('participant_id', participantId)
      .eq(column, id)
      .is('order_id', null)
      .not('claimed_at', 'is', null)
      .limit(1)
      .abortSignal(timeout()),
  ) as { id: string }[] | null;
  return (rows ?? []).length > 0;
}

/**
 * The oldest address a participant registered for this purpose that no order has
 * taken yet, and — P5-2 — that no submission has claimed: what a new payment can
 * still be prepared with, and what an order opened outside the relay may take.
 */
export async function unboundAddress(participantId: string, purpose: AddressPurpose): Promise<{ id: string } | null> {
  const [column, id] = purposeColumn(purpose);
  const rows = checked(
    'order.address_unbound',
    await getDb()
      .from('bridge_v2_order_addresses')
      .select('id')
      .eq('participant_id', participantId)
      .eq(column, id)
      .is('order_id', null)
      .is('claimed_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .abortSignal(timeout()),
  ) as { id: string }[] | null;
  return rows?.[0] ?? null;
}

/** The order an address now serves. Conditional on it serving none, so two orders never share one. */
export async function bindAddress(addressId: string, orderId: bigint): Promise<boolean> {
  const rows = checked(
    'order.address_bind',
    await getDb()
      .from('bridge_v2_order_addresses')
      .update({ order_id: orderId.toString(), bound_at: new Date().toISOString() })
      .eq('id', addressId)
      .is('order_id', null)
      .select('id')
      .abortSignal(timeout()),
  ) as { id: string }[] | null;
  return (rows ?? []).length === 1;
}

/** Whether an order already has its address. */
export async function orderHasAddress(orderId: bigint): Promise<boolean> {
  const row = checkedMaybe(
    'order.address_of_order',
    await getDb().from('bridge_v2_order_addresses').select('id').eq('order_id', orderId.toString()).abortSignal(timeout()).maybeSingle(),
  );
  return row !== null;
}

/** 10.2: the address of an order, read back — for its store, and for the post code the provider and the oracle compare. */
export async function addressOfOrder(orderId: bigint): Promise<PostalAddress | null> {
  const row = checkedMaybe(
    'order.address_read',
    await getDb().from('bridge_v2_order_addresses').select('address_enc').eq('order_id', orderId.toString()).abortSignal(timeout()).maybeSingle(),
  ) as { address_enc: string } | null;
  if (row === null) return null;
  const plain = await decryptUnder(ROOT, ADDRESS_LABEL, row.address_enc);
  return plain === null ? null : (JSON.parse(plain) as PostalAddress);
}

/**
 * P6-20: the addresses of many orders in one read, decrypted — for a store's list,
 * which must not ask the database once per order.
 */
export async function addressesOfOrders(orderIds: readonly bigint[]): Promise<Map<string, PostalAddress | null>> {
  const out = new Map<string, PostalAddress | null>();
  if (orderIds.length === 0) return out;
  const rows = checked(
    'order.address_read_many',
    await getDb().from('bridge_v2_order_addresses').select('order_id, address_enc').in('order_id', orderIds.map(String)).abortSignal(timeout()),
  ) as { order_id: number | string; address_enc: string }[] | null;
  for (const row of rows ?? []) {
    const plain = await decryptUnder(ROOT, ADDRESS_LABEL, row.address_enc);
    out.set(String(row.order_id), plain === null ? null : (JSON.parse(plain) as PostalAddress));
  }
  return out;
}

/** D7 and P18: what a participant's own addresses are for, decrypted, for the export. */
export async function addressesOf(participantId: string): Promise<Array<{ orderId: string | null; address: PostalAddress | null }>> {
  const rows = checked(
    'order.address_export',
    await getDb().from('bridge_v2_order_addresses').select('order_id, address_enc').eq('participant_id', participantId).abortSignal(timeout()),
  ) as Pick<AddressRow, 'order_id' | 'address_enc'>[] | null;
  const out = [];
  for (const row of rows ?? []) {
    const plain = await decryptUnder(ROOT, ADDRESS_LABEL, row.address_enc);
    out.push({ orderId: row.order_id == null ? null : String(row.order_id), address: plain === null ? null : (JSON.parse(plain) as PostalAddress) });
  }
  return out;
}

// -----------------------------------------------------------------------------
// the index of orders
// -----------------------------------------------------------------------------

/** One order as this side keeps it: what the chain said at seen_block, and how it ended. */
export interface OrderRow {
  readonly orderId: bigint;
  readonly termsId: bigint;
  readonly voucherId: bigint;
  readonly store: `0x${string}`;
  readonly payer: `0x${string}`;
  readonly mode: number;
  readonly prize: boolean;
  readonly shipDays: number;
  readonly deliveryDays: number;
  readonly state: number;
  readonly flags: number;
  readonly paidAt: bigint;
  readonly shippedAt: bigint;
  readonly windowEndsAt: bigint;
  readonly contestedAt: bigint;
  readonly seenBlock: bigint;
  readonly outcome: number | null;
  readonly closedAt: string | null;
  /** P5-4: when the pass last wrote the row — the least recently synced go first. */
  readonly syncedAt?: string | null;
}

interface OrderDbRow {
  order_id: number | string;
  terms_id: number | string;
  voucher_id: number | string;
  store_address: string;
  payer_address: string;
  mode: number;
  prize: boolean;
  ship_days: number;
  delivery_days: number;
  state: number;
  flags: number;
  paid_at: number | string;
  shipped_at: number | string;
  window_ends_at: number | string;
  contested_at: number | string;
  seen_block: number | string;
  outcome: number | null;
  closed_at: string | null;
  updated_at?: string | null;
}

const ORDER_COLUMNS =
  'order_id, terms_id, voucher_id, store_address, payer_address, mode, prize, ship_days, delivery_days, state, flags, paid_at, shipped_at, window_ends_at, contested_at, seen_block, outcome, closed_at, updated_at';

const big = (value: number | string | null | undefined): bigint => BigInt(String(value ?? 0));

function toOrderRow(row: OrderDbRow): OrderRow {
  return {
    orderId: big(row.order_id),
    termsId: big(row.terms_id),
    voucherId: big(row.voucher_id),
    store: row.store_address as `0x${string}`,
    payer: row.payer_address as `0x${string}`,
    mode: Number(row.mode),
    prize: row.prize === true,
    shipDays: Number(row.ship_days),
    deliveryDays: Number(row.delivery_days),
    state: Number(row.state),
    flags: Number(row.flags),
    paidAt: big(row.paid_at),
    shippedAt: big(row.shipped_at),
    windowEndsAt: big(row.window_ends_at),
    contestedAt: big(row.contested_at),
    seenBlock: big(row.seen_block),
    outcome: row.outcome ?? null,
    closedAt: row.closed_at ?? null,
    syncedAt: row.updated_at ?? null,
  };
}

/** What the frontend shows of an order: the chain's facts, as strings (a uint256 does not survive a JSON number). */
export function publicOrder(row: OrderRow): Record<string, string | number | boolean | null> {
  return {
    orderId: row.orderId.toString(),
    termsId: row.termsId.toString(),
    voucherId: row.voucherId === 0n ? null : row.voucherId.toString(),
    store: row.store,
    mode: row.mode === 0 ? 'CARRIER' : 'OWN_MEANS',
    prize: row.prize,
    state: row.state,
    flags: row.flags,
    shipBy: (row.paidAt + BigInt(row.shipDays) * 86_400n).toString(),
    deliverBy: row.shippedAt === 0n ? null : (row.shippedAt + BigInt(row.deliveryDays) * 86_400n).toString(),
    windowEndsAt: row.windowEndsAt === 0n ? null : row.windowEndsAt.toString(),
    contestedAt: row.contestedAt === 0n ? null : row.contestedAt.toString(),
    outcome: row.outcome,
  };
}

/** Writes an order as last seen. One row per order (the primary key), rewritten on every change. */
export async function saveOrder(row: OrderRow): Promise<void> {
  checked(
    'order.save',
    await getDb()
      .from('bridge_v2_orders')
      .upsert(
        {
          order_id: row.orderId.toString(),
          terms_id: row.termsId.toString(),
          voucher_id: row.voucherId.toString(),
          store_address: getAddress(row.store),
          payer_address: getAddress(row.payer),
          mode: row.mode,
          prize: row.prize,
          ship_days: row.shipDays,
          delivery_days: row.deliveryDays,
          state: row.state,
          flags: row.flags,
          paid_at: row.paidAt.toString(),
          shipped_at: row.shippedAt.toString(),
          window_ends_at: row.windowEndsAt.toString(),
          contested_at: row.contestedAt.toString(),
          seen_block: row.seenBlock.toString(),
          outcome: row.outcome,
          closed_at: row.closedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'order_id' },
      )
      .abortSignal(timeout()),
  );
}

/** A filter of the orders index, as data: the builder's own type does not survive being passed around. */
type OrderFilter = readonly ['eq', string, string | number] | readonly ['in', string, readonly number[]] | readonly ['is', string, null];

async function selectOrders(operation: string, filters: readonly OrderFilter[]): Promise<OrderRow[]> {
  let query = getDb().from('bridge_v2_orders').select(ORDER_COLUMNS);
  for (const [kind, column, value] of filters) {
    query = kind === 'in' ? query.in(column, [...(value as readonly number[])]) : kind === 'eq' ? query.eq(column, value as string | number) : query.is(column, null);
  }
  const rows = checked(operation, await query.order('order_id', { ascending: true }).abortSignal(timeout())) as OrderDbRow[] | null;
  return (rows ?? []).map(toOrderRow);
}

/** P5-4: rows per page of the open orders read. */
const OPEN_ORDERS_PAGE = 500;

/**
 * Every order the pass still has work on: not in its final state, or in it with
 * the close not yet recorded (Adenda R1). closed_at is written last, once the
 * erasure date is set and the mark settled, so a close cut short by a failure is
 * read again and finished by a later pass.
 *
 * P5-4: all of them, whatever their number — a page at a time by id, until a page
 * comes back empty, so no cap on the rows one answer holds leaves any unread —
 * and the least recently synced first, so a pass the clock cuts short leaves the
 * rest at the front of the next one.
 */
export async function openOrders(): Promise<OrderRow[]> {
  const all: OrderRow[] = [];
  let after = '0';
  for (;;) {
    const rows = checked(
      'order.open',
      await getDb()
        .from('bridge_v2_orders')
        .select(ORDER_COLUMNS)
        .is('closed_at', null)
        .gt('order_id', after)
        .order('order_id', { ascending: true })
        .limit(OPEN_ORDERS_PAGE)
        .abortSignal(timeout()),
    ) as OrderDbRow[] | null;
    if (rows === null || rows.length === 0) break;
    all.push(...rows.map(toOrderRow));
    after = String(rows[rows.length - 1].order_id);
  }
  return all.sort((a, b) => (a.syncedAt ?? '').localeCompare(b.syncedAt ?? '') || (a.orderId < b.orderId ? -1 : 1));
}

export async function orderRow(orderId: bigint): Promise<OrderRow | null> {
  const [row] = await selectOrders('order.one', [['eq', 'order_id', orderId.toString()]]);
  return row ?? null;
}

/**
 * P5-12: a new order that cannot be read or written down is kept here, apart,
 * with how many passes tried it — so the discovery of the orders after it goes
 * on, and it is read again every pass until it can be.
 */
export async function recordUnreadOrder(orderId: bigint): Promise<number> {
  const existing = checkedMaybe(
    'order.unread_read',
    await getDb().from('bridge_v2_order_unread').select('attempts').eq('order_id', orderId.toString()).abortSignal(timeout()).maybeSingle(),
  ) as { attempts: number } | null;
  const attempts = (existing?.attempts ?? 0) + 1;
  checked(
    'order.unread_record',
    await getDb()
      .from('bridge_v2_order_unread')
      .upsert({ order_id: orderId.toString(), attempts, last_failed_at: new Date().toISOString() }, { onConflict: 'order_id' })
      .abortSignal(timeout()),
  );
  return attempts;
}

/** P5-12: the orders read aside, to be read again. */
export async function unreadOrderIds(): Promise<bigint[]> {
  const rows = checked(
    'order.unread',
    await getDb().from('bridge_v2_order_unread').select('order_id').order('order_id', { ascending: true }).abortSignal(timeout()),
  ) as { order_id: number | string }[] | null;
  return (rows ?? []).map((row) => big(row.order_id));
}

/** P5-12: read at last, it leaves the list. */
export async function clearUnreadOrder(orderId: bigint): Promise<void> {
  checked('order.unread_clear', await getDb().from('bridge_v2_order_unread').delete().eq('order_id', orderId.toString()).abortSignal(timeout()));
}

/** The highest order id this side has seen, or zero. */
export async function lastKnownOrderId(): Promise<bigint> {
  const rows = checked(
    'order.last',
    await getDb().from('bridge_v2_orders').select('order_id').order('order_id', { ascending: false }).limit(1).abortSignal(timeout()),
  ) as { order_id: number | string }[] | null;
  return rows?.[0] === undefined ? 0n : big(rows[0].order_id);
}

/** A recipient's orders (H23: in COMPRA the payer is the recipient; in PRÉMIO, who redeemed). */
export function ordersOfPayer(safe: `0x${string}`): Promise<OrderRow[]> {
  return selectOrders('order.of_payer', [['eq', 'payer_address', getAddress(safe)]]);
}

/** A store's orders (P2: its creator account is the store the terms name). */
export function ordersOfStore(safe: `0x${string}`): Promise<OrderRow[]> {
  return selectOrders('order.of_store', [['eq', 'store_address', getAddress(safe)]]);
}

/**
 * 10.3: the clock of an order's erasure starts at its final state. Its address,
 * its shipment and its evidence are erased ERASE_AFTER_CLOSE_DAYS later.
 */
export async function scheduleErasure(orderId: bigint, closedAt: Date): Promise<void> {
  const eraseAfter = new Date(closedAt.getTime() + ERASE_AFTER_CLOSE_DAYS * DAY_MS).toISOString();
  for (const table of ['bridge_v2_order_addresses', 'bridge_v2_order_shipments', 'bridge_v2_order_evidence']) {
    checked(
      'order.erasure_schedule',
      await getDb().from(table).update({ erase_after: eraseAfter }).eq('order_id', orderId.toString()).is('erase_after', null).abortSignal(timeout()),
    );
  }
}

/**
 * 10.3: real erasure — rows deleted, not pseudonymised — of everything whose time
 * has come, and of addresses registered for an order that never came, the same
 * number of days after they were written.
 */
export async function eraseExpired(now: Date = new Date()): Promise<number> {
  let erased = 0;
  for (const table of ['bridge_v2_order_addresses', 'bridge_v2_order_shipments', 'bridge_v2_order_evidence']) {
    const rows = checked(
      'order.erase',
      await getDb().from(table).delete().lte('erase_after', now.toISOString()).select('order_id').abortSignal(timeout()),
    ) as unknown[] | null;
    erased += (rows ?? []).length;
  }
  const drafts = checked(
    'order.erase_drafts',
    await getDb()
      .from('bridge_v2_order_addresses')
      .delete()
      .is('order_id', null)
      .lte('created_at', new Date(now.getTime() - ERASE_AFTER_CLOSE_DAYS * DAY_MS).toISOString())
      .select('id')
      .abortSignal(timeout()),
  ) as unknown[] | null;
  return erased + (drafts ?? []).length;
}

/**
 * P18: an erasure request. Addresses no order took, and those of orders already
 * in their final state, go now with what travels with them; those of orders still
 * open go their 29 days after the final state, as every address does. Returns how
 * many were deferred, which the response tells the participant.
 */
export async function eraseAddressesOf(participantId: string, limit = Number.POSITIVE_INFINITY): Promise<{ erased: number; deferred: number }> {
  const rows = checked(
    'order.erase_mine',
    await getDb().from('bridge_v2_order_addresses').select('id, order_id').eq('participant_id', participantId).abortSignal(timeout()),
  ) as Pick<AddressRow, 'id' | 'order_id'>[] | null;
  let erased = 0;
  let deferred = 0;
  for (const row of rows ?? []) {
    // SPEC-BLOCO-03 T13: the request erases at most `limit` now, so its route can
    // declare a duration (F7); the rest carry their erasure date already (10.3,
    // scheduleErasure and the unbound rows' own) and go with the hourly pass.
    if (erased >= limit) {
      deferred += 1;
      continue;
    }
    if (row.order_id != null) {
      const order = await orderRow(big(row.order_id));
      if (order === null || order.state !== OrderState.CLOSED) {
        deferred += 1;
        continue;
      }
      for (const table of ['bridge_v2_order_shipments', 'bridge_v2_order_evidence']) {
        checked('order.erase_mine_related', await getDb().from(table).delete().eq('order_id', String(row.order_id)).abortSignal(timeout()));
      }
    }
    checked('order.erase_mine_address', await getDb().from('bridge_v2_order_addresses').delete().eq('id', row.id).abortSignal(timeout()));
    erased += 1;
  }
  return { erased, deferred };
}

// -----------------------------------------------------------------------------
// shipments — 9.1.1, H17, M9
// -----------------------------------------------------------------------------

export interface Shipment {
  readonly orderId: bigint;
  readonly trackingHash: Hex;
  readonly trackerId: string | null;
}

interface ShipmentRow {
  order_id: number | string;
  tracking_hash: string;
  tracking_enc: string;
  tracker_id: string | null;
}

const toShipment = (row: ShipmentRow): Shipment => ({
  orderId: big(row.order_id),
  trackingHash: row.tracking_hash as Hex,
  trackerId: row.tracker_id ?? null,
});

/** P6-20: which of these orders have a shipment registered, in one read. */
export async function ordersWithShipment(orderIds: readonly bigint[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const rows = checked(
    'order.shipments_many',
    await getDb().from('bridge_v2_order_shipments').select('order_id').in('order_id', orderIds.map(String)).abortSignal(timeout()),
  ) as { order_id: number | string }[] | null;
  return new Set((rows ?? []).map((row) => String(row.order_id)));
}

export async function shipmentOf(orderId: bigint): Promise<Shipment | null> {
  const row = checkedMaybe(
    'order.shipment',
    await getDb().from('bridge_v2_order_shipments').select('order_id, tracking_hash, tracker_id').eq('order_id', orderId.toString()).abortSignal(timeout()).maybeSingle(),
  ) as ShipmentRow | null;
  return row === null ? null : toShipment(row);
}

/**
 * I6: one tracking hash, one order — the unique constraint is the authority, and
 * the second registration of a number is refused here, before the store signs a
 * ship() the escrow would refuse.
 */
export async function registerShipment(orderId: bigint, trackingHash: Hex, trackingNumber: string): Promise<'ok' | 'hash_used' | 'order_has_shipment'> {
  const { error } = await getDb()
    .from('bridge_v2_order_shipments')
    .insert({
      order_id: orderId.toString(),
      tracking_hash: trackingHash.toLowerCase(),
      tracking_enc: await encryptUnder(ROOT, ADDRESS_LABEL, trackingNumber),
    })
    .abortSignal(timeout());
  if (error === null) return 'ok';
  if ((error as { code?: string }).code === '23505') {
    return (await shipmentOf(orderId)) === null ? 'hash_used' : 'order_has_shipment';
  }
  return checked('order.shipment_insert', { data: null, error }) as never;
}

/** M9: the provider's identifier, kept — the oracle reads the shipment by it (M6). */
export async function setTracker(orderId: bigint, trackerId: string): Promise<void> {
  checked(
    'order.tracker',
    await getDb()
      .from('bridge_v2_order_shipments')
      .update({ tracker_id: trackerId, updated_at: new Date().toISOString() })
      .eq('order_id', orderId.toString())
      .abortSignal(timeout()),
  );
}

/**
 * P5-3: a shipment leaves the queue of retries for good — the provider refused it
 * for what it is (REFUSED), or its order reached its final state (CLOSED).
 */
export async function stopTrackerRetry(orderId: bigint, reason: 'REFUSED' | 'CLOSED'): Promise<void> {
  checked(
    'order.tracker_stop',
    await getDb()
      .from('bridge_v2_order_shipments')
      .update({ retry_stopped_at: new Date().toISOString(), retry_stop_reason: reason, updated_at: new Date().toISOString() })
      .eq('order_id', orderId.toString())
      .is('tracker_id', null)
      .is('retry_stopped_at', null)
      .abortSignal(timeout()),
  );
}

/**
 * 9.5.5: shipments the provider has not taken yet, oldest first, with the number
 * to send again. P5-3: never one whose retries stopped.
 */
export async function shipmentsWithoutTracker(limit: number): Promise<Array<Shipment & { trackingNumber: string | null }>> {
  const rows = checked(
    'order.shipment_untracked',
    await getDb()
      .from('bridge_v2_order_shipments')
      .select('order_id, tracking_hash, tracking_enc, tracker_id')
      .is('tracker_id', null)
      .is('retry_stopped_at', null)
      .order('created_at', { ascending: true })
      .limit(limit)
      .abortSignal(timeout()),
  ) as ShipmentRow[] | null;
  const out = [];
  for (const row of rows ?? []) {
    out.push({ ...toShipment(row), trackingNumber: await decryptUnder(ROOT, ADDRESS_LABEL, row.tracking_enc) });
  }
  return out;
}

/**
 * M9, N7, N3 (B3-B7 of piece 4's matrix): the orders the oracle may attest now —
 * TRANSPORTADORA only; shipped, or in a window a declaration opened with no proof
 * yet (the oracle's stillWorthAttesting); with a tracker and an address — as
 * {orderId, trackerId, postCode}.
 *
 * B8 (X10, Y5): an order in a window the store's declaration opened stays on the
 * list until that window ends — the carrier's refusal still counts there (the
 * escrow of 5d85a46, _refusableWindow) — and leaves it at the end, when neither a
 * refusal nor anything else the oracle says changes it any more.
 *
 * At most ORACLE_PENDING_PAGE of them, rotated by the workflow's schedule slot:
 * the oracle takes the first 13 it is given, and the same 13 every time would
 * leave the rest unasked for ever. Within one slot the answer is the same for
 * every node of the DON, which the identical-aggregation consensus needs; P5-10
 * puts the slot's turn half a slot away from the workflow's firing.
 * ponytail: an order that changes state inside a slot changes the body for the
 * nodes that ask after it; that run of the oracle does nothing and the next one
 * reads the new list.
 */
export async function oraclePending(nowSeconds: number): Promise<Array<{ orderId: string; trackerId: string; postCode: string }>> {
  const rows = (
    await selectOrders('order.oracle_candidates', [
      ['eq', 'mode', OrderMode.CARRIER],
      ['in', 'state', [OrderState.SHIPPED, OrderState.WINDOW]],
    ])
  ).filter(
    (row) =>
      row.state === OrderState.SHIPPED ||
      ((row.flags & (OrderFlag.PROOF | OrderFlag.REFUSAL)) === 0 && BigInt(Math.floor(nowSeconds)) <= row.windowEndsAt),
  );
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.orderId.toString());
  const shipments = checked(
    'order.oracle_shipments',
    await getDb().from('bridge_v2_order_shipments').select('order_id, tracking_hash, tracker_id').in('order_id', ids).abortSignal(timeout()),
  ) as ShipmentRow[] | null;
  const trackerOf = new Map((shipments ?? []).filter((row) => row.tracker_id).map((row) => [String(row.order_id), row.tracker_id as string]));

  // B7: one tracker, one order. A tracker named twice serves neither.
  const seen = new Map<string, number>();
  for (const tracker of trackerOf.values()) seen.set(tracker.toLowerCase(), (seen.get(tracker.toLowerCase()) ?? 0) + 1);
  const candidates = rows.filter((row) => {
    const tracker = trackerOf.get(row.orderId.toString());
    return tracker !== undefined && seen.get(tracker.toLowerCase()) === 1;
  });

  let chosen = candidates;
  if (candidates.length > ORACLE_PENDING_PAGE) {
    const slot = rotationSlot(nowSeconds);
    const start = (slot * ORACLE_PENDING_PAGE) % candidates.length;
    chosen = Array.from({ length: ORACLE_PENDING_PAGE }, (_unused, i) => candidates[(start + i) % candidates.length]);
    chosen.sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
  }

  const out = [];
  for (const row of chosen) {
    const address = await addressOfOrder(row.orderId);
    if (address === null) continue;
    out.push({ orderId: row.orderId.toString(), trackerId: trackerOf.get(row.orderId.toString()) as string, postCode: address.postCode });
  }
  return out;
}

/** P5-10: the rotation's slot at `nowSeconds`, turning half a slot after the oracle fires. */
export function rotationSlot(nowSeconds: number): number {
  return Math.floor((nowSeconds - ORACLE_ROTATION_OFFSET_SECONDS) / ORACLE_ROTATION_SECONDS);
}

// -----------------------------------------------------------------------------
// evidence — P17
// -----------------------------------------------------------------------------

export type EvidenceParty = 'RECIPIENT' | 'STORE';

/** P17: one text per party, written once; the second attempt of a party is refused, so the arbiter's hash never moves. */
export async function writeEvidence(orderId: bigint, party: EvidenceParty, body: string): Promise<boolean> {
  const { error } = await getDb()
    .from('bridge_v2_order_evidence')
    .insert({ order_id: orderId.toString(), party, text_enc: await encryptUnder(ROOT, EVIDENCE_LABEL, body) })
    .abortSignal(timeout());
  if (error === null) return true;
  if ((error as { code?: string }).code === '23505') return false;
  return checked('order.evidence_insert', { data: null, error }) as never;
}

/**
 * P5-7 and D7: the texts a participant wrote as a party — as the recipient of the
 * orders its participant account paid or redeemed, and as the store of the orders
 * its creator account sells — decrypted, for the export. Never the other party's.
 */
export async function evidenceWrittenBy(
  recipient: `0x${string}` | null,
  store: `0x${string}` | null,
): Promise<Array<{ orderId: string; party: EvidenceParty; text: string | null }>> {
  const out: Array<{ orderId: string; party: EvidenceParty; text: string | null }> = [];
  for (const [party, orders] of [
    ['RECIPIENT', recipient === null ? [] : await ordersOfPayer(recipient)],
    ['STORE', store === null ? [] : await ordersOfStore(store)],
  ] as const) {
    if (orders.length === 0) continue;
    const rows = checked(
      'order.evidence_export',
      await getDb()
        .from('bridge_v2_order_evidence')
        .select('order_id, text_enc')
        .eq('party', party)
        .in('order_id', orders.map((row) => row.orderId.toString()))
        .abortSignal(timeout()),
    ) as { order_id: number | string; text_enc: string }[] | null;
    for (const row of rows ?? []) {
      out.push({ orderId: String(row.order_id), party, text: await decryptUnder(ROOT, EVIDENCE_LABEL, row.text_enc) });
    }
  }
  return out;
}

/** P17: both texts of a contest, decrypted, for the two parties and the arbiter. */
export async function evidenceOf(orderId: bigint): Promise<{ recipient: string | null; store: string | null }> {
  const rows = checked(
    'order.evidence_read',
    await getDb().from('bridge_v2_order_evidence').select('party, text_enc').eq('order_id', orderId.toString()).abortSignal(timeout()),
  ) as { party: EvidenceParty; text_enc: string }[] | null;
  const out: { recipient: string | null; store: string | null } = { recipient: null, store: null };
  for (const row of rows ?? []) {
    const plain = await decryptUnder(ROOT, EVIDENCE_LABEL, row.text_enc);
    if (row.party === 'RECIPIENT') out.recipient = plain;
    else out.store = plain;
  }
  return out;
}

// -----------------------------------------------------------------------------
// notices — 8.3, P4, P22
// -----------------------------------------------------------------------------

/** Y5 adds WINDOW_REFUSED: a declared window the carrier's refusal closed before its end. */
export type OrderNoticeKind = 'WINDOW_OPENED' | 'WINDOW_CLOSING' | 'STORE_ORDER' | 'ARBITER_CONTEST' | 'WINDOW_REFUSED';

/** P5-4: order ids per read of the notices sent, so a long list of orders stays one short request each. */
const NOTICE_READ_CHUNK = 200;

/** The notices already sent for these orders, as "orderId:KIND". */
export async function sentOrderNotices(orderIds: readonly bigint[]): Promise<Set<string>> {
  const sent = new Set<string>();
  for (let start = 0; start < orderIds.length; start += NOTICE_READ_CHUNK) {
    const rows = checked(
      'order.notices_sent',
      await getDb()
        .from('bridge_v2_order_notices')
        .select('order_id, kind')
        .in('order_id', orderIds.slice(start, start + NOTICE_READ_CHUNK).map(String))
        .abortSignal(timeout()),
    ) as { order_id: number | string; kind: string }[] | null;
    for (const row of rows ?? []) sent.add(`${row.order_id}:${row.kind}`);
  }
  return sent;
}

/** Recorded after the send succeeded: a duplicate beats a lost notice, as the recovery notices have it. */
export async function recordOrderNotice(orderId: bigint, kind: OrderNoticeKind): Promise<void> {
  const { error } = await getDb().from('bridge_v2_order_notices').insert({ order_id: orderId.toString(), kind }).abortSignal(timeout());
  if (error !== null && (error as { code?: string }).code !== '23505') checked('order.notice_record', { data: null, error });
}

// -----------------------------------------------------------------------------
// recipient marks — 13.1, P5
// -----------------------------------------------------------------------------

export type MarkStatus = 'RESERVED' | 'MARKED' | 'RELEASED' | 'SKIPPED';

export async function markOf(orderId: bigint): Promise<{ status: MarkStatus } | null> {
  return checkedMaybe(
    'order.mark',
    await getDb().from('bridge_v2_recipient_marks').select('status').eq('order_id', orderId.toString()).abortSignal(timeout()).maybeSingle(),
  ) as { status: MarkStatus } | null;
}

/**
 * P5: a number counts once per store. The reservation IS that rule — a partial
 * unique index over (store, phone) among RESERVED and MARKED rows — so of two
 * orders from one number to one store only one is ever marked, and a second
 * becomes markable only once the first is released (its delivery did not count).
 */
export async function reserveMark(orderId: bigint, store: `0x${string}`, phoneHmac: string): Promise<boolean> {
  const { error } = await getDb()
    .from('bridge_v2_recipient_marks')
    .insert({ order_id: orderId.toString(), store_address: getAddress(store), phone_hmac: phoneHmac, status: 'RESERVED' })
    .abortSignal(timeout());
  if (error === null) return true;
  if ((error as { code?: string }).code === '23505') {
    // Either this order already has a row, or the (store, number) pair is taken.
    return false;
  }
  return checked('order.mark_reserve', { data: null, error }) as never;
}

/** P5: an order that can never count — the store's own person, or no Keptra account — is decided once. */
export async function skipMark(orderId: bigint, store: `0x${string}`): Promise<void> {
  const { error } = await getDb()
    .from('bridge_v2_recipient_marks')
    .insert({ order_id: orderId.toString(), store_address: getAddress(store), phone_hmac: null, status: 'SKIPPED' })
    .abortSignal(timeout());
  if (error !== null && (error as { code?: string }).code !== '23505') checked('order.mark_skip', { data: null, error });
}

export async function setMarkStatus(orderId: bigint, status: MarkStatus): Promise<void> {
  checked(
    'order.mark_status',
    await getDb()
      .from('bridge_v2_recipient_marks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('order_id', orderId.toString())
      .abortSignal(timeout()),
  );
}

// -----------------------------------------------------------------------------
// vouchers the scan no longer reads
// -----------------------------------------------------------------------------

/** Vouchers that can never be voided again: voided already, or burned with their unit (P11's scan skips them). */
export async function finishedVouchers(): Promise<Set<string>> {
  const rows = checked('order.vouchers_finished', await getDb().from('bridge_v2_finished_vouchers').select('voucher_id').abortSignal(timeout())) as
    | { voucher_id: number | string }[]
    | null;
  return new Set((rows ?? []).map((row) => String(row.voucher_id)));
}

export async function recordFinishedVoucher(voucherId: bigint): Promise<void> {
  const { error } = await getDb().from('bridge_v2_finished_vouchers').insert({ voucher_id: voucherId.toString() }).abortSignal(timeout());
  if (error !== null && (error as { code?: string }).code !== '23505') checked('order.voucher_finished', { data: null, error });
}
