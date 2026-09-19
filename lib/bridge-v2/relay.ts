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
 */

import { encodeFunctionData, type Hex } from 'viem';
import { alert } from './alert.js';
import { claimSpend } from './spend.js';
import type { Logger } from './log.js';
import type { RunDeadline } from './runlock.js';
import { CREATOR_APPROVAL_ABI, CREATOR_CAMPAIGN_MANAGER_ABI, ERC20_ABI, GIVEAWAY_MANAGER_V2_ABI, PrizeKind } from './abi.js';
import {
  ACCOUNT_RECOGNITION_MS,
  CAMPAIGN_RECONCILE_MS,
  GIVEAWAY_MANAGER_V2,
  GUARDIAN_CHANGES_PER_DAY,
  RELAYED_CAMPAIGN_STALE_MS,
  RELAYED_TRANSACTIONS_PER_DAY,
  USDC,
} from './config.js';
import {
  claimableFor,
  erc20BalanceOf,
  encodeTokenPrizeData,
  giveawayIdFromLogs,
  prizeDelivery,
  readGiveaway,
  transactionKnown,
  waitForReceipt,
  type MinedReceipt,
} from './chain.js';
import {
  accountState,
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
import { advanceCampaign, findActiveCampaign, fundingCampaigns, type CreatorCampaign } from './creatorCampaigns.js';
import { acquireFunder, disableFunder, releaseFunder, signAsFunder } from './funders.js';
import { guardianAddress } from './guardian.js';

/** Everything an account can be asked to do through the relay. A closed union. */
export type Action =
  | { readonly kind: 'enter'; readonly giveawayId: bigint }
  | { readonly kind: 'claim'; readonly giveawayId: bigint }
  /** C7: `amount` is what the owner asked to send, in the prize's own unit — never "the whole balance". */
  | { readonly kind: 'transfer'; readonly giveawayId: bigint; readonly to: `0x${string}`; readonly amount: bigint }
  | { readonly kind: 'createCampaign' }
  | { readonly kind: 'addPasskey'; readonly credentialId: string }
  | { readonly kind: 'cancelRecovery' }
  | { readonly kind: 'revokeGuardian' }
  /** C2, C4, A6: complete what the account lacks — create it, enable the module, add the guardian. */
  | { readonly kind: 'configure' };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adenda E2: the cancellation of a recovery (6.3.3, R-2) and the reaction to a
 * compromise (R-3, A6). Always possible: never counted against the relay's limit,
 * never refused by it, and sent whatever the shared spend ceiling says.
 */
const ALWAYS_POSSIBLE: ReadonlySet<Action['kind']> = new Set(['cancelRecovery', 'revokeGuardian']);

/** Which of the participant's two accounts an action runs on (A10). */
export function roleFor(action: Action, requested: AccountRole | null): AccountRole {
  if (action.kind === 'enter' || action.kind === 'claim' || action.kind === 'transfer') return 'PARTICIPANT';
  if (action.kind === 'createCampaign') return 'CREATOR';
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
 * 6.1 as the chain holds it — R-4 among it — with the owners A3 admits: one or
 * two signers of the participant's own passkeys, threshold 1.
 */
async function meetsComposition(account: Account, state: AccountState): Promise<boolean> {
  if (configurationRefusal(state, account.guardian, state.owners) !== null) return false;
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
): Promise<{ calls: SafeCall[]; extraSigner: Passkey | null; campaign?: CreatorCampaign }> {
  const safe = account.safe;
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
      };
    }
    case 'claim': {
      // 6.2.3 and F3: the prize stays in the contract until the winner claims it,
      // and only the winner can.
      if ((await claimableFor(action.giveawayId, safe)) <= 0n) throw new RelayRefusal('nothing_to_claim');
      return {
        calls: [
          {
            to: GIVEAWAY_MANAGER_V2,
            data: encodeFunctionData({ abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'claimPrize', args: [action.giveawayId] }),
          },
        ],
        extraSigner: null,
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
        return { calls: [{ to: delivery.to, data: delivery.data }], extraSigner: null };
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
      return { calls: addOwnerCalls(safe, added.signer), extraSigner: added };
    }
    case 'cancelRecovery': {
      // 6.3.3 and R-2.
      if (state.recoveryExecuteAfter === 0n) throw new RelayRefusal('no_recovery');
      return { calls: cancelRecoveryCalls(), extraSigner: null };
    }
    case 'revokeGuardian': {
      // R-3 as A6 corrects it.
      const current = state.guardians[0];
      if (current === undefined) throw new RelayRefusal('no_guardian');
      return { calls: revokeGuardianCalls(current, state.recoveryExecuteAfter > 0n), extraSigner: null };
    }
    case 'configure': {
      // C2 (b), C4, A6: what the account lacks and nothing else. A missing
      // account or module is the whole configuration, which prepareAction puts
      // in front as the first transaction; a missing guardian is the current one
      // added back by the account itself (A6: "no próximo login").
      if (configurationGap(state) !== 'guardian') return { calls: [], extraSigner: null };
      return { calls: addGuardianCalls(guardianAddress()), extraSigner: null };
    }
  }
}

