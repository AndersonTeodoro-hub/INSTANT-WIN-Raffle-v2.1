/**
 * The scheduled pipeline, with the RPC, the database and the providers replaced
 * by doubles.
 *
 * Everything under test here is real: processor.ts, entries.ts, eligibility.ts,
 * merkle.ts, funders.ts, wallet.ts, custody.ts and spend.ts. What is doubled is
 * the chain and the database, so a run can be put into states that are otherwise
 * only reachable by killing a function halfway through — which is exactly the
 * class of failure this pipeline exists to survive.
 */

import { assert, deadline, http, jsonResponse, recordingLogger, suite, test } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import * as chain from '../doubles/chain.mjs';

import {
  processEligibleEntries,
  processPrizes,
  publishPendingRoots,
  reconcileFunding,
  reconcileSubmitted,
  sweepConfirmed,
} from '../../../lib/bridge-v2/processor.ts';
import { buildTree } from '../../../lib/bridge-v2/merkle.ts';
import { addressOf } from '../../../lib/bridge-v2/wallet.ts';
import * as config from '../../../lib/bridge-v2/config.ts';

suite('processor');

const WALLET = addressOf(0);
const HASH = `0x${'a'.repeat(64)}`;

const DEFAULT_CAMPAIGN = {
  status: 1,
  isOpen: true,
  isSettled: false,
  endTime: 0n,
  effectiveEndTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
  acceptsEntries: true,
  prizeModule: '0x0000000000000000000000000000000000000000',
  prizeKind: 0,
  prizeAmount: 0n,
  declaredValue: 0n,
  winnersCount: 1,
  feeToken: config.USDC,
  settledAt: 0n,
};

const settled = (overrides = {}) => ({
  ...DEFAULT_CAMPAIGN,
  status: 5,
  isOpen: false,
  isSettled: true,
  acceptsEntries: false,
  settledAt: BigInt(Math.floor(Date.now() / 1000) - 60),
  ...overrides,
});

function entryRow(overrides = {}) {
  return {
    id: 'entry-1',
    participant_id: 'participant-1',
    giveaway_id: '1',
    status: 'ELIGIBLE',
    wallet_address: WALLET,
    phone_hmac: null,
    root_index: '0',
    tx_hash: null,
    ...overrides,
  };
}

function custodyRow(overrides = {}) {
  return {
    entry_id: 'entry-1',
    prize_kind: 'TOKEN',
    requires_own_wallet: false,
    destination_address: null,
    destination_confirmed_at: null,
    custody_expires_at: null,
    claimed_at: null,
    claim_tx_hash: null,
    delivered_at: null,
    delivery_tx_hash: null,
    custody_expired_alert_at: null,
    no_prize_at: null,
    entry: { participant_id: 'participant-1', giveaway_id: '1', wallet_address: WALLET },
    ...overrides,
  };
}

/** A clean slate with the writes a run needs in order to get anywhere. */
function fresh() {
  db.reset();
  chain.reset();
  http.reset();
  http.on('api.telegram.org', () => jsonResponse({ ok: true }));
  db.on('bridge_v2_participants:select', () => ({
    data: { id: 'participant-1', wallet_index: 0, wallet_address: WALLET },
    error: null,
  }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_acquire_funder', () => ({
    data: [{ funder_index: 0, address: addressOf(5), next_nonce: 7, lease_token: 'lease-1' }],
    error: null,
  }));
  db.on('rpc:bridge_v2_renew_funder_lease', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_release_funder', () => ({ data: true, error: null }));
  db.on('rpc:bridge_v2_reconcile_funder_nonce', () => ({ data: true, error: null }));
  // The account agrees with the stored nonce, so the G6 reconciliation is a
  // no-op unless a test asks for a disagreement.
  chain.set({ transactionCount: { latest: 7, pending: 7 } });
  // Every transition matches by default; a test that cares programs its own.
  db.on('bridge_v2_entries:update', () => ({ data: { id: 'entry-1' }, error: null }));
  db.on('bridge_v2_custody:update', () => ({ data: { entry_id: 'entry-1' }, error: null }));
}

/** The transitions a run performed, as [from, to] pairs. */
const transitions = () =>
  db
    .callsTo('bridge_v2_entries:update')
    .filter((call) => call.payload.status !== undefined)
    .map((call) => [
      call.filters.find(([, column]) => column === 'status')?.[2] ?? null,
      call.payload.status,
    ]);

const events = (log) => log.events.map((entry) => entry.kind);
const reasons = (log) => log.events.map((entry) => entry.detail?.reason).filter(Boolean);
const summaries = (log) => log.events.map((entry) => entry.detail?.summary).filter(Boolean);

