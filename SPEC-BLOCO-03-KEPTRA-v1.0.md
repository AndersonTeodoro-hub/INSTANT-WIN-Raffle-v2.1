# SPEC-BLOCO-03 — Keptra: contas, garantia e cumprimento verificável

Versão 1.31 — 23/09/2026. Substitui as v0.1 e v0.2.

Histórico de versões (o nome do ficheiro no repositório mantém-se; a versão é esta linha):
- 1.0: texto base (18/09)
- 1.1: Adenda A
- 1.2: Adenda B
- 1.3: Adenda C
- 1.4: Adenda D
- 1.5: Adenda E
- 1.6: Adenda F, primeira redacção
- 1.7: Adenda F com F4, F7 e F10 como resultados (19/09)
- 1.8: Adenda G — peça 1 fechada, regra de paragem das auditorias e lista de pendentes antes do deploy (19/09)
- 1.9: Adenda H — decisões da Fase A das peças 2 e 3 (19/09)
- 1.10: Adenda I — decisões da construção das peças 2 e 3, aceites pelo owner (20/09)
- 1.11: Adenda J — decisões da auditoria completa das peças 2 e 3 (20/09)
- 1.12: Adenda K — fecho das peças 2 e 3 (20/09)
- 1.13: Adenda L — decisões da Fase A da peça 4, o oráculo de entrega (20/09)
- 1.14: Adenda M — decisões da construção da peça 4 (20/09)
- 1.15: Adenda N — decisões da auditoria da peça 4 (20/09)
- 1.16: Adenda O — fecho da peça 4 (20/09)
- 1.17: Adenda P — decisões da Fase A da peça 5 (21/09)
- 1.18: Adenda Q — decisões da construção da peça 5 (21/09)
- 1.19: Adenda R — decisões da auditoria da peça 5 (21/09)
- 1.20: Adenda S — fecho da peça 5 (21/09)
- 1.21: Adenda T — decisões da Fase A da peça 6 (22/09)
- 1.22: T21 — computador e telemóvel (22/09)
- 1.23: Adenda U — decisões da construção da peça 6 (22/09)
- 1.24: Adenda V — decisões da auditoria da peça 6 (22/09)
- 1.25: Adenda W — fecho da peça 6 (22/09)
- 1.26: Adenda X — decisões da Fase A do lote dos contratos (22/09)
- 1.27: Adenda Y — decisões da auditoria do lote dos contratos (22/09)
- 1.28: Adenda Z — fecho do lote dos contratos (23/09)
- 1.30: Adenda AA — fecho do lote do oráculo e âmbito completo do lote da bridge e do frontend (23/09)
- 1.31: Adenda AB — decisões da auditoria do lote da bridge e do frontend (23/09)

Esta spec diz O QUE o sistema tem de fazer e provar. Não diz como implementar.

Estado de cada ponto:
- [DECIDIDO] — aprovado pelo owner, não se reabre.
- [FACTO Rn/Qm] — relatório de leitura n do Claude Code, pergunta m:
  - R1: integração com o existente, 18/09;
  - R2: carteiras derivadas, 18/09;
  - R3: contas com passkey, 18/09;
  - R4: recuperação, 18/09.
- [PENDENTE] — depende de acção ou verificação externa.

---

## 0. Identidade

- Plataforma e empresa: **Keptra** ("promises, kept"). Domínios: keptra.io (principal) e keptra.xyz (protecção). [DECIDIDO 18/09]
  - Pesquisa de marcas em 18/09: USPTO sem resultados; EUIPO sem resultados; TMview só com "KK KEPTRÄK" (classe 9, cancelada). Não é um parecer jurídico.
  - "Attesta" foi descartado: marcas registadas nos EUA nas classes 9 e 42 (Attesta Inc.).
- Posicionamento: camada de confiança entre valor tokenizado e obrigações do mundo real. O valor só é libertado quando a obrigação está provada.
- Três módulos, uma plataforma:
  1. **Instant Win**: lotaria com sorteio verificável (em produção).
  2. **Event Center**: sorteios de marcas (em produção).
  3. **Commerce**: compra protegida, prémio físico garantido e pool de garantia (este documento).
- Linguagem pública: "garantia on-chain para marcas". Nunca "seguro", nunca "rendimento", até existir entidade. No pitch, ao júri e a investidores, o pool é apresentado por inteiro: pool de garantia com provedores de capital, operacional, que abre a terceiros depois do enquadramento. [DECIDIDO 18/09]

## 1. Objectivo

O dinheiro de uma compra, ou a caução e a cobertura de um prémio físico, fica num contrato público. Só é libertado para a loja quando a entrega é provada e a janela de contestação fecha sem contestação válida. Se a obrigação falha, o valor vai para quem tem direito a ele. As regras ficam visíveis antes do pagamento e são cumpridas pelo contrato.

Entrega provada não é o mesmo que obrigação cumprida: a prova abre a janela em que o destinatário pode contestar não-entrega ou não-conformidade.

## 2. Âmbito

### 2.1 Dentro
1. Contas de utilizador controladas por passkey, para os três módulos, com migração das carteiras derivadas. [DECIDIDO 18/09]
2. Modo COMPRA: pagamento de produto físico em USDC para o escrow.
3. Modo PRÉMIO FÍSICO: caução da marca, mais cobertura do pool, mais voucher.
4. Pool de garantia v1 completo: provedores, quotas, levantamentos e distribuição de taxas. A entrada está fechada a terceiros. [DECIDIDO 18/09]
5. Reputação (score) e escalões da loja, com consequência no preço e na cobertura.
6. Duas fontes de prova: tracking de transportadora (oráculo) e código de entrega (meios próprios).
7. Contestação com árbitro limitado.
8. Ramp de cartão por interface multi-fornecedor, em sandbox. [DECIDIDO 18/09]

### 2.2 Fora
1. Ramp de cartão em produção: depende de KYB, e portanto da entidade.
2. Stripe, em qualquer papel. [DECIDIDO 18/09]
3. Câmbio on-chain: preços em USDC. [FACTO R1/Q11: EURC não existe em Arbitrum One]
4. Token. [decisions.md]
5. Carrinho com vários produtos: uma encomenda é um produto, com quantidade.
6. KYB de lojas: no lançamento, as lojas são autorizadas pelo owner.
7. API empresarial e webhooks para lojas: depois do Buildathon.
8. Garantia e devoluções depois da liquidação: regem-se pela política da loja (T12).
9. Substituição física do produto pelo pool: a compensação é sempre em USDC.

### 2.3 Regra permanente
A plataforma nunca consegue mover fundos de utilizadores. O valor está sempre num contrato com regras públicas, ou numa conta que só a passkey do utilizador autoriza.

Excepção declarada e temporária: as carteiras derivadas existentes, até à migração (secção 6.6). [FACTO R2/Q1–Q3]

## 3. Alcance legal
A plataforma é global, e o desenho é feito como se fosse construída nos EUA. O contrato cumpre o que a loja declarou antes do pagamento, dentro dos limites desta spec. Cada loja declara nos termos que as suas condições cumprem a lei do seu país, e a responsabilidade é dela. [DECIDIDO 18/09]

O enquadramento do pool (provedores externos), da custódia e dos sorteios com prémio fica para a assessoria do programa. [PENDENTE P11]

## 4. Factos de integração

- F1. O GiveawayManagerV2 não suporta pagamento pendente de entrega. [R1/Q1–Q3] → contrato próprio.
- F2. O ERC721PrizeModule existente entrega um NFT por vencedor; a taxa em USDC é cobrada sobre declaredValue ≠ 0. [R1/Q1–Q2] → o voucher entra por este módulo.
- F3. O claimPrize exige msg.sender = vencedor. [R1/Q3]
- F4. O prazo de resgate do núcleo é fixo em 90 dias. [R1/Q3]
- F5. O AutomationReceiver actual aceita um único workflowId. [R1/Q6] → o oráculo tem workflow e receiver próprios.
- F6. O núcleo não tem contador por criador. [R1/Q5]
- F7. Os funders estão presos ao GiveawayManagerV2 por constante no código. [R1/Q13]
- F8. O CRE permite, por execução, 15 chamadas HTTP e 5 leituras de segredos. [R1/Q12]
- F9. As carteiras derivadas saem de uma única mnemónica do servidor. O servidor assina sozinho e o utilizador não detém nenhum factor. [R2/Q1–Q3]
- F10. A chave derivada é usada num único ponto (wallet.ts:58), através de 2 primitivas, em 7 operações. [R3/Q3]
- F11. P-256 em Arbitrum One: o precompile 0x100 comporta-se como EIP-7951 e custa 6900 gas. A vulnerabilidade do RIP-7212 não se aplica. [R3/Q1]
- F12. A viem 2.54.3, já instalada, tem createWebAuthnCredential e toWebAuthnAccount. [R3/Q5]
- F13. O execTransaction da Safe é chamável por qualquer um e aceita a assinatura EIP-1271 do signer WebAuthn. [R3/Q2; R4/Q6]
- F14. O módulo de recuperação de 7 dias, 0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2, corre o commit 113d3c0. É código auditado, anterior às correcções. Os achados M-01, L-03 e L-04 aplicam-se a um guardião único. [R4/Q1–Q2]

## 5. Actores e papéis

| Papel | Pode | Não pode |
|---|---|---|
| Utilizador (comprador, vencedor, participante) | Tudo o que envolve a sua conta, sempre com a passkey | Agir sobre contas alheias |
| Loja / marca | Publicar condições, declarar envio, submeter código, declarar entrega ou recusa, reembolsar | Receber antes do fim da janela de contestação |
| Oráculo (workflow e receiver próprios) | Atestar entregue, recusado ou devolvido | Qualquer outro destino de fundos |
| Árbitro (chave própria) | Decidir uma contestação entre dois destinos; marcar fraude, com motivo registado | Reter fundos, escolher um terceiro destino, agir fora de contestação |
| Guardião (chave própria do servidor) | Iniciar a recuperação de uma conta, com atraso de 7 dias | Ser owner de qualquer conta; mover fundos |
| Bridge (relayer e funders) | Submeter transacções assinadas por passkeys e pagar o gás; marcar destinatário verificado e distinto | Autorizar qualquer acção de um utilizador |
| Owner | Autorizar lojas, fontes de garantia e provedores; ajustar parâmetros dentro dos tectos; pausar novas operações | Tocar em fundos; alterar condições de operações existentes; exceder tectos |

Cada papel usa uma chave diferente. Nenhuma chave serve dois papéis.

## 6. Contas de utilizador

### 6.1 Composição [DECIDIDO 18/09; R3, R4]
1. Safe 1.4.1 (SafeL2 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762) por utilizador.
2. Owner único: o proxy de signer WebAuthn criado pela SafeWebAuthnSignerFactory (passkey v0.2.1). Threshold 1. O SharedSigner não é usado. [R4/Q4]
3. Verifiers: só o precompile 0x0100, sem fallback. É uma constante da plataforma, porque entra no endereço do signer. [R4/Q7]
4. Módulo de recuperação: 0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2 (7 dias), com um único guardião (a chave de guardião do servidor) e threshold 1.
5. Sem ERC-4337 e sem bundler: a bridge submete as transacções por execTransaction e paga o gás. [F13]
6. O endereço da conta é determinístico e conhecido antes da criação. A conta é criada na primeira acção que o exija.

### 6.2 Experiência
1. O utilizador entra com email e verifica o telefone por Telegram, como hoje. Cria a passkey (Face ID ou impressão digital) na primeira acção.
2. Todas as acções que movem valor ou direitos exigem a passkey no momento: entrar num sorteio, reclamar um prémio, pagar, confirmar recepção, contestar, cancelar uma recuperação.
3. Nenhuma acção de utilizador é executada por cron sem a sua assinatura. Os prémios ficam no contrato até o vencedor os reclamar, dentro do prazo de 90 dias do núcleo. [F4]
4. O utilizador pode acrescentar uma segunda passkey (outro dispositivo).
5. O email de resultado passa a ser caminho crítico: é o que leva o vencedor a voltar e reclamar. [P8]

### 6.3 Recuperação (opção A) [DECIDIDO 18/09]
1. O guardião inicia a troca de passkey. A troca só se executa 7 dias depois.
2. O utilizador é avisado por email e Telegram no início, a meio e 24 horas antes do fim.
3. O utilizador pode cancelar a qualquer momento com a passkey antiga.

### 6.4 Regras obrigatórias da recuperação (mitigações dos achados conhecidos) [R4/Q2–Q6]
- R-1 (M-01). O guardião só confirma uma recuperação depois de validar o novo owner:
  - é um proxy de signer já implantado (createSigner chamado antes);
  - não é guardião;
  - não é zero, a sentinela nem a própria Safe;
  - não está duplicado.
  
  Sem validação, não há confirmação.
- R-2 (L-04). Todo o cancelamento pelo utilizador leva cancelRecovery e invalidateNonce na mesma transacção.
- R-3 (L-03). A reacção a um comprometimento do guardião é uma única transacção, assinada pela passkey: cancelRecovery, depois invalidateNonce, depois revogar o guardião.
- R-4 (L-05). O módulo nunca é configurado como fallback handler. Isto é verificado na criação de cada conta.
- R-5 (K-02). O módulo nunca é desactivado nem reactivado.
- R-6. As recuperações legítimas são finalizadas pela bridge logo que o atraso termina (corrida depois dos 7 dias, R4/Q6).
- R-7. Fronteira aceite e declarada: com um guardião único, o servidor pode reiniciar uma recuperação depois de um cancelamento. Um servidor comprometido consegue incomodar, mas não roubar.

### 6.5 Onde as contas substituem as carteiras derivadas
As 7 operações hoje assinadas pela chave derivada [F10] passam a ser assinadas pela passkey e submetidas pela bridge, com o mesmo efeito on-chain:
- enter;
- claimPrize;
- transferências de prémio;
- approve (dois);
- createGiveaway;
- a devolução do gás restante deixa de existir.

As folhas Merkle de elegibilidade passam a usar o endereço da conta.

### 6.6 Migração das carteiras derivadas
1. Contas novas nascem já com passkey.
2. Um utilizador existente cria a passkey no próximo login. Com essa autorização, a bridge move os saldos da carteira derivada para a conta nova. É a última assinatura feita com a chave derivada.
3. Criadores (marcas) sem carteira: o mesmo processo.
4. Quando todas as carteiras derivadas com saldo estiverem migradas ou vazias, a variável BRIDGE_V2_WALLET_SEED é retirada. Até lá, a excepção de 2.3 mantém-se declarada.
5. Saldos conhecidos: 2,5 USDC em cada um dos endereços 0x48158b603260347b60AABd2728faCd046F4d3595 e 0x791a21dEBbeFe617A8EF3d21a6E0C56B209055fa. [R2/Q6] Se são carteiras derivadas está por confirmar pelo owner. [PENDENTE]

## 7. Condições declaradas pela loja, por produto ou campanha

Todas visíveis antes do pagamento ou da criação da campanha. Gravadas com a operação, e não mudam depois.
1. Preço, em USDC.
2. Custo de envio, em USDC.
3. Custo de devolução, em USDC. Máximo: o custo de envio declarado.
4. Taxa de recusa/devolução: de 0 a 15% do preço. [DECIDIDO 18/09]
5. Regiões de entrega aceites (países).
6. Modo de entrega: TRANSPORTADORA ou MEIOS PRÓPRIOS.
7. Prazo de envio: até 5 dias.
8. Prazo de entrega depois do envio: até 10 dias.
9. Endereço de pagamento da loja. A plataforma nunca converte USDC em moeda comum.

