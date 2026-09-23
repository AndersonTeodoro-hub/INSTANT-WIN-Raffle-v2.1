/**
 * The relay: what the bridge does with a Keptra account. SPEC-BLOCO-03 6.1.5,
 * 6.2.2, 6.5 and 6.4.
 *
 * Two steps, the same inputs both times. prepare builds the account's next
 * transaction for one action and returns the hash the passkey must sign; submit
 * builds it again from scratch, checks that the passkey signed exactly that hash,
 * and sends it — paid by the relayer, authorised by nothing but the signature
 * (section 5: "submeter transacções assinadas por passkeys e pagar o gás").
 *
 * WHAT CAN BE BUILT is the Action union below and nothing else. The account is
 * always the session's own (M36): the route passes a participant id from the
 * cookie, and no address of an account ever arrives from a request. Every
 * transaction passes keptra.refusalFor before a hash is returned and again
 * before anything is sent (R-4, R-5, M21).
 *
 * The first action an account takes also creates it (6.1.6): the relayer sends
 * createSigner, createProxyWithNonce and the account's first execTransaction as
 * one atomic batch, and that first transaction starts with the configuration
 * that enables the recovery module and adds the guardian (6.1.4).
 *
 * Adenda C2, option (b), as D1 reads it: the configuration is read from the
 * chain on every action. An account that exists without its module — deployed
 * at its address by somebody else through the permissionless factory — or that
 * was never configured and holds no guardian can do exactly one thing through
 * the relay: `configure`, which completes it, signed by its passkey. An account
 * that was configured and whose guardian its user revoked (R-3) keeps every
 * action, and `configure` adds the current guardian back — except during a
 * guardian compromise (bridge_v2_guardian_incidents), when it waits for the
 * rotation, and no transaction adds a listed key to any account. `configure`
 * on an account that does not exist yet creates it with nothing but its
 * configuration, which is how the bridge deploys and configures an account
 * before showing its address as a destination of value (C4).
 *
 * Adenda E2: the relayer pays for at most 20 transactions per account in 24
 * hours. The cancellation of a recovery and the reaction to a compromise are
 * never counted, never refused by that limit, and never stopped by the shared
 * spend ceiling. Adenda E3 and E10: "deployed" and "never configured" are the
 * chain's answer (readAccount). Adenda E7: the maintenance pass settles from the
 * chain a campaign whose receipt never came (reconcileRelayedCampaigns).
 *
 * Adenda F1: every decision about an account's guardian — R-3's revocation
 * among them — is about the guardian the account holds on-chain, never the one
 * recorded here, and the maintenance pass brings the record into line
 * (reconcileGuardians). Adenda F5: a draft in FUNDING with no hash is released
 * only when the chain shows no campaign of the creator account since it.
 * Adenda F7: a submission sends nothing unless its irreversible part fits the
 * route's own budget (submitAction, RELAY_SEND_MS). Adenda F10: the closed list
 * reads the calls before they are encoded.
 */

import { encodeAbiParameters, encodeFunctionData, keccak256, type Hex } from 'viem';
import { alert } from './alert.js';
import { claimSpend } from './spend.js';
import type { Logger } from './log.js';
import { acquireRunLock, releaseRunLock, runDeadline, type RunDeadline } from './runlock.js';
import {
  CREATOR_APPROVAL_ABI,
  CREATOR_CAMPAIGN_MANAGER_ABI,
  ERC20_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  KEPTRA_ESCROW_ABI,
  KEPTRA_GUARANTEE_ABI,
  KEPTRA_VOUCHER_ABI,
  OrderFlag,
  OrderMode,
  OrderState,
  PrizeKind,
} from './abi.js';
import {
  ACCOUNT_RECOGNITION_MS,
  CAMPAIGN_RECONCILE_MS,
  CONTRACT_MAX_DURATION_SECONDS,
  CONTRACT_MAX_PARTICIPANTS,
  CONTRACT_MIN_DURATION_SECONDS,
  CONTRACT_MIN_PARTICIPANTS,
  ERC721_PRIZE_MODULE,
  GIVEAWAY_MANAGER_V2,
  GUARDIAN_CHANGES_PER_DAY,
  GUARDIAN_RECORD_MS,
  GUARDIAN_SCAN_MS,
  KEPTRA_ESCROW,
  KEPTRA_GUARANTEE,
  KEPTRA_VOUCHER,
  REDEMPTION_ATTESTATION_TTL_SECONDS,
  RELAYED_CAMPAIGN_STALE_MS,
  RELAYED_TRANSACTIONS_PER_DAY,
  RELAY_SEND_MS,
  USDC,
  VOUCHER_CAMPAIGN_MAX_ITEMS,
} from './config.js';
import {
  campaignsCreatedBy,
  claimableFor,
  currentCreationFee,
  erc20BalanceOf,
  encodeTokenPrizeData,
  erc20Meta,
  giveawayIdFromLogs,
  prizeDelivery,
  readGiveaway,
  signRedemption,
  slotPrice,
  transactionKnown,
  waitForReceipt,
  type MinedReceipt,
} from './chain.js';
import {
  brandParams,
  keptraPeripherals,
  obligationFromLogs,
  offerIdFromLogs,
  orderIdFromLogs,
  readObligation,
  readOrder,
  readTerms,
  readVouchers,
  voucherIdsFromLogs,
  type OrderWithTerms,
  type TermsView,
} from './escrowChain.js';
import { bindAddress, keptraContractsConfigured, orderHasAddress, shipmentOf, unboundAddress, type AddressPurpose } from './orders.js';
import { hasVerifiedPhone } from './phone.js';
import {
  accountState,
  chainNow,
  configurationRefusal,
  hasCode,
  isValidPasskeySignature,
  relayerCall,
  sendRelayed,
  type AccountState,
} from './keptraChain.js';
import {
  accountUsable,
  addGuardianCalls,
  addOwnerCalls,
  assertionToSignature,
  cancelRecoveryCalls,
  configurationCalls,
  configurationGap,
  createAccountCall,
  createSignerCall,
  encodeSafeSignature,
  execTransactionData,
  refusalFor,
  revokeGuardianCalls,
  safeTxFor,
  safeTxHash,
  type AccountRole,
  type SafeCall,
  type SafeTx,
} from './keptra.js';
import {
  accountBySafe,
  accountsAwaitingRecognition,
  accountsPage,
  findAccount,
  findPasskey,
  guardianChangesSince,
  guardianCompromised,
  markDeployed,
  passkeySigners,
  recordGuardian,
  recordGuardianChange,
  recordRelayed,
  relayedSince,
  type Account,
  type Passkey,
} from './accounts.js';
import { findEntry } from './entries.js';
import { proofForAddress } from './eligibility.js';
import { findCreatorById, findCreatorByParticipant } from './creators.js';
import {
  advanceCampaign,
  creatorCampaignLock,
  findActiveCampaign,
  startSubmission,
  fundingCampaigns,
  registeredGiveawayIds,
  type CreatorCampaign,
} from './creatorCampaigns.js';
import { acquireFunder, disableFunder, releaseFunder, signAsFunder } from './funders.js';
import { guardianAddress } from './guardian.js';

/** Everything an account can be asked to do through the relay. A closed union. */
export type Action =
  | { readonly kind: 'enter'; readonly giveawayId: bigint }
  | { readonly kind: 'claim'; readonly giveawayId: bigint }
  /** C7: `amount` is what the owner asked to send, in the prize's own unit — never "the whole balance". */
  | { readonly kind: 'transfer'; readonly giveawayId: bigint; readonly to: `0x${string}`; readonly amount: bigint }
  /** SPEC-BLOCO-03 T12 (U17): USDC out of either account, exactly the amount stated (C7). */
  | { readonly kind: 'transferUsdc'; readonly to: `0x${string}`; readonly amount: bigint }
  | { readonly kind: 'createCampaign' }
  | { readonly kind: 'addPasskey'; readonly credentialId: string }
  | { readonly kind: 'cancelRecovery' }
  | { readonly kind: 'revokeGuardian' }
  /** C2, C4, A6: complete what the account lacks — create it, enable the module, add the guardian. */
  | { readonly kind: 'configure' }
  // SPEC-BLOCO-03 piece 5, P1 — the recipient (6.2.2, T1, T2, T6, T9).
  /** T1 in COMPRA. `codeCommit` is the delivery code's commitment from the recipient's own device (H18), zero by carrier. */
  | { readonly kind: 'pay'; readonly termsId: bigint; readonly quantity: number; readonly codeCommit: Hex }
  /** T1 in PRÉMIO. `deadline` is the attestation's: set by prepare, echoed by submit so both build the same bytes. */
  | { readonly kind: 'redeem'; readonly voucherId: bigint; readonly codeCommit: Hex; readonly deadline: bigint | null }
  | { readonly kind: 'cancelOrder'; readonly orderId: bigint }
  | { readonly kind: 'confirm'; readonly orderId: bigint }
  | { readonly kind: 'contest'; readonly orderId: bigint }
  // P1 — the store and the brand, from their creator account (P2).
  | { readonly kind: 'createOffer'; readonly terms: OfferTerms }
  | { readonly kind: 'deactivateOffer'; readonly termsId: bigint }
  | { readonly kind: 'ship'; readonly orderId: bigint }
  | { readonly kind: 'submitCode'; readonly orderId: bigint; readonly code: Hex }
  | { readonly kind: 'declareDelivered'; readonly orderId: bigint }
  | { readonly kind: 'declareRefusal'; readonly orderId: bigint }
  | { readonly kind: 'refund'; readonly orderId: bigint; readonly amount: bigint }
  | { readonly kind: 'createObligation'; readonly terms: OfferTerms; readonly units: number }
  | {
      readonly kind: 'createVoucherCampaign';
      readonly obligationId: bigint;
      readonly voucherIds: readonly bigint[];
      readonly durationSeconds: number;
      readonly slotCap: number;
    };

