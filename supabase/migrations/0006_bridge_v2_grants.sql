-- =============================================================================
-- 0006_bridge_v2_grants — three roles, least privilege, per table and per verb
--
-- I5: RLS is on for every table (0004). RLS and GRANT are independent
-- mechanisms and BOTH must allow an operation — the V1 incident 42501 of
-- 31/08/2026 was exactly that confusion — so this file carries two halves that
-- have to agree: a GRANT per table and per verb, and a POLICY per role, per
-- table and per verb. A table with RLS on and no policy for a role denies that
-- role every row, whatever it was granted.
--
-- BYPASSRLS is never used, on any role. A role that bypasses RLS makes the
-- policies below decoration, and the whole point of writing them per verb is
-- that a leaked credential is stopped by something other than its own grants.
--
-- I7: the routes that only read do not carry the credential that can write.
-- bridge_v2_reader can read participation state and can write exactly three
-- things it cannot function without: its own rate-limit counters (B1 applies to
-- read routes too), its own diagnostic events (K5), and the session freshness
-- clock (A4 slides idle expiry on use). It cannot touch participants, phones,
-- entries, codes, funders or custody. A leaked reader credential reads personal
-- data but cannot create an entry, bind a phone, or move gas.
--
-- Of those, only the session slide, the disposable-domain lookup and the
-- privacy/export reads are on the reader today: entry/status and
-- prize/destination read through entries.ts and custody.ts, which hold the
-- writer. The privileges below describe the split the routes are meant to have,
-- and the gap between that and the credential they actually carry is a code
-- change in those two modules, not a grant change here.
--
-- I6: both roles are scoped exclusively to bridge_v2_* objects. A leaked
-- credential reaches nothing outside the bridge, including the V1 tables in the
-- same schema, which are deliberately not granted here.
--
-- The V1 role grants in 0003 are untouched. This migration adds; it revokes
-- nothing that V1 depends on.
--
-- Idempotent: role creation is guarded, and GRANT on an already-granted
-- privilege is a silent no-op in Postgres.
-- =============================================================================

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_v2_reader') THEN
    CREATE ROLE bridge_v2_reader NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_v2_writer') THEN
    CREATE ROLE bridge_v2_writer NOLOGIN NOINHERIT;
  END IF;
  -- The operator seed role. It exists so that INSERT on the funder pool and on
  -- the disposable-domain blocklist is held by nobody that serves a request:
  -- scripts/bridge-v2-seed.mjs assumes this role from a terminal, and no route
  -- can mint a token for it because no route module knows the name.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bridge_v2_seeder') THEN
    CREATE ROLE bridge_v2_seeder NOLOGIN NOINHERIT;
  END IF;
END
$roles$;

-- PostgREST switches into the role named by the JWT role claim. Without this it
-- cannot assume either role and every request fails on role resolution.
GRANT bridge_v2_reader TO authenticator;
GRANT bridge_v2_writer TO authenticator;
GRANT bridge_v2_seeder TO authenticator;

GRANT USAGE ON SCHEMA public TO bridge_v2_reader;
GRANT USAGE ON SCHEMA public TO bridge_v2_writer;
GRANT USAGE ON SCHEMA public TO bridge_v2_seeder;

-- -----------------------------------------------------------------------------
-- bridge_v2_reader
-- -----------------------------------------------------------------------------
-- SELECT: entry/status and prize/destination read their own participant's state
-- after the session proves the email (A1, D1).
GRANT SELECT ON TABLE public.bridge_v2_participants       TO bridge_v2_reader;
GRANT SELECT ON TABLE public.bridge_v2_entries            TO bridge_v2_reader;
GRANT SELECT ON TABLE public.bridge_v2_custody            TO bridge_v2_reader;
GRANT SELECT ON TABLE public.bridge_v2_eligibility_roots  TO bridge_v2_reader;
GRANT SELECT ON TABLE public.bridge_v2_eligibility_leaves TO bridge_v2_reader;

