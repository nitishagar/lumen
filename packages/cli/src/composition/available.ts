/**
 * The CLI's available-provider map (I2) — the REAL seven built-ins from the
 * @lumen-seo/providers barrel (Phase 6 rebase commit). Core's registry
 * validates the configured boundary selection against this map (unknown
 * names → ConfigError listing the built-ins) and applies the BYOK skip rule
 * (I1); BYOK env-var NAME overrides from lumen.config.json (config.byok)
 * reach the providers themselves as ProviderSettings.envVar so a provider
 * reads the SAME env name the skip rule judged.
 *
 * Pacing is the providers package's GCRA defaults (no per-provider pacing
 * keys exist in core's config schema); every outbound request flows through
 * core's DNS-validating Fetcher — the ONLY transport, I16.
 */
import type { AnyProvider, ResolvedConfig } from '@lumen-seo/core';
import { USER_AGENT } from '@lumen-seo/core';
import { createNodeFetcher } from '@lumen-seo/core/node';
import { createBuiltInProviders, InMemoryCache } from '@lumen-seo/providers';
import type { ProvidersConfig } from '@lumen-seo/providers';

/** Node ProviderDeps: SSRF-guarded fetcher, TTL cache, injected seams, env reader (I1/I9/I12/I16). */
const nodeProviderDeps = () => ({
  fetcher: createNodeFetcher(),
  cache: new InMemoryCache(),
  clock: () => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  env: (name: string): string | undefined => process.env[name],
  userAgent: USER_AGENT,
});

/** config.byok maps provider name → env-var NAME (values are never stored — I1/I16). */
const providersConfigFrom = (config: ResolvedConfig): ProvidersConfig =>
  Object.fromEntries(
    Object.entries(config.byok).map(([name, envVar]) => [name, { envVar }]),
  ) as ProvidersConfig;

export const availableProviders = (config: ResolvedConfig): Record<string, AnyProvider> =>
  createBuiltInProviders(providersConfigFrom(config), nodeProviderDeps());