/** Section 7 as a store or brand states it. For an obligation, `price` is the declared value and there is no refusal fee (11.6). */
export interface OfferTerms {
  readonly payout: `0x${string}`;
  readonly price: bigint;
  readonly shipping: bigint;
  readonly returnCost: bigint;
  readonly refusalFeeBps: number;
  readonly shipDays: number;
  readonly deliveryDays: number;
  readonly mode: number;
  /** I14: ISO-3166-1 alpha-2 pairs, as bytes (orders.encodeRegions). */
  readonly regions: Hex;
}

/**
 * SPEC-BLOCO-03 C12 and T2: what one transaction does — the action, the amounts
 * and the destination — computed here, while the calls are built, from the same
 * reads the calls are built from. The page shows it before it asks for the
 * passkey and computes none of it (T2: no third copy of a formula).
 *
 * An amount is what leaves the account; for claim and for a cancelled order it is
 * what comes back into it, and the destination is then the account itself.
 */
export type SummaryAmount =
  /**
   * V4: a token other than USDC carries its own decimals and symbol, read from the
   * token when the summary is prepared (withTokenMeta), or null when the token does
   * not say — the page then shows no figure for it. USDC's are config.ts's.
   */
  | { readonly kind: 'ERC20'; readonly token: `0x${string}`; readonly value: bigint; readonly meta?: { readonly decimals: number; readonly symbol: string } | null }
  | { readonly kind: 'NFT'; readonly token: `0x${string}`; readonly tokenIds: readonly bigint[] }
  /** Prize items whose ids the claim itself decides (an NFT campaign's claim). */
  | { readonly kind: 'ITEMS'; readonly token: `0x${string}`; readonly count: bigint };

export type DestinationRole = 'ESCROW' | 'GUARANTEE' | 'GIVEAWAY' | 'THIS_ACCOUNT' | 'STORE' | 'RECIPIENT' | 'ADDRESS';

export interface ActionSummary {
  readonly action: Action['kind'];
  readonly amounts: readonly SummaryAmount[];
  readonly destination: { readonly address: `0x${string}`; readonly role: DestinationRole } | null;
}

const usdcAmount = (value: bigint): SummaryAmount => ({ kind: 'ERC20', token: USDC, value });
const nothingMoves = (action: Action['kind']): ActionSummary => ({ action, amounts: [], destination: null });
const summaryOf = (
  action: Action['kind'],
  amounts: readonly SummaryAmount[],
  address: `0x${string}`,
  role: DestinationRole,
): ActionSummary => ({ action, amounts, destination: { address, role } });

/** The summary as JSON: every amount and id a string, since a uint256 does not survive a JSON number. */
export function summaryJson(summary: ActionSummary): Record<string, unknown> {
  return {
    action: summary.action,
    amounts: summary.amounts.map((amount) =>
      amount.kind === 'ERC20'
        ? { kind: amount.kind, token: amount.token, value: amount.value.toString(), ...(amount.meta === undefined ? {} : { meta: amount.meta }) }
        : amount.kind === 'NFT'
          ? { kind: amount.kind, token: amount.token, tokenIds: amount.tokenIds.map(String) }
          : { kind: amount.kind, token: amount.token, count: amount.count.toString() },
    ),
    destination: summary.destination,
  };
}

/**
 * SPEC-BLOCO-03 V4 (A4): every amount of a token other than USDC in the summary,
 * with that token's decimals and symbol as the token reports them (erc20Meta, which
 * refuses a symbol that is not a short plain word). Done once, when the summary is
 * prepared for the page; the submit rebuilds the calls and needs none of it.
 */
export async function withTokenMeta(summary: ActionSummary): Promise<ActionSummary> {
  const amounts = await Promise.all(
    summary.amounts.map(async (amount) =>
      amount.kind === 'ERC20' && amount.token.toLowerCase() !== USDC.toLowerCase() ? { ...amount, meta: await erc20Meta(amount.token) } : amount,
    ),
  );
  return { ...summary, amounts };
}

/**
 * SPEC-BLOCO-03 V5 (B11): the contracts USDC is never sent to from an account — the
 * five of Keptra (the escrow, the guarantee and the voucher of config.ts, and the
 * reputation and the pool the escrow and the guarantee name on-chain), the USDC
 * contract itself and the draws' core. USDC sent to any of them would not come
 * back. When the two on-chain names cannot be read the transfer is refused: it is
 * not signed unchecked.
 */
async function platformContract(to: `0x${string}`): Promise<boolean> {
  const named: `0x${string}`[] = [USDC, GIVEAWAY_MANAGER_V2, KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_VOUCHER];
  if (keptraContractsConfigured()) {
    try {
      named.push(...(await keptraPeripherals()));
    } catch {
      throw new RelayRefusal('destination_unchecked');
    }
  }
  return named.some((address) => address.toLowerCase() === to.toLowerCase());
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_SECONDS = 86_400n;
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
const MAX_UINT96 = (1n << 96n) - 1n;
const BPS = 10_000n;

/**
 * Adenda E2: the cancellation of a recovery (6.3.3, R-2) and the reaction to a
 * compromise (R-3, A6). Always possible: never counted against the relay's limit,
 * never refused by it, and sent whatever the shared spend ceiling says.
 *
 * Adenda P16: and contesting, confirming and cancelling an order — a right with a
 * deadline is never lost to a limit.
 */
const ALWAYS_POSSIBLE: ReadonlySet<Action['kind']> = new Set(['cancelRecovery', 'revokeGuardian', 'cancelOrder', 'confirm', 'contest']);

/** P1: what a recipient does, and what a store or a brand does. */
const RECIPIENT_ACTIONS: ReadonlySet<Action['kind']> = new Set(['pay', 'redeem', 'cancelOrder', 'confirm', 'contest']);
const STORE_ACTIONS: ReadonlySet<Action['kind']> = new Set([
  'createOffer',
  'deactivateOffer',
  'ship',
  'submitCode',
  'declareDelivered',
  'declareRefusal',
  'refund',
  'createObligation',
  'createVoucherCampaign',
]);

/** Which of the participant's two accounts an action runs on (A10). P2: a store is its creator account. */
export function roleFor(action: Action, requested: AccountRole | null): AccountRole {
  if (action.kind === 'enter' || action.kind === 'claim' || action.kind === 'transfer') return 'PARTICIPANT';
  if (action.kind === 'createCampaign' || STORE_ACTIONS.has(action.kind)) return 'CREATOR';
  if (RECIPIENT_ACTIONS.has(action.kind)) return 'PARTICIPANT';
  return requested ?? 'PARTICIPANT';
}

/** A refusal the route turns into a status, never an exception. */
export class RelayRefusal extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`[bridge-v2] relay refused: ${reason}`);
    this.name = 'RelayRefusal';
    this.reason = reason;
  }
}

/** An account as the chain shows it, and what that makes it. */
export interface AccountView {
  /** The row, with deployedAt as this read left it. */
  readonly account: Account;
  readonly state: AccountState;
  /** Configured once (D1), read through E10: marked, or found on-chain as 6.1 says. */
  readonly configured: boolean;
  /** Marked deployed by this very read (E3). */
  readonly recognized: boolean;
  /** D1: what C2 and C4 turn on. */
  readonly usable: boolean;
}

