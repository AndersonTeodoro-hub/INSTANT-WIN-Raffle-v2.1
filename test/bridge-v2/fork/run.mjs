/**
 * The fork suite's entry point, run as a child of ../run.mjs. SPEC-BLOCO-03.
 *
 *   node --experimental-strip-types --import ./test/bridge-v2/fork/register.mjs test/bridge-v2/fork/run.mjs
 *
 * Starts anvil from ANVIL_BIN on a fork of Arbitrum One, points the bridge's
 * chain modules at it, runs keptra.fork.mjs, and prints its results as one JSON
 * line for the parent to merge into the requirement map. Without ANVIL_BIN it
 * reports one failure rather than nothing: a suite that did not run has not
 * passed.
 *
 * Outbound HTTP is the same double the main suite uses, with one route let
 * through: 127.0.0.1, the fork itself.
 */

import { http, installEnv, installFetchDouble, jsonResponse, realFetch, results, restoreFetch } from '../harness.mjs';
import { startFork } from './anvil.mjs';

const MARKER = '::keptra-fork-results::';

installEnv();
installFetchDouble();

const bin = process.env.ANVIL_BIN;
let fork = null;

if (bin === undefined || bin.length === 0) {
  results.push({
    suite: 'fork',
    requirements: [],
    name: 'ANVIL_BIN is set, so the on-chain suite can start a local fork',
    ok: false,
    error: 'ANVIL_BIN is not set: the on-chain tests did not run',
  });
} else {
  try {
    // The fork READS from Arbitrum One: the operator's endpoint when there is
    // one, the public one otherwise. Every transaction stays on 127.0.0.1.
    const { DEFAULT_RPC_URL } = await import('../../../lib/bridge-v2/config.ts');
    const upstream = process.env.ARBITRUM_RPC_URL ?? DEFAULT_RPC_URL;
    fork = await startFork({ bin, upstream, fetchImpl: realFetch });
    process.env.ARBITRUM_RPC_URL = fork.url;
    // One answer is the chain's rather than anvil's: Arbitrum One suggests a
    // priority fee of zero (eth_maxPriorityFeePerGas, measured 18/09/2026), anvil
    // one gwei whatever it forks. Left at anvil's, every fee estimate is fifty
    // times the chain's and H3's ceiling refuses what the real chain would take.
    const passThrough = (url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (body?.method === 'eth_maxPriorityFeePerGas') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: '0x0' });
      }
      return realFetch(url, init);
    };
    http.on('127.0.0.1', passThrough);
    // Mail and Telegram are accepted and recorded, never sent.
    http.on('api.resend.com', () => jsonResponse({ id: 'test-mail' }));
    http.on('api.telegram.org', () => jsonResponse({ ok: true, result: {} }));
    await import('./keptra.fork.mjs');
  } catch (error) {
    results.push({
      suite: 'fork',
      requirements: [],
      name: 'the local fork starts and the on-chain suite loads',
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  } finally {
    fork?.stop();
  }
}

restoreFetch();
process.stdout.write(`\n${MARKER}${JSON.stringify(results)}\n`);
process.exit(0);
