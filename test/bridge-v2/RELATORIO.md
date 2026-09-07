# Relatório da suite de testes — Bridge V2

**Spec:** `instant-win-audit/v2/SPEC-BRIDGE-V2.md`, incluindo a secção
"Verificação de participante — DECISÃO 05/09/2026" e as marcas SUBSTITUÍDO.
**Código sob teste:** commit `84d17d8` de `feat/bridge-v2`.
**Branch da suite:** `test/bridge-v2`, criada a partir de `84d17d8`.
**Data:** 2026-09-07.

---

## 1. Resultado

```
npm run test:bridge-v2

testes:     341  (passaram 339, falharam 2)
requisitos: 88  (sem teste: 0)
```

Por suite:

| Suite | Testes | O que corre |
|---|---|---|
| `pure` | 94 | módulos sem dependência externa; invariantes de importação do `config.ts` |
| `sql` | 53 | migrações 0004–0006, estaticamente (não há Postgres nesta máquina) |
| `source` | 42 | propriedades de toda a superfície: A6, F1, F2, F4, F6, G2, G4, K2, K4, R1, R5 |
| `routes` | 56 | as dez rotas HTTP, com base de dados, chain e fornecedores em dobros |
| `processor` | 66 | o pipeline agendado, incluindo os quatro modos de falha exigidos |
| `contracts` | 20 | ABI contra o artefacto compilado, as seis transacções, `eth_call` reais a Arbitrum One |

A suite da V1 continua intacta: `npm test` → **43 passaram, 0 falharam**.

### Os dois testes que falham

```
FALHA [F2] no file in the repository carries anything shaped like a live secret
      AssertionError [ERR_ASSERTION]: secret-shaped values found:
        test/bridge.test.mjs: a 32-byte private key

FALHA [J2] the code hash is bound to the campaign as well as the address
      AssertionError [ERR_ASSERTION]: the code hash carries no campaign, so a
      code issued in one campaign verifies in another
```

Ambos são achados. Estão descritos na secção 2 e **não foram corrigidos**.

---

## 2. Achados

### Achado 1 — F2: três chaves privadas literais num ficheiro do projecto

**Ficheiro:linha:** `test/bridge.test.mjs:194-196`

```js
const TEST_PKS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
];
```

**O que a spec exige.** Regra 0.1 e F2: *"NUNCA escrever nenhuma chave, token, API
key ou credencial em NENHUM ficheiro do projecto"*, e F2 estende-o explicitamente
a *"código, comentários, testes, documentação, mensagens de erro, logs, respostas
HTTP"*. A regra desta sessão diz o mesmo por outras palavras: valores de teste são
gerados no próprio teste e nunca são chaves reais.

**O que o código faz.** Escreve três chaves privadas completas, em claro, num
ficheiro versionado. São as três primeiras contas do Anvil, e o comentário por
cima diz que são públicas e sem fundos — o que é verdade e não é a regra. São
chaves privadas válidas em qualquer cadeia EVM, e a regra não tem excepção para
chaves conhecidas.

**Alcance.** É a suite da **V1**, não código da V2, e é anterior a esta sessão.
Nenhum ficheiro da V2 tem o mesmo problema: a suite nova gera cada chave de
funder com `crypto.getRandomValues` no arranque do processo, e usa a mnemónica
pública do Hardhat apenas para a derivação, que é o único valor cuja substituição
tornaria o teste incapaz de verificar os endereços BIP-44 canónicos.

**Correcção sugerida, não aplicada.** Gerar as três chaves no próprio teste, como
`test/bridge-v2/harness.mjs` faz. O teste da V1 só precisa de chaves distintas
dentro de uma execução, não destas.

**Nota sobre o detector.** O mesmo teste apanhava também
`test/bridge.test.mjs:341`, `sb_secret_MARCADOR_FALSO_DE_TESTE`. É um marcador,
não uma credencial, e o padrão foi apertado para exigir um sufixo com a forma de
uma chave real. Um detector que grita sobre marcadores ensina o leitor a ignorá-lo.

---

### Achado 2 — J2: o hash do código não está ligado à campanha

**Ficheiro:linha:** `lib/bridge-v2/codes.ts:30-32`

```ts
function hashCode(code: string, canonicalEmail: string): Promise<string> {
  return keyedHash('BRIDGE_V2_CODE_HMAC_KEY', 'email-code-v1', `${canonicalEmail}:${code}`);
}
```

**O que a spec exige.** J2: *"Guardado em hash, com chave dedicada. Nunca em claro.
HMAC com chave separada da raiz de derivação (F1), **ligado ao email e à campanha**
para impedir reutilização cruzada."*

**O que o código faz.** Liga ao email canónico e ao código. A campanha não entra
no hash, e não entra em mais nenhum ponto do fluxo do código de email: a rota
`session/request-code` não recebe `giveawayId` e a tabela `bridge_v2_email_codes`
não tem coluna de campanha.

**Avaliação do impacto, para não exagerar o achado.** Na V2 o código de email
prova posse do endereço e emite uma **sessão**, que não pertence a campanha
nenhuma; a entrada numa campanha é um passo posterior, autenticado pelo cookie
(A1, A6) e com a unicidade no telefone. Não há, portanto, "reutilização cruzada
entre campanhas" a acontecer: não existe um código por campanha que possa ser
gasto noutra. O texto de J2 descreve um desenho em que o código era por campanha,
e a arquitectura mudou.

