import { defineConfig } from 'vitest/config';

/**
 * Root Vitest entry — `npm test` runs every package project in one command.
 * Vitest 4 style: `projects` pointing at per-package config files (no
 * deprecated vitest.workspace.ts). The private `@seolite/site` workspace
 * ships no vitest config, so it is naturally excluded (PLAN.md Phase 1).
 */
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});
