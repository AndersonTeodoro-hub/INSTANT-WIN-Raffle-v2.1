/**
 * SPEC-BLOCO-03 piece 6 — the frontend, and what Adenda T changed in the bridge.
 *
 * T8: the logic and the flows are tested here, with the real routes in this
 * process and the software authenticator (../passkey.mjs) behind a double of
 * navigator.credentials — no browser and no new test dependency. The page's
 * modules (lib/keptra/*) are the ones the screens import; the screens themselves
 * were opened in a real browser against the local app (test/preview) and their
 * captures are the report's.
 *
 * Tags: Un for the rows of test/bridge-v2/MATRIZ-PECA6-KEPTRA.md, ATn for the
 * decisions of Adenda T.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  toFunctionSignature,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { assert, deadline, http, jsonResponse, recordingLogger, suite, test } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import * as chain from '../doubles/chain.mjs';
import * as kchain from '../doubles/keptraChain.mjs';
import * as escrow from '../doubles/escrowChain.mjs';
import { PRIVACY_TEXT as BRIDGE_PRIVACY_TEXT, REAL_KEPTRA, REAL_PRIVACY_TEXT, setKeptraContracts, setPrivacyText } from '../doubles/config.mjs';
import { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } from '../memdb.mjs';
import { createPasskey } from '../passkey.mjs';
import { applyMigration, attempt, asRole, bootEngine, createDatabase, sql } from '../pg.mjs';

import * as keptra from '../../../lib/bridge-v2/keptra.ts';
import * as bridgeAbi from '../../../lib/bridge-v2/abi.ts';
import { advanceOrders } from '../../../lib/bridge-v2/keptraOrders.ts';
import { guardianAddress } from '../../../lib/bridge-v2/guardian.ts';

import * as api from '../../../lib/keptra/api.ts';
import * as webauthn from '../../../lib/keptra/webauthn.ts';
import { runAction } from '../../../lib/keptra/relay.ts';
import * as code from '../../../lib/keptra/deliveryCode.ts';
import { QUIET_ZONE, qrSymbol } from '../../../lib/keptra/qr.ts';
import * as format from '../../../lib/keptra/format.ts';
import * as clientOrders from '../../../lib/keptra/orders.ts';
import * as contracts from '../../../lib/keptra/contracts.ts';
import * as reads from '../../../lib/keptra/reads.ts';
import * as focus from '../../../lib/keptra/focus.ts';
import { PRIVACY_TEXT, privacyPublished } from '../../../lib/keptra/privacy.ts';
import { checkDescription } from '../../../lib/keptra-description.ts';

import * as statusRoute from '../../../api/bridge/v2/account/status.ts';
import * as vouchersRoute from '../../../api/bridge/v2/account/vouchers.ts';
import * as register from '../../../api/bridge/v2/account/register.ts';
import * as relayRoute from '../../../api/bridge/v2/account/relay.ts';
import * as migrateRoute from '../../../api/bridge/v2/account/migrate.ts';
import * as addressRoute from '../../../api/bridge/v2/order/address.ts';
import * as listRoute from '../../../api/bridge/v2/order/list.ts';
import * as evidenceRoute from '../../../api/bridge/v2/order/evidence.ts';
import * as storeOrdersRoute from '../../../api/bridge/v2/store/orders.ts';
import * as trackingRoute from '../../../api/bridge/v2/store/tracking.ts';
import * as offersRoute from '../../../api/bridge/v2/store/offers.ts';
import * as describeRoute from '../../../api/bridge/v2/store/description.ts';
import * as offerDescriptionRoute from '../../../api/bridge/v2/offer/description.ts';
import * as arbiterRoute from '../../../api/bridge/v2/arbiter/evidence.ts';
import * as eraseRoute from '../../../api/bridge/v2/privacy/erase.ts';
import * as exportRoute from '../../../api/bridge/v2/privacy/export.ts';

suite('frontend');

const root = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/');
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const codeOf = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const SESSION_COOKIE = 'iw_bridge_session=a-token-value';
const ESCROW = getAddress('0x00000000000000000000000000000000e5c0e5c0');
const GUARANTEE = getAddress('0x00000000000000000000000000000000ea4a0001');
const VOUCHER = getAddress('0x0000000000000000000000000000000076c40001');
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const T0 = BigInt(Math.floor(Date.now() / 1000));
const DAY = 86_400n;
const ADDRESS = { name: 'Ana Silva', street: 'Rua das Flores 12', postCode: '1000-001', city: 'Lisboa', country: 'PT', phone: null };

// ---------------------------------------------------------------------------
// the bridge in this process, and the page's client pointed at it (T8)
// ---------------------------------------------------------------------------

const ROUTES = {
  'account/status': statusRoute,
  'account/vouchers': vouchersRoute,
  'account/register': register,
  'account/relay': relayRoute,
  'account/migrate': migrateRoute,
  'order/address': addressRoute,
  'order/list': listRoute,
  'order/evidence': evidenceRoute,
  'store/orders': storeOrdersRoute,
  'store/tracking': trackingRoute,
  'store/offers': offersRoute,
  'store/description': describeRoute,
  'offer/description': offerDescriptionRoute,
  'privacy/erase': eraseRoute,
  'privacy/export': exportRoute,
};

/** Every body the page sent, to prove what never leaves it (T6: the delivery code). */
const sent = [];
let cookie = SESSION_COOKIE;
const bridgeFetch = async (input, init) => {
  sent.push({ path: input, body: String(init.body ?? '') });
  const route = ROUTES[input.replace('/api/bridge/v2/', '')];
  if (!route) throw new Error(`[test] no route for ${input}`);
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', 'user-agent': 'test-agent' };
  if (cookie !== null) headers.cookie = cookie;
  return route.POST(new Request(`https://keptra.invalid${input}`, { method: 'POST', headers, body: init.body }));
};
api.setFetch(bridgeFetch);

let store;
const owners = new Map();

function asParticipant(participantId) {
  db.on('bridge_v2_sessions:select', () => ({
    data: {
      id: `session-${participantId}`,
      participant_id: participantId,
      idle_expires_at: new Date(Date.now() + 60_000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    },
    error: null,
  }));
}

const configuredState = (safe, extra = {}) => ({
  deployed: true,
  nonce: 1n,
  owners: [owners.get(safe.toLowerCase()) ?? '0x0000000000000000000000000000000000000009'],
  threshold: 1n,
  modules: [keptra.RECOVERY_MODULE],
  fallbackHandler: keptra.FALLBACK_HANDLER,
  guardians: [guardianAddress()],
  guardianThreshold: 1n,
  recoveryExecuteAfter: 0n,
  recoveryNewOwners: [],
  ...extra,
});

function fresh() {
  db.reset();
  chain.reset();
  kchain.reset();
  escrow.reset();
  http.reset();
  owners.clear();
  sent.length = 0;
  cookie = SESSION_COOKIE;
  setKeptraContracts({ escrow: ESCROW, guarantee: GUARANTEE, voucher: VOUCHER });
  store = memdb(db, KEPTRA_TABLES, KEPTRA_UNIQUE);
  db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_acquire_funder', () => ({
    data: [{ funder_index: 0, address: '0x5555555555555555555555555555555555555555', next_nonce: 3, lease_token: 'lease-1' }],
    error: null,
  }));
  for (const name of ['reconcile_funder_nonce', 'renew_funder_lease', 'release_funder', 'disable_funder']) {
    db.on(`rpc:bridge_v2_${name}`, () => ({ data: true, error: null }));
  }
  chain.set({ transactionCount: { latest: 3, pending: 3 } });
  kchain.set({ isValidPasskeySignature: true, accountState: (safe) => configuredState(safe) });
  http.on('api.resend.com', () => jsonResponse({ id: 'mail-1' }));
  http.on('api.ship24.com', () => jsonResponse({ data: { tracker: { trackerId: 'tracker-0001-aaaa' } } }, 201));
}

