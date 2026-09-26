# Matriz da peça 5 — os fluxos da bridge

Spec: `SPEC-BLOCO-03-KEPTRA-v1.0.md` (repositório `instant-win-audit/v2`), linha 3: **Versão 1.31 — 23/09/2026** (Adendas AA e AB). A construção foi verificada contra a 1.19 (Adenda R); o lote antes do deploy, contra a 1.30; a correcção da Adenda AB, contra a 1.31.
Cobre a secção 17, ponto 5, a O4 da Adenda O, as **Adendas P, Q e R**, e o que a **AA4 da Adenda AA** lista para a peça 5: P5-1 a P5-14, B8, Y5 e, com os contratos, T18 e Q7.

Código: este repositório, ramo `feat/keptra-bridge`. A construção está em `d0f49c2`. A correcção da Adenda R está no commit que traz esta matriz.
Contratos das peças 2 e 3: commit `5d85a46` (Z1, o lote dos contratos). O bytecode de criação e a ABI estão em `test/bridge-v2/fork/keptra-5d85a46.json`; o hash do escrow é o da Z1, o que a peça 4 fixa em `df37231`. (Até ao lote era o `183a2b4`, Q7.)

**Nomes.**
- **Qn** são os requisitos da peça, levantados na Fase A. Os testes usam estes números como etiqueta.
- As decisões das adendas levam o prefixo A:
  - **APn** para a Adenda P;
  - **AQn** para a Adenda Q, porque Qn já são os requisitos;
  - **ARn** para a Adenda R.

Cada teste declara as suas etiquetas, e o mapa de requisitos de `test/bridge-v2/run.mjs` conta-as. O teste AR3 confirma que cada etiqueta usada pelos testes da peça tem uma linha nesta matriz.

**Suites.**
- **`orders`** (`test/bridge-v2/suites/orders.test.mjs`): a cadeia está em duplo, a base de dados em memória, e a migration 0013 corre num Postgres embebido.
- **`fork-orders`** (`test/bridge-v2/fork/orders.fork.mjs`): um fork local de Arbitrum One, com os contratos de 5d85a46, a USDC, a Safe e o GiveawayManagerV2 reais.

**Ficheiros e linhas.** As referências `ficheiro:linha` são do commit que traz esta matriz. Os caminhos curtos querem dizer:
- `orders.ts`, `keptraOrders.ts`, `escrowChain.ts`, `config.ts`, `relay.ts`, `chain.ts`, `abi.ts`, `ship24.ts`, `mail.ts` e `log.ts`: estão em `lib/bridge-v2/`;
- as rotas: estão em `api/bridge/v2/`;
- `0013`: é `supabase/migrations/0013_keptra_orders.sql`.

## 0. O que foi construído

| Parte | Ficheiro | O que é |
|---|---|---|
| Dados | `orders.ts` | Moradas cifradas, envios e HMAC do tracking, evidências, avisos, marcações, índice de encomendas, lista do oráculo, apagamento |
| Passe | `keptraOrders.ts` | O passe das encomendas, a cada minuto, dentro da fase `advanceLifecycle` e sob o lock do pipeline. Passos: índice, saídas por tempo, avisos, fechos, marcações. Inclui também os dois passos da manutenção |
| Leituras | `escrowChain.ts` | Só leituras do escrow, da garantia e do voucher. Inclui a busca de `OrderClosed` por partes (R2) |
| Fornecedor | `ship24.ts` | Registo do envio na Ship24 |
| Rotas | `order/{address,list,evidence}.ts`, `store/{orders,tracking}.ts`, `oracle/pending.ts`, `arbiter/evidence.ts` | Morada, lista do destinatário, evidências, lado da loja, lista do oráculo, leitura do árbitro |
| Relay | `relay.ts`, `account/relay.ts` | Acções de destinatário, loja e marca (P1); isenções da P16 |
| Chaves | `chain.ts` | Saídas do keeper, marcação e atestação do resgate pelo papel bridge |
| Base | `0013` | Sete tabelas, RLS e verbos exactos. Só como ficheiro, nunca aplicada |

## 1. Requisitos da peça (Q1–Q32)

