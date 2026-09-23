-- =============================================================================
-- 0013_keptra_orders — SPEC-BLOCO-03 piece 5 and Adenda P.
--
-- What the bridge keeps about the orders of the escrow (pieces 2 and 3): the
-- delivery addresses (section 10), the shipments registered with the tracking
-- provider (9.1.1, H17, M9), the evidence of a contest (P17), the notices sent
-- (8.3, P4, P22), the recipient marks (13.1, P5), the index of orders the
-- cron passes read, and the vouchers the void scan has finished with.
--
-- A FILE, NEVER APPLIED TO PRODUCTION BY THE BUILD SESSION (A15). The owner
-- applies it, after 0012.
--
-- NEVER stored here in clear (section 10, P20): an address, a tracking number or
-- the text of the evidence. Each is ciphertext under a key derived from
-- BRIDGE_V2_PHONE_HMAC_KEY and a label, held outside the database (P5-8): the
-- address under 'order-address-enc-v1'; the tracking number under that SAME
-- label, 'order-address-enc-v1', because it travels with the address and is
-- erased with it; the evidence under 'order-evidence-enc-v1'. The tracking hash's
-- own label, 'order-tracking-hmac-v1', keys the hash and encrypts nothing.
-- The tracking hash is the keyed hash the escrow holds (H17); the phone is the
-- keyed hash bridge_v2_phones already holds.
--
-- Idempotent, like 0012. Adenda D6: every privilege on these tables is the
-- explicit list at the end; none is left from Supabase's default privileges.
-- =============================================================================
SET search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. addresses — section 10, P15, P18, P19
-- -----------------------------------------------------------------------------
-- Registered for an offer before paying (terms_id) or for a voucher before
-- redeeming (voucher_id), and bound to the order that opens (order_id). 10.3:
-- erased (DELETE) at erase_after, which the orders pass sets when the order
-- reaches its final state; one never bound goes the same number of days after
-- it was written (lib/bridge-v2/orders.ts eraseExpired).
CREATE TABLE IF NOT EXISTS bridge_v2_order_addresses (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid        NOT NULL REFERENCES bridge_v2_participants (id),
  terms_id       bigint      CHECK (terms_id > 0),
  voucher_id     bigint      CHECK (voucher_id > 0),
  order_id       bigint      CHECK (order_id > 0),
  address_enc    text        NOT NULL CHECK (address_enc LIKE 'v1.%'),
  bound_at       timestamptz,
  erase_after    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- An address is for an offer or for a voucher, never both and never neither.
  CHECK ((terms_id IS NULL) <> (voucher_id IS NULL))
);
-- One address per order: two orders never share one, and an order never has two.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_order_addresses_order
  ON bridge_v2_order_addresses (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bridge_v2_order_addresses_unbound
  ON bridge_v2_order_addresses (participant_id, created_at) WHERE order_id IS NULL;

-- -----------------------------------------------------------------------------
-- 2. the index of orders — what the chain said, and how each order ended
-- -----------------------------------------------------------------------------
-- Public facts of the escrow, rewritten by the orders pass each time it reads
-- them (seen_block). outcome is OrderClosed's (13.1 and P5 need it; the Order
-- struct keeps none). closed_at is written last, once the order's erasure date
-- is set and its mark settled (Adenda R1): until then the pass reads the order
-- again, and seen_block is where its search for OrderClosed goes on from.
CREATE TABLE IF NOT EXISTS bridge_v2_orders (
  order_id       bigint      PRIMARY KEY CHECK (order_id > 0),
  terms_id       bigint      NOT NULL,
  voucher_id     bigint      NOT NULL DEFAULT 0,
  store_address  text        NOT NULL CHECK (store_address ~ '^0x[0-9a-fA-F]{40}$'),
  payer_address  text        NOT NULL CHECK (payer_address ~ '^0x[0-9a-fA-F]{40}$'),
  mode           smallint    NOT NULL CHECK (mode IN (0, 1)),
  prize          boolean     NOT NULL,
  ship_days      smallint    NOT NULL,
  delivery_days  smallint    NOT NULL,
  state          smallint    NOT NULL CHECK (state BETWEEN 1 AND 5),
  flags          smallint    NOT NULL,
  paid_at        bigint      NOT NULL,
  shipped_at     bigint      NOT NULL,
  window_ends_at bigint      NOT NULL,
  contested_at   bigint      NOT NULL,
  seen_block     bigint      NOT NULL,
  outcome        smallint    CHECK (outcome BETWEEN 0 AND 4),
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bridge_v2_orders_open ON bridge_v2_orders (order_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS bridge_v2_orders_payer ON bridge_v2_orders (payer_address);
CREATE INDEX IF NOT EXISTS bridge_v2_orders_store ON bridge_v2_orders (store_address);

-- -----------------------------------------------------------------------------
-- 3. shipments — 9.1.1, H17, I6, M9
-- -----------------------------------------------------------------------------
-- I6: one tracking hash, one order, ever — the unique constraint is the
-- authority. tracker_id is the provider's identifier (M6), null until the
-- provider took the shipment (9.5.5: the maintenance pass asks again).
CREATE TABLE IF NOT EXISTS bridge_v2_order_shipments (
  order_id      bigint      PRIMARY KEY CHECK (order_id > 0),
  tracking_hash text        NOT NULL UNIQUE CHECK (tracking_hash ~ '^0x[0-9a-f]{64}$'),
  -- P5-8: ciphertext under 'order-address-enc-v1', the address's label (orders.ts registerShipment).
  tracking_enc  text        NOT NULL CHECK (tracking_enc LIKE 'v1.%'),
  tracker_id    text        CHECK (tracker_id ~ '^[A-Za-z0-9-]{8,64}$'),
  erase_after   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bridge_v2_order_shipments_untracked
  ON bridge_v2_order_shipments (created_at) WHERE tracker_id IS NULL;

-- -----------------------------------------------------------------------------
-- 4. evidence — P17
-- -----------------------------------------------------------------------------
-- One text per party, written once: the primary key refuses a second, so the
-- hash the arbiter passes to decide() never moves.
CREATE TABLE IF NOT EXISTS bridge_v2_order_evidence (
  order_id    bigint      NOT NULL CHECK (order_id > 0),
  party       text        NOT NULL CHECK (party IN ('RECIPIENT', 'STORE')),
  text_enc    text        NOT NULL CHECK (text_enc LIKE 'v1.%'),
  erase_after timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, party)
);

-- -----------------------------------------------------------------------------
-- 5. notices — 8.3, P3, P4, P22
-- -----------------------------------------------------------------------------
-- Each at most once per order, written after the email was accepted.
CREATE TABLE IF NOT EXISTS bridge_v2_order_notices (
  order_id bigint      NOT NULL CHECK (order_id > 0),
  kind     text        NOT NULL CHECK (kind IN ('WINDOW_OPENED', 'WINDOW_CLOSING', 'STORE_ORDER', 'ARBITER_CONTEST')),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, kind)
);

-- -----------------------------------------------------------------------------
-- 6. recipient marks — 13.1, P5
-- -----------------------------------------------------------------------------
-- One decision per order. P5: a number counts once per store — the partial
-- unique index over the live marks (RESERVED, MARKED) is that rule, so of two
-- orders from one number to one store only one is marked, and a released mark
-- (its delivery did not count) frees the pair. SKIPPED: the order can never
-- count (the store's own person, or no Keptra account).
CREATE TABLE IF NOT EXISTS bridge_v2_recipient_marks (
  order_id      bigint      PRIMARY KEY CHECK (order_id > 0),
  store_address text        NOT NULL CHECK (store_address ~ '^0x[0-9a-fA-F]{40}$'),
  phone_hmac    text,
  status        text        NOT NULL CHECK (status IN ('RESERVED', 'MARKED', 'RELEASED', 'SKIPPED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'SKIPPED' OR phone_hmac IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS bridge_v2_recipient_marks_once
  ON bridge_v2_recipient_marks (store_address, phone_hmac) WHERE status IN ('RESERVED', 'MARKED');

-- -----------------------------------------------------------------------------
-- 7. vouchers the void scan has finished with — P11
-- -----------------------------------------------------------------------------
-- Voided, or burned with their unit: never releasable again, never read again.
CREATE TABLE IF NOT EXISTS bridge_v2_finished_vouchers (
  voucher_id bigint      PRIMARY KEY CHECK (voucher_id > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- RLS and grants — the same shape as every bridge_v2_* table (I5, D6)
-- -----------------------------------------------------------------------------
ALTER TABLE bridge_v2_order_addresses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_order_shipments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_order_evidence    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_order_notices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_recipient_marks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_v2_finished_vouchers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bridge_v2_order_addresses   FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_orders            FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_order_shipments   FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_order_evidence    FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_order_notices     FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_recipient_marks   FROM service_role;
REVOKE ALL ON TABLE public.bridge_v2_finished_vouchers FROM service_role;

-- Exactly the verbs lib/bridge-v2/orders.ts uses.
-- addresses: registered, bound and given their erasure date, erased (10.3, P18).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_order_addresses   TO service_role;
-- orders: upserted by the pass (INSERT and UPDATE), read by the routes. A record: never deleted.
GRANT SELECT, INSERT, UPDATE         ON TABLE public.bridge_v2_orders            TO service_role;
-- shipments: registered, given their tracker and erasure date, erased.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_order_shipments   TO service_role;
-- evidence: written once per party, given its erasure date, erased.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_v2_order_evidence    TO service_role;
-- notices: recorded once each, never changed.
GRANT SELECT, INSERT                 ON TABLE public.bridge_v2_order_notices     TO service_role;
-- marks: reserved or skipped, then marked or released.
GRANT SELECT, INSERT, UPDATE         ON TABLE public.bridge_v2_recipient_marks   TO service_role;
-- finished vouchers: recorded once each.
GRANT SELECT, INSERT                 ON TABLE public.bridge_v2_finished_vouchers TO service_role;

REVOKE ALL ON TABLE public.bridge_v2_order_addresses   FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_orders            FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_order_shipments   FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_order_evidence    FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_order_notices     FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_recipient_marks   FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_v2_finished_vouchers FROM anon, authenticated;
