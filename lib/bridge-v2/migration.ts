/**
 * Migration of the derived wallets. SPEC-BLOCO-03 6.6, A8, A9.
 *
 * The one place outside the old pipeline that still signs as a derived wallet,
 * and the last: with the passkey's authorisation, verified on-chain before the
 * row was written (api/bridge/v2/account/migrate.ts), each asset the wallet
 * holds is moved to the participant's account — one operation per asset (A9) —
 * the unspent gas goes back to the pool through the existing sweep (A9), and
 * once nothing is left AND no right is still tied to the address (A8), the
 * index is sealed and the derived key is never used for it again (M2).
 *
 * Runs in the maintenance pass under the pipeline's lock, for the reason the
 * sweep does: the pipeline also signs for derived wallets, and two signers on one
 * nonce is G6 broken from the outside. A creator's wallet is also signed for by
 * module 2's submit, so its migration takes the creator's lock as well and waits
 * while a draft is alive (Adenda F2).
 *
 * Adenda F3: which entries are still rights is the chain's answer (openRights).
 * Adenda F4 and F6: the seed's readiness reads every derived wallet that exists,
 * or says "not ready", and counts ETH above the cost of a sweep as a balance.
 */

import { encodeFunctionData, type Hex } from 'viem';
import type { Logger } from './log.js';
import { alert } from './alert.js';
import { acquireRunLock, releaseRunLock, type RunDeadline } from './runlock.js';
import { claimSpend } from './spend.js';
import { ERC20_ABI, GiveawayStatus } from './abi.js';
import { DB_TIMEOUT_MS, MIGRATION_ASSET_MS, MIGRATION_SEAL_MS, USDC } from './config.js';
import {
  claimableFor,
  claimDeadlineSeconds,
  creatorRefunded,
  erc20BalanceOf,
  fundDerivedWallet,
  hasEntered,
  prizeDelivery,
  quoteDelivery,
  readGiveaway,
  submitAsDerived,
  sweepAboveCost,
  sweepQuote,
  waitForReceipt,
  type PrizeDelivery,
} from './chain.js';
import { checked, getDb } from './db.js';
import {
  accountById,
  derivedWallets,
  pendingMigrations,
  sealMigration,
  touchMigration,
  type Account,
  type Migration,
} from './accounts.js';
import { findCreatorByParticipant } from './creators.js';
import { creatorCampaignLock, findActiveCampaign } from './creatorCampaigns.js';
import { acquireFunder, disableFunder, funderAddress, randomFunderAddress, releaseFunder, renewLease, signAsFunder } from './funders.js';
import { signAsDerived } from './wallet.js';
import { readAccount } from './relay.js';

// -----------------------------------------------------------------------------
// what a derived wallet holds, and what is still tied to it
// -----------------------------------------------------------------------------

/**
 * A9: every transfer that empties the wallet into the account — USDC, every
 * ERC-20 of a prize or a creator deposit, and every prize NFT — built by the
 * same code that delivers a prize (chain.prizeDelivery), so the amounts and ids
 * come from the chain.
 */
export async function assetTransfers(migration: Migration, account: `0x${string}`): Promise<PrizeDelivery[]> {
  const db = getDb();
  const transfers: PrizeDelivery[] = [];
  const tokens = new Set<string>([USDC.toLowerCase()]);

  if (migration.kind === 'PARTICIPANT') {
    // Prizes claimed into the wallet and not delivered from it: tokens and NFTs.
    const rows = checked(
      'migration.custody',
      await db
        .from('bridge_v2_custody')
        .select('entry:bridge_v2_entries!inner(giveaway_id::text, wallet_address)')
        .eq('entry.wallet_address', migration.derived)
        .not('claimed_at', 'is', null)
        .is('delivered_at', null)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as { entry: { giveaway_id: string } }[] | null;
    for (const row of rows ?? []) {
      const giveawayId = BigInt(row.entry.giveaway_id);
      const delivery = await prizeDelivery(await readGiveaway(giveawayId), giveawayId, migration.derived, account);
      if (delivery === null) continue;
      if (delivery.data.startsWith(encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [account, 0n] }).slice(0, 10))) {
        tokens.add(delivery.to.toLowerCase());
      } else {
        transfers.push(delivery);
      }
    }
  } else {
    // A creator's deposits: the prize tokens of its drafts.
    const rows = checked(
      'migration.creator_tokens',
      await db
        .from('bridge_v2_creator_campaigns')
        .select('prize_token, creator:bridge_v2_creators!inner(wallet_address)')
        .eq('creator.wallet_address', migration.derived)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as { prize_token: string }[] | null;
    for (const row of rows ?? []) tokens.add(row.prize_token.toLowerCase());
  }

  for (const token of tokens) {
    const balance = await erc20BalanceOf(token as `0x${string}`, migration.derived);
    if (balance <= 0n) continue;
    transfers.unshift({
      to: token as `0x${string}`,
      amount: balance,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [account, balance] }),
    });
  }
  return transfers;
}