/** A participant with a passkey — created by the PAGE's own code (webauthn.createPasskey) — and both accounts configured. */
async function person(id, signer) {
  store.insert('bridge_v2_participants', { id, email_canonical: `${id}@example.test`, wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  asParticipant(id);
  const passkey = await createPasskey();
  const credentials = fakeCredentials(passkey);
  kchain.set({ signerAddressOf: signer });
  const key = await webauthn.createPasskey(credentials, `${id}@example.test`);
  const registered = await api.registerPasskey(key);
  assert.equal(registered.ok, true, JSON.stringify(registered));
  const rows = store.rows('bridge_v2_accounts').filter((row) => row.participant_id === id);
  for (const row of rows) owners.set(row.safe_address.toLowerCase(), signer);
  return {
    id,
    passkey,
    credentials,
    participant: rows.find((row) => row.role === 'PARTICIPANT').safe_address,
    creator: rows.find((row) => row.role === 'CREATOR').safe_address,
  };
}

/** navigator.credentials, as a browser would answer, with the software authenticator behind it. */
function fakeCredentials(passkey) {
  const calls = [];
  const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    calls,
    async create(options) {
      calls.push({ op: 'create', options });
      return { rawId: buffer(webauthn.fromBase64Url(passkey.credentialId)), response: { getPublicKey: () => passkey.spki } };
    },
    async get(options) {
      calls.push({ op: 'get', options });
      const challenge = webauthn.toHex(new Uint8Array(options.publicKey.challenge));
      const assertion = await passkey.sign(challenge);
      return {
        rawId: buffer(webauthn.fromBase64Url(assertion.credentialId)),
        response: {
          authenticatorData: buffer(webauthn.hexToBytes(assertion.authenticatorData)),
          clientDataJSON: buffer(new TextEncoder().encode(assertion.clientDataJSON)),
          signature: buffer(webauthn.hexToBytes(assertion.signature)),
        },
      };
    },
  };
}

/** The page's relay flow, confirming every summary and signing with this person's passkey; the summaries seen are kept. */
function deps(who, answers = []) {
  const seen = [];
  const order = [];
  return {
    seen,
    order,
    confirm: async (summary) => {
      seen.push(summary);
      order.push('confirm');
      return answers.length === 0 ? true : answers.shift();
    },
    sign: async (hash) => {
      order.push('sign');
      return webauthn.signHash(who.credentials, hash, [who.passkey.credentialId]);
    },
  };
}

function offer(extra = {}) {
  escrow.set({
    readTerms: { store: '0x7777777777777777777777777777777777777777', price: 10_000_000n, payout: '0x7777777777777777777777777777777777777777', shipping: 1_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode: 0, prize: false, active: true, ...extra },
    regionsOf: ['PT', 'ES'],
  });
}

function fx({ id, state = bridgeAbi.OrderState.PAID, flags = 0, payer, store: storeSafe, mode = 0, prize = false, windowEndsAt = 0n, termsId = 1n, voucherId = 0n, codeCommit = ZERO_HASH, paid = 11_000_000n, shippedAt = 0n }) {
  return {
    order: { orderId: BigInt(id), termsId, quantity: 1, state, flags, payer, paid, paidAt: T0, shippedAt, windowEndsAt, contestedAt: 0n, voucherId, codeCommit },
    terms: { store: storeSafe, price: 10_000_000n, payout: storeSafe, shipping: 1_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode, prize, active: true },
  };
}

function chainShows(list, now = T0) {
  const byId = new Map(list.map((item) => [item.order.orderId, item]));
  escrow.set({
    ordersHead: { orderCount: list.reduce((max, item) => (item.order.orderId >= max ? item.order.orderId + 1n : max), 1n), now, block: 1_000n },
    readOrders: (ids) => ids.map((id) => byId.get(id) ?? fx({ id, state: bridgeAbi.OrderState.NONE, payer: '0x0000000000000000000000000000000000000000', store: '0x0000000000000000000000000000000000000000' })),
  });
}

const pass = () => advanceOrders(recordingLogger(), deadline());

/** A mined log of `eventName`, as viem would read it from a receipt. */
function logOf(address, abi, eventName, args, dataTypes, dataValues) {
  return { address, topics: encodeEventTopics({ abi, eventName, args }), data: encodeAbiParameters(dataTypes, dataValues), blockNumber: 1n, logIndex: 0, transactionIndex: 0, transactionHash: ZERO_HASH, blockHash: ZERO_HASH, removed: false };
}

// ===========================================================================
// the passkey in the page — U1, U6, U7, AT8
// ===========================================================================

await test(['U1', 'AT8'], 'A13 and C9: the page asks for a passkey only on https://keptra.io, and its RP ID and origin are the bridge’s constants', () => {
  assert.equal(webauthn.RP_ID, keptra.RP_ID);
  assert.equal(webauthn.KEPTRA_ORIGIN, keptra.KEPTRA_BASE);
  assert.equal(webauthn.passkeyOrigin('https://keptra.io', true), true);
  for (const origin of ['https://www.keptra.io', 'https://instntwin.com', 'http://localhost:5173', 'https://keptra.io.evil.example']) {
    assert.equal(webauthn.passkeyOrigin(origin, true), false, origin);
  }
  assert.equal(webauthn.passkeyOrigin('https://keptra.io', false), false, 'no WebAuthn, no passkey');
});

await test(['U6', 'AT8'], '6.2.1: the page creates the passkey for keptra.io — ES256 only, user verification required, a resident key — and registers the public key the device gave, parsed from SPKI', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const [call] = buyer.credentials.calls;
  assert.equal(call.op, 'create');
  assert.equal(call.options.publicKey.rp.id, 'keptra.io');
  assert.deepEqual(call.options.publicKey.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
  assert.equal(call.options.publicKey.authenticatorSelection.userVerification, 'required');
  assert.equal(call.options.publicKey.authenticatorSelection.residentKey, 'required');
  const [row] = store.rows('bridge_v2_passkeys');
  assert.equal(row.credential_id, buyer.passkey.credentialId);
  assert.equal(String(row.public_x), buyer.passkey.x.toString());
  assert.equal(String(row.public_y), buyer.passkey.y.toString());
});

await test(['U7', 'AT8'], '6.2.2 and C9: the page’s assertion is what the bridge parses — the challenge is the hash, the origin keptra.io, the DER signature verifies against the registered key', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const hash = keccak256('0x1234');
  const assertion = await webauthn.signHash(buyer.credentials, hash, [buyer.passkey.credentialId]);
  const get = buyer.credentials.calls.find((c) => c.op === 'get');
  assert.equal(get.options.publicKey.rpId, 'keptra.io');
  assert.equal(get.options.publicKey.userVerification, 'required');
  assert.equal(webauthn.base64Url(get.options.publicKey.allowCredentials[0].id), buyer.passkey.credentialId);
  const parsed = keptra.assertionToSignature(hash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  assert.notEqual(parsed, null, 'the bridge refused the page’s assertion');
  assert.equal(keptra.assertionToSignature(keccak256('0x99'), assertion.authenticatorData, assertion.clientDataJSON, assertion.signature), null, 'another hash');
  // The signature itself, checked with the public key the page registered.
  const { r, s } = keptra.parseDerSignature(assertion.signature);
  const raw = webauthn.hexToBytes(`0x${r.toString(16).padStart(64, '0')}${s.toString(16).padStart(64, '0')}`);
  const pub = await crypto.subtle.importKey('spki', buyer.passkey.spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(assertion.clientDataJSON)));
  const signed = new Uint8Array([...webauthn.hexToBytes(assertion.authenticatorData), ...clientHash]);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, raw, signed), true);
});

// ===========================================================================
// the relay flow — U5, U21, AT2, AT8
// ===========================================================================

await test(['U5', 'U21', 'AT2', 'AT8'], 'C12 and T2: pay through the page — the bridge’s summary (price × quantity + shipping, to the escrow) is shown first, the passkey signs only after the yes, and the order id comes back', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  asParticipant('participant-1');
  assert.equal((await api.registerAddress({ termsId: '1' }, ADDRESS)).ok, true);
  chain.set({ erc20BalanceOf: 100_000_000n });
  const opened = logOf(ESCROW, bridgeAbi.KEPTRA_ESCROW_ABI, 'OrderOpened', { orderId: 42n, termsId: 1n, payer: buyer.participant }, [{ type: 'uint96' }, { type: 'uint256' }], [31_000_000n, 0n]);
  chain.set({ waitForReceipt: { status: 'success', logs: [opened] } });
  const flow = deps(buyer);
  const outcome = await runAction({ kind: 'pay', termsId: '1', quantity: 3 }, flow);
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  assert.equal(outcome.result.orderId, '42');
  assert.deepEqual(flow.order, ['confirm', 'sign']);
  const [summary] = flow.seen;
  assert.equal(summary.action, 'pay');
  assert.deepEqual(summary.amounts, [{ kind: 'ERC20', token: USDC, value: String(3n * 10_000_000n + 1_000_000n) }]);
  assert.deepEqual(summary.destination, { address: ESCROW, role: 'ESCROW' });
  const words = format.summaryWords(summary);
  assert.equal(words.amounts[0], '31.00 USDC');
});

await test(['U5', 'AT2'], 'C12: saying no to the summary sends nothing and never asks for the passkey; closing the passkey prompt sends nothing either', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  asParticipant('participant-1');
  await api.registerAddress({ termsId: '1' }, ADDRESS);
  chain.set({ erc20BalanceOf: 100_000_000n });
  const no = deps(buyer, [false]);
  assert.deepEqual(await runAction({ kind: 'pay', termsId: '1', quantity: 1 }, no), { status: 'cancelled' });
  assert.deepEqual(no.order, ['confirm']);
  const closed = { confirm: async () => true, sign: async () => Object.assign(new Error('closed'), { name: 'NotAllowedError' }) };
  closed.sign = async () => {
    throw Object.assign(new Error('closed'), { name: 'NotAllowedError' });
  };
  assert.deepEqual(await runAction({ kind: 'pay', termsId: '1', quantity: 1 }, closed), { status: 'cancelled' });
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0, 'something was relayed');
  assert.equal(sent.filter((s) => s.path.endsWith('account/relay') && s.body.includes('"signature"')).length, 0, 'a submit was sent');
});

await test(['U7'], 'a transaction that landed in between (stale_nonce): the page prepares again, shows the new summary and asks again — once', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  chain.set({ erc20BalanceOf: 5_000_000n });
  // Between the first prepare and its submit another transaction lands: the account's nonce moves on.
  let nonce = 1n;
  kchain.set({ accountState: (safe) => configuredState(safe, { nonce }) });
  const flow = deps(buyer);
  const sign = flow.sign;
  let signs = 0;
  flow.sign = async (hash) => {
    signs += 1;
    const assertion = await sign(hash);
    if (signs === 1) nonce = 2n;
    return assertion;
  };
  const outcome = await runAction({ kind: 'transferUsdc', to: '0x4444444444444444444444444444444444444444', amount: '1000000' }, flow);
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  assert.equal(signs, 2, 'the passkey was not asked again');
  assert.equal(flow.seen.length, 2, 'the new summary was not shown');
  const submits = sent.filter((s) => s.path.endsWith('account/relay') && s.body.includes('"signature"'));
  assert.deepEqual(submits.map((s) => JSON.parse(s.body).nonce), ['1', '2']);
  // Once: a second move on is refused, not chased.
  nonce = 3n;
  signs = 0;
  flow.sign = async (hash) => {
    signs += 1;
    const assertion = await sign(hash);
    nonce += 1n;
    return assertion;
  };
  const twice = await runAction({ kind: 'transferUsdc', to: '0x4444444444444444444444444444444444444444', amount: '1000000' }, flow);
  assert.equal(twice.status, 'refused');
  assert.equal(signs, 2);
});

