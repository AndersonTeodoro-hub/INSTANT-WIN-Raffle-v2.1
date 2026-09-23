/**
 * SPEC-BLOCO-03 piece 5 — the orders, everything that is not on-chain: the
 * addresses, the tracking provider, the oracle's list, the relay's order
 * actions, the orders pass driven by a doubled chain, the notices, the evidence
 * and the arbiter, the erasure, and migration 0013 executed on the embedded
 * Postgres. The on-chain half is test/bridge-v2/fork/orders.fork.mjs, against the
 * contracts of commit 5d85a46.
 *
 * Tags: Qn for the rows of the piece's matrix (test/bridge-v2/MATRIZ-PECA5-KEPTRA.md),
 * and APn, AQn and ARn for the decisions of Adendas P, Q and R.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  toFunctionSelector,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  assert,
  deadline,
  http,
  jsonResponse,
  recordingLogger,
  request,
  suite,
  test,
  TEST_CRON_SECRET,
  TEST_ORACLE_TOKEN,
  TEST_ROLE_KEY,
} from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import * as chain from '../doubles/chain.mjs';
import * as kchain from '../doubles/keptraChain.mjs';
import * as escrow from '../doubles/escrowChain.mjs';
import { resetKeptraContracts, setKeptraContracts, REAL_KEPTRA } from '../doubles/config.mjs';
import { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } from '../memdb.mjs';
import { createPasskey } from '../passkey.mjs';
import { callsOf } from '../safecalls.mjs';
import { applyMigration, asRole, attempt, bootEngine, createDatabase, sql } from '../pg.mjs';

import * as keptra from '../../../lib/bridge-v2/keptra.ts';
import * as config from '../../../lib/bridge-v2/config.ts';
import * as env from '../../../lib/bridge-v2/env.ts';
import * as orders from '../../../lib/bridge-v2/orders.ts';
import { advanceOrders, dueExit, dueNotices, eraseOrderData, retryTrackers } from '../../../lib/bridge-v2/keptraOrders.ts';
import { keyedHash } from '../../../lib/bridge-v2/crypto.ts';
import { guardianAddress } from '../../../lib/bridge-v2/guardian.ts';
import {
  CREATOR_APPROVAL_ABI,
  CREATOR_CAMPAIGN_MANAGER_ABI,
  KEPTRA_BRIDGE_ROLE_ABI,
  KEPTRA_ESCROW_ABI,
  KEPTRA_GUARANTEE_ABI,
  KEPTRA_KEEPER_ABI,
  KEPTRA_VOUCHER_ABI,
  OrderFlag,
  OrderState,
} from '../../../lib/bridge-v2/abi.ts';

import * as register from '../../../api/bridge/v2/account/register.ts';
import * as relayRoute from '../../../api/bridge/v2/account/relay.ts';
import * as addressRoute from '../../../api/bridge/v2/order/address.ts';
import * as listRoute from '../../../api/bridge/v2/order/list.ts';
import * as evidenceRoute from '../../../api/bridge/v2/order/evidence.ts';
import * as storeOrdersRoute from '../../../api/bridge/v2/store/orders.ts';
import * as trackingRoute from '../../../api/bridge/v2/store/tracking.ts';
import * as pendingRoute from '../../../api/bridge/v2/oracle/pending.ts';
import * as arbiterRoute from '../../../api/bridge/v2/arbiter/evidence.ts';
import * as eraseRoute from '../../../api/bridge/v2/privacy/erase.ts';
import * as exportRoute from '../../../api/bridge/v2/privacy/export.ts';

suite('orders');

const root = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/');
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const url = (path) => `https://events.invalid/api/bridge/v2/${path}`;
const SESSION_COOKIE = 'iw_bridge_session=a-token-value';
const ESCROW = getAddress('0x00000000000000000000000000000000e5c0e5c0');
const GUARANTEE = getAddress('0x00000000000000000000000000000000ea4a0001');
const VOUCHER = getAddress('0x0000000000000000000000000000000076c40001');
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const T0 = BigInt(Math.floor(Date.now() / 1000));
const DAY = 86_400n;

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

/** A clean slate: the tables in memory, every chain double reset, the contracts configured (P24), limits open. */
function fresh() {
  db.reset();
  chain.reset();
  kchain.reset();
  escrow.reset();
  http.reset();
  owners.clear();
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
  kchain.set({
    isValidPasskeySignature: true,
    accountState: (safe) => ({
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
    }),
  });
  http.on('api.resend.com', () => jsonResponse({ id: 'mail-1' }));
  http.on('api.telegram.org', () => jsonResponse({ ok: true }));
  http.on('api.ship24.com', () => jsonResponse({ data: { tracker: { trackerId: 'tracker-0001-aaaa' } } }, 201));
}

