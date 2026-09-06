import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce } from '../../../../lib/bridge-v2/ratelimit.js';
import { parseLinkCode, parsePhone, parseTelegramId } from '../../../../lib/bridge-v2/validate.js';
import { claimLinkForChat, consumeLinkForChat } from '../../../../lib/bridge-v2/linkcodes.js';
import {
  bindPhoneAndVerify,
  hashPhone,
  hashTelegramChatId,
  hashTelegramId,
} from '../../../../lib/bridge-v2/phone.js';
import { BOT_MESSAGES, askForContact, isFromTelegram, sendAndClearKeyboard, sendText } from '../../../../lib/bridge-v2/telegram.js';
import { claimSpend } from '../../../../lib/bridge-v2/spend.js';

/**
 * POST /api/bridge/v2/telegram/webhook
 *
 * Steps 2 and 3 of the 05/09/2026 decision. The bot receives /start with the
 * code, asks for the contact, receives a number Telegram itself verified, and
 * confirms.
 *
 * R1: the only markup this route can produce is a reply keyboard carrying
 * request_contact. There is no Web App anywhere in the path.
 *
 * R2: nothing sent from here mentions a token, a chain, a wallet, a prize or an
 * amount, and no message carries a link to any of them.
 *
 * The route always answers 200. Telegram retries anything else, so a 500 here is
 * not a failed delivery but an infinite one. Every collision that could produce
 * one is a named outcome of bridge_v2_bind_phone_and_verify instead (8.8).
 */
