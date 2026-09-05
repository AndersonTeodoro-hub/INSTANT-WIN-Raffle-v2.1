-- =============================================================================
-- 0006_bridge_v2_grants — two roles, least privilege, per table and per verb
--
-- I5: RLS is on with zero policies (0004), so anon and authenticated reach
-- nothing. Access is exclusively through the two roles created here. BYPASSRLS
-- and GRANT are independent mechanisms — the V1 incident 42501 of 31/08/2026 was
-- exactly this confusion — so every privilege the code uses is granted below and
-- nothing else is.
--
-- I7: the routes that only read do not carry the credential that can write.
-- bridge_v2_reader can read participation state and can write exactly three
-- things it cannot function without: its own rate-limit counters (B1 applies to
-- read routes too), its own diagnostic events (K5), and the session freshness
-- clock (A4 slides idle expiry on use). It cannot touch participants, phones,
-- entries, codes, funders or custody. A leaked reader credential reads personal
-- data but cannot create an entry, bind a phone, or move gas.
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
END
$roles$;

-- PostgREST switches into the role named by the JWT role claim. Without this it
-- cannot assume either role and every request fails on role resolution.
GRANT bridge_v2_reader TO authenticator;
GRANT bridge_v2_writer TO authenticator;

GRANT USAGE ON SCHEMA public TO bridge_v2_reader;
GRANT USAGE ON SCHEMA public TO bridge_v2_writer;

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

-- sessions: created on verify (A1), revoked on request and on incident (A5).
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_sessions TO bridge_v2_writer;

-- email codes: issued, attempted, consumed, superseded. Expiry removal is the
-- retention function's job (I10), not a route's.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_email_codes TO bridge_v2_writer;

-- link codes: issued by entry/start, consumed once by the bot webhook.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_link_codes TO bridge_v2_writer;

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

GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_rate_limits    TO bridge_v2_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_external_spend TO bridge_v2_writer;

-- C2 blocklist is read at request time and edited by an operator, never written
-- by a route, so both roles get SELECT and neither gets more.
GRANT SELECT ON TABLE public.bridge_v2_disposable_domains TO bridge_v2_writer;
GRANT SELECT ON TABLE public.bridge_v2_disposable_domains TO bridge_v2_reader;

GRANT INSERT ON TABLE public.bridge_v2_ops_events TO bridge_v2_writer;
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
GRANT EXECUTE ON FUNCTION public.bridge_v2_bind_phone(text, uuid, text)                          TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_phone(uuid, integer)                          TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_acquire_funder(integer)                               TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_renew_funder_lease(integer, uuid, integer)            TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_funder(integer, uuid, bigint)                 TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_disable_funder(integer)                               TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_spend(text, integer, integer, integer)          TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_cleanup(integer, integer)                             TO bridge_v2_writer;
GRANT EXECUTE ON FUNCTION public.bridge_v2_next_wallet_index()                                   TO bridge_v2_writer;

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