**Porque continua a ser um achado.** A regra 0.4 diz que *"qualquer decisão de
âmbito não coberta por este documento é declarada numa secção DESVIOS, nunca
tomada em silêncio"*. Esta é exactamente uma dessas decisões e não está declarada
em lado nenhum: `codes.ts` não a menciona, e o repositório não tem secção DESVIOS.
Os outros três pontos em que a implementação se afasta da spec estão declarados no
próprio código (`env.ts:60`, `processor.ts:12`, `privacy/erase.ts:28`, todos com
`OPEN POINT`); este não está. Um auditor que leia J2 e depois `codes.ts` encontra
uma discrepância sem explicação e tem de decidir sozinho se é intencional.

**Correcção sugerida, não aplicada.** Uma de duas, e é decisão do owner:
adicionar uma nota `OPEN POINT` em `codes.ts` a dizer que J2 fala de uma campanha
que o fluxo de sessão não tem; ou marcar J2 como SUBSTITUÍDO na spec, como já foi
feito a B6, C3 e C4.

---

## 3. Requisitos que não são inteiramente testáveis nesta máquina

Todos os 88 identificadores têm pelo menos um teste. O que segue é o que **esses
testes não conseguem provar aqui**, e o que faria falta.

### 3.1 Não há Postgres nem Docker — as migrações 0004-0006 não são executadas

A suite `sql` decide, a partir do texto da migração, tudo o que é decidível: que o
contador é um `INSERT ... ON CONFLICT DO UPDATE` com o veredicto tirado do
`RETURNING` e não de uma leitura anterior; que a penalidade vive numa tabela
chaveada por `(axis, key_hash)` e por mais nada; que a aquisição de funder é um
`UPDATE` condicional com `FOR UPDATE SKIP LOCKED`; que o RLS está ligado nas 16
tabelas sem uma única política; que cada `GRANT` é exactamente o verbo que o
código usa; que o `EXECUTE` é revogado de `PUBLIC` antes de ser concedido; que
todas as tabelas efémeras têm caminho de retenção.

O que isto **não** prova, e só uma instância de Postgres provaria:

| Requisito | O que falta provar | O que seria preciso |
|---|---|---|
| B3, G1, J4 | que duas transacções concorrentes gastam uma tentativa cada, e não uma por ronda | Postgres, duas ligações, `pg_sleep` dentro da função para forçar a sobreposição |
| B4 | que a penalidade cresce de facto e sobrevive à fronteira da janela | Postgres e controlo do relógio |
| G3, G6 | que a expiração de um lease nunca deixa entrar um segundo detentor | Postgres, dois clientes, um `leased_until` no passado |
| G5 | que os índices únicos parciais recusam a segunda inserção | Postgres |
| I5 | que `anon` e `authenticated` não lêem nada | um projecto Supabase real e uma chave publicável |
| I10, K7 | que `bridge_v2_cleanup` apaga o que diz apagar | Postgres com linhas antigas |
| C6 | que o arrefecimento e a troca de número se comportam nos limites | Postgres e controlo do relógio |

Instalar Postgres (ou Docker) e correr as migrações contra uma base vazia fecharia
esta coluna inteira. É o maior buraco da suite, e é ambiental, não de desenho.

### 3.2 Requisitos cuja substância está fora do código

| Requisito | Porquê |
|---|---|
| **F5** rotação | Pede um procedimento **documentado e executável**. O teste verifica a propriedade que a rotação precisa — uma variável por raiz, lida no momento do uso — mas o documento não existe no repositório. Escrevê-lo é trabalho de operação. |
| **K1** auditoria de dependências | O teste confirma que o lockfile está commitado e tem hashes de integridade. Verificar CVEs precisa de `npm audit` com rede e da base de dados de vulnerabilidades. |
| **K3** separação de processos | É uma propriedade do deployment do Vercel (um ficheiro de rota, uma função). O teste confirma o que o código pode garantir: que nenhuma rota pública importa `wallet.js`, `funders.js` ou `processor.js`. Provar o isolamento real exige inspeccionar o deployment. |
| **F4, R2 (risco residual)** janela em memória | A própria spec declara isto como mitigação parcial: o Vercel reutiliza contentores quentes e o JavaScript não zera strings. O teste garante o que é garantível — nenhum módulo guarda material de chave em âmbito de módulo. |
| **C9, E5, R3** | São declarações e conteúdo. Os testes verificam que a declaração existe onde um leitor a procura, e que nada proibido está no código (nenhum nome de exchange, nenhum username de bot escrito à mão). O texto público em si está fora do repositório. |
| **B6, C3, C4** | SUBSTITUÍDOS pela decisão de 05/09/2026. São testados como **ausência**: nenhum fornecedor de SMS, nenhuma consulta de tipo de linha, em nenhum ficheiro nem em nenhuma dependência. É o que a decisão pede. |
| **H8** alertas | O caminho até ao webhook é exercitado com um `fetch` em dobro. Que um alerta chegue a um humano depende de `BRIDGE_V2_ALERT_WEBHOOK_URL` estar configurado e do destino. |
| **D3** tempo uniforme | O piso de 400 ms é medido neste processo. A latência real inclui a rede e o arranque a frio do Vercel, que esta máquina não reproduz. |
| **I7** segregação de credenciais | Não é satisfeito como escrito, e o código di-lo: `lib/bridge-v2/db.ts:16-18` declara que uma só credencial serve leitura e escrita, e que isso é uma garantia mais fraca do que I7 pede. O teste verifica que a declaração está lá. É um desvio **declarado**, ao contrário do achado 2. |

### 3.3 O que nenhum teste local pode dizer

A assinatura das rotas perante o runtime do Vercel. A suite da V1 já regista isto
no seu cabeçalho, e continua verdadeiro: só um `curl` pós-deploy prova que
`export async function POST` é a forma que o runtime chama. A suite confirma que
as dez rotas da V2 têm exactamente a forma que as três rotas da V1 conhecidas por
funcionar têm, o que é o mais perto que se chega daqui.

