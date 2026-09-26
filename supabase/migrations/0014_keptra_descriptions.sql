-- =============================================================================
-- 0014_keptra_descriptions — SPEC-BLOCO-03 piece 6, Adenda T4.
--
-- The product description of each offer (COMPRA) and each obligation (PRÉMIO):
-- a title and a text, no images, written by the store or brand the terms name
-- when it creates them, never changed after (T4), shown before paying or
-- redeeming and handed to the arbiter with the evidence.
--
-- A FILE, NEVER APPLIED TO PRODUCTION BY THE BUILD SESSION (A15). The owner
-- applies it, after 0012 and 0013 (Q6).
--
-- "Never changed" is a privilege, not a promise: the service holds INSERT and
-- SELECT and nothing else, so no statement the bridge can send rewrites or
-- removes a description a buyer already read. Public content (the store
-- publishes it on the offer's link), so nothing here is personal data and
-- nothing is encrypted.
--
-- Idempotent, like 0012 and 0013. Adenda D6: every privilege on this table is
-- the explicit list at the end; none is left from Supabase's default privileges.
-- =============================================================================
SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS bridge_v2_offer_descriptions (
  -- The escrow's terms id: one description per set of terms, ever (T4).
  terms_id      bigint      PRIMARY KEY CHECK (terms_id > 0),
  -- The store or brand the terms name, checked on-chain before the write.
  store_address text        NOT NULL CHECK (store_address ~ '^0x[0-9a-fA-F]{40}$'),
  -- PRÉMIO: the obligation whose terms these are; NULL for an offer.
  obligation_id bigint      CHECK (obligation_id >= 0),
  -- lib/keptra-description.ts: at most 120 characters on one line, and 2 000 in the text.
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120 AND title !~ '[\n\r]'),
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- A store's console lists its own (T5: there is no catalogue).
CREATE INDEX IF NOT EXISTS bridge_v2_offer_descriptions_store
  ON bridge_v2_offer_descriptions (store_address, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS and grants — the same shape as every bridge_v2_* table (I5, D6)
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_offer_descriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bridge_v2_offer_descriptions FROM service_role;
-- Exactly the verbs lib/bridge-v2/descriptions.ts uses: written once, read. Never
-- updated, never deleted (T4).
GRANT SELECT, INSERT ON TABLE public.bridge_v2_offer_descriptions TO service_role;

REVOKE ALL ON TABLE public.bridge_v2_offer_descriptions FROM anon, authenticated;
