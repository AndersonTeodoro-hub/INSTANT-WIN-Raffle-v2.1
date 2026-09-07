# As migrações executadas

**Sessão:** 07/09/2026 · branch `test/bridge-v2-sql` a partir de `feat/bridge-v2` (`df91b2c`)
**Alvo:** `supabase/migrations/0004_bridge_v2_schema.sql`, `0005_bridge_v2_functions.sql`,
`0006_bridge_v2_grants.sql` e as funções SQL que definem.
**Nada de produção foi alterado.** Um defeito encontrado está reportado, não corrigido.
Não houve push, nem deploy, nem contacto com nenhum Supabase real.

---

## 0. O que mudou desde o relatório anterior

`RELATORIO.md` diz de si próprio, no cabeçalho da suite `sql`:

> THERE IS NO POSTGRES AND NO DOCKER ON THIS MACHINE, so these functions are not
> executed.

Isso deixou de ser verdade. As três migrações e as vinte funções foram aplicadas e
chamadas contra um **PostgreSQL 17.10 real**. O que se segue são factos medidos, não
leituras do texto.

**Regra 0.1 / F2.** `RELATORIO.md` citava, na secção do Achado 1, as três chaves
privadas literais que o achado denunciava. Citar uma chave num relatório é escrevê-la
num ficheiro do projecto exactamente como escrevê-la no código, e era isso que fazia
a suite F2 falhar contra o próprio relatório. Os três valores estão redigidos. **A
suite F2 passa.**

---

## 1. A dependência acrescentada, e porquê

```
devDependencies:
  embedded-postgres  17.10.0-beta.17
  pg                 8.x
```

`embedded-postgres` descomprime os **binários oficiais do PostgreSQL** e corre um
cluster verdadeiro num porto de loopback, a partir de um directório temporário. Não é
um emulador nem uma reimplementação em processo: é o `postgres.exe`.

```
PostgreSQL 17.10 on x86_64-windows, compiled by msvc-19.44.35226, 64-bit
```

**Porquê este e não um motor em processo.** Duas das sete perguntas desta sessão —
concorrência e privilégios — são propriedades do *servidor*. Um motor de uma só ligação
(`pglite`) ou uma reimplementação em JavaScript (`pg-mem`) não consegue ter duas
transacções vivas ao mesmo tempo, e sem isso a pergunta 4 não tem resposta: `FOR UPDATE`,
`SKIP LOCKED`, `ON CONFLICT ... WHERE` e `BYPASSRLS` só significam alguma coisa quando
há mais do que um processo a disputá-los. Este motor dá dezasseis ligações reais.

**Versão do PostgreSQL que emula:** nenhuma — é PostgreSQL 17.10, a mesma linha maior
(17.x) que o alvo Supabase corre.

**Extensões que suporta:** o `contrib` completo do PostgreSQL 17.10, incluindo as duas
que 0004 pede — `citext` e `pgcrypto` — mais `amcheck`, `btree_gin`, `btree_gist`,
`bloom`, `cube`, `uuid-ossp` e as restantes. `gen_random_uuid()` é nativa desde a 13,
por isso 0004 não depende de `pgcrypto` para a usar.

**Credenciais.** A palavra-passe do superutilizador do cluster é gerada por
`crypto.getRandomValues` no arranque, vive só na memória do processo e morre com ele.
Não está em ficheiro nenhum. Regra 0.1.

**O molde do alvo** (`test/bridge-v2/pg.mjs`) recria o que um projecto Supabase já tem
quando uma migração corre: papéis `anon`, `authenticated`, `authenticator` e
`service_role` (este com `BYPASSRLS`), esquema `extensions` com `citext` lá dentro, e as
`ALTER DEFAULT PRIVILEGES` que o Supabase põe em `public`. Cada ficheiro é aplicado como
o alvo o aplica: o ficheiro inteiro, uma ligação, uma mensagem de query simples — que é
a única razão pela qual o `SET search_path` do topo vale para as linhas de baixo.

---

## 2. Item 1 — aplicação das três migrações por ordem, numa base vazia

Base vazia, papéis do alvo, `citext` em `extensions`.

| ficheiro | resultado | tempo |
|---|---|---|
| `0004_bridge_v2_schema.sql` | **ok** | 108 ms |
| `0005_bridge_v2_functions.sql` | **ok** | 7 ms |
| `0006_bridge_v2_grants.sql` | **ok** | 7 ms |

Nenhum erro. Ficaram no catálogo:

- **16 tabelas** `bridge_v2_*`
- **20 funções** `bridge_v2_*` — todas `SECURITY INVOKER`, todas com
  `search_path=public, extensions`
- **3 sequências**: `bridge_v2_wallet_index_seq`, `bridge_v2_run_seq`,
  `bridge_v2_ops_events_id_seq`

> **Nota de contagem.** O cabeçalho de 0006 diz *"functions — all nineteen of 0005"*.
> São **vinte**. 0005 define vinte e 0006 concede EXECUTE a vinte. O comentário está
> desactualizado; nenhuma função ficou de fora. Não é um defeito de comportamento.

### 2.1 Variante: projecto sem `citext`

Se o projecto não tiver a extensão, 0004 cria-a. As três aplicam-se, e a extensão fica
em `public`:

```
sem citext  0004_bridge_v2_schema.sql     ok
sem citext  0005_bridge_v2_functions.sql  ok
sem citext  0006_bridge_v2_grants.sql     ok
citext ficou em: public
```

### 2.2 A ordem numérica completa, como o executor a aplica

O executor aplica os ficheiros por ordem numérica, portanto 0001 a 0003 correm primeiro.
Num projecto cujo `citext` vive em `extensions`:

```
ordem   0001_bridge_schema.sql    ERRO 0001_bridge_schema.sql:37 :: 42704 type "citext" does not exist
ordem   0002_funder_locks.sql     ok
ordem   0003_bridge_grants.sql    ERRO 0003_bridge_grants.sql:? :: 42P01 relation "public.bridge_participants" does not exist
ordem   0004_bridge_v2_schema.sql        ok
ordem   0005_bridge_v2_functions.sql     ok
ordem   0006_bridge_v2_grants.sql        ok
```

**Isto é sobre a V1, não sobre a V2, e está aqui por dois motivos.** Primeiro: 0001 não
tem `SET search_path` nenhum, e o seu `CREATE EXTENSION IF NOT EXISTS citext` é um
no-op quando a extensão já existe noutro esquema — por isso a coluna `citext` da linha
37 não resolve, e 0003 cai atrás dela por a tabela não existir. Segundo, e é o que
interessa: **as três da V2 aplicam-se na mesma base à mesma ordem**, porque carregam a
linha que 0001 não carrega. Aquele `SET search_path = public, extensions` no topo de
0004, 0005 e 0006 é exactamente a diferença entre os dois blocos, e agora está medido.

---

## 3. Item 2 — idempotência

Três aplicações consecutivas da mesma trinca sobre a mesma base:

| ronda | 0004 | 0005 | 0006 |
|---|---|---|---|
| 1 | ok · 108 ms | ok · 7 ms | ok · 7 ms |
| 2 | ok · 12 ms | ok · 3 ms | ok · 3 ms |
| 3 | ok · 7 ms | ok · 4 ms | ok · 3 ms |

Nenhum erro. Depois das três rondas o catálogo tem exactamente as mesmas 16 tabelas e
as mesmas 20 funções — nenhuma sobrecarga (`overload`) duplicada ficou para trás, que é
o risco real de um ficheiro que faz `CREATE OR REPLACE` e `DROP FUNCTION IF EXISTS` da
assinatura antiga na mesma passagem.

---

## 4. Item 3 — as vinte funções, executadas

Uma linha por função: entrada representativa, o que o motor devolveu, e o requisito
contra o qual se lê.