await test(['AT2', 'U16', 'U15'], 'T2: every action’s summary is the bridge’s — claim brings the prize into the account, enter names the core, cancel returns the payment, confirm releases it to the store, refund goes to the buyer, contest moves nothing', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  const prepare = async (body) => (await api.call('account/relay', body));
  asParticipant('participant-1');
  chain.set({ claimableFor: 25_000_000n });
  const claim = await prepare({ kind: 'claim', giveawayId: '9' });
  assert.deepEqual(claim.summary.amounts, [{ kind: 'ERC20', token: USDC, value: '25000000' }]);
  assert.deepEqual(claim.summary.destination, { address: buyer.participant, role: 'THIS_ACCOUNT' });
  chainShows([fx({ id: 5, payer: buyer.participant, store: shop.creator, paid: 11_000_000n })]);
  const cancel = await prepare({ kind: 'cancelOrder', orderId: '5' });
  assert.deepEqual(cancel.summary.amounts, [{ kind: 'ERC20', token: USDC, value: '11000000' }]);
  assert.equal(cancel.summary.destination.role, 'THIS_ACCOUNT');
  chainShows([fx({ id: 5, state: bridgeAbi.OrderState.SHIPPED, payer: buyer.participant, store: shop.creator, paid: 11_000_000n })]);
  const confirm = await prepare({ kind: 'confirm', orderId: '5' });
  assert.deepEqual(confirm.summary.destination, { address: shop.creator, role: 'STORE' });
  assert.equal(confirm.summary.amounts[0].value, '11000000');
  chainShows([fx({ id: 5, state: bridgeAbi.OrderState.WINDOW, windowEndsAt: T0 + 5n * DAY, payer: buyer.participant, store: shop.creator })]);
  kchain.set({ chainNow: T0 });
  const contest = await prepare({ kind: 'contest', orderId: '5' });
  assert.deepEqual([contest.summary.amounts, contest.summary.destination], [[], null]);
  asParticipant('store-1');
  const refund = await prepare({ kind: 'refund', orderId: '5', amount: '2000000' });
  assert.deepEqual(refund.summary, { action: 'refund', amounts: [{ kind: 'ERC20', token: USDC, value: '2000000' }], destination: { address: buyer.participant, role: 'RECIPIENT' } });
  // The client never recomputes an amount: no copy of the obligation formula (T2) and no price arithmetic in the page's code.
  for (const dir of ['lib/keptra', 'pages/keptra', 'components/keptra']) {
    for (const name of readdirSync(`${root}${dir}`)) {
      assert.ok(!/bondBps|protectionBps/.test(codeOf(`${dir}/${name}`)), `${dir}/${name} repeats the obligation formula`);
    }
  }
  // U15: the Event Center signs the entry only at ELIGIBLE, with the passkey; U16: the claim, when won.
  const detail = codeOf('pages/EventDetail.tsx');
  assert.match(detail, /status\.passkey === true && status\.status === 'ELIGIBLE'/);
  assert.match(detail, /relay\(\{ kind: 'enter', giveawayId/);
  assert.match(detail, /relay\(\{ kind: 'claim', giveawayId/);
});

await test(['U28', 'AT2', 'AT5', 'AU6'], 'T2, T5 and U6: a prize obligation — the bond and the fee are the bridge’s one figure in the summary, and the obligation, its terms and its vouchers come back from the receipt', async () => {
  fresh();
  const brand = await person('brand-1', '0x3333333333333333333333333333333333333333');
  asParticipant('brand-1');
  chain.set({ erc20BalanceOf: 500_000_000n });
  const created = logOf(GUARANTEE, bridgeAbi.KEPTRA_GUARANTEE_ABI, 'ObligationCreated', { obligationId: 3n, termsId: 11n, brand: brand.creator },
    [{ type: 'address' }, { type: 'uint32' }, { type: 'uint96' }, { type: 'uint96' }, { type: 'uint256' }, { type: 'uint8' }],
    ['0x1111111111111111111111111111111111111111', 2, 55_000_000n, 55_000_000n, 3_300_000n, 0]);
  const minted = [21n, 22n].map((tokenId) => logOf(VOUCHER, bridgeAbi.KEPTRA_VOUCHER_ABI, 'VoucherMinted', { tokenId, obligationId: 3n, to: brand.creator }, [], []));
  chain.set({ waitForReceipt: { status: 'success', logs: [created, ...minted] } });
  const flow = deps(brand);
  const outcome = await runAction({ kind: 'createObligation', price: '100000000', shipping: '10000000', returnCost: '0', shipDays: 3, deliveryDays: 7, mode: 'CARRIER', regions: ['PT'], units: 2 }, flow);
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  // 50% bond of 110 USDC, rounded up, per unit; 3% of the coverage as the fee: 2 × 55 + 3.3.
  assert.deepEqual(flow.seen[0].amounts, [{ kind: 'ERC20', token: USDC, value: '113300000' }]);
  assert.deepEqual(flow.seen[0].destination, { address: GUARANTEE, role: 'GUARANTEE' });
  assert.deepEqual([outcome.result.obligationId, outcome.result.termsId, outcome.result.voucherIds], ['3', '11', ['21', '22']]);
});

await test(['U26', 'AT5'], 'T5: an offer published through the page comes back with the id the store shares; nothing moves, and the summary says so', async () => {
  fresh();
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  asParticipant('store-1');
  const published = logOf(ESCROW, bridgeAbi.KEPTRA_ESCROW_ABI, 'OfferCreated', { termsId: 7n, store: shop.creator }, [{ type: 'uint8' }, { type: 'uint96' }, { type: 'uint96' }], [0, 10_000_000n, 1_000_000n]);
  chain.set({ waitForReceipt: { status: 'success', logs: [published] } });
  const flow = deps(shop);
  const outcome = await runAction({ kind: 'createOffer', payout: shop.creator, price: '10000000', shipping: '1000000', returnCost: '0', refusalFeeBps: 500, shipDays: 3, deliveryDays: 7, mode: 'CARRIER', regions: ['PT', 'ES'] }, flow);
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  assert.equal(outcome.result.termsId, '7');
  assert.deepEqual([flow.seen[0].amounts, flow.seen[0].destination], [[], null]);
  // Past the ceilings the relay refuses before anything is signed (7.4, 7.7).
  const refused = await runAction({ kind: 'createOffer', payout: shop.creator, price: '10000000', shipping: '1000000', returnCost: '0', refusalFeeBps: 1600, shipDays: 3, deliveryDays: 7, mode: 'CARRIER', regions: ['PT'] }, deps(shop));
  assert.equal(refused.status, 'refused');
  assert.match(refused.error, /conditions are not allowed/);
});

// ===========================================================================
// U17 — USDC out of either account (T12)
// ===========================================================================

await test(['U17', 'AU2'], 'T12 (U17) and Adenda U2: USDC leaves the business account too, exactly the amount typed; never to the account itself, never past the balance, never into a platform account not set up', async () => {
  fresh();
  const brand = await person('brand-1', '0x3333333333333333333333333333333333333333');
  const other = await person('other-1', '0x4444444444444444444444444444444444444444');
  asParticipant('brand-1');
  chain.set({ erc20BalanceOf: 7_500_000n });
  const flow = deps(brand);
  const done = await runAction({ kind: 'transferUsdc', role: 'CREATOR', to: '0x9999999999999999999999999999999999999999', amount: '7500000' }, flow);
  assert.equal(done.status, 'done', JSON.stringify(done));
  assert.deepEqual(flow.seen[0], { action: 'transferUsdc', amounts: [{ kind: 'ERC20', token: USDC, value: '7500000' }], destination: { address: '0x9999999999999999999999999999999999999999', role: 'ADDRESS' } });
  // It ran on the creator account, and it is a USDC transfer of exactly that amount.
  const relayed = kchain.calls.filter((c) => c.name === 'sendRelayed').at(-1);
  assert.ok(JSON.stringify(relayed.args[1]).toLowerCase().includes(brand.creator.slice(2).toLowerCase()));
  const refuse = async (body) => (await api.call('account/relay', body));
  assert.match((await refuse({ kind: 'transferUsdc', role: 'CREATOR', to: brand.creator, amount: '1' })).error, /other than this account/);
  assert.match((await refuse({ kind: 'transferUsdc', role: 'CREATOR', to: '0x9999999999999999999999999999999999999999', amount: '7500001' })).error, /cannot be sent/);
  kchain.set({ accountState: (safe) => (safe.toLowerCase() === other.participant.toLowerCase() ? { ...configuredState(safe), deployed: false, modules: [], guardians: [] } : configuredState(safe)) });
  assert.match((await refuse({ kind: 'transferUsdc', to: other.participant, amount: '1' })).error, /not set up yet/);
});

// ===========================================================================
// the account — U8, U9, U12, U14, AT3, AT19
// ===========================================================================

await test(['U8', 'U9', 'AT3'], 'T3: account/status reads, and registers nothing — an address only once usable (C4), recovery against the current guardian (C6), the passkeys’ ids; no session, no answer', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const status = await api.accountStatus();
  assert.equal(status.ok, true);
  assert.deepEqual(status.passkeys, [buyer.passkey.credentialId]);
  assert.equal(status.email, 'participant-1@example.test');
  const personal = status.accounts.find((a) => a.role === 'PARTICIPANT');
  assert.equal(personal.address, buyer.participant);
  assert.equal(personal.recoveryEnabled, true);
  const before = store.rows('bridge_v2_passkeys').length;
  kchain.set({ accountState: (safe) => ({ ...configuredState(safe), deployed: false, modules: [], guardians: [] }) });
  const bare = await api.accountStatus();
  assert.equal(bare.accounts.every((a) => a.address === null || a.configured), true);
  kchain.set({ accountState: (safe) => configuredState(safe, { guardians: ['0x8888888888888888888888888888888888888888'] }) });
  assert.equal((await api.accountStatus()).accounts[0].recoveryEnabled, false, 'a rotated-away guardian shows no recovery');
  assert.equal(store.rows('bridge_v2_passkeys').length, before, 'status wrote a passkey');
  cookie = null;
  assert.equal((await api.accountStatus()).status, 401);
});

await test(['U12', 'AT19'], '6.3.3 and T19 (U12): a change of access pending on-chain is shown with its date, and cancelled with the passkey — with a session, and even with the 20-a-day limit reached', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const until = T0 + 3n * DAY;
  kchain.set({ accountState: (safe) => configuredState(safe, { recoveryExecuteAfter: until }) });
  const status = await api.accountStatus();
  assert.equal(status.accounts[0].recoveryPendingUntil, new Date(Number(until) * 1000).toISOString());
  const account = store.rows('bridge_v2_accounts').find((row) => row.role === 'PARTICIPANT');
  for (let i = 0; i < 25; i += 1) store.insert('bridge_v2_relayed_transactions', { account_id: account.id, created_at: new Date().toISOString() });
  const flow = deps(buyer);
  const outcome = await runAction({ kind: 'cancelRecovery' }, flow);
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  assert.deepEqual([flow.seen[0].amounts, flow.seen[0].destination], [[], null]);
  cookie = null;
  const anonymous = await runAction({ kind: 'cancelRecovery' }, deps(buyer));
  assert.equal(anonymous.status, 'refused');
  assert.equal(anonymous.code, 401);
});

await test(['U14'], '6.6.2 (U14): a participant with an earlier wallet sees it waiting, authorises the move with the passkey through the page, and sees it authorised', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const row = store.rows('bridge_v2_participants').find((p) => p.id === 'participant-1');
  row.wallet_index = 7;
  row.wallet_address = '0x7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a';
  assert.equal((await api.accountStatus()).migration.PARTICIPANT, 'PENDING');
  const challenge = await api.migrationChallenge('PARTICIPANT');
  assert.equal(challenge.ok, true, JSON.stringify(challenge));
  const assertion = await webauthn.signHash(buyer.credentials, challenge.challenge, [buyer.passkey.credentialId]);
  const authorised = await api.authorizeMigration('PARTICIPANT', assertion);
  assert.equal(authorised.ok && authorised.status, 'AUTHORIZED', JSON.stringify(authorised));
  assert.equal((await api.accountStatus()).migration.PARTICIPANT, 'AUTHORIZED');
  store.rows('bridge_v2_migrations')[0].sealed_at = new Date().toISOString();
  assert.equal((await api.accountStatus()).migration.PARTICIPANT, 'DONE');
});

await test(['U23', 'AT3'], 'T3 and 11.10 (U23): account/vouchers lists the vouchers each account holds — a winner’s with its 30-day deadline, a brand’s loose ones — and nobody else’s', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const claimedAt = T0 - DAY;
  escrow.set({
    voucherLastId: 4n,
    readVouchers: (ids) => ids.map((voucherId) => ({
      voucherId,
      owner: voucherId === 1n ? buyer.participant : voucherId === 2n ? buyer.creator : voucherId === 3n ? '0x1212121212121212121212121212121212121212' : buyer.participant,
      voided: voucherId === 4n,
      claimedAt: voucherId === 1n ? claimedAt : 0n,
      giveawayId: voucherId === 1n ? 9n : 0n,
      obligationId: 3n,
    })),
  });
  const listed = await api.accountVouchers();
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.vouchers.map((v) => [v.voucherId, v.role]), [['1', 'PARTICIPANT'], ['2', 'CREATOR']]);
  assert.equal(listed.vouchers[0].redeemBy, String(claimedAt + 30n * DAY));
  assert.equal(listed.complete, true);
});

