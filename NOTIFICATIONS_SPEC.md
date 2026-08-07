# NOTIFICATIONS_SPEC — notificações transaccionais aos jogadores

**Estado:** Fase 1, investigação e proposta. Documento de decisão.
**Data:** 2026-08-07
**Contrato:** RaffleManagerV3 `0xB1935f2d6D0A8dEb7cfB074b17f179fd842d324a`, Arbitrum One.

Esta sessão **não implementa nada**. Sem código de produção, sem chaves, sem envios.

---

## 0. O problema a resolver

O V3 paga por **pull-payment**: a liquidação credita `claimable[vencedor]` mas não transfere nada. O dinheiro só sai quando o vencedor chama `claim()`. É o desenho certo — impede que um destinatário hostil ou bloqueado trave a liquidação de toda a gente — mas cria um problema humano:

> **Um vencedor que não sabe que ganhou nunca faz claim, e o prémio fica no contrato para sempre.**

O mesmo se aplica aos reembolsos: uma ronda cancelada deixa `claimRefund(roundId)` disponível, e quem não souber não reclama.

**Restrição inegociável (decisão do Anderson):** apenas comunicação de serviço a quem **já interagiu com o protocolo** e/ou fez **opt-in explícito**. Proibido qualquer desenho que envie mensagens a wallets que nunca jogaram, listas frias, ou descoberta de audiência. Isto é serviço transaccional, não marketing.

---

## 1. Avaliação das opções

### 1.a Push Protocol — **NÃO RECOMENDADO: risco de abandono**

**Como funciona.** Cria-se um "canal" on-chain; os utilizadores **subscrevem** o canal (opt-in explícito, on-chain); o dono do canal envia notificações via SDK; os utilizadores recebem na app Push, no site push.org, e em carteiras/dapps que integrem o inbox.

**Custo de criação:** **50 PUSH** mais gas. A PUSH está a **$0,005179** (CoinGecko, 2026-08-07), portanto 50 PUSH ≈ **$0,26**. Em dinheiro, é nada.

**Mas o preço é o próprio sinal de alarme.** O volume diário da PUSH é de **~$56 800**. Um token de infraestrutura com esse volume não sustenta uma equipa. E os indicadores acumulam:

| Indicador | Facto verificado |
|---|---|
| push.org | A homepage é **inteiramente sobre "Push Chain — the Universal Blockchain for Apps"**. Não menciona notificações, canais ou subscritores em lado nenhum. |
| `push-protocol/push-dev-docs` | Repositório devolve **404** na API do GitHub — removido ou renomeado |
| `push-protocol/push-smart-contracts` | Vivo mas parado: último push **2026-02-11**, há ~6 meses |
| Docs em comms.push.org | Ainda de pé, sem aviso de descontinuação |
| PUSH token | $0,005179, volume 24h ~$56,8k |

**Leitura:** o projecto pivotou para uma L1 e as notificações ficaram em modo de manutenção, na melhor das hipóteses. A documentação ainda estar de pé não é garantia de nada — foi exactamente o que se passou com a Reown (ver 1.d).

**Alcance:** limitado a quem tenha a app Push instalada **e** subscreva o canal. Para os nossos jogadores, isso é uma segunda app a instalar para receber avisos de uma rifa.
**Esforço:** médio — criar canal, integrar SDK de envio, integrar widget de subscrição.
**Risco:** **alto.** Construir sobre infraestrutura em declínio para um problema que é crítico (dinheiro por reclamar).

### 1.b XMTP — viável, mas com um tecto de alcance que decide tudo

**Como funciona.** Mensagem 1:1 encriptada endereço-a-endereço. O nosso backend teria uma identidade XMTP e enviaria DMs às wallets vencedoras.

**O requisito que manda:** o destinatário **tem de ter uma identidade XMTP activa**. Uma wallet que nunca ligou o XMTP **não é alcançável**. Existe `Client.canMessage([{identifier, identifierKind}])` (e `canMessageStatic`) precisamente para verificar antes de tentar — devolve um mapa `endereço → booleano`.

