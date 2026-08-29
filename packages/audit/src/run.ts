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
import type { Issue, PageReport, RobotsPolicy, Severity, SiteAuditReport } from '@lumen-seo/core';
import { resolveAuditConfig } from './config.js';
import { crawl } from './crawl/crawler.js';
import type { CrawledPage, CrawlGate } from './crawl/crawler.js';
import { createRuleSet } from './rules/rule-set.js';
import { robotsGate } from './crawl/robots-policy.js';
import { RateLimiter } from './crawl/rate-limiter.js';
import { discoverSitemaps } from './crawl/sitemap.js';
import type { AuditConfig, CrawlerDeps, ResolvedAuditConfig, StopReason } from './types.js';
import { LumenSeedDisallowedError } from './types.js';

const WEIGHT: Record<Severity, number> = { error: 10, warning: 3, info: 0 };

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
    waitForTurn: (url, sig) => limiter.waitForTurn(url.host, sig),
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
  const crawlIssuesByPage = new Map<string, Issue[]>();
  for (const rule of ruleSet.crawlRules) {
    try {
      const found = rule.checkCrawl(result.index, { depth: 0, isSeed: true, signal });
      for (const issue of found) {
        if (issue.url === undefined) continue;
        const list = crawlIssuesByPage.get(issue.url) ?? [];
        list.push(issue);
        crawlIssuesByPage.set(issue.url, list);
      }
    } catch {
      ruleErrors[rule.id] = (ruleErrors[rule.id] ?? 0) + 1;
    }
  }
  for (const page of result.pages) {
    const extra = crawlIssuesByPage.get(page.url);
    if (extra !== undefined) page.issues.push(...extra);
  }

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
): SiteAuditReport =>
  assembleReport([], 'aborted', deps.now(), deps.now(), {}, resolved, seed, deps, warnings, {});

/** Phase-1 inline assembly — Phase 6 moves this to `report/` (scorer, sanitize, id). */
const assembleReport = (
  pages: readonly CrawledPage[],
  stop: StopReason,
  startedAtMs: number,
  completedAtMs: number,
  ruleErrors: Record<string, number>,
  resolved: ResolvedAuditConfig,
  seed: URL,
  deps: CrawlerDeps,
  warnings: string[],
  ruleSeverities: Readonly<Record<string, Severity>>,
): SiteAuditReport => {
  const pageReports: PageReport[] = pages.map((p) => ({
    url: p.url,
    status: p.status,
    ...(p.title !== undefined ? { title: p.title } : {}),
    issues: p.issues,
    score: p.skipped !== undefined ? null : Math.max(0, 100 - p.issues.reduce((s, i) => s + WEIGHT[i.severity], 0)),
    timingMs: p.timingMs,
    bytes: p.bytes,
    robotsAllowed: p.robotsAllowed,
    depth: p.depth,
    ...(p.skipped !== undefined ? { skipped: p.skipped } : {}),
    ...(p.redirectChain !== undefined ? { redirectChain: p.redirectChain } : {}),
  }));

  const audited = pageReports.filter((p) => p.skipped === undefined);
  const score =
    audited.length === 0 ? 0 : Math.round(audited.reduce((s, p) => s + (p.score ?? 0), 0) / audited.length);

  const countsBySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const byRule: Record<string, number> = {};
  for (const page of pageReports) {
    for (const issue of page.issues) {
      countsBySeverity[issue.severity] += 1;
      byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1;
    }
  }

  const startedAt = new Date(startedAtMs).toISOString();
  return {
    id: `audit-${seed.host}-${startedAt}-${deps.randomId()}`,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    pages: pageReports,
    summary: {
      countsBySeverity,
      score,
      pagesAudited: audited.length,
      pagesSkipped: pageReports.length - audited.length,
      byRule,
      ...(Object.keys(ruleErrors).length > 0 ? { ruleErrors } : {}),
    },
    incomplete: stop !== 'completed',
    configSnapshot: {
      seed: seed.href,
      crawl: { ...resolved.crawl },
      respectRobots: resolved.respectRobots,
      renderer: 'static', // A10 — honesty label: no JS rendering
      thresholds: { ...resolved.thresholds },
      maxBodyBytes: resolved.maxBodyBytes,
      rules: { ...ruleSeverities },
      discoveryWarnings: warnings,
    },
    stopReason: stop,
  };
};
