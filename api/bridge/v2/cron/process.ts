import { handle, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { requireEnv } from '../../../../lib/bridge-v2/env.js';
import { assertConfigured } from '../../../../lib/bridge-v2/alert.js';
import { timingSafeEqualHex } from '../../../../lib/bridge-v2/crypto.js';
import {
  processEligibleEntries,
  processPrizes,
  publishPendingRoots,
  reconcileFunding,
  reconcileSubmitted,
} from '../../../../lib/bridge-v2/processor.js';
import { acquireRunLock, releaseRunLock, runDeadline } from '../../../../lib/bridge-v2/runlock.js';

/**
 * GET or POST /api/bridge/v2/cron/process
 *
 * Drives the on-chain pipeline: publish roots for what has been verified, fund
 * and submit what has been admitted, finish anything whose receipt was never
 * seen, and collect and deliver the prizes of campaigns that have settled.
 *
 * Separate from the Telegram webhook on purpose. Telegram retries a delivery it
 * does not see acknowledged, so doing chain work inside the webhook would replay
 * funding on every retry. The webhook records the verified fact quickly; this
 * does the slow part, and can be run again safely because every step is
 * conditional on the state it expects (G5).
 *
 * Not publicly callable. The shared secret is required configuration (env.ts),
 * so a project without one does not have a quiet endpoint that refuses: it has a
 * loud one that alerts. Running unauthenticated is not on the list of options —
 * the alternative to the secret is an endpoint anyone can use to make the bridge
 * spend gas.
 */
const route = handle('cron/process', async ({ request, log }) => {
  // K8: EVERY VARIABLE THE PIPELINE DEPENDS ON, CHECKED HERE, ON THE RUN THAT
  // WOULD OTHERWISE FAIL ONE DEEP CHAIN CALL AT A TIME.
  //
  // The check existed only in the hourly maintenance route, so a variable that
  // went missing was found by whichever route ran first — up to sixty minutes
  // during which this one published nothing and funded nothing while every
  // failure was caught per item and logged as if an RPC were having a bad minute.
  // The pipeline runs every minute and is the thing that spends money and moves
  // participants forward, so it is where the answer is needed first.
  //
  // Before the authorisation, deliberately. The bridge being unable to work is
  // not a fact about the caller, and a run that cannot check its own credential
  // because that credential is one of the missing names has to say so.
  await assertConfigured(log);

  const secret = requireEnv('CRON_SECRET');
  // J5 applies here as much as it does to a verification code: a shared secret
  // compared with === returns at the first differing byte, and the difference is
  // measurable across enough samples by anyone who can call this route as often
  // as they like — which is anyone, since the comparison is the only thing
  // guarding it. The bridge already owns a constant-time compare and this is the
  // one place that was not using it.
  if (!timingSafeEqualHex(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return refuse(401, 'Unauthorized.');
  }

  // G6, as a property of the run. This cron fires every minute over work whose
  // slowest unit is two bounded receipt waits, so runs overlap by construction —
  // and two overlapping runs list the same ELIGIBLE rows, read the same account
  // nonce for the role key and for a derived wallet, and pay for the same entry
  // twice. Every signing path below is correct on its own; what made them unsafe
  // was being started twice at once, which is a fact about the schedule and can
  // only be fixed here.
  //
  // A run that finds the lock held does nothing and says so. That is the normal
  // outcome several times an hour, not an error.
  const lock = await acquireRunLock('cron/process');
  if (lock === null) {
    await log.event('route.rejected', { reason: 'run_in_progress' });
    return ok({ skipped: 'run_in_progress' });
  }

  // G4. The platform kills a function at maxDuration wherever it happens to be,
  // and where it happens to be may be between a broadcast transaction and the
  // row that records its hash — the V1's lost tx_hash, reintroduced by a
  // scheduler instead of by a missing timeout. Each stage checks this before
  // starting another unit of work, so a run stops between units and leaves
  // nothing half-written.
  const deadline = runDeadline();

  try {
    // Ordered so that work moves one stage per run in the worst case, and
    // several when everything is healthy. Reconciliation runs first so an entry
    // that has already landed is not looked at again by the funding stage.
    const reconciled = await reconcileSubmitted(log, deadline);
    // I8: entries left in FUNDING by a run that no longer exists. Before the
    // funding stage, so an entry recovered here is available to it in the same
    // run rather than in the next one.
    const recovered = await reconcileFunding(log, deadline);
    const roots = await publishPendingRoots(log, deadline);
    const processed = await processEligibleEntries(log, deadline);
    // Section 7, last because it is the only stage whose input is produced by a
    // third party rather than by the stage before it: a campaign settles when
    // its creator and Chainlink say so, not when this pipeline gets there.
    const prizes = await processPrizes(log, deadline);

    await log.event('route.ok', { reconciled, recovered, roots, processed, prizes });
    return ok({ reconciled, recovered, roots, processed, prizes });
  } finally {
    // Released whatever happened, including on the throw the envelope turns into
    // a 500. A lock that cannot be released expires on its own, which is what
    // covers the one case this finally cannot: the platform killing the process.
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
