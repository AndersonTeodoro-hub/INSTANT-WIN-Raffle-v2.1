/**
 * Entry lifecycle. G5, and the uniqueness rule of the 05/09/2026 decision.
 *
 * An entry moves AWAITING_CONTACT, VERIFIED, ELIGIBLE, FUNDING, SUBMITTED,
 * CONFIRMED, with FAILED as the terminal alternative. Every state is written by
 * a path in this module, which is I8: the V1 declared PENDING_CODE in its schema
 * and never wrote it, so the schema described a machine the code did not run.
 *
 * G5 is carried by idempotency_key, derived from the participant and the
 * campaign and unique in the table. A repeated request finds the existing row
 * instead of creating a second one, so no repetition produces a second entry, a
 * second funding, or a second email.
 */

import { checked, checkedMaybe, getWriter } from './db.js';
import { sha256Hex } from './crypto.js';
import type { Participant } from './participants.js';

export type EntryStatus =
  | 'AWAITING_CONTACT'
  | 'VERIFIED'
  | 'ELIGIBLE'
  | 'FUNDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export interface Entry {
  readonly id: string;
  readonly participantId: string;
  readonly giveawayId: bigint;
  readonly status: EntryStatus;
  readonly walletAddress: `0x${string}`;
  readonly phoneHmac: string | null;
  readonly rootIndex: bigint | null;
  readonly txHash: string | null;
}

interface EntryRow {
  id: string;
  participant_id: string;
  giveaway_id: string;
  status: EntryStatus;
  wallet_address: string;
  phone_hmac: string | null;
  root_index: string | null;
  tx_hash: string | null;
}

const COLUMNS =
  'id, participant_id, giveaway_id, status, wallet_address, phone_hmac, root_index, tx_hash';

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    participantId: row.participant_id,
    giveawayId: BigInt(row.giveaway_id),
    status: row.status,
    walletAddress: row.wallet_address as `0x${string}`,
    phoneHmac: row.phone_hmac,
    rootIndex: row.root_index === null ? null : BigInt(row.root_index),
    txHash: row.tx_hash,
  };
}

/** G5: stable per participant and campaign, so a repeat is recognisable. */
function idempotencyKey(participantId: string, giveawayId: bigint): Promise<string> {
  return sha256Hex(`entry:${participantId}:${giveawayId.toString()}`);
}

export async function findEntry(participantId: string, giveawayId: bigint): Promise<Entry | null> {
  const db = await getWriter();
  const row = checkedMaybe(
    'entry.find',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('participant_id', participantId)
      .eq('giveaway_id', giveawayId.toString())
      .maybeSingle(),
  ) as EntryRow | null;
  return row === null ? null : toEntry(row);
}

/**
 * Opens an entry, or returns the one that already exists.
 *
 * Called when the participant asks for a confirmation link. The row is created
 * before the link so the bot has something to attach the verified number to, and
 * so a second request for the same campaign reuses it rather than opening a
 * parallel one.
 */
export async function openEntry(participant: Participant, giveawayId: bigint): Promise<Entry> {
  const existing = await findEntry(participant.id, giveawayId);
  if (existing !== null) return existing;

  const db = await getWriter();
  const inserted = await db
    .from('bridge_v2_entries')
    .insert({
      participant_id: participant.id,
      giveaway_id: giveawayId.toString(),
      status: 'AWAITING_CONTACT',
      wallet_address: participant.walletAddress,
      idempotency_key: await idempotencyKey(participant.id, giveawayId),
    })
    .select(COLUMNS)
    .maybeSingle();

  if (inserted.error) {
    // The unique constraint won a race. Read the winner rather than failing:
    // from the participant's side nothing went wrong.
    const winner = await findEntry(participant.id, giveawayId);
    if (winner !== null) return winner;
    throw new Error('[bridge-v2] entry could not be opened');
  }

  return toEntry(inserted.data as EntryRow);
}

/**
 * Advances an entry, refusing when it is no longer in the state expected.
 *
 * G2: the result decides. A transition that matched no row means another
 * invocation moved the entry first, and carrying on would duplicate its work —
 * a second funding, or a second enter().
 */
export async function advance(
  entryId: string,
  from: EntryStatus,
  to: EntryStatus,
  extra: Record<string, string | null> = {},
): Promise<boolean> {
  const db = await getWriter();
  const updated = await db
    .from('bridge_v2_entries')
    .update({ status: to, updated_at: new Date().toISOString(), ...extra })
    .eq('id', entryId)
    .eq('status', from)
    .select('id')
    .maybeSingle();

  if (updated.error) return false;
  return updated.data !== null;
}

/** Entries waiting for a root, for one campaign. Used to batch a publication. */
export async function listVerified(giveawayId: bigint, limit: number): Promise<Entry[]> {
  const db = await getWriter();
  const rows = checked(
    'entry.list_verified',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('giveaway_id', giveawayId.toString())
      .eq('status', 'VERIFIED')
      .order('created_at', { ascending: true })
      .limit(limit),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/** Campaigns with work waiting, so the processor never scans the id space (C10 of the contract spec). */
export async function campaignsWithVerified(limit: number): Promise<bigint[]> {
  const db = await getWriter();
  const rows = checked(
    'entry.campaigns_pending',
    await db
      .from('bridge_v2_entries')
      .select('giveaway_id')
      .eq('status', 'VERIFIED')
      .limit(limit),
  ) as Array<{ giveaway_id: string }> | null;
  if (!Array.isArray(rows)) return [];
  return [...new Set(rows.map((row) => row.giveaway_id))].map((id) => BigInt(id));
}

/** Entries admitted to a root and waiting to be funded and submitted. */
export async function listEligible(limit: number): Promise<Entry[]> {
  const db = await getWriter();
  const rows = checked(
    'entry.list_eligible',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('status', 'ELIGIBLE')
      .order('updated_at', { ascending: true })
      .limit(limit),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/**
 * Entries broadcast but not yet reconciled.
 *
 * K3: the V1 lost the transaction hash when a function died mid-wait, so an
 * entry that had actually been submitted looked like one that never was. The
 * hash is written before the wait, and this list is how a later pass finishes
 * the reconciliation.
 */
export async function listSubmitted(limit: number): Promise<Entry[]> {
  const db = await getWriter();
  const rows = checked(
    'entry.list_submitted',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('status', 'SUBMITTED')
      .order('updated_at', { ascending: true })
      .limit(limit),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/** Entries that reached the chain, for the H7 sweep. */
export async function listConfirmed(limit: number): Promise<Entry[]> {
  const db = await getWriter();
  const rows = checked(
    'entry.list_confirmed',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('status', 'CONFIRMED')
      .order('updated_at', { ascending: true })
      .limit(limit),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}
