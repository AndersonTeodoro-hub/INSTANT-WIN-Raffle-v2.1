/**
 * Environment variable access for Bridge V2.
 *
 * Rule 0.1 and F2: no key, token or credential is ever written to a file in this
 * repository. Everything below is a NAME. Values live only in the Vercel project
 * settings and only in the memory of a running function.
 *
 * F3: a missing variable is reported by name and never by value, never by
 * length, and never by prefix. A length in a log is already information about a
 * secret.
 *
 * F1 is the reason this list is long. The V1 used one BRIDGE_SEED for both
 * wallet derivation and code HMAC, so a leak of either use leaked both. V2 keeps
 * five independent roots: wallet derivation, code HMAC, phone HMAC, session
 * hashing, and funder signing. Compromising one compromises one.
 */

// The project has no @types/node — it is a browser project that also ships
// serverless functions. Declaring the one global we use keeps a whole types
// package out of the process that handles key material (K2).
declare const process: { env: Record<string, string | undefined> };

/**
 * Every variable the bridge reads. Grouped by why it exists, because a reader
 * checking F1 needs to see at a glance that the roots really are separate.
 */
export const REQUIRED_ENV = [
  // Database. The service key is deliberately absent: V2 talks to PostgREST as
  // one of two scoped roles (I7), and the JWT for those roles is minted from the
  // project JWT secret.
  'SUPABASE_URL',
  'SUPABASE_JWT_SECRET',

  // F1 — five independent roots.
  'BRIDGE_V2_WALLET_SEED',
  'BRIDGE_V2_CODE_HMAC_KEY',
  'BRIDGE_V2_PHONE_HMAC_KEY',
  'BRIDGE_V2_SESSION_HMAC_KEY',
  'BRIDGE_V2_FUNDER_KEYS',
  // The key that holds the on-chain bridge role, i.e. the address the contract
  // accepts for addEligibilityRoot. Kept as its own root for the same reason as
  // the others: publishing eligibility and funding gas are different powers and
  // should not fall together.
  //
  // OPEN POINT: the specification does not say which key holds this role. It is a
  // separate variable here so the choice stays visible and revocable, not because
  // the spec settled it.
  'BRIDGE_V2_ROLE_KEY',

  // Email. J7 requires our own authenticated sender domain.
  'RESEND_API_KEY',
  'BRIDGE_V2_MAIL_FROM',

  // Telegram. R5: the token is an environment variable and nothing else.
  // The webhook secret is what Telegram echoes in X-Telegram-Bot-Api-Secret-Token
  // so the webhook can reject anything that did not come from Telegram.
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  // The bot's public username, used only to build the t.me link the page opens.
  // Read from configuration because the owner chooses the name (R3 constrains what
  // it may contain); no name is written into this repository.
  'TELEGRAM_BOT_USERNAME',
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number];

/**
 * Optional variables. Each has a documented fallback in the module that reads
 * it; none may be required for the bridge to run correctly.
 */
export const OPTIONAL_ENV = [
  // Dedicated RPC endpoint. Without it the same public endpoint the frontend
  // already uses is applied.
  'ARBITRUM_RPC_URL',
  // Where K8 alerts are posted. Without it alerts degrade to ops events only.
  'BRIDGE_V2_ALERT_WEBHOOK_URL',
  // Shared secret for the cron routes, so scheduled work is not publicly callable.
  'BRIDGE_V2_CRON_SECRET',
] as const;

export type OptionalEnvName = (typeof OPTIONAL_ENV)[number];

/** Thrown when configuration is missing. Carries names only (F3). */
export class MissingEnvError extends Error {
  readonly names: readonly string[];
  constructor(names: readonly string[]) {
    super(`[bridge-v2] missing environment variables: ${names.join(', ')}`);
    this.name = 'MissingEnvError';
    this.names = names;
  }
}

/**
 * Reads one required variable.
 *
 * F4: the value is returned to the caller and never cached in module scope. The
 * caller is expected to use it and let it fall out of scope. This is a partial
 * mitigation and is declared as such in R2: the Vercel runtime reuses warm
 * containers and process.env persists across invocations, and JavaScript cannot
 * reliably zero a string. What this avoids is a second, longer-lived copy.
 */
export function requireEnv(name: RequiredEnvName): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new MissingEnvError([name]);
  return value;
}

/** Reads one optional variable, or undefined when unset or empty. */
export function optionalEnv(name: OptionalEnvName): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Checks every required variable at once.
 *
 * One message listing everything missing, rather than one deploy per forgotten
 * variable. Used by the health path of the cron routes so misconfiguration is
 * found by a schedule rather than by a participant.
 */
export function assertEnv(): void {
  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.length === 0;
  });
  if (missing.length > 0) throw new MissingEnvError(missing);
}
