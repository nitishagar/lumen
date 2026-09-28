/**
 * Actionable-findings ranking + grouping (E1.2 FR-1/FR-2): ONE comparator and
 * ONE grouping function consumed by the CLI human renderer, the MCP
 * `topRules` payload, and (Bundle 5) the SARIF/Markdown renderers.
 *
 * Ranking: severity (error > warning > info) → affected pages descending →
 * ruleId ascending. P-Honest: `affectedPages` counts DISTINCT audited page
 * URLs only — skipped pages are never counted as affected (and never as
 * passing).
 */
import type { ByRuleGroup, Issue, PageReport, Severity } from '@lumen-seo/core';

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

export const compareIssues = (a: Issue, b: Issue): number => {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
};

export const maxSeverity = (severities: readonly Severity[]): Severity =>
  severities.reduce<Severity>((best, s) => (SEVERITY_ORDER[s] < SEVERITY_ORDER[best] ? s : best), 'info');

/**
 * Groups all issues of a run by rule id. `fixHint`/`helpUrl` come from the
 * issue where present (fixHint may be absent for plugin rules — renderers
 * print the "no fix hint provided by plugin" line in that case).
 */
export const groupIssues = (
  issues: readonly (Issue & { url?: string })[],
  options: { fixHints?: Readonly<Record<string, string | undefined>> } = {},
): ByRuleGroup[] => {
  const byRule = new Map<string, { severities: Severity[]; urls: Set<string>; fixHint?: string; helpUrl?: string }>();
  for (const issue of issues) {
    let g = byRule.get(issue.ruleId);
    if (g === undefined) {
      g = { severities: [], urls: new Set(), fixHint: issue.fixHint, helpUrl: issue.helpUrl };
      byRule.set(issue.ruleId, g);
    }
    g.severities.push(issue.severity);
    if (issue.url !== undefined) g.urls.add(issue.url);
  }
  const groups: ByRuleGroup[] = [...byRule.entries()].map(([ruleId, g]) => ({
    ruleId,
    severity: maxSeverity(g.severities),
    affectedPages: g.urls.size,
    sampleUrls: [...g.urls].sort().slice(0, 3),
    ...(g.fixHint !== undefined ? { fixHint: g.fixHint } : options.fixHints?.[ruleId] !== undefined ? { fixHint: options.fixHints[ruleId] } : {}),
    ...(g.helpUrl !== undefined ? { helpUrl: g.helpUrl } : {}),
  }));
  return groups.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.affectedPages !== b.affectedPages) return b.affectedPages - a.affectedPages;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
};

/** All issues of a run in ranked order (per-issue: severity → ruleId → url). */
export const rankedIssues = (pages: readonly PageReport[]): Issue[] =>
  pages
    .flatMap((p) => p.issues)
    .sort((a, b) => {
      const byRule = compareIssues(a, b);
      if (byRule !== 0) return byRule;
      return (a.url ?? '').localeCompare(b.url ?? '');
    });
