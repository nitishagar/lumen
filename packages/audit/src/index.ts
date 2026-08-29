/**
 * @lumen-seo/audit — the crawl-and-judge engine (audit-engine aspect, P2).
 *
 * One public entry point — `runSiteAudit` — backs both the `lumen audit` CLI
 * command and the `lumen_audit_site` MCP tool. Node-only by design (cheerio);
 * never imported by the Worker bundle (I6).
 *
 * TSDoc contract note for P4 consumers: every string inside a
 * `SiteAuditReport` produced here is untrusted crawled text, stored inert
 * (control characters stripped, length-capped) — escape at render time.
 */
export const packageName = '@lumen-seo/audit';

export { runSiteAudit } from './run.js';

export type {
  AuditConfig,
  AuditThresholds,
  CancellableDelay,
  CrawlIndex,
  CrawlIndexEntry,
  CrawlRule,
  CrawlerDeps,
  OutLink,
  ResolvedAuditConfig,
  ResolvedThresholds,
  RuleContext,
  SkipReason,
  StopReason,
} from './types.js';
export {
  DEFAULT_THRESHOLDS,
  LumenRobotsUnreachableError,
  LumenSeedDisallowedError,
  SKIP_REASONS,
  STOP_REASONS,
} from './types.js';
