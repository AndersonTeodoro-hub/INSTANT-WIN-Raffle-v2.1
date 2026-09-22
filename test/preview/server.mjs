/**
 * The local preview of the Keptra screens (SPEC-BLOCO-03 T8, T20, T21). NOT part of
 * the build or the deploy.
 *
 *   ANVIL_BIN=<anvil.exe> node --experimental-strip-types --import ./test/bridge-v2/fork/register.mjs test/preview/server.mjs
 *
 * T20: nothing here talks to production. The chain is an anvil fork of Arbitrum One
 * on 127.0.0.1 (the fork harness's own M44 check), with the contracts of 183a2b4
 * deployed on it from their creation code; the database is the suites' in-memory
 * tables; the bridge's routes run in this process; mail and Telegram are doubled.
 *
 * It seeds what the screenshots show — a store with a published offer, a buyer
 * with an order paid and one in its contest window, a brand's obligation with its
 * vouchers, the pool's provider — through the real relay, signed by software
 * passkeys, and writes the addresses the page must read into PREVIEW_GEN_DIR for
 * test/preview/vite.config.mjs. Then it serves /api/bridge/v2/* and three preview
 * routes:
 * - /__preview/login?as=buyer|store|none picks whose session the next requests
 *   carry (the routes' own resolveSession, doubled as the suites do);
 * - /__preview/sign {hash} signs with that person's software passkey — the page's
 *   passkeys are keptra.io's, so on localhost the preview's webauthn.ts asks here
 *   (SPEC-BLOCO-03 V1: the store's flow runs to its end in a real browser);
 * - /__preview/fail?route=<path>&on=1|0 makes one bridge route answer 503, to see
 *   a read that fails (V3).
 * The orders pass runs every 15 s, as the cron does every minute, so what the
 * chain did shows in the bridge's lists.
 */

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createPublicClient, encodeAbiParameters, encodeFunctionData, getAddress, http as viemHttp, parseAbi } from 'viem';
import { arbitrum } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { http, installEnv, installFetchDouble, jsonResponse, realFetch, recordingLogger, TEST_KEEPER_KEY, TEST_ROLE_KEY } from '../bridge-v2/harness.mjs';
import { rpcClient, setUsdcBalance, startFork } from '../bridge-v2/fork/anvil.mjs';

installEnv();
installFetchDouble();
const bin = process.env.ANVIL_BIN;
if (!bin) throw new Error('ANVIL_BIN is not set');
const { DEFAULT_RPC_URL, USDC, GIVEAWAY_MANAGER_V2, ERC721_PRIZE_MODULE } = await import('../../lib/bridge-v2/config.ts');
const fork = await startFork({ bin, upstream: process.env.ARBITRUM_RPC_URL ?? DEFAULT_RPC_URL, fetchImpl: realFetch });
process.env.ARBITRUM_RPC_URL = fork.url;
http.on('127.0.0.1', (url, init) => {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  if (body?.method === 'eth_maxPriorityFeePerGas') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: '0x0' });
  return realFetch(url, init);
});
http.on('api.resend.com', () => jsonResponse({ id: 'preview-mail' }));
http.on('api.telegram.org', () => jsonResponse({ ok: true, result: {} }));
http.on('api.ship24.com', () => jsonResponse({ data: { tracker: { trackerId: 'preview-tracker-0001' } } }, 201));

const db = await import('../bridge-v2/doubles/db.mjs');
const { setKeptraContracts } = await import('../bridge-v2/doubles/config.mjs');
const { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } = await import('../bridge-v2/memdb.mjs');
const { createPasskey } = await import('../bridge-v2/passkey.mjs');
const kchain = await import('../../lib/bridge-v2/keptraChain.ts');
const relay = await import('../../lib/bridge-v2/relay.ts');
const accounts = await import('../../lib/bridge-v2/accounts.ts');
const orders = await import('../../lib/bridge-v2/orders.ts');
const descriptions = await import('../../lib/bridge-v2/descriptions.ts');
const { advanceOrders } = await import('../../lib/bridge-v2/keptraOrders.ts');
const { guardianAddress } = await import('../../lib/bridge-v2/guardian.ts');
const { funderAddress } = await import('../../lib/bridge-v2/funders.ts');
const { runDeadline } = await import('../../lib/bridge-v2/runlock.ts');
const { readFileSync } = await import('node:fs');

const rpc = rpcClient(fork.url, realFetch);
const client = createPublicClient({ chain: arbitrum, transport: viemHttp(fork.url, { timeout: 60_000 }) });
const log = recordingLogger();

