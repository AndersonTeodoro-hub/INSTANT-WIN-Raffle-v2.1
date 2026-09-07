/**
 * Migrations 0004, 0005 and 0006, EXECUTED.
 *
 * suites/sql.test.mjs checks what can be decided from the text of these files.
 * This one applies them to a real PostgreSQL 17.10 cluster (test/bridge-v2/pg.mjs)
 * and calls every function in them, because a parser cannot answer the questions
 * the requirements actually ask:
 *
 *   - does the counter stay right when eight callers arrive at once (B3, G1)
 *   - does the penalty survive the window boundary (B4)
 *   - does a partial unique index refuse the second live binding (C5, C6)
 *   - does ON CONFLICT ... WHERE return no row to the second run (G3, G6)
 *   - does the plpgsql EXCEPTION block keep the work done before it (G5)
 *   - does the REVOKE reach the function it named (I5)
 *   - does a role without BYPASSRLS see nothing (I5)
 *
 * The target is a Supabase project: roles anon, authenticated, authenticator and
 * service_role (the last with BYPASSRLS), citext installed, files applied in
 * numeric order. pg.mjs recreates that shape. Where the engine and the target
 * can differ, the difference is a test of its own rather than a footnote.
 *
 * A failing test here is a finding. Its message carries the migration line, what
 * the requirement asks for, and what the engine did.
 */

import { assert, suite, test } from '../harness.mjs';
import {
  applyMigration,
  asRole,
  attempt,
  bootEngine,
  bridgeFunctions,
  bridgeTables,
  concurrently,
  createDatabase,
  reset,
  sleep,
  sql,
} from '../pg.mjs';

suite('engine');

const V2 = ['0004_bridge_v2_schema.sql', '0005_bridge_v2_functions.sql', '0006_bridge_v2_grants.sql'];
const V1 = ['0001_bridge_schema.sql', '0002_funder_locks.sql', '0003_bridge_grants.sql'];

/** A well-formed address that is not anybody's. */
const ADDR = '0x2222222222222222222222222222222222222222';
/** 2^256 - 1, the largest campaign id the contract can hand out. */
const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

let counter = 0;
const uniq = (prefix) => `${prefix}-${++counter}`;

// ---------------------------------------------------------------------------
// the cluster
// ---------------------------------------------------------------------------

let engine = null;
let target = null;   // Supabase-shaped: roles, citext in extensions, default privileges
let bare = null;     // the same roles, without Supabase's ALTER DEFAULT PRIVILEGES
let plain = null;    // no citext at all, so 0004 has to create it
let ordered = null;  // every migration in numeric order, V1 first
let boot = null;

try {
  engine = await bootEngine();
  target = await createDatabase('bridge_v2_target', { withCitext: true });
  for (const file of V2) {
    const applied = await applyMigration(target, file);
    if (!applied.ok) throw new Error(`${file} did not apply: ${applied.at} ${applied.text}`);
  }
} catch (error) {
  boot = error;
}

if (boot !== null) {
  // One loud failure rather than sixty quiet ones. A suite that cannot reach the
  // engine has not tested anything, and must not read as if it had.
  await test([], 'the Postgres engine starts and the migrations apply', () => {
    throw boot;
  });
} else {

// ---------------------------------------------------------------------------
// helpers over the target database
// ---------------------------------------------------------------------------

const q = (text, values) => sql(target, text, values);
const rows = async (text, values) => (await q(text, values)).rows;
const one = async (text, values) => (await q(text, values)).rows[0];
const scalar = async (text, values) => {
  const row = await one(text, values);
  return row === undefined ? undefined : Object.values(row)[0];
};

const participant = async (email = `${uniq('who')}@example.test`) =>
  (await one(
    `INSERT INTO bridge_v2_participants (email_canonical, wallet_address)
     VALUES ($1, $2) RETURNING id`,
    [email, ADDR],
  )).id;

const entry = async (participantId, giveawayId, status = 'AWAITING_CONTACT') =>
  (await one(
    `INSERT INTO bridge_v2_entries
       (participant_id, giveaway_id, status, wallet_address, idempotency_key)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [participantId, giveawayId, status, ADDR, uniq('idem')],
  )).id;

const emailCode = async (email, hash, expires = `now() + interval '10 minutes'`) =>
  (await one(
    `INSERT INTO bridge_v2_email_codes (email_canonical, code_hash, expires_at)
     VALUES ($1, $2, ${expires}) RETURNING id`,
    [email, hash],
  )).id;

const funders = async (count) => {
  const values = Array.from({ length: count }, (_u, index) => `(${index}, '${ADDR}')`).join(',');
  await q(`INSERT INTO bridge_v2_funders (funder_index, address) VALUES ${values}`);
};

// ===========================================================================
// 1. applying the three migrations
// ===========================================================================

await test(['I5', 'I6'], '0004, 0005 and 0006 apply in order to an empty target-shaped database', async () => {
  // Applied above, before any test ran, because everything below needs them.
  // What is asserted here is that they left behind what they claim to create.
  const tables = await bridgeTables(target);
  assert.equal(tables.length, 16, `0004 declares sixteen tables, the catalog holds ${tables.length}`);
  const functions = await bridgeFunctions(target);
  assert.equal(functions.length, 20, `0005 defines twenty functions, the catalog holds ${functions.length}`);
  const sequences = await rows(
    `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'bridge\\_v2\\_%'`,
  );
  assert.equal(sequences.length, 3, 'three sequences: wallet index, run, ops events');
});

await test(['I6'], 'applying the three again changes nothing and raises nothing', async () => {
  const before = await rows(
    `SELECT count(*)::int AS tables FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'bridge\\_v2\\_%'`,
  );
  for (const round of [1, 2]) {
    for (const file of V2) {
      const applied = await applyMigration(target, file);
      assert.ok(applied.ok, `round ${round}: ${file} ${applied.ok ? '' : `${applied.at} ${applied.text}`}`);
    }
  }
  const after = await rows(
    `SELECT count(*)::int AS tables FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'bridge\\_v2\\_%'`,
  );
  assert.deepEqual(after, before, 'a re-application created or dropped a table');
  const functions = await bridgeFunctions(target);
  assert.equal(functions.length, 20, 'a re-application left a second overload of some function behind');
});

await test(['I6'], '0004 installs citext itself when the project does not already carry it', async () => {
  plain = await createDatabase('bridge_v2_plain', { withCitext: false });
  for (const file of V2) {
    const applied = await applyMigration(plain, file);
    assert.ok(applied.ok, `${file} on a database without citext: ${applied.ok ? '' : `${applied.at} ${applied.text}`}`);
  }
  const where = (await plain.pool.query(
    `SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'citext'`,
  )).rows[0];
  assert.equal(where.nspname, 'public', 'CREATE EXTENSION without a schema puts citext in public');
});

await test(['I6'], 'the V2 migrations do not depend on the V1 ones applying first', async () => {
  // The executor applies files in numeric order, so 0001 to 0003 run first. On a
  // project whose citext lives in `extensions` they do not survive that, because
  // they carry no search_path of their own; the V2 three do, and this is what
  // that line buys. The V1 outcome is recorded in the report, not asserted here:
  // the V1 is not what this session is testing.
  ordered = await createDatabase('bridge_v2_ordered', { withCitext: true });
  const outcomes = [];
  for (const file of [...V1, ...V2]) outcomes.push(await applyMigration(ordered, file));
  for (const applied of outcomes.slice(3)) {
    assert.ok(applied.ok, `${applied.file} after the V1 files: ${applied.ok ? '' : `${applied.at} ${applied.text}`}`);
  }
});

await test(['I5'], 'every function runs as its caller and resolves citext through both schemas', async () => {
  const functions = await bridgeFunctions(target);
  const definers = functions.filter((row) => row.security_definer).map((row) => row.name);
  assert.deepEqual(definers, [], 'SECURITY DEFINER would let a leaked role reach past what it was granted');
  const wrong = functions
    .filter((row) => !(row.config ?? []).includes('search_path=public, extensions'))
    .map((row) => row.name);
  assert.deepEqual(wrong, [], 'a body without both schemas fails at runtime where citext lives in extensions');
});

// ===========================================================================
// 2. the twenty functions
// ===========================================================================

// --- bridge_v2_rate_limit_hit ---------------------------------------------

await test(['B1', 'B2', 'B3', 'G1'], 'rate_limit_hit allows up to the ceiling and denies past it', async () => {
  await reset(target);
  const key = uniq('key');
  assert.deepEqual(await one(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 60, 2, 10, 3600)`, [key]),
    { allowed: true, retry_after_seconds: 0 });
  assert.deepEqual(await one(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 60, 2, 10, 3600)`, [key]),
    { allowed: true, retry_after_seconds: 0 });
  assert.deepEqual(await one(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 60, 2, 10, 3600)`, [key]),
    { allowed: false, retry_after_seconds: 10 }, 'the third call in a window of two must be refused');
  assert.equal(await scalar(`SELECT count FROM bridge_v2_rate_limits WHERE key_hash = $1`, [key]), 3);
});

