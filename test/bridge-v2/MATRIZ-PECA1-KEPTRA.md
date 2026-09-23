# Matriz da peça 1 — contas com passkey e recuperação: o lote antes do deploy

Spec: `SPEC-BLOCO-03-KEPTRA-v1.0.md` (repositório `instant-win-audit/v2`), linha 3: **Versão 1.31 — 23/09/2026** — a versão em vigor, com a **Adenda AA** e a **Adenda AB**.
Cobre o que a **AA4** lista para a peça 1 e para o módulo 2: **P1-1 a P1-11** (G3 e P26) e **D-B5 e D-FUNDING** (B5, E7 e G3). O D-0007 saiu (AA3). Pela **Adenda AB**, cobre também a **AB6** (B4) e a **AB7** (secção 5).

Onde vive: por decisão do owner nesta sessão (pergunta 1 abaixo), a matriz da peça 1 para este lote fica neste repositório, como a AA1 fez com a da peça 4. A matriz da Fase A (`MATRIZ-PECA1-KEPTRA.md` em `instant-win-audit/v2`, M1 a M46 e Adendas A a F) não foi alterada; as linhas M1–M46 continuam lá, e as etiquetas KMn da suite continuam a apontar para ela.

Código: este repositório, ramo `feat/keptra-frontend`. Peça 1 fechada em `f35ca31` (G2); este lote vem nos commits da AA4 sobre `81f08ce`.

**Nomes.** Os pendentes mantêm o nome que a spec lhes dá (`P1-n`, `D-B5`, `D-FUNDING`), e é esse o nome da etiqueta nos testes. O mapa de requisitos de `test/bridge-v2/run.mjs` conta-os.

**Suites.**
- **`keptra`** (`test/bridge-v2/suites/keptra.test.mjs`): a cadeia em duplo, a base em memória, e as migrations 0012 e 0015 no Postgres embebido.
- **`fork`** (`test/bridge-v2/fork/keptra.fork.mjs`): um fork local de Arbitrum One com a USDC, a Safe e o GiveawayManagerV2 reais.

## 0. Perguntas feitas ao owner nesta sessão (23/09)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | A definição de feito pede a matriz da peça 1 na versão 1.30, e ela vive em `instant-win-audit/v2`, que esta sessão não pode alterar. | Nova neste repositório (`test/bridge-v2/MATRIZ-PECA1-KEPTRA.md`); a de `instant-win-audit` fica intocada. |
| 2 | P1-11: o que o apagamento faz a cada tabela da 0012. | Apaga as passkeys e o histórico de recuperações (com os avisos); as contas, as migrações e as contagens da relay ficam; recusado enquanto houver uma recuperação viva; migration 0015 com DELETE nessas três tabelas. |
| 3 | P1-4: que chaves contam como "da plataforma", quando o teste da F1 reconhecia uma conta com o guardião antigo de uma rotação. | Só a chave actual (`BRIDGE_V2_GUARDIAN_KEY`). O teste da F1 muda só nessa parte; a R-3 continua a nomear o guardião on-chain. |

## 1. Pendentes da peça 1 (G3, P26)