### Moradas e dados pessoais

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q1 | 10.1, 10.2 e I7: a morada nunca vai para a cadeia e fica cifrada em repouso | `orders.ts:82` (campos), `:156` (cifra), `:50` (raiz e etiquetas); `0013:38` (só ciphertext) | `orders`: "10.2 and P19: an address is kept as ciphertext…"; "0013: an address is for an offer or a voucher, never in clear…" | passam |
| Q2 | 10.2 e L1: a morada só é lida pela loja da encomenda e pela comparação do código postal | `store/orders.ts:34` (conta CREATOR, e só as encomendas cujas condições a nomeiam); `store/tracking.ts:60`; `orders.ts:576` (o oráculo recebe só o código postal) | `orders`: "10.2 and P2: the address is read by the store the order’s terms name…" | passa |
| Q3 | 11.5, H7 e I14: morada numa região aceite | `order/address.ts:57` (regiões da oferta), `:66` (regiões da obrigação do voucher); `relay.ts:598` e `:618` (sem morada, não há pagamento nem resgate) | `orders`: "P15: in COMPRA an address outside the regions…"; "H7 and 11.5: for a voucher, only one this account holds…" | passam |
| Q4 | 10.3: apagamento real, até 30 dias depois do estado final, incluindo as evidências | `keptraOrders.ts:520` (a data é marcada no fecho); `orders.ts:412` (data) e `:427` (DELETE); `config.ts:649` (29 dias); `keptraOrders.ts:539` (passo da manutenção) | `orders`: "10.3: at the final state…"; "0013: what eraseExpired sends deletes the rows…"; os testes AR1 | passam |
| Q5 | D7 e C5 da SPEC-BRIDGE-V2: a exportação e o apagamento a pedido incluem as moradas | `orders.ts:455`; `privacy/erase.ts:75`, `privacy/export.ts:69` | `orders`: "P18: an erasure request deletes the addresses no open order needs now…" | passa |

### Tracking e oráculo

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q6 | H17, 9.1.1 e I6: HMAC do número de tracking; o mesmo hash não serve duas encomendas | `orders.ts:108` (normalização), `:115` (HMAC), `:515` (registo); `0013:93` (UNIQUE) | `orders`: "H17: the tracking hash is keyed…"; "I6: a number that serves an order is refused for another…"; `fork-orders`: 16.4 | passam |
| Q7 | M9 e O4: registo na Ship24 com o código postal e o país; o `trackerId` fica guardado | `ship24.ts:25`; `store/tracking.ts:85` | `orders`: "M9 and P7: the shipment is registered with the provider…"; `fork-orders`: 16.4 | passam |
| Q8 | 9.5.5: o fornecedor em baixo não bloqueia nenhum estado | `store/tracking.ts:84`; `keptraOrders.ts:551` (nova tentativa na manutenção) | `orders`: "9.5.5: a provider that fails blocks nothing…" | passa |
| Q9 | M9, N7, N3 e O4: lista do oráculo com credencial própria, só TRANSPORTADORA à espera de prova | `oracle/pending.ts:16`; `orders.ts:576` e `:592` (um tracker, uma encomenda); `config.ts:666` (rotação) | `orders`: "M9 and O4: the oracle’s list needs its own credential…"; "N7 and B5, B6, B7…"; "B4: past 13 the list rotates…"; `fork-orders`: 16.4 | passam |
| Q10 | M1 e O4: chave Ship24 própria da bridge | `ship24.ts:6` (`BRIDGE_V2_SHIP24_KEY`) | `orders`: "M1 and P7: the bridge uses its own provider key…" | passa |

### Atestações do papel bridge

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q11 | 13.1, H3 e H33: destinatário verificado por telefone e distinto dos já contados | `keptraOrders.ts:578` e `:597` (marcação), `:252` (resolução no fecho); `chain.ts:841`; `0013:145` (índice parcial) | `orders`: os seis testes Q11, mais os testes AR1 e AR2 que resolvem a marca; `fork-orders`: 16.4 | passam |
| Q12 | H7 e I6: atestação da morada no resgate | `chain.ts:872`; `relay.ts:611` e `:621` (prazo de 1 hora) | `orders`: "H7 and I6: the attestation is the bridge role’s EIP-712 signature…"; "H7: a redemption is prepared only with an address…"; `fork-orders`: 16.3 | passam |

### Relay

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q13 | 6.2.2, T1, T2, T6, T9 e H23: pagar, resgatar, cancelar, confirmar e contestar com a passkey; lojas e marcas pela relay | `relay.ts:589` (pay), `:611` (redeem), `:644` (contest), `:649` (createOffer), `:677` (ship), `:751` (campanha com vouchers); `:261` (conta de cada acção) | `orders`: os testes Q13; `fork-orders`: 16.3, 16.4 e 16.5 | passam |
| Q14 | E3, E7 e F7: com o recibo perdido, o estado final fica certo | `relay.ts:1054` (associação da morada no submit); `keptraOrders.ts:236` (no passe) | `orders`: "Q14: a relayed payment binds the recipient’s address…" | passa |
| Q15 | E2: no máximo 20 transacções por conta em 24 horas | `relay.ts:244` (as isenções da P16) | `orders`: "P16: contesting, confirming and cancelling pass with the 24-hour limit reached…" | passa |