-- Sessions: SELECT to validate, UPDATE to slide idle expiry on use (A4).
-- Deliberately no INSERT and no DELETE — creating and revoking a session are
-- write-route operations.
GRANT SELECT, UPDATE ON TABLE public.bridge_v2_sessions TO bridge_v2_reader;

-- B1: every route is rate limited, including the read routes, so the reader must
-- be able to move its own counters. The function is SECURITY INVOKER, so the
-- table privilege is checked against this role and cannot be borrowed.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_rate_limits TO bridge_v2_reader;
GRANT EXECUTE ON FUNCTION public.bridge_v2_rate_limit_hit(text, text, integer, integer, integer) TO bridge_v2_reader;

-- K5: diagnostics under a correlation id. Append only; the reader cannot alter
-- or remove a record of what it did.
GRANT INSERT ON TABLE public.bridge_v2_ops_events TO bridge_v2_reader;
GRANT USAGE ON SEQUENCE public.bridge_v2_ops_events_id_seq TO bridge_v2_reader;

-- -----------------------------------------------------------------------------
-- bridge_v2_writer
-- -----------------------------------------------------------------------------
-- participants: SELECT and INSERT to get-or-create on first verified email;
-- UPDATE for updated_at. No removal verb — erasure on request (D7) is a
-- deliberate operator action, not something a route can do.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_participants TO bridge_v2_writer;
GRANT USAGE ON SEQUENCE public.bridge_v2_wallet_index_seq TO bridge_v2_writer;

-- sessions: created on verify (A1), revoked on request and on incident (A5),
-- and removed after the grace period by the retention function.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_sessions TO bridge_v2_writer;

-- email codes: issued, attempted, consumed, superseded, and finally removed by
-- the retention function (I10). DELETE is granted because bridge_v2_cleanup is
-- SECURITY INVOKER and runs as this role: without it the retention pass fails
-- with 42501 and the table grows exactly as the V1's did (finding K6).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_email_codes TO bridge_v2_writer;

-- link codes: issued by entry/start, consumed once by the bot webhook, expired
-- by the retention function.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_link_codes TO bridge_v2_writer;

-- phones: bound by the bot webhook (C5), released on number change (C6).
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_phones TO bridge_v2_writer;

-- entries: the whole lifecycle, AWAITING_CONTACT through CONFIRMED or FAILED.
-- No removal verb: entries are the participation record, and one that vanished
-- would leave an address in an on-chain root unexplained.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_entries TO bridge_v2_writer;

-- eligibility: append-only on this side too, mirroring the contract (4.1).
-- UPDATE exists only to record the transaction hash once the root is mined.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_eligibility_roots  TO bridge_v2_writer;
GRANT SELECT, INSERT ON TABLE public.bridge_v2_eligibility_leaves TO bridge_v2_writer;

-- custody: E2 outcome per entry, E4 destination once confirmed.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_custody TO bridge_v2_writer;

-- funders: lease, renew, release, disable. No INSERT from a route — the pool is
-- seeded by an operator from the configured keys, never by request traffic.
GRANT SELECT, UPDATE ON TABLE public.bridge_v2_funders TO bridge_v2_writer;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_rate_limits    TO bridge_v2_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_external_spend TO bridge_v2_writer;

-- C2 blocklist is read at request time and edited by an operator, never written
-- by a route, so both roles get SELECT and neither gets more.
GRANT SELECT ON TABLE public.bridge_v2_disposable_domains TO bridge_v2_writer;
GRANT SELECT ON TABLE public.bridge_v2_disposable_domains TO bridge_v2_reader;

-- ops events: appended by every route, read by the H8 error-rate check in
-- cron/maintenance, and expired by the retention function (K7).
GRANT SELECT, INSERT, DELETE ON TABLE public.bridge_v2_ops_events TO bridge_v2_writer;
GRANT USAGE ON SEQUENCE public.bridge_v2_ops_events_id_seq TO bridge_v2_writer;

