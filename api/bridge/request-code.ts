// Extensão .ts explícita: ao contrário do código do browser, isto não passa
// pelo Vite. Um especificador sem extensão só resolve dentro de um bundler, e
// falha em Node puro — foi o que o smoke test apanhou.
import { notImplemented } from './_stub.ts';

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
  return notImplemented();
}
