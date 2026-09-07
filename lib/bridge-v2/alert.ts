/**
 * Alerting. K8 and H8.
 *
 * An attack in progress has to be visible while it is in progress. The bridge
 * cannot page anyone by itself, so it does the two things a serverless function
 * can: it records the event where the dashboards look (ops events), and it posts
 * to a webhook if one is configured.
 *
 * The webhook is optional by design. An unset webhook degrades alerting to the
 * events table; it never makes an alert throw, because an alert that can fail
 * the request it is warning about is worse than no alert.
 *
 * K4: the payload carries a kind and coarse counters. Never an email, a number,
 * an address, or a code.
 */

import { assertEnv, MissingEnvError, optionalEnv } from './env.js';
import { HTTP_TIMEOUT_MS } from './config.js';
import type { Detail, Logger } from './log.js';

export async function alert(log: Logger, summary: string, detail: Detail = {}): Promise<void> {
  await log.event('alert', { ...detail, summary });

  const url = optionalEnv('BRIDGE_V2_ALERT_WEBHOOK_URL');
  if (url === undefined) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'bridge-v2',
        summary,
        correlation_id: log.correlationId,
        detail,
      }),
      signal: controller.signal,
    });
  } catch {
    // Swallowed deliberately. The event is already recorded; a webhook outage
    // must not propagate into the request that raised the alert.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * K8: configuration is checked, and a gap in it is announced rather than acted on
 * quietly.
 *
 * Both scheduled routes call this before they do anything else. The throw is
 * deliberate and is re-raised after the alert: an incomplete configuration is not
 * a condition to work around, and the envelope in http.ts turns it into a logged
 * route.error carrying the missing NAMES and a generic 500 to the caller. What it
 * must never be is a quiet answer — a 503 that says "not available" to a
 * scheduler that does not read answers is the same as no bridge at all, and that
 * is exactly what an unset CRON_SECRET used to produce.
 *
 * F3: names only. The alert carries which variables are missing and nothing about
 * what any of them contains.
 */
export async function assertConfigured(log: Logger): Promise<void> {
  try {
    assertEnv();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      await alert(log, 'configuration incomplete', { missing: error.names.join(',') });
    }
    throw error;
  }
}
