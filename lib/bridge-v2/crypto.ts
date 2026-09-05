/**
 * Cryptographic primitives for Bridge V2.
 *
 * Everything here uses Web Crypto (globalThis.crypto), not node:crypto. It is
 * present in the Vercel runtime without an import, and its types come from the
 * DOM lib the project already compiles against — so the module that touches key
 * material pulls in no package at all (K2).
 *
 * F4: no CryptoKey and no key string is held in module scope. Keys are imported
 * inside the function that uses them and fall out of scope with it. This is a
 * partial mitigation, declared in R2: process.env persists in a warm container
 * and JavaScript cannot zero a string. What it avoids is a second long-lived
 * copy that outlives the request.
 */

import { requireEnv, type RequiredEnvName } from './env.js';

/** CSPRNG bytes. The only source of randomness in the bridge. */
export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

/** URL-safe base64 without padding, for values that travel in a URL or a cookie. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * A decimal string of exactly `digits` digits, uniformly distributed (J1).
 *
 * The rejection loop matters. 2^32 is not a multiple of 10^6, so taking the
 * remainder directly would make the low end of the range very slightly more
 * likely. The result would still look random and would still be wrong, which is
 * the kind of weakness nobody notices until it is being exploited.
 */
export function randomDigits(digits: number): string {
  const range = 10 ** digits;
  const limit = Math.floor(0xffff_ffff / range) * range;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] as number;
  } while (value >= limit);
  return String(value % range).padStart(digits, '0');
}

/**
 * HMAC-SHA256 under one of the five independent roots (F1), with an additional
 * domain label.
 *
 * Two levels of separation, on purpose. The root is chosen by environment
 * variable, so a phone hash and a session hash never share key material at all.
 * The label separates uses within one root, so that adding a second use of the
 * same root later cannot produce a value that is valid for the first.
 *
 * The effective key is HMAC(root, label) rather than the root itself, so nothing
 * that leaks from here is the configured secret.
 */
export async function keyedHash(
  root: RequiredEnvName,
  label: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const rootKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(requireEnv(root)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derived = await crypto.subtle.sign('HMAC', rootKey, encoder.encode(label));
  const subKey = await crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', subKey, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

/**
 * Constant-time comparison of two hex strings (J5).
 *
 * A plain === returns at the first differing byte, and that timing difference is
 * measurable across enough samples. This always walks the whole string.
 *
 * The length check is not a leak: both sides are fixed-width hashes produced by
 * this module, so an unequal length means a malformed input, not a near miss.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Unkeyed SHA-256, hex. Used only where the input is not a secret and the point
 * is a stable identifier rather than authentication — correlation signals (C7)
 * and rate-limit keys (B2), which must never hold an IP or an email in clear.
 */
export async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return toHex(new Uint8Array(digest));
}

/** A correlation id for one request (K5). Not a secret; never derived from user data. */
export function correlationId(): string {
  return crypto.randomUUID();
}
