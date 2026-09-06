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
  // The Telegram chat the bot is talking to. This is the per-caller axis of the
  // webhook: every update arrives from Telegram's own infrastructure, so the
  // source address identifies Telegram and not the person, and limiting on it
  // limits every participant together while stopping no individual abuser.
  // The key is the chat HMAC, never the chat id (K4, R4).
  TELEGRAM_CHAT: { windowSeconds: 3600, max: 30, penaltySeconds: 300 },
  // C7: the device fingerprint. Weak by design (signals.ts), so the ceiling is
  // loose enough that a shared office NAT is not a false positive and tight
  // enough that one machine cannot register a hundred accounts in an hour.
  CLIENT: { windowSeconds: 3600, max: 20, penaltySeconds: 300 },
  GIVEAWAY: { windowSeconds: 60, max: 300, penaltySeconds: 30 },
  ROUTE_GLOBAL: { windowSeconds: 60, max: 3000, penaltySeconds: 10 },
} as const;

export type RateAxis = keyof typeof RATE_LIMITS;

/**
 * B4: how long a key must stay quiet before its strike count starts again.
 *
 * The escalating cost lives in bridge_v2_rate_penalties, keyed by axis and key
 * and by no window, which is what makes it survive a window boundary. Something
 * has to make it end, or somebody who mistyped a code twice in March meets an
 * hour of penalty in September. A week of silence is that something.
 */
export const STRIKE_DECAY_SECONDS = 7 * 24 * 60 * 60;
/** The same number in days, for the retention pass that removes decayed rows. */
export const PENALTY_DECAY_DAYS = 7 as const;

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
 * E2: at or above this, the winner must supply their own wallet.
 *
 * OWNER DECISION D1, 06/09/2026: this number is only ever compared against an
 * amount of USDC. Any other token, and every NFT, requires the winner's own
 * wallet whatever the amount. That is what makes the constant meaningful — "100"
 * in the base units of a token the campaign creator chose is not a hundred of
 * anything, and the previous comparison did exactly that: an arbitrary ERC-20
 * with eighteen decimals cleared this threshold at 0.0000000001 of a token, so
 * an unlimited prize in a worthless token went to temporary custody, and a
 * six-decimal token worth a thousand dollars a unit did not.
 */
export const CUSTODY_OWN_WALLET_THRESHOLD = 100n * 10n ** BigInt(USDC_DECIMALS);
/** E3: temporary custody never becomes indefinite. */
export const CUSTODY_TEMPORARY_DAYS = 30 as const;

// -----------------------------------------------------------------------------
// G, H — chain
// -----------------------------------------------------------------------------
/** G4: no external wait is unbounded. Applied to every RPC call. */
export const RPC_TIMEOUT_MS = 10_000;
/**
 * G4: the receipt wait is the one that killed V1 leases. Bounded here.
 *
 * HALVED FROM SIXTY SECONDS, AND THE REASON IS ARITHMETIC RATHER THAN TASTE.
 * This number is the dominant term of every worst case below, and those worst
 * cases have to fit inside RUN_BUDGET_MS or the guard that reserves them can
 * never be true — which is exactly what had happened to the prize stage: it
 * reserved 300_000 ms out of a 280_000 ms budget, so no run ever started a
 * prize and no prize was ever claimed or delivered. The ceiling on the budget is
 * the platform's 300-second maxDuration and cannot be raised, so the term that
 * had to come down is this one.
 *
 * Thirty seconds is still enormous for the chain this bridge signs on. Arbitrum
 * One produces a block roughly every 250 ms and the sequencer acknowledges an
 * accepted transaction in about one; thirty seconds is on the order of a hundred
 * blocks. A wait that does give up is not a lost transaction either — it stays
 * in the mempool, its hash is recorded, and reconcileSubmitted finishes it.
 */
export const RECEIPT_TIMEOUT_MS = 30_000;
/** G4: email and Telegram calls. */
export const HTTP_TIMEOUT_MS = 8_000;
/**
 * G4: the database is an external service like any other, and PostgREST answers
 * over HTTP. Every query carries this as an AbortSignal, so no request path can
 * wait on it for ever. Generous relative to the queries actually issued — all of
 * them are single-row or bounded-batch — because the point is a ceiling, not a
 * performance budget.
 */
export const DB_TIMEOUT_MS = 8_000;
/** G3: lease length, and the point at which a live operation renews it. */
export const FUNDER_LEASE_SECONDS = 90 as const;

