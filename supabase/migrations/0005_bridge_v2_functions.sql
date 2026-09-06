-- =============================================================================
-- 0005_bridge_v2_functions — atomic server-side operations
--
-- Every counter in the bridge is incremented and checked inside one of these
-- functions. B3 and G1 forbid read-compare-write across the whole surface, and
-- findings #3 and #5 of the V1 audit are exactly that pattern: a SELECT count
-- followed by an INSERT, and a read of attempts followed by a write of
-- attempts + 1. Concurrent requests read the same value and the counter advances
-- once per round instead of once per attempt.
--
-- Putting the read and the write in one statement inside one transaction is the
-- only construction that closes it. Nothing here returns personal data, and
-- nothing here takes a plaintext email, phone or code — callers pass keyed
-- hashes (K4).
--
-- All functions are SECURITY INVOKER (the default) on purpose: the caller's role
-- must hold the table privileges granted in 0006, so a leaked role cannot reach
-- past what it was granted by calling a function that runs as the owner.
--
-- SEARCH PATH. Every function below sets it to public, extensions rather than
-- public alone. citext is the reason: two of these functions take a citext
-- parameter and several read citext columns, and the type, its operators and its
-- comparison functions are all resolved through the search_path at execution
-- time. Where citext was installed into extensions rather than public -- which
-- depends on when and by whom it was first created, and IF NOT EXISTS makes a
-- later WITH SCHEMA clause a no-op -- a body declared with public alone parses
-- at creation and then fails at runtime on the = it cannot resolve. Naming both
-- schemas is correct in either case and costs nothing in the other.
--
-- Idempotent: CREATE OR REPLACE throughout.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- rate limiting — B1, B2, B3, B4
-- -----------------------------------------------------------------------------
-- Returns whether the caller may proceed and, when not, how long to wait.
--
-- The increment is a single INSERT ... ON CONFLICT DO UPDATE, so two concurrent
-- callers cannot both observe the pre-increment value. The verdict is computed
-- from the value the increment itself returned, never from a prior read.
--
-- B4: crossing the ceiling raises strikes and sets a penalty that grows with
-- each strike, capped so that a mistake does not lock an axis out for a day.
--
-- THE PENALTY DOES NOT LIVE IN THE WINDOW ROW. It used to, and that made the
-- escalation a fiction: a window row is created by the first request of its
-- window and is gone with it, so an attacker who earned an hour of penalty on a
-- sixty-second axis waited sixty seconds and met a fresh row with zero strikes.
-- strikes and penalty_until are now read from and written to
-- bridge_v2_rate_penalties, keyed by (axis, key_hash) and by nothing else, so
-- crossing a window boundary changes nothing about what a caller already owes.
--
-- Strikes decay rather than accumulate for ever: a key whose last strike is
-- older than p_strike_decay_seconds starts again at one. B4 is a cost imposed on
-- somebody attacking now, not a permanent record of a mistyped code.
CREATE OR REPLACE FUNCTION bridge_v2_rate_limit_hit(
  p_axis                 text,
  p_key_hash             text,
  p_window_seconds       integer,
  p_max_count            integer,
  p_penalty_seconds      integer,
  p_strike_decay_seconds integer
) RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_window   timestamptz;
  v_count    integer;
  v_strikes  integer;
  v_penalty  timestamptz;
  v_last     timestamptz;
  v_now      timestamptz := now();
