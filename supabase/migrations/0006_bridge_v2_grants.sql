-- =============================================================================
-- 0006_bridge_v2_grants — privileges for service_role
--
-- The bridge reaches the database with the sb_secret_ key, the same variable the
-- V1 reads (lib/bridge/supabase.ts:55). That key resolves to service_role.
--
-- WHY THE PER-ROUTE ROLES ARE GONE. The previous revision of this file created
-- bridge_v2_reader, bridge_v2_writer and bridge_v2_seeder, and the code minted
-- an HS256 JWT per request naming one of them. That depended on the project's
-- legacy HS256 signing key, which is now in "previously used keys" and on its
-- way to revocation; the current signing key is ECC P-256 with a non-exportable
-- private half, so those tokens cannot be reissued. A privilege model that stops
-- working at the next key rotation is not a privilege model.
--
-- WHAT THIS COSTS. I7 asked that a read-only route not carry the credential that
-- can write. With one key it does. The separation is now only which functions a
-- route calls, which is weaker than a credential that cannot perform the write.
-- Recorded here rather than left for a reader to discover.
--
-- I5 STILL HOLDS AND STILL MATTERS. RLS stays enabled on every bridge_v2_* table
-- (0004:343-356) with zero policies, so anon and authenticated read and write
-- nothing even if a publishable key reaches a browser. service_role passes
-- because it carries BYPASSRLS.
--
-- BUT BYPASSRLS IS NOT A GRANT. They are independent mechanisms and both must
-- allow an operation. That confusion is the V1 incident 42501 of 31/08/2026,
-- where every route returned 500 because the tables had been created without a
-- single GRANT to the role the bridge used. This file is the other half, and it
-- is why 0006 is not deleted: without it the bridge fails exactly as V1 did.
--
-- The V1 grants in 0003 are untouched. This file adds; it removes nothing V1
-- depends on.
--
-- Idempotent: the cleanup is guarded, and GRANT on an already-granted privilege
-- is a silent no-op in Postgres.
--
-- The search_path is set for the same reason as in 0004 and 0005: the two grants
-- below name a citext parameter, and the type has to resolve to whichever schema
-- actually holds the extension.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- Remove what the previous revision created
-- -----------------------------------------------------------------------------
-- Every policy on a bridge_v2_* table, whoever it was for. The requirement is
-- RLS on with no policies, so this is written as a sweep rather than a list:
-- a named list would silently miss a policy added between revisions.
DO $drop_policies$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename LIKE 'bridge\_v2\_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END
$drop_policies$;

-- The three roles, with their privileges withdrawn first. DROP ROLE refuses while
-- a role still holds a grant anywhere, so the revokes are not optional tidiness.
DO $drop_roles$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['bridge_v2_reader', 'bridge_v2_writer', 'bridge_v2_seeder']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE %I FROM authenticator', role_name);
      EXECUTE format('DROP ROLE IF EXISTS %I', role_name);
    END IF;
  END LOOP;
END
$drop_roles$;

-- -----------------------------------------------------------------------------
-- service_role — exactly the verbs the code uses, per table
-- -----------------------------------------------------------------------------
-- Modelled on the V1 0003, which named the call site for every privilege. Each
-- comment below is the reason the verb is granted; a verb with no call site is
-- not granted, so widening this file requires a reader to say what needs it.

GRANT USAGE ON SCHEMA public TO service_role;

-- participants — SELECT participants.ts, INSERT participants.ts (get-or-create),
-- UPDATE privacy/erase.ts (pseudonymisation). No DELETE: erasure is a rewrite,
-- and removing a participant would orphan an address already in an on-chain root.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_participants TO service_role;

-- sessions — SELECT and UPDATE on resolve (A4 slide), INSERT on verify,
-- UPDATE on revoke (A5).
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_sessions TO service_role;

-- email codes — INSERT from codes.ts; SELECT and UPDATE from the attempt,
-- consume and supersede functions, which are SECURITY INVOKER and therefore run
-- with the caller's privileges, not the owner's.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_email_codes TO service_role;