### Avisos, contestação e saídas por tempo

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q16 | 8.3 e 9.4: avisos em T5, na declaração e 24 horas antes do fecho da janela | `keptraOrders.ts:418` e `:436`; `mail.ts:405` | `orders`: os testes Q16; `fork-orders`: 16.4 | passam |
| Q17 | B2 e A13: as ligações usam keptra.io | `mail.ts:20` (`KEPTRA_BASE`) | `orders`: "P3: every order notice goes by email only…" | passa |
| Q18 | B8: o tecto de gasto é reclamado antes de cada chamada | `keptraOrders.ts:620` (chain), `:558` (tracking), `sendNotices` (email); `config.ts:147` | `orders`: "9.5.5: a provider that fails blocks nothing…"; "P3: every order notice…" | passam |
| Q19 | T9, 10.3, P17 e AQ3: as evidências ficam fora da cadeia, são lidas pelas partes e pelo árbitro, e são apagadas com a morada | `order/evidence.ts:68`; `arbiter/evidence.ts:45` e `:49`; `orders.ts:624` e `:120` | `orders`: os três testes Q19; `fork-orders`: 16.5 (contestação) | passam |
| Q20 | J5, O4, I1 e I10: as saídas por tempo são disparadas quando os prazos passam | `keptraOrders.ts:278` e `:293`; `chain.ts:809` | `orders`: os testes Q20 e os testes AR2; `fork-orders`: 16.5 | passam |
| Q21 | H8, H9, J1, 11.9 e 11.10: os vouchers que o núcleo já não entrega são anulados | `keptraOrders.ts:377` | `orders`: "H8, H9, J1: a voucher the core can no longer deliver…" e o teste AR2 da leitura dos vouchers; `fork-orders`: H9 e 16.3 | passam |

### Ramp

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q22–Q25 | 14.1 a 14.3, 16.7 e C4 do ramp | — | — | Fora da construção (P8 a P10) |

### Transversais

| # | Requisito | Onde está | Teste | Resultado |
|---|---|---|---|---|
| Q26 | F7: cada rota que chama o RPC declara a sua duração | `config.ts:1054` (`ROUTE_MAX_DURATION_SECONDS`); `vercel.json` | `orders`: "F7: the four order routes that reach the chain…" | passa |
| Q27 | C1: todas as reservas de tempo são constantes do mapa | `config.ts:764` (`EVERY_RESERVATION_MS`), com as reservas do fecho em `:692` e `:694` | `orders`: "C1 and P12: every reservation of the orders pass…"; `keptra`: AF8 e AC1 | passam |
| Q28 | D6: privilégio mínimo nas tabelas novas; a migration fica só como ficheiro | `0013:160-198` | `orders`: os testes do motor Q28; `fork-orders`: "pieces 2 and 3 run from the creation code of 183a2b4…" | passam |
| Q29 | H1 da SPEC-BRIDGE-V2: superfície de assinatura com endereços e funções literais | `abi.ts:1140` e `:1148`; `chain.ts:787` | `orders`: "P13: the list of what the bridge signs is closed and counted…"; `fork-orders`: "P13: every function the bridge encodes…" | passam; o reforço do teste é o P5-6 |
| Q30 | 2.3 e I12: nenhuma chave do servidor move valor de um utilizador | Asserção da passkey na relay | `orders`: "2.3 and I12: every order action is sent only with the passkey’s signature…"; `fork-orders`: GS026 | passam |
| Q31 | P12: custo real de uma encomenda | Medido no fork | `fork-orders`: "P12: the cost of one order, measured on the fork (gas)…", com os valores no título | passa |
| Q32 | A16, F12 e secção 19: sem dependências novas; o runner falha com código de saída | `test/bridge-v2/verdict.mjs`; `package.json` sem alterações | `orders`: "P24: the three contract addresses are literals…"; o código de saída do runner | passa |

## 2. Adenda P

