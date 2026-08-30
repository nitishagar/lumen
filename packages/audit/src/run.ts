/**
 * `runSiteAudit` — the single public engine entry point (I5): one polite,
 * bounded, cancellable crawl + rules + report. Both the `lumen audit` CLI and
 * the `lumen_audit_site` MCP tool call exactly this (P4's concern).
 *
 * Pipeline (plan Approach): gate (robots) → discover (sitemaps) → crawl loop
 * (worker pool) → crawl rules → assemble. Abort anywhere resolves with a
 * partial report (`stopReason: 'aborted'`, `incomplete: true`) — it never
 * rejects (I14). Robots refusal surfaces as typed errors with zero page
 * fetches (A2).
 *
 * Determinism (I10): clock, sleep, jitter, and the report-id random component
 * are injected via `deps`; identical inputs + deps produce byte-identical
 * reports.
 */
import { AbortedError } from '@lumen-seo/core';
import type { Issue, RobotsPolicy, SiteAuditReport } from '@lumen-seo/core';
import { resolveAuditConfig } from './config.js';
import { crawl } from './crawl/crawler.js';
import type { CrawlGate, CrawledPage } from './crawl/crawler.js';
import { createRuleSet } from './rules/rule-set.js';
import { robotsGate } from './crawl/robots-policy.js';
import { RateLimiter } from './crawl/rate-limiter.js';
import { discoverSitemaps } from './crawl/sitemap.js';
import { assembleReport } from './report/assemble.js';
import type { AuditConfig, CrawlIndex, CrawlerDeps, CrawlRule, ResolvedAuditConfig } from './types.js';
import { LumenSeedDisallowedError } from './types.js';

export const runSiteAudit = async (
  seed: URL,
  config: AuditConfig = {},
  deps: CrawlerDeps,
  signal?: AbortSignal,
): Promise<SiteAuditReport> => {
  const resolved = resolveAuditConfig(config);
  const warnings: string[] = [];
  const onWarning = (code: string): void => {
    warnings.push(code);
  };
  const limiter = new RateLimiter(deps, resolved.crawl.perHostMinDelayMs);

  if (signal?.aborted) return emptyAbortedReport(resolved, seed, deps, warnings); // zero requests

  // 1. Gate — robots.txt, conservative on failure (A2). `respectRobots: false`
  //    skips the gate but never the rate limiter or budgets.
  let policy: RobotsPolicy = Object.freeze({ isAllowed: () => true, sitemaps: Object.freeze([]) });
  let probeSitemap = true;
  if (resolved.respectRobots) {
    let gate: Awaited<ReturnType<typeof robotsGate>>;
    try {
      gate = await robotsGate(seed, deps, signal);
    } catch (e) {
      if (e instanceof AbortedError || signal?.aborted === true) {
        return emptyAbortedReport(resolved, seed, deps, warnings);
      }
      throw e;
    }
    policy = gate.policy;
    if (policy.crawlDelay !== undefined) limiter.setCrawlDelay(policy.crawlDelay); // RFC 9309 seconds
    probeSitemap = gate.probeSitemap;
    if (!policy.isAllowed(seed)) throw new LumenSeedDisallowedError(seed.href);
  }

  // 2. Discover — robots `Sitemap:` sources (≤ MAX_SITEMAP_SOURCES) or the
  //    /sitemap.xml probe; same-origin http(s) only; discovery failures warn
  //    and fall back to link discovery.
  let discovered: URL[] = [];
  const sources = probeSitemap ? [] : [...policy.sitemaps]; // source cap applied inside discovery
  try {
    discovered = await discoverSitemaps({ seed, sources, deps, limiter, signal, onWarning });
  } catch (e) {
    if (!(e instanceof AbortedError) && signal?.aborted !== true) throw e;
    discovered = [];
  }

  // 3. Crawl — worker pool behind the robots+politeness gate, running the
  //    per-page rule set (built-ins + plugin rules with effective severities).
  const ruleSet = createRuleSet(resolved); // validates severityOverrides (unknown id -> ConfigError)
  const crawlGate: CrawlGate = {
    isAllowed: (url) => (resolved.respectRobots ? policy.isAllowed(url) : true),
    waitForTurn: (url, sig, deadlineMs) => limiter.waitForTurn(url.host, sig, deadlineMs),
  };
  const result = await crawl({
    seed,
    config: resolved,
    deps,
    rules: ruleSet.pageRules,
    signal,
    gate: crawlGate,
    discovered,
    onWarning,
  });

  // 4. Finalize — crawl-level rules (broken-internal-link, redirect-chain)
  //    place their issues on OWNING pages via Issue.url (I3).
  const ruleErrors = { ...result.ruleErrors };
  applyCrawlRuleIssues(result.pages, result.index, ruleSet.crawlRules, ruleErrors, signal);

  return assembleReport(
    result.pages,
    result.stop,
    result.startedAtMs,
    result.completedAtMs,
    ruleErrors,
    resolved,
    seed,
    deps,
    warnings,
    ruleSet.effectiveSeverity,
  );
};

/** Abort during gate/discovery: a zero-page partial report, honestly labeled (I14). */
const emptyAbortedReport = (
  resolved: ResolvedAuditConfig,
  seed: URL,
  deps: CrawlerDeps,
  warnings: string[],
): SiteAuditReport => assembleReport([], 'aborted', deps.now(), deps.now(), {}, resolved, seed, deps, warnings, {});

/**
 * Finalize (I3/I14): run the crawl-level rules against the index and place
 * each issue on its OWNING page (`Issue.url`). A throwing crawl rule is
 * isolated per rule into `ruleErrors` — no fabricated issue, run continues.
 * Issues without `url` are dropped (a crawl-rule issue is never attributed to
 * the wrong page). Exported for direct isolation testing with stub rules.
 */
export const applyCrawlRuleIssues = (
  pages: readonly CrawledPage[],
  index: CrawlIndex,
  crawlRules: readonly CrawlRule[],
  ruleErrors: Record<string, number>,
  signal?: AbortSignal,
): void => {
  const byPage = new Map<string, Issue[]>();
  for (const rule of crawlRules) {
    try {
      const found = rule.checkCrawl(index, { depth: 0, isSeed: true, signal });
      for (const issue of found) {
        if (issue.url === undefined) continue;
        const list = byPage.get(issue.url) ?? [];
        list.push(issue);
        byPage.set(issue.url, list);
      }
    } catch {
      ruleErrors[rule.id] = (ruleErrors[rule.id] ?? 0) + 1;
    }
  }
  for (const page of pages) {
    const extra = byPage.get(page.url);
    if (extra !== undefined) page.issues.push(...extra);
  }
};