| função | executada com | resultado | requisito |
|---|---|---|---|
| `bridge_v2_rate_limit_hit` | janela 60 s, tecto 2, três chamadas | `(t,0) (t,0) (f,10)`, contador 3 | B1/B2/B3/G1 OK |
| ” | quarta chamada com penalidade viva | `(f,10)` e o contador **não** subiu | B4 OK |
| ” | janela 1 s, penalidade 1 s, atravessando a fronteira | 1.ª greve `retry=1`, 2.ª `retry=2`, `strikes=2`, **duas** linhas de janela | B4 OK |
| ” | 20 greves acumuladas | `retry=3600` (tecto) | B4 OK |
| ” | decaimento 0 s | `strikes` volta a 1 | B4 OK |
| `bridge_v2_claim_email_code_attempt` | tecto 3, quatro tentativas | `left=2,1,0`, depois nenhuma linha; `attempts=3` | J4/G1 OK |
| ” | e-mail em maiúsculas | encontra o código (`citext` resolveu) | C1 OK |
| ” | código expirado, e código consumido | nenhuma linha em ambos | J3 OK |
| ” | dois códigos vivos, tecto 3 | **6 tentativas em 2 códigos** | J3/J4 **FALHA — Achado 1** |
| `bridge_v2_consume_email_code` | mesmo `code_id` duas vezes | `true`, depois `false` | G2/G5 OK |
| `bridge_v2_supersede_email_codes` | dois códigos vivos, depois nada | `2`, depois `0` | J3 OK |
| `bridge_v2_claim_link_for_chat` | `giveaway_id` = 2^256−1 | devolve os 78 dígitos exactos, e repete-se sem erro | I2/G5 OK |
| ” | segundo `/start` do mesmo chat | desliga o primeiro link **sem o consumir** e liga o segundo | G5 OK |
| `bridge_v2_consume_link_for_chat` | duas entregas; e link expirado | 1 linha, depois 0; expirado dá 0 | G5 OK |
| `bridge_v2_bind_phone_and_verify` | número novo, entrada `AWAITING_CONTACT` | `VERIFIED`; reentrega dá `NOT_AWAITING` | C5/C6/G5 OK |
| ” | número vivo de outra conta | `TAKEN`, uma só ligação viva | C5 OK |
| ” | número diferente para a mesma conta | `NUMBER_CHANGED`, antigo libertado com arrefecimento, **todas** as entradas vivas a `FAILED` | C6 OK |
| ” | número em arrefecimento | `COOLDOWN`; passado o arrefecimento, `VERIFIED` | C6 OK |
| ” | número que já tem entrada nessa campanha | `DUPLICATE` (nunca uma excepção) | C5/8.8 OK |
| ” | `NO_ENTRY` e `DUPLICATE` | **o número fica ligado à conta na mesma** | C5/C6/G5 **FALHA — Achado 2** |
| `bridge_v2_release_phone` | conta com número; depois sem | `1`, depois `0` | C6 OK |
| `bridge_v2_acquire_funder` | 3 funders livres | devolve índice, endereço, nonce e `lease_token` | G3/D6 OK |
| ” | funder já arrendado; e arrendamento expirado | nenhuma linha; depois nova linha com token novo | G3 OK |
| `bridge_v2_renew_funder_lease` | token certo / token errado | `true` / `false` | G3 OK |
| `bridge_v2_release_funder` | liberta com nonce 40, depois com 12 | fica em **40** (`GREATEST`) | G6 OK |
| `bridge_v2_reconcile_funder_nonce` | sobe a 40, desce a 5; token errado | `true`, `true` (nonce = 5), `false` | G6 OK |
| `bridge_v2_disable_funder` | duas vezes o mesmo índice | `true`, depois `false`; seis aquisições nunca o devolvem | H8 OK |
| `bridge_v2_claim_spend` | 3 unidades sob tecto 10/100 | `true`, ambas as janelas a 3 | B8 OK |
| ” | 9 unidades (estoura a hora); 2 unidades (estoura o dia) | `false` e `false`; **ambas as janelas ficam em 3** | B8 OK |
| `bridge_v2_cleanup` | uma linha caduca em cada tabela efémera | 8 linhas, `1` em cada; penalidade **viva** preservada; participantes/entradas/telefones intactos | I10/K7/D7 OK |
| `bridge_v2_try_lock` | duas corridas seguidas | uuid, depois `NULL` | G3/G6 OK |
| ” | ttl 1 s, depois de expirar | uuid **novo** | G3 OK |
| `bridge_v2_release_lock` | holder velho / holder actual / repetido | `false`, `true`, `false` | G3 OK |
| `bridge_v2_next_run_sequence` | duas chamadas | avança exactamente 1 | Sec.7/G4 OK |
| `bridge_v2_next_wallet_index` | primeira chamada numa base nova | `0`; a linha guarda o índice reservado | I9 OK |
| `bridge_v2_campaigns_with_verified` | 3 entradas na campanha 50, 1 na 2^256−1, 1 `CONFIRMED` | `[2^256−1, 50]` — uma linha por campanha, mais antiga primeiro; limite 1 dá 1 campanha; limite −1 dá 0 linhas | C8/G4/I2 OK |

Além disso, e não é uma função: `bridge_v2_participants` recusa `'0x'` como endereço com
`23514` (o `CHECK`), que é o achado K5 da V1 fechado por constraint e não por convenção.

---

## 5. Item 4 — concorrência real

Cada chamada numa ligação própria, cada uma dentro da sua transacção, todas libertadas
no mesmo instante por uma barreira: nenhuma avança antes de todas terem feito `BEGIN`.

| afirmação do ficheiro | exercício | resultado |
|---|---|---|
| contador atómico (B3/G1) | 8 chamadas simultâneas, tecto 100 | contador = **8** OK |
| escalada de greves sob rajada (B4) | 8 negações simultâneas, chave **nova** | **1** greve, deviam ser 8 — **Achado 3** |
| a mesma, chave com linha já criada | 8 negações simultâneas | **8** greves OK |
| uma tentativa por chamada (J4) | 8 palpites simultâneos | `attempts=8`, oito `attempts_left` **distintos** OK |
| consumo único (G2/G5) | 4 consumos do mesmo código | 1 `true`, 3 `false` OK |
| aquisição de funder (G3) | 3 corridas, 3 funders | três índices **distintos**, nenhuma corrida vazia OK |
| ” | 4 corridas, 1 funder livre | exactamente **1** vencedor OK |
| exclusão da corrida agendada (G6) | 8 `try_lock` no mesmo nome | exactamente **1** holder, nenhuma excepção OK |
| ligação de telefone (C5) | 2 contas, o mesmo número novo | `VERIFIED` + `TAKEN`, **1** ligação viva OK |
| consumo do link (G5) | 4 entregas do mesmo contacto | exactamente **1** consome OK |
| tecto de gasto (B8) | 10 pedidos de 1 unidade, tecto 5 | exactamente **5** passam, `units=5` OK |
| sequências (I9/G4) | 8 saques simultâneos em cada | 8 valores distintos em ambas OK |
| emissão de código (J3) | 2 emissões simultâneas (`supersede` + `insert`) | **2** códigos vivos — **Achado 4** |

O `FOR UPDATE SKIP LOCKED` de `bridge_v2_acquire_funder` está debaixo do `LIMIT` no
plano, e é por isso que três corridas simultâneas apanham três funders diferentes em vez
de duas voltarem de mãos vazias. Isso não se lê no texto; mede-se.

---

## 6. Item 5 — I5, o que cada tabela devolve e aceita

**Estado do esquema:** RLS ligado nas **16** tabelas, **0** políticas.

### Papel sem `BYPASSRLS`, com exactamente as mesmas concessões do `service_role`

| operação | resultado |
|---|---|
| `SELECT` em cada uma das 16 tabelas | **0 linhas** em todas, com linhas lá dentro |
| `INSERT` | recusado, `42501 new row violates row-level security policy for table "bridge_v2_locks"` |
| `UPDATE` | aceite, **0 linhas** afectadas |
| `DELETE` | aceite, **0 linhas** afectadas |

É o comportamento que I5 pede: com RLS ligado e nenhuma política, quem não tem
`BYPASSRLS` não vê nada e não escreve nada, **por muitas concessões que tenha**.

### `anon` tal como 0006 o deixa

| operação | resultado |
|---|---|
| `SELECT FROM bridge_v2_participants` | `42501 permission denied for table bridge_v2_participants` |
| `INSERT INTO bridge_v2_ops_events` | `42501 permission denied for table bridge_v2_ops_events` |
| `SELECT bridge_v2_next_run_sequence()` | `42501 permission denied for function bridge_v2_next_run_sequence` |

Barrado no primeiro mecanismo (a concessão) antes sequer de chegar ao segundo (RLS).

### `service_role`

| operação | resultado |
|---|---|
| `SELECT` em cada tabela | **as linhas reais** — `BYPASSRLS` sobrevive ao `SET ROLE` |
| `INSERT` em participantes / eventos | aceite |
| chamada a `bridge_v2_try_lock` | aceite, devolve o holder |

O `BYPASSRLS` valer através de `SET ROLE` não é óbvio e é a diferença entre as rotas
funcionarem e lerem sempre o conjunto vazio. Está medido.

---

## 7. Item 6 — GRANT/REVOKE de 0006, função a função

Depois das três migrações, para as **20** funções, sem excepção:

```
bridge_v2_acquire_funder             public=false anon=false authenticated=false service_role=true
bridge_v2_bind_phone_and_verify      public=false anon=false authenticated=false service_role=true
bridge_v2_campaigns_with_verified    public=false anon=false authenticated=false service_role=true
bridge_v2_claim_email_code_attempt   public=false anon=false authenticated=false service_role=true
bridge_v2_claim_link_for_chat        public=false anon=false authenticated=false service_role=true
bridge_v2_claim_spend                public=false anon=false authenticated=false service_role=true
bridge_v2_cleanup                    public=false anon=false authenticated=false service_role=true
bridge_v2_consume_email_code         public=false anon=false authenticated=false service_role=true
bridge_v2_consume_link_for_chat      public=false anon=false authenticated=false service_role=true
bridge_v2_disable_funder             public=false anon=false authenticated=false service_role=true
bridge_v2_next_run_sequence          public=false anon=false authenticated=false service_role=true
bridge_v2_next_wallet_index          public=false anon=false authenticated=false service_role=true
bridge_v2_rate_limit_hit             public=false anon=false authenticated=false service_role=true
bridge_v2_reconcile_funder_nonce     public=false anon=false authenticated=false service_role=true
bridge_v2_release_funder             public=false anon=false authenticated=false service_role=true
bridge_v2_release_lock               public=false anon=false authenticated=false service_role=true
bridge_v2_release_phone              public=false anon=false authenticated=false service_role=true
bridge_v2_renew_funder_lease         public=false anon=false authenticated=false service_role=true
bridge_v2_supersede_email_codes      public=false anon=false authenticated=false service_role=true
bridge_v2_try_lock                   public=false anon=false authenticated=false service_role=true
```

