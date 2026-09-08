import { handle, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { requireEnv } from '../../../../lib/bridge-v2/env.js';
import { assertConfigured } from '../../../../lib/bridge-v2/alert.js';
import { timingSafeEqualHex } from '../../../../lib/bridge-v2/crypto.js';
import { PIPELINE_PHASES, type PipelinePhase } from '../../../../lib/bridge-v2/config.js';
import type { Logger } from '../../../../lib/bridge-v2/log.js';
import {
  processEligibleEntries,
  processPrizes,
  publishPendingRoots,
  reconcileFunding,
  reconcileSubmitted,
} from '../../../../lib/bridge-v2/processor.js';
import {
  acquireRunLock,
  nextRunSequence,
  releaseRunLock,
  runDeadline,
  type RunDeadline,
} from '../../../../lib/bridge-v2/runlock.js';

/**
 * The stages, under the names config.ts declares a reservation for.
 *
 * Keyed by PipelinePhase rather than merely listed, so a stage without a declared
 * reservation does not compile and a declared reservation without a stage does
 * not either. The numbers and the work they describe used to live in different
 * files with nothing tying them together, which is how the prize stage came to
 * reserve more than the entire budget and stay that way.
 */
const STAGES: Record<PipelinePhase, (log: Logger, deadline: RunDeadline) => Promise<number>> = {
  reconcileSubmitted,
  reconcileFunding,
  publishRoots: publishPendingRoots,
  processEntries: processEligibleEntries,
  processPrizes,
};

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
    // §7/G4: WHERE THIS RUN STARTS, AND WHY IT IS NOT ALWAYS THE SAME PLACE.
    //
    // The five stages reserve 460 seconds between them out of a budget of 280, and
    // they used to run in a fixed order with the largest reservation last. That is
    // not a preference about ordering, it is starvation stated as code: under
    // continuous load the four stages in front consume the budget, the prize
    // stage's guard is false, and prizes are never claimed or delivered at all —
    // the same outage this file's own history already records from an arithmetic
    // error, reached again by scheduling, and just as silent, because a stage that
    // starts nothing returns zero and reads like a stage with nothing to do.
    //
    // One number per run, taken from a sequence so it advances once per run that
    // actually happens rather than once per minute, and every phase leads a run
    // once within PHASE_STARVATION_BOUND_RUNS. A phase that leads has the whole
    // budget, and config.ts checks that the whole budget is enough for each of
    // them; those two facts together are the guarantee.
    //
    // Nothing is skipped and nothing is reordered — the declared order is still the
    // order, read from a different starting point. It can be, because correctness
    // never rested on it: every stage is conditional on the state it expects (G5),
    // and no stage is the input of the next within one run. What the declared order
    // buys is latency in the healthy case, and the run that starts at phase zero
    // still gets exactly that.
    //
    // Read inside the try, not between the lock and it: this call reaches the
    // database, and a lock taken outside a try/finally that can throw is a lock
    // nothing ever gives back except its own TTL. It used to sit here unguarded,
    // so a single failing sequence read orphaned the lock every cycle it was
    // retried, and the pipeline never got past it.
    const offset = (await nextRunSequence()) % PIPELINE_PHASES.length;

    const counts: Record<string, number> = {};
    for (let step = 0; step < PIPELINE_PHASES.length; step += 1) {
      const phase = PIPELINE_PHASES[(offset + step) % PIPELINE_PHASES.length];
      counts[phase] = await STAGES[phase](log, deadline);
    }

    const firstPhase = PIPELINE_PHASES[offset];
    // The starting phase is in the record because a stage that did nothing and a
    // stage that never began look identical from a count, and telling them apart
    // is the whole point of the rotation being visible.
    await log.event('route.ok', { ...counts, first_phase: firstPhase });
    return ok({ firstPhase, ...counts });
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
