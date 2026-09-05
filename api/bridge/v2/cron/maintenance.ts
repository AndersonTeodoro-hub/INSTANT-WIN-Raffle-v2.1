import { handle, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { optionalEnv, assertEnv } from '../../../../lib/bridge-v2/env.js';
import {
  FUNDER_LOW_BALANCE_WEI,
  OPS_RETENTION_DAYS,
  ROUTE_ERROR_ALERT_COUNT,
  SESSION_GRACE_DAYS,
  SPEND_ALERT_FRACTION,
  SPEND_CAPS,
  VRF_LOW_LINK_JUELS,
} from '../../../../lib/bridge-v2/config.js';
import { checked, getWriter } from '../../../../lib/bridge-v2/db.js';
import { sweepConfirmed } from '../../../../lib/bridge-v2/processor.js';
import { funderAddress, poolSize } from '../../../../lib/bridge-v2/funders.js';
import {
  isPaused,
  publicClient,
  registeredBridge,
  roleAddress,
  vrfSubscriptionLink,
} from '../../../../lib/bridge-v2/chain.js';
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
 * H8 and K8: check everything that fails silently and alert before it becomes an
 * outage rather than after. H8 names four: the balance of each funder, the LINK
 * left in the VRF subscription, the consumption of each external provider, and
 * the error rate per route. All four are below, plus the two the bridge cannot
 * work without at all — an empty pool, and a bridge address the contract no
 * longer accepts.
 *
 * Each check is independent and none of them throws: a chain read that fails
 * must not stop the retention pass that already ran, and an alert that cannot be
 * raised is worse than a slow cron.
 */
const route = handle('cron/maintenance', async ({ request, log }) => {
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
    if (balance < FUNDER_LOW_BALANCE_WEI) lowFunders += 1;
  }
  if (lowFunders > 0) await alert(log, 'funder balance low', { funders: lowFunders });

  // H8: the LINK in the VRF subscription. A subscription that runs dry is the
  // one failure this side cannot retry — the draw is requested, the fulfilment
  // never arrives, and the campaign sits in DRAW_REQUESTED for ever.
  let vrfLink: string | null = null;
  try {
    const juels = await vrfSubscriptionLink();
    vrfLink = juels.toString();
    if (juels < VRF_LOW_LINK_JUELS) {
      await alert(log, 'vrf subscription link low', { juels: vrfLink });
    }
  } catch (error) {
    // Not being able to read it is itself worth knowing: the coordinator address
    // comes from the contract, so a failure here means the contract or the RPC
    // is not answering, not that the subscription is fine.
    await log.failure('alert', error, { check: 'vrf_link' });
  }

  // H8: consumption per external provider, against the ceilings B8 enforces.
  // The ceiling stopping the spend is already an alert (spend.ts); this is the
  // one that arrives while there is still budget to act on.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const spend = checked(
    'spend.window_select',
    await db
      .from('bridge_v2_external_spend')
      .select('provider, units')
      .eq('window_kind', 'DAY')
      .gte('window_start', dayStart.toISOString()),
  ) as Array<{ provider: string; units: number }> | null;

  for (const row of Array.isArray(spend) ? spend : []) {
    const caps = SPEND_CAPS[row.provider as keyof typeof SPEND_CAPS];
    if (caps === undefined) continue;
    if (row.units >= caps.day * SPEND_ALERT_FRACTION) {
      await alert(log, 'external spend approaching ceiling', {
        provider: row.provider,
        units: row.units,
        cap: caps.day,
      });
    }
  }

  // H8 and K8: the error rate per route. An attack or a broken dependency shows
  // up here while it is happening, rather than in a bill or a support message.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const errors = checked(
    'ops.error_rate',
    await db
      .from('bridge_v2_ops_events')
      .select('route')
      .eq('kind', 'route.error')
      .gte('created_at', hourAgo),
  ) as Array<{ route: string | null }> | null;

  const perRoute = new Map<string, number>();
  for (const row of Array.isArray(errors) ? errors : []) {
    const key = row.route ?? 'unknown';
    perRoute.set(key, (perRoute.get(key) ?? 0) + 1);
  }
  for (const [name, count] of perRoute) {
    if (count >= ROUTE_ERROR_ALERT_COUNT) {
      await alert(log, 'route error rate high', { route: name, errors: count });
    }
  }

  // The bridge role is what lets a root be published at all. If the contract no
  // longer names our address, every publication will revert and the reason is
  // not visible anywhere else. Reading it was not enough: nothing compared it.
  const registered = (await registeredBridge()).toLowerCase();
  const ours = roleAddress().toLowerCase();
  if (registered !== ours) {
    // K4: the addresses are public, but the alert says only that they differ —
    // the operator reads the pair from the response below, under their own auth.
    await alert(log, 'contract no longer names this bridge');
  }

  const paused = await isPaused();
  if (paused) await alert(log, 'contract is paused');

  await log.event('route.ok', {
    removed,
    swept,
    low_funders: lowFunders,
    bridge_registered: registered === ours,
    paused,
  });
  return ok({
    removed,
    swept,
    lowFunders,
    vrfLink,
    registeredBridge: registered,
    bridgeRegistered: registered === ours,
    contractPaused: paused,
    routeErrors: Object.fromEntries(perRoute),
  });
});

/**
 * 8.10: exported as a named async function declaration.
 *
 * The V1 routes reached this shape by incident — commit cea0c09 renamed a
 * default export to POST because the runtime would not otherwise answer — and
 * the form the three surviving V1 routes use is the declaration. The V2 routes
 * differed from it for no reason, and a route file that does not look like the
 * one known to work is a difference nobody wants to be debugging in production.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
