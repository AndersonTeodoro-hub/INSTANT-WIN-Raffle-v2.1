/**
 * The campaign lifecycle — SPEC-BRIDGE-V2 §18 — with the chain doubled.
 *
 * lifecycle.ts is the real module under test. What stands in is chain.ts, so a
 * run can be handed any state a campaign can be in, and a transaction can be made
 * to go unseen, revert, or cost more than the ceiling, without anything signed.
 */

import { encodeErrorResult } from 'viem';
import { assert, deadline, recordingLogger, suite, test } from '../harness.mjs';
import * as chain from '../doubles/chain.mjs';
import { ChainError } from '../doubles/chain.mjs';
import { advanceLifecycle, nextTransition } from '../../../lib/bridge-v2/lifecycle.ts';
import {
  GIVEAWAY_LIFECYCLE_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  GiveawayStatus,
} from '../../../lib/bridge-v2/abi.ts';
import * as config from '../../../lib/bridge-v2/config.ts';

suite('lifecycle');

const NOW = 1_800_000_000n;
const RESCUE_ENDS = BigInt(config.CONTRACT_DRAW_TIMEOUT_SECONDS + config.CONTRACT_RESCUE_WINDOW_SECONDS);
const { NONE, OPEN, CLOSED, DRAW_REQUESTED, SEED_RECEIVED, SETTLED, CANCELLED } = GiveawayStatus;

/** A campaign as readLifecyclePage returns it; due to close unless told otherwise. */
function campaign(id, status, overrides = {}) {
  return {
    giveawayId: BigInt(id),
    status,
    effectiveEndTime: NOW - 60n,
    closedAt: 0n,
    drawRequestedAt: 0n,
    ...overrides,
  };
}

/** A contract holding exactly these campaigns, read the way chain.ts reads it. */
function contractWith(campaigns, head = {}) {
  chain.reset();
  const last = campaigns.reduce((max, c) => (c.giveawayId > max ? c.giveawayId : max), 0n);
  chain.set({
    lifecycleHead: { lastGiveawayId: last, now: NOW, paused: false, ...head },
    readLifecyclePage: (from, to) => campaigns.filter((c) => c.giveawayId >= from && c.giveawayId <= to),
  });
}

const callsTo = (name) => chain.calls.filter((call) => call.name === name);
const sent = () => callsTo('sendLifecycleCall').map((call) => `${call.args[0]}(${call.args[1]})`);
const kinds = (log) => log.events.filter((event) => event.kind !== 'alert').map((event) => event.kind);
const alerts = (log) =>
  log.events.filter((event) => event.kind === 'alert').map((event) => event.detail.summary);

/** A revert as viem hands it over: the four bytes somewhere down the cause chain. */
const revert = (abi, errorName) =>
  Object.assign(new Error('execution reverted'), {
    cause: { data: encodeErrorResult({ abi, errorName }) },
  });

// ---------------------------------------------------------------------------
// M1 — every state, every transition
// ---------------------------------------------------------------------------

await test(['M1'], 'each state a campaign can be in maps to the transition §18 fixes', () => {
  const at = (c) => nextTransition(c, NOW, false);
  assert.equal(at(campaign(1, OPEN, { effectiveEndTime: NOW + 1n })), null, 'closed before its end');
  // closeGiveaway reverts only while block.timestamp < effectiveEndTime.
  assert.equal(at(campaign(1, OPEN, { effectiveEndTime: NOW })), 'closeGiveaway');
  assert.equal(at(campaign(1, CLOSED)), 'requestDraw');
  // expireDrawRequest reverts while block.timestamp <= drawRequestedAt + 48 h.
  assert.equal(at(campaign(1, DRAW_REQUESTED, { drawRequestedAt: NOW - RESCUE_ENDS })), null);
  assert.equal(
    at(campaign(1, DRAW_REQUESTED, { drawRequestedAt: NOW - RESCUE_ENDS - 1n })),
    'expireDrawRequest',
  );
  assert.equal(at(campaign(1, SEED_RECEIVED)), 'finalizeWinners');
  for (const status of [NONE, SETTLED, CANCELLED]) {
    assert.equal(at(campaign(1, status)), null, `status ${status} was given a transition`);
  }
});

await test(['M1'], 'a paused contract closes nothing but is still drawn and finalized', () => {
  assert.equal(nextTransition(campaign(1, OPEN), NOW, true), null);
  assert.equal(nextTransition(campaign(1, CLOSED), NOW, true), 'requestDraw');
  assert.equal(nextTransition(campaign(1, SEED_RECEIVED), NOW, true), 'finalizeWinners');
});