await test(['B4'], 'a request refused by a live penalty does not also spend a window slot', async () => {
  await reset(target);
  const key = uniq('key');
  for (const _unused of [1, 2, 3]) await q(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 60, 2, 10, 3600)`, [key]);
  const spent = await scalar(`SELECT count FROM bridge_v2_rate_limits WHERE key_hash = $1`, [key]);
  await q(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 60, 2, 10, 3600)`, [key]);
  assert.equal(
    await scalar(`SELECT count FROM bridge_v2_rate_limits WHERE key_hash = $1`, [key]),
    spent,
    'a penalised caller filled their own window, which is 0005:88-92 not holding',
  );
});

await test(['B4'], 'the penalty outlives the window boundary and grows across it', async () => {
  await reset(target);
  const key = uniq('key');
  // One-second windows and a one-second penalty, so the boundary is crossed for
  // real rather than simulated by moving a clock.
  await q(`SELECT * FROM bridge_v2_rate_limit_hit('em', $1, 1, 1, 1, 3600)`, [key]);
  const first = await one(`SELECT * FROM bridge_v2_rate_limit_hit('em', $1, 1, 1, 1, 3600)`, [key]);
  assert.equal(first.allowed, false);
  assert.equal(first.retry_after_seconds, 1, 'the first strike costs the base penalty');

  await sleep(1200); // the window has rolled and the penalty has run out

  await q(`SELECT * FROM bridge_v2_rate_limit_hit('em', $1, 1, 1, 1, 3600)`, [key]);
  const second = await one(`SELECT * FROM bridge_v2_rate_limit_hit('em', $1, 1, 1, 1, 3600)`, [key]);
  assert.equal(second.retry_after_seconds, 2, 'B4: the second strike must cost more than the first');
  assert.equal(await scalar(`SELECT strikes FROM bridge_v2_rate_penalties WHERE key_hash = $1`, [key]), 2);
  assert.equal(
    await scalar(`SELECT count(*)::int FROM bridge_v2_rate_limits WHERE key_hash = $1`, [key]),
    2,
    'two window rows, so the strike count really did survive a boundary',
  );
});

await test(['B4'], 'the penalty is capped at an hour however many strikes there are', async () => {
  await reset(target);
  const key = uniq('key');
  await q(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 600, 0, 3600, 3600)`, [key]);
  await q(`UPDATE bridge_v2_rate_penalties
              SET strikes = 20, penalty_until = now() - interval '1 second', last_strike_at = now()
            WHERE key_hash = $1`, [key]);
  const verdict = await one(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 600, 0, 3600, 3600)`, [key]);
  assert.equal(verdict.retry_after_seconds, 3600, 'LEAST(3600, ...) at 0005:112 is the cap');
});

await test(['B4'], 'a strike older than the decay window starts the count again at one', async () => {
  await reset(target);
  const key = uniq('key');
  await q(`SELECT * FROM bridge_v2_rate_limit_hit('em', $1, 600, 0, 0, 0)`, [key]);
  assert.equal(await scalar(`SELECT strikes FROM bridge_v2_rate_penalties WHERE key_hash = $1`, [key]), 1);
  await sleep(1100);
  await q(`SELECT * FROM bridge_v2_rate_limit_hit('em', $1, 600, 0, 0, 0)`, [key]);
  assert.equal(
    await scalar(`SELECT strikes FROM bridge_v2_rate_penalties WHERE key_hash = $1`, [key]),
    1,
    'B4 is a cost on somebody attacking now, not a permanent record',
  );
});

// --- bridge_v2_claim_email_code_attempt / consume / supersede --------------

await test(['J4', 'G1'], 'claim_email_code_attempt spends one attempt and hands back the stored hash', async () => {
  await reset(target);
  const email = `${uniq('code')}@example.test`;
  await emailCode(email, 'HASH-LIVE');
  const first = await one(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 3)`, [email]);
  assert.equal(first.code_hash, 'HASH-LIVE');
  assert.equal(first.attempts_left, 2, 'three allowed, one spent');
  const second = await one(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 3)`, [email]);
  assert.equal(second.attempts_left, 1);
  const third = await one(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 3)`, [email]);
  assert.equal(third.attempts_left, 0);
  assert.equal(await scalar(`SELECT attempts FROM bridge_v2_email_codes WHERE email_canonical = $1`, [email]), 3);
  assert.equal(
    (await rows(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 3)`, [email])).length,
    0,
    'a fourth guess must find nothing to attempt',
  );
});

await test(['J4', 'C1'], 'the email is matched case-insensitively, as a citext column', async () => {
  await reset(target);
  const email = `${uniq('case')}@example.test`;
  await emailCode(email, 'HASH-CI');
  const claimed = await one(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 5)`, [email.toUpperCase()]);
  assert.equal(claimed?.code_hash, 'HASH-CI', 'citext did not resolve, so the type or the search_path is wrong');
});

await test(['J3'], 'an expired or consumed code cannot be attempted', async () => {
  await reset(target);
  const email = `${uniq('dead')}@example.test`;
  await emailCode(email, 'HASH-EXPIRED', `now() - interval '1 minute'`);
  assert.equal((await rows(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 5)`, [email])).length, 0);
  const live = await emailCode(email, 'HASH-CONSUMED');
  await q(`UPDATE bridge_v2_email_codes SET consumed_at = now() WHERE id = $1`, [live]);
  assert.equal((await rows(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 5)`, [email])).length, 0);
});

await test(['G2', 'G5'], 'consume_email_code reports whether it changed a row', async () => {
  await reset(target);
  const email = `${uniq('consume')}@example.test`;
  const id = await emailCode(email, 'HASH-ONCE');
  assert.equal(await scalar(`SELECT bridge_v2_consume_email_code($1)`, [id]), true);
  assert.equal(await scalar(`SELECT bridge_v2_consume_email_code($1)`, [id]), false,
    'a second consumption must report that somebody else got there first');
});

await test(['J3'], 'supersede_email_codes ends every live code for the address', async () => {
  await reset(target);
  const email = `${uniq('super')}@example.test`;
  await emailCode(email, 'HASH-1');
  await emailCode(email, 'HASH-2');
  assert.equal(await scalar(`SELECT bridge_v2_supersede_email_codes($1)`, [email]), 2);
  assert.equal(await scalar(`SELECT bridge_v2_supersede_email_codes($1)`, [email]), 0);
  assert.equal(
    await scalar(`SELECT count(*)::int FROM bridge_v2_email_codes
                   WHERE email_canonical = $1 AND consumed_at IS NULL`, [email]),
    0,
  );
});

await test(['J3', 'J4'], 'the attempt ceiling belongs to the address, not to one code', async () => {
  await reset(target);
  const email = `${uniq('ladder')}@example.test`;
  await emailCode(email, 'HASH-OLDER');
  await sleep(5); // created_at DESC has to be able to tell them apart
  await emailCode(email, 'HASH-NEWER');

  const seen = [];
  for (let guess = 0; guess < 8; guess += 1) {
    const claimed = await one(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 3)`, [email]);
    if (claimed === undefined) break;
    seen.push(claimed.code_hash);
  }

  assert.deepEqual(
    [...new Set(seen)],
    ['HASH-NEWER'],
    'ACHADO 0005:145-171. J3 says only the most recent unconsumed code for an address is valid, and J4 '
    + 'caps the guesses. The predicate `attempts < p_max_attempts` inside `ORDER BY created_at DESC LIMIT 1` '
    + 'removes the exhausted newest code from the candidate set instead of ending the attempt, so the '
    + `previous live code becomes attemptable: the engine handed out ${seen.length} guesses across `
    + `${new Set(seen).size} codes for a ceiling of three. The ceiling is per code, not per address.`,
  );
});

