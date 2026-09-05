/**
 * Sessions. A1 to A6.
 *
 * Finding #1: the V1 had no authentication on any route, so every endpoint took
 * an email as a parameter and believed it. Finding #2 is what that buys an
 * attacker — status.ts returned the wallet address, transaction hash and
 * timestamps for any address anyone cared to type.
 *
 * A6 is the requirement that closes both by construction: no route may take an
 * identity from the client. The only way a route learns who is calling is
 * resolveSession, which reads a cookie the client cannot forge and returns a
 * participant id the client never sees.
 */

import {
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  SESSION_TOKEN_BYTES,
} from './config.js';
import { keyedHash, randomBytes, toBase64Url } from './crypto.js';
import { checked, checkedMaybe, getReader, getWriter } from './db.js';
import type { RequestSignals } from './signals.js';

/** A2: HMAC under the session root (F1), so a table dump yields no usable token. */
function hashToken(token: string): Promise<string> {
  return keyedHash('BRIDGE_V2_SESSION_HMAC_KEY', 'session-token-v1', token);
}

export interface Session {
  readonly id: string;
  readonly participantId: string;
}

/**
 * Issues a session for a participant whose email possession has just been proved.
 *
 * A2: 32 bytes of CSPRNG output is 256 bits exactly, encoded base64url so it
 * survives a cookie unescaped. The token encodes nothing — it is not derived
 * from the email and carries no claims — so it cannot be guessed from anything
 * the attacker already knows.
 */
export async function createSession(
  participantId: string,
  signals: RequestSignals,
): Promise<string> {
  const token = toBase64Url(randomBytes(SESSION_TOKEN_BYTES));
  const now = Date.now();

  const db = await getWriter();
  checked(
    'session.insert',
    await db.from('bridge_v2_sessions').insert({
      participant_id: participantId,
      token_hash: await hashToken(token),
      idle_expires_at: new Date(now + SESSION_IDLE_MS).toISOString(),
      absolute_expires_at: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
      ip_hash: signals.ipHash,
      subnet_hash: signals.subnetHash,
      client_hash: signals.clientHash,
    }),
  );

  return token;
}

/**
 * A3: the cookie the token travels in.
 *
 * HttpOnly keeps it away from any script on the page, Secure keeps it off plain
 * HTTP, and SameSite=Lax keeps a third-party form from spending it. Path is
 * scoped to the API so it is never attached to a static asset request.
 *
 * Max-Age matches the absolute lifetime, not the idle one: the browser should
 * keep sending a token that is still renewable, and the server decides whether
 * it is still alive.
 */
export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${maxAge}`;
}

/** The cookie that clears a session in the browser (A5, client half). */
export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0`;
}

function tokenFromCookies(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

interface SessionRow {
  id: string;
  participant_id: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

/**
 * Resolves the caller, or null.
 *
 * A4: both clocks are checked. The idle clock slides on a successful resolve;
 * the absolute clock never moves, so a session that has reached it dies even if
 * it was used a second ago. There is no path that mints a fresh session from an
 * expired one — renewal is this slide and nothing else.
 */
export async function resolveSession(request: Request): Promise<Session | null> {
  const token = tokenFromCookies(request);
  if (token === null) return null;

  const tokenHash = await hashToken(token);
  const reader = await getReader();
  const row = checkedMaybe(
    'session.select',
    await reader
      .from('bridge_v2_sessions')
      .select('id, participant_id, idle_expires_at, absolute_expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle(),
  ) as SessionRow | null;

  if (row === null || row.revoked_at !== null) return null;

  const now = Date.now();
  if (new Date(row.absolute_expires_at).getTime() <= now) return null;
  if (new Date(row.idle_expires_at).getTime() <= now) return null;

  // The slide is the reader role's one write (I7), and its failure is not fatal:
  // a session that failed to slide is still a valid session for this request.
  await reader
    .from('bridge_v2_sessions')
    .update({
      last_seen_at: new Date(now).toISOString(),
      idle_expires_at: new Date(now + SESSION_IDLE_MS).toISOString(),
    })
    .eq('id', row.id);

  return { id: row.id, participantId: row.participant_id };
}

/**
 * A5: revokes every session of one participant.
 *
 * Per participant rather than per session, because the requirement exists for
 * incident response: the question being answered is "make this account's tokens
 * stop working", and a caller who has to enumerate sessions will miss one.
 */
export async function revokeAllSessions(participantId: string): Promise<number> {
  const db = await getWriter();
  const rows = checked(
    'session.revoke',
    await db
      .from('bridge_v2_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('participant_id', participantId)
      .is('revoked_at', null)
      .select('id'),
  ) as Array<{ id: string }> | null;
  return Array.isArray(rows) ? rows.length : 0;
}
