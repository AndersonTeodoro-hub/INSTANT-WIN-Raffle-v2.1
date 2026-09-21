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

/**
 * The deployment descriptor, imported rather than described.
 *
 * G4 asks that every route with an external wait declare a duration the platform
 * will honour, and that duration is derived from the timeouts in this file. Two
 * files therefore have to agree about a number — and the last time two numbers in
 * this system had to agree, the prize reservation and the run budget, they did
 * not, and the stage that claims prizes never ran once. Importing the descriptor
 * is what turns "they agree" from a sentence in a comment into the check at the
 * bottom of this file.
 */
import vercelConfig from '../../vercel.json' with { type: 'json' };
import { IMAGE_LIMITS } from '../campaign-identity.js';

/** Arbitrum One. The bridge signs on no other chain. */
export const CHAIN_ID = 42161 as const;

/** GiveawayManagerV2, Arbitrum One. Verified on Sourcify (exact match). */
export const GIVEAWAY_MANAGER_V2 = '0xEA91eb545FBB7e82f0085ff30555ed06C1Baf739' as const;

/** USDC on Arbitrum One, 6 decimals. */
export const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const;
export const USDC_DECIMALS = 6 as const;

/**
 * SPEC-BLOCO-03 piece 5, Adenda P24: the escrow, the guarantee and the voucher of
 * pieces 2 and 3 (commit 183a2b4). Literals, as H1 wants every contract address —
 * and zero until the owner fills them in after the deploy. While any is zero
 * every route and cron step of the orders refuses with "configuration incomplete"
 * (keptraContractsConfigured in orders.ts), and the general rehearsal fails.
 */
export const KEPTRA_ESCROW: `0x${string}` = '0x0000000000000000000000000000000000000000';
export const KEPTRA_GUARANTEE: `0x${string}` = '0x0000000000000000000000000000000000000000';
export const KEPTRA_VOUCHER: `0x${string}` = '0x0000000000000000000000000000000000000000';
/**
 * The ERC721PrizeModule of GiveawayManagerV2 (Arbitrum One), the only module a
 * voucher can enter a campaign through (11.3, H9). The fork suite reads it back
 * from the core as registered and NFT.
 */
export const ERC721_PRIZE_MODULE = '0xafe9E198816DEa24e7f74e9D666c0F250aD688BC' as const;

// -----------------------------------------------------------------------------
// Creator-without-wallet campaign limits — mirrored from GiveawayManagerV2.sol
// so a bad request fails with 400 before it costs a wasted revert (I2).
// -----------------------------------------------------------------------------
export const CONTRACT_MIN_DURATION_SECONDS = 60 * 60;
export const CONTRACT_MAX_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const CONTRACT_MAX_WINNERS = 1_000;
export const CONTRACT_MIN_PARTICIPANTS = 10;
export const CONTRACT_MAX_PARTICIPANTS = 100_000;

/**
 * §18 M1: GiveawayManagerV2.DRAW_TIMEOUT and RESCUE_WINDOW (GiveawayManagerV2.sol
 * :98, :109). Constants of the deployed contract with no setter; contracts.test.mjs
 * reads both back from Arbitrum One, so a copy that drifts fails the suite.
 */
export const CONTRACT_DRAW_TIMEOUT_SECONDS = 24 * 60 * 60;
export const CONTRACT_RESCUE_WINDOW_SECONDS = 24 * 60 * 60;

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
  // SPEC-BLOCO-03 piece 5: one tracker created at the tracking provider (M9).
  // The minimum paid plan counts 1 000 a month; this keeps a runaway loop inside it.
  tracking: { hour: 30, day: 100 },
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
 * The RPC term is an ALLOWANCE, and is named as one. processEligible makes ten
 * sequential round trips outside those two waits — hasEntered, readGiveaway,
 * slotsRemaining, the funder nonce reconciliation, the entry quote, the balance
 * of the wallet about to be funded, the funding estimate, the funding broadcast,
 * the derived nonce, the entry broadcast — and reserving ten RPC_TIMEOUT_MS would
 * be reserving a hundred seconds for calls that
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
 * it has already been paid, and what is left in it to hand on. Twenty sequential
 * round trips and four receipt waits, under the same split as above: the four
 * waits in full, the reads on an allowance.
 *
 * It used to be written at the call site as 2 * ENTRY_WORST_CASE_MS, which was
 * the right shape and the wrong number, because the number it produced was larger
 * than the budget it was checked against. It lives here now for the same reason
 * every other ceiling does: a budget written at its call site is a budget nobody
 * ever checks against the run it has to fit inside.
 */
export const PRIZE_WORST_CASE_MS = 2 * ENTRY_WORST_CASE_MS + 4 * RPC_TIMEOUT_MS;

/**
 * What one step of creator/campaign/submit.ts costs: the quote, then the derived
 * wallet funded with its gas (its balance, the fee and estimate, the broadcast)
 * and that receipt awaited, the lease renewed, then the call itself (the nonce,
 * the broadcast) and its receipt. Three steps — approve the module, approve the
 * core, createGiveaway — each waited on in turn before the next is quoted.
 *
 * EACH RECEIPT IS AWAITED, DELIBERATELY, RATHER THAN ONLY THE LAST. createGiveaway
 * calls takeCustody, which reverts unless the module's allowance is already
 * satisfied — so quoting it (eth_estimateGas) before the approve that grants
 * that allowance is actually mined would estimate a revert, or would have to
 * ask the node to simulate against a pending state this side cannot rely on
 * being there. Waiting for each transaction before quoting the next is the
 * one ordering that is simply correct.
 *
 * SPEC-BLOCO-03 Adenda F7, as the owner decided on 19/09/2026: counted stage by
 * stage, three of these (six receipts, eighteen round trips) and the route
 * around them do NOT fit the platform's 300 seconds — the 270 declared before
 * counted four receipts and seven round trips. So the route budgets itself as
 * the crons do (RUN_BUDGET_MS) and starts a step only with CREATOR_SUBMIT_UNIT_MS
 * left; otherwise it answers "try again" and the campaign stays in FUNDING,
 * which a retry already resumes.
 */