await test(['M1', 'M3'], 'a campaign past its end is closed with one transaction, done only on its receipt', async () => {
  contractWith([campaign(1, OPEN)]);
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 1);
  assert.deepEqual(sent(), ['closeGiveaway(1)']);

  const order = chain.calls.map((call) => call.name);
  assert.ok(
    order.indexOf('sendLifecycleCall') < order.indexOf('waitForReceipt'),
    'the receipt was waited on before anything was sent',
  );
  assert.equal(callsTo('waitForReceipt')[0].args[0], chain.behaviour.sendLifecycleCall);
  assert.deepEqual(kinds(log), ['lifecycle.sent', 'lifecycle.confirmed']);
  assert.deepEqual(alerts(log), []);
});

await test(['M1'], 'a closed campaign has its draw requested', async () => {
  contractWith([campaign(2, CLOSED)]);
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 1);
  assert.deepEqual(sent(), ['requestDraw(2)']);
  assert.deepEqual(kinds(log), ['lifecycle.sent', 'lifecycle.confirmed']);
});

await test(['M1'], 'a campaign holding its seed has one batch of winners finalized per run', async () => {
  contractWith([campaign(3, SEED_RECEIVED)]);
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 1);
  assert.deepEqual(sent(), ['finalizeWinners(3)']);
  assert.deepEqual(kinds(log), ['lifecycle.sent', 'lifecycle.confirmed']);
});

await test(['M1'], 'a draw request past its rescue window is expired, and the next run requests the draw again', async () => {
  contractWith([campaign(4, DRAW_REQUESTED, { drawRequestedAt: NOW - RESCUE_ENDS - 1n })]);
  assert.equal(await advanceLifecycle(recordingLogger(), deadline()), 1);
  assert.deepEqual(sent(), ['expireDrawRequest(4)']);

  // What the contract holds after the expiry mined: CLOSED again (GiveawayManagerV2.sol:835).
  contractWith([campaign(4, CLOSED, { closedAt: NOW })]);
  assert.equal(await advanceLifecycle(recordingLogger(), deadline()), 1);
  assert.deepEqual(sent(), ['requestDraw(4)']);
});

await test(['M1'], 'a campaign with nothing due costs neither a keeper read nor a transaction', async () => {
  contractWith([
    campaign(1, OPEN, { effectiveEndTime: NOW + 3600n }),
    campaign(2, DRAW_REQUESTED, { drawRequestedAt: NOW - 60n }),
    campaign(3, SETTLED),
    campaign(4, CANCELLED),
  ]);
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 0);
  assert.equal(callsTo('keeperAccount').length, 0);
  assert.deepEqual(sent(), []);
  assert.deepEqual(log.events, []);
});

await test(['M1'], 'every campaign the contract has is read, one page at a time', async () => {
  const many = Array.from({ length: 250 }, (_, index) => campaign(index + 1, SETTLED));
  contractWith(many);
  await advanceLifecycle(recordingLogger(), deadline());
  assert.deepEqual(
    callsTo('readLifecyclePage').map((call) => call.args),
    [[1n, 100n], [101n, 200n], [201n, 250n]],
  );
});

// ---------------------------------------------------------------------------
// M3, M4 — one at a time, confirmed, and never twice
// ---------------------------------------------------------------------------

await test(['M3'], 'a transaction whose receipt is not seen stops the run from sending another', async () => {
  contractWith([campaign(1, CLOSED), campaign(2, CLOSED)]);
  chain.set({ waitForReceipt: null });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 0);
  assert.deepEqual(sent(), ['requestDraw(1)']);
  assert.deepEqual(kinds(log), ['lifecycle.sent', 'lifecycle.unconfirmed']);
});

await test(['M4', 'M6'], 'nothing is sent while the keeper has a transaction in flight, and that is alerted', async () => {
  contractWith([campaign(1, CLOSED)]);
  chain.set({
    keeperAccount: { balance: 10n ** 18n, latestNonce: 4, pendingNonce: 5, maxFeePerGas: 100_000_000n },
  });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 0);
  assert.deepEqual(sent(), []);
  assert.deepEqual(kinds(log), ['lifecycle.deferred']);
  assert.equal(log.events[0].detail.reason, 'keeper_transaction_pending');
  assert.deepEqual(alerts(log), ['keeper transaction not mined yet']);
});

