/**
 * Database access for Bridge V2, as one of two scoped roles.
 *
 * I7: the routes that only read do not carry the credential that can write. The
 * V1 used SUPABASE_SERVICE_KEY everywhere, so one leaked value could do
 * anything the bridge could do. Here a short-lived JWT is minted per request
 * carrying a role claim, and PostgREST switches into that role. The role holds
 * exactly the table privileges granted in migration 0006 and nothing more.
 *
 * I5 and I6: RLS is on with zero policies, so anon and authenticated read
 * nothing. The two roles are scoped exclusively to bridge_v2_* objects, so a
 * leaked bridge token reaches nothing else in the project, including the V1
 * tables in the same schema.
 *
 * The service key is deliberately not read by this module. If it is ever needed
 * it must be a separate, argued decision, not a convenience.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';
import { toBase64Url } from './crypto.js';

export type BridgeRole = 'bridge_v2_reader' | 'bridge_v2_writer';

/** JWT lifetime. Long enough for one invocation, useless if it escapes. */
const TOKEN_TTL_SECONDS = 120;

function encodeSegment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Mints an HS256 JWT whose `role` claim names the Postgres role to assume.
 *
 * Hand-rolled rather than pulled from a library: it is three base64url segments
 * and one HMAC, and every package added here is code running in the same process
 * as the derivation seed (K2). Web Crypto already provides the only hard part.
 */
async function mintRoleToken(role: BridgeRole): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    role,
    iss: 'supabase',
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  });
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requireEnv('SUPABASE_JWT_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * A client bound to one role for the life of one request.
 *
 * persistSession and autoRefreshToken are off: there is no end user session
 * here, and storing anything between invocations would be state leaking across
 * requests in a warm container.
 */
async function clientFor(role: BridgeRole): Promise<SupabaseClient> {
  const token = await mintRoleToken(role);
  return createClient(requireEnv('SUPABASE_URL'), token, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getReader(): Promise<SupabaseClient> {
  return clientFor('bridge_v2_reader');
}

export function getWriter(): Promise<SupabaseClient> {
  return clientFor('bridge_v2_writer');
}

/**
 * Thrown when a database operation fails. Carries a stable code for the caller
 * and never the driver message, which can contain row values.
 */
export class DatabaseError extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`[bridge-v2] database operation failed: ${operation}`);
    this.name = 'DatabaseError';
    this.operation = operation;
  }
}

/**
 * G2: no write ignores its result.
 *
 * The V1 wrote `attempts + 1` and never looked at whether the UPDATE succeeded,
 * which is finding #5 and part of K5. Every call in V2 goes through one of these
 * two helpers, so ignoring an error requires deleting a line rather than
 * forgetting to add one.
 */
export function checked<T>(operation: string, result: { data: T; error: unknown }): T {
  if (result.error) throw new DatabaseError(operation);
  return result.data;
}

/** Same, for calls whose result may legitimately be empty. */
export function checkedMaybe<T>(operation: string, result: { data: T | null; error: unknown }): T | null {
  if (result.error) throw new DatabaseError(operation);
  return result.data;
}
