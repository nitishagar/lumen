/**
 * Job-summary Markdown renderer (PRD E1.4 FR-2): score, new/fixed when
 * baselined, top rule groups with fixes — piped by the Action to
 * `$GITHUB_STEP_SUMMARY`.
 */
import type { BaselineDiff } from '@lumen-seo/audit';
import type { SiteAuditReport } from '@lumen-seo/core';

export interface MarkdownOptions {
  baseline?: { path: string; diff: BaselineDiff };
}

export const renderMarkdown = (report: SiteAuditReport, o: MarkdownOptions = {}): string => {
  const c = report.summary.countsBySeverity;
  const lines: string[] = [
    '## lumen audit',
    '',
    `- **score:** ${report.summary.score ?? 'n/a'}/100`,
    `- **pages:** ${report.summary.pagesAudited ?? report.pages.length} audited${report.summary.pagesSkipped ? `, ${report.summary.pagesSkipped} skipped` : ''}`,
    `- **issues:** ${c.error} error / ${c.warning} warning / ${c.info} info`,
  ];
  if (report.incomplete) {
    lines.push(`- ⚠️ **incomplete run** (stopReason: ${report.stopReason ?? 'unknown'}) — the comparison is partial`);
  }
  if (o.baseline !== undefined) {
    const d = o.baseline.diff;
    lines.push(
      '',
      `### baseline (\`${o.baseline.path}\`)`,
      '',
      `- **new:** ${d.newIssues.length} (gated) · **existing:** ${d.existingCount} · **fixed:** ${d.fixed.length} · **unknown:** ${d.unknown.length}`,
    );
    if (d.newIssues.length > 0) {
      lines.push('', '| severity | rule | page |', '|---|---|---|');
      for (const i of d.newIssues.slice(0, 10)) {
        lines.push(`| ${i.severity} | \`${i.ruleId}\` | ${i.url ?? ''} |`);
      }
      if (d.newIssues.length > 10) lines.push(`| … | +${d.newIssues.length - 10} more | |`);
    }
  }
  const groups = report.summary.byRule ?? [];
  if (groups.length > 0) {
    lines.push('', '### top rules', '', '| severity | rule | pages | fix |', '|---|---|---|---|');
    for (const g of groups.slice(0, 10)) {
      const fix = (g.fixHint ?? 'no fix hint provided').replace(/\|/g, '\\|');
      const rule = g.helpUrl !== undefined ? `[\`${g.ruleId}\`](${g.helpUrl})` : `\`${g.ruleId}\``;
      lines.push(`| ${g.severity} | ${rule} | ${g.affectedPages} | ${fix} |`);
    }
  }
  return `${lines.join('\n')}\n`;
};
