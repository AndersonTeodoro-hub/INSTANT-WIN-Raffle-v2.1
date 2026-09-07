/**
 * The modules with no external dependency: crypto, validation, identity,
 * sessions, the Merkle tree, custody policy, the bot vocabulary, and the
 * invariants config.ts checks at import time.
 */

import { assert, http, jsonResponse, suite, test, TEST_MNEMONIC } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import { planGas } from '../doubles/chain.mjs';

import * as crypto2 from '../../../lib/bridge-v2/crypto.ts';
import * as validate from '../../../lib/bridge-v2/validate.ts';
import * as identity from '../../../lib/bridge-v2/identity.ts';
import * as merkle from '../../../lib/bridge-v2/merkle.ts';
import * as wallet from '../../../lib/bridge-v2/wallet.ts';
import * as session from '../../../lib/bridge-v2/session.ts';
import * as custody from '../../../lib/bridge-v2/custody.ts';
import * as config from '../../../lib/bridge-v2/config.ts';
import * as envelope from '../../../lib/bridge-v2/http.ts';
import * as env from '../../../lib/bridge-v2/env.ts';
import * as signals from '../../../lib/bridge-v2/signals.ts';
import * as abi from '../../../lib/bridge-v2/abi.ts';
import { BOT_MESSAGES } from '../../../lib/bridge-v2/telegram.ts';
import { encodeErrorResult, encodePacked, keccak256, toBytes, toHex } from 'viem';

suite('pure');

const addressAt = (n) => `0x${n.toString(16).padStart(40, '0')}`;

// ---------------------------------------------------------------------------
// J1, F1, A2 — randomness and key separation
// ---------------------------------------------------------------------------

await test(['J1'], 'randomDigits always yields exactly the configured width', () => {
  for (let i = 0; i < 2000; i += 1) {
    assert.match(crypto2.randomDigits(config.EMAIL_CODE_DIGITS), /^[0-9]{6}$/);
  }
});

await test(['J1'], 'randomDigits covers its range rather than a corner of it', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) seen.add(crypto2.randomDigits(6));
  assert.ok(seen.size > 4000, `only ${seen.size} distinct in 5000 draws`);
});

await test(['J1'], 'randomIndex rejects the biased tail instead of taking a remainder', () => {
  // 2^32 is not a multiple of 10^6, so a draw at or above
  // floor(2^32 / 10^6) * 10^6 must be taken again rather than folded down.
  // Feeding one of those first is what proves the loop runs.
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const queue = [4_294_967_295, 7];
  let draws = 0;
  globalThis.crypto.getRandomValues = (buffer) => {
    if (buffer instanceof Uint32Array) {
      buffer[0] = queue[Math.min(draws, queue.length - 1)];
      draws += 1;
      return buffer;
    }
    return real(buffer);
  };
  try {
    assert.equal(crypto2.randomIndex(1_000_000), 7);
    assert.equal(draws, 2, 'the biased draw was used instead of being rejected');
  } finally {
    globalThis.crypto.getRandomValues = real;
  }
});

await test(['J1'], 'randomIndex refuses a bound it cannot serve uniformly', () => {
  for (const bound of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN]) {
    assert.throws(() => crypto2.randomIndex(bound), /supported range/);
  }
});

await test(['F1'], 'one message under three roots gives three unrelated hashes', async () => {
  const a = await crypto2.keyedHash('BRIDGE_V2_CODE_HMAC_KEY', 'label', 'message');
  const b = await crypto2.keyedHash('BRIDGE_V2_PHONE_HMAC_KEY', 'label', 'message');
  const c = await crypto2.keyedHash('BRIDGE_V2_SESSION_HMAC_KEY', 'label', 'message');
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

await test(['F1'], 'one root with two labels gives two unrelated hashes', async () => {
  const a = await crypto2.keyedHash('BRIDGE_V2_PHONE_HMAC_KEY', 'phone-identity-v1', 'x');
  const b = await crypto2.keyedHash('BRIDGE_V2_PHONE_HMAC_KEY', 'telegram-user-v1', 'x');
  assert.notEqual(a, b);
});

await test(['F1', 'F2'], 'a keyed hash never contains the configured secret', async () => {
  const secret = process.env.BRIDGE_V2_CODE_HMAC_KEY;
  const digest = await crypto2.keyedHash('BRIDGE_V2_CODE_HMAC_KEY', 'label', 'message');
  assert.ok(!digest.includes(secret));
  assert.equal(digest.length, 64);
});

await test(['J5'], 'the hex compare walks the string and refuses a length mismatch', () => {
  assert.ok(crypto2.timingSafeEqualHex('abcd', 'abcd'));
  assert.ok(!crypto2.timingSafeEqualHex('abcd', 'abce'));
  assert.ok(!crypto2.timingSafeEqualHex('abcd', 'abc'));
  assert.ok(!crypto2.timingSafeEqualHex('', 'a'));
  assert.ok(crypto2.timingSafeEqualHex('', ''));
});

await test(['A2'], 'base64url output carries no padding and no URL-unsafe character', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(
      crypto2.toBase64Url(crypto2.randomBytes(config.SESSION_TOKEN_BYTES)),
      /^[A-Za-z0-9_-]+$/,
    );
  }
});

await test(['A2'], 'a session token carries 256 bits of entropy', () => {
  assert.equal(config.SESSION_TOKEN_BYTES, 32);
  const tokens = new Set();
  for (let i = 0; i < 1000; i += 1) {
    tokens.add(crypto2.toBase64Url(crypto2.randomBytes(config.SESSION_TOKEN_BYTES)));
  }
  assert.equal(tokens.size, 1000, 'a repeat in 1000 draws is not 256 bits');
});