export const CREATOR_SUBMIT_STEP_MS = 2 * RECEIPT_TIMEOUT_MS + 6 * RPC_TIMEOUT_MS + DB_TIMEOUT_MS;
/**
 * F7: what may follow a step before the route ends — a failure recorded and
 * alerted (event, alert, webhook), or the confirmation and its event; then the
 * funder lease released (and, if that fails, the funder disabled, an event and
 * an alert) and the creator's lock released.
 */
export const CREATOR_SUBMIT_TAIL_MS = 7 * DB_TIMEOUT_MS + 2 * HTTP_TIMEOUT_MS;
/** F7: the reservation a step of the submit starts under: the step and the tail after it. */
export const CREATOR_SUBMIT_UNIT_MS = CREATOR_SUBMIT_STEP_MS + CREATOR_SUBMIT_TAIL_MS;

/**
 * What each stage of the pipeline reserves before it starts one unit of its own
 * work, and — because the keys are the stage names — what the stages ARE.
 *
 * HERE RATHER THAN AT THE CALL SITES, and that is the fix rather than tidiness.
 * Every one of these numbers used to be written where it was used, and the prize
 * one was written there as 2 * ENTRY_WORST_CASE_MS: 300_000 ms against a 280_000
 * ms budget, false on the first millisecond of every run, so the stage that
 * claims and delivers prizes never ran its body once and nothing said so. A
 * reservation kept beside the budget it has to fit inside is a reservation
 * somebody can check, which is what happens below.
 *
 * The key set is the phase set as well. api/bridge/v2/cron/process.ts builds its
 * run out of these keys, so a stage cannot exist without a declared reservation
 * and a reservation cannot be declared for a stage the run does not have.
 */
export const PHASE_RESERVATION_MS = {
  /** One SUBMITTED entry: a bounded receipt wait, then the reads about its hash. */
  reconcileSubmitted: RECEIPT_TIMEOUT_MS + 2 * RPC_TIMEOUT_MS,
  /** One abandoned FUNDING entry: hasEntered, and the transition that follows it. */
  reconcileFunding: 2 * RPC_TIMEOUT_MS,
  /** One campaign: a manager transaction and its receipt. */
  publishRoots: RECEIPT_TIMEOUT_MS + 2 * RPC_TIMEOUT_MS,
  /** One entry: fund, wait, submit, wait. */
  processEntries: ENTRY_WORST_CASE_MS,
  /**
   * §18: one lifecycle transition — the head read, one page of campaigns, the
   * keeper account, the quote, the broadcast, and a receipt wait. Before the
   * prizes, because a settled campaign is the prize stage's input.
   */
  advanceLifecycle: RECEIPT_TIMEOUT_MS + 5 * RPC_TIMEOUT_MS,
  /** One prize: a claim and a delivery, each funded and each awaited. */
  processPrizes: PRIZE_WORST_CASE_MS,
} as const;

export type PipelinePhase = keyof typeof PHASE_RESERVATION_MS;

/**
 * 07/09/2026 decision: what one self-custody ELIGIBLE entry costs to
 * reconcile — hasEntered, and the transition that follows it. No receipt
 * wait, because the bridge never signs for this wallet; it only asks the
 * chain whether the participant has entered on their own.
 *
 * NOT a pipeline phase of its own. It runs inside processEligibleEntries,
 * under the processEntries reservation, which is far larger per item (a
 * funding transfer and a submission, each awaited) than this ever costs — so
 * borrowing that budget cannot starve it. A seventh phase would have meant a
 * seventh name in the rotation the G4 tests fix at six; this keeps the
 * rotation exactly as it is while still reconciling these entries every run.
 */
export const SELF_CUSTODY_RECONCILE_MS = 2 * RPC_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 A4: a Keptra-account entry reconciles like a self-custody one
 * and may also send its one "confirm your entry" email — the campaign read, the
 * root's publication time, the spend claim, the reminder claim, the email
 * address and the post. Runs under the processEntries reservation for the same
 * reason SELF_CUSTODY_RECONCILE_MS does, and is checked against the budget below.
 */
export const PASSKEY_ENTRY_RECONCILE_MS = 3 * RPC_TIMEOUT_MS + HTTP_TIMEOUT_MS + 6 * DB_TIMEOUT_MS;

/**
 * A4: how long after its root is published a Keptra-account entry waits before
 * the email is sent. The page asks for the passkey the moment the root lands; a
 * participant still looking at it should not also be emailed about it.
 */
export const ENTER_REMINDER_DELAY_MS = 10 * 60 * 1000;

/**
 * What one settlement notice costs: the two reads that decide whether a wallet
 * won, the one email, and the writes around them. It signs nothing and waits for
 * no receipt.
 *
 * NOT a pipeline phase, for the reason stated directly above: a seventh name in
 * the rotation changes the bound the G4 tests fix at six. It runs inside
 * processPrizes, the stage about campaigns that have settled — and after its
 * queue, because 240_000 + 52_000 does not fit in a 280_000 ms run and whichever
 * goes first takes the budget.
 */
export const SETTLEMENT_NOTICE_MS = 2 * RPC_TIMEOUT_MS + HTTP_TIMEOUT_MS + 3 * DB_TIMEOUT_MS;

/**
 * The phases in their declared order, which is the order a run prefers: the two
 * reconciliations first, so an entry that has already landed is not looked at
 * again by the stages behind them; prizes last, because they are the one stage
 * whose input a third party produces.
 *
 * A run rotates this list. It never reorders it, and it never skips an entry of
 * it — correctness never depended on the order, because every stage is
 * conditional on the state it expects (G5) and none of them is the input of the
 * next within a single run.
 */
export const PIPELINE_PHASES = Object.keys(PHASE_RESERVATION_MS) as readonly PipelinePhase[];

