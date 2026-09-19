/**
 * SPEC-BLOCO-03 piece 1, on-chain: the requirements of MATRIZ-PECA1-KEPTRA that
 * say "Fork", run against the real contracts of Arbitrum One on a local anvil
 * fork. Nothing here is a mock of a contract: the Safe singleton, the proxy
 * factory, MultiSendCallOnly, the fallback handler, the passkey signer factory,
 * the Candide recovery module, GiveawayManagerV2, its ERC-20 prize module, USDC
 * and the VRF coordinator are the deployed ones, read through the fork.
 *
 * The bridge code is the real code too — keptra.ts, keptraChain.ts, relay.ts,
 * recovery.ts, migration.ts, chain.ts, funders.ts, wallet.ts — with only the
 * database doubled (fork/loader.mjs), as tables in memory (../memdb.mjs).
 *
 * The one thing the fork is asked to pretend is the other side of what the
 * bridge does not own: the bridge role publishing a root and the VRF coordinator
 * delivering a seed are impersonated, as M25 says.
 *
 * Tags are KMn, for Mn of the matrix (the SPEC-BRIDGE-V2 map already has M1..M8).
 */

import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  http as viemHttp,
  keccak256,
  pad,
  parseAbi,
  parseEventLogs,
  toHex,
  zeroAddress,
} from 'viem';
import { arbitrum } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { assert, deadline, recordingLogger, request, suite, test, TEST_FUNDER_KEYS, TEST_GUARDIAN_KEY, TEST_KEEPER_KEY, TEST_MNEMONIC, TEST_ROLE_KEY, realFetch } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } from '../memdb.mjs';
import { createPasskey } from '../passkey.mjs';
import { callsOf } from '../safecalls.mjs';
import { assertLocalFork, rpcClient, setUsdcBalance } from './anvil.mjs';
import * as keptra from '../../../lib/bridge-v2/keptra.ts';
import * as kchain from '../../../lib/bridge-v2/keptraChain.ts';
import * as relay from '../../../lib/bridge-v2/relay.ts';
import * as accounts from '../../../lib/bridge-v2/accounts.ts';
import * as recovery from '../../../lib/bridge-v2/recovery.ts';
import * as migration from '../../../lib/bridge-v2/migration.ts';
import * as wallet from '../../../lib/bridge-v2/wallet.ts';
import { guardianAddress } from '../../../lib/bridge-v2/guardian.ts';
import { funderAddress } from '../../../lib/bridge-v2/funders.ts';
import { buildTree, proofFor } from '../../../lib/bridge-v2/merkle.ts';
import { GIVEAWAY_MANAGER_V2, USDC } from '../../../lib/bridge-v2/config.ts';
import { GIVEAWAY_MANAGER_V2_ABI } from '../../../lib/bridge-v2/abi.ts';
import { runDeadline } from '../../../lib/bridge-v2/runlock.ts';
import { expireUnfundedDrafts } from '../../../lib/bridge-v2/creatorCampaigns.ts';
import * as registerRoute from '../../../api/bridge/v2/account/register.ts';

suite('fork');

const url = process.env.ARBITRUM_RPC_URL;
const rpc = rpcClient(url, realFetch);
const client = createPublicClient({ chain: arbitrum, transport: viemHttp(url, { timeout: 60_000 }) });
const log = recordingLogger();

const ERC20_PRIZE_MODULE = '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b';
const NPM = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';

const ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function balanceOf(address,uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function tokenByIndex(uint256) view returns (uint256)',
  'function safeTransferFrom(address,address,uint256)',
  'function safeTransferFrom(address,address,uint256,uint256,bytes)',
  'function transfer(address,uint256) returns (bool)',
  'function bridge() view returns (address)',
  'function vrfCoordinator() view returns (address)',
  'function currentFee(uint8,uint256) view returns (uint256)',
  'function pricePerSlot() view returns (uint256)',
  'function closeGiveaway(uint256)',
  'function requestDraw(uint256)',
  'function rawFulfillRandomWords(uint256,uint256[])',
  'function finalizeWinners(uint256)',
  'function addEligibilityRoot(uint256,bytes32)',
  'function enter(uint256,uint256,bytes32[])',
  'function execTransactionFromModule(address,uint256,bytes,uint8) returns (bool)',
  'function confirmRecovery(address,address[],uint256,bool)',
  'function approve(address,uint256) returns (bool)',
  'function createGiveaway(address,bytes,uint256,uint256,uint256,uint32,uint32) returns (uint256)',
  'function isModuleRegistered(address) view returns (bool)',
  'function itemsOf(uint256) view returns (uint256[])',
  'function claimable(uint256,address) view returns (uint256)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  // Adenda E9: read by these tests only, so declared here and not in keptra.ts.
  'function VERSION() view returns (string)',
  'function isModuleEnabled(address) view returns (bool)',
  'function setApprovalForAll(address,bool)',
  'function lotsOf(uint256) view returns ((uint256,uint256,uint256)[])',
  'function proxyCreationCode() pure returns (bytes)',
  'function isGuardian(address,address) view returns (bool)',
  'function guardiansCount(address) view returns (uint256)',
  'event Created(address indexed signer, uint256 x, uint256 y, uint176 verifiers)',
  'event RecoveryCanceled(address indexed wallet, uint256 nonce)',
  'event NonceInvalidated(address indexed wallet, uint256 nonce)',
]);

const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
const usdcOf = (holder) => read(USDC, ABI, 'balanceOf', [holder]);
const tick = () => deadline();
/**
 * Where the tests send what leaves an account, and who else enters: fresh
 * addresses, generated now. Well-known test keys are not used on a fork of a
 * live chain — some of their addresses carry code there (EIP-7702 delegations),
 * and a safeTransferFrom to one of them reverts for reasons that are not ours.
 */
const destination = privateKeyToAccount(generatePrivateKey()).address;

// ---------------------------------------------------------------------------
// the database, in memory, and the funder pool as the relayer (A15)
// ---------------------------------------------------------------------------

db.reset();
const store = memdb(db, KEPTRA_TABLES, KEPTRA_UNIQUE);
db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
db.on('rpc:bridge_v2_acquire_funder', () => ({
  data: [{ funder_index: 0, address: funderAddress(0), next_nonce: 0, lease_token: '00000000-0000-0000-0000-000000000001' }],
  error: null,
}));
for (const name of ['reconcile_funder_nonce', 'renew_funder_lease', 'release_funder', 'disable_funder']) {
  db.on(`rpc:bridge_v2_${name}`, () => ({ data: true, error: null }));
}
// Run locks (the migration of a creator's wallet takes the creator's, Adenda F2): always free here.
db.on('rpc:bridge_v2_try_lock', () => ({ data: 'fork-lock-holder', error: null }));
db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
for (let index = 0; index < TEST_FUNDER_KEYS.length; index += 1) {
  await rpc.setBalance(funderAddress(index), 10n ** 18n);
}

async function registerParticipant(id, passkey) {
  store.insert('bridge_v2_participants', { id, email_canonical: `${id}@example.test`, wallet_index: null, wallet_address: null });
  const signer = await kchain.signerAddressOf(passkey.x, passkey.y);
  const registered = await accounts.registerPasskey(id, passkey.credentialId, passkey.x, passkey.y, signer);
  const list = await accounts.ensureAccounts(id, signer, guardianAddress());
  return { signer, passkey: registered, participant: list.find((a) => a.role === 'PARTICIPANT'), creator: list.find((a) => a.role === 'CREATOR') };
}

/** The whole relay, as a page would drive it: prepare, sign with the passkey, submit. */
async function relayAs(participantId, passkey, action, role = null) {
  const prepared = await relay.prepareAction(participantId, action, role);
  const assertion = await passkey.sign(prepared.hash);
  return relay.submitAction(participantId, action, role, prepared.tx.nonce, assertion, log);
}

/** A Safe transaction the account signs and the relayer sends, below the action list. */
async function execAs(account, passkey, signer, calls) {
  const state = await kchain.accountState(account.safe);
  const tx = keptra.safeTxFor(calls, state.nonce);
  // The relay's closed list admits it: a call to a token, never to the account or the module.
  assert.equal(keptra.refusalFor(account.safe, calls, state.nonce, null, guardianAddress()), null);
  const hash = keptra.safeTxHash(account.safe, tx);
  const assertion = await passkey.sign(hash);
  const signature = keptra.assertionToSignature(hash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  const batch = [];
  if (!(await kchain.hasCode(signer))) batch.push(keptra.createSignerCall(passkey.x, passkey.y));
  batch.push({ to: account.safe, data: keptra.execTransactionData(tx, keptra.encodeSafeSignature(signer, signature)) });
  return relay.sendAsRelayer(batch, log);
}

/** Creates an account with only its configuration, for the subjects of the recovery tests. */
async function deployOnly(account, passkey, signer) {
  const tx = keptra.safeTxFor(keptra.configurationCalls(account.safe, account.guardian), 0n);
  const hash = keptra.safeTxHash(account.safe, tx);
  const assertion = await passkey.sign(hash);
  const signature = keptra.assertionToSignature(hash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  const sent = await relay.sendAsRelayer(
    [
      keptra.createSignerCall(passkey.x, passkey.y),
      keptra.createAccountCall(account.initialSigner, account.role),
      { to: account.safe, data: keptra.execTransactionData(tx, keptra.encodeSafeSignature(signer, signature)) },
    ],
    log,
  );
  assert.equal(sent.receipt.status, 'success');
  await accounts.markDeployed(account.id);
  return sent;
}

/** An execTransaction signed by a plain ECDSA key, the way a server key would try it. */
async function execSignedByKey(safe, privateKey, calls) {
  const state = await kchain.accountState(safe);
  const tx = keptra.safeTxFor(calls, state.nonce);
  const hash = keptra.safeTxHash(safe, tx);
  const signature = await privateKeyToAccount(privateKey).sign({ hash });
  return keptra.execTransactionData(tx, signature);
}

// ===========================================================================
// M44 — the harness only talks to a local Arbitrum One fork
// ===========================================================================

await test(['KM44'], 'the on-chain harness refuses any node that is not 127.0.0.1 with chainId 42161', async () => {
  await assertLocalFork(url, realFetch);
  await assert.rejects(assertLocalFork(url.replace('127.0.0.1', 'localhost'), realFetch), /not 127\.0\.0\.1/);
  const mainnetShaped = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }));
  await assert.rejects(assertLocalFork('http://127.0.0.1:1', mainnetShaped), /refusing chain 1/);
});

// ===========================================================================
// 6.1.6 and 6.1.3 — addresses known before, and the verifiers
// ===========================================================================

await test(['KM8'], 'the proxy creation code the address is computed from is the factory’s own', async () => {
  const code = await read(keptra.SAFE_PROXY_FACTORY, ABI, 'proxyCreationCode');
  assert.equal(code.toLowerCase(), keptra.PROXY_CREATION_CODE.toLowerCase());
});

await test(['KM5'], 'a tampered passkey signature is not accepted by the signer code, a real one is', async () => {
  const passkey = await createPasskey();
  const challenge = keptra.migrationChallenge(zeroAddress, zeroAddress);
  const good = await passkey.sign(challenge);
  const parsed = keptra.assertionToSignature(challenge, good.authenticatorData, good.clientDataJSON, good.signature);
  assert.equal(await kchain.isValidPasskeySignature(challenge, parsed, passkey.x, passkey.y), true);
  assert.equal(await kchain.isValidPasskeySignature(challenge, { ...parsed, s: parsed.s ^ 1n }, passkey.x, passkey.y), false);
  // The signer requires user verification (UV) on-chain.
  const noUv = await passkey.sign(challenge, { flags: 0x01 });
  const parsedNoUv = keptra.assertionToSignature(challenge, noUv.authenticatorData, noUv.clientDataJSON, noUv.signature);
  assert.equal(await kchain.isValidPasskeySignature(challenge, parsedNoUv, passkey.x, passkey.y), false);
});

// ===========================================================================
// 6.5 — a creator account creates a campaign (M27, M28), and is created doing it
// ===========================================================================

const creatorKey = await createPasskey();
const creator = await registerParticipant('creator-1', creatorKey);
const PRIZE = 10_000_000n; // 10 USDC
const fee = await read(GIVEAWAY_MANAGER_V2, ABI, 'currentFee', [0, PRIZE]);
const slotsCost = 10n * (await read(GIVEAWAY_MANAGER_V2, ABI, 'pricePerSlot'));
const creatorRow = store.insert('bridge_v2_creators', { participant_id: 'creator-1', wallet_index: null, wallet_address: creator.creator.safe });
store.insert('bridge_v2_creator_campaigns', {
  creator_id: creatorRow.id,
  status: 'PENDING_DEPOSIT',
  module: ERC20_PRIZE_MODULE,
  prize_token: USDC,
  prize_amount: PRIZE.toString(),
  duration_seconds: '3600',
  winners_count: 10,
  slot_cap: 10,
  fee_amount: fee.toString(),
  slots_cost: slotsCost.toString(),
  giveaway_id: null,
  tx_hash: null,
});

let giveawayId = null;
let createReceipt = null;
let createTxHash = null;
const relayerBalanceBefore = await client.getBalance({ address: funderAddress(0) });

await test(['KM8'], 'the creator account’s address is written before it exists', async () => {
  assert.equal(await kchain.hasCode(creator.creator.safe), false, 'the account existed before its first action');
  assert.equal(creator.creator.safe, keptra.predictSafeAddress(creator.signer, 'CREATOR'));
});