-- -----------------------------------------------------------------------------
-- functions — every atomic operation of 0005
-- -----------------------------------------------------------------------------
-- EXECUTE alone grants nothing extra: the functions are SECURITY INVOKER, so the
-- table privileges above still apply and cannot be borrowed through a call.
GRANT EXECUTE ON FUNCTION public.bridge_v2_rate_limit_hit(text, text, integer, integer, integer) TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_email_code_attempt(citext, integer)             TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_consume_email_code(uuid)                              TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_supersede_email_codes(citext)                         TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_link_for_chat(text, bigint)                     TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_consume_link_for_chat(bigint)                         TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_bind_phone_and_verify(text, uuid, numeric, text, integer) TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_phone(uuid, integer)                          TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_acquire_funder(integer)                               TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_renew_funder_lease(integer, uuid, integer)            TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_funder(integer, uuid, bigint)                 TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_disable_funder(integer)                               TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_spend(text, integer, integer, integer)          TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_cleanup(integer, integer)                             TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_next_wallet_index()                                   TO bridge_v2_writer;

-- -----------------------------------------------------------------------------
-- bridge_v2_seeder — the operator seed role (findings 8.3 and 8.12)
-- -----------------------------------------------------------------------------
-- INSERT on the funder pool and on the disposable-domain blocklist lives here
-- and nowhere else. Neither list may be written by request traffic: a route
-- that could add a funder could add one whose key it chose, and a route that
-- could edit the blocklist could unblock a disposable provider.
--
-- SELECT is granted alongside so the seed can be run twice and insert only what
-- is missing. UPDATE is deliberately absent: a funder whose configured key no
-- longer matches its stored address is a key rotation, which also needs the
-- nonce reset, and that is an operator decision rather than something a seed
-- script should do on its own.
GRANT SELECT, INSERT ON TABLE public.bridge_v2_funders            TO bridge_v2_seeder;
GRANT SELECT, INSERT ON TABLE public.bridge_v2_disposable_domains TO bridge_v2_seeder;

-- Nothing else. The seeder cannot read a participant, a session, a phone or an
-- entry, so the credential an operator runs from a terminal reaches no personal
-- data at all.
REVOKE ALL ON TABLE public.bridge_v2_participants FROM bridge_v2_seeder;
REVOKE ALL ON TABLE public.bridge_v2_sessions     FROM bridge_v2_seeder;
REVOKE ALL ON TABLE public.bridge_v2_phones       FROM bridge_v2_seeder;
REVOKE ALL ON TABLE public.bridge_v2_entries      FROM bridge_v2_seeder;

-- -----------------------------------------------------------------------------
-- Nothing for anon, nothing for authenticated
-- -----------------------------------------------------------------------------
-- Same reasoning as the V1 0003: these tables hold personal data and the mapping
-- from email to on-chain address. Leaving either role with a default privilege
-- here would remove the RLS barrier silently. If client-side access is ever
-- needed, the decision is to write an explicit policy, never to add a GRANT.
REVOKE ALL ON TABLE public.bridge_v2_participants       FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_sessions           FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_email_codes        FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_link_codes         FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_phones             FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_entries            FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_eligibility_roots  FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_eligibility_leaves FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_rate_limits        FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_funders            FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_external_spend     FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_disposable_domains FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_custody            FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_ops_events         FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS policies — I5, one per role, per table, per verb
-- -----------------------------------------------------------------------------
-- RLS is enabled on every bridge table in 0004. Enabling it without policies
-- denies every row to every role that is not the owner, so the grants above
-- would have been necessary and not sufficient: the routes would read and write
-- nothing, and no error would say why.
--
-- Each policy below mirrors exactly one GRANT above. The predicate is true
-- because the row-level question is already answered elsewhere: A6 means no
-- route takes an identity from the client, and D1 means every query is scoped
-- to the participant the session cookie proved. What these policies carry is
-- the second half of I7 — the reader role has no policy that lets it write to a
-- participant, an entry, a phone or a funder, so a leaked reader credential is
-- refused by RLS as well as by its grants.
--
-- anon and authenticated appear in no policy at all. Nothing they present can
-- read a row of any table here, which is the barrier the REVOKEs at the end of
-- this file reinforce rather than replace.
--
-- Idempotent: CREATE POLICY has no IF NOT EXISTS, so each is dropped first.

