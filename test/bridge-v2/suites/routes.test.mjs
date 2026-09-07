/**
 * The HTTP routes, with the database, the chain and every outbound provider
 * replaced by doubles. What is under test is the route: its guards, the order it
 * applies them in, what it answers, and what it refuses to say.
 */

import { readFileSync } from 'node:fs';
import {
  assert,
  http,
  jsonResponse,
  request,
  suite,
  test,
  TEST_CRON_SECRET,
  TEST_TELEGRAM_SECRET,
} from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import * as chain from '../doubles/chain.mjs';

import * as requestCode from '../../../api/bridge/v2/session/request-code.ts';
import * as verify from '../../../api/bridge/v2/session/verify.ts';
import * as revoke from '../../../api/bridge/v2/session/revoke.ts';
import * as entryStart from '../../../api/bridge/v2/entry/start.ts';
import * as entryStatus from '../../../api/bridge/v2/entry/status.ts';
import * as entryAddress from '../../../api/bridge/v2/entry/address.ts';
import * as entryResume from '../../../api/bridge/v2/entry/resume.ts';
import * as destination from '../../../api/bridge/v2/prize/destination.ts';
import * as privacyExport from '../../../api/bridge/v2/privacy/export.ts';
import * as privacyErase from '../../../api/bridge/v2/privacy/erase.ts';
import * as webhook from '../../../api/bridge/v2/telegram/webhook.ts';
import * as cronProcess from '../../../api/bridge/v2/cron/process.ts';
import * as cronMaintenance from '../../../api/bridge/v2/cron/maintenance.ts';
import * as creatorStart from '../../../api/bridge/v2/creator/campaign/start.ts';
import * as creatorSubmit from '../../../api/bridge/v2/creator/campaign/submit.ts';
import * as creatorStatus from '../../../api/bridge/v2/creator/campaign/status.ts';

suite('routes');

const WALLET = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const OWN_WALLET = '0x1234567890abcdef1234567890abcdef12345678';
const SESSION_COOKIE = 'iw_bridge_session=a-token-value';
const url = (path) => `https://events.invalid/api/bridge/v2/${path}`;

/** Everything a route needs to find a live session and its participant. */
function liveSession({ participantId = 'participant-1' } = {}) {
  db.on('bridge_v2_sessions:select', () => ({
    data: {
      id: 'session-1',
      participant_id: participantId,
      idle_expires_at: new Date(Date.now() + 60_000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    },
    error: null,
  }));
  db.on('bridge_v2_participants:select', () => ({
    data: { id: participantId, wallet_index: 0, wallet_address: WALLET },
    error: null,
  }));
}

const allowAllLimits = () =>
  db.on('rpc:bridge_v2_rate_limit_hit', () => ({
    data: [{ allowed: true, retry_after_seconds: 0 }],
    error: null,
  }));

const denyLimits = () =>
  db.on('rpc:bridge_v2_rate_limit_hit', () => ({
    data: [{ allowed: false, retry_after_seconds: 42 }],
    error: null,
  }));

/** A clean slate for one test. */
function fresh() {
  db.reset();
  chain.reset();
  http.reset();
  allowAllLimits();
  http.on('api.resend.com', () => jsonResponse({ id: 'mail-1' }));
  http.on('api.telegram.org', () => jsonResponse({ ok: true }));
  http.on('cloudflare-dns.com', () => jsonResponse({ Status: 0, Answer: [{ data: '10 mx' }] }));
}

const alertsRaised = () =>
  db
    .callsTo('bridge_v2_ops_events:insert')
    .filter((call) => call.payload.kind === 'alert')
    .map((call) => call.payload.detail.summary);

// ---------------------------------------------------------------------------
// session/request-code — B5, B8, C1, C2, D2, J2, J6
// ---------------------------------------------------------------------------

await test(['D2'], 'a code request answers identically for a known and an unknown address', async () => {
  const answers = [];
  for (const known of [null, { id: 'participant-1' }]) {
    fresh();
    db.on('bridge_v2_participants:select', () => ({ data: known, error: null }));
    db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
    const response = await requestCode.POST(
      request(url('session/request-code'), { body: { email: 'someone@example.com' } }),
    );
    answers.push([response.status, await response.text()]);
  }
  assert.deepEqual(answers[0], answers[1], 'the answer distinguishes a registered address');
  assert.equal(answers[0][0], 200);
  assert.deepEqual(JSON.parse(answers[0][1]), { ok: true, status: 'accepted' });
});

await test(['D2', 'C2'], 'a disposable domain and a missing MX record answer the same', async () => {
  const answers = [];
  for (const setup of [
    () =>
      db.on('bridge_v2_disposable_domains:select', () => ({
        data: [{ domain: 'x' }],
        error: null,
      })),
    () => {
      db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
      http.routes.length = 0;
      http.on('cloudflare-dns.com', () => jsonResponse({ Status: 0, Answer: [] }));
    },
  ]) {
    fresh();
    setup();
    const response = await requestCode.POST(
      request(url('session/request-code'), { body: { email: 'someone@example.com' } }),
    );
    answers.push([response.status, await response.text()]);
  }
  assert.deepEqual(answers[0], answers[1]);
  assert.equal(answers[0][0], 200);
});

await test(['D2', 'B5'], 'an address over its own limit is refused silently, not with a 429', async () => {
  // Returning 429 from the address axis published the difference between an
  // address the platform knows and one it does not: the ceilings differ, so
  // anyone could test membership three requests at a time.
  fresh();
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_rate_limit_hit', (op) => {
    const allowed = op.args.p_axis !== 'UNKNOWN_EMAIL';
    return { data: [{ allowed, retry_after_seconds: allowed ? 0 : 3600 }], error: null };
  });
  const response = await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'someone@example.com' } }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: 'accepted' });
  assert.equal(http.requests.filter((entry) => entry.url.includes('resend')).length, 0);
});

await test(['B5'], 'an unknown address is counted on a different axis from a known one', async () => {
  const axes = [];
  for (const known of [null, { id: 'participant-1' }]) {
    fresh();
    db.on('bridge_v2_participants:select', () => ({ data: known, error: null }));
    db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
    db.on('rpc:bridge_v2_rate_limit_hit', (op) => {
      if (op.args.p_axis.includes('EMAIL')) axes.push(op.args.p_axis);
      return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
    });
    await requestCode.POST(
      request(url('session/request-code'), { body: { email: 'someone@example.com' } }),
    );
  }
  assert.deepEqual(axes, ['UNKNOWN_EMAIL', 'EMAIL']);
});

await test(['B2'], 'a caller over an axis about themselves does get a 429', async () => {
  // The axes that say nothing about which address was named are safe to report.
  fresh();
  denyLimits();
  const response = await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'someone@example.com' } }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '42');
});

