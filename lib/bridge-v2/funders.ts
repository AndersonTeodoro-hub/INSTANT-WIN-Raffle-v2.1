/**
 * The gas funder pool. F7, G3 and G6.
 *
 * F7: these keys are configured independently of the participant derivation
 * seed. Compromising the pool does not compromise participant wallets, nor the
 * other way round, which is the separation the V1 did not have.
 *
 * F6 applies here too: no account object leaves this module.
 *
 * G3 and G6 are the corrections to finding #9. The V1 took a 30-second lease and
 * then waited for a receipt with no timeout, so a slow confirmation let the lease
 * lapse while the work was still running and a second invocation could take the
 * same funder and reuse its nonce. Here the lease is renewed while the operation
 * is alive, the receipt wait is bounded, and the nonce is authoritative in the
 * database rather than read from the RPC as pending.
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, TransactionSerializable } from 'viem';
import { DB_TIMEOUT_MS, FUNDER_LEASE_SECONDS } from './config.js';
import { requireEnv } from './env.js';
import { randomIndex } from './crypto.js';
import { checked, getDb } from './db.js';
import { publicClient } from './chain.js';

export interface FunderLease {
  readonly index: number;
  readonly address: `0x${string}`;
  readonly nextNonce: number;
  readonly leaseToken: string;
}

interface AcquireRow {
  funder_index: number;
  address: string;
  next_nonce: number;
  lease_token: string;
}

/**
 * Reads one key out of the configured list.
 *
 * Comma separated, read at the moment of use. The value becomes an account
 * inside the signing function below and is never returned, so the only things
 * this module hands back are an address and signed bytes.
 */
function keyAt(index: number): Hex {
  const keys = requireEnv('BRIDGE_V2_FUNDER_KEYS').split(',');
  const key = keys[index]?.trim();
  if (key === undefined || key.length === 0) {
    throw new Error('[bridge-v2] funder index is outside the configured pool');
  }
  return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
}

/** The public address of a pool member, for seeding the table and for monitoring. */
export function funderAddress(index: number): `0x${string}` {
  return privateKeyToAccount(keyAt(index)).address;
}

/**
 * D6: where one sweep sends its remainder.
 *
 * EVERY SWEEP WENT TO funderAddress(0). Funding is drawn at random from the pool
 * precisely so that an observer reading the chain cannot line the derived wallets
 * up behind a single address — and then the recovery pass sent every one of those
 * wallets' remainders to exactly one, drawing the edges the random funding had
 * refused to draw. It is worse than the V1 shape D6 mitigates, because a sweep
 * leaves one transaction per participant converging on one point, in a batch, on
 * a schedule.
 *
 * Drawn the way a funder is drawn, so the sweep's edges are distributed like the
 * funding's and the graph gains nothing an observer did not already have. A
 * mitigation and not a fix, exactly as R3 already declares of the funding side:
 * the model makes some correlation inherent, and what this requires is that the
 * sweep add none of its own.
 *
 * H2 is untouched. The destination is a key the deployment configured, picked
 * here by the CSPRNG; no request can name it and none can influence the pick.
 */
export function randomFunderAddress(poolSize: number): `0x${string}` {
  return funderAddress(randomIndex(poolSize));
}

/** How many funders are configured. H8 uses it to check the pool is not empty. */
export function poolSize(): number {
  return requireEnv('BRIDGE_V2_FUNDER_KEYS')
    .split(',')
    .filter((part) => part.trim().length > 0).length;
}

/**
 * Takes a funder, or null when every one of them is busy.
 *
 * Acquisition is a conditional atomic update in the database, so expiry alone
 * never lets a second holder in while the first still holds a live lease.
 *
 * D6: the pick is random rather than sequential. Funding every entry from the
 * next funder in order is what let an observer read entry order off the chain in
 * the V1 (finding H3.c). Random assignment is a partial mitigation and declared
 * as such in R3 — the funding model makes some correlation inherent.
 */