await test(['KM27', 'KM28', 'KM8', 'KM7'], 'the creator account approves the module and the core and creates the campaign, signed by its passkey', async () => {
  await setUsdcBalance(rpc, USDC, creator.creator.safe, PRIZE + fee + slotsCost);
  assert.equal(await usdcOf(creator.creator.safe), PRIZE + fee + slotsCost);
  assert.equal(await client.getBalance({ address: creator.creator.safe }), 0n, 'the account held ETH before');

  const submitted = await relayAs('creator-1', creatorKey, { kind: 'createCampaign' });
  createReceipt = submitted.receipt;
  createTxHash = submitted.txHash;
  assert.equal(createReceipt.status, 'success');
  giveawayId = submitted.giveawayId;
  assert.ok(giveawayId !== null && giveawayId > 0n, 'no id read from the event');

  // M28: the campaign's creator, as the contract recorded it, is the account.
  const recorded = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [giveawayId]);
  assert.equal(recorded.creator.toLowerCase(), creator.creator.safe.toLowerCase());
  // M27: both allowances were given by the account, in the same transaction.
  const approvals = parseEventLogs({ abi: ABI, eventName: 'Approval', logs: createReceipt.logs }).filter(
    (event) => event.args.owner.toLowerCase() === creator.creator.safe.toLowerCase(),
  );
  const spenders = approvals.map((event) => event.args.spender.toLowerCase());
  assert.ok(spenders.includes(ERC20_PRIZE_MODULE.toLowerCase()), 'no allowance to the prize module');
  assert.ok(spenders.includes(GIVEAWAY_MANAGER_V2.toLowerCase()), 'no allowance to the core');
  // M8: the deployment landed on the address written before; M7: the account
  // paid nothing and holds no ETH, the relayer paid the gas.
  assert.equal(await kchain.hasCode(creator.creator.safe), true);
  assert.equal(await client.getBalance({ address: creator.creator.safe }), 0n);
  assert.ok((await client.getBalance({ address: funderAddress(0) })) < relayerBalanceBefore, 'the relayer paid nothing');
  const row = store.rows('bridge_v2_creator_campaigns')[0];
  assert.equal(row.status, 'CONFIRMED');
});

// ===========================================================================
// 6.1 — the account as it exists on-chain (M3 to M7, M20)
// ===========================================================================

await test(['KM3'], 'the account is a proxy of SafeL2 1.4.1', async () => {
  // The proxy keeps its singleton in slot 0.
  const word = await client.getStorageAt({ address: creator.creator.safe, slot: '0x0' });
  assert.equal(`0x${word.slice(-40)}`.toLowerCase(), keptra.SAFE_L2_SINGLETON.toLowerCase());
  assert.equal(await read(creator.creator.safe, ABI, 'VERSION'), '1.4.1');
});

/** 6.1.2: the v0.2.1 SharedSigner, named here and only here (C13) to show it is never an owner. */
const SHARED_SIGNER = '0x94a4F6affBd8975951142c3999aEAB7ecee555c2';

await test(['KM4', 'KM1'], 'the only owner is the passkey signer, threshold 1, deployed, and never the SharedSigner', async () => {
  const owners = await read(creator.creator.safe, keptra.SAFE_ABI, 'getOwners');
  assert.deepEqual(owners.map((o) => o.toLowerCase()), [creator.signer.toLowerCase()]);
  assert.equal(await read(creator.creator.safe, keptra.SAFE_ABI, 'getThreshold'), 1n);
  assert.equal(creator.signer, await read(keptra.SIGNER_FACTORY, keptra.SIGNER_FACTORY_ABI, 'getSigner', [creatorKey.x, creatorKey.y, keptra.VERIFIERS]));
  assert.equal(await kchain.hasCode(creator.signer), true);
  assert.ok(!owners.some((o) => o.toLowerCase() === SHARED_SIGNER.toLowerCase()));
  assert.equal(await kchain.hasCode(SHARED_SIGNER), true, 'the SharedSigner named here is not the deployed one');
});

await test(['KM5'], 'the signer was created with the precompile-only verifiers', async () => {
  const created = parseEventLogs({ abi: ABI, eventName: 'Created', logs: createReceipt.logs }).filter(
    (event) => event.address.toLowerCase() === keptra.SIGNER_FACTORY.toLowerCase(),
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].args.signer.toLowerCase(), creator.signer.toLowerCase());
  assert.equal(created[0].args.verifiers, keptra.VERIFIERS);
  assert.equal(keptra.VERIFIERS, 0x100n << 160n);
});

await test(['KM6', 'KM7'], 'the recovery module is the only module, with one guardian and threshold 1', async () => {
  const state = await kchain.accountState(creator.creator.safe);
  assert.equal(await read(creator.creator.safe, ABI, 'isModuleEnabled', [keptra.RECOVERY_MODULE]), true);
  assert.deepEqual(state.modules.map((m) => m.toLowerCase()), [keptra.RECOVERY_MODULE.toLowerCase()]);
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'guardiansCount', [creator.creator.safe]), 1n);
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [creator.creator.safe, guardianAddress()]), true);
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'threshold', [creator.creator.safe]), 1n);
});

await test(['KM20', 'AC14'], 'the fallback handler is the CompatibilityFallbackHandler and never the module (R-4, A2), and the account was marked after that check', async () => {
  const state = await kchain.accountState(creator.creator.safe);
  assert.equal(state.fallbackHandler.toLowerCase(), keptra.FALLBACK_HANDLER.toLowerCase());
  assert.notEqual(state.fallbackHandler.toLowerCase(), keptra.RECOVERY_MODULE.toLowerCase());
  assert.equal(kchain.configurationRefusal(state, guardianAddress(), [creator.signer]), null);
  // The check run at creation fails when the handler is the module.
  assert.equal(
    kchain.configurationRefusal({ ...state, fallbackHandler: keptra.RECOVERY_MODULE }, guardianAddress(), [creator.signer]),
    'module_is_fallback_handler',
  );
  // C14: markDeployed ran after this very transaction (the mark was absent
  // before it, KM8 above), once the chain showed the account configured.
  const row = store.rows('bridge_v2_accounts').find((a) => a.id === creator.creator.id);
  assert.equal(typeof row.deployed_at, 'string', 'deployed_at was never written');
  assert.ok(Number.isFinite(Date.parse(row.deployed_at)), `deployed_at is not a time: ${row.deployed_at}`);
  assert.equal(row.deploy_tx_hash, undefined, 'E9: deploy_tx_hash is written again');
});

// ===========================================================================
// 6.5 — a participant account enters, wins, claims, transfers (M24, M25, M26, M30, M10)
// ===========================================================================

const playerKey = await createPasskey();
const player = await registerParticipant('player-1', playerKey);
const others = Array.from({ length: 9 }, () => privateKeyToAccount(generatePrivateKey()).address);
for (const entrant of others) {
  await rpc.setBalance(entrant, 10n ** 17n);
  await rpc.impersonate(entrant);
}
const addresses = [player.participant.safe, ...others];
const tree = buildTree(addresses.map((a) => a.toLowerCase()));
const bridgeRole = await read(GIVEAWAY_MANAGER_V2, ABI, 'bridge');
await rpc.setBalance(bridgeRole, 10n ** 18n);
await rpc.impersonate(bridgeRole);
const rootReceipt = await rpc.send({
  from: bridgeRole,
  to: GIVEAWAY_MANAGER_V2,
  data: encodeFunctionData({ abi: ABI, functionName: 'addEligibilityRoot', args: [giveawayId, tree.root] }),
});
await rpc.stopImpersonating(bridgeRole);
const rootRow = store.insert('bridge_v2_eligibility_roots', { giveaway_id: giveawayId.toString(), root_index: '0', root: tree.root, leaf_count: 10 });
tree.addresses.forEach((address, position) => store.insert('bridge_v2_eligibility_leaves', { root_id: rootRow.id, address, position }));
store.insert('bridge_v2_entries', {
  participant_id: 'player-1',
  giveaway_id: giveawayId.toString(),
  status: 'ELIGIBLE',
  wallet_address: player.participant.safe,
  root_index: '0',
  self_custody: true,
  passkey: true,
  outcome: null,
});

await test(['KM30'], 'the root that admits the account is built on the account’s address', async () => {
  assert.equal(rootReceipt.status, '0x1');
  const position = tree.addresses.indexOf(player.participant.safe.toLowerCase());
  assert.ok(position >= 0);
  const { verifyProof } = await import('../../../lib/bridge-v2/merkle.ts');
  assert.equal(verifyProof(tree.root, player.participant.safe.toLowerCase(), proofFor(tree, position)), true);
});

await test(['KM10', 'KM36', 'AC14'], 'the relay refuses a signature over any other hash, and so does the account (GS024)', async () => {
  const prepared = await relay.prepareAction('player-1', { kind: 'enter', giveawayId }, null);
  const otherChallenge = keptra.migrationChallenge(zeroAddress, zeroAddress);
  const other = await playerKey.sign(otherChallenge);
  await assert.rejects(
    relay.submitAction('player-1', { kind: 'enter', giveawayId }, null, prepared.tx.nonce, other, log),
    (error) => error instanceof relay.RelayRefusal && error.reason === 'bad_signature',
  );
  assert.equal(await kchain.hasCode(player.participant.safe), false, 'the refused action created the account');

  // On-chain, with the relay out of the way: the same assertion, carried into the
  // account's execTransaction for this transaction, is refused by the Safe with
  // GS024. The account is deployed on a snapshot only, and thrown away after.
  const snapshotId = await rpc.snapshot();
  try {
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    await rpc.setBalance(stranger, 10n ** 17n);
    await rpc.impersonate(stranger);
    for (const call of [keptra.createSignerCall(playerKey.x, playerKey.y), keptra.createAccountCall(player.signer, 'PARTICIPANT')]) {
      assert.equal((await rpc.send({ from: stranger, to: call.to, data: call.data })).status, '0x1');
    }
    await rpc.stopImpersonating(stranger);
    const signature = keptra.assertionToSignature(otherChallenge, other.authenticatorData, other.clientDataJSON, other.signature);
    const reason = await rpc.revertOf({
      from: funderAddress(0),
      to: player.participant.safe,
      data: keptra.execTransactionData(prepared.tx, keptra.encodeSafeSignature(player.signer, signature)),
    });
    assert.match(reason ?? '', /GS024/);
  } finally {
    await rpc.revert(snapshotId);
  }
  assert.equal(await kchain.hasCode(player.participant.safe), false);
});

await test(['KM24', 'KM30', 'KM8', 'KM7'], 'the participant account enters the real GiveawayManagerV2, created in the same transaction', async () => {
  assert.equal(await kchain.hasCode(player.participant.safe), false);
  const submitted = await relayAs('player-1', playerKey, { kind: 'enter', giveawayId });
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'hasEntered', [giveawayId, player.participant.safe]), true);
  assert.equal(await kchain.hasCode(player.participant.safe), true);
  assert.equal(await client.getBalance({ address: player.participant.safe }), 0n);
  assert.equal(kchain.configurationRefusal(await kchain.accountState(player.participant.safe), guardianAddress(), [player.signer]), null);
});

await test(['KM10'], 'on-chain, a signature over another hash is refused by the account with GS024', async () => {
  const state = await kchain.accountState(player.participant.safe);
  const transferTo = (to) => [{ to: USDC, data: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [to, 0n] }) }];
  const tx = keptra.safeTxFor(transferTo(destination), state.nonce);
  const wrong = keptra.safeTxFor(transferTo(funderAddress(1)), state.nonce);
  const wrongHash = keptra.safeTxHash(player.participant.safe, wrong);
  const assertion = await playerKey.sign(wrongHash);
  const signature = keptra.assertionToSignature(wrongHash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  const reason = await rpc.revertOf({
    from: funderAddress(0),
    to: player.participant.safe,
    data: keptra.execTransactionData(tx, keptra.encodeSafeSignature(player.signer, signature)),
  });
  assert.match(reason ?? '', /GS024/);
});

await test(['KM25'], 'the full cycle: ten entries, close, VRF, settle — the winning account claims with its passkey', async () => {
  for (const [index, entrant] of others.entries()) {
    const position = tree.addresses.indexOf(entrant.toLowerCase());
    const receipt = await rpc.send({
      from: entrant,
      to: GIVEAWAY_MANAGER_V2,
      data: encodeFunctionData({ abi: ABI, functionName: 'enter', args: [giveawayId, 0n, proofFor(tree, position)] }),
    });
    assert.equal(receipt.status, '0x1', `entrant ${index} could not enter: ${await rpc.revertOf({ from: entrant, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName: 'enter', args: [giveawayId, 0n, proofFor(tree, position)] }) })}`);
  }
  await rpc.increaseTime(3_700);
  // ArbSys (0x64) is an Arbitrum precompile anvil does not implement, and the
  // VRF coordinator asks it for the block number when a draw is requested. On
  // this local fork only, 0x64 answers every call with the block number
  // (NUMBER, MSTORE, RETURN 32 bytes). No contract under test is replaced; the
  // fulfilment itself is impersonated, as M25 says.
  await rpc.call('anvil_setCode', ['0x0000000000000000000000000000000000000064', '0x4360005260206000f3']);
  const caller = others[0];
  assert.equal((await rpc.send({ from: caller, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName: 'closeGiveaway', args: [giveawayId] }) })).status, '0x1');
  const drawData = encodeFunctionData({ abi: ABI, functionName: 'requestDraw', args: [giveawayId] });
  const drawReason = await rpc.revertOf({ from: caller, to: GIVEAWAY_MANAGER_V2, data: drawData });
  assert.equal(drawReason, null, `requestDraw would revert: ${drawReason}`);
  assert.equal((await rpc.send({ from: caller, to: GIVEAWAY_MANAGER_V2, data: drawData })).status, '0x1');
  const requested = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [giveawayId]);
  const coordinator = await read(GIVEAWAY_MANAGER_V2, ABI, 'vrfCoordinator');
  await rpc.setBalance(coordinator, 10n ** 18n);
  await rpc.impersonate(coordinator);
  const fulfil = await rpc.send({
    from: coordinator,
    to: GIVEAWAY_MANAGER_V2,
    data: encodeFunctionData({ abi: ABI, functionName: 'rawFulfillRandomWords', args: [requested.vrfRequestId, [123456789n]] }),
  });
  await rpc.stopImpersonating(coordinator);
  assert.equal(fulfil.status, '0x1');
  assert.equal((await rpc.send({ from: caller, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName: 'finalizeWinners', args: [giveawayId] }) })).status, '0x1');

  const owed = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'claimable', [giveawayId, player.participant.safe]);
  assert.ok(owed > 0n, 'the account did not win (all ten entrants win: winnersCount 10)');
  const before = await usdcOf(player.participant.safe);
  const submitted = await relayAs('player-1', playerKey, { kind: 'claim', giveawayId });
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'claimable', [giveawayId, player.participant.safe]), 0n);
  assert.equal((await usdcOf(player.participant.safe)) - before, owed);
});