| # | Decisão | Onde está | Teste | Resultado |
|---|---|---|---|---|
| AP1 | Lojas, marcas e destinatários agem com uma conta Keptra, através da relay | `relay.ts:589-800` | `orders` e `fork-orders`: os testes AP1 | passam |
| AP2 | A loja identifica-se pela sessão; a conta de criador é a loja das condições | `relay.ts:261`; `store/orders.ts:34`; `store/tracking.ts:60` | `orders`: "10.2 and P2…"; "P1 and P2: the store acts from its creator account…" | passam |
| AP3 | Os avisos vão só por email | `keptraOrders.ts:436` | `orders`: "P3: every order notice goes by email only…" | passa |
| AP4 | A janela de uma recusa também é avisada | `keptraOrders.ts:418` | `orders`: os testes AP4 | passam |
| AP5 | O mesmo telefone conta uma vez por loja; a própria loja nunca conta | `keptraOrders.ts:597` e `:252`; `0013:145` | `orders`: os testes AP5, os testes AR1 e AR2 (resolução da marca); `fork-orders`: 16.4 | passam |
| AP6 | Teste real na Ship24 do código postal devolvido | — | — | É tarefa do owner; a construção não fica à espera |
| AP7 | À Ship24 vão só o número, o código postal e o país | `ship24.ts:25` | `orders`: os testes AP7 | passam; a página de privacidade e o DPA são do owner |
| AP8–AP10 | O ramp sai desta construção | — | — | Fora |
| AP11 | Saídas por tempo e anulação de vouchers pelo keeper, sem o tecto partilhado | `chain.ts:809`; `keptraOrders.ts:293` | `orders` e `fork-orders`: os testes AP11 | passam |
| AP12 | Atraso máximo de 1 hora para as saídas e para o aviso das 24 horas | `cron/process.ts:41` (a cada minuto, `vercel.json`); os fechos correm depois das saídas e dos avisos (`keptraOrders.ts:134-139`) | `orders`: os testes AP12 | passam |
| AP13 | A lista de formas que a bridge assina é fechada e contada | `abi.ts:1140`, `:1148`; `chain.ts:872` | `orders` e `fork-orders`: os testes AP13 | passam; o reforço do teste é o P5-6 |
| AP14 | As marcações contam para o tecto partilhado e correm sob o lock da publicação das raízes | `keptraOrders.ts:620`; `cron/process.ts:41` | `orders`: os testes AP14; `fork-orders`: 16.4 | passam |
| AP15 | No modo COMPRA, uma morada fora das regiões é recusada antes do pagamento | `order/address.ts:57`; `relay.ts:598` | `orders`: "P15: in COMPRA an address outside the regions…" | passa; a corrida da morada é o P5-2 |
| AP16 | Contestar, confirmar e cancelar ficam fora do limite de 20 e do tecto | `relay.ts:244` | `orders`: "P16…"; `fork-orders`: 16.5 | passam |
| AP17 | Evidências (corrigida pela AQ3): texto cifrado, lido pelas partes e pelo árbitro, apagado com a morada | `orders.ts:624`, `:120` e `:412`; `order/evidence.ts:68`; `arbiter/evidence.ts:49` | `orders`: os testes AP17, incluindo o AR1 | passam; a exportação das evidências é o P5-7 |
| AP18 | Com encomendas abertas, o apagamento a pedido espera pelo estado final e avisa | `orders.ts:455`; `privacy/erase.ts:75` | `orders`: "P18: an erasure request…" | passa |
| AP19 | Campos da morada | `orders.ts:82` | `orders`: os testes AP19 | passam |
| AP20 | As chaves novas derivam de uma raiz existente, com etiqueta própria | `orders.ts:50-53` | `orders`: os testes AP20 | passam; a documentação da migration é o P5-8 |
| AP21 | Só contas Keptra | `order/address.ts` (sem conta, 409) | `orders`: os testes AP21 | passam |
| AP22 | Avisos à loja quando a encomenda é paga, e ao árbitro quando há contestação | `keptraOrders.ts:418` e `:466` | `orders`: os testes AP22 | passam |
| AP23 | Entregabilidade dos emails | — | — | É tarefa do owner (DNS) |
| AP24 | Endereços dos contratos (corrigida pela AQ1) | `config.ts:45-47`; `orders.ts:40` e `:45` | `orders`: os testes AP24; `fork-orders`: "pieces 2 and 3…" | passam |
| AP25 | Facto para a peça 4 (P4-5) | — | — | Vai para o lote antes do deploy |
| AP26 | Factos da peça 1 (P1-10 e P1-11) | — | — | Vão para o lote antes do deploy |

## 3. Adenda Q

