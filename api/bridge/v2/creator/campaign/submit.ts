import { handle, methodGuard, ok, refuse } from '../../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../../lib/bridge-v2/session.js';
import { findCreatorByParticipant } from '../../../../../lib/bridge-v2/creators.js';
import { advanceCampaign, creatorCampaignLock, findActiveCampaign, startSubmission } from '../../../../../lib/bridge-v2/creatorCampaigns.js';
import { acquireRunLock, releaseRunLock, runDeadline } from '../../../../../lib/bridge-v2/runlock.js';
import { acquireFunder, releaseFunder, renewLease, signAsFunder } from '../../../../../lib/bridge-v2/funders.js';
import { signAsDerived } from '../../../../../lib/bridge-v2/wallet.js';
import { claimSpend } from '../../../../../lib/bridge-v2/spend.js';
import { alert } from '../../../../../lib/bridge-v2/alert.js';
import { CREATOR_SUBMIT_UNIT_MS, GIVEAWAY_MANAGER_V2, USDC } from '../../../../../lib/bridge-v2/config.js';
import {
  ChainError,
  erc20BalanceOf,
  fundDerivedWallet,
  giveawayIdFromLogs,
  quoteApprove,
  quoteCreateGiveaway,
  submitAsDerived,
  waitForReceipt,
  encodeTokenPrizeData,
  type GasPlan,
} from '../../../../../lib/bridge-v2/chain.js';
import type { Hex, Log } from 'viem';
import type { FunderLease } from '../../../../../lib/bridge-v2/funders.js';

/**
 * POST /api/bridge/v2/creator/campaign/submit
 *
 * 07/09/2026 owner decision, path 3 of 4, second half: once the creator has
 * sent the prize (plus its fee) and the slot cost to the deposit address
 * creator/campaign/start.ts handed them, this signs the on-chain steps as the
 * creator's derived wallet, and funds the gas for each from the pool: approve
 * the module, approve the core — one allowance for a USDC prize, one per token
 * otherwise, because the fee is paid in the prize token (B5, D-B5) — and
 * createGiveaway.
 *
 * G3/G6: one campaign is signed for at a time. acquireRunLock, scoped to the
 * creator rather than the campaign, is the same mechanism the pipeline uses
 * against itself (runlock.ts) — a creator's derived wallet has exactly one
 * nonce sequence, and two concurrent submissions racing it is the same hazard
 * two overlapping cron runs are.
 *
 * EACH STEP IS FUNDED, BROADCAST AND AWAITED BEFORE THE NEXT IS QUOTED. See
 * config.ts's CREATOR_SUBMIT_STEP_MS for why: createGiveaway calls
 * takeCustody, which reverts unless the module's allowance is already mined,
 * so quoting it before the approve that grants that allowance is confirmed
 * would be quoting a revert.
 *
 * Idempotent by retry, not by an idempotency key: a submit that fails partway
 * leaves the campaign in FUNDING, never moves it backwards, and a second call
 * simply re-approves (harmless — approve() to the same or a higher allowance
 * changes nothing a retry cares about) and tries createGiveaway again. Once a
 * createGiveaway has been broadcast its hash is on the draft, and from there the
 * maintenance pass settles it from the chain (D-FUNDING, as E7 does the relay's).
 *
 * DESVIO, recorded rather than hidden: gas sent to a creator's derived wallet
 * here is not entered into the H7 sweep queue, which only knows about
 * bridge_v2_entries. Any unspent remainder in a creator wallet is not
 * recovered by this pass.
 */
