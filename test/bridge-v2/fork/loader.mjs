/**
 * Module resolution for the fork suite. SPEC-BLOCO-03.
 *
 * The same `.js` -> `.ts` mapping and JSON attributes as ../loader.mjs, and ONE
 * redirect instead of three: the database. chain.ts and keptraChain.ts are the
 * real modules here, talking to a local anvil fork of Arbitrum One — which is the
 * point of this suite. The database stays doubled because there is no Supabase
 * in a test, and what the suite is about is the chain.
 */

const ROOT = new URL('../../../', import.meta.url).href;
const DOUBLES = new URL('../doubles/', import.meta.url).href;
const REDIRECTS = new Map([
  [`${ROOT}lib/bridge-v2/db.ts`, `${DOUBLES}db.mjs`],
  // SPEC-BLOCO-03 P24: the three contract addresses, pointed at the contracts
  // the fork suite deploys from the 183a2b4 artifacts. Everything else is config.ts.
  [`${ROOT}lib/bridge-v2/config.ts`, `${DOUBLES}config.mjs`],
]);

function redirect(result, parentURL) {
  if (typeof parentURL === 'string' && parentURL.startsWith(DOUBLES)) return result;
  const target = REDIRECTS.get(result.url);
  return target === undefined ? result : { ...result, url: target, format: 'module' };
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.json')) {
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, format: 'json', importAttributes: { type: 'json' } };
  }
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      return redirect(await nextResolve(`${specifier.slice(0, -3)}.ts`, context), context.parentURL);
    } catch {
      // No .ts by that name: fall through.
    }
  }
  return redirect(await nextResolve(specifier, context), context.parentURL);
}