| # | Decisão | Onde está | Teste | Resultado |
|---|---|---|---|---|
| AQ1 | Endereços literais, a zero até ao deploy; enquanto estiverem a zero, as rotas e os passos recusam-se a correr | `config.ts:45-47`; `orders.ts:40-47`; `keptraOrders.ts:120` | `orders`: os três testes AQ1 | passam. "O ensaio geral falha" é da peça 7, e não é verificável aqui (P5-9) |
| AQ2 | O árbitro assina um desafio de validade curta, comparado com `escrow.arbiter()` no momento; o aviso vai para um email configurado | `arbiter/evidence.ts:45` e `:49`; `orders.ts:125`; `config.ts:655`; `keptraOrders.ts:466` (`BRIDGE_V2_ARBITER_EMAIL`) | `orders`: "P17 as answered: the arbiter reads both texts…" | passa |
| AQ3 | Dois textos, um de cada parte, e o hash cobre os dois | `orders.ts:120` e `:624` | `orders`: "P17: while contested each party writes one text…"; `fork-orders`: 16.5 | passam |
| AQ4 | A loja ou a marca é avisada em toda a encomenda que abre, por pagamento ou por resgate | `keptraOrders.ts:418` (`STORE_ORDER` em PAID) | `orders`: "P3: every order notice… the brand is told on a redemption too" | passa |
| AQ5 | As nove decisões da construção (ver abaixo) | Ver abaixo | `orders`: os testes AQ5 | passam |
| AQ6 | As migrations 0012 e 0013 são aplicadas por esta ordem antes do deploy | Tarefa do owner. O motor da suite aplica 0004 a 0013, duas vezes | `orders`: os testes do motor Q28 | É um passo do owner, não código |
| AQ7 | Depois do lote, o código de criação dos testes de fork é gerado outra vez | `test/bridge-v2/fork/keptra-5d85a46.json` (gerado de 5d85a46 no lote AA4) | `fork-orders`: "fork (Q7, Z1): pieces 2 and 3 run from the creation code of 5d85a46…" (etiqueta `AA-Q7`) | passa (lote AA4) |

As nove decisões da AQ5:

| Decisão | Onde está | Teste (`orders`) |
|---|---|---|
| Moradas, evidências e tracking derivam da mesma raiz, com etiquetas próprias; essa raiz não é rodável | `orders.ts:50-53` | "10.2 and P19…" |
| O passe corre a cada minuto, junto do ciclo de vida e sob o mesmo lock; o apagamento e a nova tentativa de registo correm de hora a hora | `cron/process.ts:41`; `keptraOrders.ts:539` e `:551` | "P14: the marks run in the pipeline…" |
| A atestação do resgate vale 1 hora, e os prazos usam o relógio da cadeia | `config.ts:651`; `relay.ts:621` | "H7: a redemption is prepared…" |
| As acções do destinatário correm na conta de participante; as da loja e da marca, na conta de criador | `relay.ts:247` e `:261` | "P1 and P2: the store acts from its creator account…" |
| Uma campanha com vouchers leva no máximo 20 vouchers e exige telefone verificado | `config.ts:672`; `relay.ts:753` | "P1 and H9: a voucher campaign…" |
| As evidências só se escrevem numa encomenda contestada, e não se alteram depois | `order/evidence.ts:68`; `0013` (chave primária por parte) | "P17: evidence is written only while the order is contested" |
| O apagamento corre aos 29 dias | `config.ts:649` | "10.3: at the final state…" |
| Tecto da Ship24: 30 registos por hora e 100 por dia | `config.ts:147` | "9.5.5: a provider that fails blocks nothing…" |
| A lista do oráculo roda por janelas de 15 minutos | `config.ts:666`; `orders.ts:576` | "B4: past 13 the list rotates…" |

## 4. Adenda R

