/**
 * SPEC-BLOCO-03 piece 1 (MATRIZ-PECA1-KEPTRA M1-M46, tagged KMn), everything that
 * is not on-chain: the pure half of the accounts, the four account routes, the
 * pipeline's handling of an account entry, the recovery pass driven by a test
 * clock, the Telegram branch of A14, and migration 0012 executed on the embedded
 * Postgres. The on-chain half is test/bridge-v2/fork, against the real contracts.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, zeroAddress } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import {
  assert,
  deadline,
  http,
  jsonResponse,
  recordingLogger,
  request,
  suite,
  test,
  TEST_TELEGRAM_SECRET,
} from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import * as chain from '../doubles/chain.mjs';
import * as kchain from '../doubles/keptraChain.mjs';
import { KEPTRA_TABLES, KEPTRA_UNIQUE, memdb } from '../memdb.mjs';
import { createPasskey } from '../passkey.mjs';
import { callsOf } from '../safecalls.mjs';
import { applyMigration, asRole, attempt, bootEngine, createDatabase, sql } from '../pg.mjs';

import * as keptra from '../../../lib/bridge-v2/keptra.ts';
import * as accounts from '../../../lib/bridge-v2/accounts.ts';

import * as recovery from '../../../lib/bridge-v2/recovery.ts';
import { guardianAddress, roleCollisions } from '../../../lib/bridge-v2/guardian.ts';
import { getOrCreateParticipant } from '../../../lib/bridge-v2/participants.ts';
import { signAsDerived, addressOf } from '../../../lib/bridge-v2/wallet.ts';
import { notifySettlements, processEligibleEntries } from '../../../lib/bridge-v2/processor.ts';
import { storeTelegramChat, telegramChatOf, hashPhone } from '../../../lib/bridge-v2/phone.ts';
import { hashRecoveryCode } from '../../../lib/bridge-v2/linkcodes.ts';
import { buildTree, proofFor, verifyProof } from '../../../lib/bridge-v2/merkle.ts';
import * as config from '../../../lib/bridge-v2/config.ts';
import { CREATOR_CAMPAIGN_MANAGER_ABI } from '../../../lib/bridge-v2/abi.ts';

import * as register from '../../../api/bridge/v2/account/register.ts';
import * as relayRoute from '../../../api/bridge/v2/account/relay.ts';
import * as recoveryRoute from '../../../api/bridge/v2/account/recovery.ts';
import * as migrateRoute from '../../../api/bridge/v2/account/migrate.ts';
import * as webhook from '../../../api/bridge/v2/telegram/webhook.ts';

suite('keptra');

const root = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/');
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const url = (path) => `https://events.invalid/api/bridge/v2/${path}`;
const SESSION_COOKIE = 'iw_bridge_session=a-token-value';
const SAFE = '0x1111111111111111111111111111111111111111';
const SIGNER = '0x2222222222222222222222222222222222222222';

let store;

/** A clean slate: the Keptra tables in memory, both chain doubles reset, limits open. */
function fresh({ participantId = 'participant-1' } = {}) {
  db.reset();
  chain.reset();
  kchain.reset();
  http.reset();
  store = memdb(db, KEPTRA_TABLES, KEPTRA_UNIQUE);
  db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_acquire_funder', () => ({
    data: [{ funder_index: 0, address: addressOf(5), next_nonce: 3, lease_token: 'lease-1' }],
    error: null,
  }));
  for (const name of ['reconcile_funder_nonce', 'renew_funder_lease', 'release_funder', 'disable_funder']) {
    db.on(`rpc:bridge_v2_${name}`, () => ({ data: true, error: null }));
  }
  chain.set({ transactionCount: { latest: 3, pending: 3 } });
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
  http.on('api.resend.com', () => jsonResponse({ id: 'mail-1' }));
  http.on('api.telegram.org', () => jsonResponse({ ok: true }));
  // telegram_chat_enc written as the NULL Postgres would return for it.
  store.insert('bridge_v2_participants', { id: participantId, email_canonical: 'someone@example.test', wallet_index: null, wallet_address: null, telegram_chat_enc: null });
}

/** An account as the chain shows it once it exists with its configuration (6.1). */
const readyState = (owners = [SIGNER], guardians = [guardianAddress()], extra = {}) => ({
  deployed: true,
  nonce: 1n,
  owners,
  threshold: 1n,
  modules: [keptra.RECOVERY_MODULE],
  fallbackHandler: keptra.FALLBACK_HANDLER,
  guardians,
  guardianThreshold: 1n,
  recoveryExecuteAfter: 0n,
  recoveryNewOwners: [],
  ...extra,
});

const mails = () => http.requests.filter((r) => r.url.includes('resend')).map((r) => JSON.parse(r.body));
const telegrams = () => http.requests.filter((r) => r.url.includes('api.telegram.org')).map((r) => JSON.parse(r.body));

// ===========================================================================
// the pure half — keptra.ts
// ===========================================================================

await test(['KM5'], 'the verifiers are the precompile alone, as the factory encodes them: 0x100 << 160', () => {
  assert.equal(keptra.VERIFIERS, 0x100n << 160n);
  assert.equal(keptra.VERIFIERS.toString(16), `100${'0'.repeat(40)}`);
});

await test(['KM8'], 'an account address is computed before it exists, from the signer and the role alone', () => {
  const participant = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT');
  const creator = keptra.predictSafeAddress(SIGNER, 'CREATOR');
  assert.match(participant, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(participant.toLowerCase(), creator.toLowerCase(), 'A10: the two roles share an address');
  assert.equal(keptra.predictSafeAddress(SIGNER, 'PARTICIPANT'), participant, 'not deterministic');
  assert.notEqual(keptra.predictSafeAddress(SAFE, 'PARTICIPANT'), participant);
  // No chain was asked (6.1.6): the computation is local.
  assert.equal(kchain.calls.length + chain.calls.length, 0);
});

await test(['KM17'], 'R-1 refuses, before anything is signed, every new owner list it must refuse', () => {
  const guardian = '0x3333333333333333333333333333333333333333';
  const deployed = new Set([SIGNER, '0x4444444444444444444444444444444444444444'].map((a) => a.toLowerCase()));
  const refuse = (owners, set = deployed) => keptra.newOwnersRefusal(SAFE, owners, guardian, set);
  assert.equal(refuse([]), 'owner_count');
  assert.equal(refuse([SIGNER, SIGNER, SIGNER]), 'owner_count');
  assert.equal(refuse([zeroAddress]), 'owner_reserved');
  assert.equal(refuse([keptra.SENTINEL]), 'owner_reserved');
  assert.equal(refuse([SAFE]), 'owner_is_safe');
  assert.equal(refuse([guardian]), 'owner_is_guardian');
  assert.equal(refuse([SIGNER, SIGNER.toUpperCase().replace('0X', '0x')]), 'owner_duplicated');
  assert.equal(refuse([SIGNER], new Set()), 'owner_not_deployed');
  assert.equal(refuse([SIGNER]), null);
  assert.equal(refuse([SIGNER, '0x4444444444444444444444444444444444444444']), null, 'A3: two passkeys are allowed');
});

await test(['KM18'], 'R-2: a cancellation is cancelRecovery then invalidateNonce, as one batch through MultiSendCallOnly', () => {
  const calls = keptra.cancelRecoveryCalls();
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.to === keptra.RECOVERY_MODULE));
  assert.equal(calls[0].data, encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'cancelRecovery' }));
  assert.equal(calls[1].data, encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'invalidateNonce' }));
  const tx = keptra.safeTxFor(calls, 4n);
  assert.equal(tx.operation, 1);
  assert.equal(tx.to, keptra.MULTI_SEND_CALL_ONLY);
  const lower = (list) => list.map((c) => ({ to: c.to.toLowerCase(), data: c.data.toLowerCase() }));
  assert.deepEqual(lower(callsOf(tx)), lower(calls));
});

await test(['KM19'], 'R-3 as A6 corrects it: cancel only when pending, then invalidate, then revoke the guardian to threshold 0', () => {
  const guardian = '0x3333333333333333333333333333333333333333';
  const idle = keptra.revokeGuardianCalls(guardian, false);
  const pending = keptra.revokeGuardianCalls(guardian, true);
  assert.equal(idle.length, 2);
  assert.equal(pending.length, 3);
  assert.equal(pending[0].data, encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'cancelRecovery' }));
  assert.equal(pending[1].data, encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'invalidateNonce' }));
  assert.equal(
    pending[2].data,
    encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'revokeGuardianWithThreshold', args: [keptra.SENTINEL, guardian, 0n] }),
  );
});

const guardian = () => guardianAddress();
/** Adenda E9: calls production never builds, so their ABI lives here and not in keptra.ts. */
const REFUSED_SELF_ABI = parseAbi(['function setFallbackHandler(address)', 'function enableModule(address)', 'function disableModule(address,address)']);
const selfCall = (functionName, args) => ({ to: SAFE, data: encodeFunctionData({ abi: REFUSED_SELF_ABI, functionName, args }) });

await test(['KM20', 'KM21'], 'the closed list refuses setFallbackHandler, enableModule and disableModule on the account, alone or in a batch', () => {
  const refused = [
    selfCall('setFallbackHandler', [keptra.RECOVERY_MODULE]),
    selfCall('setFallbackHandler', [keptra.FALLBACK_HANDLER]),
    selfCall('enableModule', [keptra.RECOVERY_MODULE]),
    selfCall('disableModule', [keptra.SENTINEL, keptra.RECOVERY_MODULE]),
  ];
  for (const call of refused) {
    assert.equal(keptra.refusalFor(SAFE, [call], 1n, null, guardian()), 'self_call');
    assert.equal(keptra.refusalFor(SAFE, [{ to: config.USDC, data: '0x' }, call], 1n, null, guardian()), 'self_call', 'a batch smuggled it through');
  }
  // What the relay does build passes.
  assert.equal(keptra.refusalFor(SAFE, keptra.addOwnerCalls(SAFE, SIGNER), 1n, null, guardian()), null);
  assert.equal(keptra.refusalFor(SAFE, keptra.cancelRecoveryCalls(), 1n, null, guardian()), null);
});

await test(['KM21', 'AF10'], 'the closed list: delegatecall only to MultiSendCallOnly by construction, no nested batch, the configuration only at nonce 0', () => {
  // F10: the relay checks the calls before it encodes them, and safeTxFor is the
  // only encoder — one call goes out as a call, several as a delegatecall to
  // MultiSendCallOnly and to nothing else.
  const single = keptra.safeTxFor([{ to: config.USDC, data: '0x' }], 1n);
  assert.deepEqual([single.operation, single.to], [0, config.USDC]);
  const batch = keptra.safeTxFor([{ to: config.USDC, data: '0x' }, { to: config.USDC, data: '0x' }], 1n);
  assert.deepEqual([batch.operation, batch.to], [1, keptra.MULTI_SEND_CALL_ONLY]);
  assert.equal(keptra.refusalFor(SAFE, [{ to: keptra.MULTI_SEND_CALL_ONLY, data: '0x' }, { to: config.USDC, data: '0x' }], 1n, null, guardian()), 'nested_batch');
  const configuration = keptra.configurationCalls(SAFE, guardian());
  assert.equal(keptra.refusalFor(SAFE, [...configuration, { to: config.USDC, data: '0x' }], 0n, configuration, guardian()), null);
  assert.equal(keptra.refusalFor(SAFE, [...configuration], 3n, configuration, guardian()), 'configuration_not_first');
  // enableModule outside the configuration prefix is refused (R-5).
  assert.equal(keptra.refusalFor(SAFE, configuration, 5n, null, guardian()), 'self_call');
  // A guardian the caller does not allow is never named — and with none allowed, none is.
  const other = '0x5555555555555555555555555555555555555555';
  assert.equal(keptra.refusalFor(SAFE, keptra.addGuardianCalls(other), 1n, null, guardian()), 'guardian_mismatch');
  assert.equal(keptra.refusalFor(SAFE, keptra.revokeGuardianCalls(other, false), 1n, null, null), 'guardian_mismatch');
});

await test(['KM10'], 'an assertion is only turned into a signature for the challenge it was made over', async () => {
  const passkey = await createPasskey();
  const challenge = keptra.migrationChallenge(SAFE, SIGNER);
  const assertion = await passkey.sign(challenge);
  const parsed = keptra.assertionToSignature(challenge, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  assert.ok(parsed !== null);
  assert.equal(parsed.authenticatorData, assertion.authenticatorData);
  assert.equal(parsed.clientDataFields, '"origin":"https://keptra.io","crossOrigin":false');
  const other = keptra.migrationChallenge(SIGNER, SAFE);
  assert.equal(keptra.assertionToSignature(other, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature), null);
});

await test(['KM15'], 'the three notices fall at t0, t0 + 3.5 days and 24 hours before the end', () => {
  const t0 = new Date('2026-09-18T12:00:00Z');
  const end = new Date(t0.getTime() + 7 * 86_400_000);
  const at = (hours) => keptra.dueNoticeStages(t0, end, new Date(t0.getTime() + hours * 3_600_000));
  assert.deepEqual(at(0), ['START']);
  assert.deepEqual(at(83.9), ['START']);
  assert.deepEqual(at(84), ['START', 'MID']);
  assert.deepEqual(at(143.9), ['START', 'MID']);
  assert.deepEqual(at(144), ['START', 'MID', 'FINAL']);
  assert.deepEqual(at(168), [], 'notices after the end');
});

await test(['KM30'], 'the eligibility proof for an account address verifies against the root that holds it', () => {
  const account = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT').toLowerCase();
  const others = Array.from({ length: 9 }, (_u, i) => addressOf(100 + i).toLowerCase());
  const tree = buildTree([account, ...others]);
  const position = tree.addresses.indexOf(account);
  assert.ok(verifyProof(tree.root, account, proofFor(tree, position)));
});

// ===========================================================================
// static — the account paths, the seed, the contracts, the dependencies
// ===========================================================================

const ACCOUNT_PATHS = [
  'lib/bridge-v2/keptra.ts',
  'lib/bridge-v2/keptraChain.ts',
  'lib/bridge-v2/accounts.ts',
  'lib/bridge-v2/relay.ts',
  'lib/bridge-v2/recovery.ts',
  'lib/bridge-v2/guardian.ts',
  'api/bridge/v2/account/register.ts',
  'api/bridge/v2/account/relay.ts',
  'api/bridge/v2/account/recovery.ts',
  'api/bridge/v2/account/migrate.ts',
];

/** Every module a file reaches through relative imports, the file included. */
function closure(start) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = read(path).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, specifier] of text.matchAll(/from '(\.[^']+)\.js'/g)) {
      const parts = path.split('/').slice(0, -1);
      for (const segment of specifier.split('/')) {
        if (segment === '..') parts.pop();
        else if (segment !== '.') parts.push(segment);
      }
      visit(`${parts.join('/')}.ts`);
    }
  };
  visit(start);
  return seen;
}

await test(['KM1'], 'no account path reaches the derived-wallet key, directly or through anything it imports', () => {
  for (const path of ACCOUNT_PATHS) {
    assert.ok(!closure(path).has('lib/bridge-v2/wallet.ts'), `${path} reaches wallet.ts`);
  }
});

await test(['KM2'], 'only wallet.ts reads the derivation seed', () => {
  const walk = (dir, out = []) => {
    for (const name of readdirSync(`${root}${dir}`)) {
      const path = `${dir}/${name}`;
      if (statSync(`${root}${path}`).isDirectory()) walk(path, out);
      else if (path.endsWith('.ts')) out.push(path);
    }
    return out;
  };
  const readers = [...walk('lib'), ...walk('api')].filter(
    (path) => path !== 'lib/bridge-v2/env.ts' && /BRIDGE_V2_WALLET_SEED/.test(read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
  );
  assert.deepEqual(readers, ['lib/bridge-v2/wallet.ts']);
});

await test(['KM2'], 'a sealed index is refused by signAsDerived; an index still in use is signed for', async () => {
  fresh();
  store.insert('bridge_v2_migrations', { wallet_index: 7, derived_address: addressOf(7), account_id: 'a', kind: 'PARTICIPANT', sealed_at: new Date().toISOString() });
  store.insert('bridge_v2_migrations', { wallet_index: 8, derived_address: addressOf(8), account_id: 'b', kind: 'PARTICIPANT', sealed_at: null });
  const tx = { chainId: 42161, type: 'eip1559', to: SAFE, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, nonce: 0 };
  await assert.rejects(signAsDerived(7, tx), /sealed/);
  assert.match(await signAsDerived(8, tx), /^0x02/);
  assert.match(await signAsDerived(9, tx), /^0x02/);
});

await test(['KM43'], 'this piece deploys no contract: there is no Solidity in the repository', () => {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(`${root}${dir}`)) {
      if (['node_modules', '.git', 'dist'].includes(name)) continue;
      const path = dir === '' ? name : `${dir}/${name}`;
      if (statSync(`${root}${path}`).isDirectory()) walk(path);
      else if (path.endsWith('.sol')) found.push(path);
    }
  };
  walk('');
  assert.deepEqual(found, []);
});

await test(['KM46', 'AC14'], 'no new dependency: the manifest and the lockfile are main’s, read from git', () => {
  // C14: compared with main itself, not with a list written here.
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const main = JSON.parse(git('show', 'main:package.json'));
  const branch = JSON.parse(read('package.json'));
  assert.deepEqual(branch.dependencies, main.dependencies);
  assert.deepEqual(branch.devDependencies, main.devDependencies);
  assert.equal(git('diff', '--name-only', 'main', '--', 'package.json', 'package-lock.json').trim(), '');
});

await test(['KM39', 'F1'], 'the guardian key is a root of its own, read by guardian.ts alone', () => {
  const env = read('lib/bridge-v2/env.ts');
  assert.ok(env.includes("'BRIDGE_V2_GUARDIAN_KEY'"));
  const readers = ACCOUNT_PATHS.concat(['lib/bridge-v2/chain.ts', 'lib/bridge-v2/funders.ts', 'lib/bridge-v2/migration.ts', 'lib/bridge-v2/processor.ts'])
    .filter((path) => read(path).includes("requireEnv('BRIDGE_V2_GUARDIAN_KEY')"));
  assert.deepEqual(readers, ['lib/bridge-v2/guardian.ts']);
});

await test(['KM39'], 'every server role a distinct key: a collision is found and named', () => {
  chain.reset();
  assert.deepEqual(roleCollisions(), []);
  chain.set({ roleAddress: guardianAddress() });
  assert.deepEqual(roleCollisions(), ['guardian=bridge_role']);
  chain.reset();
});

await test(['KM39'], 'the maintenance pass alerts when two server roles share a key', async () => {
  fresh();
  const { TEST_CRON_SECRET } = await import('../harness.mjs');
  const maintenance = await import('../../../api/bridge/v2/cron/maintenance.ts');
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
  db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
  chain.set({ roleAddress: guardianAddress() });
  const response = await maintenance.GET(request(url('cron/maintenance'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }));
  const body = await response.json();
  assert.equal(body.accounts.roleKeysDistinct, false);
  const alerts = db.callsTo('bridge_v2_ops_events:insert').filter((c) => c.payload.kind === 'alert').map((c) => c.payload.detail.summary);
  assert.ok(alerts.includes('two server roles share a key'), `alerts were ${alerts}`);
});

// ===========================================================================
// the account routes — M9, M36, M10, A14
// ===========================================================================

async function registered(signer = SIGNER) {
  const passkey = await createPasskey();
  kchain.set({ signerAddressOf: signer });
  const response = await register.POST(
    request(url('account/register'), { cookie: SESSION_COOKIE, body: { x: passkey.x.toString(), y: passkey.y.toString(), credentialId: passkey.credentialId } }),
  );
  return { passkey, response, body: await response.json() };
}

await test(['KM9'], 'registering a passkey needs a session', async () => {
  fresh();
  db.on('bridge_v2_sessions:select', () => ({ data: null, error: null }));
  const passkey = await createPasskey();
  const response = await register.POST(
    request(url('account/register'), { body: { x: passkey.x.toString(), y: passkey.y.toString(), credentialId: passkey.credentialId } }),
  );
  assert.equal(response.status, 401);
  assert.equal(store.rows('bridge_v2_passkeys').length, 0);
});

await test(['KM9', 'KM8', 'KM3'], 'the first passkey fixes both accounts, written with their addresses before either exists', async () => {
  fresh();
  const { response, body } = await registered();
  assert.equal(response.status, 200);
  assert.equal(store.rows('bridge_v2_passkeys').length, 1);
  assert.equal(store.rows('bridge_v2_passkeys')[0].public_x !== undefined, true);
  const rows = store.rows('bridge_v2_accounts');
  assert.deepEqual(rows.map((r) => r.role).sort(), ['CREATOR', 'PARTICIPANT']);
  for (const row of rows) {
    assert.equal(row.safe_address, keptra.predictSafeAddress(SIGNER, row.role));
    assert.equal(row.deployed_at, undefined);
    assert.equal(row.guardian_address, guardianAddress());
  }
  assert.deepEqual(body.accounts.map((a) => a.deployed), [false, false]);
  // A second passkey adds no account (M3: one per role).
  const again = await registered('0x7777777777777777777777777777777777777777');
  assert.equal(again.response.status, 200);
  assert.equal(store.rows('bridge_v2_accounts').length, 2);
});

await test(['KM9', 'KM31'], 'a participant created at sign-in gets no derived wallet', async () => {
  fresh();
  const created = await getOrCreateParticipant('newcomer@example.test');
  assert.equal(created.walletIndex, null);
  assert.equal(created.walletAddress, null);
  assert.deepEqual(Object.keys(db.callsTo('bridge_v2_participants:insert')[0].payload), ['email_canonical']);
  assert.equal(db.callsTo('rpc:bridge_v2_next_wallet_index').length, 0, 'an index was reserved');
});