const route = handle('creator/campaign/submit', async ({ request, log }) => {
  // SPEC-BLOCO-03 Adenda F7: three steps of this route do not fit the platform's
  // ceiling when each stage is counted at its timeout, so the route budgets
  // itself from the moment the request arrived and starts a step only when it
  // and what follows it fit (CREATOR_SUBMIT_UNIT_MS). A step that does not start
  // leaves the campaign in FUNDING, which a retry resumes.
  const deadline = runDeadline();
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'creator/campaign/submit' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const creator = await findCreatorByParticipant(session.participantId);
  if (creator === null) return refuse(404, 'No campaign in progress.');
  // SPEC-BLOCO-03 6.5: a creator account signs its own approvals and
  // createGiveaway with the passkey (account/relay, createCampaign). The bridge
  // holds no key for it and signs nothing here.
  if (creator.walletIndex === null) return refuse(409, 'Sign this campaign with your passkey.');
  const walletIndex = creator.walletIndex;

  if ((await findActiveCampaign(creator.id)) === null) return refuse(404, 'No campaign in progress.');

  // SPEC-BLOCO-03 Adenda F2: the migration of this wallet takes the same lock,
  // and so does the maintenance pass that settles a draft left in FUNDING
  // (D-FUNDING).
  const lock = await acquireRunLock(creatorCampaignLock(creator.id));
  if (lock === null) {
    return refuse(409, 'This campaign is already being submitted.');
  }

  try {
    // P1-6: the draft is read again under the lock, so what is signed for is the
    // draft as it stands now — never one the expiry or the maintenance pass moved on.
    const campaign = await findActiveCampaign(creator.id);
    if (campaign === null) return refuse(404, 'No campaign in progress.');
    // D-FUNDING, as E7 has the relay: a createGiveaway already sent for this draft
    // is the maintenance pass's to settle from the chain. A second one would
    // leave the draft naming whichever of the two was not mined.
    if (campaign.status === 'FUNDING' && campaign.txHash !== null) {
      return refuse(409, 'This campaign was already sent and is being confirmed.');
    }

    const sameToken = campaign.prizeToken.toLowerCase() === (USDC as string).toLowerCase();
    const prizeTokenBalance = await erc20BalanceOf(campaign.prizeToken, creator.walletAddress);
    const usdcBalance = sameToken ? prizeTokenBalance : await erc20BalanceOf(USDC, creator.walletAddress);
    const prizeTokenNeeded = campaign.prizeAmount + campaign.feeAmount + (sameToken ? campaign.slotsCost : 0n);
    const usdcNeeded = sameToken ? 0n : campaign.slotsCost;

    if (prizeTokenBalance < prizeTokenNeeded || usdcBalance < usdcNeeded) {
      return refuse(409, 'The deposit has not arrived yet at the address you were given.');
    }

    // P1-6: one conditional statement — still this draft, still in its state,
    // nothing sent for it — or nothing is signed.
    if (!(await startSubmission(campaign.id, campaign.status === 'FUNDING' ? 'FUNDING' : 'PENDING_DEPOSIT'))) {
      return refuse(404, 'No campaign in progress.');
    }

    const lease = await acquireFunder();
    if (lease === null) {
      await log.event('funder.exhausted');
      await alert(log, 'no funder available for creator campaign');
      return refuse(503, 'The bridge cannot fund this right now. Try again shortly.');
    }

    // D-B5, as B5 fixes it and GiveawayManagerV2.createGiveaway splits it: the
    // module pulls the prize; the core pulls the fee IN THE PRIZE TOKEN and the
    // slots in USDC. For a USDC prize the core's two are one allowance; for any
    // other token they are two, one per token. Two approvals or three, then
    // createGiveaway — the split the relay signs for a creator account.
    const approvals: { token: `0x${string}`; spender: `0x${string}`; amount: bigint }[] = [
      { token: campaign.prizeToken, spender: campaign.module, amount: campaign.prizeAmount },
      ...(sameToken
        ? [{ token: USDC as `0x${string}`, spender: GIVEAWAY_MANAGER_V2 as `0x${string}`, amount: campaign.feeAmount + campaign.slotsCost }]
        : [
            { token: campaign.prizeToken, spender: GIVEAWAY_MANAGER_V2 as `0x${string}`, amount: campaign.feeAmount },
            { token: USDC as `0x${string}`, spender: GIVEAWAY_MANAGER_V2 as `0x${string}`, amount: campaign.slotsCost },
          ]),
    ];

    let nextNonce = lease.nextNonce;
    const spent = (n: number) => {
      nextNonce = n;
    };
    const outOfTime = () => refuse(503, 'The bridge cannot finish this right now. Try again shortly.');
    // P1-7 and B8: each signed call claims its own unit of the chain ceiling, and
    // only once it has the time to run. A step the time does not reach answers
    // "try again" having claimed nothing for it; every call that is made has
    // paid for its place, on a retry as on the first try.
    const startStep = async (): Promise<Response | null> => {
      if (!deadline.hasTimeFor(CREATOR_SUBMIT_UNIT_MS)) return outOfTime();
      if (!(await claimSpend('chain', 1, log))) {
        return refuse(503, 'The bridge cannot fund this right now. Try again shortly.');
      }
      return null;
    };
    try {
      for (const approval of approvals) {
        const stop = await startStep();
        if (stop !== null) return stop;
        const quoted = await quoteApprove(creator.walletAddress, approval.token, approval.spender, approval.amount);
        await fundAndSend(lease, walletIndex, creator.walletAddress, approval.token, quoted, spent);
      }

      const stop = await startStep();
      if (stop !== null) return stop;
      const prizeData = encodeTokenPrizeData(campaign.prizeToken, campaign.prizeAmount);
      const create = await quoteCreateGiveaway(
        creator.walletAddress,
        campaign.module,
        prizeData,
        campaign.prizeAmount,
        0n,
        campaign.durationSeconds,
        campaign.winnersCount,
        campaign.slotCap,
      );
      // D-FUNDING: the hash goes on the draft the moment it is broadcast, before
      // the wait, so a receipt that never comes leaves the transaction findable
      // by the maintenance pass, as K3 and E7 have it.
      const receipt = await fundAndSend(lease, walletIndex, creator.walletAddress, GIVEAWAY_MANAGER_V2, create, spent, (hash) =>
        advanceCampaign(campaign.id, 'FUNDING', 'FUNDING', { tx_hash: hash }),
      );

      const giveawayId = giveawayIdFromLogs(receipt.logs);
      if (giveawayId === null) {
        await log.failure('creator_campaign.failed', new Error('no GiveawayCreated event'));
        await alert(log, 'createGiveaway mined with no GiveawayCreated event', { tx_hash: receipt.hash });
        return refuse(500, 'Something went wrong. Please try again.');
      }

      await advanceCampaign(campaign.id, 'FUNDING', 'CONFIRMED', {
        giveaway_id: giveawayId.toString(),
        tx_hash: receipt.hash,
      });
      await log.event('creator_campaign.confirmed', { giveaway_id: giveawayId.toString() });
      return ok({ status: 'CONFIRMED', giveawayId: giveawayId.toString(), txHash: receipt.hash });
    } catch (error) {
      if (error instanceof ChainError && error.code === 'gas_cost_above_ceiling') {
        await log.event('gas.rejected', { reason: error.code });
        await alert(log, 'creator campaign gas cost above ceiling', { reason: error.code });
      } else {
        await log.failure('creator_campaign.failed', error);
      }
      // Left in FUNDING. With no createGiveaway sent, a retry re-checks the
      // balances, re-approves harmlessly and tries createGiveaway again; with one
      // sent, the maintenance pass settles it from the chain (D-FUNDING).
      return refuse(502, 'The on-chain step failed. You can try again.');
    } finally {
      const released = await releaseFunder(lease, nextNonce);
      if (!released) {
        await log.event('funder.disabled', { funder_index: lease.index });
        await alert(log, 'funder lease could not be released', { funder_index: lease.index });
      }
    }
  } finally {
    await releaseRunLock(lock);
  }
});