/**
 * §7/G4: the starvation bound, declared here so it can be checked below rather
 * than hoped for at the call site.
 *
 * A FIXED ORDER OVER A BUDGET SMALLER THAN THE SUM OF THE RESERVATIONS IS
 * STARVATION BY CONSTRUCTION. The six reservations add up to 540_000 ms against
 * a 280_000 ms budget, and the largest of them, 240_000 ms for a prize, was
 * declared last. Under continuous load the four stages in front of it consume the
 * budget and the guard on the fifth is false every single time — the same outage
 * as the arithmetic bug this file already records, reached by scheduling instead
 * of by a wrong number, and just as silent: a stage that starts no work returns
 * zero and looks exactly like a stage with nothing to do.
 *
 * The run therefore starts at a different phase each time, advancing by one per
 * run, so each phase leads a run once in this many consecutive runs and a phase
 * that leads has the entire budget to itself. That last clause is the part that
 * has to be true rather than asserted, and it is what the loop below checks: a
 * leading phase can start one unit only if its own reservation fits inside the
 * whole budget.
 */
export const PHASE_STARVATION_BOUND_RUNS = PIPELINE_PHASES.length;

/**
 * H7: what the sweep reserves per wallet — four reads and a broadcast, with no
 * receipt wait.
 *
 * Not a pipeline phase: it runs on the maintenance schedule, borrowing the
 * pipeline's lock for the one thing in that route that signs as a derived wallet.
 * It is checked against the budget with the others because it is a unit of work
 * bounded by the same run budget, and a reservation nobody checks is how the
 * prize stage disappeared.
 */
export const SWEEP_WORST_CASE_MS = 5 * RPC_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 6.6 and Adenda C1: what the migration reserves before it moves
 * ONE asset of a derived wallet into its account — gas to the wallet and the
 * transfer, both awaited, which is the shape of an entry — plus the reads that
 * check the account is ready to receive it (C4).
 *
 * Per asset and not per wallet. The reservation it replaces was three assets at
 * once, 360_000 ms against this 280_000 ms budget: false on the first
 * millisecond of every run, so no balance was ever moved — the prize stage's
 * outage again, which is why it is declared here and checked below.
 */
export const MIGRATION_ASSET_MS = ENTRY_WORST_CASE_MS + 2 * RPC_TIMEOUT_MS;
/**
 * C1: closing one migrated wallet — the sweep of its remaining ETH (H7) and the
 * reads that decide whether it may be sealed (A8): what it still holds, and the
 * rights still tied to it.
 */
export const MIGRATION_SEAL_MS = SWEEP_WORST_CASE_MS + 4 * RPC_TIMEOUT_MS + 2 * DB_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 6.3 and C1: one recovery request confirmed — the new signer
 * created, then one guardian confirmation per account (two, A10), each awaited.
 */
export const RECOVERY_CONFIRM_MS = 3 * (RECEIPT_TIMEOUT_MS + 3 * RPC_TIMEOUT_MS);
/** C1: one confirmed request advanced — its state reads and one finalisation, awaited (R-6). */
export const RECOVERY_ADVANCE_MS = RECEIPT_TIMEOUT_MS + 4 * RPC_TIMEOUT_MS;
/**
 * One alert: its event and the webhook post (alert.ts). A building block of the
 * reservations below, and a reservation of its own where an alert is all a
 * maintenance check still has to do.
 */
export const ALERT_MS = DB_TIMEOUT_MS + HTTP_TIMEOUT_MS;
/**
 * C1, C10: one page of accounts read for a recovery nobody registered — the page,
 * every account's state (two stages), and the alert the scan may end with
 * (Adenda F7: the alert is inside the reservation, not after it).
 */
export const RECOVERY_SCAN_MS = DB_TIMEOUT_MS + 2 * RPC_TIMEOUT_MS + ALERT_MS;
/**
 * SPEC-BLOCO-03 Adenda E3: one account the relay sent for and nobody marked
 * deployed — its state read from the chain, the owner's passkeys, the mark — plus
 * its share of the page it came in.
 */
export const ACCOUNT_RECOGNITION_MS = 2 * RPC_TIMEOUT_MS + 3 * DB_TIMEOUT_MS;
/**
 * SPEC-BLOCO-03 Adenda F5: pages of campaigns (LIFECYCLE_SCAN_PAGE each) read
 * back from the newest when the chain is asked whether a creator account created
 * a campaign since a draft. A search that does not reach the draft releases
 * nothing.
 */
export const CAMPAIGN_SCAN_PAGES = 5;

/**
 * SPEC-BLOCO-03 Adenda E7 and F5: one campaign the relay left in FUNDING — its
 * creator read (up to three stages), then either a bounded wait for its receipt
 * and the node asked about the hash, or, with no hash (F5), the newest id and up
 * to CAMPAIGN_SCAN_PAGES pages of campaigns and the ids already registered —
 * whichever is longer — then the transition and its event.
 */
export const CAMPAIGN_RECONCILE_MS =
  Math.max(RECEIPT_TIMEOUT_MS + RPC_TIMEOUT_MS, (1 + CAMPAIGN_SCAN_PAGES) * RPC_TIMEOUT_MS) + 6 * DB_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 Adenda F1: one page of accounts read for the guardian each holds
 * on-chain — the page, then every account's state concurrently (two stages).
 */
export const GUARDIAN_SCAN_MS = 2 * RPC_TIMEOUT_MS + DB_TIMEOUT_MS;
/** F1: one recorded guardian brought into line with the chain, and its event. */
export const GUARDIAN_RECORD_MS = 2 * DB_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 Adenda F2: a draft in PENDING_DEPOSIT whose deposit address holds
 * none of either token this long after it was made is closed (EXPIRED).
 */
export const DRAFT_DEPOSIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** F2: one such draft — its creator read (up to three stages), two balances, the transition, the event. */
export const DRAFT_EXPIRY_MS = 2 * RPC_TIMEOUT_MS + 5 * DB_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 Adenda E1, F3, F6: one derived wallet looked at for seed
 * readiness — what it holds and what the ETH would cost to sweep, and its rights.
 * Reads only, an ALLOWANCE in ENTRY_WORST_CASE_MS's sense: a wallet with many
 * entries reads more, and a pass cut short answers "not ready" (F4).
 */
export const READINESS_WALLET_MS = 6 * RPC_TIMEOUT_MS + 3 * DB_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 Adenda F7, as the owner decided on 19/09/2026: EVERY step of the
 * maintenance pass starts only with its reservation left, the checks of H8
 * included, so that past the budget nothing runs but the pass's last event and
 * its lock released — two stages, inside the twenty seconds RUN_BUDGET_MS leaves
 * under the platform's ceiling. A step that does not start is reported as null,
 * as a check that could not run always was.
 *
 * The pass's budget is RUN_BUDGET_MS less one stage: the pipeline lock it
 * borrows for the sweep and the migration is released after their last unit,
 * and that release is reserved here rather than left past the budget.
 */