/**
 * Adenda E3 and E10. An account that exists on-chain and meets 6.1 is deployed,
 * whatever the database says — the receipt of its first transaction may never
 * have come, or its R-4 check read two owners after a second passkey — and it is
 * marked the moment it is read here. So "never configured" (D1) is the chain's
 * answer, not only deployed_at's. Every place that decides whether an account is
 * usable reads it through here.
 */
export async function readAccount(account: Account): Promise<AccountView> {
  const state = await accountState(account.safe);
  if (account.deployedAt !== null || !(await meetsComposition(account, state))) {
    const configured = account.deployedAt !== null;
    return { account, state, configured, recognized: false, usable: accountUsable(state, configured) };
  }
  await markDeployed(account.id);
  return {
    account: { ...account, deployedAt: new Date().toISOString() },
    state,
    configured: true,
    recognized: true,
    usable: accountUsable(state, true),
  };
}

/**
 * 6.1 as the chain holds it — R-4 among it — with the one guardian the chain
 * holds (Adenda F1: never the value recorded here). The reason it is not, or null.
 *
 * P1-4: and that one guardian is the platform's guardian key (6.1.4). An account
 * whose module names some other address as its guardian is not an account of
 * 6.1, however right the rest of it is: the E3 recognition does not mark it, and
 * the R-4 check after a creation alerts on it.
 */
function compositionRefusal(state: AccountState): string | null {
  if (state.guardians.length !== 1) return 'guardians';
  return configurationRefusal(state, guardianAddress(), state.owners);
}

/** compositionRefusal, with the owners A3 admits: one or two signers of the participant's own passkeys. */
async function meetsComposition(account: Account, state: AccountState): Promise<boolean> {
  if (compositionRefusal(state) !== null) return false;
  if (state.owners.length === 0 || state.owners.length > 2) return false;
  const signers = await passkeySigners(account.participantId);
  return state.owners.every((owner) => signers.has(owner.toLowerCase()));
}

export interface Prepared {
  readonly account: Account;
  readonly state: AccountState;
  readonly tx: SafeTx;
  readonly hash: Hex;
  /** A passkey whose signer must exist before the transaction runs (the one being added). */
  readonly extraSigner: Passkey | null;
  /** C11: the transaction adds the guardian back to an existing account. */
  readonly guardianChange: boolean;
  /** createCampaign: the draft the transaction creates. */
  readonly campaign: CreatorCampaign | null;
  /** redeem: the attestation's deadline, which the submit echoes (H7). */
  readonly redeemDeadline: bigint | null;
  /** C12 and T2: what the transaction does, for the page to show before the passkey. */
  readonly summary: ActionSummary;
}

/**
 * The calls an action makes, built from the chain and the database, never from
 * the request beyond the action's own identifiers.
 */
async function actionCalls(
  participantId: string,
  account: Account,
  state: AccountState,
  action: Action,
): Promise<{ calls: SafeCall[]; extraSigner: Passkey | null; summary: ActionSummary; campaign?: CreatorCampaign; redeemDeadline?: bigint }> {
  const safe = account.safe;
  if (RECIPIENT_ACTIONS.has(action.kind) || STORE_ACTIONS.has(action.kind)) {
    return { ...(await orderCalls(participantId, safe, action)), extraSigner: null };
  }
  switch (action.kind) {
    case 'enter': {
      // A4: the entry is signed once its root is published. The proof is for the
      // account's address, which is the leaf the root was built from (M30).
      const entry = await findEntry(participantId, action.giveawayId);
      if (entry === null || !entry.passkey) throw new RelayRefusal('no_entry');
      if (entry.walletAddress.toLowerCase() !== safe.toLowerCase()) throw new RelayRefusal('no_entry');
      if (entry.status !== 'ELIGIBLE' || entry.rootIndex === null) throw new RelayRefusal('not_eligible_yet');
      const proof = await proofForAddress(action.giveawayId, safe, entry.rootIndex);
      if (proof === null) throw new RelayRefusal('proof_unavailable');
      return {
        calls: [
          {
            to: GIVEAWAY_MANAGER_V2,
            data: encodeFunctionData({
              abi: GIVEAWAY_MANAGER_V2_ABI,
              functionName: 'enter',
              args: [action.giveawayId, proof.rootIndex, proof.proof],
            }),
          },
        ],
        extraSigner: null,
        summary: summaryOf('enter', [], GIVEAWAY_MANAGER_V2, 'GIVEAWAY'),
      };
    }
    case 'claim': {
      // 6.2.3 and F3: the prize stays in the contract until the winner claims it,
      // and only the winner can.
      const claimable = await claimableFor(action.giveawayId, safe);
      if (claimable <= 0n) throw new RelayRefusal('nothing_to_claim');
      // T2: the prize comes into this account — the token and its amount, or how many items.
      const prize = await readGiveaway(action.giveawayId);
      const amount: SummaryAmount =
        prize.prizeKind === PrizeKind.NFT
          ? { kind: 'ITEMS', token: prize.prizeModule, count: claimable }
          : { kind: 'ERC20', token: prize.feeToken, value: claimable };
      return {
        calls: [
          {
            to: GIVEAWAY_MANAGER_V2,
            data: encodeFunctionData({ abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'claimPrize', args: [action.giveawayId] }),
          },
        ],
        extraSigner: null,
        summary: summaryOf('claim', [amount], safe, 'THIS_ACCOUNT'),
      };
    }
    case 'transfer': {
      // 6.5 "transferências de prémio": the prize the account holds, to where its
      // owner says. The token or collection comes from the chain; the amount is
      // the owner's, exactly (C7), and never more than the account holds.
      const target = await accountBySafe(action.to);
      if (target !== null && !(await readAccount(target)).usable) {
        // C4: never into a platform account that is not deployed and configured.
        throw new RelayRefusal('destination_not_ready');
      }
      const campaign = await readGiveaway(action.giveawayId);
      if (campaign.prizeKind === PrizeKind.NFT) {
        // One prize position is one item: an ERC-721 token, or one ERC-1155 unit
        // (the module hands out nothing else), built as the delivery builds it.
        if (action.amount !== 1n) throw new RelayRefusal('amount');
        const delivery = await prizeDelivery(campaign, action.giveawayId, safe, action.to);
        if (delivery === null) throw new RelayRefusal('nothing_to_transfer');
        return {
          calls: [{ to: delivery.to, data: delivery.data }],
          extraSigner: null,
          summary: summaryOf('transfer', [{ kind: 'NFT', token: delivery.to, tokenIds: [delivery.amount] }], action.to, 'ADDRESS'),
        };
      }
      if (action.amount <= 0n) throw new RelayRefusal('amount');
      if ((await erc20BalanceOf(campaign.feeToken, safe)) < action.amount) throw new RelayRefusal('amount');
      return {
        calls: [
          {
            to: campaign.feeToken,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [action.to, action.amount] }),
          },
        ],
        extraSigner: null,
        summary: summaryOf('transfer', [{ kind: 'ERC20', token: campaign.feeToken, value: action.amount }], action.to, 'ADDRESS'),
      };
    }
    case 'transferUsdc': {
      // T12 (U17): USDC the account holds — a refund, a returned bond, a store's
      // payout — to where its owner says, exactly the amount stated (C7). Never
      // into a platform account that is not deployed and configured (C4), never
      // to the account itself, never into a platform contract (V5, B11).
      if (action.to.toLowerCase() === safe.toLowerCase()) throw new RelayRefusal('destination');
      if (await platformContract(action.to)) throw new RelayRefusal('platform_destination');
      const target = await accountBySafe(action.to);
      if (target !== null && !(await readAccount(target)).usable) throw new RelayRefusal('destination_not_ready');
      if (action.amount <= 0n || (await erc20BalanceOf(USDC, safe)) < action.amount) throw new RelayRefusal('amount');
      return {
        calls: [{ to: USDC, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [action.to, action.amount] }) }],
        extraSigner: null,
        summary: summaryOf('transferUsdc', [usdcAmount(action.amount)], action.to, 'ADDRESS'),
      };
    }
    case 'createCampaign': {
      // 6.5 "approve (dois)" and "createGiveaway", from the creator account and in
      // one transaction. The draft was priced by creator/campaign/start, exactly as
      // for a derived creator, and its numbers are the ones signed here.
      const creator = await findCreatorByParticipant(participantId);
      if (creator === null || creator.walletIndex !== null) throw new RelayRefusal('no_campaign');
      if (creator.walletAddress.toLowerCase() !== safe.toLowerCase()) throw new RelayRefusal('no_campaign');
      const campaign = await findActiveCampaign(creator.id);
      if (campaign === null) throw new RelayRefusal('no_campaign');
      // E7: a transaction already sent for this draft is the maintenance pass's
      // to settle from the chain. A second one, signed at the same nonce, would
      // leave the draft naming whichever of the two was not mined.
      if (campaign.status === 'FUNDING' && campaign.txHash !== null) throw new RelayRefusal('campaign_in_flight');
      // The contract's own split (GiveawayManagerV2.createGiveaway): the module
      // pulls the prize, the core pulls the fee in the prize token and the slots
      // in USDC. For a USDC prize that is two approvals (6.5 "approve (dois)");
      // for any other token the fee and the slots are two allowances on the core.
      const sameToken = campaign.prizeToken.toLowerCase() === (USDC as string).toLowerCase();
      const prizeHeld = await erc20BalanceOf(campaign.prizeToken, safe);
      const usdcHeld = sameToken ? prizeHeld : await erc20BalanceOf(USDC, safe);
      const prizeNeeded = campaign.prizeAmount + campaign.feeAmount + (sameToken ? campaign.slotsCost : 0n);
      const usdcNeeded = sameToken ? 0n : campaign.slotsCost;
      if (prizeHeld < prizeNeeded || usdcHeld < usdcNeeded) throw new RelayRefusal('deposit_missing');
      const approve = (token: `0x${string}`, spender: `0x${string}`, amount: bigint): SafeCall => ({
        to: token,
        data: encodeFunctionData({ abi: CREATOR_APPROVAL_ABI, functionName: 'approve', args: [spender, amount] }),
      });
      const allowances = sameToken
        ? [approve(USDC, GIVEAWAY_MANAGER_V2, campaign.feeAmount + campaign.slotsCost)]
        : [
            approve(campaign.prizeToken, GIVEAWAY_MANAGER_V2, campaign.feeAmount),
            approve(USDC, GIVEAWAY_MANAGER_V2, campaign.slotsCost),
          ];
      return {
        calls: [
          approve(campaign.prizeToken, campaign.module, campaign.prizeAmount),
          ...allowances,
          {
            to: GIVEAWAY_MANAGER_V2,
            data: encodeFunctionData({
              abi: CREATOR_CAMPAIGN_MANAGER_ABI,
              functionName: 'createGiveaway',
              args: [
                campaign.module,
                encodeTokenPrizeData(campaign.prizeToken, campaign.prizeAmount),
                campaign.prizeAmount,
                0n,
                campaign.durationSeconds,
                campaign.winnersCount,
                campaign.slotCap,
              ],
            }),
          },
        ],
        extraSigner: null,
        summary: summaryOf(
          'createCampaign',
          [{ kind: 'ERC20', token: campaign.prizeToken, value: prizeNeeded }, ...(usdcNeeded === 0n ? [] : [usdcAmount(usdcNeeded)])],
          GIVEAWAY_MANAGER_V2,
          'GIVEAWAY',
        ),
        campaign,
      };
    }
    case 'addPasskey': {
      // 6.2.4 and A3: a second passkey of the same participant, never a third.
      const added = await findPasskey(participantId, action.credentialId);
      if (added === null) throw new RelayRefusal('unknown_passkey');
      if (state.owners.some((owner) => owner.toLowerCase() === added.signer.toLowerCase())) {
        throw new RelayRefusal('already_owner');
      }
      if (state.owners.length >= 2) throw new RelayRefusal('owner_count');
      return { calls: addOwnerCalls(safe, added.signer), extraSigner: added, summary: nothingMoves('addPasskey') };
    }
    case 'cancelRecovery': {
      // 6.3.3 and R-2.
      if (state.recoveryExecuteAfter === 0n) throw new RelayRefusal('no_recovery');
      return { calls: cancelRecoveryCalls(), extraSigner: null, summary: nothingMoves('cancelRecovery') };
    }
    case 'revokeGuardian': {
      // R-3 as A6 corrects it.
      const current = state.guardians[0];
      if (current === undefined) throw new RelayRefusal('no_guardian');
      return { calls: revokeGuardianCalls(current, state.recoveryExecuteAfter > 0n), extraSigner: null, summary: nothingMoves('revokeGuardian') };
    }
    case 'configure': {
      // C2 (b), C4, A6: what the account lacks and nothing else. A missing
      // account or module is the whole configuration, which prepareAction puts
      // in front as the first transaction; a missing guardian is the current one
      // added back by the account itself (A6: "no próximo login").
      if (configurationGap(state) !== 'guardian') return { calls: [], extraSigner: null, summary: nothingMoves('configure') };
      return { calls: addGuardianCalls(guardianAddress()), extraSigner: null, summary: nothingMoves('configure') };
    }
    default:
      throw new RelayRefusal('unknown_action');
  }
}