-- -----------------------------------------------------------------------------
-- bridge_v2_reader
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS bridge_v2_custody_reader_select ON public.bridge_v2_custody;
CREATE POLICY bridge_v2_custody_reader_select ON public.bridge_v2_custody FOR SELECT TO bridge_v2_reader USING (true);

DROP POLICY IF EXISTS bridge_v2_disposable_domains_reader_select ON public.bridge_v2_disposable_domains;
CREATE POLICY bridge_v2_disposable_domains_reader_select ON public.bridge_v2_disposable_domains FOR SELECT TO bridge_v2_reader USING (true);

DROP POLICY IF EXISTS bridge_v2_eligibility_leaves_reader_select ON public.bridge_v2_eligibility_leaves;
CREATE POLICY bridge_v2_eligibility_leaves_reader_select ON public.bridge_v2_eligibility_leaves FOR SELECT TO bridge_v2_reader USING (true);

DROP POLICY IF EXISTS bridge_v2_eligibility_roots_reader_select ON public.bridge_v2_eligibility_roots;
CREATE POLICY bridge_v2_eligibility_roots_reader_select ON public.bridge_v2_eligibility_roots FOR SELECT TO bridge_v2_reader USING (true);

DROP POLICY IF EXISTS bridge_v2_entries_reader_select ON public.bridge_v2_entries;
CREATE POLICY bridge_v2_entries_reader_select ON public.bridge_v2_entries FOR SELECT TO bridge_v2_reader USING (true);

DROP POLICY IF EXISTS bridge_v2_ops_events_reader_insert ON public.bridge_v2_ops_events;
CREATE POLICY bridge_v2_ops_events_reader_insert ON public.bridge_v2_ops_events FOR INSERT TO bridge_v2_reader WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_participants_reader_select ON public.bridge_v2_participants;
CREATE POLICY bridge_v2_participants_reader_select ON public.bridge_v2_participants FOR SELECT TO bridge_v2_reader USING (true);

DROP POLICY IF EXISTS bridge_v2_rate_limits_reader_select ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_reader_select ON public.bridge_v2_rate_limits FOR SELECT TO bridge_v2_reader USING (true);
DROP POLICY IF EXISTS bridge_v2_rate_limits_reader_insert ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_reader_insert ON public.bridge_v2_rate_limits FOR INSERT TO bridge_v2_reader WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_rate_limits_reader_update ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_reader_update ON public.bridge_v2_rate_limits FOR UPDATE TO bridge_v2_reader USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_sessions_reader_select ON public.bridge_v2_sessions;
CREATE POLICY bridge_v2_sessions_reader_select ON public.bridge_v2_sessions FOR SELECT TO bridge_v2_reader USING (true);
DROP POLICY IF EXISTS bridge_v2_sessions_reader_update ON public.bridge_v2_sessions;
CREATE POLICY bridge_v2_sessions_reader_update ON public.bridge_v2_sessions FOR UPDATE TO bridge_v2_reader USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- bridge_v2_writer
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS bridge_v2_custody_writer_select ON public.bridge_v2_custody;
CREATE POLICY bridge_v2_custody_writer_select ON public.bridge_v2_custody FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_custody_writer_insert ON public.bridge_v2_custody;
CREATE POLICY bridge_v2_custody_writer_insert ON public.bridge_v2_custody FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_custody_writer_update ON public.bridge_v2_custody;
CREATE POLICY bridge_v2_custody_writer_update ON public.bridge_v2_custody FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_disposable_domains_writer_select ON public.bridge_v2_disposable_domains;
CREATE POLICY bridge_v2_disposable_domains_writer_select ON public.bridge_v2_disposable_domains FOR SELECT TO bridge_v2_writer USING (true);