Isto tem uma consequência que joga a nosso favor e contra:
- **A favor:** é impossível fazer spam a quem nunca activou o XMTP. O protocolo impõe, na prática, um filtro de alcance.
- **Contra:** os nossos vencedores muito provavelmente **não têm** XMTP activo. Não é uma coisa que um jogador de rifa faça.

**Alcance real.** A rede está viva: desde o v3, **228 milhões de mensagens** e **15 milhões de registos de identidade**. A Coinbase Wallet integra XMTP, o que dá alcance real a quem use essa carteira. Mas 15M de identidades no mundo inteiro, contra uma audiência nossa de **4 wallets**, não é uma estatística que ajude.

**Custo:** gratuito para o utilizador; quem constrói paga **~$5 por 100 000 mensagens**. Ao nosso volume, é zero.
**Esforço:** médio — identidade XMTP para o backend, gestão de chaves, `canMessage` antes de cada envio.
**Manutenção:** **activa e saudável** — `xmtp/xmtp-js` com push em 2026-06-21 e actualização em 2026-08-03.

**Risco:** baixo em fiabilidade, **alto em cobertura**. Podemos integrar tudo direito e não alcançar ninguém, porque o `canMessage` devolve `false` para todos.

### 1.c Web2 opt-in (e-mail / Telegram) no nosso backend — **RECOMENDADO**

**Como funciona.** No site, um toggle explícito. O jogador liga a wallet, activa "Notify me when I win" e dá um e-mail ou liga o Telegram. Guardamos `wallet → canal de contacto` com registo de consentimento. Um worker segue os eventos on-chain do V3 e envia.

**Alcance:** **100% de quem fizer opt-in.** É a única opção onde a cobertura depende de nós e não da adopção de terceiros.
**Custo:** Supabase free tier dá 500 MB de base de dados, **500 000 invocações de Edge Function/mês**, 50 000 MAU de auth. Ao nosso volume, **$0**. O envio de e-mail precisa de um fornecedor (Resend/Postmark/SES); a tiers gratuitas cobrem largamente centenas de mensagens/mês.
**Esforço:** médio-baixo — uma tabela, um toggle, um worker.
**Riscos:**
- **O free tier da Supabase pausa o projecto ao fim de 7 dias de inactividade.** Para um worker que corre a cada poucos minutos isto não dispara, mas é um risco a conhecer; o plano Pro são $25/mês.
- **Somos nós os responsáveis pelos dados pessoais.** Um e-mail é dado pessoal e cai no RGPD: precisa de base legal, de política de privacidade, de direito ao apagamento. Um endereço de wallet já é pseudónimo; um e-mail associado a ele deixa de o ser. É a contrapartida real desta opção, e é de natureza legal, não técnica.
- **Centralização.** Se o nosso backend cair, não há notificações. Mitigado pelo facto de o dinheiro estar sempre reclamável on-chain sem depender de nós.

### 1.d Reown / WalletConnect Notify — **MORTO. Não usar.**

Não estava na lista da tarefa, mas seria o candidato mais natural, porque o site **já usa o conector WalletConnect**. Investiguei-o por isso — e está descontinuado:

| Verificação | Resultado |
|---|---|
| `WalletConnect/web3inbox` (GitHub API) | **`"archived": true`**, último push **2025-12-05** |
| `docs.reown.com/appkit/next/notifications/overview` | **HTTP 404** |
| `docs.reown.com/appkit/javascript/notifications/backend-integration` | **HTTP 404** |
| `reown-com/reown-docs/docs.json` (config de navegação actual) | **Nenhuma página ou grupo com "notification" ou "notify"** |

Os motores de busca ainda servem estas páginas, mas as páginas já não existem. **Serve de aviso para o Push:** documentação online não prova produto vivo.

### Resumo comparativo

