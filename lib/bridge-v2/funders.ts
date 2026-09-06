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
import { FUNDER_LEASE_SECONDS } from './config.js';
import { requireEnv } from './env.js';
import { checked, getDb } from './db.js';

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
    await db.rpc('bridge_v2_acquire_funder', { p_lease_seconds: FUNDER_LEASE_SECONDS }),
  ) as AcquireRow[] | null;

  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (row === undefined) return null;

  return {
    index: row.funder_index,
    address: row.address as `0x${string}`,
    nextNonce: row.next_nonce,
    leaseToken: row.lease_token,
  };
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
    }),
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
    }),
  ) as boolean | null;
  return released === true;
}

/** H8: a funder that cannot be used is taken out of rotation, visibly. */
export async function disableFunder(index: number): Promise<boolean> {
  const db = getDb();
  const disabled = checked(
    'funder.disable',
    await db.rpc('bridge_v2_disable_funder', { p_funder_index: index }),
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
