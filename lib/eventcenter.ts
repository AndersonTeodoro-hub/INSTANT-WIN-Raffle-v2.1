/**
 * Cliente do Event Center para a Bridge V2 (api/bridge/v2/*).
 *
 * Um único `call()` fino: todas as rotas da bridge devolvem o mesmo envelope
 * ({ok:true,...} ou {ok:false,error}), cookie de sessão HttpOnly (nunca lido
 * aqui, o browser trata disso com `credentials: 'include'`), e nenhuma delas
 * aceita nada por query string (D4). Não tocar em api/bridge/v2/ nem em
 * lib/bridge-v2/ — este ficheiro só fala com elas por HTTP.
 */

import type { PublicIdentity } from './campaign-identity';

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

/**
 * `giveawayId` diz à ponte em que campanha o participante está, para o email do
 * código trazer o nome e a marca (L8). Opcional: sem ele o email é o de sempre.
 */
export const requestCode = (email: string, giveawayId?: bigint) =>
  call<Record<string, never>>('session/request-code', {
    email,
    ...(giveawayId === undefined ? {} : { giveawayId: giveawayId.toString() }),
  });

export const verifyCode = (email: string, code: string) => call<Record<string, never>>('session/verify', { email, code });

export const revokeSession = () => call<Record<string, never>>('session/revoke');

export interface EntryStartResult {
  readonly status: string;
  readonly url?: string;
}
export const entryStart = (giveawayId: bigint) =>
  call<EntryStartResult>('entry/start', { giveawayId: giveawayId.toString() });

/**
 * What a settled campaign did to one entry.
 *
 * Declared here rather than a third time in the page: this module is already the
 * one place the page reads the shape of an API answer from, and a union written
 * out at each use is a union that drifts at one of them. The server has its own
 * copy in lib/bridge-v2/entries.ts, which is deliberate — that module imports a
 * database client and must not be pulled into the browser bundle.
 */
export type EntryOutcome = 'WON' | 'LOST' | 'VOID';

export interface EntryStatusResult {
  readonly status: string;
  readonly walletAddress?: string;
  readonly txHash?: string | null;
  /**
   * What the settled campaign did to this entry, or null while it is still
   * undecided. The page reads this, never the presence of `custody`, which is
   * the rule that would apply on a win and is written at entry time.
   */
  readonly outcome?: EntryOutcome | null;
  /**
   * 07/09/2026 decision: the participant entered with their own address, so the
   * bridge holds no key for it and will never claim or deliver on their behalf.
   * The advice the page gives has to be different, or it is wrong.
   */
  readonly selfCustody?: boolean;
  /** SPEC-BLOCO-03 A4 and 6.2.5: the entry is the participant's Keptra account's, signed and claimed with the passkey. */
  readonly passkey?: boolean;
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

// ---------------------------------------------------------------------------
// Identidade de campanha — SPEC-BRIDGE-V2 §17
// ---------------------------------------------------------------------------

/** Leitura pública (L7): as identidades publicadas, por id. As campanhas sem identidade não vêm. */
export const campaignIdentities = (giveawayIds: readonly bigint[]) =>
  call<{ identities: Record<string, PublicIdentity> }>('campaign/identity/read', {
    giveawayIds: giveawayIds.map((id) => id.toString()),
  });

export type IdentitySaveResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly status: number; readonly reason: string | null };

/**
 * Grava a identidade (L2). Multipart e não JSON: leva as imagens. Sem cookie de
 * sessão — a autorização é a assinatura da carteira que vai dentro de `payload`.
 * O `reason` estável é o que a página traduz; a frase da ponte nunca é mostrada.
 */
export async function saveCampaignIdentity(form: FormData): Promise<IdentitySaveResult> {
  let res: Response;
  try {
    res = await fetch('/api/bridge/v2/campaign/identity/save', { method: 'POST', body: form });
  } catch {
    return { ok: false, status: 0, reason: null };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (json !== null && json.ok === true && typeof json.version === 'number') return { ok: true, version: json.version };
  return { ok: false, status: res.status, reason: typeof json?.reason === 'string' ? json.reason : null };
}
