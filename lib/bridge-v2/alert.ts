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

import { optionalEnv } from './env.js';
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
