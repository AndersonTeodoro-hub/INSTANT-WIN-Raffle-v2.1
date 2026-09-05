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

import { HTTP_TIMEOUT_MS } from './config.js';
import { requireEnv } from './env.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface MailResult {
  readonly sent: boolean;
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
        subject: CODE_SUBJECT,
        text: codeBody(code, ttlMinutes),
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