/** A participant with a passkey and both accounts, configured on the (doubled) chain. */
async function person(id, signer) {
  store.insert('bridge_v2_participants', { id, email_canonical: `${id}@example.test`, wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  asParticipant(id);
  const passkey = await createPasskey();
  kchain.set({ signerAddressOf: signer });
  const response = await register.POST(
    request(url('account/register'), { cookie: SESSION_COOKIE, body: { x: passkey.x.toString(), y: passkey.y.toString(), credentialId: passkey.credentialId } }),
  );
  assert.equal(response.status, 200);
  const rows = store.rows('bridge_v2_accounts').filter((row) => row.participant_id === id);
  for (const row of rows) owners.set(row.safe_address.toLowerCase(), signer);
  return {
    id,
    passkey,
    participant: rows.find((row) => row.role === 'PARTICIPANT').safe_address,
    creator: rows.find((row) => row.role === 'CREATOR').safe_address,
  };
}

const withPhone = (participantId, hmac) => store.insert('bridge_v2_phones', { participant_id: participantId, phone_hmac: hmac, released_at: null });

/** An order and its terms as escrowChain reads them. */
function fx({
  id,
  state = OrderState.PAID,
  flags = 0,
  payer,
  store: storeSafe,
  mode = 0,
  prize = false,
  paidAt = T0,
  shippedAt = 0n,
  windowEndsAt = 0n,
  contestedAt = 0n,
  shipDays = 5,
  deliveryDays = 10,
  termsId = 1n,
  voucherId = 0n,
  price = 10_000_000n,
  shipping = 1_000_000n,
  codeCommit = ZERO_HASH,
  paid = 11_000_000n,
}) {
  return {
    order: { orderId: BigInt(id), termsId, quantity: 1, state, flags, payer, paid, paidAt, shippedAt, windowEndsAt, contestedAt, voucherId, codeCommit },
    terms: { store: storeSafe, price, payout: storeSafe, shipping, returnCost: 0n, refusalFeeBps: 0, shipDays, deliveryDays, mode, prize, active: true },
  };
}

/** The escrow the doubled chain shows: these orders, at chain time `now`. */
function chainShows(list, now = T0) {
  const byId = new Map(list.map((item) => [item.order.orderId, item]));
  escrow.set({
    ordersHead: { orderCount: list.reduce((max, item) => (item.order.orderId >= max ? item.order.orderId + 1n : max), 1n), now, block: 1_000n },
    readOrders: (ids) => ids.map((id) => byId.get(id) ?? fx({ id, state: OrderState.NONE, payer: '0x0000000000000000000000000000000000000000', store: '0x0000000000000000000000000000000000000000' })),
  });
}

const pass = (log = recordingLogger()) => advanceOrders(log, deadline()).then((done) => ({ done, log }));
const mails = () => http.requests.filter((r) => r.url.includes('resend')).map((r) => JSON.parse(r.body));
const post = (route, path, body, cookie = SESSION_COOKIE) => route.POST(request(url(path), { cookie, body }));
const ADDRESS = { name: 'Ana Silva', street: 'Rua das Flores 12', postCode: '1000-001', city: 'Lisboa', country: 'PT', phone: '+351 912 345 678' };

/** The offer the doubled chain holds: active, COMPRA, accepting PT and ES. */
function offer(termsId = 1n, extra = {}) {
  escrow.set({
    readTerms: { store: '0x7777777777777777777777777777777777777777', price: 10_000_000n, payout: '0x7777777777777777777777777777777777777777', shipping: 1_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode: 0, prize: false, active: true, ...extra },
    regionsOf: ['PT', 'ES'],
  });
}

async function relay(body, cookie = SESSION_COOKIE) {
  const response = await relayRoute.POST(request(url('account/relay'), { cookie, body }));
  return { status: response.status, body: await response.json() };
}

/** prepare -> sign with the passkey -> submit, as the page drives it. */
async function relayed(passkey, body) {
  const prepared = await relay(body);
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const assertion = await passkey.sign(prepared.body.safeTxHash);
  return relay({ ...body, ...(prepared.body.deadline ? { deadline: prepared.body.deadline } : {}), nonce: prepared.body.nonce, ...assertion });
}

// ===========================================================================
// P24 — the addresses are literals, zero until the owner fills them in
// ===========================================================================

await test(['AP24', 'AQ1', 'Q32'], 'P24: the three contract addresses are literals in config.ts, zero today, and never an environment variable', () => {
  assert.deepEqual(Object.values(REAL_KEPTRA), [
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000',
  ]);
  const source = read('lib/bridge-v2/config.ts');
  for (const name of ['KEPTRA_ESCROW', 'KEPTRA_GUARANTEE', 'KEPTRA_VOUCHER']) {
    assert.match(source, new RegExp(`export const ${name}: \`0x\\$\\{string\\}\` = '0x0{40}';`));
  }
  for (const name of [...env.REQUIRED_ENV, ...env.OPTIONAL_ENV, ...env.KEPTRA_ENV]) {
    assert.ok(!/ESCROW|GUARANTEE|VOUCHER|CONTRACT/.test(name), `${name} could repoint a contract`);
  }
});

await test(['AP24', 'AQ1'], 'P24: while an address is zero every order route refuses, the relay refuses order actions, and the pass reads nothing — the general rehearsal reads keptraContractsConfigured', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  resetKeptraContracts();
  assert.equal(orders.keptraContractsConfigured(), false);
  assert.equal((await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' })).status, 503);
  assert.equal((await post(listRoute, 'order/list', {})).status, 503);
  assert.equal((await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'AB123456' })).status, 503);
  const pending = await pendingRoute.GET(request(url('oracle/pending'), { method: 'GET', headers: { authorization: `Bearer ${TEST_ORACLE_TOKEN}` } }));
  assert.equal(pending.status, 503);
  const refused = await relay({ kind: 'confirm', orderId: '1' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'Orders are not available yet.');
  const { done } = await pass();
  assert.equal(done, 0);
  assert.equal(escrow.calls.length, 0, 'the pass read the chain with no contracts configured');
  void buyer;
  setKeptraContracts({ escrow: ESCROW, guarantee: GUARANTEE, voucher: VOUCHER });
  assert.equal(orders.keptraContractsConfigured(), true);
});

await test(['AP24', 'AQ1'], 'P24: KEPTRA_ENV missing refuses the orders the same way, and the maintenance pass says which names', async () => {
  fresh();
  const saved = process.env.BRIDGE_V2_ORACLE_TOKEN;
  delete process.env.BRIDGE_V2_ORACLE_TOKEN;
  try {
    assert.equal(orders.ordersConfigured(), false);
    assert.deepEqual(env.missingKeptraEnv(), ['BRIDGE_V2_ORACLE_TOKEN']);
    db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
    db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
    db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
    db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
    const maintenance = await import('../../../api/bridge/v2/cron/maintenance.ts');
    await maintenance.GET(request(url('cron/maintenance'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }));
    const alerts = store.rows('bridge_v2_ops_events').length === 0 ? db.callsTo('bridge_v2_ops_events:insert').map((c) => c.payload) : store.rows('bridge_v2_ops_events');
    assert.ok(alerts.some((row) => row.kind === 'alert' && JSON.stringify(row.detail ?? row).includes('orders configuration incomplete')));
  } finally {
    process.env.BRIDGE_V2_ORACLE_TOKEN = saved;
  }
});

// ===========================================================================
// section 10 — addresses: Q1 Q2 Q3, P15 P19 P20 P21
// ===========================================================================

await test(['Q1', 'AP19', 'AP20', 'AQ5'], '10.2 and P19: an address is kept as ciphertext under its own label, with exactly the six fields, and nothing of it in clear', async () => {
  fresh();
  await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  const response = await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  assert.equal(response.status, 200);
  const [row] = store.rows('bridge_v2_order_addresses');
  assert.match(row.address_enc, /^v1\.[\w-]+\.[\w-]+$/);
  for (const value of ['Ana Silva', 'Rua das Flores', '1000-001', 'Lisboa', '912']) {
    assert.ok(!JSON.stringify(row).includes(value), `${value} is stored in clear`);
  }
  assert.equal(row.order_id ?? null, null);
  assert.equal(String(row.terms_id), '1');
  // Bound and read back: the six fields of P19, nothing more.
  await orders.bindAddress(row.id, 7n);
  assert.deepEqual(await orders.addressOfOrder(7n), ADDRESS);
  // P20: under a label of its own — the chat's label does not open it.
  const { decryptUnder } = await import('../../../lib/bridge-v2/crypto.ts');
  assert.equal(await decryptUnder('BRIDGE_V2_PHONE_HMAC_KEY', 'telegram-chat-enc-v1', row.address_enc), null);
  assert.equal(await decryptUnder('BRIDGE_V2_CODE_HMAC_KEY', 'order-address-enc-v1', row.address_enc), null);
});

await test(['AP19'], 'P19: each field is checked — a missing field, a control character, a post code the provider would refuse, a country that is not ISO alpha-2, a malformed phone', () => {
  assert.deepEqual(orders.parsePostalAddress({ ...ADDRESS, phone: undefined }), { ...ADDRESS, phone: null });
  for (const broken of [
    { name: '' },
    { street: 'line\nbreak' },
    { city: 'x'.repeat(201) },
    { postCode: '' },
    { postCode: '1000#001' },
    { postCode: 'x'.repeat(33) },
    { country: 'pt' },
    { country: 'PRT' },
    { phone: 'call me' },
  ]) {
    assert.equal(orders.parsePostalAddress({ ...ADDRESS, ...broken }), null, JSON.stringify(broken));
  }
});

await test(['Q3', 'AP15', 'AP21'], 'P15: in COMPRA an address outside the regions the store accepts is refused before the payment; P21: only a session with a Keptra account registers one', async () => {
  fresh();
  offer();
  asParticipant('participant-1');
  store.insert('bridge_v2_participants', { id: 'participant-1', email_canonical: 'a@example.test', wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  assert.equal((await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' })).status, 409, 'no Keptra account yet');
  await person('participant-2', '0x2222222222222222222222222222222222222222');
  const refused = await post(addressRoute, 'order/address', { ...ADDRESS, country: 'FR', termsId: '1' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /not delivered to that country/);
  assert.equal(store.rows('bridge_v2_order_addresses').length, 0);
  // And the payment cannot be prepared without one (the relay's check).
  chain.set({ erc20BalanceOf: 100_000_000n });
  const prepared = await relay({ kind: 'pay', termsId: '1', quantity: 1 });
  assert.equal(prepared.status, 409);
  assert.equal(prepared.body.error, 'Add a delivery address for this first.');
  assert.equal((await post(addressRoute, 'order/address', { ...ADDRESS, country: 'ES', termsId: '1' })).status, 200);
  assert.equal((await relay({ kind: 'pay', termsId: '1', quantity: 1 })).status, 200);
});

await test(['Q3', 'AP21'], 'H7 and 11.5: for a voucher, only one this account holds, claimed and not voided, and only in a region the brand accepts', async () => {
  fresh();
  const winner = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const voucher = (extra) => ({ voucherId: 5n, owner: winner.participant, voided: false, claimedAt: T0 - 60n, giveawayId: 3n, obligationId: 2n, ...extra });
  escrow.set({ readObligation: { brand: '0x7777777777777777777777777777777777777777', termsId: 9n }, regionsOf: (termsId) => (termsId === 9n ? ['PT'] : []) });
  for (const [extra, why] of [
    [{ owner: '0x1234567890123456789012345678901234567890' }, 'held by somebody else'],
    [{ voided: true }, 'voided'],
    [{ claimedAt: 0n }, 'never claimed'],
  ]) {
    escrow.set({ readVouchers: [voucher(extra)] });
    assert.equal((await post(addressRoute, 'order/address', { ...ADDRESS, voucherId: '5' })).status, 409, why);
  }
  escrow.set({ readVouchers: [voucher({})] });
  assert.equal((await post(addressRoute, 'order/address', { ...ADDRESS, country: 'ES', voucherId: '5' })).status, 409, 'outside the brand’s regions');
  assert.equal((await post(addressRoute, 'order/address', { ...ADDRESS, voucherId: '5' })).status, 200);
  assert.equal(String(store.rows('bridge_v2_order_addresses')[0].voucher_id), '5');
});

await test(['Q2', 'AP2'], '10.2 and P2: the address is read by the store the order’s terms name — its creator account — and by nobody else; the recipient’s list carries none', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  const other = await person('store-2', '0x4444444444444444444444444444444444444444');
  offer();
  asParticipant('participant-1');
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  await pass();
  asParticipant('store-1');
  const seen = await (await post(storeOrdersRoute, 'store/orders', {})).json();
  assert.equal(seen.orders.length, 1);
  assert.deepEqual(seen.orders[0].address, ADDRESS);
  asParticipant('store-2');
  assert.deepEqual((await (await post(storeOrdersRoute, 'store/orders', {})).json()).orders, [], 'another store saw it');
  void other;
  asParticipant('participant-1');
  const mine = await (await post(listRoute, 'order/list', {})).json();
  assert.equal(mine.orders.length, 1);
  assert.equal(mine.orders[0].hasAddress, true);
  assert.ok(!JSON.stringify(mine).includes('Lisboa'), 'the recipient list carries the address');
  // The participant account of the store's owner is not the store (P2).
  asParticipant('store-1');
  const tracking = await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'AB123456789' });
  assert.equal(tracking.status, 200);
  escrow.set({ readOrders: [fx({ id: 1, payer: buyer.participant, store: shop.participant })] });
  assert.equal((await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'CD123456789' })).status, 409);
});

// ===========================================================================
// 10.3, P18 — erasure: Q4 Q5
// ===========================================================================

await test(['Q4', 'AP17', 'AQ5'], '10.3: at the final state an order’s address, tracking number and evidence get their erasure date, and at that date they are deleted — rows gone, not pseudonymised', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  await pass();
  await orders.registerShipment(1n, `0x${'a'.repeat(64)}`, 'AB123456789');
  await orders.writeEvidence(1n, 'RECIPIENT', 'It never arrived.');
  // A draft nobody used, written long ago.
  store.insert('bridge_v2_order_addresses', { participant_id: 'participant-1', terms_id: '2', order_id: null, address_enc: 'v1.x.y', created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() });
  chainShows([fx({ id: 1, state: OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  await pass();
  for (const table of ['bridge_v2_order_addresses', 'bridge_v2_order_shipments', 'bridge_v2_order_evidence']) {
    const row = store.rows(table).find((r) => String(r.order_id) === '1');
    assert.ok(row.erase_after !== null && row.erase_after !== undefined, `${table} has no erasure date`);
    const days = (Date.parse(row.erase_after) - Date.now()) / 86_400_000;
    assert.ok(days > 28.9 && days <= 29, `${table}: ${days} days, not 29`);
  }
  assert.equal(await orders.eraseExpired(new Date()), 1, 'only the stale draft goes now');
  assert.equal(await orders.eraseExpired(new Date(Date.now() + 30 * 86_400_000)), 3);
  for (const table of ['bridge_v2_order_addresses', 'bridge_v2_order_shipments', 'bridge_v2_order_evidence']) {
    assert.equal(store.rows(table).length, 0, `${table} still holds rows`);
  }
  // The maintenance step does it, reserved like every step (AF8).
  const log = recordingLogger();
  assert.equal(await eraseOrderData(log, deadline()), 0);
  assert.equal(await eraseOrderData(log, deadline(false)), null);
});

// SPEC-BLOCO-03 T13 prevails over P18 (Adenda T, "prevalece sobre o texto anterior"): an erasure
// with an order still open is refused and says what is left; once the order ends, the addresses go.
await test(['Q5', 'AP18', 'AT13'], 'P18 as T13 reads it: an erasure request with an order open is refused and names it; once the order is final the addresses are deleted; the export carries them', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  for (const termsId of ['1', '1', '1']) await post(addressRoute, 'order/address', { ...ADDRESS, termsId });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, payer: buyer.participant, store: shop.creator })]);
  await pass();
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, state: OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  await pass();
  const exported = await (await post(exportRoute, 'privacy/export', {})).json();
  assert.equal(exported.deliveryAddresses.length, 3);
  assert.deepEqual(exported.deliveryAddresses.find((a) => a.orderId === '1').address, ADDRESS);
  const refused = await post(eraseRoute, 'privacy/erase', {});
  assert.equal(refused.status, 409);
  const said = await refused.json();
  assert.match(said.error, /1 open order/);
  assert.equal(said.left.openOrders, 1);
  assert.equal(store.rows('bridge_v2_order_addresses').length, 3, 'a refused erasure erased nothing');
  chainShows([fx({ id: 1, state: OrderState.CLOSED, payer: buyer.participant, store: shop.creator }), fx({ id: 2, state: OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  await pass();
  asParticipant('participant-1');
  const erased = await (await post(eraseRoute, 'privacy/erase', {})).json();
  assert.equal(erased.addressesErased, 3, 'both final orders’ addresses and the unused one');
  assert.equal(erased.addressesDeferred, 0);
  assert.deepEqual(store.rows('bridge_v2_order_addresses'), []);
});

// ===========================================================================
// 9.1.1, H17, M9, P7, 9.5.5 — tracking: Q6 Q7 Q8 Q10
// ===========================================================================

await test(['Q6', 'AP20'], 'H17: the tracking hash is keyed — not a plain hash of the number — under its own label, and one parcel however it is written', async () => {
  const number = orders.normaliseTrackingNumber('1z 999-aa1 0123 4567 84');
  assert.equal(number, '1Z999AA10123456784');
  assert.equal(orders.normaliseTrackingNumber('1Z999AA10123456784'), number);
  assert.equal(orders.normaliseTrackingNumber('ab-1'), null, 'too short to be a tracking number');
  const hash = await orders.trackingHashOf(number);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(hash, keccak256(stringToHex(number)));
  const { sha256Hex } = await import('../../../lib/bridge-v2/crypto.ts');
  assert.notEqual(hash.slice(2), await sha256Hex(number));
  assert.notEqual(hash.slice(2), await keyedHash('BRIDGE_V2_PHONE_HMAC_KEY', 'phone-identity-v1', number));
  assert.equal(hash, await orders.trackingHashOf(number));
});

async function shippingSetup() {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, payer: buyer.participant, store: shop.creator })]);
  await pass();
  asParticipant('store-1');
  return { buyer, shop };
}

await test(['Q7', 'AP7'], 'M9 and P7: the shipment is registered with the provider with the tracking number, the destination post code and the country — nothing else — under the bridge’s own key, and the identifier is kept', async () => {
  const { shop } = await shippingSetup();
  const response = await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'AB 1234 5678 9' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.trackingHash, await orders.trackingHashOf('AB123456789'));
  assert.equal(body.tracked, true);
  const [call] = http.requests.filter((r) => r.url.includes('ship24'));
  assert.equal(call.url, 'https://api.ship24.com/public/v1/trackers');
  assert.deepEqual(JSON.parse(call.body), { trackingNumber: 'AB123456789', destinationPostCode: '1000-001', destinationCountryCode: 'PT' });
  assert.equal(call.init.headers.authorization, `Bearer ${process.env.BRIDGE_V2_SHIP24_KEY}`);
  const [row] = store.rows('bridge_v2_order_shipments');
  assert.equal(row.tracker_id, 'tracker-0001-aaaa');
  assert.equal(row.tracking_hash, body.trackingHash);
  assert.ok(!JSON.stringify(row).includes('AB123456789'), 'the number is kept in clear');
  void shop;
});

await test(['Q6'], 'I6: a number that serves an order is refused for another — here, and when the chain already holds its hash — before the store signs a ship() the escrow would refuse', async () => {
  await shippingSetup();
  assert.equal((await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'AB123456789' })).status, 200);
  const again = await post(trackingRoute, 'store/tracking', { orderId: '2', trackingNumber: 'ab-1234-5678-9' });
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already serves another order/);
  escrow.set({ trackingHashUsed: true });
  assert.equal((await post(trackingRoute, 'store/tracking', { orderId: '2', trackingNumber: 'ZZ999999999' })).status, 409);
  assert.equal(store.rows('bridge_v2_order_shipments').length, 1);
});

await test(['Q8', 'Q18'], '9.5.5: a provider that fails blocks nothing — the store gets the hash and ships — the maintenance pass asks again, and until then the order is not in the oracle’s list; B8: no call without spend', async () => {
  await shippingSetup();
  http.routes.splice(http.routes.findIndex(([pattern]) => pattern === 'api.ship24.com'), 1);
  http.on('api.ship24.com', () => new Response('down', { status: 503 }));
  const response = await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'AB123456789' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tracked, false);
  assert.equal(store.rows('bridge_v2_order_shipments')[0].tracker_id ?? null, null);
  chainShows([fx({ id: 1, state: OrderState.SHIPPED, shippedAt: T0, payer: store.rows('bridge_v2_orders')[0].payer_address, store: store.rows('bridge_v2_orders')[0].store_address })]);
  await pass();
  assert.deepEqual(await orders.oraclePending(Number(T0)), []);
  // B8: with the ceiling reached, the provider is not called at all.
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: false, error: null }));
  const before = http.requests.filter((r) => r.url.includes('ship24')).length;
  assert.equal(await retryTrackers(recordingLogger(), deadline()), 0);
  assert.equal(http.requests.filter((r) => r.url.includes('ship24')).length, before);
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  http.routes.splice(http.routes.findIndex(([pattern]) => pattern === 'api.ship24.com'), 1);
  http.on('api.ship24.com', () => jsonResponse({ data: { tracker: { trackerId: 'tracker-0002-bbbb' } } }, 201));
  assert.equal(await retryTrackers(recordingLogger(), deadline()), 1);
  assert.deepEqual(await orders.oraclePending(Number(T0)), [{ orderId: '1', trackerId: 'tracker-0002-bbbb', postCode: '1000-001' }]);
});

