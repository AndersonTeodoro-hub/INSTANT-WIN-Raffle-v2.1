/**
 * Input parsers. I1: every field of every route passes through one of these
 * before any other use — before the database, before the chain, before a log.
 *
 * Each returns null rather than throwing, because malformed input is a client
 * problem answered with 400, not a server fault answered with 500. That
 * distinction is finding F4 of the V1: a 78-digit giveawayId produced a 500
 * because the value passed a digit-count check and then overflowed downstream.
 */

/** The real ceiling of a uint256, not an approximation by digit count (I2). */
export const UINT256_MAX = (1n << 256n) - 1n;

/** RFC 5322 is not the target. Deliverability is proved by the code arriving. */
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const MAX_EMAIL_LENGTH = 254;

export function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * I2: a giveaway id must fit the uint256 the contract declares, and ids start at
 * one, so zero is rejected as well.
 */
export function parseGiveawayId(value: unknown): bigint | null {
  const raw =
    typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : null;
  if (raw === null || !/^\d{1,78}$/.test(raw)) return null;
  const id = BigInt(raw);
  if (id <= 0n || id > UINT256_MAX) return null;
  return id;
}

/** An email verification code: exactly the configured number of digits. */
export function parseCode(value: unknown, digits: number): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return new RegExp(`^\d{${digits}}$`).test(code) ? code : null;
}

/** A deep-link code as produced by crypto.toBase64Url over LINK_CODE_BYTES. */
export function parseLinkCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^[A-Za-z0-9_-]{16,64}$/.test(code) ? code : null;
}

/**
 * A checksummed-or-lowercase 20-byte address, returned lowercased.
 *
 * Case is not validated as a checksum on purpose: the destination is confirmed
 * back to the participant before anything moves (E4), and rejecting a correct
 * address because a wallet exported it in lower case would be a worse failure
 * than the one a checksum catches.
 */
export function parseAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? (address.toLowerCase() as `0x${string}`) : null;
}

/** A phone number as Telegram delivers it. Digits, optionally a leading plus. */
export function parsePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^\+?\d{6,20}$/.test(raw)) return null;
  // Normalised to E.164 without the plus, so the same number reported with and
  // without it produces the same hash and cannot buy a second entry (C5).
  return raw.replace(/^\+/, '');
}

/** A Telegram numeric id, which is a signed 64-bit integer in the API. */
export function parseTelegramId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d{1,19}$/.test(value.trim())) return value.trim();
  return null;
}