DROP POLICY IF EXISTS bridge_v2_eligibility_leaves_writer_select ON public.bridge_v2_eligibility_leaves;
CREATE POLICY bridge_v2_eligibility_leaves_writer_select ON public.bridge_v2_eligibility_leaves FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_eligibility_leaves_writer_insert ON public.bridge_v2_eligibility_leaves;
CREATE POLICY bridge_v2_eligibility_leaves_writer_insert ON public.bridge_v2_eligibility_leaves FOR INSERT TO bridge_v2_writer WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_eligibility_roots_writer_select ON public.bridge_v2_eligibility_roots;
CREATE POLICY bridge_v2_eligibility_roots_writer_select ON public.bridge_v2_eligibility_roots FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_eligibility_roots_writer_insert ON public.bridge_v2_eligibility_roots;
CREATE POLICY bridge_v2_eligibility_roots_writer_insert ON public.bridge_v2_eligibility_roots FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_eligibility_roots_writer_update ON public.bridge_v2_eligibility_roots;
CREATE POLICY bridge_v2_eligibility_roots_writer_update ON public.bridge_v2_eligibility_roots FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_email_codes_writer_select ON public.bridge_v2_email_codes;
CREATE POLICY bridge_v2_email_codes_writer_select ON public.bridge_v2_email_codes FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_email_codes_writer_insert ON public.bridge_v2_email_codes;
CREATE POLICY bridge_v2_email_codes_writer_insert ON public.bridge_v2_email_codes FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_email_codes_writer_update ON public.bridge_v2_email_codes;
CREATE POLICY bridge_v2_email_codes_writer_update ON public.bridge_v2_email_codes FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_email_codes_writer_delete ON public.bridge_v2_email_codes;
CREATE POLICY bridge_v2_email_codes_writer_delete ON public.bridge_v2_email_codes FOR DELETE TO bridge_v2_writer USING (true);

DROP POLICY IF EXISTS bridge_v2_entries_writer_select ON public.bridge_v2_entries;
CREATE POLICY bridge_v2_entries_writer_select ON public.bridge_v2_entries FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_entries_writer_insert ON public.bridge_v2_entries;
CREATE POLICY bridge_v2_entries_writer_insert ON public.bridge_v2_entries FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_entries_writer_update ON public.bridge_v2_entries;
CREATE POLICY bridge_v2_entries_writer_update ON public.bridge_v2_entries FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_external_spend_writer_select ON public.bridge_v2_external_spend;
CREATE POLICY bridge_v2_external_spend_writer_select ON public.bridge_v2_external_spend FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_external_spend_writer_insert ON public.bridge_v2_external_spend;
CREATE POLICY bridge_v2_external_spend_writer_insert ON public.bridge_v2_external_spend FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_external_spend_writer_update ON public.bridge_v2_external_spend;
CREATE POLICY bridge_v2_external_spend_writer_update ON public.bridge_v2_external_spend FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_external_spend_writer_delete ON public.bridge_v2_external_spend;
CREATE POLICY bridge_v2_external_spend_writer_delete ON public.bridge_v2_external_spend FOR DELETE TO bridge_v2_writer USING (true);

DROP POLICY IF EXISTS bridge_v2_funders_writer_select ON public.bridge_v2_funders;
CREATE POLICY bridge_v2_funders_writer_select ON public.bridge_v2_funders FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_funders_writer_update ON public.bridge_v2_funders;
CREATE POLICY bridge_v2_funders_writer_update ON public.bridge_v2_funders FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_link_codes_writer_select ON public.bridge_v2_link_codes;
CREATE POLICY bridge_v2_link_codes_writer_select ON public.bridge_v2_link_codes FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_link_codes_writer_insert ON public.bridge_v2_link_codes;
CREATE POLICY bridge_v2_link_codes_writer_insert ON public.bridge_v2_link_codes FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_link_codes_writer_update ON public.bridge_v2_link_codes;
CREATE POLICY bridge_v2_link_codes_writer_update ON public.bridge_v2_link_codes FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_link_codes_writer_delete ON public.bridge_v2_link_codes;
CREATE POLICY bridge_v2_link_codes_writer_delete ON public.bridge_v2_link_codes FOR DELETE TO bridge_v2_writer USING (true);