// -----------------------------------------------------------------------------
// The scheduled run — G3, G4 and G6 as properties of the run, not of the code
// -----------------------------------------------------------------------------
/**
 * The `maxDuration` the cron functions declare, and the ceiling the Pro plan
 * allows for them.
 *
 * From Vercel's own documentation, "Functions > Configuring functions >
 * Duration" (vercel.com/docs/functions/configuring-functions/duration): the
 * default maximum duration is 300 seconds on every plan, and 300 seconds is also
 * the Pro plan's limit for a function that is not using Fluid compute — Hobby
 * caps at 300 with Fluid and 60 without, and Fluid on Pro raises the ceiling to
 * 800. 300 is therefore the highest number that is correct for this project
 * whichever way the account is configured, which is the property that matters
 * for a value the runtime enforces by killing the process.
 *
 * It is here as well as in vercel.json because the run has to know it. A budget
 * the code does not know is a budget the code cannot stay inside.
 */
export const CRON_MAX_DURATION_SECONDS = 300 as const;

/**
 * G4: when a run must stop starting new work.
 *
 * The platform kills a function at maxDuration wherever it happens to be, and
 * where it happens to be may be between a broadcast transaction and the row that
 * records its hash. The run therefore stops well before the ceiling, and the
 * margin is the length of the slowest single unit of work it could start — one
 * funding wait plus one submission wait, both bounded by RECEIPT_TIMEOUT_MS.
 */
export const RUN_BUDGET_MS = (CRON_MAX_DURATION_SECONDS - 20) * 1000;

/**
 * What one entry may cost: fund, wait for the receipt, submit, wait again, plus
 * the reads around them.
 *
 * WHAT THE TWO TERMS ARE, BECAUSE THEY ARE NOT THE SAME KIND OF NUMBER, and a
 * reservation that pretends they are is either useless or paralysing.
 *
 * The receipt waits are reserved in full. A slow transaction really does sit
 * there until the timeout expires; that is the ordinary shape of the slow case
 * and not a pathology, so 2 × RECEIPT_TIMEOUT_MS is a duration this path takes.
 *
 * The RPC term is an ALLOWANCE, and is named as one. processEligible makes nine
 * sequential round trips outside those two waits — hasEntered, readGiveaway,
 * slotsRemaining, the funder nonce reconciliation, the entry quote, the funding
 * estimate, the funding broadcast, the derived nonce, the entry broadcast — and
 * reserving nine RPC_TIMEOUT_MS would be reserving ninety seconds for calls that
 * answer in tens of milliseconds, because RPC_TIMEOUT_MS is the point at which a
 * call is abandoned and not a time anything is expected to take. Four of them is
 * forty seconds of slack over reads whose realistic total is under a second.
 *
 * And if the allowance is ever wrong, the failure is bounded and already handled:
 * the platform kills the run, the entry is left in FUNDING or SUBMITTED, and
 * reconcileFunding and reconcileSubmitted bring it back. Reserving the
 * pathological total instead would trade a rare recoverable interruption for a
 * pipeline that refuses to start work it could almost always finish.
 */
export const ENTRY_WORST_CASE_MS = 2 * RECEIPT_TIMEOUT_MS + 4 * RPC_TIMEOUT_MS;

/**
 * What one prize may cost, which is the largest unit the pipeline runs.
 *
 * A prize is two entry-shaped units back to back — claim, then delivery, each a
 * funding transaction with its receipt and a call with its receipt — plus the
 * reads that decide between them: the campaign, what the wallet is owed, whether
 * it has already been paid, and what is left in it to hand on. Eighteen
 * sequential round trips and four receipt waits, under the same split as above:
 * the four waits in full, the reads on an allowance.
 *
 * It used to be written at the call site as 2 * ENTRY_WORST_CASE_MS, which was
 * the right shape and the wrong number, because the number it produced was larger
 * than the budget it was checked against. It lives here now for the same reason
 * every other ceiling does: a budget written at its call site is a budget nobody
 * ever checks against the run it has to fit inside.
 */
export const PRIZE_WORST_CASE_MS = 2 * ENTRY_WORST_CASE_MS + 4 * RPC_TIMEOUT_MS;

