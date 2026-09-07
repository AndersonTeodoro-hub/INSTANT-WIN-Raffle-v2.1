-- =============================================================================
-- 0007_bridge_v2_routes — the three server-side gaps behind the owner's
-- four-path decision of 07/09/2026 (SPEC-BRIDGE-V2.md, addenda).
--
-- 1. A verified participant may declare their own address as the eligibility
--    target instead of the derived wallet. self_custody on bridge_v2_entries
--    records which; the platform never signs enter() or claimPrize() for that
--    address (E1: the derived wallet is a signing vehicle, and a self-custody
--    entry has none for the bridge to hold).
-- 2. A creator without a wallet may create a campaign and deposit its prize
--    through the bridge. bridge_v2_creators mirrors bridge_v2_participants — a
--    second derived-wallet role, drawn from the SAME sequence and the SAME
--    BRIDGE_V2_WALLET_SEED root (F1 already closes the root list; this is
--    another address under it, not a new root) — and bridge_v2_creator_campaigns
--    is its own small state machine, funded and submitted synchronously by the
--    routes in api/bridge/v2/creator/*, never by the scheduled pipeline, so a
--    creator wallet's nonce is never touched by two call sites at once.
--    DESVIO (0.4): gated on the creator already holding a verified phone
--    (a live bridge_v2_phones row). A creator with no prior verification has
--    no campaign yet to attach a Telegram deep link to, and building a
--    campaign-less verification funnel (a purpose-typed link_codes row, a new
--    bind function, a telegram/webhook.ts branch) is out of scope for this
--    pass. Recorded here rather than assumed silent.
-- 3. An entry in FAILED can be resumed once its cause no longer holds. No
--    schema is needed for it — resumeFailedEntry (entries.ts) reuses the
--    existing status column and the existing advance() transition.
--
-- Idempotent: every statement is IF NOT EXISTS or equivalent, matching 0004.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. self-custody entries
-- -----------------------------------------------------------------------------
-- self_custody: true once the participant has declared their own address in
-- place of the derived wallet (entries.ts declareOwnAddress). The pipeline
-- (processor.ts) reads this to skip funding and submission for these rows —
-- the participant signs enter() and claimPrize() themselves, off this
-- platform, with their own gas.
ALTER TABLE bridge_v2_entries ADD COLUMN IF NOT EXISTS self_custody boolean NOT NULL DEFAULT false;

-- The requirement of the 07/09/2026 decision, enforced by the database rather
-- than by application logic alone: an address already used by another
-- participant in the same campaign cannot be accepted. Safe to add over
-- existing rows — a derived wallet's address is already globally unique
-- (bridge_v2_wallet_index_seq) and bridge_v2_entries_participant_giveaway_key
-- already forbids two entries for the same (participant, giveaway), so no
-- existing row can collide.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_entries_giveaway_address_unique
  ON bridge_v2_entries (giveaway_id, wallet_address);

COMMENT ON COLUMN bridge_v2_entries.self_custody IS
  'True once the participant declared their own address (07/09/2026 decision). The bridge never signs for this wallet.';

-- -----------------------------------------------------------------------------
-- 2. creators — a second derived-wallet identity, for campaigns not entries
-- -----------------------------------------------------------------------------
-- One row per participant who has created a campaign through the bridge. Its
-- own wallet_index, drawn from the SAME sequence bridge_v2_participants draws
-- from (bridge_v2_next_wallet_index in 0005), so a creator's address can never
-- collide with any participant's — the sequence is the single source of
-- uniqueness for every address this seed ever derives, entrant or creator.
--
-- Kept separate from bridge_v2_participants, rather than reusing a
-- participant's own entrant wallet, so that a creator-campaign submission (a
-- synchronous route, never under the pipeline's run lock) can never race the
-- scheduled pipeline signing an entry for the same address at the same moment
-- (G6). Two roles, two addresses, two nonce spaces.
CREATE TABLE IF NOT EXISTS bridge_v2_creators (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid        NOT NULL UNIQUE REFERENCES bridge_v2_participants (id),
  wallet_index   bigint      NOT NULL UNIQUE,
  wallet_address text        NOT NULL CHECK (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bridge_v2_creators IS
  'Creator-without-wallet identity (07/09/2026 decision). Own derived wallet, same seed and sequence as participants, never the same address.';

-- -----------------------------------------------------------------------------
-- 3. creator campaigns — draft, fund, create; one non-terminal row at a time
-- -----------------------------------------------------------------------------
-- PENDING_DEPOSIT  draft recorded, deposit address handed to the creator
-- FUNDING          the derived wallet holds enough; the submit route is
--                  mid-sequence (approve, approve, createGiveaway)
-- CONFIRMED        createGiveaway is mined; giveaway_id is the on-chain id
-- FAILED           terminal failure; the reason is an ops event (K5), as with
--                  bridge_v2_entries
CREATE TABLE IF NOT EXISTS bridge_v2_creator_campaigns (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       uuid          NOT NULL REFERENCES bridge_v2_creators (id),
  status           text          NOT NULL CHECK (status IN (
                                    'PENDING_DEPOSIT',
                                    'FUNDING',
                                    'CONFIRMED',
                                    'FAILED'
                                  )),
  module           text          NOT NULL CHECK (module ~ '^0x[0-9a-fA-F]{40}$'),
  prize_token      text          NOT NULL CHECK (prize_token ~ '^0x[0-9a-fA-F]{40}$'),
  prize_amount     numeric(78,0) NOT NULL CHECK (prize_amount > 0),
  duration_seconds bigint        NOT NULL,
  winners_count    integer       NOT NULL,
  slot_cap         integer       NOT NULL,
  -- Computed and stored at draft time (currentFee, pricePerSlot), so the
  -- deposit instructions handed to the creator and the amounts the submit
  -- route later spends are the same numbers, not two reads of a price that
  -- can move between them.
  fee_amount       numeric(78,0) NOT NULL,
  slots_cost       numeric(78,0) NOT NULL,
  giveaway_id      numeric(78,0),
  tx_hash          text,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- One draft or in-flight campaign per creator at a time. Simpler than an
-- idempotency key over the parameters, and sufficient: a creator who wants a
-- second campaign starts it once the first has left this set.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_creator_campaigns_active_unique
  ON bridge_v2_creator_campaigns (creator_id)
  WHERE status IN ('PENDING_DEPOSIT', 'FUNDING');

CREATE INDEX IF NOT EXISTS bridge_v2_creator_campaigns_creator_idx
  ON bridge_v2_creator_campaigns (creator_id, created_at DESC);

COMMENT ON TABLE bridge_v2_creator_campaigns IS
  'Creator-without-wallet campaign creation (07/09/2026 decision). TOKEN prizes only in this pass; see the route file for why.';

-- -----------------------------------------------------------------------------
-- RLS — I5, same shape as every other bridge_v2_* table: enabled, zero policies
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_creators          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_creator_campaigns ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- grants — service_role only, exactly the verbs the new code uses (I5, I7)
-- -----------------------------------------------------------------------------
-- creators — SELECT and INSERT from creators.ts (get-or-create). No UPDATE, no
-- DELETE: the row is written once and never changes.
GRANT SELECT, INSERT ON TABLE public.bridge_v2_creators TO service_role;

-- creator campaigns — the whole lifecycle, from creatorCampaigns.ts. No
-- DELETE: a campaign draft is a record of what was asked for, like an entry.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_creator_campaigns TO service_role;

REVOKE ALL ON TABLE public.bridge_v2_creators          FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_creator_campaigns FROM anon, authenticated;
