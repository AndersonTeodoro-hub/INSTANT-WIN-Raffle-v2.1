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

-- Extensions may live in public or in extensions depending on when and by whom
-- they were installed, and citext is the one that matters: a citext column, a
-- citext parameter and the = operator that compares them are all resolved
-- through the search_path. Setting it here means every CREATE, every GRANT and
-- every function signature below resolves the type the same way, whichever
-- schema actually holds it, instead of depending on the search_path the migration
-- happens to be run under. The functions in 0005 carry the same pair for the same
-- reason, because a function body resolves its operators at execution time.
SET search_path = public, extensions;

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
  -- Set when the bot receives /start with this code. It is what lets the contact
  -- message that arrives afterwards be matched back to the campaign and
  -- participant: a contact reply carries no code of its own.
  --
  -- R4: the HMAC, never the id. A Telegram chat id in a private chat with a bot
  -- is the user id, and the user id is stored hashed on bridge_v2_phones; a dump
  -- of this table in clear named the Telegram account of every participant
  -- beside the campaign they opened. Same root as the other Telegram
  -- identifiers, its own label, and the lookup only ever needs to recognise the
  -- same chat twice, never to read the id back.
  telegram_chat_hmac text,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bridge_v2_link_codes_expiry_idx ON bridge_v2_link_codes (expires_at);
-- At most one live link per chat, so two started links cannot both be waiting
-- for the same contact reply.
-- Applied to a database that already carries the previous shape of this table.
-- The old column is dropped rather than converted: it holds a chat id in clear,
-- and the point of the change is that the value should never have been there.
ALTER TABLE bridge_v2_link_codes ADD COLUMN IF NOT EXISTS telegram_chat_hmac text;
ALTER TABLE bridge_v2_link_codes DROP COLUMN IF EXISTS telegram_chat_id;

CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_link_codes_live_chat_unique
  ON bridge_v2_link_codes (telegram_chat_hmac)
  WHERE telegram_chat_hmac IS NOT NULL AND consumed_at IS NULL;
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
-- C6, the other half: a participant holds at most one live number. Presenting a
-- second one is a change of number, not an addition, and the change has
-- consequences (release, cooldown, and a block on campaigns active at that
-- moment) that only make sense if one number is the account's number.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_phones_participant_live_unique
  ON bridge_v2_phones (participant_id) WHERE released_at IS NULL;
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
  -- H7, the pair that decides what the sweep looks at. Both are needed, and
  -- neither is an audit trail; the ops events are that.
  --
  -- funded_at is written immediately BEFORE gas is sent to the derived wallet, by
  -- every phase that sends any: the entry funding, and the prize claim and
  -- delivery fundings that come after it. Before rather than after, so there is
  -- no ordering in which gas arrives at a wallet this column has not already
  -- named. It errs towards marking a wallet that was never funded, which costs
  -- the sweep one look at an empty address; the other direction leaves value in
  -- an address nothing lists.
  --
  -- swept_at says the wallet has been dealt with SINCE that funding — recovered,
  -- or found to hold less than recovering it would cost. Every funding clears it,
  -- which is what makes the prize phase's remainder reachable at all: the entry's
  -- gas is swept while the campaign runs, and the claim's and the delivery's
  -- remainders are put back in the queue by their own fundings months later.
  --
  -- Neither column mentions status, deliberately. An entry that was funded and
  -- then failed — the campaign closed between the funding and the retry — holds
  -- exactly as much gas as one that confirmed, and the sweep read only CONFIRMED
  -- rows, so that gas stayed where it was for ever.
  funded_at       timestamptz,
  swept_at        timestamptz,
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
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS swept_at timestamptz;
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS funded_at timestamptz;
CREATE INDEX IF NOT EXISTS bridge_v2_entries_pending_idx ON bridge_v2_entries (status, updated_at);
-- H7: the sweep queue, partial on the two columns that define it, so it holds
-- only the wallets that still owe a sweep however many entries the platform has
-- finished with. No status in it: gas is gas whatever the entry ended as.
CREATE INDEX IF NOT EXISTS bridge_v2_entries_sweep_queue_idx
  ON bridge_v2_entries (updated_at)
  WHERE funded_at IS NOT NULL AND swept_at IS NULL;