-- link codes — INSERT from linkcodes.ts; SELECT and UPDATE from the claim and
-- consume functions.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_link_codes TO service_role;

-- phones — reached only through bind and release, which SELECT, INSERT and UPDATE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_phones TO service_role;

-- entries — the whole lifecycle. No DELETE: an entry is the participation record.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_entries TO service_role;

-- eligibility — append-only, mirroring the contract (4.1). UPDATE on roots exists
-- only to record the transaction hash once the publication is mined.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_eligibility_roots  TO service_role;
GRANT SELECT, INSERT ON TABLE public.bridge_v2_eligibility_leaves TO service_role;

-- rate limits — moved entirely by bridge_v2_rate_limit_hit.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_rate_limits TO service_role;

-- funders — SELECT and UPDATE from the lease functions; INSERT from the operator
-- seed script, which now shares this credential. No route contains an INSERT
-- against this table, and that is the only thing keeping the pool out of the
-- request path.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_funders TO service_role;

-- external spend — moved entirely by bridge_v2_claim_spend.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_external_spend TO service_role;

-- disposable domains — SELECT at request time (C2); INSERT from the seed script.
GRANT SELECT, INSERT ON TABLE public.bridge_v2_disposable_domains TO service_role;

-- custody — E2 outcome per entry, E4 destination once confirmed.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_custody TO service_role;

-- ops events — append only. The bridge cannot rewrite the record of what it did.
GRANT INSERT ON TABLE public.bridge_v2_ops_events TO service_role;

-- -----------------------------------------------------------------------------
-- sequences
-- -----------------------------------------------------------------------------
-- USAGE, never UPDATE. Postgres grants nextval under both, but UPDATE also
-- grants setval, and rewinding the wallet sequence would reassign an index that
-- is already somebody's wallet.
GRANT USAGE ON SEQUENCE public.bridge_v2_wallet_index_seq TO service_role;
GRANT USAGE ON SEQUENCE public.bridge_v2_ops_events_id_seq TO service_role;

-- -----------------------------------------------------------------------------
-- functions — all fifteen of 0005
-- -----------------------------------------------------------------------------
-- EXECUTE grants nothing extra on its own: every function is SECURITY INVOKER,
-- so the table privileges above still apply and cannot be borrowed through a call.
GRANT EXECUTE ON FUNCTION public.bridge_v2_rate_limit_hit(text, text, integer, integer, integer)      TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_email_code_attempt(citext, integer)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_consume_email_code(uuid)                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_supersede_email_codes(citext)                              TO service_role;
-- Both take a keyed hash of the chat id now, not the id (R4), so the signatures
-- changed and 0005 dropped the old ones.
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_link_for_chat(text, text)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_consume_link_for_chat(text)                                TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_bind_phone_and_verify(text, uuid, numeric, text, integer)  TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_phone(uuid, integer)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_acquire_funder(integer)                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_renew_funder_lease(integer, uuid, integer)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_funder(integer, uuid, bigint)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_disable_funder(integer)                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_spend(text, integer, integer, integer)               TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_cleanup(integer, integer)                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_next_wallet_index()                                        TO service_role;

-- -----------------------------------------------------------------------------
-- Nothing for anon, nothing for authenticated
-- -----------------------------------------------------------------------------
-- These tables hold personal data and the mapping from email to on-chain
-- address. RLS with no policies already blocks both roles; leaving a default
-- table privilege in place as well would mean the barrier rests on one mechanism
-- instead of two. If client-side access is ever wanted, the decision is to write
-- an explicit policy, never to add a GRANT.
REVOKE ALL ON TABLE public.bridge_v2_participants        FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_sessions            FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_email_codes         FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_link_codes          FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_phones              FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_entries             FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_eligibility_roots   FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_eligibility_leaves  FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_rate_limits         FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_funders             FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_external_spend      FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_disposable_domains  FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_custody             FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_ops_events          FROM anon, authenticated;
