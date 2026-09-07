import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../../lib/bridge-v2/signals.js';
import { parseAddress, parseIntInRange, parseUint256 } from '../../../../../lib/bridge-v2/validate.js';
import { resolveSession } from '../../../../../lib/bridge-v2/session.js';
import { hasVerifiedPhone } from '../../../../../lib/bridge-v2/phone.js';
import { getOrCreateCreator } from '../../../../../lib/bridge-v2/creators.js';
import { createDraft, findActiveCampaign } from '../../../../../lib/bridge-v2/creatorCampaigns.js';
import {
  currentCreationFee,
  isModuleRegistered,
  modulePrizeKind,
  slotPrice,
} from '../../../../../lib/bridge-v2/chain.js';
import { PrizeKind } from '../../../../../lib/bridge-v2/abi.js';
import {
  CONTRACT_MAX_DURATION_SECONDS,
  CONTRACT_MAX_PARTICIPANTS,
  CONTRACT_MAX_WINNERS,
  CONTRACT_MIN_DURATION_SECONDS,
  CONTRACT_MIN_PARTICIPANTS,
} from '../../../../../lib/bridge-v2/config.js';

/**
 * POST /api/bridge/v2/creator/campaign/start
 *   {module, prizeToken, prizeAmount, durationSeconds, winnersCount, slotCap}
 *
 * 07/09/2026 owner decision, path 3 of 4: a creator with no wallet has the
 * bridge create their campaign and deposit its prize. This route drafts it and
 * hands back a deposit address; creator/campaign/submit.ts does the signing
 * once the creator has actually sent the funds there.
 *
 * The barrier applies here exactly as it does to a participant (0.4 of the
 * decision, "sem excepção"): hasVerifiedPhone is the same fact an entrant's
 * verification leaves behind. DESVIO — a creator who has never verified a
 * phone through any campaign has nothing to attach a Telegram deep link to
 * yet, and this pass does not build a campaign-less verification funnel (see
 * the 0007 migration header). They are told to verify through an entry first.
 *
 * DESVIO — TOKEN prizes only. isModuleRegistered and modulePrizeKind are read
 * from the chain rather than trusted from the request (H1: the module is
 * still a parameter of the eventual createGiveaway, but never an unchecked
 * one), and an NFT module is refused here with a clear reason.
 *
 * The bounds below mirror GiveawayManagerV2.createGiveaway's own require
 * checks (I2): a request outside them fails with 400 here instead of costing
 * a wasted revert once funds are already at the deposit address.
 */
const route = handle('creator/campaign/start', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const body = await readJsonBody(request);
  if (body === null) return refuse(400, 'Invalid request body.');

  const module = parseAddress(body.module);
  const prizeToken = parseAddress(body.prizeToken);
  const prizeAmount = parseUint256(body.prizeAmount);
  const durationSeconds = parseIntInRange(
    body.durationSeconds,
    CONTRACT_MIN_DURATION_SECONDS,
    CONTRACT_MAX_DURATION_SECONDS,
  );
  const winnersCount = parseIntInRange(body.winnersCount, 1, CONTRACT_MAX_WINNERS);
  const slotCap = parseIntInRange(body.slotCap, CONTRACT_MIN_PARTICIPANTS, CONTRACT_MAX_PARTICIPANTS);

  if (
    module === null ||
    prizeToken === null ||
    prizeAmount === null ||
    durationSeconds === null ||
    winnersCount === null ||
    slotCap === null
  ) {
    return refuse(400, 'Invalid campaign parameters.');
  }

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'creator/campaign/start' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  if (!(await hasVerifiedPhone(session.participantId))) {
    return refuse(403, 'Verify your phone through an event page first, then create your campaign.');
  }

  if (!(await isModuleRegistered(module))) {
    return refuse(400, 'This prize module is not registered.');
  }
  if ((await modulePrizeKind(module)) !== PrizeKind.TOKEN) {
    return refuse(400, 'Creator-without-wallet campaigns support token prizes only, for now.');
  }

  const creator = await getOrCreateCreator(session.participantId);

  const existing = await findActiveCampaign(creator.id);
  if (existing !== null) {
    return refuse(409, 'You already have a campaign in progress. Finish or abandon it first.');
  }

  const feeAmount = await currentCreationFee(PrizeKind.TOKEN, prizeAmount);
  const slotsCost = BigInt(slotCap) * (await slotPrice());

  const outcome = await createDraft(creator.id, {
    module,
    prizeToken,
    prizeAmount,
    durationSeconds: BigInt(durationSeconds),
    winnersCount,
    slotCap,
    feeAmount,
    slotsCost,
  });

  if (outcome.kind === 'ACTIVE_EXISTS') {
    return refuse(409, 'You already have a campaign in progress. Finish or abandon it first.');
  }

  await log.event('route.ok', { step: 'draft_created' });

  // The creator sends the prize (plus its fee, same token) and the slot cost
  // (always USDC) to this address, then calls submit. Two amounts of the same
  // token when prizeToken is USDC — the creator sends the sum.
  return ok({
    depositAddress: creator.walletAddress,
    prizeToken,
    prizeAmount: prizeAmount.toString(),
    feeAmount: feeAmount.toString(),
    usdcForSlots: slotsCost.toString(),
  });
});

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
