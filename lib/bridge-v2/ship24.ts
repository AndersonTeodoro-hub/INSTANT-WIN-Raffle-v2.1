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
 * POST /trackers — idempotent on the provider's side for the same fields (docs.ship24.com/trackers),
 * so asking again after a lost answer creates nothing twice. The tracker id, or null.
 */
export async function createTracker(trackingNumber: string, postCode: string, country: string): Promise<string | null> {
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
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { tracker?: { trackerId?: unknown } } };
    const trackerId = body?.data?.tracker?.trackerId;
    // An identifier is what the oracle puts in a URL path; anything else is not one.
    return typeof trackerId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(trackerId) ? trackerId : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