| # | Pendente | Onde está | Teste | Resultado |
|---|---|---|---|---|
| P1-1 | Uma carteira só é selada depois de o último sweep estar confirmado on-chain | `lib/bridge-v2/migration.ts:320` (espera o recibo; sem ele, não sela e a passagem seguinte repete); `lib/bridge-v2/config.ts:499` (`MIGRATION_SEAL_MS` com o recibo) | `keptra`: "P1-1: a migrated wallet is sealed only once its last sweep is mined…" (`test/bridge-v2/suites/keptra.test.mjs:2691`) | passa |
| P1-2 | Todos os rascunhos elegíveis expiram, qualquer que seja o número à frente | `lib/bridge-v2/creatorCampaigns.ts:312` (lê por ordem de toque, página a página, até uma página só com rascunhos já vistos), `:363` (o rascunho visto e deixado vivo vai para o fim) | `keptra`: "P1-2: every eligible draft expires, however many are ahead of it…" (`test/bridge-v2/suites/keptra.test.mjs:2715`) | passa |
| P1-3 | Um saldo anterior ao rascunho não é depósito dele; sem depósito próprio, expira | `api/bridge/v2/creator/campaign/start.ts:133` (grava a base com o rascunho); `lib/bridge-v2/creatorCampaigns.ts:351` (conta só o que está acima da base); `supabase/migrations/0015_keptra_lote.sql:26` | `keptra`: "P1-3: a balance the deposit address already had…" (`test/bridge-v2/suites/keptra.test.mjs:2744`); "0015: a draft keeps its deposit baseline…" (`:3354`) | passam |
| P1-4 | O reconhecimento (E3) e o alerta R-4 confirmam que o guardião on-chain é a chave de guardião da plataforma | `lib/bridge-v2/relay.ts:420` (`compositionRefusal` compara com `guardianAddress()`, a chave actual, pergunta 3) | `keptra`: "P1-4: the R-4 check after an account is created alerts…" (`test/bridge-v2/suites/keptra.test.mjs:2783`); "F1: R-3 names the guardian the account holds on-chain…; P1-4…" (`:1984`) | passam |
| P1-5 | As reservas da manutenção cobrem as leituras da F3 | `lib/bridge-v2/config.ts:507` (`RIGHT_READ_MS`, no mapa das reservas); `lib/bridge-v2/migration.ts:160` e `:190` (cada direito reserva o seu tempo; cortado, a contagem é nula), `:336` (não sela) e `:417` (a prontidão fica incompleta) | `keptra`: "P1-5: the rights Adenda F3 reads from the chain are reserved one by one…" (`test/bridge-v2/suites/keptra.test.mjs:2812`) | passa |
| P1-6 | Um rascunho que deixou de estar em PENDING_DEPOSIT nunca é submetido | `lib/bridge-v2/creatorCampaigns.ts:257` (`startSubmission`, uma transição condicional ao estado lido e sem transacção); `api/bridge/v2/creator/campaign/submit.ts:126` (relido sob o lock); `lib/bridge-v2/relay.ts:1169` | `keptra`: "P1-6: a draft that left PENDING_DEPOSIT is never submitted…" (`test/bridge-v2/suites/keptra.test.mjs:2832`) | passa |
| P1-7 | Uma resposta de falta de tempo não consome unidades do tecto de gasto | `api/bridge/v2/creator/campaign/submit.ts:163` (cada chamada reclama a sua unidade só depois de ter o tempo) | `keptra`: "P1-7: a "try again" for lack of time claims nothing…" (`test/bridge-v2/suites/keptra.test.mjs:2873`) | passa |
| P1-8 | O comentário do passo do submit coincide com o valor declarado | `lib/bridge-v2/config.ts:794` (216_000, o `CREATOR_SUBMIT_UNIT_MS`; antes dizia 184_000 contra 200_000) e `:341`; os outros números do mesmo comentário também conferidos | `keptra`: "P1-8: the numbers config.ts’s comment gives for the reservations are the ones it declares…" (`test/bridge-v2/suites/keptra.test.mjs:2906`) | passa |
| P1-9 | Os testes KM34 do criador e AF2 da migração demonstram o que o título diz | `test/bridge-v2/fork/keptra.fork.mjs:1853` (o depósito fica com o rascunho vivo, move-se para a conta de criador quando ele sai, a chave e a semente ficam); `test/bridge-v2/suites/keptra.test.mjs:2052` (o que se move é o USDC inteiro, para a conta de criador) | os próprios testes, na suite completa | passam |
| P1-10 | Os avisos de recuperação reclamam o tecto de gasto | `lib/bridge-v2/recovery.ts:270` (email) e `:279` (Telegram); `lib/bridge-v2/config.ts` (`RECOVERY_ADVANCE_MS` com as duas reclamações) | `keptra`: "P1-10: each recovery notice claims its unit…" (`test/bridge-v2/suites/keptra.test.mjs:2936`) | passa |
| P1-11 | O apagamento e a exportação cobrem as tabelas da 0012 | `lib/bridge-v2/accounts.ts:1047` (exportação) e `:1176` (apagamento); `api/bridge/v2/privacy/export.ts:71`; `api/bridge/v2/privacy/erase.ts:109` (recusa com recuperação viva); `supabase/migrations/0015_keptra_lote.sql:39` (DELETE) | `keptra`: "P1-11: the export returns what 0012 holds…" (`test/bridge-v2/suites/keptra.test.mjs:2953`); "0015: … the statements eraseAccountData sends…" (`:3354`) | passam |

