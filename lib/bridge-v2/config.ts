/**
 * Every tunable of Bridge V2, in one place.
 *
 * Scattered magic numbers are how a ceiling silently stops matching the
 * requirement it was written for. Each constant below names the requirement it
 * serves, so a reviewer checking, say, H3 can find the number without reading
 * the call site.
 *
 * H1: the contract address and the function names are literals here. They are
 * never read from an environment variable and never taken from input. A
 * configurable contract address is a configurable place to send gas.
 */

/** Arbitrum One. The bridge signs on no other chain. */
export const CHAIN_ID = 42161 as const;

/** GiveawayManagerV2, Arbitrum One. Verified on Sourcify (exact match). */
export const GIVEAWAY_MANAGER_V2 = '0xEA91eb545FBB7e82f0085ff30555ed06C1Baf739' as const;

/** USDC on Arbitrum One, 6 decimals. */
export const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const;
export const USDC_DECIMALS = 6 as const;

/** Public endpoint used when ARBITRUM_RPC_URL is unset. */
export const DEFAULT_RPC_URL = 'https://arb1.arbitrum.io/rpc' as const;

// -----------------------------------------------------------------------------
// A — sessions
// -----------------------------------------------------------------------------
/** A2: 32 bytes of CSPRNG output, so 256 bits of entropy exactly. */
export const SESSION_TOKEN_BYTES = 32 as const;
/** A4: idle window. Slides on each authenticated use. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** A4: absolute lifetime. Never slides; a session dies at this point regardless. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Name of the session cookie (A3). */
export const SESSION_COOKIE = 'iw_bridge_session' as const;

// -----------------------------------------------------------------------------
// B — rate limiting
// -----------------------------------------------------------------------------
/**
 * B2: the axes. An attacker who varies one is still held by the others. Each
 * entry is (window seconds, max per window, base penalty seconds).
 *
 * B5 is why UNKNOWN_EMAIL exists and is the tightest of them: a code request for
 * an address that has never interacted with the platform is limited hard and
 * independently, so the bridge cannot be used to bomb a third party.
 */
export const RATE_LIMITS = {
  IP: { windowSeconds: 60, max: 30, penaltySeconds: 30 },
  SUBNET: { windowSeconds: 60, max: 120, penaltySeconds: 30 },
  SESSION: { windowSeconds: 60, max: 60, penaltySeconds: 15 },
  EMAIL: { windowSeconds: 3600, max: 5, penaltySeconds: 300 },
  UNKNOWN_EMAIL: { windowSeconds: 86400, max: 2, penaltySeconds: 3600 },
  PHONE: { windowSeconds: 86400, max: 3, penaltySeconds: 3600 },
  // C7: the device fingerprint. Weak by design (signals.ts), so the ceiling is
  // loose enough that a shared office NAT is not a false positive and tight
  // enough that one machine cannot register a hundred accounts in an hour.
  CLIENT: { windowSeconds: 3600, max: 20, penaltySeconds: 300 },
  GIVEAWAY: { windowSeconds: 60, max: 300, penaltySeconds: 30 },
  ROUTE_GLOBAL: { windowSeconds: 60, max: 3000, penaltySeconds: 10 },
} as const;

export type RateAxis = keyof typeof RATE_LIMITS;

// -----------------------------------------------------------------------------
// B7, B8 — external spend ceilings
// -----------------------------------------------------------------------------
/**
 * B8: absolute ceilings per provider. Units are provider-specific and counted by
 * the caller: one email is one unit, one funding transaction is one unit.
 */
export const SPEND_CAPS = {
  email: { hour: 500, day: 5000 },
  telegram: { hour: 3000, day: 30000 },
  chain: { hour: 500, day: 5000 },
} as const;

export type SpendProvider = keyof typeof SPEND_CAPS;

// -----------------------------------------------------------------------------
// C — identity
// -----------------------------------------------------------------------------
/** C6: how long a released number is held out of circulation. */
export const PHONE_COOLDOWN_DAYS = 30 as const;

