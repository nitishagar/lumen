/**
 * Worker provider seam (B21/R7) — the REAL `createWorkerSafeProviders`
 * wiring from `@lumen-seo/providers/worker` (the Worker-safe entry whose
 * import graph never reaches cheerio, R7/BA9 — asserted by the providers
 * aspect's module-graph test and the surfaces bundle-scan). Runtime imports
 * come ONLY from the /worker subpath; the main barrel appears exclusively in
 * `import type` positions, which bundling erases. `index.ts`,
 * `composition.ts`, and `rest.ts` are stable across the rebase — this is the
 * only file that changed.
 *
 * - `workerConfig(env)` selects ONLY the five Worker-appropriate providers'
 *   sections — tranco unselected (bulk-CSV stream parsing cannot fit the
 *   10 ms CPU ceiling, I6) — and, per the R7 kill-switch disposition, OMITS
 *   the pagespeed section when `WORKER_ENABLE_PSI === "false"` so the MCP
 *   `page_report` tool path inherits the B10 kill-switch through the
 *   composition (the REST leg keeps its explicit check in rest.ts). Absent
 *   settings → the providers' R5 default env-var names and GCRA pacing.
 * - No serp/auditRunner/pageMeta/history in McpDeps → audit_site +
 *   rank_check stay LOCAL_ONLY_CAPABILITY (E6/I6).
 * - BYOK keys ride in through `workerDeps(headers, env).env(name)` at call
 *   time (E5): visitor header first, owner's `LUMEN_*_KEY` wrangler secret as
 *   the server-side default. An absent key degrades to honest unavailability
 *   — never a keyless CrUX/OPR call (I1). Google-suggest/wikipedia need no key.
 */
import { createWorkerSafeProviders } from '@lumen-seo/providers/worker';
import type { WorkerSafeProviders } from '@lumen-seo/providers/worker';
import type { ProviderDeps, ProvidersConfig } from '@lumen-seo/providers';
import type {
  AnyProvider,
  AuthorityProvider,
  CruxProvider,
  KeywordProvider,
  PageSpeedProvider,
} from '@lumen-seo/core';
import type { McpDeps } from '../src/server.js';

export interface Env {
  /** Owner's Google API key (PageSpeed Insights API enabled) as a wrangler
   *  SECRET (`wrangler secret put LUMEN_PSI_KEY` — never a var, never in
   *  this file): the server-side default when the visitor sends no
   *  `x-lumen-psi-key` header. Served from the owner's quota. */
  LUMEN_PSI_KEY?: string;
  /** Owner's Google API key (Chrome UX Report API enabled) as a wrangler
   *  SECRET: the server-side default when the visitor sends no
   *  `x-lumen-crux-key` header. The same Cloud key usually covers both. */
  LUMEN_CRUX_KEY?: string;
  /** Kill-switch (B10): set to "false" to disable PSI on CPU-constrained zones. */
  WORKER_ENABLE_PSI?: string;
  /** E2.5: optional bearer auth — when set, every route (except OPTIONS and
   *  /healthz) requires `Authorization: Bearer <token>`. */
  WORKER_AUTH_TOKEN?: string;
  /** E2.5: comma-separated origin allowlist — when set, CORS reflects only
   *  these origins (Vary: Origin); unset keeps the permissive `*` default. */
  WORKER_ALLOWED_ORIGINS?: string;
}

/** The real locked ProviderDeps (type-only import — erased before bundling). */
export type WorkerProviderDeps = ProviderDeps;

/** REST deps consumed by worker/rest.ts (page-report + keyword-ideas legs). */
export interface WorkerRestDeps {
  clock: () => string;
  pageSpeed?: PageSpeedProvider;
  crux?: CruxProvider;
  keyword: readonly KeywordProvider[];
}

/**
 * B10 kill-switch (R7 disposition): "false" omits the pagespeed section, and
 * the compositions below leave `pageSpeed` unwired — both the REST leg and
 * the MCP tool path answer with an explicit unavailability reason.
 */
// PSI on the Worker is STRICT OPT-IN (red-team round 1): an unauthenticated
// PSI proxy must default OFF. Note the GCRA bound holds per-isolate, not
// globally — a multi-colo deployment needs a shared pacer (Durable Object),
// accepted out of scope for v0.1.0.
export const workerConfig = (env: Env): ProvidersConfig =>
  env.WORKER_ENABLE_PSI === 'true' ? { pagespeed: {} } : {};

const isoClock = (deps: WorkerProviderDeps) => (): string => new Date(deps.clock()).toISOString();

/** `pageSpeed` is wired only when workerConfig selected the pagespeed section (B10). */
const selectedPageSpeed = (
  config: ProvidersConfig,
  p: WorkerSafeProviders,
): PageSpeedProvider | undefined =>
  config.pagespeed === undefined ? undefined : boundary<PageSpeedProvider>(p.pagespeed);

/**
 * `WorkerSafeProviders` is keyed by name with `AnyProvider` values (the same
 * shape core's registry consumes); the name→boundary mapping is the providers
 * package's own registry wiring (PROVIDER_CAPABILITIES / TC-REG tests), so the
 * narrowing cast here mirrors core's registry `as<T>` after boundary checks.
 */
const boundary = <T extends AnyProvider>(p: AnyProvider): T => p as T;

export const workerMcpDeps = (headers: Headers, env: Env, deps: WorkerProviderDeps): McpDeps => {
  void headers; // BYOK values reach the providers via deps.env at call time (E5)
  const config = workerConfig(env);
  const p = createWorkerSafeProviders(config, deps);
  return {
    clock: isoClock(deps),
    keyword: [boundary<KeywordProvider>(p['google-suggest']), boundary<KeywordProvider>(p['wikipedia-demand'])],
    authority: [boundary<AuthorityProvider>(p.openpagerank)],
    pageSpeed: selectedPageSpeed(config, p),
    crux: boundary<CruxProvider>(p.crux),
    unconfigured: [],
    // no serp / auditRunner / pageMeta / history — audit_site + rank_check are
    // LOCAL_ONLY_CAPABILITY over HTTP (E6/I6)
  };
};

export const workerRestDeps = (headers: Headers, env: Env, deps: WorkerProviderDeps): WorkerRestDeps => {
  void headers;
  const config = workerConfig(env);
  const p = createWorkerSafeProviders(config, deps);
  return {
    clock: isoClock(deps),
    pageSpeed: selectedPageSpeed(config, p),
    crux: boundary<CruxProvider>(p.crux),
    keyword: [boundary<KeywordProvider>(p['google-suggest']), boundary<KeywordProvider>(p['wikipedia-demand'])],
  };
};