// -----------------------------------------------------------------------------
// SPEC-BLOCO-03 piece 5 — the orders, through the relay (P1)
// -----------------------------------------------------------------------------

const approve = (token: `0x${string}`, spender: `0x${string}`, amount: bigint): SafeCall => ({
  to: token,
  data: encodeFunctionData({ abi: CREATOR_APPROVAL_ABI, functionName: 'approve', args: [spender, amount] }),
});

const escrow = (data: Hex): SafeCall => ({ to: KEPTRA_ESCROW, data });

/** The block's clock, which is the one every deadline of the escrow is compared against. */
const nowSeconds = (): Promise<bigint> => chainNow();

/** The order, if this account is the side of it that `side` names; otherwise it is nobody's business here (M36). */
async function orderOf(orderId: bigint, safe: `0x${string}`, side: 'payer' | 'store'): Promise<OrderWithTerms> {
  let found: OrderWithTerms;
  try {
    found = await readOrder(orderId);
  } catch {
    // Past the escrow's count: getOrder reverts.
    throw new RelayRefusal('no_order');
  }
  const party = side === 'payer' ? found.order.payer : found.terms.store;
  if (found.order.state === OrderState.NONE || party.toLowerCase() !== safe.toLowerCase()) throw new RelayRefusal('no_order');
  return found;
}

/** 9.2 and H18: a commitment by the own-means mode, none by carrier (KeptraEscrow._openOrder). */
function checkCommit(mode: number, commit: Hex): void {
  if (mode === OrderMode.OWN_MEANS ? commit.toLowerCase() === ZERO_HASH : commit.toLowerCase() !== ZERO_HASH) {
    throw new RelayRefusal('code_commit');
  }
}

/** Section 7's ceilings, the ones every set of conditions shares (KeptraEscrow._validateTerms), before a revert costs gas. */
function checkTerms(terms: OfferTerms, refusalFeeAllowed: boolean): void {
  const ok =
    terms.price > 0n &&
    terms.price <= MAX_UINT96 &&
    terms.shipping <= MAX_UINT96 &&
    terms.returnCost <= terms.shipping &&
    terms.refusalFeeBps >= 0 &&
    terms.refusalFeeBps <= (refusalFeeAllowed ? 1_500 : 0) &&
    terms.shipDays >= 1 &&
    terms.shipDays <= 5 &&
    terms.deliveryDays >= 1 &&
    terms.deliveryDays <= 10 &&
    (terms.mode === OrderMode.CARRIER || terms.mode === OrderMode.OWN_MEANS);
  if (!ok) throw new RelayRefusal('terms');
}

async function usdcAtLeast(safe: `0x${string}`, amount: bigint): Promise<void> {
  if ((await erc20BalanceOf(USDC, safe)) < amount) throw new RelayRefusal('deposit_missing');
}

/**
 * The calls of an order action, from the chain and the database; from the request
 * only the action's own numbers, each checked against what the escrow will check.
 */