/** The guardian a transaction may name: the account's own, or the configured one when one is added back. */
function guardianFor(account: Account, action: Action): `0x${string}` {
  return action.kind === 'configure' ? guardianAddress() : account.guardian;
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
  // somebody else deployed bare — starts with its configuration, at nonce 0.
  const configuration = gap === 'account' || gap === 'module' ? configurationCalls(account.safe, account.guardian) : null;
  // D1: during a guardian compromise configure waits for the rotation, and no
  // transaction adds a key the incident listed — the one configured now, or the
  // one an account was registered with.
  const named = new Set<`0x${string}`>();
  if (action.kind === 'configure') named.add(guardianAddress());
  if (configuration !== null) named.add(account.guardian);
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

  const { calls, extraSigner, campaign = null } = await actionCalls(participantId, account, state, action);
  const tx = safeTxFor([...(configuration ?? []), ...calls], state.nonce);

  const refusal = refusalFor(account.safe, tx, configuration, guardianFor(account, action));
  if (refusal !== null) throw new RelayRefusal(refusal);

  return { account, state, tx, hash: safeTxHash(account.safe, tx), extraSigner, guardianChange, campaign };
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
 */
export async function submitAction(
  participantId: string,
  action: Action,
  requestedRole: AccountRole | null,
  nonce: bigint,
  assertion: Assertion,
  log: Logger,
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
  if (campaign !== null && campaign.status === 'PENDING_DEPOSIT') {
    await advanceCampaign(campaign.id, 'PENDING_DEPOSIT', 'FUNDING');
  }

  const sent = await sendAsRelayer(batch, log, {
    spend: !alwaysPossible,
    // E7: the hash is on the draft before the wait (K3), so the maintenance pass
    // can settle it from the chain if the receipt never comes.
    onBroadcast: campaign === null ? undefined : (txHash) => advanceCampaign(campaign.id, 'FUNDING', 'FUNDING', { tx_hash: txHash }),
  });
  if (sent === null) throw new RelayRefusal('relayer_unavailable');
  if (sent.receipt === null || sent.receipt.status !== 'success') {
    return { txHash: sent.hash, receipt: sent.receipt, giveawayId: null };
  }

  if (account.deployedAt === null) {
    // R-4, on every account the moment it is ours to use — created here, or
    // deployed bare by somebody else and completed here (C2): the configuration
    // read back from the chain, not the one that was asked for (readAccount).
    const view = await readAccount(account);
    if (!view.configured) {
      await alert(log, 'account configuration check failed after creation', {
        reason: configurationRefusal(view.state, account.guardian, view.state.owners) ?? 'owners',
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

  await log.event('account.relayed', { action: action.kind, deployed: state.deployed });
  return { txHash: sent.hash, receipt: sent.receipt, giveawayId };
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
 * Adenda E7: a campaign the relay sent whose receipt never came is settled from
 * the chain at the next maintenance pass. Mined, it is registered — CONFIRMED,
 * with the id its event carries. Not mined — reverted, unknown to the node, or
 * never sent by a request that no longer runs — it is released: back to
 * PENDING_DEPOSIT, where the deposit still in the creator account can be signed
 * for again. Still pending, it waits.
 *
 * Only the relay's campaigns: those of a creator whose deposit address is the
 * creator account (E1 counts a sealed one). The same pattern in module 2's
 * derived submit is D-FUNDING, left to a session of its own.
 */
export async function reconcileRelayedCampaigns(log: Logger, deadline: RunDeadline): Promise<number> {
  let settled = 0;
  for (const campaign of await fundingCampaigns()) {
    if (!deadline.hasTimeFor(CAMPAIGN_RECONCILE_MS)) break;
    try {
      const creator = await findCreatorById(campaign.creatorId);
      if (creator === null || creator.walletIndex !== null) continue;
      if (await settleCampaign(campaign, log)) settled += 1;
    } catch (error) {
      await log.failure('creator_campaign.failed', error);
    }
  }
  return settled;
}

async function settleCampaign(campaign: CreatorCampaign, log: Logger): Promise<boolean> {
  const release = async (reason: string): Promise<boolean> => {
    if (!(await advanceCampaign(campaign.id, 'FUNDING', 'PENDING_DEPOSIT', { tx_hash: null }))) return false;
    await log.event('creator_campaign.released', { reason });
    return true;
  };
  if (campaign.txHash === null) {
    return Date.parse(campaign.updatedAt) + RELAYED_CAMPAIGN_STALE_MS <= Date.now() ? release('never_sent') : false;
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