await test(['KM26', 'AC7'], 'a prize transfer (ERC-20) out of the account moves exactly the amount the owner stated, signed by the passkey', async () => {
  const held = await usdcOf(player.participant.safe);
  assert.ok(held > 2n);
  const transfer = (amount) => ({ kind: 'transfer', giveawayId, to: destination, amount });
  // More than the account holds is refused before a hash is built.
  await assert.rejects(relay.prepareAction('player-1', transfer(held + 1n), null), (error) => error.reason === 'amount');
  const part = held / 3n;
  const first = await relayAs('player-1', playerKey, transfer(part));
  assert.equal(first.receipt.status, 'success');
  assert.equal(await usdcOf(player.participant.safe), held - part, 'not exactly the stated amount left the account');
  assert.equal(await usdcOf(destination), part);
  // The rest only when the owner states the rest.
  const second = await relayAs('player-1', playerKey, transfer(held - part));
  assert.equal(second.receipt.status, 'success');
  assert.equal(await usdcOf(player.participant.safe), 0n);
  assert.equal(await usdcOf(destination), held);
});

// ===========================================================================
// 6.2.4 — a second passkey (M12)
// ===========================================================================

const secondKey = await createPasskey();
const secondSigner = await kchain.signerAddressOf(secondKey.x, secondKey.y);
await accounts.registerPasskey('player-1', secondKey.credentialId, secondKey.x, secondKey.y, secondSigner);

await test(['KM12'], 'a second passkey is added by the first, and afterwards each signs alone', async () => {
  const submitted = await relayAs('player-1', playerKey, { kind: 'addPasskey', credentialId: secondKey.credentialId }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  const owners = (await read(player.participant.safe, keptra.SAFE_ABI, 'getOwners')).map((o) => o.toLowerCase());
  assert.deepEqual(owners.sort(), [player.signer.toLowerCase(), secondSigner.toLowerCase()].sort());
  assert.equal(await read(player.participant.safe, keptra.SAFE_ABI, 'getThreshold'), 1n);
});

// ===========================================================================
// 6.5 — NFT prize transfers out of the account (M26), and A2: it can receive them
// ===========================================================================

await test(['KM26'], 'ERC-721: the account receives it (fallback handler) and sends it out, signed by the second passkey alone (M12)', async () => {
  const supply = await read(NPM, ABI, 'totalSupply');
  let tokenId = null;
  let holder = null;
  for (let back = 5n; back < 40n && tokenId === null; back += 1n) {
    const candidate = await read(NPM, ABI, 'tokenByIndex', [supply - back]);
    const owner = await read(NPM, ABI, 'ownerOf', [candidate]);
    if ((await client.getCode({ address: owner })) === undefined) {
      tokenId = candidate;
      holder = owner;
    }
  }
  assert.ok(tokenId !== null, 'no ERC-721 held by an EOA was found to test with');
  await rpc.setBalance(holder, 10n ** 17n);
  await rpc.impersonate(holder);
  const inbound = await rpc.send({ from: holder, to: NPM, data: encodeFunctionData({ abi: ABI, functionName: 'safeTransferFrom', args: [holder, player.participant.safe, tokenId] }) });
  await rpc.stopImpersonating(holder);
  assert.equal(inbound.status, '0x1', 'safeTransferFrom into the account reverted: no fallback handler (A2)');
  assert.equal((await read(NPM, ABI, 'ownerOf', [tokenId])).toLowerCase(), player.participant.safe.toLowerCase());

  const sent = await execAs(player.participant, secondKey, secondSigner, [
    { to: NPM, data: encodeFunctionData({ abi: ABI, functionName: 'safeTransferFrom', args: [player.participant.safe, destination, tokenId] }) },
  ]);
  assert.equal(sent.receipt.status, 'success');
  assert.equal((await read(NPM, ABI, 'ownerOf', [tokenId])).toLowerCase(), destination.toLowerCase());
});

await test(['KM26'], 'ERC-1155: the account receives a unit and sends it out, signed by the first passkey alone (M12)', async () => {
  const head = await client.getBlockNumber();
  const logs = await client.getLogs({
    event: ABI.find((item) => item.type === 'event' && item.name === 'TransferSingle'),
    fromBlock: head - 5_000n,
    toBlock: head,
  });
  let done = false;
  for (const entry of logs.reverse().slice(0, 60)) {
    if (done) break;
    const { to: holder, id } = entry.args;
    if (holder === zeroAddress) continue;
    const collection = entry.address;
    const balance = await read(collection, ABI, 'balanceOf', [holder, id]).catch(() => 0n);
    if (balance === 0n) continue;
    await rpc.setBalance(holder, 10n ** 17n);
    await rpc.impersonate(holder);
    const inbound = await rpc
      .send({ from: holder, to: collection, data: encodeFunctionData({ abi: ABI, functionName: 'safeTransferFrom', args: [holder, player.participant.safe, id, 1n, '0x'] }) })
      .catch(() => ({ status: '0x0' }));
    await rpc.stopImpersonating(holder);
    if (inbound.status !== '0x1') continue;
    const held = await read(collection, ABI, 'balanceOf', [player.participant.safe, id]);
    assert.ok(held >= 1n);
    const sent = await execAs(player.participant, playerKey, player.signer, [
      { to: collection, data: encodeFunctionData({ abi: ABI, functionName: 'safeTransferFrom', args: [player.participant.safe, destination, id, 1n, '0x'] }) },
    ]);
    assert.equal(sent.receipt.status, 'success');
    assert.equal(await read(collection, ABI, 'balanceOf', [player.participant.safe, id]), held - 1n);
    done = true;
  }
  assert.ok(done, 'no transferable ERC-1155 unit was found in the recent blocks');
});

// ===========================================================================
// I12 and section 5 — no server key moves value from an account (M40, M38, M37, M36, M1)
// ===========================================================================

await setUsdcBalance(rpc, USDC, player.participant.safe, 5_000_000n);
const drain = [{ to: USDC, data: encodeFunctionData({ abi: ABI, functionName: 'transfer', args: [destination, 5_000_000n] }) }];
const SERVER_KEYS = {
  guardian: TEST_GUARDIAN_KEY,
  relayer: TEST_FUNDER_KEYS[0],
  funder: TEST_FUNDER_KEYS[1],
  bridge_role: TEST_ROLE_KEY,
  keeper: TEST_KEEPER_KEY,
  // The arbiter and the owner do not exist in the code yet (matrix M40): keys
  // generated here stand in for them.
  arbiter: `0x${'a1'.repeat(32)}`,
  owner: `0x${'b2'.repeat(32)}`,
};

await test(['KM40', 'KM38', 'KM37', 'KM1'], 'no server key moves value from an account: execTransaction GS026, execTransactionFromModule GS104', async () => {
  const before = await usdcOf(player.participant.safe);
  for (const [role, key] of Object.entries(SERVER_KEYS)) {
    const data = await execSignedByKey(player.participant.safe, key, drain);
    const reason = await rpc.revertOf({ from: funderAddress(0), to: player.participant.safe, data });
    assert.match(reason ?? '', /GS026/, `${role}: execTransaction was not refused as a non-owner`);
    const from = privateKeyToAccount(key).address;
    const moduleReason = await rpc.revertOf({
      from,
      to: player.participant.safe,
      data: encodeFunctionData({ abi: ABI, functionName: 'execTransactionFromModule', args: [USDC, 0n, drain[0].data, 0] }),
    });
    assert.match(moduleReason ?? '', /GS104/, `${role}: execTransactionFromModule was not refused`);
  }
  assert.equal(await usdcOf(player.participant.safe), before);
});

await test(['KM36'], 'one account’s passkey cannot act on another account (GS026)', async () => {
  const state = await kchain.accountState(creator.creator.safe);
  const tx = keptra.safeTxFor(drain.map((c) => ({ ...c })), state.nonce);
  const hash = keptra.safeTxHash(creator.creator.safe, tx);
  const assertion = await playerKey.sign(hash);
  const signature = keptra.assertionToSignature(hash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  const reason = await rpc.revertOf({
    from: funderAddress(0),
    to: creator.creator.safe,
    data: keptra.execTransactionData(tx, keptra.encodeSafeSignature(player.signer, signature)),
  });
  assert.match(reason ?? '', /GS026/);
});

await test(['KM37'], 'the module refuses the guardian as an owner, and an owner as a guardian', async () => {
  // An owner as guardian: GuardianStorage refuses it, asked as the account itself.
  const asGuardian = await rpc.revertOf({
    from: player.participant.safe,
    to: keptra.RECOVERY_MODULE,
    data: encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'addGuardianWithThreshold', args: [player.signer, 1n] }),
  });
  assert.match(asGuardian ?? '', /GS: guardian cannot be an owner/);
  // And the relay would never build it: the allow-list names only the platform's guardian.
  assert.equal(keptra.refusalFor(player.participant.safe, keptra.addGuardianCalls(player.signer), 0n, null, guardianAddress()), 'guardian_mismatch');
});

// ===========================================================================
// 6.3 and 6.4 — recovery against the real module (M14, M16 to M19, M22, M23, M37)
// ===========================================================================

const snapshot = await rpc.snapshot();
const lostKey = await createPasskey();
const lost = await registerParticipant('lost-1', lostKey);
await deployOnly(lost.participant, lostKey, lost.signer);
const newKey = await createPasskey();
const newSigner = await kchain.signerAddressOf(newKey.x, newKey.y);
const newPasskey = await accounts.registerPasskey('lost-1', newKey.credentialId, newKey.x, newKey.y, newSigner);

function openVerified() {
  return store.insert('bridge_v2_recoveries', {
    participant_id: 'lost-1',
    passkey_id: newPasskey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: `h-${Math.random()}`,
    link_expires_at: new Date(Date.now() + 60_000).toISOString(),
    started_at: null,
    execute_after: null,
  });
}
const moduleRequest = () => read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'getRecoveryRequest', [lost.participant.safe]);
const finalizeReason = () =>
  rpc.revertOf({ from: funderAddress(0), to: keptra.RECOVERY_MODULE, data: kchain.finalizeRecoveryCall(lost.participant.safe).data });

await test(['KM17', 'KM6', 'KM14'], 'after R-1, the guardian confirms and the module starts exactly 604 800 seconds', async () => {
  const request = openVerified();
  assert.equal(await kchain.hasCode(newSigner), false, 'the new signer existed before R-1 asked for it');
  assert.equal(await recovery.confirmVerifiedRecoveries(log, tick()), 1);
  assert.equal(await kchain.hasCode(newSigner), true, 'R-1: the new owner was not deployed first');
  const pending = await moduleRequest();
  const now = await kchain.chainNow();
  assert.equal(BigInt(pending.executeAfter) - now, 604_800n);
  assert.deepEqual(pending.newOwners.map((o) => o.toLowerCase()), [newSigner.toLowerCase()]);
  assert.equal(store.rows('bridge_v2_recoveries').find((r) => r.id === request.id).status, 'CONFIRMED');
});

await test(['KM14'], 'finalising before the seven days reverts', async () => {
  assert.match((await finalizeReason()) ?? '', /SM: recovery period still pending/);
});