export const MAINTENANCE_BUDGET_MS = RUN_BUDGET_MS - DB_TIMEOUT_MS;
/** F7: the retention function, its event, and the failure event if it throws. */
export const CLEANUP_MS = 3 * DB_TIMEOUT_MS;
/** F7 and F10: the two deletes of the relay's counting tables, the event, the failure event. */
export const RELAY_RETENTION_MS = 4 * DB_TIMEOUT_MS;
/** F7 and C3: the expiry statement, its event, the failure event. */
export const RECOVERY_EXPIRY_MS = 3 * DB_TIMEOUT_MS;
/** F7 and E4: the reservations a dead pass left, given back, and the failure event. */
export const RECOVERY_RELEASE_MS = 2 * DB_TIMEOUT_MS;
/** F7 and H8: one funder's balance, the alert it may raise, the failure event. Checked per funder. */
export const FUNDER_CHECK_MS = RPC_TIMEOUT_MS + ALERT_MS + DB_TIMEOUT_MS;
/** F7 and H8: the subscription's coordinator and id, its balance, the alert, the failure event. */
export const VRF_CHECK_MS = 2 * RPC_TIMEOUT_MS + ALERT_MS + DB_TIMEOUT_MS;
/** F7 and H8: the day's spend read, one alert per provider at most, the failure event. */
export const SPEND_CHECK_MS = 2 * DB_TIMEOUT_MS + Object.keys(SPEND_CAPS).length * ALERT_MS;
/** F7 and H8: the hour's route errors read, the first alert, the failure event; each further alert is ALERT_MS of its own. */
export const ROUTE_ERRORS_CHECK_MS = 2 * DB_TIMEOUT_MS + ALERT_MS;
/** F7 and H8: one read of the contract (the bridge role, the pause), its alert, the failure event. */
export const CHAIN_CHECK_MS = RPC_TIMEOUT_MS + ALERT_MS + DB_TIMEOUT_MS;
/** F7 and M39: the role keys compared (no stage), the alert, the failure event. */
export const ROLE_KEYS_CHECK_MS = ALERT_MS + DB_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 Adenda F7, as the owner decided on 19/09/2026: the part of a
 * relayed submission that cannot be taken back once begun, which account/relay
 * starts only with this much of its own budget (RUN_BUDGET_MS, from the moment
 * the request arrived) left. Counted over the action that needs most of it:
 *
 *   database, 17: the transaction counted and counted again (E2), the draft or
 *   the guardian change recorded, the spend claimed, the funder leased and its
 *   nonce reconciled (two), the hash on the draft, the lease released — and if
 *   that fails the funder disabled, an event and an alert (three) — the account
 *   read back (two) and its alert, the campaign confirmed and its event (two),
 *   and the last event;
 *   RPC, 5: the funder's nonce, the fee with the estimate, the broadcast, and
 *   the account read back (two);
 *   HTTP, 2: the two alerts' webhook; and one receipt wait.
 *
 * A receipt that does not come within its wait leaves the state for E3 and E7.
 */
export const RELAY_SEND_MS = RECEIPT_TIMEOUT_MS + 5 * RPC_TIMEOUT_MS + 17 * DB_TIMEOUT_MS + 2 * HTTP_TIMEOUT_MS;

/**
 * SPEC-BLOCO-03 Adenda F10: bridge_v2_relayed_transactions and
 * bridge_v2_guardian_changes keep no row older than this. Each count reads 24
 * hours; the maintenance pass removes the rest.
 */
export const RELAY_RECORD_RETENTION_DAYS = 7;

/**
 * SPEC-BLOCO-03 Adenda C11: the guardians the relayer pays to add back to one
 * account in 24 hours. Above it, the relay refuses. A revocation is not counted
 * and never refused (Adenda E2: the reaction to a compromise is always possible);
 * every revocation needs a guardian added before it, so this still bounds them.
 */
export const GUARDIAN_CHANGES_PER_DAY = 3;

/**
 * SPEC-BLOCO-03 Adenda E2: the transactions the relayer pays for on one account
 * in 24 hours. Above it, the relay refuses — except the cancellation of a
 * recovery and the reaction to a compromise, which no limit stops.
 */
export const RELAYED_TRANSACTIONS_PER_DAY = 20;

/**
 * SPEC-BLOCO-03 Adenda D3: a change of access that has not reached CONFIRMED
 * this long after it was opened stops blocking a new one, with an alert.
 */
export const RECOVERY_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// SPEC-BLOCO-03 piece 5 — the orders
// -----------------------------------------------------------------------------
/** KeptraEscrow.CONTEST_WINDOW and ARBITER_WINDOW, constants of the contract (read back in the fork suite). */
export const ESCROW_CONTEST_WINDOW_SECONDS = 5 * 24 * 60 * 60;
export const ESCROW_ARBITER_WINDOW_SECONDS = 5 * 24 * 60 * 60;
/** 8.3: the recipient is told this long before the window closes. */
export const WINDOW_CLOSING_NOTICE_SECONDS = 24 * 60 * 60;
/**
 * 10.3: the address, the tracking number and the evidence are erased this long
 * after the order's final state. A day short of the thirty 10.3 allows, so an
 * hourly pass that runs late is still inside it.
 */
export const ERASE_AFTER_CLOSE_DAYS = 29;
/** H7 and I6: how long the bridge's redemption attestation is good for — one prepare and its submit. */
export const REDEMPTION_ATTESTATION_TTL_SECONDS = 60 * 60;
/** P17: one text per party, at most this long. */
export const EVIDENCE_MAX_CHARS = 2_000;
/** P17: how old the arbiter's signed request may be, and how far ahead of this clock. */
export const ARBITER_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
/** P19: the longest a field of an address may be. */
export const ADDRESS_FIELD_MAX_CHARS = 200;
/** P23-3: an offer or obligation names at most this many countries. */
export const REGIONS_MAX = 60;
/**
 * M7 and B4 of piece 4: the oracle reads the first 13 orders of the list. The list
 * holds only that many, rotated once per schedule slot of the workflow (15
 * minutes), so every order is asked about within ceil(n / 13) slots.
 */
