/**
 * The Arbitrum One endpoint the browser reads the chain through (wagmi, in
 * constants.ts). One constant in a file of its own, so the local preview of the
 * pages (test/preview) can point it at a local fork without a line of the app
 * changing — the same reason the Keptra addresses live in lib/keptra/contracts.ts.
 */
export const ARBITRUM_RPC_URL = 'https://arb1.arbitrum.io/rpc';
