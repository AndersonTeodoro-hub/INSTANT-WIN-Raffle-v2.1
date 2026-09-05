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
-- Idempotent: CREATE OR REPLACE throughout.
-- =============================================================================

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
CREATE OR REPLACE FUNCTION bridge_v2_rate_limit_hit(
  p_axis             text,
  p_key_hash         text,
  p_window_seconds   integer,
  p_max_count        integer,
  p_penalty_seconds  integer
) RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_window   timestamptz;
  v_count    integer;
  v_strikes  integer;
  v_penalty  timestamptz;
  v_now      timestamptz := now();
BEGIN
  v_window := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  INSERT INTO bridge_v2_rate_limits (axis, key_hash, window_start, count, updated_at)
  VALUES (p_axis, p_key_hash, v_window, 1, v_now)
  ON CONFLICT (axis, key_hash, window_start) DO UPDATE
    SET count = bridge_v2_rate_limits.count + 1,
        updated_at = v_now
  RETURNING count, strikes, penalty_until INTO v_count, v_strikes, v_penalty;

  -- An active penalty denies regardless of the count: B4 makes the wait the
  -- consequence, not an instant failure that costs the attacker nothing.
  IF v_penalty IS NOT NULL AND v_penalty > v_now THEN
    RETURN QUERY SELECT false, GREATEST(1, ceil(extract(epoch from (v_penalty - v_now)))::integer);
    RETURN;
  END IF;

  IF v_count > p_max_count THEN
    v_strikes := v_strikes + 1;
    -- Growth is exponential in strikes and capped at one hour.
    v_penalty := v_now + make_interval(secs => LEAST(3600, p_penalty_seconds * power(2, LEAST(v_strikes - 1, 6))::integer));
    UPDATE bridge_v2_rate_limits
       SET strikes = v_strikes, penalty_until = v_penalty, updated_at = v_now
     WHERE axis = p_axis AND key_hash = p_key_hash AND window_start = v_window;
    RETURN QUERY SELECT false, GREATEST(1, ceil(extract(epoch from (v_penalty - v_now)))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_rate_limit_hit IS 'B3/G1: increment and verdict in one atomic operation. Never read-compare-write.';

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
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
-- Single use is enforced by the WHERE clause, not by a prior read: two bot
-- updates carrying the same code race on one UPDATE and exactly one wins.
CREATE OR REPLACE FUNCTION bridge_v2_claim_link_for_chat(
  p_code_hash text,
  p_chat_id   bigint
) RETURNS TABLE (link_id uuid, participant_id uuid, giveaway_id numeric)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE bridge_v2_link_codes c
     SET telegram_chat_id = p_chat_id
   WHERE c.code_hash = p_code_hash
     AND c.consumed_at IS NULL
     AND c.expires_at > now()
  RETURNING c.id, c.participant_id, c.giveaway_id;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_claim_link_for_chat IS 'Binds a started link to the chat that opened it. Idempotent for a Telegram retry.';

-- Consumes the live link for a chat when the contact finally arrives. Single use
-- is enforced by the WHERE clause, so two deliveries of the same contact race on
-- one statement and exactly one wins. Telegram retries an unacknowledged
-- delivery, so a duplicate here is expected traffic rather than an attack.
CREATE OR REPLACE FUNCTION bridge_v2_consume_link_for_chat(p_chat_id bigint)
RETURNS TABLE (link_id uuid, participant_id uuid, giveaway_id numeric)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE bridge_v2_link_codes c
     SET consumed_at = now()
   WHERE c.telegram_chat_id = p_chat_id
     AND c.consumed_at IS NULL
     AND c.expires_at > now()
  RETURNING c.id, c.participant_id, c.giveaway_id;
END;
$fn$;



-- -----------------------------------------------------------------------------
-- phone binding — C5 and C6
-- -----------------------------------------------------------------------------
-- Binds a phone hash to a participant, or reports why it cannot.
--
-- Outcomes:
--   BOUND        the hash is now live for this participant
--   ALREADY_MINE the hash is already live for this same participant
--   TAKEN        the hash is live for a different participant (C5 global unique)
--   COOLDOWN     the hash was released recently and is still cooling (C6)
--
-- The unique partial index is the real guard; this function turns the race it
-- would lose into a named outcome instead of an exception the caller must parse.
CREATE OR REPLACE FUNCTION bridge_v2_bind_phone(
  p_phone_hmac       text,
  p_participant_id   uuid,
  p_telegram_id_hmac text
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_owner    uuid;
  v_cooldown timestamptz;
BEGIN
  SELECT participant_id INTO v_owner
    FROM bridge_v2_phones
   WHERE phone_hmac = p_phone_hmac AND released_at IS NULL
   FOR UPDATE;

  IF v_owner IS NOT NULL THEN
    RETURN CASE WHEN v_owner = p_participant_id THEN 'ALREADY_MINE' ELSE 'TAKEN' END;
  END IF;

  SELECT max(cooldown_until) INTO v_cooldown
    FROM bridge_v2_phones
   WHERE phone_hmac = p_phone_hmac AND released_at IS NOT NULL;

  IF v_cooldown IS NOT NULL AND v_cooldown > now() THEN
    RETURN 'COOLDOWN';
  END IF;

  INSERT INTO bridge_v2_phones (phone_hmac, participant_id, telegram_user_id_hmac)
  VALUES (p_phone_hmac, p_participant_id, p_telegram_id_hmac);

  RETURN 'BOUND';
EXCEPTION
  -- The partial unique index is the authority. If a concurrent transaction won
  -- the insert between the check and here, report TAKEN rather than raising.
  WHEN unique_violation THEN
    RETURN 'TAKEN';
END;
$fn$;

-- C6: release a number, opening the cooldown before it can be rebound.
CREATE OR REPLACE FUNCTION bridge_v2_release_phone(
  p_participant_id  uuid,
  p_cooldown_days   integer
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
SET search_path = public
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
  p_session_grace_days integer
) RETURNS TABLE (table_name text, rows_removed integer)
LANGUAGE plpgsql
SET search_path = public
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
SET search_path = public
AS $fn$
  SELECT nextval('bridge_v2_wallet_index_seq');
$fn$;

COMMENT ON FUNCTION bridge_v2_next_wallet_index IS 'I9: reserve the index so the address is known before the row is written.';
