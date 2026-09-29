/**
 * Gray-endpoint LIVE canary (PRD §8 hygiene, P1): google-suggest and ddg-serp
 * break silently in practice (bot protection evolves), so this makes ONE real
 * call through each provider's REAL parse path and fails loudly on drift.
 *
 * Gated by LIVE_CANARY=1 (the weekly .github/workflows/gray-canary.yml sets
 * it) — the normal suite never touches the network. On failure the workflow
 * opens an issue.
 */
import { describe, expect, it } from 'vitest';
import { createNodeFetcher } from '@lumen-seo/core/node';
import { GoogleSuggestProvider } from './google-suggest.js';
import { DdgSerpProvider } from './ddg-serp.js';
import type { ProviderDeps } from './deps.js';
import type { Pacer } from './throttle.js';

const LIVE = process.env.LIVE_CANARY === '1';
const noCache = { get: async () => undefined, set: async () => undefined };
const deps = (): ProviderDeps => ({
  fetcher: createNodeFetcher(),
  cache: noCache as never,
  clock: () => Date.now(),
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  env: () => undefined,
  userAgent: 'lumen-gray-canary (+https://github.com/nitishagar/lumen)',
});
const pacer: Pacer = { acquire: async () => undefined, tryAcquire: () => true };

describe.skipIf(!LIVE)('gray-endpoint live canary (weekly CI)', () => {
  it('google-suggest still parses (not blocked)', async () => {
    const ideas = await new GoogleSuggestProvider(deps(), pacer).ideas('weather', {});
    expect(ideas.length).toBeGreaterThan(0);
  }, 30_000);

  it('ddg-serp still parses (not blocked)', async () => {
    const results = await new DdgSerpProvider(deps(), pacer).search('weather', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  }, 30_000);
});