BEGIN
  -- The standing penalty is read first and under a row lock, so two concurrent
  -- callers cannot both observe the pre-strike value and both write strike n+1.
  SELECT p.strikes, p.penalty_until, p.last_strike_at
    INTO v_strikes, v_penalty, v_last
    FROM bridge_v2_rate_penalties p
   WHERE p.axis = p_axis AND p.key_hash = p_key_hash
     FOR UPDATE;

  v_strikes := COALESCE(v_strikes, 0);

  -- An active penalty denies regardless of the count, and denies WITHOUT
  -- spending a window slot: counting a request refused before it was looked at
  -- would let a penalised caller keep filling their own window.
  IF v_penalty IS NOT NULL AND v_penalty > v_now THEN
    RETURN QUERY SELECT false, GREATEST(1, ceil(extract(epoch from (v_penalty - v_now)))::integer);
    RETURN;
  END IF;

  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  INSERT INTO bridge_v2_rate_limits (axis, key_hash, window_start, count, updated_at)
  VALUES (p_axis, p_key_hash, v_window, 1, v_now)
  ON CONFLICT (axis, key_hash, window_start) DO UPDATE
    SET count = bridge_v2_rate_limits.count + 1,
        updated_at = v_now
  RETURNING count INTO v_count;

  IF v_count > p_max_count THEN
    IF v_last IS NULL OR v_last < v_now - make_interval(secs => p_strike_decay_seconds) THEN
      v_strikes := 1;
    ELSE
      v_strikes := v_strikes + 1;
    END IF;

    -- Growth is exponential in strikes and capped at one hour.
    v_penalty := v_now + make_interval(secs => LEAST(3600, p_penalty_seconds * power(2, LEAST(v_strikes - 1, 6))::integer));

    INSERT INTO bridge_v2_rate_penalties (axis, key_hash, strikes, penalty_until, last_strike_at)
    VALUES (p_axis, p_key_hash, v_strikes, v_penalty, v_now)
    ON CONFLICT (axis, key_hash) DO UPDATE
      SET strikes        = v_strikes,
          penalty_until  = v_penalty,
          last_strike_at = v_now;

    RETURN QUERY SELECT false, GREATEST(1, ceil(extract(epoch from (v_penalty - v_now)))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_rate_limit_hit IS 'B3/G1: increment and verdict in one atomic operation. B4: the penalty outlives the window.';

-- The five-argument signature this function had while the penalty lived in the
-- window row. Dropped rather than left in place: a caller reaching the old one
-- would silently get the behaviour B4 says is wrong.
DROP FUNCTION IF EXISTS bridge_v2_rate_limit_hit(text, text, integer, integer, integer);

-- -----------------------------------------------------------------------------
-- email code attempt — J4 and G1
-- -----------------------------------------------------------------------------
-- Claims one attempt against the newest live code for an email and returns the
-- stored hash so the caller can compare it in constant time (J5). The attempt is
-- spent by the same statement that hands out the hash, so a burst of concurrent
-- guesses spends one attempt each instead of sharing one.
--
-- Returns no row when there is no live code. The caller must treat that exactly
-- like a wrong code (D2): the response may not distinguish the two.
CREATE OR REPLACE FUNCTION bridge_v2_claim_email_code_attempt(
  p_email_canonical citext,
  p_max_attempts    integer
) RETURNS TABLE (code_id uuid, code_hash text, attempts_left integer)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH live AS (
    SELECT c.id
      FROM bridge_v2_email_codes c
     WHERE c.email_canonical = p_email_canonical
       AND c.consumed_at IS NULL
       AND c.expires_at > v_now
       AND c.attempts < p_max_attempts
     ORDER BY c.created_at DESC
     LIMIT 1
     FOR UPDATE
  )
  UPDATE bridge_v2_email_codes c
     SET attempts = c.attempts + 1
    FROM live
   WHERE c.id = live.id
  RETURNING c.id, c.code_hash, (p_max_attempts - c.attempts);
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_claim_email_code_attempt IS 'J4: one attempt spent per call, atomically. Closes finding #5.';

-- Marks a code consumed. Separate from the attempt claim because consumption
-- only happens after the constant-time comparison succeeds, which is work the
-- database must not do (it would need the plaintext code).
CREATE OR REPLACE FUNCTION bridge_v2_consume_email_code(p_code_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE bridge_v2_email_codes
     SET consumed_at = now()
   WHERE id = p_code_id AND consumed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- G2: the caller is handed the row count and must act on it. A consumption
  -- that changed nothing means someone else consumed it first.
  RETURN v_rows = 1;
END;
$fn$;

-- Supersedes every live code for an email. J3: only the most recent code is
-- valid, and superseding is explicit rather than implied by ordering alone.
CREATE OR REPLACE FUNCTION bridge_v2_supersede_email_codes(p_email_canonical citext)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE bridge_v2_email_codes
     SET consumed_at = now()
   WHERE email_canonical = p_email_canonical AND consumed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- link code consumption — 05/09/2026 decision, step 3 ("validates the code once")
-- -----------------------------------------------------------------------------
-- The previous signatures took a bigint chat id and returned a numeric campaign
-- id. Both are dropped rather than replaced: CREATE OR REPLACE cannot change a
-- parameter type or a return type, so leaving them would leave two overloads
-- live and PostgREST would have to guess which one a call meant.
DROP FUNCTION IF EXISTS bridge_v2_claim_link_for_chat(text, bigint);
DROP FUNCTION IF EXISTS bridge_v2_consume_link_for_chat(bigint);
-- Single use is enforced by the WHERE clause, not by a prior read: two bot
-- updates carrying the same code race on one UPDATE and exactly one wins.
-- p_chat_hmac, never a chat id: R4 keeps every Telegram identifier hashed at
-- rest, and the caller hashes before it gets here (phone.ts, K4).
--
-- giveaway_id leaves as text. The column is numeric(78,0) and PostgREST renders
-- a numeric as a JSON number, which is a double: a uint256 campaign id would
-- reach the caller already rounded, and it would be rounded silently.
CREATE OR REPLACE FUNCTION bridge_v2_claim_link_for_chat(
  p_code_hash text,
  p_chat_hmac text
) RETURNS TABLE (link_id uuid, participant_id uuid, giveaway_id text)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
BEGIN
  -- bridge_v2_link_codes_live_chat_unique allows one live link per chat. A
  -- participant who starts a second campaign from the same chat would otherwise
  -- make this statement raise, PostgREST answer 409, and the webhook answer 500
  -- to Telegram, which Telegram then retries for ever. The newest /start wins
  -- instead: the earlier link is detached from the chat and left unconsumed, so
  -- it can still be reopened from the page.
  UPDATE bridge_v2_link_codes c
     SET telegram_chat_hmac = NULL
   WHERE c.telegram_chat_hmac = p_chat_hmac
     AND c.consumed_at IS NULL
     AND c.code_hash <> p_code_hash;

  RETURN QUERY
  UPDATE bridge_v2_link_codes c
     SET telegram_chat_hmac = p_chat_hmac
   WHERE c.code_hash = p_code_hash
     AND c.consumed_at IS NULL
     AND c.expires_at > now()
  RETURNING c.id, c.participant_id, c.giveaway_id::text;
EXCEPTION
  -- Belt and braces for the same reason: a collision that survives the detach
  -- above leaves as "no live link", never as an exception the webhook has to
  -- turn into a status code.
  WHEN unique_violation THEN
    RETURN;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_claim_link_for_chat IS 'Binds a started link to the chat that opened it. Idempotent for a Telegram retry.';

-- Consumes the live link for a chat when the contact finally arrives. Single use
-- is enforced by the WHERE clause, so two deliveries of the same contact race on
-- one statement and exactly one wins. Telegram retries an unacknowledged
-- delivery, so a duplicate here is expected traffic rather than an attack.
CREATE OR REPLACE FUNCTION bridge_v2_consume_link_for_chat(p_chat_hmac text)
RETURNS TABLE (link_id uuid, participant_id uuid, giveaway_id text)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE bridge_v2_link_codes c
     SET consumed_at = now()
   WHERE c.telegram_chat_hmac = p_chat_hmac
     AND c.consumed_at IS NULL
     AND c.expires_at > now()
  RETURNING c.id, c.participant_id, c.giveaway_id::text;
END;
$fn$;



-- -----------------------------------------------------------------------------
-- phone binding and entry verification — C5, C6, and findings 8.7 and 8.8
-- -----------------------------------------------------------------------------
-- One function, one transaction, for what used to be two round trips: bind the
-- verified number to the participant, and move that participant's entry in this
-- campaign to VERIFIED. Split across two calls there was a window in which a
-- number was bound to an account whose entry never advanced: the number spent,
-- the participation lost, and no way back because the number is now in use.
--
-- 8.8: nothing here raises. Every uniqueness collision -- the live-number index,
-- the one-live-number-per-participant index, the (campaign, number) index --
-- leaves as a named outcome. The caller is the Telegram webhook, and an
-- exception there becomes a 500, which Telegram retries indefinitely.
--
-- Outcomes:
--   VERIFIED        the number is bound and the entry is verified
--   TAKEN           the number is live for a different participant (C5)
--   COOLDOWN        the number was released recently and is still cooling (C6)
--   NUMBER_CHANGED  a different number was live for this participant; it has
--                   been released into its cooldown and the account is blocked
--                   in every campaign it was active in at this moment (C6)
--   DUPLICATE       this number already holds an entry in this campaign
--   NOT_AWAITING    the entry is no longer waiting for a contact
--   NO_ENTRY        there is no entry for this participant and campaign
CREATE OR REPLACE FUNCTION bridge_v2_bind_phone_and_verify(
  p_phone_hmac       text,
  p_participant_id   uuid,
  p_giveaway_id      numeric,
  p_telegram_id_hmac text,
  p_cooldown_days    integer
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_owner    uuid;
  v_cooldown timestamptz;
  v_previous text;
  v_entry    uuid;
  v_rows     integer;
BEGIN
  -- C5: the live binding for this number decides before anything else. The row
  -- is locked so a concurrent delivery of the same contact cannot pass here too.
  SELECT participant_id INTO v_owner
    FROM bridge_v2_phones
   WHERE phone_hmac = p_phone_hmac AND released_at IS NULL
   FOR UPDATE;

  IF v_owner IS NOT NULL AND v_owner <> p_participant_id THEN
    RETURN 'TAKEN';
  END IF;

  IF v_owner IS NULL THEN
    SELECT max(cooldown_until) INTO v_cooldown
      FROM bridge_v2_phones
     WHERE phone_hmac = p_phone_hmac AND released_at IS NOT NULL;

    IF v_cooldown IS NOT NULL AND v_cooldown > now() THEN
      RETURN 'COOLDOWN';
    END IF;

    -- C6, the change of number. A participant holds one live number, so a
    -- different one arriving is a change: the old hash is released with its
    -- history kept, it enters the cooling period before anyone may rebind it,
    -- and the account is blocked in every campaign it was active in at this
    -- moment. The entry being confirmed right now is one of those, which is the
    -- point: a number cannot be swapped mid-confirmation and have the
    -- confirmation stand.
    SELECT phone_hmac INTO v_previous
      FROM bridge_v2_phones
     WHERE participant_id = p_participant_id AND released_at IS NULL
     FOR UPDATE;

    IF v_previous IS NOT NULL THEN
      UPDATE bridge_v2_phones
         SET released_at    = now(),
             cooldown_until = now() + make_interval(days => p_cooldown_days)
       WHERE participant_id = p_participant_id AND released_at IS NULL;

      UPDATE bridge_v2_entries
         SET status = 'FAILED', updated_at = now()
       WHERE participant_id = p_participant_id
         AND status IN ('AWAITING_CONTACT', 'VERIFIED', 'ELIGIBLE');

      RETURN 'NUMBER_CHANGED';
    END IF;

    BEGIN
      INSERT INTO bridge_v2_phones (phone_hmac, participant_id, telegram_user_id_hmac)
      VALUES (p_phone_hmac, p_participant_id, p_telegram_id_hmac);
    EXCEPTION
      -- The partial unique indexes are the authority. Losing the race to another
      -- transaction is reported, never raised.
      WHEN unique_violation THEN
        RETURN 'TAKEN';
    END;
  END IF;

  SELECT id INTO v_entry
    FROM bridge_v2_entries
   WHERE participant_id = p_participant_id AND giveaway_id = p_giveaway_id
   FOR UPDATE;

  IF v_entry IS NULL THEN
    RETURN 'NO_ENTRY';
  END IF;

  BEGIN
    UPDATE bridge_v2_entries
       SET phone_hmac = p_phone_hmac,
           status     = 'VERIFIED',
           updated_at = now()
     WHERE id = v_entry AND status = 'AWAITING_CONTACT';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION
    -- bridge_v2_entries_phone_giveaway_unique: this number already holds an
    -- entry in this campaign, which is the uniqueness rule of the 05/09/2026
    -- decision doing its job.
    WHEN unique_violation THEN
      RETURN 'DUPLICATE';
  END;

  -- The status predicate makes the transition idempotent: a Telegram retry
  -- delivering the same contact twice moves the row once.
  RETURN CASE WHEN v_rows = 1 THEN 'VERIFIED' ELSE 'NOT_AWAITING' END;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_bind_phone_and_verify IS '8.7: binding and verification in one transaction. 8.8: no collision escapes as an exception.';

-- The two-call version this replaces. Dropped rather than left in place: a
-- function nothing calls is a privilege nothing needs.
DROP FUNCTION IF EXISTS bridge_v2_bind_phone(text, uuid, text);

-- C6: release a number, opening the cooldown before it can be rebound.
CREATE OR REPLACE FUNCTION bridge_v2_release_phone(
  p_participant_id  uuid,
  p_cooldown_days   integer
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE bridge_v2_phones
     SET released_at = now(),
         cooldown_until = now() + make_interval(days => p_cooldown_days)
   WHERE participant_id = p_participant_id AND released_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- funder leases — G3 and G6
-- -----------------------------------------------------------------------------
-- Finding #9: the V1 lease expired at 30 seconds while waitForTransactionReceipt
-- ran without a timeout, so two invocations could hold the same funder and
-- collide nonces.
--
-- Two things fix it here. Acquisition is a conditional UPDATE that only takes a
-- funder whose lease is absent or already expired, so expiry alone never lets a
-- second holder in while the first still holds a valid lease. And the holder
-- carries a lease_token which every later call must present, so a holder whose
-- lease did expire cannot release or renew a funder that has since been taken by
-- somebody else.
CREATE OR REPLACE FUNCTION bridge_v2_acquire_funder(p_lease_seconds integer)
RETURNS TABLE (funder_index integer, address text, next_nonce bigint, lease_token uuid)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT f.funder_index
      FROM bridge_v2_funders f
     WHERE f.disabled_at IS NULL
       AND (f.leased_until IS NULL OR f.leased_until <= now())
     -- D6: not sequential. Random pick spreads entries across the pool so an
     -- observer cannot read entry order off the funding addresses.
     ORDER BY random()
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE bridge_v2_funders f
     SET leased_until = now() + make_interval(secs => p_lease_seconds),
         lease_token  = v_token,
         updated_at   = now()
    FROM candidate
   WHERE f.funder_index = candidate.funder_index
  RETURNING f.funder_index, f.address, f.next_nonce, f.lease_token;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_acquire_funder IS 'G3: conditional atomic acquisition. D6: random pick, not sequential.';

-- G3: renewal while the operation is alive. Requires the token, so only the
-- current holder can extend.
CREATE OR REPLACE FUNCTION bridge_v2_renew_funder_lease(
  p_funder_index  integer,
  p_lease_token   uuid,
  p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE bridge_v2_funders
     SET leased_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE funder_index = p_funder_index AND lease_token = p_lease_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- Releases the funder and advances the stored nonce in the same statement.
-- G6: the nonce is authoritative here, never read from the RPC as pending.
CREATE OR REPLACE FUNCTION bridge_v2_release_funder(
  p_funder_index  integer,
  p_lease_token   uuid,
  p_next_nonce    bigint
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE bridge_v2_funders
     SET leased_until = NULL,
         lease_token  = NULL,
         next_nonce   = GREATEST(next_nonce, p_next_nonce),
         updated_at   = now()
   WHERE funder_index = p_funder_index AND lease_token = p_lease_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- H8: a funder that cannot be used is taken out of rotation rather than retried
-- forever. Disabling is deliberate and visible, not an implicit skip.
CREATE OR REPLACE FUNCTION bridge_v2_disable_funder(p_funder_index integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_rows integer;
BEGIN
  UPDATE bridge_v2_funders
     SET disabled_at = now(), leased_until = NULL, lease_token = NULL, updated_at = now()
   WHERE funder_index = p_funder_index AND disabled_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$fn$;

-- -----------------------------------------------------------------------------
-- external spend ceiling — B8
-- -----------------------------------------------------------------------------
-- Claims units against both an hourly and a daily ceiling for one provider. The
-- claim is made before the external call, so the ceiling is enforced instead of
-- discovered on the invoice. Both windows move in the same transaction; if
-- either would exceed, neither is committed.
CREATE OR REPLACE FUNCTION bridge_v2_claim_spend(
  p_provider  text,
  p_units     integer,
  p_hour_cap  integer,
  p_day_cap   integer
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_now  timestamptz := now();
  v_hour timestamptz := date_trunc('hour', v_now);
  v_day  timestamptz := date_trunc('day', v_now);
  v_h    integer;
  v_d    integer;
BEGIN
  INSERT INTO bridge_v2_external_spend (provider, window_kind, window_start, units, updated_at)
  VALUES (p_provider, 'HOUR', v_hour, p_units, v_now)
  ON CONFLICT (provider, window_kind, window_start) DO UPDATE
    SET units = bridge_v2_external_spend.units + p_units, updated_at = v_now
  RETURNING units INTO v_h;

  INSERT INTO bridge_v2_external_spend (provider, window_kind, window_start, units, updated_at)
  VALUES (p_provider, 'DAY', v_day, p_units, v_now)
  ON CONFLICT (provider, window_kind, window_start) DO UPDATE
    SET units = bridge_v2_external_spend.units + p_units, updated_at = v_now
  RETURNING units INTO v_d;

  IF v_h > p_hour_cap OR v_d > p_day_cap THEN
    -- Undo the claim so a denied attempt does not consume budget.
    RAISE EXCEPTION 'bridge_v2_spend_ceiling' USING ERRCODE = 'check_violation';
  END IF;

  RETURN true;
EXCEPTION
  WHEN check_violation THEN
    RETURN false;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_claim_spend IS 'B8: ceiling claimed before the external call, both windows in one transaction.';

-- -----------------------------------------------------------------------------
-- retention — D7, I10 and K7
-- -----------------------------------------------------------------------------
-- Finding K6: bridge_codes grew without limit because nothing ever removed a
-- row. Every ephemeral table here has an expiry, and this is the process that
-- applies it. Returns one row per table so a run can be observed.
--
-- Deliberately does NOT touch participants, entries, phones, eligibility roots
-- or leaves. Those are the participation record and the proof material: an entry
-- that vanished would leave an address inside an on-chain root with nothing on
-- this side explaining how it got there. Erasure of a participant on request is
-- a separate deliberate path (D7), not a sweep.
CREATE OR REPLACE FUNCTION bridge_v2_cleanup(
  p_ops_retention_days integer,
  p_session_grace_days integer,
  p_penalty_decay_days integer
) RETURNS TABLE (table_name text, rows_removed integer)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM bridge_v2_email_codes WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_email_codes'::text, v_n;

  DELETE FROM bridge_v2_link_codes WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_link_codes'::text, v_n;

  DELETE FROM bridge_v2_sessions
   WHERE absolute_expires_at < now() - make_interval(days => p_session_grace_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_sessions'::text, v_n;

  DELETE FROM bridge_v2_rate_limits WHERE window_start < now() - interval '2 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_rate_limits'::text, v_n;

  -- B4 decay. Removed only once the strike count no longer means anything: the
  -- penalty has run out AND the last strike is older than the decay window the
  -- limiter itself applies. Deleting a row with a live penalty would hand the
  -- caller an amnesty the requirement exists to deny.
  DELETE FROM bridge_v2_rate_penalties
   WHERE last_strike_at < now() - make_interval(days => p_penalty_decay_days)
     AND (penalty_until IS NULL OR penalty_until < now());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_rate_penalties'::text, v_n;

  -- A lock whose holder died. Expiry already makes it unheld; removing the row
  -- keeps the table from being a permanent record of every run ever scheduled.
  DELETE FROM bridge_v2_locks WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_locks'::text, v_n;

  DELETE FROM bridge_v2_external_spend WHERE window_start < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_external_spend'::text, v_n;

  DELETE FROM bridge_v2_ops_events
   WHERE created_at < now() - make_interval(days => p_ops_retention_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN QUERY SELECT 'bridge_v2_ops_events'::text, v_n;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_cleanup IS 'I10/K7/D7: bounded retention for every ephemeral table. Closes finding K6.';

-- The two-argument signature, from before the penalty and lock tables existed.
DROP FUNCTION IF EXISTS bridge_v2_cleanup(integer, integer);

-- -----------------------------------------------------------------------------
-- scheduled-run mutual exclusion — G3 and G6
-- -----------------------------------------------------------------------------
-- Every individual signing path in the bridge is correct on its own and still
-- collides when two scheduled runs overlap: they list the same ELIGIBLE rows and
-- read the same account nonce for the role key and for a derived wallet. A cron
-- that fires every minute and does work that can take five overlaps itself by
-- construction, so exclusion has to be a property of the run, not of the code
-- inside it.
--
-- Acquisition is one statement. The ON CONFLICT branch is guarded by the expiry,
-- so a live lock makes the UPDATE match nothing and the function returns no row —
-- there is no window between reading who holds it and taking it.
--
-- A row rather than pg_try_advisory_lock: PostgREST pools connections and a
-- session lock is gone the moment the statement returns, which is before the run
-- it was meant to protect has done anything.
CREATE OR REPLACE FUNCTION bridge_v2_try_lock(
  p_name        text,
  p_ttl_seconds integer
) RETURNS uuid
LANGUAGE sql
SET search_path = public, extensions
AS $fn$
  INSERT INTO bridge_v2_locks (name, holder, acquired_at, expires_at)
  VALUES (p_name, gen_random_uuid(), now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (name) DO UPDATE
    SET holder      = gen_random_uuid(),
        acquired_at = now(),
        expires_at  = now() + make_interval(secs => p_ttl_seconds)
    WHERE bridge_v2_locks.expires_at <= now()
  RETURNING holder;
$fn$;

COMMENT ON FUNCTION bridge_v2_try_lock IS 'G6: one scheduled run at a time. No row means somebody else is running.';

-- Releases only if we still hold it. A run that overran its lease and had it
-- taken by the next run must not be able to release that run's lock.
CREATE OR REPLACE FUNCTION bridge_v2_release_lock(
  p_name   text,
  p_holder uuid
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM bridge_v2_locks WHERE name = p_name AND holder = p_holder;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_release_lock IS 'Releases only the lock this run took; an expired-and-retaken lock is left alone.';

-- -----------------------------------------------------------------------------
-- wallet index reservation — I9
-- -----------------------------------------------------------------------------
-- The address column is NOT NULL with a format CHECK, so a participant row can
-- never exist holding a placeholder. That was finding K5: the V1 inserted the
-- row first and wrote the address afterwards, so a failed UPDATE left
-- wallet_address as the literal '0x' permanently.
--
-- Reserving the index before the insert makes the address computable before the
-- row exists, so the row is written complete or not at all. A reservation that
-- is never used burns an index, which is correct: reusing it would hand one
-- person's wallet to another.
CREATE OR REPLACE FUNCTION bridge_v2_next_wallet_index()
RETURNS bigint
LANGUAGE sql
SET search_path = public, extensions
AS $fn$
  SELECT nextval('bridge_v2_wallet_index_seq');
$fn$;

COMMENT ON FUNCTION bridge_v2_next_wallet_index IS 'I9: reserve the index so the address is known before the row is written.';