await test(['KM16', 'KM18'], 'the old passkey cancels: cancelRecovery and invalidateNonce in one transaction', async () => {
  const prepared = await relay.prepareAction('lost-1', { kind: 'cancelRecovery' }, 'PARTICIPANT');
  assert.equal(prepared.tx.operation, 1);
  assert.equal(prepared.tx.to.toLowerCase(), keptra.MULTI_SEND_CALL_ONLY.toLowerCase());
  assert.equal(callsOf(prepared.tx).length, 2);
  const submitted = await relayAs('lost-1', lostKey, { kind: 'cancelRecovery' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  const events = parseEventLogs({ abi: ABI, logs: submitted.receipt.logs }).map((e) => e.eventName);
  assert.ok(events.includes('RecoveryCanceled') && events.includes('NonceInvalidated'), `events were ${events}`);
  assert.equal(BigInt((await moduleRequest()).executeAfter), 0n);
  assert.match((await finalizeReason()) ?? '', /SM: no ongoing recovery/);
  assert.equal(await recovery.advanceConfirmedRecoveries(log, tick()), 1);
  assert.equal(store.rows('bridge_v2_recoveries').at(-1).status, 'CANCELED');
});

await test(['KM23'], 'R-7 as declared: the guardian can start again after a cancellation, and the passkey can cancel again', async () => {
  openVerified();
  assert.equal(await recovery.confirmVerifiedRecoveries(log, tick()), 1);
  assert.ok(BigInt((await moduleRequest()).executeAfter) > 0n);
  const submitted = await relayAs('lost-1', lostKey, { kind: 'cancelRecovery' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(BigInt((await moduleRequest()).executeAfter), 0n);
  await recovery.advanceConfirmedRecoveries(log, tick());
});

await test(['KM22', 'KM14'], 'R-6: once the seven days pass, the bridge finalises and the new passkey is the owner', async () => {
  openVerified();
  assert.equal(await recovery.confirmVerifiedRecoveries(log, tick()), 1);
  await rpc.increaseTime(604_801);
  await recovery.advanceConfirmedRecoveries(log, tick());
  const owners = (await read(lost.participant.safe, keptra.SAFE_ABI, 'getOwners')).map((o) => o.toLowerCase());
  assert.deepEqual(owners, [newSigner.toLowerCase()]);
  await recovery.advanceConfirmedRecoveries(log, tick());
  assert.equal(store.rows('bridge_v2_recoveries').at(-1).status, 'FINALIZED');
});

await test(['AD4', 'KM8'], 'D4: after the recovery, the creator account not yet deployed is built at the new passkey’s address, for it alone', async () => {
  const row = store.rows('bridge_v2_accounts').find((a) => a.id === lost.creator.id);
  const readdressed = keptra.predictSafeAddress(newSigner, 'CREATOR');
  assert.notEqual(readdressed.toLowerCase(), lost.creator.safe.toLowerCase());
  assert.equal(row.safe_address, readdressed);
  assert.equal(row.initial_signer.toLowerCase(), newSigner.toLowerCase());
  // The lost passkey no longer reaches it.
  await assert.rejects(relayAs('lost-1', lostKey, { kind: 'configure' }, 'CREATOR'), (error) => error.reason === 'not_owner');
  // The new one builds it, configured, at the address computed from it.
  assert.equal((await relayAs('lost-1', newKey, { kind: 'configure' }, 'CREATOR')).receipt.status, 'success');
  assert.equal(await kchain.hasCode(readdressed), true);
  assert.equal(await kchain.hasCode(lost.creator.safe), false, 'the old address was deployed');
  assert.equal(kchain.configurationRefusal(await kchain.accountState(readdressed), guardianAddress(), [newSigner]), null);
  assert.notEqual(store.rows('bridge_v2_accounts').find((a) => a.id === lost.creator.id).deployed_at ?? null, null);
});

await test(['KM22'], 'a pending recovery nobody registered raises an alert and is never finalised', async () => {
  // The guardian key used outside the bridge: a confirmation with no request behind it.
  const rogue = privateKeyToAccount(`0x${'c3'.repeat(32)}`).address;
  const hash = await kchain.recoveryHash(lost.participant.safe, [rogue]);
  const signature = await privateKeyToAccount(TEST_GUARDIAN_KEY).sign({ hash });
  const sent = await relay.sendAsRelayer([kchain.confirmRecoveryCall(lost.participant.safe, [rogue], guardianAddress(), signature)], log);
  assert.equal(sent.receipt.status, 'success');
  assert.equal(await recovery.alertUnregisteredRecoveries(log, tick()), 1);
  await rpc.increaseTime(604_801);
  await recovery.advanceConfirmedRecoveries(log, tick());
  const owners = (await read(lost.participant.safe, keptra.SAFE_ABI, 'getOwners')).map((o) => o.toLowerCase());
  assert.ok(!owners.includes(rogue.toLowerCase()), 'the bridge finalised a recovery it never registered');
});

await test(['KM37'], 'the module refuses to make the guardian an owner at finalisation', async () => {
  // The unregistered one above is still pending, and the module only replaces a
  // pending recovery with more approvals: the owner (now the new passkey)
  // cancels it first, which is also 6.3.3 from the recovered side.
  const cancelled = await relayAs('lost-1', newKey, { kind: 'cancelRecovery' }, 'PARTICIPANT');
  assert.equal(cancelled.receipt.status, 'success');
  const guardian = guardianAddress();
  const hash = await kchain.recoveryHash(lost.participant.safe, [guardian]);
  const signature = await privateKeyToAccount(TEST_GUARDIAN_KEY).sign({ hash });
  const sent = await relay.sendAsRelayer([kchain.confirmRecoveryCall(lost.participant.safe, [guardian], guardian, signature)], log);
  assert.equal(sent.receipt.status, 'success');
  await rpc.increaseTime(604_801);
  assert.match((await finalizeReason()) ?? '', /SM: new owner cannot be guardian/);
  // And the guardian's own ECDSA signature is not an owner's (GS026).
  const data = await execSignedByKey(lost.participant.safe, TEST_GUARDIAN_KEY, drain);
  assert.match((await rpc.revertOf({ from: funderAddress(0), to: lost.participant.safe, data })) ?? '', /GS026/);
});

await rpc.revert(snapshot);

await test(['KM19', 'AC2'], 'R-3 as A6 corrects it: with a recovery pending, one transaction cancels, invalidates and revokes', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('revoke-1', key);
  await deployOnly(subject.participant, key, subject.signer);
  const replacement = await createPasskey();
  const replacementSigner = await kchain.signerAddressOf(replacement.x, replacement.y);
  const passkey = await accounts.registerPasskey('revoke-1', replacement.credentialId, replacement.x, replacement.y, replacementSigner);
  store.insert('bridge_v2_recoveries', {
    participant_id: 'revoke-1',
    passkey_id: passkey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: 'revoke-h',
    link_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await recovery.confirmVerifiedRecoveries(log, tick());
  const pendingBefore = await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'getRecoveryRequest', [subject.participant.safe]);
  assert.ok(BigInt(pendingBefore.executeAfter) > 0n);

  const prepared = await relay.prepareAction('revoke-1', { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(callsOf(prepared.tx).length, 3);
  const submitted = await relayAs('revoke-1', key, { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'guardiansCount', [subject.participant.safe]), 0n);
  assert.equal(BigInt((await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'getRecoveryRequest', [subject.participant.safe])).executeAfter), 0n);

  const guardian = guardianAddress();
  await rpc.setBalance(guardian, 10n ** 16n);
  await rpc.impersonate(guardian);
  const reason = await rpc.revertOf({
    from: guardian,
    to: keptra.RECOVERY_MODULE,
    data: encodeFunctionData({ abi: ABI, functionName: 'confirmRecovery', args: [subject.participant.safe, [replacementSigner], 1n, true] }),
  });
  await rpc.stopImpersonating(guardian);
  assert.match(reason ?? '', /SM: sender not a guardian/);

  // A6 and D1: the account adds the current guardian back with the passkey. (That
  // it keeps every other action meanwhile is the AD1 test below.)
  const added = await relayAs('revoke-1', key, { kind: 'configure' }, 'PARTICIPANT');
  assert.equal(added.receipt.status, 'success');
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [subject.participant.safe, guardian]), true);
});

await test(['KM19'], 'R-3 with no recovery pending does not revert: invalidate and revoke only (A6)', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('revoke-2', key);
  await deployOnly(subject.participant, key, subject.signer);
  const prepared = await relay.prepareAction('revoke-2', { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(callsOf(prepared.tx).length, 2);
  const submitted = await relayAs('revoke-2', key, { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'guardiansCount', [subject.participant.safe]), 0n);
});

await test(['AD1', 'KM12', 'KM19'], 'D1: after R-3 the account keeps working with no guardian; during an incident configure waits for the rotation, then adds the new key', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('incident-1', key);
  const safe = subject.participant.safe;
  await deployOnly(subject.participant, key, subject.signer);
  assert.equal((await relayAs('incident-1', key, { kind: 'revokeGuardian' }, 'PARTICIPANT')).receipt.status, 'success');
  const guardians = () => read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'getGuardians', [safe]);
  assert.deepEqual(await guardians(), []);

  // Usable: a second passkey is added, signed by the first, on an account with no guardian.
  const second = await createPasskey();
  const secondSigner = await kchain.signerAddressOf(second.x, second.y);
  await accounts.registerPasskey('incident-1', second.credentialId, second.x, second.y, secondSigner);
  const addedOwner = await relayAs('incident-1', key, { kind: 'addPasskey', credentialId: second.credentialId }, 'PARTICIPANT');
  assert.equal(addedOwner.receipt.status, 'success');
  const owners = (await read(safe, keptra.SAFE_ABI, 'getOwners')).map((o) => o.toLowerCase());
  assert.ok(owners.includes(secondSigner.toLowerCase()), 'the second passkey was not added');

  // The incident: the platform's key is listed. configure is refused, and nothing is sent.
  const compromised = guardianAddress();
  store.insert('bridge_v2_guardian_incidents', { guardian_address: compromised.toLowerCase() });
  const previous = process.env.BRIDGE_V2_GUARDIAN_KEY;
  try {
    const sentBefore = await client.getTransactionCount({ address: funderAddress(0) });
    await assert.rejects(relayAs('incident-1', second, { kind: 'configure' }, 'PARTICIPANT'), (error) => error.reason === 'guardian_incident');
    assert.equal(await client.getTransactionCount({ address: funderAddress(0) }), sentBefore, 'the relayer sent something');
    // The rotation: configure adds the new key, signed by the second passkey alone.
    process.env.BRIDGE_V2_GUARDIAN_KEY = generatePrivateKey();
    const rotated = guardianAddress();
    assert.equal((await relayAs('incident-1', second, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
    assert.deepEqual((await guardians()).map((g) => g.toLowerCase()), [rotated.toLowerCase()]);
    assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [safe, compromised]), false);
  } finally {
    process.env.BRIDGE_V2_GUARDIAN_KEY = previous;
    // The incident was this test's; the tests after it use the suite's guardian key.
    store.rows('bridge_v2_guardian_incidents').length = 0;
  }
});

// ===========================================================================
// 6.6 — migration of derived wallets (M32, M33, M34, M2, M35)
// ===========================================================================

const derivedIndex = 900;
const derivedAddress = wallet.addressOf(derivedIndex);
const creatorIndex = 901;
const creatorDerived = wallet.addressOf(creatorIndex);

await test(['KM35'], 'the two known balances, read on-chain: 2.5 USDC each, both plain accounts (P14 still pending)', async () => {
  for (const address of ['0x48158b603260347b60AABd2728faCd046F4d3595', '0x791a21dEBbeFe617A8EF3d21a6E0C56B209055fa']) {
    assert.equal(await usdcOf(address), 2_500_000n, `${address} does not hold 2.5 USDC`);
    assert.equal((await client.getCode({ address })) ?? '0x', '0x', `${address} is a contract`);
  }
});

async function authorize(participantId, key, kind, derived, account) {
  const challenge = keptra.migrationChallenge(derived, account.safe);
  const assertion = await key.sign(challenge);
  const signature = keptra.assertionToSignature(challenge, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  assert.equal(await kchain.isValidPasskeySignature(challenge, signature, key.x, key.y), true, 'the authorisation did not verify on-chain');
  const tampered = keptra.migrationChallenge(derived, derived);
  assert.equal(await kchain.isValidPasskeySignature(tampered, signature, key.x, key.y), false);
  return accounts.authorizeMigration(kind === 'PARTICIPANT' ? derivedIndex : creatorIndex, derived, account.id, kind);
}

await test(['KM32', 'KM34', 'KM2', 'AC1'], 'a derived wallet with USDC: authorised by the passkey on-chain, moved to the account within the real run budget, then sealed', async () => {
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-1', email_canonical: 'legacy@example.test', wallet_index: derivedIndex, wallet_address: derivedAddress });
  await accounts.registerPasskey('legacy-1', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-1', signer, guardianAddress())).filter((a) => a.role === 'PARTICIPANT');
  await setUsdcBalance(rpc, USDC, derivedAddress, 3_000_000n);
  // C4: the account exists, configured, before it is a destination.
  assert.equal((await relayAs('legacy-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');

  const before = await migration.seedRetirementReadiness(log);
  assert.equal(before.ready, false, 'readiness said ready with a derived wallet holding USDC');

  assert.equal(await authorize('legacy-1', key, 'PARTICIPANT', derivedAddress, account), 'AUTHORIZED');
  // C1: the maintenance pass's own deadline, runDeadline() with RUN_BUDGET_MS.
  const sealed = await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(sealed, 1);
  assert.equal(await usdcOf(derivedAddress), 0n);
  assert.equal(await usdcOf(account.safe), 3_000_000n);
  await assert.rejects(wallet.signAsDerived(derivedIndex, { chainId: 42161, to: derivedAddress, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, nonce: 0 }), /sealed/);
});

await test(['KM33', 'AC1'], 'the same for a creator’s derived wallet', async () => {
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-creator', email_canonical: 'brand@example.test', wallet_index: null, wallet_address: null });
  store.insert('bridge_v2_creators', { participant_id: 'legacy-creator', wallet_index: creatorIndex, wallet_address: creatorDerived });
  await accounts.registerPasskey('legacy-creator', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-creator', signer, guardianAddress())).filter((a) => a.role === 'CREATOR');
  await setUsdcBalance(rpc, USDC, creatorDerived, 1_500_000n);
  assert.equal((await relayAs('legacy-creator', key, { kind: 'configure' }, 'CREATOR')).receipt.status, 'success');
  assert.equal(await authorize('legacy-creator', key, 'CREATOR', creatorDerived, account), 'AUTHORIZED');
  assert.equal(await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline()), 1);
  assert.equal(await usdcOf(creatorDerived), 0n);
  assert.equal(await usdcOf(account.safe), 1_500_000n);
  await assert.rejects(wallet.signAsDerived(creatorIndex, { chainId: 42161, to: creatorDerived, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, nonce: 0 }), /sealed/);
});

await test(['KM34', 'AE1', 'AE11'], 'with every derived wallet empty and sealed, the seed can be retired — the sealed ones read on-chain and shown empty; a balance in one keeps the seed, with an alert', async () => {
  // E1: both wallets are sealed, and both are read — their balances, on-chain.
  assert.equal(await accounts.isIndexSealed(derivedIndex), true);
  assert.equal(await accounts.isIndexSealed(creatorIndex), true);
  for (const address of [derivedAddress, creatorDerived]) assert.equal(await usdcOf(address), 0n, `${address} is sealed and not empty`);
  const after = await migration.seedRetirementReadiness(log);
  assert.deepEqual([after.ready, after.wallets, after.holding], [true, 2, 0], `still blocking: ${after.blocking}`);
  // Something arrives in a sealed wallet: not ready, and an alert says so.
  await setUsdcBalance(rpc, USDC, creatorDerived, 1n);
  const watched = recordingLogger();
  const holding = await migration.seedRetirementReadiness(watched);
  assert.deepEqual([holding.ready, holding.holding], [false, 1], 'a sealed wallet holding USDC was reported ready');
  assert.deepEqual(
    watched.events.filter((e) => e.kind === 'alert').map((e) => [e.detail.summary, e.detail.sealed]),
    [['derived wallet holds a balance', 1]],
  );
  await setUsdcBalance(rpc, USDC, creatorDerived, 0n);
  assert.equal((await migration.seedRetirementReadiness(log)).ready, true);
});

await test(['KM34', 'KM2', 'AF3'], 'a derived wallet with a right still open — an entry its campaign still takes (F3) — is moved but not sealed (A8)', async () => {
  const index = 902;
  const address = wallet.addressOf(index);
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-2', email_canonical: 'legacy2@example.test', wallet_index: index, wallet_address: address });
  // Adenda F3: a right while its campaign still takes entries — a real one, open now.
  const open = await openCampaign();
  store.insert('bridge_v2_entries', { participant_id: 'legacy-2', giveaway_id: open.toString(), status: 'VERIFIED', wallet_address: address, passkey: false, self_custody: false, outcome: null });
  await accounts.registerPasskey('legacy-2', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-2', signer, guardianAddress())).filter((a) => a.role === 'PARTICIPANT');
  await setUsdcBalance(rpc, USDC, address, 700_000n);
  assert.equal((await relayAs('legacy-2', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  const challenge = keptra.migrationChallenge(address, account.safe);
  const assertion = await key.sign(challenge);
  const signature = keptra.assertionToSignature(challenge, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  assert.equal(await kchain.isValidPasskeySignature(challenge, signature, key.x, key.y), true);
  await accounts.authorizeMigration(index, address, account.id, 'PARTICIPANT');
  assert.equal(await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, tick()), 0);
  assert.equal(await usdcOf(account.safe), 700_000n, 'the balance was not moved');
  assert.equal(await accounts.isIndexSealed(index), false, 'sealed with a right still open');
  assert.equal((await migration.seedRetirementReadiness(log)).ready, false);
});

// ===========================================================================
// Adenda C — the corrections after the audit of 1db7d21, on the real contracts
// ===========================================================================

await test(['AC4', 'KM32'], 'the migration moves nothing into an account that is not deployed and configured; once its passkey sets it up, it moves', async () => {
  const index = 903;
  const address = wallet.addressOf(index);
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-3', email_canonical: 'legacy3@example.test', wallet_index: index, wallet_address: address });
  await accounts.registerPasskey('legacy-3', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-3', signer, guardianAddress())).filter((a) => a.role === 'PARTICIPANT');
  await setUsdcBalance(rpc, USDC, address, 400_000n);
  // The route refuses this authorisation for an account not set up (unit suite);
  // here the pass itself is shown to hold the line on its own.
  await accounts.authorizeMigration(index, address, account.id, 'PARTICIPANT');
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(address), 400_000n, 'a balance left for an account that does not exist');
  assert.equal(await kchain.hasCode(account.safe), false);
  assert.equal(await usdcOf(account.safe), 0n);

  assert.equal((await relayAs('legacy-3', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  assert.equal(keptra.configurationGap(await kchain.accountState(account.safe)), null);
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(account.safe), 400_000n);
  assert.equal(await accounts.isIndexSealed(index), true);
});

await test(['AC2', 'KM6', 'KM20'], 'an account somebody else deployed bare is refused everything but its completion, which the passkey signs at nonce 0', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('bare-1', key);
  // The signer and the initializer are public once any account of the
  // participant has acted: anybody can deploy the other one, bare.
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  await rpc.setBalance(stranger, 10n ** 17n);
  await rpc.impersonate(stranger);
  for (const call of [keptra.createSignerCall(key.x, key.y), keptra.createAccountCall(subject.signer, 'CREATOR')]) {
    assert.equal((await rpc.send({ from: stranger, to: call.to, data: call.data })).status, '0x1');
  }
  await rpc.stopImpersonating(stranger);
  const bare = await kchain.accountState(subject.creator.safe);
  assert.equal(bare.deployed, true);
  assert.equal(bare.nonce, 0n);
  assert.equal(keptra.configurationGap(bare), 'module');
  assert.deepEqual(bare.guardians, []);

  // Audit finding 2: the first action went out at nonce 0 with no configuration. Now refused.
  for (const action of [{ kind: 'createCampaign' }, { kind: 'addPasskey', credentialId: key.credentialId }, { kind: 'cancelRecovery' }, { kind: 'revokeGuardian' }]) {
    await assert.rejects(relay.prepareAction('bare-1', action, 'CREATOR'), (error) => error.reason === 'configuration_incomplete', action.kind);
  }
  const completed = await relayAs('bare-1', key, { kind: 'configure' }, 'CREATOR');
  assert.equal(completed.receipt.status, 'success');
  const state = await kchain.accountState(subject.creator.safe);
  assert.equal(kchain.configurationRefusal(state, guardianAddress(), [subject.signer]), null);
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [subject.creator.safe, guardianAddress()]), true);
  const row = store.rows('bridge_v2_accounts').find((a) => a.id === subject.creator.id);
  assert.equal(typeof row.deployed_at, 'string', 'the completed account was not marked');
  await assert.rejects(relay.prepareAction('bare-1', { kind: 'configure' }, 'CREATOR'), (error) => error.reason === 'already_configured');
});

// The register route, driven as the page drives it: a session, and the
// participant's passkey. The chain half is real.
db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
const sessionFor = (participantId) =>
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
async function accountsView(key) {
  const response = await registerRoute.POST(
    request('https://events.invalid/api/bridge/v2/account/register', {
      cookie: 'iw_bridge_session=a-token-value',
      body: { x: key.x.toString(), y: key.y.toString(), credentialId: key.credentialId },
    }),
  );
  assert.equal(response.status, 200);
  return (await response.json()).accounts;
}

await test(['AC6', 'AC4', 'KM19'], 'after a guardian rotation the page is told the account has no recovery, until the account adds the new guardian', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('rotate-1', key);
  sessionFor('rotate-1');
  const participantView = async () => (await accountsView(key)).find((a) => a.role === 'PARTICIPANT');
  // C4: no address before the account exists; the bridge deploys and configures it first.
  assert.deepEqual(await participantView(), { role: 'PARTICIPANT', address: null, deployed: false, configured: false, recoveryEnabled: false });
  assert.equal((await relayAs('rotate-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  assert.deepEqual(await participantView(), { role: 'PARTICIPANT', address: subject.participant.safe, deployed: true, configured: true, recoveryEnabled: true });

  const previous = process.env.BRIDGE_V2_GUARDIAN_KEY;
  process.env.BRIDGE_V2_GUARDIAN_KEY = generatePrivateKey();
  try {
    const rotated = await participantView();
    assert.equal(rotated.configured, true);
    assert.equal(rotated.recoveryEnabled, false, 'an account holding the rotated-away guardian was shown as recoverable');
    // A6: revoke the old guardian, then add the new one, each with the passkey.
    assert.equal((await relayAs('rotate-1', key, { kind: 'revokeGuardian' }, 'PARTICIPANT')).receipt.status, 'success');
    assert.equal((await participantView()).recoveryEnabled, false);
    assert.equal((await relayAs('rotate-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
    assert.equal((await participantView()).recoveryEnabled, true);
    assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [subject.participant.safe, guardianAddress()]), true);
  } finally {
    process.env.BRIDGE_V2_GUARDIAN_KEY = previous;
  }
});

await test(['AC9', 'KM10'], 'the signer contract accepts an assertion made for another site; the bridge refuses it and sends nothing', async () => {
  // The user's key, asked by a page on another domain.
  const key = await createPasskey({ rpId: 'keptra-login.example', origin: 'https://keptra-login.example' });
  const subject = await registerParticipant('rp-1', key);
  const prepared = await relay.prepareAction('rp-1', { kind: 'configure' }, 'PARTICIPANT');
  const assertion = await key.sign(prepared.hash);
  // Taken apart by hand, past C9's check: the on-chain signer code verifies it.
  const prefix = `{"type":"webauthn.get","challenge":"${keptra.base64UrlOf(prepared.hash)}",`;
  const raw = {
    authenticatorData: assertion.authenticatorData,
    clientDataFields: assertion.clientDataJSON.slice(prefix.length, -1),
    ...keptra.parseDerSignature(assertion.signature),
  };
  assert.equal(await kchain.isValidPasskeySignature(prepared.hash, raw, key.x, key.y), true, 'the signer checks the relying party after all');
  // The bridge does not take it.
  assert.equal(keptra.assertionToSignature(prepared.hash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature), null);
  await assert.rejects(
    relay.submitAction('rp-1', { kind: 'configure' }, 'PARTICIPANT', prepared.tx.nonce, assertion, log),
    (error) => error.reason === 'bad_signature',
  );
  assert.equal(await kchain.hasCode(subject.participant.safe), false, 'something was sent');
});

await test(['AC10', 'KM22'], 'the unregistered-recovery alert fires if and only if a pending recovery matches no live request, on any account with code', async () => {
  const count = () => recovery.alertUnregisteredRecoveries(log, tick());
  assert.equal(await count(), 0, 'baseline: an alert with nothing pending');
  const key = await createPasskey();
  const subject = await registerParticipant('alert-1', key);
  assert.equal((await relayAs('alert-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  const replacement = await createPasskey();
  const replacementSigner = await kchain.signerAddressOf(replacement.x, replacement.y);
  const passkey = await accounts.registerPasskey('alert-1', replacement.credentialId, replacement.x, replacement.y, replacementSigner);
  const request_ = store.insert('bridge_v2_recoveries', {
    participant_id: 'alert-1',
    passkey_id: passkey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: 'alert-h',
    link_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  // Confirmed on-chain exactly as confirmOne does it, with the row still
  // PHONE_VERIFIED: a pass that stopped between the two steps.
  assert.equal((await relay.sendAsRelayer([keptra.createSignerCall(replacement.x, replacement.y)], log)).receipt.status, 'success');
  const hash = await kchain.recoveryHash(subject.participant.safe, [replacementSigner]);
  const signature = await privateKeyToAccount(TEST_GUARDIAN_KEY).sign({ hash });
  const confirmed = await relay.sendAsRelayer([kchain.confirmRecoveryCall(subject.participant.safe, [replacementSigner], guardianAddress(), signature)], log);
  assert.equal(confirmed.receipt.status, 'success');
  assert.equal(await count(), 0, 'a live PHONE_VERIFIED request confirmed on-chain raised the alert');
  // No live request behind it any more: the same pending recovery is an alert.
  request_.status = 'REFUSED';
  assert.equal(await count(), 1);
  // An account with code that this side never marked deployed is read as well.
  store.rows('bridge_v2_accounts').find((a) => a.id === subject.participant.id).deployed_at = null;
  assert.equal(await count(), 1, 'an unmarked account with code was skipped');
  // The owner cancels, and there is nothing left to report.
  assert.equal((await relayAs('alert-1', key, { kind: 'cancelRecovery' }, 'PARTICIPANT')).receipt.status, 'success');
  assert.equal(await count(), 0);
});

await test(['AD3', 'KM6'], 'D3: at 24 hours a request the guardian confirmed on-chain becomes CONFIRMED with the module’s own dates; one with nothing confirmed expires', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('overdue-1', key);
  const safe = subject.participant.safe;
  assert.equal((await relayAs('overdue-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  const replacement = await createPasskey();
  const replacementSigner = await kchain.signerAddressOf(replacement.x, replacement.y);
  const passkey = await accounts.registerPasskey('overdue-1', replacement.credentialId, replacement.x, replacement.y, replacementSigner);
  const overdue = (hash) =>
    store.insert('bridge_v2_recoveries', {
      participant_id: 'overdue-1',
      passkey_id: passkey.id,
      status: 'PHONE_VERIFIED',
      link_code_hash: hash,
      link_expires_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
      created_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    });

  // Nothing confirmed on-chain: it expires.
  const idle = overdue('overdue-idle');
  assert.equal(await recovery.closeOverdueRecoveries(log, tick()), 1);
  assert.equal(idle.status, 'EXPIRED');

  // Confirmed on-chain by a pass that stopped before the row moved on.
  const partial = overdue('overdue-partial');
  assert.equal((await relay.sendAsRelayer([keptra.createSignerCall(replacement.x, replacement.y)], log)).receipt.status, 'success');
  const hash = await kchain.recoveryHash(safe, [replacementSigner]);
  const signature = await privateKeyToAccount(TEST_GUARDIAN_KEY).sign({ hash });
  const confirmed = await relay.sendAsRelayer([kchain.confirmRecoveryCall(safe, [replacementSigner], guardianAddress(), signature)], log);
  assert.equal(confirmed.receipt.status, 'success');
  assert.equal(await recovery.closeOverdueRecoveries(log, tick()), 1);
  assert.equal(partial.status, 'CONFIRMED');
  const pending = await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'getRecoveryRequest', [safe]);
  assert.equal(partial.execute_after, new Date(Number(pending.executeAfter) * 1000).toISOString());
  const { blockNumber } = await client.getTransactionReceipt({ hash: confirmed.hash });
  const block = await client.getBlock({ blockNumber });
  assert.equal(partial.started_at, new Date(Number(block.timestamp) * 1000).toISOString(), 'the start is not the confirmation');
  // No longer unregistered (C10), and the owner can still cancel it (6.3.3).
  assert.equal(await recovery.alertUnregisteredRecoveries(log, tick()), 0);
  assert.equal((await relayAs('overdue-1', key, { kind: 'cancelRecovery' }, 'PARTICIPANT')).receipt.status, 'success');
  await recovery.advanceConfirmedRecoveries(log, tick());
  assert.equal(partial.status, 'CANCELED');
});

await test(['AC11', 'AE2'], 'three guardians added back in 24 hours are paid by the relayer; the fourth is refused before anything is signed or sent; a revocation never is', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('cap-1', key);
  assert.equal((await relayAs('cap-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  for (const kind of ['revokeGuardian', 'configure', 'revokeGuardian', 'configure', 'revokeGuardian', 'configure', 'revokeGuardian']) {
    assert.equal((await relayAs('cap-1', key, { kind }, 'PARTICIPANT')).receipt.status, 'success', kind);
  }
  const guardians = () => read(keptra.RECOVERY_MODULE, ABI, 'guardiansCount', [subject.participant.safe]);
  assert.equal(await guardians(), 0n);
  const sentBefore = await client.getTransactionCount({ address: funderAddress(0) });
  await assert.rejects(relayAs('cap-1', key, { kind: 'configure' }, 'PARTICIPANT'), (error) => error.reason === 'guardian_change_limit');
  assert.equal(await client.getTransactionCount({ address: funderAddress(0) }), sentBefore, 'the relayer sent something');
  const changes = store.rows('bridge_v2_guardian_changes').filter((row) => row.account_id === subject.participant.id);
  assert.equal(changes.length, 3, 'the creation or a revocation counted as a change, or a change went unrecorded');
  // A day later the window has moved on.
  for (const row of changes) row.created_at = new Date(Date.now() - 25 * 3_600_000).toISOString();
  assert.equal((await relayAs('cap-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  assert.equal(await guardians(), 1n);
  // E2: with the three re-additions used again, the reaction to a compromise still goes out.
  for (const kind of ['revokeGuardian', 'configure', 'revokeGuardian', 'configure']) {
    assert.equal((await relayAs('cap-1', key, { kind }, 'PARTICIPANT')).receipt.status, 'success', kind);
  }
  assert.equal((await relayAs('cap-1', key, { kind: 'revokeGuardian' }, 'PARTICIPANT')).receipt.status, 'success', 'a revocation was refused');
  assert.equal(await guardians(), 0n);
});

// --- B5: a prize that is not USDC, from a creator account ------------------------

/** Writes an ERC-20 balance by finding the token's balance mapping slot. */
async function setTokenBalance(token, holder, amount) {
  for (let slot = 0n; slot < 128n; slot += 1n) {
    for (const key of [
      keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, slot])),
      keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [slot, holder])),
    ]) {
      const before = await rpc.call('eth_getStorageAt', [token, key, 'latest']);
      await rpc.call('anvil_setStorageAt', [token, key, pad(toHex(amount), { size: 32 })]);
      if ((await read(token, ABI, 'balanceOf', [holder])) === amount) return;
      await rpc.call('anvil_setStorageAt', [token, key, before]);
    }
  }
  throw new Error(`no balance slot found for ${token}`);
}

const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

await test(['KM27', 'KM28', 'AC14'], 'B5: a creator account with a non-USDC prize gives three approvals — prize to the module, fee in the prize token and slots in USDC to the core', async () => {
  const prize = 10n ** 16n; // 0.01 WETH
  const prizeFee = await read(GIVEAWAY_MANAGER_V2, ABI, 'currentFee', [0, prize]);
  await setTokenBalance(WETH, creator.creator.safe, prize + prizeFee);
  await setUsdcBalance(rpc, USDC, creator.creator.safe, slotsCost);
  store.insert('bridge_v2_creator_campaigns', {
    creator_id: creatorRow.id,
    status: 'PENDING_DEPOSIT',
    module: ERC20_PRIZE_MODULE,
    prize_token: WETH,
    prize_amount: prize.toString(),
    duration_seconds: '3600',
    winners_count: 10,
    slot_cap: 10,
    fee_amount: prizeFee.toString(),
    slots_cost: slotsCost.toString(),
    giveaway_id: null,
    tx_hash: null,
  });
  const prepared = await relay.prepareAction('creator-1', { kind: 'createCampaign' }, null);
  assert.equal(callsOf(prepared.tx).length, 4, 'three approvals and createGiveaway');
  const submitted = await relayAs('creator-1', creatorKey, { kind: 'createCampaign' });
  assert.equal(submitted.receipt.status, 'success');
  const approvals = parseEventLogs({ abi: ABI, eventName: 'Approval', logs: submitted.receipt.logs })
    .filter((event) => event.args.owner.toLowerCase() === creator.creator.safe.toLowerCase())
    .map((event) => `${event.address.toLowerCase()}>${event.args.spender.toLowerCase()}`);
  for (const expected of [
    `${WETH.toLowerCase()}>${ERC20_PRIZE_MODULE.toLowerCase()}`,
    `${WETH.toLowerCase()}>${GIVEAWAY_MANAGER_V2.toLowerCase()}`,
    `${USDC.toLowerCase()}>${GIVEAWAY_MANAGER_V2.toLowerCase()}`,
  ]) {
    assert.ok(approvals.includes(expected), `missing approval ${expected}; saw ${approvals}`);
  }
  const recorded = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [submitted.giveawayId]);
  assert.equal(recorded.creator.toLowerCase(), creator.creator.safe.toLowerCase());
  assert.equal(recorded.feeToken.toLowerCase(), WETH.toLowerCase(), 'the fee was not charged in the prize token');
  assert.equal(await read(WETH, ABI, 'balanceOf', [creator.creator.safe]), 0n);
});

// --- an NFT prize claimed through a prize module ------------------------------------

/**
 * Ten entrants in an NFT campaign — the player's account, entering with its
 * passkey, and nine others — then close, draw and settle on a seed that makes the
 * account the one winner. The ERC-721 claim and the ERC-1155 claim (E11) share it.
 */
async function playerWins(nftGiveaway) {
    // Ten entrants: the player's account, entering with its passkey, and nine others.
    const entrants = Array.from({ length: 9 }, () => privateKeyToAccount(generatePrivateKey()).address);
    for (const entrant of entrants) {
      await rpc.setBalance(entrant, 10n ** 17n);
      await rpc.impersonate(entrant);
    }
    const nftTree = buildTree([player.participant.safe, ...entrants].map((a) => a.toLowerCase()));
    await rpc.impersonate(bridgeRole);
    await rpc.send({ from: bridgeRole, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName: 'addEligibilityRoot', args: [nftGiveaway, nftTree.root] }) });
    await rpc.stopImpersonating(bridgeRole);
    const nftRoot = store.insert('bridge_v2_eligibility_roots', { giveaway_id: nftGiveaway.toString(), root_index: '0', root: nftTree.root, leaf_count: 10 });
    nftTree.addresses.forEach((address, position) => store.insert('bridge_v2_eligibility_leaves', { root_id: nftRoot.id, address, position }));
    store.insert('bridge_v2_entries', { participant_id: 'player-1', giveaway_id: nftGiveaway.toString(), status: 'ELIGIBLE', wallet_address: player.participant.safe, root_index: '0', self_custody: true, passkey: true, outcome: null });
    assert.equal((await relayAs('player-1', playerKey, { kind: 'enter', giveawayId: nftGiveaway })).receipt.status, 'success');
    for (const entrant of entrants) {
      const position = nftTree.addresses.indexOf(entrant.toLowerCase());
      const entered = await rpc.send({ from: entrant, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName: 'enter', args: [nftGiveaway, 0n, proofFor(nftTree, position)] }) });
      assert.equal(entered.status, '0x1');
    }

    // Close, draw, and settle on a seed that makes the account the one winner:
    // each seed is tried on a snapshot and thrown away if it does not.
    await rpc.increaseTime(3_700);
    const caller = entrants[0];
    const call = (functionName) => rpc.send({ from: caller, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName, args: [nftGiveaway] }) });
    assert.equal((await call('closeGiveaway')).status, '0x1');
    assert.equal((await call('requestDraw')).status, '0x1');
    const { vrfRequestId } = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [nftGiveaway]);
    const coordinator = await read(GIVEAWAY_MANAGER_V2, ABI, 'vrfCoordinator');
    await rpc.setBalance(coordinator, 10n ** 18n);
    let won = false;
    for (let word = 1n; word <= 200n && !won; word += 1n) {
      const attempt = await rpc.snapshot();
      await rpc.impersonate(caller);
      await rpc.impersonate(coordinator);
      await rpc.send({ from: coordinator, to: GIVEAWAY_MANAGER_V2, data: encodeFunctionData({ abi: ABI, functionName: 'rawFulfillRandomWords', args: [vrfRequestId, [word]] }) });
      await rpc.stopImpersonating(coordinator);
      assert.equal((await call('finalizeWinners')).status, '0x1');
      won = (await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'claimable', [nftGiveaway, player.participant.safe])) > 0n;
      if (!won) await rpc.revert(attempt);
    }
    for (const entrant of entrants) await rpc.stopImpersonating(entrant);
    assert.ok(won, 'no seed in 200 made the account the winner');
}

await test(['KM25', 'KM26', 'AC14', 'AE11'], 'an NFT prize is claimed by the account through the ERC-721 prize module, which delivers it with safeTransferFrom, and leaves by the relay’s transfer action', async () => {
  // The registered ERC-721 prize module: the one of the two NFT modules with itemsOf.
  let module721 = null;
  for (const candidate of ['0xafe9E198816DEa24e7f74e9D666c0F250aD688BC', '0xeb54e328F9F38222FA91e29D6c0367342B8EFD50']) {
    const answers = await read(candidate, ABI, 'itemsOf', [0n]).then(() => true, () => false);
    if (answers && (await read(GIVEAWAY_MANAGER_V2, ABI, 'isModuleRegistered', [candidate]))) module721 = candidate;
  }
  assert.ok(module721 !== null, 'no registered ERC-721 prize module');

  // A position NFT held by a plain account, which becomes the creator.
  const supply = await read(NPM, ABI, 'totalSupply');
  let tokenId = null;
  let brand = null;
  for (let back = 60n; back < 120n && tokenId === null; back += 1n) {
    const candidate = await read(NPM, ABI, 'tokenByIndex', [supply - back]);
    const owner = await read(NPM, ABI, 'ownerOf', [candidate]);
    if ((await client.getCode({ address: owner })) === undefined) {
      tokenId = candidate;
      brand = owner;
    }
  }
  assert.ok(tokenId !== null, 'no ERC-721 held by a plain account was found');
  const declaredValue = 10_000_000n;
  const nftFee = await read(GIVEAWAY_MANAGER_V2, ABI, 'currentFee', [1, declaredValue]);
  await rpc.setBalance(brand, 10n ** 18n);
  await setUsdcBalance(rpc, USDC, brand, nftFee + slotsCost);
  await rpc.impersonate(brand);
  const asBrand = async (to, data) => assert.equal((await rpc.send({ from: brand, to, data })).status, '0x1', `the brand's call to ${to} reverted`);
  await asBrand(NPM, encodeFunctionData({ abi: ABI, functionName: 'approve', args: [module721, tokenId] }));
  await asBrand(USDC, encodeFunctionData({ abi: ABI, functionName: 'approve', args: [GIVEAWAY_MANAGER_V2, nftFee + slotsCost] }));
  const prizeData = encodeAbiParameters([{ type: 'address' }, { type: 'uint256[]' }], [NPM, [tokenId]]);
  const created = await rpc.send({
    from: brand,
    to: GIVEAWAY_MANAGER_V2,
    data: encodeFunctionData({ abi: ABI, functionName: 'createGiveaway', args: [module721, prizeData, 1n, declaredValue, 3600n, 1, 10] }),
  });
  await rpc.stopImpersonating(brand);
  assert.equal(created.status, '0x1');
  const { giveawayIdFromLogs } = await import('../../../lib/bridge-v2/chain.ts');
  const nftGiveaway = giveawayIdFromLogs(created.logs);
  assert.ok(nftGiveaway !== null && nftGiveaway > giveawayId);

  await playerWins(nftGiveaway);

  // The claim, signed by the passkey: the module sends the NFT into the account.
  const claimed = await relayAs('player-1', playerKey, { kind: 'claim', giveawayId: nftGiveaway });
  assert.equal(claimed.receipt.status, 'success');
  assert.equal((await read(NPM, ABI, 'ownerOf', [tokenId])).toLowerCase(), player.participant.safe.toLowerCase());
  assert.equal(await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'claimable', [nftGiveaway, player.participant.safe]), 0n);
  // And out again, one item, as C7 asks: the amount stated is the one item.
  await assert.rejects(relay.prepareAction('player-1', { kind: 'transfer', giveawayId: nftGiveaway, to: destination, amount: 2n }, null), (error) => error.reason === 'amount');
  assert.equal((await relayAs('player-1', playerKey, { kind: 'transfer', giveawayId: nftGiveaway, to: destination, amount: 1n })).receipt.status, 'success');
  assert.equal((await read(NPM, ABI, 'ownerOf', [tokenId])).toLowerCase(), destination.toLowerCase());
});

// ===========================================================================
// Adenda E — the decisions after the final audit of piece 1, on the real contracts (AEn)
// ===========================================================================

/** A creator whose deposit address is the creator account (6.6.3), as creator/campaign/start leaves it. */
async function accountCreator(id, key) {
  const subject = await registerParticipant(id, key);
  const creatorRow = store.insert('bridge_v2_creators', { participant_id: id, wallet_index: null, wallet_address: subject.creator.safe });
  return { ...subject, creatorRow };
}

/** A draft priced as creator-1's: ten USDC to ten winners. */
const draftFor = (creatorId, status = 'PENDING_DEPOSIT', extra = {}) =>
  store.insert('bridge_v2_creator_campaigns', {
    creator_id: creatorId,
    status,
    module: ERC20_PRIZE_MODULE,
    prize_token: USDC,
    prize_amount: PRIZE.toString(),
    duration_seconds: '3600',
    winners_count: 10,
    slot_cap: 10,
    fee_amount: fee.toString(),
    slots_cost: slotsCost.toString(),
    giveaway_id: null,
    tx_hash: null,
    ...extra,
  });

await test(['AE3', 'AE7', 'AE10', 'AE11', 'KM8', 'AF7'], 'E3, E7, E10: the receipt of a creator account’s first transaction never comes — the next maintenance pass recognises the account from the chain and registers the campaign it created; its guardian revoked, it stays usable', async () => {
  const key = await createPasskey();
  const subject = await accountCreator('receipt-1', key);
  const draft = draftFor(subject.creatorRow.id);
  await setUsdcBalance(rpc, USDC, subject.creator.safe, PRIZE + fee + slotsCost);
  // The node takes the transaction and mines nothing until told to, so the relay's
  // bounded wait for the receipt runs out (RECEIPT_TIMEOUT_MS, the production value).
  await rpc.call('evm_setAutomine', [false]);
  let submitted;
  try {
    submitted = await relayAs('receipt-1', key, { kind: 'createCampaign' });
  } finally {
    await rpc.call('evm_mine', []);
    await rpc.call('evm_setAutomine', [true]);
  }
  assert.equal(submitted.receipt, null, 'the receipt came after all');
  const row = store.rows('bridge_v2_accounts').find((a) => a.id === subject.creator.id);
  assert.equal(row.deployed_at ?? null, null, 'marked without a receipt');
  assert.deepEqual([draft.status, draft.tx_hash], ['FUNDING', submitted.txHash], 'E7: the transaction is not on the draft');
  // The chain has both: the account, configured as 6.1 says, and the campaign.
  const mined = await client.getTransactionReceipt({ hash: submitted.txHash });
  assert.equal(mined.status, 'success');
  assert.equal(kchain.configurationRefusal(await kchain.accountState(subject.creator.safe), guardianAddress(), [subject.signer]), null);

  // The next maintenance pass: E3 recognises the account, E7 registers the campaign.
  assert.ok((await relay.recognizeDeployedAccounts(log, tick())) >= 1);
  assert.equal(typeof row.deployed_at, 'string', 'E3: the account was not recognised');
  assert.equal(await relay.reconcileRelayedCampaigns(log, tick()), 1);
  const { giveawayIdFromLogs } = await import('../../../lib/bridge-v2/chain.ts');
  const created = giveawayIdFromLogs(mined.logs);
  assert.ok(created !== null);
  assert.deepEqual([draft.status, draft.giveaway_id, draft.tx_hash], ['CONFIRMED', created.toString(), submitted.txHash]);
  const recorded = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [created]);
  assert.equal(recorded.creator.toLowerCase(), subject.creator.safe.toLowerCase());

  // E10: configured once, as the chain showed it, so a guardian its user revokes (R-3) leaves it usable.
  assert.equal((await relayAs('receipt-1', key, { kind: 'revokeGuardian' }, 'CREATOR')).receipt.status, 'success');
  const view = await relay.readAccount(await accounts.findAccount('receipt-1', 'CREATOR'));
  assert.deepEqual([view.state.guardians.length, view.configured, view.usable], [0, true, true]);
});

await test(['AE7', 'AE11'], 'E7: a relay campaign whose transaction the node never knew is released by the next pass, and the deposit still in the creator account is signed for again', async () => {
  const key = await createPasskey();
  const subject = await accountCreator('dropped-1', key);
  // C4: the account exists, configured, before the deposit.
  assert.equal((await relayAs('dropped-1', key, { kind: 'configure' }, 'CREATOR')).receipt.status, 'success');
  await setUsdcBalance(rpc, USDC, subject.creator.safe, PRIZE + fee + slotsCost);
  // A transaction recorded on the draft that was never mined, and that the node does not know.
  const lost = keccak256(toHex('keptra-e7-dropped'));
  const draft = draftFor(subject.creatorRow.id, 'FUNDING', { tx_hash: lost });
  await assert.rejects(relay.prepareAction('dropped-1', { kind: 'createCampaign' }, null), (error) => error.reason === 'campaign_in_flight');
  assert.equal(await relay.reconcileRelayedCampaigns(log, tick()), 1);
  assert.deepEqual([draft.status, draft.tx_hash], ['PENDING_DEPOSIT', null]);
  const signed = await relayAs('dropped-1', key, { kind: 'createCampaign' });
  assert.equal(signed.receipt.status, 'success');
  assert.deepEqual([draft.status, draft.giveaway_id], ['CONFIRMED', signed.giveawayId.toString()]);
  const recorded = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [signed.giveawayId]);
  assert.equal(recorded.creator.toLowerCase(), subject.creator.safe.toLowerCase());
  assert.equal(await usdcOf(subject.creator.safe), 0n);
});

await test(['AE2', 'AE11', 'KM16', 'KM18', 'KM19'], 'E2 on the real contracts: the 21st relayed transaction of the day is refused before anything is sent; the guardian’s confirmation still goes out, and the cancellation and the reaction to a compromise go out with the spend ceiling exhausted', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('volume-1', key);
  const safe = subject.participant.safe;
  assert.equal((await relayAs('volume-1', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  await setUsdcBalance(rpc, USDC, safe, 100n);
  const unit = { kind: 'transfer', giveawayId, to: destination, amount: 1n };
  for (let i = 0; i < 19; i += 1) assert.equal((await relayAs('volume-1', key, unit)).receipt.status, 'success', `transfer ${i}`);
  const counted = () => store.rows('bridge_v2_relayed_transactions').filter((row) => row.account_id === subject.participant.id).length;
  assert.equal(counted(), 20);
  assert.equal(await usdcOf(safe), 81n);
  const sentBefore = await client.getTransactionCount({ address: funderAddress(0) });
  await assert.rejects(relayAs('volume-1', key, unit), (error) => error.reason === 'relay_limit');
  assert.equal(await client.getTransactionCount({ address: funderAddress(0) }), sentBefore, 'the relayer sent the 21st');
  assert.equal(await usdcOf(safe), 81n);

  // A change of access: the guardian's confirmation is the bridge's transaction, not the account's.
  const replacement = await createPasskey();
  const replacementSigner = await kchain.signerAddressOf(replacement.x, replacement.y);
  const passkey = await accounts.registerPasskey('volume-1', replacement.credentialId, replacement.x, replacement.y, replacementSigner);
  const request_ = store.insert('bridge_v2_recoveries', {
    participant_id: 'volume-1',
    passkey_id: passkey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: 'volume-h',
    link_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(await recovery.confirmVerifiedRecoveries(log, tick()), 1);
  assert.equal(request_.status, 'CONFIRMED');
  // The shared spend ceiling is exhausted: nothing else the bridge pays for goes out.
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: false, error: null }));
  try {
    await assert.rejects(relay.sendAsRelayer([keptra.createSignerCall(replacement.x, replacement.y)], log).then((sent) => {
      if (sent === null) throw new Error('refused');
    }), /refused/);
    const cancelled = await relayAs('volume-1', key, { kind: 'cancelRecovery' }, 'PARTICIPANT');
    assert.equal(cancelled.receipt.status, 'success');
    const events = parseEventLogs({ abi: ABI, logs: cancelled.receipt.logs }).map((e) => e.eventName);
    assert.ok(events.includes('RecoveryCanceled') && events.includes('NonceInvalidated'), `events were ${events}`);
    const revoked = await relayAs('volume-1', key, { kind: 'revokeGuardian' }, 'PARTICIPANT');
    assert.equal(revoked.receipt.status, 'success');
    assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'guardiansCount', [safe]), 0n);
  } finally {
    db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  }
  assert.equal(counted(), 20, 'an always-possible transaction was counted');
  await recovery.advanceConfirmedRecoveries(log, tick());
  assert.equal(request_.status, 'CANCELED');
});

await test(['AE1', 'AE11', 'KM33'], 'E1 on the real contracts: after its derived wallet is migrated and sealed, the creator is handed its creator account as the deposit address and creates the campaign from it', async () => {
  const index = 905;
  const derived = wallet.addressOf(index);
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'sealed-creator', email_canonical: 'sealed@example.test', wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  store.insert('bridge_v2_creators', { participant_id: 'sealed-creator', wallet_index: index, wallet_address: derived });
  store.insert('bridge_v2_phones', { participant_id: 'sealed-creator', phone_hmac: 'sealed-phone', released_at: null });
  await accounts.registerPasskey('sealed-creator', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('sealed-creator', signer, guardianAddress())).filter((a) => a.role === 'CREATOR');
  await setUsdcBalance(rpc, USDC, derived, 2_000_000n);
  assert.equal((await relayAs('sealed-creator', key, { kind: 'configure' }, 'CREATOR')).receipt.status, 'success');
  // Authorised, moved and sealed as KM33 does it.
  const challenge = keptra.migrationChallenge(derived, account.safe);
  const assertion = await key.sign(challenge);
  const signature = keptra.assertionToSignature(challenge, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  assert.equal(await kchain.isValidPasskeySignature(challenge, signature, key.x, key.y), true);
  await accounts.authorizeMigration(index, derived, account.id, 'CREATOR');
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await accounts.isIndexSealed(index), true);
  assert.equal(await usdcOf(account.safe), 2_000_000n);

  // The creator starts a campaign: the address handed out is the creator account's, never the sealed wallet's.
  sessionFor('sealed-creator');
  const startRoute = await import('../../../api/bridge/v2/creator/campaign/start.ts');
  const statusRoute = await import('../../../api/bridge/v2/creator/campaign/status.ts');
  const started = await startRoute.POST(
    request('https://events.invalid/api/bridge/v2/creator/campaign/start', {
      cookie: 'iw_bridge_session=a-token-value',
      body: { module: ERC20_PRIZE_MODULE, prizeToken: USDC, prizeAmount: PRIZE.toString(), durationSeconds: 3600, winnersCount: 10, slotCap: 10 },
    }),
  );
  assert.equal(started.status, 200);
  const handed = await started.json();
  assert.equal(handed.depositAddress, account.safe, 'the sealed derived wallet was handed out');
  const status = await (await statusRoute.POST(request('https://events.invalid/api/bridge/v2/creator/campaign/status', { cookie: 'iw_bridge_session=a-token-value' }))).json();
  assert.equal(status.depositAddress, account.safe);
  // The deposit arrives there, and the creator account creates the campaign with its passkey.
  await setUsdcBalance(rpc, USDC, account.safe, BigInt(handed.prizeAmount) + BigInt(handed.feeAmount) + BigInt(handed.usdcForSlots));
  const created = await relayAs('sealed-creator', key, { kind: 'createCampaign' });
  assert.equal(created.receipt.status, 'success');
  const recorded = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [created.giveawayId]);
  assert.equal(recorded.creator.toLowerCase(), account.safe.toLowerCase());
  assert.equal(await usdcOf(derived), 0n, 'something reached the sealed wallet');
});

await test(['AE11', 'KM32', 'KM10', 'AC4'], 'the migration route on the real contracts: refused before the account is set up, then the challenge, the passkey’s authorisation checked by the signer code, and the move it allows', async () => {
  const index = 906;
  const derived = wallet.addressOf(index);
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'route-migrant', email_canonical: 'route-migrant@example.test', wallet_index: index, wallet_address: derived, telegram_chat_enc: null });
  await accounts.registerPasskey('route-migrant', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('route-migrant', signer, guardianAddress())).filter((a) => a.role === 'PARTICIPANT');
  await setUsdcBalance(rpc, USDC, derived, 1_250_000n);
  sessionFor('route-migrant');
  const migrateRoute = await import('../../../api/bridge/v2/account/migrate.ts');
  const call = (body) =>
    migrateRoute.POST(request('https://events.invalid/api/bridge/v2/account/migrate', { cookie: 'iw_bridge_session=a-token-value', body }));
  // C4: nothing is handed out before the account exists on-chain, configured.
  const early = await call({ kind: 'PARTICIPANT' });
  assert.equal(early.status, 409);
  assert.equal((await early.json()).challenge, undefined);
  assert.equal((await relayAs('route-migrant', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  const { challenge } = await (await call({ kind: 'PARTICIPANT' })).json();
  assert.equal(challenge, keptra.migrationChallenge(derived, account.safe));
  // An assertion over any other challenge is refused.
  const wrong = await key.sign(keptra.migrationChallenge(derived, derived));
  assert.equal((await call({ kind: 'PARTICIPANT', ...wrong })).status, 401);
  assert.equal(store.rows('bridge_v2_migrations').filter((m) => m.wallet_index === index).length, 0);
  // The right one: verified by the signer factory on the fork, then recorded.
  const assertion = await key.sign(challenge);
  const authorised = await call({ kind: 'PARTICIPANT', ...assertion });
  assert.equal((await authorised.json()).status, 'AUTHORIZED');
  assert.deepEqual(store.rows('bridge_v2_migrations').filter((m) => m.wallet_index === index).map((m) => m.kind), ['PARTICIPANT']);
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(derived), 0n);
  assert.equal(await usdcOf(account.safe), 1_250_000n);
  assert.equal(await accounts.isIndexSealed(index), true);
});

await test(['AE11', 'KM25', 'KM26'], 'an ERC-1155 prize is claimed by the account through the ERC-1155 prize module, and leaves by the relay’s transfer action, one unit', async () => {
  // The registered ERC-1155 prize module: the one of the two NFT modules with lotsOf.
  let module1155 = null;
  for (const candidate of ['0xafe9E198816DEa24e7f74e9D666c0F250aD688BC', '0xeb54e328F9F38222FA91e29D6c0367342B8EFD50']) {
    const answers = await read(candidate, ABI, 'lotsOf', [0n]).then(() => true, () => false);
    if (answers && (await read(GIVEAWAY_MANAGER_V2, ABI, 'isModuleRegistered', [candidate]))) module1155 = candidate;
  }
  assert.ok(module1155 !== null, 'no registered ERC-1155 prize module');
  const declaredValue = 10_000_000n;
  const nftFee = await read(GIVEAWAY_MANAGER_V2, ABI, 'currentFee', [1, declaredValue]);
  const { giveawayIdFromLogs } = await import('../../../lib/bridge-v2/chain.ts');

  // A unit held by a plain account that the module can take into custody: that account is the brand.
  const head = await client.getBlockNumber();
  const logs = await client.getLogs({ event: ABI.find((item) => item.type === 'event' && item.name === 'TransferSingle'), fromBlock: head - 5_000n, toBlock: head });
  let prize = null;
  for (const entry of logs.reverse().slice(0, 80)) {
    const { to: holder, id } = entry.args;
    if (holder === zeroAddress || (await client.getCode({ address: holder })) !== undefined) continue;
    const collection = entry.address;
    if ((await read(collection, ABI, 'balanceOf', [holder, id]).catch(() => 0n)) === 0n) continue;
    const attempt = await rpc.snapshot();
    await rpc.setBalance(holder, 10n ** 18n);
    await setUsdcBalance(rpc, USDC, holder, nftFee + slotsCost);
    await rpc.impersonate(holder);
    const send = (to, data) => rpc.send({ from: holder, to, data }).catch(() => ({ status: '0x0', logs: [] }));
    const approvedAll = await send(collection, encodeFunctionData({ abi: ABI, functionName: 'setApprovalForAll', args: [module1155, true] }));
    const approvedFee = await send(USDC, encodeFunctionData({ abi: ABI, functionName: 'approve', args: [GIVEAWAY_MANAGER_V2, nftFee + slotsCost] }));
    const prizeData = encodeAbiParameters([{ type: 'address' }, { type: 'uint256[]' }, { type: 'uint256[]' }], [collection, [id], [1n]]);
    const created = await send(
      GIVEAWAY_MANAGER_V2,
      encodeFunctionData({ abi: ABI, functionName: 'createGiveaway', args: [module1155, prizeData, 1n, declaredValue, 3600n, 1, 10] }),
    );
    await rpc.stopImpersonating(holder);
    if (approvedAll.status === '0x1' && approvedFee.status === '0x1' && created.status === '0x1') {
      prize = { collection, id, giveaway: giveawayIdFromLogs(created.logs) };
      break;
    }
    await rpc.revert(attempt);
  }
  assert.ok(prize !== null && prize.giveaway !== null, 'no ERC-1155 unit could be put into a campaign');

  await playerWins(prize.giveaway);
  // The claim, signed by the passkey: the module sends the unit into the account (A2).
  const unitsOf = (holder) => read(prize.collection, ABI, 'balanceOf', [holder, prize.id]);
  const before = await unitsOf(player.participant.safe);
  assert.equal((await relayAs('player-1', playerKey, { kind: 'claim', giveawayId: prize.giveaway })).receipt.status, 'success');
  assert.equal(await unitsOf(player.participant.safe), before + 1n);
  // Out again by the relay's transfer action: one prize position is one unit (C7).
  await assert.rejects(
    relay.prepareAction('player-1', { kind: 'transfer', giveawayId: prize.giveaway, to: destination, amount: 2n }, null),
    (error) => error.reason === 'amount',
  );
  const received = await unitsOf(destination);
  assert.equal((await relayAs('player-1', playerKey, { kind: 'transfer', giveawayId: prize.giveaway, to: destination, amount: 1n })).receipt.status, 'success');
  assert.equal(await unitsOf(destination), received + 1n);
  assert.equal(await unitsOf(player.participant.safe), before);
});

// ===========================================================================
// Adenda F — the decisions after the audit of 6ec6d50, on the real contracts (AFn)
// ===========================================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_AGO = () => new Date(Date.now() - 7 * DAY_MS - 60_000).toISOString();
const STALE = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

/** A legacy participant or creator with a derived wallet, a passkey and its account set up (C4). */
async function legacyWithAccount(id, index, kind) {
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  const derived = wallet.addressOf(index);
  const isCreator = kind === 'CREATOR';
  store.insert('bridge_v2_participants', {
    id,
    email_canonical: `${id}@example.test`,
    wallet_index: isCreator ? null : index,
    wallet_address: isCreator ? null : derived,
    telegram_chat_enc: null,
  });
  const creatorRow = isCreator ? store.insert('bridge_v2_creators', { participant_id: id, wallet_index: index, wallet_address: derived }) : null;
  await accounts.registerPasskey(id, key.credentialId, key.x, key.y, signer);
  const account = (await accounts.ensureAccounts(id, signer, guardianAddress())).find((a) => a.role === kind);
  assert.equal((await relayAs(id, key, { kind: 'configure' }, kind)).receipt.status, 'success');
  return { key, signer, derived, account, creatorRow };
}

await test(['AF1', 'KM19'], 'F1 on the real contracts: with the recorded guardian moved on (B6), R-3 still revokes the guardian the account holds, and the pass then records none', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('f1-held', key);
  await deployOnly(subject.participant, key, subject.signer);
  const safe = subject.participant.safe;
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [safe, guardianAddress()]), true);
  // B6: the rotation rewrote the recorded guardian; the account on-chain still holds the old key.
  const row = store.rows('bridge_v2_accounts').find((a) => a.id === subject.participant.id);
  row.guardian_address = privateKeyToAccount(generatePrivateKey()).address;
  const submitted = await relayAs('f1-held', key, { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success', 'the reaction to a compromise was refused while the account holds a guardian');
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'guardiansCount', [safe]), 0n);
  assert.equal(await read(keptra.RECOVERY_MODULE, ABI, 'isGuardian', [safe, guardianAddress()]), false);
  // The maintenance pass records what the chain holds now: none.
  await relay.reconcileGuardians(log, tick());
  assert.equal(row.guardian_address, null);
  // And the current guardian is added back by the account, as A6 says, then recorded again.
  assert.equal((await relayAs('f1-held', key, { kind: 'configure' }, 'PARTICIPANT')).receipt.status, 'success');
  assert.equal(row.guardian_address.toLowerCase(), guardianAddress().toLowerCase());
});

await test(['AF2', 'KM33', 'KM34'], 'F2 on the real contracts: a derived creator’s deposit is not moved while its draft is alive, and moves once the draft is gone; a draft nobody funded in seven days closes, one with its deposit does not', async () => {
  const subject = await legacyWithAccount('f2-creator', 908, 'CREATOR');
  await setUsdcBalance(rpc, USDC, subject.derived, 3_000_000n);
  await accounts.authorizeMigration(908, subject.derived, subject.account.id, 'CREATOR');
  const draft = draftFor(subject.creatorRow.id, 'PENDING_DEPOSIT', { creator: { wallet_address: subject.derived } });
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(subject.derived), 3_000_000n, 'the deposit moved while its draft was alive');
  assert.equal(await usdcOf(subject.account.safe), 0n);
  assert.equal(await accounts.isIndexSealed(908), false);
  // Seven days on, its deposit address holds USDC: F2's closure leaves it.
  draft.created_at = WEEK_AGO();
  await expireUnfundedDrafts(log, tick());
  assert.equal(draft.status, 'PENDING_DEPOSIT', 'a draft with its deposit was closed');
  // The draft stopped (an admin, FAILED): the deposit moves into the creator account and the index is sealed.
  draft.status = 'FAILED';
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(subject.derived), 0n);
  assert.equal(await usdcOf(subject.account.safe), 3_000_000n);
  assert.equal(await accounts.isIndexSealed(908), true);
  // An account creator's draft nobody funded for seven days: its balances read on the chain, closed.
  const idle = await accountCreator('f2-idle', await createPasskey());
  const unfunded = draftFor(idle.creatorRow.id, 'PENDING_DEPOSIT', { created_at: WEEK_AGO() });
  assert.equal(await usdcOf(idle.creator.safe), 0n);
  await expireUnfundedDrafts(log, tick());
  assert.equal(unfunded.status, 'EXPIRED');
});

