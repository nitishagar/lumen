/**
 * `lumen audit <url>` (E1/R1/R2/R8/E14): bounded site audit via the
 * AuditRunner port. Exit code: 0 under threshold; 1 when ANY issue is at or
 * above failThreshold OR the report is incomplete (an untrustworthy report
 * must not pass a CI gate); 2 on config/provider/usage error or SIGINT
 * cancellation ("off" NEVER gates on severity; incomplete still gates unless
 * the run was cancelled, which exits 2 with a partial, atomically-written
 * report). `--out` writes are atomic; `--max-pages` has NO flag-level default
 * (R8) — absent means core's config budget applies.
 */
import { countIssuesAtOrAbove, EXIT, FAIL_THRESHOLDS, MAX_PAGES_CEILING } from '@lumen-seo/core';
import type { FailThreshold, SiteAuditReport } from '@lumen-seo/core';
import { intFlag } from '../args.js';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError, UsageError } from '../usage-error.js';
import { validatePublicHttpUrl } from '@lumen-seo/mcp/url-guard';
import { writeFileAtomic } from '../write-atomic.js';

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  const d = deps ?? (await buildDeps(ctx.configPathFlag));
  const guard = validatePublicHttpUrl(ctx.positionals[0]);
  if (!guard.ok) throw new UsageError(guard.message);
  const url = guard.url;

  const maxPagesFlag = intFlag(ctx.flags, 'max-pages');
  if (maxPagesFlag !== undefined && (maxPagesFlag < 1 || maxPagesFlag > MAX_PAGES_CEILING)) {
    throw new UsageError(`--max-pages must be between 1 and ${MAX_PAGES_CEILING}`);
  }
  const thresholdFlag = ctx.flags['fail-threshold'];
  if (thresholdFlag !== undefined && !(FAIL_THRESHOLDS as readonly string[]).includes(String(thresholdFlag))) {
    throw new UsageError(`--fail-threshold must be one of: ${FAIL_THRESHOLDS.join(', ')}`);
  }
  const threshold: FailThreshold =
    thresholdFlag === undefined ? (d.failThreshold ?? 'error') : (thresholdFlag as FailThreshold); // R2

  if (d.auditRunner === undefined) {
    throw new ProviderUnconfiguredError('audit', 'no audit engine wired in this build');
  }

  const report = await d.auditRunner.run({ url, maxPages: maxPagesFlag }, ctx.signal); // R8: undefined = core default
  const issues = report.pages.flatMap((p) => p.issues);
  const gateFailed = report.incomplete || countIssuesAtOrAbove(issues, threshold) > 0; // 'off' never counts
  const cancelled = ctx.signal.aborted || report.stopReason === 'aborted';

  if (typeof ctx.flags.out === 'string') {
    await writeFileAtomic(ctx.flags.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  const { io } = ctx;
  if (ctx.flags.json === true) io.out(jsonDocument(report));
  else io.out(humanSummary(report, threshold));

  if (cancelled) {
    io.err('cancelled\n');
    return EXIT.CONFIG_ERROR; // E14: SIGINT -> 2
  }
  return gateFailed ? EXIT.ISSUES : EXIT.OK;
};

export const humanSummary = (report: SiteAuditReport, threshold: FailThreshold): string => {
  const c = report.summary.countsBySeverity;
  const lines = [
    `audit: ${clean(report.pages[0]?.url ?? '')}`,
    `  pages: ${report.summary.pagesAudited ?? report.pages.length} audited${report.summary.pagesSkipped ? `, ${report.summary.pagesSkipped} skipped` : ''}`,
    `  score: ${report.summary.score ?? 'n/a'}`,
    `  issues: ${c.error} error / ${c.warning} warning / ${c.info} info`,
    `  failThreshold: ${threshold}${report.incomplete ? '  (report incomplete — gate fails, E1)' : ''}`,
  ];
  const top = report.pages
    .flatMap((p) => p.issues)
    .slice(0, 10);
  for (const i of top) {
    lines.push(`    [${i.severity}] ${clean(i.ruleId, 60)}: ${clean(i.message, 140)}`);
  }
  return `${lines.join('\n')}\n`;
};