await test(['Q10', 'AP7'], 'M1 and P7: the bridge uses its own provider key — never the oracle’s — reads it at use, and no log line carries a number, a post code or an address', async () => {
  const source = read('lib/bridge-v2/ship24.ts');
  assert.match(source, /requireKeptraEnv\('BRIDGE_V2_SHIP24_KEY'\)/);
  for (const path of ['lib', 'api']) void path;
  for (const file of ['lib/bridge-v2/ship24.ts', 'lib/bridge-v2/orders.ts', 'lib/bridge-v2/keptraOrders.ts', 'api/bridge/v2/store/tracking.ts']) {
    assert.ok(!read(file).includes('KEPTRA_TRACKING_API_KEY'), `${file} names the oracle's key`);
  }
  // P7: the three fields, and no recipient object (the API would take a name and an email).
  assert.ok(!/recipient\s*:/.test(source));
  await shippingSetup();
  const log = recordingLogger();
  await post(trackingRoute, 'store/tracking', { orderId: '1', trackingNumber: 'AB123456789' });
  const logged = JSON.stringify([...db.callsTo('bridge_v2_ops_events:insert').map((c) => c.payload), ...log.events]);
  for (const value of ['AB123456789', '1000-001', 'Lisboa', 'Ana']) assert.ok(!logged.includes(value), `${value} reached a log`);
});

// ===========================================================================
// M9, N7, N3, B3-B7 — the oracle's list: Q9
// ===========================================================================

async function oracleRows(list) {
  fresh();
  for (const item of list) {
    store.insert('bridge_v2_orders', {
      order_id: String(item.id), terms_id: '1', voucher_id: '0', store_address: '0x3333333333333333333333333333333333333333', payer_address: '0x2222222222222222222222222222222222222222',
      mode: item.mode ?? 0, prize: false, ship_days: 5, delivery_days: 10, state: item.state ?? OrderState.SHIPPED, flags: item.flags ?? 0,
      paid_at: String(T0), shipped_at: String(T0), window_ends_at: '0', contested_at: '0', seen_block: '1', outcome: null, closed_at: null,
    });
    if (item.tracker !== null) store.insert('bridge_v2_order_shipments', { order_id: String(item.id), tracking_hash: `0x${String(item.id).padStart(64, '0')}`, tracking_enc: 'v1.x.y', tracker_id: item.tracker ?? `tracker-${String(item.id).padStart(4, '0')}-xx` });
    store.insert('bridge_v2_order_addresses', { participant_id: 'p', terms_id: '1', order_id: String(item.id), address_enc: await (await import('../../../lib/bridge-v2/crypto.ts')).encryptUnder('BRIDGE_V2_PHONE_HMAC_KEY', 'order-address-enc-v1', JSON.stringify({ ...ADDRESS, postCode: `PC${item.id}` })) });
  }
}

const getPending = (authorization) =>
  pendingRoute.GET(request(url('oracle/pending'), { method: 'GET', headers: authorization === undefined ? {} : { authorization } }));

