/**
 * The tracking provider. SPEC-BLOCO-03 L8, M1, M9, P7.
 *
 * One call: register a shipment, so the oracle can later read it by the
 * identifier the provider returns (M6). The bridge uses a key of its own of the
 * dedicated account (M1, BRIDGE_V2_SHIP24_KEY), never the oracle's. P7: the
 * provider receives the tracking number, the destination post code and the
 * country — never a name, an email or the rest of the address, which its API
 * would also accept.
 *
 * Raw fetch, as mail.ts does it (K2): no SDK. A failure is reported, never
 * thrown: 9.5.5 says a provider that is down blocks no state, and the caller
 * keeps the shipment and asks again later (maintenance, TRACKER_RETRY_MS).
 */

import { HTTP_TIMEOUT_MS } from './config.js';
import { requireKeptraEnv } from './env.js';

const TRACKERS_ENDPOINT = 'https://api.ship24.com/public/v1/trackers';

/**
 * What the provider answered: the tracker, a refusal of the shipment itself, or a
 * failure worth asking again.
 *
 * P5-3: a 4xx that is about the request — 400, 404, 422 — is the provider saying
 * this shipment will not be taken, and it will say so every time; the retries
 * stop. A 401 or 403 is the bridge's key, 408 and 429 are the moment, and a 5xx
 * or no answer is the provider: those are asked again.
 */
export type TrackerResult = { readonly kind: 'created'; readonly trackerId: string } | { readonly kind: 'refused' } | { readonly kind: 'failed' };

const REFUSED_STATUSES = new Set([400, 404, 422]);

/**
 * POST /trackers — idempotent on the provider's side for the same fields (docs.ship24.com/trackers),
 * so asking again after a lost answer creates nothing twice.
 */
export async function createTracker(trackingNumber: string, postCode: string, country: string): Promise<TrackerResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(TRACKERS_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireKeptraEnv('BRIDGE_V2_SHIP24_KEY')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ trackingNumber, destinationPostCode: postCode, destinationCountryCode: country }),
      signal: controller.signal,
    });
    if (!response.ok) return { kind: REFUSED_STATUSES.has(response.status) ? 'refused' : 'failed' };
    const body = (await response.json()) as { data?: { tracker?: { trackerId?: unknown } } };
    const trackerId = body?.data?.tracker?.trackerId;
    // An identifier is what the oracle puts in a URL path; anything else is not one.
    return typeof trackerId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(trackerId) ? { kind: 'created', trackerId } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
