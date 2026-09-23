/**
 * Keptra accounts, the database half. SPEC-BLOCO-03 section 6, migration 0012.
 *
 * Passkeys by their public coordinates, the accounts they own, the recovery
 * requests against those accounts, and the authorisations to migrate a derived
 * wallet. Nothing here signs and nothing here reads a key: every row is written
 * after the fact it records was checked elsewhere — a signature on-chain, a
 * session in the route, a number by Telegram.
 *
 * G1 throughout: every transition is one conditional statement, and the unique
 * indexes in 0012 are the authority under concurrency, never a read before a
 * write.
 */

import { getAddress } from 'viem';
import { checked, checkedMaybe, DatabaseError, getDb } from './db.js';
import { DB_TIMEOUT_MS, RECOVERY_REQUEST_TTL_MS } from './config.js';
import { predictSafeAddress, type AccountRole, type NoticeStage } from './keptra.js';


// -----------------------------------------------------------------------------
// passkeys
// -----------------------------------------------------------------------------

export interface Passkey {
  readonly id: string;
  readonly participantId: string;
  readonly credentialId: string;
  readonly x: bigint;
  readonly y: bigint;
  readonly signer: `0x${string}`;
}

interface PasskeyRow {
  id: string;
  participant_id: string;
  credential_id: string;
  public_x: string;
  public_y: string;
  signer_address: string;
}

const PASSKEY_COLUMNS = 'id, participant_id, credential_id, public_x::text, public_y::text, signer_address';

function toPasskey(row: PasskeyRow): Passkey {
  return {
    id: row.id,
    participantId: row.participant_id,
    credentialId: row.credential_id,
    x: BigInt(row.public_x),
    y: BigInt(row.public_y),
    signer: row.signer_address as `0x${string}`,
  };
}

/**
 * Records a passkey for the participant, or returns the one already recorded.
 *
 * A credential or a public key already held by somebody else is refused: the
 * unique constraints decide, and the winner's row is read back to tell a repeat
 * from a collision.
 */
export async function registerPasskey(
  participantId: string,
  credentialId: string,
  x: bigint,
  y: bigint,
  signer: `0x${string}`,
): Promise<Passkey | 'TAKEN'> {
  const db = getDb();
  const inserted = await db
    .from('bridge_v2_passkeys')
    .insert({
      participant_id: participantId,
      credential_id: credentialId,
      public_x: x.toString(),
      public_y: y.toString(),
      signer_address: signer,
    })
    .select(PASSKEY_COLUMNS)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();

  if (!inserted.error && inserted.data !== null) return toPasskey(inserted.data as PasskeyRow);
  if ((inserted.error as { code?: string } | null)?.code !== '23505') throw new DatabaseError('passkey.insert');

  const existing = checkedMaybe(
    'passkey.by_signer',
    await db.from('bridge_v2_passkeys').select(PASSKEY_COLUMNS).eq('signer_address', signer).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle(),
  ) as PasskeyRow | null;
  if (existing !== null && existing.participant_id === participantId && existing.credential_id === credentialId) {
    return toPasskey(existing);
  }
  return 'TAKEN';
}

/** A passkey of THIS participant, by credential. Another participant's is never found. */
export async function findPasskey(participantId: string, credentialId: string): Promise<Passkey | null> {
  const row = checkedMaybe(
    'passkey.find',
    await getDb()
      .from('bridge_v2_passkeys')
      .select(PASSKEY_COLUMNS)
      .eq('participant_id', participantId)
      .eq('credential_id', credentialId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as PasskeyRow | null;
  return row === null ? null : toPasskey(row);
}

export async function passkeyById(id: string): Promise<Passkey | null> {
  const row = checkedMaybe(
    'passkey.by_id',
    await getDb().from('bridge_v2_passkeys').select(PASSKEY_COLUMNS).eq('id', id).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle(),
  ) as PasskeyRow | null;
  return row === null ? null : toPasskey(row);
}

// -----------------------------------------------------------------------------
// accounts
// -----------------------------------------------------------------------------

export interface Account {
  readonly id: string;
  readonly participantId: string;
  readonly role: AccountRole;
  readonly safe: `0x${string}`;
  readonly initialSigner: `0x${string}`;
  /**
   * The guardian the account was registered with, and — once its module is on —
   * the one the chain holds, or null when it holds none (Adenda F1,
   * reconcileGuardians). A record: no decision about a guardian reads it.
   */
  readonly guardian: `0x${string}` | null;
  readonly deployedAt: string | null;
}

interface AccountRow {
  id: string;
  participant_id: string;
  role: AccountRole;
  safe_address: string;
  initial_signer: string;
  guardian_address: string | null;
  deployed_at: string | null;
}

const ACCOUNT_COLUMNS = 'id, participant_id, role, safe_address, initial_signer, guardian_address, deployed_at';

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    participantId: row.participant_id,
    role: row.role,
    safe: row.safe_address as `0x${string}`,
    initialSigner: row.initial_signer as `0x${string}`,
    guardian: (row.guardian_address ?? null) as `0x${string}` | null,
    // ?? null: a column never written reads as undefined from a row built by
    // hand, and means the same as NULL to every reader here.
    deployedAt: row.deployed_at ?? null,
  };
}

