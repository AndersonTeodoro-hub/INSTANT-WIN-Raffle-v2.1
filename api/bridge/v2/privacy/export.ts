import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { checked, checkedMaybe, getReader } from '../../../../lib/bridge-v2/db.js';

/**
 * POST /api/bridge/v2/privacy/export
 *
 * D7: the data subject can obtain what is held about them.
 *
 * Everything returned belongs to the caller and is scoped by the session (A6,
 * D1). There is no parameter naming a person, so this cannot be used to export
 * somebody else.
 *
 * What comes back is genuinely everything personal the bridge holds: the
 * canonical address, the derived public address, and the participation record.
 * What cannot come back is the phone number, because C5 means it was never
 * stored — only an HMAC of it, which is not reversible and is not the
 * participant's data in any useful sense.
 */
const route = handle('privacy/export', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'privacy/export' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  const db = await getReader();

  const participant = checkedMaybe(
    'export.participant',
    await db
      .from('bridge_v2_participants')
      .select('email_canonical, wallet_address, created_at')
      .eq('id', session.participantId)
      .maybeSingle(),
  ) as { email_canonical: string; wallet_address: string; created_at: string } | null;

  if (participant === null) return refuse(401, 'Sign in to continue.');

  const entries = checked(
    'export.entries',
    await db
      .from('bridge_v2_entries')
      .select('giveaway_id, status, wallet_address, tx_hash, created_at, updated_at')
      .eq('participant_id', session.participantId)
      .order('created_at', { ascending: true }),
  ) as unknown[] | null;

  await log.event('route.ok');
  return ok({
    participant: {
      email: participant.email_canonical,
      walletAddress: participant.wallet_address,
      createdAt: participant.created_at,
    },
    entries: Array.isArray(entries) ? entries : [],
    // Stated rather than omitted, so the export is honest about what exists.
    notIncluded: {
      phoneNumber: 'never stored; only a non-reversible keyed hash is held (C5)',
      derivationIndex: 'internal, not personal data',
    },
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