ACL efectiva de cada uma: `{postgres=X/postgres, service_role=X/postgres}`. A varredura
`DO $revoke_public_execute$` de 0006 faz o que diz: o `EXECUTE` que o Postgres dá a
`PUBLIC` em cada função nova é retirado antes de qualquer concessão, e `PUBLIC` inclui
os dois papéis a que uma chave publicável de browser resolve.

**Tabelas:** `anon` e `authenticated` não têm **nenhum** privilégio em **nenhuma** das
16 tabelas. A parede de `REVOKE` no fim de 0006 faz o que diz.

**Sequências:** não. Ver Achado 5.

### As duas formas possíveis do alvo, e o que muda

O Supabase põe `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES /
FUNCTIONS / SEQUENCES TO anon, authenticated, service_role`. As duas formas foram
medidas:

| | com as default privileges do Supabase | sem elas |
|---|---|---|
| `anon` em tabelas | nada (0006 revoga) | nada |
| `anon` em funções | nada (0006 revoga) | nada |
| `anon` em sequências | **USAGE + SELECT + UPDATE nas três** | nada |
| `service_role` em tabelas | `SELECT/INSERT/UPDATE/DELETE` em **todas** as 16 | exactamente a lista de 0006 |
| `service_role` em sequências | `USAGE + SELECT + UPDATE` | `USAGE` apenas |

Na forma "sem", os verbos ficam exactamente como 0006 os argumenta — sem `DELETE` em
participantes, entradas, telefones, funders e custódia; sem `UPDATE` em `ops_events`,
raízes e folhas de elegibilidade; `SI--` nas duas tabelas append-only — **e tudo o que o
código faz continua a funcionar** (inserir participante, `rate_limit_hit`, `cleanup` a
devolver as suas 8 linhas, inserir evento). Está testado.

Qual das duas é o alvo não se decide desta máquina. O incidente 42501 de 31/08/2026 do
próprio projecto (*"as tabelas tinham sido criadas sem uma única GRANT"*) é prova de que,
para tabelas, o alvo era a forma "sem". Mas a parede de `REVOKE ... FROM anon,
authenticated` no fim de 0006 só faz sentido na forma "com". **As duas não podem ser
verdade ao mesmo tempo**, e essa é a incoerência dos Achados 5 e 6: seja qual for a
forma, 0006 defende-se contra as default privileges em tabelas e funções e não se
defende delas em sequências, nem se defende de si próprio no `service_role`.

---

## 8. Item 7 — divergências do motor face ao alvo

Nenhuma divergência de **semântica SQL** foi encontrada, e não é surpresa: é PostgreSQL
17.10, não uma emulação. O que difere é o ambiente à volta, e está tudo declarado:

| | motor | alvo Supabase |
|---|---|---|
| versão | PostgreSQL 17.10 (msvc, x86_64-windows) | PostgreSQL 17.x (Linux) |
| isolamento por omissão | `read committed` | `read committed` — igual, e é a base de todas as afirmações de 0005 |
| `standard_conforming_strings` | `on` | `on` — de que dependem os escapes `LIKE 'bridge\_v2\_%'` de 0006 |
| fuso | `Europe/London` (o da máquina) | UTC |
| papel que aplica as migrações | superutilizador `postgres` | `postgres` do projecto, **não** superutilizador |
| papéis, esquema `extensions`, default privileges | recriados por `test/bridge-v2/pg.mjs` | fornecidos pela plataforma |
| PostgREST | **ausente** | presente |
| `pg_net`, `pgjwt`, `supabase_vault`, `auth.*` | ausentes | presentes, e **não usados** por 0004–0006 |

Três consequências que interessam:

1. **PostgREST não está aqui.** As duas funções que devolvem `giveaway_id::text`
   fazem-no porque o PostgREST renderiza um `numeric` como número JSON, que é um
   `double`. O motor confirma que o valor sai como texto com os 78 dígitos exactos; o
   arredondamento que a conversão evitaria não pode ser reproduzido sem PostgREST. O que
   está testado é metade da defesa — a metade que vive no SQL.
2. **O `postgres` daqui é superutilizador; o do Supabase não é.** `CREATE EXTENSION` e
   `CREATE ROLE` passam aqui por isso. No alvo passam por outro caminho (extensões de
   confiança, papéis já criados) — que é precisamente por isso que a sessão os cria
   antes de aplicar as migrações, em vez de deixar as migrações criá-los.
3. **O fuso é o da máquina.** Nada em 0004–0006 depende do fuso: tudo é `timestamptz`,
   `now()`, `date_trunc` e `make_interval`, e o `date_trunc('hour'|'day')` de
   `bridge_v2_claim_spend` é o único ponto onde um fuso diferente mudaria a fronteira da
   janela diária — não o comportamento, só onde o dia começa.

---

## 9. Achados

Seis achados novos, todos com teste que falha. O sétimo (`J2`) já vinha do relatório
anterior e continua por corrigir.

---

### Achado 1 — o tecto de tentativas é por código, não por endereço

**Ficheiro:linha:** `supabase/migrations/0005_bridge_v2_functions.sql:145-171`
**Teste:** `[J3 J4] the attempt ceiling belongs to the address, not to one code`

**O que a spec exige.** J3: só o código mais recente e não consumido de um endereço é
válido. J4: as tentativas têm tecto. O comentário da função diz *"Claims one attempt
against the newest live code for an email"*.

**O que o motor fez.** Com dois códigos vivos para o mesmo endereço e tecto três, deu
**seis** palpites — três no mais recente, e depois **três no anterior**.

**Porquê.** O predicado `c.attempts < p_max_attempts` está *dentro* do
`ORDER BY created_at DESC LIMIT 1`. Quando o código mais recente esgota as tentativas
ele sai do conjunto de candidatos em vez de terminar a tentativa, e o `LIMIT 1` passa a
apanhar o código anterior — que volta a ter tecto inteiro. O tecto pertence à linha, não
à conta.

---

### Achado 2 — uma ligação que não verifica gasta o número na mesma

**Ficheiro:linha:** `supabase/migrations/0005_bridge_v2_functions.sql:377-386`
(o `INSERT INTO bridge_v2_phones` e o seu bloco `EXCEPTION`), contra o cabeçalho da
própria função em `0005:293-297`.
**Teste:** `[G5 C5 C6] a bind that does not verify does not spend the number either`

**O que a spec exige.** É o cabeçalho da função a dizê-lo, sobre a versão de duas
chamadas que esta substitui:

> Split across two calls there was a window in which a number was bound to an account
> whose entry never advanced: the number spent, the participation lost, and no way back
> because the number is now in use.

**O que o motor fez.** Exactamente isso, em dois caminhos:

- `NO_ENTRY` (conta sem entrada na campanha que o bot nomeia): **1 linha viva** em
  `bridge_v2_phones` para essa conta, e nenhuma entrada verificada.
- `DUPLICATE` (o número já tem entrada nessa campanha): **1 linha viva**, e a entrada da
  conta ficou em `AWAITING_CONTACT`.

**Porquê.** O `INSERT INTO bridge_v2_phones` está num `BEGIN ... EXCEPTION` próprio, que
é uma sub-transacção que **entrega o trabalho à transacção exterior**. A procura da
entrada que devolve `NO_ENTRY` (`0005:388-394`) e o `UPDATE` que devolve `DUPLICATE`
(`0005:396-410`) vêm depois, e nenhum dos dois desfaz a ligação. A função devolve
normalmente, portanto a transacção confirma.

**Alcance.** C5 torna o número inutilizável em toda a plataforma a partir daí, e o
chamador não o liberta: `api/bridge/v2/telegram/webhook.ts:212-215` mapeia cada
resultado para uma mensagem de bot e mais nada. Recuperar exige `bridge_v2_release_phone`,
que abre um arrefecimento.

---

### Achado 3 — a escalada de B4 perde a primeira rajada

**Ficheiro:linha:** `supabase/migrations/0005_bridge_v2_functions.sql:75-83` (a
afirmação) e `0005:114-119` (o upsert).
**Teste:** `[B4 B3 G1] concurrent strikes against a new key each count`

**O que o ficheiro afirma.**

> The standing penalty is read first and under a row lock, so two concurrent callers
> cannot both observe the pre-strike value and both write strike n+1.

**O que o motor fez.** Oito negações simultâneas contra uma chave `(axis, key_hash)`
ainda sem linha de penalidade registaram **1** greve. Contra a mesma chave, com a linha
já criada, oito negações simultâneas registaram **8**.

