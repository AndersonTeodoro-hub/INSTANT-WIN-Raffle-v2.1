/**
 * Custody policy. E1 to E4.
 *
 * E1 is the premise: a derived wallet is a signing vehicle, not a vault. The
 * seed controls gas in flight, never wealth at rest. Everything below exists to
 * keep that true once a campaign actually pays out.
 *
 * E2 sets the thresholds. Below 100 USDC the prize may rest in the derived
 * wallet for a bounded time; at or above it the winner must give their own
 * address; and for a non-fungible prize the winner must always give their own
 * address, with no exception. The reason for the NFT rule is that its value is
 * declared by the creator and is not verifiable on-chain — there is no number to
 * trust, so there is no threshold to apply.
 *
 * WHEN THE CLOCK STARTS. custody_expires_at is written when the prize is
 * actually in the derived wallet, which is when claimPrize has been mined, and
 * not when the entry is opened. Setting it at entry time dated a custody that
 * had not begun, and for any campaign that runs longer than thirty days it dated
 * it into the past: the window expired before there was anything in the wallet
 * to expire. E3 asks that custody never be indefinite, and custody starts when
 * the value arrives.
 */

import { CUSTODY_TEMPORARY_DAYS, CUSTODY_OWN_WALLET_THRESHOLD, DB_TIMEOUT_MS } from './config.js';
import { PrizeKind } from './abi.js';
import { checked, checkedMaybe, getDb } from './db.js';

export type PrizeKindName = 'TOKEN' | 'NFT';

export interface CustodyPolicy {
  readonly prizeKind: PrizeKindName;
  readonly requiresOwnWallet: boolean;
}

/**
 * Applies E2 to one campaign.
 *
 * The share is what a single winner receives, not the whole prize: the threshold
 * is about what one person is owed, and a large prize split many ways can leave
 * each winner well under the line.
 *
 * winnersCount is clamped to the entrant count by the contract at close, so the
 * share computed here before the close is the smallest the winner could receive.
 * Erring that way is deliberate — it can only move a prize into the stricter
 * branch, never out of it.
 */
export function policyFor(
  prizeKind: number,
  prizeAmount: bigint,
  winnersCount: number,
): CustodyPolicy {
  if (prizeKind === PrizeKind.NFT) {
    return { prizeKind: 'NFT', requiresOwnWallet: true };
  }

  const winners = winnersCount > 0 ? BigInt(winnersCount) : 1n;
  const share = prizeAmount / winners;

  return {
    prizeKind: 'TOKEN',
    requiresOwnWallet: share >= CUSTODY_OWN_WALLET_THRESHOLD,
  };
}

