/**
 * Crawl budget types (I14). Core owns the TYPES and defaults; enforcement
 * (global concurrency cap, duration budget, per-host rate limiting) is the
 * audit engine's job (P2). Defaults per RECONCILIATION R3.
 */
export interface CrawlBudgets {
  maxPages: number;
  maxDepth: number;
  maxDurationMs: number;
  maxConcurrency: number;
  perHostMinDelayMs: number;
}

/** R3 defaults; the config loader hard-clamps `maxPages` at 10 000. */
export const DEFAULT_BUDGETS: CrawlBudgets = Object.freeze({
  maxPages: 100,
  maxDepth: 5,
  maxDurationMs: 300_000,
  maxConcurrency: 5,
  perHostMinDelayMs: 250,
});

export const MAX_PAGES_CEILING = 10_000;