O fluxo ponta a ponta real — email a sair pelo Resend, `/start` a chegar do
Telegram, uma entrada a ser minada em Arbitrum One — não é exercitado, por regra
desta sessão.

---

## 4. Dependências de desenvolvimento acrescentadas

**Nenhuma.**

A suite corre com `node:assert/strict` e o type-stripping nativo do Node 22, que é
exactamente a ferramenta que `package.json` e `test/bridge.test.mjs` já usam. As
únicas importações de fora são `viem`, que já é dependência de produção e é o que
o código sob teste usa, e `node:fs`.

`package.json` ganha uma linha:

```json
"test:bridge-v2": "node --experimental-strip-types --import ./test/bridge-v2/register.mjs test/bridge-v2/run.mjs",
```

O script `test` da V1 fica byte a byte como estava.

### Uma nota de ambiente, não um achado

`lib/bridge-v2/config.ts:25` faz `import vercelConfig from '../../vercel.json'`.
O Node ESM puro recusa um módulo JSON sem `with { type: 'json' }`; o esbuild, que
é o que o runtime Node do Vercel usa para compilar estes ficheiros, não recusa. O
atributo é fornecido pelo loader dos testes (`test/bridge-v2/loader.mjs`), que é
ficheiro de teste e não entra no build. Não foi alterado nada em produção. Vale a
pena saber, porque qualquer outra ferramenta que carregue estes módulos com Node
puro — um script, uma migração futura — vai bater no mesmo sítio.

---

## 5. Como a suite está construída

```
test/bridge-v2/
  register.mjs            regista o loader
  loader.mjs              .js -> .ts, atributo JSON, e o desvio para os dobros
  harness.mjs             o runner, o ambiente, e o dobro do fetch de saída
  run.mjs                 ponto de entrada; imprime o mapa requisito -> teste
  doubles/db.mjs          o construtor de queries do PostgREST, gravado e programável
  doubles/chain.mjs       as funções de rede do chain.ts; planGas e ChainError são os reais
  suites/*.test.mjs       as seis suites
```

Quatro decisões que vale a pena registar:

**Cada teste declara os requisitos que exercita.** O mapa da secção 6 é produzido a
partir dessas declarações, no fim da execução. Não pode divergir do que correu, que
é o que acontece a um mapa escrito ao lado da suite.

**Só `db.ts` e `chain.ts` são substituídos.** Tudo o resto — as rotas, o
processador, `entries.ts`, `funders.ts`, `wallet.ts`, `custody.ts`,
`eligibility.ts`, `merkle.ts`, o logger — é o módulo real. Os dobros reexportam a
metade pura do módulo que substituem (`checked`, `checkedMaybe`, `planGas`,
`rootIndexFromLogs`, `ChainError`), porque essa metade **é** o requisito: testar
uma reimplementação de `checked` seria testar o dobro.

**O `fetch` de saída é substituído, não os módulos que o chamam.** `mail.ts`,
`telegram.ts`, `alert.ts` e a consulta MX de `identity.ts` correm o seu código real
contra um transporte gravado, o que mantém os timeouts, o `AbortSignal` e os corpos
dos pedidos sob teste. Um pedido para um destino não programado é recusado: um
teste que sai para a rede passa ou falha pela disponibilidade de terceiros. A única
excepção é a suite `contracts`, que regista uma rota de passagem para
`arb1.arbitrum.io` — leituras a Arbitrum One são permitidas por esta sessão, e são
a única coisa que prova que o ABI descodifica contra o bytecode que está lá.

**Nenhuma chave real em ficheiro nenhum.** As chaves de funder e os segredos de
cron e de webhook são gerados por `crypto.getRandomValues` no arranque do processo e
existem só em memória. A mnemónica de derivação é a do Hardhat, pública e
documentada, e é usada porque os endereços BIP-44 canónicos que ela produz são o
que torna o teste de derivação verificável.

---

## 6. Mapa requisito → teste

`ok` = passou. `FALHA` = falhou, e é um dos dois achados da secção 2.

### A1 — 8 testes

- ok · `pure` · a session past either clock, or revoked, resolves to nobody
- ok · `pure` · no cookie is no session, whatever else the request carries
- ok · `source` · every route that returns participant state resolves a session first
- ok · `routes` · a correct code issues a session in a cookie and nothing else
- ok · `routes` · every stateful route answers 401 with no cookie
- ok · `routes` · every stateful route answers 401 with an expired cookie
- ok · `routes` · an update without the right secret is refused and does nothing
- ok · `routes` · an update with no secret header at all is refused

### A2 — 4 testes

- ok · `pure` · base64url output carries no padding and no URL-unsafe character
- ok · `pure` · a session token carries 256 bits of entropy
- ok · `pure` · only a hash of the token reaches the database
- ok · `routes` · a correct code issues a session in a cookie and nothing else

### A3 — 2 testes

- ok · `pure` · the session cookie carries every flag the requirement names
- ok · `routes` · a correct code issues a session in a cookie and nothing else

### A4 — 4 testes

- ok · `pure` · both clocks are written and the absolute one is the longer
- ok · `pure` · a session past either clock, or revoked, resolves to nobody
- ok · `pure` · a live session slides its idle clock and never its absolute one
- ok · `routes` · every stateful route answers 401 with an expired cookie

### A5 — 4 testes

- ok · `pure` · the clearing cookie expires immediately and keeps its flags
- ok · `pure` · revocation covers every live session of the participant at once
- ok · `routes` · erasure releases the number, tombstones the address and revokes
- ok · `routes` · revoke clears the cookie whether or not there was a session

### A6 — 4 testes