export const ORACLE_PENDING_PAGE = 13;
export const ORACLE_ROTATION_SECONDS = 15 * 60;
/**
 * P1: the vouchers one relayed campaign may deposit. takeCustody moves each with
 * safeTransferFrom (about 100 000 gas apiece), and the batch has to fit the
 * relayer's ACCOUNT band. ponytail: a larger obligation runs several campaigns.
 */
export const VOUCHER_CAMPAIGN_MAX_ITEMS = 20;
/** Orders per multicall page, two reads each (getOrder, getTerms). */
export const ORDER_SCAN_PAGE = 50;

/**
 * P12: what one pass over the orders reserves before a unit — the order count and
 * the latest block, one page of orders and their terms, the rows written, and the
 * outcome of an order seen closing (its OrderClosed log) with its mark released.
 */
export const ORDER_SCAN_MS = 3 * RPC_TIMEOUT_MS + 4 * DB_TIMEOUT_MS;
/** P11 and P12: one exit by time signed by the keeper — the account read, the quote, the broadcast, the receipt. */
export const ORDER_EXIT_MS = RECEIPT_TIMEOUT_MS + 5 * RPC_TIMEOUT_MS;
/** P11: one page of vouchers read for the ones the core can no longer deliver (ownership, the clocks, itemsOf). */
export const VOUCHER_SCAN_MS = 3 * RPC_TIMEOUT_MS + DB_TIMEOUT_MS;
/**
 * 13.1, P5, P14: one recipient marked — the payer's and the store's accounts and
 * numbers, the mark reserved, the spend claimed, the bridge role's transaction
 * and its receipt, the mark recorded.
 */
export const ORDER_MARK_MS = RECEIPT_TIMEOUT_MS + 4 * RPC_TIMEOUT_MS + 8 * DB_TIMEOUT_MS;
/** 8.3, P4, P22: one notice — the address to send to, the spend, the email, the record. */
export const ORDER_NOTICE_MS = HTTP_TIMEOUT_MS + 4 * DB_TIMEOUT_MS;
/** 10.3: the erasure of what outlived its orders — four deletes and the event. */
export const ORDER_ERASURE_MS = 5 * DB_TIMEOUT_MS;
/** 9.5.5: one tracker the provider did not take, asked again — the shipment, the address, the spend, the post, the row. */
export const TRACKER_RETRY_MS = HTTP_TIMEOUT_MS + 4 * DB_TIMEOUT_MS;

/**
 * G4 and §7/G4, checked rather than declared.
 *
 * A reservation larger than the whole budget is a unit of work that can never
 * start. That is not hypothetical: with a 60-second receipt timeout the prize
 * stage reserved 300_000 ms against a 280_000 ms budget, the comparison was false
 * on the first millisecond of every run, and no prize was ever claimed or
 * delivered.
 *
 * A comment asserting that the numbers fit would have been just as wrong as the
 * numbers were. This is the same claim made executable, and it is now made about
 * EVERY unit rather than only the largest one — because with the rotation above,
 * "the largest fits" is no longer the property that matters. What matters is that
 * each phase, on the run it leads, can start one unit; a single phase whose
 * reservation exceeded the budget would be starved for ever however the run is
 * ordered, and PHASE_STARVATION_BOUND_RUNS would be a number that means nothing.
 *
 * The values, since the point is that they are checked and not asserted:
 *
 *   RUN_BUDGET_MS        (300 - 20) * 1000        = 280_000
 *   ENTRY_WORST_CASE_MS  2 * 30_000 + 4 * 10_000  = 100_000
 *   PRIZE_WORST_CASE_MS  2 * 100_000 + 4 * 10_000 = 240_000
 *
 * and every reservation, each strictly under the budget: 50_000 for a root
 * publication and for one SUBMITTED reconciliation, 20_000 for a FUNDING
 * reconciliation, 50_000 for a sweep, 100_000 for an entry, 80_000 for a lifecycle
 * transition, 240_000 for a prize; and in the maintenance pass (C1) 120_000 for
 * one migrated asset, 106_000 for sealing a migrated wallet, 180_000 for a
 * recovery confirmation, 70_000 for advancing one, 44_000 for a page of the
 * recovery scan, 44_000 for recognising one account (E3), 108_000 for one
 * campaign left in FUNDING (E7, F5), 28_000 for a page of the guardian scan and
 * 16_000 for one guardian recorded (F1), 60_000 for one unfunded draft (F2),
 * 84_000 for one wallet of the seed readiness (E1, F6), and in the pipeline
 * 20_000 for a self-custody entry; the steps of F7 — 16_000 for an alert,
 * 24_000 for the cleanup, 32_000 for the relay's retention, 24_000 and 16_000
 * for the two recovery bookkeeping steps, 34_000 per funder, 44_000 for the VRF,
 * 64_000 for the spend, 32_000 for the route errors, 34_000 per contract read,
 * 24_000 for the role keys — and the two routes that budget themselves: 232_000
 * for a relayed submission's tail and 184_000 for one step of the creator submit.
 * The largest leaves 40_000 ms of margin, and every one fits the maintenance
 * pass's own budget (MAINTENANCE_BUDGET_MS, 272_000) as well. SPEC-BLOCO-03
 * piece 5 adds, in the pipeline, 62_000 for a page of the orders scan, 80_000
 * for one exit by the keeper, 38_000 for a page of vouchers, 134_000 for one
 * recipient mark and 40_000 for one notice; and in the maintenance pass 40_000
 * for the erasure and 40_000 for one tracker asked again.
 *
 * Adenda C1 as F8 extends it: EVERY reservation a maintenance step passes to
 * hasTimeFor — in any file the maintenance route reaches — is in this map. The
 * keptra suite checks the source for it, so a reservation written at a call site
 * again fails a test rather than a run.
 */