// ---------------------------------------------------------------------------
// I1, I2, I3 — validation
// ---------------------------------------------------------------------------

await test(['I2'], 'a giveaway id is checked against uint256, not against a digit count', () => {
  assert.equal(validate.parseGiveawayId('1'), 1n);
  assert.equal(validate.parseGiveawayId(1), 1n);
  assert.equal(validate.parseGiveawayId(validate.UINT256_MAX.toString()), validate.UINT256_MAX);
  // Finding F4 of the V1: 78 digits passed the count and overflowed downstream.
  assert.equal(validate.parseGiveawayId((validate.UINT256_MAX + 1n).toString()), null);
  assert.equal(validate.parseGiveawayId('9'.repeat(78)), null);
  assert.equal(validate.parseGiveawayId('0'), null);
  assert.equal(validate.parseGiveawayId(-1), null);
  assert.equal(validate.parseGiveawayId('1e10'), null);
  assert.equal(validate.parseGiveawayId(1.5), null);
  assert.equal(validate.parseGiveawayId(null), null);
  assert.equal(validate.parseGiveawayId({}), null);
});

await test(['I1'], 'the code parser accepts only the configured width of digits', () => {
  assert.equal(validate.parseCode('123456', 6), '123456');
  assert.equal(validate.parseCode('dddddd', 6), null, 'the escaped-d regression is back');
  assert.equal(validate.parseCode('12345', 6), null);
  assert.equal(validate.parseCode('1234567', 6), null);
  assert.equal(validate.parseCode('12345٦', 6), null, 'a non-ASCII digit was accepted');
  assert.equal(validate.parseCode(123456, 6), null);
});

await test(['I1'], 'the email parser refuses what is not an address', () => {
  assert.equal(validate.parseEmail('a@b.pt'), 'a@b.pt');
  assert.equal(validate.parseEmail('  a@b.pt  '), 'a@b.pt');
  assert.equal(validate.parseEmail('a@b'), null);
  assert.equal(validate.parseEmail('a b@c.pt'), null);
  assert.equal(validate.parseEmail('@b.pt'), null);
  assert.equal(validate.parseEmail(`${'a'.repeat(250)}@b.pt`), null);
  assert.equal(validate.parseEmail(42), null);
});

await test(['I1', 'H2'], 'the address parser normalises case and refuses anything else', () => {
  assert.equal(validate.parseAddress(`0x${'A'.repeat(40)}`), `0x${'a'.repeat(40)}`);
  assert.equal(validate.parseAddress(`0x${'a'.repeat(39)}`), null);
  assert.equal(validate.parseAddress(`0x${'g'.repeat(40)}`), null);
  assert.equal(validate.parseAddress('a'.repeat(40)), null);
});

await test(['C5', 'I1'], 'a phone is normalised so one number cannot hash twice', () => {
  assert.equal(validate.parsePhone('+351911111111'), '351911111111');
  assert.equal(validate.parsePhone('351911111111'), '351911111111');
  assert.equal(validate.parsePhone('12345'), null);
  assert.equal(validate.parsePhone('+1 202 555 0000'), null);
  assert.equal(validate.parsePhone('++351911111111'), null);
});

await test(['I1'], 'a Telegram id is accepted in both wire shapes and nothing else', () => {
  assert.equal(validate.parseTelegramId(12345), '12345');
  assert.equal(validate.parseTelegramId('-100123'), '-100123');
  assert.equal(validate.parseTelegramId(1.5), null);
  assert.equal(validate.parseTelegramId('12a'), null);
});

await test(['I1'], 'a link code is accepted only in the shape the bridge issues', () => {
  assert.equal(validate.parseLinkCode('abcdefghijklmnop'), 'abcdefghijklmnop');
  assert.equal(validate.parseLinkCode('short'), null);
  assert.equal(validate.parseLinkCode('has spaces here!'), null);
  assert.equal(validate.parseLinkCode('a'.repeat(65)), null);
});

await test(['I3'], 'a body is refused on its content type before it is parsed', async () => {
  const wrongType = new Request('https://x.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(await envelope.readJsonBody(wrongType), null);
});

await test(['I3'], 'a body is refused on its real size, not on what it declares', async () => {
  const oversize = new Request('https://x.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '10' },
    body: JSON.stringify({ pad: 'x'.repeat(config.MAX_BODY_BYTES + 100) }),
  });
  assert.equal(await envelope.readJsonBody(oversize), null, 'a lying content-length got through');
});

