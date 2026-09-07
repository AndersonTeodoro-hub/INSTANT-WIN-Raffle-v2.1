/**
 * Email verification codes. J1 to J5.
 *
 * The V1 got the cryptography here right and the concurrency wrong. The
 * generator, the keyed hash and the constant-time compare are kept as knowledge
 * and rewritten; the attempt counter is moved into the database, because
 * counting attempts in TypeScript is finding #5 and cannot be fixed in
 * TypeScript.
 */

import {
  DB_TIMEOUT_MS,
  EMAIL_CODE_DIGITS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MS,
} from './config.js';
import { keyedHash, randomDigits, timingSafeEqualHex } from './crypto.js';
import { checked, getDb } from './db.js';

/**
 * J2: the hash is bound to the address it was issued for.
 *
 * Binding matters even though the code is short-lived: without it, a code issued
 * for one address would verify for another if the same six digits came up, and
 * six digits come up often enough to matter across a large enough population.
 *
 * The key is the code root (F1), which is not the wallet seed. In the V1 both
 * uses shared BRIDGE_SEED, so a leak of the code key was a leak of every wallet.
 */
function hashCode(code: string, canonicalEmail: string): Promise<string> {
  return keyedHash('BRIDGE_V2_CODE_HMAC_KEY', 'email-code-v1', `${canonicalEmail}:${code}`);
}

/**
 * Issues a code, superseding any earlier live code for the address (J3).
 *
 * Returns the plaintext code for the one caller that needs it — the mail sender.
 * It is never returned to a client, never logged, and never stored: only the
 * hash reaches the database.
 *
 * One call, one transaction (bridge_v2_issue_email_code, 0005). Superseding and
 * inserting used to be two round trips, and a race between two issues could
 * interleave them as supersede(A), supersede(B), insert(A), insert(B): neither
 * supersede found anything to end and both inserts landed, leaving two live
 * codes for one address instead of one.
 */
export async function issueEmailCode(canonicalEmail: string): Promise<string> {
  const code = randomDigits(EMAIL_CODE_DIGITS);
  const db = getDb();

  checked(
    'code.issue',
    await db
      .rpc('bridge_v2_issue_email_code', {
        p_email_canonical: canonicalEmail,
        p_code_hash: await hashCode(code, canonicalEmail),
        p_expires_at: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString(),
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );

  return code;
}

export type CodeVerdict = 'OK' | 'WRONG' | 'NONE';

interface AttemptRow {
  code_id: string;
  code_hash: string;
  attempts_left: number;
}

/**
 * Spends one attempt and reports whether the code was right.
 *
 * The attempt is claimed by the database function before the comparison happens,
 * so a burst of concurrent guesses spends one attempt each. That is J4 and G1,
 * and it is the half the V1 got wrong: reading attempts, comparing to five, and
 * writing attempts + 1 lets any number of concurrent guesses share one increment.
 *
 * NONE means there was no live code — expired, already used, or out of attempts.
 * The caller must answer NONE and WRONG identically (D2), because the difference
 * between them is the difference between "this address is registered" and "this
 * address is not".
 */
export async function verifyEmailCode(
  canonicalEmail: string,
  candidate: string,
): Promise<CodeVerdict> {
  const db = getDb();

  const rows = checked(
    'code.claim_attempt',
    await db.rpc('bridge_v2_claim_email_code_attempt', {
      p_email_canonical: canonicalEmail,
      p_max_attempts: EMAIL_CODE_MAX_ATTEMPTS,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as AttemptRow[] | null;

  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (row === undefined) return 'NONE';

  const candidateHash = await hashCode(candidate, canonicalEmail);
  // J5: always walks the whole string, so a near miss is not faster than a
  // complete miss.
  if (!timingSafeEqualHex(candidateHash, row.code_hash)) return 'WRONG';

  const consumed = checked(
    'code.consume',
    await db
      .rpc('bridge_v2_consume_email_code', { p_code_id: row.code_id })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;

  // G2: the consumption result is acted on. A code consumed by someone else
  // between the compare and here is not a code this caller may spend.
  return consumed === true ? 'OK' : 'NONE';
}

/** Minutes, for the mail body. Derived so the two cannot drift apart. */
export const EMAIL_CODE_TTL_MINUTES = Math.floor(EMAIL_CODE_TTL_MS / 60_000);