await test(['Q9', 'AP1'], 'M9 and O4: the oracle’s list needs its own credential, compared in constant time, and answers exactly {pending:[{orderId, trackerId, postCode}]} with ids as strings', async () => {
  await oracleRows([{ id: 1 }]);
  assert.equal((await getPending()).status, 401);
  assert.equal((await getPending(`Bearer ${TEST_CRON_SECRET}`)).status, 401, 'the cron secret opened it');
  const response = await getPending(`Bearer ${TEST_ORACLE_TOKEN}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.pending, [{ orderId: '1', trackerId: 'tracker-0001-xx', postCode: 'PC1' }]);
  assert.match(read('api/bridge/v2/oracle/pending.ts'), /timingSafeEqualHex/);
});

await test(['Q9', 'AP1'], 'N7 and B5, B6, B7: only TRANSPORTADORA orders still waiting for a proof — shipped, or in a declared window with no proof — with a tracker, and never one tracker for two orders', async () => {
  await oracleRows([
    { id: 1 },
    { id: 2, mode: 1 },
    { id: 3, state: OrderState.PAID },
    { id: 4, state: OrderState.WINDOW, flags: 0 },
    { id: 5, state: OrderState.WINDOW, flags: OrderFlag.PROOF },
    { id: 6, state: OrderState.WINDOW, flags: OrderFlag.REFUSAL },
    { id: 7, state: OrderState.CLOSED },
    { id: 8, tracker: null },
    { id: 9, tracker: 'tracker-dup-0001' },
    { id: 10, tracker: 'TRACKER-DUP-0001' },
  ]);
  const ids = (await orders.oraclePending(Number(T0))).map((item) => item.orderId);
  assert.deepEqual(ids, ['1', '4']);
});

await test(['Q9', 'AQ5'], 'B4: past 13 the list rotates by the oracle’s 15-minute slot — every order within ceil(n/13) slots — and two nodes asking within one slot read the same bytes', async () => {
  await oracleRows(Array.from({ length: 30 }, (_unused, i) => ({ id: i + 1 })));
  const slot = (k) => Number(config.ORACLE_ROTATION_SECONDS) * (1_000 + k);
  const seen = new Set();
  for (let k = 0; k < 3; k += 1) {
    const list = await orders.oraclePending(slot(k));
    assert.equal(list.length, 13);
    assert.deepEqual(list.map((item) => BigInt(item.orderId)), [...list.map((item) => BigInt(item.orderId))].sort((a, b) => (a < b ? -1 : 1)), 'not in id order');
    for (const item of list) seen.add(item.orderId);
  }
  assert.equal(seen.size, 30, 'an order was never asked about');
  assert.equal(JSON.stringify(await orders.oraclePending(slot(5))), JSON.stringify(await orders.oraclePending(slot(5) + 899)));
});

// ===========================================================================
// 13.1, P5, P14 — recipient marks: Q11
// ===========================================================================

async function markSetup() {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  withPhone('participant-1', 'phone-buyer');
  withPhone('store-1', 'phone-store');
  return { buyer, shop };
}

await test(['Q11', 'AP5', 'AP14'], '13.1 and P14: a verified recipient distinct from the store is marked by the bridge role, from the shared ceiling, and the mark is recorded', async () => {
  const { buyer, shop } = await markSetup();
  const spend = [];
  db.on('rpc:bridge_v2_claim_spend', (op) => {
    spend.push(op.args.p_provider);
    return { data: true, error: null };
  });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  const { log } = await pass();
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendRecipientMark').map((c) => c.args[0]), [1n]);
  assert.ok(spend.includes('chain'), 'the mark did not claim the shared ceiling');
  assert.equal(store.rows('bridge_v2_recipient_marks')[0].status, 'MARKED');
  assert.ok(log.events.some((e) => e.kind === 'order.recipient_marked'));
});

await test(['Q11', 'AP5'], 'P5: the same number counts once per store — a second order is not marked while the first mark lives, and is once the first delivery did not count', async () => {
  const { buyer, shop } = await markSetup();
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, payer: buyer.participant, store: shop.creator })]);
  await pass();
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendRecipientMark').map((c) => c.args[0]), [1n]);
  // Order 1 closes to the recipient: it did not count, and order 2 becomes markable.
  escrow.set({ orderOutcome: { outcome: 1, searchedTo: 1_000n } });
  chainShows([
    fx({ id: 1, state: OrderState.CLOSED, flags: OrderFlag.VERIFIED, payer: buyer.participant, store: shop.creator }),
    fx({ id: 2, payer: buyer.participant, store: shop.creator }),
  ]);
  chain.reset();
  await pass();
  assert.equal(store.rows('bridge_v2_recipient_marks').find((r) => String(r.order_id) === '1').status, 'RELEASED');
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendRecipientMark').map((c) => c.args[0]), [2n]);
});

await test(['Q11', 'AP5'], 'P5: a delivery that counted keeps its mark for good — the same number never counts again at that store — but counts at another store', async () => {
  const { buyer, shop } = await markSetup();
  const other = await person('store-2', '0x4444444444444444444444444444444444444444');
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  await pass();
  escrow.set({ orderOutcome: { outcome: 0, searchedTo: 1_000n } });
  chainShows([
    fx({ id: 1, state: OrderState.CLOSED, flags: OrderFlag.VERIFIED, payer: buyer.participant, store: shop.creator }),
    fx({ id: 2, payer: buyer.participant, store: shop.creator }),
    fx({ id: 3, payer: buyer.participant, store: other.creator }),
  ]);
  chain.reset();
  await pass();
  assert.equal(store.rows('bridge_v2_recipient_marks').find((r) => String(r.order_id) === '1').status, 'MARKED');
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendRecipientMark').map((c) => c.args[0]), [3n]);
});

await test(['Q11', 'AP5'], 'P5: a recipient who is the store never counts — the same participant, or the same number — and one with no verified number is looked at again later', async () => {
  const { buyer, shop } = await markSetup();
  // The store's own person buying from its own store.
  const self = await person('store-3', '0x5555555555555555555555555555555555555557');
  withPhone('store-3', 'phone-self');
  // Another participant sharing the store's number.
  const twin = await person('participant-9', '0x5555555555555555555555555555555555555558');
  withPhone('participant-9', 'phone-store');
  const unverified = await person('participant-8', '0x5555555555555555555555555555555555555559');
  chainShows([
    fx({ id: 1, payer: self.participant, store: self.creator }),
    fx({ id: 2, payer: twin.participant, store: shop.creator }),
    fx({ id: 3, payer: unverified.participant, store: shop.creator }),
  ]);
  await pass();
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendRecipientMark'), []);
  const status = (id) => store.rows('bridge_v2_recipient_marks').find((r) => String(r.order_id) === id)?.status ?? null;
  assert.equal(status('1'), 'SKIPPED');
  assert.equal(status('2'), 'SKIPPED');
  assert.equal(status('3'), null, 'an unverified number is decided for good');
  withPhone('participant-8', 'phone-late');
  await pass();
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendRecipientMark').map((c) => c.args[0]), [3n]);
  void buyer;
});

await test(['Q11'], '13.1: a mark that reverts is alerted and stays reserved, so the index settles it at the order’s final state', async () => {
  const { buyer, shop } = await markSetup();
  chain.set({ waitForReceipt: { status: 'reverted', logs: [] } });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  const { log } = await pass();
  assert.ok(log.events.some((e) => e.kind === 'alert' && e.detail.summary === 'recipient mark reverted'));
  assert.equal(store.rows('bridge_v2_recipient_marks')[0].status, 'RESERVED');
  chainShows([fx({ id: 1, state: OrderState.CLOSED, payer: buyer.participant, store: shop.creator })]);
  await pass();
  assert.equal(store.rows('bridge_v2_recipient_marks')[0].status, 'RELEASED');
});

await test(['Q11', 'AP14', 'AQ5'], 'P14: the marks run in the pipeline, under the lock the root publication runs under, and the bridge role signs them at its pending nonce', () => {
  const process = read('api/bridge/v2/cron/process.ts');
  assert.match(process, /acquireRunLock\('cron\/process'\)/);
  assert.match(process, /advanceLifecycle: async \(log, deadline\) => \(await advanceLifecycle\(log, deadline\)\) \+ \(await advanceOrders\(log, deadline\)\)/);
  const chainSource = read('lib/bridge-v2/chain.ts');
  const mark = chainSource.slice(chainSource.indexOf('export async function sendRecipientMark'), chainSource.indexOf('export async function signRedemption'));
  assert.match(mark, /requireEnv\('BRIDGE_V2_ROLE_KEY'\)/);
  assert.match(mark, /blockTag: 'pending'/);
  // The maintenance route never marks (it would sign outside that lock).
  assert.ok(!read('api/bridge/v2/cron/maintenance.ts').includes('advanceOrders'));
});

// ===========================================================================
// H7, I6 — the redemption attestation: Q12
// ===========================================================================

await test(['Q12', 'AP13'], 'H7 and I6: the attestation is the bridge role’s EIP-712 signature over (voucher, recipient, deadline) in the escrow’s domain, and the same values sign the same bytes', async () => {
  fresh();
  const recipient = '0x2222222222222222222222222222222222222222';
  const signature = await chain.signRedemption(5n, recipient, T0 + 3600n);
  assert.equal(signature, await chain.signRedemption(5n, recipient, T0 + 3600n), 'not deterministic: prepare and submit would differ');
  const signer = await recoverTypedDataAddress({
    domain: { name: 'Keptra', version: '1', chainId: 42161, verifyingContract: ESCROW },
    types: { Redemption: [{ name: 'voucherId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Redemption',
    message: { voucherId: 5n, recipient, deadline: T0 + 3600n },
    signature,
  });
  assert.equal(signer, privateKeyToAccount(TEST_ROLE_KEY).address);
  // The typehash is the escrow's own string (KeptraEscrow.sol:73-74).
  const escrowSource = readFileSync('C:/Users/User/Documents/instant-win-audit/v2/src/KeptraEscrow.sol', 'utf8');
  assert.match(escrowSource, /keccak256\("Redemption\(uint256 voucherId,address recipient,uint256 deadline\)"\)/);
  assert.match(escrowSource, /EIP712\("Keptra", "1"\)/);
});

async function redeemSetup() {
  fresh();
  const winner = await person('participant-1', '0x2222222222222222222222222222222222222222');
  escrow.set({
    readVouchers: [{ voucherId: 5n, owner: winner.participant, voided: false, claimedAt: T0 - 60n, giveawayId: 3n, obligationId: 2n }],
    readObligation: { brand: '0x7777777777777777777777777777777777777777', termsId: 9n },
    readTerms: { store: '0x7777777777777777777777777777777777777777', price: 50_000_000n, payout: '0x7777777777777777777777777777777777777777', shipping: 5_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode: 0, prize: true, active: true },
    regionsOf: ['PT'],
  });
  return winner;
}

await test(['Q12', 'Q13', 'AP1', 'AQ5'], 'H7: a redemption is prepared only with an address registered for that voucher, and carries the voucher’s approval to the guarantee and the attestation; the deadline returned is the one the submit must echo', async () => {
  const winner = await redeemSetup();
  assert.equal((await relay({ kind: 'redeem', voucherId: '5' })).body.error, 'Add a delivery address for this first.');
  await post(addressRoute, 'order/address', { ...ADDRESS, voucherId: '5' });
  const { prepareAction } = await import('../../../lib/bridge-v2/relay.ts');
  const prepared = await prepareAction('participant-1', { kind: 'redeem', voucherId: 5n, codeCommit: ZERO_HASH, deadline: null }, null);
  const calls = callsOf(prepared.tx);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to.toLowerCase(), VOUCHER.toLowerCase());
  assert.deepEqual(decodeFunctionData({ abi: KEPTRA_VOUCHER_ABI, data: calls[0].data }).args, [GUARANTEE, 5n]);
  const redeem = decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: calls[1].data });
  assert.equal(redeem.functionName, 'redeemVoucher');
  assert.equal(redeem.args[2], prepared.redeemDeadline);
  const signer = await recoverTypedDataAddress({
    domain: { name: 'Keptra', version: '1', chainId: 42161, verifyingContract: ESCROW },
    types: { Redemption: [{ name: 'voucherId', type: 'uint256' }, { name: 'recipient', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Redemption',
    message: { voucherId: 5n, recipient: winner.participant, deadline: prepared.redeemDeadline },
    signature: redeem.args[3],
  });
  assert.equal(signer, privateKeyToAccount(TEST_ROLE_KEY).address);
  // An echoed deadline past the attestation's life is refused.
  const late = await relay({ kind: 'redeem', voucherId: '5', deadline: String(T0 + 100_000n) });
  assert.equal(late.body.error, 'This request expired. Prepare it again.');
  // Past the thirty days of 11.10, nothing is signed.
  escrow.set({ readVouchers: [{ voucherId: 5n, owner: winner.participant, voided: false, claimedAt: T0 - 31n * DAY, giveawayId: 3n, obligationId: 2n }] });
  assert.equal((await relay({ kind: 'redeem', voucherId: '5' })).body.error, 'This voucher can no longer be redeemed.');
});

// ===========================================================================
// P1, P2, P16, 6.2.2 — the relay's order actions: Q13 Q14 Q15 Q30
// ===========================================================================

const prepare = async (participantId, action) => callsOf((await (await import('../../../lib/bridge-v2/relay.ts')).prepareAction(participantId, action, null)).tx);
const decodeAll = (calls, abi) => calls.map((call) => decodeFunctionData({ abi, data: call.data }));

await test(['Q13', 'AP1'], '6.2.2 and T1: a payment is the offer’s price and shipping, approved to the escrow and paid, from the participant account; its commitment follows the mode', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  offer();
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chain.set({ erc20BalanceOf: 100_000_000n });
  const calls = await prepare('participant-1', { kind: 'pay', termsId: 1n, quantity: 3, codeCommit: ZERO_HASH });
  assert.deepEqual(calls.map((c) => c.to.toLowerCase()), [config.USDC.toLowerCase(), ESCROW.toLowerCase()]);
  assert.deepEqual(decodeFunctionData({ abi: CREATOR_APPROVAL_ABI, data: calls[0].data }).args, [ESCROW, 31_000_000n]);
  assert.deepEqual(decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: calls[1].data }).args, [1n, 3, ZERO_HASH]);
  const { roleFor } = await import('../../../lib/bridge-v2/relay.ts');
  assert.equal(roleFor({ kind: 'pay' }, 'CREATOR'), 'PARTICIPANT');
  // 9.2 and H18: by carrier no commitment; by own means one is required.
  await assert.rejects(prepare('participant-1', { kind: 'pay', termsId: 1n, quantity: 1, codeCommit: `0x${'1'.repeat(64)}` }), /code_commit/);
  offer(1n, { mode: 1 });
  await assert.rejects(prepare('participant-1', { kind: 'pay', termsId: 1n, quantity: 1, codeCommit: ZERO_HASH }), /code_commit/);
  assert.equal((await prepare('participant-1', { kind: 'pay', termsId: 1n, quantity: 1, codeCommit: `0x${'1'.repeat(64)}` })).length, 2);
  chain.set({ erc20BalanceOf: 1n });
  await assert.rejects(prepare('participant-1', { kind: 'pay', termsId: 1n, quantity: 1, codeCommit: `0x${'1'.repeat(64)}` }), /deposit_missing/);
  void buyer;
});

await test(['Q13', 'AP1'], 'T2, T6, T9: cancel, confirm and contest are the payer’s alone, and each only at the stage the escrow allows it', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const stranger = '0x1234567890123456789012345678901234567890';
  const cases = [
    ['cancelOrder', 'cancel', fx({ id: 1, payer: buyer.participant, store: stranger }), fx({ id: 1, state: OrderState.SHIPPED, payer: buyer.participant, store: stranger })],
    ['confirm', 'confirm', fx({ id: 1, state: OrderState.SHIPPED, payer: buyer.participant, store: stranger }), fx({ id: 1, state: OrderState.WINDOW, flags: OrderFlag.REFUSAL, payer: buyer.participant, store: stranger })],
    ['contest', 'contest', fx({ id: 1, state: OrderState.WINDOW, windowEndsAt: T0 + DAY, payer: buyer.participant, store: stranger }), fx({ id: 1, state: OrderState.WINDOW, windowEndsAt: T0 - 1n, payer: buyer.participant, store: stranger })],
  ];
  for (const [kind, functionName, allowed, refused] of cases) {
    escrow.set({ readOrders: [allowed] });
    const [call] = await prepare('participant-1', { kind, orderId: 1n });
    assert.equal(call.to.toLowerCase(), ESCROW.toLowerCase());
    assert.equal(decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: call.data }).functionName, functionName);
    escrow.set({ readOrders: [refused] });
    await assert.rejects(prepare('participant-1', { kind, orderId: 1n }), /order_state/, `${kind} at the wrong stage`);
    escrow.set({ readOrders: [{ ...allowed, order: { ...allowed.order, payer: stranger } }] });
    await assert.rejects(prepare('participant-1', { kind, orderId: 1n }), /no_order/, `${kind} by somebody else`);
  }
});

await test(['Q15', 'AP16'], 'P16: contesting, confirming and cancelling pass with the 24-hour limit reached and claim nothing of the shared ceiling; a payment is refused at the limit', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const accountId = store.rows('bridge_v2_accounts').find((r) => r.role === 'PARTICIPANT').id;
  for (let i = 0; i < 20; i += 1) store.insert('bridge_v2_relayed_transactions', { account_id: accountId });
  const spend = [];
  db.on('rpc:bridge_v2_claim_spend', (op) => {
    spend.push(op.args.p_provider);
    return { data: true, error: null };
  });
  escrow.set({ readOrders: [fx({ id: 1, state: OrderState.WINDOW, windowEndsAt: T0 + DAY, payer: buyer.participant, store: '0x1234567890123456789012345678901234567890' })] });
  const submitted = await relayed(buyer.passkey, { kind: 'contest', orderId: '1' });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(spend.filter((p) => p === 'chain').length, 0, 'the contest claimed the shared ceiling');
  offer();
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chain.set({ erc20BalanceOf: 100_000_000n });
  assert.equal((await relay({ kind: 'pay', termsId: '1', quantity: 1 })).body.error, 'Your account reached its limit of transactions for the last 24 hours. Try again later.');
  assert.match(read('lib/bridge-v2/relay.ts'), /new Set\(\['cancelRecovery', 'revokeGuardian', 'cancelOrder', 'confirm', 'contest'\]\)/);
});

await test(['Q14', 'Q13'], 'Q14: a relayed payment binds the recipient’s address to the order its receipt names; with the receipt lost, the orders pass binds it from the chain', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  await post(addressRoute, 'order/address', { ...ADDRESS, city: 'Porto', termsId: '1' });
  chain.set({ erc20BalanceOf: 100_000_000n });
  const opened = {
    address: ESCROW,
    topics: encodeEventTopics({ abi: KEPTRA_ESCROW_ABI, eventName: 'OrderOpened', args: { orderId: 1n, termsId: 1n, payer: buyer.participant } }),
    data: encodeAbiParameters([{ type: 'uint96' }, { type: 'uint256' }], [11_000_000n, 0n]),
  };
  chain.set({ waitForReceipt: { status: 'success', logs: [opened] } });
  const paid = await relayed(buyer.passkey, { kind: 'pay', termsId: '1', quantity: 1 });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.orderId, '1');
  assert.equal((await orders.addressOfOrder(1n)).city, 'Lisboa', 'the oldest address was not the one bound');
  // The second payment's receipt never came: the pass binds from the chain.
  chain.set({ waitForReceipt: null });
  await relayed(buyer.passkey, { kind: 'pay', termsId: '1', quantity: 1 });
  assert.equal(await orders.orderHasAddress(2n), false);
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, payer: buyer.participant, store: shop.creator })]);
  await pass();
  assert.equal((await orders.addressOfOrder(2n)).city, 'Porto');
});

async function storeSetup() {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  asParticipant('store-1');
  return { buyer, shop };
}

await test(['Q13', 'AP1', 'AP2', 'AQ5'], 'P1 and P2: the store acts from its creator account on orders whose terms name it — ship with the hash it registered, the delivery code checked against the commitment, the declarations, the refund', async () => {
  const { buyer, shop } = await storeSetup();
  const { roleFor } = await import('../../../lib/bridge-v2/relay.ts');
  for (const kind of ['createOffer', 'deactivateOffer', 'ship', 'submitCode', 'declareDelivered', 'declareRefusal', 'refund', 'createObligation', 'createVoucherCampaign']) {
    assert.equal(roleFor({ kind }, null), 'CREATOR', kind);
  }
  const at = (extra) => escrow.set({ readOrders: [fx({ id: 1, payer: buyer.participant, store: shop.creator, ...extra })] });
  // ship by carrier: the hash registered through store/tracking, and none without it.
  at({});
  await assert.rejects(prepare('store-1', { kind: 'ship', orderId: 1n }), /no_tracking/);
  await orders.registerShipment(1n, `0x${'ab'.repeat(32)}`, 'AB123456789');
  assert.deepEqual(decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: (await prepare('store-1', { kind: 'ship', orderId: 1n }))[0].data }).args, [1n, `0x${'ab'.repeat(32)}`]);
  // by own means: no hash.
  at({ mode: 1, codeCommit: keccak256(encodeAbiParameters([{ type: 'bytes32' }], [`0x${'c'.repeat(64)}`])) });
  assert.deepEqual(decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: (await prepare('store-1', { kind: 'ship', orderId: 1n }))[0].data }).args, [1n, ZERO_HASH]);
  // submitCode: the code the recipient showed, checked against the commitment.
  at({ mode: 1, state: OrderState.SHIPPED, codeCommit: keccak256(encodeAbiParameters([{ type: 'bytes32' }], [`0x${'c'.repeat(64)}`])) });
  await assert.rejects(prepare('store-1', { kind: 'submitCode', orderId: 1n, code: `0x${'d'.repeat(64)}` }), /code/);
  assert.equal((await prepare('store-1', { kind: 'submitCode', orderId: 1n, code: `0x${'c'.repeat(64)}` })).length, 1);
  assert.equal((await prepare('store-1', { kind: 'declareRefusal', orderId: 1n })).length, 1);
  at({ state: OrderState.SHIPPED, shippedAt: T0 });
  assert.equal(decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: (await prepare('store-1', { kind: 'declareDelivered', orderId: 1n }))[0].data }).functionName, 'declareDelivered');
  await assert.rejects(prepare('store-1', { kind: 'declareRefusal', orderId: 1n }), /order_state/, 'a refusal by carrier is the oracle’s');
  at({ state: OrderState.SHIPPED, shippedAt: T0 - 11n * DAY });
  await assert.rejects(prepare('store-1', { kind: 'declareDelivered', orderId: 1n }), /order_state/, 'past the delivery deadline');
  // refund: COMPRA from what the order holds; PRÉMIO paid by the brand, approved first.
  at({ paid: 11_000_000n });
  assert.equal((await prepare('store-1', { kind: 'refund', orderId: 1n, amount: 11_000_000n })).length, 1);
  await assert.rejects(prepare('store-1', { kind: 'refund', orderId: 1n, amount: 11_000_001n }), /amount/);
  at({ prize: true, price: 50_000_000n, shipping: 5_000_000n, paid: 0n });
  chain.set({ erc20BalanceOf: 100_000_000n });
  const prize = await prepare('store-1', { kind: 'refund', orderId: 1n, amount: 55_000_000n });
  assert.deepEqual(decodeFunctionData({ abi: CREATOR_APPROVAL_ABI, data: prize[0].data }).args, [ESCROW, 55_000_000n]);
  // P2: another store's order is nobody's business here.
  escrow.set({ readOrders: [fx({ id: 1, payer: buyer.participant, store: buyer.creator })] });
  await assert.rejects(prepare('store-1', { kind: 'ship', orderId: 1n }), /no_order/);
});

await test(['Q13', 'AP1'], 'P1: an offer carries section 7 inside its ceilings and ISO regions; an obligation approves exactly the tier’s bond and fee (H11, I8) and refuses a brand in debt', async () => {
  const { shop } = await storeSetup();
  const terms = { payout: shop.creator.toLowerCase(), price: 10_000_000n, shipping: 1_000_000n, returnCost: 500_000n, refusalFeeBps: 1_000, shipDays: 5, deliveryDays: 10, mode: 0, regions: orders.encodeRegions(['PT', 'ES']) };
  const [offerCall] = await prepare('store-1', { kind: 'createOffer', terms });
  const decoded = decodeFunctionData({ abi: KEPTRA_ESCROW_ABI, data: offerCall.data });
  assert.equal(decoded.functionName, 'createOffer');
  assert.equal(decoded.args[8], stringToHex('PTES'));
  for (const broken of [{ returnCost: 2_000_000n }, { refusalFeeBps: 1_501 }, { shipDays: 6 }, { deliveryDays: 11 }, { price: 0n }]) {
    await assert.rejects(prepare('store-1', { kind: 'createOffer', terms: { ...terms, ...broken } }), /terms/, JSON.stringify(broken, (k, v) => (typeof v === 'bigint' ? String(v) : v)));
  }
  // C4: a platform account is named as a payout only once it is deployed and configured.
  const undeployed = await person('store-9', '0x5555555555555555555555555555555555555556');
  const readyState = kchain.behaviour.accountState;
  kchain.set({ accountState: (safe) => (safe.toLowerCase() === undeployed.creator.toLowerCase() ? { ...readyState(safe), deployed: false, owners: [], modules: [], guardians: [] } : readyState(safe)) });
  store.rows('bridge_v2_accounts').filter((r) => r.participant_id === 'store-9').forEach((r) => (r.deployed_at = null));
  await assert.rejects(prepare('store-1', { kind: 'createOffer', terms: { ...terms, payout: undeployed.creator.toLowerCase() } }), /destination_not_ready/);
  kchain.set({ accountState: readyState });
  assert.equal(orders.encodeRegions(['PT', 'pt']), null);
  assert.equal(orders.encodeRegions(['PT', 'PT']), null);
  assert.equal(orders.encodeRegions([]), null);
  // Obligation: Nova (bond 50%, fee 3%) on 50 + 5 USDC, two units.
  chain.set({ erc20BalanceOf: 1_000_000_000n });
  const obligation = { ...terms, price: 50_000_000n, shipping: 5_000_000n, refusalFeeBps: 0 };
  const calls = await prepare('store-1', { kind: 'createObligation', terms: obligation, units: 2 });
  const bond = 27_500_000n; // ceil(55 * 50%)
  const fee = ((55_000_000n - bond) * 2n * 300n) / 10_000n;
  assert.deepEqual(decodeFunctionData({ abi: CREATOR_APPROVAL_ABI, data: calls[0].data }).args, [GUARANTEE, bond * 2n + fee]);
  assert.equal(decodeFunctionData({ abi: KEPTRA_GUARANTEE_ABI, data: calls[1].data }).functionName, 'createObligation');
  escrow.set({ brandParams: { bondBps: 5_000, protectionBps: 300, canCreate: true, debt: 1n } });
  await assert.rejects(prepare('store-1', { kind: 'createObligation', terms: obligation, units: 2 }), /brand_blocked/);
  escrow.set({ brandParams: { bondBps: 5_000, protectionBps: 300, canCreate: false, debt: 0n } });
  await assert.rejects(prepare('store-1', { kind: 'createObligation', terms: obligation, units: 2 }), /brand_blocked/);
});

await test(['Q13', 'AP1', 'AQ5'], 'P1 and H9: a voucher campaign deposits loose vouchers of the brand’s own obligation into the ERC-721 module, the operator approval living only inside the transaction, at the declared value of every unit', async () => {
  const { shop } = await storeSetup();
  withPhone('store-1', 'phone-store');
  const voucher = (id, extra = {}) => ({ voucherId: id, owner: shop.creator, voided: false, claimedAt: 0n, giveawayId: 0n, obligationId: 2n, ...extra });
  escrow.set({
    readObligation: { brand: shop.creator, termsId: 9n },
    readVouchers: (ids) => ids.map((id) => voucher(id)),
    readTerms: { store: shop.creator, price: 50_000_000n, payout: shop.creator, shipping: 5_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode: 0, prize: true, active: true },
  });
  chain.set({ erc20BalanceOf: 1_000_000_000n, currentCreationFee: 50_000_000n, slotPrice: 100_000n });
  const calls = await prepare('store-1', { kind: 'createVoucherCampaign', obligationId: 2n, voucherIds: [7n, 8n], durationSeconds: 86_400, slotCap: 10 });
  assert.deepEqual(calls.map((c) => c.to.toLowerCase()), [VOUCHER.toLowerCase(), config.USDC.toLowerCase(), config.GIVEAWAY_MANAGER_V2.toLowerCase(), VOUCHER.toLowerCase()]);
  assert.deepEqual(decodeFunctionData({ abi: KEPTRA_VOUCHER_ABI, data: calls[0].data }).args, [config.ERC721_PRIZE_MODULE, true]);
  assert.deepEqual(decodeFunctionData({ abi: KEPTRA_VOUCHER_ABI, data: calls[3].data }).args, [config.ERC721_PRIZE_MODULE, false]);
  const create = decodeFunctionData({ abi: CREATOR_CAMPAIGN_MANAGER_ABI, data: calls[2].data });
  assert.equal(create.args[0], config.ERC721_PRIZE_MODULE);
  assert.equal(create.args[1], encodeAbiParameters([{ type: 'address' }, { type: 'uint256[]' }], [VOUCHER, [7n, 8n]]));
  assert.deepEqual([create.args[2], create.args[3], create.args[5]], [2n, 100_000_000n, 2]);
  assert.deepEqual(chain.calls.find((c) => c.name === 'currentCreationFee').args, [1, 100_000_000n]);
  assert.deepEqual(decodeFunctionData({ abi: CREATOR_APPROVAL_ABI, data: calls[1].data }).args, [config.GIVEAWAY_MANAGER_V2, 51_000_000n]);
  for (const [extra, why] of [
    [{ claimedAt: T0 }, 'already claimed'],
    [{ voided: true }, 'voided'],
    [{ obligationId: 3n }, 'another obligation'],
    [{ owner: config.ERC721_PRIZE_MODULE }, 'already in a campaign'],
  ]) {
    escrow.set({ readVouchers: (ids) => ids.map((id) => voucher(id, extra)) });
    await assert.rejects(prepare('store-1', { kind: 'createVoucherCampaign', obligationId: 2n, voucherIds: [7n], durationSeconds: 86_400, slotCap: 10 }), /no_voucher/, why);
  }
  await assert.rejects(prepare('store-1', { kind: 'createVoucherCampaign', obligationId: 2n, voucherIds: Array.from({ length: 21 }, (_u, i) => BigInt(i + 1)), durationSeconds: 86_400, slotCap: 10 }), /amount/);
  store.rows('bridge_v2_phones').forEach((row) => (row.released_at = new Date().toISOString()));
  await assert.rejects(prepare('store-1', { kind: 'createVoucherCampaign', obligationId: 2n, voucherIds: [7n], durationSeconds: 86_400, slotCap: 10 }), /phone_required/);
});

await test(['Q30', 'AP1'], '2.3 and I12: every order action is sent only with the passkey’s signature over exactly the prepared hash', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  escrow.set({ readOrders: [fx({ id: 1, state: OrderState.SHIPPED, payer: buyer.participant, store: '0x1234567890123456789012345678901234567890' })] });
  const prepared = await relay({ kind: 'confirm', orderId: '1' });
  const other = await createPasskey();
  kchain.set({ isValidPasskeySignature: false });
  const forged = await relay({ kind: 'confirm', orderId: '1', nonce: prepared.body.nonce, ...(await other.sign(prepared.body.safeTxHash)), credentialId: buyer.passkey.credentialId });
  assert.equal(forged.status, 401);
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0);
});

// ===========================================================================
// J5, P11, P12 — the exits by time: Q20 Q21
// ===========================================================================

await test(['Q20', 'AP12'], 'J5: each exit is due strictly after its deadline, in the escrow’s own direction, and not a second before', () => {
  const row = (extra) => ({ state: OrderState.PAID, paidAt: T0, shipDays: 5, deliveryDays: 10, shippedAt: 0n, windowEndsAt: 0n, contestedAt: 0n, ...extra });
  assert.equal(dueExit(row({}), T0 + 5n * DAY), null);
  assert.equal(dueExit(row({}), T0 + 5n * DAY + 1n), 'expire');
  assert.equal(dueExit(row({ state: OrderState.SHIPPED, shippedAt: T0 }), T0 + 10n * DAY), null);
  assert.equal(dueExit(row({ state: OrderState.SHIPPED, shippedAt: T0 }), T0 + 10n * DAY + 1n), 'expire');
  assert.equal(dueExit(row({ state: OrderState.WINDOW, windowEndsAt: T0 }), T0), null);
  assert.equal(dueExit(row({ state: OrderState.WINDOW, windowEndsAt: T0 }), T0 + 1n), 'closeWindow');
  assert.equal(dueExit(row({ state: OrderState.CONTESTED, contestedAt: T0 }), T0 + 5n * DAY), null);
  assert.equal(dueExit(row({ state: OrderState.CONTESTED, contestedAt: T0 }), T0 + 5n * DAY + 1n), 'resolveAbsentArbiter');
  assert.equal(dueExit(row({ state: OrderState.CLOSED }), T0 + 100n * DAY), null);
});

await test(['Q20', 'AP11', 'AP12'], 'P11: the pass fires the due exits with the keeper, spends nothing of the shared ceiling, and skips an exit somebody else already made', async () => {
  fresh();
  const spend = [];
  db.on('rpc:bridge_v2_claim_spend', (op) => {
    spend.push(op.args.p_provider);
    return { data: true, error: null };
  });
  const payer = '0x1234567890123456789012345678901234567890';
  const shop = '0x0987654321098765432109876543210987654321';
  chainShows(
    [
      fx({ id: 1, payer, store: shop, paidAt: T0 - 6n * DAY }),
      fx({ id: 2, state: OrderState.SHIPPED, shippedAt: T0 - 11n * DAY, payer, store: shop }),
      fx({ id: 3, state: OrderState.WINDOW, windowEndsAt: T0 - 1n, payer, store: shop }),
      fx({ id: 4, state: OrderState.CONTESTED, contestedAt: T0 - 6n * DAY, payer, store: shop }),
      fx({ id: 5, payer, store: shop }),
    ],
    T0,
  );
  const { log } = await pass();
  assert.deepEqual(
    chain.calls.filter((c) => c.name === 'sendKeeperExit').map((c) => [c.args[0], c.args[1]]),
    [['expire', 1n], ['expire', 2n], ['closeWindow', 3n], ['resolveAbsentArbiter', 4n]],
  );
  assert.equal(spend.filter((p) => p === 'chain').length, 0, 'an exit claimed the shared ceiling');
  assert.equal(log.events.filter((e) => e.kind === 'orders.confirmed').length, 4);
  // Already made by somebody else between the read and the estimate: skipped, no alert.
  chain.reset();
  chain.set({ sendKeeperExit: Object.assign(new Error('execution reverted'), { cause: { data: toFunctionSelector('WrongState()') } }) });
  const second = await pass();
  assert.equal(second.log.events.filter((e) => e.kind === 'orders.skipped' && e.detail.reason === 'WrongState').length, 4);
  assert.ok(!second.log.events.some((e) => e.kind === 'alert'), 'an exit somebody else made raised an alert');
});

await test(['Q20', 'AP11'], '§18 M4 and M3: with a keeper transaction still pending nothing is sent; a receipt that never comes stops the pass; a deferrable price defers with an alert', async () => {
  fresh();
  const payer = '0x1234567890123456789012345678901234567890';
  const shop = '0x0987654321098765432109876543210987654321';
  chainShows([fx({ id: 1, payer, store: shop, paidAt: T0 - 6n * DAY }), fx({ id: 2, payer, store: shop, paidAt: T0 - 6n * DAY })]);
  chain.set({ keeperAccount: { balance: 10n ** 18n, latestNonce: 4, pendingNonce: 5, maxFeePerGas: 1n } });
  const pending = await pass();
  assert.equal(chain.calls.filter((c) => c.name === 'sendKeeperExit').length, 0);
  assert.ok(pending.log.events.some((e) => e.kind === 'orders.deferred' && e.detail.reason === 'keeper_transaction_pending'));
  chain.reset();
  chain.set({ waitForReceipt: null });
  await pass();
  assert.equal(chain.calls.filter((c) => c.name === 'sendKeeperExit').length, 1, 'sent past an unconfirmed transaction');
  chain.reset();
  chain.set({ sendKeeperExit: new chain.ChainError('gas_cost_above_ceiling') });
  const deferred = await pass();
  assert.ok(deferred.log.events.some((e) => e.kind === 'orders.deferred' && e.detail.reason === 'gas_cost_above_ceiling'));
  assert.ok(deferred.log.events.some((e) => e.kind === 'alert'));
});

await test(['Q21', 'AP11'], 'H8, H9, J1: a voucher the core can no longer deliver is voided by the keeper — its campaign position read for the clamp case — and burned, voided or held ones are left alone', async () => {
  fresh();
  const brand = '0x7777777777777777777777777777777777777777';
  const vouchers = [
    { voucherId: 1n, owner: null, voided: false, claimedAt: 0n, giveawayId: 0n, obligationId: 1n },
    { voucherId: 2n, owner: brand, voided: true, claimedAt: 0n, giveawayId: 0n, obligationId: 1n },
    { voucherId: 3n, owner: GUARANTEE, voided: false, claimedAt: T0 - 40n * DAY, giveawayId: 5n, obligationId: 1n },
    { voucherId: 4n, owner: config.ERC721_PRIZE_MODULE, voided: false, claimedAt: 0n, giveawayId: 6n, obligationId: 1n },
    { voucherId: 5n, owner: brand, voided: false, claimedAt: T0 - 60n, giveawayId: 6n, obligationId: 1n },
  ];
  chainShows([]);
  escrow.set({
    voucherLastId: 5n,
    readVouchers: (ids) => vouchers.filter((v) => ids.includes(v.voucherId)),
    campaignItems: [9n, 4n],
    voucherReleasable: (id, index) => id === 4n && index === 1n,
  });
  await pass();
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sendKeeperExit').map((c) => c.args), [['voidVoucher', 4n, 1n]]);
  assert.deepEqual(escrow.calls.filter((c) => c.name === 'voucherReleasable').map((c) => c.args[0]), [4n], 'a voucher inside its thirty days, or held, was asked about');
  assert.deepEqual(store.rows('bridge_v2_finished_vouchers').map((r) => String(r.voucher_id)).sort(), ['1', '2']);
  escrow.calls.length = 0;
  await pass();
  assert.deepEqual(escrow.calls.find((c) => c.name === 'readVouchers').args[0], [3n, 4n, 5n], 'finished vouchers read again');
});

// ===========================================================================
// 8.3, P3, P4, P22 — the notices: Q16 Q17 Q18
// ===========================================================================

await test(['Q16', 'AP4', 'AP22'], '8.3, P4, P22: the store on an opened order, the recipient when the window opens — a proof, a declaration or a refusal — and 24 hours before it closes, the arbiter on a contest', () => {
  const row = (extra) => ({ state: OrderState.PAID, flags: 0, windowEndsAt: 0n, ...extra });
  assert.deepEqual(dueNotices(row({}), T0), ['STORE_ORDER']);
  assert.deepEqual(dueNotices(row({ state: OrderState.WINDOW, windowEndsAt: T0 + 3n * DAY }), T0), ['WINDOW_OPENED']);
  assert.deepEqual(dueNotices(row({ state: OrderState.WINDOW, windowEndsAt: T0 + DAY }), T0), ['WINDOW_OPENED', 'WINDOW_CLOSING']);
  assert.deepEqual(dueNotices(row({ state: OrderState.WINDOW, flags: OrderFlag.REFUSAL, windowEndsAt: T0 + DAY - 1n }), T0), ['WINDOW_OPENED', 'WINDOW_CLOSING']);
  assert.deepEqual(dueNotices(row({ state: OrderState.CONTESTED }), T0), ['ARBITER_CONTEST']);
  assert.deepEqual(dueNotices(row({ state: OrderState.SHIPPED }), T0), []);
});

await test(['Q16', 'Q17', 'Q18', 'AP3', 'AP4', 'AP22', 'AQ4'], 'P3: every order notice goes by email only, once per kind, each after a claim on the email ceiling, with keptra.io links; P22 as answered: the brand is told on a redemption too', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  const spend = [];
  db.on('rpc:bridge_v2_claim_spend', (op) => {
    spend.push(op.args.p_provider);
    return { data: true, error: null };
  });
  chainShows([
    fx({ id: 1, payer: buyer.participant, store: shop.creator }),
    fx({ id: 2, prize: true, voucherId: 5n, payer: buyer.participant, store: shop.creator }),
    fx({ id: 3, state: OrderState.WINDOW, flags: OrderFlag.PROOF, windowEndsAt: T0 + 3n * DAY, payer: buyer.participant, store: shop.creator }),
    fx({ id: 4, state: OrderState.WINDOW, flags: OrderFlag.REFUSAL, windowEndsAt: T0 + 3_600n, payer: buyer.participant, store: shop.creator }),
    fx({ id: 5, state: OrderState.CONTESTED, contestedAt: T0, payer: buyer.participant, store: shop.creator }),
  ]);
  await pass();
  const sent = mails();
  const to = (orderId) => sent.filter((m) => m.subject.includes(`#${orderId}`)).map((m) => m.to[0]);
  assert.deepEqual(to(1), ['store-1@example.test']);
  assert.deepEqual(to(2), ['store-1@example.test'], 'the brand was not told of the redemption');
  assert.deepEqual(to(3), ['participant-1@example.test']);
  assert.deepEqual(to(4), ['participant-1@example.test', 'participant-1@example.test'], 'a refusal window with less than 24 hours left');
  assert.deepEqual(to(5), ['arbiter@example.invalid']);
  assert.match(sent.find((m) => m.subject.includes('#3')).text, /confirmed/);
  assert.match(sent.find((m) => m.subject.includes('#4') && m.subject.includes('action window')).text, /refused or not collected/);
  for (const mail of sent.filter((m) => !m.to[0].startsWith('arbiter'))) assert.match(mail.text, new RegExp(`${keptra.KEPTRA_BASE.replace(/[.]/g, '\\.')}/`));
  assert.equal(http.requests.filter((r) => r.url.includes('api.telegram.org')).length, 0, 'P3: a notice went by Telegram');
  assert.equal(spend.filter((p) => p === 'email').length, sent.length);
  assert.equal(store.rows('bridge_v2_order_notices').length, sent.length);
  http.requests.length = 0;
  await pass();
  assert.equal(mails().length, 0, 'a notice was sent twice');
});

await test(['Q16'], '8.3: an erased participant is not written to, and a failed send is tried again on the next run', async () => {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  store.rows('bridge_v2_participants').find((r) => r.id === 'store-1').email_canonical = 'erased-abc@invalid';
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator }), fx({ id: 2, state: OrderState.WINDOW, windowEndsAt: T0 + 3n * DAY, payer: buyer.participant, store: shop.creator })]);
  http.routes.splice(http.routes.findIndex(([pattern]) => pattern === 'api.resend.com'), 1);
  http.on('api.resend.com', () => new Response('no', { status: 500 }));
  await pass();
  assert.equal(store.rows('bridge_v2_order_notices').length, 0);
  http.routes.splice(http.routes.findIndex(([pattern]) => pattern === 'api.resend.com'), 1);
  http.on('api.resend.com', () => jsonResponse({ id: 'mail-2' }));
  http.requests.length = 0;
  await pass();
  assert.deepEqual(mails().map((m) => m.to[0]), ['participant-1@example.test']);
});