| # | Decisão | Onde está | Teste | Resultado |
|---|---|---|---|---|
| AR1 | M1: uma falha a meio do fecho nunca deixa uma encomenda fechada sem data de apagamento, nem com a marca por resolver. A passagem seguinte retoma o que ficou por fazer | `keptraOrders.ts:502` (os fechos) e `:518`: primeiro a data de apagamento (`:520`), depois o resultado, a marca (`:529`) e, só no fim, o registo do fecho (`closed_at`). `orders.ts:380`: o passe relê toda a encomenda sem `closed_at`. `0013:81` (índice). `keptraOrders.ts:205`: a encomenda fechada guarda o bloco onde a busca continua | `orders`: "R1 (M1): a close cut short at any of its writes is not recorded…", que corta cada uma das cinco escritas do fecho; "R2 (B1): out of time in the middle of the log…" | passam |
| AR2 | B1: um erro numa encomenda não impede as saídas por tempo, os avisos nem as marcas das outras. A leitura dos fechos funciona com um fornecedor RPC que limita o intervalo de blocos | Por encomenda: `keptraOrders.ts:164` (índice; `:193`: uma encomenda nova que falha guarda as seguintes para o passe seguinte), `:305` (a leitura dos vouchers falha sozinha), `:458` (avisos), `:591` (marcas), `:502` (fechos). A busca do log: `escrowChain.ts:168`, até `ORDER_LOG_SPAN_BLOCKS` (`config.ts:680`) por pedido; um pedido recusado repete com metade do intervalo (`:192`); o relógio é consultado antes de cada pedido (`:177`), e o bloco atingido fica guardado. Reservas: `config.ts:692` e `:694` | `orders`: "R2 (B1): an order whose exit, notice or mark fails…"; "R2 (B1): an order whose scan fails does not stop the pass…"; "R2 (B1): the close is read from the log through a provider that limits the block range…"; "R2 (B1): out of time in the middle of the log…" | passam |
| AR3 | A matriz fica no repositório, com a versão da spec em vigor e as Adendas P, Q e R | Este ficheiro | `orders`: "R3: this matrix is in the repository…" | passa |
| AR4 | Sai o excesso: o parâmetro da janela de contestação, o tipo de registo nunca emitido, os campos devolvidos que ninguém lê e o hash de tracking na resposta à loja. Fica a lista do destinatário | `config.ts:641` (só resta `ESCROW_ARBITER_WINDOW_SECONDS`); `log.ts:123` (sem `order.refused`); `escrowChain.ts:168` (sem `material`) e `:216` (sem `units` nem `openUnits`); `store/orders.ts:40` (sem `trackingHash`); `order/list.ts:16` (fronteira com a peça 6) | `orders`: "R4: what no flow reads is gone…" | passa |
| AR5 | Pendentes da peça 5, para o lote antes do deploy | Secção 6 | — | Ficam no lote; não pedem código nesta correcção |
| AR6 | A marca do destinatário guarda o hash do telefone sem prazo, e nunca o telefone | `0013:139` (`phone_hmac`); `0013:145` | `orders`: "0013: a number counts once per store among the live marks…" | Fronteira aceite. A página de privacidade declara-a (tarefa do owner) |

## 5. Fronteira com a peça 6

A peça 5 expõe estas rotas, todas em `/api/bridge/v2`:
- **Morada:** `order/address`.
- **Lista do destinatário:** `order/list`. É a rota que a peça 6 lê. A spec não a pede; fica por decisão da AR4 e declara-se aqui e no cabeçalho da rota.
- **Evidências:** `order/evidence`.
- **Lado da loja:** `store/orders` e `store/tracking`.
- **Relay:** `account/relay`, com as acções da P1.

A peça 6 fica com:
- o código de entrega (gerado no dispositivo, com o QR);
- as condições e as regiões antes do pagamento;
- a página de assinatura (C12);
- o painel do pool (12.7).

## 6. Pendentes da peça 5 (AR5), no lote antes do deploy

Juntam-se a G3, J6, K2 e O2:
- **P5-1 (B2):** um fecho que caia entre as duas leituras do passe nunca deixa a marca do destinatário por resolver.
- **P5-2 (B3):** uma morada não abre duas encomendas, e uma encomenda paga tem sempre morada.
- **P5-3 (B4):** um envio recusado de forma permanente sai da fila de novas tentativas, e as encomendas fechadas nunca entram nela.
- **P5-4 (B5):** o passe processa todas as encomendas abertas, qualquer que seja o número.
- **P5-5 (B6):** o pior caso da rota de processamento é medido e declarado por item.
- **P5-6 (B7):** o teste da P13 conta os locais onde a bridge assina.
- **P5-7 (B8):** a exportação inclui as evidências escritas pelo próprio participante.
- **P5-8 (B9):** a documentação da migration diz com que etiqueta é cifrado o número de tracking.
- **P5-9 (B10):** os títulos dos testes dizem o que o teste demonstra, e nenhum teste lê ficheiros de outro repositório.
- **P5-10:** as janelas de rotação da lista do oráculo não coincidem com o disparo do oráculo.

## 7. Como correr

- `npx tsc --noEmit`
- `ANVIL_BIN=<caminho do anvil.exe> npm run test:bridge-v2`
  - Corre todas as suites e o fork, e imprime o mapa de requisitos.
  - O código de saída só é diferente de zero quando falha um teste fora das três falhas de base declaradas (I5, J2 e G4).

## 8. Adenda AA — o lote antes do deploy (AA4)

