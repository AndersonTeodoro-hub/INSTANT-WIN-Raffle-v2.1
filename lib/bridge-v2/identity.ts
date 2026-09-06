/**
 * Email identity: canonical form (C1) and admissibility (C2).
 *
 * Finding #6 is the reason this module exists. The V1 lowercased an address and
 * called it identity, so alvo+1@gmail.com and alvo+2@gmail.com were two people.
 * The one-email-one-entry guard cost an attacker a plus sign.
 *
 * Under the 05/09/2026 decision the email is no longer the uniqueness factor for
 * participation — the phone is. Canonicalisation still matters: it is what makes
 * an account one account, what the rate limits count against (B2), and what
 * stops a code request storm spread across a thousand aliases of one inbox.
 */

import { getDb, checked } from './db.js';
import { DB_TIMEOUT_MS, HTTP_TIMEOUT_MS } from './config.js';

/**
 * Providers where a dot in the local part addresses the same mailbox.
 *
 * Deliberately short. Adding a provider that does treat dots as significant
 * would merge two real people into one account, which is a worse failure than
 * missing an alias. Gmail documents this behaviour; the rest of the world does
 * not, so the rest of the world is left alone.
 */
const DOT_INSENSITIVE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** Domains that are the same mailbox under a different name. */
const DOMAIN_ALIASES = new Map<string, string>([['googlemail.com', 'gmail.com']]);

/**
 * Reduces an address to the form used as the account key.
 *
 * Lowercase, sub-addressing removed, dots removed only where the provider says
 * they are irrelevant, and known domain aliases folded together.
 *
 * C1: THIS IS A KEY AND IT IS NOT AN ADDRESS TO SEND ANYTHING TO. The comment
 * here used to say the result stays deliverable, which is true of Gmail and is
 * not true in general — stripping +tag strips part of the mailbox at any provider
 * that does not implement sub-addressing, and there are many. The claim was
 * load-bearing: session/request-code sent the verification code to this value, so
 * a participant who wrote alice+shop@example.com had their code delivered to
 * alice@example.com, which may be somebody else and may not exist. Nothing
 * reported it, because a mail provider accepts any deliverable address it is
 * handed.
 *
 * What this form is for is uniqueness and counting: one account, one set of rate
 * limits, and one code per address however many aliases of it are tried. What it
 * is not for is delivery, and D7 is satisfied by storing only this form, not by
 * pretending it is the participant's mailbox.
 */
export function canonicalizeEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  if (at <= 0) return lowered;

  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);

  domain = DOMAIN_ALIASES.get(domain) ?? domain;

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);

  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.replace(/\./g, '');

  return `${local}@${domain}`;
}

export function domainOf(canonicalEmail: string): string {
  const at = canonicalEmail.lastIndexOf('@');
  return at > 0 ? canonicalEmail.slice(at + 1) : '';
}

/** Why an address was refused. The caller never passes this to the client (D2). */
export type EmailVerdict = 'OK' | 'DISPOSABLE' | 'NO_MX';

/**
 * C2, first half: the blocklist.
 *
 * Held in the database precisely so it can be updated without a deploy. A list
 * compiled into the bundle is a list that is out of date the day after release.
 */
async function isDisposable(domain: string): Promise<boolean> {
  const db = getDb();
  const rows = checked(
    'disposable_domains.select',
    await db
      .from('bridge_v2_disposable_domains')
      .select('domain')
      .eq('domain', domain)
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * C2, second half: the domain must actually accept mail.
 *
 * Resolved over DNS-over-HTTPS because a Vercel function has no DNS resolver of
 * its own and adding one would add a dependency to the process that holds the
 * derivation seed (K2).
 *
 * G4: bounded by an explicit timeout. T7: the resolver is a third party, so a
 * resolver failure must not become a participant-facing failure — an
 * indeterminate answer is treated as acceptable rather than as a rejection.
 * Refusing every registration because a DNS provider is having an outage would
 * hand that provider an off switch for the platform.
 */
async function hasMxRecord(domain: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { accept: 'application/dns-json' }, signal: controller.signal },
    );
    if (!response.ok) return true;
    const body = (await response.json()) as { Status?: number; Answer?: unknown[] };
    if (body.Status !== 0) return false;
    return Array.isArray(body.Answer) && body.Answer.length > 0;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs both halves of C2 against a canonical address.
 *
 * C8: this runs before anything is written and long before an address reaches an
 * eligibility root. Nothing that fails here ever enters, because there is no
 * path that removes an address once it is in a root.
 */
export async function screenEmail(canonicalEmail: string): Promise<EmailVerdict> {
  const domain = domainOf(canonicalEmail);
  if (domain.length === 0) return 'NO_MX';
  if (await isDisposable(domain)) return 'DISPOSABLE';
  if (!(await hasMxRecord(domain))) return 'NO_MX';
  return 'OK';
}
