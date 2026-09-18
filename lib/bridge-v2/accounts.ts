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

import { checked, checkedMaybe, DatabaseError, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';
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
  readonly guardian: `0x${string}`;
  readonly deployedAt: string | null;
  readonly guardianRevokedAt: string | null;
}

interface AccountRow {
  id: string;
  participant_id: string;
  role: AccountRole;
  safe_address: string;
  initial_signer: string;
  guardian_address: string;
  deployed_at: string | null;
  guardian_revoked_at: string | null;
}

const ACCOUNT_COLUMNS =
  'id, participant_id, role, safe_address, initial_signer, guardian_address, deployed_at, guardian_revoked_at';

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    participantId: row.participant_id,
    role: row.role,
    safe: row.safe_address as `0x${string}`,
    initialSigner: row.initial_signer as `0x${string}`,
    guardian: row.guardian_address as `0x${string}`,
    // ?? null: a column never written reads as undefined from a row built by
    // hand, and means the same as NULL to every reader here.
    deployedAt: row.deployed_at ?? null,
    guardianRevokedAt: row.guardian_revoked_at ?? null,
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

/** Written once, after the account's configuration was read back and found right (R-4). */
export async function markDeployed(accountId: string, txHash: string): Promise<void> {
  checked(
    'account.mark_deployed',
    await getDb()
      .from('bridge_v2_accounts')
      .update({ deployed_at: new Date().toISOString(), deploy_tx_hash: txHash })
      .eq('id', accountId)
      .is('deployed_at', null)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/** A6: the guardian an account now holds, or none after a revocation. */
export async function recordGuardian(accountId: string, guardian: `0x${string}`, revoked: boolean): Promise<void> {
  checked(
    'account.guardian',
    await getDb()
      .from('bridge_v2_accounts')
      .update({ guardian_address: guardian, guardian_revoked_at: revoked ? new Date().toISOString() : null })
      .eq('id', accountId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );
}

/** Deployed accounts after `afterId`, a page at a time, for the checks run over all of them. */
export async function deployedAccounts(afterId: string, limit: number): Promise<Account[]> {
  const rows = checked(
    'account.list_deployed',
    await getDb()
      .from('bridge_v2_accounts')
      .select(ACCOUNT_COLUMNS)
      .not('deployed_at', 'is', null)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as AccountRow[] | null;
  return Array.isArray(rows) ? rows.map(toAccount) : [];
}

// -----------------------------------------------------------------------------
// recoveries — 6.3, 6.4, A14
// -----------------------------------------------------------------------------

export type RecoveryStatus = 'AWAITING_PHONE' | 'PHONE_VERIFIED' | 'CONFIRMED' | 'FINALIZED' | 'CANCELED' | 'REFUSED';

export interface Recovery {
  readonly id: string;
  readonly participantId: string;
  readonly passkeyId: string;
  readonly status: RecoveryStatus;
  readonly startedAt: string | null;
  readonly executeAfter: string | null;
}

interface RecoveryRow {
  id: string;
  participant_id: string;
  passkey_id: string;
  status: RecoveryStatus;
  started_at: string | null;
  execute_after: string | null;
}

const RECOVERY_COLUMNS = 'id, participant_id, passkey_id, status, started_at, execute_after';

function toRecovery(row: RecoveryRow): Recovery {
  return {
    id: row.id,
    participantId: row.participant_id,
    passkeyId: row.passkey_id,
    status: row.status,
    startedAt: row.started_at ?? null,
    executeAfter: row.execute_after ?? null,
  };
}

/**
 * Opens a request. One live request per participant is the unique index's rule,
 * so a second request while one is running is refused rather than stacked.
 */
export async function openRecovery(
  participantId: string,
  passkeyId: string,
  linkCodeHash: string,
  linkExpiresAt: Date,
): Promise<Recovery | 'ALREADY_OPEN'> {
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
      .in('status', ['AWAITING_PHONE', 'PHONE_VERIFIED', 'CONFIRMED'])
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as RecoveryRow | null;
  return row === null ? null : toRecovery(row);
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
 */
export async function advanceRecovery(
  id: string,
  from: RecoveryStatus,
  to: RecoveryStatus,
  extra: Record<string, string | null> = {},
): Promise<boolean> {
  const row = checkedMaybe(
    'recovery.advance',
    await getDb()
      .from('bridge_v2_recoveries')
      .update({ status: to, updated_at: new Date().toISOString(), ...extra })
      .eq('id', id)
      .eq('status', from)
      .select('id')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  );
  return row !== null;
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

/** The derived key is never used for this index again (M2). */
export async function sealMigration(id: string): Promise<void> {
  checked(
    'migration.seal',
    await getDb()
      .from('bridge_v2_migrations')
      .update({ sealed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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

/** Every derived wallet not sealed yet, participants and creators (M34). */
export async function unsealedDerivedWallets(): Promise<
  { kind: 'PARTICIPANT' | 'CREATOR'; ownerId: string; walletIndex: number; address: `0x${string}` }[]
> {
  const db = getDb();
  const [participants, creators, sealed] = await Promise.all([
    db.from('bridge_v2_participants').select('id, wallet_index, wallet_address').not('wallet_index', 'is', null).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    db.from('bridge_v2_creators').select('id, wallet_index, wallet_address').not('wallet_index', 'is', null).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    db.from('bridge_v2_migrations').select('wallet_index').not('sealed_at', 'is', null).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ]);
  type Row = { id: string; wallet_index: number; wallet_address: string };
  const sealedSet = new Set(
    ((checked('migration.sealed_list', sealed) as { wallet_index: number }[] | null) ?? []).map((row) => Number(row.wallet_index)),
  );
  const out: { kind: 'PARTICIPANT' | 'CREATOR'; ownerId: string; walletIndex: number; address: `0x${string}` }[] = [];
  for (const [kind, result] of [['PARTICIPANT', participants], ['CREATOR', creators]] as const) {
    for (const row of (checked(`migration.${kind.toLowerCase()}_wallets`, result) as Row[] | null) ?? []) {
      if (sealedSet.has(Number(row.wallet_index))) continue;
      out.push({ kind, ownerId: row.id, walletIndex: Number(row.wallet_index), address: row.wallet_address as `0x${string}` });
    }
  }
  return out;
}
