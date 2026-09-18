/**
 * Recovery, driven by the maintenance pass. SPEC-BLOCO-03 6.3, 6.4, A6, A7, A14.
 *
 * A request is opened by the participant under an email session and a number
 * Telegram confirmed (A14; api/bridge/v2/account/recovery.ts and the webhook).
 * From there everything happens here, and each step is conditional on the state
 * it expects, so a pass that dies is resumed by the next one:
 *
 *   PHONE_VERIFIED -> the new passkey's signer is created, R-1 is checked on
 *                     every account, the guardian signs, the relayer submits
 *                     multiConfirmRecovery with execute = true. The module's
 *                     seven days start (6.3.1).
 *   CONFIRMED      -> the notices (6.3.2), and once the chain's clock passes
 *                     executeAfter, finalizeRecovery on every account still
 *                     pending (R-6). A request whose accounts all show no
 *                     pending recovery was cancelled with the old passkey
 *                     (6.3.3), and is closed as such.
 *
 * R-6's "legitimate" is the proposal the matrix makes (M22): a recovery the
 * bridge registered after R-1. A pending recovery on an account with no request
 * behind it raises an alert and is never finalised by the bridge.
 */

import type { Logger } from './log.js';
import { alert } from './alert.js';
import type { RunDeadline } from './runlock.js';
import { RPC_TIMEOUT_MS, RECEIPT_TIMEOUT_MS } from './config.js';
import {
  accountState,
  chainNow,
  confirmRecoveryCall,
  finalizeRecoveryCall,
  hasCode,
  recoveryHash,
} from './keptraChain.js';
import { createSignerCall, dueNoticeStages, newOwnersRefusal, type NoticeStage } from './keptra.js';
import {
  accountsOf,
  advanceRecovery,
  deployedAccounts,
  passkeyById,
  recordRecoveryNotice,
  recoveriesIn,
  sentRecoveryNotices,
  touchRecovery,
  type Recovery,
} from './accounts.js';
import { guardianAddress, signRecoveryHash } from './guardian.js';
import { sendAsRelayer } from './relay.js';
import { participantEmail } from './entries.js';
import { telegramChatOf } from './phone.js';
import { sendRecoveryNoticeEmail } from './mail.js';
import { BOT_MESSAGES, sendText } from './telegram.js';

/** One request's confirmation: a signer creation and one confirmation per account, each awaited. */
export const RECOVERY_CONFIRM_WORST_CASE_MS = 3 * (RECEIPT_TIMEOUT_MS + 3 * RPC_TIMEOUT_MS);
const BATCH = 5;

const sameOwners = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((owner, i) => owner.toLowerCase() === b[i].toLowerCase());

/**
 * PHONE_VERIFIED -> CONFIRMED. R-1 before any signature: nothing is confirmed
 * for an owner list that fails it, on any account (M17).
 */
export async function confirmVerifiedRecoveries(log: Logger, deadline: RunDeadline): Promise<number> {
  let confirmed = 0;
  for (const request of await recoveriesIn('PHONE_VERIFIED', BATCH)) {
    if (!deadline.hasTimeFor(RECOVERY_CONFIRM_WORST_CASE_MS)) break;
    try {
      if (await confirmOne(request, log)) confirmed += 1;
    } catch (error) {
      await log.failure('recovery.failed', error);
      await touchRecovery(request.id);
    }
  }
  return confirmed;
}