await test(['M4'], 'a transition somebody else already made is skipped, without gas and without an alert', async () => {
  contractWith([campaign(1, OPEN), campaign(2, CLOSED)]);
  chain.set({
    sendLifecycleCall: (action) =>
      action === 'closeGiveaway' ? revert(GIVEAWAY_MANAGER_V2_ABI, 'GiveawayNotOpen') : '0x'.padEnd(66, '5'),
  });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 1);
  const skipped = log.events.find((event) => event.kind === 'lifecycle.skipped');
  assert.equal(skipped.detail.reason, 'GiveawayNotOpen');
  assert.equal(skipped.detail.giveaway_id, '1');
  assert.equal(callsTo('waitForReceipt').length, 1, 'a skipped transition was waited on');
  assert.deepEqual(alerts(log), []);
});

await test(['M4'], 'a refusal from the lifecycle ABI is read by name as well', async () => {
  contractWith([campaign(2, CLOSED)]);
  chain.set({ sendLifecycleCall: revert(GIVEAWAY_LIFECYCLE_ABI, 'NotClosed') });
  const log = recordingLogger();
  await advanceLifecycle(log, deadline());
  assert.deepEqual(kinds(log), ['lifecycle.skipped']);
  assert.equal(log.events[0].detail.reason, 'NotClosed');
});

await test(['M4'], 'a run over a state already advanced sends nothing a second time', async () => {
  contractWith([campaign(1, CLOSED)]);
  await advanceLifecycle(recordingLogger(), deadline());
  assert.deepEqual(sent(), ['requestDraw(1)']);

  // The same campaign, as the contract holds it once the request mined.
  contractWith([campaign(1, DRAW_REQUESTED, { drawRequestedAt: NOW })]);
  assert.equal(await advanceLifecycle(recordingLogger(), deadline()), 0);
  assert.deepEqual(sent(), []);
});

// ---------------------------------------------------------------------------
// M5 — a failure ends itself
// ---------------------------------------------------------------------------

await test(['M5', 'M6'], 'one campaign that throws does not stop the others, and is recorded and alerted', async () => {
  contractWith([campaign(1, CLOSED), campaign(2, CLOSED)]);
  chain.set({
    sendLifecycleCall: (_action, giveawayId) =>
      giveawayId === 1n ? new Error('nonce too low') : '0x'.padEnd(66, '5'),
  });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 1);
  assert.deepEqual(sent(), ['requestDraw(1)', 'requestDraw(2)']);
  const failure = log.events.find((event) => event.kind === 'lifecycle.failed');
  assert.equal(failure.detail.giveaway_id, '1');
  assert.ok(failure.error instanceof Error);
  assert.deepEqual(alerts(log), ['lifecycle transition failed']);
});

await test(['M5', 'M6'], 'a transition that reverts on chain is alerted and the next one still goes', async () => {
  contractWith([campaign(1, SEED_RECEIVED), campaign(2, SEED_RECEIVED)]);
  let receipts = 0;
  chain.set({
    waitForReceipt: () => {
      receipts += 1;
      return { status: receipts === 1 ? 'reverted' : 'success', logs: [] };
    },
  });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 1);
  assert.deepEqual(sent(), ['finalizeWinners(1)', 'finalizeWinners(2)']);
  assert.deepEqual(kinds(log), [
    'lifecycle.sent', 'lifecycle.failed', 'lifecycle.sent', 'lifecycle.confirmed',
  ]);
  assert.deepEqual(alerts(log), ['lifecycle transition reverted']);
});

await test(['M5', 'M6'], 'a scan that fails ends the phase without a throw, and says so', async () => {
  contractWith([]);
  chain.set({ lifecycleHead: new Error('rpc down') });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 0);
  assert.deepEqual(kinds(log), ['lifecycle.failed']);
  assert.deepEqual(alerts(log), ['lifecycle scan failed']);
});

await test(['M5'], 'a page that fails ends the phase the same way', async () => {
  contractWith([campaign(1, CLOSED)]);
  chain.set({ readLifecyclePage: new Error('rpc down') });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 0);
  assert.deepEqual(sent(), []);
  assert.deepEqual(alerts(log), ['lifecycle scan failed']);
});

// ---------------------------------------------------------------------------
// M6 — the record and the balance
// ---------------------------------------------------------------------------