await test(['KM10'], 'the relay refuses a signature the signer contract does not accept, before the relayer is touched', async () => {
  fresh();
  const { passkey } = await registered();
  store.insert('bridge_v2_entries', { participant_id: 'participant-1', giveaway_id: '1', status: 'ELIGIBLE', wallet_address: keptra.predictSafeAddress(SIGNER, 'PARTICIPANT'), root_index: '0', passkey: true, self_custody: true });
  const account = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT').toLowerCase();
  const tree = buildTree([account, ...Array.from({ length: 9 }, (_u, i) => addressOf(40 + i).toLowerCase())]);
  const rootRow = store.insert('bridge_v2_eligibility_roots', { giveaway_id: '1', root_index: '0', root: tree.root });
  tree.addresses.forEach((address, position) => store.insert('bridge_v2_eligibility_leaves', { root_id: rootRow.id, address, position }));

  const prepared = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'enter', giveawayId: '1' } }));
  assert.equal(prepared.status, 200);
  const { safeTxHash, nonce } = await prepared.json();
  const assertion = await passkey.sign(safeTxHash);
  kchain.set({ isValidPasskeySignature: false });
  const refused = await relayRoute.POST(
    request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'enter', giveawayId: '1', nonce, ...assertion } }),
  );
  assert.equal(refused.status, 401);
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0);
  assert.equal(db.callsTo('rpc:bridge_v2_acquire_funder').length, 0);

  // A signature over another hash never reaches the chain question at all.
  const other = await passkey.sign(keptra.migrationChallenge(SAFE, SAFE));
  kchain.reset();
  kchain.set({ isValidPasskeySignature: true });
  const wrong = await relayRoute.POST(
    request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'enter', giveawayId: '1', nonce, ...other } }),
  );
  assert.equal(wrong.status, 401);
  assert.equal(kchain.calls.filter((c) => c.name === 'isValidPasskeySignature').length, 0);
});

await test(['KM36'], 'the account is always the session’s own, and another participant’s passkey is never found', async () => {
  fresh();
  const { passkey } = await registered();
  // The same database, and somebody else's session.
  store.insert('bridge_v2_participants', { id: 'participant-2', email_canonical: 'other@example.test', wallet_index: null, wallet_address: null });
  db.on('bridge_v2_sessions:select', () => ({
    data: {
      id: 'session-2',
      participant_id: 'participant-2',
      idle_expires_at: new Date(Date.now() + 60_000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    },
    error: null,
  }));
  const prepared = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'cancelRecovery' } }));
  assert.equal(prepared.status, 409, 'a session with no account of its own got an answer');
  assert.equal((await prepared.json()).error, 'Create your passkey first.');
  assert.equal(await accounts.findPasskey('participant-2', passkey.credentialId), null);
  // No request field can name an account: the route source takes none.
  const source = read('api/bridge/v2/account/relay.ts');
  assert.ok(!/body\.(safe|account|address|wallet)\b/.test(source));
});

await test(['KM14', 'KM9'], 'a change of access needs the session and a confirmed number, and returns a Telegram start link', async () => {
  fresh();
  const { passkey } = await registered();
  // E3: the account exists on-chain, which is what the route asks.
  kchain.set({ hasCode: true });
  const noPhone = await recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: passkey.credentialId } }));
  assert.equal(noPhone.status, 403);
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  const ok = await recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: passkey.credentialId } }));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.status, 'AWAITING_PHONE');
  assert.match(body.url, /^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]{16,}$/);
  const second = await recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: passkey.credentialId } }));
  assert.equal(second.status, 409, 'two live requests for one participant');
});

await test(['KM32', 'KM33'], 'a migration is authorised only by an owner passkey over the exact challenge, and recorded once', async () => {
  fresh();
  const derived = addressOf(12);
  store.rows('bridge_v2_participants')[0].wallet_index = 12;
  store.rows('bridge_v2_participants')[0].wallet_address = derived;
  const { passkey } = await registered();
  const account = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT');
  // C4: the account exists and is configured before it is a destination.
  kchain.set({ accountState: readyState() });

  const challengeResponse = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'PARTICIPANT' } }));
  const { challenge } = await challengeResponse.json();
  assert.equal(challenge, keptra.migrationChallenge(derived, account));

  const assertion = await passkey.sign(challenge);
  kchain.set({ isValidPasskeySignature: false });
  const refused = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'PARTICIPANT', ...assertion } }));
  assert.equal(refused.status, 401);
  assert.equal(store.rows('bridge_v2_migrations').length, 0);

  kchain.set({ isValidPasskeySignature: true });
  const authorised = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'PARTICIPANT', ...assertion } }));
  assert.equal((await authorised.json()).status, 'AUTHORIZED');
  const again = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'PARTICIPANT', ...assertion } }));
  assert.equal((await again.json()).status, 'ALREADY');
  assert.deepEqual(store.rows('bridge_v2_migrations').map((m) => [m.wallet_index, m.kind]), [[12, 'PARTICIPANT']]);
  // The on-chain check was asked about this challenge and this passkey.
  const asked = kchain.calls.filter((c) => c.name === 'isValidPasskeySignature').at(-1);
  assert.equal(asked.args[0], challenge);
  assert.equal(asked.args[2], passkey.x);

  // Without a derived wallet there is nothing to authorise.
  const creator = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'CREATOR' } }));
  assert.equal(creator.status, 404);
});

// ===========================================================================
// A14 and A5 — the Telegram branch of a change of access
// ===========================================================================

const telegramUpdate = (message) =>
  request(url('telegram/webhook'), { headers: { 'x-telegram-bot-api-secret-token': TEST_TELEGRAM_SECRET }, body: { update_id: 1, message } });

async function recoveryAwaitingPhone() {
  fresh();
  const passkey = await accounts.registerPasskey('participant-1', 'c'.repeat(22), 1n, 2n, SIGNER);
  const code = 'R'.repeat(22);
  store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-1',
    passkey_id: passkey.id,
    status: 'AWAITING_PHONE',
    link_code_hash: await hashRecoveryCode(code),
    link_expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  db.on('rpc:bridge_v2_claim_link_for_chat', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_consume_link_for_chat', () => ({ data: [], error: null }));
  return code;
}

await test(['KM14', 'KM15'], 'Telegram confirms a change of access only with the number the account holds, and keeps the chat encrypted (A5)', async () => {
  const code = await recoveryAwaitingPhone();
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: await hashPhone('351910000001'), released_at: null });
  await webhook.POST(telegramUpdate({ chat: { id: 4242 }, from: { id: 4242 }, text: `/start ${code}` }));
  assert.ok(store.rows('bridge_v2_recoveries')[0].telegram_chat_hmac, 'the chat was not attached');
  await webhook.POST(telegramUpdate({ chat: { id: 4242 }, from: { id: 4242 }, contact: { user_id: 4242, phone_number: '+351910000001' } }));
  const row = store.rows('bridge_v2_recoveries')[0];
  assert.equal(row.status, 'PHONE_VERIFIED');
  const participant = store.rows('bridge_v2_participants')[0];
  assert.ok(participant.telegram_chat_enc.startsWith('v1.'));
  assert.ok(!participant.telegram_chat_enc.includes('4242'), 'the chat id is stored in clear');
  assert.equal(await telegramChatOf('participant-1'), '4242');
});

await test(['KM14'], 'a different number does not confirm the change of access', async () => {
  const code = await recoveryAwaitingPhone();
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: await hashPhone('351910000001'), released_at: null });
  await webhook.POST(telegramUpdate({ chat: { id: 77 }, from: { id: 77 }, text: `/start ${code}` }));
  await webhook.POST(telegramUpdate({ chat: { id: 77 }, from: { id: 77 }, contact: { user_id: 77, phone_number: '+351919999999' } }));
  assert.equal(store.rows('bridge_v2_recoveries')[0].status, 'AWAITING_PHONE');
  assert.ok(telegrams().some((m) => m.text === 'This number is not the one confirmed for this account. The request was not confirmed.'));
});

// ===========================================================================
// the recovery pass — M15, M17, M22
// ===========================================================================

function confirmedRecovery(t0) {
  return store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-1',
    passkey_id: 'passkey-new',
    status: 'CONFIRMED',
    link_code_hash: 'h',
    link_expires_at: t0.toISOString(),
    started_at: t0.toISOString(),
    execute_after: new Date(t0.getTime() + 7 * 86_400_000).toISOString(),
  });
}

await test(['KM15'], 'with a test clock: three notices, each once, on email and on Telegram', async () => {
  fresh();
  await storeTelegramChat('participant-1', 99);
  const t0 = new Date('2026-09-18T12:00:00Z');
  const row = confirmedRecovery(t0);
  const recoveryRow = { id: row.id, participantId: 'participant-1', passkeyId: 'passkey-new', status: 'CONFIRMED', startedAt: row.started_at, executeAfter: row.execute_after };
  const log = recordingLogger();
  const at = (hours) => recovery.sendDueNotices(recoveryRow, new Date(t0.getTime() + hours * 3_600_000), log);
  assert.equal(await at(0), 2);
  assert.equal(await at(1), 0, 'START sent twice');
  assert.equal(await at(84), 2);
  assert.equal(await at(100), 0, 'MID sent twice');
  assert.equal(await at(144), 2);
  assert.equal(await at(160), 0, 'FINAL sent twice');
  assert.equal(mails().length, 3);
  assert.equal(telegrams().length, 3);
  assert.deepEqual(
    store.rows('bridge_v2_recovery_notices').map((n) => `${n.stage}:${n.channel}`).sort(),
    ['FINAL:EMAIL', 'FINAL:TELEGRAM', 'MID:EMAIL', 'MID:TELEGRAM', 'START:EMAIL', 'START:TELEGRAM'],
  );
  assert.ok(mails().every((m) => m.text.includes('https://keptra.io/account')));
  // R2/R3: the Telegram notice names no crypto and carries no link.
  assert.ok(telegrams().every((m) => !/https?:\/\//.test(m.text) && /Keptra account/.test(m.text)));
});

await test(['KM17'], 'R-1 refusing a new owner means nothing is signed and nothing is sent (0 calls)', async () => {
  fresh();
  const passkey = await accounts.registerPasskey('participant-1', 'k'.repeat(22), 1n, 2n, guardianAddress());
  store.insert('bridge_v2_accounts', { participant_id: 'participant-1', role: 'PARTICIPANT', safe_address: SAFE, initial_signer: SIGNER, guardian_address: guardianAddress(), deployed_at: new Date().toISOString() });
  store.insert('bridge_v2_recoveries', { participant_id: 'participant-1', passkey_id: passkey.id, status: 'PHONE_VERIFIED', link_code_hash: 'x', link_expires_at: new Date().toISOString() });
  kchain.set({ hasCode: true });
  assert.equal(await recovery.confirmVerifiedRecoveries(recordingLogger(), deadline()), 0);
  assert.equal(store.rows('bridge_v2_recoveries')[0].status, 'REFUSED');
  assert.equal(kchain.calls.filter((c) => ['recoveryHash', 'sendRelayed'].includes(c.name)).length, 0);
});

await test(['KM22'], 'R-6: the pass finalises a registered recovery whose period is over, and only that one', async () => {
  fresh();
  const passkey = await accounts.registerPasskey('participant-1', 'n'.repeat(22), 1n, 2n, SIGNER);
  store.insert('bridge_v2_accounts', { participant_id: 'participant-1', role: 'PARTICIPANT', safe_address: SAFE, initial_signer: SAFE, guardian_address: guardianAddress(), deployed_at: new Date().toISOString() });
  store.insert('bridge_v2_recoveries', { participant_id: 'participant-1', passkey_id: passkey.id, status: 'CONFIRMED', link_code_hash: 'x', link_expires_at: new Date().toISOString(), started_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), execute_after: new Date(Date.now() - 86_400_000).toISOString() });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const pendingState = (owners) => ({ deployed: true, nonce: 1n, owners: [SAFE], threshold: 1n, modules: [keptra.RECOVERY_MODULE], fallbackHandler: keptra.FALLBACK_HANDLER, guardians: [guardianAddress()], guardianThreshold: 1n, recoveryExecuteAfter: now - 10n, recoveryNewOwners: owners });
  // Somebody else's recovery on the account: not ours to finish.
  kchain.set({ accountState: pendingState(['0x9999999999999999999999999999999999999999']), chainNow: now });
  await recovery.advanceConfirmedRecoveries(recordingLogger(), deadline());
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0);
  // Ours: finalised.
  kchain.reset();
  kchain.set({ accountState: pendingState([SIGNER]), chainNow: now });
  await recovery.advanceConfirmedRecoveries(recordingLogger(), deadline());
  const sent = kchain.calls.filter((c) => c.name === 'sendRelayed');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args[1].data, encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'finalizeRecovery', args: [SAFE] }));
});

// ===========================================================================
// the pipeline and an account entry — M11, M29, M13, A4
// ===========================================================================

const DEFAULT_CAMPAIGN = {
  status: 1,
  isOpen: true,
  isSettled: false,
  endTime: 0n,
  effectiveEndTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
  acceptsEntries: true,
  prizeModule: zeroAddress,
  prizeKind: 0,
  prizeAmount: 10_000_000n,
  declaredValue: 0n,
  winnersCount: 1,
  feeToken: config.USDC,
  settledAt: 0n,
};

function passkeyEntry(overrides = {}) {
  return store.insert('bridge_v2_entries', {
    participant_id: 'participant-1',
    giveaway_id: '1',
    status: 'ELIGIBLE',
    wallet_address: SAFE,
    root_index: '0',
    tx_hash: null,
    self_custody: true,
    passkey: true,
    outcome: null,
    enter_reminder_at: null,
    ...overrides,
  });
}

await test(['KM11', 'KM29', 'KM24'], 'an account entry is never funded, signed or submitted by the pipeline, and is reminded once (A4)', async () => {
  fresh();
  passkeyEntry();
  store.insert('bridge_v2_eligibility_roots', { giveaway_id: '1', root_index: '0', root: 'published', created_at: new Date(Date.now() - 11 * 60_000).toISOString() });
  chain.set({ readGiveaway: DEFAULT_CAMPAIGN, hasEntered: false });
  await processEligibleEntries(recordingLogger(), deadline());
  await processEligibleEntries(recordingLogger(), deadline());
  const names = chain.calls.map((c) => c.name);
  for (const forbidden of ['fundDerivedWallet', 'submitAsDerived', 'quoteEntryCost', 'quoteClaim', 'prizeDelivery']) {
    assert.ok(!names.includes(forbidden), `the pipeline called ${forbidden} for an account entry`);
  }
  const entry = store.rows('bridge_v2_entries')[0];
  assert.equal(entry.funded_at, undefined, 'M29: an account entry was marked funded, so the sweep would list it');
  assert.equal(entry.status, 'ELIGIBLE');
  const sent = mails();
  assert.equal(sent.length, 1, 'A4: the reminder was not sent exactly once');
  assert.match(sent[0].text, /https:\/\/keptra\.io\/events\/1/);
  // Once the participant signs, the chain says so and the entry confirms.
  chain.set({ hasEntered: true });
  await processEligibleEntries(recordingLogger(), deadline());
  assert.equal(store.rows('bridge_v2_entries')[0].status, 'CONFIRMED');
  assert.ok(!chain.calls.some((c) => ['fundDerivedWallet', 'submitAsDerived'].includes(c.name)));
});

await test(['KM13'], 'a winner with an account is emailed a link to claim with the passkey', async () => {
  fresh();
  passkeyEntry({ status: 'CONFIRMED', participant: { email_canonical: 'winner@example.test' } });
  db.on('rpc:bridge_v2_campaigns_awaiting_outcome', () => ({ data: [{ giveaway_id: '1' }], error: null }));
  chain.set({
    readGiveaway: { ...DEFAULT_CAMPAIGN, status: 5, isOpen: false, isSettled: true, acceptsEntries: false, settledAt: BigInt(Math.floor(Date.now() / 1000) - 60) },
    claimableFor: 10_000_000n,
  });
  await notifySettlements(recordingLogger(), deadline());
  const sent = mails();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['winner@example.test']);
  assert.match(sent[0].text, /passkey/);
  assert.match(sent[0].text, /https:\/\/keptra\.io\/events\/1/);
  assert.ok(!/tell us the wallet/i.test(sent[0].text), 'an account winner was told to give a wallet');
});

// ===========================================================================
// Adenda C — the corrections after the audit of 1db7d21 (tagged ACn)
// ===========================================================================

/** Every .ts under lib/ and api/, with comments stripped. */
function productionSources() {
  const walk = (dir, out = []) => {
    for (const name of readdirSync(`${root}${dir}`)) {
      const path = `${dir}/${name}`;
      if (statSync(`${root}${path}`).isDirectory()) walk(path, out);
      else if (path.endsWith('.ts')) out.push(path);
    }
    return out;
  };
  return [...walk('lib'), ...walk('api')].map((path) => [
    path,
    read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
  ]);
}

// --- C1 and C14: reservations against the real budget ------------------------

await test(['AC1', 'AC14'], 'the time double is production’s rule: finding 1’s reservation is refused, the migration’s fits', () => {
  const run = deadline();
  assert.equal(run.hasTimeFor(config.RUN_BUDGET_MS + 1), false);
  assert.equal(run.hasTimeFor(360_000), false, 'the reservation of finding 1 would pass the double');
  assert.equal(run.hasTimeFor(config.MIGRATION_ASSET_MS), true);
  assert.equal(run.hasTimeFor(config.MIGRATION_SEAL_MS), true);
  assert.equal(run.hasTimeFor(config.RECOVERY_CONFIRM_MS), true);
  assert.equal(deadline(false).hasTimeFor(1), false);
});

