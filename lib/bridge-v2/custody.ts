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
 */

import { CUSTODY_OWN_WALLET_THRESHOLD, CUSTODY_TEMPORARY_DAYS } from './config.js';
import { PrizeKind } from './abi.js';
import { checked, checkedMaybe, getDb } from './db.js';

export type PrizeKindName = 'TOKEN' | 'NFT';

export interface CustodyPolicy {
  readonly prizeKind: PrizeKindName;
  readonly requiresOwnWallet: boolean;
  /** Null when the winner must supply an address, because nothing is held. */
  readonly custodyExpiresAt: Date | null;
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
    return { prizeKind: 'NFT', requiresOwnWallet: true, custodyExpiresAt: null };
  }

  const winners = winnersCount > 0 ? BigInt(winnersCount) : 1n;
  const share = prizeAmount / winners;

  if (share >= CUSTODY_OWN_WALLET_THRESHOLD) {
    return { prizeKind: 'TOKEN', requiresOwnWallet: true, custodyExpiresAt: null };
  }

  // E3: custody is never indefinite. The expiry is set the moment it begins, so
  // there is no state in which a prize is held with no end date. Past it the
  // contract's own claim deadline governs, which is where the value goes.
  const expiry = new Date(Date.now() + CUSTODY_TEMPORARY_DAYS * 24 * 60 * 60 * 1000);
  return { prizeKind: 'TOKEN', requiresOwnWallet: false, custodyExpiresAt: expiry };
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
        custody_expires_at: policy.custodyExpiresAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entry_id' },
    ),
  );
}

export interface CustodyRecord {
  readonly entryId: string;
  readonly prizeKind: PrizeKindName;
  readonly requiresOwnWallet: boolean;
  readonly destinationAddress: `0x${string}` | null;
  readonly destinationConfirmedAt: string | null;
  readonly custodyExpiresAt: string | null;
}

interface CustodyRow {
  entry_id: string;
  prize_kind: PrizeKindName;
  requires_own_wallet: boolean;
  destination_address: string | null;
  destination_confirmed_at: string | null;
  custody_expires_at: string | null;
}

export async function readCustody(entryId: string): Promise<CustodyRecord | null> {
  const db = getDb();
  const row = checkedMaybe(
    'custody.select',
    await db
      .from('bridge_v2_custody')
      .select('entry_id, prize_kind, requires_own_wallet, destination_address, destination_confirmed_at, custody_expires_at')
      .eq('entry_id', entryId)
      .maybeSingle(),
  ) as CustodyRow | null;

  if (row === null) return null;
  return {
    entryId: row.entry_id,
    prizeKind: row.prize_kind,
    requiresOwnWallet: row.requires_own_wallet,
    destinationAddress: row.destination_address as `0x${string}` | null,
    destinationConfirmedAt: row.destination_confirmed_at,
    custodyExpiresAt: row.custody_expires_at,
  };
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
    .maybeSingle();
  if (updated.error) return false;
  return updated.data !== null;
}
