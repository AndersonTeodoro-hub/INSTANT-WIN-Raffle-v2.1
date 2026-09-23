/**
 * Creator-without-wallet campaign drafts. 07/09/2026 owner decision.
 *
 * PENDING_DEPOSIT   drafted; the deposit address was handed to the creator
 * FUNDING           the derived wallet held enough at the last check; a
 *                    submit is in progress or was interrupted mid-sequence
 * CONFIRMED         createGiveaway is mined; giveaway_id is the on-chain id
 * FAILED            not reached by this pass — reserved for a hard, unretriable
 *                    stop (an admin action), which nothing here writes yet
 * EXPIRED           SPEC-BLOCO-03 Adenda F2: a PENDING_DEPOSIT draft whose
 *                    deposit address received none of either token for it
 *                    seven days after the draft was made (expireUnfundedDrafts;
 *                    P1-3: what was already there when it was made is not its)
 *
 * A creator holds at most one PENDING_DEPOSIT or FUNDING row at a time
 * (bridge_v2_creator_campaigns_active_unique, 0007), enforced by the database
 * rather than a read this module does first (G1).
 */

import { checked, checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS, DRAFT_DEPOSIT_TTL_MS, DRAFT_EXPIRY_MS, USDC } from './config.js';
import { erc20BalanceOf } from './chain.js';
import { findCreatorById } from './creators.js';
import type { Logger } from './log.js';
import type { RunDeadline } from './runlock.js';

export type CreatorCampaignStatus = 'PENDING_DEPOSIT' | 'FUNDING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';

/**
 * The lock under which a creator's derived wallet is signed for: module 2's
 * submit (creator/campaign/submit.ts) and, SPEC-BLOCO-03 Adenda F2, the
 * migration of that wallet — so the two never sign for it at the same time.
 */
export function creatorCampaignLock(creatorId: string): string {
  return `creator-campaign:${creatorId}`;
}

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
  /** SPEC-BLOCO-03 Adenda F5: when the draft was made, the instant the chain is searched back to. */
  readonly createdAt: string;
  /**
   * P1-3: what the deposit address held of the prize token and of USDC when the
   * draft was made. Only what arrives above it is this draft's deposit. Zero for a
   * draft made before migration 0015, which recorded nothing.
   */
  readonly baselinePrize: bigint;
  readonly baselineUsdc: bigint;
  readonly updatedAt: string;
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
  created_at: string;
  updated_at: string;
  deposit_baseline_prize: string | null;
  deposit_baseline_usdc: string | null;
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
const COLUMNS = 'id, creator_id, status, module, prize_token, prize_amount::text, duration_seconds, winners_count, slot_cap, fee_amount::text, slots_cost::text, giveaway_id::text, tx_hash, created_at, updated_at, deposit_baseline_prize::text, deposit_baseline_usdc::text';

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
    txHash: row.tx_hash ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    baselinePrize: BigInt(row.deposit_baseline_prize ?? '0'),
    baselineUsdc: BigInt(row.deposit_baseline_usdc ?? '0'),
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
  /** P1-3: the deposit address's balances of the prize token and of USDC as the draft is made. */
  readonly baselinePrize: bigint;
  readonly baselineUsdc: bigint;
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
      deposit_baseline_prize: input.baselinePrize.toString(),
      deposit_baseline_usdc: input.baselineUsdc.toString(),
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

/**
 * SPEC-BLOCO-03 Adenda E7: every campaign in FUNDING, oldest touched first. At
 * most one per creator (0007's index), so the list is as long as the number of
 * creators with a campaign in flight.
 */
