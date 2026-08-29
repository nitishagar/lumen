/**
 * Worker test config — locked stack (B8/ARCHITECTURE): @cloudflare/vitest-plugin
 * (Vitest >= 4.1) running tests INSIDE workerd via Miniflare, fully local.
 * The installed plugin (1.1.x) exposes the `cloudflareTest` Vite plugin (no
 * `./config` subpath), so it plugs into a standard vitest config. The
 * `outboundService` hook is the I16 outbound recorder: every request the
 * worker script makes is captured in `outboundRecorder` (node-side module
 * state) and answered with a deterministic fixture response — no live network.
 */
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { recordAndFixture } from './worker/outbound-recorder.js';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './worker/wrangler.jsonc' },
      miniflare: {
        outboundService: (req: Request) => recordAndFixture(req),
      },
    }),
  ],
  test: {
    include: ['worker/**/*.test.ts'],
  },
});
