/**
 * @lumen-seo/providers/worker — the Worker-safe factory (R7/BA9): every
 * built-in EXCEPT ddg-serp (cheerio is Node-only; the Worker parses no
 * HTML). This module and its import graph never reach cheerio — asserted by
 * the module-graph test. All seven names still validate through the shared
 * constants in ./builtins.ts.
 */
import type { AnyProvider } from '@lumen-seo/core';
import { BUILTIN_PROVIDER_NAMES, DOCUMENTED_LIMITS, PACING_DEFAULTS } from './builtins.js';
import type { BuiltinProviderName } from './builtins.js';
import type { ProvidersConfig } from './config.js';
import { assertNoSecretValues } from './config.js';
import { CruxProviderImpl } from './crux.js';
import type { ProviderDeps } from './deps.js';
import { GoogleSuggestProvider } from './google-suggest.js';
import { OpenPageRankProvider } from './openpagerank.js';
import { PageSpeedProviderImpl } from './pagespeed.js';
import { GcraPacer, resolvePacing } from './throttle.js';
import { TrancoProvider } from './tranco.js';
import { WikipediaDemandProvider } from './wikipedia-demand.js';

/** The six Worker-safe built-ins keyed by name (no `ddg-serp`). */
export type WorkerSafeProviders = Omit<Record<BuiltinProviderName, AnyProvider>, 'ddg-serp'>;

const pacerFor = (
  name: BuiltinProviderName,
  config: ProvidersConfig,
  deps: ProviderDeps,
): GcraPacer => {
  const { rpm, burst } = resolvePacing(config[name], PACING_DEFAULTS[name]!, DOCUMENTED_LIMITS[name]);
  return new GcraPacer(rpm, burst, deps.clock, deps.sleep);
};

export function createWorkerSafeProviders(config: ProvidersConfig, deps: ProviderDeps): WorkerSafeProviders {
  assertNoSecretValues(config);
  return {
    'google-suggest': new GoogleSuggestProvider(deps, pacerFor('google-suggest', config, deps)),
    'wikipedia-demand': new WikipediaDemandProvider(deps, pacerFor('wikipedia-demand', config, deps)),
    pagespeed: new PageSpeedProviderImpl(config.pagespeed ?? {}, deps, deps.clock, deps.sleep),
    crux: new CruxProviderImpl(config.crux, deps, deps.clock, deps.sleep),
    openpagerank: new OpenPageRankProvider(config.openpagerank, deps, deps.clock, deps.sleep),
    tranco: new TrancoProvider(config.tranco, deps),
  };
}

export { BUILTIN_PROVIDER_NAMES };