await test(['AC1'], 'every reservation a maintenance step passes to hasTimeFor is declared in config.ts and inside the budget check', () => {
  const found = [];
  const collect = (where, text) => {
    for (const [, argument] of text.matchAll(/hasTimeFor\(([^)]*)\)/g)) found.push([where, argument.trim()]);
  };
  for (const path of ['lib/bridge-v2/migration.ts', 'lib/bridge-v2/recovery.ts', 'api/bridge/v2/cron/maintenance.ts']) {
    collect(path, read(path));
  }
  // The sweep, the one maintenance step that lives in processor.ts.
  const processor = read('lib/bridge-v2/processor.ts');
  const sweep = processor.slice(processor.indexOf('export async function sweepConfirmed'));
  collect('processor.ts sweepConfirmed', sweep.slice(0, sweep.indexOf('\nexport ', 1)));
  assert.ok(found.length >= 7, `only ${found.length} reservations found`);

  const source = read('lib/bridge-v2/config.ts');
  const block = source.slice(source.indexOf('export const EVERY_RESERVATION_MS'), source.indexOf('export const LARGEST_UNIT_MS'));
  for (const [where, name] of found) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${where}: hasTimeFor(${name}) is not a reservation named in config.ts`);
    assert.equal(typeof config[name], 'number', `${where}: ${name} is not exported by config.ts`);
    assert.match(block, new RegExp(`\\b${name}\\b`), `${where}: ${name} is not in EVERY_RESERVATION_MS`);
  }
  for (const [unit, ms] of Object.entries(config.EVERY_RESERVATION_MS)) {
    assert.ok(ms < config.RUN_BUDGET_MS, `${unit}: ${ms} ms does not fit the ${config.RUN_BUDGET_MS} ms budget`);
  }
});

// --- C2: an account on-chain without its module or guardian ------------------

await test(['AC2', 'KM6'], 'an account deployed without its module accepts only its completion, at nonce 0, through the closed list', async () => {
  fresh();
  const { passkey } = await registered();
  const bare = readyState([SIGNER], [], { nonce: 0n, modules: [] });
  kchain.set({ accountState: bare });
  for (const kind of ['cancelRecovery', 'revokeGuardian', 'createCampaign']) {
    const refused = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind, role: 'CREATOR' } }));
    assert.equal(refused.status, 409, kind);
    assert.equal((await refused.json()).error, 'Your account needs to finish its setup first. Confirm it with your passkey.', kind);
  }
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'configure' }, 'PARTICIPANT');
  const safe = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT');
  const lower = (list) => list.map((c) => ({ to: c.to.toLowerCase(), data: c.data.toLowerCase() }));
  assert.equal(prepared.tx.nonce, 0n);
  assert.deepEqual(lower(callsOf(prepared.tx)), lower(keptra.configurationCalls(safe, guardianAddress())));
  // The completion goes out with the passkey's signature and nothing else.
  kchain.set({ isValidPasskeySignature: true, hasCode: true });
  const assertion = await passkey.sign(prepared.hash);
  const submitted = await relayRoute.POST(
    request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'configure', nonce: '0', ...assertion } }),
  );
  assert.equal(submitted.status, 200);
  const sent = kchain.calls.filter((c) => c.name === 'sendRelayed');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].args[1].to.toLowerCase(), safe.toLowerCase(), 'the account was deployed again, or something else was sent');
});

await test(['AC2', 'AD1'], 'an account never configured that holds no guardian accepts only the guardian added back', async () => {
  fresh();
  await registered();
  // deployed_at is not set: the platform never saw this account configured (D1).
  kchain.set({ accountState: readyState([SIGNER], []) });
  const refused = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'cancelRecovery' } }));
  assert.equal(refused.status, 409);
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'configure' }, null);
  assert.deepEqual(callsOf(prepared.tx).map((c) => c.data), keptra.addGuardianCalls(guardianAddress()).map((c) => c.data));
  // Complete: configure has nothing to do, and every action is back.
  kchain.set({ accountState: readyState() });
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'configure' }, null), (error) => error.reason === 'already_configured');
});

// --- C3: an abandoned change of access -----------------------------------------

await test(['AC3', 'KM14'], 'a request whose Telegram link expired closes by itself and never blocks a new one', async () => {
  fresh();
  const { passkey } = await registered();
  kchain.set({ hasCode: true });
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  const open = () => recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: passkey.credentialId } }));
  assert.equal((await open()).status, 200);
  assert.equal((await open()).status, 409, 'a live request was stacked on another');
  // The link expires unused.
  store.rows('bridge_v2_recoveries')[0].link_expires_at = new Date(Date.now() - 1_000).toISOString();
  assert.equal((await open()).status, 200, 'the abandoned request blocked a new one');
  assert.deepEqual(store.rows('bridge_v2_recoveries').map((row) => row.status), ['EXPIRED', 'AWAITING_PHONE']);

  // With nobody asking: the maintenance pass closes the second one when its link expires.
  store.rows('bridge_v2_recoveries')[1].link_expires_at = new Date(Date.now() - 1_000).toISOString();
  const { TEST_CRON_SECRET } = await import('../harness.mjs');
  const maintenance = await import('../../../api/bridge/v2/cron/maintenance.ts');
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
  db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
  const response = await maintenance.GET(request(url('cron/maintenance'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }));
  assert.equal((await response.json()).accounts.recoveriesExpired, 1);
  assert.deepEqual(store.rows('bridge_v2_recoveries').map((row) => row.status), ['EXPIRED', 'EXPIRED']);
  assert.equal((await open()).status, 200);
  // Only a request still waiting on its link: one past the phone step is the pass's to finish.
  const verified = store.insert('bridge_v2_recoveries', { participant_id: 'participant-9', passkey_id: 'p9', status: 'PHONE_VERIFIED', link_code_hash: 'v', link_expires_at: new Date(Date.now() - 1_000).toISOString() });
  assert.equal(await accounts.expireAbandonedRecoveries(), 0);
  assert.equal(verified.status, 'PHONE_VERIFIED');
});

// --- C4: value only into accounts that exist, configured ------------------------

await test(['AC4'], 'the migration authorisation is refused, with no address shown, until the account is set up', async () => {
  fresh();
  store.rows('bridge_v2_participants')[0].wallet_index = 12;
  store.rows('bridge_v2_participants')[0].wallet_address = addressOf(12);
  await registered();
  for (const state of [undefined, readyState([SIGNER], [], { modules: [] }), readyState([SIGNER], [])]) {
    kchain.reset();
    if (state !== undefined) kchain.set({ accountState: state });
    const response = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'PARTICIPANT' } }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.challenge, undefined, 'a challenge naming the account was handed out');
  }
  kchain.set({ accountState: readyState() });
  const ready = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'PARTICIPANT' } }));
  assert.equal(ready.status, 200);
});

await test(['AC4', 'AD1'], 'the creator deposit address is shown only once the creator account is deployed and configured', async () => {
  fresh();
  await registered();
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  const startRoute = await import('../../../api/bridge/v2/creator/campaign/start.ts');
  const statusRoute = await import('../../../api/bridge/v2/creator/campaign/status.ts');
  const draft = { module: '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b', prizeToken: config.USDC, prizeAmount: '10000000', durationSeconds: 3600, winnersCount: 1, slotCap: 10 };
  const start = () => startRoute.POST(request(url('creator/campaign/start'), { cookie: SESSION_COOKIE, body: draft }));

  const refused = await start();
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).depositAddress, undefined);
  assert.equal(store.rows('bridge_v2_creator_campaigns').length, 0, 'a draft was opened for an address not yet shown');

  kchain.set({ accountState: readyState() });
  const started = await start();
  assert.equal(started.status, 200);
  const creatorSafe = keptra.predictSafeAddress(SIGNER, 'CREATOR');
  assert.equal((await started.json()).depositAddress, creatorSafe);

  // E3: start() read it configured on-chain, and marked it.
  assert.equal(typeof store.rows('bridge_v2_accounts').find((row) => row.role === 'CREATOR').deployed_at, 'string');
  // D1: never configured, no guardian — the address is not shown. E10: an
  // account never seen configured, so its mark is taken back for this.
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = null;
  });
  kchain.set({ accountState: readyState([SIGNER], []) });
  const status = () => statusRoute.POST(request(url('creator/campaign/status'), { cookie: SESSION_COOKIE }));
  assert.equal((await (await status()).json()).depositAddress, null);
  // D1: configured, and its guardian revoked by its user — still usable, still shown.
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = new Date().toISOString();
  });
  assert.equal((await (await status()).json()).depositAddress, creatorSafe);
  // D1: the module missing blocks it whatever the record says.
  kchain.set({ accountState: readyState([SIGNER], [], { modules: [] }) });
  assert.equal((await (await status()).json()).depositAddress, null);
});

await test(['AC4', 'AC6', 'AD1'], 'register shows an address only for a configured account, and recovery as active only with the current guardian on-chain', async () => {
  fresh();
  const first = await registered();
  // Not deployed yet: no address, no recovery.
  assert.deepEqual(first.body.accounts.map((a) => [a.address, a.deployed, a.configured, a.recoveryEnabled]), [
    [null, false, false, false],
    [null, false, false, false],
  ]);
  const view = async (state, signer) => {
    kchain.set({ accountState: state });
    return (await registered(signer)).body.accounts;
  };
  const current = await view(readyState(), '0x7777777777777777777777777777777777777777');
  assert.ok(current.every((a) => a.address !== null && a.configured && a.recoveryEnabled));
  // After a rotation the account still holds the old key: configured, but no working recovery (C6).
  const rotated = await view(readyState([SIGNER], ['0x3333333333333333333333333333333333333333']), '0x7676767676767676767676767676767676767676');
  assert.ok(rotated.every((a) => a.configured && !a.recoveryEnabled), 'a rotated-away guardian was shown as recovery');
  // Never configured, and no guardian (D1): neither. E10: the reads above found
  // the accounts configured on-chain and marked them; an account never seen so
  // is one with no mark.
  assert.ok(store.rows('bridge_v2_accounts').every((row) => typeof row.deployed_at === 'string'), 'E3: not marked when read configured');
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = null;
  });
  const bare = await view(readyState([SIGNER], []), '0x7575757575757575757575757575757575757575');
  assert.ok(bare.every((a) => a.address === null && !a.configured && !a.recoveryEnabled));
  // Configured, then its guardian revoked by its user (D1): usable, shown, no recovery (C6).
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = new Date().toISOString();
  });
  const revoked = await view(readyState([SIGNER], []), '0x7373737373737373737373737373737373737373');
  assert.ok(revoked.every((a) => a.address !== null && a.configured && !a.recoveryEnabled), 'a revoked, configured account was hidden');
});

await test(['AC4', 'AC7'], 'a transfer never goes into a platform account that is not set up', async () => {
  fresh();
  await registered();
  const other = keptra.predictSafeAddress('0x7474747474747474747474747474747474747474', 'PARTICIPANT');
  store.insert('bridge_v2_accounts', { participant_id: 'participant-2', role: 'PARTICIPANT', safe_address: other, initial_signer: SIGNER, guardian_address: guardianAddress() });
  const ours = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT');
  kchain.set({ accountState: (safe) => (safe.toLowerCase() === ours.toLowerCase() ? readyState() : { ...readyState(), deployed: false }) });
  chain.set({ erc20BalanceOf: 5n });
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  await assert.rejects(
    relayLib.prepareAction('participant-1', { kind: 'transfer', giveawayId: 1n, to: other.toLowerCase(), amount: 1n }, null),
    (error) => error.reason === 'destination_not_ready',
  );
});

// --- C5: erasure removes the chat ------------------------------------------------

await test(['AC5'], 'erasure on request removes the encrypted Telegram chat too', async () => {
  fresh();
  await storeTelegramChat('participant-1', 4242);
  assert.ok(store.rows('bridge_v2_participants')[0].telegram_chat_enc);
  db.on('rpc:bridge_v2_release_phone', () => ({ data: 1, error: null }));
  db.on('bridge_v2_sessions:update', () => ({ data: [{ id: 'session-1' }], error: null }));
  const erase = await import('../../../api/bridge/v2/privacy/erase.ts');
  const response = await erase.POST(request(url('privacy/erase'), { cookie: SESSION_COOKIE }));
  assert.equal(response.status, 200);
  const row = store.rows('bridge_v2_participants')[0];
  assert.equal(row.telegram_chat_enc, null, 'the chat survived erasure');
  assert.equal(await telegramChatOf('participant-1'), null);
  assert.match(row.email_canonical, /^erased-[0-9a-f]{32}@invalid$/);
});

// --- C7: the amount the owner stated --------------------------------------------

await test(['AC7', 'KM26'], 'a token transfer moves exactly the stated amount, never the whole balance, and never more than is held', async () => {
  fresh();
  await registered();
  const destination = '0x7373737373737373737373737373737373737373';
  const noAmount = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'transfer', giveawayId: '1', to: destination } }));
  assert.equal(noAmount.status, 400, 'a transfer with no amount was accepted');

  kchain.set({ accountState: readyState() });
  chain.set({ erc20BalanceOf: 9_000_000n });
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'transfer', giveawayId: 1n, to: destination, amount: 2_500_000n }, null);
  const [call] = callsOf(prepared.tx);
  assert.equal(call.to.toLowerCase(), config.USDC.toLowerCase());
  assert.equal(call.data, encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [destination, 2_500_000n] }));
  assert.ok(!chain.calls.some((c) => c.name === 'prizeDelivery'), 'the balance-sweeping builder was used for a token');
  await assert.rejects(
    relayLib.prepareAction('participant-1', { kind: 'transfer', giveawayId: 1n, to: destination, amount: 9_000_001n }, null),
    (error) => error.reason === 'amount',
  );
});

// --- C9: the relying party and the origin -----------------------------------------

await test(['AC9', 'KM10'], 'an assertion made for another site or another origin is refused before the chain is asked', async () => {
  const challenge = keptra.migrationChallenge(SAFE, SIGNER);
  for (const [options, what] of [
    [{ rpId: 'keptra.xyz' }, 'rpIdHash'],
    [{ origin: 'https://instntwin.com' }, 'origin'],
    [{ rpId: 'evil.example', origin: 'https://evil.example' }, 'both'],
  ]) {
    const foreign = await createPasskey(options);
    const assertion = await foreign.sign(challenge);
    assert.equal(
      keptra.assertionToSignature(challenge, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature),
      null,
      `an assertion with the wrong ${what} was accepted`,
    );
  }
  // Through the relay: 401, and the signer contract is never asked.
  fresh();
  const passkey = await createPasskey({ origin: 'https://keptra.io.evil.example' });
  kchain.set({ signerAddressOf: SIGNER });
  await register.POST(request(url('account/register'), { cookie: SESSION_COOKIE, body: { x: passkey.x.toString(), y: passkey.y.toString(), credentialId: passkey.credentialId } }));
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  kchain.set({ accountState: readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: 10n }), isValidPasskeySignature: true });
  const tx = await relayLib.prepareAction('participant-1', { kind: 'cancelRecovery' }, null);
  const assertion = await passkey.sign(tx.hash);
  const refused = await relayRoute.POST(
    request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'cancelRecovery', nonce: tx.tx.nonce.toString(), ...assertion } }),
  );
  assert.equal(refused.status, 401);
  assert.equal(kchain.calls.filter((c) => c.name === 'isValidPasskeySignature').length, 0);
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0);
});

// --- C11: guardian changes the relayer pays for -----------------------------------

await test(['AC11', 'AE2'], 'a fourth guardian added back in 24 hours is refused before anything is signed or sent; older ones do not count; a revocation is never refused', async () => {
  fresh();
  await registered();
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = new Date().toISOString();
  });
  kchain.set({ accountState: readyState([SIGNER], []) });
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const account = store.rows('bridge_v2_accounts').find((row) => row.role === 'PARTICIPANT');
  const change = (hoursAgo) => store.insert('bridge_v2_guardian_changes', { account_id: account.id, created_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString() });
  change(30);
  change(23);
  change(2);
  assert.equal((await relayLib.prepareAction('participant-1', { kind: 'configure' }, null)).guardianChange, true);
  change(1);
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'configure' }, null), (error) => error.reason === 'guardian_change_limit');
  const refused = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'configure' } }));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Recovery settings were changed too often today. Try again tomorrow.');
  // E2, as the owner decided on 19/09: the reaction to a compromise is always
  // possible — a revocation is not a C11 change, not counted, never refused.
  kchain.set({ accountState: readyState() });
  const revoke = await relayLib.prepareAction('participant-1', { kind: 'revokeGuardian' }, null);
  assert.equal(revoke.guardianChange, false);
  // Any other action is not a guardian change and is not limited by it.
  kchain.set({ accountState: readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: 10n }) });
  assert.equal((await relayLib.prepareAction('participant-1', { kind: 'cancelRecovery' }, null)).guardianChange, false);
});

// --- C13: nothing in production only the tests use -------------------------------

await test(['AC13', 'AD3'], 'production code carries nothing only the tests use, and RP_ID is used (C9)', () => {
  const sources = productionSources();
  for (const name of ['SHARED_SIGNER', 'singletonOf', 'createdSigners']) {
    const users = sources.filter(([, text]) => new RegExp(`\\b${name}\\b`).test(text)).map(([path]) => path);
    assert.deepEqual(users, [], `${name} is still in production code`);
  }
  // Removed by C13 when only the tests read it; back since Adenda D3 with a
  // production reader (the start of a request confirmed before it went overdue).
  const period = sources.filter(([, text]) => /\bRECOVERY_PERIOD_SECONDS\b/.test(text)).map(([path]) => path);
  assert.deepEqual(period, ['lib/bridge-v2/keptra.ts', 'lib/bridge-v2/recovery.ts'], 'RECOVERY_PERIOD_SECONDS is declared for the tests alone');
  const chainHalf = sources.find(([path]) => path === 'lib/bridge-v2/keptraChain.ts')[1];
  assert.ok(!/export \{/.test(chainHalf), 'a re-export is left in keptraChain.ts');
  const pure = sources.find(([path]) => path === 'lib/bridge-v2/keptra.ts')[1];
  assert.ok((pure.match(/\bRP_ID\b/g) ?? []).length >= 2, 'RP_ID is declared and never used');
});

// ===========================================================================
// Adenda D — the decisions after the correction of piece 1 (ADn)
// ===========================================================================

const lowerCalls = (list) => list.map((c) => ({ to: c.to.toLowerCase(), data: c.data.toLowerCase() }));
const markConfigured = () =>
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = new Date().toISOString();
  });

// --- D1: what a missing configuration is, and a guardian compromise --------------

await test(['AD1', 'AC2', 'AC4'], 'D1: a configured account whose guardian its user revoked keeps every action, and configure adds the current guardian back', async () => {
  fresh();
  await registered();
  markConfigured();
  const second = await createPasskey();
  const secondSigner = '0x7272727272727272727272727272727272727272';
  await accounts.registerPasskey('participant-1', second.credentialId, second.x, second.y, secondSigner);
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const ours = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT');
  const revoked = readyState([SIGNER], []);
  const prepare = (action, state) => {
    kchain.set({ accountState: state });
    return relayLib.prepareAction('participant-1', action, null);
  };
  const refusal = (action, state) => prepare(action, state).then(() => null, (error) => error.reason);

  // Usable: a second passkey is prepared exactly as on any configured account.
  const added = await prepare({ kind: 'addPasskey', credentialId: second.credentialId }, revoked);
  assert.deepEqual(lowerCalls(callsOf(added.tx)), lowerCalls(keptra.addOwnerCalls(ours, secondSigner)));
  // Nothing to revoke or cancel, said as such — never "finish your setup".
  assert.equal(await refusal({ kind: 'revokeGuardian' }, revoked), 'no_guardian');
  assert.equal(await refusal({ kind: 'cancelRecovery' }, revoked), 'no_recovery');
  // configure adds the platform's current guardian, and nothing else.
  const configured = await prepare({ kind: 'configure' }, revoked);
  assert.deepEqual(lowerCalls(callsOf(configured.tx)), lowerCalls(keptra.addGuardianCalls(guardianAddress())));
  // C4 as D1 reads it: such an account can receive a transfer.
  const other = keptra.predictSafeAddress('0x7474747474747474747474747474747474747474', 'PARTICIPANT');
  store.insert('bridge_v2_accounts', { participant_id: 'participant-2', role: 'PARTICIPANT', safe_address: other, initial_signer: SIGNER, guardian_address: guardianAddress(), deployed_at: new Date().toISOString() });
  chain.set({ erc20BalanceOf: 5n });
  const transfer = await prepare(
    { kind: 'transfer', giveawayId: 1n, to: other.toLowerCase(), amount: 1n },
    (safe) => (safe.toLowerCase() === other.toLowerCase() ? revoked : readyState()),
  );
  assert.equal(callsOf(transfer.tx).length, 1);

  // What D1 still blocks: the module not enabled, whatever the record says ...
  assert.equal(
    await refusal({ kind: 'addPasskey', credentialId: second.credentialId }, readyState([SIGNER], [], { modules: [] })),
    'configuration_incomplete',
  );
  // ... and an account the platform never saw configured.
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = null;
  });
  assert.equal(await refusal({ kind: 'addPasskey', credentialId: second.credentialId }, revoked), 'configuration_incomplete');
});

await test(['AD1'], 'D1: during a guardian compromise configure is refused until the rotation, and no transaction adds a listed key', async () => {
  fresh();
  await registered();
  store.rows('bridge_v2_accounts').find((row) => row.role === 'PARTICIPANT').deployed_at = new Date().toISOString();
  const creatorSafe = keptra.predictSafeAddress(SIGNER, 'CREATOR');
  // The participant account revoked the compromised key (R-3); the creator account does not exist yet.
  kchain.set({
    accountState: (safe) => (safe.toLowerCase() === creatorSafe.toLowerCase() ? { ...readyState(), deployed: false, nonce: 0n } : readyState([SIGNER], [])),
  });
  const compromised = guardianAddress();
  store.insert('bridge_v2_guardian_incidents', { guardian_address: compromised.toLowerCase() });
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const refusal = (action, role = null) => relayLib.prepareAction('participant-1', action, role).then(() => null, (error) => error.reason);

  assert.equal(await refusal({ kind: 'configure' }), 'guardian_incident');
  const response = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'configure' } }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'Recovery cannot be set up while its key is being replaced. Try again later.');
  // The account itself stays usable meanwhile.
  assert.equal(await refusal({ kind: 'cancelRecovery' }), 'no_recovery');
  // A first transaction would add the key the creator account was registered with.
  assert.equal(await refusal({ kind: 'configure' }, 'CREATOR'), 'guardian_incident');
  assert.equal(await refusal({ kind: 'createCampaign' }), 'guardian_incident');

  const previous = process.env.BRIDGE_V2_GUARDIAN_KEY;
  process.env.BRIDGE_V2_GUARDIAN_KEY = generatePrivateKey();
  try {
    // Rotated: configure adds the new key.
    const rotated = guardianAddress();
    assert.notEqual(rotated.toLowerCase(), compromised.toLowerCase());
    const readded = await relayLib.prepareAction('participant-1', { kind: 'configure' }, null);
    assert.deepEqual(lowerCalls(callsOf(readded.tx)), lowerCalls(keptra.addGuardianCalls(rotated)));
    // The creator account still names the compromised key until B6 updates its row.
    assert.equal(await refusal({ kind: 'configure' }, 'CREATOR'), 'guardian_incident');
    store.rows('bridge_v2_accounts').find((row) => row.role === 'CREATOR').guardian_address = rotated;
    const created = await relayLib.prepareAction('participant-1', { kind: 'configure' }, 'CREATOR');
    assert.deepEqual(lowerCalls(callsOf(created.tx)), lowerCalls(keptra.configurationCalls(creatorSafe, rotated)));
    // The compromised key put back as the configured one is refused again: never re-added.
    process.env.BRIDGE_V2_GUARDIAN_KEY = previous;
    assert.equal(await refusal({ kind: 'configure' }), 'guardian_incident');
  } finally {
    process.env.BRIDGE_V2_GUARDIAN_KEY = previous;
  }
});

// --- D3: a change of access that does not reach CONFIRMED in 24 hours --------------

const HOUR_MS = 3_600_000;
const alertsLogged = () =>
  db.callsTo('bridge_v2_ops_events:insert').filter((c) => c.payload.kind === 'alert').map((c) => c.payload.detail.summary);

async function maintenancePass() {
  const { TEST_CRON_SECRET } = await import('../harness.mjs');
  const maintenance = await import('../../../api/bridge/v2/cron/maintenance.ts');
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
  db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
  const response = await maintenance.GET(request(url('cron/maintenance'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }));
  return response.json();
}

await test(['AD3', 'AC3'], 'D3: a request not CONFIRMED 24 hours after it was opened expires with an alert, and never blocks a new one past that', async () => {
  fresh();
  const { passkey } = await registered();
  markConfigured();
  kchain.set({ hasCode: true });
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  kchain.set({ accountState: readyState() });
  const open = () => recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: passkey.credentialId } }));
  const verified = (row, hoursAgo) =>
    Object.assign(row, { status: 'PHONE_VERIFIED', created_at: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString() });

  assert.equal((await open()).status, 200);
  const first = verified(store.rows('bridge_v2_recoveries')[0], 23.9);
  assert.equal((await open()).status, 409, 'a request inside its 24 hours was closed');
  verified(first, 24.01);
  // Asked again past the 24 hours: closed on the spot, not at the next pass.
  assert.equal((await open()).status, 200, 'a request past its 24 hours blocked a new one');
  assert.deepEqual(store.rows('bridge_v2_recoveries').map((row) => row.status), ['EXPIRED', 'AWAITING_PHONE']);
  assert.ok(alertsLogged().includes('change of access not confirmed within 24 hours of being opened'), `alerts were ${alertsLogged()}`);

  // With nobody asking, the maintenance pass closes it, and never signs for it first.
  const second = verified(store.rows('bridge_v2_recoveries')[1], 25);
  assert.equal(await recovery.confirmVerifiedRecoveries(recordingLogger(), deadline()), 0);
  assert.equal(kchain.calls.filter((c) => ['recoveryHash', 'sendRelayed'].includes(c.name)).length, 0, 'signed for a request past its 24 hours');
  assert.equal(second.status, 'PHONE_VERIFIED');
  assert.equal((await maintenancePass()).accounts.recoveriesOverdue, 1);
  assert.equal(second.status, 'EXPIRED');

  // CONFIRMED is never closed, however old: the module is running its seven days.
  store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-1',
    passkey_id: store.rows('bridge_v2_passkeys')[0].id,
    status: 'CONFIRMED',
    link_code_hash: 'confirmed',
    link_expires_at: new Date(Date.now() - 72 * HOUR_MS).toISOString(),
    created_at: new Date(Date.now() - 72 * HOUR_MS).toISOString(),
    started_at: new Date(Date.now() - 71 * HOUR_MS).toISOString(),
    execute_after: new Date(Date.now() + 97 * HOUR_MS).toISOString(),
  });
  assert.equal(await recovery.closeOverdueRecoveries(recordingLogger(), deadline()), 0);
  assert.equal((await open()).status, 409);
  assert.equal(store.rows('bridge_v2_recoveries').at(-1).status, 'CONFIRMED');
});

await test(['AD3'], 'D3: a request the guardian already confirmed on an account becomes CONFIRMED at 24 hours, with an alert, and gets its notices', async () => {
  fresh();
  await registered();
  markConfigured();
  const replacement = await createPasskey();
  const NEW = '0x7171717171717171717171717171717171717171';
  const passkey = await accounts.registerPasskey('participant-1', replacement.credentialId, replacement.x, replacement.y, NEW);
  const request_ = store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-1',
    passkey_id: passkey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: 'partial',
    link_expires_at: new Date(Date.now() - 24 * HOUR_MS).toISOString(),
    created_at: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
  });
  // Confirmed on the participant account; the pass then failed on the creator one.
  const now = BigInt(Math.floor(Date.now() / 1000));
  const executeAfter = now + 6n * 86_400n;
  const participantSafe = keptra.predictSafeAddress(SIGNER, 'PARTICIPANT');
  kchain.set({
    chainNow: now,
    accountState: (safe) =>
      safe.toLowerCase() === participantSafe.toLowerCase()
        ? readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: executeAfter, recoveryNewOwners: [NEW] })
        : readyState(),
  });
  const log = recordingLogger();
  assert.equal(await recovery.closeOverdueRecoveries(log, deadline()), 1);
  assert.equal(request_.status, 'CONFIRMED');
  assert.equal(request_.execute_after, new Date(Number(executeAfter) * 1000).toISOString());
  assert.equal(request_.started_at, new Date(Number(executeAfter - keptra.RECOVERY_PERIOD_SECONDS) * 1000).toISOString());
  assert.ok(
    log.events.some((e) => e.kind === 'alert' && e.detail.summary === 'change of access confirmed on some accounts only, 24 hours after it was opened'),
  );
  // From here it is an ordinary confirmed request: the owner is told (6.3.2).
  await recovery.advanceConfirmedRecoveries(recordingLogger(), deadline());
  assert.deepEqual(store.rows('bridge_v2_recovery_notices').map((n) => `${n.stage}:${n.channel}`), ['START:EMAIL']);
  assert.equal(mails().length, 1);
});

// --- D4: an account not deployed follows the new passkey ----------------------------

await test(['AD4'], 'D4: a finalised recovery gives an account not deployed the new passkey’s address; a deployed one, or a cancelled recovery, changes nothing', async () => {
  fresh();
  const OLD = SIGNER;
  const NEW = '0x7070707070707070707070707070707070707070';
  const passkey = await accounts.registerPasskey('participant-1', 'd'.repeat(22), 1n, 2n, NEW);
  const deployedSafe = keptra.predictSafeAddress(OLD, 'CREATOR');
  const oldPending = keptra.predictSafeAddress(OLD, 'PARTICIPANT');
  const newPending = keptra.predictSafeAddress(NEW, 'PARTICIPANT');
  const deployedRow = store.insert('bridge_v2_accounts', { participant_id: 'participant-1', role: 'CREATOR', safe_address: deployedSafe, initial_signer: OLD, guardian_address: guardianAddress(), deployed_at: new Date().toISOString() });
  const pendingRow = store.insert('bridge_v2_accounts', { participant_id: 'participant-1', role: 'PARTICIPANT', safe_address: oldPending, initial_signer: OLD, guardian_address: guardianAddress(), deployed_at: null });
  // An entry made with the old address, before the recovery (the boundary D4 accepts).
  store.insert('bridge_v2_entries', { participant_id: 'participant-1', giveaway_id: '7', status: 'ELIGIBLE', wallet_address: oldPending, root_index: '0', passkey: true, self_custody: true, phone_hmac: null, tx_hash: null, outcome: null });
  const confirmed = (hash) =>
    store.insert('bridge_v2_recoveries', {
      participant_id: 'participant-1',
      passkey_id: passkey.id,
      status: 'CONFIRMED',
      link_code_hash: hash,
      link_expires_at: new Date().toISOString(),
      started_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      execute_after: new Date(Date.now() - 86_400_000).toISOString(),
    });
  const chainShows = (owners, pendingHasCode) =>
    kchain.set({
      accountState: (safe) => (safe.toLowerCase() === deployedSafe.toLowerCase() ? readyState(owners) : { ...readyState(), deployed: false, nonce: 0n }),
      hasCode: (address) => pendingHasCode && address.toLowerCase() === oldPending.toLowerCase(),
    });

  // Cancelled with the old passkey: nothing moves.
  const cancelled = confirmed('d4-cancelled');
  chainShows([OLD], false);
  await recovery.advanceConfirmedRecoveries(recordingLogger(), deadline());
  assert.equal(cancelled.status, 'CANCELED');
  assert.equal(pendingRow.safe_address, oldPending);

  // Finalised, but somebody deployed the old address bare meanwhile: it exists, so it is not moved.
  const bare = confirmed('d4-bare');
  chainShows([NEW], true);
  await recovery.advanceConfirmedRecoveries(recordingLogger(), deadline());
  assert.equal(bare.status, 'FINALIZED');
  assert.equal(pendingRow.safe_address, oldPending);

  // Finalised, not deployed: the account takes the new passkey's address, once.
  const finalised = confirmed('d4-finalised');
  chainShows([NEW], false);
  const log = recordingLogger();
  await recovery.advanceConfirmedRecoveries(log, deadline());
  assert.equal(finalised.status, 'FINALIZED');
  assert.equal(pendingRow.safe_address, newPending);
  assert.equal(pendingRow.initial_signer, NEW);
  assert.deepEqual(log.events.filter((e) => e.kind === 'account.readdressed').map((e) => e.detail.role), ['PARTICIPANT']);
  assert.equal(deployedRow.safe_address, deployedSafe, 'a deployed account was given another address');
  assert.equal(deployedRow.initial_signer, OLD);
  // Conditional on the signer it replaces: a stale second write changes nothing (G1).
  await accounts.readdressAccount({ ...(await accounts.accountById(pendingRow.id)), initialSigner: OLD }, '0x6969696969696969696969696969696969696969');
  assert.equal(pendingRow.safe_address, newPending);

  // The relay now builds that account at its new address, for the new passkey.
  const relayLib = await import('../../../lib/bridge-v2/relay.ts');
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'configure' }, 'PARTICIPANT');
  assert.equal(prepared.account.safe, newPending);
  assert.deepEqual(lowerCalls(callsOf(prepared.tx)), lowerCalls(keptra.configurationCalls(newPending, guardianAddress())));
  // The accepted boundary: the entry made with the old address cannot be completed.
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'enter', giveawayId: 7n }, null), (error) => error.reason === 'no_entry');
});

// --- D6: least privilege on every table of 0012 -------------------------------------

await test(['AD6'], 'D6: each 0012 table is granted exactly the verbs the code uses on it, after the defaults are revoked from service_role', () => {
  const migration = read('supabase/migrations/0012_keptra_accounts.sql');
  const created = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS (bridge_v2_\w+)/g)].map((m) => m[1]);
  assert.equal(created.length, 8);
  const used = Object.fromEntries(created.map((table) => [table, new Set()]));
  const walk = (dir) => {
    for (const name of readdirSync(`${root}${dir}`)) {
      const path = `${dir}/${name}`;
      if (statSync(`${root}${path}`).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) {
        for (const [, table, call] of read(path).matchAll(/\.from\('(bridge_v2_\w+)'\)\s*\.(select|insert|update|delete|upsert)\(/g)) {
          if (table in used) used[table].add(call === 'upsert' ? 'INSERT, UPDATE' : call.toUpperCase());
        }
      }
    }
  };
  walk('lib');
  walk('api');
  const revoke = migration.search(/REVOKE ALL ON TABLE public\.bridge_v2_passkeys\s+FROM service_role/);
  assert.ok(revoke !== -1, 'nothing revokes the default privileges from service_role');
  for (const table of created) {
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM service_role;`), `${table} keeps the default privileges`);
    const grant = migration.match(new RegExp(`GRANT ([A-Z, ]+?)\\s+ON TABLE public\\.${table}\\s+TO service_role`));
    assert.ok(grant, `${table} has no grant`);
    assert.ok(migration.indexOf(grant[0]) > revoke, `${table} is granted before the defaults are revoked`);
    // Every write here filters or reads back, so SELECT comes with any verb.
    const needed = new Set([...used[table]].flatMap((v) => v.split(', ')));
    assert.ok(needed.size > 0, `${table} is used by nothing`);
    needed.add('SELECT');
    assert.deepEqual(grant[1].split(',').map((v) => v.trim()).sort(), [...needed].sort(), `${table}: granted more or less than the code uses`);
  }
});