export async function fundingCampaigns(): Promise<CreatorCampaign[]> {
  const rows = checked(
    'creator_campaign.list_funding',
    await getDb()
      .from('bridge_v2_creator_campaigns')
      .select(COLUMNS)
      .eq('status', 'FUNDING')
      .order('updated_at', { ascending: true })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as Row[] | null;
  return Array.isArray(rows) ? rows.map(toCampaign) : [];
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

/**
 * P1-6: the moment a draft is signed for. It moves to FUNDING — or stays there —
 * only if it is still where the caller last read it (`from`) and no transaction
 * has been sent for it yet. False: it expired, was settled or was sent for in
 * between, and nothing is signed. One conditional statement (G1), so a draft
 * that has left PENDING_DEPOSIT is never submitted.
 */
export async function startSubmission(id: string, from: 'PENDING_DEPOSIT' | 'FUNDING'): Promise<boolean> {
  const updated = checkedMaybe(
    'creator_campaign.start_submission',
    await getDb()
      .from('bridge_v2_creator_campaigns')
      .update({ status: 'FUNDING', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', from)
      .is('tx_hash', null)
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
}

/**
 * SPEC-BLOCO-03 Adenda F5: the on-chain ids this creator's drafts already name.
 * A campaign found on-chain that one of them registered is not another draft's.
 */
export async function registeredGiveawayIds(creatorId: string): Promise<Set<bigint>> {
  const rows = checked(
    'creator_campaign.registered',
    await getDb()
      .from('bridge_v2_creator_campaigns')
      .select('giveaway_id::text')
      .eq('creator_id', creatorId)
      .not('giveaway_id', 'is', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { giveaway_id: string }[] | null;
  return new Set((rows ?? []).map((row) => BigInt(row.giveaway_id)));
}

/**
 * SPEC-BLOCO-03 Adenda F2, as the owner decided on 19/09/2026: a draft in
 * PENDING_DEPOSIT closes by itself — EXPIRED — seven days after it was made, if
 * its deposit address received none of the prize token and none of USDC for it.
 * Every draft, a derived creator's and an account creator's alike. A draft is a
 * right of a derived wallet (A8, F2) and holds the creator's one active slot
 * (0007), so one nobody funds must not hold either for ever.
 *
 * P1-3: "for it" is what arrived above the balance the address already had when
 * the draft was made (the baseline createDraft recorded). A balance that was
 * there before is no deposit of this draft, and does not keep it alive.
 *
 * P1-2: every eligible draft is reached, however many are ahead of it. The
 * drafts are read oldest-touched first, and each one looked at and left alive —
 * its deposit arrived, or its read failed — is touched, so it goes to the back:
 * the pass reads on until a page holds only drafts it has already looked at, and
 * the next pass starts with the drafts this one did not reach.
 *
 * One conditional transition (G1): a draft a submit moved on in between is left
 * alone. A deposit that arrives after the check stays where it is: in the
 * creator account, or in the derived wallet, where the migration moves it.
 */
export async function expireUnfundedDrafts(log: Logger, deadline: RunDeadline): Promise<number> {
  const seen = new Set<string>();
  let expired = 0;
  for (;;) {
    if (!deadline.hasTimeFor(DRAFT_EXPIRY_MS)) return expired;
    const rows = checked(
      'creator_campaign.list_unfunded',
      await getDb()
        .from('bridge_v2_creator_campaigns')
        .select(COLUMNS)
        .eq('status', 'PENDING_DEPOSIT')
        .lte('created_at', new Date(Date.now() - DRAFT_DEPOSIT_TTL_MS).toISOString())
        .order('updated_at', { ascending: true })
        .limit(50)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as Row[] | null;
    const unseen = (rows ?? []).map(toCampaign).filter((campaign) => !seen.has(campaign.id));
    if (unseen.length === 0) return expired;
    for (const campaign of unseen) {
      if (!deadline.hasTimeFor(DRAFT_EXPIRY_MS)) return expired;
      seen.add(campaign.id);
      try {
        if (await depositArrived(campaign)) {
          await touchDraft(campaign.id);
          continue;
        }
        // Moved on in between (G1): no longer this pass's, and out of its list.
        if (!(await advanceCampaign(campaign.id, 'PENDING_DEPOSIT', 'EXPIRED'))) continue;
        expired += 1;
        await log.event('creator_campaign.expired');
      } catch (error) {
        await log.failure('creator_campaign.failed', error);
        await touchDraft(campaign.id);
      }
    }
  }
}

/** P1-3: whether the deposit address holds more of either token than it did when the draft was made. */
async function depositArrived(campaign: CreatorCampaign): Promise<boolean> {
  const creator = await findCreatorById(campaign.creatorId);
  // No creator row: no address a deposit could have reached.
  if (creator === null) return false;
  const usdc = (USDC as string).toLowerCase();
  if (campaign.prizeToken.toLowerCase() !== usdc && (await erc20BalanceOf(campaign.prizeToken, creator.walletAddress)) > campaign.baselinePrize) {
    return true;
  }
  return (await erc20BalanceOf(USDC, creator.walletAddress)) > campaign.baselineUsdc;
}

/** P1-2: a draft looked at and left alive goes to the back of the expiry's order. */
async function touchDraft(id: string): Promise<void> {
  checked(
    'creator_campaign.touch',
    await getDb()
      .from('bridge_v2_creator_campaigns')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'PENDING_DEPOSIT')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}