Pior caso de capital parado numa compra: 25 dias. Caso normal: liquidação no dia da confirmação pelo destinatário.

## 8. Encomenda — estados e transições

### 8.1 Transições
| # | Evento | Quem | Destino do dinheiro |
|---|---|---|---|
| T1 | Pagamento ou resgate de voucher | Destinatário | Escrow |
| T2 | Cancelamento antes do envio | Destinatário | 100% ao destinatário |
| T3 | Prazo de envio passa sem envio | Qualquer pessoa | 100% ao destinatário |
| T4 | Envio declarado | Loja | Mantém-se |
| T5 | Entrega provada (secção 9) | Oráculo ou loja | Abre a janela de contestação de 5 dias |
| T6 | Destinatário confirma recepção conforme | Destinatário | Liquida para a loja |
| T7 | Janela fecha sem contestação | Qualquer pessoa | Liquida para a loja |
| T8 | Recusa, ausência ou devolução depois do envio | Oráculo, ou loja (9.3) | Destinatário: pago − envio − custo de devolução − taxa de recusa. Loja: o resto |
| T9 | Contestação dentro da janela (não entregue ou não conforme) | Destinatário | Congela |
| T10 | Decisão do árbitro | Árbitro | Tudo à loja OU tudo ao destinatário |
| T11 | Prazo de entrega passa sem prova e sem declaração da loja | Qualquer pessoa | 100% ao destinatário |
| T12 | Reembolso voluntário | Loja | Até ao total, ao destinatário |

Nos reembolsos do modo COMPRA, o dinheiro volta sempre ao endereço que pagou.

### 8.2 Árbitro ausente
Se o árbitro não decidir em 5 dias:
- com prova de entrega (oráculo ou código válido) → liquida para a loja;
- sem prova → 100% ao destinatário.

### 8.3 Notificações
O destinatário é avisado por email, e por Telegram quando existir, em T5 e 24 horas antes do fecho da janela.

### 8.4 Taxa de transacção (modo COMPRA) [DECIDIDO 18/09]
- 1,5% sobre o valor liquidado para a loja, cobrada só na liquidação.
- A taxa é um parâmetro do owner, com tecto de 3% fixado no contrato.
- Cada encomenda grava a taxa em vigor no momento do pagamento.

## 9. Prova de entrega

### 9.1 TRANSPORTADORA
1. A loja submete o número de tracking. Na cadeia fica só o hash, e o mesmo hash não serve duas encomendas.
2. O oráculo só atesta ENTREGUE se:
   - o estado final é de entrega;
   - o código postal de destino é igual ao da morada;
   - o primeiro evento é posterior ao pagamento.
3. Tabela fechada de estados:
   - ENTREGUE (inclui vizinho e local seguro);
   - RECUSADO / DEVOLVIDO → T8;
   - EM CURSO (inclui aguarda levantamento);
   - AMBÍGUO → não atesta.
   
   A tabela é auditada.
4. Nem o código postal nem o seu hash vão para a cadeia.

### 9.2 MEIOS PRÓPRIOS
1. Só o destinatário recebe o código de entrega. Na cadeia fica só um compromisso sobre ele.
2. Entropia mínima de 96 bits; apresentado em QR e em texto; uso único.

### 9.3 Recusa em MEIOS PRÓPRIOS
A loja declara a recusa, e o destinatário tem 5 dias para contestar. Sem contestação → T8. Com contestação → T9.

### 9.4 Entrega declarada pela loja
Sem código ou com um estado AMBÍGUO, a loja pode declarar "entregue" antes do fim do prazo de entrega:
- a declaração abre a janela de 5 dias, com as notificações de 8.3;
- sem contestação → liquida para a loja;
- com contestação e árbitro ausente → 100% ao destinatário.

### 9.5 Oráculo
1. Workflow CRE e receiver próprios. [F5]
2. A chave da API de tracking é um segredo do CRE.
3. Confidential HTTP preferido [PENDENTE P1]. Plano B: HTTP normal, declarado como fronteira.
4. Paginação medida dentro dos limites por execução. [F8]
5. Se o fornecedor de tracking estiver indisponível, nenhum estado fica bloqueado: aplicam-se 9.4, T6 e os prazos.
6. Fornecedor de tracking: [PENDENTE P2 — ler os termos de uso antes de fixar]

## 10. Morada e dados pessoais
1. Nunca na cadeia, nem cifrada.
2. Cifrada em repouso. Legível só pela loja da operação e pelo processo de comparação do código postal.
3. Apagamento real até 30 dias depois do estado final, incluindo as evidências de contestação.
4. Página de privacidade publicada antes da primeira morada. [PENDENTE P6]

## 11. Modo PRÉMIO FÍSICO
1. Por unidade de prémio, a marca deposita a caução exigida pelo seu escalão (secção 13). O pool reserva o resto do valor declarado mais o envio (secção 12). A marca paga a taxa de protecção.
2. Um voucher (NFT) por unidade coberta.
3. Sorteio no GiveawayManagerV2, com o ERC721PrizeModule e declaredValue = valor declarado. [F2]
4. O vencedor reclama o voucher com a passkey (claimPrize). [F3]
5. O resgate exige uma morada numa região aceite pela marca.
6. Depois do resgate segue a secção 8, sem taxa de recusa.
7. Entrega cumprida → a caução volta à marca e a cobertura do pool é libertada.
8. Falha da marca → o vencedor recebe o valor declarado mais o envio: primeiro a caução da marca, depois o pool até à cobertura reservada. O que o pool pagar fica registado on-chain como dívida da marca.
9. Voucher não reclamado → reclaimUnclaimedPrize, ao fim de 90 dias [F4]. A marca devolve o voucher e recupera a caução; a cobertura é libertada.
10. Voucher reclamado e não resgatado em 30 dias → mesmo tratamento.
11. Voucher transferível. As regiões aceites resolvem a logística.

## 12. Pool de garantia (v1)

### 12.1 Função
O pool cobre, até um limite, o valor de obrigações de marcas no modo PRÉMIO. Não cobre o modo COMPRA, onde o dinheiro de quem compra já é a garantia. Não substitui a responsabilidade da marca.

### 12.2 Ordem de absorção da perda
1. A caução da marca.
2. O pool, até à cobertura reservada para aquela obrigação.
3. O que o pool pagar fica como dívida da marca ao pool, registada on-chain. Com dívida em aberto, a marca não cria novas obrigações.

### 12.3 Provedores de capital
1. Depósito e levantamento, com quotas proporcionais ao capital. Na construção usa-se um padrão de cofre já auditado. [a verificar na leitura de construção]
2. Só depositam endereços autorizados pelo owner. No lançamento: só o owner. Capital inicial: 100 USDC. [DECIDIDO 18/09]
3. Os levantamentos são limitados pela capacidade livre. O excedente fica em fila até as garantias activas fecharem.
4. As perdas são repartidas pelos provedores na proporção das quotas. Não há rendimento garantido.
5. Abrir a terceiros é uma alteração de configuração, não de código. Só acontece depois da entidade e do parecer jurídico.

### 12.4 Limites (todos verificados na criação de cada obrigação)
- cobertura ≤ limite por marca do escalão;
- cobertura ≤ capacidade livre do pool;
- utilização depois da reserva ≤ 70%;
- taxa de protecção paga à cabeça.

Se alguma condição falhar, a obrigação não é criada.

### 12.5 Taxas de protecção
Distribuídas entre o pool, a reserva de risco e a plataforma, por percentagens que o owner ajusta dentro de tectos fixos no contrato. Valores iniciais: pool 60%, reserva 20%, plataforma 20%. [PROPOSTA — o owner pode alterar antes do deploy]

### 12.6 Fontes de garantia
O escrow conhece uma lista de fontes de garantia autorizadas pelo owner. Cada obrigação grava na criação a fonte que a cobre. Novas fontes (pool com provedores externos, seguradora parceira, pool de uma marca) entram sem alterar o escrow. Uma fonte removida continua a honrar as obrigações que já cobria.

### 12.7 Estado público
São visíveis on-chain e num painel:
- capital;
- garantias activas;
- capacidade livre;
- utilização;
- taxas recebidas e distribuídas;
- quotas;
- dívidas de marcas.

## 13. Reputação e escalões

### 13.1 Contadores por marca e loja (on-chain)
- entregas cumpridas (só com destinatário verificado por telefone e distinto dos já contados);
- falhas menores (atraso);
- falhas materiais (nunca enviou, ou contestação perdida);
- reembolsos;
- fraude (só marcada pelo árbitro, com motivo registado — fronteira aceite).

### 13.2 Escalões iniciais (parâmetros do owner, com limites no contrato)
| Escalão | Condição | Caução | Limite de cobertura por marca | Taxa de protecção |
|---|---|---|---|---|
| Nova | < 5 entregas cumpridas | 50% | 250 USDC | 3% |
| Verificada | ≥ 5 entregas, falhas materiais < 5% | 25% | 1 000 USDC | 2% |
| Confiável | ≥ 20 entregas, falhas materiais < 2% | 10% | 5 000 USDC | 1% |
| Restrita | falhas materiais ≥ 5%, ou dívida ao pool | 100% (sem pool) | 0 | — |
| Suspensa | falhas materiais ≥ 10%, fraude, ou 2 falhas materiais seguidas | não cria obrigações | 0 | — |

A fórmula é determinística e pública. Pesos, recência e score 0–100 vêm com histórico real, como novos parâmetros.

## 14. Ramp de cartão
1. Na bridge, uma interface de fornecedor de ramp. Os fornecedores entram por configuração, e nenhum fica fixo no código. [DECIDIDO 18/09]
2. O ramp entrega USDC em Arbitrum One directamente na conta do utilizador. A chegada é detectada on-chain, da mesma forma para qualquer fornecedor.
3. No lançamento: MoonPay em sandbox, identificado como tal na interface, no vídeo e no pitch. Depois da entidade: MoonPay em produção, mais Mercuryo.
4. Os termos de uso de cada fornecedor são lidos antes de o activar.

## 15. Invariantes (o auditor verifica todos)
- I1. Nenhum estado fica sem saída por tempo. Toda a saída por tempo pode ser disparada por qualquer pessoa, sem depender do oráculo, do árbitro nem do owner.
- I2. Nenhum papel envia fundos para outro destino que não os definidos nas secções 8, 11 e 12.
- I3. As obrigações abertas estão sempre cobertas: o saldo do escrow chega para todas, e as coberturas reservadas nunca excedem o capital do pool.
- I4. As condições de uma operação não mudam depois de criada.
- I5. Taxa de recusa ≤ 15%; custo de devolução ≤ custo de envio; taxa de transacção ≤ 3%; parâmetros do pool dentro dos seus tectos.
- I6. Um hash de tracking e um código de entrega servem uma única encomenda.
- I7. Nenhum dado pessoal na cadeia.
- I8. A pausa nunca impede reembolsos, liquidações, saídas por tempo nem levantamentos dentro da capacidade livre.
- I9. Um redeploy do workflow da lotaria não afecta o bloco 03, e vice-versa.
- I10. Com o árbitro ausente, o resultado depende só da existência de prova.
- I11. Nenhum endereço fora da lista autorizada consegue depositar no pool, em nenhum caminho.
- I12. Nenhuma chave do servidor (guardião, relayer, funders, árbitro, owner) consegue mover valor de uma conta de utilizador.
- I13. Uma fonte de garantia removida continua a honrar as obrigações já cobertas.

## 16. Critérios de aceitação (verificáveis no Arbiscan antes de 04/10/2026 15:59 UTC)
1. Contratos e receiver verificados (Sourcify exact match + Arbiscan).
2. Conta com passkey criada, com o módulo de recuperação activo e a configuração de 6.1 verificável on-chain.
3. Prémio físico real:
   - marca nova com caução de 50%;
   - cobertura do pool reservada;
   - voucher reclamado com passkey;
   - entrega provada;
   - caução devolvida e capacidade libertada.
4. Compra real com uma loja real: pagamento, entrega provada, liquidação com taxa de 1,5%.
5. Uma falha on-chain: uma saída por tempo e uma contestação resolvida. Idealmente, uma falha paga pelo pool, com a dívida registada e o escalão alterado.
6. Pool visível: capital, utilização, quota do owner e taxas distribuídas.
7. Ramp em sandbox, identificado como tal.
8. Migração demonstrada: uma carteira derivada migrada para uma conta com passkey.

## 17. Ordem de construção (fechada)
Cada peça tem uma sessão de construção e uma sessão de auditoria separada, e só se passa à seguinte com a anterior aprovada.
1. Contas com passkey e recuperação (secção 6), com a bridge adaptada às 7 operações.
2. Contrato de escrow, com os dois modos.
3. Pool de garantia e escalões.
4. Oráculo (workflow e receiver).
5. Fluxos da bridge (moradas, notificações, contestação, ramp em sandbox).
6. Frontend.
7. Ensaio geral num fork local de Arbitrum One, automático e sem intervenção manual: o fluxo completo de ponta a ponta. Inclui conta com passkey e recuperação, prémio físico com pool, entrega atestada, falha paga pelo pool com a dívida e o escalão actualizados, compra com liquidação, saída por tempo, contestação e migração. O deploy em mainnet só acontece com o ensaio geral a passar por inteiro.
8. Testes reais em produção (critérios 3 a 5) e migração (critério 8). Uma única execução, como demonstração, e não para procurar erros.

Regra de testes: cada requisito tem testes automáticos escritos pela sessão de construção. O owner não testa manualmente nenhuma peça; aprova a matriz de requisitos, lê o parecer da auditoria e executa o deploy.

Nada entra no âmbito depois desta versão. O que surgir vai para a v1.1, depois do Buildathon.

## 18. Pendentes
| # | O quê | Quem |
|---|---|---|
| P1 | Acesso ao Confidential HTTP | Owner |
| P2 | Fornecedor de tracking e termos de uso | Owner + verificação |
| P5 | Marca e loja reais para os testes, com acordo escrito | Owner |
| P6 | Página de privacidade publicada | Owner |
| P7 | Corrigir J2 | Construção + auditoria |
| P8 | Emails a cair no spam (caminho crítico) | Construção |
| P9 | Rodar TELEGRAM_WEBHOOK_SECRET | Owner |
| P11 | Enquadramento: pool, custódia, sorteios | Assessoria do programa |
| P12 | Custo real medido: criação de conta, encomenda, sorteio (gás, CRE, VRF) | Construção |
| P13 | Registar os domínios keptra.io e keptra.xyz; nomes nas redes; registo da marca (UE primeiro) | Owner |
| P14 | Confirmar se 0x4815…3595 e 0x791a…55fa são carteiras derivadas | Owner (painel Supabase) |
| P15 | Defeitos de custódia do módulo 2 (R2, contradições 1–4). Ficam resolvidos pela migração; até lá são excepção declarada | — |