// --- the database, in memory ---------------------------------------------------------------
db.reset();
const store = memdb(db, KEPTRA_TABLES, KEPTRA_UNIQUE);
db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
db.on('rpc:bridge_v2_acquire_funder', () => ({ data: [{ funder_index: 0, address: funderAddress(0), next_nonce: 0, lease_token: '00000000-0000-0000-0000-000000000001' }], error: null }));
for (const name of ['reconcile_funder_nonce', 'renew_funder_lease', 'release_funder', 'disable_funder']) db.on(`rpc:bridge_v2_${name}`, () => ({ data: true, error: null }));
db.on('rpc:bridge_v2_try_lock', () => ({ data: 'preview-lock', error: null }));
db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
let who = null;
db.on('bridge_v2_sessions:select', () => ({
  data: who === null ? null : { id: `s-${who}`, participant_id: who, idle_expires_at: new Date(Date.now() + 3_600_000).toISOString(), absolute_expires_at: new Date(Date.now() + 7_200_000).toISOString(), revoked_at: null },
  error: null,
}));

// --- pieces 2 and 3, from the audited creation code (as orders.fork.mjs) -------------------
const FIXTURE = JSON.parse(readFileSync(new URL('../bridge-v2/fork/keptra-183a2b4.json', import.meta.url), 'utf8'));
const ABI = parseAbi([
  'function approve(address,uint256) returns (bool)', 'function deposit(uint256,address) returns (uint256)', 'function setGuarantee(address)',
  'function setSource(address,bool)', 'function setDefaultSource(address)', 'function setProvider(address,bool)', 'function setStore(address,bool)',
  'function reputation() view returns (address)', 'function voucher() view returns (address)',
]);
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const [owner, oracle, platform, provider, arbiter] = [fresh(), fresh(), fresh(), fresh(), fresh()];
const roleAddress = privateKeyToAccount(TEST_ROLE_KEY).address;
const keeperAddress = privateKeyToAccount(TEST_KEEPER_KEY).address;
for (const address of [owner, oracle, platform, provider, arbiter, roleAddress, keeperAddress, funderAddress(0)]) await rpc.setBalance(address, 10n ** 18n);
for (const address of [owner, provider]) await rpc.impersonate(address);
const deploy = async (name, types, values) => {
  const data = `${FIXTURE.contracts[name].creationCode}${encodeAbiParameters(types, values).slice(2)}`;
  const receipt = await rpc.waitMined(await rpc.call('eth_sendTransaction', [{ from: owner, data, gas: '0x' + (25_000_000).toString(16) }]));
  if (receipt.status !== '0x1') throw new Error(`${name} did not deploy`);
  return getAddress(receipt.contractAddress);
};
const as = async (from, to, functionName, args) => {
  const receipt = await rpc.send({ from, to, data: encodeFunctionData({ abi: ABI, functionName, args }), gas: 6_000_000n });
  if (receipt.status !== '0x1') throw new Error(`${functionName} reverted`);
};
const address6 = Array.from({ length: 6 }, () => ({ type: 'address' }));
const ESCROW = await deploy('KeptraEscrow', address6, [owner, USDC, oracle, arbiter, roleAddress, platform]);
const REPUTATION = await client.readContract({ address: ESCROW, abi: ABI, functionName: 'reputation' });
const GUARANTEE = await deploy('KeptraGuarantee', Array.from({ length: 5 }, () => ({ type: 'address' })), [ESCROW, USDC, GIVEAWAY_MANAGER_V2, ERC721_PRIZE_MODULE, REPUTATION]);
await as(owner, ESCROW, 'setGuarantee', [GUARANTEE]);
const POOL = await deploy('KeptraPool', [{ type: 'address' }, { type: 'address' }], [USDC, GUARANTEE]);
await as(owner, GUARANTEE, 'setSource', [POOL, true]);
await as(owner, GUARANTEE, 'setDefaultSource', [POOL]);
await as(owner, POOL, 'setProvider', [provider, true]);
await setUsdcBalance(rpc, USDC, provider, 5_000_000_000n);
await as(provider, USDC, 'approve', [POOL, 5_000_000_000n]);
await as(provider, POOL, 'deposit', [5_000_000_000n, provider]);
const VOUCHER = getAddress(await client.readContract({ address: GUARANTEE, abi: ABI, functionName: 'voucher' }));
setKeptraContracts({ escrow: ESCROW, guarantee: GUARANTEE, voucher: VOUCHER });