async function confirmOne(request: Recovery, log: Logger): Promise<boolean> {
  const passkey = await passkeyById(request.passkeyId);
  const accounts = (await accountsOf(request.participantId)).filter((account) => account.deployedAt !== null);
  if (passkey === null || accounts.length === 0) {
    await advanceRecovery(request.id, 'PHONE_VERIFIED', 'REFUSED');
    await log.event('recovery.refused', { reason: passkey === null ? 'no_passkey' : 'no_account' });
    return false;
  }
  const newOwners = [passkey.signer];
  const guardian = guardianAddress();

  // R-1, first condition: the new owner is a signer proxy that already exists.
  // The creation is permissionless and idempotent, and it is made BEFORE the
  // guardian signs anything.
  if (!(await hasCode(passkey.signer))) {
    const created = await sendAsRelayer([createSignerCall(passkey.x, passkey.y)], log);
    if (created === null || created.receipt?.status !== 'success') {
      await touchRecovery(request.id);
      return false;
    }
  }
  const deployed = new Set((await hasCode(passkey.signer)) ? [passkey.signer.toLowerCase()] : []);

  let executeAfter = 0n;
  for (const account of accounts) {
    const refusal = newOwnersRefusal(account.safe, newOwners, guardian, deployed);
    if (refusal !== null) {
      await advanceRecovery(request.id, 'PHONE_VERIFIED', 'REFUSED');
      await log.event('recovery.refused', { reason: refusal });
      return false;
    }
    const state = await accountState(account.safe);
    if (state.owners.some((owner) => owner.toLowerCase() === passkey.signer.toLowerCase())) {
      // Already an owner here: nothing to recover on this account.
      continue;
    }
    if (!state.guardians.some((item) => item.toLowerCase() === guardian.toLowerCase())) {
      // A6: an account that revoked its guardian has no recovery until it adds
      // the new one. Nothing the guardian signs would be accepted.
      await log.event('recovery.refused', { reason: 'guardian_absent' });
      continue;
    }
    if (state.recoveryExecuteAfter > 0n && sameOwners(state.recoveryNewOwners, newOwners)) {
      executeAfter = state.recoveryExecuteAfter > executeAfter ? state.recoveryExecuteAfter : executeAfter;
      continue;
    }
    const signature = await signRecoveryHash(await recoveryHash(account.safe, newOwners));
    const sent = await sendAsRelayer([confirmRecoveryCall(account.safe, newOwners, guardian, signature)], log);
    if (sent === null || sent.receipt?.status !== 'success') {
      await touchRecovery(request.id);
      return false;
    }
    const after = (await accountState(account.safe)).recoveryExecuteAfter;
    executeAfter = after > executeAfter ? after : executeAfter;
  }

  if (executeAfter === 0n) {
    await advanceRecovery(request.id, 'PHONE_VERIFIED', 'REFUSED');
    await log.event('recovery.refused', { reason: 'nothing_to_confirm' });
    return false;
  }
  const startedAt = await chainNow();
  await advanceRecovery(request.id, 'PHONE_VERIFIED', 'CONFIRMED', {
    started_at: new Date(Number(startedAt) * 1000).toISOString(),
    execute_after: new Date(Number(executeAfter) * 1000).toISOString(),
  });
  await log.event('recovery.confirmed');
  return true;
}

const TELEGRAM_NOTICE: Record<NoticeStage, string> = {
  START: BOT_MESSAGES.accessChangeStarted,
  MID: BOT_MESSAGES.accessChangeHalfway,
  FINAL: BOT_MESSAGES.accessChangeLastDay,
};

/**
 * 6.3.2: every notice due for one confirmed request, each at most once per
 * channel. `now` is a parameter so the schedule can be driven by a test clock.
 */
export async function sendDueNotices(request: Recovery, now: Date, log: Logger): Promise<number> {
  if (request.startedAt === null || request.executeAfter === null) return 0;
  const due = dueNoticeStages(new Date(request.startedAt), new Date(request.executeAfter), now);
  if (due.length === 0) return 0;
  const sent = await sentRecoveryNotices(request.id);
  let count = 0;
  for (const stage of due) {
    if (!sent.has(`${stage}:EMAIL`)) {
      const email = await participantEmail(request.participantId);
      if (email !== null && (await sendRecoveryNoticeEmail(email, stage, new Date(request.executeAfter))).sent) {
        await recordRecoveryNotice(request.id, stage, 'EMAIL');
        count += 1;
      }
    }
    if (!sent.has(`${stage}:TELEGRAM`)) {
      const chat = await telegramChatOf(request.participantId);
      if (chat !== null && (await sendText(chat, TELEGRAM_NOTICE[stage])).ok) {
        await recordRecoveryNotice(request.id, stage, 'TELEGRAM');
        count += 1;
      }
    }
  }
  if (count > 0) await log.event('recovery.notified', { notices: count });
  return count;
}

