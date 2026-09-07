/**
 * The interface with the deployed contracts.
 *
 * Three kinds of check, and only the third leaves this machine.
 *
 * 1. The ABI against the artifact that produced the deployed bytecode. abi.ts
 *    says it was extracted rather than written by hand; this is what makes that
 *    claim checkable.
 *
 * 2. The encoding of the six transactions the bridge may sign, and the Merkle
 *    construction, against the contract's own source.
 *
 * 3. Read-only calls to Arbitrum One. Permitted by this session's rules, and the
 *    only thing that proves the ABI decodes against the bytecode really there
 *    rather than against a JSON file. Nothing is signed and nothing broadcast;
 *    every call is an eth_call.
 */

import { readFileSync } from 'node:fs';
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  http as viemHttp,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toFunctionSelector,
} from 'viem';
import { arbitrum } from 'viem/chains';

import { assert, http, realFetch, suite, test } from '../harness.mjs';
import {
  ERC1155_ABI,
  ERC1155_PRIZE_MODULE_ABI,
  ERC1155_RECEIVER_INTERFACE_ID,
  ERC20_ABI,
  ERC721_ABI,
  ERC721_PRIZE_MODULE_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  VRF_COORDINATOR_V2_PLUS_ABI,
} from '../../../lib/bridge-v2/abi.ts';
import * as config from '../../../lib/bridge-v2/config.ts';
import { addressOf, signAsDerived } from '../../../lib/bridge-v2/wallet.ts';
import { buildTree, leafOf, proofFor } from '../../../lib/bridge-v2/merkle.ts';
import { planGas } from '../doubles/chain.mjs';

suite('contracts');

const AUDIT = 'C:/Users/User/Documents/instant-win-audit/v2';
const MANAGER = config.GIVEAWAY_MANAGER_V2;

/** The three prize modules deployed on Arbitrum One, from the session brief. */
const PRIZE_MODULES = [
  '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b',
  '0xafe9E198816DEa24e7f74e9D666c0F250aD688BC',
  '0xeb54e328F9F38222FA91e29D6c0367342B8EFD50',
];

const WALLET = addressOf(0);
const DESTINATION = addressOf(9);

// ---------------------------------------------------------------------------
// the ABI against the artifact that produced the bytecode
// ---------------------------------------------------------------------------

const artifactAbi = (name) =>
  JSON.parse(readFileSync(`${AUDIT}/out/${name}.sol/${name}.json`, 'utf8')).abi;

/** A canonical signature, so two spellings of one entry compare equal. */
function signatureOf(entry) {
  const types = (inputs = []) =>
    inputs
      .map((input) =>
        input.type.startsWith('tuple')
          ? `(${types(input.components)})${input.type.slice('tuple'.length)}`
          : input.type)
      .join(',');
  return `${entry.type} ${entry.name ?? ''}(${types(entry.inputs)})`;
}

await test(['H1'], 'every manager entry the bridge carries exists in the compiled artifact', () => {
  const deployed = new Map(artifactAbi('GiveawayManagerV2').map((e) => [signatureOf(e), e]));
  for (const entry of GIVEAWAY_MANAGER_V2_ABI) {
    const found = deployed.get(signatureOf(entry));
    assert.ok(found, `${signatureOf(entry)} is not in the deployed artifact`);
    if (entry.type !== 'function') continue;
    assert.equal(
      found.stateMutability,
      entry.stateMutability,
      `${entry.name} disagrees about mutability`,
    );
    assert.deepEqual(
      (found.outputs ?? []).map((output) => output.type),
      (entry.outputs ?? []).map((output) => output.type),
      `${entry.name} disagrees about its outputs`,
    );
  }
});

await test(['H1'], 'the campaign tuple matches the deployed struct field for field', () => {
  const deployed = artifactAbi('GiveawayManagerV2').find(
    (entry) => entry.type === 'function' && entry.name === 'getGiveaway',
  );
  const ours = GIVEAWAY_MANAGER_V2_ABI.find(
    (entry) => entry.type === 'function' && entry.name === 'getGiveaway',
  );
  // A field inserted or reordered here silently shifts every read after it.
  assert.deepEqual(
    ours.outputs[0].components.map((component) => [component.name, component.type]),
    deployed.outputs[0].components.map((component) => [component.name, component.type]),
  );
});

await test(['H1'], 'every prize module entry the bridge carries exists in its artifact', () => {
  for (const [name, ours] of [
    ['ERC721PrizeModule', ERC721_PRIZE_MODULE_ABI],
    ['ERC1155PrizeModule', ERC1155_PRIZE_MODULE_ABI],
  ]) {
    const deployed = new Map(artifactAbi(name).map((entry) => [signatureOf(entry), entry]));
    for (const entry of ours) {
      assert.ok(deployed.get(signatureOf(entry)), `${name}: ${signatureOf(entry)} is not deployed`);
    }
  }
});