// --- bridge_v2_claim_link_for_chat / consume_link_for_chat -----------------

await test(['G5', 'I2'], 'claim_link_for_chat binds the chat and returns the campaign id exactly', async () => {
  await reset(target);
  const who = await participant();
  await q(`INSERT INTO bridge_v2_link_codes (code_hash, participant_id, giveaway_id, expires_at)
           VALUES ('LINK-1', $1, $2, now() + interval '10 minutes')`, [who, MAX_UINT256]);
  const claimed = await one(`SELECT * FROM bridge_v2_claim_link_for_chat('LINK-1', 'CHAT-1')`);
  assert.equal(claimed.participant_id, who);
  assert.equal(claimed.giveaway_id, MAX_UINT256, 'I2: a uint256 id must not be rounded on the way out');
  const again = await one(`SELECT * FROM bridge_v2_claim_link_for_chat('LINK-1', 'CHAT-1')`);
  assert.equal(again.link_id, claimed.link_id, 'a Telegram retry must be idempotent, not an error');
});

await test(['G5'], 'a second start from one chat detaches the first link instead of raising', async () => {
  await reset(target);
  const who = await participant();
  await q(`INSERT INTO bridge_v2_link_codes (code_hash, participant_id, giveaway_id, expires_at)
           VALUES ('LINK-A', $1, 1, now() + interval '10 minutes'),
                  ('LINK-B', $1, 2, now() + interval '10 minutes')`, [who]);
  await q(`SELECT * FROM bridge_v2_claim_link_for_chat('LINK-A', 'CHAT-2')`);
  const second = await one(`SELECT * FROM bridge_v2_claim_link_for_chat('LINK-B', 'CHAT-2')`);
  assert.equal(second.giveaway_id, '2');
  const state = await rows(`SELECT code_hash, telegram_chat_hmac, consumed_at
                              FROM bridge_v2_link_codes ORDER BY code_hash`);
  assert.equal(state[0].telegram_chat_hmac, null, 'the earlier link keeps its life and loses the chat');
  assert.equal(state[0].consumed_at, null);
  assert.equal(state[1].telegram_chat_hmac, 'CHAT-2');
});

await test(['G5'], 'consume_link_for_chat consumes once, and an expired link not at all', async () => {
  await reset(target);
  const who = await participant();
  await q(`INSERT INTO bridge_v2_link_codes (code_hash, participant_id, giveaway_id, expires_at, telegram_chat_hmac)
           VALUES ('LINK-C', $1, 3, now() + interval '10 minutes', 'CHAT-3'),
                  ('LINK-D', $1, 4, now() - interval '1 minute',  'CHAT-4')`, [who]);
  assert.equal((await rows(`SELECT * FROM bridge_v2_consume_link_for_chat('CHAT-3')`)).length, 1);
  assert.equal((await rows(`SELECT * FROM bridge_v2_consume_link_for_chat('CHAT-3')`)).length, 0);
  assert.equal((await rows(`SELECT * FROM bridge_v2_consume_link_for_chat('CHAT-4')`)).length, 0,
    'an expired link is not consumable');
});

// --- bridge_v2_bind_phone_and_verify / release_phone -----------------------

await test(['C5', 'C6'], 'bind_phone_and_verify binds the number and verifies the entry', async () => {
  await reset(target);
  const who = await participant();
  await entry(who, 1);
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-1', $1, 1, 'TG-1', 30)`, [who]), 'VERIFIED');
  const row = await one(`SELECT status, phone_hmac FROM bridge_v2_entries WHERE participant_id = $1`, [who]);
  assert.equal(row.status, 'VERIFIED');
  assert.equal(row.phone_hmac, 'PH-1');
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-1', $1, 1, 'TG-1', 30)`, [who]),
    'NOT_AWAITING', 'a Telegram redelivery moves the row once');
});

await test(['C5'], 'a number live for one account is refused to another', async () => {
  await reset(target);
  const first = await participant();
  const second = await participant();
  await entry(first, 1);
  await entry(second, 1);
  await q(`SELECT bridge_v2_bind_phone_and_verify('PH-2', $1, 1, 'TG-1', 30)`, [first]);
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-2', $1, 1, 'TG-2', 30)`, [second]), 'TAKEN');
  assert.equal(await scalar(`SELECT count(*)::int FROM bridge_v2_phones
                              WHERE phone_hmac = 'PH-2' AND released_at IS NULL`), 1);
});

await test(['C6'], 'a change of number releases the old one and fails the account live entries', async () => {
  await reset(target);
  const who = await participant();
  await entry(who, 1);
  await entry(who, 2);
  await q(`SELECT bridge_v2_bind_phone_and_verify('PH-3', $1, 1, 'TG-3', 30)`, [who]);
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-4', $1, 1, 'TG-3', 30)`, [who]),
    'NUMBER_CHANGED');
  const old = await one(`SELECT released_at, cooldown_until FROM bridge_v2_phones WHERE phone_hmac = 'PH-3'`);
  assert.notEqual(old.released_at, null, 'C6: the old number is released with its history kept');
  assert.notEqual(old.cooldown_until, null, 'C6: and enters a cooling period');
  const states = await rows(`SELECT status FROM bridge_v2_entries WHERE participant_id = $1`, [who]);
  assert.deepEqual(states.map((row) => row.status), ['FAILED', 'FAILED'],
    'C6: the account is blocked in every campaign it was active in');
});

await test(['C6'], 'a released number is held out of circulation until its cooldown ends', async () => {
  await reset(target);
  const first = await participant();
  const second = await participant();
  await entry(first, 1);
  // A different campaign, so what is measured here is the cooldown alone: in
  // campaign 1 the number already holds an entry, and the (campaign, number)
  // rule would answer DUPLICATE before the cooldown ever came into it.
  await entry(second, 2);
  await q(`SELECT bridge_v2_bind_phone_and_verify('PH-5', $1, 1, 'TG-5', 30)`, [first]);
  assert.equal(await scalar(`SELECT bridge_v2_release_phone($1, 30)`, [first]), 1);
  assert.equal(await scalar(`SELECT bridge_v2_release_phone($1, 30)`, [first]), 0, 'nothing left to release');
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-5', $1, 2, 'TG-6', 30)`, [second]),
    'COOLDOWN');
  await q(`UPDATE bridge_v2_phones SET cooldown_until = now() - interval '1 day' WHERE phone_hmac = 'PH-5'`);
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-5', $1, 2, 'TG-6', 30)`, [second]),
    'VERIFIED', 'once the cooldown has run out the number is reusable');
});

await test(['C5'], 'one entry per campaign and number, reported rather than raised', async () => {
  await reset(target);
  const first = await participant();
  const second = await participant();
  await entry(first, 1);
  await entry(second, 1);
  await q(`SELECT bridge_v2_bind_phone_and_verify('PH-6', $1, 1, 'TG-7', 30)`, [first]);
  await q(`UPDATE bridge_v2_phones
              SET released_at = now(), cooldown_until = now() - interval '1 day'
            WHERE phone_hmac = 'PH-6'`);
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-6', $1, 1, 'TG-8', 30)`, [second]),
    'DUPLICATE', '8.8: a collision leaves as a named outcome, never as an exception');
});

