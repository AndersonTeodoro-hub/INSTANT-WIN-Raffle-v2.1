-- =============================================================================
-- 0012_keptra_accounts — SPEC-BLOCO-03 section 6 and Adenda A (piece 1).
--
-- User accounts controlled by passkey: a Safe 1.4.1 per role (A10) whose only
-- owners are the user's passkey signers, a recovery module with one guardian,
-- and the migration of the derived wallets that came before them (6.6).
--
-- A FILE, NEVER APPLIED TO PRODUCTION BY THE BUILD SESSION (A15). The owner
-- applies it.
--
-- NEVER stored here, as in 0004: a key, a seed, a private passkey, a phone
-- number or a Telegram id in clear. A passkey is stored by its PUBLIC
-- coordinates, which are what the signer contract is built from and are public
-- on-chain once used. The Telegram chat id is stored encrypted (A5), under a
-- key held outside the database.
--
-- Idempotent, like 0004, 0007, 0010 and 0011. Re-apply after 0006 for the same
-- reason 0011 gives: 0006's sweep does not name these tables.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. participants and creators — no new derived wallet (6.6.1, M31)
-- -----------------------------------------------------------------------------
-- New participants are created without a derivation index: their entries are
-- made by their account. Existing rows keep theirs until the wallet is migrated
-- (A8). The pair is still all or nothing, so no row can hold an address with no
-- index or an index with no address (I9).
ALTER TABLE bridge_v2_participants ALTER COLUMN wallet_index DROP DEFAULT;
ALTER TABLE bridge_v2_participants ALTER COLUMN wallet_index DROP NOT NULL;
ALTER TABLE bridge_v2_participants ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE bridge_v2_participants DROP CONSTRAINT IF EXISTS bridge_v2_participants_derived_pair;
ALTER TABLE bridge_v2_participants ADD CONSTRAINT bridge_v2_participants_derived_pair
  CHECK ((wallet_index IS NULL) = (wallet_address IS NULL));

-- A5: the Telegram chat, so the bridge can send a security notice. Encrypted and
-- reversible; the key is not in the database (lib/bridge-v2/phone.ts).
ALTER TABLE bridge_v2_participants ADD COLUMN IF NOT EXISTS telegram_chat_enc text;
COMMENT ON COLUMN bridge_v2_participants.telegram_chat_enc IS
  'A5: Telegram chat id, AES-GCM encrypted at rest. Used only for account security notices.';

