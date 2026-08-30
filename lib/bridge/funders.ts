import { privateKeyToAccount } from 'viem/accounts';
import type { Account, Hex } from 'viem';
import { optionalEnv } from './env.js';

/**
 * Pool de funders paralelos.
 *
 * MATEMÁTICA DO DÉBITO. O nonce de uma conta é serializado por natureza da
 * chain: uma conta só consegue uma transação confirmada de cada vez em ordem,
 * portanto UM funder é um débito de ~1 funding por bloco, faça-se o que se
 * fizer em código. N funders independentes têm N nonces independentes e correm
 * em paralelo: o débito é ~N fundings simultâneos. Para picos de centenas de
 * entradas por minuto, N na ordem das dezenas chega — com fundings a demorarem
 * ~2s em Arbitrum, N=20 dá ~600/min. O tamanho do pool é configuração, não
 * código: acrescentar chaves a BRIDGE_FUNDER_PKS aumenta o débito sem deploy.
 *
 * DEGRAU SEGUINTE. Um paymaster ERC-4337 elimina esta camada inteira: a conta
 * do participante passa a ser uma smart account cujo gas é pago pelo paymaster,
 * e deixa de haver funding, pool, leases e nonces para gerir. É uma decisão do
 * owner e uma mudança de arquitectura, não uma optimização — não implementada.
 */

/** Duração do lease. Mais longo que qualquer invocação possível (o limite de uma
 *  serverless function anda nos 10-15s), para uma function morta a meio libertar
 *  o funder sozinha em vez de o prender para sempre. */
export const LEASE_TTL_MS = 30_000;

/** Tempo máximo à espera de um funder livre. Abaixo do limite da function: mais
 *  vale um 503 honesto do que a invocação a ser cortada a meio do funding. */
export const ACQUIRE_DEADLINE_MS = 10_000;

/** Intervalo entre varrimentos do pool quando está tudo ocupado. */
const RETRY_INTERVAL_MS = 250;

/** Todos ocupados dentro do prazo — carga, não avaria. Resposta 503. */
export class AllFundersBusyError extends Error {
  constructor() { super('all funders busy'); this.name = 'AllFundersBusyError'; }
}

/** Todos sem saldo — avaria operacional, precisa de intervenção humana. */
export class FundersDepletedError extends Error {
  constructor() { super('funders depleted'); this.name = 'FundersDepletedError'; }
}

/** Endereço mascarado para logs: 0xAB..CD. Nunca o endereço inteiro. */
export function maskAddress(address: string): string {
  return address.length >= 6 ? `${address.slice(0, 4)}..${address.slice(-2)}` : '0x..';
}

/**
 * Lê o pool das env vars.
 *
 * Preferida: BRIDGE_FUNDER_PKS (lista separada por vírgulas). Aceita-se também
 * BRIDGE_FUNDER_PK no singular como pool de um, que é o nome no SPEC §5 — o
 * SPEC será emendado para a forma plural; até lá as duas funcionam e a plural
 * ganha se ambas estiverem definidas.
 *
 * As chaves só existem em memória. Nada aqui as devolve, loga ou serializa: o
 * que sai são objectos `Account` do viem, que assinam sem expor a chave.
 */
export function loadFunderPool(): Account[] {
  const raw = optionalEnv('BRIDGE_FUNDER_PKS') ?? optionalEnv('BRIDGE_FUNDER_PK');
  if (!raw) {
    throw new Error('[bridge] variável de ambiente em falta: BRIDGE_FUNDER_PKS (ou BRIDGE_FUNDER_PK) — configurar no dashboard do Vercel');
  }
  const pool = raw.split(',').map((s) => s.trim()).filter(Boolean)
    .map((pk) => privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as Hex));
  if (pool.length === 0) {
    throw new Error('[bridge] BRIDGE_FUNDER_PKS está definida mas vazia');
  }
  return pool;
}

/** Baralha uma cópia (Fisher-Yates). Sem isto, todas as invocações tentariam o
 *  índice 0 primeiro e disputavam o mesmo funder a cada pico. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** O mínimo do cliente Supabase que este módulo usa — permite injectar um duplo
 *  nos testes sem falsificar o SDK inteiro. */
export interface LockStore {
  ensureRows(size: number): Promise<void>;
  /** UPDATE condicional atómico. `true` = lease adquirido. */
  tryAcquire(index: number, token: string, until: Date): Promise<boolean>;
  release(index: number, token: string): Promise<void>;
}

export interface FunderLease {
  index: number;
  token: string;
  account: Account;
}

