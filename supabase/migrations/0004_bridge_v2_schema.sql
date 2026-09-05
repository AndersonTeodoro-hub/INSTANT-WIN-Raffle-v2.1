-- =============================================================================
-- 0004_bridge_v2_schema — Web2 Bridge V2
--
-- Implements SPEC-BRIDGE-V2.md. The bridge is the only entry path into a
-- giveaway (SPEC-GIVEAWAY-V2 3.2), so every anti-sybil defence lives here and a
-- failure here is a failure of the whole platform.
--
-- NEVER stored here: seeds, private keys, derived keys, bot tokens, plaintext
-- phone numbers. Rule 0.1. This database holds derivation indexes, public
-- addresses, and keyed hashes.
--
-- The V1 tables are left untouched. V2 is a from-scratch build (0.5); the fate
-- of V1 is not decided by this migration.
--
-- Idempotent: every statement is IF NOT EXISTS or equivalent.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- participants — one row per canonical email, forever
-- -----------------------------------------------------------------------------
-- C1: the unique key is the CANONICAL email, never the literal. Storing the
-- literal would reintroduce finding #6 (alias +N defeats one-email-one-entry).
-- Canonicalisation preserves deliverability, so the canonical form is what we
-- send to and the literal is never persisted (D7 minimisation).
--
-- Under the 05/09/2026 decision email is NOT the uniqueness factor for
-- participation — the phone is. Email identifies the account and receives
-- notification; entry uniqueness lives on bridge_v2_entries.
CREATE SEQUENCE IF NOT EXISTS bridge_v2_wallet_index_seq AS bigint START WITH 0 MINVALUE 0;

CREATE TABLE IF NOT EXISTS bridge_v2_participants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_canonical citext      NOT NULL UNIQUE,
  wallet_index    bigint      NOT NULL UNIQUE DEFAULT nextval('bridge_v2_wallet_index_seq'),
  wallet_address  text        NOT NULL CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  bridge_v2_participants IS 'Canonical email to derived wallet. Personal data; retention per D7.';
COMMENT ON COLUMN bridge_v2_participants.wallet_index IS 'BIP-44 index. Only source: bridge_v2_wallet_index_seq, never COUNT or MAX+1.';
COMMENT ON COLUMN bridge_v2_participants.wallet_address IS 'Public address only. The private key is never persisted (F6).';

-- -----------------------------------------------------------------------------
-- sessions — A1 to A5
-- -----------------------------------------------------------------------------
-- A2: token is CSPRNG with at least 256 bits of entropy, stored only as a keyed
-- hash, so a database dump yields no usable session token.
-- A4: two independent clocks. idle_expires_at slides on use; absolute_expires_at
-- never moves. Renewal requires a still-valid session.
-- A5: revoked_at gives a mass-revocation path per participant.
CREATE TABLE IF NOT EXISTS bridge_v2_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id      uuid        NOT NULL REFERENCES bridge_v2_participants (id),
  token_hash          text        NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  ip_hash             text,
  subnet_hash         text,
  client_hash         text
);

CREATE INDEX IF NOT EXISTS bridge_v2_sessions_participant_idx ON bridge_v2_sessions (participant_id);
CREATE INDEX IF NOT EXISTS bridge_v2_sessions_expiry_idx ON bridge_v2_sessions (absolute_expires_at);

COMMENT ON COLUMN bridge_v2_sessions.token_hash IS 'Keyed hash of the opaque token. The token itself is never stored (A2).';
COMMENT ON COLUMN bridge_v2_sessions.ip_hash IS 'C7 correlation signal, hashed. Never a raw IP (K4).';

