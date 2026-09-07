/**
 * Rate limiting. B1, B2, B3 and B4.
 *
 * B3 is the whole point and the reason none of this is done in TypeScript. The
 * V1 ran SELECT count then INSERT, which is finding #3: two requests read the
 * same count and both pass. Here every axis is one call to a database function
 * that increments and decides inside a single statement, so the value a caller
 * sees is a value no other caller can also see.
 *
 * B1: every route calls this, including the read routes. A read route that is
 * not limited is a free enumeration budget.
 */

import { DB_TIMEOUT_MS, RATE_LIMITS, STRIKE_DECAY_SECONDS, type RateAxis } from './config.js';
import { getDb, checked } from './db.js';
import { keyedHash } from './crypto.js';

export interface AxisCheck {
  readonly axis: RateAxis;
  /**
   * The raw value. It is hashed here and never leaves this module in clear (K4).
   *
   * Under a key, not a bare digest. Several axes carry a value whose input space
   * a laptop enumerates — an IP, a subnet, a phone number, an email drawn from a
   * leaked list — so an unkeyed hash of one is a reversible record of it, and a
   * table of those is exactly what K4 says may not be persisted.
   */
  readonly value: string;
}

export interface RateVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly deniedAxis: RateAxis | null;
}

interface HitRow {
  allowed: boolean;
  retry_after_seconds: number;
}

/**
 * Applies every axis and returns the first denial.
 *
 * Sequential rather than parallel on purpose. B4 makes a denial raise a penalty,
 * and running the axes concurrently would charge a strike on several axes for
 * one request that a single axis was always going to refuse.
 *
 * The axes are evaluated in the order given, so callers list the cheapest and
 * most specific first.
 */
export async function enforce(checks: readonly AxisCheck[]): Promise<RateVerdict> {
  const db = getDb();

  for (const check of checks) {
    const limit = RATE_LIMITS[check.axis];
    const keyHash = await keyedHash(
      'BRIDGE_V2_SIGNAL_HMAC_KEY',
      'ratelimit-key-v1',
      `${check.axis}:${check.value}`,
    );

    const rows = checked(
      'rate_limit.hit',
      await db.rpc('bridge_v2_rate_limit_hit', {
        p_axis: check.axis,
        p_key_hash: keyHash,
        p_window_seconds: limit.windowSeconds,
        p_max_count: limit.max,
        p_penalty_seconds: limit.penaltySeconds,
        // B4: the penalty and its strike count live in their own table, keyed by
        // axis and key alone, so they survive the window boundary. This is how
        // long a quiet key takes to forget them.
        p_strike_decay_seconds: STRIKE_DECAY_SECONDS,
      }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as HitRow[] | null;

    const verdict = Array.isArray(rows) ? rows[0] : undefined;
    // A missing verdict is treated as a denial. Failing open here would make a
    // database hiccup an unlimited request budget.
    if (verdict === undefined || verdict.allowed !== true) {
      return {
        allowed: false,
        retryAfterSeconds: verdict?.retry_after_seconds ?? limit.penaltySeconds,
        deniedAxis: check.axis,
      };
    }
  }

  return { allowed: true, retryAfterSeconds: 0, deniedAxis: null };
}

/** The Retry-After header for a denial, so a well-behaved client can obey B4. */
export function retryAfterHeaders(verdict: RateVerdict): Record<string, string> {
  return { 'Retry-After': String(Math.max(1, verdict.retryAfterSeconds)) };
}
