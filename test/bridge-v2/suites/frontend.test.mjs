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
  createPublicClient,
  custom,
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
/** The pages of KeptraShell and the Keptra components that write words (T17, revised by the owner on 27/09/2026). */
const KEPTRA_PAGES = readdirSync(`${root}pages/keptra`).map((name) => `pages/keptra/${name}`);
const KEPTRA_PARTS = ['KeptraShell.tsx', 'ui.tsx', 'SignIn.tsx', 'AddressForm.tsx', 'KeptraProvider.tsx'].map((name) => `components/keptra/${name}`);
/** Every word of a dictionary as [path, word], arrays included. */
const wordsOf = (value, path = '') => (typeof value === 'string' ? [[path, value]] : Object.entries(value).flatMap(([key, inner]) => wordsOf(inner, `${path}.${key}`)));

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

await test(['AT2', 'U16', 'U15'], 'T2: every action’s summary is the bridge’s — claim brings the prize into the account, enter names the core, cancel returns the payment, confirm releases it to the store, refund goes to the buyer, contest moves nothing (the page’s part checked in the source)', async () => {
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
  // A tier's rates may be shown as read (/business without a session, commit B), never computed with.
  for (const dir of ['lib/keptra', 'pages/keptra', 'components/keptra']) {
    for (const name of readdirSync(`${root}${dir}`)) {
      assert.ok(!/(?:bondBps|protectionBps)\s*[-+*/%]|[-+*/%]\s*(?:\w+\.)*(?:bondBps|protectionBps)\b/.test(codeOf(`${dir}/${name}`)), `${dir}/${name} repeats the obligation formula`);
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

await test(['U19', 'U5'], 'section 7 and C12 in words: amounts in USDC with their cents, the countries from the escrow’s bytes, the destination named when it is a Keptra contract (the page’s part checked in the source)', async () => {
  assert.equal(format.formatUsdc('31000000'), '31.00 USDC');
  assert.equal(format.formatUsdc(1_234_567_891n), '1,234.567891 USDC');
  assert.equal(format.parseUsdc('12.5'), 12_500_000n);
  assert.equal(format.parseUsdc('1.1234567'), null);
  assert.deepEqual(format.decodeRegions('0x505445534652'), ['PT', 'ES', 'FR']);
  assert.equal(format.countryName('PT'), 'Portugal');
  const words = format.summaryWords({ action: 'redeem', amounts: [{ kind: 'NFT', token: contracts.KEPTRA_VOUCHER, tokenIds: ['5'] }], destination: { address: '0x1111111111111111111111111111111111111111', role: 'GUARANTEE' } });
  assert.deepEqual([words.action, words.amounts[0], words.destination.words], ['Redeem your voucher', 'voucher #5', 'held by the Keptra guarantee contract']);
  // Every condition of section 7 is a row of the offer page — its words from the dictionary (T17 revised, 27/09/2026).
  const page = codeOf('pages/keptra/OfferPage.tsx');
  const { keptraTranslations } = await import('../../../pages/keptra.i18n.ts');
  const rows = { pricePerUnit: 'Price per unit', shipping: 'Shipping, per order', returnCost: 'Return cost, if refused', refusalFee: 'Refusal fee', deliveredBy: 'Delivered by', shipsWithin: 'Ships within', arrivesWithin: 'Arrives within', deliversTo: 'Delivers to', payoutAddress: 'Store payout address' };
  for (const [key, label] of Object.entries(rows)) {
    assert.equal(keptraTranslations.en.offer[key], label);
    assert.ok(page.includes(`[t.offer.${key},`), `the offer page does not show ${label}`);
  }
});

await test(['U35', 'AT18'], 'Q1 and T18: the page’s contract addresses are config.ts’s literals — the deploy’s on Arbitrum One; were any zero, every Keptra screen would say “not available yet” — and its ABIs are the bridge’s own objects (the page’s part checked in the source)', () => {
  const deployed = ['0x6B65fB17Cc548Fb3807F5c9130D4A4991398E246', '0xCa3121f129328B78b10f178F508e1CE0B4b37c2e', '0x3075FA512203e9dC6250Feb4eBA36c55BD2A7a22'];
  assert.deepEqual([contracts.KEPTRA_ESCROW, contracts.KEPTRA_GUARANTEE, contracts.KEPTRA_VOUCHER], deployed);
  assert.deepEqual([REAL_KEPTRA.escrow, REAL_KEPTRA.guarantee, REAL_KEPTRA.voucher], deployed);
  assert.equal(contracts.keptraConfigured(), true);
  assert.equal(contracts.KEPTRA_ESCROW_ABI, bridgeAbi.KEPTRA_ESCROW_ABI);
  assert.equal(contracts.KEPTRA_GUARANTEE_ABI, bridgeAbi.KEPTRA_GUARANTEE_ABI);
  for (const page of ['OfferPage', 'OrdersPage', 'OrderPage', 'VoucherPage', 'BusinessPage', 'PoolPage']) {
    assert.match(codeOf(`pages/keptra/${page}.tsx`), /keptraConfigured\(\)[\s\S]*NotAvailable/, `${page} does not stop while unconfigured`);
  }
});

await test(['AT12'], 'T12: what left this build has no screen — no second passkey, no recovery started from the page, no guardian revocation, no creator campaign by passkey, no voucher transfer (checked in the source)', () => {
  const pages = [...readdirSync(`${root}pages/keptra`).map((n) => `pages/keptra/${n}`), ...readdirSync(`${root}components/keptra`).map((n) => `components/keptra/${n}`), 'pages/EventDetail.tsx'];
  for (const path of pages) {
    const text = codeOf(path);
    for (const kind of ['addPasskey', 'revokeGuardian', 'createCampaign']) assert.ok(!text.includes(`kind: '${kind}'`), `${path} offers ${kind}`);
    assert.ok(!text.includes("'account/recovery'"), `${path} starts a recovery`);
  }
  assert.ok(!/call<[^>]*>\('account\/recovery'/.test(codeOf('lib/keptra/api.ts')));
});

await test(['U29', 'U30', 'AT15'], '12.7 and T15: every figure the pool panel and the tier read is a function the 5d85a46 contracts have — capital, coverage, capacity, utilisation, reserve, fees, losses, shares, debts; the escrow’s ceilings (the page’s part checked in the source)', () => {
  const fixture = JSON.parse(read('test/bridge-v2/fork/keptra-5d85a46.json'));
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

await test(['AA-T18', 'AA-Q7', 'AT18'], 'T18 and Q7 (Z1): every function, event and error of the bridge’s Keptra ABIs and of the page’s read ABIs is in the ABI compiled from 5d85a46 — same inputs, same outputs, same indexed topics — and the fixture is that commit’s, with Z1’s escrow hash', () => {
  const fixture = JSON.parse(read('test/bridge-v2/fork/keptra-5d85a46.json'));
  assert.equal(fixture.commit, '5d85a46');
  assert.equal(keccak256(fixture.contracts.KeptraEscrow.creationCode), `0x${'7f269f74cc6a659f906194f4d87635a8d0cfa56a10d1fe774047c91e023890c4'}`);
  assert.equal(existsSync(`${root}test/bridge-v2/fork/keptra-183a2b4.json`), false, 'the fixture of 183a2b4 is still there');
  const types = (params) => JSON.stringify((params ?? []).map((p) => (p.components ? { t: p.type, c: JSON.parse(types(p.components)) } : p.type)));
  const shape = (item) => `${item.type} ${item.name}${types(item.inputs)}${item.type === 'function' ? `->${types(item.outputs)}` : ''}${item.type === 'event' ? JSON.stringify(item.inputs.map((i) => Boolean(i.indexed))) : ''}`;
  const against = (label, abi, names) => {
    const compiled = new Set(names.flatMap((name) => fixture.contracts[name].abi.map(shape)));
    for (const item of abi.filter((entry) => ['function', 'event', 'error'].includes(entry.type))) {
      assert.ok(compiled.has(shape(item)), `${label}: ${shape(item)} is not in ${names.join('/')} at 5d85a46`);
    }
  };
  against('KEPTRA_ESCROW_ABI', bridgeAbi.KEPTRA_ESCROW_ABI, ['KeptraEscrow']);
  against('KEPTRA_GUARANTEE_ABI', bridgeAbi.KEPTRA_GUARANTEE_ABI, ['KeptraGuarantee']);
  against('KEPTRA_VOUCHER_ABI', bridgeAbi.KEPTRA_VOUCHER_ABI, ['KeptraVoucher']);
  against('KEPTRA_REPUTATION_ABI', bridgeAbi.KEPTRA_REPUTATION_ABI, ['KeptraReputation']);
  against('KEPTRA_KEEPER_ABI', bridgeAbi.KEPTRA_KEEPER_ABI, ['KeptraEscrow', 'KeptraGuarantee']);
  against('KEPTRA_BRIDGE_ROLE_ABI', bridgeAbi.KEPTRA_BRIDGE_ROLE_ABI, ['KeptraEscrow']);
  against('ESCROW_READ_ABI', contracts.ESCROW_READ_ABI, ['KeptraEscrow']);
  against('REPUTATION_READ_ABI', contracts.REPUTATION_READ_ABI, ['KeptraReputation']);
  against('GUARANTEE_READ_ABI', contracts.GUARANTEE_READ_ABI, ['KeptraGuarantee']);
  against('POOL_READ_ABI', contracts.POOL_READ_ABI, ['KeptraPool']);
});

await test(['AT14', 'U32'], 'T14: the privacy page is a route with the owner’s text — published — and every address form is locked while a text is empty (checked in the source)', () => {
  assert.ok(PRIVACY_TEXT.trim().length > 0, 'the owner’s text is not published');
  assert.equal(privacyPublished(), true);
  assert.equal(privacyPublished(''), false);
  assert.equal(privacyPublished('Keptra keeps…'), true);
  const form = codeOf('components/keptra/AddressForm.tsx');
  assert.ok(form.indexOf('if (!privacyPublished())') < form.indexOf('<form'), 'the form renders before the check');
  assert.match(codeOf('App.tsx'), /path="\/privacy"/);
});

await test(['U33'], 'H20 and I2: a pause stops the payment on the offer page; the redemption page does not stop on it (checked in the source)', () => {
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

await test(['U3'], 'every link a notice carries lands on a route of the app: /events/:id, /account, /orders/:id and /store/orders/:id (checked in the source)', () => {
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

await test(['AT17', 'AU3'], 'T17 as the owner revised it on 27/09/2026, and U3: every Keptra screen is in the language the switch chose — each page of KeptraShell and each Keptra component reads its words from pages/keptra.i18n.ts, where English, Portuguese and Spanish hold the same keys, none empty, and writes no English of its own; the pure modules’ words (dates, numbers, order states, the summary sheet) and the privacy notice follow the language too; the document declares the chosen language, on load and at every choice; what changed in the Event Center is in all three languages, key for key (the pages’ part checked in the source)', async () => {
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  const en = wordsOf(k.en);
  for (const [path, word] of en) assert.ok(word.trim().length > 0, `en${path} is empty`);
  for (const lang of ['pt', 'es']) {
    const other = wordsOf(k[lang]);
    assert.deepEqual(other.map(([path]) => path), en.map(([path]) => path), `${lang} does not hold the English keys`);
    for (const [path, word] of other) assert.ok(word.trim().length > 0, `${lang}${path} is empty`);
    // Translated, not copied: what stays equal to the English is only a word both languages share — listed here, so a new one is a decision.
    const same = other.filter(([, word], index) => word === en[index][1]).map(([path]) => path);
    const SHARED = {
      pt: ['.shell.menu', '.signIn.email', '.orders.voucher', '.voucher.metaTitle', '.voucher.metaTitleBare', '.pool.capital', '.pool.splitPool', '.account.passkeysOne', '.account.passkeysMany'],
      es: ['.signIn.email', '.pool.capital', '.pool.splitPool', '.account.passkeysOne', '.account.passkeysMany'],
    };
    assert.deepEqual(same, SHARED[lang], `${lang}: words left as the English ones`);
  }
  // Every page and component reads the dictionary, and writes none of its sentences itself.
  const sentences = en.filter(([path, word]) => !path.startsWith('.errors.') && /\s/.test(word) && word.length > 16 && !word.includes('{')).map(([, word]) => word);
  const NAMES = /^(?:Keptra|USDC|Event Center|Instant Win)$/;
  for (const path of [...KEPTRA_PAGES, ...KEPTRA_PARTS]) {
    const code = codeOf(path);
    assert.match(code, /useKeptraCopy\(\)/, `${path} does not read the dictionary`);
    for (const sentence of sentences) assert.ok(!code.includes(sentence), `${path} writes "${sentence}" itself`);
    for (const m of code.matchAll(/(?<![=\-])>\s*([A-Za-zÀ-ÿ’',.…—\s-]*[A-Za-z]{2,}[A-Za-zÀ-ÿ’',.…—\s-]*?)\s*</g)) assert.ok(NAMES.test(m[1].trim()), `${path} writes "${m[1].trim()}" between tags`);
    for (const m of code.matchAll(/\b(?:label|title|hint|intro|eyebrow|placeholder|aria-label|alt)="([^"]*)"/g)) assert.ok(!/[A-Za-z]{2,}/.test(m[1]) || NAMES.test(m[1]), `${path}: ${m[0]}`);
    assert.ok(!/<ReadError[^>]*what="/.test(code), `${path} names a failed read in English`);
    assert.ok(!/documentElement\.lang|\slang="/.test(code), `${path} declares a language of its own`);
  }
  // The pure modules' words, in the three languages, and the numbers in the language's own form.
  for (const table of [format.SUMMARY_WORDS, clientOrders.STATUS_WORDS]) {
    for (const lang of ['pt', 'es']) assert.deepEqual(wordsOf(table[lang]).map(([path]) => path), wordsOf(table.en).map(([path]) => path));
  }
  assert.equal(format.formatUsdc(1_234_567_891n), '1,234.567891 USDC');
  assert.equal(format.formatUsdc(1_234_567_891n, 'pt'), '1234,567891 USDC');
  assert.match(format.formatUsdc(12_345_000_000n, 'pt'), /^12\s345,00 USDC$/u);
  assert.equal(format.formatUsdc(12_345_000_000n, 'es'), '12.345,00 USDC');
  assert.equal(format.formatPercent(1250), '12.50%');
  assert.match(format.formatPercent(1250, 'es'), /^12,50\s?%$/u);
  // The language's own decimal sign — a comma in Portuguese and Spanish — and never a thousands separator (LK12).
  assert.equal(format.parseUsdc('12,5', 'pt'), 12_500_000n);
  assert.equal(format.parseUsdc('12.5', 'es'), null);
  assert.equal(format.parseUsdc('1.234,56', 'es'), null);
  assert.equal(format.parseUsdc('1 234,56', 'pt'), null);
  assert.equal(format.timeLeft(3 * 86_400 + 10, 0, 'pt'), 'dentro de 3 dias');
  assert.equal(format.countryName('ES', 'pt'), 'Espanha');
  assert.equal(format.summaryWords({ action: 'pay', amounts: [], destination: null }, 'es').action, 'Pagar este pedido');
  const shipped = { state: contracts.OrderState.SHIPPED, flags: 0, mode: 'CARRIER', prize: false, shipBy: '0', deliverBy: '864000', windowEndsAt: null, outcome: null };
  assert.equal(clientOrders.orderStatusText(shipped, 'es'), 'Enviado — en camino');
  assert.equal(clientOrders.nextDeadlineText(shipped, 0, 'pt'), 'Próximo prazo dentro de 10 dias');
  // The privacy notice: the owner's English is the reference, and the translations keep its structure (blocks, headings, items).
  const { PRIVACY_TEXTS } = await import('../../../lib/keptra/privacy.ts');
  assert.equal(PRIVACY_TEXTS.en, PRIVACY_TEXT);
  const layout = (text) => text.trim().split(/\n\s*\n/).map((block) => block.split('\n').map((line) => (line.startsWith('- ') ? '-' : 'p')).join(''));
  for (const lang of ['pt', 'es']) assert.deepEqual(layout(PRIVACY_TEXTS[lang]), layout(PRIVACY_TEXT), `the ${lang} privacy notice does not keep the owner's structure`);
  assert.match(codeOf('pages/keptra/PrivacyPage.tsx'), /parse\(PRIVACY_TEXTS\[lang\]\)/);
  // The document declares the chosen language: the stored one on load, and each new choice (a fresh copy of the store, over a stand-in document).
  globalThis.document = { documentElement: { lang: 'en' } };
  globalThis.localStorage = { getItem: () => 'es', setItem: () => {} };
  try {
    const store = await import(`../../../pages/landing.i18n.ts?document-${Date.now()}`);
    assert.equal(globalThis.document.documentElement.lang, 'es', 'the stored language is not declared on load');
    store.setLang('pt');
    assert.equal(globalThis.document.documentElement.lang, 'pt');
    store.setLang('en');
    assert.equal(globalThis.document.documentElement.lang, 'en');
  } finally {
    delete globalThis.document;
    delete globalThis.localStorage;
  }
  // U3: what changed in the Event Center, in all three languages, key for key.
  const source = read('pages/events.i18n.ts');
  // The three languages' blocks (string values); the interface's block holds types, not text.
  const blocks = [...source.matchAll(/ {4}keptra: \{([\s\S]*?) {4}\},?/g)].filter((m) => m[1].includes("'")).map((m) => [...m[1].matchAll(/^\s+(\w+): '/gm)].map((key) => key[1]));
  assert.equal(blocks.length, 3, 'not three languages');
  assert.deepEqual(blocks[1], blocks[0]);
  assert.deepEqual(blocks[2], blocks[0]);
});

await test(['AT21', 'AT0'], 'T21 and T0: the frame uses the computer’s width and folds for a phone — a wide container, a menu with finger-sized links, no action only on a hover; every screen has its loading, empty and error states (checked in the source)', () => {
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

await test(['U36'], 'A11 and A12: the flows of the earlier wallets stay — the destination form of a derived wallet’s prize, the self-custody advice (checked in the source)', () => {
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

await test(['AT3'], 'T3: piece 6 (d56f499..81f08ce, W1) changed the bridge only where Adenda T allows it (and the owner’s answers of 22/09 extended it): account status and vouchers, the relay’s summary, ids and USDC transfer, the descriptions, the erasure refusal, the public domain', () => {
  // T3 bounds piece 6's own construction, closed at 81f08ce (W1). What the lot
  // before the deploy changes in the bridge since is AA4's, not piece 6's.
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const changed = git('diff', '--name-only', 'd56f499', '81f08ce', '--', 'api', 'lib/bridge-v2', 'lib/campaign-identity.ts', 'supabase').trim().split('\n').filter(Boolean);
  const untracked = [];
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

/** Every `cast call|send <CONTRACT> "sig(...)(...)"` of an instruction file, against the ABI compiled from 5d85a46. */
function castCallsHold(path) {
  const fixture = JSON.parse(read('test/bridge-v2/fork/keptra-5d85a46.json'));
  const contractOf = { ESCROW: 'KeptraEscrow', GUARANTEE: 'KeptraGuarantee', POOL: 'KeptraPool', REPUTATION: 'KeptraReputation', VOUCHER: 'KeptraVoucher' };
  const text = read(path);
  const calls = [...text.matchAll(/cast (call|send) <([A-Z_]+)> "([A-Za-z0-9_]+)\(([^)]*)\)(?:\(([^)]*)\))?"/g)];
  let checked = 0;
  for (const [, verb, target, name, inputs, outputs] of calls) {
    const contract = contractOf[target];
    if (contract === undefined) continue;
    const split = (list) => (list === undefined || list === '' ? [] : list.split(','));
    const found = fixture.contracts[contract].abi.find((item) => item.type === 'function' && item.name === name && item.inputs.map((i) => i.type).join(',') === split(inputs).join(','));
    assert.ok(found !== undefined, `${path}: ${target} has no ${name}(${inputs}) at 5d85a46`);
    const view = found.stateMutability === 'view' || found.stateMutability === 'pure';
    assert.equal(view, verb === 'call', `${path}: ${name} is sent with cast ${verb}`);
    if (outputs !== undefined) {
      const flat = (params) => params.flatMap((p) => (p.type === 'tuple' ? flat(p.components) : [p.type]));
      assert.equal(flat(found.outputs).join(','), split(outputs).join(','), `${path}: ${name} does not return (${outputs})`);
    }
    checked += 1;
  }
  assert.ok(!/0x[0-9a-fA-F]{64}/.test(text), `${path}: a 32-byte hex value`);
  return { text, checked };
}

await test(['AA-X8'], 'X8 (Y5): the provider’s instructions describe the withdrawal queue of 5d85a46 — the index is a row of queue and never changes, row 0 is a sentinel, a request reads as (provider, shares, previous, next), queueHead and queueTail, pendingRequests counts the live ones, processQueue serves live requests only — and every call they name is in that commit’s pool with those types', () => {
  const { text, checked } = castCallsHold('docs/keptra/POOL-PROVIDER.md');
  assert.ok(checked >= 12, `only ${checked} calls checked`);
  for (const needle of ['5d85a46', 'X8', '"queue(uint256)(address,uint256,uint256,uint256)"', '"queueHead()(uint256)"', '"queueTail()(uint256)"', '"pendingRequests()(uint256)"', 'WithdrawQueued', 'sentinela', 'P23-11', 'NotQueued']) {
    assert.ok(text.includes(needle), `the provider’s instructions do not say ${needle}`);
  }
  assert.ok(!/cancelWithdraw[^\n]*<INDICE>[^\n]*\n[^\n]*queue\.length - queueHead/.test(text));
  castCallsHold('docs/keptra/ARBITER.md');
});

await test(['P23-15'], 'P23-15 (Z3): the owner’s operating instructions are in docs/keptra/OWNER.md, hold no key, name only calls the 5d85a46 contracts have, and carry Z3’s check — the six escrow roles read, isProvider asked of each in every authorised pool, before a second pool or any change of a role or a provider', () => {
  const { text, checked } = castCallsHold('docs/keptra/OWNER.md');
  assert.ok(checked >= 20, `only ${checked} calls checked`);
  for (const role of ['owner', 'pendingOwner', 'oracle', 'arbiter', 'bridge', 'platform']) assert.ok(text.includes(`"${role}()(address)"`), `the check does not read ${role}`);
  for (const needle of ['## 5. Verificação da Z3', '"isProvider(address)(bool)"', '"defaultSource()(address)"', '"isSource(address)(bool)"', 'segundo pool', 'um provedor de um pool que não seja o por defeito', 'um provedor com o mesmo endereço de um papel do escrow', '--account <owner>']) {
    assert.ok(text.includes(needle), `OWNER.md does not say ${needle}`);
  }
  assert.ok(text.indexOf('## 5. Verificação da Z3') > text.indexOf('## 4. Mudar um papel'), 'the check is not tied to the changes it guards');
  assert.ok(!/--private-key|PRIVATE_KEY|mnemonic/i.test(text), 'the instructions reach for a key');
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
  assert.deepEqual(chain.calls.filter((c) => c.name === 'erc20MetaRead').map((c) => c.args[0]), [WETH]);
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
  assert.equal(chain.calls.slice(calls).filter((c) => c.name === 'erc20MetaRead').length, 0);
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
  assert.match(provider, /tabIndex=\{-1\} aria-label=\{t\.sheet\.cancel\}/, 'the backdrop is in the tab order');
  const ui = codeOf('components/keptra/ui.tsx');
  assert.ok(!/disabled=\{rest\.disabled \|\| busy\}/.test(ui), 'a busy button is disabled and loses the focus');
  assert.match(ui, /aria-disabled=\{busy \|\| undefined\}/);
});

await test(['AV5', 'AT14', 'U32'], 'V5 (B3): the bridge refuses a delivery address while the privacy page has no text — an empty text, set in the test — and takes it with the owner’s published text', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  asParticipant('participant-1');
  const published = BRIDGE_PRIVACY_TEXT;
  assert.equal(REAL_PRIVACY_TEXT, PRIVACY_TEXT, 'the double does not hold the real text');
  setPrivacyText('');
  try {
    const refused = await api.registerAddress({ termsId: '1' }, ADDRESS);
    assert.equal(refused.status, 503);
    assert.match(refused.error, /privacy page is published/);
    assert.equal(store.rows('bridge_v2_order_addresses').length, 0);
    setPrivacyText(REAL_PRIVACY_TEXT);
    assert.equal((await api.registerAddress({ termsId: '1' }, ADDRESS)).ok, true);
  } finally {
    setPrivacyText(published);
  }
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
  assert.match(page, /\{pending \? \(\s*<div className="mt-5">\s*<DescriptionRetry what="Offer"/, 'the offer form can publish again while a description is missing');
  assert.match(page, /\{pending \? \(\s*<div className="mt-5">\s*<DescriptionRetry\s+what="Obligation"/, 'the obligation form can create again while a description is missing');
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

await test(['AV6'], 'V6: what the audit listed as excess is gone — the client’s ABI entries and re-exports, account/status’s recovery and deployed, the descriptions’ createdAt, the feeBps and paused reads, the captures and brand.mjs, the dead voids — and account/vouchers keeps complete (P6-11) (the page’s part checked in the source)', async () => {
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
  for (const file of ['0004_bridge_v2_schema.sql', '0005_bridge_v2_functions.sql', '0006_bridge_v2_grants.sql', '0007_bridge_v2_routes.sql', '0010_bridge_v2_outcomes.sql', '0011_campaign_identity.sql', '0012_keptra_accounts.sql', '0013_keptra_orders.sql', '0014_keptra_descriptions.sql', '0015_keptra_lote.sql']) {
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

  await test(['P6-14'], '0015 (P6-14): the terms a store created are recorded once and read — the service holds INSERT and SELECT only, RLS is on, the browser roles hold nothing, one row per set of terms', async () => {
    const granted = await q(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS verbs FROM information_schema.role_table_grants WHERE table_name = 'bridge_v2_store_terms' AND grantee = 'service_role'`);
    assert.equal(granted.rows[0].verbs, 'INSERT,SELECT');
    for (const role of ['anon', 'authenticated']) {
      const any = await q(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name = 'bridge_v2_store_terms' AND grantee = $1`, [role]);
      assert.equal(any.rows[0].n, 0);
    }
    assert.equal((await q(`SELECT relrowsecurity FROM pg_class WHERE relname = 'bridge_v2_store_terms'`)).rows[0].relrowsecurity, true);
    const insert = (terms, store) => attempt(engine.pool, `INSERT INTO bridge_v2_store_terms (terms_id, store_address) VALUES ($1, $2)`, [terms, store]);
    assert.equal((await insert(1, '0x3333333333333333333333333333333333333333')).ok, true);
    assert.equal((await insert(1, '0x3333333333333333333333333333333333333333')).code, '23505');
    assert.equal((await insert(2, 'not an address')).code, '23514');
    assert.equal((await insert(0, '0x3333333333333333333333333333333333333333')).code, '23514');
  });

  await test(['AB4'], '0015 (AB4): the cursor of the orders pass over the chain’s terms is the service’s to read and move — SELECT, INSERT, UPDATE and nothing else, RLS on, closed to the browser; two names only, never below one', async () => {
    const granted = await q(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS verbs FROM information_schema.role_table_grants WHERE table_name = 'bridge_v2_store_terms_cursor' AND grantee = 'service_role'`);
    assert.equal(granted.rows[0].verbs, 'INSERT,SELECT,UPDATE');
    for (const role of ['anon', 'authenticated']) {
      const any = await q(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name = 'bridge_v2_store_terms_cursor' AND grantee = $1`, [role]);
      assert.equal(any.rows[0].n, 0);
    }
    assert.equal((await q(`SELECT relrowsecurity FROM pg_class WHERE relname = 'bridge_v2_store_terms_cursor'`)).rows[0].relrowsecurity, true);
    const moved = await asRole(engine, 'service_role', async (client) => [
      await attempt(client, `INSERT INTO bridge_v2_store_terms_cursor (name, next_id) VALUES ('terms', 11), ('obligations', 5) ON CONFLICT (name) DO UPDATE SET next_id = EXCLUDED.next_id`),
      await attempt(client, `INSERT INTO bridge_v2_store_terms_cursor (name, next_id) VALUES ('terms', 12) ON CONFLICT (name) DO UPDATE SET next_id = EXCLUDED.next_id`),
      await attempt(client, `SELECT name, next_id::text FROM bridge_v2_store_terms_cursor ORDER BY name`),
      await attempt(client, `DELETE FROM bridge_v2_store_terms_cursor`),
    ]);
    assert.deepEqual(moved.slice(0, 3).map((r) => r.ok), [true, true, true]);
    assert.deepEqual(moved[2].rows.map((r) => [r.name, r.next_id]), [['obligations', '5'], ['terms', '12']]);
    assert.equal(moved[3].code, '42501', 'the service can delete the cursor');
    assert.equal((await attempt(engine.pool, `INSERT INTO bridge_v2_store_terms_cursor (name, next_id) VALUES ('orders', 1)`)).code, '23514');
    assert.equal((await attempt(engine.pool, `UPDATE bridge_v2_store_terms_cursor SET next_id = 0 WHERE name = 'terms'`)).code, '23514');
  });
}

// ===========================================================================
// Adenda AA4 — the pendentes of piece 6, P6-1 to P6-21 (P6-13 is on the fork)
// ===========================================================================

await test(['P6-1'], 'P6-1: the summary of "confirm" shows what the store receives — what the order holds less the fee it was paid at — and in PRÉMIO it names no destination', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  asParticipant('participant-1');
  const shipped = (prize) => {
    const item = fx({ id: 5, state: bridgeAbi.OrderState.SHIPPED, payer: buyer.participant, store: shop.creator, paid: 11_000_000n, prize });
    return { ...item, order: { ...item.order, feeBps: 150 } };
  };
  chainShows([shipped(false)]);
  const bought = await api.call('account/relay', { kind: 'confirm', orderId: '5' });
  assert.deepEqual(bought.summary.amounts, [{ kind: 'ERC20', token: USDC, value: String(11_000_000n - (11_000_000n * 150n) / 10_000n) }]);
  assert.deepEqual(bought.summary.destination, { address: shop.creator, role: 'STORE' });
  chainShows([shipped(true)]);
  const prize = await api.call('account/relay', { kind: 'confirm', orderId: '5' });
  assert.deepEqual([prize.summary.amounts, prize.summary.destination], [[], null]);
});

await test(['P6-2'], 'P6-2: the address form says the post code goes to the tracking provider and to the oracle’s nodes — in the three languages (checked in the source)', async () => {
  const form = read('components/keptra/AddressForm.tsx');
  assert.match(form, /label=\{t\.address\.postCode\} hint=\{t\.address\.postCodeHint\}/);
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  assert.match(k.en.address.postCodeHint, /tracking provider[^"]*nodes of the oracle/);
  assert.match(k.pt.address.postCodeHint, /fornecedor de seguimento[^"]*nós do oráculo/);
  assert.match(k.es.address.postCodeHint, /proveedor de seguimiento[^"]*nodos del oráculo/);
});

await test(['P6-3', 'P6-4'], 'P6-3 and P6-4: the pool panel writes no figure by hand, and shows the fees as amounts read from ObligationCreated and FeeReceived — events the 5d85a46 contracts emit with those fields (the page’s part checked in the source)', () => {
  const fixture = JSON.parse(read('test/bridge-v2/fork/keptra-5d85a46.json'));
  const eventOf = (contract, name) => fixture.contracts[contract].abi.find((item) => item.type === 'event' && item.name === name);
  for (const [contract, abi, name] of [['KeptraGuarantee', contracts.GUARANTEE_READ_ABI, 'ObligationCreated'], ['KeptraPool', contracts.POOL_READ_ABI, 'FeeReceived']]) {
    const compiled = eventOf(contract, name);
    assert.ok(compiled, `${contract} emits no ${name}`);
    const ours = abi.find((item) => item.type === 'event' && item.name === name);
    assert.deepEqual(ours.inputs.map((i) => `${i.type} ${i.name} ${i.indexed === true}`), compiled.inputs.map((i) => `${i.type} ${i.name} ${i.indexed === true}`), `${name} is not the event of 5d85a46`);
  }
  const page = codeOf('pages/keptra/PoolPage.tsx');
  assert.ok(!/today, one/i.test(page), 'the panel still states a figure by hand');
  assert.match(page, /eventName: 'ObligationCreated'/);
  assert.match(page, /eventName: 'FeeReceived'/);
  // Every figure of the panel comes through figureText (a read), never a literal between the tags.
  assert.ok(!/>\s*\d[\d.,]*\s*(?:%|USDC)\s*</.test(page), 'a figure is written in the JSX');
});

await test(['P6-5'], 'P6-5: a voucher with no description has no redeem button, and the page says why (checked in the source)', () => {
  const page = codeOf('pages/keptra/VoucherPage.tsx');
  assert.match(page, /const described = description !== null && description !== undefined;/);
  assert.match(page, /!expired && described && \(\s*<Button/);
  assert.match(page, /: !described \? \(/);
});

await test(['P6-6'], 'P6-6: the erasure’s refusal reads the open orders from the chain — an order newer than the index is found, an order the index still holds open but the chain closed does not block, and more than a page to read is a 503, never a guess', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  // Paid a moment ago: the pass has not indexed it.
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  asParticipant('participant-1');
  const fresher = await api.privacyErase();
  assert.equal(fresher.status, 409, 'an order the index has not read yet did not block');
  assert.match(fresher.error, /1 open order/);
  // Indexed open, then closed on-chain before the pass reads the close.
  await pass();
  chainShows([fx({ id: 1, state: bridgeAbi.OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  asParticipant('participant-1');
  // Too many new orders to read in one request: the route says so.
  escrow.set({ ordersHead: { orderCount: 200n, now: T0, block: 1_000n } });
  assert.equal((await api.privacyErase()).status, 503);
  chainShows([fx({ id: 1, state: bridgeAbi.OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  const erased = await api.privacyErase();
  assert.equal(erased.ok, true, `the index’s stale open order blocked: ${JSON.stringify(erased)}`);
});

await test(['P6-7'], 'P6-7: with the token’s decimals not read, no amount is shown or computed — the campaign page shows "…" or "Not read", the prize transfer refuses and hides the amount (checked in the source)', () => {
  const event = codeOf('pages/EventDetail.tsx');
  const account = codeOf('pages/keptra/AccountPage.tsx');
  for (const [name, text] of [['EventDetail', event], ['AccountPage', account]]) assert.ok(!/\?\? 18\b/.test(text), `${name} still assumes 18 decimals`);
  assert.match(event, /const amountShown = decimals === null \? \(meta\?\.\[0\]\?\.status === 'failure' \? 'Not read' : '…'\)/);
  assert.ok(!/formatUnits\(displayAmount \?\?/.test(event));
  assert.match(account, /if \(decimals\.data === undefined\) return setMessage/);
  assert.match(account, /\{!isNft && decimals\.data !== undefined && \(/);
});

await test(['P6-8'], 'P6-8: the voucher’s text shows only for a voucher prize — the voucher contract’s NFT, not any NFT — and only once claimed (checked in the source)', () => {
  const event = codeOf('pages/EventDetail.tsx');
  assert.match(event, /\{passkey && isVoucher && claimed && \(/);
  assert.match(event, /isVoucher=\{isNft && typeof g\?\.prizeToken === 'string' && keptraConfigured\(\) && g\.prizeToken\.toLowerCase\(\) === KEPTRA_VOUCHER\.toLowerCase\(\)\}/);
  assert.ok(!/passkey && isNft &&/.test(event));
});

await test(['P6-9'], 'P6-9: the account is read by the pages that show it — the provider reads nothing on mount, RequireAccount asks, a signature reads the passkeys only when nobody has (checked in the source)', () => {
  const provider = codeOf('components/keptra/KeptraProvider.tsx');
  assert.ok(!/useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\);/.test(provider), 'the provider still reads the account on every page');
  assert.match(provider, /if \(statusRef\.current === null\) await refresh\(\);\s*return signHash/);
  assert.match(provider, /if \(statusRef\.current !== null\) void refresh\(\);/);
  assert.match(codeOf('components/keptra/SignIn.tsx'), /useEffect\(\(\) => \{\s*if \(signedIn === null\) void refresh\(\);\s*\}, \[signedIn, refresh\]\);/);
});

await test(['P6-10'], 'P6-10: every test of this suite that reads a page’s or a component’s source says so in its title (reads this file’s source)', () => {
  const text = read('test/bridge-v2/suites/frontend.test.mjs').replaceAll('\r\n', '\n');
  const starts = [...text.matchAll(/^await test\(/gm)].map((m) => m.index);
  starts.push(text.length);
  const silent = [];
  for (let i = 0; i < starts.length - 1; i += 1) {
    const block = text.slice(starts[i], starts[i + 1]);
    const title = (block.match(/^await test\(\s*\[[^\]]*\],\s*(['`])([\s\S]*?)\1,/) ?? [])[2] ?? '';
    if (/\.tsx['`]/.test(block) && !/source/i.test(title)) silent.push(title.slice(0, 80));
  }
  assert.deepEqual(silent, []);
});

await test(['P6-11'], 'P6-11: the bridge says when the voucher list is cut short, and the orders, voucher and business pages say so rather than let a voucher look absent (the page’s part checked in the source)', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  assert.equal(typeof (await api.accountVouchers()).complete, 'boolean');
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  assert.match(k.en.ui.vouchersIncomplete, /^Not every voucher could be listed/);
  for (const page of ['OrdersPage', 'VoucherPage', 'BusinessPage']) {
    assert.match(codeOf(`pages/keptra/${page}.tsx`), /!held\.read\.value\.complete\)? (?:&& <Notice|return <Notice) tone="warning">\{t\.ui\.vouchersIncomplete\}/, page);
  }
});

await test(['P6-12'], 'P6-12: the obligation list shows bond, coverage and state from getObligation — fields the guarantee’s Obligation has — and "Not read" when the read failed (the page’s part checked in the source)', async () => {
  const obligation = bridgeAbi.KEPTRA_GUARANTEE_ABI.find((item) => item.name === 'getObligation');
  const fields = obligation.outputs[0].components.map((c) => c.name);
  for (const name of ['units', 'openUnits', 'bond', 'coverage']) assert.ok(fields.includes(name), `Obligation has no ${name}`);
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(page, /functionName: 'getObligation'/);
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  for (const [key, label] of [['bondPerUnit', 'Bond per unit'], ['coveragePerUnit', 'Pool coverage per unit'], ['state', 'State']]) {
    assert.equal(k.en.business[key], label);
    assert.ok(page.includes(`label={t.business.${key}}`), label);
  }
  assert.equal(k.en.ui.notRead, 'Not read');
  assert.match(page, /item\?\.status === 'failure' \|\| read\.isError \? t\.ui\.notRead : '…'/);
});

await test(['P6-14'], 'P6-14: an offer or an obligation whose description failed is still listed after a reload — the relay records the terms it created, store/offers names them without a title — and the page then offers only to write that description, never another publication (the page’s part checked in the source)', async () => {
  fresh();
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  const { recordStoreTerms } = await import('../../../lib/bridge-v2/descriptions.ts');
  await recordStoreTerms({ termsId: 7n, store: shop.creator, obligationId: null });
  await recordStoreTerms({ termsId: 7n, store: shop.creator, obligationId: null });
  await recordStoreTerms({ termsId: 8n, store: shop.creator, obligationId: 3n });
  asParticipant('store-1');
  let listed = (await api.myOffers()).offers;
  assert.deepEqual(listed.map((o) => [o.termsId, o.obligationId, o.title]).sort(), [['7', null, null], ['8', '3', null]]);
  escrow.set({ readTerms: { ...fx({ id: 1, payer: shop.participant, store: shop.creator }).terms } });
  assert.equal((await api.writeDescription({ termsId: '7', title: 'Desk lamp', text: 'Brushed brass.' })).ok, true);
  listed = (await api.myOffers()).offers;
  assert.deepEqual(listed.find((o) => o.termsId === '7').title, 'Desk lamp');
  assert.equal(listed.filter((o) => o.termsId === '7').length, 1, 'a described offer is listed twice');
  assert.match(codeOf('lib/bridge-v2/relay.ts'), /await recordStoreTerms\(\{ termsId: created\.termsId, store: account\.safe, obligationId: created\.obligationId \}\)/);
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(page, /const pending = unwritten \?\? undescribedOf\(listed\.read, 'offer', draft, t\.business\.writeAgain\);/);
  assert.match(page, /const pending = unwritten \?\? undescribedOf\(listed\.read, 'obligation', draft, t\.business\.writeAgain\);/);
  assert.match(page, /\{pending \? \(\s*<div className="mt-5">\s*<DescriptionRetry what="Offer"/);
  assert.match(page, /\{pending \? \(\s*<div className="mt-5">\s*<DescriptionRetry\s+what="Obligation"/);
});

await test(['P6-15', 'P6-16'], 'P6-15 and P6-16: one "Try again" re-reads everything the pool panel failed to read, and a figure not read stays "Not read" while it is read again (checked in the source)', () => {
  const page = codeOf('pages/keptra/PoolPage.tsx');
  assert.match(page, /export function figureText\(/);
  assert.match(page, /const \[attempt, setAttempt\] = useState\(0\);/);
  for (const part of ['FeesDistributed', 'Providers', 'Debts']) assert.match(page, new RegExp(`<${part}[^>]*attempt=\\{attempt\\}`), part);
  // Each "Try again" of the panel (the pool not named, or some figures failed) reads everything again.
  const retries = page.match(/<ReadError[\s\S]*?\/>/g) ?? [];
  assert.ok(retries.length > 0);
  for (const retry of retries) assert.match(retry, /onRetry=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/, retry);
  assert.match(page, /failedOnce\.current\.has\(name\)/);
});

await test(['U29'], '12.7: the pool panel reads its events from block 0 as a number, which viem sends as "0x0" — arb1.arbitrum.io/rpc refuses the tag "earliest" (-32602) — and no client file asks for that tag (checked in the source)', async () => {
  const page = codeOf('pages/keptra/PoolPage.tsx');
  assert.equal((page.match(/getContractEvents\(/g) ?? []).length, 4);
  assert.deepEqual([...page.matchAll(/fromBlock: ([^,}\s]+)/g)].map((m) => m[1]), ['0n', '0n', '0n', '0n']);
  for (const path of CLIENT_FILES()) assert.ok(!/(?:fromBlock|toBlock|blockTag):\s*['"]earliest['"]/.test(read(path)), `${path} asks for the block tag "earliest"`);
  // What goes on the wire: 0n as the hex string the RPC accepts; the tag would go out as it is.
  const sent = [];
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => (method === 'eth_getLogs' && sent.push(params[0].fromBlock), []) }) });
  for (const fromBlock of [0n, 'earliest']) await client.getContractEvents({ address: GUARANTEE, abi: contracts.GUARANTEE_READ_ABI, eventName: 'DebtRecorded', fromBlock });
  assert.deepEqual(sent, ['0x0', 'earliest']);
});

await test(['P6-17'], 'P6-17: after a lost answer the store’s console never shows "done" and the error together — an error the re-read order has outgrown becomes "done" (checked in the source)', () => {
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(page, /const at = `\$\{order\.state\}:\$\{order\.trackingRegistered\}`;/);
  assert.match(page, /message\?\.tone === 'error' && message\.at !== undefined && message\.at !== at \? \{ tone: 'success' as const/);
  assert.match(page, /\{shown && <Notice tone=\{shown\.tone\}>\{shown\.text\}<\/Notice>\}/);
  assert.ok(!/\{message && <Notice tone=\{message\.tone\}>\{message\.text\}<\/Notice>\}\s*<\/div>\s*<\/div>\s*\{actions\.includes\('evidence'\)/.test(page));
});

await test(['P6-18'], 'P6-18: "the token does not state its decimals" only when the token said nothing; a read that failed reaches the page as a failure and is shown as one', async () => {
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const token = '0x4444444444444444444444444444444444444444';
  const summary = { action: 'claim', amounts: [{ kind: 'ERC20', token, value: 5n }], destination: null };
  const shown = async (answer) => {
    chain.set({ erc20MetaRead: answer });
    const json = relayLib.summaryJson(await relayLib.withTokenMeta(summary));
    return format.amountText(json.amounts[0]);
  };
  chain.reset();
  assert.match(await shown('absent'), /the token does not state its decimals/);
  const failed = await shown('failed');
  assert.match(failed, /could not be read/);
  assert.ok(!/does not state/.test(failed), 'a failed read is shown as a token that says nothing');
  assert.equal(await shown({ symbol: 'ARB', decimals: 2 }), '0.05 ARB');
});

await test(['P6-19'], 'P6-19: the ABI entry left unused is gone — the page reads no feeBps from the escrow', () => {
  assert.ok(!contracts.ESCROW_READ_ABI.some((item) => item.name === 'feeBps'));
});

await test(['P6-20'], 'P6-20: the store’s order list reads the addresses and the shipments in one query each, whatever the number of orders', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  chainShows([1, 2, 3, 4].map((id) => fx({ id, payer: buyer.participant, store: shop.creator })));
  await pass();
  asParticipant('store-1');
  const before = { addresses: db.callsTo('bridge_v2_order_addresses:select').length, shipments: db.callsTo('bridge_v2_order_shipments:select').length };
  const listed = await api.storeOrders();
  assert.equal(listed.orders.length, 4);
  assert.equal(db.callsTo('bridge_v2_order_addresses:select').length - before.addresses, 1);
  assert.equal(db.callsTo('bridge_v2_order_shipments:select').length - before.shipments, 1);
});

await test(['P6-21'], 'P6-21: the offer page never shows reputation counters that were not read — no 0 standing in for them (checked in the source)', () => {
  const page = codeOf('pages/keptra/OfferPage.tsx');
  assert.ok(!/tier\.delivered \?\? 0|tier\.materialFailures \?\? 0/.test(page));
  assert.match(page, /tier\.delivered !== null && tier\.materialFailures !== null \?/);
});

// ===========================================================================
// Adenda AB — AB2 and AB4
// ===========================================================================

/** An order the pass wrote down, as bridge_v2_orders holds it. */
function indexed(id, { payer, store: storeSafe, state }) {
  store.insert('bridge_v2_orders', {
    order_id: String(id), terms_id: '1', voucher_id: '0', store_address: getAddress(storeSafe), payer_address: getAddress(payer), mode: 0, prize: false,
    ship_days: 5, delivery_days: 10, state, flags: 0, paid_at: String(T0), shipped_at: '0', window_ends_at: '0', contested_at: '0', seen_block: '1',
    outcome: state === bridgeAbi.OrderState.CLOSED ? 0 : null, closed_at: state === bridgeAbi.OrderState.CLOSED ? new Date().toISOString() : null,
  });
}

await test(['AB2'], 'AB2 (M1): the answer to an erasure does not depend on how many closed orders the participant has — 120 closed, as recipient and as store, erase; one open among them refuses and names it; the closed history is never read from the chain', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  const other = '0x4444444444444444444444444444444444444444';
  // 60 closed as the recipient and 60 as the store: more than twice the page the route reads.
  for (let id = 1; id <= 120; id += 1) {
    indexed(id, id <= 60 ? { payer: buyer.participant, store: other, state: bridgeAbi.OrderState.CLOSED } : { payer: other, store: buyer.creator, state: bridgeAbi.OrderState.CLOSED });
  }
  // One open order of the participant, the last one, and the index caught up with the chain.
  indexed(121, { payer: buyer.participant, store: shop.creator, state: bridgeAbi.OrderState.PAID });
  chainShows([fx({ id: 121, payer: buyer.participant, store: shop.creator })]);
  asParticipant('participant-1');
  const refused = await api.privacyErase();
  assert.equal(refused.status, 409, `a participant with an open order was not refused: ${JSON.stringify(refused)}`);
  assert.match(refused.error, /1 open order/);
  const readIds = escrow.calls.filter((c) => c.name === 'readOrders').flatMap((c) => c.args[0]).map(String);
  assert.deepEqual(readIds, ['121'], 'the closed history was read from the chain');
  // The open order closes: nothing is left to resolve (T13), and the answer is the erasure — never a 503.
  chainShows([fx({ id: 121, state: bridgeAbi.OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  const erased = await api.privacyErase();
  assert.equal(erased.ok, true, `120 closed orders blocked the erasure: ${JSON.stringify(erased)}`);
  // Before AB2, the same history was more than a page to read, and the answer a 503.
  const before = execFileSync('git', ['show', '133891e:api/bridge/v2/privacy/erase.ts'], { cwd: root, encoding: 'utf8' });
  assert.match(before, /ordersOfPayer\(participant\.safe\)/);
  assert.match(before, /if \(ids\.size > ORDER_SCAN_PAGE\) throw new TooManyToRead\(\);/);
});

/** AB4: the terms and obligations the doubled chain holds, read past a cursor as termsCreatedSince reads them. */
function chainTerms({ offers = [], obligations = [], termsCount, obligationCount, more = false }) {
  escrow.set({
    termsCreatedSince: (nextTerms, nextObligation, max) => ({
      offers: offers.filter((o) => o.termsId >= nextTerms).slice(0, max),
      obligations: obligations.filter((o) => o.obligationId >= nextObligation).slice(0, max),
      nextTerms: termsCount > nextTerms ? termsCount : nextTerms,
      nextObligation: obligationCount > nextObligation ? obligationCount : nextObligation,
      more,
    }),
  });
}

await test(['AB4'], 'AB4 (B2): an offer and an obligation the relay created are listed by the store’s console even when the receipt never reached the relay and nothing was recorded — from the chain past the index, then from the index the orders pass writes; another store’s terms are not listed; more than a page past the index is a 503, never a partial list', async () => {
  fresh();
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  const other = await person('store-2', '0x4444444444444444444444444444444444444444');
  // Receipt lost: the relay recorded nothing (bridge_v2_store_terms is empty) — the chain holds offer 9 and obligation 4 (terms 10).
  chainTerms({
    offers: [{ termsId: 8n, store: other.creator }, { termsId: 9n, store: shop.creator }],
    obligations: [{ obligationId: 4n, termsId: 10n, brand: shop.creator }],
    termsCount: 11n,
    obligationCount: 5n,
  });
  assert.equal(store.rows('bridge_v2_store_terms').length, 0);
  asParticipant('store-1');
  const listed = (await api.myOffers()).offers.map((o) => [o.termsId, o.obligationId, o.title]).sort();
  assert.deepEqual(listed, [['10', '4', null], ['9', null, null]], 'the console did not list what the chain holds');
  // The orders pass writes them down and moves its cursor past them; the list is the same from the index.
  await pass();
  assert.deepEqual(store.rows('bridge_v2_store_terms').map((r) => [String(r.terms_id), r.obligation_id == null ? null : String(r.obligation_id)]).sort(), [['10', '4'], ['8', null], ['9', null]]);
  assert.deepEqual(store.rows('bridge_v2_store_terms_cursor').map((r) => [r.name, String(r.next_id)]).sort(), [['obligations', '5'], ['terms', '11']]);
  asParticipant('store-1');
  assert.deepEqual((await api.myOffers()).offers.map((o) => [o.termsId, o.obligationId, o.title]).sort(), listed);
  // A second pass reads from the cursor: nothing is written twice.
  await pass();
  assert.equal(store.rows('bridge_v2_store_terms').length, 3);
  // Described, it is listed once, with its title.
  escrow.set({ readTerms: { ...fx({ id: 1, payer: shop.participant, store: shop.creator }).terms } });
  asParticipant('store-1');
  assert.equal((await api.writeDescription({ termsId: '9', title: 'Desk lamp', text: 'Brushed brass.' })).ok, true);
  assert.deepEqual((await api.myOffers()).offers.filter((o) => o.termsId === '9').map((o) => o.title), ['Desk lamp']);
  // More past the index than one page: no list, so the console offers to create nothing.
  chainTerms({ termsCount: 11n, obligationCount: 5n, more: true });
  const cut = await api.myOffers();
  assert.equal(cut.ok, false);
  assert.equal(cut.status, 503);
});

await test(['AB4'], 'AB4 (B2): the console offers to publish an offer or create an obligation only once its list is read — never while it loads or after it failed (checked in the source)', async () => {
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(page, /\) : listed\.read\.status === 'ready' \? \(\s*<Button className="mt-5" busy=\{busy\} onClick=\{\(\) => void publish\(\)\}>/);
  assert.match(page, /\) : listed\.read\.status === 'ready' \? \(\s*<Button className="mt-5" busy=\{busy\} onClick=\{\(\) => void create\(\)\}>/);
  // The only other create of the console is a voucher campaign's, which creates no offer and no obligation.
  assert.equal((page.match(/onClick=\{\(\) => void publish\(\)\}/g) ?? []).length, 1, 'another way to publish an offer');
  assert.deepEqual([...page.matchAll(/onClick=\{\(\) => void create\(\)\}>\s*([^<]*?)\s*</g)].map((m) => m[1]), ['{t.business.create}', '{t.business.createCampaign}']);
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  assert.deepEqual([k.en.business.create, k.en.business.createCampaign], ['Review and create', 'Review and create campaign']);
});

// The matrix is in the repository, names the spec version, and has a row for every tag the suite declares.
await test(['AT8', 'AV6', 'P6-10'], 'V6, AA4 and AB: the matrix of piece 6 is in the repository, declares the spec version in force (1.31), covers Adendas T, U, V, W, AA4 and AB, and has a row for every Un, ATn, AUn, AVn, P6-n, AB2 and AB4 a piece-6 test declares (reads the matrix)', async () => {
  const matrix = read('test/bridge-v2/MATRIZ-PECA6-KEPTRA.md');
  assert.match(matrix, /Versão 1\.31/);
  for (const adenda of ['Adenda T', 'Adenda U', 'Adenda V', 'Adenda W', 'AA4', '## 6. Adenda AB']) assert.ok(matrix.includes(adenda), `the matrix does not cover ${adenda}`);
  const { results } = await import('../harness.mjs');
  const declared = new Set(results.filter((r) => r.suite === 'frontend' || (r.suite === 'fork-orders' && r.requirements.includes('P6-13'))).flatMap((r) => r.requirements).filter((tag) => /^(U\d+|AT\d+|AU\d+|AV\d+|P6-\d+|AB[24])$/.test(tag)));
  for (const tag of ['AB2', 'AB4']) assert.ok(declared.has(tag), `no piece-6 test declares ${tag}`);
  // P6-13 runs on the fork, in another process: its row is required all the same.
  declared.add('P6-13');
  for (const tag of declared) assert.match(matrix, new RegExp(`^\\| ${tag} \\|`, 'm'), `${tag} has no row in the matrix`);
});

// ---------------------------------------------------------------------------
// The home page, Keptra first — the owner's request of 27/09/2026, commit A.
// ---------------------------------------------------------------------------

/**
 * The owner's texts of 27/09/2026, as they were given; chapter 03's title, the sentence
 * under the first screen's diagram and chapter 05's title as the owner rewrote them for
 * commit B8 (a purchase: the escrow, the 5 days, the arbiter).
 */
const OWNER_TEXTS = {
  en: {
    title: 'A brand that can prove it, cares.',
    sub: 'Keptra lets any store give its customers something no one else does: a delivery guarantee that is verified, not promised. Payment waits in escrow, an independent oracle confirms the delivery, and only then the store gets paid. No wallets, no crypto knowledge — for the store or the customer.',
    brandsCta: 'For brands — Offer verified delivery',
    customersCta: 'For customers — Buy with a guarantee you can check',
    band: 'Backed by a public guarantee pool: {capital} USDC, verified on Arbitrum One.',
    seePool: 'See the pool',
    brands: 'The stores that can show proof stand apart. Transparency your customers can verify is care they can feel — and Keptra makes it a checkbox at checkout, not a project.',
    note: 'Your payment stays in escrow until you confirm the delivery or 5 days pass without a contest. If you contest, an arbiter decides — and the money is still there.',
    customers: "Online or in store: the store is paid only when you confirm the delivery or 5 days pass without a contest — until then, the money is in escrow. You never need to understand how; you can always check that it's true.",
    modulesTitle: 'One standard of proof, everywhere.',
    obligation: 'Every order is a tokenized obligation — bond, coverage and settlement on-chain. Commerce as a real-world asset.',
    providersTitle: 'Be part of the guarantee.',
    providersBody: "The pool's capital comes from providers who back every order. Providers earn a share of every protection fee.",
    providersCta: 'Become a provider',
  },
  pt: {
    title: 'Uma marca que consegue provar, cuida.',
    sub: 'A Keptra permite a qualquer loja dar aos seus clientes algo que mais ninguém dá: uma garantia de entrega verificada, não prometida. O pagamento espera num escrow, um oráculo independente confirma a entrega, e só então a loja recebe. Sem carteiras, sem saber de cripto — nem a loja, nem o cliente.',
    brandsCta: 'Para marcas — Ofereça entrega verificada',
    customersCta: 'Para clientes — Compre com uma garantia que pode conferir',
    band: 'Apoiado por um pool de garantia público: {capital} USDC, verificado na Arbitrum One.',
    seePool: 'Ver o pool',
    brands: 'As lojas que conseguem mostrar prova destacam-se. Transparência que os seus clientes podem verificar é cuidado que eles sentem — e a Keptra torna isso numa opção no checkout, não num projecto.',
    note: 'O seu pagamento fica no escrow até confirmar a entrega ou passarem 5 dias sem a contestar. Se contestar, um árbitro decide — e o dinheiro ainda lá está.',
    customers: 'Online ou na loja: a loja só recebe quando confirmar a entrega ou passarem 5 dias sem a contestar — até lá, o dinheiro está no escrow. Nunca precisa de perceber como; pode sempre conferir que é verdade.',
    modulesTitle: 'Um só padrão de prova, em tudo.',
    obligation: 'Cada encomenda é uma obrigação tokenizada — caução, cobertura e liquidação on-chain. O comércio como activo do mundo real.',
    providersTitle: 'Faça parte da garantia.',
    providersBody: 'O capital do pool vem de provedores que sustentam cada encomenda. Os provedores recebem uma parte de cada taxa de protecção.',
    providersCta: 'Tornar-me provedor',
  },
  es: {
    title: 'Una marca que puede probarlo, cuida.',
    sub: 'Keptra permite a cualquier tienda dar a sus clientes algo que nadie más da: una garantía de entrega verificada, no prometida. El pago espera en un escrow, un oráculo independiente confirma la entrega, y solo entonces la tienda cobra. Sin wallets, sin saber de cripto — ni la tienda, ni el cliente.',
    brandsCta: 'Para marcas — Ofrece entrega verificada',
    customersCta: 'Para clientes — Compra con una garantía que puedes comprobar',
    band: 'Respaldado por un pool de garantía público: {capital} USDC, verificado en Arbitrum One.',
    seePool: 'Ver el pool',
    brands: 'Las tiendas que pueden mostrar prueba se distinguen. La transparencia que tus clientes pueden verificar es cuidado que sienten — y Keptra la convierte en una opción en el checkout, no en un proyecto.',
    note: 'Tu pago se queda en el escrow hasta que confirmes la entrega o pasen 5 días sin impugnarla. Si la impugnas, un árbitro decide — y el dinero sigue ahí.',
    customers: 'Online o en tienda: la tienda solo cobra cuando confirmas la entrega o pasan 5 días sin impugnarla — hasta entonces, el dinero está en el escrow. Nunca necesitas entender cómo; siempre puedes comprobar que es verdad.',
    modulesTitle: 'Un solo estándar de prueba, en todo.',
    obligation: 'Cada pedido es una obligación tokenizada — fianza, cobertura y liquidación on-chain. El comercio como activo del mundo real.',
    providersTitle: 'Forma parte de la garantía.',
    providersBody: 'El capital del pool viene de proveedores que respaldan cada pedido. Los proveedores reciben una parte de cada tarifa de protección.',
    providersCta: 'Quiero ser proveedor',
  },
};

await test(['LK1'], 'Keptra first (27/09): the home page tells 01 Keptra, 02 for brands, 03 for customers, 04 the guarantee pool, 05 the modules, 06 the invitation to providers, with no lottery chapter left; the first screen calls brands to /business and customers to chapter 03; every route of the app is the one of 1acef6c (checked in the source)', () => {
  const page = codeOf('pages/Landing.tsx');
  const ids = [...page.matchAll(/<(?:FilmSection|Chapter) id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['film-hero', 'for-brands', 'for-customers', 'film-pool', 'film-modules', 'film-close']);
  assert.deepEqual([...page.matchAll(/<ChapterHead index=\{(\d)\}/g)].map((m) => Number(m[1])), [2, 3, 4, 5, 6]);
  assert.ok(!/film-ticket|film-draw|film-seal|film-reveal|film-payout|film-keptra|film-reading/.test(page), 'a lottery chapter is still on the home page');
  assert.match(page, /<AudienceCta text=\{t\.hero\.ctaBrands\} to="\/business" primary \/>/);
  assert.match(page, /<AudienceCta text=\{t\.hero\.ctaCustomers\} href="#for-customers" \/>/);
  assert.match(page, /<EscrowFlow copy=\{t\.flow\}/);
  const routes = (text) => [...text.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.deepEqual(routes(read('App.tsx')), routes(git('show', '1acef6c:App.tsx')));
  assert.ok(routes(read('App.tsx')).includes('/play'), '/play is gone');
});

await test(['LK2'], 'the owner’s texts of 27/09 are on the home page word for word, in English, Portuguese and Spanish — title, subtitle, the two calls, the band, the sentence under the first screen’s diagram, chapters 02, 03 and 05 (chapter 05’s title too), and chapter 06’s title, text and call', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  for (const [lang, owner] of Object.entries(OWNER_TEXTS)) {
    const t = translations[lang];
    assert.equal(t.hero.title, owner.title, `${lang} title`);
    assert.equal(t.hero.sub, owner.sub, `${lang} subtitle`);
    assert.equal(t.hero.ctaBrands, owner.brandsCta, `${lang} call for brands`);
    assert.equal(t.hero.ctaCustomers, owner.customersCta, `${lang} call for customers`);
    assert.equal(t.hero.band, owner.band, `${lang} band`);
    assert.equal(t.hero.seePool, owner.seePool, `${lang} link to the pool`);
    assert.equal(t.flow.note, owner.note, `${lang} under the first screen's diagram`);
    // Chapters 02 and 03: the first sentence is the title, the rest the text.
    assert.equal(`${t.brands.title} ${t.brands.body}`, owner.brands, `${lang} chapter 02`);
    assert.equal(`${t.customers.title} ${t.customers.body}`, owner.customers, `${lang} chapter 03`);
    assert.equal(t.modules.title, owner.modulesTitle, `${lang} chapter 05 title`);
    assert.equal(t.modules.obligation, owner.obligation, `${lang} chapter 05`);
    assert.equal(t.providers.title, owner.providersTitle, `${lang} chapter 06 title`);
    assert.equal(t.providers.body, owner.providersBody, `${lang} chapter 06 text`);
    assert.equal(t.providers.cta, owner.providersCta, `${lang} chapter 06 call`);
    // The calls split into "to whom" and "what" at the one dash they carry.
    for (const cta of [t.hero.ctaBrands, t.hero.ctaCustomers]) assert.equal(cta.split(' — ').length, 2, cta);
  }
});

await test(['LK3'], '{capital} in the band and every figure of chapter 04 are chain reads — the pool the guarantee names (defaultSource), its totalAssets, reservedTotal and freeCapacity, which /pool reads too — never a literal; a read that failed shows no number (checked in the source)', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  for (const lang of ['en', 'pt', 'es']) {
    const { band } = translations[lang].hero;
    assert.equal(band.split('{capital}').length, 2, `${lang}: the band has one {capital}`);
    assert.ok(!/\d/.test(band), `${lang}: a digit in the band`);
  }
  const page = codeOf('pages/Landing.tsx');
  assert.match(page, /useReadContract\(\{ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'defaultSource'/);
  assert.match(page, /const POOL_FIGURES = \['totalAssets', 'reservedTotal', 'freeCapacity'\] as const;/);
  assert.match(page, /contracts: POOL_FIGURES\.map\(\(functionName\) => \(\{ address: pool \?\? KEPTRA_GUARANTEE, abi: POOL_READ_ABI, functionName \}\)\)/);
  const poolPage = codeOf('pages/keptra/PoolPage.tsx');
  for (const name of ['totalAssets', 'reservedTotal', 'freeCapacity']) assert.ok(poolPage.includes(`'${name}'`), `/pool does not read ${name}`);
  // Only a successful read becomes a number; a failed one hides the sentence (the band) or says so (chapter 04).
  assert.match(page, /if \(read\?\.status === 'success'\) return read\.result as bigint;/);
  assert.match(page, /\{capital !== 'failed' && \(/);
  assert.match(page, /capital === 'loading' \? '…' : usdc\(capital, lang\)/);
  assert.match(page, /value === 'failed' \? <span[^>]*>\{t\.pool\.notRead\}<\/span>/);
  assert.ok(!/\d[\d,.]*\s*USDC/.test(page), 'a figure written by hand on the home page');
});

await test(['LK4'], 'the home page’s EN/PT/ES switch is on every Keptra screen: KeptraShell renders LangSwitch — the component SiteHeader gives the home page — after the navigation, as on the home page, and every page under pages/keptra is framed by KeptraShell; the screens follow it (T17 as revised on 27/09/2026, test AT17) (checked in the source)', () => {
  const shell = codeOf('components/keptra/KeptraShell.tsx');
  assert.match(shell, /import \{ LangSwitch \} from '\.\.\/LangSwitch';/);
  assert.equal((shell.match(/<LangSwitch \/>/g) ?? []).length, 1);
  assert.ok(shell.indexOf('<LangSwitch />') > shell.indexOf('</nav>'), 'the switch comes before the navigation');
  assert.match(codeOf('components/SiteHeader.tsx'), /\{lang && <LangSwitch \/>\}/);
  for (const name of readdirSync(`${root}pages/keptra`)) assert.match(codeOf(`pages/keptra/${name}`), /<KeptraShell[\s>]/, `${name} is not framed by KeptraShell`);
});

await test(['LK5'], 'the first screen’s diagram tells an order in its order at every phase of the loop — the payment reaches Keptra and is held before the oracle’s seal lights, the line goes on to the store only once the seal is lit — and the still film and reduced motion draw the whole picture, still (checked in the source)', async () => {
  const { escrowFrame, ESCROW_FINAL } = await import('../../../lib/proof/flow.ts');
  for (let i = 0; i <= 3000; i += 1) {
    const phase = (i / 3000) * 3 - 1; // three cycles, from -1: the scroll can take the phase anywhere
    const f = escrowFrame(phase);
    if (f.held > 0) assert.equal(f.pay, 1, `held before paid at ${phase}`);
    if (f.proven > 0) assert.equal(f.held, 1, `proven before held at ${phase}`);
    if (f.release > 0) assert.equal(f.proven, 1, `released before proven at ${phase}`);
  }
  assert.deepEqual(escrowFrame(ESCROW_FINAL), { pay: 1, held: 1, proven: 1, release: 1, shown: 1 });
  const film = codeOf('components/film/Film.tsx');
  assert.match(film, /if \(window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return 'still';/);
  assert.match(film, /if \(mode !== 'live'\) \{\s*drawRef\.current\(start\);\s*return;\s*\}/);
  // The film's pause button stops the loop too (WCAG 2.2.2).
  assert.match(film, /if \(!pausedRef\.current\) clock \+= Math\.min\(64, Math\.max\(0, now - last\)\) \/ 1000;/);
  assert.match(codeOf('components/proof/EscrowFlow.tsx'), /useFilmTimeline\(root, ESCROW_PERIOD, ESCROW_FINAL, draw\);/);
});

await test(['LK6'], 'becoming a provider is a request, never a deposit: the call opens an email to the public contact, and the home page signs and sends nothing (checked in the source)', () => {
  const page = codeOf('pages/Landing.tsx');
  assert.match(page, /const PROVIDER_REQUEST = `mailto:\$\{INVESTOR_EMAIL\}\?subject=/);
  assert.match(page, /<a href=\{PROVIDER_REQUEST\} className="iw-btn iw-btn-primary/);
  assert.ok(!/useWriteContract|writeContract|sendTransaction|signHash|runAction|deposit\(/.test(page), 'the home page can move funds');
});

// ---------------------------------------------------------------------------
// The home page, Keptra first — commit A2: the owner's decisions of 27/09/2026
// after approving commit A.
// ---------------------------------------------------------------------------

await test(['LK7'], 'the main module leads the public header and footer in the three languages — "Verified delivery", "Entrega verificada", "Entrega verificada" — with its link to "/", then Instant Win, Giveaways, Event Center and Roadmap; header and footer read the one list (checked in the source)', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => translations[lang].header.mainModule), ['Verified delivery', 'Entrega verificada', 'Entrega verificada']);
  const nav = codeOf('components/PublicNav.tsx');
  assert.match(nav, /return \[\{ to: '\/', label: translations\[lang\]\.header\.mainModule \}, \.\.\.PUBLIC_NAV\];/);
  assert.match(nav, /export const PUBLIC_NAV = \[MODULES\.instantWin, MODULES\.giveaways, MODULES\.eventCenter, \{ to: '\/roadmap', label: 'Roadmap' \}\] as const;/);
  assert.match(nav, /instantWin: \{ to: '\/play', label: 'Instant Win' \},\s*giveaways: \{ to: '\/giveaways', label: 'Giveaways' \},\s*eventCenter: \{ to: '\/events', label: 'Event Center' \},/);
  // Both the header's links and the footer's are built from usePublicNav, never from a list of their own.
  assert.equal((nav.match(/const items = usePublicNav\(\);/g) ?? []).length, 2);
  assert.equal((nav.match(/\{items\.map\(/g) ?? []).length, 2);
});

await test(['LK8'], 'the home page’s "Enter App" / "Abrir app" leads to /orders, a route that already existed (checked in the source)', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => translations[lang].header.enterApp), ['Enter App', 'Abrir app', 'Abrir app']);
  assert.match(codeOf('pages/Landing.tsx'), /actions=\{<HeaderAction to="\/orders" icon=\{ArrowRight\} label=\{t\.header\.enterApp\} \/>\}/);
  assert.match(read('App.tsx'), /<Route path="\/orders" element=\{<OrdersPage \/>\} \/>/);
});

await test(['LK9'], 'the contact address is written next to both mailto buttons of the public site — the providers’ call on the home page and the call to talk on /roadmap — selectable, with a Copy button that writes it through navigator.clipboard, says "Copied" for 2 s, and selects it when the browser refuses; the words in the three languages (checked in the source)', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => [translations[lang].contact.copy, translations[lang].contact.copied]), [['Copy', 'Copied'], ['Copiar', 'Copiado'], ['Copiar', 'Copiado']]);
  for (const lang of ['en', 'pt', 'es']) assert.ok(translations[lang].contact.selected.length > 0, `${lang}: no word for a refused copy`);
  const contact = codeOf('components/ContactEmail.tsx');
  assert.match(contact, /import \{ INVESTOR_EMAIL \} from '\.\.\/constants';/);
  assert.match(contact, /<span ref=\{address\} translate="no" className="[^"]*select-all[^"]*">\s*\{INVESTOR_EMAIL\}\s*<\/span>/);
  assert.match(contact, /await navigator\.clipboard\.writeText\(INVESTOR_EMAIL\);\s*setState\('copied'\);/);
  assert.match(contact, /export const COPIED_MS = 2000;/);
  assert.match(contact, /window\.setTimeout\(\(\) => setState\('idle'\), COPIED_MS\)/);
  assert.match(contact, /selection\.selectAllChildren\(address\.current\)/);
  assert.match(contact, /aria-live="polite"/);
  // The two contact points: the mailto: button stays, the address follows it in the same row.
  assert.match(codeOf('pages/Landing.tsx'), /<a href=\{PROVIDER_REQUEST\}[^>]*>[\s\S]{0,200}?<\/a>\s*<ContactEmail \/>/);
  assert.match(codeOf('pages/Roadmap.tsx'), /<a href=\{`mailto:\$\{INVESTOR_EMAIL\}`\}[^>]*>[\s\S]{0,120}?<\/a>\s*<ContactEmail \/>/);
});

// ---------------------------------------------------------------------------
// Commit A3 — the owner's decisions of 27/09/2026 after the audit of A and A2.
// ---------------------------------------------------------------------------

/** What the home page said at 1acef6c (pages/landing.i18n.ts :150, :164, :168, :170): the "to players" row and three answers. */
/** The Portuguese of /play's block that was already Portugal's: still word for word as at 1acef6c. */
const PLAY_RULES_KEPT_PT = [
  'Para os jogadores',
  '85,7% do dinheiro dos bilhetes ao longo do tempo',
  'Uma wallet na Arbitrum One (como a MetaMask) com um pouco de USDC para os bilhetes e um pouco de ETH para o gas.',
  'Quanto do dinheiro vai para os jogadores?',
  'Está disponível no meu país?',
];
const PLAY_RULES = {
  en: [
    'To players',
    '85.7% of ticket money over time',
    'What do I need to play?',
    'An Arbitrum One wallet (such as MetaMask) with some USDC for tickets and a little ETH for gas.',
    'How much of the money goes to players?',
    'About 85.7% over time. Each round pays 75% of its pool to the three winners and 12.5% to development; the other 12.5% rolls into the next round, so it comes back to players — minus the same development share each time it recycles.',
    'Is this available in my country?',
    'Access depends on the rules of your own jurisdiction. It is your responsibility to check whether you are allowed to participate where you live.',
  ],
  // Portugal's Portuguese since commit B (the owner's decision of 27/09/2026): same meaning, "ronda", "vencedores", no "você".
  pt: [
    'Para os jogadores',
    '85,7% do dinheiro dos bilhetes ao longo do tempo',
    'De que preciso para jogar?',
    'Uma wallet na Arbitrum One (como a MetaMask) com um pouco de USDC para os bilhetes e um pouco de ETH para o gas.',
    'Quanto do dinheiro vai para os jogadores?',
    'Cerca de 85,7% ao longo do tempo. Cada ronda paga 75% do seu pool aos três vencedores e 12,5% ao desenvolvimento; os outros 12,5% entram na ronda seguinte, ou seja, voltam para os jogadores — menos a mesma fatia de desenvolvimento a cada reciclagem.',
    'Está disponível no meu país?',
    'O acesso depende das regras da sua própria jurisdição. É da sua responsabilidade verificar se tem permissão para participar no lugar onde vive.',
  ],
  es: [
    'Para los jugadores',
    '85,7% del dinero de los boletos con el tiempo',
    '¿Qué necesito para jugar?',
    'Una wallet en Arbitrum One (como MetaMask) con algo de USDC para los boletos y un poco de ETH para el gas.',
    '¿Cuánto dinero va a los jugadores?',
    'Alrededor del 85,7% con el tiempo. Cada ronda paga el 75% de su pool a los tres ganadores y el 12,5% al desarrollo; el otro 12,5% pasa a la ronda siguiente, o sea vuelve a los jugadores — menos la misma parte de desarrollo cada vez que se recicla.',
    '¿Está disponible en mi país?',
    'El acceso depende de las normas de tu propia jurisdicción. Es tu responsabilidad verificar si tienes permiso para participar en el lugar donde vives.',
  ],
};

await test(['LK10'], 'what is needed to play, where the ticket money goes and the jurisdiction notice are on /play’s Overview in English, Portuguese and Spanish, word for word as the home page had them at 1acef6c (the Portuguese in Portugal’s Portuguese since commit B), shown, not folded — and the home page does not get them back (checked in the source)', () => {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const before = git('show', '1acef6c:pages/landing.i18n.ts');
  const source = read('pages/app.i18n.ts');
  const starts = ['en', 'pt', 'es'].map((lang) => source.indexOf(`const ${lang}: AppCopy = {`));
  const block = (index) => source.slice(starts[index], starts[index + 1] ?? undefined);
  ['en', 'pt', 'es'].forEach((lang, index) => {
    for (const text of PLAY_RULES[lang]) {
      if (lang !== 'pt' || PLAY_RULES_KEPT_PT.includes(text)) assert.ok(before.includes(`'${text}'`), `${lang}: "${text.slice(0, 40)}…" is not the text of 1acef6c`);
      assert.ok(block(index).includes(`'${text}'`), `${lang}: "${text.slice(0, 40)}…" is not on /play`);
      assert.ok(!read('pages/landing.i18n.ts').includes(text) && !read('pages/Landing.tsx').includes(text), `the home page has "${text.slice(0, 40)}…"`);
    }
  });
  const dashboard = codeOf('pages/Dashboard.tsx');
  assert.match(read('App.tsx'), /<Route path="\/play" element=\{<GameLayout \/>\}>\s*<Route index element=\{<Dashboard \/>\} \/>/);
  for (const key of ['title', 'toPlayersLabel', 'toPlayers']) assert.match(dashboard, new RegExp(`\\{c\\.rules\\.${key}\\}`), key);
  assert.match(dashboard, /\{c\.rules\.items\.map\(\(item\) => \(/);
  assert.ok(!/<details/.test(dashboard), 'the Overview folds them away');
});

await test(['LK11'], 'no translation key is left unused: every word of the Keptra dictionary is read by a Keptra page or component, and its `errors` are sentences this app writes, word for word; every order state and summary word by its module; every word of /play’s new block by the Overview (checked in the source)', async () => {
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  const sources = [...KEPTRA_PAGES, ...KEPTRA_PARTS].map(codeOf).join('\n');
  for (const [section, value] of Object.entries(k.en)) {
    if (section === 'errors') continue;
    if (Array.isArray(value)) {
      assert.match(sources, new RegExp(`\\bt\\.${section}\\[`), `${section} is not used`);
      continue;
    }
    for (const key of Object.keys(value)) assert.match(sources, new RegExp(`\\bt\\.${section}\\.${key}\\b`), `${section}.${key} is not used`);
  }
  const client = ['lib/keptra/api.ts', 'lib/keptra/reads.ts', 'lib/keptra/relay.ts', 'lib/keptra/webauthn.ts', 'components/keptra/KeptraProvider.tsx'].map(read).join('\n');
  for (const [key, sentence] of Object.entries(k.en.errors)) assert.ok(client.includes(sentence), `errors.${key} is not a sentence this app writes`);
  const orders = codeOf('lib/keptra/orders.ts');
  for (const key of Object.keys(clientOrders.STATUS_WORDS.en)) assert.match(orders, new RegExp(`words\\.${key}\\b|\\.${key}\\.replace\\(`), `STATUS_WORDS.${key} is not used`);
  const formatCode = codeOf('lib/keptra/format.ts');
  for (const key of Object.keys(format.SUMMARY_WORDS.en)) assert.match(formatCode, new RegExp(`(?:words|SUMMARY_WORDS\\[lang\\])\\.${key}\\b`), `SUMMARY_WORDS.${key} is not used`);
  const dashboard = codeOf('pages/Dashboard.tsx');
  const rulesKeys = [...read('pages/app.i18n.ts').match(/ {2}rules: \{\n([\s\S]*?)\n {2}\};/)[1].matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(rulesKeys, ['title', 'toPlayersLabel', 'toPlayers', 'items']);
  for (const key of rulesKeys) assert.match(dashboard, new RegExp(`c\\.rules\\.${key}\\b`), `rules.${key} is not used`);
});

// ---------------------------------------------------------------------------
// Commit A4 — the owner's decisions of 27/09/2026 after the audit of A3.
// ---------------------------------------------------------------------------

await test(['LK12'], 'an amount a person types is read in the form of the page’s language — in Portuguese and Spanish one comma for the cents and no point, in English one point and no comma — and anything else is refused with how to write it, never read as another figure; every amount field of the Keptra pages says so (checked in the source)', async () => {
  const USDC = { '1.500': 1_500_000n, '1,000': 1_000_000n, '12,50': 12_500_000n, '12.50': 12_500_000n };
  const expected = {
    en: { '1.500': USDC['1.500'], '1,000': null, '12,50': null, '12.50': USDC['12.50'], '1 234': null },
    pt: { '1.500': null, '1,000': USDC['1,000'], '12,50': USDC['12,50'], '12.50': null, '1 234': null },
    es: { '1.500': null, '1,000': USDC['1,000'], '12,50': USDC['12,50'], '12.50': null, '1 234': null },
  };
  for (const [lang, values] of Object.entries(expected)) {
    for (const [text, value] of Object.entries(values)) assert.equal(format.parseUsdc(text, lang), value, `${lang} "${text}"`);
  }
  // Unchanged: at most six decimals, a whole number, one sign at most.
  assert.equal(format.parseUsdc('1500', 'pt'), 1_500_000_000n);
  assert.equal(format.parseUsdc('0,000001', 'es'), 1n);
  assert.equal(format.parseUsdc('1,1234567', 'pt'), null);
  assert.equal(format.parseUsdc('1,2,3', 'pt'), null);
  assert.equal(format.parseUsdc('1.2.3', 'en'), null);
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  assert.equal(k.en.ui.amountFormat, 'Write without commas; use a point for cents (e.g. 1500 or 12.50).');
  assert.equal(k.pt.ui.amountFormat, 'Escreva sem pontos; use vírgula para os cêntimos (ex.: 1500 ou 12,50).');
  assert.equal(k.es.ui.amountFormat, 'Escribe sin puntos; usa coma para los céntimos (ej.: 1500 o 12,50).');
  // Every amount field: the send-USDC and prize forms (account), the refund and the offer's and obligation's conditions (console).
  const account = codeOf('pages/keptra/AccountPage.tsx');
  assert.match(account, /if \(value === null && amount\.trim\(\) !== ''\) return setMessage\(\{ tone: 'error', text: t\.ui\.amountFormat \}\);/);
  assert.match(account, /const clean = decimalText\(amount, lang\);/);
  assert.match(account, /amount\.trim\(\) === '' \? t\.account\.amountNeeded : t\.ui\.amountFormat/);
  const business = codeOf('pages/keptra/BusinessPage.tsx');
  assert.match(business, /if \(value === null && amount\.trim\(\) !== ''\) return setError\(t\.ui\.amountFormat\);/);
  assert.match(business, /\[draft\.price, draft\.shipping, draft\.returnCost\]\.some\(\(text\) => text\.trim\(\) !== '' && parseUsdc\(text, lang\) === null\)\) return \{ error: t\.ui\.amountFormat \}/);
  // No amount is read without the page's language.
  for (const path of KEPTRA_PAGES) {
    for (const m of codeOf(path).matchAll(/\b(?:parseUsdc|decimalText)\(([^()]*)\)/g)) assert.match(m[1], /, lang$/, `${path}: ${m[0]}`);
  }
});

await test(['LK13'], 'the words the audit of A3 named: the countries in Portugal’s Portuguese, one minute and one day in the singular, “Verifique”, “Encomendas por cumprir”, “das participações”, and /play’s section titled “Before you play” in the three languages (the voucher page and /play’s copy checked in the source)', async () => {
  assert.deepEqual(['IR', 'VN', 'PL', 'KE'].map((c) => format.countryName(c, 'pt')), ['Irão', 'Vietname', 'Polónia', 'Quénia']);
  assert.deepEqual(['IR', 'PL'].map((c) => format.countryName(c, 'en')), ['Iran', 'Poland']);
  assert.deepEqual(['IR', 'PL'].map((c) => format.countryName(c, 'es')), ['Irán', 'Polonia']);
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => format.timeLeft(90, 0, lang)), ['in 1 minute', 'dentro de 1 minuto', 'en 1 minuto']);
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => format.timeLeft(150, 0, lang)), ['in 2 minutes', 'dentro de 2 minutos', 'en 2 minutos']);
  const { keptraTranslations: k, fill } = await import('../../../pages/keptra.i18n.ts');
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => fill(k[lang].voucher.shipDaysOne, { n: 1 })), ['1 day of redeeming', '1 dia após o resgate', '1 día desde el canje']);
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => fill(k[lang].voucher.deliveryDaysOne, { n: 1 })), ['1 day of shipping', '1 dia após o envio', '1 día desde el envío']);
  const voucher = codeOf('pages/keptra/VoucherPage.tsx');
  assert.match(voucher, /terms\.shipDays === 1 \? t\.voucher\.shipDaysOne : t\.voucher\.shipDaysMany/);
  assert.match(voucher, /terms\.deliveryDays === 1 \? t\.voucher\.deliveryDaysOne : t\.voucher\.deliveryDaysMany/);
  assert.match(k.pt.sheet.intro, /^Verifique o que esta transacção faz\./);
  assert.equal(k.pt.business.ordersTitle, 'Encomendas por cumprir');
  assert.equal(k.pt.pool.providerShare, '{pct} das participações');
  // /play's copy, one block per language (as LK10 reads it).
  const source = read('pages/app.i18n.ts');
  const starts = ['en', 'pt', 'es'].map((lang) => source.indexOf(`const ${lang}: AppCopy = {`));
  const titles = starts.map((start, index) => source.slice(start, starts[index + 1] ?? undefined).match(/ {2}rules: \{\n {4}title: '([^']*)',/)?.[1]);
  assert.deepEqual(titles, ['Before you play', 'Antes de jogar', 'Antes de jugar']);
});

// ---------------------------------------------------------------------------
// Commit B — the owner's decisions of 27/09/2026 after A4 (branch feat/landing-keptra-b).
// ---------------------------------------------------------------------------

await test(['LK14'], 'the diagrams of chapters 02 to 04 tell their steps in order at every phase — a brand’s sale (offer, payment into escrow, shipment, proof, the proof kept, the brand paid), a purchase (payment into escrow, delivery, the days to contest, inside the window, the arbiter, then the money out of escrow, to the store and back to the customer in turn, both ways in the still picture — commit B8), the pool (capital in, guarantees up to the limit, brands paying back) — on the film’s clock (pause and reduced motion), each in its chapter in place of the scene, the pool’s drawn from the amounts read on-chain; chapter 05 keeps its shape beside the modules’ cards; neither the first screen’s diagram nor the purchase names bond, risk reserve or pool (B8) (checked in the source)', async () => {
  const flow = await import('../../../lib/proof/flow.ts');
  const phases = Array.from({ length: 3001 }, (_unused, i) => (i / 3000) * 3 - 1);
  for (const phase of phases) {
    const b = flow.brandFrame(phase);
    if (b.pay > 0) assert.equal(b.publish, 1, `paid before published at ${phase}`);
    if (b.held > 0) assert.equal(b.pay, 1, `held before paid at ${phase}`);
    if (b.ship > 0) assert.equal(b.held, 1, `shipped before held at ${phase}`);
    if (b.proven > 0) assert.equal(b.ship, 1, `proven before shipped at ${phase}`);
    if (b.kept > 0) assert.equal(b.proven, 1, `proof kept before proven at ${phase}`);
    if (b.paid > 0) assert.equal(b.proven, 1, `brand paid before the proof at ${phase}`);
    const u = flow.purchaseFrame(phase);
    if (u.held > 0) assert.equal(u.pay, 1, `held before paid at ${phase}`);
    if (u.delivered > 0) assert.equal(u.held, 1, `delivered before the payment is held at ${phase}`);
    if (u.window > 0) assert.equal(u.delivered, 1, `the days to contest before the delivery at ${phase}`);
    if (u.arbiter > 0) assert.equal(u.window, 1, `the arbiter before the days to contest at ${phase}`);
    if (u.out > 0) assert.equal(u.arbiter, 1, `out of escrow before the arbiter decides at ${phase}`);
    // The store and the customer take turns: one cycle each.
    assert.notEqual(u.toStore, flow.purchaseFrame(phase + 1).toStore, `the same way out two cycles running at ${phase}`);
    const p = flow.poolFrame(phase);
    if (p.capital > 0) assert.equal(p.deposit, 1, `capital before the deposits at ${phase}`);
    if (p.cover > 0) assert.equal(p.capital, 1, `guarantees before the capital at ${phase}`);
    if (p.repay > 0) assert.equal(p.cover, 1, `repayment before the guarantees at ${phase}`);
  }
  assert.deepEqual(flow.brandFrame(flow.BRAND_FINAL), { publish: 1, pay: 1, held: 1, ship: 1, proven: 1, kept: 1, paid: 1, shown: 1 });
  assert.deepEqual(flow.purchaseFrame(flow.PURCHASE_FINAL), { pay: 1, held: 1, delivered: 1, window: 1, arbiter: 1, out: 1, toStore: true, shown: 1 });
  // The contest falls inside the five days (KeptraEscrow.contest reverts after windowEndsAt, :648 at 5d85a46).
  assert.ok(Number.isInteger(flow.CONTEST_DAY) && flow.CONTEST_DAY >= 1 && flow.CONTEST_DAY < 5, `contest on day ${flow.CONTEST_DAY}`);
  assert.deepEqual(flow.poolFrame(flow.POOL_FINAL), { deposit: 1, capital: 1, cover: 1, repay: 1, shown: 1 });
  // On the film's clock, the drawing hidden from assistive technology, its steps read.
  for (const [file, name] of [['BrandFlow', 'BRAND'], ['PurchaseFlow', 'PURCHASE'], ['PoolFlow', 'POOL']]) {
    const code = codeOf(`components/proof/${file}.tsx`);
    assert.ok(code.includes(`useFilmTimeline(root, ${name}_PERIOD, ${name}_FINAL, draw);`), file);
    assert.match(code, /aria-hidden="true"/, `${file}: the drawing is not hidden`);
    assert.match(code, /<ol/, `${file}: no list of its steps`);
  }
  assert.ok(!/\d[\d.,]*\s*USDC/.test(codeOf('components/proof/PoolFlow.tsx')), 'the pool’s diagram writes a figure');
  assert.match(codeOf('components/proof/PoolFlow.tsx'), /typeof active === 'bigint' && typeof free === 'bigint'/);
  // A purchase: one way out per cycle while it moves, both in the still picture; no guarantee, reserve or pool in it.
  const purchase = codeOf('components/proof/PurchaseFlow.tsx');
  assert.match(purchase, /const both = !liveRef\.current;/);
  assert.match(purchase, /set\(storeLine\.current, f\.toStore \|\| both \? f\.out : 0, f\.shown\);\s*set\(backLine\.current, !f\.toStore \|\| both \? f\.out : 0, f\.shown\);/);
  assert.ok(!/layers|bond|reserve|pool/i.test(purchase), 'the purchase names a guarantee layer');
  // In their chapters, in place of the scene, which waits hidden; chapter 05 keeps its shape.
  const page = codeOf('pages/Landing.tsx');
  assert.match(page, /<Chapter id="for-brands" keys=\{KEYS\.brands\} label=\{brandsWho\} figure=\{brandFlow\}/);
  assert.match(page, /<Chapter id="for-customers" keys=\{KEYS\.customers\} label=\{customersWho\} figure=\{purchaseFlow\}/);
  assert.match(page, /<Chapter id="film-pool" keys=\{KEYS\.pool\} label=\{t\.pool\.label\} figure=\{poolFlow\}/);
  assert.match(page, /<PoolFlow copy=\{t\.diagrams\.pool\} active=\{pool\.active\} free=\{pool\.free\} \/>/);
  for (const key of ['brands', 'customers', 'pool']) assert.match(page, new RegExp(`  ${key}: \\[\\{ at: 0\\.2, shape: '\\w+', alpha: 0,`), key);
  assert.match(page, /<Chapter id="film-modules" keys=\{KEYS\.modules\} wide label=\{t\.modules\.title\} caption=\{t\.film\.captions\.modules\}>/);
  const chapter = codeOf('components/film/Chapter.tsx');
  assert.match(chapter, /<FilmAnchor keys=\{keys\} ghost className="pointer-events-none absolute inset-0" \/>\s*<div data-film-panel>\{figure\}<\/div>/);
  // B8: the first screen's diagram has no chain of layers left; the owner's sentence is under it.
  const { translations } = await import('../../../pages/landing.i18n.ts');
  for (const lang of ['en', 'pt', 'es']) {
    const t = translations[lang];
    assert.deepEqual(Object.keys(t.flow), ['customer', 'store', 'escrow', 'oracle', 'proven', 'note'], `${lang}: the first screen's labels`);
    assert.equal(t.diagrams.purchase.steps.length, 5, `${lang}: the owner's five steps of a purchase`);
    assert.ok(!/bond|reserv|pool|caução|fianza/i.test(JSON.stringify(t.diagrams.purchase)), `${lang}: the purchase names a guarantee layer`);
  }
  const escrow = codeOf('components/proof/EscrowFlow.tsx');
  assert.ok(!/layers|refund/.test(escrow), 'the first screen still draws the layers');
  assert.match(escrow, /<\/div>\s*<p [^>]*>\{copy\.note\}<\/p>\s*<\/div>\s*\);\s*\}\s*$/);
});

await test(['LK15'], 'chapter 02 carries the owner’s two sentences under its text, word for word — the on-chain proof against a chargeback, and card payments next with the company being incorporated — and the cards open with the owner’s “Verified delivery” (its text as rewritten for B8: escrow, 5 days, arbiter; the three layers for prizes), live, to /business, numbered first, the modules after it (checked in the source)', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  const owner = {
    en: {
      proof: 'Every delivery leaves an on-chain proof — evidence you can use against a chargeback.',
      next: 'Next: your customers pay by card, as they always do — and delivery stays guaranteed. Company being incorporated to connect card payments.',
      card: { name: 'Verified delivery', badge: 'LIVE', cta: 'For brands', body: "Payment waits in escrow until the customer confirms the delivery or 5 days pass without a contest; a contest goes to an arbiter, with the money still in escrow. Prizes brands promise are backed by the brand's bond and, by tier, a risk reserve and the pool." },
    },
    pt: {
      proof: 'Cada entrega deixa uma prova on-chain — uma evidência que pode usar para contestar um chargeback.',
      next: 'A seguir: os seus clientes pagam com cartão, como sempre — e a entrega continua garantida. Empresa em constituição para ligar os pagamentos com cartão.',
      card: { name: 'Entrega verificada', badge: 'AO VIVO', cta: 'Para marcas', body: 'O pagamento espera num escrow até o cliente confirmar a entrega ou passarem 5 dias sem contestação; uma contestação vai a um árbitro, com o dinheiro ainda no escrow. Os prémios que as marcas prometem são garantidos pela caução da marca e, conforme o escalão, por uma reserva de risco e pelo pool.' },
    },
    es: {
      proof: 'Cada entrega deja una prueba on-chain — una evidencia que puedes usar para disputar un contracargo.',
      next: 'Próximamente: tus clientes pagan con tarjeta, como siempre — y la entrega sigue garantizada. Empresa en constitución para conectar los pagos con tarjeta.',
      card: { name: 'Entrega verificada', badge: 'EN VIVO', cta: 'Para marcas', body: 'El pago espera en un escrow hasta que el cliente confirma la entrega o pasan 5 días sin impugnación; una impugnación va a un árbitro, con el dinero aún en el escrow. Los premios que prometen las marcas están garantizados por la fianza de la marca y, según el nivel, por una reserva de riesgo y el pool.' },
    },
  };
  for (const [lang, o] of Object.entries(owner)) {
    const t = translations[lang];
    assert.equal(t.brands.proof, o.proof, `${lang} chapter 02, the proof`);
    assert.equal(t.brands.next, o.next, `${lang} chapter 02, card payments`);
    assert.deepEqual(t.modules.items[0], o.card, `${lang} the first card`);
    assert.equal(t.modules.items.length, 4, `${lang}: four cards`);
    // The modules keep their product names, which are not translated.
    assert.ok(t.modules.items.slice(1).every((item) => item.name === undefined), `${lang}: a module's name translated`);
  }
  const page = codeOf('pages/Landing.tsx');
  // Under chapter 02's text, before its link.
  assert.match(page, /\{t\.brands\.body\}<\/p>\s*<p [^>]*>\{t\.brands\.proof\}<\/p>\s*<p [^>]*>\{t\.brands\.next\}<\/p>\s*<Link to="\/business"/);
  // First, live, to /business; the others after it; the number follows the order.
  assert.match(page, /const MODULES: [^=]+= \[\s*\{ to: '\/business', icon: PackageCheck, live: true \},\s*\{ name: 'INSTANT WIN', to: '\/play'/);
  assert.match(page, /\{`0\$\{i \+ 1\}`\}/);
  assert.match(page, /\{copy\.name \?\? m\.name\}<\/h3>/);
});

await test(['LK16'], '/business without a session explains Keptra to a brand above the sign-in panel — the owner’s title, what it gains (chapter 02 and the chargeback sentence), how it works, and what it costs read on-chain only (the terms of a brand with no history: bond, protection fee, coverage limit; no deposit to sell), the fee per sale “Talk to us” since no ABI of the page reads it; then the contact address with its Copy button, then the panel; nothing of it when signed in; “Orders to fulfil” only with a session, the explanation’s title the page’s own without one (B8) (checked in the source)', async () => {
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  assert.deepEqual(['en', 'pt', 'es'].map((lang) => k[lang].brandPitch.title), ['Offer verified delivery', 'Ofereça entrega verificada', 'Ofrece entrega verificada']);
  assert.equal(k.pt.brandPitch.talkToUs, 'Fale connosco');
  for (const lang of ['en', 'pt', 'es']) {
    const p = k[lang].brandPitch;
    assert.equal(p.howSteps.length, 5, `${lang}: publish, pay into escrow, ship, proof, paid`);
    // No figure is written: every number is a chain read put into {percent}, {amount} or {tier}.
    for (const [path, word] of wordsOf(p)) assert.ok(!/\d/.test(word), `${lang} brandPitch${path} writes a figure`);
    assert.match(p.prizeBondValue, /\{percent\}/);
    assert.match(p.protectionValue, /\{percent\}/);
    assert.match(p.coverageLimitValue, /\{amount\}/);
    assert.match(p.costIntro, /\{tier\}/);
  }
  const page = codeOf('pages/keptra/BusinessPage.tsx');
  // Above the sign-in panel, on /business only, and only when the bridge says there is no session.
  assert.match(page, /\{signedIn === false && section === 'orders' && id === undefined && <BrandPitch \/>\}\s*<RequireAccount intro=\{t\.business\.intro\}>/);
  // B8: the orders' title only with a session; without one, the explanation's title is the page's one h1.
  assert.match(page, /const ordersWithoutSession = keptraConfigured\(\) && section === 'orders' && id === undefined && signedIn !== true;/);
  assert.match(page, /\{!ordersWithoutSession && <PageTitle eyebrow=\{t\.business\.eyebrow\} title=\{id \? fill\(t\.business\.orderTitle, \{ id \}\) : title\} \/>\}/);
  assert.match(page, /<h1 id="brand-pitch"[^>]*>\s*\{t\.brandPitch\.title\}\s*<\/h1>/);
  // The terms of a brand with no history, from the reputation the escrow names, through the bridge's own ABI.
  assert.match(page, /import \{ KEPTRA_REPUTATION_ABI \} from '\.\.\/\.\.\/lib\/bridge-v2\/abi';/);
  assert.match(page, /functionName: 'reputation'/);
  assert.match(page, /abi: KEPTRA_REPUTATION_ABI,\s*functionName: 'termsFor',\s*args: \[NO_HISTORY\],/);
  assert.match(page, /const NO_HISTORY = '0x0{40}';/);
  assert.match(page, /\[t\.brandPitch\.saleFee, t\.brandPitch\.talkToUs\]/);
  assert.match(page, /formatPercent\(params\.bondBps, lang\)/);
  assert.match(page, /formatPercent\(params\.protectionBps, lang\)/);
  assert.match(page, /formatUsdc\(params\.coverageLimit, lang\)/);
  assert.match(page, /const pending = failed \? t\.ui\.notRead : '…';/);
  // Chapter 02's text and its chargeback sentence, from the home page's dictionary.
  assert.match(page, /\{`\$\{home\.title\} \$\{home\.body\}`\}/);
  assert.match(page, /\{home\.proof\}/);
  // The contact address with its Copy button closes the explanation.
  const pitch = page.slice(page.indexOf('function BrandPitch()'), page.indexOf('function BusinessBody('));
  assert.match(pitch, /<ContactEmail \/>\s*<\/div>\s*<\/section>/);
  // The ABIs are untouched: the fee per sale is still read by no ABI of the page (P6-19).
  assert.ok(!contracts.ESCROW_READ_ABI.some((item) => item.name === 'feeBps'));
});

await test(['LK17'], '/roadmap keeps its six steps, numbered 01 to 06 — “Verified delivery”, live now, with the escrow, guarantee and pool to verify on Arbiscan; the lottery; “Giveaways & Event Center”; the regulated company; “Card payments”, labelled “Mass adoption”; “Keptra Token”, labelled “The last module” — each with the owner’s text of 29/09/2026, word for word, in the three languages; only the first three are on-chain; Enter App leads to /orders (checked in the source)', async () => {
  const { roadmapTranslations: r } = await import('../../../pages/roadmap.i18n.ts');
  const owner = {
    en: {
      titles: ['Verified delivery', 'Provably Fair Lottery', 'Giveaways & Event Center', 'Regulated company', 'Card payments', 'Keptra Token'],
      statuses: ['Live now', 'Live now', 'Live now', 'Next', 'Mass adoption', 'The last module'],
      bodies: [
        "Free shipping made customers smile, easy returns made them loyal. Verified delivery is the next benefit every brand will offer. The customer's payment is held in escrow, a Chainlink oracle proves the delivery from the carrier's tracking, and every proven delivery leaves an on-chain record — evidence against a chargeback.",
        'A lottery nobody can rig: 30-minute rounds, Chainlink VRF draws, every round closed by Chainlink CRE, prizes claimed straight from the contract.',
        'Any brand, creator or community runs a prize campaign. Prize modules for ERC-20, ERC-721 and ERC-1155, so a campaign can distribute any tokenized asset. One verified person, one entry — no bot farms taking the prize.',
        'To operate this at scale we intend to become a regulated company. The order is fixed and will not be skipped: a legal entity first, then licensing.',
        "Next, customers pay by card, exactly as they do today, with the same guarantee. They never touch crypto — they just buy from a brand that offers Keptra. That's how Keptra reaches everyone: not by teaching the world crypto, but by making its guarantees invisible inside every checkout.",
        "The network's own asset, connecting brands, customers and the providers who back the guarantee across every Keptra product. Launched inside the regulated company, never before it.",
      ],
    },
    pt: {
      titles: ['Entrega verificada', 'Lotaria Comprovadamente Justa', 'Giveaways e Event Center', 'Empresa regulada', 'Pagamento com cartão', 'Keptra Token'],
      statuses: ['Ao vivo agora', 'Ao vivo agora', 'Ao vivo agora', 'A seguir', 'Adopção em massa', 'O último módulo'],
      bodies: [
        'Os portes grátis fizeram os clientes sorrir, as devoluções fáceis tornaram-nos fiéis. A entrega verificada é o próximo benefício que todas as marcas vão oferecer. O pagamento do cliente fica retido em escrow, um oráculo Chainlink prova a entrega a partir do tracking da transportadora, e cada entrega provada deixa um registo on-chain — evidência contra um chargeback.',
        'Uma lotaria que ninguém consegue viciar: rondas de 30 minutos, sorteios pela Chainlink VRF, cada ronda fechada pela Chainlink CRE, prémios levantados directamente do contrato.',
        'Qualquer marca, criador ou comunidade faz uma campanha de prémios. Módulos de prémio para ERC-20, ERC-721 e ERC-1155, para que uma campanha possa distribuir qualquer activo tokenizado. Uma pessoa verificada, uma participação — sem fazendas de bots a levar o prémio.',
        'Para operar isto à escala, pretendemos tornar-nos uma empresa regulada. A ordem é fixa e não será saltada: primeiro uma entidade legal, depois o licenciamento.',
        'A seguir, os clientes pagam com cartão, exactamente como fazem hoje, com a mesma garantia. Nunca tocam em cripto — simplesmente compram a uma marca que oferece a Keptra. É assim que a Keptra chega a toda a gente: não a ensinar cripto ao mundo, mas a tornar as suas garantias invisíveis dentro de cada checkout.',
        'O activo da própria rede, que liga marcas, clientes e os provedores que sustentam a garantia em todos os produtos Keptra. Lançado dentro da empresa regulada, nunca antes dela.',
      ],
    },
    es: {
      titles: ['Entrega verificada', 'Lotería Demostrablemente Justa', 'Giveaways y Event Center', 'Empresa regulada', 'Pago con tarjeta', 'Keptra Token'],
      statuses: ['En vivo ahora', 'En vivo ahora', 'En vivo ahora', 'Siguiente', 'Adopción masiva', 'El último módulo'],
      bodies: [
        'El envío gratis hizo sonreír a los clientes, las devoluciones fáciles los fidelizaron. La entrega verificada es el próximo beneficio que todas las marcas ofrecerán. El pago del cliente queda retenido en escrow, un oráculo de Chainlink prueba la entrega a partir del seguimiento del transportista, y cada entrega probada deja un registro on-chain — evidencia contra un contracargo.',
        'Una lotería que nadie puede amañar: rondas de 30 minutos, sorteos con Chainlink VRF, cada ronda cerrada por Chainlink CRE, premios cobrados directamente del contrato.',
        'Cualquier marca, creador o comunidad organiza una campaña de premios. Módulos de premio para ERC-20, ERC-721 y ERC-1155, para que una campaña pueda distribuir cualquier activo tokenizado. Una persona verificada, una participación — sin granjas de bots llevándose el premio.',
        'Para operar esto a escala, tenemos la intención de convertirnos en una empresa regulada. El orden es fijo y no se saltará: primero una entidad legal, después la licencia.',
        'Después, los clientes pagan con tarjeta, exactamente como hoy, con la misma garantía. Nunca tocan cripto — simplemente compran a una marca que ofrece Keptra. Así llega Keptra a todos: no enseñando cripto al mundo, sino haciendo invisibles sus garantías dentro de cada checkout.',
        'El activo de la propia red, que conecta marcas, clientes y los proveedores que respaldan la garantía en todos los productos Keptra. Se lanza dentro de la empresa regulada, nunca antes.',
      ],
    },
  };
  for (const [lang, o] of Object.entries(owner)) {
    const steps = r[lang].steps;
    assert.deepEqual(steps.map((step) => step.title), o.titles, `${lang} order`);
    assert.deepEqual(steps.map((step) => step.num), ['01', '02', '03', '04', '05', '06'], `${lang} numbers`);
    // The label is the same word in the step and in the synthesis above the steps (both read `status`).
    assert.deepEqual(steps.map((step) => step.status), o.statuses, `${lang} labels`);
    assert.deepEqual(steps.map((step) => step.body), o.bodies.map((pre) => [{ pre }]), `${lang} texts`);
    // Live now, with their proof to verify: the delivery's three contracts, named.
    assert.ok(steps.slice(0, 3).every((step) => step.verify === steps[0].verify && step.verify), `${lang}: a live step without "verify it yourself"`);
    assert.equal(steps[0].contracts.length, 3, `${lang}: escrow, guarantee, pool`);
    // Nothing on-chain yet from the regulated company on.
    assert.ok(steps.slice(3).every((step) => step.verify === undefined), `${lang}: an intended step with an address`);
  }
  const page = codeOf('pages/Roadmap.tsx');
  // The same visual state as the regulated company: only the first three are on-chain.
  assert.match(page, /const ONCHAIN_STEPS = 3;/);
  assert.match(page, /\[KEPTRA_ESCROW, KEPTRA_GUARANTEE, pool\],\s*\[CONTRACTS\.RAFFLE_MANAGER\],\s*\[CONTRACTS\.GIVEAWAY_MANAGER_V2\],/);
  // The pool is the one the guarantee names, read on-chain; never a literal.
  assert.match(page, /useReadContract\(\{ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'defaultSource' \}\)/);
  assert.match(page, /href=\{`\$\{ARBISCAN\}\$\{address\}`\}/);
  assert.match(page, /<HeaderAction to="\/orders" icon=\{ArrowRight\} label=\{t\.header\.enterApp\} \/>/);
});

await test(['LK18'], 'the home page in Portuguese (the module cards, the captions, the footer) and /play in Portuguese, “Antes de jogar” included, are Portugal’s Portuguese — “prémio”, “ronda”, “lotaria”, “vencedores”, “utilizador”, no “você” — in the site’s spelling (“transacção”, “actual”)', async () => {
  const { translations } = await import('../../../pages/landing.i18n.ts');
  const { appTranslations } = await import('../../../pages/app.i18n.ts');
  // Whole words, accents included (\b alone ends a word at "ê").
  const BRAZIL = /(?<!\p{L})(?:você|vocês|rodadas?|prêmios?|ganhador(?:es)?|loteria|sacar|saque|sacado|usuário|registrar|registre|registrad[ao]s?|compartilhar|carregando|aguardando|fechando|processando|finalizando|sorteando|lendo|conectar|conecte|desconectar|atual|transação|apelido|suas? chances|rodam)(?!\p{L})/iu;
  const home = translations.pt;
  const homeWords = [...wordsOf(home.modules.items), ...wordsOf(home.film), ...wordsOf(home.footer)];
  for (const [path, word] of homeWords) assert.ok(!BRAZIL.test(word), `home pt${path}: "${word}"`);
  for (const [path, word] of wordsOf(appTranslations.pt)) assert.ok(!BRAZIL.test(word), `/play pt${path}: "${word}"`);
  assert.match(home.modules.items[1].body, /prémios/);
  assert.match(home.modules.items[1].body, /ronda/);
  assert.equal(home.modules.items[1].cta, 'Abrir a lotaria');
  assert.equal(appTranslations.pt.rules.title, 'Antes de jogar');
  assert.equal(appTranslations.pt.proof.vrfTx, 'Transacção do VRF');
  assert.equal(appTranslations.pt.raffle.currentPrizePool, 'Prémio actual');
  // The owner's texts on the home page stay as the owner wrote them.
  assert.equal(home.hero.ctaCustomers, 'Para clientes — Compre com uma garantia que pode conferir');
});

await test(['LK19'], 'a voucher’s failure is paid in the contracts’ order — the brand’s bond, then the risk reserve, then the pool’s capital (KeptraGuarantee.settleUnit, KeptraPool.payCoverage at 5d85a46) — and the voucher page and /pool’s introduction say the three layers in that order, in the three languages, as /pool’s own diagram of the order does (checked in the source)', async () => {
  const { keptraTranslations: k } = await import('../../../pages/keptra.i18n.ts');
  const layers = { en: ['bond', 'risk reserve', 'pool'], pt: ['caução', 'reserva de risco', 'pool'], es: ['fianza', 'reserva de riesgo', 'pool'] };
  for (const [lang, [bond, reserve, pool]] of Object.entries(layers)) {
    for (const [name, text] of [['voucher.failNote', k[lang].voucher.failNote], ['pool.intro', k[lang].pool.intro]]) {
      // In sequence: each layer after the one before it (the introduction names the pool and the bond earlier too).
      let from = 0;
      for (const word of [bond, reserve, pool]) {
        const at = text.indexOf(word, from);
        assert.ok(at >= 0, `${lang} ${name}: no ${word} after the layer before it: ${text}`);
        from = at + word.length;
      }
    }
  }
  // /pool's own diagram of the order, unchanged: bond, risk reserve, capital.
  assert.match(codeOf('pages/keptra/PoolPage.tsx'), /\{ name: t\.pool\.bond,[^}]*\},\s*\{ name: t\.pool\.reserve,[^}]*\},\s*\{ name: t\.pool\.capital,/);
});

await test(['LK20'], 'a small phone (375×667) holds each pinned chapter of the home page under the two-row header with its last link on screen — chapter 03’s “See the pool” first, with its drawing — in the three languages: the chapter starts below the header and overflows, if ever, at its foot; the sentence title steps down on a short phone; each drawing is sized by what the chapter’s text leaves, and gives way where its labels would no longer read (chapter 02 below 840px of height, chapter 04 below 720px), in the pinned film only (checked in the source; measured in the browser for the report)', () => {
  const chapter = codeOf('components/film/Chapter.tsx');
  // Below the 117px header, never under it; safe: an overflow falls at the foot.
  assert.match(chapter, /live \? 'h-full \[align-content:safe_center\] pb-6 pt-\[7\.75rem\] lg:py-0'/);
  assert.match(chapter, /sentence \? 'text-\[clamp\(1\.85rem,6vw,2\.6rem\)\] leading-\[1\.08\] max-lg:\[@media\(max-height:700px\)\]:text-\[1\.6rem\]'/);
  assert.match(chapter, /aspect-\[4\/3\] max-w-\[min\(92vw,calc\(\(100svh_-_32rem\)_\*_1\.33\)\)\]/);
  const page = codeOf('pages/Landing.tsx');
  const live = (formula) => `max-w-[34rem] [.film-live_&]:max-lg:max-w-[min(34rem,calc(${formula}))]`;
  assert.ok(page.includes(`brands: '${live('(100svh_-_42rem)*1.6')} [.film-live_&]:max-lg:[@media(max-height:840px)]:hidden',`), 'chapter 02');
  assert.ok(page.includes(`customers: '${live('(100svh_-_29rem)*1.76')}',`), 'chapter 03 keeps its drawing');
  assert.ok(page.includes(`pool: '${live('(100svh_-_33.5rem)*1.65')} [.film-live_&]:max-lg:[@media(max-height:720px)]:hidden',`), 'chapter 04');
  // Chapter 03 ends with its link to /pool.
  assert.match(page, /\{t\.customers\.body\}<\/p>\s*<Link to="\/pool" className=\{clsx\(QUIET_LINK, 'mt-4'\)\}>\s*\{t\.hero\.seePool\}/);
});

await test(['LK21'], '/roadmap tells the owner’s vision of 29/09/2026 in its order — the top (“The trust layer for every promise.”), the problem nobody solved and what we built, the synthesis of the phases, the three steps on-chain, the line under them (“Not a demo…”), the three intended, the size of the opportunity, where this goes and why now, then the final shape and its call — word for word in the three languages; the close keeps its note without dates; the page’s description is the top’s introduction (checked in the source)', async () => {
  const { roadmapTranslations: r } = await import('../../../pages/roadmap.i18n.ts');
  const owner = {
    en: {
      title: 'The trust layer for every promise.',
      intro: 'Every day, people are made promises. Your order will arrive. This draw is fair. Your prize will be paid. Today, all of them run on one thing: “trust me.” Keptra replaces “trust me” with proof.',
      story: [
        ['The problem nobody solved', 'Tokenized assets are coming on-chain at scale. Robinhood Chain will issue them. Institutions will mint them. But the moment a promise touches the real world — a product has to arrive, a winner has to be drawn, a prize has to be paid — everything falls back to “trust me.” And the billions of people outside crypto stay outside.'],
        ['What we built', 'Keptra is the layer that turns those promises into proof. One infrastructure on Arbitrum One, with Chainlink proving what happens in the real world — and the person on the other side never needs to know what a wallet is. They use their email. Under the hood each person gets a real wallet, created invisibly, signing their own actions. Web2 in, proof out.'],
      ],
      proofLine: "Not a demo. Not a testnet. Deployed, verified, running. Don't believe us. Go check.",
      ahead: [
        ['Where this goes', 'From there, Keptra becomes the default trust layer of commerce — every online store, every marketplace, every country. And every real-world asset that has to physically arrive gets a delivery the world can verify.'],
        ['Why now', 'The rails for tokenized assets are being laid now. The trust layer between them and real people is not. We built it, it runs, and it works for people who have never heard of a wallet.'],
      ],
      close: ['Building the trust layer for every promise.', 'Mass adoption starts with card payments. Early conversations with investors and partners are open.'],
      note: 'No dates. Each step depends on the one before it. What exists is published with the contract address next to it.',
    },
    pt: {
      title: 'A camada de confiança para cada promessa.',
      intro: 'Todos os dias, são feitas promessas às pessoas. A tua encomenda vai chegar. Este sorteio é justo. O teu prémio vai ser pago. Hoje, todas elas assentam numa única coisa: “confia em mim.” A Keptra substitui o “confia em mim” por prova.',
      story: [
        ['O problema que ninguém resolveu', 'Os activos tokenizados estão a chegar à blockchain em grande escala. A Robinhood Chain vai emiti-los. As instituições vão criá-los. Mas no momento em que uma promessa toca o mundo real — um produto tem de chegar, um vencedor tem de ser sorteado, um prémio tem de ser pago — tudo volta ao “confia em mim”. E os milhares de milhões de pessoas fora do cripto continuam de fora.'],
        ['O que construímos', 'A Keptra é a camada que transforma essas promessas em prova. Uma infraestrutura na Arbitrum One, com a Chainlink a provar o que acontece no mundo real — e a pessoa do outro lado nunca precisa de saber o que é uma carteira. Usa o email. Por trás, cada pessoa recebe uma carteira real, criada de forma invisível, que assina as suas próprias acções. Entra web2, sai prova.'],
      ],
      proofLine: 'Não é uma demo. Não é uma testnet. Implantado, verificado, a funcionar. Não acredites em nós. Vai confirmar.',
      ahead: [
        ['Para onde isto vai', 'A partir daí, a Keptra torna-se a camada de confiança padrão do comércio — cada loja online, cada marketplace, cada país. E cada activo do mundo real que tenha de chegar fisicamente a algum lado ganha uma entrega que o mundo pode verificar.'],
        ['Porquê agora', 'Os carris para os activos tokenizados estão a ser construídos agora. A camada de confiança entre eles e as pessoas reais não está. Nós construímo-la, funciona, e funciona para pessoas que nunca ouviram falar de uma carteira.'],
      ],
      close: ['A construir a camada de confiança para cada promessa.', 'A adopção em massa começa com os pagamentos com cartão. Estão abertas conversas iniciais com investidores e parceiros.'],
      note: 'Sem datas. Cada passo depende do anterior. O que existe é publicado com o endereço do contrato ao lado.',
    },
    es: {
      title: 'La capa de confianza para cada promesa.',
      intro: 'Cada día, se hacen promesas a las personas. Tu pedido llegará. Este sorteo es justo. Tu premio se pagará. Hoy, todas se apoyan en una sola cosa: “confía en mí.” Keptra sustituye el “confía en mí” por pruebas.',
      story: [
        ['El problema que nadie resolvió', 'Los activos tokenizados están llegando on-chain a gran escala. Robinhood Chain los emitirá. Las instituciones los crearán. Pero en cuanto una promesa toca el mundo real — un producto tiene que llegar, un ganador tiene que ser sorteado, un premio tiene que pagarse — todo vuelve al “confía en mí”. Y los miles de millones de personas fuera de cripto siguen fuera.'],
        ['Lo que construimos', 'Keptra es la capa que convierte esas promesas en pruebas. Una infraestructura en Arbitrum One, con Chainlink probando lo que ocurre en el mundo real — y la persona del otro lado nunca necesita saber qué es una wallet. Usa su email. Por dentro, cada persona recibe una wallet real, creada de forma invisible, que firma sus propias acciones. Entra web2, sale prueba.'],
      ],
      proofLine: 'No es una demo. No es una testnet. Desplegado, verificado, funcionando. No nos creas. Compruébalo.',
      ahead: [
        ['Hacia dónde va esto', 'A partir de ahí, Keptra se convierte en la capa de confianza por defecto del comercio — cada tienda online, cada marketplace, cada país. Y cada activo del mundo real que tenga que llegar físicamente obtiene una entrega que el mundo puede verificar.'],
        ['Por qué ahora', 'Los raíles de los activos tokenizados se están construyendo ahora. La capa de confianza entre ellos y las personas reales, no. Nosotros la construimos, funciona, y funciona para personas que nunca han oído hablar de una wallet.'],
      ],
      close: ['Construyendo la capa de confianza para cada promesa.', 'La adopción masiva empieza con los pagos con tarjeta. Están abiertas las conversaciones iniciales con inversores y socios.'],
      note: 'Sin fechas. Cada paso depende del anterior. Lo que existe se publica con la dirección del contrato al lado.',
    },
  };
  const blocks = (list) => list.map(([title, body]) => ({ title, body }));
  for (const [lang, o] of Object.entries(owner)) {
    const c = r[lang];
    assert.equal(c.hero.eyebrow, 'Roadmap', `${lang} eyebrow`);
    assert.equal(c.hero.title, o.title, `${lang} title`);
    assert.equal(c.hero.intro, o.intro, `${lang} introduction`);
    assert.deepEqual(c.story, blocks(o.story), `${lang} the problem, what we built`);
    assert.equal(c.proofLine, o.proofLine, `${lang} the line under 03`);
    assert.deepEqual(c.ahead, blocks(o.ahead), `${lang} where this goes, why now`);
    assert.deepEqual([c.outro.ctaLine1, c.outro.ctaLine2], o.close, `${lang} the close`);
    assert.equal(c.outro.note, o.note, `${lang} the note without dates stays`);
  }
  const page = codeOf('pages/Roadmap.tsx');
  // The page, top to bottom.
  const order = [
    '{c.hero.title}',
    '{c.story.map(',
    '{c.steps.map((step, i) => {',
    '{c.steps.slice(0, ONCHAIN_STEPS).map((step, i) => stepItem(step, i))}',
    '{c.proofLine}',
    '{c.steps.slice(ONCHAIN_STEPS).map((step, k) => stepItem(step, ONCHAIN_STEPS + k))}',
    '{c.opportunity.charts.map(',
    '{c.ahead.map(',
    '<RoadmapClose ',
  ];
  const at = order.map((mark) => page.indexOf(mark));
  assert.ok(at.every((index) => index >= 0), `missing: ${order.filter((_mark, k) => at[k] < 0)}`);
  assert.deepEqual([...at].sort((p, q) => p - q), at, 'out of order');
  // Both lists of steps hang on the one rail; the intended ones go on counting from 04.
  assert.match(page, /<div ref=\{rail\.list\} className="relative pb-4 sm:pl-20">/);
  assert.match(page, /<ol start=\{ONCHAIN_STEPS \+ 1\} /);
  // The close: its title and subtitle, the note without dates before them.
  const close = page.slice(page.indexOf('function RoadmapClose('));
  assert.ok(close.indexOf('{c.outro.note}') < close.indexOf('{c.outro.ctaLine1}') && close.indexOf('{c.outro.ctaLine1}') < close.indexOf('{c.outro.ctaLine2}'));
  assert.match(page, /tag\?\.setAttribute\('content', c\.hero\.intro\);/);
});

await test(['LK22'], '/roadmap’s size of the opportunity is two SVG bar charts and no more — verified delivery by share of global e-commerce, Instant Win by share of the online lottery market; nothing for the Keptra Token or the giveaways — each bar with its scenario, its share and its value in the owner’s figures, in the three languages, the sources and the fees read on-chain (escrow 1.5% per sale, lottery 12.5% of every round) in the notes, the line on card payments and the notice under them; the bars on one logarithmic scale, $10M to $10B, drawn to the owner’s revenue, and still in every mode (checked in the source)', async () => {
  const { roadmapTranslations: r } = await import('../../../pages/roadmap.i18n.ts');
  const owner = {
    en: {
      title: 'The size of the opportunity',
      scenarios: ['Launch', 'Growth', 'Maturity'],
      charts: [
        ['Verified Delivery — revenue by share of global e-commerce', [['0.1%', '$103M/year'], ['0.5%', '$516M/year'], ['2%', '$2.06B/year']], 'Global retail e-commerce: $6.88T in 2026 (EMARKETER via Shopify). Keptra fee: 1.5% per sale, read from the contract.'],
        ['Instant Win — revenue by share of the online lottery market', [['1%', '$24.3M/year'], ['5%', '$121M/year'], ['10%', '$243M/year']], 'Online lottery: $19.43B in 2029 (The Business Research Company). Platform share: 12.5% of every round, read from the contract.'],
      ],
      ticks: ['$10M', '$100M', '$1B', '$10B'],
      line: 'Card payments are what moves Keptra from launch to maturity.',
      disclaimer: 'Illustrative scenarios from public market data and on-chain fees — not a forecast or a financial promise.',
    },
    pt: {
      title: 'O tamanho da oportunidade',
      scenarios: ['Arranque', 'Crescimento', 'Maturidade'],
      charts: [
        ['Entrega verificada — receita por quota do e-commerce mundial', [['0,1%', '103 M$/ano'], ['0,5%', '516 M$/ano'], ['2%', '2,06 B$/ano']], 'E-commerce mundial a retalho: 6,88 biliões $ em 2026 (EMARKETER via Shopify). Taxa Keptra: 1,5% por venda, lida do contrato.'],
        ['Instant Win — receita por quota do mercado de lotaria online', [['1%', '24,3 M$/ano'], ['5%', '121 M$/ano'], ['10%', '243 M$/ano']], 'Lotaria online: 19,43 mil milhões $ em 2029 (The Business Research Company). Parte da plataforma: 12,5% de cada ronda, lida do contrato.'],
      ],
      ticks: ['10 M$', '100 M$', '1 B$', '10 B$'],
      line: 'Os pagamentos com cartão são o que leva a Keptra do arranque à maturidade.',
      disclaimer: 'Cenários ilustrativos a partir de dados públicos de mercado e das taxas on-chain — não são uma previsão nem uma promessa financeira.',
    },
    es: {
      title: 'El tamaño de la oportunidad',
      scenarios: ['Arranque', 'Crecimiento', 'Madurez'],
      charts: [
        ['Entrega verificada — ingresos por cuota del e-commerce mundial', [['0,1%', '103 M$/año'], ['0,5%', '516 M$/año'], ['2%', '2.060 M$/año']], 'E-commerce minorista mundial: 6,88 billones $ en 2026 (EMARKETER vía Shopify). Comisión Keptra: 1,5% por venta, leída del contrato.'],
        ['Instant Win — ingresos por cuota del mercado de lotería online', [['1%', '24,3 M$/año'], ['5%', '121 M$/año'], ['10%', '243 M$/año']], 'Lotería online: 19.430 millones $ en 2029 (The Business Research Company). Parte de la plataforma: 12,5% de cada ronda, leída del contrato.'],
      ],
      ticks: ['10 M$', '100 M$', '1.000 M$', '10.000 M$'],
      line: 'Los pagos con tarjeta son lo que lleva a Keptra del arranque a la madurez.',
      disclaimer: 'Escenarios ilustrativos a partir de datos públicos de mercado y de las comisiones on-chain — no son una previsión ni una promesa financiera.',
    },
  };
  for (const [lang, o] of Object.entries(owner)) {
    const c = r[lang].opportunity;
    assert.equal(c.title, o.title, `${lang} title`);
    assert.deepEqual(c.scenarios, o.scenarios, `${lang} scenarios`);
    assert.deepEqual(
      c.charts,
      o.charts.map(([title, bars, note]) => ({ title, bars: bars.map(([share, value]) => ({ share, value })), note })),
      `${lang} charts`,
    );
    assert.deepEqual(c.ticks, o.ticks, `${lang} scale`);
    assert.equal(c.line, o.line, `${lang} line`);
    assert.equal(c.disclaimer, o.disclaimer, `${lang} notice`);
    // No figure for the token, no chart for the giveaways or the Event Center.
    for (const [path, word] of wordsOf(c)) assert.ok(!/token|giveaway|event center/i.test(word), `${lang} opportunity${path}: "${word}"`);
  }
  // The owner's figures are the share × the market × the fee read on-chain, to three significant digits.
  const three = (value) => Number(value.toPrecision(3));
  assert.deepEqual([0.001, 0.005, 0.02].map((share) => three(6.88e12 * share * 0.015)), [103e6, 516e6, 2.06e9]);
  assert.deepEqual([0.01, 0.05, 0.1].map((share) => three(19.43e9 * share * 0.125)), [24.3e6, 121e6, 243e6]);
  const page = codeOf('pages/Roadmap.tsx');
  // The bars are drawn to those figures, on one logarithmic scale for both charts: 10^7 to 10^10 dollars.
  assert.match(page, /const REVENUE = \[\s*\[103e6, 516e6, 2\.06e9\],\s*\[24\.3e6, 121e6, 243e6\],\s*\] as const;/);
  assert.match(page, /const onScale = \(dollars: number\) => \(\(Math\.log10\(dollars\) - 7\) \/ 3\) \* 100;/);
  const chart = page.slice(page.indexOf('function OpportunityChart('), page.indexOf('export const Roadmap'));
  assert.match(chart, /<rect width=\{`\$\{onScale\(revenue\[k\]\)\}%`\} height="100%" rx=\{4\} \/>/);
  assert.match(chart, /<svg aria-hidden="true" className="mt-2 block h-3\.5 w-full overflow-visible">/);
  // Every value is written beside its bar, the drawing hidden from assistive technology.
  assert.match(chart, /\{scenarios\[k\]\}<\/span> <span className="font-mono text-gray-400">\{bar\.share\}<\/span>/);
  assert.match(chart, /\{bar\.value\}/);
  // Still in every mode: nothing for reduced motion or the pause to stop.
  assert.doesNotMatch(chart, /useFilmTimeline|requestAnimationFrame|transition|animate/);
});
