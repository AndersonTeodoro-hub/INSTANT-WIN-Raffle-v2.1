import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { arbitrum } from 'viem/chains';
import type { Account, Hex } from 'viem';
import { GIVEAWAY_MANAGER_ABI, GiveawayStatus } from './abi.js';
import { optionalEnv } from './env.js';

/**
 * Camada on-chain da ponte: ler campanhas, financiar gas, submeter enter().
 *
 * RPC: por omissão o MESMO endpoint público que o frontend já usa
 * (constants.ts:22, `https://arb1.arbitrum.io/rpc`) — reutilizar a fonte
 * existente evita ter duas verdades sobre onde a app lê a chain. É público e tem
 * rate limit; `ARBITRUM_RPC_URL` permite apontar para um endpoint dedicado sem
 * ser obrigatório configurá-lo.
 */
const DEFAULT_RPC = 'https://arb1.arbitrum.io/rpc';

/** GiveawayManager V1, Arbitrum One, verificado (Exact Match). */
export const GIVEAWAY_MANAGER = '0x1F2aE94Fd04Ce15cb2A3a09B7b81eb9e16781cB0' as const;

/** Margem sobre o gas estimado. O enter() de um participante novo escreve em
 *  storage; uma estimativa apertada falha se o preço do gas subir entre a
 *  estimativa e a submissão. 50% é barato em Arbitrum e evita ficar a meio. */
const GAS_MARGIN_NUM = 150n;
const GAS_MARGIN_DEN = 100n;

export function publicClient() {
  return createPublicClient({ chain: arbitrum, transport: http(optionalEnv('ARBITRUM_RPC_URL') ?? DEFAULT_RPC) });
}

function walletClientFor(account: Account) {
  return createWalletClient({ account, chain: arbitrum, transport: http(optionalEnv('ARBITRUM_RPC_URL') ?? DEFAULT_RPC) });
}

export interface GiveawayState {
  status: number;
  endTime: bigint;
  eligibilityRoot: Hex;
  isOpen: boolean;
  hasEnded: boolean;
  isAllowlisted: boolean;
}

/** Lê o estado da campanha. Uma chamada, tudo o que a ponte precisa de decidir. */
export async function readGiveaway(giveawayId: bigint): Promise<GiveawayState> {
  const g = await publicClient().readContract({
    address: GIVEAWAY_MANAGER,
    abi: GIVEAWAY_MANAGER_ABI,
    functionName: 'getGiveaway',
    args: [giveawayId],
  });
  const endTime = g.endTime;
  return {
    status: g.status,
    endTime,
    eligibilityRoot: g.eligibilityRoot,
    isOpen: g.status === GiveawayStatus.OPEN,
    hasEnded: BigInt(Math.floor(Date.now() / 1000)) >= endTime,
    // Campanhas com allowlist estão fora da ponte V1 (SPEC §3): a árvore Merkle
    // teria de conter as wallets derivadas antes de existirem.
    isAllowlisted: g.eligibilityRoot !== `0x${'0'.repeat(64)}`,
  };
}

/** Idempotência: a wallet já entrou nesta campanha? */
export async function hasEntered(giveawayId: bigint, wallet: Hex): Promise<boolean> {
  return publicClient().readContract({
    address: GIVEAWAY_MANAGER,
    abi: GIVEAWAY_MANAGER_ABI,
    functionName: 'hasEntered',
    args: [giveawayId, wallet],
  });
}

export async function getBalance(wallet: Hex): Promise<bigint> {
  return publicClient().getBalance({ address: wallet });
}

/**
 * Custo estimado de um enter() para esta wallet, já com margem.
 *
 * Estima contra o contrato real, com a wallet derivada como remetente — é a
 * única forma de apanhar o custo verdadeiro, que difere entre um participante
 * novo e um slot de storage já tocado.
 */
export async function estimateEnterCost(giveawayId: bigint, wallet: Hex): Promise<bigint> {
  const client = publicClient();
  const [gas, fees] = await Promise.all([
    client.estimateContractGas({
      address: GIVEAWAY_MANAGER,
      abi: GIVEAWAY_MANAGER_ABI,
      functionName: 'enter',
      args: [giveawayId, []],
      account: wallet,
    }),
    client.estimateFeesPerGas(),
  ]);
  const price = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  return (gas * price * GAS_MARGIN_NUM) / GAS_MARGIN_DEN;
}

/**
 * Envia gas de UM funder do pool para a wallet derivada e espera pelo receipt.
 *
 * A conta vem de fora, já com lease adquirido (ver funders.ts): este módulo não
 * escolhe funders nem lê chaves do ambiente. Enquanto o lease durar, esta é a
 * única invocação a usar esta conta, e por isso o nonce 'pending' é seguro —
 * era exactamente a colisão que o pool existe para eliminar.
 */
export async function fundWalletFrom(funder: Account, to: Hex, amount: bigint): Promise<Hex> {
  const client = publicClient();

  const balance = await client.getBalance({ address: funder.address });
  if (balance < amount) {
    // Sem o endereço do funder na mensagem: quem lê o erro não fica a saber que
    // wallets financiam a ponte.
    throw new Error(`[bridge] funder sem saldo suficiente (precisa de ${formatEther(amount)} ETH)`);
  }

  const hash = await walletClientFor(funder).sendTransaction({
    to,
    value: amount,
    nonce: await client.getTransactionCount({ address: funder.address, blockTag: 'pending' }),
  });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * A wallet derivada assina e envia o seu próprio enter().
 *
 * É esta a razão de existir da ponte: o contrato exige msg.sender == participante
 * (enter() não tem parâmetro de address e a folha Merkle é keccak256(msg.sender)),
 * portanto não há relayer possível — cada participante tem de assinar a sua.
 */
export async function sendEnter(account: Account, giveawayId: bigint): Promise<Hex> {
  const hash = await walletClientFor(account).writeContract({
    address: GIVEAWAY_MANAGER,
    abi: GIVEAWAY_MANAGER_ABI,
    functionName: 'enter',
    args: [giveawayId, []],
    chain: arbitrum,
    account,
  });
  return hash;
}

export async function waitForReceipt(hash: Hex) {
  return publicClient().waitForTransactionReceipt({ hash });
}

/** Link público da transação, para a UI mostrar a prova. */
export function arbiscanUrl(hash: string): string {
  return `https://arbiscan.io/tx/${hash}`;
}

/**
 * Traduz um revert conhecido do contrato numa frase para o utilizador.
 *
 * O viem descodifica o erro por nome porque o ABI inclui os `error` (ver abi.ts).
 * Um erro não mapeado NUNCA passa o texto cru para a resposta — pode conter
 * dados internos — devolve-se uma frase genérica.
 */
export function mapContractError(err: unknown): string | null {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (text.includes('AlreadyEntered')) return 'This email has already entered this giveaway.';
  if (text.includes('EntriesClosed')) return 'Entries for this giveaway are closed.';
  if (text.includes('GiveawayNotOpen')) return 'This giveaway is not open for entries.';
  if (text.includes('ParticipantCapReached')) return 'This giveaway has reached its participant limit.';
  if (text.includes('NotEligible')) return 'This giveaway requires an eligibility list.';
  if (text.includes('EnforcedPause')) return 'Entries are temporarily paused.';
  return null;
}