await test(['I3', 'I1'], 'a JSON body that is not an object is refused', async () => {
  for (const body of ['[]', '"x"', '5', 'null', 'not json']) {
    const request = new Request('https://x.invalid/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(await envelope.readJsonBody(request), null, `accepted ${body}`);
  }
});

// ---------------------------------------------------------------------------
// C1, C2 — identity
// ---------------------------------------------------------------------------

await test(['C1'], 'sub-addressing and Gmail dots collapse to one account key', () => {
  const canonical = identity.canonicalizeEmail('Target@gmail.com');
  // Finding #6: alias +N used to buy a second participant for a plus sign.
  assert.equal(identity.canonicalizeEmail('target+1@gmail.com'), canonical);
  assert.equal(identity.canonicalizeEmail('target+anything@gmail.com'), canonical);
  assert.equal(identity.canonicalizeEmail('t.a.r.g.e.t@gmail.com'), canonical);
  assert.equal(identity.canonicalizeEmail('target@googlemail.com'), canonical);
  assert.equal(identity.canonicalizeEmail('  TARGET@GMAIL.COM '), canonical);
});

await test(['C1'], 'dots are left alone where the provider says they matter', () => {
  assert.equal(identity.canonicalizeEmail('a.b@example.com'), 'a.b@example.com');
  assert.notEqual(
    identity.canonicalizeEmail('a.b@example.com'),
    identity.canonicalizeEmail('ab@example.com'),
  );
});

await test(['C1'], 'sub-addressing is stripped at every provider, which is the account rule', () => {
  assert.equal(identity.canonicalizeEmail('a+tag@example.com'), 'a@example.com');
  // A leading plus is the whole local part, not sub-addressing.
  assert.equal(identity.canonicalizeEmail('+tag@example.com'), '+tag@example.com');
});

await test(['C2', 'C8'], 'a domain on the blocklist is refused before anything is issued', async () => {
  db.reset();
  db.on('bridge_v2_disposable_domains:select', () => ({
    data: [{ domain: 'burner.invalid' }],
    error: null,
  }));
  assert.equal(await identity.screenEmail('a@burner.invalid'), 'DISPOSABLE');
});

await test(['C2'], 'a domain with no MX record is refused', async () => {
  db.reset();
  http.reset();
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  http.on('cloudflare-dns.com', () => jsonResponse({ Status: 0, Answer: [] }));
  assert.equal(await identity.screenEmail('a@no-mx.invalid'), 'NO_MX');
});

await test(['C2'], 'a domain that resolves is accepted', async () => {
  db.reset();
  http.reset();
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  http.on('cloudflare-dns.com', () =>
    jsonResponse({ Status: 0, Answer: [{ data: '10 mx.invalid.' }] }));
  assert.equal(await identity.screenEmail('a@example.com'), 'OK');
});

await test(['C2', 'G4'], 'a resolver outage does not become a registration outage', async () => {
  db.reset();
  http.reset();
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  http.on('cloudflare-dns.com', () => new Error('resolver down'));
  // T7: a third party must not hold an off switch for the platform.
  assert.equal(await identity.screenEmail('a@example.com'), 'OK');
});

await test(['G4'], 'the MX lookup and the blocklist read are both bounded', async () => {
  db.reset();
  http.reset();
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  http.on('cloudflare-dns.com', () => jsonResponse({ Status: 0, Answer: [{}] }));
  await identity.screenEmail('a@example.com');
  const dns = http.requests.find((entry) => entry.url.includes('cloudflare-dns.com'));
  assert.ok(dns?.init?.signal instanceof AbortSignal, 'the DNS call is unbounded');
  assert.ok(
    db.callsTo('bridge_v2_disposable_domains:select')[0].abortSignal instanceof AbortSignal,
  );
});

// ---------------------------------------------------------------------------
// A2 to A5 — sessions
// ---------------------------------------------------------------------------

await test(['A3'], 'the session cookie carries every flag the requirement names', () => {
  const cookie = session.sessionCookie('token-value');
  assert.match(cookie, /^iw_bridge_session=token-value;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api/);
  assert.match(cookie, new RegExp(`Max-Age=${Math.floor(config.SESSION_ABSOLUTE_MS / 1000)}`));
});

await test(['A5'], 'the clearing cookie expires immediately and keeps its flags', () => {
  const cleared = session.clearedCookie();
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Secure/);
});

await test(['A2'], 'only a hash of the token reaches the database', async () => {
  db.reset();
  let stored;
  db.on('bridge_v2_sessions:insert', (op) => {
    stored = op.payload;
    return { data: null, error: null };
  });
  const token = await session.createSession('participant-1', {
    ipHash: 'ip',
    subnetHash: 'subnet',
    clientHash: 'client',
  });
  assert.ok(token.length >= 43, 'the token is shorter than 256 bits of base64url');
  assert.notEqual(stored.token_hash, token);
  assert.equal(stored.token_hash.length, 64);
  assert.ok(!JSON.stringify(stored).includes(token), 'the token itself was persisted');
});

await test(['A4'], 'both clocks are written and the absolute one is the longer', async () => {
  db.reset();
  let stored;
  db.on('bridge_v2_sessions:insert', (op) => {
    stored = op.payload;
    return { data: null, error: null };
  });
  await session.createSession('participant-1', { ipHash: 'i', subnetHash: 's', clientHash: 'c' });
  const idle = new Date(stored.idle_expires_at).getTime();
  const absolute = new Date(stored.absolute_expires_at).getTime();
  assert.ok(absolute > idle);
  assert.ok(
    Math.abs(absolute - idle - (config.SESSION_ABSOLUTE_MS - config.SESSION_IDLE_MS)) < 2000,
  );
});

await test(['A1', 'A4'], 'a session past either clock, or revoked, resolves to nobody', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const cases = [
    ['idle expired', { idle_expires_at: past, absolute_expires_at: future, revoked_at: null }],
    ['absolute expired', { idle_expires_at: future, absolute_expires_at: past, revoked_at: null }],
    ['revoked', { idle_expires_at: future, absolute_expires_at: future, revoked_at: past }],
  ];
  for (const [label, row] of cases) {
    db.reset();
    db.on('bridge_v2_sessions:select', () => ({
      data: { id: 's', participant_id: 'p', ...row },
      error: null,
    }));
    const resolved = await session.resolveSession(
      new Request('https://x.invalid/', { headers: { cookie: 'iw_bridge_session=abc' } }),
    );
    assert.equal(resolved, null, `a ${label} session resolved`);
  }
});

