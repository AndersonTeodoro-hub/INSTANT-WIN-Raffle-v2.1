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

import { checked, checkedMaybe, DatabaseError, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';
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
  /** 07/09/2026 decision: true once the participant declared their own address. */
  readonly selfCustody: boolean;
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
  self_custody: boolean;
}

/**
 * giveaway_id and root_index are cast to text by the database, not converted by
 * this process.
 *
 * Both are numeric(78,0), and PostgREST renders a numeric as a JSON number.
 * JSON.parse turns that into an IEEE double, so any id past 2^53 arrives already
 * rounded and BigInt() either throws on the fractional result or silently yields
 * a different campaign. The declared type of the row said string while the value
 * was a number, which is exactly the shape of bug that survives a type checker.
 * ::text makes the wire format match the declaration, and the conversion to
 * bigint then happens from an exact decimal string.
 */
const COLUMNS =
  'id, participant_id, giveaway_id::text, status, wallet_address, phone_hmac, root_index::text, tx_hash, self_custody';

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
    selfCustody: row.self_custody,
  };
}

/** G5: stable per participant and campaign, so a repeat is recognisable. */
function idempotencyKey(participantId: string, giveawayId: bigint): Promise<string> {
  return sha256Hex(`entry:${participantId}:${giveawayId.toString()}`);
}