-- H7, for a database that already holds entries: a row that reached the chain was
-- funded, and on the old shape nothing recorded when. Without this the wallets
-- that are unswept TODAY would leave the queue the moment the column decides who
-- is in it, which is the opposite of what the column is for. tx_hash and the
-- three post-funding states are the evidence available on the old rows; the
-- timestamp is approximate and is used for nothing but "not null". Idempotent:
-- the filter excludes every row it has already written.
UPDATE bridge_v2_entries
   SET funded_at = updated_at
 WHERE funded_at IS NULL
   AND (tx_hash IS NOT NULL OR status IN ('FUNDING', 'SUBMITTED', 'CONFIRMED'));
-- C8/G4: what bridge_v2_campaigns_with_verified groups and orders by. Partial on
-- the one status it asks about, so it stays small however many entries the
-- platform has finished with, and ordered by created_at so the "oldest entry per
-- campaign" the queue is fair on is read rather than computed.
CREATE INDEX IF NOT EXISTS bridge_v2_entries_verified_queue_idx
  ON bridge_v2_entries (giveaway_id, created_at) WHERE status = 'VERIFIED';

COMMENT ON COLUMN bridge_v2_entries.funded_at IS 'H7: gas was sent to this wallet. Written before the transfer, by every phase that funds.';
COMMENT ON COLUMN bridge_v2_entries.swept_at IS 'H7: dealt with since that funding. Cleared by the next one, so every phase remainder is reachable.';
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
-- One row per (axis, key, window). The key is a keyed hash, so an IP, an email
-- or a phone never appears in clear in this table and none of them is
-- recoverable from it by dictionary either (K4).
--
-- The count lives here and NOTHING ELSE DOES. A window row is created by the
-- first request of its window and disappears with it, so anything stored on it
-- is forgotten at the window boundary — which is precisely what B4 says must not
-- happen to a penalty. strikes and penalty_until therefore live in
-- bridge_v2_rate_penalties below, keyed by (axis, key_hash) and by nothing else.
-- The two columns are kept on this table only so an existing installation is not
-- rewritten; nothing reads them any more.
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
-- rate_penalties — B4, and the reason it is not a column on the table above
-- -----------------------------------------------------------------------------
-- B4 asks that repeated attempts on one axis cost progressively more time. A
-- penalty recorded against a window is a penalty that ends when the window does:
-- with a sixty-second window an attacker who earned an hour of penalty waited
-- sixty seconds and met a fresh row with zero strikes. The escalation existed on
-- paper and never survived one window.
--
-- Keyed by (axis, key_hash) and by nothing else, so it outlives every window.
-- last_strike_at is what lets a strike count decay (the cleanup in 0005): the
-- growing cost is aimed at somebody attacking now, not at somebody who mistyped
-- a code last month.
CREATE TABLE IF NOT EXISTS bridge_v2_rate_penalties (
  axis           text        NOT NULL,
  key_hash       text        NOT NULL,
  strikes        integer     NOT NULL DEFAULT 0,
  penalty_until  timestamptz,
  last_strike_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (axis, key_hash)
);

CREATE INDEX IF NOT EXISTS bridge_v2_rate_penalties_strike_idx
  ON bridge_v2_rate_penalties (last_strike_at);

COMMENT ON TABLE bridge_v2_rate_penalties IS 'B4: escalating cost that survives the window boundary. Never keyed by window.';

