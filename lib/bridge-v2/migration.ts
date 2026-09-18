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
 * nonce is G6 broken from the outside.
 */

import { encodeFunctionData, type Hex } from 'viem';
import type { Logger } from './log.js';
import { alert } from './alert.js';
import type { RunDeadline } from './runlock.js';
import { claimSpend } from './spend.js';
import { ERC20_ABI, GIVEAWAY_MANAGER_V2_ABI, GiveawayStatus } from './abi.js';
import { DB_TIMEOUT_MS, GIVEAWAY_MANAGER_V2, MIGRATION_ASSET_MS, MIGRATION_SEAL_MS, USDC } from './config.js';
import {
  claimDeadlineSeconds,
  erc20BalanceOf,
  fundDerivedWallet,
  prizeDelivery,
  publicClient,
  quoteDelivery,
  readGiveaway,
  submitAsDerived,
  sweepRemainder,
  waitForReceipt,
  type PrizeDelivery,
} from './chain.js';
import { checked, getDb } from './db.js';
import {
  accountById,
  pendingMigrations,
  sealMigration,
  touchMigration,
  unsealedDerivedWallets,
  type Migration,
} from './accounts.js';
import { acquireFunder, disableFunder, randomFunderAddress, releaseFunder, renewLease, signAsFunder } from './funders.js';
import { signAsDerived } from './wallet.js';
import { accountState } from './keptraChain.js';
import { configurationGap } from './keptra.js';

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

const CREATOR_REFUNDED_ABI = [
  { type: 'function', name: 'creatorRefunded', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

/**
 * A8: the rights still tied to the derived address, which only its key can
 * exercise — claimPrize pays msg.sender, and a creator's calls require the
 * creator. While any is open, the key is kept for them and the index is not
 * sealed. Counted, not listed; the count is what readiness needs.
 */
export async function openRights(kind: 'PARTICIPANT' | 'CREATOR', derived: `0x${string}`): Promise<number> {
  const db = getDb();
  let open = 0;
  if (kind === 'PARTICIPANT') {
    const entries = checked(
      'migration.rights_entries',
      await db
        .from('bridge_v2_entries')
        .select('id, giveaway_id::text, status, outcome')
        .eq('wallet_address', derived)
        .eq('passkey', false)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as { id: string; giveaway_id: string; status: string; outcome: string | null }[] | null;
    let deadlineSeconds: bigint | null = null;
    for (const entry of entries ?? []) {
      // An entry still on its way, or entered in a campaign not settled yet.
      if (entry.status !== 'CONFIRMED' && entry.status !== 'FAILED') open += 1;
      else if (entry.status === 'CONFIRMED' && entry.outcome === null) open += 1;
      else if (entry.outcome === 'WON') {
        // A prize not claimed yet, while the contract still lets it be claimed.
        const giveawayId = BigInt(entry.giveaway_id);
        const claimable = (await publicClient().readContract({
          address: GIVEAWAY_MANAGER_V2,
          abi: GIVEAWAY_MANAGER_V2_ABI,
          functionName: 'claimable',
          args: [giveawayId, derived],
        })) as bigint;
        if (claimable === 0n) continue;
        deadlineSeconds ??= await claimDeadlineSeconds();
        const campaign = await readGiveaway(giveawayId);
        if (BigInt(Math.floor(Date.now() / 1000)) <= campaign.settledAt + deadlineSeconds) open += 1;
      }
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
      const raw = (await publicClient().readContract({
        address: GIVEAWAY_MANAGER_V2,
        abi: GIVEAWAY_MANAGER_V2_ABI,
        functionName: 'getGiveaway',
        args: [giveawayId],
      })) as unknown as { status: number; prizeAmount: bigint; prizeDelivered: bigint };
      const status = Number(raw.status);
      if (status === GiveawayStatus.SETTLED) {
        // The creator may reclaim what nobody claimed, until it is all handed out.
        if (raw.prizeDelivered < raw.prizeAmount) open += 1;
      } else if (status === GiveawayStatus.CANCELLED) {
        const refunded = (await publicClient().readContract({
          address: GIVEAWAY_MANAGER_V2,
          abi: CREATOR_REFUNDED_ABI,
          functionName: 'creatorRefunded',
          args: [giveawayId],
        })) as boolean;
        if (!refunded) open += 1;
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
 */
export async function migrateOne(
  migration: Migration,
  poolSize: number,
  log: Logger,
  deadline: RunDeadline,
): Promise<boolean> {
  const account = await accountById(migration.accountId);
  if (account === null) return false;

  // C4: value only ever goes to an account that exists with its module and
  // guardian. Until then nothing moves, and the wallet keeps its balance.
  if (configurationGap(await accountState(account.safe)) !== null) {
    await log.event('migration.waiting', { kind: migration.kind });
    return false;
  }

  for (const transfer of await assetTransfers(migration, account.safe)) {
    if (!deadline.hasTimeFor(MIGRATION_ASSET_MS)) return false;
    const moved = await moveOne(migration, transfer, log);
    await log.event(moved === null ? 'migration.failed' : 'migration.moved', { kind: migration.kind });
    if (moved === null) return false;
  }
  if (!deadline.hasTimeFor(MIGRATION_SEAL_MS)) return false;

  // A9: the ETH left behind goes back to the pool by the existing mechanism.
  if (poolSize > 0) {
    await sweepRemainder(migration.walletIndex, migration.derived, randomFunderAddress(poolSize), signAsDerived);
  }

  // A8: sealed only when the wallet is empty of every asset AND nothing is still
  // tied to its address. Otherwise the key stays usable for those rights, and
  // the next pass looks again.
  if ((await assetTransfers(migration, account.safe)).length > 0) return false;
  if ((await openRights(migration.kind, migration.derived)) > 0) return false;
  await sealMigration(migration.id);
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
 * has a balance (USDC, a prize token, a prize NFT) or a right still open. ETH
 * dust below what a sweep costs is not a balance here: A9 hands the ETH to the
 * existing sweep, which by design leaves what is not worth recovering.
 */
export async function seedRetirementReadiness(
  // G4: the maintenance pass bounds this like everything else it runs. A pass
  // that could not look at every wallet does not say "ready".
  hasTime: () => boolean = () => true,
): Promise<{ ready: boolean; blocking: number; wallets: number }> {
  const wallets = await unsealedDerivedWallets();
  let blocking = 0;
  for (const wallet of wallets) {
    if (!hasTime()) return { ready: false, blocking, wallets: wallets.length };
    const migration: Migration = {
      id: '',
      walletIndex: wallet.walletIndex,
      derived: wallet.address,
      accountId: '',
      kind: wallet.kind,
    };
    const held = await assetTransfers(migration, wallet.address);
    if (held.length > 0 || (await openRights(wallet.kind, wallet.address)) > 0) blocking += 1;
  }
  return { ready: blocking === 0, blocking, wallets: wallets.length };
}

