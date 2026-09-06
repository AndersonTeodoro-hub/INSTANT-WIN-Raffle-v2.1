/**
 * Participant records. C1 and I9.
 *
 * One row per canonical email, created the first time an address proves itself
 * and never afterwards. The row carries a derivation index and the public
 * address that index produces, and nothing else about the person.
 *
 * I9 shapes the creation order. The V1 inserted the row and then wrote the
 * address, so a failed second statement left wallet_address as the literal '0x'
 * for good — finding K5. Here the index is reserved first, the address is
 * derived from it, and the row is written complete. There is no moment at which
 * a participant exists without a usable address.
 */

import { checked, checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';
import { addressOf } from './wallet.js';

export interface Participant {
  readonly id: string;
  readonly walletIndex: number;
  readonly walletAddress: `0x${string}`;
}

interface ParticipantRow {
  id: string;
  wallet_index: number;
  wallet_address: string;
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    walletIndex: row.wallet_index,
    walletAddress: row.wallet_address as `0x${string}`,
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

  // Reserved before the address is derived, so the row can be written complete.
  const index = checked(
    'participant.reserve_index',
    await db.rpc('bridge_v2_next_wallet_index').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as number | string;

  const walletIndex = Number(index);
  const walletAddress = addressOf(walletIndex);

  const inserted = await db
    .from('bridge_v2_participants')
    .insert({
      email_canonical: canonicalEmail,
      wallet_index: walletIndex,
      wallet_address: walletAddress,
    })
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