/** A receipt carrying the event addEligibilityRoot emits. */
async function rootAddedReceipt(giveawayId, rootIndex, root) {
  const { encodeEventTopics, encodeAbiParameters } = await import('viem');
  const { GIVEAWAY_MANAGER_V2_ABI } = await import('../../../lib/bridge-v2/abi.ts');
  return {
    status: 'success',
    logs: [
      {
        address: config.GIVEAWAY_MANAGER_V2,
        topics: encodeEventTopics({
          abi: GIVEAWAY_MANAGER_V2_ABI,
          eventName: 'EligibilityRootAdded',
          args: { giveawayId, rootIndex },
        }),
        data: encodeAbiParameters([{ type: 'bytes32' }], [root]),
        blockNumber: 1n,
        blockHash: HASH,
        logIndex: 0,
        transactionHash: HASH,
        transactionIndex: 0,
        removed: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// publishPendingRoots — C8, G4, H5, H6
// ---------------------------------------------------------------------------

function publishReady(entries = [entryRow({ status: 'VERIFIED' })]) {
  db.on('rpc:bridge_v2_campaigns_with_verified', () => ({
    data: [{ giveaway_id: '1' }],
    error: null,
  }));
  db.on('bridge_v2_entries:select', () => ({ data: entries, error: null }));
  db.on('bridge_v2_eligibility_roots:insert', () => ({ data: { id: 'root-1' }, error: null }));
  db.on('bridge_v2_eligibility_leaves:insert', () => ({ data: null, error: null }));
}

await test(['C8'], 'a published root records the index the contract assigned, not a guess', async () => {
  fresh();
  publishReady();
  const tree = buildTree([WALLET]);
  chain.set({ waitForReceipt: await rootAddedReceipt(1n, 42n, tree.root) });

  const log = recordingLogger();
  assert.equal(await publishPendingRoots(log, deadline()), 1);
  const root = db.callsTo('bridge_v2_eligibility_roots:insert')[0];
  // The index used to be read with getEligibilityRootsCount before the
  // transaction was even signed, which answers how many roots have been mined
  // and not which index this one will be given.
  assert.equal(root.payload.root_index, '42');
  assert.equal(root.payload.root, tree.root);
  assert.equal(root.payload.leaf_count, 1);
  assert.deepEqual(transitions(), [['VERIFIED', 'ELIGIBLE']]);
  assert.equal(db.callsTo('bridge_v2_entries:update')[0].payload.root_index, '42');
});

await test(['C8', 'G2'], 'a publication that never confirms writes nothing at all', async () => {
  fresh();
  publishReady();
  // A row saying an address was admitted under an index the chain does not have
  // promotes the entry, moves gas, and buys a certain InvalidRoot revert.
  chain.set({ waitForReceipt: null });
  const log = recordingLogger();
  assert.equal(await publishPendingRoots(log, deadline()), 0);
  assert.equal(db.callsTo('bridge_v2_eligibility_roots:insert').length, 0);
  assert.deepEqual(transitions(), [], 'entries were promoted against nothing');
  assert.equal(log.events.at(-1).detail.recorded, false);
});

await test(['C8'], 'a mined publication with no event invents no index', async () => {
  fresh();
  publishReady();
  chain.set({ waitForReceipt: { status: 'success', logs: [] } });
  const log = recordingLogger();
  assert.equal(await publishPendingRoots(log, deadline()), 0);
  assert.equal(db.callsTo('bridge_v2_eligibility_roots:insert').length, 0);
  assert.equal(log.events.at(-1).detail.reason, 'no_root_index_event');
});

await test(['C8'], 'a reverted publication writes nothing', async () => {
  fresh();
  publishReady();
  chain.set({ waitForReceipt: { status: 'reverted', logs: [] } });
  assert.equal(await publishPendingRoots(recordingLogger(), deadline()), 0);
  assert.equal(db.callsTo('bridge_v2_eligibility_roots:insert').length, 0);
});

await test(['H5', 'H6'], 'a campaign past its entry window fails its batch instead of publishing', async () => {
  fresh();
  publishReady();
  chain.set({ readGiveaway: { ...DEFAULT_CAMPAIGN, isOpen: true, acceptsEntries: false } });
  const log = recordingLogger();
  assert.equal(await publishPendingRoots(log, deadline()), 0);
  assert.deepEqual(transitions(), [['VERIFIED', 'FAILED']]);
  assert.ok(reasons(log).includes('entries_closed'));
  assert.equal(chain.calls.filter((call) => call.name === 'publishEligibilityRoot').length, 0);
});

await test(['B7', 'H6'], 'a campaign with no slots left fails its batch rather than waiting for ever', async () => {
  fresh();
  publishReady();
  chain.set({ slotsRemaining: 0n });
  const log = recordingLogger();
  assert.equal(await publishPendingRoots(log, deadline()), 0);
  // Left VERIFIED, these rows came back on every run for the life of the
  // campaign and had no exit of their own.
  assert.deepEqual(transitions(), [['VERIFIED', 'FAILED']]);
  assert.ok(reasons(log).includes('slots_exhausted'));
});

await test(['H6'], 'only as many entries as there are slots are admitted to the root', async () => {
  fresh();
  publishReady([
    entryRow({ id: 'e1', status: 'VERIFIED', wallet_address: addressOf(1) }),
    entryRow({ id: 'e2', status: 'VERIFIED', wallet_address: addressOf(2) }),
    entryRow({ id: 'e3', status: 'VERIFIED', wallet_address: addressOf(3) }),
  ]);
  const tree = buildTree([addressOf(1), addressOf(2)]);
  chain.set({ slotsRemaining: 2n, waitForReceipt: await rootAddedReceipt(1n, 1n, tree.root) });
  await publishPendingRoots(recordingLogger(), deadline());
  assert.equal(db.callsTo('bridge_v2_eligibility_roots:insert')[0].payload.leaf_count, 2);
  assert.equal(transitions().length, 2, 'more entries were promoted than there were slots');
});

await test(['G4'], 'one campaign that throws does not end the publication stage', async () => {
  fresh();
  db.on('rpc:bridge_v2_campaigns_with_verified', () => ({
    data: [{ giveaway_id: '1' }, { giveaway_id: '2' }],
    error: null,
  }));
  db.on('bridge_v2_entries:select', () => ({
    data: [entryRow({ status: 'VERIFIED' })],
    error: null,
  }));
  db.on('bridge_v2_eligibility_roots:insert', () => ({ data: { id: 'root-1' }, error: null }));
  db.on('bridge_v2_eligibility_leaves:insert', () => ({ data: null, error: null }));
  const tree = buildTree([WALLET]);
  let reads = 0;
  chain.set({
    readGiveaway: () => {
      reads += 1;
      if (reads === 1) throw new Error('rpc timed out');
      return DEFAULT_CAMPAIGN;
    },
    waitForReceipt: await rootAddedReceipt(2n, 1n, tree.root),
  });
  assert.equal(await publishPendingRoots(recordingLogger(), deadline()), 1);
  assert.equal(reads, 2, 'the second campaign was never reached');
});

await test(['G4'], 'the publication stage starts nothing when the budget is gone', async () => {
  fresh();
  publishReady();
  assert.equal(await publishPendingRoots(recordingLogger(), deadline(false)), 0);
  assert.equal(chain.calls.length, 0, 'work was started with no budget left');
});

// ---------------------------------------------------------------------------
// processEligibleEntries — B8, G2, G3, G5, G6, H3, H5, H6, H7, K3
// ---------------------------------------------------------------------------

function eligibleReady(entries = [entryRow()]) {
  db.on('bridge_v2_entries:select', () => ({ data: entries, error: null }));
  const tree = buildTree([WALLET]);
  db.on('bridge_v2_eligibility_roots:select', () => ({
    data: { id: 'root-1', root_index: '0', root: tree.root },
    error: null,
  }));
  db.on('bridge_v2_eligibility_leaves:select', () => ({
    data: [{ address: WALLET, position: 0 }],
    error: null,
  }));
}

await test(['G5'], 'an address the contract already has is confirmed without spending anything', async () => {
  fresh();
  eligibleReady();
  chain.set({ hasEntered: true });
  const log = recordingLogger();
  assert.equal(await processEligibleEntries(log, deadline()), 1);
  assert.deepEqual(transitions(), [['ELIGIBLE', 'CONFIRMED']]);
  assert.equal(db.callsTo('rpc:bridge_v2_acquire_funder').length, 0, 'a funder was taken anyway');
  assert.equal(chain.calls.filter((call) => call.name === 'fundDerivedWallet').length, 0);
});

await test(['H5', 'H6'], 'an entry into a closed campaign is failed before any gas moves', async () => {
  fresh();
  eligibleReady();
  chain.set({ readGiveaway: { ...DEFAULT_CAMPAIGN, isOpen: true, acceptsEntries: false } });
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions(), [['ELIGIBLE', 'FAILED']]);
  assert.equal(chain.calls.filter((call) => call.name === 'fundDerivedWallet').length, 0);
  assert.ok(reasons(log).includes('entries_closed'));
});

await test(['H6'], 'an entry into a full campaign is failed before any gas moves', async () => {
  fresh();
  eligibleReady();
  chain.set({ slotsRemaining: 0n });
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions(), [['ELIGIBLE', 'FAILED']]);
  assert.ok(reasons(log).includes('slots_exhausted'));
});

await test(['C8'], 'an entry whose proof cannot be rebuilt is failed, not retried for ever', async () => {
  fresh();
  eligibleReady();
  db.on('bridge_v2_eligibility_roots:select', () => ({ data: null, error: null }));
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions(), [['ELIGIBLE', 'FAILED']]);
  assert.ok(reasons(log).includes('proof_unavailable'));
});

await test(['C8'], 'a leaf set that does not rebuild the stored root is refused', async () => {
  fresh();
  eligibleReady();
  // Submitting on this would burn gas on a certain revert.
  db.on('bridge_v2_eligibility_roots:select', () => ({
    data: { id: 'root-1', root_index: '0', root: `0x${'b'.repeat(64)}` },
    error: null,
  }));
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions(), [['ELIGIBLE', 'FAILED']]);
  assert.ok(reasons(log).includes('proof_unavailable'));
});

