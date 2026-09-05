import { clearedCookie, resolveSession, revokeAllSessions } from '../../../../lib/bridge-v2/session.js';
import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { releasePhone } from '../../../../lib/bridge-v2/phone.js';
import { checked, getWriter } from '../../../../lib/bridge-v2/db.js';
import { randomBytes, toHex } from '../../../../lib/bridge-v2/crypto.js';

/**
 * POST /api/bridge/v2/privacy/erase
 *
 * D7: erasure at the request of the data subject.
 *
 * Erasure here is pseudonymisation, and the reason is structural rather than a
 * convenience. An entry records that a particular address was admitted to a
 * particular campaign, and that address is in an eligibility root on a public
 * chain where nothing can be removed (SPEC-GIVEAWAY-V2 3.4). Deleting this side
 * would not unpublish the chain; it would only leave an address in a root with
 * nothing explaining how it got there, which serves nobody and destroys the
 * platform's own audit trail.
 *
 * So what is destroyed is the link between a person and that record: the address
 * is replaced by an irreversible tombstone, the phone binding is released, and
 * every session is revoked. What remains is the participation record, which
 * after this is no longer personal data because nothing connects it to a person.
 *
 * OPEN POINT, recorded rather than decided: the specification requires an
 * erasure path but does not say what becomes of the participation record. This
 * implements the reading that preserves the on-chain audit trail; whether the
 * owner wants a stronger erasure is not a decision this session may take.
 */
export const POST = handle('privacy/erase', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'privacy/erase' },
  ]);
  if (!verdict.allowed) {
    return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // Released first. C6 puts the number into its cooling period, so erasure does
  // not become a way to recycle a number between accounts on demand.
  const released = await releasePhone(session.participantId);

  // The tombstone is random, so it cannot be reversed to the address it replaced
  // and cannot collide with a real one. The column stays unique and not null, so
  // no constraint has to be relaxed to make erasure possible.
  const tombstone = `erased-${toHex(randomBytes(16))}@invalid`;

  const db = await getWriter();
  checked(
    'privacy.erase',
    await db
      .from('bridge_v2_participants')
      .update({ email_canonical: tombstone, updated_at: new Date().toISOString() })
      .eq('id', session.participantId),
  );

  const revoked = await revokeAllSessions(session.participantId);

  await log.event('route.ok', { released, revoked });
  return ok(
    {
      erased: true,
      phoneReleased: released > 0,
      sessionsRevoked: revoked,
      retained: 'participation record, no longer linked to an identity',
    },
    { 'Set-Cookie': clearedCookie() },
  );
});
