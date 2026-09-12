/**
 * Migrations 0004, 0005, 0006 and 0010.
 *
 * THERE IS NO POSTGRES AND NO DOCKER ON THIS MACHINE, so these functions are not
 * executed. What is checked here is everything that can be decided from the text
 * of the migration: that the counters are single statements rather than the
 * read-compare-write B3 and G1 forbid, that the penalty outlives its window,
 * that RLS is on for every table with no policy, that every grant is a verb the
 * code actually uses, that every ephemeral table has a retention path, and that
 * every state the schema declares is written by some code path.
 *
 * That is a real check of the properties the requirements name, and it is not
 * the same thing as running the SQL. The report says which of the two each
 * requirement got, and what a machine with Postgres would add.
 */

import { readFileSync } from 'node:fs';
import { assert, suite, test } from '../harness.mjs';

suite('sql');

const read = (name) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');

const SCHEMA = read('0004_bridge_v2_schema.sql');
const FUNCTIONS = read('0005_bridge_v2_functions.sql');
const GRANTS = read('0006_bridge_v2_grants.sql');
const OUTCOMES = read('0010_bridge_v2_outcomes.sql');

const source = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

/**
 * The statements, with the prose removed.
 *
 * These migrations explain themselves at length and the explanations name the
 * things they explain — pg_try_advisory_lock, sb_secret_, CREATE INDEX. A
 * structural check run over the comments answers questions about the prose.
 */
const statementsOnly = (sql) => sql.replace(/--[^\n]*/g, '');

/** The body of one CREATE OR REPLACE FUNCTION, between its $fn$ markers. */
function bodyOf(name) {
  const start = FUNCTIONS.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert.notEqual(start, -1, `${name} is not defined in 0005`);
  const open = FUNCTIONS.indexOf('$fn$', start);
  const close = FUNCTIONS.indexOf('$fn$', open + 4);
  assert.notEqual(close, -1, `${name} has no closing body marker`);
  return FUNCTIONS.slice(open + 4, close);
}

/** Every function 0005 defines. */
const FUNCTION_NAMES = [...FUNCTIONS.matchAll(/CREATE OR REPLACE FUNCTION (bridge_v2_\w+)/g)].map(
  (match) => match[1],
);

/** Every bridge table 0004 creates. */
const TABLE_NAMES = [...SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (bridge_v2_\w+)/g)].map(
  (match) => match[1],
);

// ---------------------------------------------------------------------------
// B3, G1 — counting without a read-compare-write
// ---------------------------------------------------------------------------

