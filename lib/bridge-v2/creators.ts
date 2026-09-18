/**
 * Creator-without-wallet identity. 07/09/2026 owner decision, path 3 of 4.
 *
 * Mirrors participants.ts exactly, and deliberately. Since SPEC-BLOCO-03 no new
 * row reserves a derivation index (6.6.1): a new creator's address is their
 * creator account. The rows below that do carry an index predate that, and keep
 * it until their wallet is migrated.
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

import { checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';
import { findAccount } from './accounts.js';

export interface Creator {
  readonly id: string;
  readonly participantId: string;
  /**
   * The derived wallet's index for a creator row made before SPEC-BLOCO-03, or
   * null for a creator whose deposit address is their creator account (A10,
   * 6.6.3) — for whom the bridge signs nothing.
   */
  readonly walletIndex: number | null;
  readonly walletAddress: `0x${string}`;
}

interface CreatorRow {
  id: string;
  participant_id: string;
  wallet_index: number | null;
  wallet_address: string;
}

function toCreator(row: CreatorRow): Creator {
  return {
    id: row.id,
    participantId: row.participant_id,
    walletIndex: row.wallet_index == null ? null : Number(row.wallet_index),
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
 * SPEC-BLOCO-03 6.6.1 and 6.6.3: a new creator gets no derived wallet. Their
 * deposit address is their creator account (A10), which exists as soon as they
 * have a passkey — null until then, and the route asks for one. An existing
 * derived creator keeps their row until it is migrated (A8, A12).
 *
 * The unique constraint on participant_id is the authority under concurrency,
 * exactly as it is on bridge_v2_participants.email_canonical: two simultaneous
 * first calls both try to insert, one wins, and the other reads the winner's
 * row.
 */
export async function getOrCreateCreator(participantId: string): Promise<Creator | null> {
  const existing = await findByParticipant(participantId);
  if (existing !== null) return existing;

  const account = await findAccount(participantId, 'CREATOR');
  if (account === null) return null;

  const db = getDb();
  const inserted = await db
    .from('bridge_v2_creators')
    .insert({ participant_id: participantId, wallet_index: null, wallet_address: account.safe })
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