await test(['A4'], 'a live session slides its idle clock and never its absolute one', async () => {
  db.reset();
  db.on('bridge_v2_sessions:select', () => ({
    data: {
      id: 'session-1',
      participant_id: 'participant-1',
      idle_expires_at: new Date(Date.now() + 60_000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    },
    error: null,
  }));
  const resolved = await session.resolveSession(
    new Request('https://x.invalid/', { headers: { cookie: 'iw_bridge_session=abc' } }),
  );
  assert.deepEqual(resolved, { id: 'session-1', participantId: 'participant-1' });
  const slide = db.callsTo('bridge_v2_sessions:update')[0];
  assert.ok(slide, 'the idle clock did not slide');
  assert.ok('idle_expires_at' in slide.payload);
  assert.ok(!('absolute_expires_at' in slide.payload), 'the absolute clock was extended');
});

await test(['A1', 'A6'], 'no cookie is no session, whatever else the request carries', async () => {
  db.reset();
  for (const headers of [{}, { cookie: 'other=1' }, { cookie: 'iw_bridge_session=' }]) {
    assert.equal(await session.resolveSession(new Request('https://x.invalid/', { headers })), null);
  }
  assert.equal(db.calls.length, 0, 'a request with no token still hit the database');
});

await test(['A5'], 'revocation covers every live session of the participant at once', async () => {
  db.reset();
  let op;
  db.on('bridge_v2_sessions:update', (call) => {
    op = call;
    return { data: [{ id: 'a' }, { id: 'b' }], error: null };
  });
  assert.equal(await session.revokeAllSessions('participant-1'), 2);
  assert.deepEqual(op.filters, [
    ['eq', 'participant_id', 'participant-1'],
    ['is', 'revoked_at', null],
  ]);
});

// ---------------------------------------------------------------------------
// E2, E3 and owner decision D1 — custody policy
// ---------------------------------------------------------------------------

const OTHER_TOKEN = '0x1111111111111111111111111111111111111111';

await test(['E2'], 'a USDC share below the threshold may rest in the derived wallet', () => {
  assert.deepEqual(custody.policyFor(abi.PrizeKind.TOKEN, 99n * 10n ** 6n, config.USDC), {
    prizeKind: 'TOKEN',
    requiresOwnWallet: false,
  });
});

await test(['E2'], 'a USDC share at or above the threshold requires the winner own wallet', () => {
  assert.equal(
    custody.policyFor(abi.PrizeKind.TOKEN, 100n * 10n ** 6n, config.USDC).requiresOwnWallet,
    true,
  );
  assert.equal(
    custody.policyFor(abi.PrizeKind.TOKEN, 10n ** 12n, config.USDC).requiresOwnWallet,
    true,
  );
});

await test(['E2'], 'an NFT requires the winner own wallet at any value, with no exception', () => {
  for (const amount of [0n, 1n, 10n ** 30n]) {
    assert.deepEqual(custody.policyFor(abi.PrizeKind.NFT, amount, config.USDC), {
      prizeKind: 'NFT',
      requiresOwnWallet: true,
    });
  }
});

await test(['E2', 'OWNER-D1'], 'any token that is not USDC requires the winner own wallet', () => {
  // The threshold is a hundred USDC in USDC base units, so comparing it against
  // an amount of a token the creator chose is meaningless: an unbounded prize
  // in an eighteen-decimal token used to clear it at a ten-millionth of one.
  assert.equal(custody.policyFor(abi.PrizeKind.TOKEN, 1n, OTHER_TOKEN).requiresOwnWallet, true);
  assert.equal(
    custody.policyFor(abi.PrizeKind.TOKEN, 10n ** 30n, OTHER_TOKEN).requiresOwnWallet,
    true,
  );
});

await test(['OWNER-D1'], 'the USDC comparison does not depend on the case of the address', () => {
  assert.equal(
    custody.policyFor(abi.PrizeKind.TOKEN, 1n, config.USDC.toLowerCase()).requiresOwnWallet,
    false,
  );
  assert.equal(
    custody.policyFor(abi.PrizeKind.TOKEN, 1n, `0x${config.USDC.slice(2).toUpperCase()}`)
      .requiresOwnWallet,
    false,
  );
});

await test(['E2'], 'the largest winner share is the one that carries the remainder', () => {
  // The contract pays prizeAmount / winnersCount and gives the indivisible
  // remainder to the first winner, so nobody is owed more than this.
  assert.equal(custody.largestWinnerShare(10n, 3), 4n);
  assert.equal(custody.largestWinnerShare(9n, 3), 3n);
  assert.equal(custody.largestWinnerShare(100n, 1), 100n);
  assert.equal(custody.largestWinnerShare(100n, 0), 100n, 'a zero winner count divided by zero');
});

await test(['E3'], 'custody expiry is measured from the moment it begins', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(
    custody.custodyExpiryFrom(start).getTime() - start.getTime(),
    config.CUSTODY_TEMPORARY_DAYS * 24 * 60 * 60 * 1000,
  );
  assert.equal(config.CUSTODY_TEMPORARY_DAYS, 30);
});

// ---------------------------------------------------------------------------
// C8 — the eligibility tree against the contract's own construction
// ---------------------------------------------------------------------------

/**
 * An independent implementation of OpenZeppelin's commutative fold, over bytes
 * rather than hex strings, so agreement with merkle.ts is agreement about the
 * construction and not two calls into the same code.
 */
function independentVerify(root, address, proof) {
  let node = toBytes(keccak256(encodePacked(['address'], [address])));
  for (const sibling of proof) {
    const other = toBytes(sibling);
    let left = node;
    let right = other;
    for (let i = 0; i < 32; i += 1) {
      if (node[i] !== other[i]) {
        if (node[i] > other[i]) {
          left = other;
          right = node;
        }
        break;
      }
    }
    node = toBytes(keccak256(new Uint8Array([...left, ...right])));
  }
  return toHex(node).toLowerCase() === root.toLowerCase();
}