DROP POLICY IF EXISTS bridge_v2_ops_events_writer_select ON public.bridge_v2_ops_events;
CREATE POLICY bridge_v2_ops_events_writer_select ON public.bridge_v2_ops_events FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_ops_events_writer_insert ON public.bridge_v2_ops_events;
CREATE POLICY bridge_v2_ops_events_writer_insert ON public.bridge_v2_ops_events FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_ops_events_writer_delete ON public.bridge_v2_ops_events;
CREATE POLICY bridge_v2_ops_events_writer_delete ON public.bridge_v2_ops_events FOR DELETE TO bridge_v2_writer USING (true);

DROP POLICY IF EXISTS bridge_v2_participants_writer_select ON public.bridge_v2_participants;
CREATE POLICY bridge_v2_participants_writer_select ON public.bridge_v2_participants FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_participants_writer_insert ON public.bridge_v2_participants;
CREATE POLICY bridge_v2_participants_writer_insert ON public.bridge_v2_participants FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_participants_writer_update ON public.bridge_v2_participants;
CREATE POLICY bridge_v2_participants_writer_update ON public.bridge_v2_participants FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_phones_writer_select ON public.bridge_v2_phones;
CREATE POLICY bridge_v2_phones_writer_select ON public.bridge_v2_phones FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_phones_writer_insert ON public.bridge_v2_phones;
CREATE POLICY bridge_v2_phones_writer_insert ON public.bridge_v2_phones FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_phones_writer_update ON public.bridge_v2_phones;
CREATE POLICY bridge_v2_phones_writer_update ON public.bridge_v2_phones FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_rate_limits_writer_select ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_writer_select ON public.bridge_v2_rate_limits FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_rate_limits_writer_insert ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_writer_insert ON public.bridge_v2_rate_limits FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_rate_limits_writer_update ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_writer_update ON public.bridge_v2_rate_limits FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_rate_limits_writer_delete ON public.bridge_v2_rate_limits;
CREATE POLICY bridge_v2_rate_limits_writer_delete ON public.bridge_v2_rate_limits FOR DELETE TO bridge_v2_writer USING (true);

DROP POLICY IF EXISTS bridge_v2_sessions_writer_select ON public.bridge_v2_sessions;
CREATE POLICY bridge_v2_sessions_writer_select ON public.bridge_v2_sessions FOR SELECT TO bridge_v2_writer USING (true);
DROP POLICY IF EXISTS bridge_v2_sessions_writer_insert ON public.bridge_v2_sessions;
CREATE POLICY bridge_v2_sessions_writer_insert ON public.bridge_v2_sessions FOR INSERT TO bridge_v2_writer WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_sessions_writer_update ON public.bridge_v2_sessions;
CREATE POLICY bridge_v2_sessions_writer_update ON public.bridge_v2_sessions FOR UPDATE TO bridge_v2_writer USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS bridge_v2_sessions_writer_delete ON public.bridge_v2_sessions;
CREATE POLICY bridge_v2_sessions_writer_delete ON public.bridge_v2_sessions FOR DELETE TO bridge_v2_writer USING (true);

-- -----------------------------------------------------------------------------
-- bridge_v2_seeder
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS bridge_v2_disposable_domains_seeder_select ON public.bridge_v2_disposable_domains;
CREATE POLICY bridge_v2_disposable_domains_seeder_select ON public.bridge_v2_disposable_domains FOR SELECT TO bridge_v2_seeder USING (true);
DROP POLICY IF EXISTS bridge_v2_disposable_domains_seeder_insert ON public.bridge_v2_disposable_domains;
CREATE POLICY bridge_v2_disposable_domains_seeder_insert ON public.bridge_v2_disposable_domains FOR INSERT TO bridge_v2_seeder WITH CHECK (true);

DROP POLICY IF EXISTS bridge_v2_funders_seeder_select ON public.bridge_v2_funders;
CREATE POLICY bridge_v2_funders_seeder_select ON public.bridge_v2_funders FOR SELECT TO bridge_v2_seeder USING (true);
DROP POLICY IF EXISTS bridge_v2_funders_seeder_insert ON public.bridge_v2_funders;
CREATE POLICY bridge_v2_funders_seeder_insert ON public.bridge_v2_funders FOR INSERT TO bridge_v2_seeder WITH CHECK (true);

