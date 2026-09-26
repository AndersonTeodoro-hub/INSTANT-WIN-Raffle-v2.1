-- =============================================================================
-- 0015_keptra_lote — SPEC-BLOCO-03 Adenda AA4, the lot of the bridge and the
-- frontend before the deploy.
--
-- P1-3: a creator draft records what its deposit address already held of the
-- prize token and of USDC when it was made. Only what arrives above it is that
-- draft's deposit; a draft with none expires (Adenda F2).
--
-- P1-11, as the owner answered on 23/09/2026: the erasure on request removes a
-- participant's passkeys and the history of its changes of access, with their
-- notices. 0012 gave the service no DELETE on those three tables; this gives it,
-- and nothing more.
--
-- Piece 5: an address claimed by the one payment it serves (P5-2), a shipment
-- whose retries stopped (P5-3), the new orders read aside (P5-12), and the notice
-- of a declared window the carrier's refusal closed (Y5).
--
-- A FILE, NEVER APPLIED TO PRODUCTION BY THE BUILD SESSION (A15). The owner
-- applies it after 0012, 0013 and 0014, in that order (Q6, U7).
--
-- Idempotent, like 0012 to 0014. Adenda D6: every privilege this file gives is
-- written out where its table is, and each is one lib/bridge-v2 uses.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- P1-3 — the deposit address's balances when the draft was made
-- -----------------------------------------------------------------------------
-- NULL on a draft made before this file (read as zero: it recorded nothing).
ALTER TABLE bridge_v2_creator_campaigns ADD COLUMN IF NOT EXISTS deposit_baseline_prize numeric(78,0);
ALTER TABLE bridge_v2_creator_campaigns ADD COLUMN IF NOT EXISTS deposit_baseline_usdc numeric(78,0);
ALTER TABLE bridge_v2_creator_campaigns DROP CONSTRAINT IF EXISTS bridge_v2_creator_campaigns_baseline_check;
ALTER TABLE bridge_v2_creator_campaigns ADD CONSTRAINT bridge_v2_creator_campaigns_baseline_check
  CHECK (deposit_baseline_prize >= 0 AND deposit_baseline_usdc >= 0);
COMMENT ON COLUMN bridge_v2_creator_campaigns.deposit_baseline_prize IS
  'P1-3: the prize token the deposit address held when the draft was made; only what arrives above it is the draft''s deposit.';
COMMENT ON COLUMN bridge_v2_creator_campaigns.deposit_baseline_usdc IS
  'P1-3: the USDC the deposit address held when the draft was made; only what arrives above it is the draft''s deposit.';

-- -----------------------------------------------------------------------------
-- P1-11 — the erasure's three deletes (lib/bridge-v2/accounts.ts, eraseAccountData)
-- -----------------------------------------------------------------------------
GRANT DELETE ON TABLE public.bridge_v2_recovery_notices TO service_role;
GRANT DELETE ON TABLE public.bridge_v2_recoveries TO service_role;
GRANT DELETE ON TABLE public.bridge_v2_passkeys TO service_role;