await test(['K5'], 'every error the bridge decodes is an error the manager can raise', () => {
  const deployed = new Set(
    artifactAbi('GiveawayManagerV2')
      .filter((entry) => entry.type === 'error')
      .map(signatureOf),
  );
  for (const entry of GIVEAWAY_MANAGER_V2_ABI.filter((item) => item.type === 'error')) {
    assert.ok(deployed.has(signatureOf(entry)), `${entry.name} is not an error of this contract`);
  }
});

await test(['C8'], 'the leaf the bridge builds is the leaf the contract computes', () => {
  const source = readFileSync(`${AUDIT}/src/GiveawayManagerV2.sol`, 'utf8');
  assert.match(source, /bytes32 leaf = keccak256\(abi\.encodePacked\(msg\.sender\)\);/);
  // Hashed once, not twice: the contract notes that an address leaf is 20 bytes
  // and an internal node is 64, so the two can never be confused.
  assert.equal(leafOf(WALLET), keccak256(encodePacked(['address'], [WALLET])));
  assert.match(source, /MerkleProof\.verify\(merkleProof, roots\[rootIndex\], leaf\)/);
});

await test(['C8'], 'the contract verifies against a root it holds by index, append only', () => {
  const source = readFileSync(`${AUDIT}/src/GiveawayManagerV2.sol`, 'utf8');
  assert.match(source, /emit EligibilityRootAdded\(giveawayId, roots\.length - 1, root\)/);
  // Nothing removes or replaces an entry, which is what makes "eligible once,
  // eligible for ever" structural rather than a promise.
  assert.ok(!/_eligibilityRoots\[\w+\]\[\w+\]\s*=/.test(source), 'a root can be replaced');
  assert.ok(!/delete _eligibilityRoots/.test(source), 'a root list can be deleted');
});

// ---------------------------------------------------------------------------
// H1 — the six transactions, and nothing else
// ---------------------------------------------------------------------------

const ROOT = keccak256(encodePacked(['string'], ['a root']));
const PROOF = [keccak256(encodePacked(['string'], ['sibling']))];

const SIGNED_SHAPES = {
  'fund the derived wallet': { to: WALLET, value: 1_000_000n, data: undefined },
  enter: {
    to: MANAGER,
    data: encodeFunctionData({
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'enter',
      args: [1n, 0n, PROOF],
    }),
  },
  addEligibilityRoot: {
    to: MANAGER,
    data: encodeFunctionData({
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'addEligibilityRoot',
      args: [1n, ROOT],
    }),
  },
  'sweep the remainder': { to: DESTINATION, value: 500n, data: undefined },
  claimPrize: {
    to: MANAGER,
    data: encodeFunctionData({
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'claimPrize',
      args: [1n],
    }),
  },
  'deliver the prize': {
    to: config.USDC,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [DESTINATION, 100n],
    }),
  },
};

await test(['H1'], 'the bridge signs six shapes and each carries the selector it claims', () => {
  assert.equal(Object.keys(SIGNED_SHAPES).length, 6);
  for (const name of ['enter', 'addEligibilityRoot', 'claimPrize']) {
    const decoded = decodeFunctionData({
      abi: GIVEAWAY_MANAGER_V2_ABI,
      data: SIGNED_SHAPES[name].data,
    });
    assert.equal(decoded.functionName, name);
  }
  // The two value transfers carry no calldata at all, which is what makes them
  // transfers rather than calls.
  assert.equal(SIGNED_SHAPES['fund the derived wallet'].data, undefined);
  assert.equal(SIGNED_SHAPES['sweep the remainder'].data, undefined);
});

await test(['H1'], 'every selector matches the one the deployed artifact defines', () => {
  const artifact = artifactAbi('GiveawayManagerV2');
  for (const name of ['enter', 'addEligibilityRoot', 'claimPrize']) {
    const entry = artifact.find((item) => item.type === 'function' && item.name === name);
    const expected = toFunctionSelector(
      `${name}(${entry.inputs.map((input) => input.type).join(',')})`,
    );
    assert.equal(SIGNED_SHAPES[name].data.slice(0, 10), expected, `${name} has the wrong selector`);
  }
});

await test(['H1'], 'the three delivery encodings are the three the standards define', () => {
  const erc20 = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [DESTINATION, 100n],
  });
  const erc721 = encodeFunctionData({
    abi: ERC721_ABI,
    functionName: 'safeTransferFrom',
    args: [WALLET, DESTINATION, 7n],
  });
  const erc1155 = encodeFunctionData({
    abi: ERC1155_ABI,
    functionName: 'safeTransferFrom',
    args: [WALLET, DESTINATION, 7n, 1n, '0x'],
  });
  assert.equal(erc20.slice(0, 10), toFunctionSelector('transfer(address,uint256)'));
  assert.equal(erc721.slice(0, 10), toFunctionSelector('safeTransferFrom(address,address,uint256)'));
  assert.equal(
    erc1155.slice(0, 10),
    toFunctionSelector('safeTransferFrom(address,address,uint256,uint256,bytes)'),
  );
  // The ERC-721 encoding is not a near miss on an ERC-1155 collection; it is a
  // selector that contract does not implement.
  assert.notEqual(erc721.slice(0, 10), erc1155.slice(0, 10));
});

