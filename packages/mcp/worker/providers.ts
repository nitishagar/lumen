/**
 * Worker provider seam — REBASE FILE (B21/R7, the ONLY file that changes at
 * the orchestrator's rebase commit; `index.ts`/`composition.ts`/`rest.ts` are
 * stable across both states).
 *
 * PRE-REBASE (this branch is core-only): the Worker shape is fed by testkit
 * fixture providers behind the IDENTICAL return shapes the real wiring will
 * produce — `workerMcpDeps` -> McpDeps (audit_site/rank_check local-only: no
 * serp/auditRunner/pageMeta/history), `workerRestDeps` -> REST deps.
 *
 * REBASE COMMIT (merge order P2 -> P3 -> P4 lands @lumen-seo/providers):
 *   import { createWorkerSafeProviders } from '@lumen-seo/providers';
 *   export const workerMcpDeps = (headers: Headers, env: Env): McpDeps => {
 *     const p = createWorkerSafeProviders(workerConfig(env), workerDeps(headers));
 *     return { clock: isoClock, keyword: [p['google-suggest'], p['wikipedia-demand']],
 *              pageSpeed: p.pagespeed, crux: p.crux, authority: [p.openpagerank] };
 *   };
 *   // workerConfig selects ONLY the five Worker-appropriate providers — tranco
 *   // unselected (bulk-CSV stream parsing cannot fit the 10 ms ceiling, I6);
 *   // no serp/auditRunner/pageMeta/history -> audit_site/rank_check stay
 *   // LOCAL_ONLY_CAPABILITY. The identical Phase 5 suite re-runs green, with
 *   // the outbound-host allowlist assertions activating against real providers.
 *
 * `Env` lives here because this file is what consumes it (workerConfig(env)).
 */
import type { CruxProvider, KeywordProvider, PageSpeedProvider } from '@lumen-seo/core';
import type { McpDeps } from '../src/server.js';
import { FIXED_CLOCK, fixtureAuthorityProvider, fixtureCruxProvider, fixtureKeywordProvider, fixturePageSpeedProvider } from '../src/testkit/providers.js';

export interface Env {
  /** Kill-switch (B10): set to "false" to disable PSI on CPU-constrained zones. */
  WORKER_ENABLE_PSI?: string;
}

/**
 * Minimal shape mirroring the providers aspect's locked ProviderDeps
 * (plan Phase 5 snippet) until the rebase makes the real type importable.
 */
export interface WorkerProviderDeps {
  fetcher: import('@lumen-seo/core').Fetcher;
  /** Always-miss cache (B19): no KV, no cross-request state. */
  cache: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Per-request BYOK keys via headers — values read at call time (E5). */
  env: (name: string) => string | undefined;
  userAgent: string;
}

/** Pre-rebase REST deps: the fixture PSI/CrUX/keyword providers. */
export interface WorkerRestDeps {
  clock: () => string;
  pageSpeed?: PageSpeedProvider;
  crux?: CruxProvider;
  keyword: readonly KeywordProvider[];
}

const fixtureProviders = () => ({
  pageSpeed: fixturePageSpeedProvider(),
  crux: fixtureCruxProvider(),
  keyword: [fixtureKeywordProvider()] as const,
  authority: [fixtureAuthorityProvider()] as const,
});

export const workerMcpDeps = (headers: Headers, env: Env, deps: WorkerProviderDeps): McpDeps => {
  void headers;
  void env;
  void deps; // consumed by createWorkerSafeProviders at the rebase commit
  const p = fixtureProviders();
  return {
    clock: FIXED_CLOCK,
    keyword: [...p.keyword],
    authority: [...p.authority],
    pageSpeed: p.pageSpeed, // E6: page_report serves PSI/CrUX over HTTP
    crux: p.crux,
    unconfigured: [],
    // no serp / auditRunner / pageMeta / history — audit_site + rank_check are
    // LOCAL_ONLY_CAPABILITY over HTTP (E6/I6)
  };
};

export const workerRestDeps = (headers: Headers, env: Env, deps: WorkerProviderDeps): WorkerRestDeps => {
  void headers;
  void env;
  void deps;
  const p = fixtureProviders();
  return { clock: FIXED_CLOCK, pageSpeed: p.pageSpeed, crux: p.crux, keyword: [...p.keyword] };
};
