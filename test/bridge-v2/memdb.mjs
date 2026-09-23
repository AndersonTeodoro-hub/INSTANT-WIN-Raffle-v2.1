/**
 * Tables in memory, behind the database double. SPEC-BLOCO-03 suites.
 *
 * The db double answers each call with whatever a test programmed. For the
 * Keptra flows — a passkey, two accounts, an entry, a root, a recovery, a
 * migration, all read and written many times in one run — programming every
 * call would be a second implementation of the flow in the test. This keeps
 * rows instead and applies the filters the PostgREST builder records: eq, neq,
 * is, not-is, in, gt, lt, gte, lte, order and limit, with a column path
 * ("entry.wallet_address") reaching into a row's embedded object.
 *
 * It is not Postgres: no casts, no functions, no joins beyond the embedded
 * objects a test puts on a row. The engine suite runs 0012 itself on a real
 * cluster; this is for the flows around it.
 */

import { randomUUID } from 'node:crypto';

const get = (row, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), row);
const same = (a, b) => (a === null || a === undefined ? b === null : String(a).toLowerCase() === String(b).toLowerCase());

/**
 * Ordering as Postgres has it for the columns the Keptra tables hold: a bigint or
 * numeric column compares as a number (P5-4 pages the orders by order_id past
 * 9, where '10' < '9' as text), anything else — a timestamp, a uuid — as text.
 */
const INTEGER = /^-?\d+$/;
function compare(a, b) {
  if ((typeof a === 'bigint' || typeof a === 'number' || (typeof a === 'string' && INTEGER.test(a))) &&
      (typeof b === 'bigint' || typeof b === 'number' || (typeof b === 'string' && INTEGER.test(b)))) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x > y ? 1 : x < y ? -1 : 0;
  }
  return a > b ? 1 : a < b ? -1 : 0;
}

function matches(row, filter) {
  const [kind, column] = filter;
  const value = get(row, column);
  switch (kind) {
    case 'eq':
      return same(value, filter[2]);
    case 'neq':
      return !same(value, filter[2]);
    case 'is':
      return (value ?? null) === filter[2];
    case 'not':
      return filter[2] === 'is' ? (value ?? null) !== filter[3] : !same(value, filter[3]);
    case 'in':
      return filter[2].some((item) => same(value, item));
    case 'gt':
      return value !== undefined && value !== null && compare(value, filter[2]) > 0;
    case 'lt':
      return value !== undefined && value !== null && compare(value, filter[2]) < 0;
    case 'gte':
      return value !== undefined && value !== null && compare(value, filter[2]) >= 0;
    case 'lte':
      return value !== undefined && value !== null && compare(value, filter[2]) <= 0;
    default:
      return true;
  }
}

/**
 * Installs in-memory handlers for `tables` on the db double.
 * `unique` maps a table to the column sets it must keep unique (23505 otherwise).
 */