// ===========================================================================
// T9, P17 — evidence and the arbiter: Q19
// ===========================================================================

async function contestSetup() {
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  escrow.set({ readOrders: [fx({ id: 1, state: OrderState.CONTESTED, contestedAt: T0, payer: buyer.participant, store: shop.creator })] });
  return { buyer, shop };
}

await test(['Q19', 'AP17', 'AQ3'], 'P17: while contested each party writes one text of at most 2 000 characters, kept encrypted; both read both, and the hash for decide() covers the two texts', async () => {
  await contestSetup();
  asParticipant('participant-1');
  assert.equal((await post(evidenceRoute, 'order/evidence', { orderId: '1', text: 'x'.repeat(2_001) })).status, 400);
  assert.equal((await post(evidenceRoute, 'order/evidence', { orderId: '1', text: 'It never arrived.' })).status, 200);
  assert.equal((await post(evidenceRoute, 'order/evidence', { orderId: '1', text: 'Second thoughts.' })).status, 409, 'rewritten');
  asParticipant('store-1');
  const read_ = await (await post(evidenceRoute, 'order/evidence', { orderId: '1', text: 'Delivered to the neighbour.' })).json();
  assert.equal(read_.recipient, 'It never arrived.');
  assert.equal(read_.store, 'Delivered to the neighbour.');
  assert.equal(read_.document, keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'string' }], ['It never arrived.', 'Delivered to the neighbour.'])));
  for (const row of store.rows('bridge_v2_order_evidence')) {
    assert.match(row.text_enc, /^v1\./);
    assert.ok(!row.text_enc.includes('arrived') && !row.text_enc.includes('neighbour'));
  }
  // Somebody else's session reads nothing.
  await person('participant-7', '0x6666666666666666666666666666666666666666');
  assert.equal((await post(evidenceRoute, 'order/evidence', { orderId: '1' })).status, 409);
});

