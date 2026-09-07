import { handle, methodGuard, ok, refuse } from '../../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../../lib/bridge-v2/session.js';
import { findCreatorByParticipant } from '../../../../../lib/bridge-v2/creators.js';
import { findLatestCampaign } from '../../../../../lib/bridge-v2/creatorCampaigns.js';

/**
 * POST /api/bridge/v2/creator/campaign/status
 *
 * D1/A6: what the creator page polls while submit.ts is doing its (up to
 * 270-second) work in another request. Scoped to the caller's own session,
 * never a parameter — there is no id to name somebody else's campaign with.
 *
 * Read-only, so a caller checking status before ever drafting a campaign does
 * not spend a wallet derivation index for nothing: findCreatorByParticipant
 * never creates one.
 */
const route = handle('creator/campaign/status', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'creator/campaign/status' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const creator = await findCreatorByParticipant(session.participantId);
  if (creator === null) return ok({ status: 'NONE' });

  const campaign = await findLatestCampaign(creator.id);
  await log.event('route.ok');
  if (campaign === null) return ok({ status: 'NONE' });

  return ok({
    status: campaign.status,
    depositAddress: creator.walletAddress,
    giveawayId: campaign.giveawayId?.toString() ?? null,
    txHash: campaign.txHash,
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