## 19. Método (herdado, não negociável)
- Construção de raiz a partir desta spec.
- Construção e auditoria em sessões separadas; o prompt de auditoria não diz o que deve encontrar.
- Contratos imutáveis: parâmetros e tectos fixados antes do deploy.
- Deploy e transacções só pelo owner, no terminal.
- Todo o prompt ao Claude Code começa pela REGRA ABSOLUTA: sem push, sem deploy, sem transacções em mainnet, sem acesso à base de produção. Deploy e transacções só pelo Anderson, no terminal. O auto mode é permitido.
- Qualquer dependência nova tem de ser justificada.

## 20. Registo de alterações v0.2 → 1.0
| Secção | Alteração |
|---|---|
| 0 | Nome Keptra (Attesta descartado por conflito de marca); três módulos; linguagem pública do pool |
| 2.3, 6 | Contas com passkey (Safe 1.4.1 + SignerFactory + recuperação de 7 dias), com migração |
| 6.4 | Mitigações obrigatórias dos achados M-01, L-03, L-04, L-05 e K-02 |
| 8.4 | Taxa de 1,5% com tecto de 3% |
| 11, 12, 13 | Pool de garantia v1 completo, com escalões, limites e fontes plugáveis |
| 14 | Ramp por interface multi-fornecedor |
| 15 | Invariantes I11–I13 |
| 16, 17 | Critérios de passkey, pool e migração; ordem de construção fechada |

---

## Adenda A — decisões da Fase A da peça 1 (18/09/2026)

Não acrescenta âmbito. Fecha pontos que a secção 6 deixava ambíguos, com base na verificação on-chain e na leitura do código da Fase A (matriz M1–M46). Em caso de conflito com o texto acima, prevalece esta adenda.

A1. Contratos auxiliares aprovados, todos do registo oficial da Safe para 42161 e com código verificado on-chain:
- SafeWebAuthnSignerFactory v0.2.1 0x1d31…1195;
- SafeProxyFactory 1.4.1 0x4e1D…ec67;
- MultiSendCallOnly 1.4.1 0x9641…02e2;
- CompatibilityFallbackHandler 1.4.1 0xfd07…Ec99.

Os endereços completos são os confirmados on-chain na Fase A.

A2. Cada conta tem como fallback handler o CompatibilityFallbackHandler 1.4.1. Sem ele, a conta não recebe NFTs por safeTransferFrom (prémios e voucher) e não valida assinaturas ERC-1271. A R-4 mantém-se: o handler nunca é o módulo de recuperação.

A3. "Owner único" (6.1.2) quer dizer que os owners são só signers de passkey do próprio utilizador: 1 ou 2 (6.2.4), com threshold 1. Nenhuma chave do servidor é owner. Em R-1, "não duplicado" quer dizer: sem repetições na lista nova de owners.

A4. Entrada num sorteio:
- o utilizador assina o enter depois de a raiz que contém a sua conta estar publicada;
- a página espera por essa publicação e pede a passkey;
- se o utilizador sair antes, recebe por email uma ligação para confirmar a entrada, válida até ao fecho da campanha.

A5. Avisos por Telegram:
- o chat_id passa a ser guardado cifrado (reversível), como a regra R4 da bridge permite ("encriptados em repouso");
- as mensagens são avisos de segurança da conta, sem cripto, carteiras, prémios nem termos de sorteio (regras R2 e R3 da bridge). Exemplo: "Foi pedida uma alteração de acesso à tua conta Keptra. Se não foste tu, abre esta ligação.";
- o email mantém-se como canal principal.

A6. A R-3 é corrigida:
- A reacção a um comprometimento do guardião é uma única transacção, assinada pela passkey, com: cancelRecovery (só se houver recuperação em curso), invalidateNonce e revogação do guardião.
- Depois da rotação da chave do guardião, cada conta acrescenta o novo guardião no próximo login, com a passkey.
- Até lá, a conta fica sem recuperação, e a interface avisa o utilizador.

A7. I12 e R-7 são corrigidos para reflectir o funcionamento real do módulo:
- Nenhuma chave do servidor move valor de imediato.
- Um guardião comprometido só consegue trocar o owner com 7 dias de atraso, avisos nos dois canais, e se o utilizador não cancelar dentro dessa janela.
- É uma fronteira aceite e declarada. O I12 passa a ler-se: "Nenhuma chave do servidor move valor de uma conta sem a janela de 7 dias da recuperação, sempre cancelável pela passkey."

A8. Carteiras derivadas com direitos presos ao endereço (entradas abertas, prémios por reclamar, campanhas de criador vivas):
- continuam a usar a chave derivada até esses direitos terminarem;
- a 6.6.4 passa a ler-se: "a semente é retirada quando nenhuma carteira derivada tiver saldo nem direitos em aberto".

A9. A migração cobre USDC, qualquer outro token ERC-20 de prémio e NFTs.
- O resto de ETH é devolvido aos funders pelo mecanismo existente.
- Cada activo é uma operação; "última assinatura" (6.6.2) lê-se como "últimas operações com a chave derivada".

A10. Mantém-se a separação actual entre participante e criador: uma conta Safe de participante e outra de criador. A mesma passkey pode ser owner das duas.

A11. Fora da peça 1 e sem alteração:
- o caminho de carteira própria (auto-custódia);
- criadores com carteira própria;
- a lotaria (Raffle.tsx).

A12. As regras E1–E4 da bridge V2 (custódia temporária e claim automático) continuam só para as carteiras derivadas existentes, até à sua migração. Contas com passkey nunca as usam. As entradas em curso com endereço derivado numa raiz publicada seguem as regras antigas.

A13. O domínio da passkey (RP ID) é keptra.io.
- É uma constante da plataforma.
- A app tem de estar servida em keptra.io antes da primeira passkey real.
- Nos testes em fork, o domínio não tem efeito.

A14. Iniciar uma recuperação exige ao utilizador sessão de email e verificação do telefone por Telegram, as duas. O atraso de 7 dias mantém-se.

A15. Variáveis e migração aprovadas:
- BRIDGE_V2_GUARDIAN_KEY: o guardião assina fora da cadeia e o relayer submete multiConfirmRecovery;
- o relayer reutiliza BRIDGE_V2_FUNDER_KEYS (a secção 5 junta relayer e funders num só papel);
- ANVIL_BIN, só para testes;
- supabase/migrations/0012_keptra_accounts.sql, só como ficheiro, nunca aplicada a produção.

A16. Sem dependências npm novas. A base de testes em main tem 3 falhas conhecidas (I5, J2, G4). A peça 1 não as corrige nem as pode agravar.

---

## Adenda B — decisões depois da Fase B da peça 1 (18/09/2026)

Não acrescenta âmbito. Fecha os pontos que a construção da peça 1 (commit 1db7d21, ramo feat/keptra-accounts) deixou para decisão do owner. Em caso de conflito com o texto acima, prevalece esta adenda.

B1. Mensagens do bot de Telegram: nunca contêm URL. A regra R2 da bridge prevalece sobre o exemplo da A5: o domínio é nomeado em texto simples ("keptra.io"), sem ligação.

B2. Domínio:
- as ligações que pedem uma assinatura de passkey usam keptra.io (A13);
- a migração completa da app de instntwin.com para keptra.io é obrigatória antes da primeira passkey real;
- até lá, os restantes emails podem continuar em instntwin.com.

B3. A chave de cifra do chat_id (A5) é derivada de BRIDGE_V2_PHONE_HMAC_KEY, com uma etiqueta própria. Não há variável nova. Consequência aceite: rodar essa variável invalida ao mesmo tempo os hashes de telefone e os chat_id cifrados.

B4. O módulo de recuperação e o guardião são activados na primeira transacção da conta (nonce 0), assinada pela passkey, num lote atómico com a criação da conta. Nenhuma conta pode existir on-chain sem módulo e guardião activos. Esta é a forma aceite de cumprir 6.1.4 e R-4.

B5. Criador com prémio que não seja USDC: as aprovações são uma por token e por destino (três quando o prémio não é USDC), porque a taxa é cobrada no token do prémio (FACTO R1/Q1).
- O comportamento actual de creator/campaign/submit.ts no módulo 2 (aprovar só USDC para a taxa) fica registado como defeito D-B5 do módulo 2.
- Corrige-se numa sessão própria, fora da peça 1.

B6. A rotação da chave do guardião (A6) inclui actualizar o guardião registado das contas ainda não criadas on-chain. Fica como passo do procedimento operacional de rotação.

B7. Limite aceite: o alerta de recuperações sem registo e a verificação de prontidão da semente lêem todas as contas e carteiras a cada execução da manutenção. Revê-se quando o número de contas o justificar.

B8. A peça 1 não é integrada em main nem implantada isoladamente. Fica no seu ramo até ao ensaio geral (secção 17, ponto 7). Antes de qualquer deploy: aplicar a migration 0012, configurar BRIDGE_V2_GUARDIAN_KEY, e concluir B2.

---

## Adenda C — decisões depois da auditoria da peça 1 (18/09/2026)

Resposta ao relatório de auditoria do commit 1db7d21 (veredicto NÃO APTA, achados 1–11). Não acrescenta âmbito: fixa os requisitos que a correcção tem de cumprir. Em caso de conflito com o texto acima, prevalece esta adenda.

C1. Migração (achado 1). O movimento dos saldos das carteiras derivadas tem de conseguir correr dentro do orçamento real do cron de manutenção. Toda a reserva de tempo usada por um passo da manutenção entra na verificação que existe para impedir reservas maiores do que o orçamento. Os testes usam a mesma regra de tempo que a produção.

C2. Configuração da conta (achado 2, B4). Não pode existir uma conta no endereço previsto pela plataforma que a plataforma use com módulo ou guardião em falta. Aceita-se uma de duas soluções:
- a) é impossível, por qualquer caminho, criar essa conta sem módulo e guardião activos;
- b) a bridge detecta a configuração em falta e a única acção que a relay aceita para essa conta é completá-la, com a passkey; nenhuma outra acção é aceite antes disso.

Se (a) exigir um contrato novo, a construção pára e reporta; não se escrevem contratos nesta peça.

C3. Pedidos de recuperação abandonados (achado 3). Um pedido que não avança fecha-se sozinho quando a ligação do Telegram expira. Nenhum pedido abandonado impede um pedido novo.

C4. Valor só em contas implantadas (achado 4). Nenhum endereço de conta é indicado como destino de valor enquanto a conta não estiver implantada e configurada. Isto inclui o depósito do criador, a migração e qualquer outro destino. A bridge implanta e configura a conta antes de mostrar esse endereço.

C5. Apagamento de dados (achado 5). O apagamento a pedido remove também o chat_id cifrado.

C6. Estado da recuperação (achado 6). O "recuperação activa" mostrado ao utilizador reflecte o guardião actual on-chain de cada conta. Depois de uma rotação, as contas sem o guardião actual aparecem como "sem recuperação".

C7. Transferências (achado 7). A acção de transferência move exactamente o montante indicado pelo utilizador, e nunca "todo o saldo" por omissão.

C8. Finalização horária (achado 8). Aceite como limite: a finalização e os avisos podem atrasar até uma execução da manutenção. Não se corrige.

C9. RP ID (achado 9). A bridge recusa asserções cujo rpIdHash não seja o de keptra.io, ou cujo origin não seja https://keptra.io.

C10. Alerta de recuperação sem registo (achado 10). O alerta dispara se, e só se, houver on-chain uma recuperação pendente numa conta da plataforma que não corresponda a um pedido registado em qualquer estado vivo. Conta todas as contas com código no endereço previsto, estejam ou não marcadas como implantadas.

C11. Gás de revogar e re-adicionar o guardião (achado 11). No máximo 3 alterações de guardião por conta em 24 horas, pagas pelo relayer. Acima disso, a relay recusa.

C12. Página de assinatura (fronteira detectada pela auditoria; entra na peça 6). Antes de pedir a passkey, a interface mostra ao utilizador, em linguagem simples, o que a transacção faz: acção, montante, destino.

C13. Excesso (secção 5 da auditoria). Sai do código de produção tudo o que só os testes usam: SHARED_SIGNER, singletonOf, createdSigners e as re-exportações sem uso. RP_ID passa a ser usado por C9.

Decisões que ficam aceites:
- o lembrete de entrada 10 minutos depois da publicação da raiz (A4: o tempo mínimo para distinguir "saiu da página");
- a recuperação reescreve o chat_id guardado (coerente com A5);
- uma recuperação substitui todos os owners pela passkey nova (a passkey que sobrar, se existir, pode cancelar durante os 7 dias).

C14. Testes (secção 4 da auditoria):
- o duplo de tempo respeita as reservas como a produção;
- as asserções fracas passam a provar o que o título diz;
- ganham teste: o ramo das 3 aprovações de B5, um claim de NFT feito por um módulo de prémio, e cada correcção C1–C11;
- KM46 compara as dependências com main, não com uma lista escrita à mão.

---

## Adenda D — decisões depois da correcção da peça 1 (18/09/2026)

Resposta às interpretações e contradições do relatório da correcção (commit 9c313cf). Não acrescenta âmbito. Em caso de conflito com o texto acima, prevalece esta adenda.

D1. C2 esclarecido. "Configuração em falta" quer dizer módulo de recuperação não activo, ou uma conta que nunca foi configurada. Só esse caso bloqueia todas as acções excepto configure.
- Uma conta com o módulo activo cujo guardião foi revogado pelo utilizador (R-3) continua utilizável e aparece como "sem recuperação" (C6).
- Nesse caso, configure fica disponível para acrescentar o guardião actual da plataforma.
- Durante um incidente de comprometimento do guardião, configure é recusado até a rotação estar concluída. Não se re-acrescenta a chave comprometida.

D2. C4, âmbito confirmado. O endereço de uma conta ainda não implantada pode entrar na raiz Merkle e aparecer no estado da entrada. Valor só chega a uma conta que existe, porque a reclamação é executada pela própria conta, já implantada e configurada. Aceita-se como está implementado.

D3. C3 alargado. Um pedido PHONE_VERIFIED que não chegue a CONFIRMED em 24 horas também expira, e gera um alerta. Nenhum pedido vivo bloqueia pedidos novos por mais de 24 horas.

D4. Resto do achado 4. Depois de uma recuperação, a conta de um papel que ainda não esteja implantada passa a ter o endereço calculado a partir da passkey nova. Não tem valor, pela C4, e por isso nada se perde. Fronteira aceite: uma entrada em curso feita com esse endereço antigo não pode ser concluída.

D5. Decisões não pedidas, todas aceites:
- a criação da conta não conta para o limite de C11;
- o alerta separado quando a verificação de C10 é cortada pelo tempo;
- a correcção do memdb;
- o campo configured na resposta do registo.

D6. Privilégios. As tabelas da 0012 seguem o padrão de privilégio mínimo das migrations anteriores: só as operações que o código usa. Nenhum privilégio vem de regras por omissão.

D7. Aceite como limite, como C8: a migração pode atrasar-se quando o sweep gasta o tempo da execução. É uma operação única por carteira.

D8. Processo. A secção 19 deixa de exigir o auto mode desligado. O controlo é a REGRA ABSOLUTA no topo de cada prompt, e o deploy e as transacções continuam a ser feitos só pelo Anderson. Em nenhuma sessão houve push, deploy ou transacção. A auditoria verifica também que nenhum commit do ramo chegou ao remoto.

---

## Adenda E — decisões depois da auditoria final da peça 1 (19/09/2026)

Resposta ao relatório de auditoria do commit c89d480 (veredicto NÃO APTA, achados 1–8 e excesso). Não acrescenta âmbito. Em caso de conflito com o texto acima, prevalece esta adenda.

