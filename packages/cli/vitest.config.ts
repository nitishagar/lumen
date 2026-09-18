import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedTestConfig } from '../../vitest.shared.ts';

export default mergeConfig(
  sharedTestConfig,
  defineConfig({
    test: {
      // Real-bin spawn contracts: one `node bin/lumen.js` costs ~1.5s cold
      // (TS transform lane), and contract tests run 2–4 spawns sequentially —
      // past vitest's 5s default under parallel-worker load (red-team: sandbox
      // flakes proven as `Test timed out in 5000ms`, green in isolation).
      // 20s budgets the spawns with headroom; unit packages keep the fast default.
      testTimeout: 20_000,
    },
  }),
);
