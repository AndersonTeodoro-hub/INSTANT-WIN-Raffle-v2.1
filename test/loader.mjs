/**
 * Hook de resolução para correr os módulos da ponte em Node puro.
 *
 * O código de `api/` e `lib/` importa com extensão .js ('../../lib/bridge/env.js')
 * porque é isso que o runtime do Vercel precisa: lá o .ts já foi compilado. Em
 * Node local só existe o .ts, por isso o import não resolve.
 *
 * Este hook faz o mesmo mapeamento .js -> .ts que qualquer bundler faz. Existe
 * SÓ para os testes; não entra no build nem no deploy.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    } catch {
      // Não existe .ts com esse nome: segue o caminho normal.
    }
  }
  return nextResolve(specifier, context);
}
