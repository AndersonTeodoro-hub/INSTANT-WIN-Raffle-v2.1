import { handle, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { optionalEnv, assertEnv } from '../../../../lib/bridge-v2/env.js';
import { timingSafeEqualHex } from '../../../../lib/bridge-v2/crypto.js';
import {
  FUNDER_LOW_BALANCE_WEI,
  OPS_RETENTION_DAYS,
  PENALTY_DECAY_DAYS,
  ROUTE_ERROR_ALERT_COUNT,
  SESSION_GRACE_DAYS,
  SPEND_ALERT_FRACTION,
  SPEND_CAPS,
  VRF_LOW_LINK_JUELS,
  DB_TIMEOUT_MS,
} from '../../../../lib/bridge-v2/config.js';
import { checked, getDb } from '../../../../lib/bridge-v2/db.js';
import { sweepConfirmed } from '../../../../lib/bridge-v2/processor.js';
import { acquireRunLock, releaseRunLock, runDeadline } from '../../../../lib/bridge-v2/runlock.js';
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
 * GET or POST /api/bridge/v2/cron/maintenance
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
 * EACH CHECK IS INDEPENDENT AND NONE OF THEM STOPS ANOTHER — which this comment
 * claimed before it was true. Only the VRF read was wrapped; the funder balance
 * loop, the bridge-address comparison and the pause read were bare awaits, and
 * an RPC that answered slowly on any one of them threw straight past everything
 * after it. The order made that as bad as it could be: the two checks the bridge
 * cannot work without — a role the contract no longer accepts, and a paused
 * contract — were last, so the single most likely failure was the one that
 * guaranteed they were never reached. A monitoring pass whose checks depend on
 * each other reports the health of its own first RPC call.
 *
 * `safely` below is the whole fix. Every check returns a value or records why it
 * could not, the run continues either way, and a check that could not run is
 * reported as unknown rather than as healthy — the response distinguishes the
 * two, because for an operator "no answer" and "fine" are opposite things.
 */

/**
 * Runs one check, and lets its failure end that check and nothing else.
 *
 * Returns null when it could not run. The caller decides what null means for the
 * value it was after; nothing here decides that a failed check is a passed one.
 */
async function safely<T>(
  log: { failure: (kind: 'alert', error: unknown, detail?: Record<string, string>) => Promise<void> },
  check: string,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    await log.failure('alert', error, { check });
    return null;
  }
}

