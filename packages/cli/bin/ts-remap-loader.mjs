/**
 * Resolve hook for running the workspace's TypeScript sources under plain
 * Node (BA-13: package exports point at `src/*.ts`, no build step until M2).
 *
 * Node's native type stripping executes `.ts` files but does NOT remap the
 * TypeScript convention of `./x.js` specifiers to `./x.ts` the way bundlers
 * do — so every intra-package import would fail with ERR_MODULE_NOT_FOUND.
 * This hook retries a failed `.js` resolution against the sibling `.ts` file.
 * It changes nothing for specifiers that resolve normally (node: builtins,
 * real .js files, bare package specifiers).
 */

/** @param {string} specifier @param {import('node:module').ResolveContext} context @param {import('node:module').NextResolve} next */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
      return next(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw err;
  }
}
