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

import { createPublicClient, encodeFunctionData, http as viemHttp, parseEventLogs, zeroAddress, parseAbi } from 'viem';
import { arbitrum } from 'viem/chains';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { assert, deadline, recordingLogger, suite, test, TEST_FUNDER_KEYS, TEST_GUARDIAN_KEY, TEST_KEEPER_KEY, TEST_MNEMONIC, TEST_ROLE_KEY, realFetch } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } from '../memdb.mjs';
import { createPasskey } from '../passkey.mjs';
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
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
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
  assert.equal(keptra.refusalFor(account.safe, tx, null, guardianAddress()), null);
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
  await accounts.markDeployed(account.id, sent.hash);
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
  const code = await read(keptra.SAFE_PROXY_FACTORY, keptra.PROXY_FACTORY_ABI, 'proxyCreationCode');
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
  assert.equal((await kchain.singletonOf(creator.creator.safe)).toLowerCase(), keptra.SAFE_L2_SINGLETON.toLowerCase());
  assert.equal(await read(creator.creator.safe, keptra.SAFE_ABI, 'VERSION'), '1.4.1');
});

await test(['KM4', 'KM1'], 'the only owner is the passkey signer, threshold 1, deployed, and never the SharedSigner', async () => {
  const owners = await read(creator.creator.safe, keptra.SAFE_ABI, 'getOwners');
  assert.deepEqual(owners.map((o) => o.toLowerCase()), [creator.signer.toLowerCase()]);
  assert.equal(await read(creator.creator.safe, keptra.SAFE_ABI, 'getThreshold'), 1n);
  assert.equal(creator.signer, await read(keptra.SIGNER_FACTORY, keptra.SIGNER_FACTORY_ABI, 'getSigner', [creatorKey.x, creatorKey.y, keptra.VERIFIERS]));
  assert.equal(await kchain.hasCode(creator.signer), true);
  assert.ok(!owners.some((o) => o.toLowerCase() === keptra.SHARED_SIGNER.toLowerCase()));
  assert.equal(await kchain.hasCode(keptra.SHARED_SIGNER), true, 'the SharedSigner named here is not the deployed one');
});

await test(['KM5'], 'the signer was created with the precompile-only verifiers', async () => {
  const created = kchain.createdSigners(createReceipt.logs);
  assert.equal(created.length, 1);
  assert.equal(created[0].signer.toLowerCase(), creator.signer.toLowerCase());
  assert.equal(created[0].verifiers, keptra.VERIFIERS);
  assert.equal(keptra.VERIFIERS, 0x100n << 160n);
});

await test(['KM6', 'KM7'], 'the recovery module is the only module, with one guardian and threshold 1', async () => {
  const state = await kchain.accountState(creator.creator.safe);
  assert.equal(await read(creator.creator.safe, keptra.SAFE_ABI, 'isModuleEnabled', [keptra.RECOVERY_MODULE]), true);
  assert.deepEqual(state.modules.map((m) => m.toLowerCase()), [keptra.RECOVERY_MODULE.toLowerCase()]);
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'guardiansCount', [creator.creator.safe]), 1n);
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'isGuardian', [creator.creator.safe, guardianAddress()]), true);
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'threshold', [creator.creator.safe]), 1n);
});