| | Alcance esperado | Custo | Esforço | Risco |
|---|---|---|---|---|
| **Push Protocol** | Baixo (requer app Push + subscrição) | ~$0,26 + gas | Médio | **Alto** — projecto pivotou, token a $0,005 |
| **XMTP** | **Perto de zero hoje** (requer identidade XMTP) | ~$0 ao nosso volume | Médio | Cobertura, não fiabilidade |
| **Web2 opt-in** | **100% de quem fizer opt-in** | **$0** no free tier | Médio-baixo | RGPD + centralização |
| **Reown Notify** | — | — | — | **Descontinuado** |

---

## 2. Fluxo dos três eventos de serviço

**Fonte dos destinatários: exclusivamente os eventos on-chain do V3.** Nenhuma outra lista, nunca. Um endereço só entra numa fila de notificação se aparecer num evento que o próprio contrato emitiu.

### 2.1 "Ganhaste X USDC na ronda N — faz claim"

```
gatilho   PrizeAwarded(roundId indexed, winner indexed, rank indexed, amount)
destinat. o `winner` do próprio evento, e mais ninguém
condição  optIn(winner) == true  E  claimable(winner) > 0
conteúdo  ronda, posição, montante, link directo para /play/raffle
repetição no máximo 1 imediata + 1 lembrete a 24h + 1 a 7 dias, e para
          cancela   se claimable(winner) == 0 (já reclamou)
```

O lembrete é o ponto todo desta funcionalidade: é o vencedor silencioso que perde dinheiro.

### 2.2 "Ronda N cancelada — o teu refund está disponível"

```
gatilho   RoundCancelled(roundId indexed, reason, participantCount)
destinat. participantes dessa ronda, obtidos do contrato, não de uma lista nossa:
            participantCount(roundId) + purchaseAt(roundId, i) → comprador
          filtrar por ticketsOf(roundId, addr) > 0 && !refunded(roundId, addr)
condição  optIn(addr) == true
conteúdo  ronda, motivo em linguagem simples ("menos de 3 participantes" ou
          "o sorteio não respondeu a tempo"), montante = tickets × 1 USDC
repetição imediata + lembrete a 24h; cancela quando refunded(roundId,addr) == true
```

Nota: uma ronda cancelada **sem bilhetes** não notifica ninguém, porque não há participantes. E o seed devolvido ao `pendingCarry` não pertence a ninguém — não gera notificação.

### 2.3 "Claim confirmado — X USDC na tua wallet"

```
gatilho   Claimed(account indexed, amount)   [e RefundClaimed para reembolsos]
destinat. o `account` do próprio evento
condição  optIn(account) == true
conteúdo  montante, hash da transacção, link para o Arbiscan
repetição exactamente uma, sem lembretes
```

É um recibo. Fecha o ciclo e serve de prova de que o dinheiro chegou.

### 2.4 Arquitectura do worker

```
Arbiscan/RPC ──(getLogs por bloco)──> worker ──> tabela `notification_queue`
                                                        │
                          filtro de consentimento ───────┤
                          (optIn = true, senão descarta) │
                                                        v
                                              envio (e-mail / Telegram)
                                                        │
                                              tabela `notification_log`
```

Regras invioláveis do worker:

1. **Um endereço nunca entra na fila sem ter aparecido num evento do V3.** A origem é sempre um log, não uma consulta a uma tabela de utilizadores.
2. **O consentimento é verificado no momento do envio**, não no da enfileiragem. Se o jogador revogou entretanto, a mensagem é descartada.
3. **Sem opt-in não há registo.** Um endereço que ganhe e não tenha opt-in não é guardado em lado nenhum — o evento é ignorado e passa-se à frente.
4. **Idempotência por `(txHash, logIndex, tipo)`.** Uma reorganização de blocos ou um reinício do worker não pode gerar duplicados.
5. **Sem correlação entre wallets.** Cada wallet é uma linha independente. Nunca agrupar por e-mail para inferir que duas wallets são a mesma pessoa.

---

## 3. Opt-in no site

Um toggle na página do raffle, junto ao painel de compra:

