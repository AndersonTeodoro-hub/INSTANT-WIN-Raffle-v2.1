/**
 * Database access for Bridge V2.
 *
 * One client, one credential: the sb_secret_ key, read from the same
 * environment variable the V1 already uses (lib/bridge/supabase.ts:55). That
 * key resolves to service_role, which carries BYPASSRLS.
 *
 * Why the per-route roles are gone. The project's JWT signing key is ECC P-256
 * with a non-exportable private half, and the legacy HS256 key is already in
 * "previously used keys" on its way out. The previous design minted its own
 * HS256 role tokens, so it depended on a secret that is being revoked and could
 * not be reissued under the current key. A design that cannot survive the next
 * key rotation is not a design.
 *
 * What this costs, stated rather than glossed: I7 asked that a read-only route
 * not carry the credential that can write, and with a single key it does. The
 * separation now lives entirely in which functions a route calls, which is a
 * weaker guarantee than a credential that cannot perform the write at all.
 *
 * I5 still holds and still matters: RLS stays enabled on every bridge_v2_* table
 * with zero policies (0004), so anon and authenticated read nothing even if a
 * publishable key reaches a browser. service_role passes because BYPASSRLS and
 * GRANT are independent mechanisms and migration 0006 grants it both halves.
 *
 * This module must never be imported by anything under pages/ or components/.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

/**
 * Removes `Authorization` when it merely repeats the `apikey`.
 *
 * The sb_publishable_ and sb_secret_ key formats are not JWTs and belong only in
 * the apikey header. Supabase documents what happens otherwise:
 *
 *   "You cannot send a publishable or secret key in the `Authorization: Bearer …`
 *    header, except if the value exactly equals the `apikey` header. In this case,
 *    your request will be forwarded down to your project's database, but
 *    WILL BE REJECTED AS THE VALUE IS NOT A JWT."
 *   — https://supabase.com/docs/guides/api/api-keys
 *
 * The V1 hit exactly this and fixed it the same way (lib/bridge/supabase.ts:30).
 * The condition is deliberately narrow: it strips only when the Bearer
 * DUPLICATES the apikey, so a genuinely different Authorization passes intact.
 */
export function stripSelfBearer(headers: Headers): Headers {
  const apikey = headers.get('apikey');
  if (apikey !== null && headers.get('Authorization') === `Bearer ${apikey}`) {
    headers.delete('Authorization');
  }
  return headers;
}

/**
 * The client for one invocation.
 *
 * persistSession and autoRefreshToken are off: there is no end-user session
 * here, and keeping one would be state leaking between requests in a warm
 * container.
 */
export function getDb(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, headers: stripSelfBearer(new Headers(init?.headers)) }),
    },
  });
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
 * which is finding #5. Every call in V2 goes through one of these two helpers,
 * so ignoring an error requires deleting a line rather than forgetting to add
 * one.
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
