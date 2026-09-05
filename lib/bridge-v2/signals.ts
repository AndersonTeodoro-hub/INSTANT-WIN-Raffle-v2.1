/**
 * Correlation signals (C7) and the keys the rate limiter counts against (B2).
 *
 * Everything leaves this module hashed. K4 forbids a raw IP or user agent in a
 * log or a table, and B2 needs a stable key per axis, so the two requirements
 * meet at "hash it once, at the edge, and never carry the original further".
 *
 * These signals detect bursts: many registrations from one subnet, one client
 * fingerprint across many addresses, a cadence no human produces. C8 puts that
 * detection before the on-chain entry, because after it nothing can be undone.
 */

import { sha256Hex } from './crypto.js';

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
    sha256Hex(`ip:${ip}`),
    sha256Hex(`subnet:${subnetOf(ip)}`),
    sha256Hex(`client:${clientFingerprint(request)}`),
  ]);
  return { ipHash, subnetHash, clientHash };
}
