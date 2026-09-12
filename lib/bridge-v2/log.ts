/**
 * Diagnostics for Bridge V2.
 *
 * Two requirements pull in opposite directions and both have to hold.
 *
 * K4 forbids personal data in logs: no full email, no phone number, no code, no
 * derivation index, no key, no stack trace. K5 requires enough context to
 * diagnose a production failure — the V1 threw away err.message and the stack
 * and kept nothing else, so an error in production was simply unexplainable.
 *
 * The resolution is a correlation id plus a typed event: identifiers that can be
 * followed across a request, never identifiers that name a person. An error is
 * recorded by its class and a short stable code, never by its message, because a
 * driver message can contain row values.
 */

import { getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';
import { contractErrorName } from './abi.js';

/** Event kinds. A closed set, so a grep for a kind finds every site that emits it. */
export type OpsKind =
  | 'route.ok'
  | 'route.rejected'
  | 'route.error'
  | 'ratelimit.denied'
  | 'sybil.rejected'
  | 'code.issued'
  | 'code.failed'
  | 'telegram.update'
  | 'telegram.rejected'
  | 'phone.bound'
  | 'phone.rejected'
  | 'entry.created'
  | 'entry.verified'
  | 'entry.eligible'
  | 'entry.funded'
  | 'entry.submitted'
  | 'entry.confirmed'
  | 'entry.failed'
  | 'entry.resumed'
  | 'root.published'
  | 'funder.acquired'
  | 'funder.exhausted'
  | 'funder.disabled'
  | 'spend.denied'
  | 'gas.rejected'
  | 'prize.claimed'
  | 'prize.delivered'
  | 'prize.expired'
  | 'prize.custody_expired'
  | 'prize.failed'
  | 'sweep.done'
  | 'cleanup.done'
  // The result of a settled campaign, per entry, and the email that reports it.
  // outcome.recorded carries no address and no email — K4: the ops table takes
  // the giveaway and the answer, never the person.
  | 'outcome.recorded'
  | 'outcome.notified'
  | 'outcome.failed'
  // 07/09/2026 decision: a creator without a wallet, creator/campaign/submit.ts.
  | 'creator_campaign.confirmed'
  | 'creator_campaign.failed'
  | 'alert';

/**
 * Values allowed in a detail object.
 *
 * Deliberately narrow. There is no place here for an arbitrary object, because
 * an arbitrary object is how an email ends up in a log: somebody passes the row
 * they already had.
 */
export type Detail = Record<string, string | number | boolean | null>;

export interface Logger {
  readonly correlationId: string;
  event(kind: OpsKind, detail?: Detail): Promise<void>;
  /**
   * Records a failure by class, plus the contract error when there is one. Never
   * the message, never the stack.
   */
  failure(kind: OpsKind, error: unknown, detail?: Detail): Promise<void>;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

/**
 * K5: the class, and — for a revert — the error the contract actually raised.
 *
 * The class alone was not diagnosis. Every refusal the manager makes arrives as
 * one wrapper class, so "EstimateGasExecutionError" was the recorded cause of a
 * closed campaign, an unverifiable proof, a paused contract, an exhausted slot
 * ledger and a revoked bridge role alike — five things an operator would do five
 * different things about, written down as the same word. The four bytes that tell
 * them apart were in the error the whole time and in the ABI the whole time, and
 * nothing put the two together.
 *
 * K4 still holds: a contract error NAME is a constant of a deployed contract.
 * contractErrorName returns nothing else — never the arguments, which for the
 * built-in Error(string) would be a string the contract chose.
 */
function failureDetail(error: unknown, detail: Detail): Detail {
  const revert = contractErrorName(error);
  return revert === null
    ? { ...detail, error_class: errorName(error) }
    : { ...detail, error_class: errorName(error), error_revert: revert };
}

/**
 * Builds a logger for one request.
 *
 * Writing an event must never be the reason a request fails, so persistence
 * failures are swallowed after being surfaced on the console. A bridge that
 * returns 500 because its own audit table is full is a bridge that turned
 * observability into an outage.
 */
export function createLogger(route: string, correlationId: string): Logger {
  async function persist(kind: OpsKind, detail: Detail): Promise<void> {
    // eslint-disable-next-line no-console
    console.info(`[bridge-v2] ${kind} route=${route} cid=${correlationId}`);
    try {
      const db = getDb();
      // G4: bounded like every other database call. This one is swallowed on
      // failure, which makes the timeout more important rather than less: an
      // unbounded wait here would hold a request open for the sake of a log line
      // it has already decided it can live without.
      const { error } = await db
        .from('bridge_v2_ops_events')
        .insert({
          correlation_id: correlationId,
          kind,
          route,
          detail,
        })
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (error) console.warn(`[bridge-v2] ops event not persisted cid=${correlationId}`);
    } catch {
      console.warn(`[bridge-v2] ops event not persisted cid=${correlationId}`);
    }
  }

  return {
    correlationId,
    event: (kind, detail = {}) => persist(kind, detail),
    failure: (kind, error, detail = {}) => persist(kind, failureDetail(error, detail)),
  };
}