- ok · `pure` · no cookie is no session, whatever else the request carries
- ok · `source` · no route outside the two session routes reads an email from a body
- ok · `source` · no route takes a participant id or a wallet address from a body
- ok · `routes` · every stateful route answers 401 with no cookie

### B1 — 3 testes

- ok · `source` · every participant-facing route enforces a rate limit
- ok · `source` · the read-only routes are limited as well as the writing ones
- ok · `routes` · every stateful route is rate limited before it does any work

### B2 — 6 testes

- ok · `pure` · rotating the last octet does not produce a new subnet key
- ok · `pure` · the leftmost forwarded address is the client, not the proxy
- ok · `source` · every route carries the global axis as well as its own
- ok · `routes` · a caller over an axis about themselves does get a 429
- ok · `routes` · the number is its own axis, and a denial does not burn the code
- ok · `routes` · the webhook has no IP axis, which would count Telegram as one caller

### B3 — 2 testes

- ok · `sql` · the rate limit counts with one statement, not a select then an insert
- ok · `sql` · the standing penalty is read under a row lock

### B4 — 4 testes

- ok · `sql` · the penalty is keyed by axis and key alone, never by window
- ok · `sql` · the penalty grows with the strike count, is capped, and decays
- ok · `sql` · a request refused by a live penalty does not also spend a window slot
- ok · `sql` · a penalty row is removed only once it means nothing

### B5 — 2 testes

- ok · `routes` · an address over its own limit is refused silently, not with a 429
- ok · `routes` · an unknown address is counted on a different axis from a known one

### B6 — 1 teste

- ok · `source` · no SMS provider, and no line-type lookup, exists anywhere

### B7 — 2 testes

- ok · `routes` · a campaign with no slots left hands out no link
- ok · `processor` · a campaign with no slots left fails its batch rather than waiting for ever

### B8 — 5 testes

- ok · `sql` · a spend claim moves both windows or neither
- ok · `routes` · the mail budget is claimed before the provider is called
- ok · `routes` · the Telegram budget is claimed before the link is touched
- ok · `routes` · a provider approaching its daily ceiling is alerted before it stops
- ok · `processor` · a refused gas budget returns the entry to the queue rather than holding it

### C1 — 4 testes

- ok · `pure` · sub-addressing and Gmail dots collapse to one account key
- ok · `pure` · dots are left alone where the provider says they matter
- ok · `pure` · sub-addressing is stripped at every provider, which is the account rule
- ok · `routes` · the code is keyed on the canonical address and sent to the literal one

### C2 — 5 testes

- ok · `pure` · a domain on the blocklist is refused before anything is issued
- ok · `pure` · a domain with no MX record is refused
- ok · `pure` · a domain that resolves is accepted
- ok · `pure` · a resolver outage does not become a registration outage
- ok · `routes` · a disposable domain and a missing MX record answer the same

### C3 — 1 teste

- ok · `source` · no SMS provider, and no line-type lookup, exists anywhere

### C4 — 1 teste

- ok · `source` · no SMS provider, and no line-type lookup, exists anywhere

### C5 — 8 testes

- ok · `pure` · a phone is normalised so one number cannot hash twice
- ok · `sql` · the live phone binding is unique platform-wide
- ok · `sql` · binding refuses a number that belongs to somebody else
- ok · `sql` · one entry per campaign and number, enforced by a unique index
- ok · `sql` · nothing in the schema holds a number or a Telegram id in clear
- ok · `routes` · a forwarded contact card is refused
- ok · `routes` · the number reaches the database only as a hash
- ok · `routes` · every binding outcome answers 200 with its own message

### C6 — 6 testes

- ok · `sql` · a participant holds at most one live number
- ok · `sql` · binding refuses a number that belongs to somebody else
- ok · `sql` · a released number cools down before it can be rebound
- ok · `sql` · a change of number blocks the account in the campaigns it was active in
- ok · `routes` · erasure releases the number, tombstones the address and revokes
- ok · `routes` · every binding outcome answers 200 with its own message

### C7 — 3 testes

- ok · `pure` · no signal leaves the module in clear
- ok · `pure` · rotating the last octet does not produce a new subnet key
- ok · `pure` · an IPv6 client is reduced to the block a provider allocates

### C8 — 18 testes

- ok · `pure` · a domain on the blocklist is refused before anything is issued
- ok · `pure` · the leaf is one keccak of the packed address, as the contract computes it
- ok · `pure` · every proof verifies under an independent commutative fold
- ok · `pure` · an address outside the tree cannot be proved into it
- ok · `pure` · an odd node is carried up rather than paired with itself
- ok · `pure` · the tree is deterministic for a set, whatever order it arrives in
- ok · `pure` · an empty batch is refused rather than producing a root of nothing
- ok · `pure` · a proof outside the tree is refused rather than returned empty
- ok · `sql` · the campaign queue returns one row per campaign, oldest waiting first
- ok · `processor` · a published root records the index the contract assigned, not a guess
- ok · `processor` · a publication that never confirms writes nothing at all
- ok · `processor` · a mined publication with no event invents no index
- ok · `processor` · a reverted publication writes nothing
- ok · `processor` · an entry whose proof cannot be rebuilt is failed, not retried for ever
- ok · `processor` · a leaf set that does not rebuild the stored root is refused
- ok · `contracts` · the leaf the bridge builds is the leaf the contract computes
- ok · `contracts` · the contract verifies against a root it holds by index, append only
- ok · `contracts` · a proof the bridge builds is the argument shape enter() declares

### C9 — 1 teste

- ok · `source` · the limits of the anti-sybil layers are written down, not implied

### D1 — 6 testes