/** A campaign still taking entries, created by creator-1's account through the relay. */
async function openCampaign() {
  store.insert('bridge_v2_creator_campaigns', {
    creator_id: creatorRow.id,
    status: 'PENDING_DEPOSIT',
    module: ERC20_PRIZE_MODULE,
    prize_token: USDC,
    prize_amount: PRIZE.toString(),
    duration_seconds: '3600',
    winners_count: 10,
    slot_cap: 10,
    fee_amount: fee.toString(),
    slots_cost: slotsCost.toString(),
    giveaway_id: null,
    tx_hash: null,
  });
  await setUsdcBalance(rpc, USDC, creator.creator.safe, PRIZE + fee + slotsCost);
  const created = await relayAs('creator-1', creatorKey, { kind: 'createCampaign' });
  assert.equal(created.receipt.status, 'success');
  const { readGiveaway } = await import('../../../lib/bridge-v2/chain.ts');
  assert.equal((await readGiveaway(created.giveawayId)).acceptsEntries, true);
  return created.giveawayId;
}

await test(['AF3', 'KM34', 'KM2'], 'F3 on the real contracts: an entry left in a campaign that no longer takes entries, never entered and with nothing to claim, is no right — the wallet is sealed; an entry in a campaign still taking entries is one', async () => {
  const { readGiveaway } = await import('../../../lib/bridge-v2/chain.ts');
  // The suite's first campaign is settled, and this wallet never entered it.
  assert.equal((await readGiveaway(giveawayId)).isSettled, true);
  const abandoned = await legacyWithAccount('f3-abandoned', 909, 'PARTICIPANT');
  store.insert('bridge_v2_entries', { participant_id: 'f3-abandoned', giveaway_id: giveawayId.toString(), status: 'VERIFIED', wallet_address: abandoned.derived, passkey: false, self_custody: false, outcome: null });
  await setUsdcBalance(rpc, USDC, abandoned.derived, 500_000n);
  await accounts.authorizeMigration(909, abandoned.derived, abandoned.account.id, 'PARTICIPANT');
  assert.equal(await migration.openRights('PARTICIPANT', abandoned.derived), 0);
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(abandoned.account.safe), 500_000n);
  assert.equal(await accounts.isIndexSealed(909), true, 'an abandoned entry kept the derived key');
  // A campaign that still takes entries: the entry may still be made, so it is a right.
  const open = await openCampaign();
  const waiting = await legacyWithAccount('f3-open', 910, 'PARTICIPANT');
  store.insert('bridge_v2_entries', { participant_id: 'f3-open', giveaway_id: open.toString(), status: 'VERIFIED', wallet_address: waiting.derived, passkey: false, self_custody: false, outcome: null });
  await setUsdcBalance(rpc, USDC, waiting.derived, 400_000n);
  await accounts.authorizeMigration(910, waiting.derived, waiting.account.id, 'PARTICIPANT');
  assert.equal(await migration.openRights('PARTICIPANT', waiting.derived), 1);
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await usdcOf(waiting.account.safe), 400_000n, 'the balance was not moved');
  assert.equal(await accounts.isIndexSealed(910), false, 'sealed with an entry its campaign still takes');
});