await test(['H7'], 'the funding mark is written in the same statement as the claim', async () => {
  fresh();
  eligibleReady();
  await processEligibleEntries(recordingLogger(), deadline());
  const claim = db.callsTo('bridge_v2_entries:update')[0];
  assert.equal(claim.payload.status, 'FUNDING');
  // There is no moment between the two, so no failure can leave gas in a wallet
  // the sweep queue does not hold.
  assert.equal(typeof claim.payload.funded_at, 'string');
  assert.equal(claim.payload.swept_at, null);
});

await test(['G5'], 'a claim another run already took ends this attempt silently', async () => {
  fresh();
  eligibleReady();
  db.on('bridge_v2_entries:update', () => ({ data: null, error: null }));
  await processEligibleEntries(recordingLogger(), deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_acquire_funder').length, 0, 'the work was done twice');
});

await test(['B8'], 'a refused gas budget returns the entry to the queue rather than holding it', async () => {
  fresh();
  eligibleReady();
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: false, error: null }));
  await processEligibleEntries(recordingLogger(), deadline());
  assert.deepEqual(transitions(), [['ELIGIBLE', 'FUNDING'], ['FUNDING', 'ELIGIBLE']]);
  assert.equal(db.callsTo('rpc:bridge_v2_acquire_funder').length, 0);
});

await test(['H8'], 'an empty funder pool returns the entry and raises an alert', async () => {
  fresh();
  eligibleReady();
  db.on('rpc:bridge_v2_acquire_funder', () => ({ data: [], error: null }));
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions(), [['ELIGIBLE', 'FUNDING'], ['FUNDING', 'ELIGIBLE']]);
  assert.ok(events(log).includes('funder.exhausted'));
  assert.ok(summaries(log).includes('no funder available'));
});

await test(['G3'], 'the lease is renewed between the funding and the entry', async () => {
  fresh();
  eligibleReady();
  const order = [];
  db.on('rpc:bridge_v2_renew_funder_lease', () => {
    order.push('renew');
    return { data: true, error: null };
  });
  chain.set({
    fundDerivedWallet: () => {
      order.push('fund');
      return HASH;
    },
    submitAsDerived: () => {
      order.push('submit');
      return HASH;
    },
  });
  await processEligibleEntries(recordingLogger(), deadline());
  // The V1 took a thirty-second lease and then waited for a receipt with no
  // timeout, so the lease lapsed while the operation was still running.
  assert.deepEqual(order, ['fund', 'renew', 'submit']);
});

await test(['G3'], 'a lease lost mid-operation stops the entry rather than signing on', async () => {
  fresh();
  eligibleReady();
  db.on('rpc:bridge_v2_renew_funder_lease', () => ({ data: false, error: null }));
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.equal(chain.calls.filter((call) => call.name === 'submitAsDerived').length, 0);
  assert.deepEqual(transitions().at(-1), ['FUNDING', 'ELIGIBLE']);
  assert.ok(reasons(log).includes('lease_lost'));
});