// ===========================================================================
// Adenda E — the decisions after the final audit of piece 1 (AEn)
// ===========================================================================

const relayLibrary = () => import('../../../lib/bridge-v2/relay.ts');
const DESTINATION = '0x7373737373737373737373737373737373737373';

// --- E1: a creator whose derived wallet is sealed -------------------------------------

await test(['AE1', 'AE11', 'KM33', 'KM34'], 'E1: once a creator’s derived index is sealed, every creator flow names only the creator account, and any balance left in the sealed wallet keeps the seed, with an alert', async () => {
  fresh();
  await registered();
  markConfigured();
  kchain.set({ accountState: readyState() });
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  const derived = addressOf(21);
  const creatorSafe = keptra.predictSafeAddress(SIGNER, 'CREATOR');
  const creatorAccount = store.rows('bridge_v2_accounts').find((row) => row.role === 'CREATOR');
  store.insert('bridge_v2_creators', { participant_id: 'participant-1', wallet_index: 21, wallet_address: derived });
  store.insert('bridge_v2_migrations', { wallet_index: 21, derived_address: derived, account_id: creatorAccount.id, kind: 'CREATOR', sealed_at: new Date().toISOString() });

  const startRoute = await import('../../../api/bridge/v2/creator/campaign/start.ts');
  const statusRoute = await import('../../../api/bridge/v2/creator/campaign/status.ts');
  const submitRoute = await import('../../../api/bridge/v2/creator/campaign/submit.ts');
  const draft = { module: '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b', prizeToken: config.USDC, prizeAmount: '10000000', durationSeconds: 3600, winnersCount: 1, slotCap: 10 };
  const started = await startRoute.POST(request(url('creator/campaign/start'), { cookie: SESSION_COOKIE, body: draft }));
  assert.equal(started.status, 200);
  assert.equal((await started.json()).depositAddress, creatorSafe, 'the sealed derived wallet was handed out as a deposit address');
  const status = await (await statusRoute.POST(request(url('creator/campaign/status'), { cookie: SESSION_COOKIE }))).json();
  assert.equal(status.depositAddress, creatorSafe);
  // Module 2's derived path signs nothing for it any more.
  const submitted = await submitRoute.POST(request(url('creator/campaign/submit'), { cookie: SESSION_COOKIE }));
  assert.equal(submitted.status, 409);
  assert.equal((await submitted.json()).error, 'Sign this campaign with your passkey.');
  assert.ok(!chain.calls.some((c) => ['fundDerivedWallet', 'submitAsDerived'].includes(c.name)), 'the derived key was asked to sign');
  // The relay builds the campaign from the creator account.
  chain.set({ erc20BalanceOf: 100_000_000n });
  const relayLib = await relayLibrary();
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'createCampaign' }, null);
  assert.equal(prepared.account.safe, creatorSafe);
  assert.equal(callsOf(prepared.tx).length, 3, 'two approvals and createGiveaway');
  // Nothing is left to migrate, and the route does not name the derived wallet.
  const migrate = await migrateRoute.POST(request(url('account/migrate'), { cookie: SESSION_COOKIE, body: { kind: 'CREATOR' } }));
  assert.equal(migrate.status, 404);

  // The readiness reads the sealed wallet too: a balance in it is "not ready", with an alert.
  const { seedRetirementReadiness } = await import('../../../lib/bridge-v2/migration.ts');
  chain.set({ erc20BalanceOf: (_token, holder) => (holder.toLowerCase() === derived.toLowerCase() ? 20_000_000n : 0n) });
  const log = recordingLogger();
  const holding = await seedRetirementReadiness(log);
  assert.deepEqual([holding.ready, holding.wallets, holding.holding], [false, 1, 1], 'a sealed wallet holding USDC was reported ready');
  const alerted = log.events.filter((e) => e.kind === 'alert' && e.detail.summary === 'derived wallet holds a balance');
  assert.deepEqual(alerted.map((e) => [e.detail.wallets, e.detail.sealed]), [[1, 1]]);
  chain.set({ erc20BalanceOf: 0n });
  const empty = recordingLogger();
  assert.equal((await seedRetirementReadiness(empty)).ready, true);
  assert.ok(!empty.events.some((e) => e.kind === 'alert'), 'an alert with nothing held');
});

await test(['AE1'], 'E1: an unsealed derived wallet holding a balance is "not ready" and alerts as well', async () => {
  fresh();
  store.rows('bridge_v2_participants')[0].wallet_index = 22;
  store.rows('bridge_v2_participants')[0].wallet_address = addressOf(22);
  chain.set({ erc20BalanceOf: (_token, holder) => (holder.toLowerCase() === addressOf(22).toLowerCase() ? 1n : 0n) });
  const { seedRetirementReadiness } = await import('../../../lib/bridge-v2/migration.ts');
  const log = recordingLogger();
  assert.equal((await seedRetirementReadiness(log)).ready, false);
  assert.deepEqual(
    log.events.filter((e) => e.kind === 'alert').map((e) => [e.detail.summary, e.detail.wallets, e.detail.sealed]),
    [['derived wallet holds a balance', 1, 0]],
  );
});

// --- E2: the relay's volume ---------------------------------------------------------

await test(['AE2', 'AE11'], 'E2: at most 20 relayed transactions per account in 24 hours; cancelling a recovery and the reaction to a compromise pass that limit and an exhausted spend ceiling, uncounted', async () => {
  fresh();
  const { passkey } = await registered();
  markConfigured();
  kchain.set({ accountState: readyState(), isValidPasskeySignature: true, hasCode: true });
  chain.set({ erc20BalanceOf: 9_000_000n });
  const relayLib = await relayLibrary();
  const account = store.rows('bridge_v2_accounts').find((row) => row.role === 'PARTICIPANT');
  const relayed = (hoursAgo) =>
    store.insert('bridge_v2_relayed_transactions', { account_id: account.id, created_at: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString() });
  const transfer = { kind: 'transfer', giveawayId: 1n, to: DESTINATION, amount: 1n };
  const body = { kind: 'transfer', giveawayId: '1', to: DESTINATION, amount: '1' };
  const sentCount = () => kchain.calls.filter((c) => c.name === 'sendRelayed').length;
  relayed(25); // outside the window
  for (let i = 0; i < 19; i += 1) relayed(1);

  // The 20th: prepared, signed, recorded before it is sent.
  const prepared = await relayLib.prepareAction('participant-1', transfer, null);
  const assertion = await passkey.sign(prepared.hash);
  const sent = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { ...body, nonce: prepared.tx.nonce.toString(), ...assertion } }));
  assert.equal(sent.status, 200);
  assert.equal(store.rows('bridge_v2_relayed_transactions').length, 21);
  // The 21st is refused before a hash is built, and nothing is sent.
  await assert.rejects(relayLib.prepareAction('participant-1', transfer, null), (error) => error.reason === 'relay_limit');
  const refused = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body }));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Your account reached its limit of transactions for the last 24 hours. Try again later.');
  assert.equal(sentCount(), 1);

  // The shared spend ceiling is exhausted too.
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: false, error: null }));
  const spendAsked = () => db.callsTo('rpc:bridge_v2_claim_spend').length;
  kchain.set({ accountState: readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: 10n }) });
  for (const kind of ['cancelRecovery', 'revokeGuardian']) {
    const asked = spendAsked();
    const tx = await relayLib.prepareAction('participant-1', { kind }, null);
    const signed = await passkey.sign(tx.hash);
    const response = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind, nonce: tx.tx.nonce.toString(), ...signed } }));
    assert.equal(response.status, 200, `${kind} was stopped`);
    assert.equal(spendAsked(), asked, `${kind} asked the shared ceiling`);
  }
  assert.equal(sentCount(), 3);
  assert.equal(store.rows('bridge_v2_relayed_transactions').length, 21, 'an always-possible transaction was counted');

  // With the window moved on, an ordinary action is back under the limit — and meets the ceiling.
  store.rows('bridge_v2_relayed_transactions').forEach((row) => {
    row.created_at = new Date(Date.now() - 25 * HOUR_MS).toISOString();
  });
  kchain.set({ accountState: readyState() });
  const ordinary = await relayLib.prepareAction('participant-1', transfer, null);
  const ordinarySigned = await passkey.sign(ordinary.hash);
  const unpaid = await relayRoute.POST(request(url('account/relay'), { cookie: SESSION_COOKIE, body: { ...body, nonce: ordinary.tx.nonce.toString(), ...ordinarySigned } }));
  assert.equal((await unpaid.json()).error, 'The bridge cannot send this right now. Try again shortly.');
  assert.equal(sentCount(), 3);
});

await test(['AE2'], 'E2: a burst signed at once cannot pass the limit either — each submission is counted again once its own row is written', async () => {
  fresh();
  const { passkey } = await registered();
  markConfigured();
  kchain.set({ accountState: readyState(), isValidPasskeySignature: true, hasCode: true });
  chain.set({ erc20BalanceOf: 9_000_000n });
  const account = store.rows('bridge_v2_accounts').find((row) => row.role === 'PARTICIPANT');
  for (let i = 0; i < 19; i += 1) store.insert('bridge_v2_relayed_transactions', { account_id: account.id });
  const relayLib = await relayLibrary();
  const transfer = { kind: 'transfer', giveawayId: 1n, to: DESTINATION, amount: 1n };
  const prepared = await relayLib.prepareAction('participant-1', transfer, null);
  const assertion = await passkey.sign(prepared.hash);
  // Another submission, signed at the same moment, writes its row between this one's check and its own.
  db.on('bridge_v2_relayed_transactions:insert', (op) => {
    store.insert('bridge_v2_relayed_transactions', { account_id: account.id });
    store.insert('bridge_v2_relayed_transactions', op.payload);
    return { data: null, error: null };
  });
  await assert.rejects(
    relayLib.submitAction('participant-1', transfer, null, prepared.tx.nonce, assertion, recordingLogger()),
    (error) => error.reason === 'relay_limit',
  );
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0, 'the 21st was sent');
});

// --- E3 and E10: deployed and "never configured" are the chain's answer --------------

await test(['AE3', 'AE10', 'AD1'], 'E3 and E10: an account the chain holds configured is recognised on use whatever deployed_at says; one the chain never showed configured stays "never configured"', async () => {
  fresh();
  await registered();
  const SECOND = '0x7272727272727272727272727272727272727272';
  const second = await createPasskey();
  await accounts.registerPasskey('participant-1', second.credentialId, second.x, second.y, SECOND);
  const relayLib = await relayLibrary();
  const row = (role) => store.rows('bridge_v2_accounts').find((r) => r.role === role);
  const read = async (role, state) => {
    kchain.set({ accountState: state });
    return relayLib.readAccount(await accounts.findAccount('participant-1', role));
  };
  assert.equal(row('PARTICIPANT').deployed_at ?? null, null, 'the first receipt was lost: nothing marked');

  // E10: never seen configured — module, no guardian — only configure is accepted.
  const bare = await read('PARTICIPANT', readyState([SIGNER], []));
  assert.deepEqual([bare.recognized, bare.configured, bare.usable], [false, false, false]);
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'cancelRecovery' }, null), (error) => error.reason === 'configuration_incomplete');
  // A foreign owner is not 6.1 (A3): not recognised.
  const foreign = await read('PARTICIPANT', readyState(['0x7474747474747474747474747474747474747474']));
  assert.equal(foreign.recognized, false);
  assert.equal(row('PARTICIPANT').deployed_at ?? null, null);
  // E3: configured as 6.1 says — recognised and marked on use.
  const configured = await read('PARTICIPANT', readyState());
  assert.deepEqual([configured.recognized, configured.configured, configured.usable], [true, true, true]);
  assert.equal(typeof row('PARTICIPANT').deployed_at, 'string');
  // Two owners, both the participant's passkeys (6.2.4): recognised too.
  const two = await read('CREATOR', readyState([SIGNER, SECOND]));
  assert.equal(two.recognized, true);
  assert.equal(typeof row('CREATOR').deployed_at, 'string');
  // E10: now configured once, a revoked guardian leaves it usable (D1).
  const revoked = await read('PARTICIPANT', readyState([SIGNER], []));
  assert.deepEqual([revoked.recognized, revoked.configured, revoked.usable], [false, true, true]);
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'revokeGuardian' }, null), (error) => error.reason === 'no_guardian');
});