await test(['B8'], 'the mail budget is claimed before the provider is called', async () => {
  fresh();
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: false, error: null }));
  const response = await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'someone@example.com' } }),
  );
  assert.equal(response.status, 200);
  assert.equal(http.requests.filter((entry) => entry.url.includes('resend')).length, 0);
  assert.equal(db.callsTo('rpc:bridge_v2_issue_email_code').length, 0, 'a code was issued anyway');
  assert.ok(alertsRaised().includes('external spend ceiling reached'));
});

await test(['C1', 'J6'], 'the code is keyed on the canonical address and sent to the literal one', async () => {
  // The canonical form strips +tag at every provider, and a provider that
  // treats +tag as part of the mailbox delivers to somebody else.
  fresh();
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'Alice+shop@example.com' } }),
  );
  const issued = db.callsTo('rpc:bridge_v2_issue_email_code')[0];
  assert.equal(issued.args.p_email_canonical, 'alice@example.com');
  const mail = JSON.parse(http.requests.find((entry) => entry.url.includes('resend')).body);
  assert.deepEqual(mail.to, ['Alice+shop@example.com'], 'the code went to the canonical form');
  assert.ok(!/\d{6}/.test(mail.subject), 'the code is in the subject');
  assert.match(mail.text, /\d{6}/);
});

await test(['J2', 'F2'], 'the plaintext code is never stored and never returned', async () => {
  fresh();
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  const response = await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'alice@example.com' } }),
  );
  const mail = JSON.parse(http.requests.find((entry) => entry.url.includes('resend')).body);
  const code = mail.text.match(/\b(\d{6})\b/)[1];
  const issued = db.callsTo('rpc:bridge_v2_issue_email_code')[0];
  assert.ok(!JSON.stringify(issued.args).includes(code), 'the code was persisted in clear');
  assert.equal(issued.args.p_code_hash.length, 64);
  assert.ok(!(await response.text()).includes(code));
});

await test(['I1'], 'a malformed address is a 400 and reaches nothing', async () => {
  fresh();
  const response = await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'not-an-address' } }),
  );
  assert.equal(response.status, 400);
  assert.equal(db.calls.length, 0, 'a bad address still hit the database');
});

await test(['I3'], 'a request with the wrong content type is a 400', async () => {
  fresh();
  const response = await requestCode.POST(
    new Request(url('session/request-code'), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }),
  );
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// session/verify — A1, A2, A3, D2, G2, J4
// ---------------------------------------------------------------------------

await test(['D2', 'J4'], 'a wrong code and a code that never existed answer the same', async () => {
  const answers = [];
  for (const rows of [
    // WRONG: a live code exists and the hash does not match.
    [{ code_id: 'code-1', code_hash: 'f'.repeat(64), attempts_left: 4 }],
    // NONE: no live code at all.
    [],
  ]) {
    fresh();
    db.on('rpc:bridge_v2_claim_email_code_attempt', () => ({ data: rows, error: null }));
    const response = await verify.POST(
      request(url('session/verify'), { body: { email: 'alice@example.com', code: '123456' } }),
    );
    answers.push([response.status, await response.text()]);
  }
  assert.deepEqual(answers[0], answers[1], 'the answer says whether the address is registered');
  assert.equal(answers[0][0], 401);
});

await test(['J4', 'G1'], 'the attempt is claimed in the database before anything is compared', async () => {
  fresh();
  db.on('rpc:bridge_v2_claim_email_code_attempt', () => ({ data: [], error: null }));
  await verify.POST(
    request(url('session/verify'), { body: { email: 'alice@example.com', code: '123456' } }),
  );
  const claim = db.callsTo('rpc:bridge_v2_claim_email_code_attempt')[0];
  assert.ok(claim, 'no attempt was claimed');
  assert.equal(claim.args.p_max_attempts, 5);
  assert.ok(claim.abortSignal instanceof AbortSignal);
});

await test(['A1', 'A2', 'A3'], 'a correct code issues a session in a cookie and nothing else', async () => {
  fresh();
  // The route hashes the candidate itself, so the stored hash has to be the one
  // the real hashCode produces. Take it from the issue path.
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'alice@example.com' } }),
  );
  const issued = db.callsTo('rpc:bridge_v2_issue_email_code')[0].args;
  const mail = JSON.parse(http.requests.find((entry) => entry.url.includes('resend')).body);
  const code = mail.text.match(/\b(\d{6})\b/)[1];

  db.on('rpc:bridge_v2_claim_email_code_attempt', () => ({
    data: [{ code_id: 'code-1', code_hash: issued.p_code_hash, attempts_left: 4 }],
    error: null,
  }));
  db.on('rpc:bridge_v2_consume_email_code', () => ({ data: true, error: null }));
  db.on('bridge_v2_participants:select', () => ({
    data: { id: 'participant-1', wallet_index: 0, wallet_address: WALLET },
    error: null,
  }));
  db.on('bridge_v2_sessions:insert', () => ({ data: null, error: null }));

  const response = await verify.POST(
    request(url('session/verify'), { body: { email: 'alice@example.com', code } }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^iw_bridge_session=[A-Za-z0-9_-]{43,}; /);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.deepEqual(await response.json(), { ok: true }, 'the body carries more than ok');
});

