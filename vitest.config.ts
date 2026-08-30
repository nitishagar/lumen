import { defineConfig } from 'vitest/config';

/**
 * Root Vitest entry — `npm test` runs every package project in one command.
 * Vitest 4 style: `projects` pointing at per-package config files (no
 * deprecated vitest.workspace.ts). The `@lumen-seo/site` project IS included:
 * its gate suite (G1–G9) tests the BUILT artifact, so site/dist must exist
 * first — `npm run build -w @lumen-seo/site` before `npm test` (red-team
 * round 1: with the site silently excluded, every gate was decorative on
 * the PR/main deploy path).
 *
 * The `ci-scripts` inline project covers the plain-Node CI gate scripts
 * (`scripts/ci/*.mjs`) and their tests (ci-deploy PLAN Phase 1) — they are
 * dependency-free .mjs, so they are not package projects.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'site/vitest.config.ts',
      {
        test: {
          name: 'ci-scripts',
          environment: 'node',
          include: ['test/**/*.test.mjs'],
        },
      },
    ],
  },
});