await test(['H1', 'F6'], 'a signed transaction is on Arbitrum One and recovers to the wallet', async () => {
  for (const [name, shape] of Object.entries(SIGNED_SHAPES)) {
    const signed = await signAsDerived(0, {
      chainId: config.CHAIN_ID,
      type: 'eip1559',
      to: shape.to,
      data: shape.data,
      value: shape.value,
      nonce: 3,
      gas: 100_000n,
      maxFeePerGas: 100_000_000n,
      maxPriorityFeePerGas: 0n,
    });
    const parsed = parseTransaction(signed);
    assert.equal(parsed.chainId, 42161, `${name} was signed for another chain`);
    assert.equal(parsed.type, 'eip1559');
    assert.equal(parsed.to.toLowerCase(), shape.to.toLowerCase(), `${name} goes elsewhere`);
    assert.equal(parsed.nonce, 3);
    const signer = await recoverTransactionAddress({ serializedTransaction: signed });
    assert.equal(signer.toLowerCase(), WALLET.toLowerCase(), `${name} was signed by another key`);
  }
});

await test(['H2'], 'the funding and the sweep carry a value and no calldata', async () => {
  for (const name of ['fund the derived wallet', 'sweep the remainder']) {
    const shape = SIGNED_SHAPES[name];
    const parsed = parseTransaction(
      await signAsDerived(0, {
        chainId: config.CHAIN_ID,
        type: 'eip1559',
        to: shape.to,
        value: shape.value,
        nonce: 0,
        gas: 21_500n,
        maxFeePerGas: 100_000_000n,
        maxPriorityFeePerGas: 0n,
      }),
    );
    assert.equal(parsed.value, shape.value);
    assert.ok(parsed.data === undefined || parsed.data === '0x', `${name} carries calldata`);
  }
});

