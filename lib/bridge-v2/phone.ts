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
import { checked, getWriter } from './db.js';

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

export type BindOutcome = 'BOUND' | 'ALREADY_MINE' | 'TAKEN' | 'COOLDOWN';

/**
 * Binds a number to a participant.
 *
 * The decision is made by the database function, not here, because the guard is
 * a unique index and the check has to be on the same side as the write. A check
 * in TypeScript followed by an insert is the read-compare-write G1 forbids, and
 * it is how the same number ends up bound twice under concurrency.
 */
export async function bindPhone(
  phoneHash: string,
  participantId: string,
  telegramIdHash: string,
): Promise<BindOutcome> {
  const db = await getWriter();
  const outcome = checked(
    'phone.bind',
    await db.rpc('bridge_v2_bind_phone', {
      p_phone_hmac: phoneHash,
      p_participant_id: participantId,
      p_telegram_id_hmac: telegramIdHash,
    }),
  ) as BindOutcome | null;
  // A null result is not a success. Treated as TAKEN so the caller refuses.
  return outcome ?? 'TAKEN';
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
  const db = await getWriter();
  const released = checked(
    'phone.release',
    await db.rpc('bridge_v2_release_phone', {
      p_participant_id: participantId,
      p_cooldown_days: PHONE_COOLDOWN_DAYS,
    }),
  ) as number | null;
  return released ?? 0;
}
