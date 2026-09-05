import { handle, methodGuard, ok, readJsonBody, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { parseLinkCode, parsePhone, parseTelegramId } from '../../../../lib/bridge-v2/validate.js';
import { claimLinkForChat, consumeLinkForChat } from '../../../../lib/bridge-v2/linkcodes.js';
import { bindPhone, hashPhone, hashTelegramId } from '../../../../lib/bridge-v2/phone.js';
import { findEntry, markVerified } from '../../../../lib/bridge-v2/entries.js';
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
 * The route always answers 200. Telegram retries anything else, and a retry of a
 * contact message is a retry of a binding — which is safe because the binding is
 * idempotent, but a retry storm is not. Failures are recorded and acknowledged.
 */
export const POST = handle('telegram/webhook', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  // Without this the webhook is a public endpoint accepting forged contacts, and
  // a forged contact is a forged uniqueness key.
  if (!isFromTelegram(request)) {
    await log.event('telegram.rejected', { reason: 'bad_secret' });
    return refuse(401, 'Unauthorized.');
  }

  const signals = await extractSignals(request);
  const verdict = await enforce([{ axis: 'ROUTE_GLOBAL', value: 'telegram/webhook' }, { axis: 'IP', value: signals.ipHash }]);
  if (!verdict.allowed) {
    await log.event('ratelimit.denied', { axis: verdict.deniedAxis ?? 'unknown' });
    return ok();
  }

  const update = await readJsonBody(request);
  if (update === null) return ok();

  const message = update.message as Record<string, unknown> | undefined;
  if (message === undefined) return ok();

  const chat = message.chat as Record<string, unknown> | undefined;
  const chatId = typeof chat?.id === 'number' ? chat.id : null;
  if (chatId === null) return ok();

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

    const link = await claimLinkForChat(code, chatId);
    if (link === null) {
      await sendText(chatId, BOT_MESSAGES.linkInvalid);
      return ok();
    }

    if (!(await claimSpend('telegram', 1, log))) return ok();
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

  const link = await consumeLinkForChat(chatId);
  if (link === null) {
    // No live link for this chat: either it was already used, or the contact
    // arrived without a /start. Both are the same answer.
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.linkInvalid);
    return ok();
  }

  const phoneHash = await hashPhone(phone);
  const outcome = await bindPhone(phoneHash, link.participantId, await hashTelegramId(senderId));

  if (outcome === 'TAKEN') {
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.numberTaken);
    await log.event('phone.rejected', { reason: 'taken' });
    return ok();
  }
  if (outcome === 'COOLDOWN') {
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.numberCooling);
    await log.event('phone.rejected', { reason: 'cooldown' });
    return ok();
  }

  const entry = await findEntry(link.participantId, link.giveawayId);
  if (entry === null) {
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.failed);
    return ok();
  }

  // The unique index on (giveaway_id, phone_hmac) is the guard. A false here
  // means this number already holds an entry in this campaign, which is the
  // uniqueness rule of the decision doing its job.
  const verified = await markVerified(entry.id, phoneHash);
  if (!verified) {
    await sendAndClearKeyboard(chatId, BOT_MESSAGES.alreadyUsed);
    await log.event('phone.rejected', { reason: 'entry_not_awaiting' });
    return ok();
  }

  await log.event('phone.bound');
  await log.event('entry.verified', { giveaway_id: link.giveawayId.toString() });
  await sendAndClearKeyboard(chatId, BOT_MESSAGES.confirmed);
  return ok();
});
