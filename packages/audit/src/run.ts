/**
 * `runSiteAudit` — the single public engine entry point (I5): one polite,
 * bounded, cancellable crawl + rules + report. Both the `lumen audit` CLI and
 * the `lumen_audit_site` MCP tool call exactly this (P4's concern).
 *
 * Determinism (I10): clock, sleep, jitter, and the report-id random component
 * are injected via `deps`; identical inputs + deps produce byte-identical
 * reports.
 */
import type { PageReport, Severity, SiteAuditReport } from '@lumen-seo/core';
import { resolveAuditConfig } from './config.js';
import { crawl } from './crawl/crawler.js';
import type { CrawledPage } from './crawl/crawler.js';
import type { AuditConfig, CrawlerDeps, ResolvedAuditConfig, StopReason } from './types.js';

const WEIGHT: Record<Severity, number> = { error: 10, warning: 3, info: 0 };

export const runSiteAudit = async (
  seed: URL,
  config: AuditConfig = {},
  deps: CrawlerDeps,
  signal?: AbortSignal,
): Promise<SiteAuditReport> => {
  const resolved = resolveAuditConfig(config);
  const warnings: string[] = [];
  const result = await crawl({
    seed,
    config: resolved,
    deps,
    rules: resolved.extraRules, // built-in rule set lands in Phase 5
    signal,
    onWarning: (code) => warnings.push(code),
  });

  return assembleReport(result.pages, result.stop, result.startedAtMs, result.completedAtMs, result.ruleErrors, resolved, seed, deps, warnings);
};

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
      rules: [...resolved.extraRules.map((r) => r.id)],
      discoveryWarnings: warnings,
    },
    stopReason: stop,
  };
};