await test(['C8'], 'the leaf is one keccak of the packed address, as the contract computes it', () => {
  const address = addressAt(0xabc);
  assert.equal(merkle.leafOf(address), keccak256(encodePacked(['address'], [address])));
});

await test(['C8'], 'every proof verifies under an independent commutative fold', () => {
  for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 16, 17, 33]) {
    const addresses = Array.from({ length: size }, (unused, i) => addressAt(i + 1));
    const tree = merkle.buildTree(addresses);
    tree.addresses.forEach((address, position) => {
      assert.ok(
        independentVerify(tree.root, address, merkle.proofFor(tree, position)),
        `size ${size} position ${position} does not verify`,
      );
    });
  }
});

await test(['C8'], 'an address outside the tree cannot be proved into it', () => {
  const tree = merkle.buildTree([addressAt(1), addressAt(2), addressAt(3)]);
  const proof = merkle.proofFor(tree, 0);
  assert.ok(!merkle.verifyProof(tree.root, addressAt(99), proof));
  assert.ok(!independentVerify(tree.root, addressAt(99), proof));
});

await test(['C8'], 'an odd node is carried up rather than paired with itself', () => {
  const tree = merkle.buildTree([addressAt(1), addressAt(2), addressAt(3)]);
  assert.equal(tree.layers[1].length, 2);
  assert.equal(tree.layers[1][1], tree.layers[0][2], 'the odd leaf was not carried unchanged');
});

await test(['C8'], 'the tree is deterministic for a set, whatever order it arrives in', () => {
  const addresses = [addressAt(3), addressAt(1), addressAt(2)];
  const a = merkle.buildTree(addresses);
  const b = merkle.buildTree([...addresses].reverse());
  const c = merkle.buildTree([...addresses, `0x${addressAt(1).slice(2).toUpperCase()}`]);
  assert.equal(a.root, b.root);
  assert.equal(a.root, c.root, 'a duplicate in a different case changed the root');
});

await test(['C8'], 'an empty batch is refused rather than producing a root of nothing', () => {
  assert.throws(() => merkle.buildTree([]), /no addresses/);
});

await test(['C8'], 'a proof outside the tree is refused rather than returned empty', () => {
  const tree = merkle.buildTree([addressAt(1), addressAt(2)]);
  assert.throws(() => merkle.proofFor(tree, 2), /outside the tree/);
  assert.throws(() => merkle.proofFor(tree, -1), /outside the tree/);
});

// ---------------------------------------------------------------------------
// E1, F6, I9 — the derived wallet as a signing vehicle
// ---------------------------------------------------------------------------

await test(['F6', 'E1'], 'nothing that holds a key crosses the wallet boundary', () => {
  assert.deepEqual(Object.keys(wallet).sort(), ['addressOf', 'signAsDerived']);
  const address = wallet.addressOf(0);
  assert.equal(typeof address, 'string');
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
});

await test(['F6'], 'derivation matches the canonical BIP-44 addresses for the test mnemonic', () => {
  assert.equal(process.env.BRIDGE_V2_WALLET_SEED, TEST_MNEMONIC);
  assert.equal(wallet.addressOf(0), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.equal(wallet.addressOf(1), '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  assert.equal(wallet.addressOf(2), '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
});

await test(['I9'], 'a derivation index that is not a whole non-negative number is refused', () => {
  for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => wallet.addressOf(index), /non-negative integer/);
  }
});

await test(['F6'], 'signing returns bytes, and a different index returns different bytes', async () => {
  const transaction = {
    chainId: config.CHAIN_ID,
    type: 'eip1559',
    to: addressAt(9),
    nonce: 0,
    gas: 21_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 0n,
    value: 1n,
  };
  const signed = await wallet.signAsDerived(0, transaction);
  assert.match(signed, /^0x[0-9a-f]+$/);
  assert.equal(await wallet.signAsDerived(0, transaction), signed);
  assert.notEqual(await wallet.signAsDerived(1, transaction), signed);
});

// ---------------------------------------------------------------------------
// C7, B2, K4 — correlation signals
// ---------------------------------------------------------------------------

const signalsFor = (headers) => signals.extractSignals(new Request('https://x.invalid/', { headers }));

await test(['C7', 'K4'], 'no signal leaves the module in clear', async () => {
  const extracted = await signalsFor({
    'x-forwarded-for': '203.0.113.9, 10.0.0.1',
    'user-agent': 'Mozilla/5.0 test',
    'accept-language': 'pt-PT',
  });
  for (const value of Object.values(extracted)) {
    assert.match(value, /^[0-9a-f]{64}$/);
    assert.ok(!value.includes('203.0.113'));
  }
});

await test(['B2', 'C7'], 'rotating the last octet does not produce a new subnet key', async () => {
  const a = await signalsFor({ 'x-forwarded-for': '203.0.113.9' });
  const b = await signalsFor({ 'x-forwarded-for': '203.0.113.250' });
  const c = await signalsFor({ 'x-forwarded-for': '203.0.114.9' });
  assert.notEqual(a.ipHash, b.ipHash, 'two addresses produced one ip key');
  assert.equal(a.subnetHash, b.subnetHash, 'a /24 rotation escaped the subnet axis');
  assert.notEqual(a.subnetHash, c.subnetHash);
});