await test(['AE3', 'AE11', 'KM14'], 'E3: a lost first receipt no longer keeps an account out of recovery — the route and the pass decide by the chain — and the maintenance pass recognises it', async () => {
  fresh();
  await registered();
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  const NEW = '0x7171717171717171717171717171717171717171';
  const replacement = await createPasskey();
  const next = await accounts.registerPasskey('participant-1', replacement.credentialId, replacement.x, replacement.y, NEW);
  const now = BigInt(Math.floor(Date.now() / 1000));
  let confirmedOnChain = false;
  kchain.set({
    hasCode: true,
    chainNow: now,
    accountState: () =>
      confirmedOnChain ? readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: now + 604_800n, recoveryNewOwners: [NEW] }) : readyState(),
    sendRelayed: () => {
      confirmedOnChain = true;
      return `0x${'cd'.repeat(32)}`;
    },
  });
  assert.ok(store.rows('bridge_v2_accounts').every((r) => (r.deployed_at ?? null) === null));
  // The route: the accounts exist on-chain, so there is an account to recover.
  const opened = await recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: replacement.credentialId } }));
  assert.equal(opened.status, 200, 'the route refused an account the chain holds');
  const request_ = store.rows('bridge_v2_recoveries')[0];
  Object.assign(request_, { status: 'PHONE_VERIFIED', passkey_id: next.id });
  // The pass: confirmed on the accounts the chain holds, not REFUSED for want of a mark.
  assert.equal(await recovery.confirmVerifiedRecoveries(recordingLogger(), deadline()), 1);
  assert.equal(request_.status, 'CONFIRMED');
  assert.ok(kchain.calls.some((c) => c.name === 'recoveryHash'), 'the guardian never signed');

  // The maintenance pass marks what the chain holds configured.
  confirmedOnChain = false;
  store.rows('bridge_v2_accounts').forEach((r) => {
    r.deployed_at = null;
  });
  const log = recordingLogger();
  assert.equal(await (await relayLibrary()).recognizeDeployedAccounts(log, deadline()), 2);
  assert.ok(store.rows('bridge_v2_accounts').every((r) => typeof r.deployed_at === 'string'));
  assert.equal(log.events.filter((e) => e.kind === 'account.recognized').length, 2);
  // Nothing left to recognise; and a pass with no time recognises nothing.
  assert.equal(await (await relayLibrary()).recognizeDeployedAccounts(log, deadline()), 0);
});

// --- E4: the D3 closure and the confirmation ------------------------------------------

await test(['AE4', 'AE11', 'AD3'], 'E4: the recovery route asked mid-signature cannot expire the request the guardian reserved; it stays PHONE_VERIFIED while signed and becomes CONFIRMED', async () => {
  fresh();
  await registered();
  markConfigured();
  store.insert('bridge_v2_phones', { participant_id: 'participant-1', phone_hmac: 'hash', released_at: null });
  const NEW = '0x7171717171717171717171717171717171717171';
  const replacement = await createPasskey();
  const passkey = await accounts.registerPasskey('participant-1', replacement.credentialId, replacement.x, replacement.y, NEW);
  const row = store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-1',
    passkey_id: passkey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: 'e4-race',
    link_expires_at: new Date(Date.now() - 22 * HOUR_MS).toISOString(),
    created_at: new Date(Date.now() - 23 * HOUR_MS).toISOString(),
    confirming_at: null,
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  let confirmedOnChain = false;
  const seen = [];
  kchain.set({
    hasCode: true,
    chainNow: now,
    accountState: () =>
      confirmedOnChain ? readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: now + 604_800n, recoveryNewOwners: [NEW] }) : readyState(),
    recoveryHash: async () => {
      // The moment of the signature: 24 hours have passed, and the participant asks again.
      seen.push(row.status);
      row.created_at = new Date(Date.now() - 25 * HOUR_MS).toISOString();
      const response = await recoveryRoute.POST(request(url('account/recovery'), { cookie: SESSION_COOKIE, body: { credentialId: replacement.credentialId } }));
      seen.push(response.status, row.status);
      return `0x${'ab'.repeat(32)}`;
    },
    sendRelayed: () => {
      confirmedOnChain = true;
      return `0x${'cd'.repeat(32)}`;
    },
  });
  assert.equal(await recovery.confirmVerifiedRecoveries(recordingLogger(), deadline()), 1);
  assert.deepEqual(seen.slice(0, 3), ['PHONE_VERIFIED', 409, 'PHONE_VERIFIED'], 'D3 closed the request the guardian was signing for');
  assert.equal(row.status, 'CONFIRMED');
  assert.equal(row.confirming_at, null);
  assert.equal(store.rows('bridge_v2_recoveries').length, 1, 'a second request was opened beside it');
});

await test(['AE4', 'AE11'], 'E4: a request D3 expired, one past its 24 hours, or one another pass reserved is never signed for; a dead pass’s reservation is given back, and D3 then closes it', async () => {
  fresh();
  await registered();
  markConfigured();
  kchain.set({ hasCode: true, accountState: readyState() });
  const passkey = await accounts.registerPasskey('participant-1', 'n'.repeat(22), 1n, 2n, '0x7171717171717171717171717171717171717171');
  const request_ = (hash, status, hoursAgo, confirmingAt = null) =>
    store.insert('bridge_v2_recoveries', {
      participant_id: 'participant-1',
      passkey_id: passkey.id,
      status,
      link_code_hash: hash,
      link_expires_at: new Date().toISOString(),
      created_at: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString(),
      confirming_at: confirmingAt,
    });
  const expired = request_('e4-expired', 'EXPIRED', 1);
  const overdue = request_('e4-overdue', 'PHONE_VERIFIED', 24.5);
  const reserved = request_('e4-reserved', 'PHONE_VERIFIED', 1, new Date(Date.now() - 3_600_000).toISOString());
  assert.equal(await accounts.reserveRecovery(expired.id), false, 'an expired request was reserved');
  assert.equal(await accounts.reserveRecovery(overdue.id), false, 'a request past its 24 hours was reserved');
  assert.equal(await accounts.reserveRecovery(reserved.id), false, 'a reserved request was reserved twice');
  assert.equal(await recovery.confirmVerifiedRecoveries(recordingLogger(), deadline()), 0);
  assert.equal(kchain.calls.filter((c) => ['recoveryHash', 'sendRelayed'].includes(c.name)).length, 0, 'the guardian signed');

  // D3 closes the overdue one, never the reserved one, however old.
  reserved.created_at = new Date(Date.now() - 30 * HOUR_MS).toISOString();
  assert.equal(await recovery.closeOverdueRecoveries(recordingLogger(), deadline()), 1);
  assert.deepEqual([overdue.status, reserved.status], ['EXPIRED', 'PHONE_VERIFIED']);
  // The next maintenance pass gives a dead pass's reservation back first; D3 then closes it.
  assert.equal(await accounts.releaseRecoveryReservations(), 1);
  assert.equal(await recovery.closeOverdueRecoveries(recordingLogger(), deadline()), 1);
  assert.equal(reserved.status, 'EXPIRED');
});

// --- E5: the maintenance budget -----------------------------------------------------------

await test(['AE5', 'KM15', 'KM22', 'AF7'], 'E5: when the sweep and the migration spend the whole run, the pass has already confirmed, notified and finalised its recoveries', async () => {
  fresh();
  await registered();
  markConfigured();
  const NEW = '0x7171717171717171717171717171717171717171';
  const replacement = await createPasskey();
  const passkey = await accounts.registerPasskey('participant-1', replacement.credentialId, replacement.x, replacement.y, NEW);
  const verified = store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-1',
    passkey_id: passkey.id,
    status: 'PHONE_VERIFIED',
    link_code_hash: 'e5-verified',
    link_expires_at: new Date().toISOString(),
    created_at: new Date(Date.now() - HOUR_MS).toISOString(),
  });
  // A second participant whose change of access is due to finish, with its first notice owed.
  store.insert('bridge_v2_participants', { id: 'participant-2', email_canonical: 'second@example.test', wallet_index: null, wallet_address: null, telegram_chat_enc: null });
  const OTHER_SAFE = '0x6868686868686868686868686868686868686868';
  const OTHER_NEW = '0x6767676767676767676767676767676767676767';
  const otherKey = await accounts.registerPasskey('participant-2', 'o'.repeat(22), 3n, 4n, OTHER_NEW);
  store.insert('bridge_v2_accounts', { participant_id: 'participant-2', role: 'PARTICIPANT', safe_address: OTHER_SAFE, initial_signer: SAFE, guardian_address: guardianAddress(), deployed_at: new Date().toISOString() });
  const due = store.insert('bridge_v2_recoveries', {
    participant_id: 'participant-2',
    passkey_id: otherKey.id,
    status: 'CONFIRMED',
    link_code_hash: 'e5-due',
    link_expires_at: new Date().toISOString(),
    started_at: new Date(Date.now() - 8 * 24 * HOUR_MS).toISOString(),
    execute_after: new Date(Date.now() + HOUR_MS).toISOString(),
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  let confirmedOnChain = false;
  kchain.set({
    hasCode: true,
    chainNow: now,
    accountState: (safe) =>
      safe.toLowerCase() === OTHER_SAFE.toLowerCase()
        ? readyState([SAFE], [guardianAddress()], { recoveryExecuteAfter: now - 10n, recoveryNewOwners: [OTHER_NEW] })
        : confirmedOnChain
          ? readyState([SIGNER], [guardianAddress()], { recoveryExecuteAfter: now + 604_800n, recoveryNewOwners: [NEW] })
          : readyState(),
    sendRelayed: (_lease, call) => {
      if (call.data.startsWith(encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'multiConfirmRecovery', args: [SAFE, [], 1n, [], true] }).slice(0, 10))) {
        confirmedOnChain = true;
      }
      return `0x${'cd'.repeat(32)}`;
    },
  });

  // The sweep and the migration take the pipeline's lock, and with it the run's whole budget.
  const realNow = Date.now;
  let spent = false;
  const { TEST_CRON_SECRET } = await import('../harness.mjs');
  const maintenance = await import('../../../api/bridge/v2/cron/maintenance.ts');
  db.on('rpc:bridge_v2_try_lock', (op) => {
    if (op.args.p_name === 'cron/process') {
      spent = true;
      Date.now = () => realNow() + (config.RUN_BUDGET_MS + 60_000);
    }
    return { data: 'holder-abc', error: null };
  });
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_cleanup', () => ({ data: [], error: null }));
  db.on('bridge_v2_external_spend:select', () => ({ data: [], error: null }));
  let body;
  try {
    const response = await maintenance.GET(request(url('cron/maintenance'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }));
    body = await response.json();
  } finally {
    Date.now = realNow;
  }
  assert.ok(spent, 'the sweep never ran');
  assert.equal(body.accounts.recoveriesConfirmed, 1, 'the confirmation was starved by the sweep and the migration');
  assert.equal(verified.status, 'CONFIRMED');
  // Notified (6.3.2) and finalised (R-6) in the same pass, before the time went.
  assert.ok(store.rows('bridge_v2_recovery_notices').some((n) => n.recovery_id === due.id && n.stage === 'START'), 'the notice was starved');
  const finalize = encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'finalizeRecovery', args: [OTHER_SAFE] });
  assert.ok(kchain.calls.some((c) => c.name === 'sendRelayed' && c.args[1].data === finalize), 'the finalisation was starved');
  // What came after the sweep ran out of time, which is what this pass was built to
  // show. Adenda F7: a step with no time left does not start, and says so — null.
  assert.deepEqual(
    [body.lowFunders, body.vrfLink, body.bridgeRegistered, body.contractPaused, body.accounts.recoveriesUnregistered, body.accounts.seedRetirable],
    [null, null, null, null, null, null],
  );
});

// --- E7: a relay campaign left in FUNDING -------------------------------------------------

const GIVEAWAY_CREATED = CREATOR_CAMPAIGN_MANAGER_ABI.find((item) => item.type === 'event' && item.name === 'GiveawayCreated');
/** The log createGiveaway leaves, as the chain would return it. */
const giveawayCreatedLog = (giveawayId) => ({
  address: config.GIVEAWAY_MANAGER_V2,
  topics: encodeEventTopics({ abi: [GIVEAWAY_CREATED], eventName: 'GiveawayCreated', args: { giveawayId, creator: SAFE, prizeModule: zeroAddress } }),
  data: encodeAbiParameters(GIVEAWAY_CREATED.inputs.filter((input) => !input.indexed), [0, config.USDC, 1n, 0n, config.USDC, 1n, 1n, 1, 10, 1n]),
});

function fundingDraft(creatorId, extra = {}) {
  return store.insert('bridge_v2_creator_campaigns', {
    creator_id: creatorId,
    status: 'FUNDING',
    module: '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b',
    prize_token: config.USDC,
    prize_amount: '10000000',
    duration_seconds: '3600',
    winners_count: 1,
    slot_cap: 10,
    fee_amount: '1000000',
    slots_cost: '1000000',
    giveaway_id: null,
    tx_hash: null,
    ...extra,
  });
}

await test(['AE7', 'AE11'], 'E7: the pass settles each relay campaign in FUNDING from the chain — registered if mined, released to PENDING_DEPOSIT if reverted, dropped or never sent, left while pending — and never touches module 2’s', async () => {
  fresh();
  const hash = (digit) => `0x${String(digit).repeat(64)}`;
  const creator = (i, walletIndex = null) =>
    store.insert('bridge_v2_creators', { participant_id: `p-${i}`, wallet_index: walletIndex, wallet_address: walletIndex === null ? `0x${String(i).repeat(40)}` : addressOf(walletIndex) }).id;
  const stale = new Date(Date.now() - config.RELAYED_CAMPAIGN_STALE_MS - 1_000).toISOString();
  const mined = fundingDraft(creator(1), { tx_hash: hash(1) });
  const reverted = fundingDraft(creator(2), { tx_hash: hash(2) });
  const dropped = fundingDraft(creator(3), { tx_hash: hash(3) });
  const pending = fundingDraft(creator(4), { tx_hash: hash(4) });
  const neverSent = fundingDraft(creator(5), { updated_at: stale });
  const inFlight = fundingDraft(creator(6));
  const derived = fundingDraft(creator(7, 31), { updated_at: stale });
  chain.set({
    waitForReceipt: (asked) => (asked === hash(1) ? { status: 'success', logs: [giveawayCreatedLog(77n)] } : asked === hash(2) ? { status: 'reverted', logs: [] } : null),
    transactionKnown: (asked) => asked === hash(4),
  });
  const log = recordingLogger();
  const relayLib = await relayLibrary();
  assert.equal(await relayLib.reconcileRelayedCampaigns(log, deadline()), 4);
  assert.deepEqual([mined.status, mined.giveaway_id, mined.tx_hash], ['CONFIRMED', '77', hash(1)]);
  for (const row of [reverted, dropped, neverSent]) assert.deepEqual([row.status, row.tx_hash], ['PENDING_DEPOSIT', null]);
  assert.equal(pending.status, 'FUNDING', 'a transaction still in the mempool was given up on');
  assert.equal(inFlight.status, 'FUNDING', 'a request still running had its draft released');
  assert.equal(derived.status, 'FUNDING', 'module 2’s derived submit was touched (D-FUNDING is not this piece’s)');
  assert.deepEqual(
    log.events.filter((e) => e.kind === 'creator_campaign.released').map((e) => e.detail.reason).sort(),
    ['dropped', 'never_sent', 'reverted'],
  );
  // A pass with no time settles nothing.
  assert.equal(await relayLib.reconcileRelayedCampaigns(log, deadline(false)), 0);
});

await test(['AE7', 'AF7'], 'E7: the relay writes the transaction on the draft before the wait, so a receipt that never comes leaves it findable; a second signature waits for the pass', async () => {
  fresh();
  const { passkey } = await registered();
  markConfigured();
  kchain.set({ accountState: readyState(), isValidPasskeySignature: true, hasCode: true });
  chain.set({ erc20BalanceOf: 100_000_000n, waitForReceipt: null });
  const creatorSafe = keptra.predictSafeAddress(SIGNER, 'CREATOR');
  const creatorRow = store.insert('bridge_v2_creators', { participant_id: 'participant-1', wallet_index: null, wallet_address: creatorSafe });
  const draft = fundingDraft(creatorRow.id, { status: 'PENDING_DEPOSIT' });
  const relayLib = await relayLibrary();
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'createCampaign' }, null);
  const assertion = await passkey.sign(prepared.hash);
  const submitted = await relayLib.submitAction('participant-1', { kind: 'createCampaign' }, null, prepared.tx.nonce, assertion, recordingLogger());
  assert.equal(submitted.receipt, null);
  assert.deepEqual([draft.status, draft.tx_hash], ['FUNDING', submitted.txHash]);
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'createCampaign' }, null), (error) => error.reason === 'campaign_in_flight');
  // The pass finds it dropped: released, and the creator can sign it again.
  chain.set({ transactionKnown: false });
  assert.equal(await relayLib.reconcileRelayedCampaigns(recordingLogger(), deadline()), 1);
  assert.equal(draft.status, 'PENDING_DEPOSIT');
  assert.equal((await relayLib.prepareAction('participant-1', { kind: 'createCampaign' }, null)).campaign.id, draft.id);
});

// --- E9: nothing in production only the tests read -----------------------------------------

await test(['AE9', 'AC13'], 'E9: production carries no guardian_revoked_at, no deploy_tx_hash, no RecoveryNoticeStage, and every ABI entry keptra.ts declares is one production encodes or reads', () => {
  const sources = productionSources();
  for (const name of ['guardian_revoked_at', 'guardianRevokedAt', 'deploy_tx_hash', 'RecoveryNoticeStage']) {
    const users = sources.filter(([, text]) => new RegExp(`\\b${name}\\b`).test(text)).map(([path]) => path);
    assert.deepEqual(users, [], `${name} is still in production code`);
  }
  const everything = sources.map(([, text]) => text).join('\n');
  for (const abi of [keptra.SAFE_ABI, keptra.PROXY_FACTORY_ABI, keptra.MULTI_SEND_ABI, keptra.SIGNER_FACTORY_ABI, keptra.RECOVERY_MODULE_ABI]) {
    for (const item of abi) {
      assert.equal(item.type, 'function', `${item.name}: an event is declared for the tests alone`);
      assert.ok(everything.includes(`functionName: '${item.name}'`), `${item.name} is declared and never encoded or read by production`);
    }
  }
  // 0012 creates neither column; it drops both from a database that ran an earlier text.
  const migration = read('supabase/migrations/0012_keptra_accounts.sql');
  const accountsTable = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS bridge_v2_accounts'), migration.indexOf(');', migration.indexOf('CREATE TABLE IF NOT EXISTS bridge_v2_accounts')));
  assert.ok(!/deploy_tx_hash|guardian_revoked_at/.test(accountsTable));
  assert.match(migration, /DROP COLUMN IF EXISTS deploy_tx_hash;/);
  assert.match(migration, /DROP COLUMN IF EXISTS guardian_revoked_at;/);
  // E8: each comment of linkcodes.ts sits on its own function.
  const linkcodes = read('lib/bridge-v2/linkcodes.ts');
  assert.match(linkcodes, /Issues a code for one participant and one campaign\.[\s\S]*?\*\/\s*export async function issueLinkCode/);
  assert.ok(!/\*\/\s*\/\*\*/.test(linkcodes), 'two doc comments one above the other');
});

// ===========================================================================
// Adenda F — the decisions after the audit of 6ec6d50 (AFn)
// ===========================================================================

const EMPTY_ACCOUNT = {
  deployed: false,
  nonce: 0n,
  owners: [],
  threshold: 0n,
  modules: [],
  fallbackHandler: zeroAddress,
  guardians: [],
  guardianThreshold: 0n,
  recoveryExecuteAfter: 0n,
  recoveryNewOwners: [],
};
const ERC20_PRIZE_MODULE = '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b';
const migrationLibrary = () => import('../../../lib/bridge-v2/migration.ts');
const draftsLibrary = () => import('../../../lib/bridge-v2/creatorCampaigns.ts');
/** A draft of `creatorId`, with the creator embedded as the migration's queries read it (F8). */
const draftOf = (creatorId, walletAddress, extra = {}) =>
  store.insert('bridge_v2_creator_campaigns', {
    creator_id: creatorId,
    status: 'PENDING_DEPOSIT',
    module: ERC20_PRIZE_MODULE,
    prize_token: config.USDC,
    prize_amount: '10000000',
    duration_seconds: '3600',
    winners_count: 1,
    slot_cap: 10,
    fee_amount: '1000000',
    slots_cost: '1000000',
    giveaway_id: null,
    tx_hash: null,
    creator: { wallet_address: walletAddress },
    ...extra,
  });
const openLocks = () => {
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
};

// --- F1: the guardian the account holds on-chain ------------------------------------

await test(['AF1', 'AE3'], 'F1: R-3 names the guardian the account holds on-chain, never the recorded one a rotation (B6) left behind, and the account is recognised by that guardian too', async () => {
  fresh();
  const { passkey } = await registered();
  // The recorded guardian is the platform's current key; the account still holds another one.
  const HELD = '0x4040404040404040404040404040404040404040';
  const row = store.rows('bridge_v2_accounts').find((r) => r.role === 'PARTICIPANT');
  assert.equal(row.guardian_address.toLowerCase(), guardianAddress().toLowerCase());
  kchain.set({ accountState: readyState([SIGNER], [HELD]), isValidPasskeySignature: true, hasCode: true });
  const relayLib = await relayLibrary();
  // E3 read through F1: configured as 6.1 says, with the guardian the chain holds.
  const view = await relayLib.readAccount(await accounts.findAccount('participant-1', 'PARTICIPANT'));
  assert.deepEqual([view.recognized, view.configured, view.usable], [true, true, true]);
  // R-3 revokes the held key, and nothing else is ever named.
  const prepared = await relayLib.prepareAction('participant-1', { kind: 'revokeGuardian' }, null);
  const revoke = encodeFunctionData({ abi: keptra.RECOVERY_MODULE_ABI, functionName: 'revokeGuardianWithThreshold', args: [keptra.SENTINEL, HELD, 0n] });
  assert.deepEqual(callsOf(prepared.tx).map((c) => c.data.toLowerCase()).slice(-1), [revoke.toLowerCase()]);
  const assertion = await passkey.sign(prepared.hash);
  const response = await relayRoute.POST(
    request(url('account/relay'), { cookie: SESSION_COOKIE, body: { kind: 'revokeGuardian', nonce: prepared.tx.nonce.toString(), ...assertion } }),
  );
  assert.equal(response.status, 200, 'the reaction to a compromise was refused while the account holds a guardian');
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 1);
  // With no guardian on-chain there is nothing to revoke, and no call may name one.
  kchain.set({ accountState: readyState([SIGNER], []) });
  await assert.rejects(relayLib.prepareAction('participant-1', { kind: 'revokeGuardian' }, null), (error) => error.reason === 'no_guardian');
});