async function orderCalls(
  participantId: string,
  safe: `0x${string}`,
  action: Action,
): Promise<{ calls: SafeCall[]; summary: ActionSummary; redeemDeadline?: bigint }> {
  // P24: no order action while the contracts are not configured.
  if (!keptraContractsConfigured()) throw new RelayRefusal('orders_not_configured');
  switch (action.kind) {
    case 'pay': {
      let terms: TermsView;
      try {
        terms = await readTerms(action.termsId);
      } catch {
        throw new RelayRefusal('no_offer');
      }
      if (!terms.active || terms.prize || terms.store.toLowerCase() === '0x0000000000000000000000000000000000000000') throw new RelayRefusal('no_offer');
      // P15: the address, in a region the store accepts, is registered before the payment.
      if ((await unboundAddress(participantId, { termsId: action.termsId })) === null) throw new RelayRefusal('no_address');
      checkCommit(terms.mode, action.codeCommit);
      if (action.quantity < 1 || action.quantity > 0xffffffff) throw new RelayRefusal('amount');
      const total = terms.price * BigInt(action.quantity) + terms.shipping;
      if (total > MAX_UINT96) throw new RelayRefusal('amount');
      await usdcAtLeast(safe, total);
      return {
        calls: [
          approve(USDC, KEPTRA_ESCROW, total),
          escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'pay', args: [action.termsId, action.quantity, action.codeCommit] })),
        ],
        summary: summaryOf('pay', [usdcAmount(total)], KEPTRA_ESCROW, 'ESCROW'),
      };
    }
    case 'redeem': {
      const [voucher] = await readVouchers([action.voucherId]);
      if (voucher.owner === null || voucher.owner.toLowerCase() !== safe.toLowerCase() || voucher.voided) throw new RelayRefusal('no_voucher');
      // 11.10: thirty days from the claim.
      if (voucher.claimedAt === 0n || (await nowSeconds()) > voucher.claimedAt + 30n * DAY_SECONDS) throw new RelayRefusal('voucher_expired');
      const terms = await readTerms((await readObligation(voucher.obligationId)).termsId);
      // H7: the attestation is for an address registered for this voucher, in a region the brand accepts.
      if ((await unboundAddress(participantId, { voucherId: action.voucherId })) === null) throw new RelayRefusal('no_address');
      checkCommit(terms.mode, action.codeCommit);
      const now = await nowSeconds();
      const deadline = action.deadline ?? now + BigInt(REDEMPTION_ATTESTATION_TTL_SECONDS);
      if (deadline <= now || deadline > now + BigInt(REDEMPTION_ATTESTATION_TTL_SECONDS)) throw new RelayRefusal('stale_attestation');
      const signature = await signRedemption(action.voucherId, safe, deadline);
      return {
        calls: [
          // The guarantee takes the voucher into custody with transferFrom (KeptraGuarantee.sol:289).
          { to: KEPTRA_VOUCHER, data: encodeFunctionData({ abi: KEPTRA_VOUCHER_ABI, functionName: 'approve', args: [KEPTRA_GUARANTEE, action.voucherId] }) },
          escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'redeemVoucher', args: [action.voucherId, action.codeCommit, deadline, signature] })),
        ],
        // The voucher goes into the guarantee's custody until the order ends.
        summary: summaryOf('redeem', [{ kind: 'NFT', token: KEPTRA_VOUCHER, tokenIds: [action.voucherId] }], KEPTRA_GUARANTEE, 'GUARANTEE'),
        redeemDeadline: deadline,
      };
    }
    case 'cancelOrder': {
      const { order, terms } = await orderOf(action.orderId, safe, 'payer');
      if (order.state !== OrderState.PAID) throw new RelayRefusal('order_state');
      // T2: what comes back — the payment in COMPRA, the voucher in PRÉMIO (H6).
      const back: SummaryAmount = terms.prize ? { kind: 'NFT', token: KEPTRA_VOUCHER, tokenIds: [order.voucherId] } : usdcAmount(order.paid);
      return {
        calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'cancel', args: [action.orderId] }))],
        summary: summaryOf('cancelOrder', [back], safe, 'THIS_ACCOUNT'),
      };
    }
    case 'confirm': {
      const { order, terms } = await orderOf(action.orderId, safe, 'payer');
      const open = order.state === OrderState.SHIPPED || (order.state === OrderState.WINDOW && (order.flags & OrderFlag.REFUSAL) === 0);
      if (!open) throw new RelayRefusal('order_state');
      // T2: confirming releases what the order holds to the store's payout; in PRÉMIO it holds nothing (the bond goes home).
      return {
        calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'confirm', args: [action.orderId] }))],
        summary: summaryOf('confirm', terms.prize ? [] : [usdcAmount(order.paid)], terms.payout, 'STORE'),
      };
    }
    case 'contest': {
      const { order } = await orderOf(action.orderId, safe, 'payer');
      if (order.state !== OrderState.WINDOW || (await nowSeconds()) > order.windowEndsAt) throw new RelayRefusal('order_state');
      return { calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'contest', args: [action.orderId] }))], summary: nothingMoves('contest') };
    }
    case 'createOffer': {
      const t = action.terms;
      checkTerms(t, true);
      // C4: a platform account is a payout only once it exists and is configured.
      const payout = await accountBySafe(t.payout);
      if (payout !== null && !(await readAccount(payout)).usable) throw new RelayRefusal('destination_not_ready');
      return {
        calls: [
          escrow(
            encodeFunctionData({
              abi: KEPTRA_ESCROW_ABI,
              functionName: 'createOffer',
              args: [t.payout, t.price, t.shipping, t.returnCost, t.refusalFeeBps, t.shipDays, t.deliveryDays, t.mode, t.regions],
            }),
          ),
        ],
        summary: nothingMoves('createOffer'),
      };
    }
    case 'deactivateOffer': {
      let terms: TermsView;
      try {
        terms = await readTerms(action.termsId);
      } catch {
        throw new RelayRefusal('no_offer');
      }
      if (terms.store.toLowerCase() !== safe.toLowerCase() || terms.prize) throw new RelayRefusal('no_offer');
      return { calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'deactivateOffer', args: [action.termsId] }))], summary: nothingMoves('deactivateOffer') };
    }
    case 'ship': {
      const { order, terms } = await orderOf(action.orderId, safe, 'store');
      if (order.state !== OrderState.PAID) throw new RelayRefusal('order_state');
      let hash = ZERO_HASH;
      if (terms.mode === OrderMode.CARRIER) {
        // H17: the hash the bridge computed when the store registered the number (store/tracking).
        const shipment = await shipmentOf(action.orderId);
        if (shipment === null) throw new RelayRefusal('no_tracking');
        hash = shipment.trackingHash;
      }
      return { calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'ship', args: [action.orderId, hash] }))], summary: nothingMoves('ship') };
    }
    case 'submitCode': {
      const { order, terms } = await orderOf(action.orderId, safe, 'store');
      if (terms.mode !== OrderMode.OWN_MEANS) throw new RelayRefusal('order_state');
      // 9.2: the code the recipient showed matches the commitment made at the payment.
      if (keccak256(encodeAbiParameters([{ type: 'bytes32' }], [action.code])).toLowerCase() !== order.codeCommit.toLowerCase()) {
        throw new RelayRefusal('code');
      }
      return { calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'submitCode', args: [action.orderId, action.code] }))], summary: nothingMoves('submitCode') };
    }
    case 'declareDelivered': {
      const { order, terms } = await orderOf(action.orderId, safe, 'store');
      if (order.state !== OrderState.SHIPPED || (await nowSeconds()) > order.shippedAt + BigInt(terms.deliveryDays) * DAY_SECONDS) {
        throw new RelayRefusal('order_state');
      }
      return { calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'declareDelivered', args: [action.orderId] }))], summary: nothingMoves('declareDelivered') };
    }
    case 'declareRefusal': {
      const { order, terms } = await orderOf(action.orderId, safe, 'store');
      if (terms.mode !== OrderMode.OWN_MEANS || order.state !== OrderState.SHIPPED) throw new RelayRefusal('order_state');
      return { calls: [escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'declareRefusal', args: [action.orderId] }))], summary: nothingMoves('declareRefusal') };
    }
    case 'refund': {
      const { order, terms } = await orderOf(action.orderId, safe, 'store');
      if (order.state === OrderState.CLOSED || action.amount <= 0n || action.amount > MAX_UINT96) throw new RelayRefusal('amount');
      const call = escrow(encodeFunctionData({ abi: KEPTRA_ESCROW_ABI, functionName: 'refund', args: [action.orderId, action.amount] }));
      const summary = summaryOf('refund', [usdcAmount(action.amount)], order.payer, 'RECIPIENT');
      if (!terms.prize) {
        if (action.amount > order.paid) throw new RelayRefusal('amount');
        return { calls: [call], summary };
      }
      // H6: in PRÉMIO the brand pays the refund from its own account, up to the unit's value.
      if (action.amount > terms.price + terms.shipping) throw new RelayRefusal('amount');
      await usdcAtLeast(safe, action.amount);
      return { calls: [approve(USDC, KEPTRA_ESCROW, action.amount), call], summary };
    }
    case 'createObligation': {
      const t = action.terms;
      checkTerms(t, false);
      if (action.units < 1 || action.units > 1_000) throw new RelayRefusal('amount');
      const brand = await brandParams(safe);
      // H24 and H32: a brand in debt, or suspended, creates nothing.
      if (brand.debt !== 0n || !brand.canCreate) throw new RelayRefusal('brand_blocked');
      // H11 and I8: the bond rounds up, the coverage is the rest, the fee is on the coverage.
      const unitValue = t.price + t.shipping;
      const bond = (unitValue * BigInt(brand.bondBps) + BPS - 1n) / BPS;
      const units = BigInt(action.units);
      const fee = ((unitValue - bond) * units * BigInt(brand.protectionBps)) / BPS;
      const total = bond * units + fee;
      await usdcAtLeast(safe, total);
      return {
        calls: [
          approve(USDC, KEPTRA_GUARANTEE, total),
          {
            to: KEPTRA_GUARANTEE,
            data: encodeFunctionData({
              abi: KEPTRA_GUARANTEE_ABI,
              functionName: 'createObligation',
              args: [t.price, t.shipping, t.returnCost, t.shipDays, t.deliveryDays, t.mode, t.regions, action.units],
            }),
          },
        ],
        // T2: the bond and the fee together, as computed above — the page repeats none of it.
        summary: summaryOf('createObligation', [usdcAmount(total)], KEPTRA_GUARANTEE, 'GUARANTEE'),
      };
    }
    case 'createVoucherCampaign': {
      // The same barrier every creator path has (07/09/2026 decision): a verified number.
      if (!(await hasVerifiedPhone(participantId))) throw new RelayRefusal('phone_required');
      const count = action.voucherIds.length;
      if (count < 1 || count > VOUCHER_CAMPAIGN_MAX_ITEMS || new Set(action.voucherIds.map(String)).size !== count) throw new RelayRefusal('amount');
      if (action.durationSeconds < CONTRACT_MIN_DURATION_SECONDS || action.durationSeconds > CONTRACT_MAX_DURATION_SECONDS) throw new RelayRefusal('terms');
      if (action.slotCap < CONTRACT_MIN_PARTICIPANTS || action.slotCap > CONTRACT_MAX_PARTICIPANTS) throw new RelayRefusal('terms');
      const obligation = await readObligation(action.obligationId);
      if (obligation.brand.toLowerCase() !== safe.toLowerCase()) throw new RelayRefusal('no_obligation');
      for (const voucher of await readVouchers(action.voucherIds)) {
        // H9: a voucher not yet in any campaign and never claimed, of this obligation, in this account.
        const loose =
          voucher.owner !== null && voucher.owner.toLowerCase() === safe.toLowerCase() && !voucher.voided && voucher.claimedAt === 0n && voucher.obligationId === action.obligationId;
        if (!loose) throw new RelayRefusal('no_voucher');
      }
      // 11.3 and H10: the campaign's declared value is the prize it deposits — every unit at the obligation's value.
      const declaredValue = (await readTerms(obligation.termsId)).price * BigInt(count);
      const fee = await currentCreationFee(PrizeKind.NFT, declaredValue);
      const cost = fee + (await slotPrice()) * BigInt(action.slotCap);
      await usdcAtLeast(safe, cost);
      const operator = (approved: boolean): SafeCall => ({
        to: KEPTRA_VOUCHER,
        data: encodeFunctionData({ abi: KEPTRA_VOUCHER_ABI, functionName: 'setApprovalForAll', args: [ERC721_PRIZE_MODULE, approved] }),
      });
      return {
        calls: [
          // The module pulls each voucher with safeTransferFrom (ERC721PrizeModule takeCustody); the
          // approval exists only inside this transaction.
          operator(true),
          approve(USDC, GIVEAWAY_MANAGER_V2, cost),
          {
            to: GIVEAWAY_MANAGER_V2,
            data: encodeFunctionData({
              abi: CREATOR_CAMPAIGN_MANAGER_ABI,
              functionName: 'createGiveaway',
              args: [
                ERC721_PRIZE_MODULE,
                encodeAbiParameters([{ type: 'address' }, { type: 'uint256[]' }], [KEPTRA_VOUCHER, [...action.voucherIds]]),
                BigInt(count),
                declaredValue,
                BigInt(action.durationSeconds),
                count,
                action.slotCap,
              ],
            }),
          },
          operator(false),
        ],
        summary: summaryOf(
          'createVoucherCampaign',
          [usdcAmount(cost), { kind: 'NFT', token: KEPTRA_VOUCHER, tokenIds: [...action.voucherIds] }],
          GIVEAWAY_MANAGER_V2,
          'GIVEAWAY',
        ),
      };
    }
    default:
      throw new RelayRefusal('unknown_action');
  }
}