export const EVERY_RESERVATION_MS: Record<string, number> = {
  ...PHASE_RESERVATION_MS,
  sweep: SWEEP_WORST_CASE_MS,
  // Not a phase, checked anyway: the unit that disappeared was the one whose
  // reservation nobody compared against the budget.
  settlementNotice: SETTLEMENT_NOTICE_MS,
  passkeyEntry: PASSKEY_ENTRY_RECONCILE_MS,
  migrationAsset: MIGRATION_ASSET_MS,
  migrationSeal: MIGRATION_SEAL_MS,
  recoveryConfirm: RECOVERY_CONFIRM_MS,
  recoveryAdvance: RECOVERY_ADVANCE_MS,
  recoveryScan: RECOVERY_SCAN_MS,
  accountRecognition: ACCOUNT_RECOGNITION_MS,
  campaignReconcile: CAMPAIGN_RECONCILE_MS,
  guardianScan: GUARDIAN_SCAN_MS,
  guardianRecord: GUARDIAN_RECORD_MS,
  draftExpiry: DRAFT_EXPIRY_MS,
  readinessWallet: READINESS_WALLET_MS,
  selfCustodyEntry: SELF_CUSTODY_RECONCILE_MS,
  // Adenda F7: every other step of the maintenance pass, and the two routes that
  // budget themselves like the crons.
  alert: ALERT_MS,
  cleanup: CLEANUP_MS,
  relayRetention: RELAY_RETENTION_MS,
  recoveryExpiry: RECOVERY_EXPIRY_MS,
  recoveryRelease: RECOVERY_RELEASE_MS,
  funderCheck: FUNDER_CHECK_MS,
  vrfCheck: VRF_CHECK_MS,
  spendCheck: SPEND_CHECK_MS,
  routeErrorsCheck: ROUTE_ERRORS_CHECK_MS,
  chainCheck: CHAIN_CHECK_MS,
  roleKeysCheck: ROLE_KEYS_CHECK_MS,
  relaySend: RELAY_SEND_MS,
  creatorSubmitUnit: CREATOR_SUBMIT_UNIT_MS,
  // SPEC-BLOCO-03 piece 5: the orders pass (under advanceLifecycle) and its two maintenance steps.
  orderScan: ORDER_SCAN_MS,
  orderExit: ORDER_EXIT_MS,
  voucherScan: VOUCHER_SCAN_MS,
  orderMark: ORDER_MARK_MS,
  orderNotice: ORDER_NOTICE_MS,
  orderErasure: ORDER_ERASURE_MS,
  trackerRetry: TRACKER_RETRY_MS,
};

export const LARGEST_UNIT_MS = Math.max(...Object.values(EVERY_RESERVATION_MS));

if (LARGEST_UNIT_MS >= MAINTENANCE_BUDGET_MS) {
  throw new Error(
    `[bridge-v2] the maintenance budget ${MAINTENANCE_BUDGET_MS}ms cannot start its largest unit (${LARGEST_UNIT_MS}ms)`,
  );
}

for (const [unit, reservation] of Object.entries(EVERY_RESERVATION_MS)) {
  if (reservation >= RUN_BUDGET_MS) {
    throw new Error(
      `[bridge-v2] run budget ${RUN_BUDGET_MS}ms cannot start one unit of ${unit} ` +
        `(${reservation}ms); that work would never run and no run would report it`,
    );
  }
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
  /**
   * §18 M7: the four lifecycle calls the keeper signs. The floor is the intrinsic
   * cost, because expireDrawRequest writes two fields and nothing else. The ceiling
   * sits above the largest finalizeWinners batch the contract suite measures,
   * 4_119_922 execution gas for FINALIZE_STEPS winners, which MANAGER does not
   * admit. Measured on Arbitrum One for campaign #2 (13/09/2026): closeGiveaway
   * 46_598, requestDraw 128_358, finalizeWinners with two winners 196_781.
   */
  LIFECYCLE: { min: 21_000n, max: 6_000_000n },
  /**
   * SPEC-BLOCO-03 6.1.5: what the relayer sends for a Keptra account — the
   * account's creation batched with its first transaction, a relayed
   * execTransaction, a guardian confirmation, a finalisation. The ceiling admits
   * a campaign created from an account (two approvals and createGiveaway in one
   * batch) with the account's creation in front of it; the floor is intrinsic.
   */
  ACCOUNT: { min: 21_000n, max: 3_000_000n },
  /**
   * SPEC-BLOCO-03 13.1: markVerifiedRecipient, the bridge role's one escrow call —
   * a flag and an event. The floor is intrinsic; MANAGER's 40 000 would refuse it.
   */
  ESCROW_ROLE: { min: 21_000n, max: 500_000n },
} as const;

export type GasBand = (typeof GAS_BANDS)[keyof typeof GAS_BANDS];

/** Margin over the estimate, so a price move between estimate and send does not strand the entry. */
export const GAS_MARGIN_NUMERATOR = 150n;
export const GAS_MARGIN_DENOMINATOR = 100n;

/**
 * §18 M7: the keeper's ceiling per transaction, in wei.
 *
 * MAX_GAS_COST_WEI is sized for an entry. A full finalizeWinners batch reaches it
 * at an ordinary fee — 4_119_922 × 1.5 × 0.024 gwei is already 1.48e14 of its
 * 2e14 — and past 0.032 gwei every batch would be refused. This admits the same
 * batch up to about 0.16 gwei, eight times the fee of 15/09/2026. Above it the
 * transition is deferred and alerted on every run, never sent and never silent.
 */
export const LIFECYCLE_MAX_GAS_COST_WEI = 10n ** 15n;

/**
 * §18 M6: the gas each kind of transition is counted at when the keeper's balance
 * is compared with what it still has to send. The measured cost with the gas
 * margin, rounded up, and finalizeWinners at a full batch — generous on purpose,
 * because this number decides when an alert arrives, and early is the safe side.
 * expireDrawRequest has no measurement and writes two fields; 100_000 is three
 * times what that costs.
 */
export const LIFECYCLE_GAS_RESERVE = {
  closeGiveaway: 200_000n,
  requestDraw: 250_000n,
  expireDrawRequest: 100_000n,
  finalizeWinners: 6_200_000n,
} as const;

/** The four transitions, named by the function the keeper calls. */
export type LifecycleAction = keyof typeof LIFECYCLE_GAS_RESERVE;