await test(['AF1'], 'F1: the maintenance pass brings the recorded guardian into line with the chain — the one each account holds, none once revoked — and leaves an account with no module on-chain alone', async () => {
  fresh();
  await registered();
  const HELD = '0x4141414141414141414141414141414141414141';
  const rows = store.rows('bridge_v2_accounts');
  const mine = rows.find((r) => r.role === 'PARTICIPANT');
  const same = rows.find((r) => r.role === 'CREATOR');
  const extra = (safe) =>
    store.insert('bridge_v2_accounts', { participant_id: `p-${safe.slice(2, 6)}`, role: 'PARTICIPANT', safe_address: safe, initial_signer: SIGNER, guardian_address: guardianAddress(), deployed_at: null });
  const revoked = extra('0x8282828282828282828282828282828282828282');
  const bare = extra('0x8383838383838383838383838383838383838383');
  const undeployed = extra('0x8484848484848484848484848484848484848484');
  const states = new Map([
    [mine.safe_address.toLowerCase(), readyState([SIGNER], [HELD])],
    [same.safe_address.toLowerCase(), readyState()],
    [revoked.safe_address.toLowerCase(), readyState([SIGNER], [])],
    [bare.safe_address.toLowerCase(), readyState([SIGNER], [], { modules: [] })],
  ]);
  kchain.set({ accountState: (safe) => states.get(safe.toLowerCase()) ?? EMPTY_ACCOUNT });
  const relayLib = await relayLibrary();
  const log = recordingLogger();
  assert.equal(await relayLib.reconcileGuardians(log, deadline()), 2);
  assert.equal(mine.guardian_address.toLowerCase(), HELD.toLowerCase());
  assert.equal(revoked.guardian_address, null);
  for (const untouched of [same, bare, undeployed]) assert.equal(untouched.guardian_address.toLowerCase(), guardianAddress().toLowerCase());
  assert.deepEqual(log.events.filter((e) => e.kind === 'account.guardian_reconciled').map((e) => e.detail.guardian).sort(), ['none', 'on_chain']);
  // In line now: a second pass changes nothing; a pass with no time reads nothing.
  assert.equal(await relayLib.reconcileGuardians(recordingLogger(), deadline()), 0);
  const reads = kchain.calls.filter((c) => c.name === 'accountState').length;
  assert.equal(await relayLib.reconcileGuardians(recordingLogger(), deadline(false)), 0);
  assert.equal(kchain.calls.filter((c) => c.name === 'accountState').length, reads);
  // The maintenance pass runs it.
  mine.guardian_address = guardianAddress();
  assert.equal((await maintenancePass()).accounts.guardiansReconciled, 1);
  assert.equal(mine.guardian_address.toLowerCase(), HELD.toLowerCase());
});

// --- F2: a derived creator with a draft alive -------------------------------------------

await test(['AF2', 'AF8', 'KM33'], 'F2: a derived creator’s wallet is not moved while a draft is alive, nor while module 2’s submit holds the creator’s lock; once neither holds, it moves and is sealed', async () => {
  fresh();
  await registered();
  markConfigured();
  kchain.set({ accountState: readyState() });
  openLocks();
  const derived = addressOf(41);
  const creatorAccount = store.rows('bridge_v2_accounts').find((r) => r.role === 'CREATOR');
  const creatorRow = store.insert('bridge_v2_creators', { participant_id: 'participant-1', wallet_index: 41, wallet_address: derived });
  store.insert('bridge_v2_migrations', { wallet_index: 41, derived_address: derived, account_id: creatorAccount.id, kind: 'CREATOR', sealed_at: null });
  const draft = draftOf(creatorRow.id, derived);
  // The draft's deposit sits in the derived wallet.
  let moved = false;
  chain.set({
    erc20BalanceOf: (_token, holder) => (!moved && holder.toLowerCase() === derived.toLowerCase() ? 12_000_000n : 0n),
    submitAsDerived: () => {
      moved = true;
      return `0x${'1'.repeat(64)}`;
    },
  });
  const signed = () => chain.calls.filter((c) => ['fundDerivedWallet', 'submitAsDerived', 'sweepRemainder'].includes(c.name));
  const { migrateAuthorizedWallets } = await migrationLibrary();

  const waiting = recordingLogger();
  assert.equal(await migrateAuthorizedWallets(waiting, 2, deadline()), 0);
  assert.deepEqual(signed(), [], 'the derived wallet was signed for while its draft was alive');
  assert.deepEqual(waiting.events.filter((e) => e.kind === 'migration.waiting').map((e) => e.detail.reason), ['draft']);
  // The lock it waits on is the one module 2's submit takes (creatorCampaignLock).
  const { creatorCampaignLock } = await draftsLibrary();
  assert.ok(db.callsTo('rpc:bridge_v2_try_lock').some((c) => c.args.p_name === creatorCampaignLock(creatorRow.id)));
  assert.match(read('api/bridge/v2/creator/campaign/submit.ts'), /acquireRunLock\(creatorCampaignLock\(creator\.id\)\)/);

  // The draft is gone (F2's closure), but a submit holds the creator's lock: still nothing.
  draft.status = 'EXPIRED';
  db.on('rpc:bridge_v2_try_lock', (op) => ({ data: op.args.p_name.startsWith('creator-campaign:') ? null : 'holder-abc', error: null }));
  const busy = recordingLogger();
  assert.equal(await migrateAuthorizedWallets(busy, 2, deadline()), 0);
  assert.deepEqual(signed(), []);
  assert.deepEqual(busy.events.filter((e) => e.kind === 'migration.waiting').map((e) => e.detail.reason), ['submit']);

  // Neither: the deposit moves into the creator account, and the index is sealed.
  openLocks();
  assert.equal(await migrateAuthorizedWallets(recordingLogger(), 2, deadline()), 1);
  assert.equal(chain.calls.filter((c) => c.name === 'submitAsDerived').length, 1);
  assert.equal(await accounts.isIndexSealed(41), true);
  assert.equal(db.callsTo('rpc:bridge_v2_release_lock').filter((c) => c.args.p_name === creatorCampaignLock(creatorRow.id)).length, 2, 'the creator lock was not given back');
});

await test(['AF2'], 'F2: a draft in PENDING_DEPOSIT whose deposit address holds none of either token closes as EXPIRED seven days after it was made — a derived creator’s and an account creator’s alike — and frees the creator’s one active draft', async () => {
  fresh();
  const creator = (i, walletIndex = null) =>
    store.insert('bridge_v2_creators', { participant_id: `p-${i}`, wallet_index: walletIndex, wallet_address: walletIndex === null ? `0x${String(i).repeat(40)}` : addressOf(walletIndex) });
  const old = new Date(Date.now() - config.DRAFT_DEPOSIT_TTL_MS - 60_000).toISOString();
  const young = new Date(Date.now() - config.DRAFT_DEPOSIT_TTL_MS + 3_600_000).toISOString();
  const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const c = [creator(1), creator(2, 46), creator(3), creator(4), creator(5), creator(6)];
  const empty = draftOf(c[0].id, c[0].wallet_address, { created_at: old });
  const emptyDerived = draftOf(c[1].id, c[1].wallet_address, { created_at: old });
  const usdcArrived = draftOf(c[2].id, c[2].wallet_address, { created_at: old });
  const prizeArrived = draftOf(c[3].id, c[3].wallet_address, { created_at: old, prize_token: WETH });
  const recent = draftOf(c[4].id, c[4].wallet_address, { created_at: young });
  const funding = draftOf(c[5].id, c[5].wallet_address, { created_at: old, status: 'FUNDING' });
  chain.set({
    erc20BalanceOf: (token, holder) =>
      (holder.toLowerCase() === c[2].wallet_address.toLowerCase() && token.toLowerCase() === config.USDC.toLowerCase()) ||
      (holder.toLowerCase() === c[3].wallet_address.toLowerCase() && token.toLowerCase() === WETH.toLowerCase())
        ? 1n
        : 0n,
  });
  const drafts = await draftsLibrary();
  const log = recordingLogger();
  assert.equal(await drafts.expireUnfundedDrafts(log, deadline()), 2);
  assert.deepEqual(
    [empty, emptyDerived, usdcArrived, prizeArrived, recent, funding].map((d) => d.status),
    ['EXPIRED', 'EXPIRED', 'PENDING_DEPOSIT', 'PENDING_DEPOSIT', 'PENDING_DEPOSIT', 'FUNDING'],
  );
  assert.equal(log.events.filter((e) => e.kind === 'creator_campaign.expired').length, 2);
  // EXPIRED is not the one active draft (0007's index): a new one can be made, and it is no right of the wallet.
  assert.equal(await drafts.findActiveCampaign(c[0].id), null);
  const { openRights } = await migrationLibrary();
  assert.equal(await openRights('CREATOR', c[1].wallet_address), 0);
  assert.equal(await openRights('CREATOR', c[2].wallet_address), 1, 'a live draft is a right of the wallet (A8, F2)');
  // A pass with no time closes nothing; the maintenance pass runs it.
  empty.status = 'PENDING_DEPOSIT';
  assert.equal(await drafts.expireUnfundedDrafts(recordingLogger(), deadline(false)), 0);
  assert.equal((await maintenancePass()).accounts.draftsExpired, 1);
  assert.equal(empty.status, 'EXPIRED');
});

// --- F3: which entries are rights -----------------------------------------------------------

await test(['AF3', 'AF8'], 'F3: an entry is a right only while its campaign takes entries, or while it can still win a prize within the core’s deadline; an entry abandoned in a closed campaign with nothing to claim is not', async () => {
  fresh();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const DAY = 86_400n;
  const base = { ...chain.behaviour.readGiveaway };
  const cases = [
    // [campaign, entered on-chain, claimable, expected]
    ['open, not entered yet', { status: 1, isOpen: true, acceptsEntries: true }, false, 0n, 1],
    ['closed, entered, not drawn', { status: 2, isOpen: false, acceptsEntries: false }, true, 0n, 1],
    ['closed, never entered (abandoned)', { status: 2, isOpen: false, acceptsEntries: false }, false, 0n, 0],
    ['open past its end, never entered', { status: 1, isOpen: true, acceptsEntries: false }, false, 0n, 0],
    ['settled, a prize to claim in time', { status: 5, isOpen: false, isSettled: true, acceptsEntries: false, settledAt: now - DAY }, true, 5n, 1],
    ['settled, nothing to claim', { status: 5, isOpen: false, isSettled: true, acceptsEntries: false, settledAt: now - DAY }, true, 0n, 0],
    ['settled, the deadline passed', { status: 5, isOpen: false, isSettled: true, acceptsEntries: false, settledAt: now - 91n * DAY }, true, 5n, 0],
    ['cancelled, entered', { status: 6, isOpen: false, acceptsEntries: false }, true, 0n, 0],
  ];
  const wallets = cases.map((_c, i) => `0x${(0x500 + i).toString(16).padStart(40, '0')}`);
  cases.forEach((_c, i) =>
    store.insert('bridge_v2_entries', { participant_id: `p-${i}`, giveaway_id: String(100 + i), status: i === 2 ? 'VERIFIED' : 'CONFIRMED', wallet_address: wallets[i], passkey: false, self_custody: false, outcome: null }),
  );
  chain.set({
    readGiveaway: (id) => ({ ...base, ...cases[Number(id) - 100][1] }),
    hasEntered: (id) => cases[Number(id) - 100][2],
    claimableFor: (id) => cases[Number(id) - 100][3],
  });
  const { openRights } = await migrationLibrary();
  for (const [i, [label, , , , expected]] of cases.entries()) {
    assert.equal(await openRights('PARTICIPANT', wallets[i]), expected, label);
  }
  // An entry made by an account (passkey) is never a right of a derived wallet.
  store.insert('bridge_v2_entries', { participant_id: 'p-x', giveaway_id: '100', status: 'ELIGIBLE', wallet_address: wallets[2], passkey: true, self_custody: true, outcome: null });
  assert.equal(await openRights('PARTICIPANT', wallets[2]), 0);
});

// --- F4: every derived wallet, or "not ready" --------------------------------------------------

await test(['AF4', 'KM34'], 'F4: readiness reads every derived wallet a page at a time and checks the database’s count — a server that caps its pages still reads all; a count that differs or does not come, or a list the time cuts, is "not ready"', async () => {
  fresh();
  const hex = (i) => `0x${i.toString(16).padStart(40, '0')}`;
  for (let i = 1; i <= 1203; i += 1) store.insert('bridge_v2_participants', { id: `w-${String(i).padStart(5, '0')}`, email_canonical: `w${i}@example.test`, wallet_index: 1000 + i, wallet_address: hex(0x7000 + i), telegram_chat_enc: null });
  store.insert('bridge_v2_creators', { participant_id: 'participant-1', wallet_index: 999, wallet_address: hex(0x6999) });
  const { seedRetirementReadiness } = await migrationLibrary();
  const whole = await seedRetirementReadiness(recordingLogger());
  assert.deepEqual([whole.ready, whole.complete, whole.wallets], [true, true, 1204]);
  const pages = db.callsTo('bridge_v2_participants:select').filter((c) => c.limit !== undefined);
  assert.ok(pages.length >= 4, `the list was not paged (${pages.length} pages)`);

  // A server that caps its rows at 100, below the page asked for: every row is still read.
  const rowsAfter = (op) => {
    const after = op.filters.find((f) => f[0] === 'gt')?.[2] ?? '';
    return store.rows('bridge_v2_participants').filter((r) => r.wallet_index != null && r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  let countReply = () => 1203;
  db.on('bridge_v2_participants:select', (op) =>
    op.selectOptions?.count === 'exact' ? { data: null, count: countReply(), error: null } : { data: rowsAfter(op).slice(0, 100), error: null },
  );
  const capped = await seedRetirementReadiness(recordingLogger());
  assert.deepEqual([capped.ready, capped.complete, capped.wallets], [true, true, 1204]);
  // The count and the rows disagree — a wallet the pages never reached, or one inserted between.
  countReply = () => 1204;
  const differs = await seedRetirementReadiness(recordingLogger());
  assert.deepEqual([differs.ready, differs.complete], [false, false]);
  // No count at all.
  countReply = () => null;
  assert.deepEqual([(await seedRetirementReadiness(recordingLogger())).ready], [false]);
  // The time runs out in the middle of the list.
  countReply = () => 1203;
  let asked = 0;
  const cut = await seedRetirementReadiness(recordingLogger(), () => (asked += 1) < 5);
  assert.deepEqual([cut.ready, cut.complete], [false, false]);
});

// --- F5: a draft in FUNDING with no hash ------------------------------------------------------

await test(['AF5', 'AE7'], 'F5: a relay draft in FUNDING with no hash is released only when the chain shows its creator account created no campaign since the draft — a campaign with its terms registers it, one with other terms or a search that did not reach it keeps it, and time alone releases nothing', async () => {
  fresh();
  const creator = (i) => store.insert('bridge_v2_creators', { participant_id: `p-${i}`, wallet_index: null, wallet_address: `0x${String(i).repeat(40)}` });
  const stale = new Date(Date.now() - config.RELAYED_CAMPAIGN_STALE_MS - 1_000).toISOString();
  const made = new Date(Date.now() - 2 * HOUR_MS).toISOString();
  const c = [1, 2, 3, 4, 5, 6].map(creator);
  const none = fundingDraft(c[0].id, { updated_at: stale, created_at: made });
  const unread = fundingDraft(c[1].id, { updated_at: stale, created_at: made });
  const created = fundingDraft(c[2].id, { updated_at: stale, created_at: made });
  const otherTerms = fundingDraft(c[3].id, { updated_at: stale, created_at: made });
  const taken = fundingDraft(c[4].id, { updated_at: stale, created_at: made });
  fundingDraft(c[4].id, { status: 'CONFIRMED', giveaway_id: '92', tx_hash: `0x${'9'.repeat(64)}` });
  const running = fundingDraft(c[5].id, { created_at: made });
  const terms = (giveawayId, extra = {}) => ({ giveawayId, prizeModule: ERC20_PRIZE_MODULE, prizeAmount: 10_000_000n, winnersCount: 1, slotCap: 10, durationSeconds: 3600n, ...extra });
  const asked = [];
  chain.set({
    campaignsCreatedBy: (account, since) => {
      asked.push([account.toLowerCase(), since]);
      const who = c.findIndex((row) => row.wallet_address.toLowerCase() === account.toLowerCase());
      return [[], null, [terms(91n)], [terms(93n, { slotCap: 12 })], [terms(92n)], []][who];
    },
  });
  const log = recordingLogger();
  const relayLib = await relayLibrary();
  assert.equal(await relayLib.reconcileRelayedCampaigns(log, deadline()), 3);
  assert.deepEqual([none.status, none.tx_hash], ['PENDING_DEPOSIT', null], 'nothing on-chain since the draft: released');
  assert.equal(unread.status, 'FUNDING', 'released without the chain having been read back to the draft');
  assert.deepEqual([created.status, created.giveaway_id], ['CONFIRMED', '91'], 'the campaign the account created was not registered');
  assert.equal(otherTerms.status, 'FUNDING', 'released while the account created a campaign since the draft');
  assert.deepEqual([taken.status, taken.giveaway_id], ['PENDING_DEPOSIT', null], 'a campaign another draft registered was taken for this one');
  assert.equal(running.status, 'FUNDING');
  assert.ok(log.events.some((e) => e.kind === 'alert' && e.detail.summary === 'relay campaign in FUNDING with no hash, and a campaign of its creator on-chain with other terms'));
  assert.ok(log.events.some((e) => e.kind === 'alert' && e.detail.summary === 'relay campaign in FUNDING with no hash, older than the campaigns the pass reads back'), 'a draft the pass cannot settle waited in silence');
  // Searched back to the draft's own creation (less the clock margin), and not at all for a request still running.
  const since = BigInt(Math.floor((Date.parse(made) - 5 * 60 * 1000) / 1000));
  assert.ok(asked.every(([, s]) => s === since), `searched from ${asked.map(([, s]) => s)}`);
  assert.ok(!asked.some(([a]) => a === c[5].wallet_address.toLowerCase()), 'the chain was searched for a request still running');
});

// --- F6: ETH above the cost of a sweep -----------------------------------------------------------

await test(['AF6', 'AE1', 'KM34'], 'F6: ETH above what a sweep of it costs now is a balance — "not ready", with an alert — ETH below it is not; the migration’s last sweep takes all of it above that cost, the pipeline’s keeps H7’s threshold', async () => {
  fresh();
  await registered();
  markConfigured();
  kchain.set({ accountState: readyState() });
  const derived = addressOf(44);
  const participantAccount = store.rows('bridge_v2_accounts').find((r) => r.role === 'PARTICIPANT');
  store.rows('bridge_v2_participants')[0].wallet_index = 44;
  store.rows('bridge_v2_participants')[0].wallet_address = derived;
  const { seedRetirementReadiness, migrateAuthorizedWallets } = await migrationLibrary();
  chain.set({ sweepQuote: (wallet) => (wallet.toLowerCase() === derived.toLowerCase() ? { balance: 1_500n, cost: 1_000n } : { balance: 0n, cost: 1_000n }) });
  const above = recordingLogger();
  const holding = await seedRetirementReadiness(above);
  assert.deepEqual([holding.ready, holding.holding], [false, 1], 'ETH above a sweep’s cost was not a balance');
  assert.deepEqual(above.events.filter((e) => e.kind === 'alert').map((e) => e.detail.summary), ['derived wallet holds a balance']);
  // The sweep is priced where a sweep goes: a funder of the pool (H2).
  const quoted = chain.calls.filter((c) => c.name === 'sweepQuote').map((c) => c.args[1]);
  assert.ok(quoted.length > 0 && quoted.every((to) => /^0x[0-9a-fA-F]{40}$/.test(to)));
  chain.set({ sweepQuote: { balance: 999n, cost: 1_000n } });
  const below = recordingLogger();
  assert.equal((await seedRetirementReadiness(below)).ready, true, 'ETH below a sweep’s cost kept the seed');
  assert.ok(!below.events.some((e) => e.kind === 'alert'));

  // The migration's last sweep takes all of it above its own cost, and that cost is kept with the seal.
  openLocks();
  const sealing = store.insert('bridge_v2_migrations', { wallet_index: 44, derived_address: derived, account_id: participantAccount.id, kind: 'PARTICIPANT', sealed_at: null });
  chain.set({ sweepAboveCost: { hash: `0x${'6'.repeat(64)}`, cost: 4_000n } });
  assert.equal(await migrateAuthorizedWallets(recordingLogger(), 2, deadline()), 1);
  assert.deepEqual(chain.calls.filter((c) => c.name === 'sweepAboveCost').map((c) => c.args[1]), [derived]);
  assert.equal(chain.calls.filter((c) => c.name === 'sweepRemainder').length, 0, 'the migration swept with H7’s threshold');
  assert.equal(String(sealing.sweep_cost_wei), '4000');
  // What that sweep leaves is below the cost it had, however far the fee falls afterwards —
  // the owner's decision of 19/09/2026: not a balance up to the recorded cost…
  chain.set({ sweepQuote: { balance: 3_500n, cost: 1_000n } });
  assert.equal((await seedRetirementReadiness(recordingLogger())).ready, true, 'a sealed wallet’s own remainder kept the seed after the fee fell');
  // …and a balance above it, as above the current cost for a wallet not sealed.
  chain.set({ sweepQuote: { balance: 4_001n, cost: 1_000n } });
  assert.equal((await seedRetirementReadiness(recordingLogger())).ready, false);
  // The pipeline's sweep of an entry's remainder still passes no rule: H7's threshold.
  const processor = read('lib/bridge-v2/processor.ts');
  const call = processor.slice(processor.indexOf('const hash = await sweepRemainder('), processor.indexOf(');', processor.indexOf('const hash = await sweepRemainder(')));
  assert.ok(!call.includes('ABOVE_COST'), 'the pipeline’s sweep lost H7’s threshold');
});

// --- F7: every route bounded ---------------------------------------------------------------------

await test(['AF7'], 'F7: every route whose imports reach the chain declares a duration here and in vercel.json, derived and within the platform’s ceiling; the budgeted ones start their budget as the request arrives', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const routes = [];
  const walk = (dir) => {
    for (const name of readdirSync(`${root}${dir}`)) {
      const path = `${dir}/${name}`;
      if (statSync(`${root}${path}`).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) routes.push(path);
    }
  };
  walk('api');
  const reaching = routes.filter((path) => {
    const reached = closure(path);
    return reached.has('lib/bridge-v2/chain.ts') || reached.has('lib/bridge-v2/keptraChain.ts');
  });
  for (const expected of ['api/bridge/v2/account/recovery.ts', 'api/bridge/v2/creator/campaign/status.ts', 'api/bridge/v2/account/relay.ts']) {
    assert.ok(reaching.includes(expected), `${expected} does not reach the chain any more`);
  }
  for (const route of reaching) {
    const seconds = config.ROUTE_MAX_DURATION_SECONDS[route];
    assert.equal(typeof seconds, 'number', `${route} reaches the chain and declares no duration`);
    assert.ok(seconds <= config.CRON_MAX_DURATION_SECONDS, `${route}: ${seconds}s is past the platform's ceiling`);
    assert.equal(vercel.functions[route]?.maxDuration, seconds, `${route}: vercel.json says otherwise`);
    if (seconds === config.CRON_MAX_DURATION_SECONDS) {
      // Budgeted: the budget starts with the request, before any stage it counts.
      const body = read(route).slice(read(route).indexOf('const route = handle('));
      const started = body.indexOf('runDeadline(');
      assert.ok(started !== -1, `${route} declares the ceiling and does not budget itself`);
      for (const stage of ['resolveSession(', 'acquireRunLock(', 'assertConfigured(']) {
        const at = body.indexOf(stage);
        assert.ok(at === -1 || started < at, `${route}: ${stage} runs before its budget starts`);
      }
    }
  }
  // Every route vercel.json configures is derived here (config.ts checks it at import, this says so).
  assert.deepEqual(Object.keys(vercel.functions).sort(), Object.keys(config.ROUTE_MAX_DURATION_SECONDS).sort());
  // The relay's irreversible tail and a submit step fit the budget they are started in.
  assert.ok(config.RELAY_SEND_MS < config.RUN_BUDGET_MS && config.CREATOR_SUBMIT_UNIT_MS < config.RUN_BUDGET_MS);
});

await test(['AF7', 'AE2'], 'F7: the relay records and sends nothing unless the part it cannot take back still fits its budget — otherwise the request is refused as busy, and a retry starts afresh', async () => {
  fresh();
  const { passkey } = await registered();
  markConfigured();
  kchain.set({ accountState: readyState(), isValidPasskeySignature: true, hasCode: true });
  chain.set({ erc20BalanceOf: 9_000_000n });
  const relayLib = await relayLibrary();
  const transfer = { kind: 'transfer', giveawayId: 1n, to: DESTINATION, amount: 1n };
  const prepared = await relayLib.prepareAction('participant-1', transfer, null);
  const assertion = await passkey.sign(prepared.hash);
  await assert.rejects(
    relayLib.submitAction('participant-1', transfer, null, prepared.tx.nonce, assertion, recordingLogger(), deadline(false)),
    (error) => error.reason === 'relayer_unavailable',
  );
  assert.equal(store.rows('bridge_v2_relayed_transactions').length, 0, 'counted without being sent');
  assert.equal(kchain.calls.filter((c) => c.name === 'sendRelayed').length, 0);
  assert.equal(db.callsTo('rpc:bridge_v2_claim_spend').length + db.callsTo('rpc:bridge_v2_acquire_funder').length, 0);
  // With its budget, the same signature goes out.
  const sent = await relayLib.submitAction('participant-1', transfer, null, prepared.tx.nonce, assertion, recordingLogger(), deadline());
  assert.match(sent.txHash, /^0x/);
  assert.equal(store.rows('bridge_v2_relayed_transactions').length, 1);
  // The route starts that budget as the request arrives and hands it on.
  const route = read('api/bridge/v2/account/relay.ts');
  assert.match(route, /const deadline = runDeadline\(\);[\s\S]*resolveSession\(request\)[\s\S]*log,\s*deadline,\s*\)/);
  const relaySource = read('lib/bridge-v2/relay.ts');
  const submit = relaySource.slice(relaySource.indexOf('export async function submitAction'));
  assert.ok(submit.indexOf('hasTimeFor(RELAY_SEND_MS)') < submit.indexOf('recordRelayed(account.id)'), 'recorded before the budget was checked');
  assert.ok(submit.indexOf('hasTimeFor(RELAY_SEND_MS)') < submit.indexOf('sendAsRelayer('), 'sent before the budget was checked');
});

