/**
 * Report assembly (A6): the locked `SiteAuditReport` shape + audit's additive
 * fields (`stopReason`, summary extras). Every crawled-derived string passes
 * through I13 sanitization here; urls are serialized `URL` strings by the
 * crawler (normalized keys); the id is path-safe (I13).
 */
import type { Issue, PageReport, Severity, SiteAuditReport } from '@lumen-seo/core';
import { isBlockedHost } from '@lumen-seo/core';
import { groupIssues } from '../ranking.js';
import { helpUrlFor } from '../rules/rule-set.js';
import type { CrawledPage } from '../crawl/crawler.js';
import type { CrawlerDeps, ResolvedAuditConfig, StopReason } from '../types.js';
import { reportIdFor } from './id.js';
import { sanitizeIssue, sanitizeText } from './sanitize.js';
import { scorePage, scoreReport } from './score.js';

export const assembleReport = (
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
    ...(p.title !== undefined ? { title: sanitizeText(p.title) } : {}),
    issues: p.issues.map((i) => {
      const anchor = helpUrlFor(i.ruleId); // built-ins only — a plugin's own
      // helpUrl is page/plugin-derived text and must NOT ride into reports.
      const { helpUrl: _pluginHelpUrl, ...rest } = i;
      return sanitizeIssue({
        ...rest,
        // E1.2 FR-3: every issue carries its owning page URL and the stable
        // docs anchor (engine-controlled; plugin rules get no anchor).
        url: i.url ?? p.url,
        ...(anchor !== undefined ? { helpUrl: anchor } : {}),
      });
    }),
    score: p.skipped !== undefined ? null : scorePage(p.issues),
    timingMs: p.timingMs,
    bytes: p.bytes,
    robotsAllowed: p.robotsAllowed,
    depth: p.depth,
    ...(p.skipped !== undefined ? { skipped: p.skipped } : {}),
    ...(p.redirectChain !== undefined ? { redirectChain: p.redirectChain } : {}),
  }));

  const audited = pageReports.filter((p) => p.skipped === undefined);

  const countsBySeverity: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const allIssues: Issue[] = [];
  for (const page of pageReports) {
    for (const issue of page.issues) {
      countsBySeverity[issue.severity] += 1;
      allIssues.push(issue);
    }
  }
  // E1.2 FR-2: `summary.byRule` is the ranked group array (0.x breaking per D2 —
  // the counts map it replaces is derivable from the groups).
  const byRule = groupIssues(allIssues);

  const startedAt = new Date(startedAtMs).toISOString();
  return {
    id: reportIdFor(seed.host, startedAt, deps.randomId()),
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    pages: pageReports,
    summary: {
      countsBySeverity,
      score: scoreReport(pageReports),
      pagesAudited: audited.length,
      pagesSkipped: pageReports.length - audited.length,
      byRule,
      ...(Object.keys(ruleErrors).length > 0 ? { ruleErrors } : {}),
    },
    incomplete: stop !== 'completed',
    configSnapshot: {
      seed: seed.href,
      target: { scope: resolved.targetScope ?? (isBlockedHost(seed.hostname) ? 'private' : 'public') },
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
