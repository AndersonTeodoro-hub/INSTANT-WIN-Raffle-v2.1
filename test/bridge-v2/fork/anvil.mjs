/**
 * A local fork of Arbitrum One, for the SPEC-BLOCO-03 on-chain requirements.
 *
 * anvil (Foundry 1.5.1), found through ANVIL_BIN (A15), forking the public
 * endpoint — or ARBITRUM_RPC_URL when the operator has one — READ-ONLY: the fork
 * reads state from Arbitrum One and every transaction stays on this machine.
 * `--hardfork osaka` because anvil 1.5.1 only answers the P-256 precompile at
 * 0x100 under it (Phase A, M5/F11).
 *
 * M44: the harness refuses to run anything against a node that is not
 * 127.0.0.1 answering chainId 42161. No test here can reach a real network with
 * a transaction, because every transaction goes to the URL this file checked.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { encodeAbiParameters, keccak256, pad, toHex } from 'viem';

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/** M44: the only node this harness will talk to. Throws otherwise. */
export async function assertLocalFork(url, fetchImpl = fetch) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1') throw new Error(`[fork] refusing a node that is not 127.0.0.1: ${parsed.hostname}`);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  const { result } = await response.json();
  if (Number(result) !== 42161) throw new Error(`[fork] refusing chain ${Number(result)}; the fork must be Arbitrum One (42161)`);
}

/** Starts anvil and waits until it answers. */
export async function startFork({ bin, upstream, fetchImpl = fetch }) {
  const port = await freePort();
  const child = spawn(
    bin,
    ['--fork-url', upstream, '--hardfork', 'osaka', '--chain-id', '42161', '--port', String(port), '--host', '127.0.0.1', '--silent'],
    { stdio: 'ignore', windowsHide: true },
  );
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      await assertLocalFork(url, fetchImpl);
      break;
    } catch (error) {
      if (Date.now() > deadline || child.exitCode !== null) {
        child.kill();
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return { url, stop: () => child.kill() };
}

/** Raw JSON-RPC against the fork, for the anvil_* methods viem does not wrap. */
export function rpcClient(url, fetchImpl = fetch) {
  let id = 0;
  const call = async (method, params = []) => {
    id += 1;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const body = await response.json();
    if (body.error) {
      const error = new Error(`[fork] ${method}: ${body.error.message}`);
      error.data = body.error.data;
      throw error;
    }
    return body.result;
  };

  const waitMined = async (hash) => {
    for (let i = 0; i < 200; i += 1) {
      const receipt = await call('eth_getTransactionReceipt', [hash]);
      if (receipt !== null) return receipt;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`[fork] ${hash} was never mined`);
  };

  return {
    call,
    setBalance: (address, wei) => call('anvil_setBalance', [address, toHex(wei)]),
    impersonate: (address) => call('anvil_impersonateAccount', [address]),
    stopImpersonating: (address) => call('anvil_stopImpersonatingAccount', [address]),
    increaseTime: async (seconds) => {
      await call('evm_increaseTime', [toHex(seconds)]);
      await call('evm_mine', []);
    },
    snapshot: () => call('evm_snapshot', []),
    revert: (snapshotId) => call('evm_revert', [snapshotId]),
    /** Sends as an address the node signs for (impersonated), and waits for the receipt. */
    send: async ({ from, to, data, value = 0n, gas = 3_000_000n }) => {
      const hash = await call('eth_sendTransaction', [{ from, to, data, value: toHex(value), gas: toHex(gas) }]);
      return waitMined(hash);
    },
    /** A call's revert reason, or null when it would succeed. */
    revertOf: async ({ from, to, data }) => {
      try {
        await call('eth_call', [{ from, to, data }, 'latest']);
        return null;
      } catch (error) {
        return `${error.message} ${typeof error.data === 'string' ? error.data : ''}`;
      }
    },
    waitMined,
  };
}

/**
 * Native USDC on Arbitrum One is FiatTokenV2_2, whose balances live in
 * balanceAndBlacklistStates at slot 9. Written directly so a test can hold USDC
 * without anybody else's. The caller reads balanceOf back to confirm.
 */
export async function setUsdcBalance(rpc, usdc, holder, amount) {
  const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, 9n]));
  await rpc.call('anvil_setStorageAt', [usdc, slot, pad(toHex(amount), { size: 32 })]);
}
