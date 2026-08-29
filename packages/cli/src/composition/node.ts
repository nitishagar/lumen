/**
 * Node composition root for the data commands (I2): resolves the configured
 * providers through core's registry (unknown names → ConfigError listing the
 * available ones), applies the BYOK skip rule (I1/I5: a provider whose
 * configured env-var NAME is unset is skipped and listed as unconfigured —
 * never called), and wires the JSONL history store. Every piece is injectable
 * for tests via CommandDeps.
 */
import type {
  AuthorityProvider,
  CruxProvider,
  FailThreshold,
  HistoryStore,
  KeywordProvider,
  PageSpeedProvider,
  ResolvedConfig,
  SerpProvider,
} from '@lumen-seo/core';
import { createProviderRegistry } from '@lumen-seo/core';
import type { AuditRunner, PageMetaFetcher } from '@lumen-seo/mcp/ports';
import { effectiveByok, resolveHistoryDir } from '../cli-config.js';
import { JsonlHistoryStore } from '../history/jsonl-store.js';
import { availableProviders } from './available.js';
import { createFixtureAuditRunner, createFixturePageMetaFetcher } from './audit-adapter.js';

export interface CommandDeps {
  /** Injected clock (I10): real ISO clock in production, fixed in tests. */
  clock: () => string;
  failThreshold: FailThreshold;
  keywords: readonly KeywordProvider[];
  serp?: SerpProvider;
  authority: readonly AuthorityProvider[];
  /** Providers configured but skipped for a missing BYOK key (I1/E8). */
  authorityUnconfigured: readonly string[];
  history: HistoryStore;
  auditRunner?: AuditRunner;
  pageMeta?: PageMetaFetcher;
  pageSpeed?: PageSpeedProvider;
  pagespeedUnconfigured?: string;
  crux?: CruxProvider;
  cruxUnconfigured?: string;
}

export const realClock = (): string => new Date().toISOString();

/**
 * BYOK skip (I1): a selected provider is only wired when its configured env
 * name (config.byok[providerName]) is unset-or-set-with-value. A configured
 * name whose env var is missing returns null (skip + mark unconfigured).
 */
export const byokReady = (config: ResolvedConfig, providerName: string): boolean => {
  const byok = effectiveByok(config) as Record<string, string>;
  const envName = byok[providerName];
  if (envName === undefined) return true; // no key requirement declared — provider decides
  return process.env[envName] !== undefined && process.env[envName] !== '';
};

export const nodeComposition = (config: ResolvedConfig): CommandDeps => {
  const registry = createProviderRegistry(config.providers, config.byok, availableProviders());
  const keyword = registry.keywords();
  const serp = registry.serp();
  const authority = registry.authority();
  const pageSpeed = registry.pagespeed();
  const crux = registry.crux();

  const authorityUnconfigured: string[] = [];
  let authorityProviders: AuthorityProvider[] = [];
  if (authority !== undefined) {
    const selected = config.providers.authority;
    if (selected !== undefined && !byokReady(config, selected)) {
      authorityUnconfigured.push(selected);
    } else {
      authorityProviders = [authority];
    }
  }

  const byokReason = (boundary: string, providerName: string | undefined): string | undefined =>
    providerName !== undefined && !byokReady(config, providerName)
      ? `provider "${providerName}" selected for ${boundary} is unconfigured (BYOK env var not set — see "lumen config show")`
      : undefined;

  return {
    clock: realClock,
    failThreshold: config.failThreshold,
    keywords: keyword === undefined ? [] : [keyword],
    serp,
    authority: authorityProviders,
    authorityUnconfigured,
    history: new JsonlHistoryStore(resolveHistoryDir()),
    // REBASE SEAM: fixture adapter — see composition/audit-adapter.ts.
    auditRunner: createFixtureAuditRunner(config, realClock),
    pageMeta: createFixturePageMetaFetcher(),
    pageSpeed: byokReason('pagespeed', config.providers.pagespeed) === undefined ? pageSpeed : undefined,
    pagespeedUnconfigured: byokReason('pagespeed', config.providers.pagespeed),
    crux: byokReason('crux', config.providers.crux) === undefined ? crux : undefined,
    cruxUnconfigured: byokReason('crux', config.providers.crux),
  };
};

/** Loads config and builds the production deps for a command invocation. */
export const buildDeps = async (configPathFlag?: string): Promise<CommandDeps> => {
  const { loadCliConfig } = await import('../cli-config.js');
  const { config } = await loadCliConfig(configPathFlag);
  return nodeComposition(config);
};
