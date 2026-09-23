/**
 * SPEC-BLOCO-03 piece 5, on-chain: the orders against the real contracts of
 * pieces 2 and 3 — KeptraEscrow, KeptraGuarantee (with its KeptraVoucher) and
 * KeptraPool, deployed on the local fork from the creation code of commit
 * 5d85a46 (keptra-5d85a46.json, whose escrow hash is Z1's, the one piece 4 pins) — and
 * the real GiveawayManagerV2, its ERC-721 prize module, USDC and the Safe
 * contracts of Arbitrum One.
 *
 * The bridge code is the real code: relay.ts, keptraOrders.ts, orders.ts,
 * escrowChain.ts, chain.ts, the routes. Only the database is doubled, as tables
 * in memory. The fork is asked to pretend only what the bridge does not own: the
 * oracle's attestation and the arbiter's decision are impersonated (their keys
 * are piece 4's and the owner's), as are the core's root publication and the VRF
 * fulfilment, as the piece 1 suite does.
 *
 * Tags as in the orders suite: Qn and APn, and the criteria of section 16 each
 * flow demonstrates.
 */

import { readFileSync } from 'node:fs';
import { createPublicClient, encodeAbiParameters, encodeFunctionData, getAddress, http as viemHttp, keccak256, parseAbi, parseEventLogs, stringToHex } from 'viem';
import { arbitrum } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { assert, deadline, http, jsonResponse, realFetch, recordingLogger, request, suite, test, TEST_KEEPER_KEY, TEST_ORACLE_TOKEN, TEST_ROLE_KEY } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import { setKeptraContracts } from '../doubles/config.mjs';
import { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } from '../memdb.mjs';
import { createPasskey } from '../passkey.mjs';
import { rpcClient, setUsdcBalance } from './anvil.mjs';
import * as keptra from '../../../lib/bridge-v2/keptra.ts';
import * as kchain from '../../../lib/bridge-v2/keptraChain.ts';
import * as relay from '../../../lib/bridge-v2/relay.ts';
import * as accounts from '../../../lib/bridge-v2/accounts.ts';
import * as orders from '../../../lib/bridge-v2/orders.ts';
import { advanceOrders } from '../../../lib/bridge-v2/keptraOrders.ts';
import { guardianAddress } from '../../../lib/bridge-v2/guardian.ts';
import { funderAddress } from '../../../lib/bridge-v2/funders.ts';
import { buildTree, proofFor } from '../../../lib/bridge-v2/merkle.ts';
import { ERC721_PRIZE_MODULE, ESCROW_ARBITER_WINDOW_SECONDS, GIVEAWAY_MANAGER_V2, USDC } from '../../../lib/bridge-v2/config.ts';
import { GIVEAWAY_MANAGER_V2_ABI, OrderFlag, OrderState } from '../../../lib/bridge-v2/abi.ts';
import * as trackingRoute from '../../../api/bridge/v2/store/tracking.ts';
import * as evidenceRoute from '../../../api/bridge/v2/order/evidence.ts';
import * as arbiterRoute from '../../../api/bridge/v2/arbiter/evidence.ts';
import * as pendingRoute from '../../../api/bridge/v2/oracle/pending.ts';
import * as offersRoute from '../../../api/bridge/v2/store/offers.ts';

suite('fork-orders');

const url = process.env.ARBITRUM_RPC_URL;
const rpc = rpcClient(url, realFetch);
const client = createPublicClient({ chain: arbitrum, transport: viemHttp(url, { timeout: 60_000 }) });
const log = recordingLogger();
const route = (path) => `https://events.invalid/api/bridge/v2/${path}`;
const SESSION_COOKIE = 'iw_bridge_session=a-token-value';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const DAY = 86_400;
const ADDRESS = { name: 'Ana Silva', street: 'Rua das Flores 12', postCode: '1000-001', city: 'Lisboa', country: 'PT', phone: null };

const FIXTURE = JSON.parse(readFileSync(new URL('./keptra-5d85a46.json', import.meta.url), 'utf8'));
/**
 * Z1's hash of the escrow of 5d85a46, which piece 4 pins at df37231 (OracleReceiver.fork.t.sol,
 * ESCROW_CREATION_CODE_HASH).
 * Written without its 0x: the repository refuses any 32-byte hex literal, the shape of a private key (F2).
 */
const PIECE4_ESCROW_HASH = `0x${'7f269f74cc6a659f906194f4d87635a8d0cfa56a10d1fe774047c91e023890c4'}`;

const ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function deposit(uint256,address) returns (uint256)',
  'function setGuarantee(address)',
  'function setSource(address,bool)',
  'function setDefaultSource(address)',
  'function setProvider(address,bool)',
  'function setStore(address,bool)',
  'function reputation() view returns (address)',
  'function voucher() view returns (address)',
  'function escrow() view returns (address)',
  'function guarantee() view returns (address)',
  'function ARBITER_WINDOW() view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function attest((uint256 orderId, bool delivered)[])',
  'function decide(uint256,bool,uint8,bytes32)',
  'function getOrder(uint256) view returns ((uint64 termsId, uint32 quantity, uint8 state, uint8 flags, uint16 feeBps, address payer, uint96 paid, uint64 paidAt, uint64 shippedAt, uint64 windowEndsAt, uint64 contestedAt, uint256 voucherId, bytes32 codeCommit, bytes32 trackingHash))',
  'function orderCount() view returns (uint256)',
  'function countersOf(address) view returns (uint32 delivered, uint32 minor, uint32 material, uint32 refunds, uint32 fraud, uint32 streak, bool suspended)',
  'function reservedTotal() view returns (uint256)',
  'function activeCoverage(address) view returns (uint256)',
  'function lastId() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function claimedAt(uint256) view returns (uint64)',
  'function voided(uint256) view returns (bool)',
  'function isModuleRegistered(address) view returns (bool)',
  'function prizeKind() view returns (uint8)',
  'function bridge() view returns (address)',
  'function vrfCoordinator() view returns (address)',
  'function claimable(uint256,address) view returns (uint256)',
  'function enter(uint256,uint256,bytes32[])',
  'function closeGiveaway(uint256)',
  'function requestDraw(uint256)',
  'function rawFulfillRandomWords(uint256,uint256[])',
  'function finalizeWinners(uint256)',
  'event WindowOpened(uint256 indexed orderId, uint8 kind, uint64 windowEndsAt)',
  'event StorePaid(uint256 indexed orderId, address indexed payout, uint256 net, uint256 fee)',
  'event UnitReleased(uint256 indexed obligationId, uint256 indexed voucherId, uint96 bond, uint96 coverage)',
]);

