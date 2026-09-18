/**
 * Participant records. C1 and I9.
 *
 * One row per canonical email, created the first time an address proves itself
 * and never afterwards. The row carries a derivation index and the public
 * address that index produces, and nothing else about the person.
 *
 * SPEC-BLOCO-03 6.6.1 (M9, M31): A NEW PARTICIPANT GETS NO DERIVED WALLET. Their
 * entries are made by their Keptra account, created with a passkey at their first
 * action. The index and address below exist only on rows created before that
 * decision, and only until the wallet is migrated (6.6.2, A8). I9 still holds for
 * those: the pair is all or nothing (0012's CHECK), never an address without an
 * index.
 */

import { checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';

export interface Participant {
  readonly id: string;
  /** Legacy derived wallet, or null for every participant created since 6.6.1. */
  readonly walletIndex: number | null;
  readonly walletAddress: `0x${string}` | null;
}

interface ParticipantRow {
  id: string;
  wallet_index: number | null;
  wallet_address: string | null;
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    // == null, not === null: a row selected before 0012 or built by hand may
    // carry undefined, and it means no derived wallet just the same.
    walletIndex: row.wallet_index == null ? null : Number(row.wallet_index),
    walletAddress: (row.wallet_address ?? null) as `0x${string}` | null,
  };
}

async function findByEmail(canonicalEmail: string): Promise<Participant | null> {
  const db = getDb();
  const row = checkedMaybe(
    'participant.select',
    await db
      .from('bridge_v2_participants')
      .select('id, wallet_index, wallet_address')
      .eq('email_canonical', canonicalEmail)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as ParticipantRow | null;
  return row === null ? null : toParticipant(row);
}

/**
 * Finds the participant for a canonical address, creating one if needed.
 *
 * The unique constraint on email_canonical is the authority under concurrency.
 * Two simultaneous first-time verifications both try to insert; one wins and the
 * other reads the winner's row rather than creating a second participant with a
 * second wallet for the same person.
 */
export async function getOrCreateParticipant(canonicalEmail: string): Promise<Participant> {
  const existing = await findByEmail(canonicalEmail);
  if (existing !== null) return existing;

  const db = getDb();

  // No index is reserved and no address is derived (6.6.1): the row is the
  // email and nothing else until the participant creates their passkey.
  const inserted = await db
    .from('bridge_v2_participants')
    .insert({ email_canonical: canonicalEmail })
    .select('id, wallet_index, wallet_address')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();

  if (inserted.error) {
    // Lost the race. The other transaction created the row; read it rather than
    // failing, because from the participant's side nothing went wrong.
    const winner = await findByEmail(canonicalEmail);
    if (winner !== null) return winner;
    // G2: the error is not swallowed. If there is no row either, this is a real
    // failure and the caller must see it.
    throw new Error('[bridge-v2] participant could not be created');
  }

  return toParticipant(inserted.data as ParticipantRow);
}

/** Reads a participant by id, for routes that already hold a session. */
export async function getParticipant(id: string): Promise<Participant | null> {
  const db = getDb();
  const row = checkedMaybe(
    'participant.by_id',
    await db
      .from('bridge_v2_participants')
      .select('id, wallet_index, wallet_address')
      .eq('id', id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as ParticipantRow | null;
  return row === null ? null : toParticipant(row);
}
