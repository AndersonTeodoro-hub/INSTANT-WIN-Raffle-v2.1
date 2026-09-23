# Owner — instruções de operação (SPEC-BLOCO-03, P23-15, Z3)

O owner autoriza lojas, fontes de garantia e provedores, ajusta parâmetros dentro dos tectos e pausa as criações (secção 5). Não toca em fundos. O deploy e todas as transacções são feitos só pelo owner, no terminal (secção 19).

Contratos: os do commit `5d85a46` (Adenda Z1). Hash do código de criação do escrow: `7f269f74cc6a659f906194f4d87635a8d0cfa56a10d1fe774047c91e023890c4` (com o prefixo `0x`).

Ferramentas: `cast` e `forge` (Foundry), com a chave do owner num keystore local. Nos comandos abaixo, `<owner>` é o **nome** desse keystore (`--account`), nunca a chave. Nenhum comando aqui escreve uma chave num ficheiro. `RPC=https://arb1.arbitrum.io/rpc`.

## 0. Endereços

- `<ESCROW>`, `<GUARANTEE>`, `<POOL>`: os três contratos que o `DeployKeptra` imprime.
- `<REPUTATION>`: `cast call <ESCROW> "reputation()(address)" --rpc-url $RPC`.
- `<VOUCHER>`: `cast call <GUARANTEE> "voucher()(address)" --rpc-url $RPC`.
- Os seis papéis dos contratos (X3): owner, oráculo (o receiver da peça 4), árbitro, bridge (a mesma chave que publica as raízes no núcleo, H3), plataforma e provedor do pool.

## 1. Antes do deploy

1. O endereço do owner não tem código (H4, P-OWNER): `cast code <ENDERECO_DO_OWNER> --rpc-url $RPC` devolve `0x`.
2. Simular, sem `--broadcast`, no repositório dos contratos (commit `5d85a46`), com os papéis nas variáveis `KEPTRA_ORACLE`, `KEPTRA_ARBITER`, `KEPTRA_BRIDGE`, `KEPTRA_PLATFORM` e `KEPTRA_PROVIDER` (endereços públicos, nunca chaves):
   `forge script script/DeployKeptra.s.sol --rpc-url $RPC --sender <ENDERECO_DO_OWNER>`
   O script recusa dois papéis na mesma chave (P23-2, X3), o oráculo igual ao receiver da lotaria (I9) e um owner com código.
3. Com a simulação limpa, o mesmo comando com `--account <owner> --broadcast`.

## 2. Depois do deploy, por esta ordem

1. Verificar os cinco contratos no Sourcify e no Arbiscan (16.1).
2. Escrever os endereços do escrow, da garantia e do voucher em `lib/bridge-v2/config.ts` e em `lib/keptra/contracts.ts` (os mesmos três nos dois ficheiros; um teste mantém-nos iguais). Enquanto estiverem a zero, a bridge e as páginas das encomendas não correm (Q1, U35).
3. Ligar o oráculo (peça 4, `MATRIZ-PECA4-KEPTRA.md` no repositório instant-win-cre): no receiver, `setCallAllowed(<ESCROW>, attest, true)`; no escrow, `cast send <ESCROW> "setOracle(address)" <RECEIVER> --account <owner> --rpc-url $RPC` — com a verificação da secção 5 antes.
4. O provedor deposita o capital de lançamento, 100 USDC (12.3.2), pelas instruções de `POOL-PROVIDER.md`.
5. Autorizar a loja e a marca reais (2.2.6, P5): `cast send <ESCROW> "setStore(address,bool)" <CONTA_DE_CRIADOR_DA_LOJA> true --account <owner> --rpc-url $RPC`.
6. Base de dados: aplicar as migrations `0012`, `0013`, `0014` e `0015`, por esta ordem (Q6, U7). Sem elas, o apagamento a pedido falha.
7. Variáveis da bridge, só pelo nome: `BRIDGE_V2_GUARDIAN_KEY`, `BRIDGE_V2_KEEPER_KEY`, `BRIDGE_V2_ROLE_KEY`, `BRIDGE_V2_SHIP24_KEY`, `BRIDGE_V2_ORACLE_TOKEN` e `BRIDGE_V2_ARBITER_EMAIL`.
8. As tarefas da U7: o texto da página de privacidade (T14), o RPC do browser, `keptra.io` e `www.keptra.io` no projecto Vercel (mantendo `instntwin.com`), e `keptra.io` no WalletConnect.

## 3. Operação corrente

- **Pausa (H20, I8).** Trava só criações: ofertas, pagamentos, obrigações e depósitos no pool. Reembolsos, liquidações, saídas por tempo e levantamentos continuam.
  - `cast send <ESCROW> "pause()" --account <owner> --rpc-url $RPC`
  - `cast send <ESCROW> "unpause()" --account <owner> --rpc-url $RPC`
