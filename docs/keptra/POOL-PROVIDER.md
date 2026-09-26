# Provedor do pool — instruções de terminal (SPEC-BLOCO-03 T11)

O provedor de capital do pool (H2: um endereço próprio, diferente do owner, autorizado pelo owner com `setProvider`) deposita e levanta pelo terminal. O painel público (`/pool`) mostra a sua quota (12.7, T11).

Ferramentas: `cast` (Foundry), com a chave do provedor num keystore local. Nos comandos abaixo, `<provedor>` é o **nome** desse keystore (`--account`), nunca a chave. `RPC=https://arb1.arbitrum.io/rpc`.

## 0. Endereços

- USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6 casas decimais: 100 USDC = `100000000`).
- Pool: a fonte por omissão da garantia — `cast call <GUARANTEE> "defaultSource()(address)" --rpc-url $RPC`.
- `<GUARANTEE>` é o endereço do KeptraGuarantee depois do deploy (config.ts, `KEPTRA_GUARANTEE`).

## 1. Depositar (12.3.2, I11)

1. `cast send <USDC> "approve(address,uint256)" <POOL> <MONTANTE> --account <provedor> --rpc-url $RPC`
2. `cast send <POOL> "deposit(uint256,address)" <MONTANTE> <ENDERECO_DO_PROVEDOR> --account <provedor> --rpc-url $RPC`

Só um endereço autorizado deposita, como pagador e como destinatário das quotas. Com a plataforma em pausa, não há depósitos (H20).

## 2. Ver a posição

- Quotas: `cast call <POOL> "balanceOf(address)(uint256)" <ENDERECO_DO_PROVEDOR> --rpc-url $RPC`
- Valor: `cast call <POOL> "convertToAssets(uint256)(uint256)" <QUOTAS> --rpc-url $RPC`
- O que sai já: `cast call <POOL> "maxRedeem(address)(uint256)" <ENDERECO_DO_PROVEDOR> --rpc-url $RPC`

## 3. Levantar (12.3.3, H26)

- Dentro da capacidade livre: `cast send <POOL> "redeem(uint256,address,address)" <QUOTAS> <ENDERECO_DO_PROVEDOR> <ENDERECO_DO_PROVEDOR> --account <provedor> --rpc-url $RPC`
- O que a capacidade livre deixa sair agora, em USDC: `cast call <POOL> "freeWithdrawCapacity()(uint256)" --rpc-url $RPC`

## 4. A fila de levantamentos (12.3.3, H26, J2, P23-11 — forma do commit 5d85a46, X8)

Acima da capacidade livre, o levantamento entra na fila. A fila é uma lista ligada dos pedidos **vivos**, pela ordem de chegada:

- **Pedir:** `cast send <POOL> "requestWithdraw(uint256)" <QUOTAS> --account <provedor> --rpc-url $RPC`. As quotas passam para a custódia do pool e continuam a partilhar ganhos e perdas até sair (H26).
- **O índice do pedido** é o número da sua linha em `queue`, e nunca muda. A linha `0` é uma sentinela e nunca é um pedido: o primeiro pedido tem o índice `1`. O índice vem no evento `WithdrawQueued(index, provider, shares)` do recibo: `cast receipt <HASH_DO_PEDIDO> --rpc-url $RPC` (o primeiro tópico a seguir à assinatura do evento é o índice). Guardar o índice: é ele que se usa para retirar o pedido.
- **Ler um pedido:** `cast call <POOL> "queue(uint256)(address,uint256,uint256,uint256)" <INDICE> --rpc-url $RPC` devolve, por esta ordem:
  1. o provedor que pediu;
  2. as quotas ainda por servir;
  3. o pedido vivo anterior na fila (`0` = é o primeiro);
  4. o pedido vivo seguinte (`0` = é o último).

  Um pedido servido por inteiro ou retirado fica com quotas `0`, anterior `0` e seguinte `0`: a linha fica como registo, fora da fila.
- **Onde está a fila:** `cast call <POOL> "queueHead()(uint256)" --rpc-url $RPC` é o primeiro pedido vivo e `cast call <POOL> "queueTail()(uint256)" --rpc-url $RPC` o último; `0` nos dois quer dizer fila vazia. Para percorrer a fila, começa-se em `queueHead` e segue-se o quarto campo de cada pedido até `0`.
- **Quantos esperam:** `cast call <POOL> "pendingRequests()(uint256)" --rpc-url $RPC`. Conta só os pedidos vivos: um pedido retirado sai da contagem no momento (P23-11).
- **Servir a fila (qualquer pessoa):** `cast send <POOL> "processQueue(uint256)" 10 --account <provedor> --rpc-url $RPC`. O número é quantos pedidos **vivos** servir, a começar em `queueHead`; os retirados já não estão na lista e não gastam nenhuma dessas posições. Com a capacidade livre curta, o primeiro pedido é servido em parte e fica à cabeça com o resto.
- **Retirar um pedido (J2):** `cast send <POOL> "cancelWithdraw(uint256)" <INDICE> --account <provedor> --rpc-url $RPC`. Só o provedor do pedido o retira, e só a parte ainda por servir; as quotas voltam ao seu saldo. O índice `0`, um índice que não existe, ou um pedido já servido ou retirado são recusados (`NotQueued`).

As quotas não são transferíveis (H27, P23-8): `transfer` e `transferFrom` são sempre recusados. Fora do `redeem` e do serviço da fila, que as queimam, as quotas só saem do saldo do provedor para a custódia da fila, e só voltam a ele por `cancelWithdraw`.
