import { handle, methodGuard, ok, refuse } from '../../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../../lib/bridge-v2/session.js';
import { findCreatorByParticipant } from '../../../../../lib/bridge-v2/creators.js';
import { advanceCampaign, findActiveCampaign } from '../../../../../lib/bridge-v2/creatorCampaigns.js';
import { acquireRunLock, releaseRunLock } from '../../../../../lib/bridge-v2/runlock.js';
import { acquireFunder, releaseFunder, renewLease, signAsFunder } from '../../../../../lib/bridge-v2/funders.js';
import { signAsDerived } from '../../../../../lib/bridge-v2/wallet.js';
import { claimSpend } from '../../../../../lib/bridge-v2/spend.js';
import { alert } from '../../../../../lib/bridge-v2/alert.js';
import { GIVEAWAY_MANAGER_V2, USDC } from '../../../../../lib/bridge-v2/config.js';
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
 * creator/campaign/start.ts handed them, this signs the three on-chain steps
 * — approve the module, approve the core, createGiveaway — as the creator's
 * derived wallet, and funds the gas for each from the pool.
 *
 * G3/G6: one campaign is signed for at a time. acquireRunLock, scoped to the
 * creator rather than the campaign, is the same mechanism the pipeline uses
 * against itself (runlock.ts) — a creator's derived wallet has exactly one
 * nonce sequence, and two concurrent submissions racing it is the same hazard
 * two overlapping cron runs are.
 *
 * EACH STEP IS FUNDED, BROADCAST AND AWAITED BEFORE THE NEXT IS QUOTED. See
 * config.ts's CREATOR_SUBMIT_WORST_CASE_MS for why: createGiveaway calls
 * takeCustody, which reverts unless the module's allowance is already mined,
 * so quoting it before the approve that grants that allowance is confirmed
 * would be quoting a revert.
 *
 * Idempotent by retry, not by an idempotency key: a submit that fails partway
 * leaves the campaign in FUNDING, never moves it backwards, and a second call
 * simply re-approves (harmless — approve() to the same or a higher allowance
 * changes nothing a retry cares about) and tries createGiveaway again.
 *
 * DESVIO, recorded rather than hidden: gas sent to a creator's derived wallet
 * here is not entered into the H7 sweep queue, which only knows about
 * bridge_v2_entries. Any unspent remainder in a creator wallet is not
 * recovered by this pass.
 */
const route = handle('creator/campaign/submit', async ({ request, log }) => {
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

  const campaign = await findActiveCampaign(creator.id);
  if (campaign === null) return refuse(404, 'No campaign in progress.');

  const lock = await acquireRunLock(`creator-campaign:${creator.id}`);
  if (lock === null) {
    return refuse(409, 'This campaign is already being submitted.');
  }

  try {
    const sameToken = campaign.prizeToken.toLowerCase() === (USDC as string).toLowerCase();
    const prizeTokenBalance = await erc20BalanceOf(campaign.prizeToken, creator.walletAddress);
    const usdcBalance = sameToken ? prizeTokenBalance : await erc20BalanceOf(USDC, creator.walletAddress);
    const prizeTokenNeeded = campaign.prizeAmount + campaign.feeAmount + (sameToken ? campaign.slotsCost : 0n);
    const usdcNeeded = sameToken ? 0n : campaign.slotsCost;

    if (prizeTokenBalance < prizeTokenNeeded || usdcBalance < usdcNeeded) {
      return refuse(409, 'The deposit has not arrived yet at the address you were given.');
    }

    if (campaign.status === 'PENDING_DEPOSIT') {
      await advanceCampaign(campaign.id, 'PENDING_DEPOSIT', 'FUNDING');
    }

    // B8: claimed once for the whole sequence — three signed calls, whatever
    // happens to any of them. A settled or abandoned draft gets no free pass
    // to the pool on a retry.
    if (!(await claimSpend('chain', 3, log))) {
      return refuse(503, 'The bridge cannot fund this right now. Try again shortly.');
    }

    const lease = await acquireFunder();
    if (lease === null) {
      await log.event('funder.exhausted');
      await alert(log, 'no funder available for creator campaign');
      return refuse(503, 'The bridge cannot fund this right now. Try again shortly.');
    }

    let nextNonce = lease.nextNonce;
    try {
      const approve1 = await quoteApprove(
        creator.walletAddress,
        campaign.prizeToken,
        campaign.module,
        campaign.prizeAmount,
      );
      await fundAndSend(lease, creator.walletIndex, creator.walletAddress, campaign.prizeToken, approve1, (n) => {
        nextNonce = n;
      });

      const approve2 = await quoteApprove(
        creator.walletAddress,
        USDC,
        // The core, not the module: fee and slot cost are paid to
        // GiveawayManagerV2 itself, a literal import (H1).
        GIVEAWAY_MANAGER_V2,
        campaign.feeAmount + campaign.slotsCost,
      );
      await fundAndSend(lease, creator.walletIndex, creator.walletAddress, USDC, approve2, (n) => {
        nextNonce = n;
      });

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
      const receipt = await fundAndSend(
        lease,
        creator.walletIndex,
        creator.walletAddress,
        GIVEAWAY_MANAGER_V2,
        create,
        (n) => {
          nextNonce = n;
        },
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
      // Left in FUNDING. A retry re-checks balances, re-approves harmlessly and
      // tries createGiveaway again.
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
 * what that means for the campaign row.
 */
async function fundAndSend(
  lease: FunderLease,
  walletIndex: number,
  wallet: `0x${string}`,
  to: `0x${string}`,
  quoted: { plan: GasPlan; data: Hex },
  onNonceSpent: (nextNonce: number) => void,
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
