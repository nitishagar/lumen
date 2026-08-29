/**
 * @lumen-seo/providers — main (Node) entry: the seven built-in providers,
 * the shared plumbing, and the registry wiring. `ddg-serp` needs cheerio
 * (Node-only, R7/BA9) — Worker consumers import `@lumen-seo/providers/worker`
 * instead; that entry never reaches cheerio (asserted by the module-graph
 * test).
 */
export const packageName = '@lumen-seo/providers';

// shared plumbing
export type { ProviderErrorCode } from './errors.js';
export {
  BlockedError,
  NotConfiguredError,
  ParseError,
  ProviderError,
  RateLimitedError,
  UpstreamError,
} from './errors.js';
export { redactUrl } from './redact.js';
export type { Pacer, PacingCfg } from './throttle.js';
export { GcraPacer, resolvePacing } from './throttle.js';
export type { CacheStore } from './cache.js';
export { InMemoryCache } from './cache.js';
export { json, normalizeDomain, retryAfterMs } from './http.js';
export type { ProviderDeps } from './deps.js';
export { isoNow } from './deps.js';
export { ATTRIBUTION, ESTIMATE_LABELS } from './provenance.js';
export type { AttributionKey } from './provenance.js';
export { isTimeoutLike, withProviderErrors } from './with-errors.js';

// built-in metadata + config surface
export { BUILTIN_PROVIDER_NAMES, DOCUMENTED_LIMITS, PACING_DEFAULTS, PROVIDER_CAPABILITIES } from './builtins.js';
export type { BuiltinProviderName } from './builtins.js';
export type { ProviderSettings, ProvidersConfig } from './config.js';
export { assertNoSecretValues, byokMapFromConfig, BYOK_ENV_VARS, resolveEnvVar } from './config.js';

// provider classes (ddg-serp is Node-only — import the /worker entry for Workers)
export { GoogleSuggestProvider } from './google-suggest.js';
export { WikipediaDemandProvider } from './wikipedia-demand.js';
export { PageSpeedProviderImpl } from './pagespeed.js';
export { CruxProviderImpl } from './crux.js';
export { OpenPageRankProvider } from './openpagerank.js';
export { TrancoProvider } from './tranco.js';
export { DdgSerpProvider } from './ddg-serp.js';

// opts bridge (BA12)
export * from './opts-bridge.js';

// wiring
export type { WorkerSafeProviders } from './worker.js';
export { createWorkerSafeProviders } from './worker.js';
export type { BuiltInProviders } from './registry-wiring.js';
export { createBuiltInProviders, registerBuiltIns } from './registry-wiring.js';