await test(['G5', 'C5', 'C6'], 'a bind that does not verify does not spend the number either', async () => {
  await reset(target);

  // NO_ENTRY: the participant has no entry in the campaign the bot names.
  const stranger = await participant();
  assert.equal(await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-7', $1, 99, 'TG-9', 30)`, [stranger]),
    'NO_ENTRY');
  const afterNoEntry = await scalar(`SELECT count(*)::int FROM bridge_v2_phones
                                      WHERE phone_hmac = 'PH-7' AND released_at IS NULL`);

  // DUPLICATE: the number already holds an entry in this campaign.
  const owner = await participant();
  const other = await participant();
  await entry(owner, 5);
  await entry(other, 5);
  await q(`SELECT bridge_v2_bind_phone_and_verify('PH-8', $1, 5, 'TG-10', 30)`, [owner]);
  await q(`UPDATE bridge_v2_phones
              SET released_at = now(), cooldown_until = now() - interval '1 day'
            WHERE phone_hmac = 'PH-8'`);
  const verdict = await scalar(`SELECT bridge_v2_bind_phone_and_verify('PH-8', $1, 5, 'TG-11', 30)`, [other]);
  const duplicateState = await one(
    `SELECT (SELECT count(*)::int FROM bridge_v2_phones
              WHERE phone_hmac = 'PH-8' AND participant_id = $1 AND released_at IS NULL) AS bound,
            (SELECT status FROM bridge_v2_entries WHERE participant_id = $1) AS status`,
    [other],
  );

  assert.deepEqual(
    { noEntry: afterNoEntry, duplicate: duplicateState.bound, duplicateStatus: duplicateState.status, verdict },
    { noEntry: 0, duplicate: 0, duplicateStatus: 'AWAITING_CONTACT', verdict: 'DUPLICATE' },
    'ACHADO 0005:377-386 against 0005:293-297. The function exists because the two-call version left '
    + '"the number spent, the participation lost, and no way back because the number is now in use". The '
    + 'INSERT INTO bridge_v2_phones sits in its own BEGIN/EXCEPTION block, which commits into the outer '
    + 'transaction; the entry lookup that can return NO_ENTRY (0005:388-394) and the UPDATE that can return '
    + 'DUPLICATE (0005:396-410) both come after it, and neither undoes it. The engine left the number bound '
    + `to an account with no verified entry in both cases: NO_ENTRY bound ${afterNoEntry} live row(s), `
    + `DUPLICATE bound ${duplicateState.bound} live row(s) while the entry stayed ${duplicateState.status}. `
    + 'C5 makes that number unusable platform-wide from then on.',
  );
});

// --- the funder pool -------------------------------------------------------

await test(['G3', 'D6'], 'acquire_funder takes a free funder and hands out a lease token', async () => {
  await reset(target);
  await funders(3);
  const lease = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  assert.ok(lease !== undefined, 'three free funders and nothing was acquired');
  assert.ok(lease.lease_token, 'G3: the holder carries a token every later call must present');
  const row = await one(`SELECT leased_until FROM bridge_v2_funders WHERE funder_index = $1`, [lease.funder_index]);
  assert.ok(new Date(row.leased_until) > new Date(), 'the lease is in the future');
});

await test(['G3'], 'a leased funder is not handed out again until its lease has expired', async () => {
  await reset(target);
  await funders(1);
  const first = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  assert.ok(first !== undefined);
  assert.equal((await rows(`SELECT * FROM bridge_v2_acquire_funder(60)`)).length, 0,
    'the only funder was leased and was handed out twice');
  await q(`UPDATE bridge_v2_funders SET leased_until = now() - interval '1 second'`);
  const second = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  assert.ok(second !== undefined, 'an expired lease must be reacquirable');
  assert.notEqual(second.lease_token, first.lease_token, 'the new holder gets a new token');
});

await test(['G3'], 'renew and release both require the lease token', async () => {
  await reset(target);
  await funders(1);
  const lease = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  assert.equal(await scalar(`SELECT bridge_v2_renew_funder_lease($1, $2, 60)`,
    [lease.funder_index, lease.lease_token]), true);
  assert.equal(await scalar(`SELECT bridge_v2_renew_funder_lease($1, gen_random_uuid(), 60)`,
    [lease.funder_index]), false,
    'a stale holder must not be able to extend a lease somebody else now has');
  assert.equal(await scalar(`SELECT bridge_v2_release_funder($1, gen_random_uuid(), 9)`,
    [lease.funder_index]), false);
  assert.equal(await scalar(`SELECT bridge_v2_release_funder($1, $2, 9)`,
    [lease.funder_index, lease.lease_token]), true);
  assert.equal(await scalar(`SELECT bridge_v2_release_funder($1, $2, 9)`,
    [lease.funder_index, lease.lease_token]), false, 'the token was cleared by the release');
});

await test(['G6'], 'release advances the nonce and never rewinds it', async () => {
  await reset(target);
  await funders(1);
  let lease = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  await q(`SELECT bridge_v2_release_funder($1, $2, 40)`, [lease.funder_index, lease.lease_token]);
  assert.equal(await scalar(`SELECT next_nonce FROM bridge_v2_funders WHERE funder_index = $1`,
    [lease.funder_index]), '40');
  lease = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  await q(`SELECT bridge_v2_release_funder($1, $2, 12)`, [lease.funder_index, lease.lease_token]);
  assert.equal(
    await scalar(`SELECT next_nonce FROM bridge_v2_funders WHERE funder_index = $1`, [lease.funder_index]),
    '40',
    'G6: a spent nonce never un-spends, so a stale release must not rewind it',
  );
});

await test(['G6'], 'reconciliation moves the nonce in either direction, for the lease holder only', async () => {
  await reset(target);
  await funders(1);
  const lease = await one(`SELECT * FROM bridge_v2_acquire_funder(60)`);
  await q(`SELECT bridge_v2_reconcile_funder_nonce($1, $2, 40)`, [lease.funder_index, lease.lease_token]);
  assert.equal(await scalar(`SELECT next_nonce FROM bridge_v2_funders WHERE funder_index = $1`,
    [lease.funder_index]), '40');
  assert.equal(await scalar(`SELECT bridge_v2_reconcile_funder_nonce($1, $2, 5)`,
    [lease.funder_index, lease.lease_token]), true);
  assert.equal(
    await scalar(`SELECT next_nonce FROM bridge_v2_funders WHERE funder_index = $1`, [lease.funder_index]),
    '5',
    'the one write that may lower the number is what unsticks a dropped transaction',
  );
  assert.equal(await scalar(`SELECT bridge_v2_reconcile_funder_nonce($1, gen_random_uuid(), 7)`,
    [lease.funder_index]), false);
});

await test(['H8'], 'a disabled funder leaves the rotation and cannot be disabled twice', async () => {
  await reset(target);
  await funders(2);
  assert.equal(await scalar(`SELECT bridge_v2_disable_funder(0)`), true);
  assert.equal(await scalar(`SELECT bridge_v2_disable_funder(0)`), false);
  for (let round = 0; round < 6; round += 1) {
    const lease = await one(`SELECT * FROM bridge_v2_acquire_funder(1)`);
    assert.equal(lease?.funder_index, 1, 'a disabled funder was handed out');
    await q(`UPDATE bridge_v2_funders SET leased_until = now() - interval '1 second'`);
  }
  assert.equal(await scalar(`SELECT bridge_v2_reconcile_funder_nonce(0, gen_random_uuid(), 3)`), false,
    'a funder taken out of rotation stays out');
});

// --- bridge_v2_claim_spend -------------------------------------------------

await test(['B8'], 'claim_spend moves both windows, or neither', async () => {
  await reset(target);
  assert.equal(await scalar(`SELECT bridge_v2_claim_spend('mail', 3, 10, 100)`), true);
  assert.deepEqual(
    await rows(`SELECT window_kind, units FROM bridge_v2_external_spend ORDER BY window_kind`),
    [{ window_kind: 'DAY', units: 3 }, { window_kind: 'HOUR', units: 3 }],
  );
  assert.equal(await scalar(`SELECT bridge_v2_claim_spend('mail', 9, 10, 100)`), false, 'the hour ceiling');
  assert.deepEqual(
    await rows(`SELECT window_kind, units FROM bridge_v2_external_spend ORDER BY window_kind`),
    [{ window_kind: 'DAY', units: 3 }, { window_kind: 'HOUR', units: 3 }],
    'B8: a denied attempt must not consume budget in either window',
  );
  assert.equal(await scalar(`SELECT bridge_v2_claim_spend('mail', 2, 10, 4)`), false, 'the day ceiling');
  assert.deepEqual(
    await rows(`SELECT window_kind, units FROM bridge_v2_external_spend ORDER BY window_kind`),
    [{ window_kind: 'DAY', units: 3 }, { window_kind: 'HOUR', units: 3 }],
    'a denial on the day window must not have spent the hour window',
  );
});