/**
 * G4, checked rather than declared.
 *
 * Every stage of the pipeline reserves the size of one unit of its own work
 * before starting one, and a reservation larger than the whole budget is a stage
 * that can never start anything. That is not hypothetical: with a 60-second
 * receipt timeout the prize stage reserved 300_000 ms against a 280_000 ms
 * budget, the comparison was false on the first millisecond of every run, and the
 * stage that claims and delivers prizes never ran once. Nothing reported it,
 * because a stage that starts no work returns zero and looks exactly like a stage
 * with no work to do.
 *
 * A comment asserting that the numbers fit would have been just as wrong as the
 * numbers were. This is the same claim made executable: change any constant above
 * so that the largest unit no longer fits, and the first import of this module
 * throws instead of the pipeline quietly doing nothing.
 *
 * The values, since the point is that they are checked and not asserted:
 *
 *   RUN_BUDGET_MS        (300 - 20) * 1000        = 280_000
 *   ENTRY_WORST_CASE_MS  2 * 30_000 + 4 * 10_000  = 100_000
 *   PRIZE_WORST_CASE_MS  2 * 100_000 + 4 * 10_000 = 240_000
 *
 * and the reservation each stage actually makes, every one strictly under the
 * budget: 50_000 for a root publication and for one SUBMITTED reconciliation,
 * 20_000 for a FUNDING reconciliation, 50_000 for a sweep, 100_000 for an entry,
 * 240_000 for a prize. The largest of them leaves 40_000 ms of margin.
 */
export const LARGEST_UNIT_MS = PRIZE_WORST_CASE_MS;
if (LARGEST_UNIT_MS >= RUN_BUDGET_MS) {
  throw new Error(
    `[bridge-v2] run budget ${RUN_BUDGET_MS}ms cannot start the largest unit of ` +
      `work (${LARGEST_UNIT_MS}ms); no run would ever reach the prize stage`,
  );
}

/**
 * G6: how long a scheduled run may hold the pipeline lock.
 *
 * Exactly the maximum the platform lets the run live, plus a second. Shorter and
 * a live run's lock lapses under it, which is the funder lease bug of the V1
 * moved up one level; longer and a killed run blocks the pipeline past the point
 * where it can possibly still be running.
 */
export const RUN_LOCK_SECONDS = CRON_MAX_DURATION_SECONDS + 1;

/**
 * I8: how long an entry may sit in FUNDING before it is treated as abandoned.
 *
 * FUNDING is held only by a run that is inside processEligible, and a run cannot
 * outlive maxDuration. Anything older than that plus a margin belongs to a run
 * that no longer exists, and has no other path out.
 */
export const FUNDING_STALE_MS = (CRON_MAX_DURATION_SECONDS + 120) * 1000;

/**
 * H3: absolute ceiling on what one entry may cost in gas, in wei. A compromised
 * or anomalous RPC cannot make the bridge move more than this, whatever it
 * claims the gas price is. Arbitrum entry costs are far below it; this is a
 * sanity bound, not a budget.
 */
export const MAX_GAS_COST_WEI = 2n * 10n ** 14n;

/**
 * H4: the estimate must land inside one of these bands or the transaction fails
 * unspent.
 *
 * One band per shape of transaction, because no single pair of numbers is a
 * sanity check for both a bare value transfer and a call into the manager.
 *
 * Every signed transaction takes its limit from eth_estimateGas; there is no
 * constant gas limit anywhere. The 21_000 that used to be written into the two
 * value transfers was not even correct on this chain: eth_estimateGas on
 * Arbitrum One reports 21_299 for a zero-value transfer and 21_305 with a value,
 * measured 2026-09-06, because the L1 data component is folded into the number.
 * A transaction signed with a limit of 21_000 is a transaction that runs out of
 * gas, so the constant was not a saved round trip but a broken one.
 */
export const GAS_BANDS = {
  /** A bare value transfer: funding a derived wallet, and the sweep back. */
  TRANSFER: { min: 21_000n, max: 500_000n },
  /** A call into GiveawayManagerV2: enter, addEligibilityRoot, claimPrize. */
  MANAGER: { min: 40_000n, max: 2_000_000n },
  /**
   * Handing a prize on to the destination the winner confirmed: an ERC-20
   * transfer, or an ERC-721 safeTransferFrom. Measured on Arbitrum One
   * 2026-09-06: 45_637 for a USDC transfer to a cold address, 94_605 to 128_114
   * for safeTransferFrom across three live collections. The floor is below the
   * cheapest of those because the prize token is chosen by the campaign creator
   * and a minimal ERC-20 is cheaper than USDC.
   */
  DELIVERY: { min: 25_000n, max: 500_000n },
} as const;

export type GasBand = (typeof GAS_BANDS)[keyof typeof GAS_BANDS];

/** Margin over the estimate, so a price move between estimate and send does not strand the entry. */
export const GAS_MARGIN_NUMERATOR = 150n;
export const GAS_MARGIN_DENOMINATOR = 100n;

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