// -----------------------------------------------------------------------------
// J — codes
// -----------------------------------------------------------------------------
/** J3: short life. */
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
/** J4: attempts per code, enforced atomically. */
export const EMAIL_CODE_MAX_ATTEMPTS = 5 as const;
/** Digits in an email code. */
export const EMAIL_CODE_DIGITS = 6 as const;
/** Telegram deep-link code: 16 bytes, base64url, single use. */
export const LINK_CODE_BYTES = 16 as const;
/** Link code life. Long enough to switch app, short enough to be worthless later. */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

// -----------------------------------------------------------------------------
// E — custody thresholds
// -----------------------------------------------------------------------------
/**
 * E2: at or above this, the winner must supply their own wallet. Expressed in
 * USDC base units because that is what the contract deals in.
 */
export const CUSTODY_OWN_WALLET_THRESHOLD = 100n * 10n ** BigInt(USDC_DECIMALS);
/** E3: temporary custody never becomes indefinite. */
export const CUSTODY_TEMPORARY_DAYS = 30 as const;

// -----------------------------------------------------------------------------
// G, H — chain
// -----------------------------------------------------------------------------
/** G4: no external wait is unbounded. Applied to every RPC call. */
export const RPC_TIMEOUT_MS = 10_000;
/** G4: the receipt wait is the one that killed V1 leases. Bounded here. */
export const RECEIPT_TIMEOUT_MS = 60_000;
/** G4: email and Telegram calls. */
export const HTTP_TIMEOUT_MS = 8_000;
/** G3: lease length, and the point at which a live operation renews it. */
export const FUNDER_LEASE_SECONDS = 90 as const;

/**
 * H3: absolute ceiling on what one entry may cost in gas, in wei. A compromised
 * or anomalous RPC cannot make the bridge move more than this, whatever it
 * claims the gas price is. Arbitrum entry costs are far below it; this is a
 * sanity bound, not a budget.
 */
export const MAX_GAS_COST_WEI = 2n * 10n ** 14n;

/** H4: the estimate must land inside this band or the entry fails unspent. */
export const MIN_PLAUSIBLE_GAS = 40_000n;
export const MAX_PLAUSIBLE_GAS = 2_000_000n;

/** Margin over the estimate, so a price move between estimate and send does not strand the entry. */
export const GAS_MARGIN_NUMERATOR = 150n;
export const GAS_MARGIN_DENOMINATOR = 100n;

/** H7: leftover below this is not worth a sweep transaction. */
export const SWEEP_MIN_WEI = 5n * 10n ** 13n;

// -----------------------------------------------------------------------------
// H8 — the alert thresholds
// -----------------------------------------------------------------------------
// H8 asks for an alert BEFORE exhaustion, so every threshold here is a level at
// which there is still time to act, not the level at which something has already
// stopped working.
/** A funder below this can still pay, but not for long. */
export const FUNDER_LOW_BALANCE_WEI = 10n ** 15n;
/**
 * LINK in the VRF 2.5 subscription, 18 decimals. Below this a draw may fail to
 * be fulfilled, which is the one failure in the system that cannot be retried
 * from this side.
 */
export const VRF_LOW_LINK_JUELS = 3n * 10n ** 18n;
/** Fraction of a provider's daily ceiling at which the consumption is worth an alert. */
export const SPEND_ALERT_FRACTION = 0.8;
/** Route errors in the last hour above which the error rate is worth an alert. */
export const ROUTE_ERROR_ALERT_COUNT = 25 as const;

// -----------------------------------------------------------------------------
// I, K — limits and retention
// -----------------------------------------------------------------------------
/** I3: request bodies are small by design; anything larger is refused unparsed. */
export const MAX_BODY_BYTES = 4096 as const;
/** I3: the only content type any route accepts. */
export const REQUIRED_CONTENT_TYPE = 'application/json' as const;
/** K7: diagnostic retention. */
export const OPS_RETENTION_DAYS = 30 as const;
/** Grace before an expired session row is removed, so revocation stays auditable briefly. */
export const SESSION_GRACE_DAYS = 7 as const;
/** D3: floor for responses on paths that would otherwise reveal existence by latency. */
export const UNIFORM_RESPONSE_MS = 400;