Perguntas ao owner nesta sessão: nenhuma sobre a peça 5 (as três da sessão estão na matriz da peça 1). A etiqueta dos pendentes é o seu nome; B8, Y5, Q7 e T18 levam o prefixo `AA-` (os nomes nus já são de outras linhas).

| # | Pendente | Onde está | Teste | Resultado |
|---|---|---|---|---|
| P5-1 | Um fecho entre as duas leituras do passe nunca deixa a marca por resolver | `keptraOrders.ts:650` (o bloco mais recente, lido depois das encomendas, é o limite da busca); `escrowChain.ts:111` | `orders`: "P5-1: a close that lands between the pass’s two reads…" (`orders.test.mjs:1558`) | passa |
| P5-2 | Uma morada não abre duas encomendas; uma encomenda paga tem sempre morada | `orders.ts:180` (reclamação exclusiva, uma escrita condicional); `relay.ts:1169` (reclamada antes do envio, devolvida sem envio ou com revert, ligada pelo recibo); `keptraOrders.ts:355` (a passagem liga pelo recibo da própria reclamação) e `:335` (fora da relay, só uma morada não reclamada); `0015:48` | `orders`: "P5-2: one address opens one order…" (`:1589`); "P5-2: the orders pass settles every claim…" (`:1623`); "Q14 and P5-2…" (`:893`); `keptra`: "0015 for piece 5…" | passam |
| P5-3 | Um envio recusado de forma permanente sai da fila; as encomendas fechadas nunca entram nela | `ship24.ts:32` (400, 404, 422 = recusa); `orders.ts:719`; `keptraOrders.ts:753`; o fecho pára as novas tentativas (`keptraOrders.ts`, `closeOne`); `0015:63` | `orders`: "P5-3: a shipment the provider refuses for what it is…" (`:1654`) | passa |
| P5-4 | O passe processa todas as encomendas abertas, qualquer que seja o número | `orders.ts:492` (o índice lido por páginas, a menos recente primeiro); `keptraOrders.ts:201` (páginas alternadas entre conhecidas e novas); `orders.ts:896` (avisos lidos em blocos) | `orders`: "P5-4: the pass reads every open order whatever their number…" (`:1688`) | passa |
| P5-5 | O pior caso da rota de processamento é medido e declarado por item | `config.ts:752` (`ORDER_SYNC_MS`) e `:787` (`VOUCHER_CHECK_MS`); `keptraOrders.ts:230` e `:530` | `orders`: "P5-5: the processing route’s worst case is declared per item…" (`:1716`) | passa |
| P5-6 | O teste da P13 conta os locais onde a bridge assina | o próprio teste: percorre `lib/bridge-v2` e `api` e lê as formas das funções que assinam | `orders`: "P5-6 (P13): the places the bridge signs are counted in its own source…" (`:1737`) | passa |
| P5-7 | A exportação inclui as evidências escritas pelo próprio participante | `orders.ts:847`; `api/bridge/v2/privacy/export.ts:73` | `orders`: "P5-7 (D7): the export carries the evidence the participant wrote…" (`:1783`) | passa |
| P5-8 | A documentação da migration diz com que etiqueta é cifrado o número de tracking | `supabase/migrations/0013_keptra_orders.sql:15` e a linha do `tracking_enc` (`order-address-enc-v1`) | `orders`: "P5-8: migration 0013 says with which label…" (`:1799`) | passa |
| P5-9 | Os títulos dizem o que o teste demonstra; nenhum teste lê ficheiros de outro repositório | `test/bridge-v2/giveaway-core.json` (cópia do núcleo); `contracts.test.mjs:55`; `orders.test.mjs` (a typehash e o domínio lidos da fixture de 5d85a46); títulos revistos: Q9 (B8), B4 (P5-10), Q14 (P5-2), R2 (P5-12), P13 (P5-6), F1 (P1-4), E7 (D-FUNDING), F2 e KM34 (P1-9) | `orders`: "P5-9: no test reads a file of another repository…" (`:1811`) | passa |
| P5-10 | As janelas de rotação da lista do oráculo não coincidem com o disparo do oráculo | `config.ts:721` (meia janela de desvio); `orders.ts:821` | `orders`: "P5-10: the rotation of the oracle’s list turns half a slot away…" (`:1822`); "B4…" (`:629`) | passam |
| P5-11 | A reserva de um fecho cobre todo o trabalho depois da última leitura do registo | `config.ts:766` (o que falta ao fecho) e `:777` | `orders`: "P5-11: a further read of the log reserves the whole rest of the close…" (`:1833`) | passa |
| P5-12 | Uma encomenda nova que falhe sempre não impede a descoberta das seguintes; fica à parte, com alerta | `keptraOrders.ts:251` (página lida uma a uma quando falha) e `:284`; `orders.ts:524`; `0015:75` | `orders`: "R2 (B1) and P5-12…" (`:1430`); `keptra`: "0015 for piece 5…" | passam |
| P5-13 | Um bloco actual anterior ao guardado nunca conta como fecho sem resultado | `keptraOrders.ts:678` | `orders`: "P5-13: a node answering with a block before…" (`:1575`) | passa |
| P5-14 | Nenhum teste passa ou falha por acaso; o código postal em claro não coincide com um identificador aleatório | `orders.test.mjs` (`ADDRESS` com espaços em todos os valores; o número de tracking verificado campo a campo e pela decifra) | `orders`: "10.2 and P19… (P5-14)" (`:301`); "P5-14: what is searched for “in clear” can never be matched by chance…" (`:1844`) | passam |
| AA-B8 | A bridge mantém na lista do oráculo uma encomenda numa janela aberta por declaração, até ao fim dessa janela (X10, Y5) | `orders.ts:761` e `:784` | `orders`: "N7 and B5, B6, B7… (B8)" (`:611`); `fork-orders`: "B8 and Y5 on the fork, against the escrow of 5d85a46 (X10)…" (`orders.fork.mjs:492`) | passam |
| AA-Y5 | Os avisos tratam uma janela declarada que fecha por recusa do oráculo antes do fim | `keptraOrders.ts:709` e `:719` (o fecho só é gravado depois de avisado); `mail.ts:410`; `0015:90` | `orders`: "Y5 (X10)…" (`:1860`); `fork-orders`: "B8 and Y5 on the fork…" | passam |
| AA-Q7 | O código de criação dos testes de fork passa a ser o de 5d85a46 | `test/bridge-v2/fork/keptra-5d85a46.json` | `fork-orders`: "fork (Q7, Z1)…"; `fork-orders`: "B8 and Y5 on the fork…" | passam |