await test(['Q19', 'AP17', 'AQ5'], 'P17: evidence is written only while the order is contested', async () => {
  const { buyer, shop } = await contestSetup();
  escrow.set({ readOrders: [fx({ id: 1, state: OrderState.WINDOW, windowEndsAt: T0 + DAY, payer: buyer.participant, store: shop.creator })] });
  asParticipant('participant-1');
  const response = await post(evidenceRoute, 'order/evidence', { orderId: '1', text: 'Early.' });
  assert.equal(response.status, 409);
  assert.equal(store.rows('bridge_v2_order_evidence').length, 0);
});

await test(['Q19', 'AP17', 'AP22', 'AQ2'], 'P17 as answered: the arbiter reads both texts and the hash by signing a fresh challenge with the key the escrow names now; any other signer, or a stale challenge, reads nothing', async () => {
  await contestSetup();
  await orders.writeEvidence(1n, 'RECIPIENT', 'It never arrived.');
  const arbiterKey = generatePrivateKey();
  const arbiter = privateKeyToAccount(arbiterKey);
  escrow.set({ escrowArbiter: arbiter.address });
  const ask = async (account, issuedAt) =>
    arbiterRoute.POST(
      request(url('arbiter/evidence'), {
        body: { orderId: '1', issuedAt, signature: await account.signMessage({ message: orders.arbiterChallenge(1n, issuedAt) }) },
      }),
    );
  const ok = await ask(arbiter, Date.now());
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.recipient, 'It never arrived.');
  assert.equal(body.store, null);
  assert.equal(body.document, orders.evidenceDocument('It never arrived.', null));
  assert.equal((await ask(privateKeyToAccount(generatePrivateKey()), Date.now())).status, 401);
  assert.equal((await ask(arbiter, Date.now() - 6 * 60_000)).status, 401);
  // H5: after a rotation the old key reads nothing.
  escrow.set({ escrowArbiter: privateKeyToAccount(generatePrivateKey()).address });
  assert.equal((await ask(arbiter, Date.now())).status, 401);
});