await test(['U23'], 'H7 (U23): a redemption through the page — the bridge sets the attestation’s deadline at prepare and the page echoes it at submit, so both builds are the same bytes', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  kchain.set({ chainNow: T0 });
  escrow.set({
    readVouchers: [{ voucherId: 5n, owner: buyer.participant, voided: false, claimedAt: T0 - DAY, giveawayId: 9n, obligationId: 3n }],
    readObligation: { brand: '0x7777777777777777777777777777777777777777', termsId: 2n },
    readTerms: { store: '0x7777777777777777777777777777777777777777', price: 50_000_000n, payout: '0x7777777777777777777777777777777777777777', shipping: 5_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode: 0, prize: true, active: true },
    regionsOf: ['PT'],
  });
  asParticipant('participant-1');
  assert.equal((await api.registerAddress({ voucherId: '5' }, ADDRESS)).ok, true);
  const flow = deps(buyer);
  const outcome = await runAction({ kind: 'redeem', voucherId: '5' }, flow);
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  const submit = sent.filter((s) => s.path.endsWith('account/relay')).at(-1);
  assert.match(submit.body, /"deadline":"\d+"/);
  assert.deepEqual(flow.seen[0].destination, { address: GUARANTEE, role: 'GUARANTEE' });
});

// ===========================================================================
// the delivery code — U22, AT6, AT7
// ===========================================================================

await test(['U22', 'AT6', 'AU6'], '9.2, T6 and U6: the delivery code is 20 Crockford symbols (100 bits), typed back forgivingly, and its bytes32 and commitment are the contract’s formula; the relay accepts it and refuses another', async () => {
  assert.ok(code.CODE_BITS >= 96);
  let seed = 0;
  const generated = code.generateDeliveryCode((bytes) => bytes.map(() => (seed = (seed * 97 + 13) % 256)));
  assert.match(generated, /^[0-9A-HJKMNP-TV-Z]{20}$/);
  const real = new Set(Array.from({ length: 50 }, () => code.generateDeliveryCode()));
  assert.equal(real.size, 50, 'codes repeat');
  assert.equal(code.normalizeDeliveryCode(code.groupCode(generated).toLowerCase()), generated);
  assert.equal(code.normalizeDeliveryCode('O1IL-'.repeat(4).slice(0, 23)), null);
  assert.equal(code.normalizeDeliveryCode('0000O0000I0000L00000'), '00000000010000100000');
  const bytes32 = code.codeToBytes32(generated);
  assert.match(bytes32, /^0x[0-9a-f]{64}$/);
  assert.equal(code.commitmentOf(generated), keccak256(encodeAbiParameters([{ type: 'bytes32' }], [bytes32])));
  // The store submits it through the relay, which checks it the contract's way (relay.ts submitCode).
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  chainShows([fx({ id: 8, state: bridgeAbi.OrderState.SHIPPED, mode: 1, payer: buyer.participant, store: shop.creator, codeCommit: code.commitmentOf(generated) })]);
  asParticipant('store-1');
  const ok = await api.call('account/relay', { kind: 'submitCode', orderId: '8', code: code.codeToBytes32(code.groupCode(generated)) });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const wrong = await api.call('account/relay', { kind: 'submitCode', orderId: '8', code: code.codeToBytes32('00000000000000000001') });
  assert.match(wrong.error, /does not match this order/);
});

await test(['U22', 'AT6'], 'H18 and T6: the code stays on the device — the payment carries only its commitment, the code is found again by the order’s commitment and never under another', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer({ mode: 1 });
  asParticipant('participant-1');
  await api.registerAddress({ termsId: '1' }, ADDRESS);
  chain.set({ erc20BalanceOf: 100_000_000n });
  const device = new Map();
  const storage = { getItem: (k) => device.get(k) ?? null, setItem: (k, v) => device.set(k, v) };
  const secret = code.generateDeliveryCode();
  const commitment = code.keepCode(storage, secret);
  const outcome = await runAction({ kind: 'pay', termsId: '1', quantity: 1, codeCommit: commitment }, deps(buyer));
  assert.equal(outcome.status, 'done', JSON.stringify(outcome));
  assert.ok(sent.every((s) => !s.body.includes(secret) && !s.body.includes(code.codeToBytes32(secret).slice(2))), 'the code left the device');
  assert.ok(sent.some((s) => s.body.includes(commitment)), 'the commitment was not sent');
  assert.equal(code.codeFor(storage, commitment), secret);
  assert.equal(code.codeFor(storage, keccak256('0x01')), null);
  device.set(`keptra.delivery-code.${commitment.toLowerCase()}`, '00000000000000000000');
  assert.equal(code.codeFor(storage, commitment), null, 'a code that does not match the commitment is not shown');
});

await test(['U22', 'AT6', 'AT7'], 'T6 and T7: the QR carries the code and nothing else, built by the qrcode library now declared in package.json', () => {
  const secret = code.generateDeliveryCode();
  const symbol = qrSymbol(secret);
  assert.equal(symbol.data, secret);
  assert.ok(symbol.size >= 21 && symbol.path.startsWith(`M${QUIET_ZONE}`));
  assert.match(codeOf('lib/keptra/qr.ts'), /from 'qrcode'/);
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.dependencies.qrcode, '1.5.3');
});

// ===========================================================================
// descriptions — U19, U26, U28, AT4
// ===========================================================================

await test(['AT4', 'U19', 'U26', 'AU6'], 'T4 and U6: the store writes the description of its own offer once; nobody else can, a second write is refused, anyone reads it, and the console lists it', async () => {
  fresh();
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  await person('store-2', '0x4444444444444444444444444444444444444444');
  escrow.set({ readTerms: { ...fx({ id: 1, payer: shop.participant, store: shop.creator }).terms } });
  asParticipant('store-2');
  assert.match((await api.writeDescription({ termsId: '1', title: 'Headphones', text: 'Over-ear.' })).error, /No offer of yours/);
  asParticipant('store-1');
  assert.equal((await api.writeDescription({ termsId: '1', title: 'Wireless headphones', text: 'Over-ear, 30 h battery.\nBlack.' })).ok, true);
  const again = await api.writeDescription({ termsId: '1', title: 'Changed', text: 'Changed.' });
  assert.equal(again.status, 409);
  assert.match(again.error, /cannot be changed/);
  cookie = null;
  const described = await api.offerDescription('1');
  assert.deepEqual([described.title, described.text], ['Wireless headphones', 'Over-ear, 30 h battery.\nBlack.']);
  assert.equal((await api.offerDescription('2')).status, 404);
  cookie = SESSION_COOKIE;
  asParticipant('store-1');
  assert.deepEqual((await api.myOffers()).offers.map((o) => [o.termsId, o.title]), [['1', 'Wireless headphones']]);
  assert.deepEqual(checkDescription({ title: 'Line‮break', text: 'x' }), { ok: false, field: 'title' });
  assert.deepEqual(checkDescription({ title: 'Ok', text: 'y'.repeat(2001) }), { ok: false, field: 'text' });
  assert.deepEqual(checkDescription({ title: 'See https://evil.example', text: 'x' }), { ok: false, field: 'title' });
});

await test(['AT4', 'U28'], 'T4: an obligation’s description goes with the obligation that holds those terms and names its brand; an offer cannot be described as an obligation, nor the reverse', async () => {
  fresh();
  const brand = await person('brand-1', '0x3333333333333333333333333333333333333333');
  escrow.set({ readTerms: { ...fx({ id: 1, payer: brand.participant, store: brand.creator, prize: true }).terms }, readObligation: { brand: brand.creator, termsId: 12n } });
  asParticipant('brand-1');
  assert.match((await api.writeDescription({ termsId: '12', title: 'Bike', text: 'City bike.' })).error, /No offer of yours/, 'prize terms without their obligation');
  assert.match((await api.writeDescription({ termsId: '11', obligationId: '4', title: 'Bike', text: 'City bike.' })).error, /No obligation of yours/);
  assert.equal((await api.writeDescription({ termsId: '12', obligationId: '4', title: 'Bike', text: 'City bike.' })).ok, true);
  assert.equal((await api.myOffers()).offers[0].obligationId, '4');
});

await test(['AT4'], 'T4: the arbiter receives the product description with the evidence', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  escrow.set({ readTerms: { ...fx({ id: 1, payer: buyer.participant, store: shop.creator }).terms } });
  asParticipant('store-1');
  await api.writeDescription({ termsId: '1', title: 'Lamp', text: 'Brass desk lamp.' });
  chainShows([fx({ id: 6, state: bridgeAbi.OrderState.CONTESTED, payer: buyer.participant, store: shop.creator })]);
  await pass();
  const arbiterKey = generatePrivateKey();
  const arbiter = privateKeyToAccount(arbiterKey);
  escrow.set({ escrowArbiter: arbiter.address });
  const issuedAt = Date.now();
  const { arbiterChallenge } = await import('../../../lib/bridge-v2/orders.ts');
  const signature = await arbiter.signMessage({ message: arbiterChallenge(6n, issuedAt) });
  const response = await arbiterRoute.POST(new Request('https://keptra.invalid/api/bridge/v2/arbiter/evidence', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' }, body: JSON.stringify({ orderId: '6', issuedAt, signature }),
  }));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.description, { title: 'Lamp', text: 'Brass desk lamp.' });
});

// ===========================================================================
// erasure — U31, AT13
// ===========================================================================

await test(['AT13', 'U31', 'AU1'], 'T13 and U1: erasure is refused while either account holds USDC, a voucher, or an order open as recipient or as store — and the answer names each; with nothing left it erases', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  asParticipant('participant-1');
  chain.set({ erc20BalanceOf: (token, holder) => (holder.toLowerCase() === buyer.creator.toLowerCase() ? 12_500_000n : 0n) });
  let refused = await api.privacyErase();
  assert.equal(refused.status, 409);
  assert.match(refused.error, /12\.50 USDC/);
  chain.set({ erc20BalanceOf: 0n });
  escrow.set({ voucherBalanceOf: (holder) => (holder.toLowerCase() === buyer.participant.toLowerCase() ? 1n : 0n) });
  refused = await api.privacyErase();
  assert.match(refused.error, /1 voucher\b/);
  escrow.set({ voucherBalanceOf: 0n });
  chainShows([fx({ id: 3, payer: shop.participant, store: buyer.creator })]);
  await pass();
  asParticipant('participant-1');
  refused = await api.privacyErase();
  assert.match(refused.error, /1 open order/, 'an order open as the store counts');
  assert.deepEqual(refused.data.left, { usdc: '0', vouchers: '0', openOrders: 1 });
  chainShows([fx({ id: 3, state: bridgeAbi.OrderState.CLOSED, payer: shop.participant, store: buyer.creator })]);
  await pass();
  asParticipant('participant-1');
  const erased = await api.privacyErase();
  assert.equal(erased.ok, true, JSON.stringify(erased));
});

