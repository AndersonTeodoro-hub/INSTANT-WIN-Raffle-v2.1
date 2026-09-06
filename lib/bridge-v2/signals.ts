/**
 * Correlation signals (C7) and the keys the rate limiter counts against (B2).
 *
 * Everything leaves this module hashed, and hashed UNDER A KEY. K4 forbids a raw
 * IP or user agent in a log or a table, and B2 needs a stable key per axis, so
 * the two requirements meet at "hash it once, at the edge, and never carry the
 * original further".
 *
 * WHY THE HASH IS KEYED. A bare SHA-256 was not enough, and reading one as a
 * pseudonym was the mistake. K4 asks for identifiers that are correlatable and
 * not identifying; an unkeyed digest of an IPv4 address is both, because the
 * whole input space is 2^32 and inverting the table is an afternoon on a laptop.
 * The subnet is smaller still, and a device fingerprint is a short list of
 * header values anyone can enumerate. Under HMAC with a root nobody outside the
 * runtime holds, the stored value correlates exactly as well and identifies
 * nobody without the key — which is the property the requirement actually names.
 *
 * These signals detect bursts: many registrations from one subnet, one client
 * fingerprint across many addresses, a cadence no human produces. C8 puts that
 * detection before the on-chain entry, because after it nothing can be undone.
 */

import { keyedHash } from './crypto.js';

export interface RequestSignals {
  readonly ipHash: string;
  readonly subnetHash: string;
  readonly clientHash: string;
}

/**
 * The client address as the platform reports it.
 *
 * x-forwarded-for is a list; the left-most entry is the original client and the
 * rest are proxies. On Vercel the header is set by the platform, so the value is
 * trustworthy in a way it would not be on a self-hosted origin.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(',')[0];
    if (first !== undefined) return first.trim();
  }
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown';
}

/**
 * Reduces an address to the block an attacker would have to buy across.
 *
 * IPv4 to its /24 and IPv6 to its /48, which are the units residential and
 * hosting providers actually allocate. Rotating inside a block does not create a
 * new subnet key, so B2 keeps holding when only the last octet changes.
 */
function subnetOf(ip: string): string {
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((part) => part.length > 0);
    return groups.slice(0, 3).join(':');
  }
  const octets = ip.split('.');
  return octets.length === 4 ? octets.slice(0, 3).join('.') : ip;
}

/**
 * A coarse client fingerprint.
 *
 * User agent plus the language and encoding preferences. Deliberately weak: it
 * is a burst detector, not an identifier, and anything stronger would be
 * tracking rather than abuse prevention.
 */
function clientFingerprint(request: Request): string {
  return [
    request.headers.get('user-agent') ?? '',
    request.headers.get('accept-language') ?? '',
    request.headers.get('accept-encoding') ?? '',
  ].join('|');
}

export async function extractSignals(request: Request): Promise<RequestSignals> {
  const ip = clientIp(request);
  const [ipHash, subnetHash, clientHash] = await Promise.all([
    keyedHash('BRIDGE_V2_SIGNAL_HMAC_KEY', 'signal-ip-v1', ip),
    keyedHash('BRIDGE_V2_SIGNAL_HMAC_KEY', 'signal-subnet-v1', subnetOf(ip)),
    keyedHash('BRIDGE_V2_SIGNAL_HMAC_KEY', 'signal-client-v1', clientFingerprint(request)),
  ]);
  return { ipHash, subnetHash, clientHash };
}
