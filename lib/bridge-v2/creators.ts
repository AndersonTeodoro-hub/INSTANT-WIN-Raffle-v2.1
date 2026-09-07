/**
 * Creator-without-wallet identity. 07/09/2026 owner decision, path 3 of 4.
 *
 * Mirrors participants.ts exactly, and deliberately: the same shape of
 * problem (a person with no on-chain address who still needs one signed for
 * them) gets the same shape of answer — a row that reserves a derivation
 * index before deriving, so a failed second write never leaves the row
 * pointing at nothing (I9).
 *
 * It is its own table rather than a reuse of bridge_v2_participants, and that
 * is the one real difference. A creator-campaign submission is a synchronous
 * route (api/bridge/v2/creator/campaign/submit.ts), never a scheduled run
 * under the pipeline's lock, so its derived wallet must never be one the
 * pipeline could also be signing for at the same moment (G6). Two roles, two
 * tables, two disjoint sets of addresses — drawn from the SAME sequence
 * (bridge_v2_next_wallet_index), so "disjoint" is a guarantee the sequence
 * already gives rather than one this module has to keep.
 */

import { checked, checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';
import { addressOf } from './wallet.js';

export interface Creator {
  readonly id: string;
  readonly participantId: string;
  readonly walletIndex: number;
  readonly walletAddress: `0x${string}`;
}

interface CreatorRow {
  id: string;
  participant_id: string;
  wallet_index: number;
  wallet_address: string;
}

function toCreator(row: CreatorRow): Creator {
  return {
    id: row.id,
    participantId: row.participant_id,
    walletIndex: row.wallet_index,
    walletAddress: row.wallet_address as `0x${string}`,
  };
}

/** Read-only lookup, for a route that must not create a wallet just to check one. */
export async function findCreatorByParticipant(participantId: string): Promise<Creator | null> {
  return findByParticipant(participantId);
}

async function findByParticipant(participantId: string): Promise<Creator | null> {
  const db = getDb();
  const row = checkedMaybe(
    'creator.select',
    await db
      .from('bridge_v2_creators')
      .select('id, participant_id, wallet_index, wallet_address')
      .eq('participant_id', participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as CreatorRow | null;
  return row === null ? null : toCreator(row);
}

/**
 * Finds the creator identity for a participant, creating one if needed.
 *
 * The unique constraint on participant_id is the authority under concurrency,
 * exactly as it is on bridge_v2_participants.email_canonical: two simultaneous
 * first calls both try to insert, one wins, and the other reads the winner's
 * row rather than creating a second wallet for the same person.
 */
export async function getOrCreateCreator(participantId: string): Promise<Creator> {
  const existing = await findByParticipant(participantId);
  if (existing !== null) return existing;

  const db = getDb();

  const index = checked(
    'creator.reserve_index',
    await db.rpc('bridge_v2_next_wallet_index').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as number | string;

  const walletIndex = Number(index);
  const walletAddress = addressOf(walletIndex);

  const inserted = await db
    .from('bridge_v2_creators')
    .insert({ participant_id: participantId, wallet_index: walletIndex, wallet_address: walletAddress })
    .select('id, participant_id, wallet_index, wallet_address')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();

  if (inserted.error) {
    const winner = await findByParticipant(participantId);
    if (winner !== null) return winner;
    throw new Error('[bridge-v2] creator could not be created');
  }

  return toCreator(inserted.data as CreatorRow);
}