- ok · `pure` · every response is marked no-store
- ok · `source` · no route outside the two session routes reads an email from a body
- ok · `source` · every route that returns participant state resolves a session first
- ok · `source` · every read of a participant row is filtered by the session participant
- ok · `routes` · entry status is scoped to the session participant and to nobody else
- ok · `routes` · entry status returns the caller own address, hash and custody

### D2 — 5 testes

- ok · `pure` · the indistinguishable answer has one shape and one status
- ok · `routes` · a code request answers identically for a known and an unknown address
- ok · `routes` · a disposable domain and a missing MX record answer the same
- ok · `routes` · an address over its own limit is refused silently, not with a 429
- ok · `routes` · a wrong code and a code that never existed answer the same

### D3 — 1 teste

- ok · `pure` · a route with uniform timing holds its error path to the same floor

### D4 — 2 testes

- ok · `source` · no route reads anything personal out of a URL
- ok · `source` · every route that carries data is a POST

### D5 — 2 testes

- ok · `pure` · a throw anywhere in a route becomes one generic sentence
- ok · `pure` · a configuration failure reaches the client as the same sentence

### D6 — 2 testes

- ok · `sql` · the funder is drawn at random rather than in sequence
- ok · `processor` · the sweep destination is drawn from the pool, not fixed on one funder

### D7 — 6 testes

- ok · `sql` · nothing that must not be deleted carries a DELETE grant
- ok · `sql` · every ephemeral table has a retention path
- ok · `sql` · the retention pass never touches the participation record
- ok · `routes` · entry status returns the caller own address, hash and custody
- ok · `routes` · the export returns what is held and says what is not
- ok · `routes` · erasure releases the number, tombstones the address and revokes

### E1 — 2 testes

- ok · `pure` · nothing that holds a key crosses the wallet boundary
- ok · `processor` · a prize that needs the winner own wallet is not claimed without one

### E2 — 13 testes

- ok · `pure` · a USDC share below the threshold may rest in the derived wallet
- ok · `pure` · a USDC share at or above the threshold requires the winner own wallet
- ok · `pure` · an NFT requires the winner own wallet at any value, with no exception
- ok · `pure` · any token that is not USDC requires the winner own wallet
- ok · `pure` · the largest winner share is the one that carries the remainder
- ok · `routes` · the custody rule is recorded at entry time from the campaign
- ok · `routes` · an NFT campaign records the own-wallet rule whatever it declares
- ok · `processor` · a prize that needs the winner own wallet is not claimed without one
- ok · `processor` · the rule is recomputed from claimable before anything moves
- ok · `processor` · a prize that must go to the winner own wallet gets no custody clock
- ok · `contracts` · the campaign tuple decodes into the fields the bridge reads
- ok · `contracts` · the three deployed prize modules are told apart by ERC-165
- ok · `contracts` · no module answers both item interfaces, so a delivery is never ambiguous

### E3 — 6 testes

- ok · `pure` · custody expiry is measured from the moment it begins
- ok · `sql` · custody carries the columns the prize path needs to resume
- ok · `sql` · the prize queue index excludes what can no longer receive a prize
- ok · `processor` · temporary custody starts when the claim is mined, not at entry
- ok · `processor` · an entrant who did not win leaves the prize queue for good
- ok · `processor` · a claim window that has closed takes the row out of the queue

### E4 — 5 testes

- ok · `source` · a prize delivery goes only to an address the participant confirmed
- ok · `routes` · proposing a destination stores it unconfirmed and echoes it back
- ok · `routes` · confirming names the address again, and a different one is refused
- ok · `processor` · delivery goes to the confirmed destination and marks the prize gone
- ok · `processor` · a destination proposed but not confirmed does not count

### E5 — 1 teste

- ok · `source` · no off-ramp guidance and no provider name is built into the bridge

### F1 — 5 testes

- ok · `pure` · one message under three roots gives three unrelated hashes
- ok · `pure` · one root with two labels gives two unrelated hashes
- ok · `pure` · a keyed hash never contains the configured secret
- ok · `pure` · the roots are separate variables, one per function
- ok · `source` · each root is read by the module whose job it is, and by no other

### F2 — 5 testes

- ok · `pure` · a keyed hash never contains the configured secret
- ok · `sql` · no migration contains anything shaped like a secret
- **FALHA** · `source` · no file in the repository carries anything shaped like a live secret
- ok · `source` · no .env file is tracked in the repository
- ok · `routes` · the plaintext code is never stored and never returned

### F3 — 3 testes

- ok · `pure` · a missing variable is reported by name and never by value or length
- ok · `pure` · assertEnv reports every missing name at once
- ok · `pure` · a configuration failure reaches the client as the same sentence

### F4 — 1 teste

- ok · `source` · no module holds key material in module scope

### F5 — 1 teste

- ok · `source` · each root is one variable, read at use, so rotation is a deployment

### F6 — 5 testes

- ok · `pure` · nothing that holds a key crosses the wallet boundary
- ok · `pure` · derivation matches the canonical BIP-44 addresses for the test mnemonic
- ok · `pure` · signing returns bytes, and a different index returns different bytes
- ok · `source` · no module returns an object that holds a private key
- ok · `contracts` · a signed transaction is on Arbitrum One and recovers to the wallet

### F7 — 1 teste

- ok · `source` · the funder keys and the participant seed are never read together

### G1 — 4 testes

- ok · `sql` · the rate limit counts with one statement, not a select then an insert
- ok · `sql` · the standing penalty is read under a row lock
- ok · `sql` · one attempt is spent by the same statement that hands out the hash
- ok · `routes` · the attempt is claimed in the database before anything is compared

### G2 — 7 testes