await test(['AT13', 'U31', 'AU6'], 'T13, P18 and U6: one request erases at most four addresses on the spot, so the route can declare its duration; the rest keep their dates and the answer says so; the export carries the addresses', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  for (let i = 0; i < 6; i += 1) store.insert('bridge_v2_order_addresses', { id: `a-${i}`, participant_id: 'participant-1', terms_id: 1, voucher_id: null, order_id: null, address_enc: 'v1.a.b' });
  asParticipant('participant-1');
  const exported = await api.privacyExport();
  assert.equal(exported.ok, true);
  const erased = await api.privacyErase();
  assert.deepEqual([erased.addressesErased, erased.addressesDeferred], [4, 2]);
  assert.match(erased.deferredNote, /within 30 days/);
  const { ROUTE_MAX_DURATION_SECONDS, CRON_MAX_DURATION_SECONDS } = await import('../../../lib/bridge-v2/config.ts');
  assert.ok(ROUTE_MAX_DURATION_SECONDS['api/bridge/v2/privacy/erase.ts'] <= CRON_MAX_DURATION_SECONDS);
});

// ===========================================================================
// orders in the page — U20, U24, U25, U27, U34
// ===========================================================================

await test(['U20', 'U34'], 'P15 and P19 (U20): the address form’s request is the bridge’s; a country the offer does not deliver to is refused with the bridge’s own sentence, shown as it is', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  asParticipant('participant-1');
  const outside = await api.registerAddress({ termsId: '1' }, { ...ADDRESS, country: 'FR' });
  assert.equal(outside.ok, false);
  assert.equal(outside.error, 'This is not delivered to that country.');
  assert.equal((await api.registerAddress({ termsId: '1' }, ADDRESS)).ok, true);
  assert.equal(store.rows('bridge_v2_order_addresses').length, 1);
});

await test(['U24', 'U27'], 'sections 8 and 9: the page offers each side exactly what the contract accepts in each state — cancel while paid, confirm once shipped, contest inside the window, evidence while contested; the store tracks, ships, submits the code, declares, refunds', () => {
  const base = { flags: 0, mode: 'CARRIER', prize: false, shipBy: String(T0 + 5n * DAY), deliverBy: null, windowEndsAt: null, outcome: null };
  const now = Number(T0);
  const S = bridgeAbi.OrderState;
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.PAID }, now), ['cancelOrder']);
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.SHIPPED }, now), ['confirm']);
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.WINDOW, windowEndsAt: String(T0 + DAY) }, now), ['confirm', 'contest']);
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.WINDOW, windowEndsAt: String(T0 - 1n) }, now), ['confirm']);
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.WINDOW, flags: 2, windowEndsAt: String(T0 + DAY) }, now), ['contest'], 'a refusal window cannot be confirmed');
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.CONTESTED }, now), ['evidence']);
  assert.deepEqual(clientOrders.recipientActions({ ...base, state: S.CLOSED, outcome: 0 }, now), []);
  assert.deepEqual(clientOrders.storeActions({ ...base, state: S.PAID }, now, false), ['tracking', 'refund']);
  assert.deepEqual(clientOrders.storeActions({ ...base, state: S.PAID }, now, true), ['ship', 'refund']);
  assert.deepEqual(clientOrders.storeActions({ ...base, mode: 'OWN_MEANS', state: S.SHIPPED, deliverBy: String(T0 + DAY) }, now, false), ['submitCode', 'declareDelivered', 'declareRefusal', 'refund']);
  assert.deepEqual(clientOrders.storeActions({ ...base, state: S.CLOSED }, now, false), []);
  assert.equal(clientOrders.orderStatusText({ ...base, state: S.CLOSED, outcome: 1 }), 'Closed — refunded to the buyer in full');
});

await test(['U24', 'U25', 'U27'], 'the lists and the evidence through the page: the buyer sees its orders, the store its orders with the address while open, each writes one statement while contested, and the store registers a tracking number', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  await api.registerAddress({ termsId: '1' }, ADDRESS);
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, state: bridgeAbi.OrderState.CONTESTED, payer: buyer.participant, store: shop.creator })]);
  await pass();
  asParticipant('participant-1');
  assert.deepEqual((await api.myOrders()).orders.map((o) => o.orderId).sort(), ['1', '2']);
  assert.equal((await api.orderEvidence('2', 'It never arrived.')).recipient, 'It never arrived.');
  asParticipant('store-1');
  const mine = await api.storeOrders();
  assert.deepEqual(mine.orders.find((o) => o.orderId === '1').address, ADDRESS);
  assert.equal((await api.orderEvidence('2', 'Delivered on the 3rd.')).store, 'Delivered on the 3rd.');
  escrow.set({ readOrders: () => [fx({ id: 1, payer: buyer.participant, store: shop.creator })] });
  const tracked = await api.registerTracking('1', 'AB123456789PT');
  assert.equal(tracked.ok, true, JSON.stringify(tracked));
});

// ===========================================================================
// what the page shows — U19, U29, U35, AT18, AT15, AT14, U32, U33
// ===========================================================================

await test(['U19', 'U5'], 'section 7 and C12 in words: amounts in USDC with their cents, the countries from the escrow’s bytes, the destination named when it is a Keptra contract', () => {
  assert.equal(format.formatUsdc('31000000'), '31.00 USDC');
  assert.equal(format.formatUsdc(1_234_567_891n), '1,234.567891 USDC');
  assert.equal(format.parseUsdc('12.5'), 12_500_000n);
  assert.equal(format.parseUsdc('1.1234567'), null);
  assert.deepEqual(format.decodeRegions('0x505445534652'), ['PT', 'ES', 'FR']);
  assert.equal(format.countryName('PT'), 'Portugal');
  const words = format.summaryWords({ action: 'redeem', amounts: [{ kind: 'NFT', token: contracts.KEPTRA_VOUCHER, tokenIds: ['5'] }], destination: { address: '0x1111111111111111111111111111111111111111', role: 'GUARANTEE' } });
  assert.deepEqual([words.action, words.amounts[0], words.destination.words], ['Redeem your voucher', 'voucher #5', 'held by the Keptra guarantee contract']);
  // Every condition of section 7 is a row of the offer page.
  const page = codeOf('pages/keptra/OfferPage.tsx');
  for (const label of ['Price per unit', 'Shipping, per order', 'Return cost, if refused', 'Refusal fee', 'Delivered by', 'Ships within', 'Arrives within', 'Delivers to', 'Store payout address']) {
    assert.ok(page.includes(`'${label}'`), `the offer page does not show ${label}`);
  }
});

await test(['U35', 'AT18'], 'Q1 and T18: the page’s contract addresses are config.ts’s literals — zero until the deploy, so every Keptra screen says “not available yet” — and its ABIs are the bridge’s own objects', () => {
  assert.deepEqual([contracts.KEPTRA_ESCROW, contracts.KEPTRA_GUARANTEE, contracts.KEPTRA_VOUCHER], [REAL_KEPTRA.escrow, REAL_KEPTRA.guarantee, REAL_KEPTRA.voucher]);
  assert.equal(contracts.keptraConfigured(), false);
  assert.equal(contracts.KEPTRA_ESCROW_ABI, bridgeAbi.KEPTRA_ESCROW_ABI);
  assert.equal(contracts.KEPTRA_GUARANTEE_ABI, bridgeAbi.KEPTRA_GUARANTEE_ABI);
  for (const page of ['OfferPage', 'OrdersPage', 'OrderPage', 'VoucherPage', 'BusinessPage', 'PoolPage']) {
    assert.match(codeOf(`pages/keptra/${page}.tsx`), /keptraConfigured\(\)[\s\S]*NotAvailable/, `${page} does not stop while unconfigured`);
  }
});

