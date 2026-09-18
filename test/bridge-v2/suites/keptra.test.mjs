/**
 * SPEC-BLOCO-03 piece 1 (MATRIZ-PECA1-KEPTRA M1-M46, tagged KMn), everything that
 * is not on-chain: the pure half of the accounts, the four account routes, the
 * pipeline's handling of an account entry, the recovery pass driven by a test
 * clock, the Telegram branch of A14, and migration 0012 executed on the embedded
 * Postgres. The on-chain half is test/bridge-v2/fork, against the real contracts.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, zeroAddress } from 'viem';
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
  store.insert('bridge_v2_participants', { id: participantId, email_canonical: 'someone@example.test', wallet_index: null, wallet_address: null });
}

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
  assert.deepEqual(lower(keptra.callsOf(tx)), lower(calls));
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
const selfCall = (functionName, args) => ({ to: SAFE, data: encodeFunctionData({ abi: keptra.SAFE_ABI, functionName, args }) });

await test(['KM20', 'KM21'], 'the closed list refuses setFallbackHandler, enableModule and disableModule on the account, alone or in a batch', () => {
  const refused = [
    selfCall('setFallbackHandler', [keptra.RECOVERY_MODULE]),
    selfCall('setFallbackHandler', [keptra.FALLBACK_HANDLER]),
    selfCall('enableModule', [keptra.RECOVERY_MODULE]),
    selfCall('disableModule', [keptra.SENTINEL, keptra.RECOVERY_MODULE]),
  ];
  for (const call of refused) {
    assert.equal(keptra.refusalFor(SAFE, keptra.safeTxFor([call], 1n), null, guardian()), 'self_call');
    const batch = keptra.safeTxFor([{ to: config.USDC, data: '0x' }, call], 1n);
    assert.equal(keptra.refusalFor(SAFE, batch, null, guardian()), 'self_call', 'a batch smuggled it through');
  }
  // What the relay does build passes.
  assert.equal(keptra.refusalFor(SAFE, keptra.safeTxFor(keptra.addOwnerCalls(SAFE, SIGNER), 1n), null, guardian()), null);
  assert.equal(keptra.refusalFor(SAFE, keptra.safeTxFor(keptra.cancelRecoveryCalls(), 1n), null, guardian()), null);
});

await test(['KM21'], 'the closed list: delegatecall only to MultiSendCallOnly, no nested batch, the configuration only at nonce 0', () => {
  const delegate = { to: config.USDC, data: '0x', operation: 1, nonce: 1n };
  assert.equal(keptra.refusalFor(SAFE, delegate, null, guardian()), 'delegatecall_target');
  const nested = keptra.safeTxFor([{ to: keptra.MULTI_SEND_CALL_ONLY, data: '0x' }, { to: config.USDC, data: '0x' }], 1n);
  assert.equal(keptra.refusalFor(SAFE, nested, null, guardian()), 'nested_batch');
  const configuration = keptra.configurationCalls(SAFE, guardian());
  const first = keptra.safeTxFor([...configuration, { to: config.USDC, data: '0x' }], 0n);
  assert.equal(keptra.refusalFor(SAFE, first, configuration, guardian()), null);
  assert.equal(keptra.refusalFor(SAFE, keptra.safeTxFor([...configuration], 3n), configuration, guardian()), 'configuration_not_first');
  // enableModule outside the configuration prefix is refused (R-5).
  assert.equal(keptra.refusalFor(SAFE, keptra.safeTxFor(configuration, 5n), null, guardian()), 'self_call');
  // A guardian the platform does not hold is never named.
  const other = '0x5555555555555555555555555555555555555555';
  assert.equal(keptra.refusalFor(SAFE, keptra.safeTxFor(keptra.addGuardianCalls(other), 1n), null, guardian()), 'guardian_mismatch');
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

await test(['KM46'], 'no new dependency: the manifest lists exactly what main lists', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    '@supabase/supabase-js', '@tanstack/react-query', 'clsx', 'lucide-react', 'react', 'react-dom',
    'react-router-dom', 'resend', 'tailwind-merge', 'viem', 'wagmi',
  ]);
  assert.deepEqual(Object.keys(manifest.devDependencies).sort(), [
    '@types/react', '@types/react-dom', '@vitejs/plugin-react', 'autoprefixer', 'embedded-postgres', 'pg',
    'postcss', 'tailwindcss', 'typescript', 'vite',
  ]);
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
  store.rows('bridge_v2_accounts').forEach((row) => {
    row.deployed_at = new Date().toISOString();
  });
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

  await test(['KM1'], '0012: the new tables are closed to the browser roles', async () => {
    for (const table of ['bridge_v2_passkeys', 'bridge_v2_accounts', 'bridge_v2_recoveries', 'bridge_v2_recovery_notices', 'bridge_v2_migrations']) {
      for (const role of ['anon', 'authenticated']) {
        const outcome = await asRole(engine, role, (client) => attempt(client, `SELECT 1 FROM ${table} LIMIT 1`));
        assert.equal(outcome.ok, false, `${role} can read ${table}`);
      }
      const service = await asRole(engine, 'service_role', (client) => attempt(client, `SELECT 1 FROM ${table} LIMIT 1`));
      assert.equal(service.ok, true, `service_role cannot read ${table}`);
    }
  });
}