// --- the run lock and the run sequence -------------------------------------

await test(['G3', 'G6'], 'try_lock gives one holder, and nothing to the next run', async () => {
  await reset(target);
  const holder = await scalar(`SELECT bridge_v2_try_lock('pipeline', 60)`);
  assert.ok(holder, 'the first run must get a holder');
  assert.equal(await scalar(`SELECT bridge_v2_try_lock('pipeline', 60)`), null,
    'G6: a live lock means the second run does nothing');
});

await test(['G3'], 'an expired lock is taken by the next run, and the old holder cannot release it', async () => {
  await reset(target);
  const first = await scalar(`SELECT bridge_v2_try_lock('pipeline', 1)`);
  await sleep(1200);
  const second = await scalar(`SELECT bridge_v2_try_lock('pipeline', 60)`);
  assert.ok(second, 'a killed run must not hold the lock for ever');
  assert.notEqual(second, first);
  assert.equal(await scalar(`SELECT bridge_v2_release_lock('pipeline', $1)`, [first]), false,
    'a run that overran must not release the lock the next run now holds');
  assert.equal(await scalar(`SELECT bridge_v2_release_lock('pipeline', $1)`, [second]), true);
  assert.equal(await scalar(`SELECT bridge_v2_release_lock('pipeline', $1)`, [second]), false);
});

await test(['G4'], 'the run sequence advances by one per run', async () => {
  await reset(target);
  const first = await scalar(`SELECT bridge_v2_next_run_sequence()`);
  const second = await scalar(`SELECT bridge_v2_next_run_sequence()`);
  assert.equal(Number(second) - Number(first), 1, 'the phase rotation depends on it moving exactly once');
});

await test(['I9'], 'the wallet index is reserved from a sequence, starting at zero', async () => {
  await reset(target);
  assert.equal(await scalar(`SELECT bridge_v2_next_wallet_index()`), '0', 'BIP-44 indexes start at zero');
  const reserved = await scalar(`SELECT bridge_v2_next_wallet_index()`);
  const row = await one(
    `INSERT INTO bridge_v2_participants (email_canonical, wallet_index, wallet_address)
     VALUES ($1, $2, $3) RETURNING wallet_index`,
    [`${uniq('idx')}@example.test`, reserved, ADDR],
  );
  assert.equal(row.wallet_index, reserved,
    'the row must carry the index the address was derived from, never a second draw');
});

await test(['I9'], 'a participant row cannot exist holding a placeholder address', async () => {
  await reset(target);
  const client = await target.pool.connect();
  try {
    const refused = await attempt(client,
      `INSERT INTO bridge_v2_participants (email_canonical, wallet_address) VALUES ($1, '0x')`,
      [`${uniq('bad')}@example.test`]);
    assert.equal(refused.ok, false, 'finding K5 was exactly a row left holding the literal 0x');
    assert.equal(refused.code, '23514', 'the CHECK constraint, not a trigger');
  } finally {
    client.release();
  }
});

// --- the campaign queue ----------------------------------------------------

await test(['C8', 'G4', 'I2'], 'campaigns_with_verified gives one row per campaign, longest waiting first', async () => {
  await reset(target);
  const people = [];
  for (let index = 0; index < 5; index += 1) people.push(await participant());
  await q(
    `INSERT INTO bridge_v2_entries
       (participant_id, giveaway_id, status, wallet_address, idempotency_key, created_at)
     VALUES ($1, 50, 'VERIFIED',  $6, 'q1', now() - interval '5 minutes'),
            ($2, 50, 'VERIFIED',  $6, 'q2', now() - interval '4 minutes'),
            ($3, 50, 'VERIFIED',  $6, 'q3', now() - interval '3 minutes'),
            ($4, ${MAX_UINT256}, 'VERIFIED', $6, 'q4', now() - interval '9 minutes'),
            ($5, 51, 'CONFIRMED', $6, 'q5', now() - interval '1 minute')`,
    [...people, ADDR],
  );
  const queue = (await rows(`SELECT * FROM bridge_v2_campaigns_with_verified(10)`)).map((row) => row.giveaway_id);
  assert.deepEqual(queue, [MAX_UINT256, '50'],
    'one row per campaign with work waiting, oldest first, and no campaign without VERIFIED entries');
  assert.deepEqual((await rows(`SELECT * FROM bridge_v2_campaigns_with_verified(1)`)).map((row) => row.giveaway_id),
    [MAX_UINT256], 'the limit counts campaigns, not entries');
  assert.equal((await rows(`SELECT * FROM bridge_v2_campaigns_with_verified(-1)`)).length, 0,
    'GREATEST(p_limit, 0) keeps a negative limit from raising');
});

// --- retention -------------------------------------------------------------

await test(['I10', 'K7', 'D7'], 'cleanup empties every ephemeral table and reports what it removed', async () => {
  await reset(target);
  const who = await participant();
  await entry(who, 1);
  await q(`INSERT INTO bridge_v2_phones (phone_hmac, participant_id) VALUES ('PH-KEEP', $1)`, [who]);
  await q(`INSERT INTO bridge_v2_email_codes (email_canonical, code_hash, expires_at)
           VALUES ('old@example.test', 'H', now() - interval '3 days')`);
  await q(`INSERT INTO bridge_v2_link_codes (code_hash, participant_id, giveaway_id, expires_at)
           VALUES ('OLD', $1, 1, now() - interval '3 days')`, [who]);
  await q(`INSERT INTO bridge_v2_sessions (participant_id, token_hash, idle_expires_at, absolute_expires_at)
           VALUES ($1, 'T', now() - interval '40 days', now() - interval '40 days')`, [who]);
  await q(`INSERT INTO bridge_v2_rate_limits (axis, key_hash, window_start, count)
           VALUES ('ip', 'old', now() - interval '5 days', 1)`);
  await q(`INSERT INTO bridge_v2_rate_penalties (axis, key_hash, strikes, penalty_until, last_strike_at)
           VALUES ('ip', 'decayed', 3, now() - interval '10 days', now() - interval '40 days'),
                  ('ip', 'owing',   3, now() + interval '1 hour',  now() - interval '40 days')`);
  await q(`INSERT INTO bridge_v2_locks (name, holder, expires_at)
           VALUES ('dead', gen_random_uuid(), now() - interval '3 days')`);
  await q(`INSERT INTO bridge_v2_external_spend (provider, window_kind, window_start, units)
           VALUES ('old', 'DAY', now() - interval '40 days', 1)`);
  await q(`INSERT INTO bridge_v2_ops_events (correlation_id, kind, created_at)
           VALUES (gen_random_uuid(), 'old', now() - interval '40 days')`);

  const removed = await rows(`SELECT * FROM bridge_v2_cleanup(30, 30, 30)`);
  assert.deepEqual(
    removed.map((row) => [row.table_name, row.rows_removed]),
    [
      ['bridge_v2_email_codes', 1],
      ['bridge_v2_link_codes', 1],
      ['bridge_v2_sessions', 1],
      ['bridge_v2_rate_limits', 1],
      ['bridge_v2_rate_penalties', 1],
      ['bridge_v2_locks', 1],
      ['bridge_v2_external_spend', 1],
      ['bridge_v2_ops_events', 1],
    ],
    'K6 was a table nothing ever removed a row from; every ephemeral table needs a line here',
  );
  assert.deepEqual(
    (await rows(`SELECT key_hash FROM bridge_v2_rate_penalties ORDER BY key_hash`)).map((row) => row.key_hash),
    ['owing'],
    'B4: deleting a row with a live penalty would hand the caller an amnesty',
  );
  const kept = await one(
    `SELECT (SELECT count(*)::int FROM bridge_v2_participants) AS people,
            (SELECT count(*)::int FROM bridge_v2_entries)      AS entries,
            (SELECT count(*)::int FROM bridge_v2_phones)       AS phones`,
  );
  assert.deepEqual(kept, { people: 1, entries: 1, phones: 1 },
    'D7: the participation record and the proof material are not swept');
});

// ===========================================================================
// 3. concurrency
// ===========================================================================