E1. Criador com carteira derivada selada (achado 1).
- Depois de selado o índice derivado de um criador, a plataforma nunca volta a indicar esse endereço derivado como destino de nada: depósitos de campanha e qualquer outro.
- Os fluxos de criador desse participante passam a usar só a sua conta de criador (Safe).
- A prontidão da semente (6.6.4, A8) lê todas as carteiras derivadas, seladas ou não. Qualquer saldo on-chain numa carteira derivada, selada ou não, faz a resposta ser "não pronto" e gera um alerta.

E2. Limite de transacções pagas pelo relayer (achado 2).
- Cada conta tem no máximo 20 transacções pagas pelo relayer em 24 horas.
- O cancelamento de uma recuperação (6.3.3, R-2) e a transacção de reacção a um comprometimento (R-3, A6) são sempre possíveis: não contam para esse limite e não podem ser impedidos pelo esgotamento do tecto de gasto partilhado.

E3. Reconciliação do estado implantado (achado 3). Uma conta que existe on-chain e cumpre 6.1 é reconhecida como implantada, mesmo que o recibo da sua primeira transacção se tenha perdido.
- Reconhece-se na execução seguinte da manutenção, ou antes, se a conta for usada.
- A recuperação decide pelo estado on-chain da conta, não pela marca da base de dados.

E4. Corrida na confirmação de uma recuperação (achado 4). O guardião só assina uma confirmação para um pedido que continua em PHONE_VERIFIED no momento da assinatura, e a transição de estado é garantida antes de assinar. Um pedido que expirou nunca é assinado.

E5. Tempo da manutenção (achado 5). Nenhuma execução da manutenção deixa de tentar confirmar, notificar ou finalizar recuperações por o tempo ter sido gasto no sweep ou na migração.

E6. CONFIRMED excluído da D3 (achado 6), por decisão do owner de 19/09. Com um só guardião, o módulo não substitui uma recuperação pendente. Um pedido CONFIRMED pode por isso bloquear um pedido novo até ao fim dos 7 dias, ou até ser cancelado pela passkey. Fronteira aceite.

E7. Campanha presa em FUNDING (achado 7). Uma campanha criada pela relay cujo recibo não chegou é reconciliada a partir da cadeia na execução seguinte da manutenção: fica registada se a transacção existiu, e é libertada se não existiu. O mesmo padrão no submit derivado do módulo 2 fica como defeito D-FUNDING, para uma sessão própria, junto com D-B5 e D-0007.

E8. Documentação (achado 8): o comentário deslocado em linkcodes.ts é corrigido.

E9. Excesso (secção 4 da auditoria). Sai tudo o que a produção não lê:
- guardian_revoked_at, e a reescrita que só o alimenta;
- deploy_tx_hash;
- as entradas de ABI usadas só pelos testes, que passam para os testes;
- o tipo duplicado RecoveryNoticeStage.

E10. "Nunca configurada" (D1) passa a ler-se pelo estado on-chain (E3), e não só pela marca deployed_at.

E11. Testes. Cada decisão E1–E5, E7 e E10 tem teste. Acrescentam-se também:
- o criador depois de selado;
- o timeout do recibo;
- o limite de volume da relay, com o cancelamento a passar com o tecto esgotado;
- a corrida D3/E4;
- a rota de migração no fork;
- a transferência de ERC-721 e ERC-1155 pela acção transfer da relay;
- o KM34 a provar saldos zero nas carteiras seladas.

E12. Processo.
- As sessões de auditoria não lêem nem usam a memória persistente do Claude Code gravada por outras sessões. A independência da auditoria exige-o.
- As sessões de construção não gravam nessa memória conclusões sobre defeitos.

---

## Adenda F — decisões depois da auditoria do commit 6ec6d50 (19/09/2026)

Resposta ao relatório de auditoria do commit 6ec6d50 (veredicto NÃO APTA; nenhum achado crítico nem alto; achados 1–9). Fecha também os dois pontos deixados em aberto no parecer da Adenda E. Não acrescenta âmbito. Em caso de conflito com o texto acima, prevalece esta adenda.

F1. Guardião real (achado 1). As decisões sobre o guardião de uma conta, incluindo a reacção R-3 e a revogação, usam o guardião que a conta tem on-chain, e não o valor gravado na base de dados. A manutenção reconcilia o valor gravado com o estado on-chain. A reacção R-3 é sempre possível enquanto a conta tiver um guardião on-chain.

F2. Criador derivado com rascunho vivo (achado 2).
- Um rascunho de campanha em PENDING_DEPOSIT ou FUNDING é um direito aberto da carteira derivada (A8). A migração não move os fundos dessa carteira enquanto o rascunho estiver vivo.
- Um rascunho em PENDING_DEPOSIT sem depósito recebido fecha-se sozinho 7 dias depois de criado.
- Nunca há dois caminhos a assinar pela mesma carteira derivada ao mesmo tempo.

F3. Direitos abertos (achado 3). Uma entrada só conta como direito aberto enquanto:
- a campanha aceitar entradas; ou
- a entrada puder ainda reclamar um prémio dentro do prazo do núcleo.

Uma entrada abandonada numa campanha que já não aceita entradas, e sem prémio a reclamar, não é direito aberto.

F4. Leitura completa (achado 4). A prontidão da semente avalia todas as carteiras derivadas que existem. Se não for possível confirmar que as avaliou todas, a resposta é "não pronto".

F5. E7 pela cadeia (achado 5). Um rascunho em FUNDING sem hash gravado só é libertado quando a cadeia mostrar que a conta do criador não criou nenhuma campanha desde o rascunho. O tempo sozinho não liberta.

F6. ETH (achado 6). A E1 passa a ler-se assim: qualquer saldo de token ou NFT numa carteira derivada, ou ETH acima do custo de um sweep, faz a resposta ser "não pronto". O ETH abaixo desse custo segue a A9.

F7. Durações das rotas (achado 7, e o ponto em aberto da relay).
- Cada rota declara a sua duração máxima derivada das etapas que realmente faz.
- Nenhuma rota pode, no pior caso declarado, passar o limite da plataforma.
- Toda a rota que faz chamadas RPC tem duração declarada.
- Se o recibo de uma transacção não chegar dentro do limite da rota, o estado final fica correcto na mesma, pelas regras E3 e E7.

F8. Testes (achado 8):
- os ramos que dependem de linhas embebidas (criador, entrada, custódia de prémios A9) são exercitados com dados;
- a verificação de reservas da C1 cobre todas as reservas da manutenção, onde quer que estejam declaradas;
- o KM34 no fork cobre também direitos de criador;
- cada decisão F1–F7 e F10 tem teste.

F9. Documentação (achado 9). Os comentários contraditórios são corrigidos: o da C11 e revogações em config.ts, e o dos avisos em 0012.

F10. Excesso (secção 7 da auditoria):
- as tabelas bridge_v2_relayed_transactions e bridge_v2_guardian_changes não guardam linhas com mais de 7 dias;
- sai o argumento residual de markDeployed no fork;
- a descodificação do lote que a própria relay acabou de codificar sai, se a lista de chamadas já existir antes da codificação.

Aceite: funções internas exportadas só para os testes (não mudam o comportamento).

F11. Fronteira aceite (ponto em aberto da E2). O cancelamento de uma recuperação continua sujeito ao limite global da rota e à existência de funders com saldo. Não é o tecto de gasto que a E2 nomeia. A vigilância do saldo dos funders é operacional.

F12. Runner de testes. A suite termina com código de saída diferente de zero quando falha qualquer teste que não seja uma das falhas de base declaradas (I5, J2, G4). O ensaio geral (secção 17, ponto 7) depende disto para falhar sozinho.


---

## Adenda G — fecho da peça 1 e regra de paragem (19/09/2026)

G1. Regra de paragem das auditorias, para todas as peças:
- Uma peça fica fechada quando uma auditoria completa não encontra nenhum achado crítico nem alto.
- Os achados médios corrigem-se uma vez. A correcção é verificada por uma auditoria de alterações, limitada ao diff da correcção, e não por nova auditoria completa.
- Os achados baixos entram na lista de pendentes antes do deploy (G3), ou ficam aceites e documentados.
- A verificação final de todas as peças juntas é o ensaio geral automático (secção 17, ponto 7).

G2. Peça 1 fechada. Houve auditoria completa sem achados críticos nem altos (commit 6ec6d50). As correcções da Adenda F foram verificadas por auditoria de alterações (6ec6d50..f35ca31), com o veredicto APTA. O commit de referência da peça 1 é f35ca31, no ramo feat/keptra-accounts.

Confirmado pelo owner (19/09): na prontidão da semente, o limite de ETH de uma carteira selada é o maior entre o custo gravado do seu último sweep e o custo actual de um sweep.

G3. Pendentes da peça 1, a resolver num só lote antes do deploy. Vêm da auditoria de alterações de f35ca31; todos são de severidade baixa:
- P1-1. Uma carteira só é selada depois de o último sweep estar confirmado on-chain. Nenhuma carteira fica "não pronto" para sempre por um sweep que não foi minerado.
- P1-2. Todos os rascunhos elegíveis acabam por expirar, qualquer que seja o número de rascunhos à frente na fila.
- P1-3. Um saldo que já estava no endereço antes do rascunho não conta como depósito desse rascunho. Um rascunho sem depósito próprio expira.
- P1-4. O reconhecimento de uma conta (E3) e o alerta R-4 confirmam que o guardião on-chain é uma chave de guardião da plataforma (6.1.4).
- P1-5. As reservas de tempo da manutenção cobrem as leituras que a F3 acrescentou.
- P1-6. Um rascunho que deixou de estar em PENDING_DEPOSIT nunca é submetido.
- P1-7. Uma resposta de falta de tempo não consome unidades do tecto de gasto.
- P1-8. O comentário do passo do submit coincide com o valor declarado.
- P1-9. Os testes indicados pela auditoria (KM34 do criador e AF2 da migração) demonstram o que o título diz.

Juntam-se a esta lista os defeitos do módulo 2 já registados: D-B5, D-0007 e D-FUNDING.


---

## Adenda H — decisões da Fase A das peças 2 e 3 (19/09/2026)

Responde às ambiguidades 1 a 34 da Fase A das peças 2 e 3. A numeração Hn segue a numeração das ambiguidades. Em caso de conflito com o texto acima, prevalece esta adenda.

### Processo e chaves

H1. As peças 2 e 3 são construídas juntas, numa só construção, e auditadas juntas, numa só auditoria completa, com a regra de paragem G1. Decisão do owner de 19/09.

H2. O provedor de capital do lançamento é um endereço próprio, diferente do owner. O owner autoriza-o. Nenhuma chave serve dois papéis.

H3. Quem marca um destinatário como verificado e distinto (13.1), e quem atesta a morada no resgate (H7), é o papel bridge de atestação sobre utilizadores: a mesma chave que já publica as raízes de elegibilidade no GiveawayManagerV2. É o mesmo papel, a atestar factos sobre utilizadores.

H4. Antes de qualquer deploy dos contratos novos, o endereço do owner não pode ter código. A delegação EIP-7702 hoje presente em 0x7F74…bb86 é retirada pelo owner, e confirma-se on-chain que o código do endereço tem tamanho zero. Fica como pendente do owner: P-OWNER.

H5. Oráculo e árbitro:
- são endereços que o owner pode trocar, com evento público em cada troca;
- valem para todas as operações, incluindo as já existentes (uma rotação por incidente tem de os abranger).

Fronteira declarada: o owner escolhe quem arbitra, mas o árbitro só decide entre os dois destinos definidos.

### Modo PRÉMIO

H6. No modo PRÉMIO:
- T2 (cancelamento antes do envio) devolve o voucher ao titular, que pode voltar a resgatá-lo dentro do prazo;
- T8 (recusa, ausência ou devolução) consome o voucher, devolve a caução à marca e liberta a cobertura;
- T12 (reembolso voluntário) é pago pela marca ao destinatário e conta como reembolso.

H7. O resgate de um voucher exige uma atestação do papel bridge (H3): foi registada uma morada numa das regiões aceites pela marca para este voucher. No modo COMPRA não é exigida.

H8. Libertação por qualquer pessoa, lida no GiveawayManagerV2 e no ERC721PrizeModule. Um voucher que o núcleo já não pode entregar a um vencedor é anulado, e a caução e a cobertura correspondentes são libertadas. Isto cobre três casos:
- campanha liquidada, com o prazo de 90 dias de reclamação expirado;
- campanha cancelada;
- sobras do clamp.

Não depende de nenhuma acção da marca.

H9. Prazos e transferências do voucher:
- um voucher que não entre na custódia de uma campanha do ERC721PrizeModule em 30 dias depois de emitido pode ser anulado por qualquer pessoa, com a caução e a cobertura libertadas;
- antes de sair do módulo para um vencedor, o voucher só pode ser transferido para o ERC721PrizeModule.

H10. O declaredValue do núcleo não é controlado pelo escrow: é a base da taxa que a marca paga ao núcleo. O valor por unidade da obrigação no escrow é o que conta para a caução, a cobertura e a compensação. Fronteira aceite.

H11. Bases de cálculo:
- a caução é a percentagem do escalão sobre (valor declarado + envio);
- a cobertura é o resto;
- a taxa de protecção incide sobre a cobertura.

H12. Fronteira aceite: uma marca em conluio com um vencedor pode falhar de propósito. Limitam-na a caução (que absorve a primeira perda), o limite de cobertura por marca, e a marcação de fraude pelo árbitro.

### Transições e prova

H13. Acções tardias. Depois de um prazo, a loja ainda pode enviar ou provar enquanto ninguém tiver disparado a saída por tempo. Uma acção tardia conta como falha menor (atraso).

H14. Contam como falha material:
- T3 (nunca enviou);
- T11 (sem prova);
- T10 decidido a favor do destinatário;
- 8.2 sem prova;
- 9.4 contestada com o árbitro ausente.

H15. Contestação de uma recusa (9.3). O árbitro decide entre:
- recusa válida: aplica-se a divisão de T8;
- recusa inválida: 100% ao destinatário.

A regra "tudo à loja" de T10 aplica-se só a contestações de entrega.

H16. Uma declaração de entrega (9.4) seguida de código válido ou de atestação do oráculo, dentro da janela, passa a contar como entrega com prova para a 8.2. O estado AMBÍGUO não é verificável on-chain: a declaração fica disponível até ao prazo de entrega.

H17. O hash do tracking é um hash com chave (HMAC) calculado pela bridge. Nunca é um hash simples do número de tracking.

H18. O código de entrega é gerado no dispositivo do destinatário. A bridge só conhece o compromisso.

H19. Taxa de transacção:
- incide sobre tudo o que a loja recebe, em qualquer caminho (T6, T7, a parte da loja em T8, T10 e 8.2);
- os arredondamentos favorecem os utilizadores: a taxa arredonda para baixo.

H20. A pausa trava só criações: ofertas, pagamentos, obrigações, vouchers e depósitos no pool. Todas as outras acções e saídas continuam disponíveis, e por isso os prazos não param.

H21. A fraude só é marcada pelo árbitro, dentro da decisão de uma contestação. O motivo fica on-chain como código de uma lista fechada, com hash opcional de um documento; nunca como texto livre.