await test(['C8'], 'a proof the bridge builds is the argument shape enter() declares', () => {
  const tree = buildTree([addressOf(1), addressOf(2), addressOf(3)]);
  const proof = proofFor(tree, 0);
  const decoded = decodeFunctionData({
    abi: GIVEAWAY_MANAGER_V2_ABI,
    data: encodeFunctionData({
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'enter',
      args: [1n, 0n, proof],
    }),
  });
  assert.deepEqual([...decoded.args[2]], proof);
  for (const node of decoded.args[2]) assert.match(node, /^0x[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// read-only calls to Arbitrum One
// ---------------------------------------------------------------------------

// The one place this suite is allowed out. Everything else stays doubled.
http.on('arb1.arbitrum.io', (url, init) => realFetch(url, init));

const client = createPublicClient({
  chain: arbitrum,
  transport: viemHttp(config.DEFAULT_RPC_URL, { timeout: 15_000 }),
});

const readManager = (functionName, args = []) =>
  client.readContract({ address: MANAGER, abi: GIVEAWAY_MANAGER_V2_ABI, functionName, args });

/** One probe, so a network that is not there is reported once, not eight times. */
let reachable = false;
try {
  await readManager('paused');
  reachable = true;
} catch {
  reachable = false;
}

await test(['H1'], 'Arbitrum One answers, so the on-chain checks below actually ran', () => {
  assert.ok(
    reachable,
    'the Arbitrum One RPC could not be reached, so every on-chain check is vacuous',
  );
});

if (reachable) {
  await test(['H1'], 'the manager views decode against the deployed bytecode', async () => {
    const [bridge, paused, deadline, coordinator, subscription] = await Promise.all([
      readManager('bridge'),
      readManager('paused'),
      readManager('CLAIM_DEADLINE'),
      readManager('vrfCoordinator'),
      readManager('subscriptionId'),
    ]);
    assert.match(bridge, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(typeof paused, 'boolean');
    // The window E3's thirty days is measured against, read rather than copied.
    assert.equal(deadline, 90n * 24n * 60n * 60n);
    assert.match(coordinator, /^0x[0-9a-fA-F]{40}$/);
    assert.notEqual(coordinator, '0x0000000000000000000000000000000000000000');
    assert.ok(subscription > 0n);
  });

  await test(['H8'], 'the VRF subscription the contract names is readable through it', async () => {
    const [coordinator, subscriptionId] = await Promise.all([
      readManager('vrfCoordinator'),
      readManager('subscriptionId'),
    ]);
    const result = await client.readContract({
      address: coordinator,
      abi: VRF_COORDINATOR_V2_PLUS_ABI,
      functionName: 'getSubscription',
      args: [subscriptionId],
    });
    // The first element is the LINK balance in juels; nativeBalance is second.
    assert.equal(typeof result[0], 'bigint');
    assert.ok(Array.isArray(result[4]), 'the consumer list did not decode');
    assert.ok(
      result[4].some((consumer) => consumer.toLowerCase() === MANAGER.toLowerCase()),
      'the manager is not a consumer of the subscription it names',
    );
  });

  await test(['H6'], 'the slot and entry views answer for a campaign id', async () => {
    const [slots, entered] = await Promise.all([
      readManager('slotsRemaining', [1n]),
      readManager('hasEntered', [1n, WALLET]),
    ]);
    assert.equal(typeof slots, 'bigint');
    assert.equal(entered, false);
  });

  await test(['E2'], 'the campaign tuple decodes into the fields the bridge reads', async () => {
    const [campaign, effectiveEnd] = await Promise.all([
      readManager('getGiveaway', [1n]),
      readManager('effectiveEndTime', [1n]),
    ]);
    // effectiveEndTime is not a field of the tuple and is not derivable from it:
    // the core adds the platform's accrued pause time.
    assert.equal(typeof effectiveEnd, 'bigint');
    for (const field of [
      'creator', 'startTime', 'winnersCount', 'prizeModule', 'endTime', 'status',
      'prizeKind', 'feeToken', 'prizeAmount', 'settledAt',
    ]) {
      assert.ok(field in campaign, `${field} did not decode`);
    }
  });

  await test(['E2'], 'the three deployed prize modules are told apart by ERC-165', async () => {
    // PrizeKind has two values and there are three prize shapes: both NFT
    // modules answer PrizeKind.NFT, so the kind cannot be the discriminator.
    const answers = await Promise.all(
      PRIZE_MODULES.map(async (module) => {
        try {
          return await client.readContract({
            address: module,
            abi: ERC1155_PRIZE_MODULE_ABI,
            functionName: 'supportsInterface',
            args: [ERC1155_RECEIVER_INTERFACE_ID],
          });
        } catch {
          // ERC721PrizeModule declares no supportsInterface at all, and
          // PrizeModuleBase adds none, so the call reverts there. A revert read
          // as "not this module" is the standard ERC-165 probe.
          return false;
        }
      }),
    );
    assert.equal(answers.length, 3);
    assert.equal(
      answers.filter(Boolean).length,
      1,
      `${answers.filter(Boolean).length} of three modules claim IERC1155Receiver`,
    );
  });

  await test(['E2'], 'no module answers both item interfaces, so a delivery is never ambiguous', async () => {
    const implemented = async (module, abi, functionName) => {
      try {
        await client.readContract({ address: module, abi, functionName, args: [1n] });
        return true;
      } catch (error) {
        // A campaign the module knows nothing about still decodes as a call it
        // implements; an unknown selector fails on the dispatch instead.
        return !/returned no data|does not exist|reverted/i.test(String(error.message));
      }
    };
    for (const module of PRIZE_MODULES) {
      const [items, lots] = await Promise.all([
        implemented(module, ERC721_PRIZE_MODULE_ABI, 'itemsOf'),
        implemented(module, ERC1155_PRIZE_MODULE_ABI, 'lotsOf'),
      ]);
      assert.ok(!(items && lots), `${module} answers both itemsOf and lotsOf`);
    }
  });

  await test(['H4'], 'a real estimate for a value transfer falls inside the transfer band', async () => {
    // The 21_000 that used to be written into the two value transfers is not the
    // intrinsic cost on this chain: Arbitrum folds the L1 data component in.
    const estimate = await client.estimateGas({
      account: '0x0000000000000000000000000000000000000001',
      to: DESTINATION,
    });
    assert.ok(
      estimate >= config.GAS_BANDS.TRANSFER.min && estimate <= config.GAS_BANDS.TRANSFER.max,
      `a real transfer estimates at ${estimate}, outside the band`,
    );
    assert.ok(estimate > 21_000n, `the estimate is ${estimate}; a 21_000 limit would run out`);
  });

  await test(['H3', 'H4'], 'a real fee quote produces a plan under the absolute ceiling', async () => {
    const fees = await client.estimateFeesPerGas();
    assert.ok(fees.maxFeePerGas > 0n, 'the chain reported an unusable fee');
    const plan = planGas(
      config.GAS_BANDS.MANAGER.min,
      fees.maxFeePerGas,
      fees.maxPriorityFeePerGas ?? 0n,
      config.GAS_BANDS.MANAGER,
    );
    assert.ok(plan.worstCaseWei <= config.MAX_GAS_COST_WEI);
  });
}
