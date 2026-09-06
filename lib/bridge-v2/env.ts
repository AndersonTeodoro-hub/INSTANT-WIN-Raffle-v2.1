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
 * six independent roots: wallet derivation, code HMAC, phone HMAC, session
 * hashing, correlation-signal hashing, and funder signing. Compromising one
 * compromises one.
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
  // Database. The same sb_secret_ key the V1 reads (lib/bridge/supabase.ts:55),
  // deliberately the same variable rather than a second copy of one credential
  // under two names. It resolves to service_role, which holds BYPASSRLS; RLS
  // stays on with no policies so anon and authenticated still reach nothing (I5).
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',

  // F1 — six independent roots.
  'BRIDGE_V2_WALLET_SEED',
  'BRIDGE_V2_CODE_HMAC_KEY',
  'BRIDGE_V2_PHONE_HMAC_KEY',
  'BRIDGE_V2_SESSION_HMAC_KEY',
  // K4. The key under which an IP, a subnet, a device fingerprint and a
  // canonical email become the correlation signals and rate-limit keys the
  // bridge stores. It exists because those values were being reduced with a bare
  // SHA-256, and a bare SHA-256 of an IPv4 address is not a pseudonym: the whole
  // input space is 2^32 and a laptop enumerates it in seconds. The same is true
  // of a phone-shaped string, and true in practice of an email, for which the
  // dictionary is a leaked address list. K4 asks for identifiers that are
  // correlatable and not identifying, and only a keyed hash is both.
  //
  // Its own root rather than a label under an existing one: this key is used on
  // the hot path of every route, including unauthenticated ones, while the
  // others are touched only where a code, a session or a number is handled.
  'BRIDGE_V2_SIGNAL_HMAC_KEY',
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

  // H8/K8. The shared secret the cron routes authenticate on, so scheduled work
  // is not publicly callable.
  //
  // REQUIRED, AND IT USED TO BE OPTIONAL, WHICH MEANT THE PIPELINE COULD BE
  // ABSENT RATHER THAN BROKEN. Without it both cron routes answered 503 and
  // returned: no root published, no entry funded, no prize claimed, nothing
  // swept, and no monitoring check run — including the check that reports missing
  // configuration, which lives in the route that had stopped. The failure was
  // silent by construction, because the one thing that would have reported it was
  // the thing not running. Every other variable the pipeline depends on fails
  // loudly at first use; this one alone failed by doing nothing.
  //
  // Unprefixed on purpose, unlike every other name here: Vercel attaches
  // Authorization: Bearer to a scheduled invocation only when the project holds a
  // variable named exactly CRON_SECRET. A prefixed name would leave the crons
  // arriving with no credential at all.
  'CRON_SECRET',
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
 * variable, and never a value, a length or a prefix (F3).
 *
 * K8: CALLED AT THE START OF EVERY PIPELINE RUN, NOT ONLY BY THE HOURLY
 * MAINTENANCE PASS. It was only in the hourly one, so a variable that went
 * missing was found by whichever ran first — up to sixty minutes of pipeline runs
 * failing one deep chain call at a time, each one a caught per-item error that
 * looked like a bad RPC minute rather than like configuration. The pipeline runs
 * every minute; a check it performs first costs nothing and is the earliest
 * moment the bridge can possibly know.
 */
export function assertEnv(): void {
  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.length === 0;
  });
  if (missing.length > 0) throw new MissingEnvError(missing);
}