-- A creator row with no index is a creator whose deposit address is their
-- creator account (A10), and the bridge never signs for it.
ALTER TABLE bridge_v2_creators ALTER COLUMN wallet_index DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. passkeys — public keys only
-- -----------------------------------------------------------------------------
-- signer_address is SafeWebAuthnSignerFactory.getSigner(x, y, VERIFIERS): the
-- owner the account knows. Unique platform-wide, with the credential: a public
-- key registered by one participant cannot be claimed by another.
CREATE TABLE IF NOT EXISTS bridge_v2_passkeys (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid          NOT NULL REFERENCES bridge_v2_participants (id),
  -- The length as its own check: Postgres regular expressions cap a repetition
  -- count at 255, so '{16,1400}' would fail at the first insert, not at CREATE.
  credential_id  text          NOT NULL UNIQUE CHECK (char_length(credential_id) BETWEEN 16 AND 1400 AND credential_id ~ '^[A-Za-z0-9_-]+$'),
  public_x       numeric(78,0) NOT NULL CHECK (public_x > 0),
  public_y       numeric(78,0) NOT NULL CHECK (public_y > 0),
  signer_address text          NOT NULL UNIQUE CHECK (signer_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at     timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bridge_v2_passkeys_participant_idx ON bridge_v2_passkeys (participant_id);

-- -----------------------------------------------------------------------------
-- 3. accounts — one Safe per participant and role (6.1.1, A10, M3)
-- -----------------------------------------------------------------------------
-- The address is written before the account exists (6.1.6): it is a function of
-- initial_signer and role alone, so the row is complete from the start.
-- guardian_address is the guardian the account's configuration adds, and after
-- A6 the one it holds; guardian_revoked_at marks an account left without
-- recovery until it adds the new one.
CREATE TABLE IF NOT EXISTS bridge_v2_accounts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id      uuid        NOT NULL REFERENCES bridge_v2_participants (id),
  role                text        NOT NULL CHECK (role IN ('PARTICIPANT', 'CREATOR')),
  safe_address        text        NOT NULL UNIQUE CHECK (safe_address ~ '^0x[0-9a-fA-F]{40}$'),
  initial_signer      text        NOT NULL CHECK (initial_signer ~ '^0x[0-9a-fA-F]{40}$'),
  guardian_address    text        NOT NULL CHECK (guardian_address ~ '^0x[0-9a-fA-F]{40}$'),
  deployed_at         timestamptz,
  deploy_tx_hash      text,
  guardian_revoked_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bridge_v2_accounts_one_per_role UNIQUE (participant_id, role)
);

COMMENT ON TABLE bridge_v2_accounts IS
  'SPEC-BLOCO-03 6.1: one Safe per participant and role. The bridge never holds a key for it.';

-- -----------------------------------------------------------------------------
-- 4. entries — made by an account (6.5)
-- -----------------------------------------------------------------------------
-- passkey: the entry's address is the participant's account. It is a
-- self-custody entry in every way the pipeline cares about — the bridge signs
-- nothing for it and holds no prize for it (6.2.3, A12) — which the CHECK makes a
-- property of the row rather than of the code. funded_at can never be written on
-- one, so it can never reach the sweep queue (M29).
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS passkey boolean NOT NULL DEFAULT false;
-- A4: when the "confirm your entry" email went out, so it goes once.
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS enter_reminder_at timestamptz;
ALTER TABLE bridge_v2_entries DROP CONSTRAINT IF EXISTS bridge_v2_entries_passkey_self_custody;
ALTER TABLE bridge_v2_entries ADD CONSTRAINT bridge_v2_entries_passkey_self_custody
  CHECK (NOT passkey OR (self_custody AND funded_at IS NULL));

-- -----------------------------------------------------------------------------
-- 5. recoveries — 6.3, 6.4 and A14
-- -----------------------------------------------------------------------------
-- One request per participant, covering every account the participant has
-- deployed: the lost passkey owns them all (A10). Its lifecycle:
--   AWAITING_PHONE  the email session asked; Telegram has not confirmed the number
--   PHONE_VERIFIED  both factors held (A14); the guardian may confirm after R-1
--   CONFIRMED       the module's 7 days are running on every account
--   FINALIZED       the owners were swapped (R-6)
--   CANCELED        cancelled with the old passkey everywhere (6.3.3)
--   REFUSED         R-1 refused the new owner; nothing was confirmed
-- The link code is the Telegram deep link of A14, stored as a keyed hash like
-- bridge_v2_link_codes and matched to the chat by its HMAC (R4).
CREATE TABLE IF NOT EXISTS bridge_v2_recoveries (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id     uuid        NOT NULL REFERENCES bridge_v2_participants (id),
  passkey_id         uuid        NOT NULL REFERENCES bridge_v2_passkeys (id),
  status             text        NOT NULL CHECK (status IN (
                                   'AWAITING_PHONE', 'PHONE_VERIFIED', 'CONFIRMED',
                                   'FINALIZED', 'CANCELED', 'REFUSED')),
  link_code_hash     text        NOT NULL UNIQUE,
  link_expires_at    timestamptz NOT NULL,
  telegram_chat_hmac text,
  phone_verified_at  timestamptz,
  -- t0 and the end of the 7 days, both from the chain's clock.
  started_at         timestamptz,
  execute_after      timestamptz,
  finalized_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_recoveries_live_unique
  ON bridge_v2_recoveries (participant_id)
  WHERE status IN ('AWAITING_PHONE', 'PHONE_VERIFIED', 'CONFIRMED');
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_recoveries_live_chat_unique
  ON bridge_v2_recoveries (telegram_chat_hmac)
  WHERE telegram_chat_hmac IS NOT NULL AND status = 'AWAITING_PHONE';
CREATE INDEX IF NOT EXISTS bridge_v2_recoveries_queue_idx
  ON bridge_v2_recoveries (status, updated_at);

-- 6.3.2: three notices, each at most once per channel. The primary key is the
-- "once": a notice is claimed by inserting its row, before it is sent.
CREATE TABLE IF NOT EXISTS bridge_v2_recovery_notices (
  recovery_id uuid        NOT NULL REFERENCES bridge_v2_recoveries (id),
  stage       text        NOT NULL CHECK (stage IN ('START', 'MID', 'FINAL')),
  channel     text        NOT NULL CHECK (channel IN ('EMAIL', 'TELEGRAM')),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recovery_id, stage, channel)
);

-- -----------------------------------------------------------------------------
-- 6. migrations of derived wallets — 6.6 and A8, A9
-- -----------------------------------------------------------------------------
-- authorized_at: the passkey signed the move, verified on-chain before this row
-- was written (M32). sealed_at: nothing is left in the wallet and no right is
-- still tied to it, so the derived key is never used for this index again (M2).
-- wallet_index is unique across participants and creators already (one sequence).
CREATE TABLE IF NOT EXISTS bridge_v2_migrations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_index    bigint      NOT NULL UNIQUE CHECK (wallet_index >= 0),
  derived_address text        NOT NULL CHECK (derived_address ~ '^0x[0-9a-fA-F]{40}$'),
  account_id      uuid        NOT NULL REFERENCES bridge_v2_accounts (id),
  kind            text        NOT NULL CHECK (kind IN ('PARTICIPANT', 'CREATOR')),
  authorized_at   timestamptz NOT NULL DEFAULT now(),
  sealed_at       timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bridge_v2_migrations_pending_idx
  ON bridge_v2_migrations (updated_at) WHERE sealed_at IS NULL;

-- -----------------------------------------------------------------------------
-- RLS and grants — the same shape as every bridge_v2_* table (I5)
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_passkeys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_recoveries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_recovery_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_migrations       ENABLE ROW LEVEL SECURITY;

-- Exactly the verbs lib/bridge-v2/accounts.ts uses. No DELETE anywhere: a
-- passkey, an account, a recovery and a migration are records.
GRANT SELECT, INSERT         ON TABLE public.bridge_v2_passkeys         TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_accounts         TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_recoveries       TO service_role;
GRANT SELECT, INSERT         ON TABLE public.bridge_v2_recovery_notices TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_migrations       TO service_role;

REVOKE ALL ON TABLE public.bridge_v2_passkeys         FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_accounts         FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_recoveries       FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_recovery_notices FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_migrations       FROM anon, authenticated;
