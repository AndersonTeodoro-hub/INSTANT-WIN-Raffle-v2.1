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
-- Idempotent: GRANT on an already-granted privilege is a silent no-op in
-- Postgres, and the REVOKE sweep below is written over whatever exists at the
-- moment it runs.
--
-- The search_path is set for the same reason as in 0004 and 0005: the two grants
-- below name a citext parameter, and the type has to resolve to whichever schema
-- actually holds the extension.
-- =============================================================================
SET search_path = public, extensions;

-- I5, ON WHAT IS NOT HERE. This file used to open with a sweep that dropped every
-- policy on a bridge_v2_* table, and a block that revoked and then dropped
-- bridge_v2_reader, bridge_v2_writer and bridge_v2_seeder. Both are gone: those
-- policies and those roles exist in no database. They were created by an earlier
-- revision of this same file, which was rewritten before it had ever been
-- applied, so the cleanup was cleaning up after a state that never existed.
--
-- Migration code that cannot do anything is worse than no code. It reads as
-- evidence that some deployment is carrying those roles, so a reader auditing
-- privileges goes looking for them; and a DROP ROLE is exactly the statement
-- nobody wants to find in a file they are about to apply to production. The
-- requirement it claimed to serve — RLS enabled with zero policies — is held by
-- 0004, which enables RLS on every table and writes no policy at all.

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
-- UPDATE on revoke (A5), DELETE from bridge_v2_cleanup past the grace period.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_sessions TO service_role;

-- email codes — INSERT from codes.ts; SELECT and UPDATE from the attempt,
-- consume and supersede functions, which are SECURITY INVOKER and therefore run
-- with the caller's privileges, not the owner's. DELETE from bridge_v2_cleanup.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_email_codes TO service_role;

-- link codes — INSERT from linkcodes.ts; SELECT and UPDATE from the claim and
-- consume functions; DELETE from bridge_v2_cleanup.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_link_codes TO service_role;

-- phones — reached only through bind and release, which SELECT, INSERT and UPDATE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_phones TO service_role;

-- entries — the whole lifecycle. No DELETE: an entry is the participation record.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_entries TO service_role;

-- eligibility — append-only, mirroring the contract (4.1). No UPDATE on either
-- table: the comment here used to justify one "to record the transaction hash
-- once the publication is mined", and no code has ever done that. The row is
-- written after the receipt, hash included, in a single INSERT (eligibility.ts),
-- because a root row that exists before its transaction is confirmed is a row
-- claiming an index the chain may not have. A privilege with no call site is a
-- privilege granted on a story.
GRANT SELECT, INSERT ON TABLE public.bridge_v2_eligibility_roots  TO service_role;
GRANT SELECT, INSERT ON TABLE public.bridge_v2_eligibility_leaves TO service_role;

-- rate limits — moved entirely by bridge_v2_rate_limit_hit; DELETE from
-- bridge_v2_cleanup, which drops windows older than two days.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_rate_limits TO service_role;

-- rate penalties — B4. SELECT ... FOR UPDATE and the upsert in
-- bridge_v2_rate_limit_hit; DELETE from bridge_v2_cleanup once a strike count
-- has decayed. FOR UPDATE needs SELECT and UPDATE together, which the write path
-- already has.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_rate_penalties TO service_role;

-- locks — taken and released by bridge_v2_try_lock and bridge_v2_release_lock,
-- swept by bridge_v2_cleanup. No route reads this table directly.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_locks TO service_role;

-- funders — SELECT and UPDATE from the lease functions; INSERT from the operator
-- seed script, which now shares this credential. No route contains an INSERT
-- against this table, and that is the only thing keeping the pool out of the
-- request path.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_funders TO service_role;

-- external spend — moved by bridge_v2_claim_spend; SELECT also from
-- cron/maintenance.ts, which reads the day window to alert before a ceiling is
-- reached; DELETE from bridge_v2_cleanup past thirty days.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_external_spend TO service_role;