-- -----------------------------------------------------------------------------
-- email_codes — J1 to J4
-- -----------------------------------------------------------------------------
-- J3: only the most recent unconsumed code for an email is valid.
-- J4: attempts is incremented atomically by a function in 0005 (G1), never by
-- read-modify-write, which was finding #5.
CREATE TABLE IF NOT EXISTS bridge_v2_email_codes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_canonical citext      NOT NULL,
  code_hash       text        NOT NULL,
  expires_at      timestamptz NOT NULL,
  attempts        integer     NOT NULL DEFAULT 0,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_v2_email_codes_lookup_idx
  ON bridge_v2_email_codes (email_canonical, consumed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS bridge_v2_email_codes_expiry_idx ON bridge_v2_email_codes (expires_at);

COMMENT ON COLUMN bridge_v2_email_codes.code_hash IS 'HMAC under the code-dedicated key (F1, J2). The code is never persisted in clear.';

-- -----------------------------------------------------------------------------
-- link_codes — the Telegram deep-link code, 05/09/2026 decision step 1
-- -----------------------------------------------------------------------------
-- Random, single use, generated by the bridge, bound to (campaign, participant).
-- Stored as a keyed hash because the value travels to a third party and must not
-- be replayable from a database dump.
CREATE TABLE IF NOT EXISTS bridge_v2_link_codes (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      text          NOT NULL UNIQUE,
  participant_id uuid          NOT NULL REFERENCES bridge_v2_participants (id),
  giveaway_id    numeric(78,0) NOT NULL CHECK (giveaway_id > 0),
  expires_at     timestamptz   NOT NULL,
  consumed_at    timestamptz,
  -- Set when the bot receives /start with this code, cleared never. It is what
  -- lets the contact message that arrives afterwards be matched back to the
  -- campaign and participant: a contact reply carries no code of its own.
  telegram_chat_id bigint,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_v2_link_codes_expiry_idx ON bridge_v2_link_codes (expires_at);
-- At most one live link per chat, so two started links cannot both be waiting
-- for the same contact reply.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_link_codes_live_chat_unique
  ON bridge_v2_link_codes (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS bridge_v2_link_codes_participant_idx ON bridge_v2_link_codes (participant_id, giveaway_id);

COMMENT ON TABLE bridge_v2_link_codes IS 'Single-use code bound to campaign and participant; consumed once by the Telegram bot.';

-- -----------------------------------------------------------------------------
-- phones — C5 and C6
-- -----------------------------------------------------------------------------
-- C5: the number is NEVER stored in clear. phone_hmac is an HMAC under a key
-- dedicated to phone numbers (F1) and is unique across the whole platform, so a
-- number used anywhere cannot be reused by another account.
-- C6: a released number keeps its historical row; released_at plus
-- cooldown_until hold it out of circulation before it can be rebound.
-- R4: the Telegram user id is likewise kept only as a keyed hash.
CREATE TABLE IF NOT EXISTS bridge_v2_phones (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hmac            text        NOT NULL,
  participant_id        uuid        NOT NULL REFERENCES bridge_v2_participants (id),
  telegram_user_id_hmac text,
  bound_at              timestamptz NOT NULL DEFAULT now(),
  released_at           timestamptz,
  cooldown_until        timestamptz
);

-- Global uniqueness applies to the live binding only. A released number keeps
-- its history; at most one row per number may be live at a time.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_phones_live_unique
  ON bridge_v2_phones (phone_hmac) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS bridge_v2_phones_participant_idx ON bridge_v2_phones (participant_id);
CREATE INDEX IF NOT EXISTS bridge_v2_phones_cooldown_idx ON bridge_v2_phones (phone_hmac, cooldown_until);

COMMENT ON COLUMN bridge_v2_phones.phone_hmac IS 'HMAC under the phone-dedicated key. The number in clear is never persisted (C5).';

-- -----------------------------------------------------------------------------
-- entries — one per (campaign, phone), per the 05/09/2026 decision
-- -----------------------------------------------------------------------------
-- I8: every state below is written by some code path. No dead state.
--   AWAITING_CONTACT  a link code was issued, the bot has not answered yet
--   VERIFIED          the bot returned a Telegram-verified contact
--   ELIGIBLE          the address sits inside a published eligibility root
--   FUNDING           gas is on its way to the derived wallet
--   SUBMITTED         enter() was broadcast
--   CONFIRMED         enter() is mined
--   FAILED            terminal failure; the reason is an ops event, not a column
CREATE TABLE IF NOT EXISTS bridge_v2_entries (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  uuid          NOT NULL REFERENCES bridge_v2_participants (id),
  giveaway_id     numeric(78,0) NOT NULL CHECK (giveaway_id > 0),
  phone_hmac      text,
  status          text          NOT NULL CHECK (status IN (
                                  'AWAITING_CONTACT',
                                  'VERIFIED',
                                  'ELIGIBLE',
                                  'FUNDING',
                                  'SUBMITTED',
                                  'CONFIRMED',
                                  'FAILED'
                                )),
  wallet_address  text          NOT NULL CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  root_index      numeric(78,0),
  tx_hash         text,
  idempotency_key text          NOT NULL UNIQUE,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT bridge_v2_entries_participant_giveaway_key UNIQUE (participant_id, giveaway_id)
);

-- The uniqueness rule of the 05/09/2026 decision: one entry per (phone,
-- campaign). Partial, because phone_hmac is null until the bot answers.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_entries_phone_giveaway_unique
  ON bridge_v2_entries (giveaway_id, phone_hmac) WHERE phone_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS bridge_v2_entries_giveaway_idx ON bridge_v2_entries (giveaway_id, status);
CREATE INDEX IF NOT EXISTS bridge_v2_entries_pending_idx ON bridge_v2_entries (status, updated_at);

COMMENT ON COLUMN bridge_v2_entries.idempotency_key IS 'G5: one external effect per key. A repeat never funds or enters twice.';
COMMENT ON COLUMN bridge_v2_entries.wallet_address IS 'I9: written at creation from the derivation, never a sentinel.';

-- -----------------------------------------------------------------------------
-- eligibility roots and leaves — SPEC-GIVEAWAY-V2 4.1, append-only
-- -----------------------------------------------------------------------------
-- The contract keeps a historical array of roots per campaign and never removes
-- one. The bridge must be able to rebuild a proof for any address against the
-- root it was admitted under, so the full leaf set of every published root is
-- kept here.
CREATE TABLE IF NOT EXISTS bridge_v2_eligibility_roots (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id numeric(78,0) NOT NULL CHECK (giveaway_id > 0),
  root_index  numeric(78,0) NOT NULL,
  root        text          NOT NULL CHECK (root ~ '^0x[0-9a-fA-F]{64}$'),
  leaf_count  integer       NOT NULL CHECK (leaf_count > 0),
  tx_hash     text,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT bridge_v2_eligibility_roots_key UNIQUE (giveaway_id, root_index)
);

CREATE TABLE IF NOT EXISTS bridge_v2_eligibility_leaves (
  id       uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  root_id  uuid    NOT NULL REFERENCES bridge_v2_eligibility_roots (id),
  address  text    NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  position integer NOT NULL CHECK (position >= 0),
  CONSTRAINT bridge_v2_eligibility_leaves_key UNIQUE (root_id, position)
);

CREATE INDEX IF NOT EXISTS bridge_v2_eligibility_leaves_addr_idx ON bridge_v2_eligibility_leaves (address);

-- -----------------------------------------------------------------------------
-- rate_limits — B1 to B4, counted atomically by the functions in 0005
-- -----------------------------------------------------------------------------
-- One row per (axis, key, window). The key is hashed, so an IP, an email or a
-- phone never appears in clear in this table (K4).
-- B4: strikes drives a growing penalty_until, so a repeat offender waits longer
-- rather than failing instantly.
CREATE TABLE IF NOT EXISTS bridge_v2_rate_limits (
  axis          text        NOT NULL,
  key_hash      text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  strikes       integer     NOT NULL DEFAULT 0,
  penalty_until timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (axis, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS bridge_v2_rate_limits_window_idx ON bridge_v2_rate_limits (window_start);

-- -----------------------------------------------------------------------------
-- funders — G3, G6 and F7
-- -----------------------------------------------------------------------------
-- F7: these keys are independent of the participant derivation root. The pool is
-- addressed by index; the private keys live only in an environment variable.
-- G6: next_nonce is held here and serialised per account, so no path depends on
-- a concurrently read pending nonce.
-- G3: acquisition is a conditional atomic update, so an expired lease alone
-- never authorises a second holder; the holder renews while the work is alive.
CREATE TABLE IF NOT EXISTS bridge_v2_funders (
  funder_index integer     PRIMARY KEY CHECK (funder_index >= 0),
  address      text        NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  leased_until timestamptz,
  lease_token  uuid,
  next_nonce   bigint      NOT NULL DEFAULT 0 CHECK (next_nonce >= 0),
  disabled_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bridge_v2_funders IS 'Gas funder pool. Keys never stored here; only index, address, lease and nonce.';

-- -----------------------------------------------------------------------------
-- external_spend — B7 and B8
-- -----------------------------------------------------------------------------
-- B8: an absolute ceiling per provider per hour and per day. Reaching it stops
-- the provider being used and raises an alert, rather than spending on.
CREATE TABLE IF NOT EXISTS bridge_v2_external_spend (
  provider     text        NOT NULL,
  window_kind  text        NOT NULL CHECK (window_kind IN ('HOUR', 'DAY')),
  window_start timestamptz NOT NULL,
  units        integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, window_kind, window_start)
);

-- -----------------------------------------------------------------------------
-- disposable_domains — C2, updatable without a deploy
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_v2_disposable_domains (
  domain   citext      PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bridge_v2_disposable_domains IS 'C2 blocklist, edited in the database so no deploy is needed to update it.';

-- -----------------------------------------------------------------------------
-- custody — E2, E3 and E4
-- -----------------------------------------------------------------------------
-- E2 thresholds are policy applied in code; this table records the outcome per
-- entry so a destination is never inferred.
-- E3: custody_expires_at is set when temporary custody begins, so custody can
-- never become indefinite.
CREATE TABLE IF NOT EXISTS bridge_v2_custody (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id                 uuid        NOT NULL UNIQUE REFERENCES bridge_v2_entries (id),
  prize_kind               text        NOT NULL CHECK (prize_kind IN ('TOKEN', 'NFT')),
  requires_own_wallet      boolean     NOT NULL,
  destination_address      text        CHECK (destination_address IS NULL OR destination_address ~ '^0x[0-9a-fA-F]{40}$'),
  destination_confirmed_at timestamptz,
  custody_expires_at       timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- ops_events — K5 and K8
-- -----------------------------------------------------------------------------
-- Enough context to diagnose in production, under a correlation id, with no
-- personal data (K4). The V1 discarded err.message and the stack entirely, which
-- made production diagnosis impossible; this is the other half of that trade.
-- K7: retention is bounded and enforced by the cleanup function in 0005.
CREATE TABLE IF NOT EXISTS bridge_v2_ops_events (
  id             bigserial   PRIMARY KEY,
  correlation_id uuid        NOT NULL,
  kind           text        NOT NULL,
  route          text,
  detail         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_v2_ops_events_created_idx ON bridge_v2_ops_events (created_at);
CREATE INDEX IF NOT EXISTS bridge_v2_ops_events_correlation_idx ON bridge_v2_ops_events (correlation_id);
CREATE INDEX IF NOT EXISTS bridge_v2_ops_events_kind_idx ON bridge_v2_ops_events (kind, created_at);

COMMENT ON TABLE bridge_v2_ops_events IS 'Operational diagnostics under a correlation id. No personal data, ever (K4).';

-- -----------------------------------------------------------------------------
-- RLS — I5
-- -----------------------------------------------------------------------------
-- Enabled on every table, with ZERO policies. anon and authenticated therefore
-- read and write nothing, even if a publishable key reaches the browser. Access
-- is exclusively through the two dedicated roles created in 0006, granted per
-- table and per verb.
--
-- Adding a policy here opens personal data to the browser. Do not add one
-- without a written reason.
ALTER TABLE bridge_v2_participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_email_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_link_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_phones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_entries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_eligibility_roots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_eligibility_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_rate_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_funders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_external_spend     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_disposable_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_custody            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_ops_events         ENABLE ROW LEVEL SECURITY;