await test(['KM20'], 'the fallback handler is the CompatibilityFallbackHandler and never the module (R-4, A2)', async () => {
  const state = await kchain.accountState(creator.creator.safe);
  assert.equal(state.fallbackHandler.toLowerCase(), keptra.FALLBACK_HANDLER.toLowerCase());
  assert.notEqual(state.fallbackHandler.toLowerCase(), keptra.RECOVERY_MODULE.toLowerCase());
  assert.equal(kchain.configurationRefusal(state, guardianAddress(), [creator.signer]), null);
  // The check run at creation fails when the handler is the module.
  assert.equal(
    kchain.configurationRefusal({ ...state, fallbackHandler: keptra.RECOVERY_MODULE }, guardianAddress(), [creator.signer]),
    'module_is_fallback_handler',
  );
  assert.ok(store.rows('bridge_v2_accounts').find((a) => a.id === creator.creator.id).deployed_at !== undefined);
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

await test(['KM10', 'KM36'], 'the relay refuses a signature over any other hash, and so does the account (GS024)', async () => {
  const prepared = await relay.prepareAction('player-1', { kind: 'enter', giveawayId }, null);
  const other = await playerKey.sign(keptra.migrationChallenge(zeroAddress, zeroAddress));
  await assert.rejects(
    relay.submitAction('player-1', { kind: 'enter', giveawayId }, null, prepared.tx.nonce, other, log),
    (error) => error instanceof relay.RelayRefusal && error.reason === 'bad_signature',
  );
  // On-chain, once the account exists: the same assertion is refused by the Safe.
  const signature = keptra.assertionToSignature(prepared.hash, other.authenticatorData, other.clientDataJSON, other.signature);
  assert.equal(signature, null, 'an assertion over another challenge was parsed as one over this hash');
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

await test(['KM26'], 'a prize transfer (ERC-20) out of the account, built from the chain and signed by the passkey', async () => {
  const held = await usdcOf(player.participant.safe);
  assert.ok(held > 0n);
  const submitted = await relayAs('player-1', playerKey, { kind: 'transfer', giveawayId, to: destination });
  assert.equal(submitted.receipt.status, 'success');
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
  const tx = keptra.safeTxFor(keptra.addGuardianCalls(player.signer), 0n);
  assert.equal(keptra.refusalFor(player.participant.safe, tx, null, guardianAddress()), 'guardian_mismatch');
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
  assert.equal(keptra.callsOf(prepared.tx).length, 2);
  const submitted = await relayAs('lost-1', lostKey, { kind: 'cancelRecovery' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  const events = parseEventLogs({ abi: keptra.RECOVERY_MODULE_ABI, logs: submitted.receipt.logs }).map((e) => e.eventName);
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

await test(['KM22'], 'a pending recovery nobody registered raises an alert and is never finalised', async () => {
  // The guardian key used outside the bridge: a confirmation with no request behind it.
  const rogue = privateKeyToAccount(`0x${'c3'.repeat(32)}`).address;
  const hash = await kchain.recoveryHash(lost.participant.safe, [rogue]);
  const signature = await privateKeyToAccount(TEST_GUARDIAN_KEY).sign({ hash });
  const sent = await relay.sendAsRelayer([kchain.confirmRecoveryCall(lost.participant.safe, [rogue], guardianAddress(), signature)], log);
  assert.equal(sent.receipt.status, 'success');
  assert.equal(await recovery.alertUnregisteredRecoveries(log), 1);
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

await test(['KM19'], 'R-3 as A6 corrects it: with a recovery pending, one transaction cancels, invalidates and revokes', async () => {
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
  assert.equal(keptra.callsOf(prepared.tx).length, 3);
  const submitted = await relayAs('revoke-1', key, { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'guardiansCount', [subject.participant.safe]), 0n);
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

  // A6: the account adds the (rotated) guardian back with the passkey.
  const added = await relayAs('revoke-1', key, { kind: 'addGuardian' }, 'PARTICIPANT');
  assert.equal(added.receipt.status, 'success');
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'isGuardian', [subject.participant.safe, guardian]), true);
});

await test(['KM19'], 'R-3 with no recovery pending does not revert: invalidate and revoke only (A6)', async () => {
  const key = await createPasskey();
  const subject = await registerParticipant('revoke-2', key);
  await deployOnly(subject.participant, key, subject.signer);
  const prepared = await relay.prepareAction('revoke-2', { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(keptra.callsOf(prepared.tx).length, 2);
  const submitted = await relayAs('revoke-2', key, { kind: 'revokeGuardian' }, 'PARTICIPANT');
  assert.equal(submitted.receipt.status, 'success');
  assert.equal(await read(keptra.RECOVERY_MODULE, keptra.RECOVERY_MODULE_ABI, 'guardiansCount', [subject.participant.safe]), 0n);
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

await test(['KM32', 'KM34', 'KM2'], 'a derived wallet with USDC: authorised by the passkey on-chain, moved to the account, then sealed', async () => {
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-1', email_canonical: 'legacy@example.test', wallet_index: derivedIndex, wallet_address: derivedAddress });
  await accounts.registerPasskey('legacy-1', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-1', signer, guardianAddress())).filter((a) => a.role === 'PARTICIPANT');
  await setUsdcBalance(rpc, USDC, derivedAddress, 3_000_000n);

  const before = await migration.seedRetirementReadiness();
  assert.equal(before.ready, false, 'readiness said ready with a derived wallet holding USDC');

  assert.equal(await authorize('legacy-1', key, 'PARTICIPANT', derivedAddress, account), 'AUTHORIZED');
  const sealed = await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, tick());
  assert.equal(sealed, 1);
  assert.equal(await usdcOf(derivedAddress), 0n);
  assert.equal(await usdcOf(account.safe), 3_000_000n);
  await assert.rejects(wallet.signAsDerived(derivedIndex, { chainId: 42161, to: derivedAddress, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, nonce: 0 }), /sealed/);
});

await test(['KM33'], 'the same for a creator’s derived wallet', async () => {
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-creator', email_canonical: 'brand@example.test', wallet_index: null, wallet_address: null });
  store.insert('bridge_v2_creators', { participant_id: 'legacy-creator', wallet_index: creatorIndex, wallet_address: creatorDerived });
  await accounts.registerPasskey('legacy-creator', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-creator', signer, guardianAddress())).filter((a) => a.role === 'CREATOR');
  await setUsdcBalance(rpc, USDC, creatorDerived, 1_500_000n);
  assert.equal(await authorize('legacy-creator', key, 'CREATOR', creatorDerived, account), 'AUTHORIZED');
  assert.equal(await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, tick()), 1);
  assert.equal(await usdcOf(creatorDerived), 0n);
  assert.equal(await usdcOf(account.safe), 1_500_000n);
  await assert.rejects(wallet.signAsDerived(creatorIndex, { chainId: 42161, to: creatorDerived, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, nonce: 0 }), /sealed/);
});

await test(['KM34'], 'with every derived wallet empty and sealed, the seed can be retired', async () => {
  const after = await migration.seedRetirementReadiness();
  assert.equal(after.ready, true, `still blocking: ${after.blocking}`);
});

await test(['KM34', 'KM2'], 'a derived wallet with a right still open is moved but not sealed (A8)', async () => {
  const index = 902;
  const address = wallet.addressOf(index);
  const key = await createPasskey();
  const signer = await kchain.signerAddressOf(key.x, key.y);
  store.insert('bridge_v2_participants', { id: 'legacy-2', email_canonical: 'legacy2@example.test', wallet_index: index, wallet_address: address });
  store.insert('bridge_v2_entries', { participant_id: 'legacy-2', giveaway_id: '999', status: 'VERIFIED', wallet_address: address, passkey: false, self_custody: false, outcome: null });
  await accounts.registerPasskey('legacy-2', key.credentialId, key.x, key.y, signer);
  const [account] = (await accounts.ensureAccounts('legacy-2', signer, guardianAddress())).filter((a) => a.role === 'PARTICIPANT');
  await setUsdcBalance(rpc, USDC, address, 700_000n);
  const challenge = keptra.migrationChallenge(address, account.safe);
  const assertion = await key.sign(challenge);
  const signature = keptra.assertionToSignature(challenge, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  assert.equal(await kchain.isValidPasskeySignature(challenge, signature, key.x, key.y), true);
  await accounts.authorizeMigration(index, address, account.id, 'PARTICIPANT');
  assert.equal(await migration.migrateAuthorizedWallets(log, TEST_FUNDER_KEYS.length, tick()), 0);
  assert.equal(await usdcOf(account.safe), 700_000n, 'the balance was not moved');
  assert.equal(await accounts.isIndexSealed(index), false, 'sealed with a right still open');
  assert.equal((await migration.seedRetirementReadiness()).ready, false);
});

export { TEST_MNEMONIC };
