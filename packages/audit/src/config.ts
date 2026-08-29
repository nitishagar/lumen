/**
 * Audit-config resolution: core-owned crawl budgets (R3) are merged over
 * core's `DEFAULT_BUDGETS` with `maxPages` hard-clamped at core's ceiling;
 * audit-owned knobs default per the plan's defaults table.
 */
import { DEFAULT_BUDGETS, MAX_PAGES_CEILING } from '@lumen-seo/core';
import type { CrawlBudgets } from '@lumen-seo/core';
import {
  DEFAULT_THRESHOLDS,
} from './types.js';
import type { AuditConfig, ResolvedAuditConfig, ResolvedThresholds } from './types.js';

/** Audit-owned response-body cap (2 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 2_000_000;

/** Evidence cap: issues per rule per page before the overflow marker (plan resource bound). */
export const EVIDENCE_CAP = 10;

/** robots `Sitemap:` sources fetched at most (bounds worst-case discovery). */
export const MAX_SITEMAP_SOURCES = 10;

/** Child sitemaps followed per sitemapindex (one nesting level). */
export const MAX_SITEMAP_CHILDREN = 10;

/** Total sitemap URLs accepted across all sources. */
export const MAX_SITEMAP_URLS = 10_000;

/** Sitemap body cap (bytes). */
export const MAX_SITEMAP_BYTES = 2_000_000;

/** robots-429 single retry: Retry-After cap (audit-owned, plan defaults table). */
export const ROBOTS_RETRY_AFTER_CAP_MS = 5_000;

/** Frontier seen-set cap factor (`100 x maxPages`). */
export const SEEN_SET_FACTOR = 100;

export const resolveAuditConfig = (config: AuditConfig = {}): ResolvedAuditConfig => {
  const crawl: CrawlBudgets = { ...DEFAULT_BUDGETS, ...config.crawl };
  // Sanity floors for programmatic config (file config is already validated by
  // core's loader): integers, >= 1 (`perHostMinDelayMs` >= 0), maxPages clamped (R3/A3).
  crawl.maxPages = Math.min(Math.max(1, Math.floor(crawl.maxPages)), MAX_PAGES_CEILING);
  crawl.maxDepth = Math.max(0, Math.floor(crawl.maxDepth));
  crawl.maxDurationMs = Math.max(1, Math.floor(crawl.maxDurationMs));
  crawl.maxConcurrency = Math.max(1, Math.floor(crawl.maxConcurrency));
  crawl.perHostMinDelayMs = Math.max(0, Math.floor(crawl.perHostMinDelayMs));

  const t = config.thresholds ?? {};
  const thresholds: ResolvedThresholds = {
    titleMinChars: t.titleMinChars ?? DEFAULT_THRESHOLDS.titleMinChars,
    titleMaxChars: t.titleMaxChars ?? DEFAULT_THRESHOLDS.titleMaxChars,
    descriptionMinChars: t.descriptionMinChars ?? DEFAULT_THRESHOLDS.descriptionMinChars,
    descriptionMaxChars: t.descriptionMaxChars ?? DEFAULT_THRESHOLDS.descriptionMaxChars,
    latencyMs: t.latencyMs ?? DEFAULT_THRESHOLDS.latencyMs,
  };

  return {
    crawl,
    respectRobots: config.respectRobots ?? true,
    severityOverrides: config.severityOverrides ?? {},
    thresholds,
    maxBodyBytes: config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    extraRules: config.extraRules ?? [],
  };
};
