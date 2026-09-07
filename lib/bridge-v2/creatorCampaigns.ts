/**
 * Creator-without-wallet campaign drafts. 07/09/2026 owner decision.
 *
 * PENDING_DEPOSIT   drafted; the deposit address was handed to the creator
 * FUNDING           the derived wallet held enough at the last check; a
 *                    submit is in progress or was interrupted mid-sequence
 * CONFIRMED         createGiveaway is mined; giveaway_id is the on-chain id
 * FAILED            not reached by this pass — reserved for a hard, unretriable
 *                    stop (an admin action), which nothing here writes yet
 *
 * A creator holds at most one PENDING_DEPOSIT or FUNDING row at a time
 * (bridge_v2_creator_campaigns_active_unique, 0007), enforced by the database
 * rather than a read this module does first (G1).
 */

import { checked, checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';

export type CreatorCampaignStatus = 'PENDING_DEPOSIT' | 'FUNDING' | 'CONFIRMED' | 'FAILED';

export interface CreatorCampaign {
  readonly id: string;
  readonly creatorId: string;
  readonly status: CreatorCampaignStatus;
  readonly module: `0x${string}`;
  readonly prizeToken: `0x${string}`;
  readonly prizeAmount: bigint;
  readonly durationSeconds: bigint;
  readonly winnersCount: number;
  readonly slotCap: number;
  readonly feeAmount: bigint;
  readonly slotsCost: bigint;
  readonly giveawayId: bigint | null;
  readonly txHash: string | null;
}

interface Row {
  id: string;
  creator_id: string;
  status: CreatorCampaignStatus;
  module: string;
  prize_token: string;
  prize_amount: string;
  duration_seconds: string;
  winners_count: number;
  slot_cap: number;
  fee_amount: string;
  slots_cost: string;
  giveaway_id: string | null;
  tx_hash: string | null;
}

// numeric(78,0) columns are cast to text: PostgREST renders numeric as a JSON
// number (an IEEE double), and prize_amount, fee_amount and slots_cost can all
// exceed 2^53. Same reasoning as entries.ts COLUMNS.
//
// ONE STRING LITERAL, NOT A CONCATENATION. supabase-js infers the shape of
// `.select()` from the literal TYPE of its argument; a `+` of two literals
// widens to plain `string` at the type level, which is indistinguishable from
// an arbitrary runtime string and falls back to an error type instead of the
// row shape below. Kept on one line for exactly that reason.
const COLUMNS = 'id, creator_id, status, module, prize_token, prize_amount::text, duration_seconds, winners_count, slot_cap, fee_amount::text, slots_cost::text, giveaway_id::text, tx_hash';

function toCampaign(row: Row): CreatorCampaign {
  return {
    id: row.id,
    creatorId: row.creator_id,
    status: row.status,
    module: row.module as `0x${string}`,
    prizeToken: row.prize_token as `0x${string}`,
    prizeAmount: BigInt(row.prize_amount),
    durationSeconds: BigInt(row.duration_seconds),
    winnersCount: row.winners_count,
    slotCap: row.slot_cap,
    feeAmount: BigInt(row.fee_amount),
    slotsCost: BigInt(row.slots_cost),
    giveawayId: row.giveaway_id === null ? null : BigInt(row.giveaway_id),
    txHash: row.tx_hash,
  };
}

export interface DraftInput {
  readonly module: `0x${string}`;
  readonly prizeToken: `0x${string}`;
  readonly prizeAmount: bigint;
  readonly durationSeconds: bigint;
  readonly winnersCount: number;
  readonly slotCap: number;
  readonly feeAmount: bigint;
  readonly slotsCost: bigint;
}

export type DraftOutcome = { readonly kind: 'CREATED'; readonly campaign: CreatorCampaign } | { readonly kind: 'ACTIVE_EXISTS' };

/**
 * Records a draft, or reports that this creator already has one in flight.
 *
 * bridge_v2_creator_campaigns_active_unique is the authority (G1): this does
 * not read for an existing draft first and then decide, because that is
 * exactly the race the constraint exists to close.
 */
export async function createDraft(creatorId: string, input: DraftInput): Promise<DraftOutcome> {
  const db = getDb();
  const inserted = await db
    .from('bridge_v2_creator_campaigns')
    .insert({
      creator_id: creatorId,
      status: 'PENDING_DEPOSIT',
      module: input.module,
      prize_token: input.prizeToken,
      prize_amount: input.prizeAmount.toString(),
      duration_seconds: input.durationSeconds.toString(),
      winners_count: input.winnersCount,
      slot_cap: input.slotCap,
      fee_amount: input.feeAmount.toString(),
      slots_cost: input.slotsCost.toString(),
    })
    .select(COLUMNS)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();

  if (inserted.error) {
    if ((inserted.error as { code?: string }).code === '23505') return { kind: 'ACTIVE_EXISTS' };
    throw new Error('[bridge-v2] creator campaign draft could not be recorded');
  }

  return { kind: 'CREATED', campaign: toCampaign(inserted.data as Row) };
}

/** The one draft or in-flight campaign a creator may hold at a time, if any. */
export async function findActiveCampaign(creatorId: string): Promise<CreatorCampaign | null> {
  const db = getDb();
  const row = checkedMaybe(
    'creator_campaign.find_active',
    await db
      .from('bridge_v2_creator_campaigns')
      .select(COLUMNS)
      .eq('creator_id', creatorId)
      .in('status', ['PENDING_DEPOSIT', 'FUNDING'])
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as Row | null;
  return row === null ? null : toCampaign(row);
}

/** The most recently created campaign for a creator, whatever its status. */
export async function findLatestCampaign(creatorId: string): Promise<CreatorCampaign | null> {
  const db = getDb();
  const rows = checked(
    'creator_campaign.find_latest',
    await db
      .from('bridge_v2_creator_campaigns')
      .select(COLUMNS)
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as Row[] | null;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row === undefined ? null : toCampaign(row);
}

/**
 * Advances a campaign, refusing when it is no longer in the state expected.
 *
 * G2, exactly as entries.ts advance(): a transition matching no row means the
 * row is not where the caller thought, and that is different from a database
 * error. Both used to collapse to the same false in the entries.ts version
 * before it was fixed there; this one is written correctly from the start.
 */
export async function advanceCampaign(
  id: string,
  from: CreatorCampaignStatus,
  to: CreatorCampaignStatus,
  extra: Record<string, string | null> = {},
): Promise<boolean> {
  const db = getDb();
  const updated = checkedMaybe(
    'creator_campaign.advance',
    await db
      .from('bridge_v2_creator_campaigns')
      .update({ status: to, updated_at: new Date().toISOString(), ...extra })
      .eq('id', id)
      .eq('status', from)
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
}