// ===========================================================================
// transversal: Q26 Q27 Q29 P13
// ===========================================================================

await test(['Q26'], 'F7: the four order routes that reach the chain declare durations derived from their stages, and the three that do not reach it declare none', () => {
  for (const route of ['api/bridge/v2/order/address.ts', 'api/bridge/v2/order/evidence.ts', 'api/bridge/v2/store/tracking.ts', 'api/bridge/v2/arbiter/evidence.ts']) {
    assert.equal(typeof config.ROUTE_MAX_DURATION_SECONDS[route], 'number', route);
    assert.ok(config.ROUTE_MAX_DURATION_SECONDS[route] < config.CRON_MAX_DURATION_SECONDS, route);
  }
  for (const route of ['api/bridge/v2/order/list.ts', 'api/bridge/v2/store/orders.ts', 'api/bridge/v2/oracle/pending.ts']) {
    assert.equal(config.ROUTE_MAX_DURATION_SECONDS[route], undefined, route);
    assert.ok(!read(route).includes('escrowChain'), `${route} reaches the chain`);
  }
});

await test(['Q27', 'AP12'], 'C1 and P12: every reservation of the orders pass is a named constant of EVERY_RESERVATION_MS, and one of each fits the budget of the minute-by-minute pipeline', () => {
  const source = read('lib/bridge-v2/keptraOrders.ts').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (() => {
    const text = read('lib/bridge-v2/config.ts');
    return text.slice(text.indexOf('export const EVERY_RESERVATION_MS'), text.indexOf('export const LARGEST_UNIT_MS'));
  })();
  const found = [...source.matchAll(/hasTimeFor\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(found.length >= 8);
  for (const name of found) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, name);
    assert.match(block, new RegExp(`\\b${name}\\b`), `${name} is not in EVERY_RESERVATION_MS`);
    assert.ok(config[name] < config.RUN_BUDGET_MS, name);
  }
  // P12: the pass runs in the pipeline, which runs every minute.
  assert.deepEqual(JSON.parse(read('vercel.json')).crons.find((c) => c.path.endsWith('/process')).schedule, '* * * * *');
});

await test(['Q29', 'AP13', 'H1'], 'P13: the list of what the bridge signs is closed and counted — six derived-wallet shapes, the four lifecycle calls, the four exits of piece 5, the mark and the attestation — each with literal names', () => {
  const writes = (abi) => abi.filter((item) => item.type === 'function' && item.stateMutability !== 'view').map((item) => item.name).sort();
  assert.deepEqual(writes(KEPTRA_KEEPER_ABI), ['closeWindow', 'expire', 'resolveAbsentArbiter', 'voidVoucher']);
  assert.deepEqual(writes(KEPTRA_BRIDGE_ROLE_ABI), ['markVerifiedRecipient']);
  const chainSource = read('lib/bridge-v2/chain.ts');
  const exits = chainSource.slice(chainSource.indexOf('function exitCall('), chainSource.indexOf('export async function sendKeeperExit'));
  assert.equal([...exits.matchAll(/case '(\w+)':/g)].length, 4);
  assert.equal([...chainSource.matchAll(/signTypedData\(/g)].length, 1, 'a second typed signature');
  assert.match(chainSource, /primaryType: 'Redemption'/);
  // The whole list, counted: derived (6, contracts.test.mjs), lifecycle (4), exits (4), mark (1), attestation (1).
  const shapes = ['fund', 'enter', 'addEligibilityRoot', 'sweep', 'claimPrize', 'deliver', 'closeGiveaway', 'requestDraw', 'expireDrawRequest', 'finalizeWinners', 'expire', 'closeWindow', 'resolveAbsentArbiter', 'voidVoucher', 'markVerifiedRecipient', 'Redemption'];
  assert.equal(shapes.length, 16);
  for (const name of ['expire', 'closeWindow', 'resolveAbsentArbiter', 'voidVoucher', 'markVerifiedRecipient']) {
    assert.match(chainSource, new RegExp(`functionName: '${name}'`), name);
  }
  // Selectors of the audited contracts (KeptraEscrow.sol, KeptraGuarantee.sol at 5d85a46).
  assert.equal(toFunctionSelector('expire(uint256)'), encodeFunctionData({ abi: KEPTRA_KEEPER_ABI, functionName: 'expire', args: [1n] }).slice(0, 10));
  assert.equal(toFunctionSelector('voidVoucher(uint256,uint256)'), encodeFunctionData({ abi: KEPTRA_KEEPER_ABI, functionName: 'voidVoucher', args: [1n, 0n] }).slice(0, 10));
});

// ===========================================================================
// Adenda R — the audit of piece 5: AR1 AR2 AR3 AR4
// ===========================================================================

/** From now on, a write the predicate picks fails as a lost connection would; the others reach memdb. */
function failWhen(key, when) {
  const real = db.handlerOf(key);
  db.on(key, (op) => (when(op) ? { data: null, error: { code: '08006', message: 'connection failure' } } : real(op)));
}

const alerted = (log, summary) => log.events.filter((e) => e.kind === 'alert' && e.detail.summary === summary).map((e) => e.detail.order_id ?? null);
const exitsSent = () => chain.calls.filter((c) => c.name === 'sendKeeperExit').map((c) => c.args[1]);
const marksSent = () => chain.calls.filter((c) => c.name === 'sendRecipientMark').map((c) => c.args[0]);
const ERASABLE = ['bridge_v2_order_addresses', 'bridge_v2_order_shipments', 'bridge_v2_order_evidence'];

/** Order 1, marked, with its address, shipment and evidence — then shown closed to the recipient: its mark is to be released. */
async function closingSetup() {
  const { buyer, shop } = await markSetup();
  offer();
  asParticipant('participant-1');
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  await pass();
  await orders.registerShipment(1n, `0x${'a'.repeat(64)}`, 'AB123456789');
  await orders.writeEvidence(1n, 'RECIPIENT', 'It never arrived.');
  assert.equal(store.rows('bridge_v2_recipient_marks')[0].status, 'MARKED');
  chainShows([fx({ id: 1, state: OrderState.CLOSED, flags: OrderFlag.VERIFIED, payer: buyer.participant, store: shop.creator })]);
  return { buyer, shop };
}

/** What this side knows of order 1's close: recorded or not, the erasure dates, the mark. */
function closeOfOne() {
  const row = store.rows('bridge_v2_orders').find((r) => String(r.order_id) === '1');
  return {
    closedAt: row.closed_at ?? null,
    outcome: row.outcome ?? null,
    erasure: ERASABLE.map((table) => store.rows(table).find((r) => String(r.order_id) === '1')?.erase_after ?? null),
    mark: store.rows('bridge_v2_recipient_marks').find((r) => String(r.order_id) === '1').status,
  };
}

await test(['AR1', 'Q4', 'Q11', 'AP5', 'AP17'], 'R1 (M1): a close cut short at any of its writes is not recorded, so the next pass reads the order again and finishes it — the erasure date on its address, shipment and evidence, and its mark settled', async () => {
  const cuts = [
    ['bridge_v2_order_addresses:update', () => true],
    ['bridge_v2_order_shipments:update', () => true],
    ['bridge_v2_order_evidence:update', () => true],
    ['bridge_v2_recipient_marks:update', () => true],
    // The row that records the close, and only that one: the scan's write of the order goes through.
    ['bridge_v2_orders:upsert', (op) => op.payload.closed_at !== null],
  ];
  for (const [key, when] of cuts) {
    await closingSetup();
    escrow.set({ orderOutcome: { outcome: 1, searchedTo: 1_000n } });
    let armed = true;
    failWhen(key, (op) => armed && when(op));
    const first = await pass();
    assert.deepEqual(alerted(first.log, 'order close failed'), ['1'], key);
    const cut = closeOfOne();
    assert.equal(cut.closedAt, null, `${key}: the close was recorded with work still to do`);
    armed = false;
    await pass();
    const done = closeOfOne();
    assert.ok(done.closedAt !== null, `${key}: the next pass did not finish the close`);
    assert.equal(done.outcome, 1, key);
    assert.ok(done.erasure.every((date) => date !== null), `${key}: an erasure date is missing (${done.erasure.join(', ')})`);
    for (const date of done.erasure) {
      const days = (Date.parse(date) - Date.now()) / 86_400_000;
      assert.ok(days > 28.9 && days <= 29, `${key}: ${days} days`);
    }
    assert.equal(done.mark, 'RELEASED', `${key}: the mark of a delivery that did not count is not settled`);
    // Recorded once: a third pass has nothing left to do for it.
    escrow.calls.length = 0;
    await pass();
    assert.equal(escrow.calls.filter((c) => c.name === 'orderOutcome').length, 0, `${key}: a recorded close was read again`);
  }
});

await test(['AR2', 'Q20', 'Q16', 'Q11', 'AP11', 'AP22'], 'R2 (B1): an order whose exit, notice or mark fails is logged and alerted on its own — the other orders get their exit, their notice and their mark in the same pass', async () => {
  const { buyer, shop } = await markSetup();
  const second = await person('participant-2', '0x5555555555555555555555555555555555555561');
  const third = await person('participant-3', '0x5555555555555555555555555555555555555562');
  withPhone('participant-2', 'phone-second');
  withPhone('participant-3', 'phone-third');
  chainShows([buyer, second, third].map((payer, index) => fx({ id: index + 1, payer: payer.participant, store: shop.creator, paidAt: T0 - 6n * DAY })));
  chain.set({ sendKeeperExit: (_exit, id) => (id === 2n ? new Error('connection reset') : '0x'.padEnd(66, '7')) });
  failWhen('bridge_v2_order_notices:insert', (op) => String(op.payload.order_id) === '2');
  failWhen('bridge_v2_recipient_marks:insert', (op) => String(op.payload.order_id) === '2');
  const { log } = await pass();
  assert.deepEqual(exitsSent(), [1n, 2n, 3n]);
  assert.equal(log.events.filter((e) => e.kind === 'orders.confirmed').length, 2);
  assert.deepEqual(log.events.filter((e) => e.kind === 'alert' && e.detail.summary === 'order exit failed').map((e) => e.detail.id), ['2']);
  assert.deepEqual(store.rows('bridge_v2_order_notices').map((r) => String(r.order_id)).sort(), ['1', '3']);
  assert.deepEqual(alerted(log, 'order notice failed'), ['2']);
  assert.deepEqual(marksSent(), [1n, 3n]);
  assert.deepEqual(alerted(log, 'order mark failed'), ['2']);
  assert.deepEqual(alerted(log, 'orders step failed'), [], 'a whole step stopped');
});

await test(['AR2', 'Q20', 'Q21'], 'R2 (B1): an order whose scan fails does not stop the pass — the others’ exits go, and a failed voucher scan stops none; a new order that fails holds the new ones after it for the next pass, which reads them all', async () => {
  fresh();
  const payer = '0x1234567890123456789012345678901234567890';
  const shop = '0x0987654321098765432109876543210987654321';
  chainShows([1, 2, 3].map((id) => fx({ id, payer, store: shop })));
  await pass();
  chain.reset();
  chainShows([1, 2, 3, 4, 5].map((id) => fx({ id, payer, store: shop, paidAt: T0 - 6n * DAY })));
  escrow.set({ voucherLastId: 1n, readVouchers: new Error('connection reset') });
  // Order 2 is known, order 4 new: the scan cannot write either.
  const failing = new Set(['2', '4']);
  failWhen('bridge_v2_orders:upsert', (op) => failing.has(String(op.payload.order_id)));
  const { log } = await pass();
  assert.deepEqual(exitsSent(), [1n, 3n]);
  assert.deepEqual(alerted(log, 'order scan failed'), ['2', '4']);
  assert.equal(alerted(log, 'voucher scan failed').length, 1);
  // Order 5 is not written past order 4: the index never skips an order it does not hold.
  assert.deepEqual(store.rows('bridge_v2_orders').map((r) => String(r.order_id)).sort(), ['1', '2', '3']);
  failing.clear();
  chain.reset();
  await pass();
  assert.deepEqual(exitsSent(), [1n, 2n, 3n, 4n, 5n]);
  assert.deepEqual(store.rows('bridge_v2_orders').map((r) => String(r.order_id)).sort(), ['1', '2', '3', '4', '5']);
});

/** A provider that refuses more than `limit` blocks per request, and holds order 1's OrderClosed at `closedIn`. */
function limitedProvider(limit, closedIn, outcome = 1) {
  chain.set({
    getContractEvents: ({ fromBlock, toBlock, args }) => {
      if (toBlock - fromBlock + 1n > limit) return new Error(`query exceeds max block range ${limit}`);
      return args.orderId === 1n && fromBlock <= closedIn && closedIn <= toBlock ? [{ args: { orderId: 1n, outcome, materialFailure: false } }] : [];
    },
  });
}
const logReads = () => chain.calls.filter((c) => c.name === 'getContractEvents').map((c) => c.args[0]);

await test(['AR2', 'Q11', 'AP5'], 'R2 (B1): the close is read from the log through a provider that limits the block range — a refused request is asked again over half the range, the accepted ones cover the range without a gap, and the outcome found settles the mark', async () => {
  const { buyer, shop } = await closingSetup();
  escrow.set({ orderOutcome: escrow.realOrderOutcome, ordersHead: { orderCount: 2n, now: T0, block: 60_000n } });
  limitedProvider(1_000n, 42_000n);
  const { log } = await pass();
  const reads = logReads();
  const accepted = reads.filter((p) => p.toBlock - p.fromBlock + 1n <= 1_000n);
  assert.ok(reads.length > accepted.length, 'no request was refused');
  assert.equal(accepted[0].fromBlock, 1_000n, 'the search does not start where the order was last seen open');
  for (let i = 1; i < accepted.length; i += 1) assert.equal(accepted[i].fromBlock, accepted[i - 1].toBlock + 1n, 'a gap or an overlap in the blocks read');
  assert.ok(accepted.at(-1).fromBlock <= 42_000n && 42_000n <= accepted.at(-1).toBlock, 'the search went past the log it found');
  const closed = closeOfOne();
  assert.ok(closed.closedAt !== null);
  assert.equal(closed.outcome, 1);
  assert.equal(closed.mark, 'RELEASED');
  assert.deepEqual(alerted(log, 'order close failed'), []);
  void buyer;
  void shop;
});

await test(['AR2', 'AR1', 'Q11'], 'R2 (B1): out of time in the middle of the log, the search stops and keeps how far it got — the close stays to do — and the next pass goes on from that block, not from the start, and finishes it', async () => {
  await closingSetup();
  escrow.set({ orderOutcome: escrow.realOrderOutcome, ordersHead: { orderCount: 2n, now: T0, block: 20_000n } });
  limitedProvider(1_000n, 15_000n);
  // Time for five more reads of the log, then none.
  const real = deadline();
  let reads = 5;
  const short = { ...real, hasTimeFor: (ms) => (ms === config.ORDER_LOG_CHUNK_MS ? reads-- > 0 : real.hasTimeFor(ms)) };
  const log = recordingLogger();
  await advanceOrders(log, short);
  const cut = closeOfOne();
  assert.equal(cut.closedAt, null);
  assert.equal(cut.mark, 'MARKED', 'the mark was settled without the outcome');
  const reached = store.rows('bridge_v2_orders')[0].seen_block;
  assert.ok(BigInt(reached) > 1_000n && BigInt(reached) < 15_000n, `kept ${reached}`);
  assert.ok(log.events.some((e) => e.kind === 'orders.deferred' && e.detail.reason === 'close_search_unfinished'));
  chain.calls.length = 0;
  await pass();
  assert.equal(logReads()[0].fromBlock, BigInt(reached), 'the next pass started the search again from the start');
  const done = closeOfOne();
  assert.ok(done.closedAt !== null);
  assert.equal(done.mark, 'RELEASED');
});

await test(['AR4'], 'R4: what no flow reads is gone — the contest window parameter, the log kind never emitted, the outcome’s material flag, the obligation’s unit counts and the tracking hash in the store’s list — and the recipient’s list stays, declared as the boundary with piece 6', async () => {
  assert.equal('ESCROW_CONTEST_WINDOW_SECONDS' in config, false);
  const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!code('lib/bridge-v2/log.ts').includes("'order.refused'"));
  const escrowChain = code('lib/bridge-v2/escrowChain.ts');
  assert.ok(!/material/.test(escrowChain), 'orderOutcome still returns the material flag');
  assert.ok(!/\bunits\b|openUnits/.test(escrowChain), 'readObligation still returns the unit counts');
  assert.match(read('api/bridge/v2/order/list.ts'), /boundary with\s+\*?\s*piece 6/);
  // The store's list, with a shipment registered: the order and its address, and no hash.
  fresh();
  const buyer = await person('participant-1', '0x2222222222222222222222222222222222222222');
  const shop = await person('store-1', '0x3333333333333333333333333333333333333333');
  offer();
  asParticipant('participant-1');
  await post(addressRoute, 'order/address', { ...ADDRESS, termsId: '1' });
  chainShows([fx({ id: 1, payer: buyer.participant, store: shop.creator })]);
  await pass();
  await orders.registerShipment(1n, `0x${'a'.repeat(64)}`, 'AB123456789');
  asParticipant('store-1');
  const listed = await (await post(storeOrdersRoute, 'store/orders', {})).json();
  assert.equal(listed.orders.length, 1);
  assert.deepEqual(listed.orders[0].address, ADDRESS);
  assert.equal('trackingHash' in listed.orders[0], false);
  assert.ok(!JSON.stringify(listed).includes('a'.repeat(64)));
});

