/**
 * SARIF 2.1.0 renderer (PRD E1.4 FR-1): one `rule` per lumen rule (helpUri +
 * shortDescription + the fix as help.text), one `result` per issue with the
 * page URL as `artifactLocation.uri` (mapped through the optional
 * best-effort source map — NEVER guessed: ambiguous or unmatched stays
 * URL-only, P-Honest). Provenance rides in `run.properties` (tool version,
 * crawl budgets, startedAt/completedAt, incomplete/stopReason).
 */
import type { BaselineDiff } from '@lumen-seo/audit';
import type { Issue, SiteAuditReport } from '@lumen-seo/core';
import { UA_VERSION } from '@lumen-seo/core';
import { RULES_CATALOG } from '@lumen-seo/mcp';
import type { RouteFileMap } from './source-map.js';

const SARIF_SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

const LEVEL: Record<Issue['severity'], 'error' | 'warning' | 'note'> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

export interface SarifOptions {
  sourceMap?: RouteFileMap;
  baseline?: BaselineDiff;
}

export const renderSarif = (report: SiteAuditReport, o: SarifOptions = {}): string => {
  const issues: Issue[] = report.pages.flatMap((p: { issues: Issue[] }) => p.issues);
  const ruleIdsInResults = [...new Set(issues.map((i: Issue) => i.ruleId))];
  const catalogById = new Map(RULES_CATALOG.map((r) => [r.id, r]));
  const pluginRuleIds = ruleIdsInResults.filter((id) => !catalogById.has(id));

  const rules = [
    ...RULES_CATALOG.map((r) => ({
      id: r.id,
      shortDescription: { text: `${r.id} (${r.defaultSeverity})` },
      ...(r.fixHint !== undefined ? { help: { text: r.fixHint } } : {}),
      helpUri: r.helpUrl,
    })),
    ...pluginRuleIds.map((id) => ({
      id,
      shortDescription: { text: `${id} (plugin rule)` },
    })),
  ];
  const ruleIndex = new Map(rules.map((r, n) => [r.id, n]));

  const results = issues.map((i) => {
    const mapped = o.sourceMap?.(i.url ?? '');
    return {
      ruleId: i.ruleId,
      ruleIndex: ruleIndex.get(i.ruleId) ?? -1,
      level: LEVEL[i.severity],
      message: { text: i.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: mapped ?? i.url },
          },
        },
      ],
    };
  });

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0' as const,
    runs: [
      {
        tool: {
          driver: {
            name: 'lumen',
            version: UA_VERSION,
            informationUri: 'https://nitishagar.github.io/lumen/',
            rules,
          },
        },
        results,
        properties: {
          seed: String(report.configSnapshot.seed ?? ''),
          targetScope: (report.configSnapshot as { target?: { scope?: string } }).target?.scope ?? 'public',
          pagesAudited: report.summary.pagesAudited ?? report.pages.length,
          pagesSkipped: report.summary.pagesSkipped ?? 0,
          score: report.summary.score,
          incomplete: report.incomplete,
          ...(report.stopReason !== undefined ? { stopReason: report.stopReason } : {}),
          startedAt: report.startedAt,
          completedAt: report.completedAt,
          crawl: report.configSnapshot.crawl ?? {},
          ...(o.baseline === undefined
            ? {}
            : {
                baseline: {
                  newIssues: o.baseline.newIssues.length,
                  existingCount: o.baseline.existingCount,
                  fixed: o.baseline.fixed.length,
                  unknown: o.baseline.unknown.length,
                },
              }),
        },
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
};
