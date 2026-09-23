/**
 * The contracts the Keptra pages read, and nothing that signs.
 *
 * SPEC-BLOCO-03 Q1 and T18: the addresses of the escrow, the guarantee and the
 * voucher are literals, zero until the owner fills them in after the deploy — the
 * same three config.ts holds for the bridge (a test keeps the two equal). While
 * they are zero the order, offer and pool screens say "not available yet" (U35).
 * T18 and Q7, after the batch before the deploy: every ABI entry here and in
 * lib/bridge-v2/abi.ts is held by a test against the ABI compiled from 5d85a46
 * (test/bridge-v2/fork/keptra-5d85a46.json). The addresses stay zero: DeployKeptra
 * puts the contracts at CREATE2 addresses whose creation code carries the role
 * addresses of the deploy, so they are known only then.
 *
 * The ABIs the bridge already reads with are re-exported from lib/bridge-v2/abi.ts
 * (it imports viem and nothing else), so there is one copy of each; what only the
 * page reads — the pool's panel (12.7), the tier (T15), the escrow's own ceilings —
 * is declared here.
 */

import { parseAbi } from 'viem';

export {
  ERC20_ABI,
  KEPTRA_ESCROW_ABI,
  KEPTRA_GUARANTEE_ABI,
  KEPTRA_VOUCHER_ABI,
  OrderFlag,
  OrderState,
} from '../bridge-v2/abi.js';

export const KEPTRA_ESCROW: `0x${string}` = '0x0000000000000000000000000000000000000000';
export const KEPTRA_GUARANTEE: `0x${string}` = '0x0000000000000000000000000000000000000000';
export const KEPTRA_VOUCHER: `0x${string}` = '0x0000000000000000000000000000000000000000';

/** USDC on Arbitrum One, 6 decimals — config.ts's USDC. */
export const USDC: `0x${string}` = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const USDC_DECIMALS = 6;

const ZERO = '0x0000000000000000000000000000000000000000';

/** Q1: every Keptra screen checks this first. */
export function keptraConfigured(): boolean {
  return [KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_VOUCHER].every((address) => address.toLowerCase() !== ZERO);
}

/**
 * What the page reads of the escrow besides the bridge's ABI: the section 7
 * ceilings, the pause, the stores, the reputation. P6-19: the fee is not read by
 * the page (the bridge computes what a store receives, P6-1), so it is not here.
 */
export const ESCROW_READ_ABI = parseAbi([
  'function MAX_REFUSAL_BPS() view returns (uint16)',
  'function MAX_SHIP_DAYS() view returns (uint16)',
  'function MAX_DELIVERY_DAYS() view returns (uint16)',
  'function paused() view returns (bool)',
  'function isStore(address) view returns (bool)',
  'function reputation() view returns (address)',
]);

/** 13 and T15: a store's tier and counters, read from the chain. */
export const REPUTATION_READ_ABI = parseAbi([
  'function tierOf(address store) view returns (uint8)',
  'function countersOf(address store) view returns (uint32 delivered, uint32 minor, uint32 material, uint32 refunds, uint32 fraud, uint32 streak, bool suspended)',
]);

/** The guarantee's side of 12.7: the default source (the pool), and how a protection fee splits. */
export const GUARANTEE_READ_ABI = parseAbi([
  'function defaultSource() view returns (address)',
  'function poolShareBps() view returns (uint16)',
  'function reserveShareBps() view returns (uint16)',
  'function platformShareBps() view returns (uint16)',
  'function totalDebtOf(address brand) view returns (uint256)',
  'event DebtRecorded(address indexed brand, address indexed source, uint256 amount)',
  // P6-4: every protection fee charged, and the source that took its share.
  'event ObligationCreated(uint256 indexed obligationId, uint256 indexed termsId, address indexed brand, address source, uint32 units, uint96 bond, uint96 coverage, uint256 protectionFee, uint8 tier)',
]);

/** 12.7: the pool's public state, every figure the panel shows. */
export const POOL_READ_ABI = parseAbi([
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function reservedTotal() view returns (uint256)',
  'function freeCapacity() view returns (uint256)',
  'function utilisationBps() view returns (uint256)',
  'function maxUtilisationBps() view returns (uint16)',
  'function riskReserve() view returns (uint256)',
  'function feesReceived() view returns (uint256)',
  'function lossesPaid() view returns (uint256)',
  'function pendingRequests() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function debtOf(address brand) view returns (uint256)',
  'event ProviderSet(address indexed provider, bool allowed)',
  // P6-4: what the pool took of each fee, into its capital and its risk reserve.
  'event FeeReceived(uint256 indexed obligationId, uint256 capitalAmount, uint256 reserveAmount)',
]);

/** 13.2: the tiers as the reputation contract numbers them. */
export const TIER_NAMES = ['New', 'Verified', 'Trusted', 'Restricted', 'Suspended'] as const;