H22. O envio é por encomenda. A taxa de recusa incide sobre preço × quantidade.

H23. No modo COMPRA, o pagador é o destinatário.

### Pool

H24. Dívida e escalões:
- com dívida em aberto, a marca não cria nenhuma obrigação, nem com caução de 100% (prevalece a 12.2.3);
- a dívida paga-se em USDC ao pool, por uma função pública; paga a dívida, o escalão volta a ser calculado.

O escalão Restrita aplica-se a quem não tem dívida.

H25. Reserva de risco:
- recebe a sua parte das taxas de protecção e fica no contrato do pool;
- absorve perdas depois da caução da marca e antes dos provedores;
- ninguém a pode levantar.

H26. Levantamentos:
- um pedido em fila fixa quotas, não valor: continua a partilhar ganhos e perdas até sair;
- qualquer pessoa pode processar a fila;
- a capacidade livre para levantamentos é capital − coberturas reservadas (o limite de 70% aplica-se só a reservas novas).

H27. As quotas do pool não são transferíveis.

H28. O limite por marca aplica-se ao total das coberturas activas dessa marca.

H29. O owner define a fonte de garantia usada por defeito nas obrigações novas. A parte da taxa de protecção destinada ao pool vai para a fonte gravada na obrigação.

H30. Os tectos são constantes do contrato, e os valores são ajustáveis dentro deles. Tectos:
- taxa de transacção ≤ 3%;
- taxa de protecção ≤ 5%;
- parte da plataforma na taxa de protecção ≤ 30%;
- utilização máxima ≤ 80%;
- caução mínima ≥ 10%;
- limite de cobertura por marca ≤ 10 000 USDC.

### Reputação

H31. Fórmula dos escalões:
- as percentagens de falha usam como denominador as operações terminadas (entregas cumpridas + falhas materiais);
- precedência: Suspensa, depois Restrita, depois Confiável, depois Verificada, depois Nova;
- "2 falhas materiais seguidas" são as duas últimas operações terminadas; uma entrega cumprida interrompe a sequência;
- as percentagens para Restrita e Suspensa só se aplicam com pelo menos 5 operações terminadas; abaixo disso, a Suspensa vem só de fraude ou de 2 falhas materiais seguidas;
- a Suspensa mantém-se até o owner a levantar, com evento público.

H32. Marca e loja são o mesmo endereço, com uma só reputação. Uma loja Suspensa não cria ofertas nem obrigações novas; as existentes continuam até ao fim.

H33. Fronteira aceite: a chave do papel bridge (H3) pode inflacionar a reputação ao marcar destinatários como verificados.

H34. Lojas e marcas podem agir com uma conta Keptra (através da relay) ou com uma carteira própria. O contrato não distingue.

### Construção

H35. Aprovado:
- compilador 0.8.21, EVM paris, via_ir e 200 runs, iguais ao núcleo verificado;
- endereços previsíveis por CREATE2;
- um .gitattributes com *.sol eol=lf;
- atestação do oráculo em lote, em que um item inválido é saltado sem reverter os outros.

Pendentes do owner antes do deploy: P-OWNER (H4); endereço do provedor (H2); endereços do árbitro, do oráculo, da plataforma e da reserva.


---

## Adenda I — decisões da construção das peças 2 e 3 (20/09/2026)

Registo das decisões que a construção das peças 2 e 3 (commits b44f739 e 3f1fd17, ramo feat/keptra-escrow-pool) tomou sem terem sido pedidas. O owner aceita-as todas. Passam a fazer parte da spec. Em caso de conflito com o texto acima, prevalece esta adenda.

I1. As peças 2 e 3 ficam em contratos separados, porque o escrow completo passava o limite de tamanho da rede:
- o escrow (encomendas, transições, prova, papéis);
- a garantia (obrigações, caução, cobertura, vouchers, dívidas);
- o pool;
- a reputação;
- o voucher.

I2. O resgate de um voucher não é travado pela pausa. Um voucher reclamado tem 30 dias para ser resgatado (11.10), e uma pausa não pode apagar um direito já adquirido. A pausa trava ofertas, pagamentos do modo COMPRA, obrigações e depósitos no pool.

I3. A suspensão (H31) só é reavaliada numa falha material ou numa fraude. Depois de o owner a levantar, uma entrega bem-sucedida nunca volta a suspender a loja.

I4. O owner é passado explicitamente na criação dos contratos (por causa de H35, CREATE2).

I5. Uma oferta nunca é editada: cria-se uma nova e desactiva-se a antiga (I4 da secção 15).

I6. A atestação de morada de H7 é uma assinatura do papel bridge, entregue pelo utilizador no resgate.

I7. Anular um voucher é uma marca, não uma queima. Um voucher queimado dentro do módulo de prémio bloquearia para sempre o reembolso da marca no núcleo.

I8. A caução arredonda para cima e a cobertura é o resto. A taxa de protecção arredonda a favor de quem paga (H19).

I9. Não existe função para recuperar USDC enviado por engano para os contratos. O owner não toca em fundos (2.3); o que chegar por engano fica inerte.

I10. O pagamento de uma dívida repõe primeiro a reserva de risco e depois o capital dos provedores, pela ordem por que a perda foi absorvida.

I11. Lista fechada de motivos de fraude (H21): FALSE_PROOF, NEVER_SHIPPED, NOT_AS_DESCRIBED, IDENTITY_ABUSE.

I12. Uma entrega a um destinatário não marcado como verificado não conta para a reputação, e também não interrompe uma sequência de falhas (H31).

I13. T3 e T11 são uma só saída por tempo, e as janelas partilham um só evento. As leituras de conveniência vivem na garantia. Motivo: tamanho do contrato.

I14. As regiões de entrega ficam on-chain como códigos de país ISO-3166-1 (por exemplo PT), visíveis antes do pagamento. Não são dados pessoais.

I15. Os testes de fork correm, por omissão, no bloco actual, porque o RPC público não guarda estado histórico. Com um nó de arquivo, a variável ARBITRUM_FORK_BLOCK fixa o bloco.

I16. Nos testes de fork, o precompile ArbSys (0x64) é simulado, porque o ambiente de teste não o tem e o coordenador VRF real lê-o. É o mesmo tratamento dado na peça 1.


---

## Adenda J — decisões da auditoria completa das peças 2 e 3 (20/09/2026)

Resposta à auditoria do commit 3f1fd17 (veredicto NÃO APTA; achado alto 1; achados médios 2, 3 e 5; achados baixos 4 e 6 a 14). Pela regra G1:
- os achados alto e médios corrigem-se agora, numa só correcção, verificada por auditoria de alterações;
- os achados baixos entram na lista de pendentes antes do deploy (J6) ou ficam aceites (J5).

Em caso de conflito com o texto acima, prevalece esta adenda.

J1. Saída garantida para qualquer voucher (achado 1). Qualquer voucher, em qualquer estado, tem sempre um prazo depois do qual qualquer pessoa o anula e liberta a caução e a cobertura correspondentes, sem acção da marca.
- Um voucher devolvido à marca por uma campanha sem vencedor (cancelada, ou abaixo do mínimo de participantes) volta à regra de H9.
- Nesse caso, os 30 dias de H9 contam desde a devolução.

J2. Quotas presas (achado 2). As quotas do pool nunca podem ficar sem dono. A única movimentação de quotas entre endereços é a entrada e a saída da fila de levantamento.

J3. Loja Suspensa (achado 3). Uma loja Suspensa não recebe nenhum pagamento novo, em nenhuma oferta, incluindo as publicadas antes da suspensão. As encomendas já pagas seguem até ao fim.

J4. Invariantes com conteúdo (achado 5).
- Os invariantes I3, I5 e I11 são demonstrados com o modo PRÉMIO e o pool em uso: obrigações, resgates, anulações, liquidações de unidades, fila de levantamento e alterações de parâmetros dentro dos tectos.
- Uma reversão inesperada numa acção dos testes de invariantes faz o teste falhar.

J5. Fronteiras aceites, sem código:
- achado 7: sob conluio entre a marca e o vencedor, a caução não absorve a perda. O que limita a perda é o limite de cobertura por marca (H28, H30) e o bloqueio de obrigações novas enquanto houver dívida (H24). A H12 passa a ler-se assim;
- achado 9: um endereço bloqueado pela Circle na USDC pode travar a liquidação das encomendas em que é destino. É um risco do emissor da moeda;
- achado 10: o pior caso de 25 dias da secção 7 conta desde que alguém dispara a saída por tempo. A peça 5 dispara as saídas por tempo automaticamente, quando os prazos passam;
- achado 14: as reservas novas podem adiar um provedor em fila. O owner pode pausar as criações.

J6. Pendentes das peças 2 e 3, a resolver num só lote antes do deploy (junto com G3). Os contratos são imutáveis depois do deploy, por isso este lote entra antes dele:
- P23-1 (achado 4). Só um provedor autorizado deposita no pool, como pagador e como destinatário das quotas.
- P23-2 (achado 6). O deploy recusa qualquer papel repetido entre todos os papéis, incluindo o provedor, a bridge e a plataforma.
- P23-3 (achado 8). As regiões só aceitam códigos de país ISO-3166-1 (duas letras maiúsculas), com um limite de quantidade.
- P23-4 (achado 11). O teste do critério 16.5 demonstra uma mudança de escalão.
- P23-5 (achado 12). O escalão Restrita é sempre caução de 100% sem cobertura, e não é configurável.
- P23-6 (achado 13). A matriz declara a versão da spec em vigor e cobre as Adendas I e J.
- P23-7 (secção 8 da auditoria). O excesso sai: quoteObligation, freeCapacity na interface, Terms.active nas linhas de prémio, o valor devolvido pelo mint que ninguém usa, termsCount e orderCount. MAX_UNITS e debtOf ficam, se a correcção mostrar que são precisos; senão saem.


---

## Adenda K — fecho das peças 2 e 3 (20/09/2026)

K1. Peças 2 e 3 fechadas, pela regra G1:
- a auditoria completa (commit 3f1fd17) teve um achado alto, e a correcção J1 fechou-o;
- a auditoria de alterações (3f1fd17..183a2b4) deu APTA, sem achados críticos nem altos introduzidos pela correcção.

O commit de referência das peças 2 e 3 é 183a2b4, no ramo feat/keptra-escrow-pool.

K2. Pendentes que se juntam à lista J6 e se resolvem no mesmo lote antes do deploy. Os contratos são imutáveis, por isso todos entram antes dele:
- P23-8 (achado 1 da auditoria de alterações, médio). J2 cumpre-se por inteiro: nenhuma transferência de quotas, de nenhum tipo, as deixa sem dono. Tem prioridade dentro do lote.
- P23-9 (achado 5). Nos testes de invariantes, um erro esperado de um contrato não esconde o mesmo erro vindo de outro contrato.
- P23-10 (achado 6). Os testes de invariantes demonstram, em cada sequência, anulações, liquidações de unidades e alterações de parâmetros, incluindo os escalões Restrita e Suspensa (em linha com P23-5).
- P23-11 (achados 2 e 3). Pedidos cancelados não entram na contagem de pedidos pendentes, e não podem ser multiplicados para atrasar a fila.
- P23-12 (achado 7). A documentação do contrato do voucher descreve o prazo tal como a J1 o define.

K3. Fronteiras aceites:
- achado 4: um provedor que sai da fila pode levantar pela via directa, dentro da capacidade livre. A fila nunca teve prioridade sobre a via directa;
- achado 8: a marca pode renovar os 30 dias de um voucher ao colocá-lo numa campanha nova. Cada campanha nova custa-lhe a taxa mínima do núcleo, e é esse o limite. A cobertura continua reservada enquanto o voucher estiver em circulação.


---

## Adenda L — decisões da Fase A da peça 4, o oráculo de entrega (20/09/2026)

Responde às ambiguidades A1 a A8 da Fase A da peça 4 e fixa as decisões que faltavam. Em caso de conflito com o texto acima, prevalece esta adenda.

L1. Quem compara o código postal (A1). Os nós do Workflow DON são o processo de comparação do código postal de 10.2. O número de tracking e o código postal de destino passam por eles em claro.

Fronteira aceite e declarada, com estes factos:
- o Confidential HTTP protege a chave da API, e não o conteúdo da resposta que o workflow tem de ler;
- esconder o código postal dos operadores de nó exigiria Confidential Workflows, em beta privado;
- a resposta da transportadora traz sempre o código postal, qualquer que seja o caminho.

A 9.5.3 passa a ler-se assim: o Confidential HTTP é preferível pela protecção da chave, e o HTTP normal com segredos do CRE é suficiente. A chave da API é só de leitura, com quota baixa, e é rodada depois da demonstração.

L2. Mapa de encomendas (A2). O oráculo não recebe a chave do HMAC do tracking. Aceita a lista que a bridge lhe dá, e atesta só encomendas cujo estado on-chain o permite.

Fronteira aceite: uma bridge comprometida pode associar um número de tracking a outra encomenda e obter uma atestação errada. Nenhum dinheiro sai para fora dos destinos de I2; a consequência é uma entrega dada como provada sem o ser, defensável pelo destinatário dentro da janela.

L3. Recusas em separado (A3). Um item que atesta recusa, ausência ou devolução vai sempre sozinho no seu report. Assim, um pagamento bloqueado por um endereço na lista negra do emissor da moeda não derruba atestações de outras encomendas. Não exige alteração aos contratos.

L4. orderCount fica (A4). O P23-7 passa a retirar só termsCount. O orderCount é usado pelo oráculo e pelo painel.

L5. A demonstração 16.4 corre em modo TRANSPORTADORA (A5), com o oráculo no caminho crítico: pagamento, envio real, entrega confirmada pela transportadora, atestação do oráculo e liquidação com a taxa. É o que prova a proposta da plataforma. Uma demonstração em MEIOS PRÓPRIOS pode acrescentar-se se houver tempo.

L6. Stripe (A6). A 2.2.2 é âmbito de produto: a Keptra nunca usa Stripe para mover dinheiro de utilizadores. Pagar uma subscrição de um fornecedor com cartão não é isso, e é permitido.

L7. Recusa depois de uma declaração da loja (A7). Uma atestação de recusa, ausência ou devolução vale enquanto a janela estiver aberta, mesmo que a loja já tenha declarado entrega. A prova de um terceiro prevalece sobre a declaração de quem é parte. Entra no lote antes do deploy como P23-13, porque exige alteração ao escrow.

L8. Fornecedor de tracking (A8): Ship24, com o plano pago mínimo, e chave só de leitura.
- Antes de fixar, confirma-se que existe um número de teste que chega ao estado "entregue" e que as transportadoras da demonstração estão cobertas.
- Se não se confirmar, a alternativa é a TrackingMore, e nesse caso obtém-se primeiro o acordo de API que os seus termos citam e não publicam.
- A AfterShip e a EasyPost ficam excluídas: os seus termos proíbem este uso.
- Fronteira aceite, comum a todos: nenhum fornecedor garante a exactidão da informação das transportadoras, e é sobre ela que o pagamento é libertado.

L9. Tabela de estados (9.1.3). O mapeamento entre os estados do fornecedor e os quatro estados da spec é apresentado ao owner no relatório da construção, antes da demonstração. Qualquer estado não mapeado é AMBÍGUO e não atesta nada.