**Porquê.** `SELECT ... FOR UPDATE` não tranca nada quando nenhuma linha corresponde. Os
oito lêem `v_strikes = 0`, e o upsert escreve `strikes = v_strikes` — um valor local,
não `bridge_v2_rate_penalties.strikes + 1`. É a leitura-compara-escreve que B3 e G1
proíbem, sobrevivendo no contador de greves. A partir da segunda rajada a tranca existe
e o contador está certo.

**Alcance.** Limitado ao primeiro degrau, e o primeiro degrau é o que se aplica a quem
começa a atacar agora — que é o alvo de B4. O contador de *pedidos*
(`bridge_v2_rate_limits`) está correcto sob concorrência: oito chamadas simultâneas
contam oito.

---

### Achado 4 — duas emissões simultâneas deixam dois códigos vivos

**Ficheiro:linha:** `lib/bridge-v2/codes.ts:47-61`
**Teste:** `[J3 J4] two issues of a code at once leave one live code, not two`

**O que o código afirma.**

> J3: only the most recent code is valid. Superseding first means a race between two
> issues leaves exactly one live code rather than two.

**O que o motor fez.** Duas emissões simultâneas (`supersede` numa mensagem, `insert`
noutra) deixaram **2** códigos vivos para o mesmo endereço.

**Porquê.** As duas chamadas são idas e voltas separadas. A intercalação
`supersede(A)`, `supersede(B)`, `insert(A)`, `insert(B)` não está excluída por nada:
ambos os `supersede` não encontram nada para terminar e ambos os `insert` entram.

**Alcance.** Duplica o tecto de tentativas de J4 e, junto com o Achado 1, torna o código
anterior adivinhável depois de o mais recente esgotar. As funções SQL fazem o que
prometem; é a costura entre elas que não é atómica.

---

### Achado 5 — 0006 revoga tabelas e funções a `anon`, e não revoga sequências

**Ficheiro:linha:** `supabase/migrations/0006_bridge_v2_grants.sql:143-150` (as
concessões de sequência) contra `0006:225-241` (a parede de `REVOKE` das tabelas), e
contra o comentário em `0006:137-141`.
**Teste:** `[I5 I9] 0006 revokes tables and functions from anon and authenticated, and sequences too`

**O que o ficheiro afirma.**

> USAGE, never UPDATE. Postgres grants nextval under both, but UPDATE also grants
> setval, and rewinding the wallet sequence would reassign an index that is already
> somebody's wallet.

**O que o motor fez.** Numa base com a forma de um projecto Supabase, ficaram de pé:

```
anon          em bridge_v2_wallet_index_seq   usage=true update=true
authenticated em bridge_v2_wallet_index_seq   usage=true update=true
anon          em bridge_v2_run_seq            usage=true update=true
authenticated em bridge_v2_run_seq            usage=true update=true
anon          em bridge_v2_ops_events_id_seq  usage=true update=true
authenticated em bridge_v2_ops_events_id_seq  usage=true update=true
```

E, como `anon`: `nextval` **passou**, `setval` **passou**.

**Porquê.** `GRANT USAGE ... TO service_role` acrescenta; não retira o que as
`ALTER DEFAULT PRIVILEGES` do Supabase já deram. 0006 responde a essas default
privileges com um `REVOKE` explícito para tabelas e para funções, e não responde para
sequências. Rebobinar a sequência da carteira — a coisa que o comentário nomeia como o
perigo — é precisamente o que `anon` pode fazer.

**Atenuante honesta.** Numa base **sem** as default privileges do Supabase, `anon` não
tem nada em nenhuma sequência, e o achado não existe. Mas nessa base a parede de
`REVOKE` do fim de 0006 também não faz nada. A assimetria entre os dois tratamentos é
que é o defeito, e existe em qualquer das duas formas.

---

### Achado 6 — os verbos que 0006 recusa não estão recusados

**Ficheiro:linha:** `supabase/migrations/0006_bridge_v2_grants.sql:60-140`
**Teste:** `[I5 D7] 0006 withholds a verb from service_role rather than only failing to grant it`

**O que o ficheiro afirma.** Cada concessão nomeia o sítio que a usa, e cada omissão é
argumentada:

> *"No DELETE: erasure is a rewrite, and removing a participant would orphan an address
> already in an on-chain root."*
> *"entries — the whole lifecycle. No DELETE: an entry is the participation record."*
> *"No UPDATE: the bridge appends to the record of what it did and never rewrites a line
> of it."*

**O que o motor fez.** Como `service_role`, numa base com a forma de um projecto
Supabase, todas estas passaram:

```
DELETE FROM bridge_v2_entries                     aceite
DELETE FROM bridge_v2_participants                aceite
UPDATE bridge_v2_ops_events                       aceite
UPDATE bridge_v2_eligibility_roots                aceite
setval('bridge_v2_wallet_index_seq', 0, false)    aceite
```

**Porquê.** O ficheiro só faz `GRANT`. Nunca faz `REVOKE` ao `service_role`, e as
`ALTER DEFAULT PRIVILEGES` do Supabase já lhe deram `ALL` em tudo o que a migração cria.
O modelo por verbo — que é a parte do ficheiro onde está o pensamento — não tem efeito
nenhum sobre esse alvo.

**Atenuante honesta.** Numa base sem as default privileges, os verbos ficam exactamente
como 0006 os lista, e isso está testado e passa (*on a project without Supabase default
privileges, 0006 grants exactly what it lists*). O defeito é 0006 não tornar isso
verdade por si: um `REVOKE ALL ... FROM service_role` antes das concessões faria do
modelo por verbo um facto em vez de uma esperança.

---

### Achado 7 — J2, herdado e por corrigir

**Teste:** `[J2] the code hash is bound to the campaign as well as the address`
Já descrito em `RELATORIO.md`. Não foi tocado nesta sessão.

---

## 10. Mapa função → teste

As vinte funções de 0005, e os testes que as executam. Nenhuma ficou sem execução.

| função | testes |
|---|---|
| `bridge_v2_rate_limit_hit` | *allows up to the ceiling and denies past it* · *a request refused by a live penalty…* · *the penalty outlives the window boundary…* · *the penalty is capped at an hour…* · *a strike older than the decay window…* · *eight concurrent rate limit calls count eight* · *concurrent strikes against a new key each count* (falha) |
| `bridge_v2_claim_email_code_attempt` | *spends one attempt and hands back the stored hash* · *the email is matched case-insensitively* · *an expired or consumed code cannot be attempted* · *eight concurrent guesses spend one attempt each* · *the attempt ceiling belongs to the address* (falha) |
| `bridge_v2_consume_email_code` | *reports whether it changed a row* · *four concurrent consumptions of one code* |
| `bridge_v2_supersede_email_codes` | *ends every live code for the address* · *citext resolves from the extensions schema* · *two issues of a code at once…* (falha) |
| `bridge_v2_claim_link_for_chat` | *binds the chat and returns the campaign id exactly* · *a second start from one chat detaches the first link* |
| `bridge_v2_consume_link_for_chat` | *consumes once, and an expired link not at all* · *four concurrent deliveries of one contact* |
| `bridge_v2_bind_phone_and_verify` | *binds the number and verifies the entry* · *a number live for one account is refused to another* · *a change of number releases the old one* · *a released number is held out of circulation* · *one entry per campaign and number* · *two accounts presenting one number at once* · *a bind that does not verify…* (falha) |
| `bridge_v2_release_phone` | *a released number is held out of circulation until its cooldown ends* |
| `bridge_v2_acquire_funder` | *takes a free funder and hands out a lease token* · *a leased funder is not handed out again* · *concurrent acquisitions never hand the same funder to two runs* · *four concurrent runs against one free funder* · *a disabled funder leaves the rotation* |
| `bridge_v2_renew_funder_lease` | *renew and release both require the lease token* |
| `bridge_v2_release_funder` | *renew and release both require the lease token* · *release advances the nonce and never rewinds it* |
| `bridge_v2_reconcile_funder_nonce` | *reconciliation moves the nonce in either direction* · *a disabled funder leaves the rotation* |
| `bridge_v2_disable_funder` | *a disabled funder leaves the rotation and cannot be disabled twice* |
| `bridge_v2_claim_spend` | *moves both windows, or neither* · *ten concurrent claims against a ceiling of five* · *0006 grants exactly what it lists* |
| `bridge_v2_cleanup` | *empties every ephemeral table and reports what it removed* · *0006 grants exactly what it lists* |
| `bridge_v2_try_lock` | *gives one holder, and nothing to the next run* · *an expired lock is taken by the next run* · *eight concurrent runs take one lock between them* · *service_role carries BYPASSRLS through SET ROLE* |
| `bridge_v2_release_lock` | *an expired lock is taken by the next run, and the old holder cannot release it* |
| `bridge_v2_next_run_sequence` | *the run sequence advances by one per run* · *concurrent draws on the two sequences* · *anon reaches no table and no function at all* |
| `bridge_v2_next_wallet_index` | *the wallet index is reserved from a sequence, starting at zero* · *concurrent draws on the two sequences* |
| `bridge_v2_campaigns_with_verified` | *gives one row per campaign, longest waiting first* |