await test(['G6'], 'the nonce advances on release even when the entry failed', async () => {
  fresh();
  eligibleReady();
  chain.set({ submitAsDerived: () => new Error('broadcast refused') });
  await processEligibleEntries(recordingLogger(), deadline());
  const release = db.callsTo('rpc:bridge_v2_release_funder')[0];
  // A broadcast transaction consumes its nonce whether or not it succeeded.
  assert.equal(release.args.p_next_nonce, 8, 'the funder was returned with its nonce unspent');
  assert.equal(release.args.p_lease_token, 'lease-1');
});

await test(['G6'], 'a funding that sent nothing does not advance the nonce', async () => {
  fresh();
  eligibleReady();
  // The wallet already holds what the entry needs, which is the ordinary shape
  // of a retry. Nothing is signed, so there is no transaction to consume it.
  chain.set({ fundDerivedWallet: () => null });
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_release_funder')[0].args.p_next_nonce, 7);
  assert.ok(reasons(log).includes('already_funded'));
});

await test(['G6', 'H8'], 'a funder whose lease cannot be released is taken out of rotation', async () => {
  fresh();
  eligibleReady();
  db.on('rpc:bridge_v2_release_funder', () => ({ data: false, error: null }));
  db.on('rpc:bridge_v2_disable_funder', () => ({ data: true, error: null }));
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_disable_funder').length, 1);
  assert.ok(events(log).includes('funder.disabled'));
  assert.ok(summaries(log).includes('funder lease could not be released'));
});

await test(['G6'], 'the stored nonce is corrected against the account before it is used', async () => {
  fresh();
  eligibleReady();
  // A key with prior history: the row is at 7, the account is already at 40.
  chain.set({ transactionCount: { latest: 40, pending: 40 } });
  await processEligibleEntries(recordingLogger(), deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_reconcile_funder_nonce')[0].args.p_next_nonce, 40);
  const funding = chain.calls.find((call) => call.name === 'fundDerivedWallet');
  assert.equal(funding.args[0].nextNonce, 40, 'the funding was signed on the stale nonce');
});

await test(['G6'], 'a dropped transaction lets the nonce come back down', async () => {
  fresh();
  eligibleReady();
  // The row counts transactions that are neither mined nor held anywhere.
  chain.set({ transactionCount: { latest: 3, pending: 3 } });
  await processEligibleEntries(recordingLogger(), deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_reconcile_funder_nonce')[0].args.p_next_nonce, 3);
});

await test(['G6'], 'a stored nonce inside what the account has committed to is left alone', async () => {
  fresh();
  eligibleReady();
  chain.set({ transactionCount: { latest: 5, pending: 9 } });
  await processEligibleEntries(recordingLogger(), deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_reconcile_funder_nonce').length, 0);
  assert.equal(
    chain.calls.find((call) => call.name === 'fundDerivedWallet').args[0].nextNonce,
    7,
    'a concurrent unmined broadcast was overwritten',
  );
});

await test(['G6'], 'a refused nonce correction leaves the stored value alone', async () => {
  fresh();
  eligibleReady();
  chain.set({ transactionCount: { latest: 40, pending: 40 } });
  db.on('rpc:bridge_v2_reconcile_funder_nonce', () => ({ data: false, error: null }));
  await processEligibleEntries(recordingLogger(), deadline());
  // Signing on a nonce corrected under a lease somebody else holds is the
  // collision the lease exists to prevent.
  assert.equal(chain.calls.find((call) => call.name === 'fundDerivedWallet').args[0].nextNonce, 7);
});

await test(['G4', 'G6'], 'an RPC that cannot answer leaves the nonce as it stands', async () => {
  fresh();
  eligibleReady();
  chain.set({ transactionCount: () => new Error('rpc down') });
  await processEligibleEntries(recordingLogger(), deadline());
  assert.equal(db.callsTo('rpc:bridge_v2_reconcile_funder_nonce').length, 0);
});

await test(['K3', 'G2'], 'the transaction hash is written before the wait, and checked', async () => {
  fresh();
  eligibleReady();
  const order = [];
  db.on('bridge_v2_entries:update', (op) => {
    if (op.payload.status !== undefined) order.push(op.payload.status);
    return { data: { id: 'entry-1' }, error: null };
  });
  chain.set({
    submitAsDerived: HASH,
    waitForReceipt: (hash) => {
      order.push(`wait:${hash}`);
      return { status: 'success', logs: [] };
    },
  });
  await processEligibleEntries(recordingLogger(), deadline());
  const submitted = order.indexOf('SUBMITTED');
  assert.ok(submitted !== -1, 'the entry never reached SUBMITTED');
  assert.ok(submitted < order.lastIndexOf(`wait:${HASH}`), 'the hash was written after the wait');
  const write = db
    .callsTo('bridge_v2_entries:update')
    .find((call) => call.payload.status === 'SUBMITTED');
  assert.equal(write.payload.tx_hash, HASH);
});

await test(['G2'], 'a failed write of the hash ends the entry instead of losing the transaction', async () => {
  fresh();
  eligibleReady();
  db.on('bridge_v2_entries:update', (op) =>
    op.payload.status === 'SUBMITTED'
      ? { data: null, error: null }
      : { data: { id: 'entry-1' }, error: null });
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.ok(reasons(log).includes('submitted_not_recorded'));
});

await test(['H3'], 'a gas cost above the ceiling refuses the entry and alerts', async () => {
  fresh();
  eligibleReady();
  chain.set({
    quoteEntryCost: () => {
      throw new chain.ChainError('gas_cost_above_ceiling');
    },
  });
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions().at(-1), ['FUNDING', 'ELIGIBLE']);
  assert.ok(events(log).includes('gas.rejected'));
  assert.ok(summaries(log).includes('gas cost above ceiling'));
});

await test(['G4'], 'a funding that is never mined returns the entry to the queue', async () => {
  fresh();
  eligibleReady();
  chain.set({ waitForReceipt: null });
  const log = recordingLogger();
  await processEligibleEntries(log, deadline());
  assert.deepEqual(transitions().at(-1), ['FUNDING', 'ELIGIBLE']);
  assert.ok(reasons(log).includes('funding_not_mined'));
});

await test(['G4'], 'one entry that throws does not end the funding stage', async () => {
  fresh();
  eligibleReady([entryRow({ id: 'e1' }), entryRow({ id: 'e2' })]);
  let attempts = 0;
  chain.set({
    hasEntered: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('rpc timed out');
      return false;
    },
  });
  assert.equal(await processEligibleEntries(recordingLogger(), deadline()), 2);
  assert.ok(attempts >= 2, 'the second entry was never attempted');
});

await test(['G4'], 'an entry that threw is moved to the back of the queue', async () => {
  fresh();
  eligibleReady();
  chain.set({ hasEntered: () => new Error('rpc timed out') });
  await processEligibleEntries(recordingLogger(), deadline());
  // listEligible orders by updated_at, so a row that is never written is a row
  // that is first for ever.
  const touched = db
    .callsTo('bridge_v2_entries:update')
    .filter((call) => Object.keys(call.payload).length === 1 && 'updated_at' in call.payload);
  assert.equal(touched.length, 1, 'the failed entry keeps the head of the queue');
});

await test(['G4'], 'no entry is started once the budget is gone', async () => {
  fresh();
  eligibleReady();
  assert.equal(await processEligibleEntries(recordingLogger(), deadline(false)), 0);
  assert.equal(chain.calls.length, 0);
});

// ---------------------------------------------------------------------------
// reconcileFunding and reconcileSubmitted — I8, K3
// ---------------------------------------------------------------------------

await test(['I8'], 'an entry abandoned in FUNDING is brought back by the chain answer', async () => {
  for (const [entered, expected] of [[true, 'CONFIRMED'], [false, 'ELIGIBLE']]) {
    fresh();
    db.on('bridge_v2_entries:select', () => ({
      data: [entryRow({ status: 'FUNDING' })],
      error: null,
    }));
    chain.set({ hasEntered: entered });
    assert.equal(await reconcileFunding(recordingLogger(), deadline()), 1);
    assert.deepEqual(transitions(), [['FUNDING', expected]]);
  }
});

await test(['I8'], 'the FUNDING sweep only looks at rows older than a run can live', async () => {
  fresh();
  let cutoff;
  db.on('bridge_v2_entries:select', (op) => {
    cutoff = op.filters.find(([verb]) => verb === 'lt');
    return { data: [], error: null };
  });
  await reconcileFunding(recordingLogger(), deadline());
  assert.equal(cutoff[1], 'updated_at');
  const age = Date.now() - new Date(cutoff[2]).getTime();
  assert.ok(
    Math.abs(age - config.FUNDING_STALE_MS) < 5000,
    `the cutoff is ${age}ms, not ${config.FUNDING_STALE_MS}ms`,
  );
  assert.ok(config.FUNDING_STALE_MS > config.CRON_MAX_DURATION_SECONDS * 1000);
});

await test(['K3'], 'a submitted entry the contract has is confirmed without a second look', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({
    data: [entryRow({ status: 'SUBMITTED', tx_hash: HASH })],
    error: null,
  }));
  chain.set({ hasEntered: true });
  assert.equal(await reconcileSubmitted(recordingLogger(), deadline()), 1);
  assert.deepEqual(transitions(), [['SUBMITTED', 'CONFIRMED']]);
  assert.equal(chain.calls.filter((call) => call.name === 'waitForReceipt').length, 0);
});