/** What address a recipient action binds to the order it opens (P15, H7). */
function purposeOf(action: Action): AddressPurpose | null {
  if (action.kind === 'pay') return { termsId: action.termsId };
  if (action.kind === 'redeem') return { voucherId: action.voucherId };
  return null;
}

/**
 * The guardian a transaction may name. Adding one back (A6) names the platform's
 * current key; anything else names the account's own guardian as the chain holds
 * it — R-3 revokes that one — and never the value recorded in the database, which
 * a rotation (B6) or a lost receipt can leave different (Adenda F1). Null when
 * the account holds none: then no guardian may be named.
 */
function guardianFor(state: AccountState, action: Action): `0x${string}` | null {
  return action.kind === 'configure' ? guardianAddress() : (state.guardians[0] ?? null);
}

/**
 * Builds the account's next transaction for one action and the hash its passkey
 * must sign. Throws RelayRefusal for anything the closed list does not admit.
 */
export async function prepareAction(
  participantId: string,
  action: Action,
  requestedRole: AccountRole | null,
): Promise<Prepared> {
  const found = await findAccount(participantId, roleFor(action, requestedRole));
  if (found === null) throw new RelayRefusal('no_account');

  // E3 and E10: read, and marked deployed if the chain holds it configured.
  const { account, state, usable } = await readAccount(found);
  const gap = configurationGap(state);
  if (action.kind === 'configure') {
    if (gap === null) throw new RelayRefusal('already_configured');
  } else if (state.deployed && !usable) {
    // C2 (b) and D1: an account on-chain without its module, or never
    // configured, is completed with its passkey before anything else.
    throw new RelayRefusal('configuration_incomplete');
  } else if (gap === 'account' && ['cancelRecovery', 'revokeGuardian', 'addPasskey'].includes(action.kind)) {
    throw new RelayRefusal('not_deployed');
  }

  // 6.1.4 and B4: an account's first transaction — a new account's, or one
  // somebody else deployed bare — starts with its configuration, at nonce 0,
  // adding the guardian the account was registered with. An account with no
  // module on-chain holds no guardian, so the recorded one is still the one to
  // add (F1 reconciles it only once the module is on; B6 rotates it before).
  const registered = account.guardian ?? guardianAddress();
  const configuration = gap === 'account' || gap === 'module' ? configurationCalls(account.safe, registered) : null;
  // D1: during a guardian compromise configure waits for the rotation, and no
  // transaction adds a key the incident listed — the one configured now, or the
  // one an account was registered with.
  const named = new Set<`0x${string}`>();
  if (action.kind === 'configure') named.add(guardianAddress());
  if (configuration !== null) named.add(registered);
  for (const guardian of named) {
    if (await guardianCompromised(guardian)) throw new RelayRefusal('guardian_incident');
  }

  // C11: the relayer pays for a bounded number of guardians added back per
  // account. A revocation is not one of them (E2: always possible).
  const guardianChange = action.kind === 'configure' && gap === 'guardian';
  if (guardianChange && (await guardianChangesSince(account.id, new Date(Date.now() - DAY_MS))) >= GUARDIAN_CHANGES_PER_DAY) {
    throw new RelayRefusal('guardian_change_limit');
  }
  // E2: and a bounded number of transactions per account in 24 hours.
  if (!ALWAYS_POSSIBLE.has(action.kind) && (await relayedSince(account.id, new Date(Date.now() - DAY_MS))) >= RELAYED_TRANSACTIONS_PER_DAY) {
    throw new RelayRefusal('relay_limit');
  }

  const { calls, extraSigner, summary, campaign = null, redeemDeadline = null } = await actionCalls(participantId, account, state, action);
  // F10: the closed list reads the calls before they are encoded, not a decoding of them.
  const all = [...(configuration ?? []), ...calls];
  const refusal = refusalFor(account.safe, all, state.nonce, configuration, guardianFor(state, action));
  if (refusal !== null) throw new RelayRefusal(refusal);
  const tx = safeTxFor(all, state.nonce);

  return { account, state, tx, hash: safeTxHash(account.safe, tx), extraSigner, guardianChange, campaign, redeemDeadline, summary };
}