await test(['B3', 'G1'], 'eight concurrent rate limit calls count eight, not one', async () => {
  await reset(target);
  const key = uniq('race');
  const runs = await concurrently(target, 8, (client) =>
    client.query(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 600, 100, 10, 3600)`, [key])
      .then((result) => result.rows[0]));
  assert.deepEqual(runs.filter((run) => !run.ok).map((run) => run.code), [], 'no call may raise');
  assert.equal(runs.filter((run) => run.value.allowed).length, 8);
  assert.equal(
    await scalar(`SELECT count FROM bridge_v2_rate_limits WHERE key_hash = $1`, [key]),
    8,
    'B3/G1: a read-compare-write would have advanced the counter once for the round',
  );
});

await test(['B4', 'B3', 'G1'], 'concurrent strikes against a new key each count', async () => {
  await reset(target);
  const key = uniq('strike');
  // penalty_seconds = 0, so no caller is turned away by a live penalty and every
  // one of them reaches the strike arithmetic. max_count = 0, so every call is
  // over the ceiling. Eight callers, eight strikes, if the count is atomic.
  const first = await concurrently(target, 8, (client) =>
    client.query(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 600, 0, 0, 3600)`, [key]));
  assert.deepEqual(first.filter((run) => !run.ok).map((run) => run.code), []);
  const fresh = await scalar(`SELECT strikes FROM bridge_v2_rate_penalties WHERE key_hash = $1`, [key]);

  // The same burst again, now that the row exists and FOR UPDATE has something
  // to lock.
  await concurrently(target, 8, (client) =>
    client.query(`SELECT * FROM bridge_v2_rate_limit_hit('ip', $1, 600, 0, 0, 3600)`, [key]));
  const existing = await scalar(`SELECT strikes FROM bridge_v2_rate_penalties WHERE key_hash = $1`, [key]);

  assert.deepEqual(
    { firstBurst: fresh, secondBurst: existing - fresh },
    { firstBurst: 8, secondBurst: 8 },
    'ACHADO 0005:75-83. The file states: "The standing penalty is read first and under a row lock, so two '
    + 'concurrent callers cannot both observe the pre-strike value and both write strike n+1." '
    + 'SELECT ... FOR UPDATE locks nothing when no row matches, and the upsert at 0005:114-119 writes '
    + '`strikes = v_strikes` from the local read rather than from the stored value, so the first burst '
    + `against an unseen (axis, key) is a lost update: eight concurrent denials recorded ${fresh} strike(s) `
    + `instead of 8. Once the row exists the lock does hold (${existing - fresh} of 8). B4's escalation `
    + 'therefore starts one step late for exactly the burst it exists to punish.',
  );
});

await test(['J4', 'G1'], 'eight concurrent guesses spend one attempt each', async () => {
  await reset(target);
  const email = `${uniq('burst')}@example.test`;
  await emailCode(email, 'HASH-BURST');
  const runs = await concurrently(target, 8, (client) =>
    client.query(`SELECT * FROM bridge_v2_claim_email_code_attempt($1, 100)`, [email])
      .then((result) => result.rows[0]));
  assert.deepEqual(runs.filter((run) => !run.ok).map((run) => run.code), []);
  const left = runs.map((run) => run.value.attempts_left);
  assert.equal(new Set(left).size, 8, 'finding #5 was a burst of guesses sharing one increment');
  assert.equal(await scalar(`SELECT attempts FROM bridge_v2_email_codes WHERE email_canonical = $1`, [email]), 8);
});

await test(['G2', 'G5'], 'four concurrent consumptions of one code: exactly one wins', async () => {
  await reset(target);
  const id = await emailCode(`${uniq('once')}@example.test`, 'HASH-ONCE');
  const runs = await concurrently(target, 4, (client) =>
    client.query(`SELECT bridge_v2_consume_email_code($1) AS ok`, [id]).then((result) => result.rows[0].ok));
  assert.equal(runs.filter((run) => run.ok && run.value === true).length, 1);
  assert.equal(runs.filter((run) => run.ok && run.value === false).length, 3);
});

await test(['G3'], 'concurrent acquisitions never hand the same funder to two runs', async () => {
  await reset(target);
  await funders(3);
  const runs = await concurrently(target, 3, (client) =>
    client.query(`SELECT * FROM bridge_v2_acquire_funder(60)`).then((result) => result.rows[0]));
  const taken = runs.filter((run) => run.ok && run.value !== undefined).map((run) => run.value.funder_index);
  assert.equal(new Set(taken).size, taken.length, 'G6: two runs on one funder is a nonce collision');
  assert.equal(taken.length, 3, 'FOR UPDATE SKIP LOCKED sits under the LIMIT, so a locked row is skipped');
});

await test(['G3'], 'four concurrent runs against one free funder: exactly one gets it', async () => {
  await reset(target);
  await funders(3);
  await q(`UPDATE bridge_v2_funders SET disabled_at = now() WHERE funder_index IN (1, 2)`);
  const runs = await concurrently(target, 4, (client) =>
    client.query(`SELECT * FROM bridge_v2_acquire_funder(60)`).then((result) => result.rows[0]));
  const taken = runs.filter((run) => run.ok && run.value !== undefined);
  assert.equal(taken.length, 1, 'expiry alone must never authorise a second holder');
});

await test(['G6'], 'eight concurrent runs take one lock between them', async () => {
  await reset(target);
  const runs = await concurrently(target, 8, (client) =>
    client.query(`SELECT bridge_v2_try_lock('pipeline', 60) AS holder`).then((result) => result.rows[0].holder));
  assert.deepEqual(runs.filter((run) => !run.ok).map((run) => run.code), [], 'a losing run must not raise');
  assert.equal(runs.filter((run) => run.ok && run.value !== null).length, 1,
    'a cron that fires every minute over five minutes of work overlaps itself by construction');
});

await test(['C5'], 'two accounts presenting one number at once: one binds, one is told it is taken', async () => {
  await reset(target);
  const first = await participant();
  const second = await participant();
  await entry(first, 1);
  await entry(second, 1);
  const runs = await concurrently(target, 2, (client, index) =>
    client.query(`SELECT bridge_v2_bind_phone_and_verify('PH-RACE', $1, 1, 'TG-R', 30) AS outcome`,
      [index === 0 ? first : second]).then((result) => result.rows[0].outcome));
  assert.deepEqual(runs.filter((run) => !run.ok).map((run) => run.code), [],
    '8.8: a collision must never leave as an exception');
  assert.deepEqual(runs.map((run) => run.value).sort(), ['TAKEN', 'VERIFIED']);
  assert.equal(await scalar(`SELECT count(*)::int FROM bridge_v2_phones
                              WHERE phone_hmac = 'PH-RACE' AND released_at IS NULL`), 1,
    'C5: one live binding per number, platform-wide');
});

await test(['G5'], 'four concurrent deliveries of one contact consume the link once', async () => {
  await reset(target);
  const who = await participant();
  await q(`INSERT INTO bridge_v2_link_codes (code_hash, participant_id, giveaway_id, expires_at, telegram_chat_hmac)
           VALUES ('LINK-RACE', $1, 1, now() + interval '10 minutes', 'CHAT-RACE')`, [who]);
  const runs = await concurrently(target, 4, (client) =>
    client.query(`SELECT * FROM bridge_v2_consume_link_for_chat('CHAT-RACE')`).then((result) => result.rowCount));
  assert.equal(runs.filter((run) => run.ok && run.value === 1).length, 1,
    'Telegram retries an unacknowledged delivery, so a duplicate is expected traffic');
});

await test(['B8'], 'ten concurrent claims against a ceiling of five let exactly five through', async () => {
  await reset(target);
  const runs = await concurrently(target, 10, (client) =>
    client.query(`SELECT bridge_v2_claim_spend('provider', 1, 5, 1000) AS ok`).then((result) => result.rows[0].ok));
  assert.equal(runs.filter((run) => run.ok && run.value === true).length, 5,
    'B8: the ceiling is enforced before the call, not discovered on the invoice');
  assert.equal(await scalar(`SELECT units FROM bridge_v2_external_spend WHERE window_kind = 'HOUR'`), 5);
});