/** §18 M1: campaigns per multicall page, two reads each. */
export const LIFECYCLE_SCAN_PAGE = 100;

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

// -----------------------------------------------------------------------------
// L — campaign identity (§17)
// -----------------------------------------------------------------------------
/** L5: the Storage bucket the images live in. 0011 creates it. */
export const IDENTITY_BUCKET = 'campaign-identity' as const;
/**
 * L3: how long after it is made a signature is still accepted. Long enough to
 * pick two images and wait for a slow wallet; short enough that a signature
 * found later in a log or a proxy is worth nothing.
 */
export const IDENTITY_SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;
/** L3: how far ahead of this clock a signature's instant may be, for a device clock that runs fast. */
export const IDENTITY_SIGNATURE_MAX_SKEW_MS = 2 * 60 * 1000;
/**
 * L6/I10: how long a spent nonce is kept. A day against a ten-minute window, and
 * the window is what makes that enough: an older signature is refused before the
 * nonce ledger is ever asked.
 */
export const IDENTITY_NONCE_RETENTION_SECONDS = 24 * 60 * 60;
/** L7: the most campaigns one read may name. The list page shows thirty. */
export const IDENTITY_READ_MAX_IDS = 30 as const;
/**
 * I3 for the one route that takes files: both images at their ceilings, plus the
 * payload. About 2.6 MB, under the 4.5 MB the platform accepts as a request body.
 */
export const IDENTITY_MAX_BODY_BYTES = IMAGE_LIMITS.banner.maxBytes + IMAGE_LIMITS.logo.maxBytes + 64 * 1024;
/** G4: one image upload. Longer than HTTP_TIMEOUT_MS, because it carries up to 2 MB. */
export const STORAGE_TIMEOUT_MS = 15_000;

// -----------------------------------------------------------------------------
// G4 — the duration every route with an external wait declares
// -----------------------------------------------------------------------------
/**
 * A route's worst case, from the stages it can actually wait on.
 *
 * Every term is a ceiling and none is an expectation, for the reason
 * DB_TIMEOUT_MS already gives: the timeout is the point at which a call is
 * abandoned, not a time anything is expected to take. A route's declared duration
 * has to be a ceiling too, because the platform enforces it by killing the
 * process — and a process killed mid-route is the shape of failure this whole
 * file exists to bound.
 *
 * An RPC stage is one round trip or one Promise.all of them, since concurrent
 * calls share a timeout. A database stage is one PostgREST request. An HTTP stage
 * is one post bounded by HTTP_TIMEOUT_MS: an alert's webhook, for these routes.
 */
function maxDurationSeconds(rpcStages: number, dbStages: number, httpStages = 0): number {
  return Math.ceil((rpcStages * RPC_TIMEOUT_MS + dbStages * DB_TIMEOUT_MS + httpStages * HTTP_TIMEOUT_MS) / 1000);
}

/**
 * What each route declares to the platform, and what vercel.json must say.
 *
 * ONLY THE TWO CRONS DECLARED ANYTHING, and the reason that was wrong is not that
 * the other routes are fast. entry/start reads the campaign and then its slot
 * ledger — two RPC stages, 20_000 ms of ceiling — around a dozen and a half
 * database requests each bounded at 8_000 ms, and it does that while a
 * participant waits. G4 says no external wait is unbounded; a route whose own
 * bounds add up past the duration the platform allows it is a route the platform
 * kills in the middle, which is unbounded from the participant's side and leaves
 * a half-written entry from the bridge's.
 *
 * Derived, not chosen. Change RPC_TIMEOUT_MS or DB_TIMEOUT_MS and these numbers
 * move with them, and the check below fails until vercel.json is brought back
 * into line.
 *
 * SPEC-BLOCO-03 Adenda F7: every route that reaches the chain is here (the keptra
 * suite follows each route's imports to chain.ts and keptraChain.ts), and every
 * number is recounted from the stages the route really makes — the database
 * stages always include the envelope's event (http.ts) for a route that throws
 * after its own. A route whose stages add up past the platform's ceiling does not
 * declare a sum it cannot keep: it declares the ceiling and budgets itself
 * against RUN_BUDGET_MS from the moment the request arrives, starting its
 * irreversible part only when that part fits (the crons, account/relay,
 * creator/campaign/submit).
 */