// --- people, with software passkeys, acting through the real relay ------------------------
async function person(id, email, phone) {
  const passkey = await createPasskey();
  store.insert('bridge_v2_participants', { id, email_canonical: email, wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  store.insert('bridge_v2_phones', { participant_id: id, phone_hmac: phone, released_at: null });
  const signer = await kchain.signerAddressOf(passkey.x, passkey.y);
  await accounts.registerPasskey(id, passkey.credentialId, passkey.x, passkey.y, signer);
  const list = await accounts.ensureAccounts(id, signer, guardianAddress());
  return { id, passkey, participant: list.find((a) => a.role === 'PARTICIPANT'), creator: list.find((a) => a.role === 'CREATOR') };
}
async function act(p, action, role = null) {
  const prepared = await relay.prepareAction(p.id, action, role);
  const echoed = prepared.redeemDeadline === null ? action : { ...action, deadline: prepared.redeemDeadline };
  const submitted = await relay.submitAction(p.id, echoed, role, prepared.tx.nonce, await p.passkey.sign(prepared.hash), log);
  if (submitted.receipt?.status !== 'success') throw new Error(`${action.kind} did not succeed`);
  return submitted;
}
const ADDRESS = { name: 'Ana Silva', street: 'Rua das Flores 12', postCode: '1000-001', city: 'Lisboa', country: 'PT', phone: null };

const buyer = await person('buyer-1', 'ana@example.test', 'phone-buyer');
const shop = await person('store-1', 'orders@lumen-studio.example', 'phone-store');
await as(owner, ESCROW, 'setStore', [shop.creator.safe, true]);
await act(buyer, { kind: 'configure' });
await act(shop, { kind: 'configure' }, 'CREATOR');
await setUsdcBalance(rpc, USDC, buyer.participant.safe, 480_000_000n);
await setUsdcBalance(rpc, USDC, shop.creator.safe, 900_000_000n);

const offer = (price, shipping, mode) => ({ kind: 'createOffer', terms: { payout: shop.creator.safe, price, shipping, returnCost: shipping < 3_000_000n ? shipping : 3_000_000n, refusalFeeBps: 500, shipDays: 3, deliveryDays: 7, mode, regions: orders.encodeRegions(['PT', 'ES', 'FR', 'DE']) } });
const first = await act(shop, offer(129_000_000n, 6_500_000n, 0), 'CREATOR');
const termsId = first.created.termsId;
await descriptions.writeDescription({ termsId, store: shop.creator.safe, obligationId: null, title: 'Lumen desk lamp — brushed brass', text: 'A brushed-brass desk lamp with a dimmable warm LED (2700 K), a weighted base and a 1.8 m braided cable.\nShips assembled, in recyclable packaging. Two-year maker’s warranty.' });
const second = await act(shop, offer(49_000_000n, 0n, 1), 'CREATOR');
await descriptions.writeDescription({ termsId: second.created.termsId, store: shop.creator.safe, obligationId: null, title: 'Linen table runner, hand-hemmed', text: 'Stone-washed European linen, 40 × 180 cm. Delivered by our studio in Lisbon.' });

await orders.registerAddress('buyer-1', { termsId }, ADDRESS);
const paidOrder = await act(buyer, { kind: 'pay', termsId, quantity: 1, codeCommit: `0x${'0'.repeat(64)}` });
await orders.registerAddress('buyer-1', { termsId }, ADDRESS);
const shipped = await act(buyer, { kind: 'pay', termsId, quantity: 2, codeCommit: `0x${'0'.repeat(64)}` });
await orders.registerShipment(shipped.orderId, `0x${'ab'.repeat(32)}`, 'CTT1234567890PT');
await act(shop, { kind: 'ship', orderId: shipped.orderId }, 'CREATOR');
await act(shop, { kind: 'declareDelivered', orderId: shipped.orderId }, 'CREATOR');

const obligation = await act(shop, { kind: 'createObligation', terms: { payout: '0x0000000000000000000000000000000000000001', price: 180_000_000n, shipping: 10_000_000n, returnCost: 0n, refusalFeeBps: 0, shipDays: 5, deliveryDays: 10, mode: 0, regions: orders.encodeRegions(['PT', 'ES']) }, units: 2 }, 'CREATOR');
await descriptions.writeDescription({ termsId: obligation.created.termsId, store: shop.creator.safe, obligationId: obligation.created.obligationId, title: 'Lumen floor lamp — prize edition', text: 'The Lumen floor lamp in brushed brass, 160 cm, with a dimmable warm LED. Won in the Lumen Studio autumn draw.' });

await advanceOrders(log, runDeadline());
console.log(`[preview] orders ${paidOrder.orderId}, ${shipped.orderId}; offers ${termsId}, ${second.created.termsId}; obligation ${obligation.created.obligationId}`);

// --- what the page reads: the addresses and the fork's endpoint ---------------------------
const gen = process.env.PREVIEW_GEN_DIR;
if (!gen) throw new Error('PREVIEW_GEN_DIR is not set');
mkdirSync(gen, { recursive: true });
const real = readFileSync(new URL('../../lib/keptra/contracts.ts', import.meta.url), 'utf8');
const zero = "'0x0000000000000000000000000000000000000000'";
writeFileSync(`${gen}/contracts.ts`, real
  .replace(`KEPTRA_ESCROW: \`0x\${string}\` = ${zero}`, `KEPTRA_ESCROW: \`0x\${string}\` = '${ESCROW}'`)
  .replace(`KEPTRA_GUARANTEE: \`0x\${string}\` = ${zero}`, `KEPTRA_GUARANTEE: \`0x\${string}\` = '${GUARANTEE}'`)
  .replace(`KEPTRA_VOUCHER: \`0x\${string}\` = ${zero}`, `KEPTRA_VOUCHER: \`0x\${string}\` = '${VOUCHER}'`)
  .replace("from '../bridge-v2/abi.js'", `from '${new URL('../../lib/bridge-v2/abi.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')}'`));
writeFileSync(`${gen}/rpc.ts`, `export const ARBITRUM_RPC_URL = '${fork.url}';\n`);
writeFileSync(`${gen}/seed.json`, JSON.stringify({ termsId: String(termsId), ownMeansTermsId: String(second.created.termsId), paidOrder: String(paidOrder.orderId), windowOrder: String(shipped.orderId), obligationId: String(obligation.created.obligationId) }));

// --- the bridge, in this process -----------------------------------------------------------
const ROUTES = {};
for (const path of ['account/status', 'account/vouchers', 'account/register', 'account/relay', 'account/migrate', 'order/address', 'order/list', 'order/evidence', 'store/orders', 'store/tracking', 'store/offers', 'store/description', 'offer/description', 'privacy/erase', 'privacy/export', 'session/request-code', 'session/verify', 'session/revoke', 'entry/status', 'entry/start', 'campaign/identity/read']) {
  ROUTES[path] = await import(`../../api/bridge/v2/${path}.ts`);
}
const PEOPLE = { buyer: 'buyer-1', store: 'store-1', none: null };
const PASSKEYS = { 'buyer-1': buyer.passkey, 'store-1': shop.passkey };
const failing = new Set();
let passing = false;
setInterval(async () => {
  if (passing) return;
  passing = true;
  try {
    await advanceOrders(log, runDeadline());
  } catch (error) {
    console.log(`[preview] orders pass: ${error.message}`);
  } finally {
    passing = false;
  }
}, 15_000);
const port = Number(process.env.PREVIEW_API_PORT ?? 8787);
createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/__preview/login') {
    who = PEOPLE[url.searchParams.get('as') ?? 'none'] ?? null;
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`session: ${who ?? 'none'}`);
    return;
  }
  if (url.pathname === '/__preview/fail') {
    const name = url.searchParams.get('route') ?? '';
    if (url.searchParams.get('on') === '1') failing.add(name);
    else failing.delete(name);
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`failing: ${[...failing].join(', ') || 'none'}`);
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (url.pathname === '/__preview/sign') {
    const passkey = who === null ? undefined : PASSKEYS[who];
    if (!passkey) return res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no session' }));
    const { hash } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await passkey.sign(hash)));
    return;
  }
  const name = url.pathname.replace('/api/bridge/v2/', '');
  const route = ROUTES[name];
  if (!route || req.method !== 'POST') return res.writeHead(404).end();
  if (failing.has(name)) return res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'The service is unavailable right now. Try again shortly.' }));
  const response = await route.POST(new Request(`http://127.0.0.1${url.pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', 'user-agent': 'preview', cookie: 'iw_bridge_session=preview' }, body: Buffer.concat(chunks) }));
  res.writeHead(response.status, { 'content-type': 'application/json' }).end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`[preview] bridge on http://127.0.0.1:${port}, fork ${fork.url}`));