/** A browser assertion over the prepared hash, as the route received it. */
export interface Assertion {
  readonly credentialId: string;
  readonly authenticatorData: Hex;
  readonly clientDataJSON: string;
  readonly signature: Hex;
}

export interface Submitted {
  readonly txHash: Hex;
  readonly receipt: MinedReceipt | null;
  readonly giveawayId: bigint | null;
  /** pay and redeem: the order the escrow opened, from the receipt. */
  readonly orderId: bigint | null;
  /** T5: what createOffer or createObligation created, from the receipt — the terms, and the obligation and its vouchers. */
  readonly created: { readonly termsId: bigint | null; readonly obligationId: bigint | null; readonly voucherIds: readonly bigint[] } | null;
}

/**
 * Sends one relayed batch from a funder lease and waits for it, bounded. The
 * nonce accounting and the release are the processor's (G6).
 *
 * `spend: false` is for the two transactions Adenda E2 says the shared spend
 * ceiling cannot stop. `onBroadcast` runs with the hash before the wait, as K3
 * has the pipeline record it, so a receipt that never comes still leaves the
 * transaction findable.
 */
export async function sendAsRelayer(
  calls: readonly SafeCall[],
  log: Logger,
  options: { readonly spend?: boolean; readonly onBroadcast?: (hash: Hex) => Promise<unknown> } = {},
): Promise<{ hash: Hex; receipt: MinedReceipt | null } | null> {
  if ((options.spend ?? true) && !(await claimSpend('chain', 1, log))) return null;
  const lease = await acquireFunder();
  if (lease === null) {
    await log.event('funder.exhausted');
    await alert(log, 'no funder available for a relayed account transaction');
    return null;
  }
  let nextNonce = lease.nextNonce;
  try {
    const hash = await sendRelayed(lease, relayerCall(calls), signAsFunder, (spent) => {
      nextNonce = spent;
    });
    await options.onBroadcast?.(hash);
    return { hash, receipt: await waitForReceipt(hash) };
  } finally {
    if (!(await releaseFunder(lease, nextNonce))) {
      await disableFunder(lease.index);
      await log.event('funder.disabled', { funder_index: lease.index });
      await alert(log, 'funder lease could not be released', { funder_index: lease.index });
    }
  }
}

/**
 * Rebuilds the transaction, checks the passkey signed exactly its hash, and
 * relays it. `nonce` is the nonce the passkey signed for: a transaction that
 * landed in between moved the account on, and the signature is then for a
 * transaction that no longer exists (stale_nonce).
 *
 * Adenda F7: `deadline` is the route's own budget, running since the request
 * arrived (account/relay). Nothing is recorded or sent unless the part that
 * cannot be taken back — RELAY_SEND_MS — still fits in it; otherwise the request
 * is refused as if the relayer were busy, and a retry starts afresh.
 */
export async function submitAction(
  participantId: string,
  action: Action,
  requestedRole: AccountRole | null,
  nonce: bigint,
  assertion: Assertion,
  log: Logger,
  deadline: RunDeadline = runDeadline(),
): Promise<Submitted> {
  const prepared = await prepareAction(participantId, action, requestedRole);
  const { account, state, tx, hash } = prepared;
  if (tx.nonce !== nonce) throw new RelayRefusal('stale_nonce');

  // The passkey is looked up among the session's own; another participant's is
  // never found (M36).
  const passkey = await findPasskey(participantId, assertion.credentialId);
  if (passkey === null) throw new RelayRefusal('unknown_passkey');

  // M10: the assertion must be over this hash, and the signer contract must
  // accept it. Both before a funder is touched.
  const signature = assertionToSignature(hash, assertion.authenticatorData, assertion.clientDataJSON, assertion.signature);
  if (signature === null || !(await isValidPasskeySignature(hash, signature, passkey.x, passkey.y))) {
    throw new RelayRefusal('bad_signature');
  }

  const isOwner = state.deployed
    ? state.owners.some((owner) => owner.toLowerCase() === passkey.signer.toLowerCase())
    : passkey.signer.toLowerCase() === account.initialSigner.toLowerCase();
  if (!isOwner) throw new RelayRefusal('not_owner');

  const batch: SafeCall[] = [];
  if (!(await hasCode(passkey.signer))) batch.push(createSignerCall(passkey.x, passkey.y));
  if (prepared.extraSigner !== null && !(await hasCode(prepared.extraSigner.signer))) {
    batch.push(createSignerCall(prepared.extraSigner.x, prepared.extraSigner.y));
  }
  if (!state.deployed) batch.push(createAccountCall(account.initialSigner, account.role));
  batch.push({ to: account.safe, data: execTransactionData(tx, encodeSafeSignature(passkey.signer, signature)) });

  // F7: from here on nothing can be taken back; it starts only if it can finish.
  if (!deadline.hasTimeFor(RELAY_SEND_MS)) throw new RelayRefusal('relayer_unavailable');

  // E2: counted before it is sent, so one that then fails still counts. Every
  // submission passed prepareAction's count on its own; counted again once this
  // one is written, a burst sent at once cannot go past the limit either.
  const alwaysPossible = ALWAYS_POSSIBLE.has(action.kind);
  if (!alwaysPossible) {
    await recordRelayed(account.id);
    if ((await relayedSince(account.id, new Date(Date.now() - DAY_MS))) > RELAYED_TRANSACTIONS_PER_DAY) {
      throw new RelayRefusal('relay_limit');
    }
  }
  // C11: counted before it is sent, so a change that then fails still counts.
  if (prepared.guardianChange) await recordGuardianChange(account.id);

  const { campaign } = prepared;
  // P1-6: signed for only while it is still the draft prepare read, with nothing
  // sent for it: one that expired or was settled in between is never submitted.
  if (campaign !== null && !(await startSubmission(campaign.id, campaign.status === 'FUNDING' ? 'FUNDING' : 'PENDING_DEPOSIT'))) {
    throw new RelayRefusal('no_campaign');
  }

  const sent = await sendAsRelayer(batch, log, {
    spend: !alwaysPossible,
    // E7: the hash is on the draft before the wait (K3), so the maintenance pass
    // can settle it from the chain if the receipt never comes.
    onBroadcast: campaign === null ? undefined : (txHash) => advanceCampaign(campaign.id, 'FUNDING', 'FUNDING', { tx_hash: txHash }),
  });
  if (sent === null) throw new RelayRefusal('relayer_unavailable');
  if (sent.receipt === null || sent.receipt.status !== 'success') {
    return { txHash: sent.hash, receipt: sent.receipt, giveawayId: null, orderId: null, created: null };
  }

  if (account.deployedAt === null) {
    // R-4, on every account the moment it is ours to use — created here, or
    // deployed bare by somebody else and completed here (C2): the configuration
    // read back from the chain, not the one that was asked for (readAccount).
    const view = await readAccount(account);
    if (!view.configured) {
      await alert(log, 'account configuration check failed after creation', {
        reason: compositionRefusal(view.state) ?? 'owners',
      });
    }
  }

  let giveawayId: bigint | null = null;
  if (campaign !== null) {
    giveawayId = giveawayIdFromLogs(sent.receipt.logs);
    if (giveawayId !== null) {
      await advanceCampaign(campaign.id, 'FUNDING', 'CONFIRMED', { giveaway_id: giveawayId.toString(), tx_hash: sent.hash });
      await log.event('creator_campaign.confirmed', { giveaway_id: giveawayId.toString() });
    }
  }
  if (action.kind === 'configure' && configurationGap(state) === 'guardian') {
    await recordGuardian(account.id, guardianAddress());
  }
  if (action.kind === 'createVoucherCampaign') giveawayId = giveawayIdFromLogs(sent.receipt.logs);

  // Q14: the order a pay or a redemption opened takes its address now; the orders
  // pass does it from the chain when this receipt never came (bindRecipientAddress).
  let orderId: bigint | null = null;
  const purpose = purposeOf(action);
  if (purpose !== null) {
    orderId = orderIdFromLogs(sent.receipt.logs);
    try {
      const draft = orderId === null || (await orderHasAddress(orderId)) ? null : await unboundAddress(participantId, purpose);
      if (orderId !== null && draft !== null && (await bindAddress(draft.id, orderId))) {
        await log.event('order.address_bound', { order_id: orderId.toString(), reconciled: false });
      }
    } catch (error) {
      // The payment stands; the pass binds it on its next run.
      await log.failure('orders.failed', error, { stage: 'bind' });
    }
  }

  // T5: the id the store or the brand shares, read from the receipt as the order's is.
  let created: Submitted['created'] = null;
  if (action.kind === 'createOffer') {
    created = { termsId: offerIdFromLogs(sent.receipt.logs), obligationId: null, voucherIds: [] };
  } else if (action.kind === 'createObligation') {
    const obligation = obligationFromLogs(sent.receipt.logs);
    created = { termsId: obligation?.termsId ?? null, obligationId: obligation?.obligationId ?? null, voucherIds: voucherIdsFromLogs(sent.receipt.logs) };
  }

  await log.event('account.relayed', { action: action.kind, deployed: state.deployed });
  return { txHash: sent.hash, receipt: sent.receipt, giveawayId, orderId, created };
}