const read = (address, functionName, args = []) => client.readContract({ address, abi: ABI, functionName, args });
const usdcOf = (holder) => read(USDC, 'balanceOf', [holder]);
const gasOf = async (hash) => BigInt((await rpc.call('eth_getTransactionReceipt', [hash])).gasUsed);

// ---------------------------------------------------------------------------
// the database, in memory; the relayer is the funder pool (A15)
// ---------------------------------------------------------------------------

db.reset();
const store = memdb(db, KEPTRA_TABLES, KEPTRA_UNIQUE);
db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
db.on('rpc:bridge_v2_acquire_funder', () => ({
  data: [{ funder_index: 0, address: funderAddress(0), next_nonce: 0, lease_token: '00000000-0000-0000-0000-000000000001' }],
  error: null,
}));
for (const name of ['reconcile_funder_nonce', 'renew_funder_lease', 'release_funder', 'disable_funder']) {
  db.on(`rpc:bridge_v2_${name}`, () => ({ data: true, error: null }));
}
db.on('rpc:bridge_v2_try_lock', () => ({ data: 'fork-lock-holder', error: null }));
db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
const asSession = (participantId) =>
  db.on('bridge_v2_sessions:select', () => ({
    data: { id: `s-${participantId}`, participant_id: participantId, idle_expires_at: new Date(Date.now() + 60_000).toISOString(), absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null },
    error: null,
  }));
let trackerSeq = 0;
http.on('api.ship24.com', () => {
  trackerSeq += 1;
  return jsonResponse({ data: { tracker: { trackerId: `fork-tracker-${String(trackerSeq).padStart(4, '0')}` } } }, 201);
});

// ---------------------------------------------------------------------------
// pieces 2 and 3, deployed from the audited creation code
// ---------------------------------------------------------------------------

const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const [owner, oracle, platform, provider] = [fresh(), fresh(), fresh(), fresh()];
const arbiterKey = generatePrivateKey();
const arbiter = privateKeyToAccount(arbiterKey).address;
const roleAddress = privateKeyToAccount(TEST_ROLE_KEY).address;
const keeperAddress = privateKeyToAccount(TEST_KEEPER_KEY).address;
for (const address of [owner, oracle, platform, provider, arbiter, roleAddress, keeperAddress]) await rpc.setBalance(address, 10n ** 18n);
for (const address of [owner, oracle, provider, arbiter]) await rpc.impersonate(address);

async function deploy(name, types, values) {
  const data = `${FIXTURE.contracts[name].creationCode}${encodeAbiParameters(types, values).slice(2)}`;
  const hash = await rpc.call('eth_sendTransaction', [{ from: owner, data, gas: '0x' + (25_000_000).toString(16) }]);
  const receipt = await rpc.waitMined(hash);
  assert.equal(receipt.status, '0x1', `${name} did not deploy`);
  return getAddress(receipt.contractAddress);
}
const as = async (from, to, data) => {
  const receipt = await rpc.send({ from, to, data, gas: 6_000_000n });
  assert.equal(receipt.status, '0x1', `call to ${to} from ${from} reverted: ${await rpc.revertOf({ from, to, data })}`);
  return receipt;
};
const call = (functionName, args) => encodeFunctionData({ abi: ABI, functionName, args });

const address6 = Array.from({ length: 6 }, () => ({ type: 'address' }));
const ESCROW = await deploy('KeptraEscrow', address6, [owner, USDC, oracle, arbiter, roleAddress, platform]);
const REPUTATION = await read(ESCROW, 'reputation');
const GUARANTEE = await deploy('KeptraGuarantee', Array.from({ length: 5 }, () => ({ type: 'address' })), [ESCROW, USDC, GIVEAWAY_MANAGER_V2, ERC721_PRIZE_MODULE, REPUTATION]);
await as(owner, ESCROW, call('setGuarantee', [GUARANTEE]));
const POOL = await deploy('KeptraPool', [{ type: 'address' }, { type: 'address' }], [USDC, GUARANTEE]);
await as(owner, GUARANTEE, call('setSource', [POOL, true]));
await as(owner, GUARANTEE, call('setDefaultSource', [POOL]));
await as(owner, POOL, call('setProvider', [provider, true]));
await setUsdcBalance(rpc, USDC, provider, 1_000_000_000n);
await as(provider, USDC, call('approve', [POOL, 1_000_000_000n]));
await as(provider, POOL, call('deposit', [1_000_000_000n, provider]));
const VOUCHER = getAddress(await read(GUARANTEE, 'voucher'));
setKeptraContracts({ escrow: ESCROW, guarantee: GUARANTEE, voucher: VOUCHER });

// ---------------------------------------------------------------------------
// people: a buyer (and winner) and a store (and brand), with passkeys
// ---------------------------------------------------------------------------

