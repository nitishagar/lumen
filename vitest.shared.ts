import type { ViteUserConfig } from 'vitest/config';

/**
 * Shared Vitest defaults, merged by every package's vitest.config.ts.
 * Vitest 4 replaced the deprecated `vitest.workspace.ts` with a root-level
 * `projects` glob (see the root vitest.config.ts); this file keeps the
 * per-package test contract in one place (PLAN.md Phase 1).
 */
export const sharedTestConfig: ViteUserConfig = {
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
};