- ok · `sql` · consumption reports whether it changed a row
- ok · `source` · no database result is used without going through the checked helpers
- ok · `routes` · a code consumed by somebody else between compare and consume is refused
- ok · `processor` · a publication that never confirms writes nothing at all
- ok · `processor` · the transaction hash is written before the wait, and checked
- ok · `processor` · a failed write of the hash ends the entry instead of losing the transaction
- ok · `processor` · a database outage ends each stage without signing anything

### G3 — 4 testes

- ok · `sql` · a funder is taken by a conditional update, never by expiry alone
- ok · `sql` · renew and release both require the lease token
- ok · `processor` · the lease is renewed between the funding and the entry
- ok · `processor` · a lease lost mid-operation stops the entry rather than signing on

### G4 — 28 testes

- ok · `pure` · a resolver outage does not become a registration outage
- ok · `pure` · the MX lookup and the blocklist read are both bounded
- ok · `pure` · every unit of work fits inside one run budget
- ok · `pure` · the run budget leaves room for the slowest unit inside maxDuration
- ok · `pure` · the prize reservation is derived from the entry one and still fits
- ok · `pure` · every phase has a reservation and every reservation has a phase
- ok · `pure` · a route duration this code derives is the duration vercel.json declares
- ok · `pure` · both scheduled paths are routes with a declared duration
- ok · `sql` · the run sequence advances once per run, from a sequence
- ok · `sql` · the campaign queue returns one row per campaign, oldest waiting first
- ok · `source` · every database call in the codebase carries an abort signal
- ok · `source` · every outbound fetch in the codebase carries an abort signal
- ok · `source` · the receipt wait is bounded and there is only one of it
- ok · `routes` · the pipeline runs every phase and reports which one led
- ok · `routes` · the leading phase advances by one per run that actually happens
- ok · `processor` · one campaign that throws does not end the publication stage
- ok · `processor` · the publication stage starts nothing when the budget is gone
- ok · `processor` · an RPC that cannot answer leaves the nonce as it stands
- ok · `processor` · a funding that is never mined returns the entry to the queue
- ok · `processor` · one entry that throws does not end the funding stage
- ok · `processor` · an entry that threw is moved to the back of the queue
- ok · `processor` · no entry is started once the budget is gone
- ok · `processor` · a delivery that is never mined is not marked delivered
- ok · `processor` · a campaign that has not settled is left where it is
- ok · `processor` · one prize that throws does not end the prize stage
- ok · `processor` · no prize is started once the budget is gone
- ok · `processor` · a database outage ends each stage without signing anything
- ok · `processor` · an RPC outage ends each stage without a state change

### G5 — 9 testes

- ok · `sql` · binding and verifying are one call, so a number cannot be spent on nothing
- ok · `sql` · a link is bound and consumed by predicate, so a retry cannot double it
- ok · `routes` · the link code is stored hashed and the plaintext appears once
- ok · `routes` · an entry already moving is not re-issued a link
- ok · `routes` · a null binding outcome is treated as a refusal, never as a success
- ok · `processor` · an address the contract already has is confirmed without spending anything
- ok · `processor` · a claim another run already took ends this attempt silently
- ok · `processor` · a claim the chain already has is recorded rather than made again
- ok · `processor` · a delivery with nothing left to send is marked done, not sent twice

### G6 — 15 testes

- ok · `sql` · release advances the nonce and never rewinds it
- ok · `sql` · reconciliation can move the nonce down, which release cannot
- ok · `sql` · the run lock is taken in one statement guarded by its own expiry
- ok · `sql` · a lock is released only by the run that took it
- ok · `routes` · a run that finds the lock held does nothing and says so
- ok · `routes` · the pipeline lock is released with the holder it was taken with
- ok · `routes` · the sweep borrows the pipeline lock and is skipped when it is held
- ok · `processor` · the nonce advances on release even when the entry failed
- ok · `processor` · a funding that sent nothing does not advance the nonce
- ok · `processor` · a funder whose lease cannot be released is taken out of rotation
- ok · `processor` · the stored nonce is corrected against the account before it is used
- ok · `processor` · a dropped transaction lets the nonce come back down
- ok · `processor` · a stored nonce inside what the account has committed to is left alone
- ok · `processor` · a refused nonce correction leaves the stored value alone
- ok · `processor` · an RPC that cannot answer leaves the nonce as it stands

### H1 — 15 testes

- ok · `pure` · the contract address and the chain are literals, not configuration
- ok · `pure` · the manager ABI carries exactly three state-changing functions
- ok · `pure` · no ABI in the bridge can approve or move a third party balance
- ok · `pure` · the prize modules and the VRF coordinator are read-only to the bridge
- ok · `source` · no contract address in the bridge comes from input
- ok · `source` · every functionName the bridge signs is a literal
- ok · `contracts` · every manager entry the bridge carries exists in the compiled artifact
- ok · `contracts` · the campaign tuple matches the deployed struct field for field
- ok · `contracts` · every prize module entry the bridge carries exists in its artifact
- ok · `contracts` · the bridge signs six shapes and each carries the selector it claims
- ok · `contracts` · every selector matches the one the deployed artifact defines
- ok · `contracts` · the three delivery encodings are the three the standards define
- ok · `contracts` · a signed transaction is on Arbitrum One and recovers to the wallet
- ok · `contracts` · Arbitrum One answers, so the on-chain checks below actually ran
- ok · `contracts` · the manager views decode against the deployed bytecode

### H2 — 5 testes

- ok · `pure` · the address parser normalises case and refuses anything else
- ok · `source` · the destination of a funding is always a server-derived address
- ok · `source` · a prize delivery goes only to an address the participant confirmed
- ok · `processor` · delivery goes to the confirmed destination and marks the prize gone
- ok · `contracts` · the funding and the sweep carry a value and no calldata