async function registerParticipant(id, phone) {
  const passkey = await createPasskey();
  store.insert('bridge_v2_participants', { id, email_canonical: `${id}@example.test`, wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  store.insert('bridge_v2_phones', { participant_id: id, phone_hmac: phone, released_at: null });
  const signer = await kchain.signerAddressOf(passkey.x, passkey.y);
  await accounts.registerPasskey(id, passkey.credentialId, passkey.x, passkey.y, signer);
  const list = await accounts.ensureAccounts(id, signer, guardianAddress());
  return { id, passkey, signer, participant: list.find((a) => a.role === 'PARTICIPANT'), creator: list.find((a) => a.role === 'CREATOR') };
}

/** prepare, sign with the passkey, submit — echoing the redemption deadline as the route does. */
async function relayAs(person, action, role = null) {
  const prepared = await relay.prepareAction(person.id, action, role);
  const echoed = prepared.redeemDeadline === null ? action : { ...action, deadline: prepared.redeemDeadline };
  const assertion = await person.passkey.sign(prepared.hash);
  const submitted = await relay.submitAction(person.id, echoed, role, prepared.tx.nonce, assertion, log);
  assert.equal(submitted.receipt?.status, 'success', `${action.kind} did not succeed`);
  return submitted;
}

const buyer = await registerParticipant('buyer-1', 'phone-buyer');
const shop = await registerParticipant('store-1', 'phone-store');
await as(owner, ESCROW, call('setStore', [shop.creator.safe, true]));
await relayAs(buyer, { kind: 'configure' });
// C4: the store's account is deployed and configured before it is named as the payout of an offer.
await relayAs(shop, { kind: 'configure' }, 'CREATOR');
await setUsdcBalance(rpc, USDC, buyer.participant.safe, 1_000_000_000n);

const pass = () => advanceOrders(log, deadline());
const order = (id) => read(ESCROW, 'getOrder', [BigInt(id)]);
const attest = (id, delivered = true) => as(oracle, ESCROW, call('attest', [[{ orderId: BigInt(id), delivered }]]));
const TERMS = { payout: shop.creator.safe, price: 20_000_000n, shipping: 2_000_000n, returnCost: 1_000_000n, refusalFeeBps: 500, shipDays: 5, deliveryDays: 10, mode: 0, regions: orders.encodeRegions(['PT', 'ES']) };

async function track(orderId, number) {
  asSession('store-1');
  const response = await trackingRoute.POST(request(route('store/tracking'), { cookie: SESSION_COOKIE, body: { orderId: String(orderId), trackingNumber: number } }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return (await response.json()).trackingHash;
}

let lastPayHash = null;
/** A paid COMPRA order, with its address registered first (P15). Returns its id. */
async function paid() {
  await orders.registerAddress('buyer-1', { termsId: 1n }, ADDRESS);
  const submitted = await relayAs(buyer, { kind: 'pay', termsId: 1n, quantity: 1, codeCommit: ZERO_HASH });
  assert.ok(submitted.orderId !== null);
  lastPayHash = submitted.txHash;
  return submitted.orderId;
}

const gas = {};

// ===========================================================================
// the contracts under test
// ===========================================================================

await test(['Q28', 'AP24', 'AA-Q7', 'AA-T18'], 'fork (Q7, Z1): pieces 2 and 3 run from the creation code of 5d85a46 — the escrow’s hash is Z1’s and piece 4’s pin at df37231 — wired as DeployKeptra wires them, and the bridge points at them by configuration', async () => {
  assert.equal(`0x${FIXTURE.contracts.KeptraEscrow.keccak256}`, PIECE4_ESCROW_HASH);
  assert.equal(keccak256(FIXTURE.contracts.KeptraEscrow.creationCode), PIECE4_ESCROW_HASH);
  assert.equal(getAddress(await read(GUARANTEE, 'escrow')), ESCROW);
  assert.equal(getAddress(await read(ESCROW, 'guarantee')), GUARANTEE);
  assert.equal(Number(await read(ESCROW, 'ARBITER_WINDOW')), ESCROW_ARBITER_WINDOW_SECONDS);
  assert.equal(await read(GIVEAWAY_MANAGER_V2, 'isModuleRegistered', [ERC721_PRIZE_MODULE]), true);
  assert.equal(Number(await read(ERC721_PRIZE_MODULE, 'prizeKind')), 1);
  assert.equal(orders.keptraContractsConfigured(), true);
});

await test(['Q29', 'AP13'], 'P13: every function the bridge encodes into the escrow, the guarantee and the voucher exists in the audited contracts with that selector', () => {
  const ids = (name) => Object.values(FIXTURE.contracts[name].methodIdentifiers).map((selector) => `0x${selector}`);
  const want = {
    KeptraEscrow: ['expire(uint256)', 'closeWindow(uint256)', 'resolveAbsentArbiter(uint256)', 'markVerifiedRecipient(uint256)', 'pay(uint256,uint32,bytes32)', 'redeemVoucher(uint256,bytes32,uint256,bytes)', 'cancel(uint256)', 'confirm(uint256)', 'contest(uint256)', 'createOffer(address,uint96,uint96,uint96,uint16,uint16,uint16,uint8,bytes)', 'deactivateOffer(uint256)', 'ship(uint256,bytes32)', 'submitCode(uint256,bytes32)', 'declareDelivered(uint256)', 'declareRefusal(uint256)', 'refund(uint256,uint96)'],
    KeptraGuarantee: ['voidVoucher(uint256,uint256)', 'createObligation(uint96,uint96,uint96,uint16,uint16,uint8,bytes,uint32)'],
    KeptraVoucher: ['approve(address,uint256)', 'setApprovalForAll(address,bool)', 'releasable(uint256,uint256)'],
  };
  for (const [contract, signatures] of Object.entries(want)) {
    for (const signature of signatures) {
      assert.ok(signature in FIXTURE.contracts[contract].methodIdentifiers, `${contract} has no ${signature}`);
      assert.ok(ids(contract).includes(keccak256(stringToHex(signature)).slice(0, 10)));
    }
  }
});

// ===========================================================================
// 16.4 — a purchase by carrier, proved by the oracle, settled with the 1.5% fee
// ===========================================================================

await test(['Q13', 'Q7', 'Q9', 'Q11', 'Q16', 'AP1', 'AP2', 'AP5', 'AP14'], '16.4 on the fork: the store publishes an offer from its account; the buyer pays with its passkey; the store registers the tracking and ships with the keyed hash; the bridge marks the recipient; the oracle’s list names the order; the oracle attests; the buyer confirms and the store is paid less 1.5%', async () => {
  const offer = await relayAs(shop, { kind: 'createOffer', terms: TERMS });
  gas.createOffer = await gasOf(offer.txHash);
  const orderId = await paid();
  gas.pay = await gasOf(lastPayHash);
  assert.equal(orderId, 1n);
  assert.deepEqual(await orders.addressOfOrder(orderId), ADDRESS);
  // The pass: the store is told (P22) and the recipient marked (13.1), by the bridge role on-chain.
  await pass();
  assert.ok((Number((await order(orderId)).flags) & OrderFlag.VERIFIED) !== 0, 'the escrow does not show the mark');
  gas.mark = await gasOf(log.events.findLast((e) => e.kind === 'order.recipient_marked').detail.tx_hash);
  // H17: the hash on-chain is the bridge's keyed hash, never the number.
  const hash = await track(orderId, '1Z 999 AA1 0123 4567 84');
  const shipped = await relayAs(shop, { kind: 'ship', orderId });
  gas.ship = await gasOf(shipped.txHash);
  assert.equal((await order(orderId)).trackingHash, hash);
  assert.equal(hash, await orders.trackingHashOf('1Z999AA10123456784'));
  await pass();
  // M9: the oracle's list, served by the route, names the order with its tracker and post code.
  const listed = await (await pendingRoute.GET(request(route('oracle/pending'), { method: 'GET', headers: { authorization: `Bearer ${TEST_ORACLE_TOKEN}` } }))).json();
  assert.deepEqual(listed.pending, [{ orderId: '1', trackerId: 'fork-tracker-0001', postCode: '1000-001' }]);
  const attested = await attest(orderId);
  gas.attest = BigInt(attested.gasUsed);
  await pass();
  assert.equal(store.rows('bridge_v2_order_notices').filter((n) => String(n.order_id) === '1').map((n) => n.kind).sort().join(','), 'STORE_ORDER,WINDOW_OPENED');
  const before = { store: await usdcOf(shop.creator.safe), platform: await usdcOf(platform) };
  const confirmed = await relayAs(buyer, { kind: 'confirm', orderId });
  gas.confirm = await gasOf(confirmed.txHash);
  const total = 22_000_000n;
  const fee = (total * 150n) / 10_000n;
  assert.equal((await usdcOf(shop.creator.safe)) - before.store, total - fee);
  assert.equal((await usdcOf(platform)) - before.platform, fee);
  assert.equal(Number((await order(orderId)).state), OrderState.CLOSED);
  // 13.1: the marked delivery counted.
  assert.equal(Number((await read(REPUTATION, 'countersOf', [shop.creator.safe]))[0]), 1);
});

await test(
  ['Q31'],
  `P12: the cost of one order, measured on the fork (gas): createOffer ${gas.createOffer}, pay ${gas.pay}, mark ${gas.mark}, ship ${gas.ship}, attest ${gas.attest}, confirm ${gas.confirm}`,
  () => {
    for (const key of ['createOffer', 'pay', 'mark', 'ship', 'attest', 'confirm']) assert.ok(typeof gas[key] === 'bigint' && gas[key] > 0n, key);
  },
);

// ===========================================================================
// 16.5 — the exits by time, fired by the keeper; a contest resolved
// ===========================================================================

await test(['Q20', 'AP11', 'AP12'], '16.5 on the fork: an order never shipped is expired by the keeper once its five days pass, and the buyer gets everything back; a proved window closes to the store', async () => {
  const unshipped = await paid();
  await pass();
  const shipped = await paid();
  await track(shipped, 'JJD000390007845550');
  await relayAs(shop, { kind: 'ship', orderId: shipped });
  await attest(shipped);
  const buyerBefore = await usdcOf(buyer.participant.safe);
  const storeBefore = await usdcOf(shop.creator.safe);
  await pass();
  assert.equal(Number((await order(unshipped)).state), OrderState.PAID, 'expired before its deadline');
  await rpc.increaseTime(5 * DAY + 60);
  await pass();
  assert.equal(Number((await order(unshipped)).state), OrderState.CLOSED);
  assert.equal((await usdcOf(buyer.participant.safe)) - buyerBefore, 22_000_000n);
  assert.equal(Number((await order(shipped)).state), OrderState.CLOSED);
  assert.equal((await usdcOf(shop.creator.safe)) - storeBefore, 22_000_000n - (22_000_000n * 150n) / 10_000n);
  const exits = log.events.filter((e) => e.kind === 'orders.confirmed').map((e) => `${e.detail.exit}:${e.detail.id}`);
  assert.ok(exits.includes(`expire:${unshipped}`) && exits.includes(`closeWindow:${shipped}`), exits.join(' '));
  assert.ok(Number((await read(REPUTATION, 'countersOf', [shop.creator.safe]))[2]) >= 1, 'T3 was not a material failure');
});

await test(['Q19', 'Q13', 'AP16', 'AP17'], '16.5 on the fork: the buyer contests with its passkey, both parties write their evidence, the arbiter reads it with its own key and decides with the bridge’s hash; an absent arbiter is resolved by the keeper on the proof', async () => {
  const contested = await paid();
  await track(contested, 'CZ123456789PT');
  await relayAs(shop, { kind: 'ship', orderId: contested });
  await attest(contested);
  await relayAs(buyer, { kind: 'contest', orderId: contested });
  asSession('buyer-1');
  assert.equal((await evidenceRoute.POST(request(route('order/evidence'), { cookie: SESSION_COOKIE, body: { orderId: String(contested), text: 'The box was empty.' } }))).status, 200);
  asSession('store-1');
  assert.equal((await evidenceRoute.POST(request(route('order/evidence'), { cookie: SESSION_COOKIE, body: { orderId: String(contested), text: 'Packed and sealed on camera.' } }))).status, 200);
  const issuedAt = Date.now();
  const signature = await privateKeyToAccount(arbiterKey).signMessage({ message: orders.arbiterChallenge(contested, issuedAt) });
  const read_ = await (await arbiterRoute.POST(request(route('arbiter/evidence'), { body: { orderId: String(contested), issuedAt, signature } }))).json();
  assert.equal(read_.recipient, 'The box was empty.');
  assert.equal(read_.document, orders.evidenceDocument('The box was empty.', 'Packed and sealed on camera.'));
  await pass();
  assert.ok(store.rows('bridge_v2_order_notices').some((n) => String(n.order_id) === String(contested) && n.kind === 'ARBITER_CONTEST'));
  // T10 for the store (a second material failure in a row would suspend it, H31, and J3 would stop the tests' later payments).
  const before = await usdcOf(shop.creator.safe);
  const decided = await as(arbiter, ESCROW, call('decide', [contested, true, 0, read_.document]));
  assert.equal(decided.status, '0x1');
  assert.equal((await usdcOf(shop.creator.safe)) - before, 22_000_000n - (22_000_000n * 150n) / 10_000n);
  assert.equal(Number((await order(contested)).state), OrderState.CLOSED);
  // And an arbiter who never decides: after five days the keeper settles on the proof.
  const absent = await paid();
  await track(absent, 'LX987654321PT');
  await relayAs(shop, { kind: 'ship', orderId: absent });
  await attest(absent);
  await relayAs(buyer, { kind: 'contest', orderId: absent });
  await rpc.increaseTime(5 * DAY + 60);
  await pass();
  assert.equal(Number((await order(absent)).state), OrderState.CLOSED);
  assert.ok(log.events.some((e) => e.kind === 'orders.confirmed' && e.detail.exit === 'resolveAbsentArbiter' && e.detail.id === String(absent)));
});

// ===========================================================================
// 16.3 — a physical prize: bond, pool coverage, a voucher won and claimed with
// the passkey, redeemed with the bridge's attestation, delivered, bond back
// ===========================================================================

await test(['Q13', 'Q12', 'Q21', 'AP1', 'AP13'], '16.3 on the fork: a new brand’s obligation takes a 50% bond and reserves pool coverage; its voucher goes into a campaign on the real core; the buyer wins, claims it with its passkey, redeems it with the bridge’s attestation; delivery proved, the bond goes back and the coverage is freed', async () => {
  await setUsdcBalance(rpc, USDC, shop.creator.safe, 500_000_000n);
  const reservedBefore = await read(POOL, 'reservedTotal');
  const obligation = { ...TERMS, price: 50_000_000n, shipping: 5_000_000n, returnCost: 0n, refusalFeeBps: 0, regions: orders.encodeRegions(['PT']) };
  await relayAs(shop, { kind: 'createObligation', terms: obligation, units: 1 });
  const voucherId = await read(VOUCHER, 'lastId');
  assert.equal(getAddress(await read(VOUCHER, 'ownerOf', [voucherId])), getAddress(shop.creator.safe));
  // Nova: 50% of 55 USDC is the bond; the rest is the coverage the pool reserves (H11).
  assert.equal((await read(POOL, 'reservedTotal')) - reservedBefore, 27_500_000n);
  const campaign = await relayAs(shop, { kind: 'createVoucherCampaign', obligationId: 1n, voucherIds: [voucherId], durationSeconds: 3_600, slotCap: 10 });
  const giveawayId = campaign.giveawayId;
  assert.ok(giveawayId !== null);
  assert.equal(getAddress(await read(VOUCHER, 'ownerOf', [voucherId])), getAddress(ERC721_PRIZE_MODULE));

  // The draw on the real core: the buyer's account enters with its passkey, nine others by hand.
  const entrants = Array.from({ length: 9 }, fresh);
  for (const entrant of entrants) {
    await rpc.setBalance(entrant, 10n ** 17n);
    await rpc.impersonate(entrant);
  }
  const tree = buildTree([buyer.participant.safe, ...entrants].map((a) => a.toLowerCase()));
  const coreBridge = await read(GIVEAWAY_MANAGER_V2, 'bridge');
  await rpc.setBalance(coreBridge, 10n ** 18n);
  await rpc.impersonate(coreBridge);
  await as(coreBridge, GIVEAWAY_MANAGER_V2, encodeFunctionData({ abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'addEligibilityRoot', args: [giveawayId, tree.root] }));
  await rpc.stopImpersonating(coreBridge);
  const root = store.insert('bridge_v2_eligibility_roots', { giveaway_id: giveawayId.toString(), root_index: '0', root: tree.root, leaf_count: 10 });
  tree.addresses.forEach((address, position) => store.insert('bridge_v2_eligibility_leaves', { root_id: root.id, address, position }));
  store.insert('bridge_v2_entries', { participant_id: 'buyer-1', giveaway_id: giveawayId.toString(), status: 'ELIGIBLE', wallet_address: buyer.participant.safe, root_index: '0', self_custody: true, passkey: true, outcome: null });
  await relayAs(buyer, { kind: 'enter', giveawayId });
  for (const entrant of entrants) {
    await as(entrant, GIVEAWAY_MANAGER_V2, call('enter', [giveawayId, 0n, proofFor(tree, tree.addresses.indexOf(entrant.toLowerCase()))]));
  }
  await rpc.increaseTime(3_700);
  await rpc.call('anvil_setCode', ['0x0000000000000000000000000000000000000064', '0x4360005260206000f3']);
  await as(entrants[0], GIVEAWAY_MANAGER_V2, call('closeGiveaway', [giveawayId]));
  await as(entrants[0], GIVEAWAY_MANAGER_V2, call('requestDraw', [giveawayId]));
  const { vrfRequestId } = await client.readContract({ address: GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'getGiveaway', args: [giveawayId] });
  const coordinator = await read(GIVEAWAY_MANAGER_V2, 'vrfCoordinator');
  await rpc.setBalance(coordinator, 10n ** 18n);
  let won = false;
  for (let word = 1n; word <= 200n && !won; word += 1n) {
    const attempt = await rpc.snapshot();
    await rpc.impersonate(coordinator);
    await rpc.send({ from: coordinator, to: GIVEAWAY_MANAGER_V2, data: call('rawFulfillRandomWords', [vrfRequestId, [word]]) });
    await rpc.stopImpersonating(coordinator);
    await rpc.impersonate(entrants[0]);
    await as(entrants[0], GIVEAWAY_MANAGER_V2, call('finalizeWinners', [giveawayId]));
    won = (await read(GIVEAWAY_MANAGER_V2, 'claimable', [giveawayId, buyer.participant.safe])) > 0n;
    if (!won) await rpc.revert(attempt);
  }
  for (const entrant of entrants) await rpc.stopImpersonating(entrant);
  assert.ok(won, 'no seed in 200 made the buyer the winner');

  // Claimed with the passkey (F3): the voucher is the buyer's, and its thirty days start.
  await relayAs(buyer, { kind: 'claim', giveawayId });
  assert.equal(getAddress(await read(VOUCHER, 'ownerOf', [voucherId])), getAddress(buyer.participant.safe));
  assert.ok((await read(VOUCHER, 'claimedAt', [voucherId])) > 0n);

  // H7: redeemed with the address registered and the bridge role's attestation.
  await orders.registerAddress('buyer-1', { voucherId }, ADDRESS);
  const redeemed = await relayAs(buyer, { kind: 'redeem', voucherId, codeCommit: ZERO_HASH, deadline: null });
  const orderId = redeemed.orderId;
  assert.ok(orderId !== null);
  assert.deepEqual(await orders.addressOfOrder(orderId), ADDRESS);
  assert.equal((await order(orderId)).voucherId, voucherId);

  // Delivery proved and confirmed: the bond goes home, the coverage is freed (11.7).
  await track(orderId, 'PRIZE0000000001PT');
  await relayAs(shop, { kind: 'ship', orderId });
  await attest(orderId);
  const bondBefore = await usdcOf(shop.creator.safe);
  const confirmed = await relayAs(buyer, { kind: 'confirm', orderId });
  const released = parseEventLogs({ abi: ABI, eventName: 'UnitReleased', logs: confirmed.receipt.logs });
  assert.equal(released.length, 1);
  assert.equal((await usdcOf(shop.creator.safe)) - bondBefore, 27_500_000n);
  assert.equal(await read(POOL, 'reservedTotal'), reservedBefore);
  assert.equal(await read(GUARANTEE, 'activeCoverage', [shop.creator.safe]), 0n);
});

await test(['Q21', 'AP11'], 'H9 on the fork: a voucher never placed in a campaign is voided by the keeper after its thirty days, and its bond and coverage come free with no act of the brand', async () => {
  const reservedBefore = await read(POOL, 'reservedTotal');
  const obligation = { ...TERMS, price: 10_000_000n, shipping: 1_000_000n, returnCost: 0n, refusalFeeBps: 0, regions: orders.encodeRegions(['PT']) };
  await relayAs(shop, { kind: 'createObligation', terms: obligation, units: 1 });
  const voucherId = await read(VOUCHER, 'lastId');
  assert.ok((await read(POOL, 'reservedTotal')) > reservedBefore);
  await pass();
  assert.equal(await read(VOUCHER, 'voided', [voucherId]), false, 'voided inside its thirty days');
  const bondBefore = await usdcOf(shop.creator.safe);
  await rpc.increaseTime(30 * DAY + 60);
  await pass();
  assert.equal(await read(VOUCHER, 'voided', [voucherId]), true);
  assert.equal(await read(POOL, 'reservedTotal'), reservedBefore);
  assert.equal((await usdcOf(shop.creator.safe)) - bondBefore, 5_500_000n);
  assert.ok(log.events.some((e) => e.kind === 'orders.confirmed' && e.detail.exit === 'voidVoucher'));
});

await test(['Q30'], '2.3 and I12 on the fork: no server key moves an account’s value through the escrow — the bridge role’s signature on the buyer’s account is refused with GS026', async () => {
  const state = await kchain.accountState(buyer.participant.safe);
  const calls = [{ to: USDC, data: call('approve', [ESCROW, 1n]) }];
  const tx = keptra.safeTxFor(calls, state.nonce);
  const signature = await privateKeyToAccount(TEST_ROLE_KEY).sign({ hash: keptra.safeTxHash(buyer.participant.safe, tx) });
  const reason = await rpc.revertOf({ from: funderAddress(0), to: buyer.participant.safe, data: keptra.execTransactionData(tx, signature) });
  assert.match(reason ?? '', /GS026/);
});

// ===========================================================================
// Adenda AA4 — B8 and Y5, against the escrow of 5d85a46 (X10)
// ===========================================================================

await test(['AA-B8', 'AA-Y5', 'AA-Q7'], 'B8 and Y5 on the fork, against the escrow of 5d85a46 (X10): an order in a window the store’s declaration opened stays on the oracle’s list until that window ends; the carrier’s refusal attested inside it closes it at once with T8, and the recipient is told; past the end it leaves the list and a refusal no longer applies', async () => {
  const chainNow = async () => Number((await client.getBlock({ blockTag: 'latest' })).timestamp);
  const listed = async () => (await orders.oraclePending(await chainNow())).map((item) => item.orderId);
  // Declared, then refused by the carrier inside the window.
  const refused = await paid();
  await track(refused, 'AA4 B8 REFUSED 0001');
  await relayAs(shop, { kind: 'ship', orderId: refused });
  await relayAs(shop, { kind: 'declareDelivered', orderId: refused });
  await pass();
  assert.equal(Number((await order(refused)).state), OrderState.WINDOW);
  assert.ok((await listed()).includes(String(refused)), 'a declared window left the oracle’s list before its end');
  const buyerBefore = await usdcOf(buyer.participant.safe);
  await attest(refused, false);
  assert.equal(Number((await order(refused)).state), OrderState.CLOSED, 'the escrow of 5d85a46 did not take the refusal inside a declared window');
  // T8: 22 paid, less shipping (2), the return (1) and the refusal fee (5% of 20).
  assert.equal((await usdcOf(buyer.participant.safe)) - buyerBefore, 18_000_000n);
  await pass();
  const kinds = store.rows('bridge_v2_order_notices').filter((n) => String(n.order_id) === String(refused)).map((n) => n.kind).sort();
  assert.ok(kinds.includes('WINDOW_REFUSED'), `the recipient was not told: ${kinds}`);
  assert.ok(http.requests.some((r) => r.url.includes('resend') && /closed by the carrier/.test(JSON.parse(r.body).subject)));
  const closed = store.rows('bridge_v2_orders').find((r) => String(r.order_id) === String(refused));
  assert.notEqual(closed.closed_at ?? null, null);
  assert.equal(Number(closed.outcome), 2);
  // Declared, and the window runs out: it leaves the list, and a refusal after it changes nothing.
  const ended = await paid();
  await track(ended, 'AA4 B8 ENDED 0002');
  await relayAs(shop, { kind: 'ship', orderId: ended });
  await relayAs(shop, { kind: 'declareDelivered', orderId: ended });
  await pass();
  assert.ok((await listed()).includes(String(ended)));
  await rpc.increaseTime(5 * DAY + 60);
  assert.ok(!(await listed()).includes(String(ended)), 'a declared window stayed on the list past its end');
  await attest(ended, false);
  assert.equal(Number((await order(ended)).state), OrderState.WINDOW, 'a refusal applied past the end of the window');
  await pass();
  assert.equal(Number((await order(ended)).state), OrderState.CLOSED, 'the keeper did not close the window');
  assert.ok(!store.rows('bridge_v2_order_notices').some((n) => String(n.order_id) === String(ended) && n.kind === 'WINDOW_REFUSED'));
});

await test(['P6-13', 'AA-Q7'], 'P6-13 on the fork, against the escrow of 5d85a46: the delivery code runs end to end — the buyer’s page makes the code and keeps it on the device, pays with its commitment; the store types it as a person would (lower case, spaces, O for 0) and the page turns it into the contract’s bytes32; a wrong code is refused by the bridge, the right one proves the delivery on-chain', async () => {
  const { generateDeliveryCode, keepCode, codeFor, normalizeDeliveryCode, codeToBytes32 } = await import('../../../lib/keptra/deliveryCode.ts');
  const offer = await relayAs(shop, { kind: 'createOffer', terms: { ...TERMS, mode: 1 } });
  const termsId = offer.created.termsId;
  assert.ok(termsId !== null);
  // The buyer's device: the code is made there and kept there, under the commitment the order carries.
  const device = new Map();
  const deviceStore = { getItem: (k) => device.get(k) ?? null, setItem: (k, v) => device.set(k, v) };
  const code = generateDeliveryCode();
  const commitment = keepCode(deviceStore, code);
  await orders.registerAddress('buyer-1', { termsId }, ADDRESS);
  const paidOrder = await relayAs(buyer, { kind: 'pay', termsId, quantity: 1, codeCommit: commitment });
  const orderId = paidOrder.orderId;
  assert.equal((await order(orderId)).codeCommit, commitment);
  assert.equal(codeFor(deviceStore, (await order(orderId)).codeCommit), code, 'the device does not find the code by the order’s commitment');
  await relayAs(shop, { kind: 'ship', orderId });
  // A wrong code: refused before anything is signed.
  const wrong = generateDeliveryCode();
  await assert.rejects(relay.prepareAction(shop.id, { kind: 'submitCode', orderId, code: codeToBytes32(wrong) }, null), (error) => error.reason === 'code');
  // What the store typed at the door, as the page reads it.
  const typed = `${code.slice(0, 5).toLowerCase()} ${code.slice(5, 10)}-${code.slice(10)}`.replace(/0/g, 'O');
  const normal = normalizeDeliveryCode(typed);
  assert.equal(normal, code);
  await relayAs(shop, { kind: 'submitCode', orderId, code: codeToBytes32(normal) });
  const proved = await order(orderId);
  assert.equal(Number(proved.state), OrderState.WINDOW);
  assert.ok((Number(proved.flags) & OrderFlag.PROOF) !== 0, 'the escrow does not show the delivery proved by the code');
});

// ===========================================================================
// Adenda AB, on the fork
// ===========================================================================

const offersOf = async (participantId) => {
  asSession(participantId);
  const response = await offersRoute.POST(request(route('store/offers'), { cookie: SESSION_COOKIE, body: {} }));
  return { status: response.status, body: await response.json() };
};

await test(['AB4', 'AA-Q7'], 'AB4 on the fork, against the escrow and the guarantee of 5d85a46: the terms and obligations are read from the chain — an id past the last terms reverts and ends the read — so an offer whose record the relay lost is listed by the store’s console from the chain, and the orders pass writes every offer and obligation down, each with its store or brand, and moves past them', async () => {
  const { termsCreatedSince } = await import('../../../lib/bridge-v2/escrowChain.ts');
  const offer = await relayAs(shop, { kind: 'createOffer', terms: TERMS });
  const termsId = offer.created.termsId;
  assert.ok(termsId !== null);
  // The relay's record of it is lost (its write failed), and the pass has not run since.
  const rows = store.rows('bridge_v2_store_terms');
  rows.splice(rows.findIndex((r) => String(r.terms_id) === String(termsId)), 1);
  const listed = await offersOf('store-1');
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(listed.body.offers.some((o) => o.termsId === String(termsId) && o.obligationId === null), 'the console did not list the offer the chain holds');
  // The real reads: every terms from id 1, the last one the one just created; a page smaller than that says there is more.
  const all = await termsCreatedSince(1n, 1n, 50);
  assert.equal(all.more, false);
  assert.equal(all.nextTerms, termsId + 1n, 'the read did not stop at the first id the escrow does not hold');
  assert.deepEqual(all.offers.find((o) => o.termsId === termsId).store.toLowerCase(), shop.creator.safe.toLowerCase());
  const obligations = await client.readContract({ address: GUARANTEE, abi: parseAbi(['function obligationCount() view returns (uint256)']), functionName: 'obligationCount' });
  assert.equal(all.nextObligation, obligations);
  assert.ok(all.obligations.length >= 2 && all.obligations.every((o) => o.brand.toLowerCase() === shop.creator.safe.toLowerCase()));
  const small = await termsCreatedSince(1n, 1n, 1);
  assert.deepEqual([small.more, small.nextTerms, small.offers.length + small.obligations.length > 0], [true, 2n, true]);
  // The pass writes it down from the chain and moves the cursor past everything.
  await pass();
  assert.ok(store.rows('bridge_v2_store_terms').some((r) => String(r.terms_id) === String(termsId) && r.store_address.toLowerCase() === shop.creator.safe.toLowerCase()));
  for (const ob of all.obligations) {
    const row = store.rows('bridge_v2_store_terms').find((r) => String(r.terms_id) === String(ob.termsId));
    assert.equal(String(row?.obligation_id), String(ob.obligationId), `obligation ${ob.obligationId} not written with its terms`);
  }
  assert.deepEqual(store.rows('bridge_v2_store_terms_cursor').map((r) => [r.name, String(r.next_id)]).sort(), [['obligations', String(obligations)], ['terms', String(termsId + 1n)]]);
  assert.ok((await offersOf('store-1')).body.offers.some((o) => o.termsId === String(termsId)));
});

await test(['AB6'], 'AB6 on the fork, with Arbitrum One’s USDC: a draft whose deposit address’s balance went below its baseline after it was made keeps its real deposit — the Transfer the log holds since the draft’s block — and a draft with no transfer into its address expires', async () => {
  const drafts = await import('../../../lib/bridge-v2/creatorCampaigns.ts');
  const { blockNumber, transferInto } = await import('../../../lib/bridge-v2/chain.ts');
  const [funded, empty, payer] = [fresh(), fresh(), fresh()];
  await rpc.setBalance(payer, 10n ** 18n);
  // Both addresses held 5 USDC when the draft was made (the baseline), and it went down to nothing after.
  for (const holder of [funded, empty]) await setUsdcBalance(rpc, USDC, holder, 5_000_000n);
  const from = await blockNumber();
  for (const holder of [funded, empty]) await setUsdcBalance(rpc, USDC, holder, 0n);
  // A real deposit of 2 USDC into the first: below the baseline.
  await setUsdcBalance(rpc, USDC, payer, 2_000_000n);
  await rpc.impersonate(payer);
  await as(payer, USDC, encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [funded, 2_000_000n] }));
  assert.equal(await usdcOf(funded), 2_000_000n);
  const tip = await blockNumber();
  const hit = await transferInto(USDC, funded, from, tip, () => true);
  assert.equal(hit.found, true, 'the deposit in the log was not found');
  assert.ok(hit.searchedTo <= tip);
  assert.equal((await transferInto(USDC, empty, from, tip, () => true)).found, false);
  assert.equal((await transferInto(USDC, funded, tip + 1n, tip + 1n, () => true)).found, false, 'a transfer before the range was found');
  const old = new Date(Date.now() - 8 * DAY * 1000).toISOString();
  const draft = (holder, i) => {
    const creatorRow = store.insert('bridge_v2_creators', { participant_id: `ab6-${i}`, wallet_index: null, wallet_address: holder });
    return store.insert('bridge_v2_creator_campaigns', {
      creator_id: creatorRow.id, status: 'PENDING_DEPOSIT', module: ERC721_PRIZE_MODULE, prize_token: USDC, prize_amount: '10000000', duration_seconds: '3600',
      winners_count: 1, slot_cap: 10, fee_amount: '1000000', slots_cost: '1000000', giveaway_id: null, tx_hash: null, created_at: old, updated_at: old,
      deposit_baseline_prize: '5000000', deposit_baseline_usdc: '5000000', deposit_from_block: String(from), creator: { wallet_address: holder },
    });
  };
  const kept = draft(funded, 1);
  const gone = draft(empty, 2);
  await drafts.expireUnfundedDrafts(log, deadline());
  assert.deepEqual([kept.status, gone.status], ['PENDING_DEPOSIT', 'EXPIRED']);
});

await test(['AB7', 'AA-Q7'], 'AB7 on the fork, against the escrow of 5d85a46: after the guardian key is rotated (B6), an account still holding the old key — with a change of access the old key started — keeps publishing offers with its passkey, and configure reconfigures it by R-3 in one transaction: the change cancelled, the nonce invalidated, the old key revoked, the new one added; it keeps working after', async () => {
  const { signRecoveryHash } = await import('../../../lib/bridge-v2/guardian.ts');
  const MODULE = parseAbi(['function isGuardian(address,address) view returns (bool)', 'function guardiansCount(address) view returns (uint256)', 'function nonce(address) view returns (uint256)']);
  const brand = await registerParticipant('rotated-1', 'phone-rotated');
  await as(owner, ESCROW, call('setStore', [brand.creator.safe, true]));
  await relayAs(brand, { kind: 'configure' }, 'CREATOR');
  const safe = brand.creator.safe;
  const OLD = guardianAddress();
  // The old key starts a change of access (as a compromised key would).
  const rogue = privateKeyToAccount(generatePrivateKey()).address;
  const sent = await relay.sendAsRelayer([kchain.confirmRecoveryCall(safe, [rogue], OLD, await signRecoveryHash(await kchain.recoveryHash(safe, [rogue])))], log);
  assert.equal(sent.receipt.status, 'success');
  assert.notEqual((await kchain.accountState(safe)).recoveryExecuteAfter, 0n);
  const nonceBefore = await client.readContract({ address: keptra.RECOVERY_MODULE, abi: MODULE, functionName: 'nonce', args: [safe] });
  const previous = process.env.BRIDGE_V2_GUARDIAN_KEY;
  process.env.BRIDGE_V2_GUARDIAN_KEY = generatePrivateKey();
  try {
    const NEW = guardianAddress();
    const terms = { ...TERMS, payout: safe };
    // Its owner keeps using it.
    const first = await relayAs(brand, { kind: 'createOffer', terms }, 'CREATOR');
    assert.ok(first.created.termsId !== null);
    // Reconfigured by R-3, in one transaction signed by the passkey.
    const reconfigured = await relayAs(brand, { kind: 'configure' }, 'CREATOR');
    const events = parseEventLogs({ abi: parseAbi(['event RecoveryCanceled(address indexed wallet, uint256 nonce)', 'event NonceInvalidated(address indexed wallet, uint256 nonce)']), logs: reconfigured.receipt.logs }).map((e) => e.eventName);
    assert.ok(events.includes('RecoveryCanceled') && events.includes('NonceInvalidated'), `events were ${events}`);
    const state = await kchain.accountState(safe);
    assert.equal(state.recoveryExecuteAfter, 0n, 'the change of access the old key started is still pending');
    assert.deepEqual(state.guardians.map((g) => g.toLowerCase()), [NEW.toLowerCase()]);
    assert.equal(await client.readContract({ address: keptra.RECOVERY_MODULE, abi: MODULE, functionName: 'isGuardian', args: [safe, OLD] }), false);
    assert.ok((await client.readContract({ address: keptra.RECOVERY_MODULE, abi: MODULE, functionName: 'nonce', args: [safe] })) > nonceBefore);
    assert.equal(kchain.configurationRefusal(state, NEW, [brand.signer]), null, 'the account is not an account of 6.1 with the new key');
    assert.equal(store.rows('bridge_v2_accounts').find((a) => a.id === brand.creator.id).guardian_address.toLowerCase(), NEW.toLowerCase());
    // And it keeps working after.
    const second = await relayAs(brand, { kind: 'createOffer', terms }, 'CREATOR');
    assert.equal(second.created.termsId, first.created.termsId + 1n);
    await assert.rejects(relay.prepareAction(brand.id, { kind: 'configure' }, 'CREATOR'), (error) => error.reason === 'already_configured');
  } finally {
    process.env.BRIDGE_V2_GUARDIAN_KEY = previous;
  }
});
