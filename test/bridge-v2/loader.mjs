/**
 * Module resolution for the Bridge V2 test suite.
 *
 * Three jobs, and only the first is shared with the V1 loader.
 *
 * 1. `.js` -> `.ts`. Production code imports with the extension the Vercel
 *    runtime needs, where the TypeScript has already been compiled. Locally only
 *    the `.ts` exists. This is the same mapping any bundler does.
 *
 * 2. JSON import attributes. `lib/bridge-v2/config.ts` does
 *    `import vercelConfig from '../../vercel.json'`, which is what makes the
 *    route-duration invariant at the foot of that file executable. Bare Node ESM
 *    refuses a JSON module without `with { type: 'json' }`; esbuild, which is what
 *    the Vercel Node runtime compiles these files with, does not. The attribute is
 *    supplied here so the test process can load what production loads. This is a
 *    property of the loader, not a change to production code.
 *
 * 3. Test doubles. `lib/bridge-v2/db.ts` and `lib/bridge-v2/chain.ts` are the two
 *    modules that reach a network the tests may not touch, so imports of them
 *    resolve to the doubles in ./doubles instead. Everything else — the routes,
 *    the processor, the pure modules, the funders, the logger — is the real
 *    module under test. A double importing the real module it stands in for is
 *    exempt, or it would redirect to itself.
 *
 * Exists only for the tests. It is not in the build and not in the deploy.
 */

const ROOT = new URL('../../', import.meta.url).href;
const DOUBLES = new URL('./doubles/', import.meta.url).href;

/** Real module -> double. Keyed by resolved URL so a specifier cannot dodge it. */
const REDIRECTS = new Map([
  [`${ROOT}lib/bridge-v2/db.ts`, `${DOUBLES}db.mjs`],
  [`${ROOT}lib/bridge-v2/chain.ts`, `${DOUBLES}chain.mjs`],
]);

function redirect(result, parentURL) {
  // A double may import the module it stands in for, so that the pure half of
  // that module (checked, planGas, ChainError) stays the real code under test.
  if (typeof parentURL === 'string' && parentURL.startsWith(DOUBLES)) return result;
  const target = REDIRECTS.get(result.url);
  return target === undefined ? result : { ...result, url: target, format: 'module' };
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.json')) {
    // The attribute has to be on the RESULT, not on the context handed to the
    // next hook: it is what the load step reads, and what the module cache keys
    // on. Passing it down instead leaves the load step with nothing.
    const resolved = await nextResolve(specifier, context);
    return { ...resolved, format: 'json', importAttributes: { type: 'json' } };
  }

  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      return redirect(await nextResolve(`${specifier.slice(0, -3)}.ts`, context), context.parentURL);
    } catch {
      // No .ts by that name: fall through to the ordinary resolution.
    }
  }

  return redirect(await nextResolve(specifier, context), context.parentURL);
}