await test(['AT12'], 'T12: what left this build has no screen — no second passkey, no recovery started from the page, no guardian revocation, no creator campaign by passkey, no voucher transfer', () => {
  const pages = [...readdirSync(`${root}pages/keptra`).map((n) => `pages/keptra/${n}`), ...readdirSync(`${root}components/keptra`).map((n) => `components/keptra/${n}`), 'pages/EventDetail.tsx'];
  for (const path of pages) {
    const text = codeOf(path);
    for (const kind of ['addPasskey', 'revokeGuardian', 'createCampaign']) assert.ok(!text.includes(`kind: '${kind}'`), `${path} offers ${kind}`);
    assert.ok(!text.includes("'account/recovery'"), `${path} starts a recovery`);
  }
  assert.ok(!/call<[^>]*>\('account\/recovery'/.test(codeOf('lib/keptra/api.ts')));
});

await test(['U29', 'U30', 'AT15'], '12.7 and T15: every figure the pool panel and the tier read is a function the 183a2b4 contracts have — capital, coverage, capacity, utilisation, reserve, fees, losses, shares, debts; the escrow’s ceilings', () => {
  const fixture = JSON.parse(read('test/bridge-v2/fork/keptra-183a2b4.json'));
  const has = (contract, abi) => {
    for (const item of abi.filter((entry) => entry.type === 'function')) {
      const signature = toFunctionSignature(item).replace(/\s/g, '');
      assert.ok(signature in fixture.contracts[contract].methodIdentifiers, `${contract} has no ${signature}`);
    }
  };
  has('KeptraPool', contracts.POOL_READ_ABI);
  has('KeptraGuarantee', contracts.GUARANTEE_READ_ABI);
  has('KeptraEscrow', contracts.ESCROW_READ_ABI);
  assert.match(codeOf('pages/keptra/OfferPage.tsx'), /useTier\(terms\?\.store/);
  assert.match(codeOf('components/keptra/hooks.ts'), /functionName: 'tierOf'/);
});

await test(['AT14', 'U32'], 'T14: the privacy page is a route with the owner’s text — empty today — and every address form is locked while it is empty', () => {
  assert.equal(PRIVACY_TEXT, '');
  assert.equal(privacyPublished(), false);
  assert.equal(privacyPublished('Keptra keeps…'), true);
  const form = codeOf('components/keptra/AddressForm.tsx');
  assert.ok(form.indexOf('if (!privacyPublished())') < form.indexOf('<form'), 'the form renders before the check');
  assert.match(codeOf('App.tsx'), /path="\/privacy"/);
});

await test(['U33'], 'H20 and I2: a pause stops the payment on the offer page; the redemption page does not stop on it', () => {
  assert.match(codeOf('pages/keptra/OfferPage.tsx'), /paused \?/);
  assert.ok(!/paused/.test(codeOf('pages/keptra/VoucherPage.tsx')));
});

// ===========================================================================
// domain, language, routes — U2, U3, U4, AT9, AT17, AT0, AT21, U36, U37, AT3
// ===========================================================================

const CLIENT_FILES = () => {
  const out = ['App.tsx', 'constants.ts', 'index.html', 'public/manifest.webmanifest'];
  for (const dir of ['pages', 'pages/keptra', 'components', 'components/keptra', 'lib/keptra']) {
    for (const name of readdirSync(`${root}${dir}`)) if (!statSync(`${root}${dir}/${name}`).isDirectory()) out.push(`${dir}/${name}`);
  }
  return out;
};

await test(['U2', 'AT9', 'AU4'], 'T9 and U4: the app is Keptra at keptra.io — the pages of instntwin.com redirect there and its /api stays; no client file and no notice names the old domain; the title, the manifest and the previews say Keptra', () => {
  const vercel = JSON.parse(read('vercel.json'));
  for (const host of ['instntwin.com', 'www.instntwin.com']) {
    const rule = vercel.redirects.find((r) => r.has?.[0]?.value === host);
    assert.ok(rule, `${host} does not redirect`);
    assert.equal(rule.destination, 'https://keptra.io/:path');
    assert.equal(rule.permanent, true);
    assert.match(rule.source, /\(\?!api\/\)/, `${host} redirects /api too`);
  }
  for (const path of CLIENT_FILES()) assert.ok(!read(path).includes('instntwin.com'), `${path} still names instntwin.com`);
  assert.ok(!codeOf('lib/bridge-v2/mail.ts').includes('instntwin'), 'a notice still links to the old domain');
  assert.match(read('index.html'), /<title>Keptra — /);
  assert.equal(JSON.parse(read('public/manifest.webmanifest')).name, 'Keptra');
  assert.match(read('api/og/event.ts'), /const SITE = 'https:\/\/keptra\.io'/);
  assert.match(read('api/og/event.ts'), /og:site_name" content="Keptra"/);
});

await test(['U3'], 'every link a notice carries lands on a route of the app: /events/:id, /account, /orders/:id and /store/orders/:id', () => {
  const routes = [...read('App.tsx').matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  const mail = codeOf('lib/bridge-v2/mail.ts');
  const links = [...mail.matchAll(/\$\{KEPTRA_BASE\}(\/[a-z/]+)/g)].map((m) => m[1]);
  assert.ok(links.length >= 4, 'the notices name fewer pages than expected');
  const toRoute = (link) => (link.endsWith('/') ? `${link}:id` : link);
  for (const link of links) {
    const wanted = toRoute(link);
    assert.ok(routes.some((route) => route === wanted || route.replace(/:\w+$/, ':id') === wanted), `${link} has no page`);
  }
});

await test(['U4', 'AT0'], 'section 0: nothing the pages say calls Keptra insurance or promises a yield — in the new screens, the Event Center and the three languages', () => {
  const forbidden = /\b(insurance|insured|insurer|yield|yields|interest rate|seguro|seguradora|rendimento|rendimiento)\b/i;
  const files = [...CLIENT_FILES().filter((p) => /\.(tsx|ts)$/.test(p)), 'index.html', 'api/og/event.ts'];
  for (const path of files) {
    const strings = [...codeOf(path).matchAll(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`[^`]*`|>([^<>{}]+)</g)].map((m) => m[0]);
    for (const text of strings) assert.ok(!forbidden.test(text), `${path}: ${text.slice(0, 80)}`);
  }
});

await test(['AT17', 'AU3'], 'T17 and U3: the new screens are in English; what changed in the Event Center is in all three languages, key for key', async () => {
  for (const name of readdirSync(`${root}pages/keptra`)) assert.ok(!/useLang|i18n/.test(codeOf(`pages/keptra/${name}`)), `${name} is translated`);
  const source = read('pages/events.i18n.ts');
  // The three languages' blocks (string values); the interface's block holds types, not text.
  const blocks = [...source.matchAll(/ {4}keptra: \{([\s\S]*?) {4}\},?/g)].filter((m) => m[1].includes("'")).map((m) => [...m[1].matchAll(/^\s+(\w+): '/gm)].map((k) => k[1]));
  assert.equal(blocks.length, 3, 'not three languages');
  assert.deepEqual(blocks[1], blocks[0]);
  assert.deepEqual(blocks[2], blocks[0]);
});

await test(['AT21', 'AT0'], 'T21 and T0: the frame uses the computer’s width and folds for a phone — a wide container, a menu with finger-sized links, no action only on a hover; every screen has its loading, empty and error states', () => {
  const shell = codeOf('components/keptra/KeptraShell.tsx');
  assert.match(shell, /max-w-7xl/);
  assert.match(shell, /aria-expanded=\{open\}/);
  assert.match(shell, /min-h-\[44px\]/);
  assert.match(codeOf('components/keptra/ui.tsx'), /min-h-\[48px\]/);
  for (const page of ['OfferPage', 'OrdersPage', 'OrderPage', 'VoucherPage', 'BusinessPage', 'PoolPage', 'AccountPage']) {
    const text = codeOf(`pages/keptra/${page}.tsx`);
    assert.ok(/Loading|RequireAccount/.test(text) && /Empty|Notice/.test(text), `${page} lacks a loading or an empty/error state`);
  }
});

await test(['U36'], 'A11 and A12: the flows of the earlier wallets stay — the destination form of a derived wallet’s prize, the self-custody advice', () => {
  const detail = codeOf('pages/EventDetail.tsx');
  assert.match(detail, /<PrizePanel giveawayId=\{giveawayId\} custody=/);
  assert.match(detail, /proposeDestination\(/);
  assert.match(detail, /c\.wonBodySelf/);
});

await test(['U37', 'AT7', 'AU5'], '19, T7 and U5: the one dependency added is the QR library Adenda T declares; nothing else joins the manifest', () => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const main = JSON.parse(git('show', 'main:package.json'));
  const branch = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(branch.dependencies).filter((name) => !(name in main.dependencies)), ['qrcode']);
  assert.deepEqual(branch.devDependencies, main.devDependencies);
});

await test(['AT3'], 'T3: the bridge changed only where Adenda T allows it (and the owner’s answers of 22/09 extended it): account status and vouchers, the relay’s summary, ids and USDC transfer, the descriptions, the erasure refusal, the public domain', () => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const changed = git('diff', '--name-only', 'd56f499', '--', 'api', 'lib/bridge-v2', 'lib/campaign-identity.ts', 'supabase').trim().split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'api', 'lib/bridge-v2', 'supabase').trim().split('\n').filter(Boolean);
  const allowed = new Set([
    'api/bridge/v2/account/status.ts', 'api/bridge/v2/account/vouchers.ts', // T3: the account's state
    'api/bridge/v2/account/relay.ts', 'lib/bridge-v2/relay.ts', 'lib/bridge-v2/escrowChain.ts', 'lib/bridge-v2/abi.ts', // T2, T5, U17
    'api/bridge/v2/offer/description.ts', 'api/bridge/v2/store/description.ts', 'api/bridge/v2/store/offers.ts', 'lib/bridge-v2/descriptions.ts', 'supabase/migrations/0014_keptra_descriptions.sql', 'api/bridge/v2/arbiter/evidence.ts', 'lib/campaign-identity.ts', // T4
    'api/bridge/v2/privacy/erase.ts', 'lib/bridge-v2/orders.ts', // T13
    'lib/bridge-v2/mail.ts', 'api/og/event.ts', // T9
    'lib/bridge-v2/accounts.ts', 'lib/bridge-v2/participants.ts', 'lib/bridge-v2/config.ts', 'lib/bridge-v2/log.ts', // the reads and declarations those need
    'api/bridge/v2/store/orders.ts', // Adenda V1: whether the tracking number is registered
    'api/bridge/v2/order/address.ts', // Adenda V5 (B3): no address before the privacy page has its text
  ]);
  for (const path of [...changed, ...untracked]) assert.ok(allowed.has(path), `${path} changed outside Adenda T`);
});

await test(['AT10', 'AT11', 'AU6'], 'T10, T11 and U6: the arbiter and the pool’s provider act from the terminal, with written instructions that name the real calls and hold no key', () => {
  const arbiter = read('docs/keptra/ARBITER.md');
  for (const needle of ['arbiter/evidence', 'decide(uint256,bool,uint8,bytes32)', 'Keptra arbiter: read the evidence of order', 'NOT_AS_DESCRIBED']) assert.ok(arbiter.includes(needle), needle);
  const provider = read('docs/keptra/POOL-PROVIDER.md');
  for (const needle of ['deposit(uint256,address)', 'requestWithdraw(uint256)', 'cancelWithdraw(uint256)', 'processQueue(uint256)', 'defaultSource()']) assert.ok(provider.includes(needle), needle);
  for (const text of [arbiter, provider]) assert.ok(!/0x[0-9a-fA-F]{64}/.test(text), 'a 32-byte hex value in the instructions');
});

// ===========================================================================
// Adenda V — the corrections of the audit of piece 6 (AVn)
// ===========================================================================

await test(['AV1', 'U27'], 'V1 (A1): once the tracking number is registered the store can always declare the shipment — after reloading the page, in another session, from the notice’s link, after an answer that never arrived; the console passes the bridge’s answer to storeActions (checked in the page’s source)', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  await api.registerAddress({ termsId: '1' }, ADDRESS);
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  await pass();
  const now = Number(T0);
  // What a freshly loaded console has: nothing of its own, only the bridge's list (store/orders) and the page's rule.
  const consoleActions = async (orderId = '1') => {
    const listed = await api.storeOrders();
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const order = listed.orders.find((o) => o.orderId === orderId);
    return clientOrders.storeActions(order, now, order.trackingRegistered);
  };
  asParticipant('store-1');
  assert.deepEqual(await consoleActions(), ['tracking', 'refund']);
  assert.equal((await api.registerTracking('1', 'AB123456789PT')).ok, true);
  // The page is reloaded: the registration survives only in the bridge, and the console now offers to ship.
  assert.deepEqual(await consoleActions(), ['ship', 'refund']);
  // Another session of the same store — another device, or the notice's link to /store/orders/1.
  db.on('bridge_v2_sessions:select', () => ({
    data: { id: 'another-session', participant_id: 'store-1', idle_expires_at: new Date(Date.now() + 60_000).toISOString(), absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null },
    error: null,
  }));
  assert.deepEqual(await consoleActions(), ['ship', 'refund']);
  // The answer to the registration never arrived, so the store types the number again: the bridge refuses a second
  // registration, and the order still ships.
  const again = await api.registerTracking('1', 'AB123456789PT');
  assert.equal(again.status, 409);
  assert.deepEqual(await consoleActions(), ['ship', 'refund']);
  const shipped = await runAction({ kind: 'ship', orderId: '1' }, deps(shop));
  assert.equal(shipped.status, 'done', JSON.stringify(shipped));
  const shipCall = kchain.calls.filter((c) => c.name === 'sendRelayed').at(-1);
  const hash = store.rows('bridge_v2_order_shipments')[0].tracking_hash;
  assert.ok(JSON.stringify(shipCall.args, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)).toLowerCase().includes(hash.slice(2).toLowerCase()), 'ship() does not carry the registered hash');
  // The console reads it from the bridge, and keeps no flag of its own.
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(page, /storeActions\(order, now, order\.trackingRegistered\)/);
  assert.ok(!/setTracked|useState\(false\);\s*\n\s*const \[input/.test(page), 'the console still remembers the registration itself');
});

await test(['AV2', 'AT0'], 'V2 (A2), from the source and Tailwind’s own palette: every text colour the new screens use reaches 4.5:1 on the lightest ground they sit on (the input and card greys; black text on the brand amber)', async () => {
  const { default: palette } = await import('tailwindcss/colors.js');
  const config = (await import('../../../tailwind.config.js')).default.theme.extend.colors;
  const hex = (token) => {
    const [name, shade] = token.split('-');
    if (name === 'white') return '#ffffff';
    if (name === 'black') return '#000000';
    if (config[name]) return typeof config[name] === 'string' ? config[name] : config[name][shade ?? 'DEFAULT'];
    return palette[name]?.[shade];
  };
  const luminance = (color) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const files = [...readdirSync(`${root}pages/keptra`).map((n) => `pages/keptra/${n}`), ...readdirSync(`${root}components/keptra`).map((n) => `components/keptra/${n}`)];
  const seen = new Map();
  for (const path of files) {
    for (const m of codeOf(path).matchAll(/(?<![\w-])(?:(?:placeholder|disabled|aria-busy):)?text-((?:gray|red|green|amber|brand|success|white|black)(?:-\d{2,3})?)(?![\w/-])/g)) {
      if (!seen.has(m[1])) seen.set(m[1], path);
    }
  }
  assert.ok(seen.has('gray-400') && seen.has('white'), 'the scan found no text colours');
  for (const [token, path] of seen) {
    const color = hex(token);
    assert.ok(color, `${token} (${path}) is not in the palette`);
    if (token === 'black') {
      assert.ok(ratio(color, config.brand.DEFAULT) >= 4.5, 'black on the brand amber');
      continue;
    }
    const worst = Math.min(ratio(color, config.dark.input), ratio(color, config.dark.card));
    assert.ok(worst >= 4.5, `${token} in ${path}: ${worst.toFixed(2)}:1`);
  }
  assert.ok(ratio(palette.gray[500], config.dark.card) < 4.5, 'the check would not catch gray-500, the colour the audit measured');
});

await test(['AV3'], 'V3 (A3): a read that fails comes out as a failed read with the bridge’s own sentence and a retry — never as an empty list; the same read, asked again once the bridge answers, is the list', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  asParticipant('participant-1');
  await api.registerAddress({ termsId: '1' }, ADDRESS);
  chainShows([fx({ id: 1, payer: buyer.participant, store: '0x7777777777777777777777777777777777777777' })]);
  await pass();
  asParticipant('participant-1');
  const limited = () => db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: false, retry_after_seconds: 30 }], error: null }));
  const open = () => db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
  limited();
  for (const [what, read] of [['order/list', api.myOrders], ['account/vouchers', api.accountVouchers], ['store/offers', api.myOffers], ['store/orders', api.storeOrders]]) {
    const state = reads.fromBridge(await read());
    assert.equal(state.status, 'failed', `${what} did not fail`);
    assert.equal(state.error, 'Too many requests. Please wait and try again.', what);
  }
  open();
  const again = reads.fromBridge(await api.myOrders());
  assert.equal(again.status, 'ready');
  assert.deepEqual(again.value.orders.map((o) => o.orderId), ['1']);
  // A bridge that does not answer at all is a failed read too, in the page's own words.
  api.setFetch(async () => {
    throw new TypeError('fetch failed');
  });
  try {
    const lost = reads.fromBridge(await api.myOrders());
    assert.deepEqual(lost, { status: 'failed', error: 'The network did not answer. Check your connection and try again.' });
  } finally {
    api.setFetch(bridgeFetch);
  }
});

await test(['AV3'], 'V3 (A3): a chain read that fails is a failed read — the whole query, or one call of a batch — while a call the contract reverted is the chain’s answer (an offer id the escrow never issued); the error objects are shaped as viem nests them', () => {
  const ok = { status: 'success', result: 1n };
  const revert = { status: 'failure', error: { name: 'ContractFunctionExecutionError', cause: { name: 'ContractFunctionRevertedError' } } };
  const noAnswer = { status: 'failure', error: { name: 'ContractFunctionExecutionError', cause: { name: 'HttpRequestError', cause: { name: 'TypeError' } } } };
  assert.equal(reads.chainFailed({ isLoading: false, isError: true }), true);
  assert.equal(reads.chainFailed({ isLoading: false, isError: false, data: [ok, noAnswer] }), true);
  assert.equal(reads.chainFailed({ isLoading: false, isError: false, data: [ok, ok] }), false);
  assert.equal(reads.reverted(revert.error), true);
  assert.equal(reads.reverted(noAnswer.error), false);
  assert.equal(reads.reverted(null), false);
  assert.deepEqual(reads.chainRead([{ isLoading: false, isError: false, data: [noAnswer] }], () => 1), { status: 'failed', error: reads.CHAIN_FAILED });
  assert.deepEqual(reads.chainRead([{ isLoading: true, isError: false }], () => 1), reads.LOADING);
  assert.deepEqual(reads.chainRead([{ isLoading: false, isError: false, data: [ok] }], () => 7), { status: 'ready', value: 7 });
  // The offer page's rule: "no offer at this link" only on the revert, an error with "Try again" on anything else.
  assert.match(codeOf('components/keptra/hooks.ts'), /const unknownId = terms\?\.status === 'failure' && reverted\(terms\.error\);\s*\n[\s\S]*failed: enabled && !unknownId && chainFailed\(result\)/);
});

await test(['AV3', 'AT0'], 'V3 (A3), reading the source of the new screens: no failed read is turned into an empty list or an unread fact — no “ok ? … : []”, no events .catch into an empty list, the offer page says “no offer” only when the read did not fail; every screen that reads has ReadError', () => {
  const files = [...readdirSync(`${root}pages/keptra`).map((n) => `pages/keptra/${n}`), ...readdirSync(`${root}components/keptra`).map((n) => `components/keptra/${n}`)];
  for (const path of files) {
    const text = codeOf(path);
    assert.ok(!/\.ok \?[^;]*: \[\]/.test(text), `${path} turns a refusal into an empty list`);
    assert.ok(!/\.catch\(\(\) => set\w+\(\[\]\)\)/.test(text), `${path} turns a failed chain read into an empty list`);
    assert.ok(!/could not be read\. Try again shortly/.test(text), `${path} says a read failed without a way to try again`);
  }
  for (const page of ['OfferPage', 'OrdersPage', 'OrderPage', 'VoucherPage', 'BusinessPage', 'PoolPage', 'AccountPage']) {
    assert.match(codeOf(`pages/keptra/${page}.tsx`), /<ReadError/, `${page} has no error state for a failed read`);
  }
  assert.match(codeOf('pages/keptra/OfferPage.tsx'), /!loading && !failed && \(terms === null \|\| terms\.prize\)/);
  assert.match(codeOf('components/keptra/SignIn.tsx'), /statusError/);
  assert.match(codeOf('components/keptra/KeptraProvider.tsx'), /result\.status === 401/);
});

await test(['AV4', 'AT2'], 'V4 (A4): a token that is not USDC comes in the bridge’s summary with its own decimals and symbol, read from the token, and the sheet writes “1.50 WETH”; a token that does not state its decimals gets no figure at all; USDC is as before', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  asParticipant('participant-1');
  chain.set({ claimableFor: 1_500_000_000_000_000_000n, readGiveaway: { ...chain.behaviour.readGiveaway, feeToken: WETH }, erc20Meta: { symbol: 'WETH', decimals: 18 } });
  const claim = await api.call('account/relay', { kind: 'claim', giveawayId: '9' });
  assert.equal(claim.ok, true, JSON.stringify(claim));
  assert.deepEqual(claim.summary.amounts, [{ kind: 'ERC20', token: WETH, value: '1500000000000000000', meta: { symbol: 'WETH', decimals: 18 } }]);
  assert.deepEqual(chain.calls.filter((c) => c.name === 'erc20Meta').map((c) => c.args[0]), [WETH]);
  assert.equal(format.summaryWords(claim.summary).amounts[0], '1.50 WETH');
  chain.set({ erc20Meta: null });
  const silent = await api.call('account/relay', { kind: 'claim', giveawayId: '9' });
  assert.equal(silent.summary.amounts[0].meta, null);
  const words = format.summaryWords(silent.summary).amounts[0];
  assert.ok(!/\d{3,}/.test(words), `a figure was shown without the token's decimals: ${words}`);
  assert.match(words, /cannot be shown/);
  // USDC: config.ts's decimals, and no read of the token.
  chain.set({ readGiveaway: { ...chain.behaviour.readGiveaway, feeToken: USDC }, claimableFor: 25_000_000n });
  const calls = chain.calls.length;
  const usdc = await api.call('account/relay', { kind: 'claim', giveawayId: '9' });
  assert.deepEqual(usdc.summary.amounts, [{ kind: 'ERC20', token: USDC, value: '25000000' }]);
  assert.equal(chain.calls.slice(calls).filter((c) => c.name === 'erc20Meta').length, 0);
  assert.equal(format.summaryWords(usdc.summary).amounts[0], '25.00 USDC');
});

await test(['AV5'], 'V5 (B1): the signing sheet holds the focus — Tab past the last control goes to the first, Shift+Tab before the first to the last, focus from outside comes back in — and gives it back to the opener, which a busy button keeps (checked in the source)', () => {
  const [a, b, c] = ['cancel', 'arbiscan', 'sign'].map((name) => ({ name }));
  const controls = [a, b, c];
  assert.equal(focus.trapTarget(controls, c, false), a);
  assert.equal(focus.trapTarget(controls, a, true), c);
  assert.equal(focus.trapTarget(controls, b, false), null, 'inside the sheet the browser moves on');
  assert.equal(focus.trapTarget(controls, b, true), null);
  assert.equal(focus.trapTarget(controls, { name: 'the page behind' }, false), a);
  assert.equal(focus.trapTarget(controls, null, true), c);
  assert.equal(focus.trapTarget([], a, false), null);
  const provider = codeOf('components/keptra/KeptraProvider.tsx');
  assert.match(provider, /trapTarget\(controls,/);
  assert.match(provider, /opener\?\.focus\(\)/);
  assert.match(provider, /tabIndex=\{-1\} aria-label="Cancel"/, 'the backdrop is in the tab order');
  const ui = codeOf('components/keptra/ui.tsx');
  assert.ok(!/disabled=\{rest\.disabled \|\| busy\}/.test(ui), 'a busy button is disabled and loses the focus');
  assert.match(ui, /aria-disabled=\{busy \|\| undefined\}/);
});

await test(['AV5', 'AT14', 'U32'], 'V5 (B3): the bridge refuses a delivery address while the privacy page has no text — the owner’s text, empty today — and takes it once the page has one', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  asParticipant('participant-1');
  const published = BRIDGE_PRIVACY_TEXT;
  setPrivacyText(REAL_PRIVACY_TEXT);
  try {
    assert.equal(REAL_PRIVACY_TEXT, PRIVACY_TEXT, 'the double does not hold the real text');
    const refused = await api.registerAddress({ termsId: '1' }, ADDRESS);
    assert.equal(refused.status, 503);
    assert.match(refused.error, /privacy page is published/);
    assert.equal(store.rows('bridge_v2_order_addresses').length, 0);
  } finally {
    setPrivacyText(published);
  }
  assert.equal((await api.registerAddress({ termsId: '1' }, ADDRESS)).ok, true);
  assert.equal(store.rows('bridge_v2_order_addresses').length, 1);
  assert.match(read('lib/bridge-v2/config.ts'), /export \{ PRIVACY_TEXT \} from '\.\.\/keptra\/privacy\.js';/, 'the bridge reads another copy of the text');
});

await test(['AV5', 'U24'], 'V5 (B7): each order’s next deadline is written the same on every width — ship-by while paid, the window while it runs, arrive-by after shipping, none once closed — and the list does not hide it on a phone (checked in the source)', () => {
  const now = Number(T0);
  const S = bridgeAbi.OrderState;
  const base = { shipBy: String(T0 + 3n * DAY), deliverBy: String(T0 + 10n * DAY), windowEndsAt: String(T0 + 5n * DAY) };
  assert.equal(clientOrders.nextDeadlineText({ ...base, state: S.PAID }, now), 'Next deadline in 3 days');
  assert.equal(clientOrders.nextDeadlineText({ ...base, state: S.SHIPPED }, now), 'Next deadline in 10 days');
  assert.equal(clientOrders.nextDeadlineText({ ...base, state: S.WINDOW }, now), 'Next deadline in 5 days');
  assert.equal(clientOrders.nextDeadlineText({ ...base, state: S.SHIPPED, deliverBy: null }, now), null);
  assert.equal(clientOrders.nextDeadlineText({ ...base, state: S.CLOSED }, now), null);
  const list = codeOf('pages/keptra/OrdersPage.tsx');
  const cell = list.match(/<span className="([^"]*)">\{deadline \?\? ''\}<\/span>/);
  assert.ok(cell, 'the list does not show nextDeadlineText');
  assert.ok(!/(^|\s)hidden(\s|$)/.test(cell[1]), `the deadline is hidden on a phone: ${cell[1]}`);
});

await test(['AV5', 'AT4'], 'V5 (B9): an offer whose description failed after it was published gets that description written — the retry writes it, an answer lost on the way shows as written — and the page then offers no second publication (checked in the source)', async () => {
  fresh();
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  escrow.set({ readTerms: { ...fx({ id: 1, payer: shop.participant, store: shop.creator }).terms } });
  asParticipant('store-1');
  const entry = { termsId: '1', title: 'Desk lamp', text: 'Brushed brass.' };
  // The first write never reaches the bridge.
  api.setFetch(async () => {
    throw new TypeError('fetch failed');
  });
  let first;
  try {
    first = await api.writeDescription(entry);
  } finally {
    api.setFetch(bridgeFetch);
  }
  assert.equal(first.ok, false);
  assert.equal((await api.writeDescription(entry)).ok, true, 'the retry of that offer’s description was refused');
  // Written, but its answer lost: a second retry is refused as already written, and the description is there to read.
  const lostAnswer = await api.writeDescription(entry);
  assert.equal(lostAnswer.status, 409);
  assert.equal((await api.offerDescription('1')).ok, true);
  assert.deepEqual((await api.myOffers()).offers.map((o) => o.termsId), ['1']);
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(page, /written\.status === 409 && \(await offerDescription\(termsId\)\)\.ok/);
  assert.match(page, /\{unwritten \? \(\s*<div className="mt-5">\s*<DescriptionRetry what="Offer"/, 'the offer form can publish again while a description is missing');
  assert.match(page, /\{unwritten \? \(\s*<div className="mt-5">\s*<DescriptionRetry\s+what="Obligation"/, 'the obligation form can create again while a description is missing');
});

await test(['AV5', 'U17'], 'V5 (B11): USDC is never sent to a contract of the platform — the escrow, the guarantee, the voucher, the reputation and the pool the chain names, the USDC contract, the draws’ core; when the chain cannot name the two, nothing is signed', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  asParticipant('participant-1');
  chain.set({ erc20BalanceOf: 5_000_000n });
  const [reputation, pool] = ['0x00000000000000000000000000000000ee7a0001', '0x00000000000000000000000000000000ee7a0002'];
  escrow.set({ keptraPeripherals: [reputation, pool] });
  const { GIVEAWAY_MANAGER_V2 } = await import('../../../lib/bridge-v2/config.ts');
  const send = (to) => api.call('account/relay', { kind: 'transferUsdc', to, amount: '1000000' });
  for (const to of [ESCROW, GUARANTEE, VOUCHER, reputation, pool, USDC, GIVEAWAY_MANAGER_V2]) {
    const refused = await send(to.toLowerCase());
    assert.equal(refused.ok, false, `${to} was accepted`);
    assert.match(refused.error, /contract of the platform/, to);
  }
  assert.equal((await send('0x9999999999999999999999999999999999999999')).ok, true);
  escrow.set({ keptraPeripherals: new Error('node down') });
  assert.match((await send('0x9999999999999999999999999999999999999999')).error, /cannot be checked right now/);
});

await test(['AV6'], 'V6: what the audit listed as excess is gone — the client’s ABI entries and re-exports, account/status’s recovery and deployed, the descriptions’ createdAt, the feeBps and paused reads, the captures and brand.mjs, the dead voids — and account/vouchers keeps complete (P6-11)', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  const names = (abi) => abi.map((item) => item.name);
  assert.ok(!names(contracts.ESCROW_READ_ABI).some((n) => ['CONTEST_WINDOW', 'guarantee'].includes(n)));
  assert.ok(!names(contracts.GUARANTEE_READ_ABI).includes('obligationCount'));
  assert.ok(!names(contracts.POOL_READ_ABI).some((n) => ['freeWithdrawCapacity', 'convertToAssets', 'DebtRepaid'].includes(n)));
  assert.ok(!('OrderMode' in contracts) && !('OrderOutcome' in contracts));
  const status = await api.accountStatus();
  assert.equal(status.ok, true);
  assert.ok(!('recovery' in status), 'account/status still answers recovery');
  assert.ok(status.accounts.every((account) => !('deployed' in account)), 'account/status still answers deployed');
  escrow.set({ readTerms: { ...fx({ id: 1, payer: '0x2222222222222222222222222222222222222222', store: status.accounts.find((a) => a.role === 'CREATOR').address }).terms } });
  assert.equal((await api.writeDescription({ termsId: '1', title: 'Lamp', text: 'Brass.' })).ok, true);
  assert.ok(!('createdAt' in (await api.offerDescription('1'))));
  assert.ok(!('createdAt' in (await api.myOffers()).offers[0]));
  assert.ok('complete' in (await api.accountVouchers()), 'account/vouchers lost complete');
  assert.ok(!/feeBps/.test(codeOf('pages/keptra/OfferPage.tsx')) && !/functionName: 'feeBps'/.test(codeOf('components/keptra/hooks.ts')));
  assert.ok(!/functionName: 'paused'/.test(codeOf('pages/keptra/BusinessPage.tsx')));
  assert.equal(existsSync(`${root}test/preview/screens`), false, 'the captures are still in the repository');
  assert.equal(existsSync(`${root}test/preview/brand.mjs`), false);
  assert.ok(!/void (?:termsId|other|decodeFunctionData);/.test(read('test/bridge-v2/suites/frontend.test.mjs')));
});

// ===========================================================================
// migration 0014, executed — AT4
// ===========================================================================

let engine = null;
try {
  await bootEngine();
  engine = await createDatabase('bridge_v2_frontend', { withCitext: true });
  for (const file of ['0004_bridge_v2_schema.sql', '0005_bridge_v2_functions.sql', '0006_bridge_v2_grants.sql', '0007_bridge_v2_routes.sql', '0010_bridge_v2_outcomes.sql', '0011_campaign_identity.sql', '0012_keptra_accounts.sql', '0013_keptra_orders.sql', '0014_keptra_descriptions.sql']) {
    const applied = await applyMigration(engine, file);
    if (!applied.ok) throw new Error(`${file} did not apply: ${applied.at} ${applied.text}`);
  }
  const again = await applyMigration(engine, '0014_keptra_descriptions.sql');
  if (!again.ok) throw new Error(`0014 is not idempotent: ${again.at} ${again.text}`);
} catch (error) {
  await test(['AT4'], 'migration 0014 applies after 0004 to 0013, twice', () => {
    throw error;
  });
  engine = null;
}

if (engine !== null) {
  const q = (text, values) => sql(engine, text, values);
  await test(['AT4'], '0014: a description is written once and never changed — the service holds INSERT and SELECT only, RLS is on, the browser roles hold nothing, one row per set of terms, the limits of the form', async () => {
    const granted = await q(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS verbs FROM information_schema.role_table_grants WHERE table_name = 'bridge_v2_offer_descriptions' AND grantee = 'service_role'`);
    assert.equal(granted.rows[0].verbs, 'INSERT,SELECT');
    for (const role of ['anon', 'authenticated']) {
      const any = await q(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name = 'bridge_v2_offer_descriptions' AND grantee = $1`, [role]);
      assert.equal(any.rows[0].n, 0);
    }
    assert.equal((await q(`SELECT relrowsecurity FROM pg_class WHERE relname = 'bridge_v2_offer_descriptions'`)).rows[0].relrowsecurity, true);
    const insert = (terms, title, body) => attempt(engine.pool, `INSERT INTO bridge_v2_offer_descriptions (terms_id, store_address, title, body) VALUES ($1, '0x3333333333333333333333333333333333333333', $2, $3)`, [terms, title, body]);
    assert.equal((await insert(1, 'Lamp', 'Brass.')).ok, true);
    assert.equal((await insert(1, 'Other', 'Other.')).code, '23505');
    assert.equal((await insert(2, 'x'.repeat(121), 'Brass.')).code, '23514');
    assert.equal((await insert(3, 'Two\nlines', 'Brass.')).code, '23514');
    const update = await asRole(engine, 'service_role', (client) => client.query(`UPDATE bridge_v2_offer_descriptions SET title = 'Changed' WHERE terms_id = 1`).then(() => 'updated', (error) => error.code));
    assert.equal(update, '42501', 'the service can rewrite a description');
    const remove = await asRole(engine, 'service_role', (client) => client.query(`DELETE FROM bridge_v2_offer_descriptions WHERE terms_id = 1`).then(() => 'deleted', (error) => error.code));
    assert.equal(remove, '42501', 'the service can delete a description');
  });
}

// The matrix is in the repository, names the spec version, and has a row for every tag the suite declares.
await test(['AT8', 'AV6'], 'V6: the matrix of piece 6 is in the repository, declares the spec version in force (1.24), covers Adendas T, U and V, and has a row for every Un, ATn, AUn and AVn a piece-6 test declares', async () => {
  const matrix = read('test/bridge-v2/MATRIZ-PECA6-KEPTRA.md');
  assert.match(matrix, /Versão 1\.24/);
  for (const adenda of ['Adenda T', 'Adenda U', 'Adenda V']) assert.ok(matrix.includes(adenda), `the matrix does not cover ${adenda}`);
  const { results } = await import('../harness.mjs');
  const declared = new Set(results.filter((r) => r.suite === 'frontend').flatMap((r) => r.requirements).filter((tag) => /^(U\d+|AT\d+|AU\d+|AV\d+)$/.test(tag)));
  for (const tag of declared) assert.match(matrix, new RegExp(`^\\| ${tag} \\|`, 'm'), `${tag} has no row in the matrix`);
});
