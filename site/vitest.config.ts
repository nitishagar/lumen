import { defineConfig } from 'vitest/config';

/**
 * Site gate suite — deterministic tests over the built artifact.
 *
 * `npm test -w @lumen-seo/site` requires a prior build BY DESIGN (no silent
 * rebuilds): the globalSetup fails fast with guidance when site/dist is
 * missing. `npm run check -w @lumen-seo/site` chains build → test.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
  },
});