### H3 — 4 testes

- ok · `pure` · a plan above the absolute ceiling fails instead of spending
- ok · `pure` · the margin is applied to the limit and carried into the worst case
- ok · `processor` · a gas cost above the ceiling refuses the entry and alerts
- ok · `contracts` · a real fee quote produces a plan under the absolute ceiling

### H4 — 4 testes

- ok · `pure` · an estimate outside its band is refused before anything is signed
- ok · `pure` · the transfer band admits the real Arbitrum intrinsic cost
- ok · `contracts` · a real estimate for a value transfer falls inside the transfer band
- ok · `contracts` · a real fee quote produces a plan under the absolute ceiling

### H5 — 3 testes

- ok · `routes` · a campaign past its effective end hands out no link
- ok · `processor` · a campaign past its entry window fails its batch instead of publishing
- ok · `processor` · an entry into a closed campaign is failed before any gas moves

### H6 — 8 testes

- ok · `routes` · a campaign past its effective end hands out no link
- ok · `routes` · a campaign with no slots left hands out no link
- ok · `processor` · a campaign past its entry window fails its batch instead of publishing
- ok · `processor` · a campaign with no slots left fails its batch rather than waiting for ever
- ok · `processor` · only as many entries as there are slots are admitted to the root
- ok · `processor` · an entry into a closed campaign is failed before any gas moves
- ok · `processor` · an entry into a full campaign is failed before any gas moves
- ok · `contracts` · the slot and entry views answer for a campaign id

### H7 — 9 testes

- ok · `sql` · the sweep queue is funded-and-not-swept, with no status in it
- ok · `sql` · a database that already holds entries gets its funded wallets back
- ok · `routes` · the sweep borrows the pipeline lock and is skipped when it is held
- ok · `processor` · the funding mark is written in the same statement as the claim
- ok · `processor` · the sweep queue is every funded wallet, whatever its entry ended as
- ok · `processor` · a wallet is marked whether or not the sweep was worth making
- ok · `processor` · a sweep that could not be made is touched, never marked done
- ok · `processor` · a wallet with no derivation index is marked rather than retried for ever
- ok · `processor` · a prize funding puts the wallet back in the sweep queue

### H8 — 9 testes

- ok · `routes` · maintenance reports a check that could not run as unknown
- ok · `routes` · one failing check does not stop the ones behind it
- ok · `routes` · a bridge address the contract no longer names raises an alert
- ok · `routes` · a paused contract and a low VRF balance are both alerted
- ok · `routes` · a funder that cannot pay for one entry is counted and alerted
- ok · `routes` · a provider approaching its daily ceiling is alerted before it stops
- ok · `processor` · an empty funder pool returns the entry and raises an alert
- ok · `processor` · a funder whose lease cannot be released is taken out of rotation
- ok · `contracts` · the VRF subscription the contract names is readable through it

### I1 — 10 testes

- ok · `pure` · the code parser accepts only the configured width of digits
- ok · `pure` · the email parser refuses what is not an address
- ok · `pure` · the address parser normalises case and refuses anything else
- ok · `pure` · a phone is normalised so one number cannot hash twice
- ok · `pure` · a Telegram id is accepted in both wire shapes and nothing else
- ok · `pure` · a link code is accepted only in the shape the bridge issues
- ok · `pure` · a JSON body that is not an object is refused
- ok · `pure` · a route answers 405 to a method it does not implement
- ok · `routes` · a malformed address is a 400 and reaches nothing
- ok · `routes` · a destination that is not an address is a 400

### I2 — 4 testes

- ok · `pure` · a giveaway id is checked against uint256, not against a digit count
- ok · `sql` · a campaign id is stored as an exact decimal, not as a float
- ok · `sql` · every function that returns a campaign id casts it to text
- ok · `routes` · a campaign id past uint256 is a 400, never a 500

### I3 — 4 testes

- ok · `pure` · a body is refused on its content type before it is parsed
- ok · `pure` · a body is refused on its real size, not on what it declares
- ok · `pure` · a JSON body that is not an object is refused
- ok · `routes` · a request with the wrong content type is a 400

### I4 — 1 teste

- ok · `sql` · no function builds SQL out of a value a caller supplies

### I5 — 10 testes

- ok · `sql` · row level security is enabled on every table the migration creates
- ok · `sql` · no policy exists, so anon and authenticated reach nothing
- ok · `sql` · anon and authenticated are revoked on every table
- ok · `sql` · a grant on a table is only a verb the code uses
- ok · `sql` · nothing that must not be deleted carries a DELETE grant
- ok · `sql` · a sequence is granted USAGE and never UPDATE
- ok · `sql` · EXECUTE is revoked from PUBLIC before it is granted to anyone
- ok · `sql` · every function 0005 defines is granted to the one role that calls it
- ok · `sql` · no function is granted that 0005 does not define
- ok · `sql` · every function runs as the caller, not as the owner

### I6 — 1 teste

- ok · `sql` · every object the migration creates is under the bridge prefix

### I7 — 1 teste

- ok · `sql` · the one-credential design is declared where a reader looks for it

### I8 — 8 testes

- ok · `sql` · every entry state the schema declares is written by a code path
- ok · `sql` · every state a run can leave behind is also read by a query
- ok · `processor` · an entry abandoned in FUNDING is brought back by the chain answer
- ok · `processor` · the FUNDING sweep only looks at rows older than a run can live
- ok · `processor` · a transaction the node has never heard of is treated as dropped
- ok · `processor` · a transaction still in the mempool is left alone but moved down the queue
- ok · `processor` · a mined and reverted entry goes back for a fresh quote
- ok · `processor` · a SUBMITTED entry with no hash recorded goes back to the queue

