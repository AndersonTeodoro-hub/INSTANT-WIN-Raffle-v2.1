/**
 * Phone identity. C5 and C6, and the uniqueness key of the 05/09/2026 decision.
 *
 * The number is the factor that makes one participation one person. It arrives
 * only from Telegram's request_contact, so it is a number Telegram verified
 * rather than a number somebody typed.
 *
 * C5: it is never stored in clear, anywhere, at any point. What is stored is an
 * HMAC under a key dedicated to phone numbers, which is not the wallet seed and
 * not the code key (F1). The hash is unique platform-wide, so a number used
 * anywhere cannot be reused by another account.
 *
 * The decision is explicit that the key is the NUMBER and not the Telegram user
 * id: deleting and recreating a Telegram account yields a new user id for the
 * same number, and a uniqueness key that resets on demand is not one.
 */

import { PHONE_COOLDOWN_DAYS } from './config.js';
import { keyedHash } from './crypto.js';
import { checked, getDb } from './db.js';

/** C5. The only function that turns a number into something storable. */
export function hashPhone(normalisedNumber: string): Promise<string> {
  return keyedHash('BRIDGE_V2_PHONE_HMAC_KEY', 'phone-identity-v1', normalisedNumber);
}

/**
 * R4: the Telegram user id is personal data too, so it is kept the same way.
 *
 * It is retained at all only to answer a support question about which account a
 * confirmation came from, and it is never a uniqueness key.
 */
export function hashTelegramId(telegramId: string): Promise<string> {
  return keyedHash('BRIDGE_V2_PHONE_HMAC_KEY', 'telegram-user-v1', telegramId);
}

/**
 * Every way the binding and the verification can end.
 *
 * One list rather than two because they are one operation now: the database
 * function that binds is the database function that verifies, so there is no
 * outcome in which a number is spent on an entry that did not move.
 */
export type BindOutcome =
  | 'VERIFIED'
  | 'TAKEN'
  | 'COOLDOWN'
  | 'NUMBER_CHANGED'
  | 'DUPLICATE'
  | 'NOT_AWAITING'
  | 'NO_ENTRY';

/**
 * Binds a number to a participant and verifies that participant's entry, in one
 * transaction (8.7).
 *
 * The decision is made by the database function, not here, because the guards
 * are unique indexes and a check has to be on the same side as the write. A
 * check in TypeScript followed by an insert is the read-compare-write G1
 * forbids, and it is how the same number ends up bound twice under concurrency.
 *
 * 8.8: the function returns a named outcome for every collision and raises for
 * none of them, so the Telegram webhook can never answer 500 to a uniqueness
 * violation and be retried for ever.
 */
export async function bindPhoneAndVerify(
  phoneHash: string,
  participantId: string,
  giveawayId: bigint,
  telegramIdHash: string,
): Promise<BindOutcome> {
  const db = getDb();
  const outcome = checked(
    'phone.bind_and_verify',
    await db.rpc('bridge_v2_bind_phone_and_verify', {
      p_phone_hmac: phoneHash,
      p_participant_id: participantId,
      p_giveaway_id: giveawayId.toString(),
      p_telegram_id_hmac: telegramIdHash,
      p_cooldown_days: PHONE_COOLDOWN_DAYS,
    }),
  ) as BindOutcome | null;
  // A null result is not a success. Treated as a duplicate so the caller refuses.
  return outcome ?? 'DUPLICATE';
}

/**
 * C6: releases the number a participant holds.
 *
 * The old hash keeps its historical row and enters a cooling period before it
 * can be bound again, so a number cannot be cycled between accounts to buy extra
 * entries. The requirement also asks that the account be blocked in campaigns
 * active at the moment of the change; that is enforced where entries are
 * created, because this module does not know what is active.
 */
export async function releasePhone(participantId: string): Promise<number> {
  const db = getDb();
  const released = checked(
    'phone.release',
    await db.rpc('bridge_v2_release_phone', {
      p_participant_id: participantId,
      p_cooldown_days: PHONE_COOLDOWN_DAYS,
    }),
  ) as number | null;
  return released ?? 0;
}