await test(['AR3'], 'R3: this matrix is in the repository, names the spec version it was checked against (1.19) and the Adendas P, Q and R, and has a row for every Qn, APn, AQn and ARn a piece-5 test declares', () => {
  const matrix = read('test/bridge-v2/MATRIZ-PECA5-KEPTRA.md');
  assert.match(matrix, /linha 3: \*\*Versão 1\.19 — 21\/09\/2026\*\*/);
  for (const heading of ['## 2. Adenda P', '## 3. Adenda Q', '## 4. Adenda R']) assert.ok(matrix.includes(heading), heading);
  const declared = new Set();
  for (const path of ['test/bridge-v2/suites/orders.test.mjs', 'test/bridge-v2/fork/orders.fork.mjs']) {
    for (const [, list] of read(path).matchAll(/await test\(\s*\[([^\]]*)\]/g)) {
      for (const tag of list.split(',').map((part) => part.trim().replace(/'/g, ''))) if (/^(Q|AP|AQ|AR)\d+$/.test(tag)) declared.add(tag);
    }
  }
  assert.ok(declared.has('AR3') && declared.has('Q31') && declared.has('AQ5'), 'the tags were not all read');
  for (const tag of declared) assert.match(matrix, new RegExp(`^\\| ${tag} \\|`, 'm'), `${tag} has no row in the matrix`);
});

// ===========================================================================
// migration 0013, executed — Q28
// ===========================================================================

let engine = null;
try {
  await bootEngine();
  engine = await createDatabase('bridge_v2_orders', { withCitext: true });
  for (const file of [
    '0004_bridge_v2_schema.sql',
    '0005_bridge_v2_functions.sql',
    '0006_bridge_v2_grants.sql',
    '0007_bridge_v2_routes.sql',
    '0010_bridge_v2_outcomes.sql',
    '0011_campaign_identity.sql',
    '0012_keptra_accounts.sql',
    '0013_keptra_orders.sql',
  ]) {
    const applied = await applyMigration(engine, file);
    if (!applied.ok) throw new Error(`${file} did not apply: ${applied.at} ${applied.text}`);
  }
  // Idempotent, like the ones before it.
  const again = await applyMigration(engine, '0013_keptra_orders.sql');
  if (!again.ok) throw new Error(`0013 is not idempotent: ${again.at} ${again.text}`);
} catch (error) {
  await test(['Q28'], 'migration 0013 applies after 0004 to 0012, twice', () => {
    throw error;
  });
  engine = null;
}

if (engine !== null) {
  const q = (text, values) => sql(engine, text, values);
  const participant = async (email) => (await q(`INSERT INTO bridge_v2_participants (email_canonical) VALUES ($1) RETURNING id`, [email])).rows[0].id;

  await test(['Q28', 'AD6'], '0013 on an engine with Supabase’s default privileges: every new table holds exactly its listed verbs, RLS is on, and the browser roles hold nothing', async () => {
    const expected = {
      bridge_v2_order_addresses: 'DELETE,INSERT,SELECT,UPDATE',
      bridge_v2_orders: 'INSERT,SELECT,UPDATE',
      bridge_v2_order_shipments: 'DELETE,INSERT,SELECT,UPDATE',
      bridge_v2_order_evidence: 'DELETE,INSERT,SELECT,UPDATE',
      bridge_v2_order_notices: 'INSERT,SELECT',
      bridge_v2_recipient_marks: 'INSERT,SELECT,UPDATE',
      bridge_v2_finished_vouchers: 'INSERT,SELECT',
    };
    for (const [table, verbs] of Object.entries(expected)) {
      const granted = await q(
        `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS verbs FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = 'service_role'`,
        [table],
      );
      assert.equal(granted.rows[0].verbs, verbs, table);
      for (const role of ['anon', 'authenticated']) {
        const any = await q(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = $2`, [table, role]);
        assert.equal(any.rows[0].n, 0, `${role} holds a privilege on ${table}`);
      }
      const rls = await q(`SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [table]);
      assert.equal(rls.rows[0].relrowsecurity, true, `${table} has no RLS`);
    }
  });

  await test(['Q28', 'Q1', 'Q6'], '0013: an address is for an offer or a voucher, never in clear, one per order; a tracking hash serves one order; evidence is one text per party', async () => {
    const id = await participant('addr@example.test');
    const address = (extra) => attempt(engine.pool, `INSERT INTO bridge_v2_order_addresses (participant_id, terms_id, voucher_id, order_id, address_enc) VALUES ($1, $2, $3, $4, $5)`, [id, ...extra]);
    assert.equal((await address([1, 2, null, 'v1.a.b'])).code, '23514', 'both an offer and a voucher');
    assert.equal((await address([null, null, null, 'v1.a.b'])).code, '23514', 'neither');
    assert.equal((await address([1, null, null, 'Rua das Flores 12'])).code, '23514', 'in clear');
    assert.equal((await address([1, null, 7, 'v1.a.b'])).ok, true);
    assert.equal((await address([1, null, 7, 'v1.c.d'])).code, '23505', 'two addresses for one order');
    const shipment = (orderId, hash) => attempt(engine.pool, `INSERT INTO bridge_v2_order_shipments (order_id, tracking_hash, tracking_enc) VALUES ($1, $2, 'v1.a.b')`, [orderId, hash]);
    assert.equal((await shipment(7, `0x${'a'.repeat(64)}`)).ok, true);
    assert.equal((await shipment(8, `0x${'a'.repeat(64)}`)).code, '23505', 'I6: one hash, two orders');
    assert.equal((await shipment(9, 'AB123456789')).code, '23514', 'a number in place of its hash');
    const evidence = (party) => attempt(engine.pool, `INSERT INTO bridge_v2_order_evidence (order_id, party, text_enc) VALUES (7, $1, 'v1.a.b')`, [party]);
    assert.equal((await evidence('RECIPIENT')).ok, true);
    assert.equal((await evidence('RECIPIENT')).code, '23505');
    assert.equal((await evidence('ARBITER')).code, '23514');
  });

  await test(['Q28', 'AP5'], '0013: a number counts once per store among the live marks, and a released mark frees the pair', async () => {
    const mark = (orderId, store_, status) =>
      attempt(engine.pool, `INSERT INTO bridge_v2_recipient_marks (order_id, store_address, phone_hmac, status) VALUES ($1, $2, 'phone-1', $3)`, [orderId, store_, status]);
    const storeA = '0x3333333333333333333333333333333333333333';
    const storeB = '0x4444444444444444444444444444444444444444';
    assert.equal((await mark(1, storeA, 'RESERVED')).ok, true);
    assert.equal((await mark(2, storeA, 'RESERVED')).code, '23505');
    assert.equal((await mark(3, storeB, 'RESERVED')).ok, true, 'another store');
    await q(`UPDATE bridge_v2_recipient_marks SET status = 'RELEASED' WHERE order_id = 1`);
    assert.equal((await mark(2, storeA, 'RESERVED')).ok, true);
    const skip = await attempt(engine.pool, `INSERT INTO bridge_v2_recipient_marks (order_id, store_address, phone_hmac, status) VALUES (4, $1, NULL, 'SKIPPED')`, [storeA]);
    assert.equal(skip.ok, true);
    const bare = await attempt(engine.pool, `INSERT INTO bridge_v2_recipient_marks (order_id, store_address, phone_hmac, status) VALUES (5, $1, NULL, 'RESERVED')`, [storeA]);
    assert.equal(bare.code, '23514', 'a live mark with no number');
  });

  await test(['Q28', 'Q4'], '0013: what eraseExpired sends deletes the rows whose date has come, as the service role, and nothing else', async () => {
    const id = await participant('erase@example.test');
    await q(`INSERT INTO bridge_v2_order_addresses (participant_id, terms_id, order_id, address_enc, erase_after) VALUES ($1, 1, 20, 'v1.a.b', now() - interval '1 minute'), ($1, 1, 21, 'v1.a.b', now() + interval '1 day')`, [id]);
    const deleted = await asRole(engine, 'service_role', (client) => client.query(`DELETE FROM bridge_v2_order_addresses WHERE erase_after <= now() RETURNING order_id`));
    assert.deepEqual(deleted.rows.map((r) => Number(r.order_id)), [20]);
  });
}