const route = handle('cron/maintenance', async ({ request, log }) => {
  const secret = optionalEnv('CRON_SECRET');
  if (secret === undefined) return refuse(503, 'Not available.');
  // J5 applies here as much as it does to a verification code: a shared secret
  // compared with === returns at the first differing byte, and the difference is
  // measurable across enough samples by anyone who can call this route as often
  // as they like — which is anyone, since the comparison is the only thing
  // guarding it. The bridge already owns a constant-time compare and this is the
  // one place that was not using it.
  if (!timingSafeEqualHex(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return refuse(401, 'Unauthorized.');
  }

  // Its own lock, so two maintenance runs cannot overlap.
  //
  // Not the pipeline's lock, deliberately. The sweep does need it — that is the
  // one thing here that signs as a derived wallet and reads its nonce, which is
  // the account state the pipeline is also using — but the checks do not, and
  // taking the pipeline lock for the whole route would have meant that a busy
  // pipeline, which is exactly when monitoring matters most, silently skipped
  // every check for as long as it stayed busy. The pipeline runs every minute
  // and may hold its lock for five, so "H8 is suspended while the bridge is
  // under load" is not a trade worth making for one hourly recovery task.
  const lock = await acquireRunLock('cron/maintenance');
  if (lock === null) {
    await log.event('route.rejected', { reason: 'run_in_progress' });
    return ok({ skipped: 'run_in_progress' });
  }
  const deadline = runDeadline();

  try {
    // Configuration is checked on a schedule so a missing variable is found by a
    // cron run rather than by a participant hitting a 500. Inside safely,
    // because a missing variable must not stop the retention pass either — it is
    // reported, like every other check.
    const configOk = await safely(log, 'config', async () => {
      assertEnv();
      return true;
    });

    const db = getDb();
    const removed = await safely(log, 'cleanup', async () => {
      const cleaned = checked(
        'cleanup.run',
        await db.rpc('bridge_v2_cleanup', {
          p_ops_retention_days: OPS_RETENTION_DAYS,
          p_session_grace_days: SESSION_GRACE_DAYS,
          p_penalty_decay_days: PENALTY_DECAY_DAYS,
        }).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
      ) as Array<{ table_name: string; rows_removed: number }> | null;

      const total = Array.isArray(cleaned)
        ? cleaned.reduce((sum, row) => sum + row.rows_removed, 0)
        : 0;
      await log.event('cleanup.done', { removed: total });
      return total;
    });

    // H7: the remainder goes back to a funder, never to an address a request
    // could name (H2).
    //
    // G6: this is the one thing in this route that signs as a derived wallet,
    // so it runs under the PIPELINE's lock and not this route's. Without it the
    // sweep and the funding stage would read the same wallet's nonce at the same
    // moment, which is the collision the pipeline lock exists to prevent — the
    // sweep would replace the entry transaction rather than follow it. If the
    // pipeline is mid-run the sweep is skipped and the next hour takes it: it is
    // a recovery task over a queue that drains, and nothing is lost by waiting.
    const size = await safely(log, 'pool_size', async () => poolSize());
    let swept: number | null = 0;
    let sweepSkipped = false;
    if (size !== null && size > 0) {
      const pipeline = await acquireRunLock('cron/process');
      if (pipeline === null) {
        sweepSkipped = true;
      } else {
        try {
          swept = await safely(log, 'sweep', () =>
            sweepConfirmed(log, funderAddress(0), deadline),
          );
        } finally {
          await releaseRunLock(pipeline);
        }
      }
    }

    // H8: the checks that have no other alarm.
    if (size === 0) await alert(log, 'funder pool is empty');

    const lowFunders = await safely(log, 'funder_balances', async () => {
      const client = publicClient();
      let low = 0;
      for (let index = 0; index < (size ?? 0); index += 1) {
        const balance = await client.getBalance({ address: funderAddress(index) });
        // A funder that cannot pay for one entry is already out of service; the
        // threshold is deliberately generous so the alert arrives before that.
        if (balance < FUNDER_LOW_BALANCE_WEI) low += 1;
      }
      if (low > 0) await alert(log, 'funder balance low', { funders: low });
      return low;
    });

    // H8: the LINK in the VRF subscription. A subscription that runs dry is the
    // one failure this side cannot retry — the draw is requested, the fulfilment
    // never arrives, and the campaign sits in DRAW_REQUESTED for ever. Not being
    // able to read it is itself worth knowing: the coordinator address comes
    // from the contract, so a failure means the contract or the RPC is not
    // answering, not that the subscription is fine.
    const vrfLink = await safely(log, 'vrf_link', async () => {
      const juels = await vrfSubscriptionLink();
      if (juels < VRF_LOW_LINK_JUELS) {
        await alert(log, 'vrf subscription link low', { juels: juels.toString() });
      }
      return juels.toString();
    });

    // H8: consumption per external provider, against the ceilings B8 enforces.
    // The ceiling stopping the spend is already an alert (spend.ts); this is the
    // one that arrives while there is still budget to act on.
    await safely(log, 'external_spend', async () => {
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const spend = checked(
        'spend.window_select',
        await db
          .from('bridge_v2_external_spend')
          .select('provider, units')
          .eq('window_kind', 'DAY')
          .gte('window_start', dayStart.toISOString())
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
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
      return true;
    });

    // H8 and K8: the error rate per route. An attack or a broken dependency
    // shows up here while it is happening, rather than in a bill or a support
    // message.
    const perRoute = (await safely(log, 'route_error_rate', async () => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const errors = checked(
        'ops.error_rate',
        await db
          .from('bridge_v2_ops_events')
          .select('route')
          .eq('kind', 'route.error')
          .gte('created_at', hourAgo)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
      ) as Array<{ route: string | null }> | null;

      const counts = new Map<string, number>();
      for (const row of Array.isArray(errors) ? errors : []) {
        const key = row.route ?? 'unknown';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [name, count] of counts) {
        if (count >= ROUTE_ERROR_ALERT_COUNT) {
          await alert(log, 'route error rate high', { route: name, errors: count });
        }
      }
      return counts;
    })) ?? new Map<string, number>();

    // The bridge role is what lets a root be published at all. If the contract
    // no longer names our address, every publication will revert and the reason
    // is not visible anywhere else. This and the pause check used to be last and
    // unguarded, which meant the two things the bridge cannot work without were
    // the two most likely to be skipped.
    const bridgeRegistered = await safely(log, 'bridge_role', async () => {
      const registered = (await registeredBridge()).toLowerCase();
      const ours = roleAddress().toLowerCase();
      if (registered !== ours) {
        // K4: the addresses are public, but the alert says only that they
        // differ — the operator reads the pair from the response below, under
        // their own auth.
        await alert(log, 'contract no longer names this bridge');
      }
      return { registered, matches: registered === ours };
    });

    const paused = await safely(log, 'paused', async () => {
      const value = await isPaused();
      if (value) await alert(log, 'contract is paused');
      return value;
    });

    // null everywhere means "this check could not run", and is reported as such
    // rather than as a healthy value. An operator reading `bridgeRegistered:
    // null` knows to look; reading `false` for the same thing would send them
    // after a role that may be perfectly fine.
    const result = {
      configOk,
      removed,
      swept,
      sweepSkipped,
      lowFunders,
      vrfLink,
      registeredBridge: bridgeRegistered?.registered ?? null,
      bridgeRegistered: bridgeRegistered?.matches ?? null,
      contractPaused: paused,
      routeErrors: Object.fromEntries(perRoute),
    };

    await log.event('route.ok', {
      removed,
      swept,
      low_funders: lowFunders,
      bridge_registered: result.bridgeRegistered,
      paused,
    });
    return ok(result);
  } finally {
    await releaseRunLock(lock);
  }
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

/**
 * Vercel invokes a scheduled path with GET, so the crons in vercel.json would
 * otherwise reach a module that only answers POST and take a 405 every run.
 * Both verbs run the same handler: the authorisation is the shared secret in the
 * Authorization header, which is a property of the caller and not of the method.
 */
export async function GET(request: Request): Promise<Response> {
  return route(request);
}
