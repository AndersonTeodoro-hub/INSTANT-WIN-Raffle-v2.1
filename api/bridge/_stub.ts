/**
 * Resposta partilhada pelos três stubs da ponte.
 *
 * Ficheiro prefixado com `_`: o Vercel não expõe como rota nada em `api/` cujo
 * nome comece por underscore, por isso isto é um módulo interno e não um
 * quarto endpoint.
 *
 * Assinatura Web (Request -> Response), suportada pelo runtime Node do Vercel.
 * Escolhida por não precisar dos tipos de `@vercel/node`: o `lib` do tsconfig
 * já traz `Request`/`Response` do DOM, portanto zero dependências novas.
 */
export function notImplemented(): Response {
  return new Response(JSON.stringify({ error: 'not implemented' }), {
    status: 501,
    headers: { 'content-type': 'application/json' },
  });
}