export function memdb(db, tables, unique = {}) {
  const data = new Map(tables.map((table) => [table, []]));

  const select = (table, op) => {
    let rows = data.get(table).filter((row) => op.filters.every((filter) => matches(row, filter)));
    for (const [column, options] of [...op.order].reverse()) {
      const direction = options?.ascending === false ? -1 : 1;
      rows = [...rows].sort((a, b) => direction * compare(get(a, column), get(b, column)));
    }
    if (op.limit !== undefined) rows = rows.slice(0, op.limit);
    return rows;
  };

  const shape = (op, rows) => {
    if (op.single === 'maybe' || op.single === 'one') return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };

  // SPEC-BLOCO-03 Adenda F4: { count: 'exact' } counts every row the filters
  // admit, before the limit, as PostgREST's Content-Range does; `head` returns
  // the count alone.
  const counted = (table, op) => {
    const count = select(table, { ...op, order: [], limit: undefined }).length;
    if (op.selectOptions?.head === true) return { data: null, count, error: null };
    return { ...shape(op, select(table, op)), count };
  };

  // A unique set is a column list, or { columns, where } for a partial index:
  // only rows the predicate admits take part, as in Postgres.
  const violates = (table, candidate, except) =>
    (unique[table] ?? []).some((spec) => {
      const { columns, where = () => true } = Array.isArray(spec) ? { columns: spec } : spec;
      if (!where(candidate)) return false;
      return data
        .get(table)
        .some(
          (row) =>
            row !== except &&
            where(row) &&
            columns.every((column) => candidate[column] !== null && candidate[column] !== undefined && same(row[column], candidate[column])),
        );
    });

  for (const table of tables) {
    db.on(`${table}:select`, (op) => (op.selectOptions?.count === 'exact' ? counted(table, op) : shape(op, select(table, op))));
    db.on(`${table}:insert`, (op) => {
      const payloads = Array.isArray(op.payload) ? op.payload : [op.payload];
      const inserted = [];
      // A column the insert did not write and asks to read back is NULL, as in
      // Postgres, not missing.
      const returned = (op.columns ?? '').split(',').map((column) => column.trim().split('::')[0]).filter((name) => /^\w+$/.test(name));
      for (const payload of payloads) {
        const row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload };
        for (const name of returned) if (!(name in row)) row[name] = null;
        if (violates(table, row, null)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        data.get(table).push(row);
        inserted.push(row);
      }
      return shape(op, inserted);
    });
    db.on(`${table}:update`, (op) => {
      const rows = select(table, { ...op, order: [], limit: undefined });
      for (const row of rows) {
        const next = { ...row, ...op.payload };
        if (violates(table, next, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      for (const row of rows) Object.assign(row, op.payload);
      return shape(op, rows);
    });
    // Adenda F10: a delete removes what the filters admit and returns it.
    db.on(`${table}:delete`, (op) => {
      const rows = select(table, { ...op, order: [], limit: undefined });
      data.set(table, data.get(table).filter((row) => !rows.includes(row)));
      return shape(op, rows);
    });
    db.on(`${table}:upsert`, (op) => {
      const payloads = Array.isArray(op.payload) ? op.payload : [op.payload];
      const key = op.options?.onConflict;
      for (const payload of payloads) {
        const existing = key === undefined ? undefined : data.get(table).find((row) => same(row[key], payload[key]));
        if (existing !== undefined) Object.assign(existing, payload);
        else data.get(table).push({ id: randomUUID(), created_at: new Date().toISOString(), ...payload });
      }
      return { data: null, error: null };
    });
  }

  return {
    rows: (table) => data.get(table),
    insert: (table, row) => {
      const full = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
      data.get(table).push(full);
      return full;
    },
  };
}

/** The tables the Keptra flows touch, and the uniqueness 0012 and 0004 give them. */
export const KEPTRA_TABLES = [
  'bridge_v2_participants',
  'bridge_v2_passkeys',
  'bridge_v2_accounts',
  'bridge_v2_entries',
  'bridge_v2_custody',
  'bridge_v2_eligibility_roots',
  'bridge_v2_eligibility_leaves',
  'bridge_v2_creators',
  'bridge_v2_creator_campaigns',
  'bridge_v2_recoveries',
  'bridge_v2_recovery_notices',
  'bridge_v2_migrations',
  'bridge_v2_guardian_changes',
  'bridge_v2_relayed_transactions',
  'bridge_v2_guardian_incidents',
  'bridge_v2_phones',
  'bridge_v2_ops_events',
  // SPEC-BLOCO-03 piece 5, migration 0013.
  'bridge_v2_order_addresses',
  'bridge_v2_orders',
  'bridge_v2_order_shipments',
  'bridge_v2_order_evidence',
  'bridge_v2_order_notices',
  'bridge_v2_recipient_marks',
  'bridge_v2_finished_vouchers',
  // SPEC-BLOCO-03 piece 6, migration 0014 (T4).
  'bridge_v2_offer_descriptions',
  // SPEC-BLOCO-03 AA4, migration 0015: the new orders read aside (P5-12).
  'bridge_v2_order_unread',
  // 0015: the terms the relay created for a store (P6-14).
  'bridge_v2_store_terms',
  // 0015 (AB4): how far the orders pass has read the chain's terms and obligations.
  'bridge_v2_store_terms_cursor',
];

export const KEPTRA_UNIQUE = {
  bridge_v2_passkeys: [['credential_id'], ['signer_address']],
  bridge_v2_accounts: [['safe_address'], ['participant_id', 'role']],
  bridge_v2_migrations: [['wallet_index']],
  bridge_v2_guardian_incidents: [['guardian_address']],
  bridge_v2_recovery_notices: [['recovery_id', 'stage', 'channel']],
  bridge_v2_entries: [['participant_id', 'giveaway_id']],
  // 0012's partial unique index: one LIVE request per participant.
  bridge_v2_recoveries: [
    { columns: ['participant_id'], where: (row) => ['AWAITING_PHONE', 'PHONE_VERIFIED', 'CONFIRMED'].includes(row.status) },
    ['link_code_hash'],
  ],
  // 0013: one address per order; one shipment per order and per tracking hash
  // (I6); one text per party; one notice per kind; one decision per order and a
  // number counted once per store among the live marks (P5).
  bridge_v2_order_addresses: [{ columns: ['order_id'], where: (row) => row.order_id != null }],
  bridge_v2_orders: [['order_id']],
  bridge_v2_order_shipments: [['order_id'], ['tracking_hash']],
  bridge_v2_order_evidence: [['order_id', 'party']],
  bridge_v2_order_notices: [['order_id', 'kind']],
  bridge_v2_recipient_marks: [
    ['order_id'],
    { columns: ['store_address', 'phone_hmac'], where: (row) => ['RESERVED', 'MARKED'].includes(row.status) },
  ],
  bridge_v2_finished_vouchers: [['voucher_id']],
  // 0014: one description per set of terms, written once (T4).
  bridge_v2_offer_descriptions: [['terms_id']],
  bridge_v2_order_unread: [['order_id']],
  bridge_v2_store_terms: [['terms_id']],
  bridge_v2_store_terms_cursor: [['name']],
};
