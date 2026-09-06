/**
 * One scheduled run at a time, and a run that stops before the platform stops it.
 *
 * G6 is written as a property of a signing path — an explicit, serialised nonce
 * per funder account — and every one of those paths was correct on its own. What
 * broke it was the schedule around them. The pipeline cron fires every minute
 * and does work whose slowest unit is two sixty-second receipt waits, so two
 * runs overlap by construction, and two overlapping runs read the same nonce for
 * the role key and for a derived wallet, list the same ELIGIBLE rows, and pay
 * for the same entry twice. Exclusion cannot live inside the code that overlaps;
 * it has to be the thing that decides whether that code runs at all.
 *
 * G4 is the other half and is about the end of a run rather than its beginning.
 * The platform kills a function at maxDuration wherever it is, and where it is
 * may be between a broadcast transaction and the row that records its hash — the
 * V1's finding K3, reintroduced by a scheduler instead of by a missing timeout.
 * A run therefore stops starting work while there is still time to finish what
 * it has, which is what a deadline is for.
 */

import { DB_TIMEOUT_MS, ENTRY_WORST_CASE_MS, RUN_BUDGET_MS, RUN_LOCK_SECONDS } from './config.js';
import { checkedMaybe, getDb } from './db.js';

export interface RunLock {
  readonly name: string;
  readonly holder: string;
}

/**
 * Takes the lock for one scheduled run, or returns null because another run has
 * it.
 *
 * Null is a normal outcome and not an error: the previous run is still working,
 * and the correct response is for this one to do nothing at all. A cron that
 * fires every minute over work that sometimes takes five produces four of these
 * for every run that does something.
 *
 * The lock expires on its own, because a function the platform killed releases
 * nothing. The expiry is the run's own maxDuration plus a second, so it cannot
 * lapse under a run the platform is still allowing to live.
 */
export async function acquireRunLock(name: string): Promise<RunLock | null> {
  const db = getDb();
  const holder = checkedMaybe(
    'lock.acquire',
    await db
      .rpc('bridge_v2_try_lock', { p_name: name, p_ttl_seconds: RUN_LOCK_SECONDS })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as string | null;

  return holder === null ? null : { name, holder };
}

/**
 * Gives the lock back, if it is still ours.
 *
 * The holder is passed because a run that overran its lease no longer owns the
 * lock and must not release the run that took it over. Returns whether the
 * release matched; the caller logs it and carries on either way, since a lock
 * that could not be released expires by itself.
 */
export async function releaseRunLock(lock: RunLock): Promise<boolean> {
  const db = getDb();
  const released = checkedMaybe(
    'lock.release',
    await db
      .rpc('bridge_v2_release_lock', { p_name: lock.name, p_holder: lock.holder })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;
  return released === true;
}

export interface RunDeadline {
  /** True while there is time to start another unit of work of this size. */
  hasTimeFor(estimateMs?: number): boolean;
  /** Milliseconds left in the run's own budget, never negative. */
  remainingMs(): number;
}

/**
 * The budget for one run, measured from now.
 *
 * Every loop that does chain work asks this before it starts the next item, so
 * the run stops between units rather than inside one. The default estimate is
 * the worst case for a single entry — fund, wait, submit, wait — because that is
 * the longest thing any of those loops can start.
 */
export function runDeadline(budgetMs: number = RUN_BUDGET_MS): RunDeadline {
  const endsAt = Date.now() + budgetMs;
  const remainingMs = (): number => Math.max(0, endsAt - Date.now());
  return {
    remainingMs,
    hasTimeFor: (estimateMs: number = ENTRY_WORST_CASE_MS): boolean => remainingMs() > estimateMs,
  };
}
