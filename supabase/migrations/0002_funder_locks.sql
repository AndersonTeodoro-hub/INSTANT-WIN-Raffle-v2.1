-- =============================================================================
-- 0002_funder_locks — pool de funders com leases
--
-- Uma linha por índice de funder. Quem quiser financiar adquire a linha com um
-- UPDATE condicional atómico e liberta-a no fim.
--
-- PORQUE NÃO pg_try_advisory_lock:
-- Os advisory locks de sessão são "held until explicitly released or the session
-- ends" (docs do Postgres, 13.3.5 Advisory Locks). O acesso aqui é por PostgREST
-- sobre um pool de ligações: o UPDATE de aquisição e o de libertação podem cair
-- em ligações diferentes, e o lock ficaria preso na primeira até a ligação ser
-- reciclada. A variante de transacção (pg_advisory_xact_lock) liberta no fim da
-- transacção — ou seja, antes de o funding sequer começar, porque o funding
-- acontece em JS, fora da transacção. Nenhuma das duas atravessa uma operação
-- assíncrona. Um lease com prazo atravessa.
--
-- O prazo é o que torna isto seguro em serverless: se a function morrer a meio,
-- ninguém corre o UPDATE de libertação, e sem prazo o funder ficava bloqueado
-- para sempre. Com prazo, volta sozinho ao pool.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bridge_funder_locks (
  -- Índice do funder dentro de BRIDGE_FUNDER_PKS. Não guarda chaves nem
  -- endereços: só a posição na lista. A chave vive apenas na env var.
  funder_index integer     PRIMARY KEY,

  -- NULL ou no passado = livre. No futuro = ocupado até esse instante.
  locked_until timestamptz,

  -- Quem detém o lease. Sem isto, uma invocação lenta cujo lease expirou podia
  -- libertar o lease de outra que já tinha adquirido o mesmo funder.
  lock_token   uuid,

  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  bridge_funder_locks              IS 'Leases do pool de funders. Nunca contem chaves nem enderecos.';
COMMENT ON COLUMN bridge_funder_locks.funder_index IS 'Posicao em BRIDGE_FUNDER_PKS (0-based).';
COMMENT ON COLUMN bridge_funder_locks.lock_token   IS 'Detentor do lease actual; impede libertacao cruzada apos expirar.';

-- Varrimento de linhas livres na aquisicao.
CREATE INDEX IF NOT EXISTS bridge_funder_locks_free_idx ON bridge_funder_locks (locked_until);

-- Mesma regra das outras tabelas: RLS ligado, zero policies, acesso so pelo
-- service_role (ver 0001).
ALTER TABLE bridge_funder_locks ENABLE ROW LEVEL SECURITY;
