/**
 * @lumen-seo/audit — public types (PLAN.md "Key audit-owned types").
 *
 * Core-compatible by construction: report/payload types come from
 * `@lumen-seo/core` (A12 — additive optional fields already shipped there);
 * the stringly-typed unions (`StopReason`, `SkipReason`) are declared HERE and
 * stored as `string` in core's payload models to avoid a reverse dependency.
 */
import { LumenError } from '@lumen-seo/core';
import type { AuditRule, CrawlBudgets, Fetcher, Issue, Severity } from '@lumen-seo/core';

/** Exactly one terminal state per run (A5). */
export type StopReason = 'completed' | 'aborted' | 'time_budget' | 'page_budget';

export const STOP_REASONS: readonly StopReason[] = ['completed', 'aborted', 'time_budget', 'page_budget'];

/**
 * Closed skip vocabulary (A4). Serialized ONLY as
 * `PageReport.skipped = { reason: SkipReason }` — an object with a reason
 * code, never a bare string.
 */
export type SkipReason =
  | 'robots_disallowed'
  | 'non_html'
  | 'oversized'
  | 'fetch_error'
  | 'rate_limited'
  | 'redirect_loop'
  | 'redirect_cap';

export const SKIP_REASONS: readonly SkipReason[] = [
  'robots_disallowed',
  'non_html',
  'oversized',
  'fetch_error',
  'rate_limited',
  'redirect_loop',
  'redirect_cap',
];

/** Per-page rule context (plan's `RuleContext`; `signal` inherited from core's `RuleOpts`). */
export interface RuleContext {
  depth: number;
  isSeed: boolean;
  signal?: AbortSignal;
}

/** One audited/hit page in the crawl index (input to crawl-level rules). */
export interface CrawlIndexEntry {
  /** Requested URL (normalized, fragment-stripped). */
  url: string;
  status: number;
  depth: number;
  /** Known redirect hops: `0` when the final URL equals the requested URL. */
  hops: number;
  finalUrl: string;
}

/** A discovered out-link, kept for crawl-level rules (never judged unless fetched). */
export interface OutLink {
  /** Raw `href` as written in the document. */
  href: string;
  /** Resolved absolute URL (raw `href` when unresolvable/exotic scheme). */
  url: string;
  internal: boolean;
}

/** Link/status index populated during the crawl; consumed by `CrawlRule`s. */
export interface CrawlIndex {
  pages: readonly CrawlIndexEntry[];
  /** Keyed by normalized page URL. */
  outLinks: ReadonlyMap<string, readonly OutLink[]>;
  /** Observed outcome for a normalized URL — `undefined` when never fetched (I3: never judged). */
  statusOf(url: string): { status: number; finalUrl: string } | undefined;
}

/** Audit-local extension of core's per-page `AuditRule` SPI for crawl-level rules. */
export interface CrawlRule {
  readonly id: string;
  readonly severity: Severity;
  readonly categories: readonly string[];
  /** Returns issues across pages; each issue MUST carry `url` (the owning page). */
  checkCrawl(index: CrawlIndex, o: RuleContext): Issue[];
}

/** Cancellable sleep — the single time seam for every wait in the crawler (I10). */
export type CancellableDelay = Promise<void> & { cancel(): void };

/**
 * Everything non-deterministic is injected (I10): transport (core Fetcher,
 * I12/I17), clock, sleep, jitter, and the report-id random component.
 */
export interface CrawlerDeps {
  fetcher: Fetcher;
  now(): number;
  delay(ms: number, signal?: AbortSignal): CancellableDelay;
  jitter(): number;
  randomId(): string;
}

/** Rule threshold overrides (audit-owned knobs; defaults per plan defaults table). */
export interface AuditThresholds {
  titleMinChars?: number;
  titleMaxChars?: number;
  descriptionMinChars?: number;
  descriptionMaxChars?: number;
  latencyMs?: number;
}

export interface ResolvedThresholds {
  titleMinChars: number;
  titleMaxChars: number;
  descriptionMinChars: number;
  descriptionMaxChars: number;
  latencyMs: number;
}

export const DEFAULT_THRESHOLDS: ResolvedThresholds = Object.freeze({
  titleMinChars: 15,
  titleMaxChars: 65,
  descriptionMinChars: 50,
  descriptionMaxChars: 165,
  latencyMs: 1_500,
});

/**
 * Audit-owned configuration. Core-owned crawl budgets (R3) are plumbed through
 * `crawl` on top of core's `DEFAULT_BUDGETS` (`maxPages` hard-clamped at
 * core's `MAX_PAGES_CEILING`); severity overrides use core's flat
 * `Record<ruleId, Severity>` shape and are validated by core's rule registry.
 */
export interface AuditConfig {
  crawl?: Partial<CrawlBudgets>;
  /** Default `true`. Skips the robots gate — NEVER the rate limiter or budgets (A2). */
  respectRobots?: boolean;
  severityOverrides?: Readonly<Record<string, Severity>>;
  thresholds?: AuditThresholds;
  /** Response body cap in bytes (default 2 MiB). */
  maxBodyBytes?: number;
  /** Additional plugin rules (e.g. from core's `loadPluginRules`) merged after the built-ins. */
  extraRules?: readonly AuditRule[];
}

export interface ResolvedAuditConfig {
  crawl: CrawlBudgets;
  respectRobots: boolean;
  severityOverrides: Readonly<Record<string, Severity>>;
  thresholds: ResolvedThresholds;
  maxBodyBytes: number;
  extraRules: readonly AuditRule[];
}

/** robots.txt could not be fetched conservatively — refuse to crawl (A2, zero page fetches). */
export class LumenRobotsUnreachableError extends LumenError {
  readonly site: string;

  constructor(site: string) {
    super(
      `robots.txt for ${site} is unreachable (5xx/network/timeout after fetcher retries, or 429 persisted after retry) — refusing to crawl (conservative, RFC 9309)`,
      'audit',
    );
    this.site = site;
  }
}

/** The seed URL itself is disallowed by robots.txt — refuse to crawl (A2, zero page fetches). */
export class LumenSeedDisallowedError extends LumenError {
  readonly seed: string;

  constructor(seed: string) {
    super(`seed URL ${seed} is disallowed by robots.txt — refusing to crawl`, 'audit');
    this.seed = seed;
  }
}
