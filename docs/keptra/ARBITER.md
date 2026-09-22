# Árbitro — instruções de terminal (SPEC-BLOCO-03 T10)

O árbitro decide uma contestação entre os dois destinos que a spec permite (T10, H15), com a sua própria chave, pelo terminal. Não há página de árbitro.

Ferramentas: `cast` (Foundry), com a chave do árbitro num keystore local. Nos comandos abaixo, `<arbitro>` é o **nome** desse keystore (`--account`), nunca a chave. Nenhum comando aqui escreve uma chave num ficheiro.

## 0. Quando

Cada contestação chega por email ao endereço `BRIDGE_V2_ARBITER_EMAIL` (P22), com o número da encomenda e o prazo: 5 dias a contar da contestação (8.2). Passado esse prazo, qualquer pessoa pode fechar a encomenda só pela prova (`resolveAbsentArbiter`), e o keeper fá-lo dentro de uma hora.

## 1. Ler as evidências e a descrição do produto

A rota `POST /api/bridge/v2/arbiter/evidence` devolve os dois textos (destinatário e loja), a descrição do produto (T4) e o `document` — o hash que se passa ao contrato.

1. Escolher o instante, em milissegundos: `ISSUED=$(date +%s%3N)`.
2. Assinar o desafio (EIP-191), com a mensagem exacta:
   `cast wallet sign --account <arbitro> "Keptra arbiter: read the evidence of order <ID> at $ISSUED"`
3. Enviar, dentro de 5 minutos:
   `curl -s -X POST https://keptra.io/api/bridge/v2/arbiter/evidence -H 'content-type: application/json' -d '{"orderId":"<ID>","issuedAt":'$ISSUED',"signature":"<ASSINATURA>"}'`

A rota compara o signatário com `arbiter()` do escrow nesse momento. Uma assinatura antiga ou de outra chave recebe 401.

## 2. Decidir

`cast send <ESCROW> "decide(uint256,bool,uint8,bytes32)" <ID> <STORE_WINS> <FRAUD> <DOCUMENT> --account <arbitro> --rpc-url https://arb1.arbitrum.io/rpc`

- `STORE_WINS`: `true` ou `false`.
  - Contestação de entrega: `true` = tudo à loja, `false` = tudo ao destinatário (T10).
  - Contestação de recusa (9.3, H15): `true` = recusa válida (divisão de T8), `false` = recusa inválida, tudo ao destinatário.
- `FRAUD` (H21, I11): `0` nenhuma, `1` FALSE_PROOF, `2` NEVER_SHIPPED, `3` NOT_AS_DESCRIBED, `4` IDENTITY_ABUSE. Só dentro de uma decisão, e nunca como texto livre.
- `DOCUMENT`: o `document` devolvido no passo 1 (P17, AQ3). Cobre os dois textos.

`<ESCROW>` é o endereço do KeptraEscrow depois do deploy (config.ts, `KEPTRA_ESCROW`).

## 3. Verificar

`cast call <ESCROW> "getOrder(uint256)" <ID> --rpc-url https://arb1.arbitrum.io/rpc` — o estado passa a `5` (CLOSED). O evento `ArbiterDecided` fica no Arbiscan.