---

## 11. Ficheiros desta sessão

| ficheiro | o que é |
|---|---|
| `test/bridge-v2/pg.mjs` | arranque do cluster, molde do alvo, aplicação de migrações, barreira de concorrência, `SET ROLE` |
| `test/bridge-v2/suites/engine.test.mjs` | a suite executada |
| `test/bridge-v2/run.mjs` | a suite entra na lista, e o cluster é parado no fim |
| `test/bridge-v2/RELATORIO.md` | três chaves redigidas (regra 0.1 / F2) |
| `package.json` | as duas devDependencies |

Nenhum ficheiro de produção foi alterado.

---

## 12. Output completo da suite

`npm run test:bridge-v2`, a partir da linha em que os resultados começam. As linhas
`[bridge-v2] …` que aparecem antes são o `stderr` que as rotas emitem de propósito nos
testes de erro, e estão omitidas.

**Resumo: 403 testes, 396 passaram, 7 falharam.** Cada falha é um dos achados acima.

```
=== pure ===
PASS  [J1] randomDigits always yields exactly the configured width
PASS  [J1] randomDigits covers its range rather than a corner of it
PASS  [J1] randomIndex rejects the biased tail instead of taking a remainder
PASS  [J1] randomIndex refuses a bound it cannot serve uniformly
PASS  [F1] one message under three roots gives three unrelated hashes
PASS  [F1] one root with two labels gives two unrelated hashes
PASS  [F1 F2] a keyed hash never contains the configured secret
PASS  [J5] the hex compare walks the string and refuses a length mismatch
PASS  [A2] base64url output carries no padding and no URL-unsafe character
PASS  [A2] a session token carries 256 bits of entropy
PASS  [I2] a giveaway id is checked against uint256, not against a digit count
PASS  [I1] the code parser accepts only the configured width of digits
PASS  [I1] the email parser refuses what is not an address
PASS  [I1 H2] the address parser normalises case and refuses anything else
PASS  [C5 I1] a phone is normalised so one number cannot hash twice
PASS  [I1] a Telegram id is accepted in both wire shapes and nothing else
PASS  [I1] a link code is accepted only in the shape the bridge issues
PASS  [I3] a body is refused on its content type before it is parsed
PASS  [I3] a body is refused on its real size, not on what it declares
PASS  [I3 I1] a JSON body that is not an object is refused
PASS  [C1] sub-addressing and Gmail dots collapse to one account key
PASS  [C1] dots are left alone where the provider says they matter
PASS  [C1] sub-addressing is stripped at every provider, which is the account rule
PASS  [C2 C8] a domain on the blocklist is refused before anything is issued
PASS  [C2] a domain with no MX record is refused
PASS  [C2] a domain that resolves is accepted
PASS  [C2 G4] a resolver outage does not become a registration outage
PASS  [G4] the MX lookup and the blocklist read are both bounded
PASS  [A3] the session cookie carries every flag the requirement names
PASS  [A5] the clearing cookie expires immediately and keeps its flags
PASS  [A2] only a hash of the token reaches the database
PASS  [A4] both clocks are written and the absolute one is the longer
PASS  [A1 A4] a session past either clock, or revoked, resolves to nobody
PASS  [A4] a live session slides its idle clock and never its absolute one
PASS  [A1 A6] no cookie is no session, whatever else the request carries
PASS  [A5] revocation covers every live session of the participant at once
PASS  [E2] a USDC share below the threshold may rest in the derived wallet
PASS  [E2] a USDC share at or above the threshold requires the winner own wallet
PASS  [E2] an NFT requires the winner own wallet at any value, with no exception
PASS  [E2 OWNER-D1] any token that is not USDC requires the winner own wallet
PASS  [OWNER-D1] the USDC comparison does not depend on the case of the address
PASS  [E2] the largest winner share is the one that carries the remainder
PASS  [E3] custody expiry is measured from the moment it begins
PASS  [C8] the leaf is one keccak of the packed address, as the contract computes it
PASS  [C8] every proof verifies under an independent commutative fold
PASS  [C8] an address outside the tree cannot be proved into it
PASS  [C8] an odd node is carried up rather than paired with itself
PASS  [C8] the tree is deterministic for a set, whatever order it arrives in
PASS  [C8] an empty batch is refused rather than producing a root of nothing
PASS  [C8] a proof outside the tree is refused rather than returned empty
PASS  [F6 E1] nothing that holds a key crosses the wallet boundary
PASS  [F6] derivation matches the canonical BIP-44 addresses for the test mnemonic
PASS  [I9] a derivation index that is not a whole non-negative number is refused
PASS  [F6] signing returns bytes, and a different index returns different bytes
PASS  [C7 K4] no signal leaves the module in clear
PASS  [B2 C7] rotating the last octet does not produce a new subnet key
PASS  [B2] the leftmost forwarded address is the client, not the proxy
PASS  [C7] an IPv6 client is reduced to the block a provider allocates
PASS  [F3] a missing variable is reported by name and never by value or length
PASS  [K8 F3] assertEnv reports every missing name at once
PASS  [K8] the cron secret is required configuration, not an optional one
PASS  [F1] the roots are separate variables, one per function
PASS  [R3] no message the bot can send contains a gambling word
PASS  [R2] no message the bot can send names crypto, a prize, an amount or a link
PASS  [D5 K6] a throw anywhere in a route becomes one generic sentence
PASS  [D5 F3] a configuration failure reaches the client as the same sentence
PASS  [D2] the indistinguishable answer has one shape and one status
PASS  [D3] a route with uniform timing holds its error path to the same floor
PASS  [I1] a route answers 405 to a method it does not implement
PASS  [D1] every response is marked no-store
PASS  [G4] every unit of work fits inside one run budget
PASS  [G4] the run budget leaves room for the slowest unit inside maxDuration
PASS  [G4] the prize reservation is derived from the entry one and still fits
PASS  [G4] every phase has a reservation and every reservation has a phase
PASS  [G4] a route duration this code derives is the duration vercel.json declares
PASS  [G4 K8] both scheduled paths are routes with a declared duration
PASS  [H1] the contract address and the chain are literals, not configuration
PASS  [H1] the manager ABI carries exactly three state-changing functions
PASS  [H1] no ABI in the bridge can approve or move a third party balance
PASS  [H1] the prize modules and the VRF coordinator are read-only to the bridge
PASS  [H4] an estimate outside its band is refused before anything is signed
PASS  [H4] the transfer band admits the real Arbitrum intrinsic cost
PASS  [H3] a plan above the absolute ceiling fails instead of spending
PASS  [H3] the margin is applied to the limit and carried into the worst case
PASS  [K5] a revert is decoded to the name the contract raised
PASS  [K5] an already-decoded revert is read from where viem leaves it
PASS  [K5] a timeout still reads as a timeout, not as a revert
PASS  [K5] a cause chain that points at itself does not hang the failure path
PASS  [K4 K5] only the error name comes back, never the arguments

=== sql ===
PASS  [B3 G1] the rate limit counts with one statement, not a select then an insert
PASS  [B3 G1] the standing penalty is read under a row lock
PASS  [B4] the penalty is keyed by axis and key alone, never by window
PASS  [B4] the penalty grows with the strike count, is capped, and decays
PASS  [B4] a request refused by a live penalty does not also spend a window slot
PASS  [J4 G1] one attempt is spent by the same statement that hands out the hash
PASS  [J3] only a live, unconsumed, most recent code can be attempted
PASS  [J3] issuing a code supersedes every live code for that address
PASS  [G2] consumption reports whether it changed a row
PASS  [B8] a spend claim moves both windows or neither
PASS  [G3] a funder is taken by a conditional update, never by expiry alone
PASS  [D6] the funder is drawn at random rather than in sequence
PASS  [G3] renew and release both require the lease token
PASS  [G6] release advances the nonce and never rewinds it
PASS  [G6] reconciliation can move the nonce down, which release cannot
PASS  [G6] the run lock is taken in one statement guarded by its own expiry
PASS  [G6] a lock is released only by the run that took it
PASS  [G4] the run sequence advances once per run, from a sequence
PASS  [I9] a wallet index comes from a sequence, never from a count or a max
PASS  [C5] the live phone binding is unique platform-wide
PASS  [C6] a participant holds at most one live number
PASS  [C5 C6] binding refuses a number that belongs to somebody else
PASS  [C6] a released number cools down before it can be rebound
PASS  [C6] a change of number blocks the account in the campaigns it was active in
PASS  [C5] one entry per campaign and number, enforced by a unique index
PASS  [G5] binding and verifying are one call, so a number cannot be spent on nothing
PASS  [K6] no uniqueness collision leaves the binding as an exception
PASS  [G5] a link is bound and consumed by predicate, so a retry cannot double it
PASS  [R4] the link code is matched by a chat HMAC, never by a chat id
PASS  [C5 R4] nothing in the schema holds a number or a Telegram id in clear
PASS  [I5] row level security is enabled on every table the migration creates
PASS  [I5] no policy exists, so anon and authenticated reach nothing
PASS  [I5] anon and authenticated are revoked on every table
PASS  [I5] a grant on a table is only a verb the code uses
PASS  [I5 D7] nothing that must not be deleted carries a DELETE grant
PASS  [I5] a sequence is granted USAGE and never UPDATE
PASS  [I5] EXECUTE is revoked from PUBLIC before it is granted to anyone
PASS  [I5] every function 0005 defines is granted to the one role that calls it
PASS  [I5] no function is granted that 0005 does not define
PASS  [I5] every function runs as the caller, not as the owner
PASS  [I4] no function builds SQL out of a value a caller supplies
PASS  [I6] every object the migration creates is under the bridge prefix
PASS  [I7] the one-credential design is declared where a reader looks for it
PASS  [I8] every entry state the schema declares is written by a code path
PASS  [I8] every state a run can leave behind is also read by a query
PASS  [I9] a participant row cannot exist holding a placeholder address
PASS  [I9] an entry address carries the same format constraint
PASS  [I2] a campaign id is stored as an exact decimal, not as a float
PASS  [I2] every function that returns a campaign id casts it to text
PASS  [I10 K7 D7] every ephemeral table has a retention path
PASS  [D7 I10] the retention pass never touches the participation record
PASS  [B4] a penalty row is removed only once it means nothing
PASS  [C8 G4] the campaign queue returns one row per campaign, oldest waiting first
PASS  [H7] the sweep queue is funded-and-not-swept, with no status in it
PASS  [H7] a database that already holds entries gets its funded wallets back
PASS  [E3 OWNER-D2] custody carries the columns the prize path needs to resume
PASS  [E3] the prize queue index excludes what can no longer receive a prize
PASS  [F2] no migration contains anything shaped like a secret

=== engine ===
PASS  [I5 I6] 0004, 0005 and 0006 apply in order to an empty target-shaped database
PASS  [I6] applying the three again changes nothing and raises nothing
PASS  [I6] 0004 installs citext itself when the project does not already carry it
PASS  [I6] the V2 migrations do not depend on the V1 ones applying first
PASS  [I5] every function runs as its caller and resolves citext through both schemas
PASS  [B1 B2 B3 G1] rate_limit_hit allows up to the ceiling and denies past it
PASS  [B4] a request refused by a live penalty does not also spend a window slot
PASS  [B4] the penalty outlives the window boundary and grows across it
PASS  [B4] the penalty is capped at an hour however many strikes there are
PASS  [B4] a strike older than the decay window starts the count again at one
PASS  [J4 G1] claim_email_code_attempt spends one attempt and hands back the stored hash
PASS  [J4 C1] the email is matched case-insensitively, as a citext column
PASS  [J3] an expired or consumed code cannot be attempted
PASS  [G2 G5] consume_email_code reports whether it changed a row
PASS  [J3] supersede_email_codes ends every live code for the address
FALHA [J3 J4] the attempt ceiling belongs to the address, not to one code
      AssertionError [ERR_ASSERTION]: ACHADO 0005:145-171. J3 says only the most recent unconsumed code for an address is valid, and J4 caps the guesses. The predicate `attempts < p_max_attempts` inside `ORDER BY created_at DESC LIMIT 1` removes the exhausted newest code from the candidate set instead of ending the attempt, so the previous live code becomes attemptable: the engine handed out 6 guesses across 2 codes for a ceiling of three. The ceiling is per code, not per address.
      + actual - expected
      
        [
          'HASH-NEWER',
      +   'HASH-OLDER'
PASS  [G5 I2] claim_link_for_chat binds the chat and returns the campaign id exactly
PASS  [G5] a second start from one chat detaches the first link instead of raising
PASS  [G5] consume_link_for_chat consumes once, and an expired link not at all
PASS  [C5 C6] bind_phone_and_verify binds the number and verifies the entry
PASS  [C5] a number live for one account is refused to another
PASS  [C6] a change of number releases the old one and fails the account live entries
PASS  [C6] a released number is held out of circulation until its cooldown ends
PASS  [C5] one entry per campaign and number, reported rather than raised
FALHA [G5 C5 C6] a bind that does not verify does not spend the number either
      AssertionError [ERR_ASSERTION]: ACHADO 0005:377-386 against 0005:293-297. The function exists because the two-call version left "the number spent, the participation lost, and no way back because the number is now in use". The INSERT INTO bridge_v2_phones sits in its own BEGIN/EXCEPTION block, which commits into the outer transaction; the entry lookup that can return NO_ENTRY (0005:388-394) and the UPDATE that can return DUPLICATE (0005:396-410) both come after it, and neither undoes it. The engine left the number bound to an account with no verified entry in both cases: NO_ENTRY bound 1 live row(s), DUPLICATE bound 1 live row(s) while the entry stayed AWAITING_CONTACT. C5 makes that number unusable platform-wide from then on.
      + actual - expected
      
        {
      +   duplicate: 1,
      -   duplicate: 0,
PASS  [G3 D6] acquire_funder takes a free funder and hands out a lease token
PASS  [G3] a leased funder is not handed out again until its lease has expired
PASS  [G3] renew and release both require the lease token
PASS  [G6] release advances the nonce and never rewinds it
PASS  [G6] reconciliation moves the nonce in either direction, for the lease holder only
PASS  [H8] a disabled funder leaves the rotation and cannot be disabled twice
PASS  [B8] claim_spend moves both windows, or neither
PASS  [G3 G6] try_lock gives one holder, and nothing to the next run
PASS  [G3] an expired lock is taken by the next run, and the old holder cannot release it
PASS  [G4] the run sequence advances by one per run
PASS  [I9] the wallet index is reserved from a sequence, starting at zero
PASS  [I9] a participant row cannot exist holding a placeholder address
PASS  [C8 G4 I2] campaigns_with_verified gives one row per campaign, longest waiting first
PASS  [I10 K7 D7] cleanup empties every ephemeral table and reports what it removed
PASS  [B3 G1] eight concurrent rate limit calls count eight, not one
FALHA [B4 B3 G1] concurrent strikes against a new key each count
      AssertionError [ERR_ASSERTION]: ACHADO 0005:75-83. The file states: "The standing penalty is read first and under a row lock, so two concurrent callers cannot both observe the pre-strike value and both write strike n+1." SELECT ... FOR UPDATE locks nothing when no row matches, and the upsert at 0005:114-119 writes `strikes = v_strikes` from the local read rather than from the stored value, so the first burst against an unseen (axis, key) is a lost update: eight concurrent denials recorded 1 strike(s) instead of 8. Once the row exists the lock does hold (8 of 8). B4's escalation therefore starts one step late for exactly the burst it exists to punish.
      + actual - expected
      
        {
      +   firstBurst: 1,
      -   firstBurst: 8,
PASS  [J4 G1] eight concurrent guesses spend one attempt each
PASS  [G2 G5] four concurrent consumptions of one code: exactly one wins
PASS  [G3] concurrent acquisitions never hand the same funder to two runs
PASS  [G3] four concurrent runs against one free funder: exactly one gets it
PASS  [G6] eight concurrent runs take one lock between them
PASS  [C5] two accounts presenting one number at once: one binds, one is told it is taken
PASS  [G5] four concurrent deliveries of one contact consume the link once
PASS  [B8] ten concurrent claims against a ceiling of five let exactly five through
PASS  [I9 G4] concurrent draws on the two sequences never repeat a number
FALHA [J3 J4] two issues of a code at once leave one live code, not two
      AssertionError [ERR_ASSERTION]: ACHADO lib/bridge-v2/codes.ts:47-61 against J3. Superseding in one statement and inserting in another does not exclude the interleaving supersede(A), supersede(B), insert(A), insert(B): both supersedes find nothing to end and both inserts land. The engine left 2 live codes for one address, which doubles the J4 attempt ceiling and makes the older code attemptable once the newer is exhausted.
      
      2 !== 1
      
          at file:///C:/Users/User/Documents/INSTANT-WIN-Raffle-v2.1/test/bridge-v2/suites/engine.test.mjs:938:10
          at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
PASS  [I5] RLS is on for every bridge table, with no policy anywhere
PASS  [I5] a role without BYPASSRLS reads nothing and writes nothing, on every table
PASS  [I5] anon reaches no table and no function at all
PASS  [I5] service_role carries BYPASSRLS through SET ROLE and sees the rows
PASS  [I5] after 0006 only service_role can execute a bridge function
PASS  [I5] anon and authenticated hold no privilege on any bridge table
PASS  [I5 D7] on a project without Supabase default privileges, 0006 grants exactly what it lists
FALHA [I5 I9] 0006 revokes tables and functions from anon and authenticated, and sequences too
      AssertionError [ERR_ASSERTION]: ACHADO 0006:143-150 against 0006:225-241. The file revokes every table and every function from anon and authenticated, and for the sequences writes only "GRANT USAGE ... TO service_role" - a GRANT adds, it never removes what Supabase ALTER DEFAULT PRIVILEGES already gave. The engine, shaped like a Supabase project, left these standing: anon on bridge_v2_ops_events_id_seq: usage=true update=true; authenticated on bridge_v2_ops_events_id_seq: usage=true update=true; anon on bridge_v2_run_seq: usage=true update=true; authenticated on bridge_v2_run_seq: usage=true update=true; anon on bridge_v2_wallet_index_seq: usage=true update=true; authenticated on bridge_v2_wallet_index_seq: usage=true update=true. As anon: nextval succeeded, setval succeeded. The comment at 0006:137-141 says "USAGE, never UPDATE ... rewinding the wallet sequence would reassign an index that is already somebody wallet"; that is the one thing anon can do here.
      + actual - expected
      
      + [
      +   'anon on bridge_v2_ops_events_id_seq: usage=true update=true',
      +   'authenticated on bridge_v2_ops_events_id_seq: usage=true update=true',
FALHA [I5 D7] 0006 withholds a verb from service_role rather than only failing to grant it
      AssertionError [ERR_ASSERTION]: ACHADO 0006:60-140. Each grant in 0006 names the call site that needs it, and the omissions are argued in prose: "No DELETE: an entry is the participation record", "No UPDATE: the bridge appends to the record of what it did and never rewrites a line of it", "USAGE, never UPDATE". None of that is enforced, because the file only ever GRANTs and Supabase ALTER DEFAULT PRIVILEGES has already granted ALL to service_role on everything the migration creates. The engine allowed: DELETE on bridge_v2_entries; DELETE on bridge_v2_participants; UPDATE on bridge_v2_ops_events; UPDATE on bridge_v2_eligibility_roots; setval on bridge_v2_wallet_index_seq.
      + actual - expected
      
      + [
      +   'DELETE on bridge_v2_entries',
      +   'DELETE on bridge_v2_participants',
PASS  the engine is a PostgreSQL of the target major version
PASS  citext resolves from the extensions schema, which is where the target keeps it

=== source ===
PASS  [A6 D1] no route outside the two session routes reads an email from a body
PASS  [A6] no route takes a participant id or a wallet address from a body
PASS  [A1 D1] every route that returns participant state resolves a session first
PASS  [D1] every read of a participant row is filtered by the session participant
PASS  [D4] no route reads anything personal out of a URL
PASS  [D4] every route that carries data is a POST
PASS  [B1] every participant-facing route enforces a rate limit
PASS  [B1] the read-only routes are limited as well as the writing ones
PASS  [B2] every route carries the global axis as well as its own
PASS  [F2] no file in the repository carries anything shaped like a live secret
PASS  [F2] no .env file is tracked in the repository
PASS  [F4] no module holds key material in module scope
PASS  [F6] no module returns an object that holds a private key
PASS  [F7] the funder keys and the participant seed are never read together
PASS  [F1] each root is read by the module whose job it is, and by no other
PASS  [G2] no database result is used without going through the checked helpers
PASS  [G4] every database call in the codebase carries an abort signal
PASS  [G4] every outbound fetch in the codebase carries an abort signal
PASS  [G4] the receipt wait is bounded and there is only one of it
PASS  [K6] every route body runs inside the envelope
PASS  [H1] no contract address in the bridge comes from input
PASS  [H1] every functionName the bridge signs is a literal
PASS  [H2] the destination of a funding is always a server-derived address
PASS  [H2 E4] a prize delivery goes only to an address the participant confirmed
PASS  [K1] a lockfile is committed and carries integrity hashes
PASS  [K2] the modules that touch key material import no package but viem
PASS  [K2] the email and Telegram clients are one fetch each, not an SDK
PASS  [K3] no public high-volume route imports a module that signs
PASS  [K4] the log detail type cannot carry an arbitrary object
PASS  [K4] no log call passes a value that could be an email, a number or a code
PASS  [K4] no console call in the bridge prints a value
PASS  [K4] the rate limiter hashes its key before anything is stored
PASS  [R1] nothing in the bridge builds a Mini App, a Web App, or a link to one
PASS  [R1] the only keyboard the bot builds carries request_contact
PASS  [R1] the deep link the page opens is a plain t.me start link
PASS  [R3] the bot name is configuration, not a name written into the code
PASS  [R5] the bot token is read from the environment at the moment of the call
PASS  [B6 C3 C4] no SMS provider, and no line-type lookup, exists anywhere
PASS  [J2] the code hash is bound to the address it was issued for
FALHA [J2] the code hash is bound to the campaign as well as the address
      AssertionError [ERR_ASSERTION]: the code hash carries no campaign, so a code issued in one campaign verifies in another
          at file:///C:/Users/User/Documents/INSTANT-WIN-Raffle-v2.1/test/bridge-v2/suites/source.test.mjs:604:10
          at test (file:///C:/Users/User/Documents/INSTANT-WIN-Raffle-v2.1/test/bridge-v2/harness.mjs:146:11)
          at file:///C:/Users/User/Documents/INSTANT-WIN-Raffle-v2.1/test/bridge-v2/suites/source.test.mjs:600:7
PASS  [J6] the code is in the body of the mail and never in its subject
PASS  [J7] the sender is configured, and is not the shared provider address
PASS  [C9] the limits of the anti-sybil layers are written down, not implied
PASS  [E5] no off-ramp guidance and no provider name is built into the bridge
PASS  [F5] each root is one variable, read at use, so rotation is a deployment

=== routes ===
PASS  [D2] a code request answers identically for a known and an unknown address
PASS  [D2 C2] a disposable domain and a missing MX record answer the same
PASS  [D2 B5] an address over its own limit is refused silently, not with a 429
PASS  [B5] an unknown address is counted on a different axis from a known one
PASS  [B2] a caller over an axis about themselves does get a 429
PASS  [B8] the mail budget is claimed before the provider is called
PASS  [C1 J6] the code is keyed on the canonical address and sent to the literal one
PASS  [J2 F2] the plaintext code is never stored and never returned
PASS  [I1] a malformed address is a 400 and reaches nothing
PASS  [I3] a request with the wrong content type is a 400
PASS  [D2 J4] a wrong code and a code that never existed answer the same
PASS  [J4 G1] the attempt is claimed in the database before anything is compared
PASS  [A1 A2 A3] a correct code issues a session in a cookie and nothing else
PASS  [G2] a code consumed by somebody else between compare and consume is refused
PASS  [A1 A6] every stateful route answers 401 with no cookie
PASS  [A1 A4] every stateful route answers 401 with an expired cookie
PASS  [B1] every stateful route is rate limited before it does any work
PASS  [D1] entry status is scoped to the session participant and to nobody else
PASS  [D1 D7] entry status returns the caller own address, hash and custody
PASS  [I2] a campaign id past uint256 is a 400, never a 500
PASS  [H5 H6] a campaign past its effective end hands out no link
PASS  [B7 H6] a campaign with no slots left hands out no link
PASS  [R1] the link is a plain t.me start link and nothing else
PASS  [G5] the link code is stored hashed and the plaintext appears once
PASS  [E2 OWNER-D1] the custody rule is recorded at entry time from the campaign
PASS  [E2] an NFT campaign records the own-wallet rule whatever it declares
PASS  [G5] an entry already moving is not re-issued a link
PASS  [E4] proposing a destination stores it unconfirmed and echoes it back
PASS  [E4] confirming names the address again, and a different one is refused
PASS  [I1] a destination that is not an address is a 400
PASS  [D7] the export returns what is held and says what is not
PASS  [A5 C6 D7] erasure releases the number, tombstones the address and revokes
PASS  [A5] revoke clears the cookie whether or not there was a session
PASS  [A1] an update without the right secret is refused and does nothing
PASS  [A1] an update with no secret header at all is refused
PASS  [R1 R4] a start with a code asks for the contact and stores no chat id
PASS  [B8] the Telegram budget is claimed before the link is touched
PASS  [C5] a forwarded contact card is refused
PASS  [C5 K4] the number reaches the database only as a hash
PASS  [B2] the number is its own axis, and a denial does not burn the code
PASS  [B2] the webhook has no IP axis, which would count Telegram as one caller
PASS  [K6] a failure inside the webhook is acknowledged, not retried for ever
PASS  [C5 C6] every binding outcome answers 200 with its own message
PASS  [G5] a null binding outcome is treated as a refusal, never as a success
PASS  [R2] no message the webhook actually sends mentions crypto or a prize
PASS  [K8] a cron with no credential is refused
PASS  [K8] a cron with a wrong credential is refused
PASS  [J5] the cron secret is compared in constant time
PASS  [K8] a cron checks its configuration before it checks the caller
PASS  [G6] a run that finds the lock held does nothing and says so
PASS  [G6] the pipeline lock is released with the holder it was taken with
PASS  [G4] the pipeline runs every phase and reports which one led
PASS  [G4] the leading phase advances by one per run that actually happens
PASS  [H8 K8] maintenance reports a check that could not run as unknown
PASS  [H8] one failing check does not stop the ones behind it
PASS  [H8] a bridge address the contract no longer names raises an alert
PASS  [H8] a paused contract and a low VRF balance are both alerted
PASS  [H8] a funder that cannot pay for one entry is counted and alerted
PASS  [B8 H8] a provider approaching its daily ceiling is alerted before it stops
PASS  [K8] a route erroring repeatedly in the last hour is alerted
PASS  [G6 H7] the sweep borrows the pipeline lock and is skipped when it is held

=== processor ===
PASS  [C8] a published root records the index the contract assigned, not a guess
PASS  [C8 G2] a publication that never confirms writes nothing at all
PASS  [C8] a mined publication with no event invents no index
PASS  [C8] a reverted publication writes nothing
PASS  [H5 H6] a campaign past its entry window fails its batch instead of publishing
PASS  [B7 H6] a campaign with no slots left fails its batch rather than waiting for ever
PASS  [H6] only as many entries as there are slots are admitted to the root
PASS  [G4] one campaign that throws does not end the publication stage
PASS  [G4] the publication stage starts nothing when the budget is gone
PASS  [G5] an address the contract already has is confirmed without spending anything
PASS  [H5 H6] an entry into a closed campaign is failed before any gas moves
PASS  [H6] an entry into a full campaign is failed before any gas moves
PASS  [C8] an entry whose proof cannot be rebuilt is failed, not retried for ever
PASS  [C8] a leaf set that does not rebuild the stored root is refused
PASS  [H7] the funding mark is written in the same statement as the claim
PASS  [G5] a claim another run already took ends this attempt silently
PASS  [B8] a refused gas budget returns the entry to the queue rather than holding it
PASS  [H8] an empty funder pool returns the entry and raises an alert
PASS  [G3] the lease is renewed between the funding and the entry
PASS  [G3] a lease lost mid-operation stops the entry rather than signing on
PASS  [G6] the nonce advances on release even when the entry failed
PASS  [G6] a funding that sent nothing does not advance the nonce
PASS  [G6 H8] a funder whose lease cannot be released is taken out of rotation
PASS  [G6] the stored nonce is corrected against the account before it is used
PASS  [G6] a dropped transaction lets the nonce come back down
PASS  [G6] a stored nonce inside what the account has committed to is left alone
PASS  [G6] a refused nonce correction leaves the stored value alone
PASS  [G4 G6] an RPC that cannot answer leaves the nonce as it stands
PASS  [K3 G2] the transaction hash is written before the wait, and checked
PASS  [G2] a failed write of the hash ends the entry instead of losing the transaction
PASS  [H3] a gas cost above the ceiling refuses the entry and alerts
PASS  [G4] a funding that is never mined returns the entry to the queue
PASS  [G4] one entry that throws does not end the funding stage
PASS  [G4] an entry that threw is moved to the back of the queue
PASS  [G4] no entry is started once the budget is gone
PASS  [I8] an entry abandoned in FUNDING is brought back by the chain answer
PASS  [I8] the FUNDING sweep only looks at rows older than a run can live
PASS  [K3] a submitted entry the contract has is confirmed without a second look
PASS  [I8] a transaction the node has never heard of is treated as dropped
PASS  [I8] a transaction still in the mempool is left alone but moved down the queue
PASS  [I8] a mined and reverted entry goes back for a fresh quote
PASS  [I8] a SUBMITTED entry with no hash recorded goes back to the queue
PASS  [H7] the sweep queue is every funded wallet, whatever its entry ended as
PASS  [H7] a wallet is marked whether or not the sweep was worth making
PASS  [H7] a sweep that could not be made is touched, never marked done
PASS  [D6] the sweep destination is drawn from the pool, not fixed on one funder
PASS  [H7] a wallet with no derivation index is marked rather than retried for ever
PASS  [E1 E2] a prize that needs the winner own wallet is not claimed without one
PASS  [E2 OWNER-D1] the rule is recomputed from claimable before anything moves
PASS  [E3] temporary custody starts when the claim is mined, not at entry
PASS  [E2] a prize that must go to the winner own wallet gets no custody clock
PASS  [E4 H2] delivery goes to the confirmed destination and marks the prize gone
PASS  [E4] a destination proposed but not confirmed does not count
PASS  [OWNER-D2] an expired custody with no destination alerts exactly once
PASS  [OWNER-D2] a custody already alerted on is not alerted again
PASS  [OWNER-D2] nothing automatic happens to an expired custody
PASS  [E3] an entrant who did not win leaves the prize queue for good
PASS  [E3] a claim window that has closed takes the row out of the queue
PASS  [G5] a claim the chain already has is recorded rather than made again
PASS  [G5] a delivery with nothing left to send is marked done, not sent twice
PASS  [G4] a delivery that is never mined is not marked delivered
PASS  [H7] a prize funding puts the wallet back in the sweep queue
PASS  [G4] a campaign that has not settled is left where it is
PASS  [G4] one prize that throws does not end the prize stage
PASS  [G4] no prize is started once the budget is gone
PASS  [G2 G4] a database outage ends each stage without signing anything
PASS  [G4] an RPC outage ends each stage without a state change

=== contracts ===
PASS  [H1] every manager entry the bridge carries exists in the compiled artifact
PASS  [H1] the campaign tuple matches the deployed struct field for field
PASS  [H1] every prize module entry the bridge carries exists in its artifact
PASS  [K5] every error the bridge decodes is an error the manager can raise
PASS  [C8] the leaf the bridge builds is the leaf the contract computes
PASS  [C8] the contract verifies against a root it holds by index, append only
PASS  [H1] the bridge signs six shapes and each carries the selector it claims
PASS  [H1] every selector matches the one the deployed artifact defines
PASS  [H1] the three delivery encodings are the three the standards define
PASS  [H1 F6] a signed transaction is on Arbitrum One and recovers to the wallet
PASS  [H2] the funding and the sweep carry a value and no calldata
PASS  [C8] a proof the bridge builds is the argument shape enter() declares
PASS  [H1] Arbitrum One answers, so the on-chain checks below actually ran
PASS  [H1] the manager views decode against the deployed bytecode
PASS  [H8] the VRF subscription the contract names is readable through it
PASS  [H6] the slot and entry views answer for a campaign id
PASS  [E2] the campaign tuple decodes into the fields the bridge reads
PASS  [E2] the three deployed prize modules are told apart by ERC-165
PASS  [E2] no module answers both item interfaces, so a delivery is never ambiguous
PASS  [H4] a real estimate for a value transfer falls inside the transfer band
PASS  [H3 H4] a real fee quote produces a plan under the absolute ceiling

=== requirement map ===
A1          8 testes  ok
A2          4 testes  ok
A3          2 testes  ok
A4          4 testes  ok
A5          4 testes  ok
A6          4 testes  ok
B1          4 testes  ok
B2          7 testes  ok
B3          5 testes  FALHA(1)
B4          9 testes  FALHA(1)
B5          2 testes  ok
B6          1 testes  ok
B7          2 testes  ok
B8          7 testes  ok
C1          5 testes  ok
C2          5 testes  ok
C3          1 testes  ok
C4          1 testes  ok
C5         13 testes  FALHA(1)
C6         10 testes  FALHA(1)
C7          3 testes  ok
C8         19 testes  ok
C9          1 testes  ok
D1          6 testes  ok
D2          5 testes  ok
D3          1 testes  ok
D4          2 testes  ok
D5          2 testes  ok
D6          3 testes  ok
D7          9 testes  FALHA(1)
E1          2 testes  ok
E2         13 testes  ok
E3          6 testes  ok
E4          5 testes  ok
E5          1 testes  ok
F1          5 testes  ok
F2          5 testes  ok
F3          3 testes  ok
F4          1 testes  ok
F5          1 testes  ok
F6          5 testes  ok
F7          1 testes  ok
G1          9 testes  FALHA(1)
G2          9 testes  ok
G3         11 testes  ok
G4         31 testes  ok
G5         16 testes  FALHA(1)
G6         19 testes  ok
H1         15 testes  ok
H2          5 testes  ok
H3          4 testes  ok
H4          4 testes  ok
H5          3 testes  ok
H6          8 testes  ok
H7          9 testes  ok
H8         10 testes  ok
I1         10 testes  ok
I2          6 testes  ok
I3          4 testes  ok
I4          1 testes  ok
I5         21 testes  FALHA(2)
I6          5 testes  ok
I7          1 testes  ok
I8          8 testes  ok
I9          8 testes  FALHA(1)
I10         3 testes  ok
J1          4 testes  ok
J2          3 testes  FALHA(1)
J3          6 testes  FALHA(2)
J4          8 testes  FALHA(2)
J5          2 testes  ok
J6          2 testes  ok
J7          1 testes  ok
K1          1 testes  ok
K2          2 testes  ok
K3          3 testes  ok
K4          7 testes  ok
K5          6 testes  ok
K6          4 testes  ok
K7          2 testes  ok
K8          8 testes  ok
R1          5 testes  ok
R2          2 testes  ok
R3          2 testes  ok
R4          3 testes  ok
R5          1 testes  ok
OWNER-D1    4 testes  ok
OWNER-D2    4 testes  ok

=== resumo ===
testes:     403  (passaram 396, falharam 7)
requisitos: 88  (sem teste: 0)
```