/**
 * Funds the shortfall for one call, broadcasts it and waits for the receipt.
 * Throws on anything short of a mined success — the caller's catch decides
 * what that means for the campaign row. `onBroadcast` runs with the hash
 * before the wait (D-FUNDING).
 */
async function fundAndSend(
  lease: FunderLease,
  walletIndex: number,
  wallet: `0x${string}`,
  to: `0x${string}`,
  quoted: { plan: GasPlan; data: Hex },
  onNonceSpent: (nextNonce: number) => void,
  onBroadcast?: (hash: Hex) => Promise<unknown>,
): Promise<{ hash: Hex; logs: readonly Log[] }> {
  const fundingHash = await fundDerivedWallet(lease, wallet, quoted.plan.worstCaseWei, signAsFunder, onNonceSpent);
  if (fundingHash !== null) {
    const funded = await waitForReceipt(fundingHash);
    if (funded === null || funded.status !== 'success') {
      throw new Error('[bridge-v2] creator wallet funding was not mined');
    }
  }

  if (!(await renewLease(lease))) {
    throw new Error('[bridge-v2] funder lease was lost');
  }

  const hash = await submitAsDerived(walletIndex, wallet, to, quoted.data, quoted.plan, signAsDerived);
  await onBroadcast?.(hash);
  const receipt = await waitForReceipt(hash);
  if (receipt === null || receipt.status !== 'success') {
    throw new Error('[bridge-v2] creator campaign step was not mined');
  }
  return { hash, logs: receipt.logs };
}

/**
 * 8.10: exported as a named async function declaration.
 *
 * The V1 routes reached this shape by incident — commit cea0c09 renamed a
 * default export to POST because the runtime would not otherwise answer — and
 * the form the three surviving V1 routes use is the declaration. The V2 routes
 * differed from it for no reason, and a route file that does not look like the
 * one known to work is a difference nobody wants to be debugging in production.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
