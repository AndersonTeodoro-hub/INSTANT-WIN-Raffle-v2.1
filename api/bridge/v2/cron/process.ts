import { handle, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { optionalEnv } from '../../../../lib/bridge-v2/env.js';
import {
  processEligibleEntries,
  publishPendingRoots,
  reconcileSubmitted,
} from '../../../../lib/bridge-v2/processor.js';

/**
 * GET or POST /api/bridge/v2/cron/process
 *
 * Drives the on-chain pipeline: publish roots for what has been verified, fund
 * and submit what has been admitted, and finish anything whose receipt was never
 * seen.
 *
 * Separate from the Telegram webhook on purpose. Telegram retries a delivery it
 * does not see acknowledged, so doing chain work inside the webhook would replay
 * funding on every retry. The webhook records the verified fact quickly; this
 * does the slow part, and can be run again safely because every step is
 * conditional on the state it expects (G5).
 *
 * Not publicly callable. Without the shared secret configured the route refuses
 * outright rather than running unauthenticated, because the alternative is an
 * endpoint that anyone can use to make the bridge spend gas.
 */
const route = handle('cron/process', async ({ request, log }) => {
  const secret = optionalEnv('CRON_SECRET');
  if (secret === undefined) return refuse(503, 'Not available.');
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return refuse(401, 'Unauthorized.');
  }

  // Ordered so that work moves one stage per run in the worst case, and several
  // when everything is healthy. Reconciliation runs first so an entry that has
  // already landed is not looked at again by the funding stage.
  const reconciled = await reconcileSubmitted(log);
  const roots = await publishPendingRoots(log);
  const processed = await processEligibleEntries(log);

  await log.event('route.ok', { reconciled, roots, processed });
  return ok({ reconciled, roots, processed });
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
