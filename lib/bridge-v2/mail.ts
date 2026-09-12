/**
 * Outbound email. J6 and J7.
 *
 * Sent by direct HTTPS call rather than through the resend package. The package
 * is installed for the V1 and stays there; not importing it keeps one more
 * dependency out of the process that holds the derivation seed (K2), and the
 * whole API surface used here is one POST.
 *
 * J7: the sender is our own authenticated domain, read from configuration. The
 * V1 used the shared onboarding@resend.dev, which meant abuse by any other
 * tenant moved our deliverability and ours moved theirs.
 *
 * G4: the call is bounded by an explicit timeout. An email provider that stops
 * answering must not hold a function open until the platform kills it.
 */

import { GIVEAWAY_MANAGER_V2, HTTP_TIMEOUT_MS } from './config.js';
import { requireEnv } from './env.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface MailResult {
  readonly sent: boolean;
}

/**
 * One POST to the provider, which is the whole of the API surface this module
 * uses — the reason the package is not imported (K2).
 *
 * Extracted when the settlement notices below became a second caller. The
 * properties this file's header claims are properties of this function now, so
 * there is one place where the sender is read from configuration (J7) and one
 * place where the call is bounded (G4), rather than two that have to agree.
 *
 * A failure is reported, never thrown. Every caller is either a route that must
 * not tell the client the difference (D2) or a pipeline pass that must not turn
 * a provider outage into a lost database write.
 */