-- -----------------------------------------------------------------------------
-- P5-2 — an address is claimed by the one relayed payment or redemption it serves
-- -----------------------------------------------------------------------------
-- claimed_at: taken by a submission (lib/bridge-v2/orders.ts claimAddress);
-- claim_tx: the relayer transaction it was sent in, from which the orders pass
-- binds it when the relay never saw the receipt. One transaction opens one order,
-- so it serves one address.
ALTER TABLE bridge_v2_order_addresses ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE bridge_v2_order_addresses ADD COLUMN IF NOT EXISTS claim_tx text;
ALTER TABLE bridge_v2_order_addresses DROP CONSTRAINT IF EXISTS bridge_v2_order_addresses_claim_tx_check;
ALTER TABLE bridge_v2_order_addresses ADD CONSTRAINT bridge_v2_order_addresses_claim_tx_check
  CHECK (claim_tx IS NULL OR (claim_tx ~ '^0x[0-9a-f]{64}$' AND claimed_at IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_order_addresses_claim_tx
  ON bridge_v2_order_addresses (claim_tx) WHERE claim_tx IS NOT NULL;

-- -----------------------------------------------------------------------------
-- P5-3 — a shipment leaves the retries: refused for what it is, or its order closed
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_order_shipments ADD COLUMN IF NOT EXISTS retry_stopped_at timestamptz;
ALTER TABLE bridge_v2_order_shipments ADD COLUMN IF NOT EXISTS retry_stop_reason text;
ALTER TABLE bridge_v2_order_shipments DROP CONSTRAINT IF EXISTS bridge_v2_order_shipments_retry_stop_check;
ALTER TABLE bridge_v2_order_shipments ADD CONSTRAINT bridge_v2_order_shipments_retry_stop_check
  CHECK ((retry_stopped_at IS NULL) = (retry_stop_reason IS NULL) AND (retry_stop_reason IS NULL OR retry_stop_reason IN ('REFUSED', 'CLOSED')));
DROP INDEX IF EXISTS bridge_v2_order_shipments_untracked;
CREATE INDEX IF NOT EXISTS bridge_v2_order_shipments_untracked
  ON bridge_v2_order_shipments (created_at) WHERE tracker_id IS NULL AND retry_stopped_at IS NULL;

-- -----------------------------------------------------------------------------
-- P5-12 — a new order that cannot be read is kept aside, and read again every pass
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_v2_order_unread (
  order_id        bigint      PRIMARY KEY CHECK (order_id > 0),
  attempts        integer     NOT NULL CHECK (attempts > 0),
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bridge_v2_order_unread ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bridge_v2_order_unread FROM service_role;
-- Exactly the verbs lib/bridge-v2/orders.ts uses: recorded again on every failure (upsert), read, cleared once read.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_order_unread TO service_role;
REVOKE ALL ON TABLE public.bridge_v2_order_unread FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Y5 — a declared window closed by the carrier's refusal is told to the recipient
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_order_notices DROP CONSTRAINT IF EXISTS bridge_v2_order_notices_kind_check;
ALTER TABLE bridge_v2_order_notices ADD CONSTRAINT bridge_v2_order_notices_kind_check
  CHECK (kind IN ('WINDOW_OPENED', 'WINDOW_CLOSING', 'STORE_ORDER', 'ARBITER_CONTEST', 'WINDOW_REFUSED'));

-- -----------------------------------------------------------------------------
-- P6-14 — the terms a store created through the relay, so an offer or an obligation
-- whose description failed is still listed after a reload (and never created again)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_v2_store_terms (
  -- The escrow's terms id, read from the receipt of createOffer or createObligation.
  terms_id      bigint      PRIMARY KEY CHECK (terms_id > 0),
  store_address text        NOT NULL CHECK (store_address ~ '^0x[0-9a-fA-F]{40}$'),
  -- PRÉMIO: the obligation; NULL for an offer.
  obligation_id bigint      CHECK (obligation_id >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bridge_v2_store_terms_store
  ON bridge_v2_store_terms (store_address, created_at DESC);
ALTER TABLE bridge_v2_store_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bridge_v2_store_terms FROM service_role;
-- Exactly the verbs lib/bridge-v2/descriptions.ts uses: recorded once, read.
GRANT SELECT, INSERT ON TABLE public.bridge_v2_store_terms TO service_role;
REVOKE ALL ON TABLE public.bridge_v2_store_terms FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- AB6 — a real deposit for a draft counts, whatever the balance did after the draft
-- was made: the block its deposit is read from (transfers into the address from it
-- on), moved on as the expiry reads the log and finds none. NULL on a draft made
-- before it: the balance alone says.
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_creator_campaigns ADD COLUMN IF NOT EXISTS deposit_from_block bigint;
ALTER TABLE bridge_v2_creator_campaigns DROP CONSTRAINT IF EXISTS bridge_v2_creator_campaigns_deposit_from_block_check;
ALTER TABLE bridge_v2_creator_campaigns ADD CONSTRAINT bridge_v2_creator_campaigns_deposit_from_block_check
  CHECK (deposit_from_block >= 0);

-- -----------------------------------------------------------------------------
-- AB5 — a notice the email provider refused for what it is is recorded, as refused,
-- and never sent again: no unit of email spent on it every pass, and the close of a
-- refused window (Y5) not held by it. NULL: sent.
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_order_notices ADD COLUMN IF NOT EXISTS refused_at timestamptz;

-- -----------------------------------------------------------------------------
-- AB4 — the console's list is the chain's: the orders pass reads every terms and
-- every obligation the contracts hold into bridge_v2_store_terms, so one the relay
-- created is listed even when its receipt never reached the relay or the relay's
-- own write failed. This is how far that read has gone: the next id of each.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_v2_store_terms_cursor (
  name    text   PRIMARY KEY CHECK (name IN ('terms', 'obligations')),
  next_id bigint NOT NULL CHECK (next_id >= 1)
);
ALTER TABLE bridge_v2_store_terms_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bridge_v2_store_terms_cursor FROM service_role;
-- Exactly the verbs lib/bridge-v2/descriptions.ts uses: read, and moved on (upsert).
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_v2_store_terms_cursor TO service_role;
REVOKE ALL ON TABLE public.bridge_v2_store_terms_cursor FROM anon, authenticated;