const route = handle('telegram/webhook', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  // Without this the webhook is a public endpoint accepting forged contacts, and
  // a forged contact is a forged uniqueness key.
  if (!isFromTelegram(request)) {
    await log.event('telegram.rejected', { reason: 'bad_secret' });
    return refuse(401, 'Unauthorized.');
  }

  // The route ceiling, and nothing per source address.
  //
  // There is no IP axis here, and there must not be one. Every update on this
  // route arrives from Telegram, so the source address identifies Telegram and
  // not the person: the axis counted the whole world as one caller. It bought
  // nothing against an abuser, who reaches this route only through Telegram like
  // everybody else, and it cost everything under load, because one participant
  // could put the shared key into penalty and B4 would then hold every other
  // participant behind a growing wait. A limit that cannot separate its subjects
  // is a denial-of-service switch with extra steps.
  //
  // B2 is satisfied by the axes that do separate them, and they are below: the
  // chat, once one is known, and the number, at the point where one exists.
  const routeVerdict = await enforce([{ axis: 'ROUTE_GLOBAL', value: 'telegram/webhook' }]);
  if (!routeVerdict.allowed) {
    await log.event('ratelimit.denied', { axis: routeVerdict.deniedAxis ?? 'unknown' });
    return ok();
  }

  const update = await readJsonBody(request);
  if (update === null) return ok();

  const message = update.message as Record<string, unknown> | undefined;
  if (message === undefined) return ok();

  const chat = message.chat as Record<string, unknown> | undefined;
  const chatId = typeof chat?.id === 'number' ? chat.id : null;
  if (chatId === null) return ok();

  // B2, per caller. The chat is the only thing on this route that identifies one
  // person before a number has been shared, so it is the axis that has to hold
  // the flood. Keyed on the HMAC, never on the id (K4, R4).
  const chatVerdict = await enforce([{ axis: 'TELEGRAM_CHAT', value: await hashTelegramChatId(chatId) }]);
  if (!chatVerdict.allowed) {
    await log.event('ratelimit.denied', { axis: 'TELEGRAM_CHAT' });
    return ok();
  }

  await log.event('telegram.update');

  // ---------------------------------------------------------------------------
  // Step 2 — /start <code>
  // ---------------------------------------------------------------------------
  const text = typeof message.text === 'string' ? message.text : null;
  if (text !== null && text.startsWith('/start')) {
    const parameter = text.slice('/start'.length).trim();
    const code = parseLinkCode(parameter);

    if (code === null) {
      await sendText(chatId, BOT_MESSAGES.needsLink);
      return ok();
    }

    // B8, and the order it implies: the budget is claimed before the link is
    // touched, not after. Claiming afterwards attached the link to this chat and
    // then refused to send the request for a contact, leaving the participant
    // with a code that had been spent on nothing.
    if (!(await claimSpend('telegram', 1, log))) return ok();

    const link = await claimLinkForChat(code, chatId);
    if (link === null) {
      await sendText(chatId, BOT_MESSAGES.linkInvalid);
      return ok();
    }

    await askForContact(chatId);
    return ok();
  }

  // ---------------------------------------------------------------------------
  // Step 3 — the shared contact
  // ---------------------------------------------------------------------------
  const contact = message.contact as Record<string, unknown> | undefined;
  if (contact === undefined) return ok();

  // The contact must be the sender's own. Telegram lets a user forward somebody
  // else's contact card, and only a card whose user_id matches the sender is one
  // Telegram actually verified.
  const from = message.from as Record<string, unknown> | undefined;
  const senderId = parseTelegramId(from?.id);
  const contactUserId = parseTelegramId(contact.user_id);
  if (senderId === null || contactUserId === null || senderId !== contactUserId) {
    await sendText(chatId, BOT_MESSAGES.wrongContact);
    await log.event('phone.rejected', { reason: 'contact_not_own' });
    return ok();
  }

  const phone = parsePhone(contact.phone_number);
  if (phone === null) {
    await sendText(chatId, BOT_MESSAGES.wrongContact);
    return ok();
  }

  const phoneHash = await hashPhone(phone);

  // B2, at the only point in the system where a number exists. The key is the
  // HMAC, never the number (K4), and the check runs before the link is consumed
  // so a denial does not also burn the code.
  const phoneVerdict = await enforce([{ axis: 'PHONE', value: phoneHash }]);
  if (!phoneVerdict.allowed) {
    await log.event('ratelimit.denied', { axis: 'PHONE' });
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.tooMany);
    return ok();
  }

  const link = await consumeLinkForChat(chatId);
  if (link === null) {
    // No live link for this chat: either it was already used, or the contact
    // arrived without a /start. Both are the same answer.
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.linkInvalid);
    return ok();
  }

  // 8.7: one call. The number is bound and the entry is verified in the same
  // transaction, so there is no window in which a number is spent on an entry
  // that never advanced — the number gone, the participation lost, and no way
  // back because the number is now in use.
  const outcome = await bindPhoneAndVerify(
    phoneHash,
    link.participantId,
    link.giveawayId,
    await hashTelegramId(senderId),
  );

  if (outcome === 'VERIFIED') {
    await log.event('phone.bound');
    await log.event('entry.verified', { giveaway_id: link.giveawayId.toString() });
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.confirmed);
    return ok();
  }

  // Every remaining outcome is a refusal the database decided, never an
  // exception this route has to turn into a status code (8.8).
  const refusals = {
    TAKEN: BOT_MESSAGES.numberTaken,
    COOLDOWN: BOT_MESSAGES.numberCooling,
    NUMBER_CHANGED: BOT_MESSAGES.numberChanged,
    DUPLICATE: BOT_MESSAGES.numberAlreadyInEvent,
    NOT_AWAITING: BOT_MESSAGES.alreadyUsed,
    NO_ENTRY: BOT_MESSAGES.failed,
  } as const;

  await log.event('phone.rejected', { reason: outcome });
  await sendAndClearKeyboard(chatId, refusals[outcome]);
  return ok();
});

/**
 * 8.10: exported as a named async function declaration.
 *
 * The V1 routes reached this shape by incident — commit cea0c09 renamed a
 * default export to POST because the runtime would not otherwise answer — and
 * the form the three surviving V1 routes use is the declaration. The V2 routes
 * differed from it for no reason, and a route file that does not look like the
 * one known to work is a difference nobody wants to be debugging in production.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
