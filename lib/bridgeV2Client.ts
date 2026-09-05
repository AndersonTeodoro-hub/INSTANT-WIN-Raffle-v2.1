/**
 * Browser-side client for Bridge V2.
 *
 * Deliberately standalone. It imports nothing from lib/bridge-v2, because those
 * modules read environment variables that hold key material and must never be
 * reachable from a bundle that ships to a browser. Everything here is fetch and
 * types.
 *
 * A3: the session travels in an HttpOnly cookie, so nothing in this file can
 * read it or needs to. credentials: 'same-origin' is what makes the browser
 * attach it; there is no token to store and no header to set.
 *
 * D4: every call is a POST with a JSON body. No email, code or identifier ever
 * appears in a URL, because a URL reaches access logs, browser history and the
 * Referer header.
 */

const BASE = '/api/bridge/v2';

export type EntryStatus =
  | 'NONE'
  | 'AWAITING_CONTACT'
  | 'VERIFIED'
  | 'ELIGIBLE'
  | 'FUNDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED';

export interface CustodyView {
  prizeKind: 'TOKEN' | 'NFT';
  requiresOwnWallet: boolean;
  destinationAddress: string | null;
  destinationConfirmed: boolean;
  custodyExpiresAt: string | null;
}

export interface EntryState {
  status: EntryStatus;
  walletAddress?: string;
  txHash?: string | null;
  custody?: CustodyView | null;
}

export interface Failure {
  ok: false;
  error: string;
  retryAfterSeconds?: number;
}

export type Result<T> = ({ ok: true } & T) | Failure;

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'Network error. Please try again.' };
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }

  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const failure = parsed as { error?: string };
    return {
      ok: false,
      error: failure.error ?? 'Something went wrong. Please try again.',
      ...(retryAfter === null ? {} : { retryAfterSeconds: Number(retryAfter) }),
    };
  }

  return parsed as { ok: true } & T;
}

/**
 * Asks for a verification code.
 *
 * The answer is the same whether the address is new, known, or refused (D2), so
 * the caller must show one message for all of them and must not infer anything
 * from a success.
 */
export function requestCode(email: string): Promise<Result<Record<string, never>>> {
  return post('/session/request-code', { email });
}

/** Proves control of the address. On success the session cookie is set. */
export function verifyCode(email: string, code: string): Promise<Result<Record<string, never>>> {
  return post('/session/verify', { email, code });
}

/** A5: ends every session of this account, not only this browser's. */
export function signOut(): Promise<Result<Record<string, never>>> {
  return post('/session/revoke');
}

/**
 * Step 1 of the confirmation flow: returns the link the button opens.
 *
 * The URL is built by the server from configuration. The bot's name is not
 * written anywhere in this repository.
 */
export function startEntry(giveawayId: string): Promise<Result<{ status: EntryStatus; url?: string }>> {
  return post('/entry/start', { giveawayId });
}

/** Step 4: what the page shows. Scoped to the caller by the session cookie. */
export function entryStatus(giveawayId: string): Promise<Result<EntryState>> {
  return post('/entry/status', { giveawayId });
}

/** E4, first call: proposes a destination and gets it echoed back to display. */
export function proposeDestination(
  giveawayId: string,
  address: string,
): Promise<Result<{ destinationAddress: string; destinationConfirmed: boolean }>> {
  return post('/prize/destination', { giveawayId, address });
}

/** E4, second call: confirms the address the participant was shown. */
export function confirmDestination(
  giveawayId: string,
  address: string,
): Promise<Result<{ destinationAddress: string; destinationConfirmed: boolean }>> {
  return post('/prize/destination', { giveawayId, address, confirm: true });
}

/** D7: everything the bridge holds about the caller. */
export function exportMyData(): Promise<Result<Record<string, unknown>>> {
  return post('/privacy/export');
}

/** D7: erasure at the request of the data subject. */
export function eraseMyData(): Promise<Result<Record<string, unknown>>> {
  return post('/privacy/erase');
}
