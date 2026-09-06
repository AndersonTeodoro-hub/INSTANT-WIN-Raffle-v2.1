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

import {
  CUSTODY_TEMPORARY_DAYS,
  CUSTODY_OWN_WALLET_THRESHOLD,
  DB_TIMEOUT_MS,
  USDC,
} from './config.js';
import { PrizeKind } from './abi.js';
import { checked, checkedMaybe, getDb } from './db.js';

export type PrizeKindName = 'TOKEN' | 'NFT';

export interface CustodyPolicy {
  readonly prizeKind: PrizeKindName;
  readonly requiresOwnWallet: boolean;
}

/**
 * The largest single share a campaign can pay one winner.
 *
 * The contract's own arithmetic, from GiveawayManagerV2.claimable: the share is
 * prizeAmount / winnersCount and the indivisible remainder goes to the first
 * derived winner, so slot 1 is owed share + remainder and nobody is owed more.
 *
 * Used only where the real figure is not available — before a campaign settles,
 * and after a prize has been claimed, when claimable() has gone back to zero.
 * Taking the maximum rather than the mean errs towards the stricter branch,
 * which is the only direction it is safe to err in: it can require a wallet the
 * winner owns for a prize that turned out to be small, never leave a large one
 * in a derived wallet.
 */
export function largestWinnerShare(prizeAmount: bigint, winnersCount: number): bigint {
  const winners = winnersCount > 0 ? BigInt(winnersCount) : 1n;
  const share = prizeAmount / winners;
  return share + (prizeAmount - share * winners);
}

/**
 * Applies E2, under owner decision D1 of 06/09/2026.
 *
 * TWO THINGS CHANGED HERE AND BOTH WERE WRONG BEFORE.
 *
 * The token. The threshold is a hundred USDC, in USDC base units, and it was
 * being compared against an amount of whatever token the campaign creator chose.
 * "100000000" means one hundred in a six-decimal token and a ten-millionth of
 * one in an eighteen-decimal token, so an unbounded prize in a token nobody has
 * heard of went to temporary custody while a modest prize in a token with few
 * decimals did not. There is no conversion that fixes this — pricing an
 * arbitrary ERC-20 needs an oracle, and the same reasoning E2 already applies to
 * an NFT applies here: there is no number to trust. D1 settles it by scope
 * rather than by arithmetic. Only USDC can rest in a derived wallet; every other
 * token, like every NFT, needs a wallet the winner owns, whatever the amount.
 *
 * The value. The share was computed from winnersCount at entry time, and the
 * contract clamps winnersCount down to the entrant count when it closes. A
 * campaign created for ten winners that draws three pays each of them more than
 * three times what was assumed here — the estimate erred towards the LENIENT
 * branch, not the strict one, which is how a prize over the threshold ends up in
 * temporary custody. What one winner is actually owed is claimable(), and that
 * is what the prize path now passes in.
 */
export function policyFor(
  prizeKind: number,
  winnerShare: bigint,
  prizeToken: `0x${string}`,
): CustodyPolicy {
  if (prizeKind === PrizeKind.NFT) {
    return { prizeKind: 'NFT', requiresOwnWallet: true };
  }

  // D1. The comparison below is only meaningful in one token's units, so any
  // other token skips it entirely.
  if (prizeToken.toLowerCase() !== (USDC as string).toLowerCase()) {
    return { prizeKind: 'TOKEN', requiresOwnWallet: true };
  }

  return {
    prizeKind: 'TOKEN',
    requiresOwnWallet: winnerShare >= CUSTODY_OWN_WALLET_THRESHOLD,
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
  /** D2: set the first and only time an expired custody was alerted on. */
  readonly custodyExpiredAlertAt: string | null;
  /** Section 7: set when the settled campaign owes this wallet nothing, ever. */
  readonly noPrizeAt: string | null;
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
  custody_expired_alert_at: string | null;
  no_prize_at: string | null;
}

const CUSTODY_COLUMNS =
  'entry_id, prize_kind, requires_own_wallet, destination_address, ' +
  'destination_confirmed_at, custody_expires_at, claimed_at, claim_tx_hash, ' +
  'delivered_at, delivery_tx_hash, custody_expired_alert_at, no_prize_at';

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
    custodyExpiredAlertAt: row.custody_expired_alert_at,
    noPrizeAt: row.no_prize_at,
  };
}

/**
 * Rewrites the E2 outcome once the real figure is known.
 *
 * The row written at entry time records the rule the participant was shown, from
 * a share the contract had not yet fixed. When the campaign settles, claimable()
 * says what this winner is actually owed, and that number decides. Written
 * BEFORE the claim, so the branch taken by the transaction that moves the prize
 * is the branch stored on the row — a run that dies between the two reads the
 * same answer the next time.
 */