await test(['I8'], 'a transaction the node has never heard of is treated as dropped', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({
    data: [entryRow({ status: 'SUBMITTED', tx_hash: HASH })],
    error: null,
  }));
  // Not mined, not pending: it will never be mined and no waiting changes that.
  chain.set({ hasEntered: false, waitForReceipt: null, transactionKnown: false });
  const log = recordingLogger();
  await reconcileSubmitted(log, deadline());
  assert.deepEqual(transitions(), [['SUBMITTED', 'ELIGIBLE']]);
  assert.ok(reasons(log).includes('transaction_dropped'));
});

await test(['I8'], 'a transaction still in the mempool is left alone but moved down the queue', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({
    data: [entryRow({ status: 'SUBMITTED', tx_hash: HASH })],
    error: null,
  }));
  chain.set({ hasEntered: false, waitForReceipt: null, transactionKnown: true });
  await reconcileSubmitted(recordingLogger(), deadline());
  const updates = db.callsTo('bridge_v2_entries:update');
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].payload), ['updated_at'], 'the state was changed');
});

await test(['I8'], 'a mined and reverted entry goes back for a fresh quote', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({
    data: [entryRow({ status: 'SUBMITTED', tx_hash: HASH })],
    error: null,
  }));
  chain.set({ hasEntered: false, waitForReceipt: { status: 'reverted', logs: [] } });
  const log = recordingLogger();
  await reconcileSubmitted(log, deadline());
  assert.deepEqual(transitions(), [['SUBMITTED', 'ELIGIBLE']]);
  assert.ok(reasons(log).includes('reverted'));
});

await test(['I8'], 'a SUBMITTED entry with no hash recorded goes back to the queue', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({
    data: [entryRow({ status: 'SUBMITTED', tx_hash: null })],
    error: null,
  }));
  chain.set({ hasEntered: false });
  const log = recordingLogger();
  await reconcileSubmitted(log, deadline());
  assert.deepEqual(transitions(), [['SUBMITTED', 'ELIGIBLE']]);
  assert.ok(reasons(log).includes('no_transaction_recorded'));
});

// ---------------------------------------------------------------------------
// sweepConfirmed — D6, H7
// ---------------------------------------------------------------------------

await test(['H7'], 'the sweep queue is every funded wallet, whatever its entry ended as', async () => {
  fresh();
  let filters;
  db.on('bridge_v2_entries:select', (op) => {
    filters = op.filters;
    return { data: [], error: null };
  });
  await sweepConfirmed(recordingLogger(), 2, deadline());
  // Reading CONFIRMED rows left the gas of every failed entry where it was.
  assert.deepEqual(filters, [['not', 'funded_at', 'is', null], ['is', 'swept_at', null]]);
});