export async function findAccount(participantId: string, role: AccountRole): Promise<Account | null> {
  const row = checkedMaybe(
    'account.find',
    await getDb()
      .from('bridge_v2_accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('participant_id', participantId)
      .eq('role', role)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as AccountRow | null;
  return row === null ? null : toAccount(row);
}

export async function accountById(id: string): Promise<Account | null> {
  const row = checkedMaybe(
    'account.by_id',
    await getDb().from('bridge_v2_accounts').select(ACCOUNT_COLUMNS).eq('id', id).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle(),
  ) as AccountRow | null;
  return row === null ? null : toAccount(row);
}

export async function accountsOf(participantId: string): Promise<Account[]> {
  const rows = checked(
    'account.list_mine',
    await getDb()
      .from('bridge_v2_accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('participant_id', participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as AccountRow[] | null;
  return Array.isArray(rows) ? rows.map(toAccount) : [];
}

/**
 * 6.1.6 and A10: the participant's two accounts, written with their addresses
 * before either exists. The first passkey decides them; a later passkey is an
 * owner added to them, never a reason for new ones. The unique constraint per
 * (participant, role) is M3.
 */
export async function ensureAccounts(
  participantId: string,
  signer: `0x${string}`,
  guardian: `0x${string}`,
): Promise<Account[]> {
  const db = getDb();
  for (const role of ['PARTICIPANT', 'CREATOR'] as const) {
    if ((await findAccount(participantId, role)) !== null) continue;
    const inserted = await db
      .from('bridge_v2_accounts')
      .insert({
        participant_id: participantId,
        role,
        safe_address: predictSafeAddress(signer, role),
        initial_signer: signer,
        guardian_address: guardian,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    // Lost a race to a concurrent registration: its row is the account.
    if (inserted.error && (inserted.error as { code?: string }).code !== '23505') {
      throw new DatabaseError('account.insert');
    }
  }
  return accountsOf(participantId);
}

/**
 * Written once, after the account's configuration was read back from the chain
 * and found right (R-4) — after its first transaction, or whenever the chain is
 * found to hold it configured (Adenda E3).
 */
export async function markDeployed(accountId: string): Promise<void> {
  checked(
    'account.mark_deployed',
    await getDb()
      .from('bridge_v2_accounts')
      .update({ deployed_at: new Date().toISOString() })
      .eq('id', accountId)
      .is('deployed_at', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * Adenda D4: after a recovery, an account not deployed yet takes the address the
 * new passkey gives it — its old one is bound to the lost key, and holds nothing
 * (C4). Conditional on the signer it had and on still not being deployed, so a
 * pass that repeats it changes nothing (G1).
 */
export async function readdressAccount(account: Account, signer: `0x${string}`): Promise<void> {
  checked(
    'account.readdress',
    await getDb()
      .from('bridge_v2_accounts')
      .update({ safe_address: predictSafeAddress(signer, account.role), initial_signer: signer })
      .eq('id', account.id)
      .eq('initial_signer', account.initialSigner)
      .is('deployed_at', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * A6: the guardian an account added back after a rotation; Adenda F1: the one
 * the chain holds, or none (null), when the maintenance pass reconciles it.
 */
export async function recordGuardian(accountId: string, guardian: `0x${string}` | null): Promise<void> {
  checked(
    'account.guardian',
    await getDb()
      .from('bridge_v2_accounts')
      .update({ guardian_address: guardian })
      .eq('id', accountId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * Every account after `afterId`, a page at a time, for the checks run over all
 * of them. Marked deployed or not (C10): an account somebody else deployed at
 * its address has code on-chain and no deployed_at here, and is still ours.
 */
export async function accountsPage(afterId: string, limit: number): Promise<Account[]> {
  const rows = checked(
    'account.list_page',
    await getDb()
      .from('bridge_v2_accounts')
      .select(ACCOUNT_COLUMNS)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as AccountRow[] | null;
  return Array.isArray(rows) ? rows.map(toAccount) : [];
}

/**
 * Adenda E3: accounts not marked deployed that the relay has sent a transaction
 * for — the only way the platform deploys one — a page at a time. Among them is
 * every account whose first receipt was lost.
 */
export async function accountsAwaitingRecognition(afterId: string, limit: number): Promise<Account[]> {
  const rows = checked(
    'account.list_unrecognised',
    await getDb()
      .from('bridge_v2_accounts')
      // One literal, as ACCOUNT_COLUMNS is, so the client keeps the row's shape (creatorCampaigns.ts COLUMNS).
      .select('id, participant_id, role, safe_address, initial_signer, guardian_address, deployed_at, relayed:bridge_v2_relayed_transactions!inner(id)')
      .is('deployed_at', null)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as AccountRow[] | null;
  return Array.isArray(rows) ? rows.map(toAccount) : [];
}

/** Adenda E3 and A3: every passkey signer of this participant, lower-case — the only owners an account may have. */
export async function passkeySigners(participantId: string): Promise<Set<string>> {
  const rows = checked(
    'passkey.list_mine',
    await getDb()
      .from('bridge_v2_passkeys')
      .select('signer_address')
      .eq('participant_id', participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { signer_address: string }[] | null;
  return new Set((rows ?? []).map((row) => row.signer_address.toLowerCase()));
}

/**
 * SPEC-BLOCO-03 T3: the credential ids of this participant's passkeys, for the
 * page to name in navigator.credentials.get (allowCredentials). Ids only: the
 * public keys stay here.
 */
export async function passkeyCredentialIds(participantId: string): Promise<string[]> {
  const rows = checked(
    'passkey.ids_mine',
    await getDb()
      .from('bridge_v2_passkeys')
      .select('credential_id')
      .eq('participant_id', participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { credential_id: string }[] | null;
  return (rows ?? []).map((row) => row.credential_id);
}

/** C4: the platform account at this address, if the address is one. */
export async function accountBySafe(safe: `0x${string}`): Promise<Account | null> {
  const row = checkedMaybe(
    'account.by_safe',
    await getDb()
      .from('bridge_v2_accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('safe_address', getAddress(safe))
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as AccountRow | null;
  return row === null ? null : toAccount(row);
}

/**
 * C11: the guardians the relayer paid to add back to this account since `since`.
 * A revocation is not counted (Adenda E2: the reaction to a compromise is always
 * possible); the gas stays bounded, because every revocation needs a guardian
 * added before it. Each is recorded BEFORE it is sent (recordGuardianChange), so
 * one that then fails still counts: the count can be high, never low.
 */
export async function guardianChangesSince(accountId: string, since: Date): Promise<number> {
  const rows = checked(
    'account.guardian_changes',
    await getDb()
      .from('bridge_v2_guardian_changes')
      .select('id')
      .eq('account_id', accountId)
      .gte('created_at', since.toISOString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { id: string }[] | null;
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Adenda D1: whether an incident declared this guardian key compromised. The
 * owner writes bridge_v2_guardian_incidents by hand; the bridge only reads it.
 * While the configured key is listed the rotation is not complete.
 */
export async function guardianCompromised(guardian: `0x${string}`): Promise<boolean> {
  const row = checkedMaybe(
    'account.guardian_incident',
    await getDb()
      .from('bridge_v2_guardian_incidents')
      .select('guardian_address')
      .eq('guardian_address', guardian.toLowerCase())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return row !== null;
}

export async function recordGuardianChange(accountId: string): Promise<void> {
  checked(
    'account.guardian_change',
    await getDb()
      .from('bridge_v2_guardian_changes')
      .insert({ account_id: accountId })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * Adenda E2: the transactions the relayer paid for on this account since
 * `since`, recorded BEFORE each is sent (recordRelayed), like C11's.
 */
export async function relayedSince(accountId: string, since: Date): Promise<number> {
  const rows = checked(
    'account.relayed',
    await getDb()
      .from('bridge_v2_relayed_transactions')
      .select('id')
      .eq('account_id', accountId)
      .gte('created_at', since.toISOString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { id: string }[] | null;
  return Array.isArray(rows) ? rows.length : 0;
}

export async function recordRelayed(accountId: string): Promise<void> {
  checked(
    'account.relayed_record',
    await getDb()
      .from('bridge_v2_relayed_transactions')
      .insert({ account_id: accountId })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * Adenda F10: the two tables the relay counts in (C11, E2) keep no row older
 * than `days`. Each count looks at 24 hours; nothing reads further back but
 * accountsAwaitingRecognition (E3), which the maintenance pass runs hourly, so a
 * lost first receipt is recognised long before its row goes. Run by that pass.
 */
export async function purgeRelayRecords(days: number): Promise<number> {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = getDb();
  const relayed = checked(
    'account.relay_retention',
    await db.from('bridge_v2_relayed_transactions').delete().lt('created_at', before).select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { id: string }[] | null;
  const changes = checked(
    'account.guardian_retention',
    await db.from('bridge_v2_guardian_changes').delete().lt('created_at', before).select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { id: string }[] | null;
  return (relayed?.length ?? 0) + (changes?.length ?? 0);
}

// -----------------------------------------------------------------------------
// recoveries — 6.3, 6.4, A14
// -----------------------------------------------------------------------------

export type RecoveryStatus =
  | 'AWAITING_PHONE'
  | 'PHONE_VERIFIED'
  | 'CONFIRMED'
  | 'FINALIZED'
  | 'CANCELED'
  | 'REFUSED'
  | 'EXPIRED';

/** The states the one-live-request index covers (0012). */
export const LIVE_RECOVERY_STATUSES: readonly RecoveryStatus[] = ['AWAITING_PHONE', 'PHONE_VERIFIED', 'CONFIRMED'];

export interface Recovery {
  readonly id: string;
  readonly participantId: string;
  readonly passkeyId: string;
  readonly status: RecoveryStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly executeAfter: string | null;
}

interface RecoveryRow {
  id: string;
  participant_id: string;
  passkey_id: string;
  status: RecoveryStatus;
  created_at: string;
  started_at: string | null;
  execute_after: string | null;
}

const RECOVERY_COLUMNS = 'id, participant_id, passkey_id, status, created_at, started_at, execute_after';

function toRecovery(row: RecoveryRow): Recovery {
  return {
    id: row.id,
    participantId: row.participant_id,
    passkeyId: row.passkey_id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    executeAfter: row.execute_after ?? null,
  };
}

/**
 * Adenda C3: a request whose Telegram link expired before the number was
 * confirmed is closed as EXPIRED — every such request, or one participant's.
 * One conditional statement (G1); the maintenance pass runs it for everybody,
 * and openRecovery for the participant asking, so an abandoned request never
 * holds the one-live-request index against a new one.
 */
export async function expireAbandonedRecoveries(participantId?: string): Promise<number> {
  const now = new Date().toISOString();
  let query = getDb()
    .from('bridge_v2_recoveries')
    .update({ status: 'EXPIRED', updated_at: now })
    .eq('status', 'AWAITING_PHONE')
    .lte('link_expires_at', now);
  if (participantId !== undefined) query = query.eq('participant_id', participantId);
  const rows = checked(
    'recovery.expire',
    await query.select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { id: string }[] | null;
  return Array.isArray(rows) ? rows.length : 0;
}

/** Adenda D3: whether a request has outlived the 24 hours it has to reach CONFIRMED. */
export function recoveryOverdue(request: Recovery, now: number = Date.now()): boolean {
  return Date.parse(request.createdAt) + RECOVERY_REQUEST_TTL_MS <= now;
}

/**
 * Adenda D3: PHONE_VERIFIED requests opened 24 hours ago or more — everybody's,
 * or one participant's — and not reserved for a confirmation in progress (E4).
 * What becomes of each is recovery.ts's to decide, because it depends on the chain.
 */
export async function overdueVerifiedRecoveries(participantId?: string): Promise<Recovery[]> {
  let query = getDb()
    .from('bridge_v2_recoveries')
    .select(RECOVERY_COLUMNS)
    .eq('status', 'PHONE_VERIFIED')
    .is('confirming_at', null)
    .lte('created_at', new Date(Date.now() - RECOVERY_REQUEST_TTL_MS).toISOString());
  if (participantId !== undefined) query = query.eq('participant_id', participantId);
  const rows = checked(
    'recovery.overdue',
    await query.abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as RecoveryRow[] | null;
  return Array.isArray(rows) ? rows.map(toRecovery) : [];
}

/**
 * Opens a request. One live request per participant is the unique index's rule,
 * so a second request while one is running is refused rather than stacked — but
 * one whose link expired unused is closed first (C3) and does not count.
 */
export async function openRecovery(
  participantId: string,
  passkeyId: string,
  linkCodeHash: string,
  linkExpiresAt: Date,
): Promise<Recovery | 'ALREADY_OPEN'> {
  await expireAbandonedRecoveries(participantId);
  const inserted = await getDb()
    .from('bridge_v2_recoveries')
    .insert({
      participant_id: participantId,
      passkey_id: passkeyId,
      status: 'AWAITING_PHONE',
      link_code_hash: linkCodeHash,
      link_expires_at: linkExpiresAt.toISOString(),
    })
    .select(RECOVERY_COLUMNS)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (inserted.error) {
    if ((inserted.error as { code?: string }).code === '23505') return 'ALREADY_OPEN';
    throw new DatabaseError('recovery.insert');
  }
  return toRecovery(inserted.data as RecoveryRow);
}

export async function liveRecovery(participantId: string): Promise<Recovery | null> {
  const row = checkedMaybe(
    'recovery.live',
    await getDb()
      .from('bridge_v2_recoveries')
      .select(RECOVERY_COLUMNS)
      .eq('participant_id', participantId)
      .in('status', [...LIVE_RECOVERY_STATUSES])
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as RecoveryRow | null;
  return row === null ? null : toRecovery(row);
}

/** C10: every request in a live state, whatever its step. At most one per participant. */
export async function liveRecoveries(): Promise<Recovery[]> {
  const rows = checked(
    'recovery.live_all',
    await getDb()
      .from('bridge_v2_recoveries')
      .select(RECOVERY_COLUMNS)
      .in('status', [...LIVE_RECOVERY_STATUSES])
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as RecoveryRow[] | null;
  return Array.isArray(rows) ? rows.map(toRecovery) : [];
}

/** A14, step 1: /start with the recovery code attaches the chat. Single statement (G1). */
export async function claimRecoveryForChat(codeHash: string, chatHmac: string): Promise<Recovery | null> {
  const row = checkedMaybe(
    'recovery.claim_chat',
    await getDb()
      .from('bridge_v2_recoveries')
      .update({ telegram_chat_hmac: chatHmac, updated_at: new Date().toISOString() })
      .eq('link_code_hash', codeHash)
      .eq('status', 'AWAITING_PHONE')
      .gt('link_expires_at', new Date().toISOString())
      .select(RECOVERY_COLUMNS)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as RecoveryRow | null;
  return row === null ? null : toRecovery(row);
}

/** A14, step 2: the request waiting on this chat's contact, if any. */
export async function recoveryAwaitingChat(chatHmac: string): Promise<Recovery | null> {
  const row = checkedMaybe(
    'recovery.by_chat',
    await getDb()
      .from('bridge_v2_recoveries')
      .select(RECOVERY_COLUMNS)
      .eq('telegram_chat_hmac', chatHmac)
      .eq('status', 'AWAITING_PHONE')
      .gt('link_expires_at', new Date().toISOString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as RecoveryRow | null;
  return row === null ? null : toRecovery(row);
}

/**
 * Moves a request, refusing when it is no longer where the caller thinks it is.
 * False is "somebody else moved it" and only that; a database error throws (G2).
 * `unreserved`: only while no confirmation holds it (Adenda E4) — D3's closure.
 */
export async function advanceRecovery(
  id: string,
  from: RecoveryStatus,
  to: RecoveryStatus,
  extra: Record<string, string | null> = {},
  unreserved = false,
): Promise<boolean> {
  let query = getDb()
    .from('bridge_v2_recoveries')
    .update({ status: to, updated_at: new Date().toISOString(), ...extra })
    .eq('id', id)
    .eq('status', from);
  if (unreserved) query = query.is('confirming_at', null);
  const row = checkedMaybe(
    'recovery.advance',
    await query.select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle(),
  );
  return row !== null;
}

/**
 * Adenda E4: reserves a PHONE_VERIFIED request for the confirmation about to be
 * signed, in one conditional statement (G1). It succeeds only while the request
 * is still PHONE_VERIFIED, unreserved and inside its 24 hours (D3), and from then
 * on D3's closure leaves it alone (advanceRecovery, `unreserved`), so the
 * guardian never signs for a request that expired and the move to CONFIRMED is
 * nobody else's to take. The request stays PHONE_VERIFIED while it is signed.
 */
export async function reserveRecovery(id: string): Promise<boolean> {
  const row = checkedMaybe(
    'recovery.reserve',
    await getDb()
      .from('bridge_v2_recoveries')
      .update({ confirming_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'PHONE_VERIFIED')
      .is('confirming_at', null)
      .gt('created_at', new Date(Date.now() - RECOVERY_REQUEST_TTL_MS).toISOString())
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return row !== null;
}

/**
 * Adenda E4: gives reservations back — one request's, after a confirmation that
 * did not finish, or every request's at the start of a maintenance pass. Only
 * the pass reserves, under its own lock, so a reservation it finds is one a dead
 * pass left behind.
 */
export async function releaseRecoveryReservations(id?: string): Promise<number> {
  let query = getDb()
    .from('bridge_v2_recoveries')
    .update({ confirming_at: null })
    .eq('status', 'PHONE_VERIFIED')
    .not('confirming_at', 'is', null);
  if (id !== undefined) query = query.eq('id', id);
  const rows = checked(
    'recovery.release',
    await query.select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { id: string }[] | null;
  return Array.isArray(rows) ? rows.length : 0;
}

/** Requests in one state, oldest touched first. */
export async function recoveriesIn(status: RecoveryStatus, limit: number): Promise<Recovery[]> {
  const rows = checked(
    'recovery.list',
    await getDb()
      .from('bridge_v2_recoveries')
      .select(RECOVERY_COLUMNS)
      .eq('status', status)
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as RecoveryRow[] | null;
  return Array.isArray(rows) ? rows.map(toRecovery) : [];
}

/** Moves a request to the back of its queue without changing it. */
export async function touchRecovery(id: string): Promise<void> {
  checked(
    'recovery.touch',
    await getDb()
      .from('bridge_v2_recoveries')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * 6.3.2: the notices already sent for one request, as "STAGE:CHANNEL".
 *
 * Recorded AFTER the send, not claimed before it, unlike a settlement notice:
 * a security notice lost to a provider failure is worse than one sent twice, and
 * the maintenance pass that sends them runs under a lock of its own, so two
 * passes never race over the same one.
 */
export async function sentRecoveryNotices(recoveryId: string): Promise<Set<string>> {
  const rows = checked(
    'recovery.notices_sent',
    await getDb()
      .from('bridge_v2_recovery_notices')
      .select('stage, channel')
      .eq('recovery_id', recoveryId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { stage: string; channel: string }[] | null;
  return new Set((rows ?? []).map((row) => `${row.stage}:${row.channel}`));
}

/** Records one notice as sent. The primary key makes a second record of it a no-op. */
export async function recordRecoveryNotice(
  recoveryId: string,
  stage: NoticeStage,
  channel: 'EMAIL' | 'TELEGRAM',
): Promise<void> {
  const inserted = await getDb()
    .from('bridge_v2_recovery_notices')
    .insert({ recovery_id: recoveryId, stage, channel })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (inserted.error && (inserted.error as { code?: string }).code !== '23505') {
    throw new DatabaseError('recovery.notice');
  }
}

// -----------------------------------------------------------------------------
// migrations of derived wallets — 6.6, A8, A9
// -----------------------------------------------------------------------------

export interface Migration {
  readonly id: string;
  readonly walletIndex: number;
  readonly derived: `0x${string}`;
  readonly accountId: string;
  readonly kind: 'PARTICIPANT' | 'CREATOR';
}

interface MigrationRow {
  id: string;
  wallet_index: number;
  derived_address: string;
  account_id: string;
  kind: 'PARTICIPANT' | 'CREATOR';
}

const MIGRATION_COLUMNS = 'id, wallet_index, derived_address, account_id, kind';

function toMigration(row: MigrationRow): Migration {
  return {
    id: row.id,
    walletIndex: Number(row.wallet_index),
    derived: row.derived_address as `0x${string}`,
    accountId: row.account_id,
    kind: row.kind,
  };
}

/** Records a passkey authorisation that was verified on-chain. Once per index. */
export async function authorizeMigration(
  walletIndex: number,
  derived: `0x${string}`,
  accountId: string,
  kind: 'PARTICIPANT' | 'CREATOR',
): Promise<'AUTHORIZED' | 'ALREADY'> {
  const inserted = await getDb()
    .from('bridge_v2_migrations')
    .insert({ wallet_index: walletIndex, derived_address: derived, account_id: accountId, kind })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (!inserted.error) return 'AUTHORIZED';
  if ((inserted.error as { code?: string }).code === '23505') return 'ALREADY';
  throw new DatabaseError('migration.insert');
}

export async function pendingMigrations(limit: number): Promise<Migration[]> {
  const rows = checked(
    'migration.pending',
    await getDb()
      .from('bridge_v2_migrations')
      .select(MIGRATION_COLUMNS)
      .is('sealed_at', null)
      .order('updated_at', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as MigrationRow[] | null;
  return Array.isArray(rows) ? rows.map(toMigration) : [];
}

/**
 * The derived key is never used for this index again (M2). `sweepCostWei`: what
 * the last sweep of the wallet cost (Adenda F6) — the remainder it left is below
 * it, and seed readiness does not count that remainder as a balance.
 */
export async function sealMigration(id: string, sweepCostWei: bigint | null): Promise<void> {
  checked(
    'migration.seal',
    await getDb()
      .from('bridge_v2_migrations')
      .update({
        sealed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sweep_cost_wei: sweepCostWei === null ? null : sweepCostWei.toString(),
      })
      .eq('id', id)
      .is('sealed_at', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

export async function touchMigration(id: string): Promise<void> {
  checked(
    'migration.touch',
    await getDb()
      .from('bridge_v2_migrations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/**
 * SPEC-BLOCO-03 T3 and 6.6: where the migration of one derived wallet stands, for
 * the account page — authorised and waiting for the maintenance pass (and, A8,
 * for the wallet's open rights to end), or sealed. Null: not authorised yet.
 */
export async function migrationStatus(walletIndex: number): Promise<'AUTHORIZED' | 'DONE' | null> {
  const row = checkedMaybe(
    'migration.status',
    await getDb()
      .from('bridge_v2_migrations')
      .select('sealed_at')
      .eq('wallet_index', walletIndex)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as { sealed_at: string | null } | null;
  if (row === null) return null;
  return row.sealed_at == null ? 'AUTHORIZED' : 'DONE';
}

/** M2: whether this derivation index has been sealed by a finished migration. */
export async function isIndexSealed(walletIndex: number): Promise<boolean> {
  const row = checkedMaybe(
    'migration.sealed',
    await getDb()
      .from('bridge_v2_migrations')
      .select('id')
      .eq('wallet_index', walletIndex)
      .not('sealed_at', 'is', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return row !== null;
}

export interface DerivedWallet {
  readonly kind: 'PARTICIPANT' | 'CREATOR';
  readonly ownerId: string;
  readonly walletIndex: number;
  readonly address: `0x${string}`;
  readonly sealed: boolean;
  /** Sealed: what its last sweep cost (Adenda F6, sealMigration), or null. */
  readonly sweepCostWei: bigint | null;
}

/** Adenda F4: rows per page of the read below. */
const WALLET_PAGE = 500;

type WalletRow = { id: string; wallet_index: number; wallet_address: string };

/**
 * Every row of one table that holds a derived wallet, or null when it cannot be
 * confirmed that every one was read (Adenda F4).
 *
 * A page at a time, by id, until a page comes back EMPTY — so a server that caps
 * its rows below the page size shortens pages but cannot end the read early —
 * and what was read must equal the exact count the database gives for the same
 * filter. A count that does not come, or does not match, is null — and so is a
 * read the caller's budget (`hasTime`, Adenda F7) stopped before its end.
 */
async function everyWalletRow(
  table: 'bridge_v2_participants' | 'bridge_v2_creators',
  hasTime: () => boolean,
): Promise<WalletRow[] | null> {
  const db = getDb();
  if (!hasTime()) return null;
  const counted = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .not('wallet_index', 'is', null)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (counted.error || typeof counted.count !== 'number') return null;
  const rows: WalletRow[] = [];
  let afterId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    if (!hasTime()) return null;
    const page = checked(
      'migration.derived_wallets',
      await db
        .from(table)
        .select('id, wallet_index, wallet_address')
        .not('wallet_index', 'is', null)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(WALLET_PAGE)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    ) as WalletRow[] | null;
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    afterId = page[page.length - 1].id;
  }
  return rows.length === counted.count ? rows : null;
}

/**
 * Every derived wallet, participants and creators, sealed or not (M34 as Adenda
 * E1 reads it): a sealed wallet is still read for what it holds.
 *
 * Adenda F4: `complete` is whether every one that exists was read; readiness
 * answers "not ready" when it is not. A sealed flag missed only makes a wallet
 * look unsealed, which is read for more, never for less.
 */
export async function derivedWallets(hasTime: () => boolean = () => true): Promise<{ wallets: DerivedWallet[]; complete: boolean }> {
  const sealed = checked(
    'migration.sealed_list',
    await getDb()
      .from('bridge_v2_migrations')
      .select('wallet_index, sweep_cost_wei::text')
      .not('sealed_at', 'is', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as { wallet_index: number; sweep_cost_wei: string | null }[] | null;
  const sealedCost = new Map((sealed ?? []).map((row) => [Number(row.wallet_index), row.sweep_cost_wei == null ? null : BigInt(row.sweep_cost_wei)]));
  const wallets: DerivedWallet[] = [];
  let complete = true;
  for (const [kind, table] of [['PARTICIPANT', 'bridge_v2_participants'], ['CREATOR', 'bridge_v2_creators']] as const) {
    const rows = await everyWalletRow(table, hasTime);
    if (rows === null) {
      complete = false;
      continue;
    }
    for (const row of rows) {
      const walletIndex = Number(row.wallet_index);
      wallets.push({
        kind,
        ownerId: row.id,
        walletIndex,
        address: row.wallet_address as `0x${string}`,
        sealed: sealedCost.has(walletIndex),
        sweepCostWei: sealedCost.get(walletIndex) ?? null,
      });
    }
  }
  return { wallets, complete };
}

// -----------------------------------------------------------------------------
// P1-11: the export and the erasure cover the tables of migration 0012
// -----------------------------------------------------------------------------

/** P1-11: what migration 0012 holds about one participant, for the export (D7). */
export interface AccountData {
  readonly passkeys: readonly { credentialId: string; signer: string; publicX: string; publicY: string; createdAt: string }[];
  readonly accounts: readonly {
    role: string;
    address: string;
    initialSigner: string;
    guardian: string | null;
    deployedAt: string | null;
    createdAt: string;
    relayedTransactions: readonly string[];
    guardianChanges: readonly string[];
  }[];
  readonly recoveries: readonly {
    status: string;
    linkExpiresAt: string;
    phoneVerifiedAt: string | null;
    startedAt: string | null;
    executeAfter: string | null;
    finalizedAt: string | null;
    createdAt: string;
    updatedAt: string;
    notices: readonly { stage: string; channel: string; sentAt: string }[];
  }[];
  readonly migrations: readonly { derivedAddress: string; kind: string; authorizedAt: string; sealedAt: string | null }[];
}

/**
 * P1-11: every row of the 0012 tables that is the participant's — its passkeys,
 * its accounts with what the relay counted for each, its changes of access with
 * their notices, and its migrations. The keyed hashes the rows carry (the
 * Telegram chat's, the link code's) are not returned, for the reason the phone's
 * is not (C5). The guardian incidents are the platform's, never a participant's.
 */
export async function accountDataOf(participantId: string): Promise<AccountData> {
  const db = getDb();
  const passkeys = (checked(
    'export.passkeys',
    await db
      .from('bridge_v2_passkeys')
      .select('credential_id, signer_address, public_x::text, public_y::text, created_at')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: true })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) ?? []) as { credential_id: string; signer_address: string; public_x: string; public_y: string; created_at: string }[];
  const accounts = (checked(
    'export.accounts',
    await db
      .from('bridge_v2_accounts')
      .select('id, role, safe_address, initial_signer, guardian_address, deployed_at, created_at')
      .eq('participant_id', participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) ?? []) as { id: string; role: string; safe_address: string; initial_signer: string; guardian_address: string | null; deployed_at: string | null; created_at: string }[];
  const recoveries = (checked(
    'export.recoveries',
    await db
      .from('bridge_v2_recoveries')
      .select('id, status, link_expires_at, phone_verified_at, started_at, execute_after, finalized_at, created_at, updated_at')
      .eq('participant_id', participantId)
      .order('created_at', { ascending: true })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) ?? []) as {
    id: string;
    status: string;
    link_expires_at: string;
    phone_verified_at: string | null;
    started_at: string | null;
    execute_after: string | null;
    finalized_at: string | null;
    created_at: string;
    updated_at: string;
  }[];
  const accountIds = accounts.map((row) => row.id);
  const recoveryIds = recoveries.map((row) => row.id);
  const byAccount = async (table: 'bridge_v2_relayed_transactions' | 'bridge_v2_guardian_changes') =>
    (accountIds.length === 0
      ? []
      : ((checked(
          `export.${table}`,
          await db.from(table).select('account_id, created_at').in('account_id', accountIds).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
        ) ?? []) as { account_id: string; created_at: string }[]));
  const [relayed, guardianChanges] = [await byAccount('bridge_v2_relayed_transactions'), await byAccount('bridge_v2_guardian_changes')];
  const notices =
    recoveryIds.length === 0
      ? []
      : ((checked(
          'export.recovery_notices',
          await db
            .from('bridge_v2_recovery_notices')
            .select('recovery_id, stage, channel, sent_at')
            .in('recovery_id', recoveryIds)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
        ) ?? []) as { recovery_id: string; stage: string; channel: string; sent_at: string }[]);
  const migrations =
    accountIds.length === 0
      ? []
      : ((checked(
          'export.migrations',
          await db
            .from('bridge_v2_migrations')
            .select('derived_address, kind, authorized_at, sealed_at')
            .in('account_id', accountIds)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
        ) ?? []) as { derived_address: string; kind: string; authorized_at: string; sealed_at: string | null }[]);
  return {
    passkeys: passkeys.map((row) => ({
      credentialId: row.credential_id,
      signer: row.signer_address,
      publicX: row.public_x,
      publicY: row.public_y,
      createdAt: row.created_at,
    })),
    accounts: accounts.map((row) => ({
      role: row.role,
      address: row.safe_address,
      initialSigner: row.initial_signer,
      guardian: row.guardian_address,
      deployedAt: row.deployed_at,
      createdAt: row.created_at,
      relayedTransactions: relayed.filter((r) => r.account_id === row.id).map((r) => r.created_at),
      guardianChanges: guardianChanges.filter((r) => r.account_id === row.id).map((r) => r.created_at),
    })),
    recoveries: recoveries.map((row) => ({
      status: row.status,
      linkExpiresAt: row.link_expires_at,
      phoneVerifiedAt: row.phone_verified_at,
      startedAt: row.started_at,
      executeAfter: row.execute_after,
      finalizedAt: row.finalized_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      notices: notices.filter((n) => n.recovery_id === row.id).map((n) => ({ stage: n.stage, channel: n.channel, sentAt: n.sent_at })),
    })),
    migrations: migrations.map((row) => ({
      derivedAddress: row.derived_address,
      kind: row.kind,
      authorizedAt: row.authorized_at,
      sealedAt: row.sealed_at,
    })),
  };
}

/** P1-11: the participant's changes of access, whatever their state — what the erasure removes, and whether one is still alive. */
export async function recoveriesOf(participantId: string): Promise<{ id: string; status: RecoveryStatus }[]> {
  return ((checked(
    'erase.recoveries',
    await getDb()
      .from('bridge_v2_recoveries')
      .select('id, status')
      .eq('participant_id', participantId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) ?? []) as { id: string; status: RecoveryStatus }[]);
}

/**
 * P1-11, as the owner answered on 23/09/2026: the erasure removes the
 * participant's passkeys and the history of its changes of access, with their
 * notices — in the order the foreign keys ask (notices, requests, passkeys). The
 * accounts, the migrations and the relay's counts stay, as the participation
 * record does (D7): the addresses are public on the chain, and the counts leave
 * after seven days (F10). The caller has refused the erasure while a change of
 * access is alive (erase.ts).
 */
export async function eraseAccountData(participantId: string, recoveryIds: readonly string[]): Promise<{ passkeys: number; recoveries: number }> {
  const db = getDb();
  if (recoveryIds.length > 0) {
    checked(
      'erase.recovery_notices',
      await db.from('bridge_v2_recovery_notices').delete().in('recovery_id', [...recoveryIds]).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    );
  }
  const recoveries = (checked(
    'erase.recoveries',
    await db.from('bridge_v2_recoveries').delete().eq('participant_id', participantId).select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) ?? []) as { id: string }[];
  const passkeys = (checked(
    'erase.passkeys',
    await db.from('bridge_v2_passkeys').delete().eq('participant_id', participantId).select('id').abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) ?? []) as { id: string }[];
  return { passkeys: passkeys.length, recoveries: recoveries.length };
}