await test(['B3', 'G1'], 'the rate limit counts with one statement, not a select then an insert', () => {
  const body = bodyOf('bridge_v2_rate_limit_hit');
  // The V1's finding #3 is SELECT count(*) followed by INSERT.
  assert.ok(!/SELECT\s+count\s*\(/i.test(body), 'a counting SELECT is back');
  assert.match(body, /INSERT INTO bridge_v2_rate_limits[\s\S]*ON CONFLICT[\s\S]*DO UPDATE/);
  assert.match(body, /SET count = bridge_v2_rate_limits\.count \+ 1/);
  // The verdict must come from the value the increment itself returned.
  assert.match(body, /RETURNING count INTO v_count/);
  assert.match(body, /IF v_count > p_max_count THEN/);
});

await test(['B3', 'G1'], 'the standing penalty is read under a row lock', () => {
  // Without FOR UPDATE two callers both read strike n and both write n+1.
  assert.match(bodyOf('bridge_v2_rate_limit_hit'), /FROM bridge_v2_rate_penalties[\s\S]*FOR UPDATE/);
});

await test(['B4'], 'the penalty is keyed by axis and key alone, never by window', () => {
  // A penalty stored on a window row ends when the window does: with a sixty
  // second window an attacker waited sixty seconds for an amnesty.
  assert.match(
    SCHEMA,
    /CREATE TABLE IF NOT EXISTS bridge_v2_rate_penalties[\s\S]*?PRIMARY KEY \(axis, key_hash\)/,
  );
  const penalties = SCHEMA.slice(
    SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS bridge_v2_rate_penalties'),
    SCHEMA.indexOf('CREATE INDEX IF NOT EXISTS bridge_v2_rate_penalties_strike_idx'),
  );
  assert.ok(!/window/i.test(penalties), 'the penalty table carries a window again');
});

await test(['B4'], 'the penalty grows with the strike count, is capped, and decays', () => {
  const body = bodyOf('bridge_v2_rate_limit_hit');
  assert.match(body, /power\(2, LEAST\(\s*\(CASE/);
  assert.match(body, /LEAST\(3600,/);
  // Or somebody who mistyped a code in March meets an hour of penalty later.
  // Achado 3: the decay check and the reset to 1 both moved into the CASE of
  // the atomic upsert, reading the stored row through the "p" alias rather
  // than a value a prior SELECT read.
  assert.match(body, /p\.last_strike_at < v_check - make_interval\(secs => p_strike_decay_seconds\)/);
  assert.match(body, /WHEN[\s\S]*THEN\s+1/);
});

await test(['B4'], 'a request refused by a live penalty does not also spend a window slot', () => {
  const body = bodyOf('bridge_v2_rate_limit_hit');
  const penaltyReturn = body.indexOf('IF v_penalty IS NOT NULL AND v_penalty > v_check THEN');
  const insert = body.indexOf('INSERT INTO bridge_v2_rate_limits');
  assert.ok(penaltyReturn !== -1 && insert !== -1);
  assert.ok(penaltyReturn < insert, 'the penalty check runs after the counter is incremented');
});

await test(['J4', 'G1'], 'one attempt is spent by the same statement that hands out the hash', () => {
  const body = bodyOf('bridge_v2_claim_email_code_attempt');
  // Finding #5: read attempts, compare with five, write attempts + 1.
  assert.match(body, /UPDATE bridge_v2_email_codes[\s\S]*SET attempts = c\.attempts \+ 1/);
  assert.match(body, /RETURNING c\.id, c\.code_hash/);
  assert.match(body, /FOR UPDATE/);
  assert.match(body, /c\.attempts < p_max_attempts/);
});

await test(['J3'], 'only a live, unconsumed, most recent code can be attempted', () => {
  const body = bodyOf('bridge_v2_claim_email_code_attempt');
  assert.match(body, /c\.consumed_at IS NULL/);
  assert.match(body, /c\.expires_at > v_now/);
  assert.match(body, /ORDER BY c\.created_at DESC[\s\S]*LIMIT 1/);
});

await test(['J3'], 'issuing a code supersedes every live code for that address', () => {
  const body = bodyOf('bridge_v2_supersede_email_codes');
  assert.match(body, /UPDATE bridge_v2_email_codes[\s\S]*SET consumed_at = now\(\)/);
  assert.match(body, /WHERE email_canonical = p_email_canonical AND consumed_at IS NULL/);
});

await test(['G2'], 'consumption reports whether it changed a row', () => {
  const body = bodyOf('bridge_v2_consume_email_code');
  assert.match(body, /consumed_at IS NULL/);
  assert.match(body, /GET DIAGNOSTICS v_rows = ROW_COUNT/);
  assert.match(body, /RETURN v_rows = 1/);
});

await test(['B8'], 'a spend claim moves both windows or neither', () => {
  const body = bodyOf('bridge_v2_claim_spend');
  const hour = body.indexOf("'HOUR'");
  const day = body.indexOf("'DAY'");
  assert.ok(hour !== -1 && day !== -1 && hour < day);
  assert.match(body, /IF v_h > p_hour_cap OR v_d > p_day_cap THEN/);
  // The raise is what rolls the two increments back together.
  assert.match(body, /RAISE EXCEPTION 'bridge_v2_spend_ceiling'/);
  assert.match(body, /WHEN check_violation THEN[\s\S]*RETURN false/);
});

// ---------------------------------------------------------------------------
// G3, G6 — leases, nonces and the run lock
// ---------------------------------------------------------------------------

await test(['G3'], 'a funder is taken by a conditional update, never by expiry alone', () => {
  const body = bodyOf('bridge_v2_acquire_funder');
  assert.match(body, /f\.leased_until IS NULL OR f\.leased_until <= now\(\)/);
  assert.match(body, /FOR UPDATE SKIP LOCKED/);
  assert.match(body, /UPDATE bridge_v2_funders[\s\S]*SET leased_until = now\(\)/);
  assert.match(body, /lease_token\s+= v_token/);
  assert.match(body, /f\.disabled_at IS NULL/);
});

await test(['D6'], 'the funder is drawn at random rather than in sequence', () => {
  // Funding every entry from the next funder in order let an observer read
  // entry order off the chain (finding H3.c).
  assert.match(bodyOf('bridge_v2_acquire_funder'), /ORDER BY random\(\)/);
});

await test(['G3'], 'renew and release both require the lease token', () => {
  for (const name of ['bridge_v2_renew_funder_lease', 'bridge_v2_release_funder']) {
    assert.match(bodyOf(name), /lease_token\s*=\s*p_lease_token/, `${name} does not check the token`);
  }
});

await test(['G6'], 'release advances the nonce and never rewinds it', () => {
  // A broadcast transaction consumes its nonce whether or not it succeeded.
  assert.match(
    bodyOf('bridge_v2_release_funder'),
    /next_nonce\s+= GREATEST\(next_nonce, p_next_nonce\)/,
  );
});

await test(['G6'], 'reconciliation can move the nonce down, which release cannot', () => {
  const body = bodyOf('bridge_v2_reconcile_funder_nonce');
  // GREATEST here would make a dropped transaction permanent: the stored value
  // sits one past a nonce that will never be mined and the funder is dead.
  assert.match(body, /SET next_nonce = p_next_nonce/);
  assert.ok(!/GREATEST/.test(body), 'the correction cannot go down');
  assert.match(body, /lease_token\s+= p_lease_token/);
  assert.match(body, /disabled_at IS NULL/);
});

await test(['G6'], 'the run lock is taken in one statement guarded by its own expiry', () => {
  const body = bodyOf('bridge_v2_try_lock');
  assert.match(body, /INSERT INTO bridge_v2_locks[\s\S]*ON CONFLICT \(name\) DO UPDATE/);
  assert.match(body, /WHERE bridge_v2_locks\.expires_at <= now\(\)/);
  assert.match(body, /RETURNING holder/);
  // A session advisory lock would be gone the moment the statement returned.
  assert.ok(!/advisory/i.test(statementsOnly(FUNCTIONS)), 'an advisory lock is back');
});

await test(['G6'], 'a lock is released only by the run that took it', () => {
  assert.match(bodyOf('bridge_v2_release_lock'), /WHERE name = p_name AND holder = p_holder/);
});

await test(['G4'], 'the run sequence advances once per run, from a sequence', () => {
  assert.match(FUNCTIONS, /CREATE SEQUENCE IF NOT EXISTS bridge_v2_run_seq[\s\S]*CYCLE/);
  assert.match(bodyOf('bridge_v2_next_run_sequence'), /nextval\('bridge_v2_run_seq'\)/);
});

await test(['I9'], 'a wallet index comes from a sequence, never from a count or a max', () => {
  assert.match(bodyOf('bridge_v2_next_wallet_index'), /nextval\('bridge_v2_wallet_index_seq'\)/);
  assert.ok(!/MAX\(wallet_index\)/i.test(SCHEMA + FUNCTIONS));
});

// ---------------------------------------------------------------------------
// C5, C6 and the 05/09/2026 uniqueness rule
// ---------------------------------------------------------------------------

await test(['C5'], 'the live phone binding is unique platform-wide', () => {
  assert.match(
    SCHEMA,
    /CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_phones_live_unique[\s\S]{0,200}released_at IS NULL/,
  );
});

await test(['C6'], 'a participant holds at most one live number', () => {
  assert.match(
    SCHEMA,
    /CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_phones_participant_live_unique[\s\S]{0,200}released_at IS NULL/,
  );
});

await test(['C5', 'C6'], 'binding refuses a number that belongs to somebody else', () => {
  const body = bodyOf('bridge_v2_bind_phone_and_verify');
  assert.match(body, /released_at IS NULL[\s\S]*FOR UPDATE/);
  assert.match(
    body,
    /IF v_owner IS NOT NULL AND v_owner <> p_participant_id THEN[\s\S]*RETURN 'TAKEN'/,
  );
});

await test(['C6'], 'a released number cools down before it can be rebound', () => {
  const body = bodyOf('bridge_v2_bind_phone_and_verify');
  assert.match(body, /max\(cooldown_until\)[\s\S]*released_at IS NOT NULL/);
  assert.match(body, /IF v_cooldown IS NOT NULL AND v_cooldown > now\(\)[\s\S]*RETURN 'COOLDOWN'/);
  assert.match(
    bodyOf('bridge_v2_release_phone'),
    /cooldown_until = now\(\) \+ make_interval\(days => p_cooldown_days\)/,
  );
});

await test(['C6'], 'a change of number blocks the account in the campaigns it was active in', () => {
  const body = bodyOf('bridge_v2_bind_phone_and_verify');
  assert.match(body, /RETURN 'NUMBER_CHANGED'/);
  assert.match(
    body,
    /UPDATE bridge_v2_entries[\s\S]*SET status = 'FAILED'[\s\S]*status IN \('AWAITING_CONTACT', 'VERIFIED', 'ELIGIBLE'\)/,
  );
});

await test(['C5'], 'one entry per campaign and number, enforced by a unique index', () => {
  assert.match(
    SCHEMA,
    /CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_entries_phone_giveaway_unique[\s\S]{0,200}\(giveaway_id, phone_hmac\)[\s\S]{0,80}WHERE phone_hmac IS NOT NULL/,
  );
});

await test(['G5'], 'binding and verifying are one call, so a number cannot be spent on nothing', () => {
  const body = bodyOf('bridge_v2_bind_phone_and_verify');
  assert.match(body, /INSERT INTO bridge_v2_phones/);
  assert.match(
    body,
    /UPDATE bridge_v2_entries[\s\S]*SET phone_hmac = p_phone_hmac[\s\S]*status\s+= 'VERIFIED'/,
  );
  // The status predicate is what makes a Telegram retry move the row once.
  assert.match(body, /WHERE id = v_entry AND status = 'AWAITING_CONTACT'/);
  assert.match(body, /RETURN CASE WHEN v_rows = 1 THEN 'VERIFIED' ELSE 'NOT_AWAITING' END/);
});

await test(['K6'], 'no uniqueness collision leaves the binding as an exception', () => {
  const body = bodyOf('bridge_v2_bind_phone_and_verify');
  // Telegram retries a 500 for hours, so every collision has to be a value.
  const handlers = body.match(/WHEN unique_violation THEN/g) ?? [];
  assert.ok(handlers.length >= 2, `only ${handlers.length} unique_violation handlers`);
  for (const outcome of [
    'TAKEN', 'COOLDOWN', 'NUMBER_CHANGED', 'DUPLICATE', 'NOT_AWAITING', 'NO_ENTRY',
  ]) {
    assert.ok(body.includes(`'${outcome}'`), `${outcome} is not an outcome of the function`);
  }
});

await test(['G5'], 'a link is bound and consumed by predicate, so a retry cannot double it', () => {
  assert.match(
    bodyOf('bridge_v2_claim_link_for_chat'),
    /UPDATE bridge_v2_link_codes[\s\S]*consumed_at IS NULL[\s\S]*expires_at > now\(\)/,
  );
  assert.match(
    bodyOf('bridge_v2_consume_link_for_chat'),
    /SET consumed_at = now\(\)[\s\S]*consumed_at IS NULL[\s\S]*expires_at > now\(\)/,
  );
});

await test(['R4'], 'the link code is matched by a chat HMAC, never by a chat id', () => {
  assert.match(SCHEMA, /ALTER TABLE bridge_v2_link_codes DROP COLUMN IF EXISTS telegram_chat_id/);
  assert.match(SCHEMA, /ADD COLUMN IF NOT EXISTS telegram_chat_hmac text/);
  for (const name of ['bridge_v2_claim_link_for_chat', 'bridge_v2_consume_link_for_chat']) {
    assert.match(bodyOf(name), /p_chat_hmac/);
    assert.ok(!/telegram_chat_id/.test(bodyOf(name)), `${name} still reads a chat id`);
  }
});

await test(['C5', 'R4'], 'nothing in the schema holds a number or a Telegram id in clear', () => {
  const phones = SCHEMA.slice(
    SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS bridge_v2_phones'),
    SCHEMA.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_phones_live_unique'),
  );
  assert.match(phones, /phone_hmac/);
  assert.match(phones, /telegram_user_id_hmac/);
  assert.ok(!/phone_number|\bphone\s+text/.test(phones), 'a clear number column exists');
  assert.ok(!/telegram_user_id\s+(bigint|text)/.test(phones), 'a clear Telegram id column exists');
});

// ---------------------------------------------------------------------------
// I4, I5, I6, I7 — row level security and privileges
// ---------------------------------------------------------------------------

await test(['I5'], 'row level security is enabled on every table the migration creates', () => {
  assert.ok(TABLE_NAMES.length >= 16, `only ${TABLE_NAMES.length} tables found`);
  for (const table of TABLE_NAMES) {
    assert.match(
      SCHEMA,
      new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`),
      `${table} has no ENABLE ROW LEVEL SECURITY`,
    );
  }
});

await test(['I5'], 'no policy exists, so anon and authenticated reach nothing', () => {
  // A policy here would open personal data to the browser.
  assert.ok(!/CREATE POLICY/i.test(SCHEMA + GRANTS), 'a policy was added');
});

await test(['I5'], 'anon and authenticated are revoked on every table', () => {
  for (const table of TABLE_NAMES) {
    assert.match(
      GRANTS,
      new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM anon, authenticated`),
      `${table} is not revoked from anon and authenticated`,
    );
  }
});

await test(['I5'], 'a grant on a table is only a verb the code uses', () => {
  const expected = {
    bridge_v2_participants: ['SELECT', 'INSERT', 'UPDATE'],
    bridge_v2_sessions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    bridge_v2_email_codes: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    bridge_v2_link_codes: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    bridge_v2_phones: ['SELECT', 'INSERT', 'UPDATE'],
    bridge_v2_entries: ['SELECT', 'INSERT', 'UPDATE'],
    bridge_v2_eligibility_roots: ['SELECT', 'INSERT'],
    bridge_v2_eligibility_leaves: ['SELECT', 'INSERT'],
    bridge_v2_funders: ['SELECT', 'INSERT', 'UPDATE'],
    bridge_v2_disposable_domains: ['SELECT', 'INSERT'],
    bridge_v2_custody: ['SELECT', 'INSERT', 'UPDATE'],
    bridge_v2_ops_events: ['SELECT', 'INSERT', 'DELETE'],
  };
  for (const [table, verbs] of Object.entries(expected)) {
    const line = GRANTS.match(new RegExp(`GRANT ([A-Z, ]+) ON TABLE public\\.${table}\\s`));
    assert.ok(line, `${table} has no grant`);
    assert.deepEqual(
      line[1].split(',').map((verb) => verb.trim()).filter(Boolean).sort(),
      [...verbs].sort(),
      `${table} is granted more or less than the code uses`,
    );
  }
});

await test(['I5', 'D7'], 'nothing that must not be deleted carries a DELETE grant', () => {
  // The participation record and the proof material are what an on-chain root
  // is explained by; a DELETE would leave an address in a root with nothing on
  // this side saying how it got there.
  for (const table of [
    'bridge_v2_participants',
    'bridge_v2_entries',
    'bridge_v2_phones',
    'bridge_v2_eligibility_roots',
    'bridge_v2_eligibility_leaves',
    'bridge_v2_custody',
  ]) {
    const line = GRANTS.match(new RegExp(`GRANT ([A-Z, ]+) ON TABLE public\\.${table}\\s`));
    assert.ok(!line[1].includes('DELETE'), `${table} can be deleted from`);
  }
});

await test(['I5'], 'a sequence is granted USAGE and never UPDATE', () => {
  const sequenceGrants = [...GRANTS.matchAll(/GRANT ([A-Z, ]+) ON SEQUENCE public\.(\w+)/g)];
  assert.ok(sequenceGrants.length >= 3, `only ${sequenceGrants.length} sequence grants`);
  for (const [, verbs, sequence] of sequenceGrants) {
    assert.equal(verbs.trim(), 'USAGE', `${sequence} is granted ${verbs}`);
  }
});

await test(['I5'], 'EXECUTE is revoked from PUBLIC before it is granted to anyone', () => {
  // Postgres grants EXECUTE to PUBLIC by default, so a function created here is
  // callable by anon until something takes it away.
  const revoke = GRANTS.indexOf('REVOKE ALL ON FUNCTION');
  const grant = GRANTS.indexOf('GRANT EXECUTE ON FUNCTION');
  assert.ok(revoke !== -1, 'nothing revokes EXECUTE from PUBLIC');
  assert.ok(revoke < grant, 'the revoke sweep runs after the grants');
  assert.match(GRANTS, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  assert.match(GRANTS, /REVOKE ALL ON FUNCTION %s FROM anon, authenticated/);
});

await test(['I5'], 'every function 0005 defines is granted to the one role that calls it', () => {
  for (const name of FUNCTION_NAMES) {
    assert.ok(
      GRANTS.includes(`GRANT EXECUTE ON FUNCTION public.${name}(`),
      `${name} has no EXECUTE grant, so the bridge cannot call it`,
    );
  }
});

await test(['I5'], 'no function is granted that 0005 does not define', () => {
  const granted = [...GRANTS.matchAll(/GRANT EXECUTE ON FUNCTION public\.(bridge_v2_\w+)\(/g)].map(
    (match) => match[1],
  );
  for (const name of granted) {
    assert.ok(FUNCTION_NAMES.includes(name), `${name} is granted and no longer exists`);
  }
});

await test(['I5'], 'every function runs as the caller, not as the owner', () => {
  // SECURITY DEFINER would let a leaked role reach past what it was granted.
  assert.ok(!/SECURITY DEFINER/i.test(FUNCTIONS), 'a function runs as its owner');
});

await test(['I4'], 'no function builds SQL out of a value a caller supplies', () => {
  assert.ok(!/EXECUTE\s+format\(/.test(FUNCTIONS), '0005 executes dynamic SQL');
  for (const [, argument] of GRANTS.matchAll(/EXECUTE format\(([^)]*)\)/g)) {
    assert.ok(
      /\br\.\w+/.test(argument),
      'dynamic SQL in 0006 is built from something other than the catalogue',
    );
  }
});

await test(['I6'], 'every object the migration creates is under the bridge prefix', () => {
  const created = [
    ...statementsOnly(SCHEMA).matchAll(
      /CREATE (?:TABLE|SEQUENCE|UNIQUE INDEX|INDEX)(?: IF NOT EXISTS)? (\w+)/g,
    ),
    ...statementsOnly(FUNCTIONS).matchAll(
      /CREATE (?:OR REPLACE FUNCTION|SEQUENCE IF NOT EXISTS) (\w+)/g,
    ),
  ].map((match) => match[1]);
  assert.ok(created.length > 20);
  for (const name of created) {
    assert.match(name, /^bridge_v2_/, `${name} is outside the bridge namespace`);
  }
});

await test(['I7'], 'the one-credential design is declared where a reader looks for it', () => {
  // I7 asks that a read-only route not carry the credential that can write. The
  // build uses one service key for both, which is a declared weakening rather
  // than an omission; the declaration has to exist, in the module that holds it.
  const dbModule = source('lib/bridge-v2/db.ts');
  assert.match(dbModule, /I7/);
  assert.match(dbModule, /weaker guarantee/);
});

// ---------------------------------------------------------------------------
// I8, I9, I10, K7 — states, sentinels and retention
// ---------------------------------------------------------------------------

await test(['I8'], 'every entry state the schema declares is written by a code path', () => {
  const declared = SCHEMA
    .slice(SCHEMA.indexOf('status          text          NOT NULL CHECK (status IN ('))
    .match(/'([A-Z_]+)'/g)
    .slice(0, 7)
    .map((quoted) => quoted.replaceAll("'", ''));
  assert.deepEqual(declared, [
    'AWAITING_CONTACT', 'VERIFIED', 'ELIGIBLE', 'FUNDING', 'SUBMITTED', 'CONFIRMED', 'FAILED',
  ]);

  // Finding K7 of the V1: PENDING_CODE was declared and never written.
  const written = [
    source('lib/bridge-v2/entries.ts'),
    source('lib/bridge-v2/processor.ts'),
    source('api/bridge/v2/entry/start.ts'),
    FUNCTIONS,
  ].join('\n');
  for (const state of declared) {
    assert.ok(written.includes(`'${state}'`), `${state} is declared and never written`);
  }
});

await test(['I8'], 'every state a run can leave behind is also read by a query', () => {
  // FUNDING was written by one path and read by none, so a killed run left an
  // entry in a state nothing listed.
  const entries = source('lib/bridge-v2/entries.ts');
  assert.match(entries, /export async function listStale/);
  assert.match(source('lib/bridge-v2/processor.ts'), /listStale\('FUNDING', FUNDING_STALE_MS/);
});

await test(['I9'], 'a participant row cannot exist holding a placeholder address', () => {
  // Finding K5: wallet_address stayed the literal '0x' for ever after a failed
  // second statement.
  const participants = SCHEMA.slice(
    SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS bridge_v2_participants'),
    SCHEMA.indexOf('COMMENT ON TABLE  bridge_v2_participants'),
  );
  assert.match(participants, /wallet_address\s+text\s+NOT NULL/);
  assert.match(participants, /0x\[0-9a-fA-F\]\{40\}/);
});

await test(['I9'], 'an entry address carries the same format constraint', () => {
  assert.match(
    SCHEMA,
    /CREATE TABLE IF NOT EXISTS bridge_v2_entries[\s\S]*?wallet_address\s+text\s+NOT NULL CHECK \(wallet_address ~ '\^0x\[0-9a-fA-F\]\{40\}\$'\)/,
  );
});

await test(['I2'], 'a campaign id is stored as an exact decimal, not as a float', () => {
  const numericColumns = [...SCHEMA.matchAll(/giveaway_id\s+numeric\(78,0\)/g)];
  assert.ok(numericColumns.length >= 3, `only ${numericColumns.length} numeric(78,0) campaign ids`);
  assert.ok(!/giveaway_id\s+(bigint|integer|double)/.test(SCHEMA));
});

await test(['I2'], 'every function that returns a campaign id casts it to text', () => {
  // PostgREST renders a numeric as a JSON number, which is an IEEE double: a
  // uint256 id would arrive already rounded.
  for (const name of [
    'bridge_v2_claim_link_for_chat',
    'bridge_v2_consume_link_for_chat',
    'bridge_v2_campaigns_with_verified',
  ]) {
    assert.match(bodyOf(name), /giveaway_id::text/, `${name} returns a campaign id as a number`);
  }
});

await test(['I10', 'K7', 'D7'], 'every ephemeral table has a retention path', () => {
  const body = bodyOf('bridge_v2_cleanup');
  // Finding K6: bridge_codes grew without limit because nothing removed a row.
  for (const table of [
    'bridge_v2_email_codes',
    'bridge_v2_link_codes',
    'bridge_v2_sessions',
    'bridge_v2_rate_limits',
    'bridge_v2_rate_penalties',
    'bridge_v2_locks',
    'bridge_v2_external_spend',
    'bridge_v2_ops_events',
  ]) {
    assert.match(body, new RegExp(`DELETE FROM ${table}`), `${table} is never cleaned`);
  }
});

await test(['D7', 'I10'], 'the retention pass never touches the participation record', () => {
  const body = bodyOf('bridge_v2_cleanup');
  for (const table of [
    'bridge_v2_participants',
    'bridge_v2_entries',
    'bridge_v2_phones',
    'bridge_v2_eligibility_roots',
    'bridge_v2_eligibility_leaves',
    'bridge_v2_custody',
  ]) {
    assert.ok(!body.includes(`DELETE FROM ${table}`), `${table} is swept by the retention pass`);
  }
});

await test(['B4'], 'a penalty row is removed only once it means nothing', () => {
  assert.match(
    bodyOf('bridge_v2_cleanup'),
    /DELETE FROM bridge_v2_rate_penalties[\s\S]*last_strike_at < now\(\)[\s\S]*penalty_until IS NULL OR penalty_until < now\(\)/,
  );
});

// ---------------------------------------------------------------------------
// C8, G4, H7, E3 — the queues
// ---------------------------------------------------------------------------

await test(['C8', 'G4'], 'the campaign queue returns one row per campaign, oldest waiting first', () => {
  const body = bodyOf('bridge_v2_campaigns_with_verified');
  // The limit used to apply to entry rows, so one campaign holding twenty
  // VERIFIED entries filled the batch and every other campaign waited for ever.
  assert.match(body, /GROUP BY e\.giveaway_id/);
  assert.match(body, /ORDER BY min\(e\.created_at\) ASC/);
  assert.match(body, /LIMIT GREATEST\(p_limit, 0\)/);
  assert.match(body, /WHERE e\.status = 'VERIFIED'/);
});

await test(['H7'], 'the sweep queue is funded-and-not-swept, with no status in it', () => {
  // Gas is gas whatever the entry ended as, and a terminal mark left the two
  // prize fundings unreachable.
  const start = SCHEMA.indexOf('bridge_v2_entries_sweep_queue_idx');
  assert.notEqual(start, -1, 'there is no sweep queue index');
  const index = SCHEMA.slice(start, start + 220);
  assert.match(index, /WHERE funded_at IS NOT NULL AND swept_at IS NULL/);
  assert.ok(!/status/.test(index), 'the sweep queue narrowed by status again');
});

await test(['H7'], 'a database that already holds entries gets its funded wallets back', () => {
  assert.match(
    SCHEMA,
    /UPDATE bridge_v2_entries\s+SET funded_at = updated_at\s+WHERE funded_at IS NULL/,
  );
});

await test(['E3', 'OWNER-D2'], 'custody carries the columns the prize path needs to resume', () => {
  for (const column of [
    'custody_expires_at',
    'claimed_at',
    'claim_tx_hash',
    'delivered_at',
    'delivery_tx_hash',
    'custody_expired_alert_at',
    'no_prize_at',
  ]) {
    assert.ok(
      new RegExp(`\\b${column}\\s+(timestamptz|text)`).test(SCHEMA),
      `${column} is missing from the custody table`,
    );
  }
});

await test(['E3'], 'the prize queue index excludes what can no longer receive a prize', () => {
  // Every entry that confirms gets a custody row, winner or not, so without
  // no_prize_at a campaign of a thousand entrants left 997 permanent rows.
  assert.match(SCHEMA, /DROP INDEX IF EXISTS bridge_v2_custody_pending_idx/);
  assert.match(
    SCHEMA,
    /CREATE INDEX IF NOT EXISTS bridge_v2_custody_pending_idx[\s\S]{0,160}WHERE delivered_at IS NULL AND no_prize_at IS NULL/,
  );
});

await test(['F2'], 'no migration contains anything shaped like a secret', () => {
  for (const [name, text] of [['0004', SCHEMA], ['0005', FUNCTIONS], ['0006', GRANTS]]) {
    assert.ok(!/\b(0x)?[0-9a-fA-F]{64}\b/.test(text), `${name} contains a 32-byte hex value`);
    // A key VALUE, not the name of one. 0006 explains which variable the bridge
    // reaches the database with, and naming a variable is what F3 asks for.
    assert.ok(
      !/(sb_secret_|sb_publishable_)[A-Za-z0-9_-]{4,}|eyJ[A-Za-z0-9_-]{10,}/.test(text),
      `${name} contains a key`,
    );
  }
});

// ---------------------------------------------------------------------------
// 0010 — the settlement outcome, and the queue that reports it
//
// Nothing in test/bridge-v2 read this migration at all until now: it was written
// in the same pass as the code that depends on it and shipped with no check of
// any kind over its text.
// ---------------------------------------------------------------------------

await test(['I5'], '0010 revokes EXECUTE from PUBLIC before granting it to the one caller', () => {
  // 0006's sweep runs over the functions that exist when 0006 runs. A function
  // created afterwards is created outside that wall — Postgres grants EXECUTE on
  // a new function to PUBLIC by default — so it has to rebuild it for itself, or
  // anon can call it.
  const revoke = OUTCOMES.indexOf('REVOKE ALL ON FUNCTION');
  const grant = OUTCOMES.indexOf('GRANT EXECUTE ON FUNCTION');
  assert.ok(revoke !== -1, 'nothing revokes EXECUTE from PUBLIC');
  assert.ok(revoke < grant, 'the grant runs before the revoke, so it is undone');
  assert.match(OUTCOMES, /REVOKE ALL ON FUNCTION public\.bridge_v2_campaigns_awaiting_outcome\(integer\) FROM PUBLIC/);
  assert.match(OUTCOMES, /GRANT EXECUTE ON FUNCTION public\.bridge_v2_campaigns_awaiting_outcome\(integer\) TO service_role/);
});

await test(['I5'], '0010 is idempotent in every statement, like 0004 and 0007', () => {
  const statements = statementsOnly(OUTCOMES);
  assert.match(statements, /ADD COLUMN IF NOT EXISTS outcome text/);
  assert.match(statements, /ADD COLUMN IF NOT EXISTS outcome_notified_at timestamptz/);
  assert.match(statements, /CREATE INDEX IF NOT EXISTS bridge_v2_entries_outcome_pending_idx/);
  assert.match(statements, /CREATE OR REPLACE FUNCTION bridge_v2_campaigns_awaiting_outcome/);
  // The CHECK cannot say IF NOT EXISTS, so it says it the other way.
  assert.match(statements, /WHEN duplicate_object THEN NULL/);
});

await test(['I5'], '0010 runs as its caller and resolves citext through both schemas', () => {
  assert.ok(!/SECURITY DEFINER/i.test(OUTCOMES), 'the function runs as its owner');
  assert.match(OUTCOMES, /SET search_path = public, extensions\n?AS \$fn\$/);
});

await test(['C8', 'G4'], 'the campaign queue is ordered by a key the pipeline can move', () => {
  // THE FAILURE THIS FIXES. The queue necessarily contains campaigns that have
  // not settled, because from the database "no result yet" and "settled but
  // unreported" are the same row. CONFIRMED is terminal and nothing writes those
  // rows on its own, so ordering by min(updated_at) pinned the oldest open
  // campaigns to the head of a five-campaign batch for ever and a campaign that
  // settled behind them was never reached — its winners never told, which is the
  // failure this migration exists to remove.
  const body = OUTCOMES.slice(
    OUTCOMES.indexOf('CREATE OR REPLACE FUNCTION bridge_v2_campaigns_awaiting_outcome'),
  );
  assert.match(body, /ORDER BY max\(e\.updated_at\) ASC/);
  assert.ok(!/ORDER BY min\(/.test(body), 'the order key is one nothing ever writes');
  // The pipeline touches one entry of a campaign it cannot act on, and one write
  // only moves max(). processor.ts is where that touch is.
  assert.match(
    source('lib/bridge-v2/processor.ts'),
    /if \(!campaign\.isSettled\) \{\s*\n\s*await touch\(targets\[0\]\.entryId\);/,
  );
});

await test(['C8'], 'the index carries the column the queue is ordered by', () => {
  // A partial index on (giveaway_id) alone leaves the aggregate reading
  // updated_at from the heap for every unreported entry on the platform, once a
  // run. The sibling in 0004 carries its order key for the same reason.
  assert.match(
    OUTCOMES,
    /CREATE INDEX IF NOT EXISTS bridge_v2_entries_outcome_pending_idx\s*\n\s*ON bridge_v2_entries \(giveaway_id, updated_at\)\s*\n\s*WHERE status = 'CONFIRMED' AND outcome_notified_at IS NULL/,
  );
  // And the per-campaign read has to use the same order, or the index serves one
  // of the two queries.
  assert.match(source('lib/bridge-v2/entries.ts'), /list_awaiting_outcome[\s\S]{0,600}\.order\('updated_at'/);
});

await test(['I5'], '0010 retires the entries whose prize story is already over', () => {
  // Without this every CONFIRMED entry on the platform enters the queue on the
  // first run, including ones whose custody was delivered or written off months
  // ago — and the notice for those tells somebody to name a wallet for a prize
  // that is not coming.
  const statements = statementsOnly(OUTCOMES);
  assert.match(statements, /UPDATE bridge_v2_entries e\s*\n\s*SET outcome = COALESCE\(/);
  assert.match(statements, /outcome_notified_at = now\(\)/);
  assert.match(
    statements,
    /c\.delivered_at IS NOT NULL OR c\.claimed_at IS NOT NULL OR c\.no_prize_at IS NOT NULL/,
  );
  // A claimed custody is a winner whose prize is already in the derived wallet;
  // anything but WON there closes the one route that can still send it on.
  assert.match(
    statements,
    /WHEN c\.delivered_at IS NOT NULL OR c\.claimed_at IS NOT NULL THEN 'WON' ELSE 'VOID' END/,
  );
  // And nothing already CONFIRMED when this file ran is ever emailed: the second
  // statement claims the notice for the rest, whatever their custody says.
  assert.match(
    statements,
    /UPDATE bridge_v2_entries e\s*\n\s*SET outcome_notified_at = now\(\)\s*\n\s*WHERE e\.status = 'CONFIRMED'\s*\n\s*AND e\.outcome_notified_at IS NULL;/,
  );
});

await test(['F2'], '0010 contains nothing shaped like a secret', () => {
  assert.ok(!/\b(0x)?[0-9a-fA-F]{64}\b/.test(OUTCOMES), '0010 contains a 32-byte hex value');
  assert.ok(
    !/(sb_secret_|sb_publishable_)[A-Za-z0-9_-]{4,}|eyJ[A-Za-z0-9_-]{10,}/.test(OUTCOMES),
    '0010 contains a key',
  );
});
