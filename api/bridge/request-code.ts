/**
 * POST /api/bridge/request-code
 *
 * Gera o código de 6 dígitos, grava o hash e envia o email (SPEC-BRIDGE §2b).
 *
 * STUB: responde 501 e mais nada. Existe para validar o encaminhamento do
 * Vercel — que as rotas /api/* chegam a uma function e não são apanhadas pelo
 * rewrite da SPA — antes de haver lógica para depurar por cima. A lógica é a
 * Parte 2.
 */
export default function handler(_request: Request): Response {
  // Stub inline de propósito — sem imports relativos até à Parte 2 (ref: incidente ERR_MODULE_NOT_FOUND 30/08).
  return new Response(JSON.stringify({ error: 'not implemented' }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' },
  });
}