O que muda para o owner antes do deploy: a migration `0015_keptra_lote.sql` também traz a parte da peça 5; `vercel.json` passa `store/tracking` a 158 s.

## 9. Adenda AB — AB3 e AB5 (23/09)

A etiqueta é o nome da decisão (`AB3`, `AB5`).

| # | Decisão | Onde está | Teste | Resultado |
|---|---|---|---|---|
| AB3 | B1: uma morada reservada para um pagamento ou um resgate nunca fica presa — sem envio volta a estar disponível; com envio fica ligada à encomenda que ele abriu, mesmo que a escrita do hash tenha falhado | `lib/bridge-v2/relay.ts:1244` (a escrita do hash falhada não pára a espera: o recibo liga a morada); `lib/bridge-v2/keptraOrders.ts:410` (uma reserva sem hash, mais velha que a rota da relay, liga-se à encomenda que as contas do participante abriram para a mesma oferta ou voucher desde a reserva, ou é devolvida quando o índice tem todas as encomendas da cadeia e nenhuma é dela; com o índice atrás, espera); `lib/bridge-v2/orders.ts:233` e `:260` | `orders`: "AB3 (B1): a payment whose write of the transaction hash fails…" (`test/bridge-v2/suites/orders.test.mjs:1900`); "AB3 (B1): a claim with no transaction written never stays taken…" (`:1926`) | passam |
| AB5 | B3: um aviso que o fornecedor de email recusa sempre não impede o fecho de uma janela recusada de ficar registado, e não gasta uma unidade de email em cada passe | `lib/bridge-v2/mail.ts:35` (uma resposta 4xx que não 408 nem 429 é recusa da própria mensagem); `lib/bridge-v2/keptraOrders.ts:836` (gravado como recusado, com alerta, nunca mais enviado), `:820` (o fecho da janela recusada segue); `lib/bridge-v2/orders.ts:999`; `supabase/migrations/0015_keptra_lote.sql:128` (`refused_at`) | `orders`: "AB5 (B3): a notice the email provider refuses for what it is…" (`test/bridge-v2/suites/orders.test.mjs:1963`); `keptra`: "0015 for AB5 and AB6…" (`test/bridge-v2/suites/keptra.test.mjs:3527`), no Postgres embebido | passam |

Uma recusa de momento (5xx, 408, 429, sem resposta) continua a ser tentada outra vez, e o fecho continua à espera dela, como a Y5 pediu.
