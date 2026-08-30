-- =============================================================================
-- 0001_bridge_schema — Web2 Bridge V1
--
-- Implementa SPEC-BRIDGE.md §4 (DADOS) do repo instant-win-contracts, aprovado
-- 30/08/2026. Três tabelas: participantes (email -> wallet derivada), entradas
-- (uma por email e campanha) e códigos de verificação.
--
-- NUNCA guardar aqui: seed, chaves privadas, chaves derivadas. SPEC §2c e §5:
-- o seed vive só em env var do Vercel e as chaves são recalculadas em memória.
-- Esta base de dados guarda apenas o ÍNDICE de derivação e o ENDEREÇO público.
--
-- Migração idempotente (IF NOT EXISTS) para poder correr duas vezes sem partir.
-- =============================================================================

-- citext: o email é comparado sem distinguir maiúsculas. Sem isto, "A@x.pt" e
-- "a@x.pt" seriam dois participantes com duas wallets — dois lugares na mesma
-- campanha para a mesma pessoa, que é exactamente o que o guarda V1 evita.
CREATE EXTENSION IF NOT EXISTS citext;


-- -----------------------------------------------------------------------------
-- bridge_participants — um registo por email, para sempre
-- -----------------------------------------------------------------------------

-- Índice de derivação BIP-44 (m/44'/60'/0'/0/{index}), SPEC §2d. A sequência é a
-- ÚNICA fonte do índice: atribuir por COUNT(*) ou MAX(index)+1 daria o mesmo
-- número a dois pedidos concorrentes e, com isso, a mesma wallet a dois emails.
--
-- Começa em 0: é o primeiro endereço canónico do caminho de derivação, e não há
-- razão para o desperdiçar. A sequência nunca recua nem reutiliza — um índice
-- consumido por uma transação abortada fica queimado, o que é o comportamento
-- correcto: reutilizá-lo seria reatribuir uma wallet.
CREATE SEQUENCE IF NOT EXISTS bridge_wallet_index_seq AS integer START WITH 0 MINVALUE 0;

CREATE TABLE IF NOT EXISTS bridge_participants (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext      NOT NULL UNIQUE,
  wallet_index   integer     NOT NULL UNIQUE DEFAULT nextval('bridge_wallet_index_seq'),
  wallet_address text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  bridge_participants          IS 'Email -> wallet invisivel. Dado pessoal: ver pagina de privacidade (SPEC-BRIDGE 4).';
COMMENT ON COLUMN bridge_participants.wallet_index   IS 'Indice BIP-44 m/44''/60''/0''/0/{index}. Unica fonte: bridge_wallet_index_seq.';
COMMENT ON COLUMN bridge_participants.wallet_address IS 'Endereco publico derivado. A chave privada NUNCA e guardada.';


-- -----------------------------------------------------------------------------
-- bridge_entries — uma entrada por participante e campanha
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_entries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid        NOT NULL REFERENCES bridge_participants (id),
  -- numeric e nao bigint: giveawayId no contrato e uint256, que nao cabe em int8.
  giveaway_id    numeric     NOT NULL,
  status         text        NOT NULL CHECK (status IN (
                               'PENDING_CODE',
                               'CODE_VERIFIED',
                               'FUNDING',
                               'SUBMITTED',
                               'CONFIRMED',
                               'FAILED'
                             )),
  tx_hash        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Decidido (Anderson, 30/08/2026): mantida pela aplicacao, sem trigger.
  -- Quem faz UPDATE tem de passar updated_at = now() explicitamente; se nao
  -- passar, a coluna fica com a data de criacao e nao ha nada que o corrija.
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- O guarda anti-sybil do V1 (SPEC 6): 1 email = 1 entrada por campanha.
  -- E tambem a rede de seguranca da idempotencia do /verify.
  CONSTRAINT bridge_entries_participant_giveaway_key UNIQUE (participant_id, giveaway_id)
);

COMMENT ON COLUMN bridge_entries.status  IS 'PENDING_CODE|CODE_VERIFIED|FUNDING|SUBMITTED|CONFIRMED|FAILED (SPEC-BRIDGE 4).';
COMMENT ON COLUMN bridge_entries.tx_hash IS 'Hash da tx enter(). Nulo ate a submissao.';
COMMENT ON COLUMN bridge_entries.updated_at IS 'Mantida pela aplicacao (sem trigger): passar updated_at = now() em cada UPDATE.';


-- -----------------------------------------------------------------------------
-- bridge_codes — códigos de 6 dígitos, guardados como hash
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bridge_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem FK para bridge_participants: o codigo e pedido ANTES de o participante
  -- existir. O email e a unica ligacao nesta fase.
  email       citext      NOT NULL,
  giveaway_id numeric     NOT NULL,
  -- Hash, nunca o codigo em claro (SPEC 5, "codigos hasheados").
  code_hash   text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  -- Maximo de 5 tentativas (SPEC 4). O limite e imposto pela aplicacao, nao por
  -- CHECK: um CHECK rebentaria a transacao em vez de devolver uma recusa limpa.
  attempts    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN bridge_codes.code_hash IS 'Hash do codigo de 6 digitos. O codigo em claro nunca e persistido.';
COMMENT ON COLUMN bridge_codes.attempts  IS 'Tentativas de verificacao. Maximo 5, imposto na aplicacao.';


-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
-- Procura do codigo activo no /verify.
CREATE INDEX IF NOT EXISTS bridge_codes_email_giveaway_idx ON bridge_codes (email, giveaway_id);
-- Listagem/contagem de entradas por campanha.
CREATE INDEX IF NOT EXISTS bridge_entries_giveaway_idx ON bridge_entries (giveaway_id);


-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- RLS ligado nas tres tabelas e DELIBERADAMENTE sem uma unica policy.
--
-- Sem policies, os roles `anon` e `authenticated` — os que uma chave publicavel
-- do Supabase assume — nao veem nem escrevem uma linha, mesmo que a chave fuja
-- para o browser. O acesso e exclusivamente pelo `service_role`, que ignora RLS
-- por desenho do Postgres e vive apenas na env var SUPABASE_SERVICE_KEY, no
-- servidor (SPEC 4 e 5).
--
-- Consequencia a conhecer: adicionar uma policy aqui e abrir dados pessoais ao
-- browser. Nao adicionar sem uma razao escrita.
ALTER TABLE bridge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_codes        ENABLE ROW LEVEL SECURITY;
