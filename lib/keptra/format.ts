/**
 * How the Keptra pages write numbers, dates and a transaction's summary.
 *
 * T0: every number shown comes from the chain or the bridge; these functions only
 * write them down — an amount in base units becomes "12.50 USDC", never a guess.
 * C12 and T2: a relay summary becomes three plain sentences — what happens, what
 * moves, where it goes — from the fields the bridge computed.
 */

import type { ActionSummary, SummaryAmount } from './relay.js';
import { KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_VOUCHER, USDC, USDC_DECIMALS } from './contracts.js';

/** Base units as a decimal string with the token's decimals, trailing zeros past two dropped. */
export function formatUnits(value: string | bigint, decimals: number): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (fraction.length < 2 && decimals >= 2) fraction = fraction.padEnd(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === '' ? '' : `.${fraction}`}`;
}

export const formatUsdc = (value: string | bigint): string => `${formatUnits(value, USDC_DECIMALS)} USDC`;

/** "12.50" from what a person typed, in USDC base units; null when it is not an amount with at most six decimals. */
export function parseUsdc(text: string): bigint | null {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return BigInt(whole) * 10n ** 6n + BigInt(fraction.padEnd(6, '0'));
}

export const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A chain timestamp (seconds) as "22 Sep 2026, 14:05 UTC". */
export function formatUtc(seconds: string | number | bigint): string {
  const date = new Date(Number(seconds) * 1000);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${day}, ${time} UTC`;
}

/** "in 3 days" / "in 5 hours" / "passed", against the chain's clock or this device's. */
export function timeLeft(seconds: string | number | bigint, nowSeconds: number): string {
  const left = Number(seconds) - nowSeconds;
  if (left <= 0) return 'passed';
  const days = Math.floor(left / 86_400);
  if (days >= 2) return `in ${days} days`;
  const hours = Math.floor(left / 3_600);
  if (hours >= 2) return `in ${hours} hours`;
  return `in ${Math.max(1, Math.floor(left / 60))} minutes`;
}

/** ISO-3166-1 alpha-2 as a country's English name, through the platform's own table. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The countries an offer accepts, from regionsOf's bytes: ASCII pairs (I14). */
export function decodeRegions(hex: string): string[] {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const text = Array.from({ length: body.length / 2 }, (_, i) => String.fromCharCode(parseInt(body.slice(2 * i, 2 * i + 2), 16))).join('');
  return text.match(/.{2}/g) ?? [];
}

// ---------------------------------------------------------------------------
// C12 and T2 — a relay summary in plain words
// ---------------------------------------------------------------------------

const ACTION_WORDS: Record<string, string> = {
  enter: 'Enter the draw',
  claim: 'Claim your prize',
  transfer: 'Send a prize',
  transferUsdc: 'Send USDC',
  createCampaign: 'Create the campaign',
  addPasskey: 'Add a passkey',
  cancelRecovery: 'Cancel the change of access',
  revokeGuardian: 'Remove the recovery key',
  configure: 'Set up your account',
  pay: 'Pay for this order',
  redeem: 'Redeem your voucher',
  cancelOrder: 'Cancel this order',
  confirm: 'Confirm you received the order',
  contest: 'Contest this order',
  createOffer: 'Publish this offer',
  deactivateOffer: 'Take this offer down',
  ship: 'Declare the order shipped',
  submitCode: 'Submit the delivery code',
  declareDelivered: 'Declare the order delivered',
  declareRefusal: 'Declare the order refused',
  refund: 'Refund the recipient',
  createObligation: 'Create the prize obligation',
  createVoucherCampaign: 'Create the voucher campaign',
};

/** What a named contract is, for a person. */
function contractName(address: string): string | null {
  const lower = address.toLowerCase();
  if (lower === KEPTRA_ESCROW.toLowerCase()) return 'the Keptra escrow contract';
  if (lower === KEPTRA_GUARANTEE.toLowerCase()) return 'the Keptra guarantee contract';
  return null;
}

/**
 * V4 (A4): USDC with its six decimals; any other token with the decimals and the
 * symbol the bridge read from it (relay.ts withTokenMeta). A token that did not say
 * gets no figure at all — a count of base units read as a price would be a number
 * nobody read.
 */
export function amountText(amount: SummaryAmount): string {
  if (amount.kind === 'ERC20') {
    if (amount.token.toLowerCase() === USDC.toLowerCase()) return formatUsdc(amount.value);
    if (amount.meta) return `${formatUnits(amount.value, amount.meta.decimals)} ${amount.meta.symbol}`;
    // P6-18: a failed read is a failed read, not a token that says nothing.
    if (amount.metaFailed) return `an amount of token ${shortAddress(amount.token)} that cannot be shown: its decimals could not be read — try again`;
    return `an amount of token ${shortAddress(amount.token)} that cannot be shown: the token does not state its decimals`;
  }
  if (amount.kind === 'ITEMS') return `${amount.count} prize item${amount.count === '1' ? '' : 's'}`;
  const what = amount.token.toLowerCase() === KEPTRA_VOUCHER.toLowerCase() ? 'voucher' : 'item';
  return amount.tokenIds.length === 1 ? `${what} #${amount.tokenIds[0]}` : `${amount.tokenIds.length} ${what}s (#${amount.tokenIds.join(', #')})`;
}

const DESTINATION_WORDS: Record<string, string> = {
  ESCROW: 'held by the Keptra escrow contract until the order ends',
  GUARANTEE: 'held by the Keptra guarantee contract',
  GIVEAWAY: 'to the Instant Win giveaway contract',
  THIS_ACCOUNT: 'into your own Keptra account',
  STORE: "to the store's payout address",
  RECIPIENT: "to the buyer's Keptra account",
  ADDRESS: 'to the address you entered',
};

export interface SummaryWords {
  readonly action: string;
  /** Each amount as a sentence fragment; empty when nothing moves. */
  readonly amounts: readonly string[];
  /** Where it goes, in words, and the address itself; null when nothing moves. */
  readonly destination: { readonly words: string; readonly address: string; readonly named: string | null } | null;
}

export function summaryWords(summary: ActionSummary): SummaryWords {
  return {
    action: ACTION_WORDS[summary.action] ?? summary.action,
    amounts: summary.amounts.map(amountText),
    destination:
      summary.destination === null
        ? null
        : {
            words: DESTINATION_WORDS[summary.destination.role] ?? summary.destination.role,
            address: summary.destination.address,
            named: contractName(summary.destination.address),
          },
  };
}
