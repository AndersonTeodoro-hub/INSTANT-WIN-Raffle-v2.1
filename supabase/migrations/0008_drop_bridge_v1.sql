-- =============================================================================
-- 0008_drop_bridge_v1 — remove a Web2 Bridge V1 por completo
--
-- SO CORRER DEPOIS do deploy que remove api/bridge/{request-code,verify,status}.ts.
-- Decisao do owner: a Bridge V1 sai da plataforma. As rotas estavam em producao
-- sem serem chamadas por nenhum ficheiro do frontend, e status.ts devolvia o
-- estado de uma entrada a partir de um email sem autenticacao.
--
-- Drop na ordem inversa das dependencias (0001 -> 0002): bridge_entries tem FK
-- para bridge_participants, por isso sai primeiro.
-- =============================================================================

DROP TABLE IF EXISTS bridge_entries;
DROP TABLE IF EXISTS bridge_codes;
DROP TABLE IF EXISTS bridge_participants;
DROP SEQUENCE IF EXISTS bridge_wallet_index_seq;
DROP TABLE IF EXISTS bridge_funder_locks;

-- citext fica: a Bridge V2 tambem depende dela (0004_bridge_v2_schema.sql).
