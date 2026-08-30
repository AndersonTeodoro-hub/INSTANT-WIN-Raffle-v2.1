import { requireEnv } from './env.js';

/**
 * Códigos de verificação de 6 dígitos.
 *
 * Tudo aqui usa Web Crypto (`globalThis.crypto`), não o módulo `node:crypto`.
 * Duas razões: está disponível no runtime do Vercel sem importar nada, e os
 * tipos já vêm do `lib: ["DOM"]` do tsconfig — evita instalar `@types/node` só
 * para hashear. Nada neste ficheiro loga um código em claro.
 */

/** Validade do código (SPEC §3: 10 minutos). */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Tentativas de verificação por código (SPEC §4: máximo 5). */
export const MAX_ATTEMPTS = 5;
/** Códigos pedidos por email+campanha por hora. Trava reenvios em catadupa. */
export const MAX_CODES_PER_HOUR = 3;

const CODE_DIGITS = 6;
const CODE_MIN = 100_000; // sem zeros à esquerda: 6 dígitos sempre
const CODE_RANGE = 900_000; // 100000..999999

/**
 * Gera um código de 6 dígitos criptograficamente aleatório.
 *
 * Rejeição de amostras enviesadas: 2^32 não é múltiplo de 900000, por isso os
 * últimos valores do espaço sairiam com probabilidade ligeiramente maior. O laço
 * descarta essa cauda. Sem isto o código continuaria "aleatório" mas não
 * uniforme, e é exactamente o tipo de fraqueza que ninguém nota até ser tarde.
 */
export function generateCode(): string {
  const limit = Math.floor(0xffff_ffff / CODE_RANGE) * CODE_RANGE;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= limit);
  return String(CODE_MIN + (n % CODE_RANGE)).padStart(CODE_DIGITS, '0');
}

/**
 * Chave HMAC dos códigos, derivada de BRIDGE_SEED — sem env var nova.
 *
 * NÃO usa o BRIDGE_SEED directamente como chave: separação de domínios. A chave
 * efectiva é HMAC(seed, rótulo fixo), portanto uma eventual fuga desta subchave
 * não é a seed, e o mesmo segredo pode servir dois fins sem os cruzar.
 *
 * Escolhida a seed e não a SUPABASE_SERVICE_KEY porque a service key é rodável a
 * qualquer momento (e a rotação invalidaria códigos em voo), enquanto rodar a
 * seed já implica perder as wallets derivadas — um evento em que invalidar
 * códigos de 10 minutos é o menor dos problemas.
 */
const HMAC_LABEL = 'instantwin-bridge-code-hmac-v1';

async function codeKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const seedKey = await crypto.subtle.importKey(
    'raw', enc.encode(requireEnv('BRIDGE_SEED')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const derived = await crypto.subtle.sign('HMAC', seedKey, enc.encode(HMAC_LABEL));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * Hash do código, ligado ao email e à campanha.
 *
 * O email e o giveawayId entram na mensagem para o hash de um código não poder
 * ser reaproveitado noutra campanha nem por outra pessoa, mesmo que por azar
 * saia o mesmo código de 6 dígitos.
 */
export async function hashCode(code: string, email: string, giveawayId: string): Promise<string> {
  const key = await codeKey();
  const msg = new TextEncoder().encode(`${email.toLowerCase()}:${giveawayId}:${code}`);
  const sig = await crypto.subtle.sign('HMAC', key, msg);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Comparação em tempo constante.
 *
 * Um `===` sobre hashes hexadecimais sai mais cedo no primeiro byte diferente, e
 * essa diferença de tempo é mensurável. Aqui percorre-se sempre tudo.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Instante de expiração de um código gerado agora. */
export function codeExpiry(now: number = Date.now()): Date {
  return new Date(now + CODE_TTL_MS);
}

export function isExpired(expiresAt: string | Date, now: number = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}
