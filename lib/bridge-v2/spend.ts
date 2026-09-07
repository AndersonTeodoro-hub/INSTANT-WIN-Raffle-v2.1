/**
 * External spend ceilings. B7 and B8.
 *
 * B8 requires an absolute ceiling per provider per hour and per day, and
 * requires that reaching it stops the spending and raises an alert rather than
 * continuing. The claim is made BEFORE the external call, so the ceiling is
 * something the bridge enforces rather than something it discovers on an
 * invoice.
 *
 * B7, the per-campaign budget, is not counted here. It is the slots the creator
 * paid for, and those live on-chain where the contract counts them; chain.ts
 * reads that ceiling directly (H6). Duplicating it in this table would create a
 * second truth that could disagree with the contract.
 */

import { DB_TIMEOUT_MS, SPEND_CAPS, type SpendProvider } from './config.js';
import { getDb, checked } from './db.js';
import type { Logger } from './log.js';
import { alert } from './alert.js';

/**
 * Claims units of a provider's budget.
 *
 * Returns false when either window would be exceeded, having consumed nothing.
 * The caller must treat false as "do not make the call" — there is no partial
 * spend and no retry that would succeed sooner.
 */
export async function claimSpend(
  provider: SpendProvider,
  units: number,
  log: Logger,
): Promise<boolean> {
  const caps = SPEND_CAPS[provider];
  const db = getDb();

  const allowed = checked(
    'spend.claim',
    await db.rpc('bridge_v2_claim_spend', {
      p_provider: provider,
      p_units: units,
      p_hour_cap: caps.hour,
      p_day_cap: caps.day,
    }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as boolean | null;

  if (allowed !== true) {
    await log.event('spend.denied', { provider, units });
    // B8: reaching a ceiling is an event somebody has to see while it is
    // happening, not a line in a report afterwards.
    await alert(log, 'external spend ceiling reached', { provider });
    return false;
  }

  return true;
}