export const ROUTE_MAX_DURATION_SECONDS: Record<string, number> = {
  // Budgeted: every step starts only with its reservation left (PHASE_RESERVATION_MS,
  // MAINTENANCE_BUDGET_MS and the steps above), and past the budget only the last
  // event and the lock's release remain — two stages, inside the twenty seconds.
  'api/bridge/v2/cron/process.ts': CRON_MAX_DURATION_SECONDS,
  'api/bridge/v2/cron/maintenance.ts': CRON_MAX_DURATION_SECONDS,
  // Two RPC stages: readGiveaway, whose two reads are concurrent, and
  // slotsRemaining. Seventeen database stages: the session read and its A4
  // slide, six rate-limit axes, the participant read, the account read (6.5),
  // the entry lookup, its insert and the re-read a lost unique-constraint race
  // takes, the custody policy upsert, the link code insert, the ops event, and
  // the envelope's.
  'api/bridge/v2/entry/start.ts': maxDurationSeconds(2, 17),
  // Three RPC stages: hasEntered, then readGiveaway and slotsRemaining. Ten
  // database stages: the session read and slide, four rate-limit axes, the entry
  // lookup, the transition, its event, and the envelope's.
  'api/bridge/v2/entry/resume.ts': maxDurationSeconds(3, 10),
  // Six RPC stages, each awaited on its own: isModuleRegistered, modulePrizeKind,
  // the creator account's state (two, readAccount), currentFee, pricePerSlot.
  // Eighteen database stages: the session read and slide, three rate-limit axes,
  // the phone check, the creator read (one; three for a sealed creator), the
  // account read and the two readAccount may write, get-or-create's read, account
  // read, insert and the re-read a lost race takes, the active-draft check, the
  // draft insert, the ops event, and the envelope's.
  'api/bridge/v2/creator/campaign/start.ts': maxDurationSeconds(6, 18),
  // Two RPC stages: the creator account's state (readAccount). Fourteen database
  // stages: the session read and slide, three rate-limit axes, the creator read
  // (up to three: the row, whether its index is sealed, the account a sealed one
  // is shown as), the latest campaign, the ops event, the account read and the two
  // readAccount may write, and the envelope's.
  'api/bridge/v2/creator/campaign/status.ts': maxDurationSeconds(2, 14),
  // Budgeted: see CREATOR_SUBMIT_STEP_MS.
  'api/bridge/v2/creator/campaign/submit.ts': CRON_MAX_DURATION_SECONDS,
  // L2/L5. Three RPC stages: the creator from getGiveaway, then the ERC-1271 check
  // for a contract wallet, getCode and isValidSignature one after the other. Seven
  // database stages: three rate-limit axes, the published identity when an image
  // is kept, the save function, the ops event, and the envelope's. Plus two
  // uploads, each bounded by STORAGE_TIMEOUT_MS, which maxDurationSeconds does not
  // model.
  'api/bridge/v2/campaign/identity/save.ts':
    maxDurationSeconds(3, 7) + Math.ceil((2 * STORAGE_TIMEOUT_MS) / 1000),
  // SPEC-BLOCO-03. Three RPC stages: getSigner, then both accounts' state read
  // together (two, readAccount). Seventeen database stages: the session read and
  // slide, three rate-limit axes, the passkey insert and the re-read a lost race
  // takes, each account's read and insert (four) and the list after them, the two
  // readAccount may write, the live recovery, the ops event, and the envelope's.
  'api/bridge/v2/account/register.ts': maxDurationSeconds(3, 17),
  // Three RPC stages: the account's state (two, readAccount) and the on-chain
  // signature check. Fifteen database stages: the session read and slide, three
  // rate-limit axes, the participant or creator read (up to three), the account
  // read and the two readAccount may write, the passkey, the authorisation
  // insert, the ops event, and the envelope's.
  'api/bridge/v2/account/migrate.ts': maxDurationSeconds(3, 15),
  // SPEC-BLOCO-03 Adenda F7. Three RPC stages: the accounts' code together, then
  // D3's close for an overdue request (the accounts' state, two). Eighteen
  // database stages: the session read and slide, three rate-limit axes, the phone
  // check, the passkey, the account list; D3's overdue list, the passkey, the
  // account list, the transition, its event and its alert's event; the expiry of
  // an abandoned request and the insert (openRecovery), the ops event, and the
  // envelope's. One HTTP stage: that alert's webhook.
  'api/bridge/v2/account/recovery.ts': maxDurationSeconds(3, 18, 1),
  // Budgeted: its stages add up past the ceiling (the per-stage worst case of
  // createCampaign is about four hundred seconds), so it declares the ceiling and
  // starts the irreversible part only with RELAY_SEND_MS of RUN_BUDGET_MS left.
  'api/bridge/v2/account/relay.ts': CRON_MAX_DURATION_SECONDS,
  // SPEC-BLOCO-03 piece 5. Three RPC stages: a voucher's owner and clocks, its
  // obligation, the terms' regions (an offer's regions alone for COMPRA). Ten
  // database stages: the session read and slide, three rate-limit axes, the
  // account read, the insert, the ops event, and the envelope's; one to spare.
  'api/bridge/v2/order/address.ts': maxDurationSeconds(3, 10),
  // Two RPC stages: the order, then its terms. Twelve database stages: the
  // session read and slide, three rate-limit axes, both accounts, the evidence
  // read, the insert, the re-read, the ops event, and the envelope's.
  'api/bridge/v2/order/evidence.ts': maxDurationSeconds(2, 12),
  // Three RPC stages: the order, its terms, then whether the hash is used.
  // Twelve database stages: the session read and slide, three rate-limit axes,
  // the account, the shipment and the address, the spend, the insert, the ops
  // event and the envelope's. Two HTTP stages: the provider, and an alert.
  'api/bridge/v2/store/tracking.ts': maxDurationSeconds(3, 12, 2),
  // One RPC stage: the escrow's arbiter. Five database stages: two rate-limit
  // axes, the evidence, the ops event, and the envelope's.
  'api/bridge/v2/arbiter/evidence.ts': maxDurationSeconds(1, 5),
};

/**
 * SPEC-BLOCO-03 Adenda E7: a relay campaign in FUNDING with no transaction
 * recorded, older than this, belongs to a request that no longer runs — the
 * route's own ceiling plus the margin FUNDING_STALE_MS gives a run — and is
 * released.
 */
export const RELAYED_CAMPAIGN_STALE_MS = (ROUTE_MAX_DURATION_SECONDS['api/bridge/v2/account/relay.ts'] + 120) * 1000;

/**
 * G4, checked rather than declared, exactly as the run budget above is.
 *
 * The relation this holds is in both directions. Every route this file gives a
 * duration must carry that duration in vercel.json, or the platform is enforcing
 * a limit the code does not know about; and every route vercel.json configures
 * must appear here, or there is a number in the deployment that nothing derived
 * and nobody checks — which is precisely how the prize reservation came to be
 * larger than the budget it was compared against.
 */
const DECLARED_DURATIONS = vercelConfig.functions as Record<string, { maxDuration?: number }>;

for (const [route, seconds] of Object.entries(ROUTE_MAX_DURATION_SECONDS)) {
  if (seconds > CRON_MAX_DURATION_SECONDS) {
    throw new Error(
      `[bridge-v2] ${route} needs ${seconds}s but the platform allows at most ` +
        `${CRON_MAX_DURATION_SECONDS}s; its worst case cannot be declared honestly`,
    );
  }
  if (DECLARED_DURATIONS[route]?.maxDuration !== seconds) {
    throw new Error(
      `[bridge-v2] vercel.json declares ${String(DECLARED_DURATIONS[route]?.maxDuration)} for ` +
        `${route}; its worst case derived from the timeouts above is ${seconds}s`,
    );
  }
}

for (const route of Object.keys(DECLARED_DURATIONS)) {
  if (!(route in ROUTE_MAX_DURATION_SECONDS)) {
    throw new Error(
      `[bridge-v2] vercel.json configures ${route} with a duration this file does not derive`,
    );
  }
}