await test(['G2'], 'a code consumed by somebody else between compare and consume is refused', async () => {
  fresh();
  db.on('rpc:bridge_v2_claim_email_code_attempt', () => ({
    data: [{ code_id: 'code-1', code_hash: 'a'.repeat(64), attempts_left: 4 }],
    error: null,
  }));
  db.on('rpc:bridge_v2_consume_email_code', () => ({ data: false, error: null }));
  const response = await verify.POST(
    request(url('session/verify'), { body: { email: 'alice@example.com', code: '123456' } }),
  );
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// A1, A4, A6, B1, D1, I2 — the routes that need a session
// ---------------------------------------------------------------------------

const SESSION_ROUTES = [
  ['entry/status', entryStatus, { giveawayId: '1' }],
  ['entry/start', entryStart, { giveawayId: '1' }],
  ['entry/address', entryAddress, { giveawayId: '1', address: OWN_WALLET }],
  ['entry/resume', entryResume, { giveawayId: '1' }],
  ['prize/destination', destination, { giveawayId: '1', address: OWN_WALLET }],
  ['privacy/export', privacyExport, undefined],
  ['privacy/erase', privacyErase, undefined],
  [
    'creator/campaign/start',
    creatorStart,
    {
      module: OWN_WALLET,
      prizeToken: WALLET,
      prizeAmount: '1000000',
      durationSeconds: 3600,
      winnersCount: 1,
      slotCap: 10,
    },
  ],
  ['creator/campaign/submit', creatorSubmit, undefined],
  ['creator/campaign/status', creatorStatus, undefined],
];

await test(['A1', 'A6'], 'every stateful route answers 401 with no cookie', async () => {
  for (const [name, module, body] of SESSION_ROUTES) {
    fresh();
    const response = await module.POST(request(url(name), { body }));
    assert.equal(response.status, 401, `${name} answered ${response.status} with no session`);
  }
});

await test(['A1', 'A4'], 'every stateful route answers 401 with an expired cookie', async () => {
  for (const [name, module, body] of SESSION_ROUTES) {
    fresh();
    db.on('bridge_v2_sessions:select', () => ({
      data: {
        id: 'session-1',
        participant_id: 'participant-1',
        idle_expires_at: new Date(Date.now() - 1000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
      },
      error: null,
    }));
    const response = await module.POST(request(url(name), { body, cookie: SESSION_COOKIE }));
    assert.equal(response.status, 401, `${name} accepted an expired session`);
  }
});

await test(['B1'], 'every stateful route is rate limited before it does any work', async () => {
  for (const [name, module, body] of SESSION_ROUTES) {
    fresh();
    liveSession();
    denyLimits();
    const response = await module.POST(request(url(name), { body, cookie: SESSION_COOKIE }));
    assert.equal(response.status, 429, `${name} answered ${response.status} over its limit`);
    assert.equal(response.headers.get('retry-after'), '42');
  }
});

await test(['D1'], 'entry status is scoped to the session participant and to nobody else', async () => {
  fresh();
  liveSession({ participantId: 'participant-7' });
  let filters;
  db.on('bridge_v2_entries:select', (op) => {
    filters = op.filters;
    return { data: null, error: null };
  });
  const response = await entryStatus.POST(
    request(url('entry/status'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: 'NONE' });
  assert.deepEqual(filters, [
    ['eq', 'participant_id', 'participant-7'],
    ['eq', 'giveaway_id', '1'],
  ]);
});

await test(['D1', 'D7'], 'entry status returns the caller own address, hash and custody', async () => {
  fresh();
  liveSession();
  db.on('bridge_v2_entries:select', () => ({
    data: {
      id: 'entry-1',
      participant_id: 'participant-1',
      giveaway_id: '1',
      status: 'CONFIRMED',
      wallet_address: WALLET,
      phone_hmac: 'a'.repeat(64),
      root_index: '3',
      tx_hash: '0xabc',
    },
    error: null,
  }));
  db.on('bridge_v2_custody:select', () => ({
    data: {
      entry_id: 'entry-1',
      prize_kind: 'TOKEN',
      requires_own_wallet: false,
      destination_address: null,
      destination_confirmed_at: null,
      custody_expires_at: null,
      claimed_at: null,
      claim_tx_hash: null,
      delivered_at: null,
      delivery_tx_hash: null,
      custody_expired_alert_at: null,
      no_prize_at: null,
    },
    error: null,
  }));
  const body = await (
    await entryStatus.POST(
      request(url('entry/status'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
    )
  ).json();
  assert.equal(body.status, 'CONFIRMED');
  assert.equal(body.walletAddress, WALLET);
  assert.equal(body.txHash, '0xabc');
  assert.equal(body.custody.prizeKind, 'TOKEN');
  // C5: the number was never stored, so its hash is not the participant's data
  // to hand back either.
  assert.ok(!JSON.stringify(body).includes('phone'), 'a phone field reached the client');
});

await test(['I2'], 'a campaign id past uint256 is a 400, never a 500', async () => {
  fresh();
  liveSession();
  const response = await entryStatus.POST(
    request(url('entry/status'), { body: { giveawayId: '9'.repeat(78) }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// entry/start — E2, G5, H5, H6, R1
// ---------------------------------------------------------------------------

function startReady() {
  liveSession();
  db.on('bridge_v2_entries:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_entries:insert', () => ({
    data: {
      id: 'entry-1',
      participant_id: 'participant-1',
      giveaway_id: '1',
      status: 'AWAITING_CONTACT',
      wallet_address: WALLET,
      phone_hmac: null,
      root_index: null,
      tx_hash: null,
    },
    error: null,
  }));
  db.on('bridge_v2_custody:upsert', () => ({ data: null, error: null }));
  db.on('bridge_v2_link_codes:insert', () => ({ data: null, error: null }));
}

await test(['H5', 'H6'], 'a campaign past its effective end hands out no link', async () => {
  fresh();
  startReady();
  // enter() checks status AND block.timestamp < effectiveEndTime, and a campaign
  // stays OPEN past its end until somebody calls closeGiveaway.
  chain.set({
    readGiveaway: { ...chain.behaviour.readGiveaway, isOpen: true, acceptsEntries: false },
  });
  const response = await entryStart.POST(
    request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 409);
  assert.equal(db.callsTo('bridge_v2_link_codes:insert').length, 0);
});

await test(['B7', 'H6'], 'a campaign with no slots left hands out no link', async () => {
  fresh();
  startReady();
  chain.set({ slotsRemaining: 0n });
  const response = await entryStart.POST(
    request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 409);
  assert.equal(db.callsTo('bridge_v2_link_codes:insert').length, 0);
});

await test(['R1'], 'the link is a plain t.me start link and nothing else', async () => {
  fresh();
  startReady();
  const body = await (
    await entryStart.POST(
      request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
    )
  ).json();
  assert.equal(body.status, 'AWAITING_CONTACT');
  assert.match(body.url, /^https:\/\/t\.me\/example_events_bot\?start=[A-Za-z0-9_-]{16,}$/);
  assert.ok(!/web_?app|startapp/i.test(body.url), 'the link opens a Web App');
});

await test(['G5'], 'the link code is stored hashed and the plaintext appears once', async () => {
  fresh();
  startReady();
  const body = await (
    await entryStart.POST(
      request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
    )
  ).json();
  const code = body.url.split('start=')[1];
  const insert = db.callsTo('bridge_v2_link_codes:insert')[0];
  assert.notEqual(insert.payload.code_hash, code);
  assert.equal(insert.payload.code_hash.length, 64);
  assert.equal(insert.payload.participant_id, 'participant-1');
  assert.equal(insert.payload.giveaway_id, '1');
});

await test(['E2', 'OWNER-D1'], 'the custody rule is recorded at entry time from the campaign', async () => {
  fresh();
  startReady();
  chain.set({
    readGiveaway: {
      ...chain.behaviour.readGiveaway,
      prizeKind: 0,
      prizeAmount: 500n * 10n ** 6n,
      winnersCount: 10,
    },
  });
  await entryStart.POST(
    request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
  );
  const upsert = db.callsTo('bridge_v2_custody:upsert')[0];
  // The largest share is 50 USDC, under the threshold, so temporary custody.
  assert.equal(upsert.payload.prize_kind, 'TOKEN');
  assert.equal(upsert.payload.requires_own_wallet, false);
});

await test(['E2'], 'an NFT campaign records the own-wallet rule whatever it declares', async () => {
  fresh();
  startReady();
  chain.set({
    readGiveaway: {
      ...chain.behaviour.readGiveaway,
      prizeKind: 1,
      prizeAmount: 0n,
      winnersCount: 1,
    },
  });
  await entryStart.POST(
    request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
  );
  const upsert = db.callsTo('bridge_v2_custody:upsert')[0];
  assert.equal(upsert.payload.prize_kind, 'NFT');
  assert.equal(upsert.payload.requires_own_wallet, true);
});

await test(['G5'], 'an entry already moving is not re-issued a link', async () => {
  fresh();
  liveSession();
  db.on('bridge_v2_entries:select', () => ({
    data: {
      id: 'entry-1',
      participant_id: 'participant-1',
      giveaway_id: '1',
      status: 'CONFIRMED',
      wallet_address: WALLET,
      phone_hmac: null,
      root_index: null,
      tx_hash: null,
    },
    error: null,
  }));
  const body = await (
    await entryStart.POST(
      request(url('entry/start'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
    )
  ).json();
  assert.deepEqual(body, { ok: true, status: 'CONFIRMED' });
  assert.equal(db.callsTo('bridge_v2_link_codes:insert').length, 0);
});

// ---------------------------------------------------------------------------
// prize/destination — E4
// ---------------------------------------------------------------------------

function custodyReady() {
  liveSession();
  db.on('bridge_v2_entries:select', () => ({
    data: {
      id: 'entry-1',
      participant_id: 'participant-1',
      giveaway_id: '1',
      status: 'CONFIRMED',
      wallet_address: WALLET,
      phone_hmac: null,
      root_index: null,
      tx_hash: null,
    },
    error: null,
  }));
  db.on('bridge_v2_custody:select', () => ({
    data: {
      entry_id: 'entry-1',
      prize_kind: 'TOKEN',
      requires_own_wallet: true,
      destination_address: null,
      destination_confirmed_at: null,
      custody_expires_at: null,
      claimed_at: null,
      claim_tx_hash: null,
      delivered_at: null,
      delivery_tx_hash: null,
      custody_expired_alert_at: null,
      no_prize_at: null,
    },
    error: null,
  }));
}

await test(['E4'], 'proposing a destination stores it unconfirmed and echoes it back', async () => {
  fresh();
  custodyReady();
  let update;
  db.on('bridge_v2_custody:update', (op) => {
    update = op;
    return { data: { entry_id: 'entry-1' }, error: null };
  });
  const body = await (
    await destination.POST(
      request(url('prize/destination'), {
        body: { giveawayId: '1', address: OWN_WALLET },
        cookie: SESSION_COOKIE,
      }),
    )
  ).json();
  assert.deepEqual(body, { ok: true, destinationAddress: OWN_WALLET, destinationConfirmed: false });
  assert.equal(update.payload.destination_address, OWN_WALLET);
  assert.equal(update.payload.destination_confirmed_at, null, 'the proposal confirmed itself');
});

await test(['E4'], 'confirming names the address again, and a different one is refused', async () => {
  fresh();
  custodyReady();
  db.on('bridge_v2_custody:update', (op) => {
    // The database matches on the address, so a confirmation of anything else
    // finds no row.
    const named = op.filters.find(([, column]) => column === 'destination_address');
    return { data: named?.[2] === OWN_WALLET ? { entry_id: 'entry-1' } : null, error: null };
  });

  const wrong = await destination.POST(
    request(url('prize/destination'), {
      body: { giveawayId: '1', address: `0x${'9'.repeat(40)}`, confirm: true },
      cookie: SESSION_COOKIE,
    }),
  );
  assert.equal(wrong.status, 409);

  const right = await destination.POST(
    request(url('prize/destination'), {
      body: { giveawayId: '1', address: OWN_WALLET, confirm: true },
      cookie: SESSION_COOKIE,
    }),
  );
  assert.equal(right.status, 200);
  assert.deepEqual(await right.json(), {
    ok: true,
    destinationAddress: OWN_WALLET,
    destinationConfirmed: true,
  });
});

await test(['I1'], 'a destination that is not an address is a 400', async () => {
  fresh();
  custodyReady();
  const response = await destination.POST(
    request(url('prize/destination'), {
      body: { giveawayId: '1', address: 'my-wallet' },
      cookie: SESSION_COOKIE,
    }),
  );
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// entry/address — 07/09/2026 decision, path 2: declare your own address
// ---------------------------------------------------------------------------

function entryReady(overrides = {}) {
  liveSession();
  db.on('bridge_v2_entries:select', () => ({
    data: {
      id: 'entry-1',
      participant_id: 'participant-1',
      giveaway_id: '1',
      status: 'AWAITING_CONTACT',
      wallet_address: WALLET,
      phone_hmac: null,
      root_index: null,
      tx_hash: null,
      self_custody: false,
      ...overrides,
    },
    error: null,
  }));
}

await test(['C8'], 'declaring an own address updates the entry and marks it self-custody', async () => {
  fresh();
  entryReady();
  let update;
  db.on('bridge_v2_entries:update', (op) => {
    update = op;
    return { data: { id: 'entry-1' }, error: null };
  });
  const body = await (
    await entryAddress.POST(
      request(url('entry/address'), { body: { giveawayId: '1', address: OWN_WALLET }, cookie: SESSION_COOKIE }),
    )
  ).json();
  assert.deepEqual(body, { ok: true, walletAddress: OWN_WALLET, selfCustody: true });
  assert.equal(update.payload.wallet_address, OWN_WALLET);
  assert.equal(update.payload.self_custody, true);
  assert.ok(
    update.filters.some(([op, col, val]) => op === 'in' && col === 'status' && val.includes('AWAITING_CONTACT')),
    'the update did not gate on the pre-root statuses',
  );
});

await test(['C8'], 'an address already used in this campaign is refused, not raised', async () => {
  fresh();
  entryReady();
  db.on('bridge_v2_entries:update', () => ({ data: null, error: { code: '23505' } }));
  const response = await entryAddress.POST(
    request(url('entry/address'), { body: { giveawayId: '1', address: OWN_WALLET }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 409);
});

await test(['C8'], 'an entry already past ELIGIBLE cannot change its address', async () => {
  fresh();
  entryReady({ status: 'ELIGIBLE', root_index: '2' });
  db.on('bridge_v2_entries:update', () => ({ data: null, error: null }));
  const response = await entryAddress.POST(
    request(url('entry/address'), { body: { giveawayId: '1', address: OWN_WALLET }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 409);
});

await test(['A6'], 'declaring an address for an entry that does not exist is a 404', async () => {
  fresh();
  liveSession();
  db.on('bridge_v2_entries:select', () => ({ data: null, error: null }));
  const response = await entryAddress.POST(
    request(url('entry/address'), { body: { giveawayId: '1', address: OWN_WALLET }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 404);
});

// ---------------------------------------------------------------------------
// entry/resume — 07/09/2026 decision, path 3: resume a FAILED entry
// ---------------------------------------------------------------------------

await test([], 'resuming an entry that is not FAILED just reports its status', async () => {
  fresh();
  entryReady({ status: 'VERIFIED' });
  const body = await (
    await entryResume.POST(request(url('entry/resume'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }))
  ).json();
  assert.deepEqual(body, { ok: true, status: 'VERIFIED' });
});

await test([], 'a FAILED entry already on chain is resumed straight to CONFIRMED', async () => {
  fresh();
  entryReady({ status: 'FAILED' });
  chain.set({ hasEntered: true });
  let update;
  db.on('bridge_v2_entries:update', (op) => {
    update = op;
    return { data: { id: 'entry-1' }, error: null };
  });
  const body = await (
    await entryResume.POST(request(url('entry/resume'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }))
  ).json();
  assert.deepEqual(body, { ok: true, status: 'CONFIRMED' });
  assert.equal(update.payload.status, 'CONFIRMED');
});

await test(['H5', 'H6'], 'a FAILED entry cannot resume into a closed or full campaign', async () => {
  fresh();
  entryReady({ status: 'FAILED' });
  chain.set({ hasEntered: false, readGiveaway: { ...chain.behaviour.readGiveaway, acceptsEntries: false } });
  const response = await entryResume.POST(
    request(url('entry/resume'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 409);
});

await test(['C8'], 'a FAILED entry already inside a root resumes to ELIGIBLE, not VERIFIED', async () => {
  fresh();
  entryReady({ status: 'FAILED', root_index: '4' });
  chain.set({ hasEntered: false });
  let update;
  db.on('bridge_v2_entries:update', (op) => {
    update = op;
    return { data: { id: 'entry-1' }, error: null };
  });
  const body = await (
    await entryResume.POST(request(url('entry/resume'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }))
  ).json();
  assert.deepEqual(body, { ok: true, status: 'ELIGIBLE' });
  assert.equal(update.payload.status, 'ELIGIBLE');
});

await test([], 'a FAILED entry never inside a root resumes to VERIFIED', async () => {
  fresh();
  entryReady({ status: 'FAILED', root_index: null });
  chain.set({ hasEntered: false });
  let update;
  db.on('bridge_v2_entries:update', (op) => {
    update = op;
    return { data: { id: 'entry-1' }, error: null };
  });
  const body = await (
    await entryResume.POST(request(url('entry/resume'), { body: { giveawayId: '1' }, cookie: SESSION_COOKIE }))
  ).json();
  assert.deepEqual(body, { ok: true, status: 'VERIFIED' });
  assert.equal(update.payload.status, 'VERIFIED');
});

// ---------------------------------------------------------------------------
// creator/campaign — 07/09/2026 decision, path 2: a creator without a wallet
// ---------------------------------------------------------------------------

const CREATOR_BODY = {
  module: OWN_WALLET,
  prizeToken: WALLET,
  prizeAmount: '1000000',
  durationSeconds: 3600,
  winnersCount: 1,
  slotCap: 10,
};

function creatorReady() {
  liveSession();
  db.on('bridge_v2_phones:select', () => ({ data: { id: 'phone-1' }, error: null }));
  db.on('bridge_v2_creators:select', () => ({
    data: { id: 'creator-1', participant_id: 'participant-1', wallet_index: 5, wallet_address: OWN_WALLET },
    error: null,
  }));
}

await test([], 'a creator without a verified phone cannot draft a campaign', async () => {
  fresh();
  liveSession();
  db.on('bridge_v2_phones:select', () => ({ data: null, error: null }));
  const response = await creatorStart.POST(
    request(url('creator/campaign/start'), { body: CREATOR_BODY, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 403);
});

await test([], 'an unregistered prize module is refused before anything is drafted', async () => {
  fresh();
  creatorReady();
  chain.set({ isModuleRegistered: false });
  const response = await creatorStart.POST(
    request(url('creator/campaign/start'), { body: CREATOR_BODY, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 400);
});

await test([], 'an NFT prize module is refused for a creator without a wallet', async () => {
  fresh();
  creatorReady();
  chain.set({ modulePrizeKind: 1 }); // PrizeKind.NFT
  const response = await creatorStart.POST(
    request(url('creator/campaign/start'), { body: CREATOR_BODY, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 400);
});

await test([], 'a creator with a campaign already in progress cannot draft a second one', async () => {
  fresh();
  creatorReady();
  db.on('bridge_v2_creator_campaigns:select', () => ({
    data: {
      id: 'draft-1',
      creator_id: 'creator-1',
      status: 'PENDING_DEPOSIT',
      module: CREATOR_BODY.module,
      prize_token: CREATOR_BODY.prizeToken,
      prize_amount: CREATOR_BODY.prizeAmount,
      duration_seconds: String(CREATOR_BODY.durationSeconds),
      winners_count: CREATOR_BODY.winnersCount,
      slot_cap: CREATOR_BODY.slotCap,
      fee_amount: '1000000',
      slots_cost: '1000000',
      giveaway_id: null,
      tx_hash: null,
    },
    error: null,
  }));
  const response = await creatorStart.POST(
    request(url('creator/campaign/start'), { body: CREATOR_BODY, cookie: SESSION_COOKIE }),
  );
  assert.equal(response.status, 409);
});

await test([], 'a valid draft hands back the deposit address and amounts', async () => {
  fresh();
  creatorReady();
  db.on('bridge_v2_creator_campaigns:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_creator_campaigns:insert', () => ({
    data: {
      id: 'draft-1',
      creator_id: 'creator-1',
      status: 'PENDING_DEPOSIT',
      module: CREATOR_BODY.module,
      prize_token: CREATOR_BODY.prizeToken,
      prize_amount: CREATOR_BODY.prizeAmount,
      duration_seconds: String(CREATOR_BODY.durationSeconds),
      winners_count: CREATOR_BODY.winnersCount,
      slot_cap: CREATOR_BODY.slotCap,
      fee_amount: '1000000',
      slots_cost: '1000000',
      giveaway_id: null,
      tx_hash: null,
    },
    error: null,
  }));
  const body = await (
    await creatorStart.POST(request(url('creator/campaign/start'), { body: CREATOR_BODY, cookie: SESSION_COOKIE }))
  ).json();
  assert.equal(body.ok, true);
  assert.equal(body.depositAddress, OWN_WALLET);
  assert.equal(body.prizeToken, CREATOR_BODY.prizeToken);
});

await test([], 'campaign status reports NONE for a participant who never created one', async () => {
  fresh();
  liveSession();
  db.on('bridge_v2_creators:select', () => ({ data: null, error: null }));
  const body = await (
    await creatorStatus.POST(request(url('creator/campaign/status'), { cookie: SESSION_COOKIE }))
  ).json();
  assert.deepEqual(body, { ok: true, status: 'NONE' });
});

await test([], 'submitting with no campaign in progress is a 404', async () => {
  fresh();
  creatorReady();
  db.on('bridge_v2_creator_campaigns:select', () => ({ data: null, error: null }));
  const response = await creatorSubmit.POST(request(url('creator/campaign/submit'), { cookie: SESSION_COOKIE }));
  assert.equal(response.status, 404);
});

await test([], 'submitting before the deposit has arrived is refused, not signed', async () => {
  fresh();
  creatorReady();
  db.on('bridge_v2_creator_campaigns:select', () => ({
    data: {
      id: 'draft-1',
      creator_id: 'creator-1',
      status: 'PENDING_DEPOSIT',
      module: CREATOR_BODY.module,
      prize_token: CREATOR_BODY.prizeToken,
      prize_amount: '1000000',
      duration_seconds: '3600',
      winners_count: 1,
      slot_cap: 10,
      fee_amount: '1000000',
      slots_cost: '1000000',
      giveaway_id: null,
      tx_hash: null,
    },
    error: null,
  }));
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-1', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  chain.set({ erc20BalanceOf: 0n });
  const response = await creatorSubmit.POST(request(url('creator/campaign/submit'), { cookie: SESSION_COOKIE }));
  assert.equal(response.status, 409);
  assert.equal(
    chain.calls.some((call) => call.name === 'quoteApprove'),
    false,
    'a step was signed before the deposit was confirmed',
  );
});

// ---------------------------------------------------------------------------
// privacy — A5, C6, D7
// ---------------------------------------------------------------------------

await test(['D7'], 'the export returns what is held and says what is not', async () => {
  fresh();
  liveSession();
  db.on('bridge_v2_participants:select', () => ({
    data: {
      email_canonical: 'alice@example.com',
      wallet_address: WALLET,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    error: null,
  }));
  db.on('bridge_v2_entries:select', () => ({
    data: [{ giveaway_id: '1', status: 'CONFIRMED', wallet_address: WALLET, tx_hash: '0xabc' }],
    error: null,
  }));
  const body = await (
    await privacyExport.POST(request(url('privacy/export'), { cookie: SESSION_COOKIE }))
  ).json();
  assert.equal(body.participant.email, 'alice@example.com');
  assert.equal(body.participant.walletAddress, WALLET);
  assert.equal(body.entries.length, 1);
  // C5: the number was never stored, so it cannot be exported, and saying so is
  // part of an honest export.
  assert.match(body.notIncluded.phoneNumber, /never stored/);
  assert.ok(!('derivationIndex' in body.participant));
});

await test(['A5', 'C6', 'D7'], 'erasure releases the number, tombstones the address and revokes', async () => {
  fresh();
  liveSession();
  db.on('rpc:bridge_v2_release_phone', () => ({ data: 1, error: null }));
  let tombstone;
  db.on('bridge_v2_participants:update', (op) => {
    tombstone = op.payload.email_canonical;
    return { data: null, error: null };
  });
  db.on('bridge_v2_sessions:update', () => ({ data: [{ id: 'a' }], error: null }));

  const response = await privacyErase.POST(
    request(url('privacy/erase'), { cookie: SESSION_COOKIE }),
  );
  const body = await response.json();
  assert.equal(db.callsTo('rpc:bridge_v2_release_phone').length, 1, 'the number was not released');
  // C6: released into its cooldown, so erasure is not a way to recycle a number.
  assert.equal(db.callsTo('rpc:bridge_v2_release_phone')[0].args.p_cooldown_days, 30);
  assert.match(tombstone, /^erased-[0-9a-f]{32}@invalid$/);
  assert.ok(!tombstone.includes('alice'), 'the tombstone carries the old address');
  assert.equal(body.sessionsRevoked, 1);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

await test(['A5'], 'revoke clears the cookie whether or not there was a session', async () => {
  for (const alive of [false, true]) {
    fresh();
    if (alive) {
      liveSession();
      db.on('bridge_v2_sessions:update', () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }));
    } else {
      db.on('bridge_v2_sessions:select', () => ({ data: null, error: null }));
    }
    const response = await revoke.POST(request(url('session/revoke'), { cookie: SESSION_COOKIE }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /iw_bridge_session=; .*Max-Age=0/);
  }
});

// ---------------------------------------------------------------------------
// telegram/webhook — A1, B2, B8, C5, C6, K4, K6, R1, R2, R4
// ---------------------------------------------------------------------------

const telegramRequest = (update, { secret = TEST_TELEGRAM_SECRET } = {}) =>
  request(url('telegram/webhook'), {
    body: update,
    headers: { 'x-telegram-bot-api-secret-token': secret },
  });

const sentTexts = () =>
  http.requests
    .filter((entry) => entry.url.includes('api.telegram.org'))
    .map((entry) => JSON.parse(entry.body));

const contactUpdate = (chatId = 1) => ({
  message: {
    chat: { id: chatId },
    from: { id: 111 },
    contact: { user_id: 111, phone_number: '+351911111111' },
  },
});

await test(['A1'], 'an update without the right secret is refused and does nothing', async () => {
  for (const secret of ['wrong', '', 'x'.repeat(TEST_TELEGRAM_SECRET.length)]) {
    fresh();
    const response = await webhook.POST(
      telegramRequest({ message: { chat: { id: 1 }, text: '/start abc' } }, { secret }),
    );
    assert.equal(response.status, 401);
    assert.equal(sentTexts().length, 0, 'the bot answered an unauthenticated caller');
  }
});

await test(['A1'], 'an update with no secret header at all is refused', async () => {
  fresh();
  const response = await webhook.POST(
    request(url('telegram/webhook'), { body: { message: { chat: { id: 1 } } } }),
  );
  assert.equal(response.status, 401);
});

await test(['R1', 'R4'], 'a start with a code asks for the contact and stores no chat id', async () => {
  fresh();
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_claim_link_for_chat', () => ({
    data: [{ link_id: 'link-1', participant_id: 'participant-1', giveaway_id: '1' }],
    error: null,
  }));
  const response = await webhook.POST(
    telegramRequest({ message: { chat: { id: 4242 }, text: '/start abcdefghijklmnop' } }),
  );
  assert.equal(response.status, 200);
  const claim = db.callsTo('rpc:bridge_v2_claim_link_for_chat')[0];
  assert.match(claim.args.p_chat_hmac, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(claim.args).includes('4242'), 'the chat id was stored in clear');
  const sent = sentTexts();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reply_markup.keyboard[0][0].request_contact, true);
  assert.ok(!('inline_keyboard' in sent[0].reply_markup));
});

await test(['B8'], 'the Telegram budget is claimed before the link is touched', async () => {
  fresh();
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: false, error: null }));
  const response = await webhook.POST(
    telegramRequest({ message: { chat: { id: 1 }, text: '/start abcdefghijklmnop' } }),
  );
  assert.equal(response.status, 200);
  // Claiming afterwards attached the link to the chat and then refused to ask
  // for a contact, spending the code on nothing.
  assert.equal(db.callsTo('rpc:bridge_v2_claim_link_for_chat').length, 0);
});

await test(['C5'], 'a forwarded contact card is refused', async () => {
  fresh();
  const response = await webhook.POST(
    telegramRequest({
      message: {
        chat: { id: 1 },
        from: { id: 111 },
        contact: { user_id: 222, phone_number: '+351911111111' },
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(db.callsTo('rpc:bridge_v2_bind_phone_and_verify').length, 0);
  assert.match(sentTexts()[0].text, /not yours/);
});

await test(['C5', 'K4'], 'the number reaches the database only as a hash', async () => {
  fresh();
  db.on('rpc:bridge_v2_consume_link_for_chat', () => ({
    data: [{ link_id: 'link-1', participant_id: 'participant-1', giveaway_id: '1' }],
    error: null,
  }));
  db.on('rpc:bridge_v2_bind_phone_and_verify', () => ({ data: 'VERIFIED', error: null }));
  await webhook.POST(telegramRequest(contactUpdate()));
  const bind = db.callsTo('rpc:bridge_v2_bind_phone_and_verify')[0];
  assert.match(bind.args.p_phone_hmac, /^[0-9a-f]{64}$/);
  assert.match(bind.args.p_telegram_id_hmac, /^[0-9a-f]{64}$/);
  const serialised = JSON.stringify(db.calls.map((call) => call.args ?? call.payload ?? null));
  assert.ok(!serialised.includes('351911111111'), 'the number reached the database in clear');
  assert.ok(!serialised.includes('911111111'), 'part of the number reached the database');
});

await test(['B2'], 'the number is its own axis, and a denial does not burn the code', async () => {
  fresh();
  db.on('rpc:bridge_v2_rate_limit_hit', (op) => ({
    data: [{ allowed: op.args.p_axis !== 'PHONE', retry_after_seconds: 3600 }],
    error: null,
  }));
  const response = await webhook.POST(telegramRequest(contactUpdate()));
  assert.equal(response.status, 200);
  assert.equal(db.callsTo('rpc:bridge_v2_consume_link_for_chat').length, 0, 'the code was burned');
  const phoneAxis = db
    .callsTo('rpc:bridge_v2_rate_limit_hit')
    .find((call) => call.args.p_axis === 'PHONE');
  assert.match(phoneAxis.args.p_key_hash, /^[0-9a-f]{64}$/);
});

await test(['B2'], 'the webhook has no IP axis, which would count Telegram as one caller', async () => {
  fresh();
  db.on('rpc:bridge_v2_consume_link_for_chat', () => ({ data: [], error: null }));
  await webhook.POST(telegramRequest({ message: { chat: { id: 1 }, text: 'hello' } }));
  const axes = db.callsTo('rpc:bridge_v2_rate_limit_hit').map((call) => call.args.p_axis);
  // The source address identifies Telegram, not the person: an IP axis limits
  // every participant together and stops no individual abuser.
  assert.deepEqual(axes, ['ROUTE_GLOBAL', 'TELEGRAM_CHAT']);
});

await test(['K6'], 'a failure inside the webhook is acknowledged, not retried for ever', async () => {
  fresh();
  // Telegram reads a 500 as an undelivered update and sends it again, with
  // backoff, for hours — into the same failing dependency.
  db.on('rpc:bridge_v2_consume_link_for_chat', () => new Error('database refused the connection'));
  const response = await webhook.POST(telegramRequest(contactUpdate()));
  assert.equal(response.status, 200, 'a dependency outage became a Telegram retry storm');
  assert.deepEqual(await response.json(), { ok: true });
});

await test(['C5', 'C6'], 'every binding outcome answers 200 with its own message', async () => {
  const outcomes = {
    TAKEN: /already confirmed for another account/,
    COOLDOWN: /released recently/,
    NUMBER_CHANGED: /already confirmed a different number/,
    DUPLICATE: /already confirmed a participation in this event/,
    NOT_AWAITING: /already confirmed/,
    NO_ENTRY: /went wrong/,
  };
  for (const [outcome, expected] of Object.entries(outcomes)) {
    fresh();
    db.on('rpc:bridge_v2_consume_link_for_chat', () => ({
      data: [{ link_id: 'link-1', participant_id: 'participant-1', giveaway_id: '1' }],
      error: null,
    }));
    db.on('rpc:bridge_v2_bind_phone_and_verify', () => ({ data: outcome, error: null }));
    const response = await webhook.POST(telegramRequest(contactUpdate()));
    assert.equal(response.status, 200, `${outcome} did not answer 200`);
    assert.match(sentTexts().at(-1).text, expected, `${outcome} sent the wrong message`);
  }
});

await test(['G5'], 'a null binding outcome is treated as a refusal, never as a success', async () => {
  fresh();
  db.on('rpc:bridge_v2_consume_link_for_chat', () => ({
    data: [{ link_id: 'link-1', participant_id: 'participant-1', giveaway_id: '1' }],
    error: null,
  }));
  db.on('rpc:bridge_v2_bind_phone_and_verify', () => ({ data: null, error: null }));
  const response = await webhook.POST(telegramRequest(contactUpdate()));
  assert.equal(response.status, 200);
  assert.match(sentTexts().at(-1).text, /already confirmed a participation in this event/);
});

await test(['R2'], 'no message the webhook actually sends mentions crypto or a prize', async () => {
  fresh();
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_claim_link_for_chat', () => ({ data: [], error: null }));
  await webhook.POST(telegramRequest({ message: { chat: { id: 1 }, text: '/start bad code!' } }));
  await webhook.POST(
    telegramRequest({ message: { chat: { id: 1 }, text: '/start abcdefghijklmnop' } }),
  );
  assert.ok(sentTexts().length >= 2);
  for (const sent of sentTexts()) {
    const lowered = sent.text.toLowerCase();
    for (const word of ['usdc', 'arbitrum', 'wallet', 'token', 'prize', 'lottery', 'raffle']) {
      assert.ok(!lowered.includes(word), `the bot sent "${word}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// the two cron routes — G4, G6, H7, H8, J5, K8
// ---------------------------------------------------------------------------

const CRONS = [['cron/process', cronProcess], ['cron/maintenance', cronMaintenance]];
const authorised = (name) =>
  request(url(name), { headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } });

function maintenanceReady() {
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
  db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
  db.on('bridge_v2_ops_events:select', () => ({ data: [], error: null }));
  db.on('bridge_v2_entries:select', () => ({ data: [], error: null }));
}

await test(['K8'], 'a cron with no credential is refused', async () => {
  for (const [name, module] of CRONS) {
    fresh();
    const response = await module.POST(request(url(name)));
    assert.equal(response.status, 401, `${name} ran unauthenticated`);
  }
});

await test(['K8'], 'a cron with a wrong credential is refused', async () => {
  for (const [name, module] of CRONS) {
    fresh();
    const response = await module.POST(
      request(url(name), { headers: { authorization: `Bearer ${'0'.repeat(64)}` } }),
    );
    assert.equal(response.status, 401, `${name} accepted a wrong secret`);
  }
});

await test(['J5'], 'the cron secret is compared in constant time', () => {
  // A === returns at the first differing byte, and this route can be called as
  // often as anyone likes.
  for (const name of ['process', 'maintenance']) {
    const code = readFileSync(
      new URL(`../../../api/bridge/v2/cron/${name}.ts`, import.meta.url),
      'utf8',
    );
    assert.match(code, /timingSafeEqualHex\(request\.headers\.get\('authorization'\) \?\? ''/);
    assert.ok(!/=== `Bearer/.test(code), `${name} compares its secret with ===`);
  }
});

await test(['K8'], 'a cron checks its configuration before it checks the caller', async () => {
  // The bridge being unable to work is not a fact about the caller, and a run
  // that cannot read its own credential has to say so rather than answer 401.
  for (const [name, module] of CRONS) {
    fresh();
    const saved = process.env.BRIDGE_V2_FUNDER_KEYS;
    delete process.env.BRIDGE_V2_FUNDER_KEYS;
    try {
      const response = await module.POST(request(url(name)));
      assert.equal(response.status, 500, `${name} answered ${response.status} unconfigured`);
      assert.ok(!(await response.json()).error.includes('BRIDGE_V2'), 'a name reached the caller');
      const alerts = db
        .callsTo('bridge_v2_ops_events:insert')
        .filter((call) => call.payload.kind === 'alert');
      assert.ok(alerts.length > 0, `${name} failed quietly`);
      assert.match(alerts[0].payload.detail.missing, /BRIDGE_V2_FUNDER_KEYS/);
    } finally {
      process.env.BRIDGE_V2_FUNDER_KEYS = saved;
    }
  }
});

await test(['G6'], 'a run that finds the lock held does nothing and says so', async () => {
  for (const [name, module] of CRONS) {
    fresh();
    db.on('rpc:bridge_v2_try_lock', () => ({ data: null, error: null }));
    const response = await module.POST(authorised(name));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, skipped: 'run_in_progress' });
    assert.equal(chain.calls.length, 0, `${name} touched the chain without the lock`);
  }
});

await test(['G6'], 'the pipeline lock is released with the holder it was taken with', async () => {
  fresh();
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_next_run_sequence', () => ({ data: 0, error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  await cronProcess.POST(authorised('cron/process'));
  const release = db.callsTo('rpc:bridge_v2_release_lock')[0];
  assert.equal(release.args.p_name, 'cron/process');
  assert.equal(release.args.p_holder, 'holder-abc');
});

await test(['G4'], 'the pipeline runs every phase and reports which one led', async () => {
  fresh();
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_next_run_sequence', () => ({ data: 2, error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  const body = await (await cronProcess.POST(authorised('cron/process'))).json();
  assert.equal(body.firstPhase, 'publishRoots');
  for (const phase of [
    'reconcileSubmitted', 'reconcileFunding', 'publishRoots', 'processEntries', 'processPrizes',
  ]) {
    assert.ok(phase in body, `${phase} did not run`);
  }
});

await test(['G4'], 'the leading phase advances by one per run that actually happens', async () => {
  const leaders = [];
  for (let sequence = 0; sequence < 6; sequence += 1) {
    fresh();
    db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
    db.on('rpc:bridge_v2_next_run_sequence', () => ({ data: sequence, error: null }));
    db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
    const body = await (await cronProcess.POST(authorised('cron/process'))).json();
    leaders.push(body.firstPhase);
  }
  // Five phases, so each leads once within five consecutive runs.
  assert.equal(new Set(leaders.slice(0, 5)).size, 5, `only ${new Set(leaders).size} phases led`);
  assert.equal(leaders[5], leaders[0], 'the rotation does not come back round');
});

await test(['H8', 'K8'], 'maintenance reports a check that could not run as unknown', async () => {
  fresh();
  maintenanceReady();
  // The RPC is down for the checks the bridge cannot work without.
  chain.set({
    registeredBridge: new Error('rpc down'),
    isPaused: new Error('rpc down'),
    vrfSubscriptionLink: new Error('rpc down'),
  });
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  // "No answer" and "fine" are opposite things to an operator.
  assert.equal(body.bridgeRegistered, null);
  assert.equal(body.registeredBridge, null);
  assert.equal(body.contractPaused, null);
  assert.equal(body.vrfLink, null);
  assert.equal(body.ok, true);
});

await test(['H8'], 'one failing check does not stop the ones behind it', async () => {
  fresh();
  maintenanceReady();
  db.on('rpc:bridge_v2_cleanup', () => new Error('cleanup exploded'));
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  assert.equal(body.removed, null, 'the failed cleanup is reported as a number');
  // The checks after it still ran.
  assert.notEqual(body.bridgeRegistered, null);
  assert.notEqual(body.contractPaused, null);
});

await test(['H8'], 'a bridge address the contract no longer names raises an alert', async () => {
  fresh();
  maintenanceReady();
  chain.set({ registeredBridge: '0x9999999999999999999999999999999999999999' });
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  assert.equal(body.bridgeRegistered, false);
  assert.ok(
    alertsRaised().includes('contract no longer names this bridge'),
    `alerts were ${alertsRaised()}`,
  );
});

await test(['H8'], 'a paused contract and a low VRF balance are both alerted', async () => {
  fresh();
  maintenanceReady();
  chain.set({ isPaused: true, vrfSubscriptionLink: 1n });
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  assert.equal(body.contractPaused, true);
  const alerts = alertsRaised();
  assert.ok(alerts.includes('contract is paused'), `alerts were ${alerts}`);
  assert.ok(alerts.includes('vrf subscription link low'), `alerts were ${alerts}`);
});

await test(['H8'], 'a funder that cannot pay for one entry is counted and alerted', async () => {
  fresh();
  maintenanceReady();
  chain.set({ balanceOf: 1n });
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  assert.equal(body.lowFunders, 2, 'the two configured funders were not both counted');
  assert.ok(alertsRaised().includes('funder balance low'));
});

await test(['B8', 'H8'], 'a provider approaching its daily ceiling is alerted before it stops', async () => {
  fresh();
  maintenanceReady();
  db.on('bridge_v2_external_spend:select', () => ({
    data: [{ provider: 'email', units: 4500 }],
    error: null,
  }));
  await cronMaintenance.POST(authorised('cron/maintenance'));
  assert.ok(alertsRaised().includes('external spend approaching ceiling'));
});

await test(['K8'], 'a route erroring repeatedly in the last hour is alerted', async () => {
  fresh();
  maintenanceReady();
  db.on('bridge_v2_ops_events:select', () => ({
    data: Array.from({ length: 30 }, () => ({ route: 'session/verify' })),
    error: null,
  }));
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  assert.equal(body.routeErrors['session/verify'], 30);
  assert.ok(alertsRaised().includes('route error rate high'));
});

await test(['G6', 'H7'], 'the sweep borrows the pipeline lock and is skipped when it is held', async () => {
  fresh();
  const taken = [];
  db.on('rpc:bridge_v2_try_lock', (op) => {
    if (op.args.p_name === 'cron/process') return { data: null, error: null };
    taken.push(op.args.p_name);
    return { data: 'holder-abc', error: null };
  });
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
  db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
  db.on('bridge_v2_ops_events:select', () => ({ data: [], error: null }));
  const body = await (await cronMaintenance.POST(authorised('cron/maintenance'))).json();
  assert.deepEqual(taken, ['cron/maintenance']);
  assert.equal(body.sweepSkipped, true);
  assert.equal(db.callsTo('bridge_v2_entries:select').length, 0, 'the sweep ran anyway');
  // And the checks still ran: monitoring matters most when the pipeline is busy.
  assert.notEqual(body.contractPaused, null);
});