- **Taxa de transacção (8.4, tecto de 3%).** Só vale para encomendas novas (I4): `cast send <ESCROW> "setFee(uint16)" <BPS> --account <owner> --rpc-url $RPC`.
- **Escalões (13.2, H30).** `cast send <REPUTATION> "setTierParams(uint8,uint16,uint16,uint96)" <ESCALAO> <CAUCAO_BPS> <TAXA_BPS> <LIMITE> --account <owner> --rpc-url $RPC`, com `0` Nova, `1` Verificada, `2` Confiável. A Restrita e a Suspensa não são configuráveis (P23-5) e o contrato recusa-as.
- **Levantar uma suspensão (H31):** `cast send <REPUTATION> "liftSuspension(address)" <LOJA> --account <owner> --rpc-url $RPC`.
- **Divisão da taxa de protecção (12.5):** `cast send <GUARANTEE> "setProtectionSplit(uint16,uint16,uint16)" <POOL_BPS> <RESERVA_BPS> <PLATAFORMA_BPS> --account <owner> --rpc-url $RPC`.
- **Utilização máxima do pool (12.4, tecto de 80%):** `cast send <POOL> "setMaxUtilisation(uint16)" <BPS> --account <owner> --rpc-url $RPC`.
- **Lojas:** `cast send <ESCROW> "setStore(address,bool)" <LOJA> <true|false> --account <owner> --rpc-url $RPC`.

## 4. Mudar um papel, um provedor ou a fonte de garantia

Chamadas:
- Papéis do escrow (H5): `setOracle(address)`, `setArbiter(address)`, `setBridge(address)`, `setPlatform(address)` em `<ESCROW>`.
- Propriedade, em dois passos (Ownable2Step): `cast send <ESCROW> "transferOwnership(address)" <NOVO_OWNER> --account <owner> --rpc-url $RPC`, e depois o novo owner chama `acceptOwnership()`. A propriedade da garantia, do pool e da reputação segue a do escrow.
- Provedores (12.3.2): `cast send <POOL> "setProvider(address,bool)" <PROVEDOR> <true|false> --account <owner> --rpc-url $RPC`.
- Fontes de garantia (12.6): `cast send <GUARANTEE> "setSource(address,bool)" <POOL> <true|false> --account <owner> --rpc-url $RPC` e `cast send <GUARANTEE> "setDefaultSource(address)" <POOL> --account <owner> --rpc-url $RPC`.

**Antes de cada uma destas chamadas, e antes de autorizar um segundo pool, faz-se a verificação da secção 5.** Depois da chamada, repete-se.

## 5. Verificação da Z3: nenhuma chave com dois papéis

O que os contratos garantem sozinhos (Z3):
- nenhum papel do escrow — owner, owner em oferta, oráculo, árbitro, bridge e plataforma — fica na mesma chave que outro papel do escrow;
- o owner, e o endereço a quem a propriedade está oferecida, nunca são provedores do pool por defeito.

O que os contratos **não** recusam, e o owner confirma à mão (fronteira declarada da Z3):
- um provedor de um pool que não seja o por defeito;
- um provedor com o mesmo endereço de um papel do escrow.

O script de deploy garante o estado inicial (X3), com um só pool. A partir daí, a regra é esta: **antes de autorizar um segundo pool, ou de mudar um papel ou um provedor depois do deploy, confirmar que nenhuma chave fica com dois papéis.**

1. Ler os papéis do escrow:
   - `cast call <ESCROW> "owner()(address)" --rpc-url $RPC`
   - `cast call <ESCROW> "pendingOwner()(address)" --rpc-url $RPC` (zero: nenhuma propriedade em oferta)
   - `cast call <ESCROW> "oracle()(address)" --rpc-url $RPC`
   - `cast call <ESCROW> "arbiter()(address)" --rpc-url $RPC`
   - `cast call <ESCROW> "bridge()(address)" --rpc-url $RPC`
   - `cast call <ESCROW> "platform()(address)" --rpc-url $RPC`
2. Ler as fontes: `cast call <GUARANTEE> "defaultSource()(address)" --rpc-url $RPC`, e, para cada pool que se autorizou ou vai autorizar, `cast call <GUARANTEE> "isSource(address)(bool)" <POOL> --rpc-url $RPC`.
3. Em **cada** pool autorizado (o por defeito e qualquer outro), para **cada** um dos seis endereços do passo 1 que não seja zero, e para o endereço novo que se vai dar a um papel: `cast call <POOL> "isProvider(address)(bool)" <ENDERECO> --rpc-url $RPC` tem de devolver `false`.
4. Para cada provedor autorizado — o do lançamento, e o novo que se vai autorizar —, o seu endereço não pode ser nenhum dos seis do passo 1.
5. O endereço novo de um papel não pode ser nenhum dos seis do passo 1 (o contrato do escrow também o recusa), nem um provedor de nenhum pool (passo 3).
6. Se alguma destas leituras der um par repetido, a chamada **não** se faz. Resolve-se primeiro: retirar o provedor (`setProvider(<ENDERECO>, false)`) ou escolher outra chave para o papel.

As chaves da bridge — keeper, guardião, relayer e funders — não são papéis dos contratos (X3) e não entram nesta verificação; a manutenção da bridge alerta se duas delas coincidirem ("two server roles share a key", M39).
