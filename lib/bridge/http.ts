/**
 * Utilitários partilhados pelas três rotas: respostas JSON, validação de input e
 * mascaramento para logs.
 *
 * Existe porque a secção de segurança é transversal — sem um sítio comum, as
 * três rotas teriam três versões ligeiramente diferentes de "validar o email" e
 * "responder com erro", e é nas diferenças que se abrem buracos.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Erro para o cliente. Só uma mensagem escolhida por nós — nunca `err.message`,
 *  nunca stack, nunca valores internos. */
export function fail(status: number, error: string): Response {
  return json({ ok: false, error }, status);
}

/**
 * Lê o corpo JSON sem nunca deixar rebentar em 500.
 *
 * Um corpo malformado é input do utilizador, não um bug do servidor: devolve
 * `null` e a rota responde 400.
 */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Validação de email deliberadamente conservadora: um rótulo, uma arroba, um
 * domínio com ponto, sem espaços, comprimento limitado. Não tenta implementar o
 * RFC 5322 — a validação a sério é o código chegar à caixa de correio.
 */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
export const MAX_EMAIL_LENGTH = 254;

export function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_RE.test(email) ? email : null;
}

/**
 * giveawayId é uint256 no contrato: aceita-se decimal em string ou number
 * inteiro, devolve-se BigInt. Rejeita negativos, zero (os ids começam em 1) e
 * qualquer coisa que não seja dígitos.
 */
export function parseGiveawayId(value: unknown): bigint | null {
  const raw = typeof value === 'number' && Number.isInteger(value) ? String(value)
    : typeof value === 'string' ? value.trim() : null;
  if (raw === null || !/^\d{1,78}$/.test(raw)) return null;
  const id = BigInt(raw);
  return id > 0n ? id : null;
}

/** Código: exactamente 6 dígitos. */
export function parseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^\d{6}$/.test(code) ? code : null;
}

/**
 * Máscara para logs: `a***@dominio.pt`.
 *
 * Nenhum log desta ponte imprime um email completo. Serve para conseguir seguir
 * um problema sem espalhar dados pessoais pelos logs do Vercel.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Envelope de erro para qualquer excepção não prevista.
 *
 * Loga com máscara e devolve uma frase fixa. É isto que garante que uma falha
 * inesperada nunca vaza uma stack trace nem um valor interno na resposta HTTP.
 */
export function unexpected(context: string, err: unknown, email?: string): Response {
  const where = email ? `${context} (${maskEmail(email)})` : context;
  console.error(`[bridge] erro inesperado em ${where}:`, err instanceof Error ? err.name : 'unknown');
  return fail(500, 'Something went wrong. Please try again.');
}