export async function findEntry(participantId: string, giveawayId: bigint): Promise<Entry | null> {
  const db = getDb();
  const row = checkedMaybe(
    'entry.find',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('participant_id', participantId)
      .eq('giveaway_id', giveawayId.toString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as EntryRow | null;
  return row === null ? null : toEntry(row);
}

export type DeclareAddressOutcome = 'DECLARED' | 'ADDRESS_TAKEN' | 'NOT_DECLARABLE';

/**
 * 07/09/2026 decision: a verified participant may declare their own address as
 * the eligibility target instead of the derived wallet.
 *
 * Only while the entry is still AWAITING_CONTACT or VERIFIED. C8: once an
 * address sits inside a published root nobody can take it out again, and
 * ELIGIBLE is exactly the state that means a root already covers this entry —
 * so those are the only two states the WHERE clause admits.
 *
 * Uniqueness is the database's, not this function's: bridge_v2_entries_
 * giveaway_address_unique (0007 migration) is the authority. A race between
 * two participants declaring the same address in the same campaign resolves
 * by which UPDATE's commit the constraint accepts, never by a read this
 * function did earlier (G1).
 */
export async function declareOwnAddress(
  entryId: string,
  address: `0x${string}`,
): Promise<DeclareAddressOutcome> {
  const db = getDb();
  const result = await db
    .from('bridge_v2_entries')
    .update({ wallet_address: address, self_custody: true, updated_at: new Date().toISOString() })
    .eq('id', entryId)
    .in('status', ['AWAITING_CONTACT', 'VERIFIED'])
    .select('id')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();

  if (result.error) {
    // 23505 is bridge_v2_entries_giveaway_address_unique: this address already
    // sits on another entry in this campaign. Nothing else is this function's
    // to distinguish (G2) — any other error is a real failure and throws.
    if ((result.error as { code?: string }).code === '23505') return 'ADDRESS_TAKEN';
    throw new DatabaseError('entry.declare_own_address');
  }

  return result.data === null ? 'NOT_DECLARABLE' : 'DECLARED';
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

  const db = getDb();
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
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
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
 *
 * AND A DATABASE ERROR IS NOT THAT. Both were being returned as false, and the
 * two say opposite things to every caller: false-because-no-row means the work
 * belongs to somebody else and this run should stop, while false-because-the-
 * write-failed means the entry is still exactly where it was and nothing
 * recorded what this run just did. The funding path reads the second as the
 * first and returns quietly, having moved gas and having written nothing about
 * it.
 *
 * So an error throws, and the callers that must survive one catch it per entry
 * rather than per run.
 */
export async function advance(
  entryId: string,
  from: EntryStatus,
  to: EntryStatus,
  extra: Record<string, string | null> = {},
): Promise<boolean> {
  const db = getDb();
  const updated = checkedMaybe(
    'entry.advance',
    await db
      .from('bridge_v2_entries')
      .update({ status: to, updated_at: new Date().toISOString(), ...extra })
      .eq('id', entryId)
      .eq('status', from)
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );

  return updated !== null;
}

/** Entries waiting for a root, for one campaign. Used to batch a publication. */
export async function listVerified(giveawayId: bigint, limit: number): Promise<Entry[]> {
  const db = getDb();
  const rows = checked(
    'entry.list_verified',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('giveaway_id', giveawayId.toString())
      .eq('status', 'VERIFIED')
      .order('created_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/**
 * Campaigns with work waiting, so the processor never scans the id space (C10 of
 * the contract spec).
 *
 * C8/G4: THE LIMIT APPLIES TO CAMPAIGNS, WHICH IS WHAT THE CALLER IS COUNTING.
 * It used to apply to entry rows: twenty of them were read, with no order and no
 * distinct, and whatever campaigns happened to appear among those twenty were
 * what the publication stage got to see. A campaign holding twenty VERIFIED
 * entries filled the whole result on its own and every other campaign waited —
 * indefinitely, because the same twenty rows came back on the next run, and the
 * run after that. One campaign that could not progress stopped root publication
 * for all of them, which any creator could cause by accident and any attacker on
 * purpose.
 *
 * Distinct is half of it; the order is the other half. Grouping by campaign and
 * ordering by the oldest VERIFIED entry each one holds means the campaign that
 * has been waiting longest is served first, and no campaign appears more than
 * once however many entries it is holding. Both happen in the database, because
 * doing them here would mean reading every VERIFIED row on the platform in order
 * to sort twenty of them.
 */
export async function campaignsWithVerified(limit: number): Promise<bigint[]> {
  const db = getDb();
  const rows = checked(
    'entry.campaigns_pending',
    await db
      .rpc('bridge_v2_campaigns_with_verified', { p_limit: limit })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as Array<{ giveaway_id: string }> | null;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => BigInt(row.giveaway_id));
}

/**
 * Entries admitted to a root and waiting to move again — funded and
 * submitted by the bridge, or, for a self_custody entry (07/09/2026
 * decision), simply asked whether the participant has entered on their own.
 * One query for both: processEligibleEntries (processor.ts) branches on
 * selfCustody per row rather than this module running two differently
 * filtered queries against the same table for what is, to the caller, one
 * queue of entries waiting on the next thing to happen to them.
 */
export async function listEligible(limit: number): Promise<Entry[]> {
  const db = getDb();
  const rows = checked(
    'entry.list_eligible',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('status', 'ELIGIBLE')
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
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
  const db = getDb();
  const rows = checked(
    'entry.list_submitted',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('status', 'SUBMITTED')
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/**
 * Entries left in a state no run is holding any more. I8.
 *
 * FUNDING was written by one path and read by none. It is entered between the
 * decision to fund and the broadcast of enter(), and it is left by the same
 * invocation on every branch that invocation can reach — which is fine until the
 * invocation itself stops existing. A function the platform kills at its
 * duration limit, a container that goes away, a database error between the
 * broadcast and the row: each leaves an entry in FUNDING, and no query listed
 * FUNDING, so nothing ever looked at it again. The participant is verified, the
 * campaign has their slot, and their entry is in a state whose only remaining
 * property is that it is not any of the others. That is a terminal state reached
 * by accident, which is exactly what I8 exists to forbid.
 *
 * The threshold is what makes this safe rather than a second race: FUNDING is
 * only ever held inside a single scheduled run, a run cannot outlive its own
 * maxDuration, and one run at a time holds the pipeline lock. Anything older
 * than that plus a margin belongs to a run that has certainly stopped.
 */
export async function listStale(
  status: EntryStatus,
  olderThanMs: number,
  limit: number,
): Promise<Entry[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = checked(
    'entry.list_stale',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .eq('status', status)
      .lt('updated_at', cutoff)
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/**
 * H7: derived wallets that have been given gas and not dealt with since.
 *
 * TWO THINGS USED TO NARROW THIS, AND BOTH LEFT GAS BEHIND FOR EVER.
 *
 * It read CONFIRMED rows. A wallet is funded before enter() is broadcast, and
 * enter() does not always succeed: the transaction reverts, or the campaign
 * closes in the meantime, and the entry goes back to ELIGIBLE and from there to
 * FAILED. That wallet holds exactly as much gas as one whose entry landed, and no
 * query anywhere listed it. The status of an entry says nothing about whether its
 * wallet was ever paid, so this asks the columns that do.
 *
 * And swept_at was written once, terminally. The prize phase funds the same
 * wallet twice more — a claim, then a delivery — months after the entry was
 * swept, and each of those leaves its own remainder. One terminal mark said the
 * wallet had been finished with before two of its three fundings had happened.
 *
 * So the queue is "funded, and not swept since". funded_at is written immediately
 * before every funding by every phase that funds, and clears swept_at as it goes.
 * The queue still drains, which is the property the mark exists for: a pass
 * writes swept_at for every row it looked at, including the wallets whose
 * remainder is not worth the transaction, so nothing holds the head for ever.
 */
export async function listSweepable(limit: number): Promise<Entry[]> {
  const db = getDb();
  const rows = checked(
    'entry.list_sweepable',
    await db
      .from('bridge_v2_entries')
      .select(COLUMNS)
      .not('funded_at', 'is', null)
      .is('swept_at', null)
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as EntryRow[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : [];
}

/**
 * H7: the two columns that put a wallet into the sweep queue, as one write.
 *
 * Applied immediately BEFORE gas is sent, never after, and the ordering is the
 * whole guarantee. A wallet cannot receive gas unless this write has already
 * succeeded, so there is no failure — a killed function, a database error, a
 * broadcast whose answer never came back — that leaves value in an address the
 * queue does not hold. It errs the other way instead, marking a wallet that was
 * never actually funded, and that costs one look at an empty address.
 *
 * Clearing swept_at is what makes the mark repeatable. The entry funding, the
 * prize claim and the prize delivery each pay the same wallet at a different
 * time, and each has to put it back in the queue.
 */
export function fundingMark(): Record<string, string | null> {
  return { funded_at: new Date().toISOString(), swept_at: null };
}

/** H7: the same mark on its own, for a phase that funds without changing state. */
export async function markFunded(entryId: string): Promise<void> {
  const db = getDb();
  checked(
    'entry.mark_funded',
    await db
      .from('bridge_v2_entries')
      .update(fundingMark())
      .eq('id', entryId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * H7: this entry's derived wallet has been dealt with since it was last funded.
 *
 * Written for a wallet that was swept and for one whose remainder was below the
 * cost of sweeping it, because both mean the same thing to this pass: there is
 * nothing more to do here until somebody funds the wallet again. The next funding
 * clears it and the wallet comes back.
 */
export async function markSwept(entryId: string): Promise<void> {
  const db = getDb();
  await db
    .from('bridge_v2_entries')
    .update({ swept_at: new Date().toISOString() })
    .eq('id', entryId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
}

/**
 * Moves an entry to the back of its queue without changing its state.
 *
 * For the pass that finds a submitted transaction still pending: nothing has
 * happened yet, the row is right as it stands, and the only thing that must
 * change is that the next run looks at a different entry first. Without it a
 * transaction that stays in the mempool holds the head of the reconciliation
 * queue and every entry behind it is never reconciled at all.
 */
export async function touch(entryId: string): Promise<void> {
  const db = getDb();
  await db
    .from('bridge_v2_entries')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', entryId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
}