await test(['AF5', 'AE7'], 'F5 on the real contracts: a draft in FUNDING whose hash was never written is registered with the campaign its creator account created since, found on the chain; with none since, it is released', async () => {
  const key = await createPasskey();
  const subject = await accountCreator('f5-lost', key);
  await setUsdcBalance(rpc, USDC, subject.creator.safe, PRIZE + fee + slotsCost);
  const draft = draftFor(subject.creatorRow.id);
  const sent = await relayAs('f5-lost', key, { kind: 'createCampaign' });
  assert.equal(sent.receipt.status, 'success');
  // The request died between FUNDING and the hash: the move to FUNDING is all that was written.
  Object.assign(draft, { status: 'FUNDING', tx_hash: null, giveaway_id: null, updated_at: STALE() });
  await relay.reconcileRelayedCampaigns(log, tick());
  assert.deepEqual([draft.status, draft.giveaway_id], ['CONFIRMED', sent.giveawayId.toString()], 'the campaign on the chain was not registered, or the draft was released');
  // A creator account that created nothing since its draft: the chain shows it, and the draft is released.
  const idle = await accountCreator('f5-idle', await createPasskey());
  const waiting = draftFor(idle.creatorRow.id, 'FUNDING', { updated_at: STALE() });
  await relay.reconcileRelayedCampaigns(log, tick());
  assert.deepEqual([waiting.status, waiting.tx_hash], ['PENDING_DEPOSIT', null]);
});

