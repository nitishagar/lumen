import { defineConfig } from 'astro/config';

// Pages project site under https://nitishagar.github.io/lumen/ — every URL
// carries the /lumen base (RENAMES.md; BA-1). Static output only: the site
// fetches nothing at runtime.
export default defineConfig({
  site: 'https://nitishagar.github.io',
  base: '/lumen',
  output: 'static',
  build: { assets: 'assets' },
});
// The prerender entry in site/dist imports `cookie` at runtime; Node's
// walk-up resolution from site/dist must find astro's ESM cookie@2.x, not
// the CJS cookie@0.7.2 that @lumen-seo/mcp's express chain hoists to the
// repo root ("Named export 'parseCookie' not found"). vite.ssr.noExternal
// does not reach the prerender entry, so the fix is a direct `cookie`
// dependency in site/package.json: npm installs the ESM copy at
// site/node_modules/cookie — the first directory walk-up hits.