await test(['H7'], 'a wallet is marked whether or not the sweep was worth making', async () => {
  for (const hash of [HASH, null]) {
    fresh();
    db.on('bridge_v2_entries:select', () => ({
      data: [entryRow({ status: 'FAILED' })],
      error: null,
    }));
    chain.set({ sweepRemainder: hash });
    assert.equal(await sweepConfirmed(recordingLogger(), 2, deadline()), hash === null ? 0 : 1);
    const marks = db.callsTo('bridge_v2_entries:update').filter((c) => 'swept_at' in c.payload);
    assert.equal(marks.length, 1, 'the wallet holds the head of the queue for ever');
  }
});

await test(['H7'], 'a sweep that could not be made is touched, never marked done', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({ data: [entryRow()], error: null }));
  chain.set({ sweepRemainder: () => new Error('rpc having a bad minute') });
  await sweepConfirmed(recordingLogger(), 2, deadline());
  const updates = db.callsTo('bridge_v2_entries:update');
  // Marking it closed the wallet permanently, which for the last funding a
  // wallet ever receives abandoned the remainder of the whole prize path.
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].payload), ['updated_at']);
});

await test(['D6'], 'the sweep destination is drawn from the pool, not fixed on one funder', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({
    data: Array.from({ length: 14 }, (unused, i) => entryRow({ id: `e${i}` })),
    error: null,
  }));
  const destinations = new Set();
  chain.set({
    sweepRemainder: (index, wallet, target) => {
      destinations.add(target);
      return HASH;
    },
  });
  await sweepConfirmed(recordingLogger(), 2, deadline());
  // Sending every participant's remainder to funder 0 drew, in a batch and on a
  // schedule, exactly the edges the random funding refused to draw.
  assert.equal(destinations.size, 2, `the sweep used ${destinations.size} of 2 funders`);
});

await test(['H7'], 'a wallet with no derivation index is marked rather than retried for ever', async () => {
  fresh();
  db.on('bridge_v2_entries:select', () => ({ data: [entryRow()], error: null }));
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  await sweepConfirmed(recordingLogger(), 2, deadline());
  assert.equal(chain.calls.filter((call) => call.name === 'sweepRemainder').length, 0);
  assert.ok('swept_at' in db.callsTo('bridge_v2_entries:update')[0].payload);
});

// ---------------------------------------------------------------------------
// processPrizes — E1, E2, E3, E4, G4, G5, H7, OWNER-D1, OWNER-D2
// ---------------------------------------------------------------------------

function prizeReady(custody = custodyRow()) {
  db.on('bridge_v2_custody:select', () => ({ data: [custody], error: null }));
  chain.set({ readGiveaway: settled() });
}

await test(['E1', 'E2'], 'a prize that needs the winner own wallet is not claimed without one', async () => {
  fresh();
  prizeReady(custodyRow({ requires_own_wallet: true }));
  chain.set({ readGiveaway: settled({ prizeKind: 1 }), claimableFor: 1n });
  assert.equal(await processPrizes(recordingLogger(), deadline()), 0);
  // Claiming early would park the prize in the one place E1 says value may not
  // rest, with a thirty-day clock running on it.
  assert.equal(chain.calls.filter((call) => call.name === 'quoteClaim').length, 0);
  assert.deepEqual(
    Object.keys(db.callsTo('bridge_v2_custody:update').at(-1).payload),
    ['updated_at'],
  );
});

await test(['E2', 'OWNER-D1'], 'the rule is recomputed from claimable before anything moves', async () => {
  fresh();
  // Recorded at entry time as temporary custody; the campaign clamped its
  // winner count, so this winner is actually owed more than the threshold.
  prizeReady(custodyRow({ requires_own_wallet: false }));
  chain.set({
    readGiveaway: settled({ prizeAmount: 1000n * 10n ** 6n, winnersCount: 1 }),
    claimableFor: 1000n * 10n ** 6n,
  });
  await processPrizes(recordingLogger(), deadline());
  const rewrite = db
    .callsTo('bridge_v2_custody:update')
    .find((call) => 'requires_own_wallet' in call.payload);
  assert.ok(rewrite, 'the provisional rule was never rewritten');
  assert.equal(rewrite.payload.requires_own_wallet, true);
  // And nothing was claimed, because there is no destination.
  assert.equal(chain.calls.filter((call) => call.name === 'quoteClaim').length, 0);
});

await test(['E3'], 'temporary custody starts when the claim is mined, not at entry', async () => {
  fresh();
  prizeReady(custodyRow({ requires_own_wallet: false }));
  chain.set({ claimableFor: 50n * 10n ** 6n });
  const before = Date.now();
  await processPrizes(recordingLogger(), deadline());
  const begin = db.callsTo('bridge_v2_custody:update').find((call) => 'claimed_at' in call.payload);
  assert.ok(begin, 'the claim was never recorded');
  const expiry = new Date(begin.payload.custody_expires_at).getTime();
  assert.ok(
    Math.abs(expiry - before - config.CUSTODY_TEMPORARY_DAYS * 86_400_000) < 5000,
    'the clock did not start at the claim',
  );
  assert.deepEqual(begin.filters, [['eq', 'entry_id', 'entry-1'], ['is', 'claimed_at', null]]);
});

await test(['E2'], 'a prize that must go to the winner own wallet gets no custody clock', async () => {
  fresh();
  prizeReady(
    custodyRow({
      requires_own_wallet: true,
      destination_address: addressOf(9),
      destination_confirmed_at: new Date().toISOString(),
    }),
  );
  chain.set({
    readGiveaway: settled({ prizeAmount: 1000n * 10n ** 6n }),
    claimableFor: 1000n * 10n ** 6n,
    prizeDelivery: { to: config.USDC, amount: 1n, data: '0xabc' },
  });
  await processPrizes(recordingLogger(), deadline());
  const begin = db.callsTo('bridge_v2_custody:update').find((call) => 'claimed_at' in call.payload);
  // It holds nothing: the delivery runs in the same pass.
  assert.equal(begin.payload.custody_expires_at, null);
});