async function post(to: string, subject: string, text: string): Promise<MailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: requireEnv('BRIDGE_V2_MAIL_FROM'),
        to: [to],
        subject,
        text,
      }),
      signal: controller.signal,
    });
    return { sent: response.ok };
  } catch {
    return { sent: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * J6: the subject never carries the code.
 *
 * In the V1 the code was in the subject line, so it was readable in a lock
 * screen notification without opening the mailbox. The subject here says what
 * the message is and nothing more.
 */
const CODE_SUBJECT = 'Your verification code';

function codeBody(code: string, minutes: number): string {
  return [
    'Use this code to confirm your email address:',
    '',
    code,
    '',
    `The code is valid for ${minutes} minutes and can be used once.`,
    'If you did not ask for it, ignore this message.',
  ].join('\n');
}

/**
 * Sends a verification code.
 *
 * Returns whether the provider accepted it. The caller must not tell the client
 * the difference (D2): a failure to send and a refusal to send look identical
 * from outside, or the response becomes a probe for which addresses exist.
 */
export async function sendCodeEmail(
  to: string,
  code: string,
  ttlMinutes: number,
): Promise<MailResult> {
  return post(to, CODE_SUBJECT, codeBody(code, ttlMinutes));
}

// ---------------------------------------------------------------------------
// settlement notices
// ---------------------------------------------------------------------------

/**
 * Where a participant is sent to act on a result.
 *
 * A constant, not configuration: it was an optional environment variable with
 * this value as its fallback and nothing in the tree ever set it. constants.ts
 * is not imported instead — that is client code, it reads import.meta.env, and
 * this module runs in the function that holds the derivation seed (K2).
 */
const PUBLIC_BASE = 'https://instantwin.finance';

/** What the notice needs to say, assembled by the caller that read the chain. */
export interface SettlementNotice {
  readonly giveawayId: bigint;
  /** The contract's answer, not a guess: claimable, or an already-taken prize. */
  readonly won: boolean;
  /**
   * Ready to print, e.g. "250 USDC" or "1 item", or null when the amount cannot
   * be named — a token that implements neither symbol() nor decimals(), or a
   * loser, who is owed no such sentence at all. null rather than an empty
   * string: a sentinel two files have to agree on is a sentinel one of them can
   * stop honouring without the other noticing.
   */
  readonly prize: string | null;
  /** E2: above the threshold the prize may not rest in temporary custody. */
  readonly requiresOwnWallet: boolean;
  /**
   * 07/09/2026 decision: the participant entered with their own address, so the
   * bridge holds no key for it and will never claim on their behalf. The advice
   * has to be different or it is wrong.
   */
  readonly selfCustody: boolean;
}

/**
 * R3 is why this is an email: the bot may not mention a prize, a draw or a
 * lottery, so the only channel left is the address the participant proved they
 * own. It is the canonical one on bridge_v2_participants, never one from a
 * request.
 *
 * The subject may name the campaign and the result, unlike a verification code
 * (J6): the winners of a settled campaign are public on a public chain. What it
 * must not become is bait, so a losing notice says so plainly.
 */
function noticeSubject(notice: SettlementNotice): string {
  return notice.won
    ? `You won giveaway #${notice.giveawayId}`
    : `Giveaway #${notice.giveawayId}: the draw is done`;
}

function noticeBody(notice: SettlementNotice): string {
  const event = `${PUBLIC_BASE}/events/${notice.giveawayId}`;
  const contract = `https://arbiscan.io/address/${GIVEAWAY_MANAGER_V2}`;

  if (!notice.won) {
    return [
      `Giveaway #${notice.giveawayId} has been drawn, and your entry was not one of the winners.`,
      '',
      'Nothing is owed and nothing is pending. The result was produced by Chainlink VRF',
      'and settled on Arbitrum, so you do not have to take our word for it:',
      '',
      `  The campaign and its winners:  ${event}`,
      `  The contract, on Arbiscan:     ${contract}`,
      '',
      'Thank you for entering.',
    ].join('\n');
  }

  const what = notice.prize ?? 'a share of the prize';

  // What to do next is genuinely three different things, and sending the wrong
  // one is worse than sending none: a self-custody winner who waits for a
  // delivery that is never coming can lose the prize to the 90-day claim
  // deadline (GiveawayManagerV2.sol, CLAIM_DEADLINE).
  const next = notice.selfCustody
    ? [
        'You entered with your own wallet, so the prize is yours to collect directly:',
        'call claimPrize on the contract from that wallet. This platform holds no key',
        'for it and cannot collect on your behalf.',
        '',
        'There is a deadline. The contract closes claims 90 days after settlement, and',
        'after that the creator may reclaim what nobody took.',
      ]
    : notice.requiresOwnWallet
      ? [
          'What happens next: tell us the wallet to send it to. A prize this size cannot',
          'rest in temporary custody, so it goes to an address you own and nowhere else.',
          '',
          'Open the campaign page, enter the address, and confirm it. You will be shown it',
          'again before anything moves, because it cannot be changed once confirmed.',
        ]
      : [
          'What happens next: nothing, unless you want it sooner. The prize can rest in',
          'temporary custody for up to 30 days, or you can name your own wallet now and',
          'have it sent straight there.',
          '',
          'Open the campaign page, enter the address, and confirm it. You will be shown it',
          'again before anything moves, because it cannot be changed once confirmed.',
        ];

  return [
    `Your entry in giveaway #${notice.giveawayId} was drawn as a winner.`,
    '',
    `You won: ${what}`,
    '',
    ...next,
    '',
    `  The campaign:               ${event}`,
    `  The contract, on Arbiscan:  ${contract}`,
    '',
    'Nobody from this platform will ever ask you for a seed phrase, a private key or a',
    'payment to release a prize. If a message does, it is not us.',
  ].join('\n');
}

/**
 * Sends one settlement notice.
 *
 * Returns whether the provider accepted it, and the caller uses that to decide
 * whether the row stays marked as notified. Never throws, for the same reason
 * sendCodeEmail does not: a pipeline pass that has already written a result must
 * not be unwound by an email provider having a bad minute.
 */
export function sendSettlementEmail(to: string, notice: SettlementNotice): Promise<MailResult> {
  return post(to, noticeSubject(notice), noticeBody(notice));
}
