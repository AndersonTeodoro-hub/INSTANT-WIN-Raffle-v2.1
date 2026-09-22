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
- Acima dela, em fila: `cast send <POOL> "requestWithdraw(uint256)" <QUOTAS> --account <provedor> --rpc-url $RPC`. As quotas em fila continuam a partilhar ganhos e perdas até sair (H26).
- Servir a fila (qualquer pessoa): `cast send <POOL> "processQueue(uint256)" 10 --account <provedor> --rpc-url $RPC`
- Retirar um pedido da fila (J2): `cast send <POOL> "cancelWithdraw(uint256)" <INDICE> --account <provedor> --rpc-url $RPC`

As quotas não são transferíveis (H27).
