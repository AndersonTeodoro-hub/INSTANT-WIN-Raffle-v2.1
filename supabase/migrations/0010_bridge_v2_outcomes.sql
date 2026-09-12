-- =============================================================================
-- 0010_bridge_v2_outcomes — what a settled campaign did to each entry, and
-- whether its participant has been told.
--
-- TWO BUGS, ONE MISSING FACT. Nobody was ever told they had won (the only
-- outbound email was the verification code, and R3 forbids the bot from
-- mentioning a prize), and "Your prize" was shown to everybody who entered,
-- because entry/status gated that panel on a bridge_v2_custody row, which
-- custody.recordPolicy writes when the entry is OPENED.
--
-- A column and not a status: status is the funnel an entry walks and it is
-- complete at CONFIRMED. Not derived on read: claimable() answers zero for a
-- wallet that never won AND for a winner already paid
-- (GiveawayManagerV2.sol:1458-1464), so the answer has to be captured while the
-- chain still has it.
--
-- Idempotent, like 0004 and 0007. No table grant is needed — 0006 already grants
-- SELECT, INSERT and UPDATE on bridge_v2_entries to service_role.
-- =============================================================================
SET search_path = public, extensions;

-- NULL means "not decided yet". Written once — processor.ts claims the write on
-- the column still being NULL.
--
-- VOID IS THE THIRD ANSWER, for a campaign that will never produce a reportable
-- result: a cancelled one (closing under MIN_PARTICIPANTS cancels itself,
-- GiveawayManagerV2.sol:757), or one whose 90-day claim window closed before
-- anybody was told, where claimable() reads zero for a winner who never claimed
-- as well as for a loser. Both still need a terminal value, or their entries
-- hold slots in the small per-run batch for ever.
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS outcome text;

DO $$
BEGIN
  ALTER TABLE bridge_v2_entries
    ADD CONSTRAINT bridge_v2_entries_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('WON', 'LOST', 'VOID'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

-- Separate from outcome because the two fail independently: the result is a
-- database write against a fact already read from the chain, the email is a
-- third-party call that can fail on its own for hours.
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS outcome_notified_at timestamptz;

COMMENT ON COLUMN bridge_v2_entries.outcome IS
  'WON, LOST, or VOID when there is no reportable result. Written once by the pipeline from the contract. NULL until the campaign reaches a terminal state. The gate for the prize panel (api/bridge/v2/entry/status.ts).';
COMMENT ON COLUMN bridge_v2_entries.outcome_notified_at IS
  'Set the first and only time the participant was emailed about the result. Claimed conditionally, so a repeated run does not send a second email.';

-- -----------------------------------------------------------------------------
-- the backlog
-- -----------------------------------------------------------------------------
-- WITHOUT THIS, EVERY CONFIRMED ENTRY ON THE PLATFORM ENTERS THE QUEUE ON THE
-- FIRST RUN — a mass send about campaigns that ended months ago, telling people
-- to name a wallet for a prize delivered or written off long since. NOTHING THAT
-- PREDATES THIS FILE IS EVER EMAILED: the second statement claims the notice for
-- every entry that was already CONFIRMED when it ran.
--
-- Two statements, because only the first can say what happened. A CLAIMED
-- CUSTODY IS A WINNER: the prize is in the derived wallet already, and anything
-- but WON closes the destination route (api/bridge/v2/prize/destination.ts),
-- which is the only way it can still be sent anywhere. delivered_at is
-- unambiguous; no_prize_at is written for a loser and for an expired claim
-- alike, so it gets VOID rather than a guess.
--
-- The second leaves outcome NULL deliberately: what the database cannot decide
-- it does not guess. VOID there would be that same irreversible refusal, over
-- winners of campaigns that have not even drawn yet.
--
-- Idempotent: a second application finds the same rows already notified.
UPDATE bridge_v2_entries e
   SET outcome = COALESCE(
         e.outcome,
         CASE WHEN c.delivered_at IS NOT NULL OR c.claimed_at IS NOT NULL THEN 'WON' ELSE 'VOID' END
       ),
       outcome_notified_at = now()
  FROM bridge_v2_custody c
 WHERE c.entry_id = e.id
   AND e.status = 'CONFIRMED'
   AND e.outcome_notified_at IS NULL
   AND (c.delivered_at IS NOT NULL OR c.claimed_at IS NOT NULL OR c.no_prize_at IS NOT NULL);

UPDATE bridge_v2_entries e
   SET outcome_notified_at = now()
 WHERE e.status = 'CONFIRMED'
   AND e.outcome_notified_at IS NULL;

-- -----------------------------------------------------------------------------
-- the queue
-- -----------------------------------------------------------------------------
-- ONE PREDICATE, AND IT IS outcome_notified_at RATHER THAN outcome: nothing sets
-- this column before outcome, so an unrecorded result is always also an unsent
-- notice. Partial and CONFIRMED only — what stays in a queue must be what can
-- still be acted on. The second column is the order key of the function below.
CREATE INDEX IF NOT EXISTS bridge_v2_entries_outcome_pending_idx
  ON bridge_v2_entries (giveaway_id, updated_at)
  WHERE status = 'CONFIRMED' AND outcome_notified_at IS NULL;

-- -----------------------------------------------------------------------------
-- one row per campaign with results waiting, least recently looked at first
-- -----------------------------------------------------------------------------
-- C8/G4. Grouping by campaign is half the fix — a flat LIMIT over entry rows
-- lets one large campaign fill the window on its own (0005 records the bug).
--
-- max(updated_at) AND NOT min(updated_at) IS THE OTHER HALF, and it decides
-- whether this queue moves at all. It necessarily holds campaigns that have NOT
-- settled — from the database, "no result yet" and "settled but unreported" are
-- the same row — CONFIRMED is terminal, and nothing writes those rows on its
-- own. Under min() the oldest open campaigns hold the whole per-run batch for
-- ever and a campaign that settles behind them is never reached.
--
-- Under max(), the pipeline touches one entry of a campaign it cannot act on and
-- that campaign goes to the back; a settled one is never touched, so it keeps
-- its old timestamp and stays at the front until every entry is told.
CREATE OR REPLACE FUNCTION bridge_v2_campaigns_awaiting_outcome(p_limit integer)
RETURNS TABLE (giveaway_id text)
LANGUAGE sql
SET search_path = public, extensions
AS $fn$
  SELECT e.giveaway_id::text
    FROM bridge_v2_entries e
   WHERE e.status = 'CONFIRMED'
     AND e.outcome_notified_at IS NULL
   GROUP BY e.giveaway_id
   ORDER BY max(e.updated_at) ASC
   LIMIT GREATEST(p_limit, 0);
$fn$;

COMMENT ON FUNCTION bridge_v2_campaigns_awaiting_outcome IS
  'C8/G4: one row per campaign whose result has not reached every entrant, least recently looked at first, so no campaign starves another.';

-- 0006's sweep ran over the functions that existed then, and Postgres grants
-- EXECUTE on a new function to PUBLIC by default. A function created after 0006
-- is outside that wall and has to rebuild it.
REVOKE ALL ON FUNCTION public.bridge_v2_campaigns_awaiting_outcome(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_v2_campaigns_awaiting_outcome(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_v2_campaigns_awaiting_outcome(integer) TO service_role;