await test(['AF7'], 'F7: creator/campaign/submit starts a step only when it and what follows fit its budget; otherwise it answers "try again" and the campaign stays in FUNDING, which a retry resumes', async () => {
  fresh();
  const derived = addressOf(45);
  const creatorRow = store.insert('bridge_v2_creators', { participant_id: 'participant-1', wallet_index: 45, wallet_address: derived });
  const draft = draftOf(creatorRow.id, derived);
  chain.set({ erc20BalanceOf: 100_000_000n, waitForReceipt: { status: 'success', logs: [giveawayCreatedLog(88n)] } });
  const realNow = Date.now;
  let jump = null;
  db.on('rpc:bridge_v2_try_lock', () => {
    if (jump !== null) Date.now = () => realNow() + jump;
    return { data: 'holder-abc', error: null };
  });
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  const submitRoute = await import('../../../api/bridge/v2/creator/campaign/submit.ts');
  const submit = () => submitRoute.POST(request(url('creator/campaign/submit'), { cookie: SESSION_COOKIE }));
  const steps = () => chain.calls.filter((c) => c.name === 'submitAsDerived').length;
  let response;
  try {
    // Not enough left for the first step and what follows it.
    jump = config.RUN_BUDGET_MS - config.CREATOR_SUBMIT_UNIT_MS + 1_000;
    response = await submit();
  } finally {
    Date.now = realNow;
  }
  assert.equal(response.status, 503);
  assert.equal(steps(), 0, 'a step was started past the budget');
  assert.equal(draft.status, 'FUNDING', 'the campaign did not stay where a retry resumes it');
  assert.ok(db.callsTo('rpc:bridge_v2_release_funder').length === 1 && db.callsTo('rpc:bridge_v2_release_lock').length === 1, 'the lease or the lock was kept');
  // Enough for one step only: the first goes out, the second waits for the retry.
  let quotes = 0;
  chain.set({
    quoteApprove: () => {
      quotes += 1;
      if (quotes === 1) Date.now = () => realNow() + (config.RUN_BUDGET_MS - config.CREATOR_SUBMIT_UNIT_MS + 1_000);
      return { plan: chain.gasPlan(60_000n), data: '0xapprove' };
    },
  });
  jump = null;
  try {
    response = await submit();
  } finally {
    Date.now = realNow;
  }
  assert.equal(response.status, 503);
  assert.equal(steps(), 1);
  assert.equal(draft.status, 'FUNDING');
  // With the whole budget, the retry finishes it.
  chain.set({ quoteApprove: { plan: chain.gasPlan(60_000n), data: '0xapprove' } });
  response = await submit();
  assert.equal(response.status, 200);
  assert.deepEqual([draft.status, draft.giveaway_id], ['CONFIRMED', '88']);
});

await test(['AF7'], 'F7: a maintenance pass with its budget gone starts no step — each reported as not run — and ends with its event and its lock', async () => {
  fresh();
  const realNow = Date.now;
  const { TEST_CRON_SECRET } = await import('../harness.mjs');
  const maintenance = await import('../../../api/bridge/v2/cron/maintenance.ts');
  db.on('rpc:bridge_v2_try_lock', () => {
    Date.now = () => realNow() + config.MAINTENANCE_BUDGET_MS + 1_000;
    return { data: 'holder-abc', error: null };
  });
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  let body;
  try {
    body = await (await maintenance.GET(request(url('cron/maintenance'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }))).json();
  } finally {
    Date.now = realNow;
  }
  const accountsSteps = Object.entries(body.accounts).filter(([name]) => name !== 'roleKeysDistinct');
  assert.deepEqual(
    [body.removed, body.relayRecordsRemoved, body.swept, body.lowFunders, body.vrfLink, body.bridgeRegistered, body.contractPaused],
    [null, null, null, null, null, null, null],
  );
  assert.deepEqual(accountsSteps.filter(([, value]) => value !== null), [], 'a step ran with no time left');
  assert.equal(body.accounts.roleKeysDistinct, null);
  assert.deepEqual([...chain.calls, ...kchain.calls].map((c) => c.name).filter((name) => !['roleAddress', 'keeperAddress'].includes(name)), [], 'the chain was asked past the budget');
  const after = db.calls.slice(db.calls.findIndex((c) => c.key === 'rpc:bridge_v2_try_lock') + 1).map((c) => c.key);
  assert.deepEqual(after, ['bridge_v2_ops_events:insert', 'rpc:bridge_v2_release_lock'], `past the budget: ${after}`);
});

await test(['AF7'], 'F7: a pipeline run with its budget gone starts no phase — not even the read of its queue — and ends with its event and its lock', async () => {
  fresh();
  const realNow = Date.now;
  const { TEST_CRON_SECRET } = await import('../harness.mjs');
  const pipeline = await import('../../../api/bridge/v2/cron/process.ts');
  db.on('rpc:bridge_v2_try_lock', () => ({ data: 'holder-abc', error: null }));
  db.on('rpc:bridge_v2_release_lock', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_next_run_sequence', () => {
    Date.now = () => realNow() + config.RUN_BUDGET_MS + 1_000;
    return { data: 3, error: null };
  });
  let body;
  try {
    body = await (await pipeline.GET(request(url('cron/process'), { method: 'GET', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } }))).json();
  } finally {
    Date.now = realNow;
  }
  for (const phase of config.PIPELINE_PHASES) assert.equal(body[phase], 0, phase);
  assert.deepEqual(chain.calls.map((c) => c.name).filter((name) => !['roleAddress', 'keeperAddress'].includes(name)), []);
  const after = db.calls.slice(db.calls.findIndex((c) => c.key === 'rpc:bridge_v2_next_run_sequence') + 1).map((c) => c.key);
  assert.deepEqual(after, ['bridge_v2_ops_events:insert', 'rpc:bridge_v2_release_lock'], `past the budget: ${after}`);
});

// --- F8: the branches that read embedded rows, with data ----------------------------------------

await test(['AF8', 'KM32', 'KM33'], 'F8: what a derived wallet holds is read through the embedded rows — a claimed prize by its custody row’s entry (tokens and NFTs), a creator’s deposit tokens by its drafts’ creator — and only its own', async () => {
  fresh();
  const participantWallet = addressOf(47);
  const creatorWallet = addressOf(48);
  const ACCOUNT = '0x4242424242424242424242424242424242424242';
  const PRIZE_TOKEN = '0x3131313131313131313131313131313131313131';
  const COLLECTION = '0x3232323232323232323232323232323232323232';
  const CREATOR_TOKEN = '0x3333333333333333333333333333333333333333';
  const custody = (giveawayId, wallet, extra = {}) =>
    store.insert('bridge_v2_custody', { entry_id: `e-${giveawayId}`, claimed_at: new Date().toISOString(), delivered_at: null, entry: { giveaway_id: String(giveawayId), wallet_address: wallet }, ...extra });
  custody(61, participantWallet);
  custody(62, participantWallet);
  custody(63, participantWallet, { delivered_at: new Date().toISOString() });
  custody(64, addressOf(49));
  const nft = encodeFunctionData({ abi: parseAbi(['function safeTransferFrom(address,address,uint256)']), functionName: 'safeTransferFrom', args: [participantWallet, ACCOUNT, 7n] });
  chain.set({
    prizeDelivery: (_campaign, giveawayId) =>
      giveawayId === 61n
        ? { to: PRIZE_TOKEN, amount: 5n, data: encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [ACCOUNT, 5n] }) }
        : giveawayId === 62n
          ? { to: COLLECTION, amount: 1n, data: nft }
          : null,
    erc20BalanceOf: (token, holder) =>
      holder.toLowerCase() === participantWallet.toLowerCase() && token.toLowerCase() === PRIZE_TOKEN.toLowerCase()
        ? 5n
        : holder.toLowerCase() === creatorWallet.toLowerCase() && token.toLowerCase() === CREATOR_TOKEN.toLowerCase()
          ? 9n
          : 0n,
  });
  const { assetTransfers } = await migrationLibrary();
  const moves = await assetTransfers({ id: 'm', walletIndex: 47, derived: participantWallet, accountId: 'a', kind: 'PARTICIPANT' }, ACCOUNT);
  assert.deepEqual(moves.map((m) => m.to.toLowerCase()).sort(), [COLLECTION.toLowerCase(), PRIZE_TOKEN.toLowerCase()].sort());
  assert.deepEqual(
    chain.calls.filter((c) => c.name === 'prizeDelivery').map((c) => c.args[1]).sort(),
    [61n, 62n],
    'a delivered prize, or another wallet’s, was read',
  );
  // A creator's deposits: the prize tokens of its own drafts, whatever their state.
  const creatorRow = store.insert('bridge_v2_creators', { participant_id: 'p-c', wallet_index: 48, wallet_address: creatorWallet });
  draftOf(creatorRow.id, creatorWallet, { prize_token: CREATOR_TOKEN, status: 'EXPIRED' });
  draftOf('someone-else', addressOf(50), { prize_token: '0x3434343434343434343434343434343434343434' });
  const deposits = await assetTransfers({ id: 'm', walletIndex: 48, derived: creatorWallet, accountId: 'a', kind: 'CREATOR' }, ACCOUNT);
  assert.deepEqual(deposits.map((m) => [m.to.toLowerCase(), m.amount]), [[CREATOR_TOKEN.toLowerCase(), 9n]]);
});

await test(['AF8', 'KM34', 'KM33'], 'F8: a creator’s rights are read through its drafts’ embedded creator and the chain — a live draft, a settled campaign with prize left to reclaim, a running one, a cancelled one not refunded — and another creator’s rows are never its', async () => {
  fresh();
  const wallet = addressOf(51);
  const creatorRow = store.insert('bridge_v2_creators', { participant_id: 'p-r', wallet_index: 51, wallet_address: wallet });
  const base = { ...chain.behaviour.readGiveaway };
  const onChain = {
    71: { status: 5, isSettled: true, acceptsEntries: false, prizeAmount: 10n, prizeDelivered: 4n },
    72: { status: 5, isSettled: true, acceptsEntries: false, prizeAmount: 10n, prizeDelivered: 10n },
    73: { status: 1 },
    74: { status: 6, acceptsEntries: false },
    75: { status: 6, acceptsEntries: false },
  };
  chain.set({ readGiveaway: (id) => ({ ...base, ...onChain[Number(id)] }), creatorRefunded: (id) => id === 75n });
  const confirmed = (id) => draftOf(creatorRow.id, wallet, { status: 'CONFIRMED', giveaway_id: String(id) });
  const { openRights } = await migrationLibrary();
  const count = () => openRights('CREATOR', wallet);
  confirmed(72);
  confirmed(75);
  assert.equal(await count(), 0, 'a campaign fully handed out, or cancelled and refunded, is still a right');
  confirmed(71);
  assert.equal(await count(), 1, 'prize left to reclaim is not a right');
  confirmed(73);
  confirmed(74);
  assert.equal(await count(), 3);
  draftOf(creatorRow.id, wallet);
  assert.equal(await count(), 4, 'a live draft is not a right (F2)');
  draftOf('someone-else', addressOf(52), { status: 'CONFIRMED', giveaway_id: '71' });
  assert.equal(await count(), 4, 'another creator’s campaign was counted');
});

await test(['AF8', 'AC1'], 'F8: every reservation the maintenance route starts a unit with — in any file it reaches — is a named reservation of config.ts, inside the budget check', () => {
  const reached = [...closure('api/bridge/v2/cron/maintenance.ts')];
  assert.ok(reached.includes('lib/bridge-v2/relay.ts') && reached.includes('lib/bridge-v2/processor.ts') && reached.includes('lib/bridge-v2/creatorCampaigns.ts'));
  const block = (() => {
    const source = read('lib/bridge-v2/config.ts');
    return source.slice(source.indexOf('export const EVERY_RESERVATION_MS'), source.indexOf('export const LARGEST_UNIT_MS'));
  })();
  assert.match(block, /\.\.\.PHASE_RESERVATION_MS/);
  const named = (where, argument) => {
    if (/^[A-Z][A-Z0-9_]*$/.test(argument)) {
      assert.equal(typeof config[argument], 'number', `${where}: ${argument} is not exported by config.ts`);
      assert.match(block, new RegExp(`\\b${argument}\\b`), `${where}: ${argument} is not in EVERY_RESERVATION_MS`);
      return;
    }
    const phase = argument.match(/^PHASE_RESERVATION_MS(?:\.(\w+)|\[\w+\])$/);
    assert.ok(phase !== null, `${where}: hasTimeFor(${argument}) is not a reservation named in config.ts`);
    if (phase[1] !== undefined) assert.ok(phase[1] in config.PHASE_RESERVATION_MS, `${where}: ${argument}`);
  };
  let found = 0;
  for (const path of reached) {
    // runlock.ts defines hasTimeFor; every other file only calls it.
    if (path === 'lib/bridge-v2/runlock.ts') continue;
    const text = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/remainingMs\(/.test(text) || path === 'lib/bridge-v2/runlock.ts', `${path} measures time outside hasTimeFor`);
    for (const [, raw] of text.matchAll(/hasTimeFor\(([^)]*)\)/g)) {
      const argument = raw.trim();
      found += 1;
      if (/^[a-z]\w*$/.test(argument)) {
        // A local: every value it can take must be a named reservation.
        const assigned = text.match(new RegExp(`const ${argument} =([^;]+);`));
        assert.ok(assigned !== null, `${path}: hasTimeFor(${argument}) with no declaration to read`);
        for (const option of assigned[1].split(/[?:]/).map((part) => part.trim()).filter((part) => part !== '' && !/^\w+\.\w+$/.test(part) || /^PHASE_RESERVATION_MS\./.test(part))) {
          if (/^entry\./.test(option)) continue;
          named(`${path} (${argument})`, option);
        }
      } else {
        named(path, argument);
      }
    }
  }
  assert.ok(found >= 30, `only ${found} reservations found`);
  for (const [unit, ms] of Object.entries(config.EVERY_RESERVATION_MS)) {
    assert.ok(ms < config.MAINTENANCE_BUDGET_MS, `${unit}: ${ms} ms does not fit the maintenance budget`);
  }
});

// --- F10: what production carried for nothing, and the counting tables' retention -------------------

await test(['AF10', 'AC11', 'AE2'], 'F10: the relay’s two counting tables keep no row older than seven days — the maintenance pass removes them and keeps the rest', async () => {
  fresh();
  await registered();
  const account = store.rows('bridge_v2_accounts')[0];
  const at = (days) => new Date(Date.now() - days * 24 * HOUR_MS).toISOString();
  for (const table of ['bridge_v2_relayed_transactions', 'bridge_v2_guardian_changes']) {
    for (const days of [0, 1, 6.9, 7.1, 30]) store.insert(table, { account_id: account.id, created_at: at(days) });
  }
  const body = await maintenancePass();
  assert.equal(body.relayRecordsRemoved, 4);
  for (const table of ['bridge_v2_relayed_transactions', 'bridge_v2_guardian_changes']) {
    const left = store.rows(table).map((row) => Date.now() - Date.parse(row.created_at));
    assert.equal(left.length, 3, table);
    assert.ok(left.every((age) => age < config.RELAY_RECORD_RETENTION_DAYS * 24 * HOUR_MS), `${table} kept a row past seven days`);
  }
  // The counts the relay makes (24 hours) are unchanged by it.
  assert.equal(await accounts.relayedSince(account.id, new Date(Date.now() - 24 * HOUR_MS)), 1);
});