await test(['I9', 'G4'], 'concurrent draws on the two sequences never repeat a number', async () => {
  await reset(target);
  const wallets = await concurrently(target, 8, (client) =>
    client.query(`SELECT bridge_v2_next_wallet_index() AS index`).then((result) => result.rows[0].index));
  assert.equal(new Set(wallets.map((run) => run.value)).size, 8,
    'I9: reusing an index would hand one person wallet to another');
  const runsSeq = await concurrently(target, 8, (client) =>
    client.query(`SELECT bridge_v2_next_run_sequence() AS index`).then((result) => result.rows[0].index));
  assert.equal(new Set(runsSeq.map((run) => run.value)).size, 8);
});

await test(['J3', 'J4'], 'two issues of a code at once leave one live code, not two', async () => {
  await reset(target);
  const email = `${uniq('issue')}@example.test`;
  // What lib/bridge-v2/codes.ts:47-61 does: supersede, then insert. Two round
  // trips, and the comment above them says the order "means a race between two
  // issues leaves exactly one live code rather than two".
  const runs = await concurrently(target, 2, async (client) => {
    await client.query(`SELECT bridge_v2_supersede_email_codes($1)`, [email]);
    await client.query(
      `INSERT INTO bridge_v2_email_codes (email_canonical, code_hash, expires_at)
       VALUES ($1, $2, now() + interval '10 minutes')`,
      [email, uniq('HASH')],
    );
    return 'issued';
  });
  assert.deepEqual(runs.filter((run) => !run.ok).map((run) => run.code), []);
  const live = await scalar(
    `SELECT count(*)::int FROM bridge_v2_email_codes
      WHERE email_canonical = $1 AND consumed_at IS NULL`, [email]);
  assert.equal(
    live,
    1,
    'ACHADO lib/bridge-v2/codes.ts:47-61 against J3. Superseding in one statement and inserting in another '
    + 'does not exclude the interleaving supersede(A), supersede(B), insert(A), insert(B): both supersedes '
    + `find nothing to end and both inserts land. The engine left ${live} live codes for one address, which `
    + 'doubles the J4 attempt ceiling and makes the older code attemptable once the newer is exhausted.',
  );
});

// ===========================================================================
// 4. I5 - row level security
// ===========================================================================

await test(['I5'], 'RLS is on for every bridge table, with no policy anywhere', async () => {
  const unprotected = await rows(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname LIKE 'bridge\\_v2\\_%' AND NOT c.relrowsecurity`,
  );
  assert.deepEqual(unprotected.map((row) => row.relname), [], 'a table without RLS is open to anon');
  assert.equal(
    await scalar(`SELECT count(*)::int FROM pg_policies
                   WHERE schemaname = 'public' AND tablename LIKE 'bridge\\_v2\\_%'`),
    0,
    'a policy here opens personal data to the browser',
  );
});

await test(['I5'], 'a role without BYPASSRLS reads nothing and writes nothing, on every table', async () => {
  await reset(target);
  const who = await participant();
  await entry(who, 1);
  await q(`INSERT INTO bridge_v2_ops_events (correlation_id, kind) VALUES (gen_random_uuid(), 'seen')`);

  const tables = await bridgeTables(target);
  await q(`CREATE ROLE bridge_v2_probe NOLOGIN`).catch(() => {});
  await q(`GRANT USAGE ON SCHEMA public TO bridge_v2_probe`);
  for (const table of tables) {
    await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO bridge_v2_probe`);
  }

  const observed = await asRole(target, 'bridge_v2_probe', async (client) => {
    const seen = {};
    for (const table of tables) {
      const read = await attempt(client, `SELECT count(*)::int AS n FROM public.${table}`);
      seen[table] = read.ok ? read.rows[0].n : `refused ${read.code}`;
    }
    const write = await attempt(client,
      `INSERT INTO public.bridge_v2_locks (name, holder, expires_at)
       VALUES ('probe', gen_random_uuid(), now())`);
    const update = await attempt(client, `UPDATE public.bridge_v2_ops_events SET kind = 'x'`);
    const remove = await attempt(client, `DELETE FROM public.bridge_v2_ops_events`);
    return { seen, write, update, remove };
  });

  assert.deepEqual(
    Object.values(observed.seen),
    tables.map(() => 0),
    'I5: RLS with no policy means every SELECT returns the empty set, whatever the grants say',
  );
  assert.equal(observed.write.ok, false, 'an INSERT must be refused by the policy check');
  assert.equal(observed.write.code, '42501');
  assert.match(observed.write.message, /row-level security policy/);
  assert.equal(observed.update.rowCount, 0, 'an UPDATE sees no row to change');
  assert.equal(observed.remove.rowCount, 0, 'a DELETE sees no row to remove');
});

await test(['I5'], 'anon reaches no table and no function at all', async () => {
  const refusals = await asRole(target, 'anon', async (client) => ({
    read: await attempt(client, `SELECT * FROM public.bridge_v2_participants LIMIT 1`),
    write: await attempt(client,
      `INSERT INTO public.bridge_v2_ops_events (correlation_id, kind) VALUES (gen_random_uuid(), 'x')`),
    call: await attempt(client, `SELECT bridge_v2_next_run_sequence()`),
  }));
  assert.deepEqual(
    [refusals.read.code, refusals.write.code, refusals.call.code],
    ['42501', '42501', '42501'],
    'the grant is the first barrier and RLS the second; a publishable key in a browser passes neither',
  );
  assert.match(refusals.call.message, /permission denied for function/);
});

await test(['I5'], 'service_role carries BYPASSRLS through SET ROLE and sees the rows', async () => {
  await reset(target);
  const who = await participant();
  await entry(who, 1);
  const observed = await asRole(target, 'service_role', async (client) => ({
    people: await attempt(client, `SELECT count(*)::int AS n FROM public.bridge_v2_participants`),
    write: await attempt(client,
      `INSERT INTO public.bridge_v2_ops_events (correlation_id, kind) VALUES (gen_random_uuid(), 'ok')`),
    call: await attempt(client, `SELECT bridge_v2_try_lock('service', 10) AS holder`),
  }));
  assert.equal(observed.people.rows[0].n, 1, 'BYPASSRLS has to survive SET ROLE or every route reads nothing');
  assert.equal(observed.write.ok, true);
  assert.equal(observed.call.ok, true);
});

// ===========================================================================
// 5. I5 - what 0006 grants, and to whom
// ===========================================================================

await test(['I5'], 'after 0006 only service_role can execute a bridge function', async () => {
  const functions = await bridgeFunctions(target);
  const wrong = [];
  for (const row of functions) {
    const privileges = await one(
      `SELECT has_function_privilege('anon',          $1::oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::oid, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role',  $1::oid, 'EXECUTE') AS service,
              EXISTS (SELECT 1 FROM aclexplode($2::text::aclitem[]) acl
                       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS public`,
      [row.oid, row.acl],
    );
    if (privileges.public || privileges.anon || privileges.authenticated || !privileges.service) {
      wrong.push(`${row.name}: public=${privileges.public} anon=${privileges.anon} `
        + `authenticated=${privileges.authenticated} service_role=${privileges.service}`);
    }
  }
  assert.deepEqual(wrong, [],
    'Postgres grants EXECUTE to PUBLIC on a new function, and PUBLIC includes anon and authenticated');
});

await test(['I5'], 'anon and authenticated hold no privilege on any bridge table', async () => {
  const held = await rows(
    `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name LIKE 'bridge\\_v2\\_%'
        AND grantee IN ('anon', 'authenticated')`,
  );
  assert.deepEqual(held, [], 'the REVOKE wall at the end of 0006 is the second of the two mechanisms');
});