await test(['M6'], 'a keeper balance below what is pending is alerted with the numbers, and the calls still go', async () => {
  contractWith([campaign(1, OPEN), campaign(2, SEED_RECEIVED)]);
  const fee = 100_000_000n;
  chain.set({ keeperAccount: { balance: 1n, latestNonce: 0, pendingNonce: 0, maxFeePerGas: fee } });
  const log = recordingLogger();
  await advanceLifecycle(log, deadline());
  const low = log.events.find((event) => event.kind === 'alert');
  assert.equal(low.detail.summary, 'keeper balance does not cover pending lifecycle calls');
  assert.equal(
    low.detail.required_wei,
    ((config.LIFECYCLE_GAS_RESERVE.closeGiveaway + config.LIFECYCLE_GAS_RESERVE.finalizeWinners) * fee).toString(),
  );
  assert.equal(low.detail.balance_wei, '1');
  assert.equal(low.detail.pending, 2);
  assert.equal(sent().length, 2, 'a low balance stopped calls that may still fit');
});

await test(['M6', 'K4'], 'the record carries the campaign, the action and the hash, and nothing about a person', async () => {
  contractWith([campaign(7, CLOSED)]);
  const log = recordingLogger();
  await advanceLifecycle(log, deadline());
  for (const event of log.events) {
    for (const key of Object.keys(event.detail)) {
      assert.ok(['giveaway_id', 'action', 'tx_hash'].includes(key), `the record carries ${key}`);
    }
  }
  assert.equal(log.events.at(-1).detail.tx_hash, chain.behaviour.sendLifecycleCall);
});

// ---------------------------------------------------------------------------
// M7 — the ceiling defers, alerts every run, and never holds the rest up
// ---------------------------------------------------------------------------

await test(['M7'], 'a batch above the cost ceiling is deferred and alerted on every run, never in silence', async () => {
  const campaigns = [campaign(1, SEED_RECEIVED), campaign(2, OPEN)];
  const ceiling = (action) =>
    action === 'finalizeWinners' ? new ChainError('gas_cost_above_ceiling') : '0x'.padEnd(66, '5');

  for (let run = 1; run <= 2; run += 1) {
    contractWith(campaigns);
    chain.set({ sendLifecycleCall: ceiling });
    const log = recordingLogger();
    assert.equal(await advanceLifecycle(log, deadline()), 1, `run ${run}: the close behind it did not go`);
    const deferred = log.events.find((event) => event.kind === 'lifecycle.deferred');
    assert.equal(deferred.detail.giveaway_id, '1');
    assert.equal(deferred.detail.reason, 'gas_cost_above_ceiling');
    assert.ok(
      alerts(log).includes('lifecycle transition deferred'),
      `run ${run} deferred without an alert`,
    );
    assert.ok(
      !log.events.some((event) => event.kind === 'lifecycle.sent' && event.detail.giveaway_id === '1'),
      `run ${run} recorded a deferred batch as sent`,
    );
  }
});

await test(['M7', 'H4'], 'an estimate outside the lifecycle band is deferred the same way', async () => {
  contractWith([campaign(1, SEED_RECEIVED)]);
  chain.set({ sendLifecycleCall: new ChainError('gas_estimate_out_of_band') });
  const log = recordingLogger();
  assert.equal(await advanceLifecycle(log, deadline()), 0);
  assert.deepEqual(kinds(log), ['lifecycle.deferred']);
  assert.equal(log.events[0].detail.reason, 'gas_estimate_out_of_band');
  assert.deepEqual(alerts(log), ['lifecycle transition deferred']);
});

// ---------------------------------------------------------------------------
// M8, G4 — order and budget
// ---------------------------------------------------------------------------

await test(['M8'], 'the transitions with a deadline go first and the heaviest goes last', async () => {
  contractWith([
    campaign(1, SEED_RECEIVED),
    campaign(2, OPEN),
    campaign(3, CLOSED),
    campaign(4, DRAW_REQUESTED, { drawRequestedAt: NOW - RESCUE_ENDS - 1n }),
    campaign(5, CLOSED),
  ]);
  await advanceLifecycle(recordingLogger(), deadline());
  assert.deepEqual(sent(), [
    'requestDraw(3)', 'requestDraw(5)', 'expireDrawRequest(4)', 'closeGiveaway(2)', 'finalizeWinners(1)',
  ]);
});

await test(['G4'], 'no campaign is read when the run has no time left for one transition', async () => {
  contractWith([campaign(1, CLOSED)]);
  assert.equal(await advanceLifecycle(recordingLogger(), deadline(false)), 0);
  assert.deepEqual(chain.calls, []);
});