await test(['AF10', 'AE9'], 'F10: production no longer decodes the batch it just encoded — the closed list reads the calls first — and the fork calls markDeployed as production defines it', () => {
  const keptraSource = read('lib/bridge-v2/keptra.ts');
  assert.ok(!/export function (decodeMultiSend|callsOf)\b/.test(keptraSource), 'the decoder is still in production');
  assert.equal(typeof keptra.decodeMultiSend, 'undefined');
  assert.equal(typeof keptra.callsOf, 'undefined');
  assert.equal(keptra.refusalFor.length, 5);
  const relaySource = read('lib/bridge-v2/relay.ts');
  const prepare = relaySource.slice(relaySource.indexOf('export async function prepareAction'), relaySource.indexOf('export interface Assertion'));
  assert.ok(prepare.indexOf('refusalFor(account.safe, all,') !== -1 && prepare.indexOf('refusalFor(') < prepare.indexOf('safeTxFor('), 'the list is checked after it is encoded');
  const fork = read('test/bridge-v2/fork/keptra.fork.mjs');
  const uses = [...fork.matchAll(/markDeployed\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0 && uses.every((args) => !args.includes(',')), `markDeployed called with ${uses}`);
  assert.equal(accounts.markDeployed.length, 1);
});

// --- F12: the suite's exit code ---------------------------------------------------------------------

await test(['AF12'], 'F12: the suite exits non-zero when any test fails that is not one of the three declared baseline failures, and only then', async () => {
  const { BASELINE_FAILURES, verdict } = await import('../verdict.mjs');
  assert.deepEqual(BASELINE_FAILURES.map((f) => f.suite), ['sql', 'source', 'processor']);
  const pass = (suite, name) => ({ suite, name, requirements: [], ok: true });
  const fail = (suite, name) => ({ suite, name, requirements: [], ok: false });
  const baseline = BASELINE_FAILURES.map((f) => fail(f.suite, f.name));
  assert.equal(verdict([pass('keptra', 'x'), ...baseline]).exitCode, 0);
  assert.equal(verdict([pass('keptra', 'x')]).exitCode, 0, 'a baseline failure that starts passing failed the run');
  assert.equal(verdict([...baseline, fail('keptra', 'anything new')]).exitCode, 1);
  // A baseline title in another suite is not the baseline test.
  assert.equal(verdict([fail('keptra', BASELINE_FAILURES[0].name)]).exitCode, 1);
  assert.equal(verdict([fail('fork', 'the on-chain suite ran and reported')]).exitCode, 1);
  // And the code survives the exit hook embedded-postgres installs, which used to turn every run into 0.
  const script = (results) => `
    import hook from 'async-exit-hook';
    import { exitWith, verdict } from './test/bridge-v2/verdict.mjs';
    hook(() => {});
    exitWith(verdict(${JSON.stringify(results)}).exitCode);`;
  const run = (source) => spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8' }).status;
  assert.equal(run(script([...baseline, fail('keptra', 'new')])), 1);
  assert.equal(run(script(baseline)), 0);
  // The defect F12 answers: exitCode set, then the hook's beforeExit ends the process with 0.
  assert.equal(run(`import hook from 'async-exit-hook'; hook(() => {}); process.exitCode = 1;`), 0);
  assert.match(read('test/bridge-v2/run.mjs'), /exitWith\(outcome\.exitCode\)/);
});

// ===========================================================================
// migration 0012, executed — M3, M29, M31, and the grants
// ===========================================================================

let engine = null;
try {
  await bootEngine();
  engine = await createDatabase('bridge_v2_keptra', { withCitext: true });
  for (const file of [
    '0004_bridge_v2_schema.sql',
    '0005_bridge_v2_functions.sql',
    '0006_bridge_v2_grants.sql',
    '0007_bridge_v2_routes.sql',
    '0010_bridge_v2_outcomes.sql',
    '0011_campaign_identity.sql',
    '0012_keptra_accounts.sql',
  ]) {
    const applied = await applyMigration(engine, file);
    if (!applied.ok) throw new Error(`${file} did not apply: ${applied.at} ${applied.text}`);
  }
} catch (error) {
  await test(['KM31'], 'migration 0012 applies after 0004 to 0011', () => {
    throw error;
  });
  engine = null;
}

if (engine !== null) {
  const q = (text, values) => sql(engine, text, values);
  const participant = async (email) => (await q(`INSERT INTO bridge_v2_participants (email_canonical) VALUES ($1) RETURNING id, wallet_index, wallet_address`, [email])).rows[0];

  await test(['KM31'], '0012: a participant row needs no derivation index, and index and address stay a pair', async () => {
    const row = await participant('fresh@example.test');
    assert.equal(row.wallet_index, null);
    assert.equal(row.wallet_address, null);
    const half = await attempt(engine.pool, `INSERT INTO bridge_v2_participants (email_canonical, wallet_index) VALUES ('half@example.test', 5)`);
    assert.equal(half.ok, false);
    assert.equal(half.code, '23514');
  });

  await test(['KM3'], '0012: one account per participant and role, and an address is never reused', async () => {
    const { id } = await participant('owner@example.test');
    const insert = (role, safe) =>
      attempt(engine.pool, `INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, $2, $3, $4, $4)`, [id, role, safe, SIGNER]);
    assert.equal((await insert('PARTICIPANT', SAFE)).ok, true);
    assert.equal((await insert('CREATOR', '0x6666666666666666666666666666666666666666')).ok, true);
    const second = await insert('PARTICIPANT', '0x7777777777777777777777777777777777777777');
    assert.equal(second.code, '23505', 'a second participant account for the same person');
    const other = await participant('other@example.test');
    const reused = await attempt(engine.pool, `INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, 'PARTICIPANT', $2, $3, $3)`, [other.id, SAFE, SIGNER]);
    assert.equal(reused.code, '23505', 'two participants share an account address');
  });

  await test(['KM29', 'KM11'], '0012: an account entry is always self-custody and can never be marked funded', async () => {
    const { id } = await participant('entrant@example.test');
    const entry = (giveaway, extra) =>
      attempt(engine.pool, `INSERT INTO bridge_v2_entries (participant_id, giveaway_id, status, wallet_address, idempotency_key, passkey, self_custody, funded_at) VALUES ($1, $2, 'VERIFIED', $3, $4, true, $5, $6)`, [id, giveaway, SAFE, `k-${giveaway}`, ...extra]);
    assert.equal((await entry(1, [false, null])).code, '23514', 'a passkey entry that is not self-custody');
    assert.equal((await entry(2, [true, new Date().toISOString()])).code, '23514', 'a passkey entry marked funded');
    assert.equal((await entry(3, [true, null])).ok, true);
  });

  await test(['KM14', 'KM23'], '0012: one live change of access per participant; a notice is recorded once', async () => {
    const { id } = await participant('recover@example.test');
    const passkey = (await q(`INSERT INTO bridge_v2_passkeys (participant_id, credential_id, public_x, public_y, signer_address) VALUES ($1, $2, 1, 2, $3) RETURNING id`, [id, 'p'.repeat(20), '0x8888888888888888888888888888888888888888'])).rows[0].id;
    const open = (code) => attempt(engine.pool, `INSERT INTO bridge_v2_recoveries (participant_id, passkey_id, status, link_code_hash, link_expires_at) VALUES ($1, $2, 'AWAITING_PHONE', $3, now()) RETURNING id`, [id, passkey, code]);
    const first = await open('code-1');
    assert.equal(first.ok, true);
    assert.equal((await open('code-2')).code, '23505');
    // Once cancelled, a new one may start (R-7).
    await q(`UPDATE bridge_v2_recoveries SET status = 'CANCELED' WHERE id = $1`, [first.rows[0].id]);
    assert.equal((await open('code-3')).ok, true);
    const notice = () => attempt(engine.pool, `INSERT INTO bridge_v2_recovery_notices (recovery_id, stage, channel) VALUES ($1, 'START', 'EMAIL')`, [first.rows[0].id]);
    assert.equal((await notice()).ok, true);
    assert.equal((await notice()).code, '23505');
  });

  await test(['AC3'], '0012: EXPIRED is a state, it frees the one-live-request index, and the expiry statement is the one accounts.ts runs', async () => {
    const { id } = await participant('expired@example.test');
    const passkey = (await q(`INSERT INTO bridge_v2_passkeys (participant_id, credential_id, public_x, public_y, signer_address) VALUES ($1, $2, 1, 2, $3) RETURNING id`, [id, 'e'.repeat(20), '0x9898989898989898989898989898989898989898'])).rows[0].id;
    const open = (code, expires) => attempt(engine.pool, `INSERT INTO bridge_v2_recoveries (participant_id, passkey_id, status, link_code_hash, link_expires_at) VALUES ($1, $2, 'AWAITING_PHONE', $3, $4) RETURNING id`, [id, passkey, code, expires]);
    assert.equal((await open('exp-1', new Date(Date.now() - 60_000).toISOString())).ok, true);
    assert.equal((await open('exp-2', new Date(Date.now() + 60_000).toISOString())).code, '23505');
    // What expireAbandonedRecoveries sends: one conditional UPDATE.
    const expired = await q(`UPDATE bridge_v2_recoveries SET status = 'EXPIRED', updated_at = now() WHERE status = 'AWAITING_PHONE' AND link_expires_at <= now() AND participant_id = $1 RETURNING id`, [id]);
    assert.equal(expired.rowCount, 1);
    assert.equal((await open('exp-3', new Date(Date.now() + 60_000).toISOString())).ok, true, 'an expired request still held the index');
    const unknown = await attempt(engine.pool, `UPDATE bridge_v2_recoveries SET status = 'LOST' WHERE participant_id = $1`, [id]);
    assert.equal(unknown.code, '23514');
  });

  await test(['AC11'], '0012: guardian changes are recorded per account by the service, stamped by the database, and counted in a window', async () => {
    const { id } = await participant('guardian@example.test');
    const account = (await q(`INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, 'PARTICIPANT', $2, $3, $3) RETURNING id`, [id, '0x9797979797979797979797979797979797979797', SIGNER])).rows[0].id;
    for (let i = 0; i < 3; i += 1) {
      const insert = await asRole(engine, 'service_role', (client) => attempt(client, `INSERT INTO bridge_v2_guardian_changes (account_id) VALUES ($1) RETURNING created_at`, [account]));
      assert.equal(insert.ok, true);
    }
    // The query guardianChangesSince makes.
    const counted = await q(`SELECT id FROM bridge_v2_guardian_changes WHERE account_id = $1 AND created_at >= $2`, [account, new Date(Date.now() - 86_400_000).toISOString()]);
    assert.equal(counted.rowCount, 3);
    const orphan = await attempt(engine.pool, `INSERT INTO bridge_v2_guardian_changes (account_id) VALUES (gen_random_uuid())`);
    assert.equal(orphan.code, '23503');
  });

  await test(['AD6', 'AD1'], '0012 on an engine with Supabase’s default privileges: every new table holds exactly its listed verbs, for every role', async () => {
    const expected = {
      bridge_v2_accounts: 'SELECT,INSERT,UPDATE',
      // Adenda F10: the two counting tables keep seven days, so the service deletes from them.
      bridge_v2_guardian_changes: 'SELECT,INSERT,DELETE',
      bridge_v2_guardian_incidents: 'SELECT',
      bridge_v2_migrations: 'SELECT,INSERT,UPDATE',
      bridge_v2_passkeys: 'SELECT,INSERT',
      bridge_v2_recoveries: 'SELECT,INSERT,UPDATE',
      bridge_v2_recovery_notices: 'SELECT,INSERT',
      bridge_v2_relayed_transactions: 'SELECT,INSERT,DELETE',
    };
    const held = await q(
      `SELECT c.relname AS name, r.rolname AS role,
              array_to_string(ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                                     WHERE has_table_privilege(r.rolname, c.oid, p)), ',') AS verbs
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN pg_roles r
        WHERE n.nspname = 'public' AND c.relname = ANY($1) AND r.rolname IN ('service_role', 'anon', 'authenticated')
        ORDER BY c.relname, r.rolname`,
      [Object.keys(expected)],
    );
    const shape = (role) => Object.fromEntries(held.rows.filter((row) => row.role === role).map((row) => [row.name, row.verbs]));
    assert.deepEqual(shape('service_role'), expected, 'a verb came from the default privileges, or one the code uses is missing');
    for (const role of ['anon', 'authenticated']) {
      assert.deepEqual(Object.values(shape(role)), Object.keys(expected).map(() => ''), `${role} holds a privilege`);
    }
    // D1: the bridge reads incidents and never writes one; the owner writes them, in lower case.
    const write = await asRole(engine, 'service_role', (client) =>
      attempt(client, `INSERT INTO bridge_v2_guardian_incidents (guardian_address) VALUES ('0x${'a'.repeat(40)}')`));
    assert.equal(write.code, '42501');
    assert.equal((await attempt(engine.pool, `INSERT INTO bridge_v2_guardian_incidents (guardian_address) VALUES ('0x${'A'.repeat(40)}')`)).code, '23514');
    assert.equal((await attempt(engine.pool, `INSERT INTO bridge_v2_guardian_incidents (guardian_address) VALUES ('0x${'a'.repeat(40)}')`)).ok, true);
    const read = await asRole(engine, 'service_role', (client) =>
      attempt(client, `SELECT guardian_address FROM bridge_v2_guardian_incidents WHERE guardian_address = '0x${'a'.repeat(40)}'`));
    assert.equal(read.rows.length, 1);
  });

  await test(['KM1', 'AC11'], '0012: the new tables are closed to the browser roles', async () => {
    for (const table of ['bridge_v2_passkeys', 'bridge_v2_accounts', 'bridge_v2_recoveries', 'bridge_v2_recovery_notices', 'bridge_v2_migrations', 'bridge_v2_guardian_changes', 'bridge_v2_relayed_transactions']) {
      for (const role of ['anon', 'authenticated']) {
        const outcome = await asRole(engine, role, (client) => attempt(client, `SELECT 1 FROM ${table} LIMIT 1`));
        assert.equal(outcome.ok, false, `${role} can read ${table}`);
      }
      const service = await asRole(engine, 'service_role', (client) => attempt(client, `SELECT 1 FROM ${table} LIMIT 1`));
      assert.equal(service.ok, true, `service_role cannot read ${table}`);
    }
  });
  await test(['AE4', 'AE11'], '0012: a reserved request is never expired by D3, one D3 expired is never reserved, and run at the same moment exactly one of the two wins', async () => {
    const { id } = await participant('reserve@example.test');
    const passkey = (await q(`INSERT INTO bridge_v2_passkeys (participant_id, credential_id, public_x, public_y, signer_address) VALUES ($1, $2, 1, 2, $3) RETURNING id`, [id, 'r'.repeat(20), '0x9696969696969696969696969696969696969696'])).rows[0].id;
    const open = async (code) => {
      await q(`UPDATE bridge_v2_recoveries SET status = 'EXPIRED' WHERE participant_id = $1 AND status = 'PHONE_VERIFIED'`, [id]);
      return (await q(`INSERT INTO bridge_v2_recoveries (participant_id, passkey_id, status, link_code_hash, link_expires_at) VALUES ($1, $2, 'PHONE_VERIFIED', $3, now()) RETURNING id`, [id, passkey, code])).rows[0].id;
    };
    // What reserveRecovery and D3's closure (advanceRecovery, unreserved) send.
    const reserve = (request) =>
      q(`UPDATE bridge_v2_recoveries SET confirming_at = now(), updated_at = now() WHERE id = $1 AND status = 'PHONE_VERIFIED' AND confirming_at IS NULL AND created_at > now() - interval '24 hours' RETURNING id`, [request]);
    const expire = (request) =>
      q(`UPDATE bridge_v2_recoveries SET status = 'EXPIRED', updated_at = now() WHERE id = $1 AND status = 'PHONE_VERIFIED' AND confirming_at IS NULL RETURNING id`, [request]);
    const first = await open('reserve-1');
    assert.equal((await reserve(first)).rowCount, 1);
    assert.equal((await expire(first)).rowCount, 0, 'D3 expired a reserved request');
    assert.equal((await reserve(first)).rowCount, 0, 'reserved twice');
    // Given back (releaseRecoveryReservations): D3 may close it, and then it is never reserved.
    await q(`UPDATE bridge_v2_recoveries SET confirming_at = NULL WHERE status = 'PHONE_VERIFIED' AND confirming_at IS NOT NULL AND id = $1`, [first]);
    assert.equal((await expire(first)).rowCount, 1);
    assert.equal((await reserve(first)).rowCount, 0, 'an expired request was reserved');
    // The race itself, on two connections at once.
    for (let round = 0; round < 5; round += 1) {
      const request = await open(`race-${round}`);
      const [reserved, expired] = await Promise.all([reserve(request), expire(request)]);
      assert.equal(reserved.rowCount + expired.rowCount, 1, `round ${round}: both or neither won`);
    }
  });

  await test(['AE2', 'AE9'], '0012: relayed transactions are recorded by the service and counted in a window; the accounts table has no column production does not read', async () => {
    const { id } = await participant('relayed@example.test');
    const account = (await q(`INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, 'PARTICIPANT', $2, $3, $3) RETURNING id`, [id, '0x9595959595959595959595959595959595959595', SIGNER])).rows[0].id;
    for (let i = 0; i < 3; i += 1) {
      const insert = await asRole(engine, 'service_role', (client) => attempt(client, `INSERT INTO bridge_v2_relayed_transactions (account_id) VALUES ($1)`, [account]));
      assert.equal(insert.ok, true);
    }
    // The query relayedSince makes.
    const counted = await q(`SELECT id FROM bridge_v2_relayed_transactions WHERE account_id = $1 AND created_at >= $2`, [account, new Date(Date.now() - 86_400_000).toISOString()]);
    assert.equal(counted.rowCount, 3);
    assert.equal((await attempt(engine.pool, `INSERT INTO bridge_v2_relayed_transactions (account_id) VALUES (gen_random_uuid())`)).code, '23503');
    const columns = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'bridge_v2_accounts'`);
    const names = columns.rows.map((row) => row.column_name);
    assert.ok(!names.includes('deploy_tx_hash') && !names.includes('guardian_revoked_at'), `columns: ${names}`);
    const recoveries = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'bridge_v2_recoveries' AND column_name = 'confirming_at'`);
    assert.equal(recoveries.rowCount, 1);
  });

  await test(['AF2'], '0012 (F2): a draft can be EXPIRED, nothing else is added, and an EXPIRED draft is not the creator’s one active draft', async () => {
    const { id } = await participant('f2-creator@example.test');
    const creator = (await q(`INSERT INTO bridge_v2_creators (participant_id, wallet_index, wallet_address) VALUES ($1, NULL, $2) RETURNING id`, [id, '0x9191919191919191919191919191919191919191'])).rows[0].id;
    const draft = (status) =>
      attempt(
        engine.pool,
        `INSERT INTO bridge_v2_creator_campaigns (creator_id, status, module, prize_token, prize_amount, duration_seconds, winners_count, slot_cap, fee_amount, slots_cost)
         VALUES ($1, $2, $3, $3, 1, 3600, 1, 10, 1, 1)`,
        [creator, status, '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b'],
      );
    assert.equal((await draft('EXPIRED')).ok, true);
    assert.equal((await draft('EXPIRED')).ok, true, 'two EXPIRED drafts collided on the active-draft index');
    assert.equal((await draft('PENDING_DEPOSIT')).ok, true);
    assert.equal((await draft('PENDING_DEPOSIT')).code, '23505', 'the one active draft is no longer enforced');
    assert.equal((await draft('CLOSED')).code, '23514');
    // The expiry statement expireUnfundedDrafts runs, by the service.
    const expired = await asRole(engine, 'service_role', (client) =>
      attempt(client, `UPDATE bridge_v2_creator_campaigns SET status = 'EXPIRED', updated_at = now() WHERE creator_id = $1 AND status = 'PENDING_DEPOSIT' RETURNING id`, [creator]));
    assert.equal(expired.rows.length, 1);
    assert.equal((await draft('PENDING_DEPOSIT')).ok, true, 'an EXPIRED draft still held the slot');
  });

  await test(['AF1'], '0012 (F1): the recorded guardian can be none — the pass records NULL once an account holds no guardian on-chain — and anything recorded is still an address', async () => {
    const { id } = await participant('f1-guardian@example.test');
    const account = (await q(`INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, 'PARTICIPANT', $2, $3, $3) RETURNING id`, [id, '0x9292929292929292929292929292929292929292', SIGNER])).rows[0].id;
    const record = (value) => asRole(engine, 'service_role', (client) => attempt(client, `UPDATE bridge_v2_accounts SET guardian_address = $2 WHERE id = $1`, [account, value]));
    assert.equal((await record(null)).ok, true);
    assert.equal((await q(`SELECT guardian_address FROM bridge_v2_accounts WHERE id = $1`, [account])).rows[0].guardian_address, null);
    assert.equal((await record('not-an-address')).code, '23514');
    assert.equal((await record('0x9393939393939393939393939393939393939393')).ok, true);
  });

  await test(['AF6'], '0012 (F6): a seal keeps what the last sweep cost, written by the service with the seal, never negative', async () => {
    const { id } = await participant('f6-seal@example.test');
    const account = (await q(`INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, 'PARTICIPANT', $2, $3, $3) RETURNING id`, [id, '0x9696969696969696969696969696969696969696', SIGNER])).rows[0].id;
    const migration = (await q(`INSERT INTO bridge_v2_migrations (wallet_index, derived_address, account_id, kind) VALUES (7001, $1, $2, 'PARTICIPANT') RETURNING id`, ['0x9797979797979797979797979797979797979797', account])).rows[0].id;
    const seal = (cost) =>
      asRole(engine, 'service_role', (client) =>
        attempt(client, `UPDATE bridge_v2_migrations SET sealed_at = now(), updated_at = now(), sweep_cost_wei = $2 WHERE id = $1 AND sealed_at IS NULL`, [migration, cost]));
    assert.equal((await seal('-1')).code, '23514');
    assert.equal((await seal('428526000')).ok, true);
    assert.equal((await q(`SELECT sweep_cost_wei::text AS cost FROM bridge_v2_migrations WHERE id = $1`, [migration])).rows[0].cost, '428526000');
  });

  await test(['AF10'], '0012 (F10): the service deletes the relay’s counting rows past seven days, the statement purgeRelayRecords makes, and nothing else of 0012', async () => {
    const { id } = await participant('f10-retention@example.test');
    const account = (await q(`INSERT INTO bridge_v2_accounts (participant_id, role, safe_address, initial_signer, guardian_address) VALUES ($1, 'PARTICIPANT', $2, $3, $3) RETURNING id`, [id, '0x9494949494949494949494949494949494949494', SIGNER])).rows[0].id;
    for (const table of ['bridge_v2_relayed_transactions', 'bridge_v2_guardian_changes']) {
      await q(`INSERT INTO ${table} (account_id, created_at) VALUES ($1, now() - interval '8 days'), ($1, now() - interval '6 days'), ($1, now())`, [account]);
      const purged = await asRole(engine, 'service_role', (client) =>
        attempt(client, `DELETE FROM ${table} WHERE created_at < $1 RETURNING id`, [new Date(Date.now() - 7 * 86_400_000).toISOString()]));
      assert.equal(purged.ok, true, `${table}: the service cannot delete`);
      assert.equal(purged.rows.length, 1, table);
      assert.equal((await q(`SELECT count(*)::int AS n FROM ${table} WHERE account_id = $1`, [account])).rows[0].n, 2);
    }
    for (const table of ['bridge_v2_accounts', 'bridge_v2_passkeys', 'bridge_v2_recoveries', 'bridge_v2_migrations']) {
      const denied = await asRole(engine, 'service_role', (client) => attempt(client, `DELETE FROM ${table} WHERE false`));
      assert.equal(denied.code, '42501', `${table} can be deleted from`);
    }
  });
}
