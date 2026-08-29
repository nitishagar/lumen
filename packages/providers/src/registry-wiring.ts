/**
 * Registry wiring for Node consumers (I2): `createBuiltInProviders` adds
 * ddg-serp (cheerio-based — NOT Worker-safe) on top of the worker-safe six;
 * `registerBuiltIns` adapts to core's frozen `createProviderRegistry`
 * factory (validation happens at construction — unknown names get core's
 * ConfigError listing these built-ins).
 */
import type { AnyProvider, ProviderBoundary, ProviderRegistry } from '@lumen-seo/core';
import { createProviderRegistry } from '@lumen-seo/core';
import { BUILTIN_PROVIDER_NAMES, DOCUMENTED_LIMITS, PACING_DEFAULTS } from './builtins.js';
import type { BuiltinProviderName } from './builtins.js';
import type { ProvidersConfig } from './config.js';
import { assertNoSecretValues, byokMapFromConfig } from './config.js';
import { DdgSerpProvider } from './ddg-serp.js';
import type { ProviderDeps } from './deps.js';
import { GcraPacer, resolvePacing } from './throttle.js';
import { createWorkerSafeProviders } from './worker.js';

export type BuiltInProviders = Record<BuiltinProviderName, AnyProvider>;

export function createBuiltInProviders(config: ProvidersConfig, deps: ProviderDeps): BuiltInProviders {
  assertNoSecretValues(config);
  const { rpm, burst } = resolvePacing(
    config['ddg-serp'],
    PACING_DEFAULTS['ddg-serp']!,
    DOCUMENTED_LIMITS['ddg-serp'],
  );
  return {
    ...createWorkerSafeProviders(config, deps),
    'ddg-serp': new DdgSerpProvider(deps, new GcraPacer(rpm, burst, deps.clock, deps.sleep)),
  };
}

/**
 * Adapts the built-ins to core's registry factory: validates the boundary
 * selection (unknown names → ConfigError listing the built-ins) and the
 * byok env-var NAME overrides. Core's registries are frozen at construction
 * (no mutation API), so "registering" IS constructing.
 */
export function registerBuiltIns(
  selection: Readonly<Partial<Record<ProviderBoundary, string>>>,
  config: ProvidersConfig,
  deps: ProviderDeps,
): ProviderRegistry {
  return createProviderRegistry(selection, byokMapFromConfig(config), createBuiltInProviders(config, deps));
}

export { BUILTIN_PROVIDER_NAMES };