/**
 * A8: the rights still tied to the derived address, which only its key can
 * exercise — claimPrize pays msg.sender, and a creator's calls require the
 * creator. While any is open, the key is kept for them and the index is not
 * sealed. Counted, not listed; the count is what readiness needs.
 *
 * Adenda F3: an entry is a right only while its campaign still takes entries,
 * or while it can still win a prize within the core's deadline — and only an
 * entry the chain holds can. Decided by the chain for every entry, whatever the
 * row's status says: an entry abandoned in a campaign that no longer takes
 * entries, with no prize to claim, is not a right. Adenda F2: a creator's draft
 * in PENDING_DEPOSIT or FUNDING is.
 */
export async function openRights(kind: 'PARTICIPANT' | 'CREATOR', derived: `0x${string}`): Promise<number> {
  const db = getDb();
  let open = 0;
  if (kind === 'PARTICIPANT') {
    const entries = checked(
      'migration.rights_entries',
      await db
        .from('bridge_v2_entries')
        .select('giveaway_id::text')
        .eq('wallet_address', derived)
        .eq('passkey', false)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as { giveaway_id: string }[] | null;
    let deadlineSeconds: bigint | null = null;
    for (const entry of entries ?? []) {
      const giveawayId = BigInt(entry.giveaway_id);
      const campaign = await readGiveaway(giveawayId);
      // The entry may still be made.
      if (campaign.acceptsEntries) {
        open += 1;
        continue;
      }
      // Only an entry on-chain can win anything, and nothing in a cancelled campaign.
      if (campaign.status === GiveawayStatus.CANCELLED || !(await hasEntered(giveawayId, derived))) continue;
      // Not drawn yet: it may still win, and claim within the deadline after.
      if (!campaign.isSettled) {
        open += 1;
        continue;
      }
      // Drawn: a prize not claimed yet, while the contract still lets it be claimed.
      if ((await claimableFor(giveawayId, derived)) === 0n) continue;
      deadlineSeconds ??= await claimDeadlineSeconds();
      if (BigInt(Math.floor(Date.now() / 1000)) <= campaign.settledAt + deadlineSeconds) open += 1;
    }
  } else {
    const campaigns = checked(
      'migration.rights_campaigns',
      await db
        .from('bridge_v2_creator_campaigns')
        .select('status, giveaway_id::text, creator:bridge_v2_creators!inner(wallet_address)')
        .eq('creator.wallet_address', derived)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as { status: string; giveaway_id: string | null }[] | null;
    for (const campaign of campaigns ?? []) {
      if (campaign.status === 'PENDING_DEPOSIT' || campaign.status === 'FUNDING') {
        open += 1;
        continue;
      }
      if (campaign.status !== 'CONFIRMED' || campaign.giveaway_id === null) continue;
      const giveawayId = BigInt(campaign.giveaway_id);
      const created = await readGiveaway(giveawayId);
      if (created.status === GiveawayStatus.SETTLED) {
        // The creator may reclaim what nobody claimed, until it is all handed out.
        if (created.prizeDelivered < created.prizeAmount) open += 1;
      } else if (created.status === GiveawayStatus.CANCELLED) {
        if (!(await creatorRefunded(giveawayId))) open += 1;
      } else {
        open += 1;
      }
    }
  }
  return open;
}

// -----------------------------------------------------------------------------
// the move
// -----------------------------------------------------------------------------

/** One asset: gas to the derived wallet, then its transfer, both awaited. */
async function moveOne(
  migration: Migration,
  transfer: PrizeDelivery,
  log: Logger,
): Promise<Hex | null> {
  if (!(await claimSpend('chain', 1, log))) return null;
  const plan = await quoteDelivery(migration.derived, transfer);
  const lease = await acquireFunder();
  if (lease === null) {
    await log.event('funder.exhausted');
    return null;
  }
  let nextNonce = lease.nextNonce;
  try {
    const funding = await fundDerivedWallet(lease, migration.derived, plan.worstCaseWei, signAsFunder, (spent) => {
      nextNonce = spent;
    });
    if (funding !== null) {
      const funded = await waitForReceipt(funding);
      if (funded === null || funded.status !== 'success') return null;
    }
    if (!(await renewLease(lease))) return null;
    const hash = await submitAsDerived(migration.walletIndex, migration.derived, transfer.to, transfer.data, plan, signAsDerived);
    const receipt = await waitForReceipt(hash);
    return receipt?.status === 'success' ? hash : null;
  } finally {
    if (!(await releaseFunder(lease, nextNonce))) {
      await disableFunder(lease.index);
      await alert(log, 'funder lease could not be released', { funder_index: lease.index });
    }
  }
}

/**
 * Moves what one authorised wallet holds, returns the gas, and seals the index
 * when nothing is left and no right remains. True when sealed.
 *
 * C1: every asset is reserved on its own, and so is the close, against the real
 * run budget; a pass that runs out stops between units and the next one picks
 * up what is left, because assetTransfers reads what is still there.
 *
 * Adenda F2: a creator's derived wallet is signed for by module 2's submit as
 * well, under the creator's own lock (creatorCampaignLock). The migration takes
 * that same lock for as long as it signs, so the two never sign for one wallet
 * at once, and moves nothing while the creator has a draft alive: the draft is a
 * right of the wallet (A8), and its deposit is what the submit signs away.
 */
export async function migrateOne(
  migration: Migration,
  poolSize: number,
  log: Logger,
  deadline: RunDeadline,
): Promise<boolean> {
  const account = await accountById(migration.accountId);
  if (account === null) return false;

  // C4 as D1 reads it: value only ever goes to an account that exists with its
  // configuration. Until then nothing moves, and the wallet keeps its balance.
  // E3 and E10: whether it does is the chain's answer.
  if (!(await readAccount(account)).usable) {
    await log.event('migration.waiting', { kind: migration.kind });
    return false;
  }
  if (migration.kind === 'PARTICIPANT') return moveAndSeal(migration, account, poolSize, log, deadline);

  const creator = await findCreatorByParticipant(account.participantId);
  if (creator === null) return false;
  const lock = await acquireRunLock(creatorCampaignLock(creator.id));
  if (lock === null) {
    await log.event('migration.waiting', { kind: migration.kind, reason: 'submit' });
    return false;
  }
  try {
    if ((await findActiveCampaign(creator.id)) !== null) {
      await log.event('migration.waiting', { kind: migration.kind, reason: 'draft' });
      return false;
    }
    return await moveAndSeal(migration, account, poolSize, log, deadline);
  } finally {
    await releaseRunLock(lock);
  }
}

async function moveAndSeal(
  migration: Migration,
  account: Account,
  poolSize: number,
  log: Logger,
  deadline: RunDeadline,
): Promise<boolean> {
  for (const transfer of await assetTransfers(migration, account.safe)) {
    if (!deadline.hasTimeFor(MIGRATION_ASSET_MS)) return false;
    const moved = await moveOne(migration, transfer, log);
    await log.event(moved === null ? 'migration.failed' : 'migration.moved', { kind: migration.kind });
    if (moved === null) return false;
  }
  if (!deadline.hasTimeFor(MIGRATION_SEAL_MS)) return false;

  // A9: the ETH left behind goes back to the pool by the existing mechanism —
  // all of it above the sweep's own cost (F6, owner's decision of 19/09/2026):
  // a sealed wallet is never swept again, and readiness counts that ETH. The
  // cost is kept with the seal: what the sweep leaves is below it.
  const swept =
    poolSize > 0 ? await sweepAboveCost(migration.walletIndex, migration.derived, randomFunderAddress(poolSize), signAsDerived) : null;

  // A8: sealed only when the wallet is empty of every asset AND nothing is still
  // tied to its address. Otherwise the key stays usable for those rights, and
  // the next pass looks again.
  if ((await assetTransfers(migration, account.safe)).length > 0) return false;
  if ((await openRights(migration.kind, migration.derived)) > 0) return false;
  await sealMigration(migration.id, swept?.cost ?? null);
  await log.event('migration.sealed', { kind: migration.kind });
  return true;
}

/** The maintenance step, under the pipeline lock. */
export async function migrateAuthorizedWallets(log: Logger, poolSize: number, deadline: RunDeadline): Promise<number> {
  let sealed = 0;
  for (const migration of await pendingMigrations(5)) {
    if (!deadline.hasTimeFor(MIGRATION_ASSET_MS)) break;
    try {
      if (await migrateOne(migration, poolSize, log, deadline)) sealed += 1;
      else await touchMigration(migration.id);
    } catch (error) {
      await log.failure('migration.failed', error);
      await touchMigration(migration.id);
    }
  }
  return sealed;
}

/**
 * M34, 6.6.4 as A8 rewrites it: the seed can be retired when no derived wallet
 * has a balance or a right still open.
 *
 * Adenda E1 as F6 rewrites it: any token or NFT in a derived wallet (USDC, a
 * prize token, a prize NFT), or ETH above what a sweep of it costs now, is a
 * balance. ETH below that cost follows A9. Every derived wallet is read, sealed
 * or not, and any balance in any of them makes the answer "not ready" and raises
 * an alert. A sealed wallet's rights were closed when it was sealed, and its key
 * signs nothing since; only what it holds is asked.
 *
 * Adenda F4: every derived wallet that exists is evaluated, or the answer is
 * "not ready" — a list that could not be confirmed whole (derivedWallets), or a
 * pass that ran out of time before the last wallet (`complete`).
 */
export async function seedRetirementReadiness(
  log: Logger,
  // G4: the maintenance pass bounds this like everything else it runs. A pass
  // that could not look at every wallet does not say "ready".
  hasTime: () => boolean = () => true,
): Promise<{ ready: boolean; complete: boolean; blocking: number; holding: number; wallets: number }> {
  const listed = await derivedWallets(hasTime);
  const wallets = listed.wallets;
  let blocking = 0;
  let holding = 0;
  let sealedHolding = 0;
  let complete = listed.complete;
  // F6: the sweep this ETH would take, priced to where a sweep sends it (H2).
  const sweepTo = wallets.length > 0 ? funderAddress(0) : null;
  for (const wallet of wallets) {
    if (!hasTime()) {
      complete = false;
      break;
    }
    const migration: Migration = {
      id: '',
      walletIndex: wallet.walletIndex,
      derived: wallet.address,
      accountId: '',
      kind: wallet.kind,
    };
    const tokens = (await assetTransfers(migration, wallet.address)).length > 0;
    // F6, and the owner's decision of 19/09/2026 on what a sealed wallet keeps:
    // above the cost of a sweep now, and — sealed — above the cost of the last
    // sweep too, whose unspent reservation is what it left behind.
    const eth = await sweepQuote(wallet.address, sweepTo as `0x${string}`);
    const floor = wallet.sweepCostWei !== null && wallet.sweepCostWei > eth.cost ? wallet.sweepCostWei : eth.cost;
    const held = tokens || eth.balance > floor;
    if (held) {
      holding += 1;
      if (wallet.sealed) sealedHolding += 1;
    }
    if (held || (!wallet.sealed && (await openRights(wallet.kind, wallet.address)) > 0)) blocking += 1;
  }
  if (holding > 0) {
    await alert(log, 'derived wallet holds a balance', { wallets: holding, sealed: sealedHolding });
  }
  return { ready: complete && blocking === 0, complete, blocking, holding, wallets: wallets.length };
}