export async function updatePolicy(entryId: string, requiresOwnWallet: boolean): Promise<void> {
  const db = getDb();
  checked(
    'custody.update_policy',
    await db
      .from('bridge_v2_custody')
      .update({ requires_own_wallet: requiresOwnWallet, updated_at: new Date().toISOString() })
      .eq('entry_id', entryId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
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
 *
 * G2: false means the row did not match, and only that. A database error throws.
 * The two were being collapsed into the same false, and the caller turns false
 * into a 409 telling the participant their request was refused — so a database
 * that was simply unavailable was reported to them as a decision about their
 * address, and the route returned 200-shaped refusals for an outage nobody was
 * paged about. An error is not an answer.
 */
export async function proposeDestination(
  entryId: string,
  destination: `0x${string}`,
): Promise<boolean> {
  const db = getDb();
  const updated = checkedMaybe(
    'custody.propose_destination',
    await db
      .from('bridge_v2_custody')
      .update({
        destination_address: destination,
        destination_confirmed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('entry_id', entryId)
      .select('entry_id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
}

/**
 * E4, second step: confirms the destination the participant was shown.
 *
 * The address is passed again and must match what is stored. A confirmation that
 * does not name the address it confirms would accept whatever happened to be in
 * the row, which is precisely what the second step exists to prevent.
 *
 * G2: false means the stored address is not this one. A database error throws,
 * because the decision the caller makes from false — telling the participant to
 * confirm the address they were shown — is only true if the row was actually
 * read.
 */
export async function confirmDestination(
  entryId: string,
  destination: `0x${string}`,
): Promise<boolean> {
  const db = getDb();
  const updated = checkedMaybe(
    'custody.confirm_destination',
    await db
      .from('bridge_v2_custody')
      .update({
        destination_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('entry_id', entryId)
      .eq('destination_address', destination)
      .select('entry_id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
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
 * AND "NOT DELIVERED" WAS NOT THE RIGHT CONDITION ON ITS OWN. Every entry that
 * confirms gets a custody row, winner or not, because at entry time nobody knows
 * which it will be. Once the campaign settles, most of those rows belong to
 * people who did not win: claimable() reads zero for them and will read zero for
 * the rest of time, and delivered_at is never set because there is nothing to
 * deliver. They stayed in this queue for ever. A campaign of a thousand entrants
 * and three winners left nine hundred and ninety-seven permanent rows, ordered by
 * updated_at and therefore ahead of every genuine prize behind them, each one
 * costing a campaign read and a claimable read on every run — a batch of ten that
 * moved nothing and grew with every campaign the platform ever ran.
 *
 * no_prize_at is the exit. §7/G4: what stays in the queue is what can still
 * receive a prize.
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
      .is('no_prize_at', null)
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
 *
 * G2: false means the row was already claimed. A database error throws — the
 * caller reads false as "somebody else recorded this claim", and swallowing an
 * error into that answer says a prize is accounted for when nothing was written.
 */
export async function beginCustody(
  entryId: string,
  claimTxHash: string | null,
  expiresAt: Date | null,
): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = checkedMaybe(
    'custody.begin',
    await db
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
      .maybeSingle(),
  );
  return updated !== null;
}

/**
 * The prize left the derived wallet for the address the winner confirmed (E4).
 *
 * G2: false means it was already marked delivered. A database error throws,
 * because false and "the write did not happen" are the difference between a
 * prize that is done with and one the next pass has to finish.
 */
export async function markDelivered(entryId: string, txHash: string | null): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = checkedMaybe(
    'custody.mark_delivered',
    await db
      .from('bridge_v2_custody')
      .update({ delivered_at: now, delivery_tx_hash: txHash, updated_at: now })
      .eq('entry_id', entryId)
      .is('delivered_at', null)
      .select('entry_id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
}

/**
 * OWNER DECISION D2, 06/09/2026: one alert per expired custody, never repeated.
 *
 * Returns true only for the pass that actually claimed the alert, because the
 * write is conditional on the column still being null and the database decides
 * which pass wins. Reading the column and then writing it would be the
 * read-compare-write G1 forbids, and would let two passes both alert.
 *
 * The alternative — alerting whenever the expiry is in the past — fired once a
 * minute for as long as the value sat there, which is thirty days of one message
 * about one prize. That is not an alert; it is the noise that teaches its reader
 * to filter the channel.
 *
 * Nothing else happens to the value. D2 says an expired custody with no
 * destination is retained, and the bridge takes no automatic action on it.
 */
export async function claimCustodyExpiredAlert(entryId: string): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = checkedMaybe(
    'custody.claim_expiry_alert',
    await db
      .from('bridge_v2_custody')
      .update({ custody_expired_alert_at: now, updated_at: now })
      .eq('entry_id', entryId)
      .is('custody_expired_alert_at', null)
      .select('entry_id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
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

/**
 * Section 7, G4: takes a row out of the prize queue because there is no prize.
 *
 * Written only where the answer is final, and finality here has exactly two
 * shapes, both of them decided by the contract and neither of them reversible:
 *
 *   the campaign has SETTLED, nothing was ever claimed for this wallet, and
 *   claimable() is zero — this entrant did not win, and a campaign settles once;
 *
 *   the claim window has closed with nothing claimed — past CLAIM_DEADLINE
 *   claimPrize reverts with ClaimExpired and the creator may reclaim, so there is
 *   nothing left for this side to attempt at any later date.
 *
 * Deliberately NOT delivered_at, which would say a prize left the wallet. These
 * two facts are different and an operator reading the table has to be able to
 * tell them apart. Nothing here touches an unclaimed prize that still exists:
 * a row with claimed_at set and no destination is the D2 case and stays in the
 * queue where the expiry alert can find it.
 *
 * Idempotent, and conditional on the column being null so a second pass writes
 * nothing.
 */
export async function closeNoPrize(entryId: string): Promise<boolean> {
  const db = getDb();
  const now = new Date().toISOString();
  const updated = checkedMaybe(
    'custody.close_no_prize',
    await db
      .from('bridge_v2_custody')
      .update({ no_prize_at: now, updated_at: now })
      .eq('entry_id', entryId)
      .is('no_prize_at', null)
      .is('claimed_at', null)
      .select('entry_id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return updated !== null;
}