-- -----------------------------------------------------------------------------
-- locks — G3 and G6, applied to a scheduled run rather than to a funder
-- -----------------------------------------------------------------------------
-- A cron that runs every minute and does work that can take longer than a minute
-- overlaps itself. Two overlapping runs of the pipeline read the same ELIGIBLE
-- rows, take different funders, and read the same account nonce for the role key
-- and for a derived wallet — which is G6 broken from the outside, by scheduling,
-- with every individual code path still correct.
--
-- The lease is a row rather than pg_try_advisory_lock because PostgREST pools
-- connections: a session-scoped lock is released the moment the statement that
-- took it returns, which is before the run it was meant to protect has started.
--
-- expires_at is what makes a killed run recoverable. A function the platform
-- stops does not release anything, so the lock has to be able to expire on its
-- own; it is set from the function's own maxDuration, so it cannot lapse while
-- the run holding it is still allowed to be alive.
CREATE TABLE IF NOT EXISTS bridge_v2_locks (
  name        text        PRIMARY KEY,
  holder      uuid        NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

COMMENT ON TABLE bridge_v2_locks IS 'G3/G6: one scheduled run at a time. Expiry bounded by the function maxDuration.';

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
  -- E3. Written when claimPrize is mined and the prize is actually in the
  -- derived wallet, never at entry time: custody cannot expire before it starts,
  -- and a campaign that runs longer than the window would otherwise have handed
  -- every winner an expiry already in the past.
  custody_expires_at       timestamptz,
  -- Section 7. claimed_at says the prize is in the derived wallet, delivered_at
  -- says it has left for the address the winner confirmed. Two facts rather than
  -- one status, because a run that dies between the claim and the delivery has
  -- to be resumable at exactly the point it stopped.
  claimed_at               timestamptz,
  claim_tx_hash            text,
  delivered_at             timestamptz,
  delivery_tx_hash         text,
  -- OWNER DECISION D2, 06/09/2026. An expired temporary custody with no
  -- destination is retained and nothing automatic happens to the value; the only
  -- action is one alert, once. Written the first time the expiry is observed, so
  -- the alert is a fact about the custody and not about how many times a cron
  -- happened to look at it. Without it the scheduled pass raised the same alert
  -- every minute for thirty days, which is an alerting channel that trains its
  -- reader to ignore it.
  custody_expired_alert_at timestamptz,
  -- Section 7 and G4. The settled campaign owes this wallet nothing and never
  -- will: it did not win, or the claim window closed with nothing claimed. Both
  -- are decided by the contract and neither is reversible.
  --
  -- It exists because "not delivered" was doing the work of "still owed", and
  -- they are not the same set. Every entry that confirms gets a custody row,
  -- winner or not, because at entry time nobody knows which it is. After the draw
  -- most of those rows belong to people who did not win, and delivered_at is
  -- never written for them because there is nothing to deliver — so they stayed
  -- in the queue for ever, ordered ahead of real prizes by updated_at, costing
  -- two chain reads apiece on every run and accumulating with every campaign the
  -- platform ever ran.
  --
  -- Deliberately not delivered_at: that column says a prize left the wallet, and
  -- an operator reading this table has to be able to tell the two apart.
  no_prize_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bridge_v2_custody ADD COLUMN IF NOT EXISTS claimed_at               timestamptz;
ALTER TABLE bridge_v2_custody ADD COLUMN IF NOT EXISTS claim_tx_hash            text;
ALTER TABLE bridge_v2_custody ADD COLUMN IF NOT EXISTS delivered_at             timestamptz;
ALTER TABLE bridge_v2_custody ADD COLUMN IF NOT EXISTS delivery_tx_hash         text;
ALTER TABLE bridge_v2_custody ADD COLUMN IF NOT EXISTS custody_expired_alert_at timestamptz;
ALTER TABLE bridge_v2_custody ADD COLUMN IF NOT EXISTS no_prize_at              timestamptz;

-- The prize queue: custody rows that can still receive a prize, oldest touched
-- first. Both exclusions matter — one for a prize that has arrived where it was
-- going, one for an entry that was never owed anything — and the index carries
-- them so the queue read stays a scan of what is actually pending. Dropped first
-- because CREATE INDEX IF NOT EXISTS keeps whatever predicate the index already
-- has, so a database holding the previous definition would keep it silently.
DROP INDEX IF EXISTS bridge_v2_custody_pending_idx;
CREATE INDEX IF NOT EXISTS bridge_v2_custody_pending_idx
  ON bridge_v2_custody (updated_at) WHERE delivered_at IS NULL AND no_prize_at IS NULL;

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
ALTER TABLE bridge_v2_rate_penalties     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_locks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_funders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_external_spend     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_disposable_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_custody            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_ops_events         ENABLE ROW LEVEL SECURITY;
