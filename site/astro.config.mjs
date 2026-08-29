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