## 2. Defeitos do módulo 2 (B5, E7, G3)

| # | Defeito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| D-B5 | O submit derivado aprovava só USDC para a taxa; a taxa é cobrada no token do prémio | `api/bridge/v2/creator/campaign/submit.ts:144` (prémio ao módulo; taxa no token do prémio e slots em USDC ao núcleo; um só, para um prémio USDC) | `keptra`: "D-B5 (B5): module 2’s submit pays the fee in the prize token…" (`test/bridge-v2/suites/keptra.test.mjs:2996`) | passa |
| D-FUNDING | Campanha do submit derivado presa em FUNDING | `api/bridge/v2/creator/campaign/submit.ts:191` (o hash no rascunho antes da espera) e `:109` (um segundo envio é recusado); `lib/bridge-v2/relay.ts:1325` e `:1336` (a manutenção liquida pela cadeia, sob o lock do criador) | `keptra`: "D-FUNDING (E7): module 2’s submit writes the createGiveaway hash…" (`test/bridge-v2/suites/keptra.test.mjs:3026`); "E7: the pass settles each relay campaign…" | passam |

## 3. O que muda para o owner antes do deploy

- Aplicar também a migration `0015_keptra_lote.sql`, depois da 0012, 0013 e 0014 (actualiza a Q6 e a U7).
- `vercel.json`: `creator/campaign/start` passa a 214 s e `privacy/erase` a 282 s (F7, recontados).

## 4. Como correr

- `npx tsc --noEmit`
- `ANVIL_BIN=<caminho do anvil.exe> npm run test:bridge-v2`

## 5. Adenda AB — AB6 e AB7 (23/09)

A etiqueta é o nome da decisão (`AB6`, `AB7`). As duas correm também no fork: a AB6 com a USDC de Arbitrum One, a AB7 contra o escrow de 5d85a46 (`test/bridge-v2/fork/orders.fork.mjs`).

| # | Decisão | Onde está | Teste | Resultado |
|---|---|---|---|---|
| AB6 | B4: um depósito real para um rascunho conta sempre, mesmo que o saldo do endereço de depósito tenha descido depois de o rascunho ser criado | `api/bridge/v2/creator/campaign/start.ts:136` (o bloco lido com os saldos, gravado com o rascunho); `lib/bridge-v2/creatorCampaigns.ts:374` (sem saldo acima da base, lê as transferências para o endereço desde esse bloco; lida em parte, o rascunho fica e a passagem seguinte continua de onde parou, `:398`); `lib/bridge-v2/chain.ts:1557` (`transferInto`); `lib/bridge-v2/config.ts:576` e `:578`; `supabase/migrations/0015_keptra_lote.sql:117` | `keptra`: "AB6 (B4): a real deposit for a draft counts…" (`test/bridge-v2/suites/keptra.test.mjs:3338`); "0015 for AB5 and AB6…" (`:3527`), no Postgres embebido; `fork-orders`: "AB6 on the fork, with Arbitrum One’s USDC…" (`test/bridge-v2/fork/orders.fork.mjs:603`) | passam |
| AB7 | Depois de uma rotação da chave de guardião (B6), uma conta com o guardião antigo continua a poder ser reconfigurada pela R-3 e usada pelo dono | `lib/bridge-v2/keptra.ts:636` (`rotatedAwayGuardian`); `lib/bridge-v2/relay.ts:668` (configure = R-3 sobre a chave antiga e a actual acrescentada, numa só transacção), `:1012` (só essas duas chaves podem ser nomeadas), `:1032` (a conta não está "já configurada"); `lib/bridge-v2/keptra.ts:726` (`refusalFor` com revoke e add) | `keptra`: "AB7: after a rotation of the guardian key (B6)…" (`test/bridge-v2/suites/keptra.test.mjs:3389`); `fork-orders`: "AB7 on the fork, against the escrow of 5d85a46…" (`test/bridge-v2/fork/orders.fork.mjs:638`) | passam |

O que muda para o owner antes do deploy: a migration `0015_keptra_lote.sql` ganha `deposit_from_block` nos rascunhos (AB6); um rascunho anterior fica com NULL e continua a ser julgado só pelo saldo.