```
🔔 Notify me when I win
   [  toggle  ]
   ┌─────────────────────────────────────────────┐
   │ Email    [ voce@exemplo.com            ]    │
   │                                             │
   │ ☐ I agree to receive service notifications  │
   │   about my own rounds: prizes to claim,     │
   │   refunds available, and claim receipts.    │
   │   Nothing else. Unsubscribe any time.       │
   │                                             │
   │              [ Save ]                       │
   └─────────────────────────────────────────────┘
```

**O que guarda**

| Campo | Descrição |
|---|---|
| `wallet` | endereço, em minúsculas, **chave primária** |
| `channel` | `email` ou `telegram` |
| `destination` | o e-mail ou chat id |
| `consent_at` | timestamp do consentimento |
| `consent_text_version` | versão exacta do texto aceite |
| `verified_at` | timestamp da confirmação do canal (duplo opt-in) |
| `revoked_at` | preenchido ao revogar; a linha **nunca** é reutilizada depois |

**Como se prova que foi mesmo o dono da wallet**

Uma assinatura SIWE (`personal_sign`) da mensagem de consentimento, guardada com o registo. Sem isso, qualquer pessoa poderia inscrever a wallet de outra — e transformávamos o sistema num vector de spam contra terceiros. **A assinatura é obrigatória.**

**Duplo opt-in.** O e-mail só fica activo depois de o dono clicar no link de confirmação. Impede que se inscreva o endereço de outra pessoa.

**Como se revoga**

- No site: o mesmo toggle, desligado. Efeito imediato.
- Em qualquer mensagem: link de "unsubscribe" com token de uso único, sem exigir ligar a wallet.
- Revogar preenche `revoked_at` e **apaga `destination`**. Fica o registo de que houve consentimento e de que foi revogado, sem guardar o dado pessoal.

**O que nunca acontece**

- Nunca se envia a quem não tem `verified_at` preenchido e `revoked_at` vazio.
- Nunca se envia sobre rondas em que a wallet não participou.
- Nunca se envia conteúdo promocional. Só os três eventos da secção 2.
- Nunca se compram, importam ou inferem endereços.

---

## 4. Recomendação

### Web2 opt-in (e-mail), Fase 2. XMTP como camada extra opcional, Fase 3. Push, não.

**Fundamentação.**

**O dimensionamento manda em tudo.** Li a audiência real on-chain: em cinco rondas do V3, houve participantes numa única ronda, **4 wallets**. Integrar um protocolo de mensagens descentralizado para alcançar 4 pessoas — que quase de certeza não têm identidade XMTP nem a app Push instalada — é engenharia a resolver o problema errado. O problema é *chegar à pessoa*, e a via com 100% de cobertura garantida é aquela em que a pessoa nos diz onde a encontrar.

**Push está fora por risco de abandono.** O token a $0,005 com $57k de volume, a homepage inteiramente dedicada a outra coisa, o repositório de docs em 404 e os contratos parados desde Fevereiro compõem um quadro claro. E a Reown mostrou exactamente como isto acaba: documentação de pé, produto morto, repositório arquivado. Não construímos o caminho crítico de *"o vencedor recebe o dinheiro"* sobre isso.

**XMTP está tecnicamente saudável mas não alcança os nossos utilizadores hoje.** O `canMessage` diria `false` para praticamente todos. Fica como camada adicional para quando houver utilizadores de Coinbase Wallet — é barata de acrescentar depois, porque o worker e a fila já existirão.

**Custo total da recomendação: $0** enquanto couber nos free tiers, com $25/mês de Supabase Pro quando o volume ou a disponibilidade o justificarem.

### Plano por etapas para a Fase 2

