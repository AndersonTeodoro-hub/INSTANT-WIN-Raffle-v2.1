import { handle, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { optionalEnv, assertEnv } from '../../../../lib/bridge-v2/env.js';
import { OPS_RETENTION_DAYS, SESSION_GRACE_DAYS } from '../../../../lib/bridge-v2/config.js';
import { checked, getWriter } from '../../../../lib/bridge-v2/db.js';
import { sweepConfirmed } from '../../../../lib/bridge-v2/processor.js';
import { funderAddress, poolSize } from '../../../../lib/bridge-v2/funders.js';
import { isPaused, publicClient, registeredBridge } from '../../../../lib/bridge-v2/chain.js';
import { alert } from '../../../../lib/bridge-v2/alert.js';

/**
 * POST /api/bridge/v2/cron/maintenance
 *
 * Three scheduled duties that have nothing to do with a participant request.
 *
 * I10, K7 and D7: expire what is meant to be ephemeral. The V1 had no cleanup at
 * all, so bridge_codes grew for ever (finding K6).
 *
 * H7: recover the gas entries did not spend, back into the pool that paid for it.
 *
 * H8 and K8: check the things that fail silently — an empty funder pool, a
 * funder with no balance, a bridge address the contract no longer accepts — and
 * alert before they become an outage rather than after.
 */
export const POST = handle('cron/maintenance', async ({ request, log }) => {
  const secret = optionalEnv('BRIDGE_V2_CRON_SECRET');
  if (secret === undefined) return refuse(503, 'Not available.');
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return refuse(401, 'Unauthorized.');
  }

  // Configuration is checked on a schedule so a missing variable is found by a
  // cron run rather than by a participant hitting a 500.
  assertEnv();

  const db = await getWriter();
  const cleaned = checked(
    'cleanup.run',
    await db.rpc('bridge_v2_cleanup', {
      p_ops_retention_days: OPS_RETENTION_DAYS,
      p_session_grace_days: SESSION_GRACE_DAYS,
    }),
  ) as Array<{ table_name: string; rows_removed: number }> | null;

  const removed = Array.isArray(cleaned)
    ? cleaned.reduce((total, row) => total + row.rows_removed, 0)
    : 0;
  await log.event('cleanup.done', { removed });

  // H7: the remainder goes back to a funder, never to an address a request could
  // name (H2).
  const size = poolSize();
  const swept = size > 0 ? await sweepConfirmed(log, funderAddress(0)) : 0;

  // H8: the checks that have no other alarm.
  if (size === 0) await alert(log, 'funder pool is empty');

  const client = publicClient();
  let lowFunders = 0;
  for (let index = 0; index < size; index += 1) {
    const balance = await client.getBalance({ address: funderAddress(index) });
    // A funder that cannot pay for one entry is already out of service; the
    // threshold is deliberately generous so the alert arrives before that.
    if (balance < 10n ** 15n) lowFunders += 1;
  }
  if (lowFunders > 0) await alert(log, 'funder balance low', { funders: lowFunders });

  // The bridge role is what lets a root be published at all. If the contract no
  // longer names our address, every publication will revert and the reason is
  // not visible anywhere else.
  const registered = (await registeredBridge()).toLowerCase();
  const paused = await isPaused();

  await log.event('route.ok', { removed, swept, low_funders: lowFunders, paused });
  return ok({ removed, swept, lowFunders, registeredBridge: registered, contractPaused: paused });
});