await test(['AF6', 'KM34', 'KM32'], 'F6 on the real contracts: ETH above what a sweep of it costs is a balance; H7’s sweep would leave it, the migration’s last sweep takes it, and what is left is below that cost', async () => {
  const { sweepQuote, sweepRemainder } = await import('../../../lib/bridge-v2/chain.ts');
  const subject = await legacyWithAccount('f6-eth', 911, 'PARTICIPANT');
  const funder = funderAddress(0);
  const holdingNow = async () => (await migration.seedRetirementReadiness(recordingLogger())).holding;
  await rpc.setBalance(subject.derived, 0n);
  const without = await holdingNow();
  const { cost } = await sweepQuote(subject.derived, funder);
  assert.ok(cost > 0n);
  // Between one and two sweeps' cost: a balance for F6, not worth it for H7.
  const band = cost + cost / 2n;
  await rpc.setBalance(subject.derived, band);
  assert.equal(await holdingNow(), without + 1, 'ETH above a sweep’s cost was not counted');
  assert.equal(await sweepRemainder(911, subject.derived, funder, wallet.signAsDerived), null);
  assert.equal(await client.getBalance({ address: subject.derived }), band, 'H7’s sweep moved it');
  // The migration's last sweep.
  await accounts.authorizeMigration(911, subject.derived, subject.account.id, 'PARTICIPANT');
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await accounts.isIndexSealed(911), true);
  const left = await client.getBalance({ address: subject.derived });
  assert.ok(left < band, 'nothing was swept');
  // What it left is the unspent part of its own reservation, below the cost it had — which the seal keeps.
  const sealed = store.rows('bridge_v2_migrations').find((m) => m.wallet_index === 911);
  assert.ok(sealed.sweep_cost_wei !== undefined && sealed.sweep_cost_wei !== null, 'the seal did not keep the sweep’s cost');
  assert.ok(left <= BigInt(sealed.sweep_cost_wei), `left ${left} wei, above the sweep’s own cost ${sealed.sweep_cost_wei}`);
  assert.equal(await holdingNow(), without, 'a sealed wallet with ETH below its last sweep’s cost kept the seed');
});

