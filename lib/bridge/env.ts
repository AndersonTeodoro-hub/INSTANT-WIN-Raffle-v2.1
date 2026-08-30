/**
 * Leitura fail-fast das variáveis de ambiente da ponte Web2.
 *
 * Os nomes vêm do SPEC-BRIDGE §5 e são só isso: NOMES. Nenhum valor, nenhum
 * default, nenhum placeholder com forma de chave vive neste repositório — os
 * valores são configurados pelo owner no dashboard do Vercel e só existem em
 * memória da function.
 *
 * Falhar cedo e alto é deliberado: uma variável em falta tem de rebentar no
 * primeiro pedido, com o nome da variável na mensagem, e não silenciosamente
 * mais à frente com um `undefined` a chegar ao Supabase ou a um signer.
 */

// O projecto não tem @types/node (é um projecto de browser). Declarar aqui só o
// que usamos evita instalar um pacote de tipos inteiro para ler cinco chaves.
// Como este ficheiro é um módulo, a declaração é local e não polui o global.
declare const process: { env: Record<string, string | undefined> };

/** Nomes das variáveis exigidas pelo SPEC-BRIDGE §5. */
export const BRIDGE_ENV_KEYS = [
  'BRIDGE_SEED',
  'BRIDGE_FUNDER_PK',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'RESEND_API_KEY',
] as const;

export type BridgeEnvKey = (typeof BRIDGE_ENV_KEYS)[number];
export type BridgeEnv = Record<BridgeEnvKey, string>;

/**
 * Devolve uma variável, ou lança nomeando-a.
 *
 * A mensagem traz o nome mas nunca o valor — nem sequer o comprimento, que num
 * log já é informação sobre o segredo.
 */
export function requireEnv(key: BridgeEnvKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`[bridge] variável de ambiente em falta: ${key} — configurar no dashboard do Vercel`);
  }
  return value;
}

/**
 * Lê as cinco de uma vez e lança com a lista completa das que faltam.
 *
 * Uma lista de cada vez obrigava a um deploy por variável esquecida; assim uma
 * só mensagem diz tudo o que falta configurar.
 */
export function loadBridgeEnv(): BridgeEnv {
  const missing: BridgeEnvKey[] = [];
  const found = {} as BridgeEnv;

  for (const key of BRIDGE_ENV_KEYS) {
    const value = process.env[key];
    if (value) found[key] = value;
    else missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `[bridge] variáveis de ambiente em falta: ${missing.join(', ')} — configurar no dashboard do Vercel`,
    );
  }

  return found;
}