/**
 * CONFIRMED -> FINALIZED or CANCELED, with the notices on the way. The clock
 * that decides finalisation is the chain's, because it is the one the module
 * compares against.
 */
export async function advanceConfirmedRecoveries(
  log: Logger,
  deadline: RunDeadline,
  now: Date = new Date(),
): Promise<number> {
  let finished = 0;
  for (const request of await recoveriesIn('CONFIRMED', 20)) {
    if (!deadline.hasTimeFor(RECEIPT_TIMEOUT_MS + 4 * RPC_TIMEOUT_MS)) break;
    try {
      const passkey = await passkeyById(request.passkeyId);
      if (passkey === null) continue;
      const accounts = (await accountsOf(request.participantId)).filter((account) => account.deployedAt !== null);
      const states = await Promise.all(accounts.map((account) => accountState(account.safe)));
      const pending = accounts.filter((_, i) => states[i].recoveryExecuteAfter > 0n);

      if (pending.length === 0) {
        const replaced = states.some((state) =>
          state.owners.some((owner) => owner.toLowerCase() === passkey.signer.toLowerCase()),
        );
        await advanceRecovery(request.id, 'CONFIRMED', replaced ? 'FINALIZED' : 'CANCELED', {
          finalized_at: replaced ? new Date().toISOString() : null,
        });
        await log.event(replaced ? 'recovery.finalized' : 'recovery.canceled');
        finished += 1;
        continue;
      }

      await sendDueNotices(request, now, log);

      const chainTime = await chainNow();
      for (const [i, account] of accounts.entries()) {
        const state = states[i];
        if (state.recoveryExecuteAfter === 0n || chainTime < state.recoveryExecuteAfter) continue;
        // R-6: only the owner list this request registered. Anything else on
        // this account is somebody else's recovery and is not ours to finish.
        if (!sameOwners(state.recoveryNewOwners, [passkey.signer])) continue;
        const sent = await sendAsRelayer([finalizeRecoveryCall(account.safe)], log);
        if (sent !== null && sent.receipt?.status === 'success') await log.event('recovery.finalized');
      }
      await touchRecovery(request.id);
    } catch (error) {
      await log.failure('recovery.failed', error);
      await touchRecovery(request.id);
    }
  }
  return finished;
}

/**
 * M22: a recovery pending on an account with no confirmed request of ours behind
 * it. The guardian is the platform's key, so this is either a compromised
 * guardian or a request this side lost — an alert either way, never a
 * finalisation. One page of accounts per call, read concurrently.
 */
export async function alertUnregisteredRecoveries(log: Logger, deadline?: RunDeadline): Promise<number> {
  const confirmed = await recoveriesIn('CONFIRMED', 200);
  const registered = new Map<string, string>();
  for (const request of confirmed) {
    const passkey = await passkeyById(request.passkeyId);
    if (passkey !== null) registered.set(request.participantId, passkey.signer.toLowerCase());
  }
  let unregistered = 0;
  // ponytail: one state read per deployed account per pass; an event cursor on
  // RecoveryExecuted replaces this if the account count makes the pass slow.
  let afterId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    if (deadline !== undefined && !deadline.hasTimeFor(2 * RPC_TIMEOUT_MS)) break;
    const accounts = await deployedAccounts(afterId, 50);
    if (accounts.length === 0) break;
    const states = await Promise.all(accounts.map((account) => accountState(account.safe)));
    for (const [i, account] of accounts.entries()) {
      const state = states[i];
      if (state.recoveryExecuteAfter === 0n) continue;
      const expected = registered.get(account.participantId);
      if (expected !== undefined && sameOwners(state.recoveryNewOwners, [expected])) continue;
      unregistered += 1;
    }
    afterId = accounts[accounts.length - 1].id;
  }
  if (unregistered > 0) await alert(log, 'recovery pending with no registered request', { accounts: unregistered });
  return unregistered;
}
