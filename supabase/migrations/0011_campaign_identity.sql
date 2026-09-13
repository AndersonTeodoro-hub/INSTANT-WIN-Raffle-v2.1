-- =============================================================================
-- 0011_campaign_identity — the name, message, images and brand a creator
-- publishes for a campaign, kept off chain and keyed by the on-chain giveaway id.
-- SPEC-BRIDGE-V2 §17 (L1–L10).
--
-- WHY OFF CHAIN. GiveawayManagerV2 stores the prize, the winners, the slots and
-- the window. A participant saw "#2", "5 USDC" and an address, on the page, in
-- the email and in the link preview. The contract is out of scope and campaign
-- #2 already exists, so the identity lives here and attaches to the id.
--
-- WHO WRITES IT (L2). Nobody reaches these tables but service_role, and the only
-- write path is bridge_v2_save_campaign_identity, called by
-- api/bridge/v2/campaign/identity/save.ts after it has checked a wallet
-- signature against the creator the contract records. The database does not
-- know about wallets; what it enforces is that a signature is spent once and
-- that an older signature never overwrites a newer one (L6).
--
-- WHO READS IT (L7). service_role again, from api/bridge/v2/campaign/identity/
-- read.ts and api/og/event.ts. There is no anon or authenticated path, and no
-- policy: the public reads the route, never the table.
--
-- Idempotent, like 0004, 0007 and 0010: every statement is IF NOT EXISTS, OR
-- REPLACE, ON CONFLICT, or a GRANT/REVOKE that is a no-op the second time.
--
-- RE-APPLYING 0006 AFTER THIS FILE. 0006 opens with a sweep that revokes every
-- privilege on every bridge_v2_* table from service_role and grants back its own
-- list, which does not name the two tables below. Re-apply this file after it.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- the identity, one row per campaign
-- -----------------------------------------------------------------------------
-- The bounds repeat lib/campaign-identity.ts. The route refuses first with a
-- reason the page can show; these are the floor that holds if a caller ever
-- skips the route.
--
-- Images are recorded by what they are, not by where they are: the object path
-- is derived from the id, the slot, the hash and the type
-- (imageObjectPath), so a row can never point at an object the hash does not
-- describe.
CREATE TABLE IF NOT EXISTS bridge_v2_campaign_identities (
  giveaway_id     numeric(78,0) PRIMARY KEY CHECK (giveaway_id > 0),
  name            text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  message         text          NOT NULL CHECK (char_length(message) BETWEEN 1 AND 280),
  brand_name      text          NOT NULL CHECK (char_length(brand_name) BETWEEN 1 AND 60),
  link_url        text          CHECK (link_url IS NULL OR (char_length(link_url) <= 200 AND link_url LIKE 'https://%')),
  banner_sha256   text          NOT NULL CHECK (banner_sha256 ~ '^[0-9a-f]{64}$'),
  banner_type     text          NOT NULL CHECK (banner_type IN ('image/png', 'image/jpeg', 'image/webp')),
  banner_width    integer       NOT NULL CHECK (banner_width BETWEEN 1 AND 4096),
  banner_height   integer       NOT NULL CHECK (banner_height BETWEEN 1 AND 4096),
  logo_sha256     text          CHECK (logo_sha256 IS NULL OR logo_sha256 ~ '^[0-9a-f]{64}$'),
  logo_type       text          CHECK (logo_type IS NULL OR logo_type IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_width      integer       CHECK (logo_width IS NULL OR logo_width BETWEEN 1 AND 2048),
  logo_height     integer       CHECK (logo_height IS NULL OR logo_height BETWEEN 1 AND 2048),
  -- The creator the contract recorded when the signature was checked. The
  -- contract never changes it; this is the audit trail of who signed, not a
  -- second source of truth.
  creator_address text          NOT NULL CHECK (creator_address ~ '^0x[0-9a-f]{40}$'),
  signed_at       timestamptz   NOT NULL,
  version         integer       NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  -- I9: a logo is all four columns or none of them, never half a picture.
  CONSTRAINT bridge_v2_campaign_identities_logo_whole CHECK (
    (logo_sha256 IS NULL) = (logo_type IS NULL)
    AND (logo_type IS NULL) = (logo_width IS NULL)
    AND (logo_width IS NULL) = (logo_height IS NULL)
  )
);

COMMENT ON TABLE bridge_v2_campaign_identities IS
  'Campaign identity (SPEC-BRIDGE-V2 L1). Written only by bridge_v2_save_campaign_identity after a creator signature; read only through the identity and OG routes.';

-- -----------------------------------------------------------------------------
-- the signatures already spent
-- -----------------------------------------------------------------------------
-- L6. A signature is accepted for a few minutes after it is made
-- (IDENTITY_SIGNATURE_MAX_AGE_MS); inside that window this table is what stops
-- the same one being submitted twice. Keyed on the nonce the signature carries
-- rather than on the signature bytes, because an ECDSA signature has a second
-- valid form with the same signer and the same message.
CREATE TABLE IF NOT EXISTS bridge_v2_campaign_identity_nonces (
  giveaway_id numeric(78,0) NOT NULL CHECK (giveaway_id > 0),
  nonce       text          NOT NULL CHECK (nonce ~ '^[0-9a-f]{32}$'),
  used_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (giveaway_id, nonce)
);

-- I10: the retention delete below runs on every save and reads this column.
CREATE INDEX IF NOT EXISTS bridge_v2_campaign_identity_nonces_used_idx
  ON bridge_v2_campaign_identity_nonces (used_at);

COMMENT ON TABLE bridge_v2_campaign_identity_nonces IS
  'Spent identity signature nonces (SPEC-BRIDGE-V2 L6). Kept for the retention the caller passes, far longer than a signature is accepted.';

-- -----------------------------------------------------------------------------
-- the one write path
-- -----------------------------------------------------------------------------
-- Three outcomes, returned rather than raised so the route can answer each one:
--
--   REPLAYED  the nonce was already spent — the same signature again
--   STALE     a signature made at or before the one already applied; the newer
--             identity stays, and this nonce is spent
--   SAVED     inserted, or updated with the version incremented
--
-- THE STALE CHECK IS INSIDE THE UPSERT, not a read before it. Two first saves
-- for the same campaign both find no row; a read-then-write would let the second
-- one apply whichever signature arrived last rather than whichever was made
-- last. ON CONFLICT ... WHERE decides it in the statement that writes.
CREATE OR REPLACE FUNCTION bridge_v2_save_campaign_identity(
  p_giveaway_id             numeric,
  p_nonce                   text,
  p_signed_at               timestamptz,
  p_nonce_retention_seconds integer,
  p_creator_address         text,
  p_name                    text,
  p_message                 text,
  p_brand_name              text,
  p_link_url                text,
  p_banner_sha256           text,
  p_banner_type             text,
  p_banner_width            integer,
  p_banner_height           integer,
  p_logo_sha256             text,
  p_logo_type               text,
  p_logo_width              integer,
  p_logo_height             integer
)
RETURNS TABLE (saved_outcome text, saved_version integer)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $fn$
DECLARE
  v_version integer;
BEGIN
  DELETE FROM bridge_v2_campaign_identity_nonces n
   WHERE n.used_at < now() - make_interval(secs => GREATEST(p_nonce_retention_seconds, 0));

  INSERT INTO bridge_v2_campaign_identity_nonces (giveaway_id, nonce)
  VALUES (p_giveaway_id, p_nonce)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'REPLAYED'::text, NULL::integer;
    RETURN;
  END IF;

  INSERT INTO bridge_v2_campaign_identities AS i (
    giveaway_id, name, message, brand_name, link_url,
    banner_sha256, banner_type, banner_width, banner_height,
    logo_sha256, logo_type, logo_width, logo_height,
    creator_address, signed_at
  )
  VALUES (
    p_giveaway_id, p_name, p_message, p_brand_name, p_link_url,
    p_banner_sha256, p_banner_type, p_banner_width, p_banner_height,
    p_logo_sha256, p_logo_type, p_logo_width, p_logo_height,
    p_creator_address, p_signed_at
  )
  ON CONFLICT (giveaway_id) DO UPDATE
     SET name            = EXCLUDED.name,
         message         = EXCLUDED.message,
         brand_name      = EXCLUDED.brand_name,
         link_url        = EXCLUDED.link_url,
         banner_sha256   = EXCLUDED.banner_sha256,
         banner_type     = EXCLUDED.banner_type,
         banner_width    = EXCLUDED.banner_width,
         banner_height   = EXCLUDED.banner_height,
         logo_sha256     = EXCLUDED.logo_sha256,
         logo_type       = EXCLUDED.logo_type,
         logo_width      = EXCLUDED.logo_width,
         logo_height     = EXCLUDED.logo_height,
         creator_address = EXCLUDED.creator_address,
         signed_at       = EXCLUDED.signed_at,
         version         = i.version + 1,
         updated_at      = now()
   WHERE i.signed_at < EXCLUDED.signed_at
  RETURNING i.version INTO v_version;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT 'STALE'::text, c.version
        FROM bridge_v2_campaign_identities c
       WHERE c.giveaway_id = p_giveaway_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'SAVED'::text, v_version;
END;
$fn$;

COMMENT ON FUNCTION bridge_v2_save_campaign_identity IS
  'L6: spends the nonce and applies the identity only if it was signed after the one already stored. SAVED, STALE or REPLAYED.';

-- -----------------------------------------------------------------------------
-- RLS — I5, the same shape as every other bridge_v2_* table
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_campaign_identities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_campaign_identity_nonces ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- grants — service_role, exactly the verbs the code uses (I5)
-- -----------------------------------------------------------------------------
-- 0006 Achado 6: Supabase's default privileges have already given service_role
-- ALL on both tables by the time this line runs. Revoked first so the per-verb
-- list below is the whole of what it holds.
REVOKE ALL ON TABLE public.bridge_v2_campaign_identities      FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_campaign_identity_nonces FROM service_role;

-- identities — SELECT from campaignIdentity.ts (read route, OG, emails) and from
-- the upsert's conflict check; INSERT and UPDATE from the save function, which is
-- SECURITY INVOKER and therefore runs with these privileges. No DELETE: nothing
-- removes an identity.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_campaign_identities TO service_role;

-- nonces — INSERT the spent nonce, DELETE past retention, SELECT for the
-- retention predicate. No UPDATE: a spent nonce is never unspent.
GRANT SELECT, INSERT, DELETE ON TABLE public.bridge_v2_campaign_identity_nonces TO service_role;

-- Nothing for the two browser roles, on either table.
REVOKE ALL ON TABLE public.bridge_v2_campaign_identities      FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_campaign_identity_nonces FROM anon, authenticated;

-- 0010's note applies: EXECUTE on a new function goes to PUBLIC by default, and
-- 0006's sweep ran before this function existed.
REVOKE ALL ON FUNCTION public.bridge_v2_save_campaign_identity(numeric, text, timestamptz, integer, text, text, text, text, text, text, text, integer, integer, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bridge_v2_save_campaign_identity(numeric, text, timestamptz, integer, text, text, text, text, text, text, text, integer, integer, text, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_v2_save_campaign_identity(numeric, text, timestamptz, integer, text, text, text, text, text, text, text, integer, integer, text, text, integer, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- the image bucket (L5)
-- -----------------------------------------------------------------------------
-- Public, because a link preview is fetched by a crawler with no credentials.
-- The size and type limits repeat the ones the route checks on the bytes; here
-- they hold if anything ever writes to the bucket without the route. No
-- storage.objects policy is created, so anon and authenticated can read a public
-- object by URL and cannot write one.
--
-- Only where the storage schema exists. A Supabase project always has it; the
-- engine the suite applies migrations to does not, and the branch is exercised
-- there against a table shaped like the real one.
DO $bucket$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('campaign-identity', 'campaign-identity', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
    ON CONFLICT (id) DO UPDATE
       SET public             = EXCLUDED.public,
           file_size_limit    = EXCLUDED.file_size_limit,
           allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END
$bucket$;