-- disposable domains — SELECT at request time (C2); INSERT from the seed script.
GRANT SELECT, INSERT ON TABLE public.bridge_v2_disposable_domains TO service_role;

-- custody — E2 outcome per entry, E4 destination once confirmed.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_custody TO service_role;

-- ops events — INSERT from log.ts, SELECT from cron/maintenance.ts (the per-route
-- error rate of H8/K8, which was being read with no privilege to read it), and
-- DELETE from bridge_v2_cleanup, which is the K7 retention. No UPDATE: the bridge
-- appends to the record of what it did and never rewrites a line of it.
GRANT SELECT, INSERT, DELETE ON TABLE public.bridge_v2_ops_events TO service_role;

-- -----------------------------------------------------------------------------
-- sequences
-- -----------------------------------------------------------------------------
-- USAGE, never UPDATE. Postgres grants nextval under both, but UPDATE also
-- grants setval, and rewinding the wallet sequence would reassign an index that
-- is already somebody's wallet.
GRANT USAGE ON SEQUENCE public.bridge_v2_wallet_index_seq TO service_role;
GRANT USAGE ON SEQUENCE public.bridge_v2_ops_events_id_seq TO service_role;

-- -----------------------------------------------------------------------------
-- functions — all nineteen of 0005
-- -----------------------------------------------------------------------------
-- REVOKE FIRST, AND THIS IS THE POINT OF THE BLOCK. Postgres grants EXECUTE on a
-- new function to PUBLIC by default, and PUBLIC includes anon and authenticated —
-- the two roles a publishable key in a browser resolves to. Every function in
-- 0005 was therefore callable from the open internet: rate_limit_hit could be
-- called to burn somebody else's budget, acquire_funder to hold the pool,
-- cleanup to delete the retention tables. They failed on the missing table
-- privilege, because SECURITY INVOKER is what saved this, but a defence that
-- rests on one mechanism is not the defence I5 asks for, and a function whose
-- body needs no table at all would have had nothing standing in front of it.
--
-- The revoke is a sweep rather than a list for the same reason the policy drop
-- above is: a named list silently misses whatever is added next.
DO $revoke_public_execute$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'bridge\_v2\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.signature);
  END LOOP;
END
$revoke_public_execute$;

-- EXECUTE grants nothing extra on its own: every function is SECURITY INVOKER,
-- so the table privileges above still apply and cannot be borrowed through a call.
GRANT EXECUTE ON FUNCTION public.bridge_v2_rate_limit_hit(text, text, integer, integer, integer, integer) TO service_role;
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
-- G6: the lease holder's correction of next_nonce against the account. Separate
-- from release because it is the one write that may lower the number, which is
-- what unsticks a funder whose transaction was dropped from the mempool.
GRANT EXECUTE ON FUNCTION public.bridge_v2_reconcile_funder_nonce(integer, uuid, bigint)              TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_disable_funder(integer)                                    TO service_role;
-- C8/G4: one row per campaign with VERIFIED entries, longest-waiting first, so a
-- full campaign cannot hold the publication batch against every other one.
GRANT EXECUTE ON FUNCTION public.bridge_v2_campaigns_with_verified(integer)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_claim_spend(text, integer, integer, integer)               TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_cleanup(integer, integer, integer)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_next_wallet_index()                                        TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_try_lock(text, integer)                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_v2_release_lock(text, uuid)                                   TO service_role;

-- No ALTER DEFAULT PRIVILEGES here on purpose. It would apply to every function
-- created in this schema by the role running the migration, which includes the
-- V1 and anything else the project owns, and this branch does not touch the V1.
-- The sweep above runs on every apply and covers every bridge_v2_ function that
-- exists at that moment, which is the same guarantee inside our own scope.

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
REVOKE ALL ON TABLE public.bridge_v2_rate_penalties      FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_locks               FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_funders             FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_external_spend      FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_disposable_domains  FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_custody             FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_ops_events          FROM anon, authenticated;
