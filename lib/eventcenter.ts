/**
 * Cliente do Event Center para a Bridge V2 (api/bridge/v2/*).
 *
 * Um único `call()` fino: todas as rotas da bridge devolvem o mesmo envelope
 * ({ok:true,...} ou {ok:false,error}), cookie de sessão HttpOnly (nunca lido
 * aqui, o browser trata disso com `credentials: 'include'`), e nenhuma delas
 * aceita nada por query string (D4). Não tocar em api/bridge/v2/ nem em
 * lib/bridge-v2/ — este ficheiro só fala com elas por HTTP.
 */

export interface BridgeError {
  readonly ok: false;
  readonly error: string;
  readonly status: number;
}

export type BridgeResult<T extends object> = ({ ok: true } & T) | BridgeError;

async function call<T extends object>(path: string, body?: Record<string, unknown>): Promise<BridgeResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/bridge/v2/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: 'Network error. Check your connection and try again.', status: 0 };
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (json === null) return { ok: false, error: 'Unexpected response from the server.', status: res.status };
  if (json.ok !== true) {
    return { ok: false, error: typeof json.error === 'string' ? json.error : 'Something went wrong.', status: res.status };
  }
  return { ok: true, ...json } as BridgeResult<T>;
}

export const requestCode = (email: string) => call<Record<string, never>>('session/request-code', { email });

export const verifyCode = (email: string, code: string) => call<Record<string, never>>('session/verify', { email, code });

export const revokeSession = () => call<Record<string, never>>('session/revoke');

export interface EntryStartResult {
  readonly status: string;
  readonly url?: string;
}
export const entryStart = (giveawayId: bigint) =>
  call<EntryStartResult>('entry/start', { giveawayId: giveawayId.toString() });

export interface EntryStatusResult {
  readonly status: string;
  readonly walletAddress?: string;
  readonly txHash?: string | null;
  readonly custody: {
    prizeKind: 'TOKEN' | 'NFT';
    requiresOwnWallet: boolean;
    destinationAddress: string | null;
    destinationConfirmed: boolean;
    custodyExpiresAt: string | null;
  } | null;
}
export const entryStatus = (giveawayId: bigint) =>
  call<EntryStatusResult>('entry/status', { giveawayId: giveawayId.toString() });

export interface DestinationResult {
  readonly destinationAddress: string;
  readonly destinationConfirmed: boolean;
}
export const proposeDestination = (giveawayId: bigint, address: string) =>
  call<DestinationResult>('prize/destination', { giveawayId: giveawayId.toString(), address });

export const confirmDestination = (giveawayId: bigint, address: string) =>
  call<DestinationResult>('prize/destination', { giveawayId: giveawayId.toString(), address, confirm: true });

export interface PrivacyExportResult {
  readonly participant: { email: string; walletAddress: string; createdAt: string };
  readonly entries: unknown[];
  readonly notIncluded: Record<string, string>;
}
export const privacyExport = () => call<PrivacyExportResult>('privacy/export');

export interface PrivacyEraseResult {
  readonly erased: boolean;
  readonly phoneReleased: boolean;
  readonly sessionsRevoked: number;
  readonly retained: string;
}
export const privacyErase = () => call<PrivacyEraseResult>('privacy/erase');