L10. Custo por chamada. Com HTTP normal, cada nó do DON faz o pedido ao fornecedor. O custo real por encomenda atestada é medido e registado (P12), e as chamadas repetidas são reduzidas ao que o CRE permitir.

L11. O receiver do oráculo é uma segunda instância do AutomationReceiver já auditado, com identidade de workflow própria e uma só saída permitida: a atestação no escrow. Nada mais entra na lista.


---

## Adenda M — decisões da construção da peça 4 (20/09/2026)

Corrige a Adenda L onde ela assentava num facto errado, e regista as decisões tomadas na construção do oráculo (commits b12b4a5 e 4612f49 em instant-win-cre, dcf5b78 na matriz). Em caso de conflito com o texto acima, prevalece esta adenda.

M1. Chaves do fornecedor (corrige L8). A Ship24 não tem chaves com âmbito: todas dão acesso total à conta.
- Existe uma conta Ship24 dedicada à Keptra, que só contém envios da plataforma.
- A bridge e o oráculo usam chaves diferentes dessa conta, para que revogar uma não derrube a outra.
- A fronteira declarada passa a ser "chave de acesso total a uma conta dedicada", e não "chave só de leitura". A chave do oráculo é rodada depois da demonstração.

M2. As três condições da 9.1.2 — estado final, código postal igual e primeiro evento posterior ao pagamento — valem para qualquer atestação, incluindo a de recusa, ausência ou devolução. Quando uma delas falha, não se atesta nada, e a encomenda segue para a saída por tempo, onde o destinatário recebe tudo.

M3. Tabela de estados (L9), aprovada:
- entregue → ENTREGUE;
- recebido, em trânsito, em distribuição, tentativa falhada, disponível para levantamento → EM CURSO;
- pendente → AMBÍGUO;
- excepção com recusa do destinatário → RECUSADO;
- excepção com devolução → DEVOLVIDO;
- excepção por extravio, destruição ou recusa da alfândega → AMBÍGUO, porque não é uma recusa do destinatário e não pode custar-lhe o envio, a devolução e a taxa de recusa;
- qualquer outro estado, incluindo os que o fornecedor venha a acrescentar → AMBÍGUO.

M4. Uma hora sem fuso horário tem o mesmo tratamento de uma data sem hora: conta como o fim desse dia em UTC, com folga de 24 horas.

M5. O código postal é comparado por igualdade inteira, depois de normalizado. Um código parcial não passa.

M6. O oráculo consulta o envio pelo identificador que o fornecedor atribui, e não pelo número de tracking.

M7. Facto medido, que corrige a F8: o limite que aperta uma execução do oráculo não é o das chamadas HTTP, mas o das leituras da cadeia, também 15. Daí o tecto de 13 encomendas por execução, com um ciclo de 15 minutos contra uma janela de entrega de 10 dias.

M8. A L7 não é implementável antes do lote que antecede o deploy: hoje o escrow só aceita uma recusa antes de a janela abrir. O comportamento actual fica fixado por teste, para que o P23-13 tenha um antes e um depois.

M9. Requisitos que a peça 4 deixa à peça 5:
- ao registar o envio, a bridge cria o registo no fornecedor já com o código postal de destino, e guarda o identificador devolvido;
- a bridge serve ao oráculo a lista de encomendas por atestar, com identificador do envio e código postal, protegida por credencial própria.


---

## Adenda N — decisões da auditoria da peça 4 (20/09/2026)

Resposta à auditoria completa da peça 4 (veredicto APTA; achado médio A1; achados baixos A2 a A9; excesso). Pela regra G1 a peça fica fechada, e o achado médio corrige-se uma vez, com verificação por auditoria de alterações. Em caso de conflito com o texto acima, prevalece esta adenda.

N1. Um envio discordante não cala o oráculo (A1). Uma encomenda sobre a qual os nós do DON não cheguem a acordo não impede que as restantes sejam atestadas nessa execução.

Motivo: um envio que muda de estado entre as consultas de dois nós, ou uma resposta com códigos diferentes, é normal. Hoje isso deita fora a execução inteira, e um envio que oscile em todas as corridas bloqueia tudo indefinidamente.

N2. Fornecedor ou bridge em falha (A2). Está demonstrado por teste que, quando o fornecedor ou a bridge falham, nada é atestado e a execução termina sem efeito. É a 9.5.5.

N3. Um envio, uma encomenda (A5). Numa execução, o mesmo identificador de envio nunca produz atestações para mais do que uma encomenda.

N4. Registo fiel (A3, A4, A9):
- as instruções de reprodução da medição reproduzem-na tal como estão escritas, incluindo o caso que bate no tecto;
- não há referências a ficheiros que não existem;
- tudo o que o owner tem de preencher antes do deploy está marcado no ficheiro e listado na matriz, incluindo o endereço do serviço da bridge.

N5. Excesso, sai:
- os parâmetros de configuração que só podem baixar um tecto já medido;
- o alvo de simulação que nada usa;
- a imposição de versão de dependência que a spec não exige;
- os endereços de uma corrida de medição guardados no repositório, que nascem obsoletos.

N6. Fronteiras aceites, sem código:
- A6: a folga de 24 horas na comparação entre o primeiro evento e o pagamento é larga, e é o caminho normal, porque o fornecedor devolve com frequência carimbos sem fuso horário. Aceita-se, porque o erro por rigidez custa entregas verdadeiras;
- A7: o oráculo não sabe se o escrow aplicou a atestação. Uma encomenda cujo pagamento esteja bloqueado pelo emissor da moeda consome uma escrita em cada execução, sem efeito. É a mesma fronteira do achado 9 das peças 2 e 3;
- A8: uma encomenda de outro modo que a bridge liste gasta orçamento da execução sem produzir nada. Fica resolvido pelo requisito N7.

N7. Requisitos que a peça 4 deixa à peça 5, a juntar aos de M9:
- a bridge só lista, para o oráculo, encomendas do modo TRANSPORTADORA que estejam à espera de prova.


---

## Adenda O — fecho da peça 4 (20/09/2026)

O1. Peça 4 fechada, pela regra G1: a auditoria completa não teve achados críticos nem altos, e a auditoria de alterações da correcção N deu APTA. Commits de referência: 43032c9 em instant-win-cre e dc529e8 na matriz, ambos no ramo feat/keptra-oracle.

O2. Pendentes da peça 4, para o lote antes do deploy (juntam-se a G3, J6 e K2):
- P4-1. O caminho para as instruções de medição resolve para o ficheiro que existe.
- P4-2. A árvore de dependências não tem vulnerabilidades conhecidas. Se evitá-las exigir fixar a versão de uma dependência, essa fixação não conta como excesso, e o N5 lê-se assim.
- P4-3. Os comentários descrevem o que o código faz: as consultas ao fornecedor são feitas uma após a outra, e não em simultâneo.
- P4-4. Nenhuma mensagem vinda de fora — do fornecedor ou da bridge — é escrita no registo tal como veio, e o caminho de falha está coberto por teste.

O3. Fronteira registada: a regra "um envio, uma encomenda" (N3) vale dentro de cada execução. Uma bridge comprometida que repita o mesmo envio numa execução seguinte consegue a segunda atestação. É a fronteira que a L2 já aceita.

O4. Resumo do que a peça 5 herda das peças 2, 3 e 4:
- disparar as saídas por tempo quando os prazos passam (J5);
- calcular o HMAC do número de tracking (H17);
- registar o envio no fornecedor com o código postal de destino, e guardar o identificador devolvido (M9);
- servir ao oráculo a lista de encomendas à espera de prova, protegida por credencial própria, só do modo TRANSPORTADORA (M9, N7);
- usar uma chave própria da conta do fornecedor, diferente da do oráculo (M1).


---

## Adenda P — decisões da Fase A da peça 5 (21/09/2026)

Responde às ambiguidades AMB-1 a AMB-26 da Fase A da peça 5. A numeração Pn segue a das ambiguidades. Em caso de conflito com o texto acima, prevalece esta adenda.

### Âmbito

P1. Lojas e marcas agem com uma conta Keptra, através da relay, tal como os destinatários: pagar, resgatar, cancelar, confirmar, contestar; e do lado da loja e da marca, ofertas, envio, código, declarações, reembolso, obrigações e campanhas com vouchers. Lojas, marcas e titulares com carteira própria ficam para depois do Buildathon (corrige, para esta construção, a H34 e a 11.11).

P2. A loja identifica-se pela sessão, e a sua conta de criador tem de ser a loja gravada nas condições da oferta.

P8, P9 e P10. O ramp sai desta construção e passa para depois do Buildathon. Os factos que o decidem:
- o sandbox da MoonPay não entrega USDC em Arbitrum One, por isso a 14.2 e a 16.7 não são demonstráveis em sandbox;
- o contrato da MoonPay proíbe transacções ligadas a contratos de lotaria, e a plataforma tem uma lotaria. Fica para o parecer jurídico (P11).

O critério 16.7 sai da demonstração de 04/10.

### Fornecedor de tracking

P6. Antes da demonstração, o owner faz um teste real na Ship24, com e sem o código postal de destino no registo do envio, para saber se o código postal devolvido vem da transportadora ou repete o que a bridge enviou.
- Se vier da transportadora, a guarda do código postal (9.1.2) mantém-se como prova.
- Se repetir o que a bridge enviou, a guarda passa a ser só verificação de coerência, e a fronteira fica declarada: a prova assenta no estado final da transportadora, no envio posterior ao pagamento e no uso único do número de tracking.

A construção não fica à espera deste teste.

P7. Apagamento na Ship24. A 10.3 aplica-se aos dados guardados pela Keptra. Os dados enviados à Ship24 seguem a retenção dela.
- A página de privacidade nomeia a Ship24 como processador, com a sua retenção.
- À Ship24 só vai o número de tracking, o código postal e o país; nunca o nome, o email nem a morada completa.
- O owner pede à Ship24 o acordo de API e o DPA que os termos citam.

P25. Facto para a peça 4: a recusa do destinatário aparece na categoria "delivery" da Ship24, e não em "exception". Entra no lote antes do deploy como P4-5: a tabela de estados reconhece a recusa onde a Ship24 a põe.

### Avisos

P3. Os avisos de 8.3 vão só por email. O bot do Telegram continua a fazer só a verificação e os avisos de segurança da conta (R2, A5).

P4. A janela de contestação de uma recusa (9.3) também é avisada, com as mesmas regras de 8.3.

P12. Atraso máximo aceite, contado a partir do momento em que o prazo passa:
- saídas por tempo: 1 hora;
- aviso das 24 horas antes do fecho da janela: 1 hora.

P22. Avisos que se acrescentam:
- à loja, quando uma encomenda é paga, com o prazo de envio;
- ao árbitro, quando há uma contestação.

O lembrete dos 30 dias do voucher fica para depois.

### Moradas e evidências

P15. No modo COMPRA, a bridge recusa uma morada fora das regiões aceites pela loja, antes do pagamento.

P17. Evidências de uma contestação:
- só texto, até 2 000 caracteres, cifrado em repouso;
- lido só pelo destinatário, pela loja da encomenda e pelo árbitro;
- o hash que o árbitro passa ao contrato é calculado a partir desse texto;
- é apagado com a morada.

P18. Um pedido de apagamento com encomendas abertas apaga a morada dessas encomendas só depois do estado final, mais 30 dias. O utilizador é informado disso na resposta.

P19. Campos da morada: nome, morada, código postal, cidade, país, e telefone opcional para a transportadora.

P20. As chaves novas (cifra das moradas e das evidências, HMAC do tracking) derivam de raízes existentes com etiqueta própria, como na B3.

P21. Só contas Keptra, nesta construção (P1).

### Chaves, limites e reputação

P5. Destinatário distinto (13.1): o mesmo telefone conta uma vez por loja. Um destinatário que é a própria loja (a mesma pessoa) nunca conta.

P11. As saídas por tempo e a anulação de vouchers usam a chave do keeper, que passa a poder chamar essas funções do escrow e da garantia. Não consomem o tecto de gasto partilhado, porque protegem utilizadores (como a E2 faz com os cancelamentos).

P13. A lista de formas que a bridge assina é fechada e contada por teste, incluindo as novas: a marcação do destinatário e a atestação do resgate.

P14. As marcações de destinatário contam para o tecto de gasto partilhado e correm sob o mesmo lock da publicação das raízes.

P16. Contestar, confirmar e cancelar não contam para o limite de 20 transacções por conta em 24 horas, nem consomem o tecto partilhado. Um direito com prazo nunca pode ser perdido por causa de um limite.

### Pendentes e fora de âmbito

P23. A entregabilidade dos emails (P8) depende do DNS e do domínio, e é tarefa do owner.

P24. Os endereços dos contratos entram por configuração, e o ensaio geral falha se algum não estiver preenchido.

P26. Factos da peça 1, para o lote antes do deploy:
- P1-10: os avisos de recuperação reclamam o tecto de gasto;
- P1-11: o apagamento e a exportação cobrem as tabelas da migration 0012.


---

## Adenda Q — decisões da construção da peça 5 (21/09/2026)

Regista as respostas do owner durante a construção da peça 5 (commit d0f49c2, ramo feat/keptra-bridge), e as decisões que a construção tomou sem terem sido pedidas, que o owner aceita. Em caso de conflito com o texto acima, prevalece esta adenda.

Q1. Corrige a P24. Os endereços dos contratos são literais no código, como manda a regra H1 da bridge, e ficam a zero até o owner os preencher depois do deploy. Enquanto algum estiver a zero, as rotas e os passos das encomendas recusam-se a correr, e o ensaio geral falha.

Q2. O árbitro identifica-se assinando, com a sua chave, um desafio de validade curta. A bridge compara o signatário com o árbitro que o escrow nomeia nesse momento, e por isso acompanha qualquer troca feita pelo owner (H5). O aviso de contestação vai para um endereço de email configurado.

Q3. Corrige a P17. As evidências de uma contestação têm dois textos, um do destinatário e outro da loja, cada um com até 2 000 caracteres. O hash que o árbitro passa ao contrato cobre os dois.

Q4. Completa a P22. A loja ou a marca é avisada em toda a encomenda que abre: por pagamento no modo COMPRA, e por resgate de voucher no modo PRÉMIO.

Q5. Decisões da construção, aceites:
- as chaves das moradas, das evidências e do tracking derivam da mesma raiz, com etiquetas próprias (P20). Essa raiz não é rodável;
- o passe das encomendas corre a cada minuto, junto do ciclo de vida das campanhas e sob o mesmo lock; o apagamento e a nova tentativa de registo no fornecedor correm na manutenção horária;
- a atestação de um resgate vale 1 hora, e os prazos são comparados com o relógio da cadeia;
- as acções do destinatário correm na conta de participante; as da loja e da marca, na conta de criador;
- uma campanha com vouchers leva no máximo 20 vouchers, e exige telefone verificado;
- as evidências só se escrevem numa encomenda contestada, e não se alteram depois;
- o apagamento corre aos 29 dias, para ficar dentro dos 30 da 10.3 mesmo com atraso do passe;
- tecto de gasto do fornecedor de tracking: 30 registos por hora e 100 por dia;
- a lista do oráculo roda por janelas de 15 minutos quando há mais de 13 encomendas à espera.

Q6. Antes do deploy, as migrations 0012 e 0013 são aplicadas por esta ordem. Sem elas, o apagamento a pedido falha.