await test(['AF8', 'KM34', 'KM33'], 'KM34 on the fork, for a creator: a derived creator wallet whose campaign still has prize to reclaim — read on the real contract — and a live draft are two rights: its deposit moves, its key stays, the seed stays', async () => {
  const subject = await legacyWithAccount('km34-creator', 912, 'CREATOR');
  const recorded = await read(GIVEAWAY_MANAGER_V2, GIVEAWAY_MANAGER_V2_ABI, 'getGiveaway', [giveawayId]);
  assert.ok(recorded.prizeDelivered < recorded.prizeAmount, 'the campaign has nothing left to reclaim');
  const campaign = draftFor(subject.creatorRow.id, 'CONFIRMED', { giveaway_id: giveawayId.toString(), creator: { wallet_address: subject.derived } });
  const live = draftFor(subject.creatorRow.id, 'PENDING_DEPOSIT', { creator: { wallet_address: subject.derived } });
  assert.equal(await migration.openRights('CREATOR', subject.derived), 2);
  await accounts.authorizeMigration(912, subject.derived, subject.account.id, 'CREATOR');
  await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, runDeadline());
  assert.equal(await accounts.isIndexSealed(912), false, 'sealed with rights still open');
  assert.equal((await migration.seedRetirementReadiness(recordingLogger())).ready, false);
});

export { TEST_MNEMONIC };
