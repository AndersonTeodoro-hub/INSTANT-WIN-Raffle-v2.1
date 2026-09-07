/**
 * The database double.
 *
 * Stands in for lib/bridge-v2/db.ts. Only getDb() is replaced: checked,
 * checkedMaybe, DatabaseError and stripSelfBearer are re-exported from the real
 * module, because they are pure and they are G2 itself — a double that
 * reimplemented them would be testing the double.
 *
 * The builder mirrors the shape of the PostgREST client the production code
 * actually uses: from().select().eq().maybeSingle(), insert().select().single(),
 * update().eq().is().select().maybeSingle(), rpc(), and .abortSignal() anywhere
 * in the chain. Every call is recorded, so a test can assert what was asked as
 * well as what came back — which is how G4 (every external wait bounded) and K4
 * (no personal data written to the ops table) are checked across the whole
 * surface rather than one call at a time.
 *
 * There is no Postgres on this machine, so what this double does NOT do is
 * execute the SQL of migrations 0004-0006. Those are covered statically in
 * suites/sql.test.mjs, and the report says so.
 */

import { checked, checkedMaybe, DatabaseError, stripSelfBearer } from '../../../lib/bridge-v2/db.ts';

export { checked, checkedMaybe, DatabaseError, stripSelfBearer };

/** Every call made through this double, in order. */
export const calls = [];

/** key -> (op) => {data, error} | throws. Keys: "table:verb" and "rpc:name". */
const handlers = new Map();

/** Result used when no handler matches. Never an error, so a test opts in. */
let fallback = { data: null, error: null };

export function reset() {
  calls.length = 0;
  handlers.clear();
  fallback = { data: null, error: null };
}

/** Programs one operation. `key` is "table:verb" or "rpc:name". */
export function on(key, handler) {
  handlers.set(key, typeof handler === 'function' ? handler : () => handler);
}

/** What an unprogrammed operation returns. */
export function setFallback(result) {
  fallback = result;
}

/** Calls whose key matches, for assertions. */
export function callsTo(key) {
  return calls.filter((call) => call.key === key);
}

function dispatch(op) {
  op.key = op.kind === 'rpc' ? `rpc:${op.name}` : `${op.table}:${op.verb ?? 'select'}`;
  calls.push(op);
  const handler = handlers.get(op.key);
  const result = handler === undefined ? fallback : handler(op);
  if (result instanceof Error) throw result;
  return result;
}

function makeBuilder(op) {
  const chain = (fn) => (...args) => {
    fn(...args);
    return builder;
  };

  const builder = {
    select: chain((columns) => {
      op.columns = columns;
      op.verb ??= 'select';
    }),
    insert: chain((payload) => {
      op.verb = 'insert';
      op.payload = payload;
    }),
    upsert: chain((payload, options) => {
      op.verb = 'upsert';
      op.payload = payload;
      op.options = options;
    }),
    update: chain((payload) => {
      op.verb = 'update';
      op.payload = payload;
    }),
    delete: chain(() => {
      op.verb = 'delete';
    }),
    eq: chain((column, value) => op.filters.push(['eq', column, value])),
    neq: chain((column, value) => op.filters.push(['neq', column, value])),
    is: chain((column, value) => op.filters.push(['is', column, value])),
    not: chain((column, operator, value) => op.filters.push(['not', column, operator, value])),
    lt: chain((column, value) => op.filters.push(['lt', column, value])),
    lte: chain((column, value) => op.filters.push(['lte', column, value])),
    gt: chain((column, value) => op.filters.push(['gt', column, value])),
    gte: chain((column, value) => op.filters.push(['gte', column, value])),
    in: chain((column, value) => op.filters.push(['in', column, value])),
    order: chain((column, options) => op.order.push([column, options])),
    limit: chain((value) => {
      op.limit = value;
    }),
    abortSignal: chain((signal) => {
      op.abortSignal = signal;
    }),
    maybeSingle: chain(() => {
      op.single = 'maybe';
    }),
    single: chain(() => {
      op.single = 'one';
    }),
    // A PostgREST builder is a thenable, which is what lets production code
    // await it without a terminal method.
    then: (onFulfilled, onRejected) => {
      let settled;
      try {
        settled = Promise.resolve(dispatch(op));
      } catch (error) {
        settled = Promise.reject(error);
      }
      return settled.then(onFulfilled, onRejected);
    },
  };

  return builder;
}

export function getDb() {
  return {
    from: (table) =>
      makeBuilder({ kind: 'table', table, verb: null, filters: [], order: [], abortSignal: null }),
    rpc: (name, args) =>
      makeBuilder({ kind: 'rpc', name, args, verb: 'rpc', filters: [], order: [], abortSignal: null }),
  };
}
