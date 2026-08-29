/**
 * @lumen-seo/core — main entry (Workers-safe: no Node built-ins; the Node-only
 * surface lives behind the `@lumen-seo/core/node` subpath).
 *
 * Payload models with exactly the ARCHITECTURE-required fields, provenance
 * helpers, config loader, severity gate, provider/rule registries, the
 * SSRF-guarded Fetcher, and the robots.txt policy.
 */
export type { Severity } from './severity.js';
export { SEVERITIES, isSeverity } from './severity.js';
export type {
  AuthorityKind,
  AuthoritySignal,
  CruxMetric,
  CruxRecord,
  HistogramBin,
  KeywordIdea,
  PageSpeedMetrics,
  PageSpeedReport,
  PageSpeedScores,
  SerpResult,
} from './payloads.js';
export type {
  Issue,
  IssueEvidence,
  PageContext,
  PageReport,
  SiteAuditReport,
  SiteAuditReportSummary,
} from './page.js';
export type { CrawlBudgets } from './budgets.js';
export { DEFAULT_BUDGETS, MAX_PAGES_CEILING } from './budgets.js';
export type {
  AnyProvider,
  AuthorityOpts,
  AuthorityProvider,
  CruxOpts,
  CruxProvider,
  IdeasOpts,
  KeywordProvider,
  PageSpeedOpts,
  PageSpeedProvider,
  ProviderBoundary,
  SearchOpts,
  SerpProvider,
} from './providers.js';
export { PROVIDER_BOUNDARIES, isProviderBoundary } from './providers.js';
export type { Metric, Provenance, ProvenanceKind } from './provenance.js';
export { mkMetric, mkSource, PROVENANCE_KINDS } from './provenance.js';
export type { AuditRule, RuleOpts } from './rules.js';
export { looksLikeAuditRule } from './rules.js';
export type { HistoryListQuery, HistoryStore, RankHistoryEntry } from './history.js';
export const packageName = '@lumen-seo/core';