await test(['E4', 'H2'], 'delivery goes to the confirmed destination and marks the prize gone', async () => {
  fresh();
  const target = addressOf(9);
  prizeReady(
    custodyRow({
      requires_own_wallet: true,
      destination_address: target,
      destination_confirmed_at: new Date().toISOString(),
    }),
  );
  chain.set({
    claimableFor: 1000n * 10n ** 6n,
    readGiveaway: settled({ prizeAmount: 1000n * 10n ** 6n }),
    prizeDelivery: { to: config.USDC, amount: 100n, data: '0xdeadbeef' },
  });
  const log = recordingLogger();
  assert.equal(await processPrizes(log, deadline()), 1);
  assert.equal(chain.calls.find((call) => call.name === 'prizeDelivery').args[3], target);
  const marked = db.callsTo('bridge_v2_custody:update').find((c) => 'delivered_at' in c.payload);
  assert.ok(marked);
  assert.deepEqual(marked.filters, [['eq', 'entry_id', 'entry-1'], ['is', 'delivered_at', null]]);
  assert.ok(events(log).includes('prize.delivered'));
});

await test(['E4'], 'a destination proposed but not confirmed does not count', async () => {
  fresh();
  prizeReady(
    custodyRow({
      requires_own_wallet: true,
      destination_address: addressOf(9),
      destination_confirmed_at: null,
    }),
  );
  // An NFT, so the own-wallet rule survives the recomputation from claimable.
  chain.set({ readGiveaway: settled({ prizeKind: 1 }), claimableFor: 1n });
  await processPrizes(recordingLogger(), deadline());
  assert.equal(chain.calls.filter((call) => call.name === 'quoteClaim').length, 0);
  assert.equal(chain.calls.filter((call) => call.name === 'prizeDelivery').length, 0);
});

await test(['OWNER-D2'], 'an expired custody with no destination alerts exactly once', async () => {
  fresh();
  prizeReady(
    custodyRow({
      requires_own_wallet: false,
      claimed_at: new Date().toISOString(),
      custody_expires_at: new Date(Date.now() - 1000).toISOString(),
      custody_expired_alert_at: null,
    }),
  );
  chain.set({ claimableFor: 0n });
  const log = recordingLogger();
  await processPrizes(log, deadline());
  const claimAlert = db
    .callsTo('bridge_v2_custody:update')
    .find((call) => 'custody_expired_alert_at' in call.payload);
  assert.ok(claimAlert, 'the alert was not claimed through the database');
  // The database decides which pass wins; reading the column and then writing
  // it would be the read-compare-write G1 forbids.
  assert.deepEqual(claimAlert.filters, [
    ['eq', 'entry_id', 'entry-1'],
    ['is', 'custody_expired_alert_at', null],
  ]);
  assert.ok(events(log).includes('prize.custody_expired'));
  assert.ok(summaries(log).includes('temporary custody expired with no destination'));
});

await test(['OWNER-D2'], 'a custody already alerted on is not alerted again', async () => {
  fresh();
  prizeReady(
    custodyRow({
      claimed_at: new Date().toISOString(),
      custody_expires_at: new Date(Date.now() - 1000).toISOString(),
      custody_expired_alert_at: new Date(Date.now() - 500).toISOString(),
    }),
  );
  chain.set({ claimableFor: 0n });
  const log = recordingLogger();
  await processPrizes(log, deadline());
  // The condition stays true for as long as the value sits there, so alerting
  // on it directly was one message a minute for thirty days.
  assert.ok(!events(log).includes('prize.custody_expired'));
  assert.equal(
    db
      .callsTo('bridge_v2_custody:update')
      .filter((c) => 'custody_expired_alert_at' in c.payload).length,
    0,
  );
});

await test(['OWNER-D2'], 'nothing automatic happens to an expired custody', async () => {
  fresh();
  prizeReady(
    custodyRow({
      claimed_at: new Date().toISOString(),
      custody_expires_at: new Date(Date.now() - 1000).toISOString(),
    }),
  );
  chain.set({ claimableFor: 0n });
  await processPrizes(recordingLogger(), deadline());
  // D2: the value stays where it is and the bridge takes no action on it.
  assert.equal(chain.calls.filter((call) => call.name === 'prizeDelivery').length, 0);
  assert.equal(
    db.callsTo('bridge_v2_custody:update').filter((c) => 'delivered_at' in c.payload).length,
    0,
  );
});

await test(['E3'], 'an entrant who did not win leaves the prize queue for good', async () => {
  fresh();
  prizeReady(custodyRow());
  chain.set({ claimableFor: 0n, prizeAlreadyClaimed: false });
  const log = recordingLogger();
  await processPrizes(log, deadline());
  // A campaign of a thousand entrants and three winners left 997 permanent rows
  // ordered ahead of every real prize behind them.
  const closed = db.callsTo('bridge_v2_custody:update').find((c) => 'no_prize_at' in c.payload);
  assert.ok(closed, 'the row stayed in the queue for ever');
  assert.deepEqual(closed.filters, [
    ['eq', 'entry_id', 'entry-1'],
    ['is', 'no_prize_at', null],
    ['is', 'claimed_at', null],
  ]);
  assert.ok(reasons(log).includes('not_a_winner'));
});

await test(['E3'], 'a claim window that has closed takes the row out of the queue', async () => {
  fresh();
  prizeReady(custodyRow());
  chain.set({
    readGiveaway: settled({ settledAt: BigInt(Math.floor(Date.now() / 1000) - 200 * 86_400) }),
    claimableFor: 5n,
  });
  const log = recordingLogger();
  await processPrizes(log, deadline());
  assert.ok(events(log).includes('prize.expired'));
  assert.ok(db.callsTo('bridge_v2_custody:update').some((c) => 'no_prize_at' in c.payload));
  assert.equal(chain.calls.filter((call) => call.name === 'quoteClaim').length, 0);
});

await test(['G5'], 'a claim the chain already has is recorded rather than made again', async () => {
  fresh();
  prizeReady(custodyRow({ requires_own_wallet: false }));
  // A claim broadcast by a run that died before its receipt arrived is
  // invisible from this side and identical to one that never happened.
  chain.set({ claimableFor: 0n, prizeAlreadyClaimed: true });
  const log = recordingLogger();
  await processPrizes(log, deadline());
  assert.equal(chain.calls.filter((call) => call.name === 'quoteClaim').length, 0);
  const begin = db.callsTo('bridge_v2_custody:update').find((c) => 'claimed_at' in c.payload);
  assert.ok(begin, 'the prize is in the wallet and the row does not say so');
  assert.ok(reasons(log).includes('already_on_chain'));
});