await test(['B2'], 'the leftmost forwarded address is the client, not the proxy', async () => {
  const viaProxy = await signalsFor({ 'x-forwarded-for': '203.0.113.9, 198.51.100.1' });
  const direct = await signalsFor({ 'x-forwarded-for': '203.0.113.9' });
  assert.equal(viaProxy.ipHash, direct.ipHash);
});

await test(['C7'], 'an IPv6 client is reduced to the block a provider allocates', async () => {
  const a = await signalsFor({ 'x-forwarded-for': '2001:db8:1234:5678::1' });
  const b = await signalsFor({ 'x-forwarded-for': '2001:db8:1234:9999::1' });
  const c = await signalsFor({ 'x-forwarded-for': '2001:db8:9999:5678::1' });
  assert.equal(a.subnetHash, b.subnetHash, 'a /48 rotation escaped the subnet axis');
  assert.notEqual(a.subnetHash, c.subnetHash);
});

// ---------------------------------------------------------------------------
// F1, F3, K8 — configuration
// ---------------------------------------------------------------------------

/** node:assert throws() returns nothing, and these tests need the error itself. */
function caught(body) {
  try {
    body();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw and got none');
}

await test(['F3'], 'a missing variable is reported by name and never by value or length', () => {
  const saved = process.env.BRIDGE_V2_CODE_HMAC_KEY;
  try {
    process.env.BRIDGE_V2_CODE_HMAC_KEY = '';
    const error = caught(() => env.requireEnv('BRIDGE_V2_CODE_HMAC_KEY'));
    assert.ok(error instanceof env.MissingEnvError);
    assert.deepEqual(error.names, ['BRIDGE_V2_CODE_HMAC_KEY']);
    assert.ok(error.message.includes('BRIDGE_V2_CODE_HMAC_KEY'));
    assert.ok(!error.message.includes(saved));
    assert.ok(!error.message.includes(String(saved.length)));
  } finally {
    process.env.BRIDGE_V2_CODE_HMAC_KEY = saved;
  }
});

await test(['K8', 'F3'], 'assertEnv reports every missing name at once', () => {
  const saved = { RESEND_API_KEY: process.env.RESEND_API_KEY, CRON_SECRET: process.env.CRON_SECRET };
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.CRON_SECRET;
    const error = caught(() => env.assertEnv());
    assert.deepEqual([...error.names].sort(), ['CRON_SECRET', 'RESEND_API_KEY']);
  } finally {
    Object.assign(process.env, saved);
  }
});

await test(['K8'], 'the cron secret is required configuration, not an optional one', () => {
  assert.ok(env.REQUIRED_ENV.includes('CRON_SECRET'));
  assert.ok(!env.OPTIONAL_ENV.includes('CRON_SECRET'));
});

await test(['F1'], 'the roots are separate variables, one per function', () => {
  const roots = env.REQUIRED_ENV.filter((name) => /SEED|HMAC_KEY|FUNDER_KEYS|ROLE_KEY/.test(name));
  assert.deepEqual([...roots].sort(), [
    'BRIDGE_V2_CODE_HMAC_KEY',
    'BRIDGE_V2_FUNDER_KEYS',
    'BRIDGE_V2_PHONE_HMAC_KEY',
    'BRIDGE_V2_ROLE_KEY',
    'BRIDGE_V2_SESSION_HMAC_KEY',
    'BRIDGE_V2_SIGNAL_HMAC_KEY',
    'BRIDGE_V2_WALLET_SEED',
  ]);
});

// ---------------------------------------------------------------------------
// R2, R3 — what the bot is allowed to say
// ---------------------------------------------------------------------------

const GAMBLING_WORDS = ['lottery', 'raffle', 'lotaria', 'sorteio', 'gambling', 'aposta', 'jackpot'];
const CRYPTO_WORDS = [
  'usdc', 'arbitrum', 'wallet', 'token', 'crypto', 'blockchain', 'ethereum', 'prize', 'nft',
  'airdrop', 'coin',
];

await test(['R3'], 'no message the bot can send contains a gambling word', () => {
  for (const [name, text] of Object.entries(BOT_MESSAGES)) {
    for (const word of GAMBLING_WORDS) {
      assert.ok(!text.toLowerCase().includes(word), `${name} contains "${word}"`);
    }
  }
});

await test(['R2'], 'no message the bot can send names crypto, a prize, an amount or a link', () => {
  for (const [name, text] of Object.entries(BOT_MESSAGES)) {
    const lowered = text.toLowerCase();
    for (const word of CRYPTO_WORDS) {
      assert.ok(!lowered.includes(word), `${name} contains "${word}"`);
    }
    assert.ok(!/https?:\/\//.test(lowered), `${name} carries a link`);
    assert.ok(!/0x[0-9a-f]{6,}/.test(lowered), `${name} carries an address`);
  }
});

// ---------------------------------------------------------------------------
// D1, D2, D3, D5, K6 — the request envelope
// ---------------------------------------------------------------------------

await test(['D5', 'K6'], 'a throw anywhere in a route becomes one generic sentence', async () => {
  const route = envelope.handle('test/route', async () => {
    throw new Error('a driver message that mentions alice@example.com');
  });
  const response = await route(new Request('https://x.invalid/', { method: 'POST' }));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, 'Something went wrong. Please try again.');
  assert.ok(!JSON.stringify(body).includes('alice@example.com'));
});

await test(['D5', 'F3'], 'a configuration failure reaches the client as the same sentence', async () => {
  const route = envelope.handle('test/route', async () => {
    throw new env.MissingEnvError(['BRIDGE_V2_CODE_HMAC_KEY']);
  });
  const response = await route(new Request('https://x.invalid/', { method: 'POST' }));
  assert.equal(response.status, 500);
  assert.ok(
    !(await response.json()).error.includes('BRIDGE_V2'),
    'a variable name reached the client',
  );
});