export interface AcquireDeps {
  store: LockStore;
  pool: readonly Account[];
  /** Saldo mínimo exigido ao funder para esta operação. */
  needed: bigint;
  getBalance: (address: Hex) => Promise<bigint>;
  /* Injectáveis para teste — em produção usam-se os defaults. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  order?: <T>(items: readonly T[]) => T[];
  newToken?: () => string;
  deadlineMs?: number;
  leaseTtlMs?: number;
}

/**
 * Adquire um funder livre COM saldo, ou lança.
 *
 * Ordem aleatória dos índices, varrimento repetido até ao prazo. Um funder
 * adquirido mas sem saldo é libertado imediatamente e marcado — não se volta a
 * tentar, e se todos ficarem marcados o erro é `FundersDepletedError`, distinto
 * de `AllFundersBusyError`: um é falta de dinheiro (alguém tem de agir), o outro
 * é excesso de procura (o cliente repete).
 *
 * Quem chama é responsável por libertar o lease num `finally`.
 */
export async function acquireFunder(deps: AcquireDeps): Promise<FunderLease> {
  const {
    store, pool, needed, getBalance,
    now = () => Date.now(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    order = shuffled,
    newToken = () => crypto.randomUUID(),
    deadlineMs = ACQUIRE_DEADLINE_MS,
    leaseTtlMs = LEASE_TTL_MS,
  } = deps;

  await store.ensureRows(pool.length);

  const depleted = new Set<number>();
  const giveUpAt = now() + deadlineMs;

  while (now() < giveUpAt) {
    for (const index of order(pool.map((_, i) => i))) {
      if (depleted.has(index)) continue;

      const token = newToken();
      if (!(await store.tryAcquire(index, token, new Date(now() + leaseTtlMs)))) continue;

      const account = pool[index]!;
      try {
        if ((await getBalance(account.address)) >= needed) {
          return { index, token, account };
        }
      } catch (err) {
        // Falha a ler o saldo não é falta de saldo: liberta e tenta outro, sem
        // marcar como esgotado, para um RPC intermitente não esvaziar o pool.
        await store.release(index, token);
        continue;
      }

      // Adquirido mas sem saldo: liberta já e não volta a este.
      depleted.add(index);
      await store.release(index, token);
      console.error(`[bridge] funder sem saldo: index=${index} ${maskAddress(account.address)}`);
    }

    if (depleted.size === pool.length) throw new FundersDepletedError();
    if (now() >= giveUpAt) break;
    await sleep(RETRY_INTERVAL_MS);
  }

  if (depleted.size === pool.length) throw new FundersDepletedError();
  throw new AllFundersBusyError();
}

/**
 * `LockStore` real, sobre a tabela `bridge_funder_locks` (migração 0002).
 *
 * A aquisição é UM `UPDATE ... WHERE funder_index = X AND (locked_until IS NULL
 * OR locked_until < agora)`. Um UPDATE isolado é atómico no Postgres: duas
 * invocações a correrem isto ao mesmo tempo são serializadas pelo lock de linha,
 * e só a primeira vê a condição verdadeira. A segunda não recebe linha nenhuma —
 * que é como se sabe que não se ganhou o lease.
 */
export function supabaseLockStore(db: {
  from: (table: string) => any;
}): LockStore {
  const T = 'bridge_funder_locks';
  let ensured = 0;

  return {
    async ensureRows(size) {
      // Memoizado por processo: as linhas só têm de nascer uma vez, e um cold
      // start novo repete o upsert sem consequências (ignoreDuplicates).
      if (ensured >= size) return;
      const rows = Array.from({ length: size }, (_, i) => ({ funder_index: i }));
      const { error } = await db.from(T).upsert(rows, { onConflict: 'funder_index', ignoreDuplicates: true });
      if (error) throw error;
      ensured = size;
    },

    async tryAcquire(index, token, until) {
      const { data, error } = await db.from(T)
        .update({ locked_until: until.toISOString(), lock_token: token, updated_at: new Date().toISOString() })
        .eq('funder_index', index)
        .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`)
        .select('funder_index');
      if (error) throw error;
      return Array.isArray(data) && data.length === 1;
    },

    async release(index, token) {
      // O token no WHERE impede que uma invocação cujo lease já expirou liberte
      // o lease de outra que entretanto adquiriu o mesmo funder.
      const { error } = await db.from(T)
        .update({ locked_until: null, lock_token: null, updated_at: new Date().toISOString() })
        .eq('funder_index', index).eq('lock_token', token);
      if (error) throw error;
    },
  };
}
