/**
 * Telegram Bot API client. Decision of 05/09/2026, restrictions R1 to R5.
 *
 * R1 — this is a pure bot. There is no Mini App, no Web App, and no inline
 * keyboard that opens one, anywhere in this file or reachable from it. The only
 * markup constructed here is a reply keyboard carrying request_contact. The
 * restriction is not a preference: section 7 of the Telegram bot developer terms
 * confines Mini Apps that touch crypto to TON, and this project settles on
 * Arbitrum.
 *
 * R2 — the bot does not touch crypto and does not talk about it. No message
 * built here names a token, a chain, a wallet, a prize or an amount, and no
 * message carries a link to a chain explorer or to a prize page. It receives a
 * code, asks for a contact, and confirms. That is the whole vocabulary.
 *
 * R3 — no message, and no value this module sends, contains lottery, raffle,
 * gambling or their equivalents in any language. The wording below is about
 * confirming participation in an event, which is what it actually is.
 *
 * R5 — the token is read from the environment at the moment of the call and is
 * never stored, logged, or written to a file.
 */

import { HTTP_TIMEOUT_MS } from './config.js';
import { requireEnv } from './env.js';

/**
 * Messages the bot may send. Kept together so R2 and R3 can be checked by
 * reading one list rather than by grepping the codebase.
 */
export const BOT_MESSAGES = {
  needsLink:
    'To confirm your participation, open the link from the event page. This chat cannot start the process on its own.',
  askContact:
    'Tap the button below to share your phone number. It is used once, to confirm that this participation belongs to one person.',
  contactButton: 'Share my phone number',
  wrongContact:
    'That contact is not yours. Please use the button so the number can be confirmed by Telegram.',
  linkInvalid:
    'This link is no longer valid. Request a new one from the event page.',
  alreadyUsed:
    'This participation is already confirmed. Nothing else is needed here.',
  numberTaken:
    'This number is already confirmed for another account.',
  numberCooling:
    'This number was released recently and cannot be reused yet.',
  // C6: the account presented a number other than the one it already holds.
  // R2 and R3 hold here too: no token, no chain, no prize, no lottery word.
  numberChanged:
    'This account already confirmed a different number. That number has now been released, and the participations it was confirming were stopped. You can start again from the event page.',
  // The (event, number) uniqueness rule of the 05/09/2026 decision.
  numberAlreadyInEvent:
    'This number has already confirmed a participation in this event.',
  // B2: the per-number limit. Deliberately says nothing about the ceiling (D5).
  tooMany:
    'Too many attempts from this number. Please try again later.',
  confirmed:
    'Confirmed. You can close this chat and return to the page.',
  failed:
    'Something went wrong. Please try again from the event page.',
} as const;

interface ApiResult {
  readonly ok: boolean;
}

/**
 * One call to the Bot API.
 *
 * G4: bounded by an explicit timeout, like every other external call. A failure
 * is reported, never thrown: a Telegram outage must not turn a webhook delivery
 * into a 500, because Telegram retries a 500 and would replay the update.
 */
async function call(method: string, payload: Record<string, unknown>): Promise<ApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${requireEnv('TELEGRAM_BOT_TOKEN')}/${method}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );
    return { ok: response.ok };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain text, no markup, no keyboard. */
export function sendText(chatId: number | string, text: string): Promise<ApiResult> {
  return call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

/**
 * Asks for the contact with a reply keyboard.
 *
 * request_contact is the only mechanism that yields a number Telegram itself has
 * verified. A number typed into a chat is a number the sender chose, which would
 * make the uniqueness key worthless.
 *
 * one_time_keyboard hides the button after a tap; the keyboard is removed
 * explicitly on completion so it does not linger in the chat.
 */
export function askForContact(chatId: number | string): Promise<ApiResult> {
  return call('sendMessage', {
    chat_id: chatId,
    text: BOT_MESSAGES.askContact,
    reply_markup: {
      keyboard: [[{ text: BOT_MESSAGES.contactButton, request_contact: true }]],
      one_time_keyboard: true,
      resize_keyboard: true,
      is_persistent: false,
    },
  });
}

/** Sends a closing message and takes the keyboard away. */
export function sendAndClearKeyboard(chatId: number | string, text: string): Promise<ApiResult> {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { remove_keyboard: true },
  });
}

/**
 * The webhook authenticity check.
 *
 * Telegram echoes the secret configured with setWebhook in this header. Without
 * it the webhook is a public endpoint that anyone can post a forged contact to,
 * and a forged contact is a forged uniqueness key.
 *
 * Compared with a length check first and then a full walk, so a wrong secret of
 * the right length does not leak its prefix by timing.
 */
export function isFromTelegram(request: Request): boolean {
  const presented = request.headers.get('x-telegram-bot-api-secret-token');
  if (presented === null) return false;
  const expected = requireEnv('TELEGRAM_WEBHOOK_SECRET');
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