/** E3: how long temporary custody lasts, from the moment the prize arrives. */
export function custodyExpiryFrom(startedAt: Date): Date {
  return new Date(startedAt.getTime() + CUSTODY_TEMPORARY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Records the policy for an entry.
 *
 * Written when the entry is opened rather than when a prize is won, so the rule
 * that applied is the rule that was in force at entry time and is visible to the
 * participant from the start.
 */
export async function recordPolicy(entryId: string, policy: CustodyPolicy): Promise<void> {
  const db = getDb();
  checked(
    'custody.insert',
    await db.from('bridge_v2_custody').upsert(
      {
        entry_id: entryId,
        prize_kind: policy.prizeKind,
        requires_own_wallet: policy.requiresOwnWallet,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entry_id' },
    ).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

export interface CustodyRecord {
  readonly entryId: string;
  readonly prizeKind: PrizeKindName;
  readonly requiresOwnWallet: boolean;
  readonly destinationAddress: `0x${string}` | null;
  readonly destinationConfirmedAt: string | null;
  /** Set when the prize reached the derived wallet, never before (E3). */
  readonly custodyExpiresAt: string | null;
  readonly claimedAt: string | null;
  readonly claimTxHash: string | null;
  readonly deliveredAt: string | null;
  readonly deliveryTxHash: string | null;
}

interface CustodyRow {
  entry_id: string;
  prize_kind: PrizeKindName;
  requires_own_wallet: boolean;
  destination_address: string | null;
  destination_confirmed_at: string | null;
  custody_expires_at: string | null;
  claimed_at: string | null;
  claim_tx_hash: string | null;
  delivered_at: string | null;
  delivery_tx_hash: string | null;
}

const CUSTODY_COLUMNS =
  'entry_id, prize_kind, requires_own_wallet, destination_address, ' +
  'destination_confirmed_at, custody_expires_at, claimed_at, claim_tx_hash, ' +
  'delivered_at, delivery_tx_hash';

function toCustody(row: CustodyRow): CustodyRecord {
  return {
    entryId: row.entry_id,
    prizeKind: row.prize_kind,
    requiresOwnWallet: row.requires_own_wallet,
    destinationAddress: row.destination_address as `0x${string}` | null,
    destinationConfirmedAt: row.destination_confirmed_at,
    custodyExpiresAt: row.custody_expires_at,
    claimedAt: row.claimed_at,
    claimTxHash: row.claim_tx_hash,
    deliveredAt: row.delivered_at,
    deliveryTxHash: row.delivery_tx_hash,
  };
}

export async function readCustody(entryId: string): Promise<CustodyRecord | null> {
  const db = getDb();
  const row = checkedMaybe(
    'custody.select',
    await db
      .from('bridge_v2_custody')
      .select(CUSTODY_COLUMNS)
      .eq('entry_id', entryId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as CustodyRow | null;

  return row === null ? null : toCustody(row);
}

/**
 * E4, first step: records a proposed destination without confirming it.
 *
 * Proposing and confirming are separate writes on purpose. The requirement is
 * that the address is shown back to the participant before anything moves, and a
 * single call that stored and accepted in one go would leave nothing to show.
 */
export async function proposeDestination(
  entryId: string,
  destination: `0x${string}`,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .from('bridge_v2_custody')
    .update({
      destination_address: destination,
      destination_confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('entry_id', entryId)
    .select('entry_id')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (updated.error) return false;
  return updated.data !== null;
}

/**
 * E4, second step: confirms the destination the participant was shown.
 *
 * The address is passed again and must match what is stored. A confirmation that
 * does not name the address it confirms would accept whatever happened to be in
 * the row, which is precisely what the second step exists to prevent.
 */
export async function confirmDestination(
  entryId: string,
  destination: `0x${string}`,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .from('bridge_v2_custody')
    .update({
      destination_confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('entry_id', entryId)
    .eq('destination_address', destination)
    .select('entry_id')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (updated.error) return false;
  return updated.data !== null;
}

// -----------------------------------------------------------------------------
// The prize queue — what the scheduled pass reads and writes
// -----------------------------------------------------------------------------

/** One row of the prize queue: the custody record plus the entry it belongs to. */
export interface PendingPrize {
  readonly custody: CustodyRecord;
  readonly participantId: string;
  readonly giveawayId: bigint;
  readonly walletAddress: `0x${string}`;
}

interface PendingRow extends CustodyRow {
  entry: {
    participant_id: string;
    giveaway_id: string;
    wallet_address: string;
  };
}

/**
 * Prizes that have not been delivered yet, oldest first.
 *
 * Only entries that reached the chain can have won anything, so the join is an
 * inner one on CONFIRMED. The ordering key is updated_at and every pass writes
 * it, whether or not it managed to move the prize along — otherwise a row that
 * cannot progress yet, because the winner has not named a destination, sits at
 * the head of the queue for ever and the rows behind it are never looked at.
 *
 * giveaway_id is cast to text in the query. It is numeric(78,0) and PostgREST
 * renders a numeric as a JSON number, which is an IEEE double: a uint256 id
 * would arrive already rounded, and BigInt() of a rounded double is a different
 * campaign or a thrown error.
 */
export async function listPendingPrizes(limit: number): Promise<PendingPrize[]> {
  const db = getDb();
  const rows = checked(
    'custody.list_pending',
    await db
      .from('bridge_v2_custody')
      .select(
        `${CUSTODY_COLUMNS}, entry:bridge_v2_entries!inner(participant_id, giveaway_id::text, wallet_address, status)`,
      )
      .is('delivered_at', null)
      .eq('entry.status', 'CONFIRMED')
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as PendingRow[] | null;

  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    custody: toCustody(row),
    participantId: row.entry.participant_id,
    giveawayId: BigInt(row.entry.giveaway_id),
    walletAddress: row.entry.wallet_address as `0x${string}`,
  }));
}

/**
 * E3: records that the prize is now in the derived wallet, and when custody ends.
 *
 * The expiry is written here and nowhere else, because here is the first moment
 * at which there is a custody to expire. Conditional on claimed_at being null so
 * two passes that both saw an unmined claim cannot restart the clock.
 */
export async function beginCustody(
  entryId: string,
  claimTxHash: string | null,
  expiresAt: Date | null,
): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = await db
    .from('bridge_v2_custody')
    .update({
      claimed_at: now,
      claim_tx_hash: claimTxHash,
      custody_expires_at: expiresAt?.toISOString() ?? null,
      updated_at: now,
    })
    .eq('entry_id', entryId)
    .is('claimed_at', null)
    .select('entry_id')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (updated.error) return false;
  return updated.data !== null;
}

/** The prize left the derived wallet for the address the winner confirmed (E4). */
export async function markDelivered(entryId: string, txHash: string | null): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = await db
    .from('bridge_v2_custody')
    .update({ delivered_at: now, delivery_tx_hash: txHash, updated_at: now })
    .eq('entry_id', entryId)
    .is('delivered_at', null)
    .select('entry_id')
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (updated.error) return false;
  return updated.data !== null;
}

/**
 * Moves a row to the back of the prize queue without changing anything else.
 *
 * What makes the queue a queue. A prize waiting on a destination the participant
 * has not given yet is not an error and not finished; it just must not be the
 * row every run looks at first.
 */
export async function touchCustody(entryId: string): Promise<void> {
  const db = getDb();
  await db
    .from('bridge_v2_custody')
    .update({ updated_at: new Date().toISOString() })
    .eq('entry_id', entryId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
}