Q7. O lote antes do deploy muda o bytecode do escrow (P23-13). Depois dele, o código de criação usado nos testes de fork das peças 4 e 5 é gerado outra vez, e esses testes voltam a correr.


---

## Adenda R — decisões da auditoria da peça 5 (21/09/2026)

Resposta à auditoria completa da peça 5 (commit d0f49c2; veredicto APTA; achado médio M1; baixos B1 a B10; excesso). Pela regra G1, o médio corrige-se uma vez, com auditoria de alterações. Em caso de conflito com o texto acima, prevalece esta adenda.

R1. Fecho de uma encomenda (M1). Uma falha a meio do fecho nunca deixa uma encomenda fechada sem data de apagamento, nem com a marca do destinatário por resolver. Numa passagem seguinte, tudo o que ficou por fazer é retomado.

R2. Passe isolado (B1). Um erro numa encomenda não impede as saídas por tempo, os avisos nem as marcas das outras. A leitura dos fechos na cadeia funciona com um fornecedor RPC que limite o intervalo de blocos por pedido.

Motivo para juntar o B1 à correcção: é a mesma função que o M1, e as saídas por tempo protegem dinheiro de utilizadores.

R3. A matriz da peça 5 fica no repositório, com a versão da spec em vigor e as Adendas P, Q e R, como nas peças anteriores. A auditoria não a encontrou.

R4. Excesso, sai:
- o parâmetro da janela de contestação, usado só nos testes;
- o tipo de registo que nunca é emitido;
- os campos devolvidos que nenhum fluxo lê;
- o hash de tracking na resposta à loja.

Fica a rota que lista as encomendas do utilizador, porque é o que a peça 6 lê. Declara-se como parte da fronteira com a peça 6.

R5. Pendentes da peça 5, para o lote antes do deploy (juntam-se a G3, J6, K2 e O2):
- P5-1 (B2): um fecho que caia entre as duas leituras do passe nunca deixa a marca do destinatário por resolver;
- P5-2 (B3): uma morada não pode abrir duas encomendas, e uma encomenda paga tem sempre morada;
- P5-3 (B4): um envio recusado de forma permanente sai da fila de novas tentativas, e as encomendas fechadas nunca entram nela;
- P5-4 (B5): o passe processa todas as encomendas abertas, qualquer que seja o número;
- P5-5 (B6): o pior caso da rota de processamento é medido e declarado por item;
- P5-6 (B7): o teste da P13 conta os locais onde a bridge assina, e não uma lista do próprio teste;
- P5-7 (B8): a exportação inclui as evidências escritas pelo próprio participante;
- P5-8 (B9): a documentação da migration diz com que etiqueta é cifrado o número de tracking;
- P5-9 (B10): os títulos dos testes dizem o que o teste demonstra, e nenhum teste lê ficheiros de outro repositório por caminho absoluto;
- P5-10: as janelas de rotação da lista do oráculo não coincidem com o disparo do oráculo.

R6. Fronteira aceite. A marca do destinatário guarda o hash do telefone sem prazo, porque a contagem de destinatários distintos (13.1) é permanente. Guarda-se o hash, e nunca o telefone. A página de privacidade declara-o.


---

## Adenda S — fecho da peça 5 (21/09/2026)

S1. Peça 5 fechada, pela regra G1: a auditoria completa não teve achados críticos nem altos, e a auditoria de alterações da correcção R deu APTA. Commit de referência: d56f499, no ramo feat/keptra-bridge.

S2. Pendentes da auditoria de alterações, para o lote antes do deploy (juntam-se a P5-1 a P5-10):
- P5-11 (B-1): a reserva de tempo de um fecho cobre todo o trabalho que ainda falta depois da última leitura do registo;
- P5-12 (B-2): uma encomenda nova que falhe sempre não impede a descoberta das seguintes; se não puder ser lida, fica registada à parte, com alerta;
- P5-13 (B-3): um bloco actual anterior ao bloco guardado nunca conta como "fecho sem resultado".


---

## Adenda T — decisões da Fase A da peça 6 (22/09/2026)

Responde às ambiguidades AMB-1 a AMB-19 da Fase A da peça 6 e fixa o que a interface tem de ser. Em caso de conflito com o texto acima, prevalece esta adenda.

### Qualidade da interface

T0. A Keptra é uma camada de garantia e custódia de dinheiro, usada por empresas. A interface transmite isso:
- identidade visual própria e consistente em todos os ecrãs;
- área de empresas (loja e marca) separada da área do cliente;
- todos os estados tratados — a carregar, vazio, erro e sucesso —, sem ecrãs em branco nem mensagens técnicas;
- funciona no telemóvel e no computador;
- acessibilidade ao nível WCAG 2.1 AA;
- movimento discreto, que ajuda a perceber o que mudou e nunca atrasa uma acção;
- cada número mostrado vem da cadeia ou da bridge, e nunca é inventado ou estimado.

### Domínio e marca

T1 (AMB-1). A app é servida em keptra.io, como fixam a A13, a B2 e a C9. O owner regista o domínio. O código não muda de domínio.

T9 (AMB-9). A app inteira passa para keptra.io, incluindo a lotaria e o Event Center:
- o nome da plataforma no título, no manifest e nas pré-visualizações passa a Keptra; "Instant Win" continua como nome dos sorteios;
- instntwin.com redirecciona as páginas para keptra.io e continua a servir /api, para o webhook do Telegram e as ligações já enviadas continuarem a funcionar.

T17 (AMB-17). Os ecrãs novos ficam só em inglês nesta construção. Português e espanhol ficam para depois do Buildathon. Os ecrãs que já existem mantêm os três idiomas.

### Âmbito da construção

T3 (AMB-3). A peça 6 pode alterar a bridge só no que esta adenda pede: a leitura do estado da conta, os ids devolvidos pela relay (T5), o resumo da acção (T2), a descrição das ofertas (T4) e o domínio público (T9). Tudo entra na auditoria da peça 6, e nenhum teste das peças 1 e 5 pode regredir.

T12 (AMB-12). Ficam fora desta construção, para depois do Buildathon:
- a segunda passkey (U10);
- iniciar uma recuperação (U11) e a reacção a comprometimento do guardião (U13);
- a campanha de criador com conta Keptra (U18);
- a transferência de vouchers.

Ficam dentro: ver o estado da recuperação (U9), cancelar uma recuperação (U12) e transferir USDC ou um prémio com o montante exacto (U17), porque sem ela o dinheiro que chega à conta de um utilizador não tem saída.

T10 (AMB-10) e T11 (AMB-11). O árbitro e o provedor do pool agem pelo terminal, com instruções escritas. O painel do pool mostra a quota do provedor (H2), e não "do owner".

### Assinatura e ofertas

T2 (AMB-2 e AMB-16). A página de assinatura (C12) mostra a acção, o montante e o destino calculados pela bridge ao preparar a transacção, e não pelo cliente. A bridge devolve esse resumo junto com o hash. Não há terceira cópia da fórmula da obrigação.

T4 (AMB-4). Cada oferta e cada obrigação tem uma descrição do produto: título e texto, sem imagens, escrita pela loja ou marca ao criar. Não se altera depois de criada. É mostrada antes de pagar ou resgatar, e o árbitro recebe-a junto com as evidências.

T5 (AMB-5). Não há catálogo. A loja ou marca partilha uma ligação por oferta. A relay devolve o id da oferta ou da obrigação que criou, como já faz com o id da encomenda.

T15 (AMB-15). O escalão da loja é mostrado antes de pagar, lido da cadeia.

### Código de entrega

T6 (AMB-6).
- É gerado no dispositivo do destinatário e guardado nesse dispositivo.
- Se se perder, vale a 9.4, com a declaração da loja e a janela de contestação.
- O QR leva só o código.
- A conversão do código para o formato que o contrato espera é fixa e testada contra a fórmula do contrato.
- Quem entrega usa a conta de criador da loja.

A demonstração usa o modo TRANSPORTADORA (L5); o código de entrega entra na construção mas não na demonstração.

T7 (AMB-7). A biblioteca de QR que já está na árvore passa a dependência directa, declarada e justificada.

### Testes

T8 (AMB-8). A lógica e os fluxos testam-se com as rotas reais no mesmo processo e o autenticador de software, sem browser, e sem dependências de teste novas. A construção e a auditoria verificam os ecrãs num browser real, só contra a app local ou de pré-visualização, e o relatório inclui capturas dos ecrãs principais.

### Privacidade e dados

T13 (AMB-13). O apagamento a pedido é recusado enquanto a conta Keptra do participante tiver saldo, vouchers ou encomendas abertas. A mensagem diz o que falta resolver.

T14 (AMB-14). A página de privacidade é uma rota da app. O texto é do owner. O formulário de morada fica bloqueado enquanto a página não tiver texto.

T18 (AMB-18). Depois do lote antes do deploy, as ABIs e os endereços usados pelo cliente são gerados outra vez, como a Q7 prevê para os testes de fork.

T19 (AMB-19). Cancelar uma recuperação exige sessão de email e a passkey antiga. Aceite.

### Regras da sessão

T20. Nenhuma sessão de construção ou de auditoria faz pedidos à produção (instntwin.com, keptra.io ou a base de dados de produção), nem grava na memória persistente do Claude Code.

### Computador e telemóvel

T21. Decisão do owner.
- Quem avalia a plataforma na demonstração, os jurados e as marcas, usa o computador. Cada ecrã é desenhado primeiro para o computador e usa o espaço que ele dá: os painéis da loja e da marca mostram mais informação de uma vez, e nenhum ecrã é uma coluna estreita com espaço vazio dos lados.
- Cada ecrã adapta-se ao telemóvel e fica completo e fácil de usar: nada cortado, nada que obrigue a deslizar para o lado, botões do tamanho de um dedo, e nenhuma acção escondida ou em falta.
- Os fluxos do cliente — pagar, resgatar um voucher, confirmar, contestar e mostrar o código de entrega — funcionam no telemóvel tão bem como no computador.
- Verifica-se em três larguras: 1440 px, 1024 px e 390 px.


---

## Adenda U — decisões da construção da peça 6 (22/09/2026)

Regista as respostas do owner durante a construção da peça 6 (commit 61e8169, ramo feat/keptra-frontend) e as decisões que a construção tomou sem terem sido pedidas, que o owner aceita. Em caso de conflito com o texto acima, prevalece esta adenda.

U1. Completa a T13. A recusa do apagamento é feita na bridge, e não só no ecrã. "Saldo" quer dizer: USDC em qualquer das duas contas Keptra, vouchers em qualquer delas, ou encomendas abertas como destinatário ou como loja. Outros tokens de prémio não contam, porque a bridge não os consegue contar. A alteração à bridge entra na auditoria da peça 6, como prevê a T3.

U2. Completa a T12. A transferência de USDC é uma acção nova da relay, disponível nas duas contas, sempre com o montante exacto escrito pelo utilizador (C7). Nunca para a própria conta, nunca para uma conta da plataforma que não esteja configurada (C4). A transferência de um prémio de campanha continua pela acção que já existia.

U3. Completa a T17. Os textos novos dentro de ecrãs que já existiam ficam em inglês, português e espanhol. Os ecrãs novos ficam só em inglês.

U4. Completa a T0. A identidade visual é o sistema que a app já tem, com o nome Keptra no título, no manifest, nas pré-visualizações de ligações e nos ícones. A área de empresas distingue-se pela navegação e pela disposição. Uma identidade nova fica para depois do Buildathon.

U5. Completa a T7. O teste que impede dependências novas passa a aceitar exactamente a biblioteca de QR que a T7 declara, e nenhuma outra.

U6. Decisões da construção, aceites:
- a descrição do produto (T4) é escrita por uma rota própria, logo depois de a relay devolver o id; sem descrição, a página não deixa pagar;
- a relay devolve também os ids dos vouchers que uma obrigação cunhou (T5);
- um pedido de apagamento remove no momento até 4 moradas; as restantes já têm data de apagamento e saem com a passagem horária;
- o código de entrega tem 100 bits, em 20 símbolos, e fica guardado no browser sob o compromisso da encomenda;
- os cabeçalhos dos ecrãs que já existiam mantêm "Instant Win", o nome dos sorteios;
- o payout de uma oferta é a conta de empresa da loja, e o dinheiro sai de lá pela transferência de USDC;
- o árbitro e o provedor do pool têm instruções escritas em docs/keptra/;
- a pré-visualização local (test/preview/) corre num fork e não entra no build nem no deploy.

U7. Tarefas do owner que esta construção acrescenta ao deploy:
- escrever o texto da página de privacidade (T14). Enquanto estiver vazio, nenhuma morada pode ser registada e nenhuma compra é possível;
- aplicar as migrations 0012, 0013 e 0014, por esta ordem (actualiza a Q6);
- decidir o RPC que o browser usa; o RPC público pode limitar a leitura de eventos do painel do pool;
- ligar keptra.io e www.keptra.io ao projecto Vercel, mantendo instntwin.com ligado;
- autorizar keptra.io no WalletConnect.


---

## Adenda V — decisões da auditoria da peça 6 (22/09/2026)

Resposta à auditoria completa da peça 6 (commit 61e8169; veredicto NÃO APTA; achado alto A1; médios A2 a A4; baixos B1 a B18; excesso). O alto e os médios corrigem-se numa só ronda, verificada por auditoria de alterações que repete no browser a reprodução do A1 e a medição do contraste. Em caso de conflito com o texto acima, prevalece esta adenda.

V1 (A1). Depois de registar o número de tracking, a loja consegue sempre declarar o envio: noutra sessão, depois de recarregar a página, a partir da ligação do email, ou depois de uma resposta perdida.

V2 (A2). Todo o texto dos ecrãs novos tem contraste de pelo menos 4,5:1 sobre o fundo em que aparece, medido no browser.

V3 (A3). Uma leitura que falha, da cadeia ou da bridge, aparece como erro, com a possibilidade de tentar outra vez. Nunca aparece como lista vazia nem com uma frase que afirme um facto que não foi lido.

V4 (A4). Um montante de um token que não seja USDC é mostrado com as casas decimais e o símbolo desse token. Como todos os números mostrados (T0, T2), vem da cadeia ou da bridge.

V5. Baixos que entram nesta ronda, porque são baratos e tocam em dinheiro ou em acessibilidade:
- (B1) a folha de assinatura prende o foco enquanto está aberta e devolve-o ao botão que a abriu quando fecha;
- (B3) a bridge recusa registar uma morada enquanto a página de privacidade não tiver texto; o bloqueio deixa de ser só do cliente;
- (B7) no telemóvel, o prazo seguinte de cada encomenda fica visível;
- (B9) se a descrição da oferta falhar depois de a oferta ser publicada, a página mostra o erro e oferece só escrever a descrição dessa oferta, nunca publicar outra;
- (B11) a transferência de USDC recusa como destino os contratos da Keptra, o contrato USDC e o núcleo dos sorteios.

V6. Registo:
- a matriz da peça 6 declara a versão da spec em vigor e cobre as Adendas T, U e V;
- as capturas de ecrã saem do repositório; ficam no relatório;
- sai o excesso que a auditoria listou: entradas de ABI, campos devolvidos e leituras que nenhum ecrã usa.