await test(['D2'], 'the indistinguishable answer has one shape and one status', async () => {
  const response = envelope.accepted();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: 'accepted' });
});

await test(['D3'], 'a route with uniform timing holds its error path to the same floor', async () => {
  const timed = async (route) => {
    const started = Date.now();
    await route(new Request('https://x.invalid/', { method: 'POST' }));
    return Date.now() - started;
  };
  const okMs = await timed(envelope.handle('r', async () => envelope.ok(), { uniformTiming: true }));
  const errorMs = await timed(
    envelope.handle('r', async () => {
      throw new Error('x');
    }, { uniformTiming: true }),
  );
  assert.ok(okMs >= config.UNIFORM_RESPONSE_MS - 25, `success path returned in ${okMs}ms`);
  assert.ok(errorMs >= config.UNIFORM_RESPONSE_MS - 25, `error path returned in ${errorMs}ms`);
});

await test(['I1'], 'a route answers 405 to a method it does not implement', () => {
  assert.equal(
    envelope.methodGuard(new Request('https://x.invalid/', { method: 'GET' }), 'POST')?.status,
    405,
  );
  assert.equal(
    envelope.methodGuard(new Request('https://x.invalid/', { method: 'POST' }), 'POST'),
    null,
  );
});

await test(['D1'], 'every response is marked no-store', () => {
  for (const response of [envelope.ok(), envelope.accepted(), envelope.refuse(400, 'x')]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

// ---------------------------------------------------------------------------
// G4 and section 7 — the invariants config.ts checks at import time
// ---------------------------------------------------------------------------

await test(['G4'], 'every unit of work fits inside one run budget', () => {
  const units = { ...config.PHASE_RESERVATION_MS, sweep: config.SWEEP_WORST_CASE_MS };
  for (const [unit, reservation] of Object.entries(units)) {
    assert.ok(
      reservation < config.RUN_BUDGET_MS,
      `${unit} reserves ${reservation}ms of a ${config.RUN_BUDGET_MS}ms budget`,
    );
  }
  assert.equal(config.LARGEST_UNIT_MS, config.PHASE_RESERVATION_MS.processPrizes);
});

await test(['G4'], 'the run budget leaves room for the slowest unit inside maxDuration', () => {
  assert.equal(config.RUN_BUDGET_MS, (config.CRON_MAX_DURATION_SECONDS - 20) * 1000);
  assert.ok(config.RUN_BUDGET_MS < config.CRON_MAX_DURATION_SECONDS * 1000);
  assert.equal(config.RUN_LOCK_SECONDS, config.CRON_MAX_DURATION_SECONDS + 1);
});

await test(['G4'], 'the prize reservation is derived from the entry one and still fits', () => {
  assert.equal(config.ENTRY_WORST_CASE_MS, 2 * config.RECEIPT_TIMEOUT_MS + 4 * config.RPC_TIMEOUT_MS);
  assert.equal(config.PRIZE_WORST_CASE_MS, 2 * config.ENTRY_WORST_CASE_MS + 4 * config.RPC_TIMEOUT_MS);
  assert.ok(config.PRIZE_WORST_CASE_MS < config.RUN_BUDGET_MS);
});

await test(['G4'], 'every phase has a reservation and every reservation has a phase', () => {
  assert.deepEqual(
    [...config.PIPELINE_PHASES].sort(),
    Object.keys(config.PHASE_RESERVATION_MS).sort(),
  );
  assert.equal(config.PHASE_STARVATION_BOUND_RUNS, config.PIPELINE_PHASES.length);
});

await test(['G4'], 'a route duration this code derives is the duration vercel.json declares', async () => {
  const vercel = (await import('../../../vercel.json', { with: { type: 'json' } })).default;
  for (const [route, seconds] of Object.entries(config.ROUTE_MAX_DURATION_SECONDS)) {
    assert.equal(vercel.functions[route]?.maxDuration, seconds, `${route} disagrees with vercel.json`);
    assert.ok(seconds <= config.CRON_MAX_DURATION_SECONDS);
  }
  for (const route of Object.keys(vercel.functions)) {
    assert.ok(route in config.ROUTE_MAX_DURATION_SECONDS, `${route} has an underived duration`);
  }
});

await test(['G4', 'K8'], 'both scheduled paths are routes with a declared duration', async () => {
  const vercel = (await import('../../../vercel.json', { with: { type: 'json' } })).default;
  for (const cron of vercel.crons) {
    const path = `${cron.path.replace(/^\//, '')}.ts`;
    assert.ok(
      path in config.ROUTE_MAX_DURATION_SECONDS,
      `${path} is scheduled with no declared duration`,
    );
  }
});

// ---------------------------------------------------------------------------
// H1, H3, H4, K5 — what may be signed, at what price, and how a revert reads
// ---------------------------------------------------------------------------

await test(['H1'], 'the contract address and the chain are literals, not configuration', () => {
  assert.equal(config.GIVEAWAY_MANAGER_V2, '0xEA91eb545FBB7e82f0085ff30555ed06C1Baf739');
  assert.equal(config.CHAIN_ID, 42161);
  assert.equal(config.USDC, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
  for (const name of [...env.REQUIRED_ENV, ...env.OPTIONAL_ENV]) {
    assert.ok(!/CONTRACT|MANAGER|CHAIN_ID/.test(name), `${name} could repoint the contract`);
  }
});

await test(['H1'], 'the manager ABI carries exactly three state-changing functions', () => {
  const mutable = abi.GIVEAWAY_MANAGER_V2_ABI
    .filter((item) => item.type === 'function' && item.stateMutability === 'nonpayable')
    .map((item) => item.name);
  assert.deepEqual([...mutable].sort(), ['addEligibilityRoot', 'claimPrize', 'enter']);
});

await test(['H1'], 'no ABI in the bridge can approve or move a third party balance', () => {
  const mutableOf = (list) =>
    list
      .filter((item) => item.type === 'function' && item.stateMutability === 'nonpayable')
      .map((item) => item.name);
  assert.deepEqual(mutableOf(abi.ERC20_ABI), ['transfer']);
  assert.deepEqual(mutableOf(abi.ERC721_ABI), ['safeTransferFrom']);
  assert.deepEqual(mutableOf(abi.ERC1155_ABI), ['safeTransferFrom']);
  for (const list of [abi.ERC20_ABI, abi.ERC721_ABI, abi.ERC1155_ABI]) {
    for (const item of list) {
      assert.ok(!/approve/i.test(item.name ?? ''), `${item.name} is an approval`);
    }
  }
});

await test(['H1'], 'the prize modules and the VRF coordinator are read-only to the bridge', () => {
  for (const list of [
    abi.ERC721_PRIZE_MODULE_ABI,
    abi.ERC1155_PRIZE_MODULE_ABI,
    abi.VRF_COORDINATOR_V2_PLUS_ABI,
  ]) {
    for (const item of list) {
      if (item.type !== 'function') continue;
      assert.ok(
        item.stateMutability === 'view' || item.stateMutability === 'pure',
        `${item.name} is not read-only`,
      );
    }
  }
});

await test(['H4'], 'an estimate outside its band is refused before anything is signed', () => {
  for (const band of Object.values(config.GAS_BANDS)) {
    assert.throws(() => planGas(band.min - 1n, 1n, 0n, band), /gas_estimate_out_of_band/);
    assert.throws(() => planGas(band.max + 1n, 1n, 0n, band), /gas_estimate_out_of_band/);
  }
});

await test(['H4'], 'the transfer band admits the real Arbitrum intrinsic cost', () => {
  // 21_000 on a bare EVM; Arbitrum One folds the L1 data component in and
  // answers 21_299 for a zero-value transfer and 21_305 with a value.
  assert.ok(config.GAS_BANDS.TRANSFER.min <= 21_000n);
  assert.ok(config.GAS_BANDS.TRANSFER.max >= 21_305n);
  assert.ok(planGas(21_305n, 100n, 0n, config.GAS_BANDS.TRANSFER).gasLimit > 21_305n);
});

await test(['H3'], 'a plan above the absolute ceiling fails instead of spending', () => {
  const band = config.GAS_BANDS.MANAGER;
  assert.throws(
    () => planGas(band.min, config.MAX_GAS_COST_WEI, 0n, band),
    /gas_cost_above_ceiling/,
  );
});

await test(['H3'], 'the margin is applied to the limit and carried into the worst case', () => {
  const plan = planGas(100_000n, 1_000n, 500n, config.GAS_BANDS.MANAGER);
  assert.equal(
    plan.gasLimit,
    (100_000n * config.GAS_MARGIN_NUMERATOR) / config.GAS_MARGIN_DENOMINATOR,
  );
  assert.equal(plan.worstCaseWei, plan.gasLimit * 1_000n);
  assert.equal(plan.maxPriorityFeePerGas, 500n);
  assert.ok(plan.worstCaseWei <= config.MAX_GAS_COST_WEI);
});

await test(['K5'], 'a revert is decoded to the name the contract raised', () => {
  for (const name of ['EntriesClosed', 'NotEligible', 'SlotsExhausted', 'InvalidRoot', 'NotBridge']) {
    const data = encodeErrorResult({ abi: abi.GIVEAWAY_MANAGER_V2_ABI, errorName: name });
    // The payload sits several links down the cause chain of a wrapper class,
    // which is where the gas estimate throws it.
    const wrapped = new Error('EstimateGasExecutionError', {
      cause: new Error('inner', { cause: Object.assign(new Error('raw'), { data }) }),
    });
    assert.equal(abi.contractErrorName(wrapped), name);
  }
});

await test(['K5'], 'an already-decoded revert is read from where viem leaves it', () => {
  assert.equal(
    abi.contractErrorName({ cause: { data: { errorName: 'AlreadyEntered' } } }),
    'AlreadyEntered',
  );
});

await test(['K5'], 'a timeout still reads as a timeout, not as a revert', () => {
  assert.equal(abi.contractErrorName(new Error('timed out')), null);
  assert.equal(abi.contractErrorName(null), null);
  assert.equal(abi.contractErrorName(undefined), null);
  assert.equal(abi.contractErrorName('string'), null);
});

await test(['K5'], 'a cause chain that points at itself does not hang the failure path', () => {
  const loop = { data: '0xnothex' };
  loop.cause = loop;
  assert.equal(abi.contractErrorName(loop), null);
});

await test(['K4', 'K5'], 'only the error name comes back, never the arguments', () => {
  // The built-in Error(string) carries a string the reverting contract chose,
  // which is exactly the kind of value that may not reach a log.
  const data = encodeErrorResult({
    abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'reason', type: 'string' }] }],
    errorName: 'Error',
    args: ['alice@example.com is not allowed'],
  });
  const name = abi.contractErrorName(Object.assign(new Error('x'), { data }));
  assert.ok(name === null || !name.includes('alice@example.com'), 'a revert argument was returned');
});
