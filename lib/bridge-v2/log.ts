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
  /** Records a failure by class and code. Never the message, never the stack. */
  failure(kind: OpsKind, error: unknown, detail?: Detail): Promise<void>;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
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
    failure: (kind, error, detail = {}) =>
      persist(kind, { ...detail, error_class: errorName(error) }),
  };
}