| Etapa | Conteúdo | Depende de |
|---|---|---|
| **2.1** | Schema Supabase: `notification_optin`, `notification_queue`, `notification_log`. RLS a impedir leitura cruzada. Migração declarativa. | — |
| **2.2** | Endpoint de opt-in com verificação da assinatura SIWE server-side + e-mail de duplo opt-in. Revogação por token. | 2.1 |
| **2.3** | Toggle na UI do raffle, com o texto de consentimento versionado. | 2.2 |
| **2.4** | Worker de eventos: segue `PrizeAwarded`, `RoundCancelled`, `Claimed`, `RefundClaimed` do V3 a partir do bloco 492021006, com cursor persistido e idempotência por `(txHash, logIndex, tipo)`. | 2.1 |
| **2.5** | Envio + lembretes, com cancelamento quando `claimable == 0` ou `refunded == true`. | 2.3, 2.4 |
| **2.6** | Página de privacidade, e um "as minhas notificações" onde o jogador vê e apaga o que temos dele. | 2.2 |
| **3.x** | *(Opcional, mais tarde)* XMTP como canal alternativo: `canMessage` primeiro, e só envia se `true`. Reaproveita a fila. | 2.5 |

**Antes de começar a Fase 2, três coisas precisam de decisão tua:** quem é o responsável pelo tratamento dos dados para efeitos de RGPD, qual o fornecedor de e-mail, e se queres Telegram no primeiro lote ou só e-mail.

---

## 5. Verificado por mim vs. assumido

### Verificado — fui à fonte

- **Reown Notify / Web3Inbox está descontinuado.** `WalletConnect/web3inbox` devolve `"archived": true` na API do GitHub, último push `2025-12-05`. As duas páginas de documentação de notificações devolvem **HTTP 404**. O `docs.json` actual do `reown-com/reown-docs` **não tem nenhuma página com "notification" ou "notify"**.
- **Push: 50 PUSH para criar canal**, mais gas — lido na documentação oficial de criação de canal. A página lista Ethereum e Polygon; **não menciona Arbitrum**.
- **PUSH a $0,005179** com volume 24h de ~$56 800 (CoinGecko, 2026-08-07).
- **`push-protocol/push-dev-docs` devolve 404** na API do GitHub. **`push-protocol/push-smart-contracts` não está arquivado**, último push `2026-02-11`, 21 issues abertas.
- **push.org é inteiramente sobre Push Chain** e não menciona o produto de notificações.
- **XMTP exige identidade no destinatário**, com `canMessage` / `canMessageStatic` a devolver `endereço → booleano`.
- **`xmtp/xmtp-js` está vivo**: não arquivado, push `2026-06-21`, actualizado `2026-08-03`, 302 estrelas.
- **Supabase free tier**: 500 MB de base de dados, 500k invocações de Edge Function/mês, 50k MAU, **pausa após 7 dias de inactividade**.
- **A audiência real do V3**, lida on-chain: `participantCount` das rondas 1 a 6 = 0, 0, **4**, 0, 0, 0.

### Assumido / não verificado

- **Que os nossos jogadores não têm identidade XMTP.** É inferência a partir do perfil, **não medição**. É verificável em minutos com `canMessageStatic` sobre as 4 wallets conhecidas, e vale a pena fazê-lo antes de fechar a Fase 3 — se por acaso derem `true`, o XMTP sobe de prioridade.
- **Que o Push está efectivamente abandonado.** Os indicadores são fortes e convergentes, mas **não há aviso oficial de descontinuação** — as docs continuam a apresentar o produto como activo. É juízo meu sobre um conjunto de sinais, não um facto declarado pela Push.
- **Os $5 por 100 000 mensagens do XMTP** vêm de material citado em pesquisa, não de uma tabela de preços oficial que eu tenha aberto.
- **Preços de fornecedores de e-mail** não foram verificados; assumi que as tiers gratuitas cobrem centenas de mensagens/mês.
- **Nada foi testado.** Não criei canal, não enviei mensagem, não abri conta, não escrevi código. Não existe qualquer chave neste documento nem em qualquer ficheiro do projecto.
- **As implicações de RGPD estão assinaladas, não resolvidas.** Não sou aconselhamento jurídico, e a escolha da base legal e do responsável pelo tratamento é decisão que tem de ser tomada por ti.