// -----------------------------------------------------------------------------
// the maintenance pass
// -----------------------------------------------------------------------------

/**
 * Adenda E3: the maintenance pass recognises every account the relay sent for
 * that the chain holds configured and nobody marked — a first receipt lost —
 * whether or not its owner comes back to use it.
 */
export async function recognizeDeployedAccounts(log: Logger, deadline: RunDeadline): Promise<number> {
  let recognized = 0;
  let afterId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    // F7: not even the next page is read without one account's time left.
    if (!deadline.hasTimeFor(ACCOUNT_RECOGNITION_MS)) return recognized;
    const page = await accountsAwaitingRecognition(afterId, 50);
    if (page.length === 0) return recognized;
    for (const account of page) {
      if (!deadline.hasTimeFor(ACCOUNT_RECOGNITION_MS)) return recognized;
      try {
        if ((await readAccount(account)).recognized) {
          recognized += 1;
          await log.event('account.recognized', { role: account.role });
        }
      } catch (error) {
        await log.failure('account.refused', error);
      }
    }
    afterId = page[page.length - 1].id;
  }
}

/**
 * Adenda F1: the recorded guardian of every account whose module is on follows
 * the chain — its one guardian, or none once its user revoked it (R-3). An
 * account with no module on-chain holds no guardian and keeps the registered one,
 * which is what its configuration will add (B6 rotates it). Nothing decides on
 * the recorded value any more (guardianFor, compositionRefusal); this keeps it
 * from saying otherwise.
 */
export async function reconcileGuardians(log: Logger, deadline: RunDeadline): Promise<number> {
  let reconciled = 0;
  let afterId = '00000000-0000-0000-0000-000000000000';
  // ponytail: one state read per account per pass (B7 accepts it, as for C10).
  for (;;) {
    if (!deadline.hasTimeFor(GUARDIAN_SCAN_MS)) return reconciled;
    const page = await accountsPage(afterId, 50);
    if (page.length === 0) return reconciled;
    const states = await Promise.all(page.map((account) => accountState(account.safe)));
    for (const [i, account] of page.entries()) {
      const gap = configurationGap(states[i]);
      if (gap === 'account' || gap === 'module') continue;
      const onChain = states[i].guardians[0] ?? null;
      if ((onChain?.toLowerCase() ?? null) === (account.guardian?.toLowerCase() ?? null)) continue;
      if (!deadline.hasTimeFor(GUARDIAN_RECORD_MS)) return reconciled;
      await recordGuardian(account.id, onChain);
      reconciled += 1;
      await log.event('account.guardian_reconciled', { role: account.role, guardian: onChain === null ? 'none' : 'on_chain' });
    }
    afterId = page[page.length - 1].id;
  }
}

/**
 * Adenda E7: a campaign the relay sent whose receipt never came is settled from
 * the chain at the next maintenance pass. Mined, it is registered — CONFIRMED,
 * with the id its event carries. Not mined — reverted, or unknown to the node —
 * it is released: back to PENDING_DEPOSIT, where the deposit still in the
 * creator account can be signed for again. Still pending, it waits.
 *
 * Adenda F5: a draft in FUNDING with no transaction recorded — its request died
 * between the move to FUNDING and the hash — is released only once the chain
 * shows the creator account created no campaign since the draft. Time alone
 * releases nothing: it only says the request that could have sent it is over.
 * A campaign the account did create since then, with the draft's terms, is the
 * draft's (E7: registered); one with other terms is alerted and the draft waits.
 *
 * D-FUNDING: module 2's derived submit (creator/campaign/submit) is settled the
 * same way, from its derived wallet: it writes the createGiveaway's hash on the
 * draft the moment it is broadcast, as the relay does. A derived draft is read
 * and settled under the creator's lock — the one the submit and the migration
 * take — so a submit still running is never settled under it, and one the lock
 * finds busy is left for the next pass.
 */
export async function reconcileRelayedCampaigns(log: Logger, deadline: RunDeadline): Promise<number> {
  let settled = 0;
  for (const campaign of await fundingCampaigns()) {
    if (!deadline.hasTimeFor(CAMPAIGN_RECONCILE_MS)) break;
    try {
      const creator = await findCreatorById(campaign.creatorId);
      if (creator === null) continue;
      if (creator.walletIndex === null) {
        if (await settleCampaign(campaign, creator.walletAddress, log)) settled += 1;
        continue;
      }
      const lock = await acquireRunLock(creatorCampaignLock(creator.id));
      if (lock === null) continue;
      try {
        // Read again under the lock: a submit that held it may have moved the draft on.
        const current = await findActiveCampaign(creator.id);
        if (current === null || current.id !== campaign.id || current.status !== 'FUNDING') continue;
        if (await settleCampaign(current, creator.walletAddress, log)) settled += 1;
      } finally {
        await releaseRunLock(lock);
      }
    } catch (error) {
      await log.failure('creator_campaign.failed', error);
    }
  }
  return settled;
}

/**
 * F5: how far before the draft's creation the chain is searched, for a server
 * clock and a block clock that disagree by a little. A campaign of the account
 * inside this margin that another draft already registered is not counted.
 */
const CLOCK_MARGIN_MS = 5 * 60 * 1000;

async function settleCampaign(campaign: CreatorCampaign, account: `0x${string}`, log: Logger): Promise<boolean> {
  const release = async (reason: string): Promise<boolean> => {
    if (!(await advanceCampaign(campaign.id, 'FUNDING', 'PENDING_DEPOSIT', { tx_hash: null }))) return false;
    await log.event('creator_campaign.released', { reason });
    return true;
  };
  if (campaign.txHash === null) {
    if (Date.parse(campaign.updatedAt) + RELAYED_CAMPAIGN_STALE_MS > Date.now()) return false;
    const since = BigInt(Math.floor((Date.parse(campaign.createdAt) - CLOCK_MARGIN_MS) / 1000));
    const created = await campaignsCreatedBy(account, since);
    // The chain could not be read back far enough: nothing is shown, nothing is released.
    if (created === null) {
      await alert(log, 'relay campaign in FUNDING with no hash, older than the campaigns the pass reads back');
      return false;
    }
    const taken = await registeredGiveawayIds(campaign.creatorId);
    const candidates = created.filter((found) => !taken.has(found.giveawayId));
    if (candidates.length === 0) return release('never_sent');
    const mine = candidates.find(
      (found) =>
        found.prizeModule.toLowerCase() === campaign.module.toLowerCase() &&
        found.prizeAmount === campaign.prizeAmount &&
        found.winnersCount === campaign.winnersCount &&
        found.slotCap === campaign.slotCap &&
        found.durationSeconds === campaign.durationSeconds,
    );
    if (mine === undefined) {
      await alert(log, 'relay campaign in FUNDING with no hash, and a campaign of its creator on-chain with other terms');
      return false;
    }
    if (!(await advanceCampaign(campaign.id, 'FUNDING', 'CONFIRMED', { giveaway_id: mine.giveawayId.toString() }))) return false;
    await log.event('creator_campaign.confirmed', { giveaway_id: mine.giveawayId.toString(), reconciled: true });
    return true;
  }
  const hash = campaign.txHash as Hex;
  const receipt = await waitForReceipt(hash);
  if (receipt?.status === 'success') {
    const giveawayId = giveawayIdFromLogs(receipt.logs);
    if (giveawayId === null) {
      await alert(log, 'relayed createGiveaway mined with no GiveawayCreated event');
      return false;
    }
    if (!(await advanceCampaign(campaign.id, 'FUNDING', 'CONFIRMED', { giveaway_id: giveawayId.toString(), tx_hash: hash }))) {
      return false;
    }
    await log.event('creator_campaign.confirmed', { giveaway_id: giveawayId.toString(), reconciled: true });
    return true;
  }
  if (receipt?.status === 'reverted') return release('reverted');
  // I8: not mined and unknown to the node is dropped; known is still pending.
  return (await transactionKnown(hash)) ? false : release('dropped');
}