### I9 — 4 testes

- ok · `pure` · a derivation index that is not a whole non-negative number is refused
- ok · `sql` · a wallet index comes from a sequence, never from a count or a max
- ok · `sql` · a participant row cannot exist holding a placeholder address
- ok · `sql` · an entry address carries the same format constraint

### I10 — 2 testes

- ok · `sql` · every ephemeral table has a retention path
- ok · `sql` · the retention pass never touches the participation record

### J1 — 4 testes

- ok · `pure` · randomDigits always yields exactly the configured width
- ok · `pure` · randomDigits covers its range rather than a corner of it
- ok · `pure` · randomIndex rejects the biased tail instead of taking a remainder
- ok · `pure` · randomIndex refuses a bound it cannot serve uniformly

### J2 — 3 testes

- ok · `source` · the code hash is bound to the address it was issued for
- **FALHA** · `source` · the code hash is bound to the campaign as well as the address
- ok · `routes` · the plaintext code is never stored and never returned

### J3 — 2 testes

- ok · `sql` · only a live, unconsumed, most recent code can be attempted
- ok · `sql` · issuing a code supersedes every live code for that address

### J4 — 3 testes

- ok · `sql` · one attempt is spent by the same statement that hands out the hash
- ok · `routes` · a wrong code and a code that never existed answer the same
- ok · `routes` · the attempt is claimed in the database before anything is compared

### J5 — 2 testes

- ok · `pure` · the hex compare walks the string and refuses a length mismatch
- ok · `routes` · the cron secret is compared in constant time

### J6 — 2 testes

- ok · `source` · the code is in the body of the mail and never in its subject
- ok · `routes` · the code is keyed on the canonical address and sent to the literal one

### J7 — 1 teste

- ok · `source` · the sender is configured, and is not the shared provider address

### K1 — 1 teste

- ok · `source` · a lockfile is committed and carries integrity hashes

### K2 — 2 testes

- ok · `source` · the modules that touch key material import no package but viem
- ok · `source` · the email and Telegram clients are one fetch each, not an SDK

### K3 — 3 testes

- ok · `source` · no public high-volume route imports a module that signs
- ok · `processor` · the transaction hash is written before the wait, and checked
- ok · `processor` · a submitted entry the contract has is confirmed without a second look

### K4 — 7 testes

- ok · `pure` · no signal leaves the module in clear
- ok · `pure` · only the error name comes back, never the arguments
- ok · `source` · the log detail type cannot carry an arbitrary object
- ok · `source` · no log call passes a value that could be an email, a number or a code
- ok · `source` · no console call in the bridge prints a value
- ok · `source` · the rate limiter hashes its key before anything is stored
- ok · `routes` · the number reaches the database only as a hash

### K5 — 6 testes

- ok · `pure` · a revert is decoded to the name the contract raised
- ok · `pure` · an already-decoded revert is read from where viem leaves it
- ok · `pure` · a timeout still reads as a timeout, not as a revert
- ok · `pure` · a cause chain that points at itself does not hang the failure path
- ok · `pure` · only the error name comes back, never the arguments
- ok · `contracts` · every error the bridge decodes is an error the manager can raise

### K6 — 4 testes

- ok · `pure` · a throw anywhere in a route becomes one generic sentence
- ok · `sql` · no uniqueness collision leaves the binding as an exception
- ok · `source` · every route body runs inside the envelope
- ok · `routes` · a failure inside the webhook is acknowledged, not retried for ever

### K7 — 1 teste

- ok · `sql` · every ephemeral table has a retention path

### K8 — 8 testes

- ok · `pure` · assertEnv reports every missing name at once
- ok · `pure` · the cron secret is required configuration, not an optional one
- ok · `pure` · both scheduled paths are routes with a declared duration
- ok · `routes` · a cron with no credential is refused
- ok · `routes` · a cron with a wrong credential is refused
- ok · `routes` · a cron checks its configuration before it checks the caller
- ok · `routes` · maintenance reports a check that could not run as unknown
- ok · `routes` · a route erroring repeatedly in the last hour is alerted

### R1 — 5 testes

- ok · `source` · nothing in the bridge builds a Mini App, a Web App, or a link to one
- ok · `source` · the only keyboard the bot builds carries request_contact
- ok · `source` · the deep link the page opens is a plain t.me start link
- ok · `routes` · the link is a plain t.me start link and nothing else
- ok · `routes` · a start with a code asks for the contact and stores no chat id

### R2 — 2 testes

- ok · `pure` · no message the bot can send names crypto, a prize, an amount or a link
- ok · `routes` · no message the webhook actually sends mentions crypto or a prize

### R3 — 2 testes

- ok · `pure` · no message the bot can send contains a gambling word
- ok · `source` · the bot name is configuration, not a name written into the code

### R4 — 3 testes

- ok · `sql` · the link code is matched by a chat HMAC, never by a chat id
- ok · `sql` · nothing in the schema holds a number or a Telegram id in clear
- ok · `routes` · a start with a code asks for the contact and stores no chat id

### R5 — 1 teste

- ok · `source` · the bot token is read from the environment at the moment of the call

### OWNER-D1 — 4 testes

- ok · `pure` · any token that is not USDC requires the winner own wallet
- ok · `pure` · the USDC comparison does not depend on the case of the address
- ok · `routes` · the custody rule is recorded at entry time from the campaign
- ok · `processor` · the rule is recomputed from claimable before anything moves

### OWNER-D2 — 4 testes

- ok · `sql` · custody carries the columns the prize path needs to resume
- ok · `processor` · an expired custody with no destination alerts exactly once
- ok · `processor` · a custody already alerted on is not alerted again
- ok · `processor` · nothing automatic happens to an expired custody