V7. Pendentes da peça 6, para o lote antes do deploy:
- P6-1 (B2): o resumo de "confirmar" mostra o que a loja recebe de facto, já sem a taxa; no modo PRÉMIO não mostra destino;
- P6-2 (B4): o texto do formulário de morada diz que o código postal vai para o fornecedor de tracking e para os nós do oráculo;
- P6-3 (B5): nenhum número do painel do pool é escrito à mão;
- P6-4 (B6): o painel mostra as taxas distribuídas em montantes, e não só em percentagens;
- P6-5 (B8): um voucher sem descrição não é resgatável pela página;
- P6-6 (B10): a recusa do apagamento lê as encomendas abertas da cadeia, e não do índice;
- P6-7 (B12): sem as casas decimais do token carregadas, a página não mostra montante;
- P6-8 (B13): o texto do voucher aparece só para um prémio do tipo voucher, e só depois de reclamado;
- P6-9 (B14): o estado da conta só é lido nas páginas que precisam dele;
- P6-10 (B16): os títulos dos testes dizem o que o teste demonstra; um teste que só lê o código-fonte diz isso no título;
- P6-11 (B17): a página avisa quando a lista de vouchers está incompleta;
- P6-12 (B18): a lista de obrigações mostra caução, cobertura e estado;
- P6-13: um teste de fork exercita o código de entrega de ponta a ponta contra o contrato real.


---

## Adenda W — fecho da peça 6 (22/09/2026)

W1. Peça 6 fechada, pela regra G1: a auditoria de alterações da correcção V deu APTA, sem achados críticos nem altos introduzidos. Commit de referência: 81f08ce, no ramo feat/keptra-frontend.

W2. Pendentes para o lote antes do deploy (juntam-se a P6-1 a P6-13):
- P6-14 (médio, prioridade): uma oferta ou obrigação cuja descrição falhou continua visível para a loja depois de recarregar a página, e a página nunca oferece publicar outra. Numa obrigação, publicar outra deposita outra caução;
- P6-15: no painel do pool, um só "Tentar outra vez" relê tudo o que falhou;
- P6-16: com a cadeia em baixo, um valor que não foi lido fica como "não lido", sem alternar com o estado de carregamento;
- P6-17: depois de uma resposta perdida, a consola da loja não mostra ao mesmo tempo o sucesso e o erro;
- P6-18: "o token não indica as casas decimais" só aparece quando o token de facto não as indica; uma leitura que falhou é mostrada como falha;
- P6-19: sai a entrada de ABI que ficou sem uso;
- P6-20: a lista de encomendas da loja não faz uma consulta à base por cada encomenda;
- P6-21: a página da oferta nunca mostra contadores de reputação que não foram lidos.

W3. Pendente da peça 5, para o mesmo lote:
- P5-14: nenhum teste passa ou falha por acaso; o teste que procura o código postal em claro não pode dar positivo por coincidência com um identificador aleatório.


---

## Adenda X — decisões da Fase A do lote dos contratos (22/09/2026)

Responde às ambiguidades 1 a 14 da Fase A do lote antes do deploy, parte dos contratos (P23-1 a P23-13). Em caso de conflito com o texto acima, prevalece esta adenda.

X1 (d1). O P23-13 vem da L7, da M8 e da Q7. O P4-5 é da peça 4 e entra no lote do oráculo. Esse lote garante que uma recusa ou devolução indicada pelo fornecedor nunca é atestada como entrega, qualquer que seja a categoria em que o fornecedor a coloque.

X2 (d2 e d6). O P23-7 retira o que nenhuma peça usa: termsCount, quoteObligation, freeCapacity na interface IGuaranteeSource, e o valor devolvido pelo mint do voucher. Ficam: orderCount (L4), a função freeCapacity do pool, os dois debtOf e o MAX_UNITS, que limita o ciclo de emissão. As condições de um prémio ficam gravadas como inactivas, e desactivar uma oferta é recusado para condições de prémio.

X3 (d3). Os seis papéis passados aos contratos — owner, oráculo, árbitro, bridge, plataforma e provedor do pool — são distintos dois a dois. O script de deploy recusa qualquer par repetido. A rotação de um papel no escrow recusa um endereço igual a outro papel do escrow. A autorização de um provedor recusa o owner e o próprio pool. O keeper, o guardião, os relayers e os funders não são papéis dos contratos e não entram nesta regra. A bridge do escrow e a do núcleo dos sorteios são a mesma chave de propósito (H3).

X4 (d4). Uma região são duas letras maiúsculas, de A a Z; não se verifica a lista ISO atribuída. Cada oferta ou obrigação tem no máximo 60 regiões, sem repetidas.

X5 (d5). O teste do critério 16.5 mostra a mudança de escalão com uma marca que já tem histórico de entregas e depois sofre uma falha material que a leva a Restrita. Na demonstração real, o 16.5 mostra o pool a pagar e a dívida registada; a mudança de escalão fica demonstrada pelo teste de fork e é declarada assim na submissão.

X6 (d7). A separação da origem dos erros nos invariantes faz-se só nos testes; os nomes dos erros nos contratos não mudam. Se for impossível sem os mudar, PARAR e perguntar.

X7 (d8). Para a Restrita e a Suspensa, aceita-se um estado preparado no início de cada sequência, a partir do qual a sequência aleatória continua.

X8 (d9). Aceita-se mudar a forma da fila de levantamentos, incluindo o que o índice de um pedido significa. As instruções do provedor são actualizadas no lote da bridge e do frontend.

X9 (d10). A matriz das peças 2 e 3 declara a versão da spec em vigor e cobre todas as adendas que tocam nos contratos, incluindo a I, a J, a K, a L, a M e esta.

X10 (d11). Uma recusa atestada pelo oráculo aplica-se numa janela aberta por declaração da loja, antes do fim da janela, e com a encomenda ainda não contestada. Não se aplica numa janela aberta por prova de entrega, numa encomenda contestada, nem depois do fim da janela. O resultado é o T8, sem efeito na reputação da loja.

X11 (d12). A reserva de risco fica dentro do pool (H25) e não tem endereço próprio. O pedido de um endereço "da reserva" na H35 é texto antigo e deixa de valer.

X12 (d13). Aceita-se que o máximo de depósito para um provedor não dependa de quem chama, embora o depósito só seja aceite do próprio provedor.

X13. Estado conhecido, para registo:
- o P-OWNER (H4) está resolvido: a delegação EIP-7702 foi retirada a 21/09, e o endereço do owner não tem código;
- a demonstração do 16.5 usa uma marca com endereço diferente da loja do 16.4, ou faz-se depois dela, porque uma marca suspensa deixa de receber pagamentos (J3);
- com 100 USDC de capital no pool, a obrigação da demonstração do 16.5 tem de caber na cobertura disponível.


---

## Adenda Y — decisões da auditoria do lote dos contratos (22/09/2026)

Resposta à auditoria de alterações do lote dos contratos (commit 62a8fce; veredicto APTA; um achado médio e três baixos). Os contratos são imutáveis depois do deploy, por isso o médio e os baixos que tocam nos contratos ou na prova deles corrigem-se agora, numa só ronda, verificada por auditoria de alterações. Em caso de conflito com o texto acima, prevalece esta adenda.

Y1 (achado 1, P23-10). Em cada sequência dos invariantes, a própria sequência aleatória liquida unidades e age sobre as lojas Restrita e Suspensa. O estado preparado no início só cria essas duas lojas (X7); não conta para o que cada sequência tem de demonstrar.

Y2 (achado 2, X3). Nenhuma sequência de chamadas do owner deixa dois papéis na mesma chave, incluindo através de uma transferência de propriedade que ainda não foi aceite.

Y3 (achado 3, P23-6, X9). A matriz das peças 2 e 3 tem uma linha para cada decisão das Adendas I, J e K que toca nos contratos, e cada referência ficheiro:linha aponta para o que nomeia.

Y4 (achado 4). O histórico de entregas do teste do critério 16.5 é feito de destinatários distintos, como a bridge o produziria (13.1, P5).

Y5. Registo, para os lotes seguintes:
- lote do oráculo: o oráculo passa a enviar recusas numa janela aberta por declaração, dentro dos limites da X10; sem isso, o P23-13 não tem efeito em produção;
- lote da bridge e do frontend: as instruções do provedor descrevem a nova forma da fila (X8); os avisos tratam uma janela declarada que fecha por recusa do oráculo antes do fim.
- o erro aritmético que o construtor viu numa versão intermédia dos testes fica por explicar. A auditoria não encontrou caminho para ele em nenhum dos cinco contratos, e oito sementes adicionais dos invariantes não o reproduziram.


---

## Adenda Z — fecho do lote dos contratos (23/09/2026)

Z1. Lote dos contratos fechado, pela regra G1: a auditoria de alterações da correcção Y deu APTA, sem achados críticos nem altos introduzidos. Commits de referência: 5d85a46, no ramo feat/keptra-lote-contratos (worktree v2-lote). Hash do código de criação do escrow, compilado na raiz do repositório: 0x7f269f74cc6a659f906194f4d87635a8d0cfa56a10d1fe774047c91e023890c4.

Z2. Corrige a Y1, conforme a resposta do owner na construção: o estado preparado no início dos invariantes mantém o aquecimento J4, além das lojas Restrita e Suspensa. O que a Y1 exige mantém-se: os contadores contam só o que a sequência faz.

Z3. Corrige a Y2, conforme a resposta do owner na construção. Nos contratos, a regra é esta:
- nenhum papel do escrow, incluindo a propriedade em oferta, fica na mesma chave que outro papel do escrow;
- o owner, e o endereço a quem a propriedade está oferecida, nunca são provedores do pool por defeito.

Fronteira declarada, que fica fora dos contratos:
- um provedor de um pool que não seja o por defeito, e um provedor com o mesmo endereço de um papel do escrow, não são recusados pelos contratos. O script de deploy garante o estado inicial (X3), e o deploy tem um só pool;
- antes de autorizar um segundo pool, ou de mudar um papel ou um provedor depois do deploy, o owner confirma que nenhuma chave fica com dois papéis. Isto fica escrito nas instruções de operação do owner.

Z4. Fronteiras aceites nos testes:
- os invariantes não exploram parâmetros do owner abaixo de 10% de utilização máxima nem de 500 USDC de limite de cobertura, porque abaixo disso nenhuma marca consegue criar e a sequência deixa de provar alguma coisa. Os contratos aceitam valores mais baixos; o owner não os usa no lançamento;
- as entregas preparadas para a loja Restrita nos invariantes usam o mesmo comprador. É estado de teste, e não uma demonstração: a demonstração do 16.5 (Y4) usa destinatários distintos.

Z5. Pendentes dos testes dos contratos, que não mudam o bytecode, para o lote antes do deploy:
- P23-14: um teste demonstra o resgate de um voucher com a pausa activa (I2);
- P23-15: as instruções de operação do owner incluem a verificação da Z3.


---

## Adenda AA — fecho do lote do oráculo e âmbito completo do lote da bridge e do frontend (23/09/2026)

Em caso de conflito com o texto acima, prevalece esta adenda. Decisão do owner: nenhum pendente fica para depois do Buildathon.

AA1. Lote do oráculo fechado, pela regra G1: a auditoria de alterações deu APTA, só com achados baixos. Commit de referência: df37231, no ramo feat/keptra-oracle do repositório instant-win-cre. A matriz da peça 4 passa a viver nesse repositório (MATRIZ-PECA4-KEPTRA.md).

AA2. Correcção do oráculo, no repositório instant-win-cre, antes do deploy:
- P4-6: os testes do P4-4 demonstram que o corpo recebido não chega ao registo, também quando o erro do parser o citaria;
- P4-7: o resultado da ronda de consenso da lista da bridge não leva o conteúdo da lista para o registo.

AA3. O D-0007 sai: a spec só o nomeia e não diz o que pede, e nenhum ficheiro o define.

AA4. Lote da bridge e do frontend, antes do deploy, no repositório INSTANT-WIN-Raffle-v2.1. Entra tudo o que segue:
- T18 e Q7: as ABIs e os endereços do cliente, a fixture e os testes de fork passam a corresponder aos contratos do commit 5d85a46 (Z1);
- B8: a bridge continua a pôr na lista do oráculo uma encomenda numa janela aberta por declaração da loja, até ao fim dessa janela (X10, Y5);
- Y5: os avisos tratam uma janela declarada que fecha por recusa do oráculo antes do fim;
- X8: as instruções do provedor descrevem a forma da fila de levantamentos do commit 5d85a46;
- P23-15: as instruções de operação do owner, com a verificação da Z3, ficam em docs/keptra/OWNER.md;
- peça 1: P1-1 a P1-11;
- módulo 2: D-B5 e D-FUNDING;
- peça 5: P5-1 a P5-14;
- peça 6: P6-1 a P6-21.


---

## Adenda AB — decisões da auditoria do lote da bridge e do frontend (23/09/2026)

Resposta à auditoria de alterações do lote AA4 (diff 81f08ce..133891e; veredicto APTA; um achado médio e quatro baixos). Decisão do owner: todos se corrigem antes do deploy, numa só ronda, verificada por auditoria de alterações. Em caso de conflito com o texto acima, prevalece esta adenda.

AB1. O oráculo está fechado. A correcção AA2 (commits dfd5779 e 5037750, repositório instant-win-cre) teve auditoria de alterações APTA, com três baixos aceites como fronteira:
- sem o conteúdo da lista no registo, uma falha da ronda da lista aparece só como "pending list round failed" (é o que a P4-7 pede);
- a prova de que o erro do parser citaria o corpo vale no Bun; na CRE o erro é apanhado da mesma forma;
- uma bridge comprometida pode fazer aparecer no registo um estado HTTP que não aconteceu, com no máximo três dígitos.

AB2 (M1). A resposta a um pedido de apagamento não depende de quantas encomendas fechadas o participante tem no histórico, como recipiente ou como loja. Um participante sem nada por resolver (T13) consegue sempre apagar os seus dados.

AB3 (B1). Uma morada reservada para um pagamento ou um resgate nunca fica presa: se o envio não aconteceu, volta a estar disponível; se o envio aconteceu, fica ligada à encomenda que esse envio abriu, mesmo que a escrita do hash da transacção tenha falhado.

AB4 (B2). Uma oferta ou obrigação criada pela relay aparece na consola da loja, e a consola nunca oferece criar outra, mesmo quando o recibo da criação não chegou à relay ou o registo das condições falhou.

AB5 (B3). Um aviso que o fornecedor de email recusa sempre não impede o fecho de uma janela recusada de ficar registado, e não gasta uma unidade de email em cada passe.

AB6 (B4). Um depósito real para um rascunho de campanha conta sempre como depósito desse rascunho, mesmo que o saldo do endereço de depósito tenha descido depois de o rascunho ser criado.

AB7. Depois de uma rotação da chave de guardião (B6), uma conta que ainda tem o guardião antigo continua a poder ser reconfigurada pela R-3 e usada pelo seu dono.

AB8. Processo. A partir de 23/09, o owner faz push de cada ramo no fim de cada passo aprovado. A verificação "nenhum commit do ramo chegou ao remoto" deixa de fazer parte das auditorias; mantém-se a proibição de push, deploy e transacções para as sessões do Claude Code.

AB9. Os ecrãs da peça 6 cujos testes só lêem o código-fonte (P6-5, P6-7 a P6-9, P6-12, P6-15 a P6-17, P6-21) são verificados num browser real no ensaio geral.
