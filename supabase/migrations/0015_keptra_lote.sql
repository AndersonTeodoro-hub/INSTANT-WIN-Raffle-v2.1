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
-- A FILE, NEVER APPLIED TO PRODUCTION BY THE BUILD SESSION (A15). The owner
-- applies it after 0012, 0013 and 0014, in that order (Q6, U7).
--
-- Idempotent, like 0012 to 0014. Adenda D6: every privilege this file gives is
-- the explicit list at the end, and each is one lib/bridge-v2 uses.
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
