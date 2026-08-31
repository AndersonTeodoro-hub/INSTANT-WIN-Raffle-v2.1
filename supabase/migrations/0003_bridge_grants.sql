-- =============================================================================
-- 0003_bridge_grants — privilegios minimos para o service_role
--
-- INCIDENTE 42501, 31/08/2026. Todas as rotas da ponte devolviam 500. O curl
-- directo ao PostgREST com a Secret key no header `apikey` devolveu 403:
--
--   {"code":"42501","details":null,
--    "hint":"Grant the required privileges to the current role with:
--            GRANT SELECT ON public.bridge_participants TO service_role;",
--    "message":"permission denied for table bridge_participants"}
--
-- ORIGEM. As migracoes 0001 e 0002 criam tabelas e ligam RLS, e nao contem uma
-- unica instrucao GRANT nem ALTER DEFAULT PRIVILEGES. A documentacao do Supabase
-- diz que "By default, tables in the `public` schema are granted SELECT, INSERT,
-- UPDATE, and DELETE to the `anon` and `authenticated` roles"
-- (https://supabase.com/docs/guides/troubleshooting/database-api-42501-errors)
-- — e nao nomeia o service_role. As tabelas nasceram, portanto, sem privilegios
-- para o role que a ponte usa.
--
-- O ponto que enganou: o service_role tem BYPASSRLS, mas BYPASSRLS e GRANT sao
-- mecanismos independentes. Ignorar as policies de RLS nao dispensa ter
-- privilegio na tabela. A chave estava certa e o role resolvido estava certo;
-- faltava so isto.
--
-- IDEMPOTENTE. GRANT sobre um privilegio ja concedido e um no-op silencioso no
-- Postgres, sem erro. Este ficheiro pode correr as vezes que forem precisas.
--
-- DEPENDE de 0001 (3 tabelas + sequencia) e de 0002 (bridge_funder_locks).
-- Aplicar por ordem: 0001 -> 0002 -> 0003.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Porque NADA para anon nem para authenticated
-- -----------------------------------------------------------------------------
-- Desenho do SPEC-BRIDGE 4: RLS ligado, ZERO policies, acesso exclusivamente
-- pelo service_role. Estes dados sao pessoais (emails) e o mapeamento
-- email -> wallet nunca deve ser legivel do browser. Sem policies, o RLS ja
-- bloqueia anon/authenticated mesmo que tenham privilegio de tabela por defeito;
-- conceder-lhes o que quer que seja aqui seria retirar essa barreira em silencio.
-- Se algum dia for preciso acesso do lado do cliente, a decisao e escrever uma
-- policy explicita, nao um GRANT.

-- -----------------------------------------------------------------------------
-- bridge_participants — SELECT, INSERT, UPDATE
-- -----------------------------------------------------------------------------
--   SELECT  status.ts:27, request-code.ts:42, verify.ts:63
--           (e verify.ts:69, que le a linha devolvida pelo INSERT)
--   INSERT  verify.ts:68  (get-or-create do participante)
--   UPDATE  verify.ts:74  (grava o wallet_address depois de a sequencia dar o indice)
--   Sem DELETE: nenhum caminho do codigo apaga participantes.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_participants TO service_role;

-- -----------------------------------------------------------------------------
-- bridge_entries — SELECT, INSERT, UPDATE
-- -----------------------------------------------------------------------------
--   SELECT  status.ts:34, request-code.ts:47, verify.ts:88
--   INSERT  verify.ts:84  (upsert: insere quando a entrada ainda nao existe)
--   UPDATE  verify.ts:84 (upsert em conflito), :97, :112, :125, :132, :143
--   Sem DELETE: as entradas sao o registo historico da participacao.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_entries TO service_role;

-- -----------------------------------------------------------------------------
-- bridge_codes — SELECT, INSERT, UPDATE, DELETE
-- -----------------------------------------------------------------------------
--   SELECT  request-code.ts:58 (contagem do rate limit), verify.ts:38
--   INSERT  request-code.ts:67 (grava o hash do codigo)
--   UPDATE  verify.ts:49  (incrementa attempts numa tentativa falhada)
--   DELETE  verify.ts:136 (apaga o codigo consumido, para nao ser reutilizado)
--   Unica tabela com DELETE, e e deliberado: um codigo usado nao deve sobreviver.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bridge_codes TO service_role;

-- -----------------------------------------------------------------------------
-- bridge_funder_locks — SELECT, INSERT, UPDATE
-- -----------------------------------------------------------------------------
--   INSERT  funders.ts:197 (ensureRows: cria uma linha por indice de funder)
--   UPDATE  funders.ts:197 (upsert em conflito), :204 (aquisicao), :216 (libertacao)
--   SELECT  funders.ts:207 (le a linha devolvida pelo UPDATE de aquisicao — e
--           disso que depende saber se o lease foi ganho)
--   Sem DELETE: as linhas do pool sao permanentes.
GRANT SELECT, INSERT, UPDATE ON TABLE public.bridge_funder_locks TO service_role;

-- -----------------------------------------------------------------------------
-- bridge_wallet_index_seq — USAGE
-- -----------------------------------------------------------------------------
-- O INSERT em bridge_participants (verify.ts:68) dispara o DEFAULT
-- nextval('bridge_wallet_index_seq') declarado em 0001:38. O privilegio e
-- verificado contra o role que insere, nao contra o dono da tabela: sem isto o
-- INSERT falha com 42501 na sequencia, mesmo com INSERT na tabela.
--
-- USAGE e nao UPDATE. Documentacao do Postgres
-- (https://www.postgresql.org/docs/current/ddl-priv.html):
--   USAGE  — "For sequences, allows use of the currval and nextval functions."
--   UPDATE — "For sequences, this privilege allows use of the nextval and setval functions."
-- USAGE cobre exactamente o que precisamos. UPDATE traria tambem setval, que
-- permitiria recuar a sequencia — e recuar aqui significa reatribuir indices ja
-- usados, ou seja, dar a um email a wallet de outro. Nao concedido de propósito.
GRANT USAGE ON SEQUENCE public.bridge_wallet_index_seq TO service_role;
