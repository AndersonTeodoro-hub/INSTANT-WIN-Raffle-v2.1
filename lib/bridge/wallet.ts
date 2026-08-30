import { mnemonicToAccount } from 'viem/accounts';
import type { HDAccount } from 'viem';
import { requireEnv } from './env.js';

/**
 * Wallets invisíveis: derivação BIP-44 a partir de UMA mnemónica (SPEC §2d).
 *
 * Caminho: m/44'/60'/0'/0/{index}. É o default do `mnemonicToAccount` do viem
 * quando só se passa `addressIndex` — verificado contra os endereços canónicos
 * da mnemónica de teste pública do Anvil/Hardhat (ver test/bridge.test.mjs).
 *
 * REGRA: a chave privada nunca sai deste módulo. O objecto `HDAccount` do viem
 * assina em memória; nada aqui devolve, loga, serializa ou persiste a chave. O
 * que vai para a base de dados é só o `index` e o `address` público.
 *
 * O índice é atribuído pela sequence do Postgres (migração 0001), nunca
 * calculado aqui — dois pedidos concorrentes calculariam o mesmo.
 */

/** Deriva a conta do índice. Só em memória, só durante a invocação. */
export function deriveAccount(index: number): HDAccount {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`[bridge] wallet_index inválido: tem de ser inteiro >= 0`);
  }
  return mnemonicToAccount(requireEnv('BRIDGE_SEED'), { addressIndex: index });
}

/** Só o endereço público, para gravar na BD. */
export function deriveAddress(index: number): `0x${string}` {
  return deriveAccount(index).address;
}