await test(['I5', 'D7'], 'on a project without Supabase default privileges, 0006 grants exactly what it lists', async () => {
  bare = await createDatabase('bridge_v2_bare', { withCitext: true });
  // The same roles and the same citext, and deliberately NOT the ALTER DEFAULT
  // PRIVILEGES that Supabase sets on `public`. This is 0006 read literally.
  await bare.pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated, service_role`);
  await bare.pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role`);
  await bare.pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role`);
  for (const file of V2) {
    const applied = await applyMigration(bare, file);
    assert.ok(applied.ok, `${file}: ${applied.ok ? '' : `${applied.at} ${applied.text}`}`);
  }
  const verbs = await bare.pool.query(
    `SELECT c.relname AS table_name,
            has_table_privilege('service_role', c.oid, 'SELECT') AS s,
            has_table_privilege('service_role', c.oid, 'INSERT') AS i,
            has_table_privilege('service_role', c.oid, 'UPDATE') AS u,
            has_table_privilege('service_role', c.oid, 'DELETE') AS d
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'bridge\\_v2\\_%'
      ORDER BY c.relname`,
  );
  const shape = Object.fromEntries(verbs.rows.map((row) =>
    [row.table_name, `${row.s ? 'S' : '-'}${row.i ? 'I' : '-'}${row.u ? 'U' : '-'}${row.d ? 'D' : '-'}`]));

  assert.deepEqual(shape, {
    // no DELETE: erasure is a rewrite, and a removed participant orphans an
    // address already inside an on-chain root
    bridge_v2_participants: 'SIU-',
    bridge_v2_sessions: 'SIUD',
    bridge_v2_email_codes: 'SIUD',
    bridge_v2_link_codes: 'SIUD',
    bridge_v2_phones: 'SIU-',
    // no DELETE: an entry is the participation record
    bridge_v2_entries: 'SIU-',
    // append-only, mirroring the contract
    bridge_v2_eligibility_roots: 'SI--',
    bridge_v2_eligibility_leaves: 'SI--',
    bridge_v2_rate_limits: 'SIUD',
    bridge_v2_rate_penalties: 'SIUD',
    bridge_v2_locks: 'SIUD',
    bridge_v2_funders: 'SIU-',
    bridge_v2_external_spend: 'SIUD',
    bridge_v2_disposable_domains: 'SI--',
    bridge_v2_custody: 'SIU-',
    // no UPDATE: the bridge appends to the record of what it did
    bridge_v2_ops_events: 'SI-D',
  }, 'a verb with no call site is a privilege granted on a story');

  // And the operations the bridge actually performs still work under exactly that.
  const worked = await asRole(bare, 'service_role', async (client) => ({
    people: await attempt(client,
      `INSERT INTO public.bridge_v2_participants (email_canonical, wallet_address)
       VALUES ('bare@example.test', '${ADDR}')`),
    limit: await attempt(client, `SELECT * FROM bridge_v2_rate_limit_hit('ip', 'bare', 60, 5, 10, 3600)`),
    sweep: await attempt(client, `SELECT count(*)::int AS n FROM bridge_v2_cleanup(30, 30, 30)`),
    log: await attempt(client,
      `INSERT INTO public.bridge_v2_ops_events (correlation_id, kind) VALUES (gen_random_uuid(), 'k')`),
  }));
  assert.deepEqual(Object.entries(worked).filter(([, result]) => !result.ok).map(([name]) => name), [],
    'the withheld verbs must not be verbs the code needs');
  assert.equal(worked.sweep.rows[0].n, 8, 'the retention pass reaches all eight tables under these grants');
});

await test(['I5', 'I9'], '0006 revokes tables and functions from anon and authenticated, and sequences too', async () => {
  // Supabase sets ALTER DEFAULT PRIVILEGES in `public` granting ALL on tables,
  // functions AND sequences to anon, authenticated and service_role. 0006 answers
  // the first two with an explicit REVOKE and does not answer the third at all.
  const held = await rows(
    `SELECT s.relname AS sequence_name, r.rolname AS role,
            has_sequence_privilege(r.rolname, s.oid, 'USAGE')  AS usage,
            has_sequence_privilege(r.rolname, s.oid, 'UPDATE') AS update
       FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
       CROSS JOIN pg_roles r
      WHERE n.nspname = 'public' AND s.relkind = 'S' AND s.relname LIKE 'bridge\\_v2\\_%'
        AND r.rolname IN ('anon', 'authenticated')
      ORDER BY s.relname, r.rolname`,
  );
  const reachable = held.filter((row) => row.usage || row.update)
    .map((row) => `${row.role} on ${row.sequence_name}: usage=${row.usage} update=${row.update}`);

  const browser = await asRole(target, 'anon', async (client) => ({
    next: await attempt(client, `SELECT nextval('public.bridge_v2_wallet_index_seq')`),
    rewind: await attempt(client, `SELECT setval('public.bridge_v2_wallet_index_seq', 0, false)`),
  }));

  assert.deepEqual(
    reachable,
    [],
    'ACHADO 0006:143-150 against 0006:225-241. The file revokes every table and every function from anon and '
    + 'authenticated, and for the sequences writes only "GRANT USAGE ... TO service_role" - a GRANT adds, it '
    + 'never removes what Supabase ALTER DEFAULT PRIVILEGES already gave. The engine, shaped like a Supabase '
    + `project, left these standing: ${reachable.join('; ')}. As anon: `
    + `nextval ${browser.next.ok ? 'succeeded' : 'was refused'}, `
    + `setval ${browser.rewind.ok ? 'succeeded' : 'was refused'}. The comment at 0006:137-141 says "USAGE, `
    + 'never UPDATE ... rewinding the wallet sequence would reassign an index that is already somebody '
    + 'wallet"; that is the one thing anon can do here.',
  );
});

await test(['I5', 'D7'], '0006 withholds a verb from service_role rather than only failing to grant it', async () => {
  // Same mechanism, other side. 0006 never REVOKEs anything from service_role, so
  // on a project carrying Supabase's default privileges every deliberate omission
  // in the grant list is inert.
  const attempts = await asRole(target, 'service_role', async (client) => ({
    'DELETE on bridge_v2_entries': await attempt(client, `DELETE FROM public.bridge_v2_entries`),
    'DELETE on bridge_v2_participants': await attempt(client, `DELETE FROM public.bridge_v2_participants`),
    'UPDATE on bridge_v2_ops_events': await attempt(client, `UPDATE public.bridge_v2_ops_events SET kind = 'x'`),
    'UPDATE on bridge_v2_eligibility_roots': await attempt(client,
      `UPDATE public.bridge_v2_eligibility_roots SET root_index = 1`),
    'setval on bridge_v2_wallet_index_seq': await attempt(client,
      `SELECT setval('public.bridge_v2_wallet_index_seq', 0, false)`),
  }));
  const allowed = Object.entries(attempts).filter(([, result]) => result.ok).map(([name]) => name);
  assert.deepEqual(
    allowed,
    [],
    'ACHADO 0006:60-140. Each grant in 0006 names the call site that needs it, and the omissions are argued '
    + 'in prose: "No DELETE: an entry is the participation record", "No UPDATE: the bridge appends to the '
    + 'record of what it did and never rewrites a line of it", "USAGE, never UPDATE". None of that is '
    + 'enforced, because the file only ever GRANTs and Supabase ALTER DEFAULT PRIVILEGES has already '
    + `granted ALL to service_role on everything the migration creates. The engine allowed: ${allowed.join('; ')}.`,
  );
});

// ===========================================================================
// 6. the engine against the target
// ===========================================================================

await test([], 'the engine is a PostgreSQL of the target major version', async () => {
  const settings = Object.fromEntries(engine.settings.map((row) => [row.name, row.setting]));
  assert.match(settings.server_version, /^17\./,
    `the target runs PostgreSQL 17.x; this is ${settings.server_version}`);
  assert.equal(settings.default_transaction_isolation, 'read committed',
    'every concurrency claim in 0005 is a claim about READ COMMITTED');
  assert.equal(settings.standard_conforming_strings, 'on',
    'the LIKE escapes in the 0006 revoke sweep depend on it');
});

await test([], 'citext resolves from the extensions schema, which is where the target keeps it', async () => {
  const where = await scalar(
    `SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'citext'`,
  );
  assert.equal(where, 'extensions');
  // Proof that the SET search_path on the functions is doing the work: a session
  // whose search_path is public alone still resolves the citext parameter.
  const client = await target.pool.connect();
  try {
    await client.query(`SET search_path = public`);
    const called = await attempt(client, `SELECT bridge_v2_supersede_email_codes('probe@example.test')`);
    assert.equal(called.ok, true,
      'without the per-function search_path this call fails on the = it cannot resolve');
  } finally {
    await client.query(`RESET search_path`).catch(() => {});
    client.release();
  }
});

}