export async function acquireFunder(): Promise<FunderLease | null> {
  const db = getDb();
  const rows = checked(
    'funder.acquire',
    await db
      .rpc('bridge_v2_acquire_funder', { p_lease_seconds: FUNDER_LEASE_SECONDS })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as AcquireRow[] | null;

  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (row === undefined) return null;

  const address = row.address as `0x${string}`;
  const nextNonce = await reconcileNonce(row.funder_index, address, row.next_nonce, row.lease_token);

  return {
    index: row.funder_index,
    address,
    nextNonce,
    leaseToken: row.lease_token,
  };
}

/**
 * G6: brings the stored nonce back into agreement with the account.
 *
 * The stored number is the authority WHILE a lease is held — that is the whole
 * point of it, and it is what stops two operations reading a pending count at
 * the same moment. It is not the authority about the account's history, and it
 * was being treated as if it were: the row is created with next_nonce 0 by the
 * schema default and by the seed script, and from then on it only ever moves
 * through releaseFunder, which takes GREATEST of the old value and the new. Two
 * things follow, and both are outages no run recovers from.
 *
 * A funder key with any prior history starts at 0 against an account whose count
 * is already forty. Every transaction it signs is refused as a stale nonce,
 * nothing is ever mined, so the stored number never advances, and the funder is
 * dead on arrival. That covers the ordinary case of a key that has been used for
 * anything before, and the case of a rotated pool member.
 *
 * A transaction dropped from the mempool leaves the stored number one past a
 * nonce that will now never be used. Everything the funder signs afterwards has
 * a gap in front of it and is never mined, and GREATEST means the stored number
 * can only go up. The funder is stuck for ever, and the bridge disables it or
 * waits on it rather than repairing it.
 *
 * The account answers both. `latest` is what has actually been mined; `pending`
 * is that plus what the node holds for this account, counted from `latest`
 * without gaps. So:
 *
 *   stored < latest    the row is behind the chain. The chain wins.
 *   stored > pending   the transactions the row counts are neither mined nor held
 *                      anywhere. They are gone. The chain wins.
 *   otherwise          the row is inside what the account has committed to, which
 *                      is exactly the range it exists to serialise. The row wins,
 *                      and a concurrent unmined broadcast is not overwritten.
 *
 * The correction is written back under the lease token, so only the holder of a
 * live lease can move it and a lapsed holder cannot rewind a funder somebody else
 * is using. A failure to read the account leaves the stored value alone: not
 * knowing is not a reason to rewrite a nonce.
 */
async function reconcileNonce(
  index: number,
  address: `0x${string}`,
  stored: number,
  leaseToken: string,
): Promise<number> {
  let latest: number;
  let pending: number;
  try {
    const client = publicClient();
    [latest, pending] = await Promise.all([
      client.getTransactionCount({ address, blockTag: 'latest' }),
      client.getTransactionCount({ address, blockTag: 'pending' }),
    ]);
  } catch {
    return stored;
  }

  const reconciled = stored < latest ? latest : stored > pending ? pending : stored;
  if (reconciled === stored) return stored;

  const db = getDb();
  const written = checked(
    'funder.reconcile_nonce',
    await db.rpc('bridge_v2_reconcile_funder_nonce', {
      p_funder_index: index,
      p_lease_token: leaseToken,
      p_next_nonce: reconciled,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;

  // A refused write means the lease is no longer ours, and signing on a nonce
  // this side corrected under a lease somebody else holds is the collision the
  // lease exists to prevent. The stored value comes back unchanged; the caller's
  // first signed transaction then fails on it and the operation ends there, which
  // is the safe direction to be wrong in.
  return written === true ? reconciled : stored;
}

/**
 * G3: extends the lease while the operation is still running.
 *
 * Returns false when the lease is no longer ours, which the caller must treat as
 * fatal for the operation. Continuing to sign under a lease somebody else now
 * holds is exactly the nonce collision this exists to prevent.
 */
export async function renewLease(lease: FunderLease): Promise<boolean> {
  const db = getDb();
  const renewed = checked(
    'funder.renew',
    await db.rpc('bridge_v2_renew_funder_lease', {
      p_funder_index: lease.index,
      p_lease_token: lease.leaseToken,
      p_lease_seconds: FUNDER_LEASE_SECONDS,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;
  return renewed === true;
}

/**
 * Releases the funder and advances its nonce.
 *
 * G6: the nonce written here is the authority for the next user of this funder.
 * It advances even when the transaction failed, because a broadcast transaction
 * consumes its nonce whether or not it succeeded, and reusing it would produce a
 * replacement rather than a new transaction.
 */
export async function releaseFunder(lease: FunderLease, nextNonce: number): Promise<boolean> {
  const db = getDb();
  const released = checked(
    'funder.release',
    await db.rpc('bridge_v2_release_funder', {
      p_funder_index: lease.index,
      p_lease_token: lease.leaseToken,
      p_next_nonce: nextNonce,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;
  return released === true;
}

/** H8: a funder that cannot be used is taken out of rotation, visibly. */
export async function disableFunder(index: number): Promise<boolean> {
  const db = getDb();
  const disabled = checked(
    'funder.disable',
    await db
      .rpc('bridge_v2_disable_funder', { p_funder_index: index })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;
  return disabled === true;
}

/** Signs as a funder. Like the participant wallet, no account escapes (F6). */
export async function signAsFunder(
  index: number,
  transaction: TransactionSerializable,
): Promise<Hex> {
  return privateKeyToAccount(keyAt(index)).signTransaction(transaction);
}