await test(['G5'], 'a delivery with nothing left to send is marked done, not sent twice', async () => {
  fresh();
  prizeReady(
    custodyRow({
      requires_own_wallet: true,
      claimed_at: new Date().toISOString(),
      destination_address: addressOf(9),
      destination_confirmed_at: new Date().toISOString(),
    }),
  );
  chain.set({ claimableFor: 0n, prizeDelivery: null });
  await processPrizes(recordingLogger(), deadline());
  assert.ok(db.callsTo('bridge_v2_custody:update').some((c) => 'delivered_at' in c.payload));
});

await test(['G4'], 'a delivery that is never mined is not marked delivered', async () => {
  fresh();
  prizeReady(
    custodyRow({
      requires_own_wallet: true,
      claimed_at: new Date().toISOString(),
      destination_address: addressOf(9),
      destination_confirmed_at: new Date().toISOString(),
    }),
  );
  chain.set({
    claimableFor: 0n,
    prizeDelivery: { to: config.USDC, amount: 1n, data: '0xabc' },
    // The wallet already holds the gas, so the only wait left is the delivery's.
    fundDerivedWallet: null,
    waitForReceipt: null,
  });
  const log = recordingLogger();
  assert.equal(await processPrizes(log, deadline()), 0);
  assert.equal(
    db.callsTo('bridge_v2_custody:update').filter((c) => 'delivered_at' in c.payload).length,
    0,
  );
  assert.ok(reasons(log).includes('delivery_not_mined'));
});

await test(['H7'], 'a prize funding puts the wallet back in the sweep queue', async () => {
  fresh();
  prizeReady(custodyRow({ requires_own_wallet: false }));
  chain.set({ claimableFor: 50n * 10n ** 6n });
  await processPrizes(recordingLogger(), deadline());
  // The claim and the delivery pay the same wallet months after the entry was
  // swept, and clearing swept_at is the only thing that brings it back.
  const mark = db.callsTo('bridge_v2_entries:update').find((c) => 'funded_at' in c.payload);
  assert.ok(mark, 'the prize funding left gas in a wallet nothing lists');
  assert.equal(mark.payload.swept_at, null);
});

await test(['G4'], 'a campaign that has not settled is left where it is', async () => {
  fresh();
  prizeReady();
  chain.set({ readGiveaway: DEFAULT_CAMPAIGN });
  assert.equal(await processPrizes(recordingLogger(), deadline()), 0);
  assert.equal(chain.calls.filter((call) => call.name === 'claimableFor').length, 0);
  assert.deepEqual(
    Object.keys(db.callsTo('bridge_v2_custody:update').at(-1).payload),
    ['updated_at'],
  );
});

await test(['G4'], 'one prize that throws does not end the prize stage', async () => {
  fresh();
  db.on('bridge_v2_custody:select', () => ({
    data: [custodyRow({ entry_id: 'a' }), custodyRow({ entry_id: 'b' })],
    error: null,
  }));
  let reads = 0;
  chain.set({
    readGiveaway: () => {
      reads += 1;
      if (reads === 1) throw new Error('rpc timed out');
      return settled();
    },
    claimableFor: 0n,
  });
  const log = recordingLogger();
  await processPrizes(log, deadline());
  assert.equal(reads, 2, 'the second prize was never reached');
  assert.ok(events(log).includes('prize.failed'));
});

await test(['G4'], 'no prize is started once the budget is gone', async () => {
  fresh();
  prizeReady();
  assert.equal(await processPrizes(recordingLogger(), deadline(false)), 0);
  // The reservation used to be 300_000 ms against a 280_000 ms budget, so this
  // guard was false on the first millisecond of every run and no prize was ever
  // claimed or delivered.
  assert.equal(chain.calls.filter((call) => call.name === 'readGiveaway').length, 0);
});

// ---------------------------------------------------------------------------
// the dependencies being down
// ---------------------------------------------------------------------------

await test(['G2', 'G4'], 'a database outage ends each stage without signing anything', async () => {
  for (const [name, stage] of [
    ['publishPendingRoots', publishPendingRoots],
    ['processEligibleEntries', processEligibleEntries],
    ['reconcileFunding', reconcileFunding],
    ['reconcileSubmitted', reconcileSubmitted],
    ['processPrizes', processPrizes],
  ]) {
    fresh();
    db.setFallback({ data: null, error: { message: 'connection refused' } });
    let threw = null;
    try {
      await stage(recordingLogger(), deadline());
    } catch (error) {
      threw = error;
    }
    // The stage may throw — the cron envelope turns that into a logged 500 — but
    // it must never have signed anything on the way.
    assert.equal(
      chain.calls.filter((call) => call.name === 'submitAsDerived').length,
      0,
      `${name} signed with the database down`,
    );
    assert.equal(
      chain.calls.filter((call) => call.name === 'fundDerivedWallet').length,
      0,
      `${name} moved gas with the database down`,
    );
    if (threw !== null) assert.match(String(threw.message), /bridge-v2/);
  }
});

await test(['G4'], 'an RPC outage ends each stage without a state change', async () => {
  const down = () => new Error('rpc unreachable');
  for (const [name, stage, status] of [
    ['processEligibleEntries', processEligibleEntries, 'ELIGIBLE'],
    ['reconcileFunding', reconcileFunding, 'FUNDING'],
    ['reconcileSubmitted', reconcileSubmitted, 'SUBMITTED'],
  ]) {
    fresh();
    eligibleReady([entryRow({ status })]);
    chain.set({ hasEntered: down, readGiveaway: down, waitForReceipt: down });
    await stage(recordingLogger(), deadline());
    assert.deepEqual(transitions(), [], `${name} changed a state on a dead RPC`);
  }
});
