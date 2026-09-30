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
import { countIssuesAtOrAbove, createPrivateScopePolicy, EXIT, FAIL_THRESHOLDS, MAX_PAGES_CEILING } from '@lumen-seo/core';
import type { FailThreshold, SiteAuditReport, SsrfPolicy } from '@lumen-seo/core';
import type { BaselineDiff, BaselineFile } from '@lumen-seo/audit';
import { buildBaseline, diffAgainstBaseline } from '@lumen-seo/audit';
import { readBaseline, writeBaselineAtomic } from '../baseline.js';
import { createGscProvider } from '@lumen-seo/providers/node';
import { GSC_PACING } from '@lumen-seo/providers/node';
import { GcraPacer, InMemoryCache } from '@lumen-seo/providers';
import { createNodeFetcher } from '@lumen-seo/core/node';
import { intFlag } from '../args.js';
import type { CommandDeps } from '../composition/node.js';
import { buildDeps } from '../composition/node.js';
import type { RunnerScope } from '../composition/audit-adapter.js';
import { jsonDocument } from '../io.js';
import { renderSarif } from '../render/sarif.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderHtml } from '../render/html.js';
import { buildRouteFileMap, seedBase } from '../render/source-map.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { ProviderUnconfiguredError, UsageError } from '../usage-error.js';
import { validatePublicHttpUrl } from '@lumen-seo/mcp/url-guard';
import { writeFileAtomic } from '../write-atomic.js';

export const execute = async (ctx: CliContext, deps?: CommandDeps): Promise<number> => {
  // E1.1 FR-5: canonical origin must be an absolute http(s) URL (fail fast).
  let canonicalOrigin: URL | undefined;
  if (ctx.flags['canonical-origin'] !== undefined) {
    const raw = String(ctx.flags['canonical-origin']);
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
      canonicalOrigin = u;
    } catch {
      throw new UsageError(`--canonical-origin must be an absolute http(s) URL (got "${raw}")`);
    }
  }
  // E1.7 FR-4: --only is a comma-separated category/ruleId list.
  const onlyFlag = ctx.flags.only === undefined ? undefined : String(ctx.flags.only).split(',').map((t) => t.trim()).filter((t) => t !== '');
  const scope: RunnerScope | undefined =
    ctx.flags['allow-private'] === true || canonicalOrigin !== undefined || (onlyFlag !== undefined && onlyFlag.length > 0)
      ? {
          ...(ctx.flags['allow-private'] === true ? { privateScope: { loopback: true } } : {}),
          ...(canonicalOrigin === undefined ? {} : { canonicalOrigin }),
          ...(onlyFlag === undefined || onlyFlag.length === 0 ? {} : { only: onlyFlag }),
        }
      : undefined;
  const d = deps ?? (await buildDeps(ctx.configPathFlag, scope));
  // E1.1 admission: with a launch-time scope, a private host is admitted ONLY
  // at its own (the seed's) origin; without one the guard is unchanged.
  const policyFor: ((url: URL) => SsrfPolicy) | undefined =
    d.privateScope === undefined
      ? undefined
      : (url: URL) => createPrivateScopePolicy({ seedOrigin: url, loopback: d.privateScope!.loopback, allowHosts: d.privateScope!.allowHosts });
  const guard = validatePublicHttpUrl(ctx.positionals[0], policyFor);
  if (!guard.ok) {
    throw new UsageError(
      guard.blockedHost === true
        ? `${guard.message} — for local/private targets pass --allow-private (and list non-loopback ranges in crawl.allowPrivateHosts)`
        : guard.message,
    );
  }
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

  // E1.3: --baseline gates only on NEW findings; --update-baseline writes the
  // current fingerprint set. Mutually exclusive by intent.
  const baselinePath = typeof ctx.flags.baseline === 'string' ? ctx.flags.baseline : undefined;
  const updatePath = typeof ctx.flags['update-baseline'] === 'string' ? ctx.flags['update-baseline'] : undefined;
  if (baselinePath !== undefined && updatePath !== undefined) {
    throw new UsageError('--baseline and --update-baseline are mutually exclusive');
  }
  let baseline: BaselineFile | undefined;
  if (baselinePath !== undefined) baseline = await readBaseline(baselinePath);

  // E1.4: --format selects the renderer; --json stays an alias for json.
  const FORMATS = ['human', 'json', 'sarif', 'md', 'html'] as const;
  type Format = (typeof FORMATS)[number];
  const formatFlag = ctx.flags.format === undefined ? undefined : String(ctx.flags.format);
  if (formatFlag !== undefined && !(FORMATS as readonly string[]).includes(formatFlag)) {
    throw new UsageError(`--format must be one of: ${FORMATS.join(', ')}`);
  }
  if (formatFlag !== undefined && formatFlag !== 'json' && ctx.flags.json === true) {
    throw new UsageError('--json is an alias for --format json — pick one');
  }
  const format: Format = (formatFlag as Format | undefined) ?? (ctx.flags.json === true ? 'json' : 'human');
  const sourceMap =
    ctx.flags['source-map'] === undefined
      ? undefined
      : buildRouteFileMap(String(ctx.flags['source-map']), process.cwd(), seedBase(url));

  if (d.auditRunner === undefined) {
    throw new ProviderUnconfiguredError('audit', 'no audit engine wired in this build');
  }

  const report = await d.auditRunner.run({ url, maxPages: maxPagesFlag }, ctx.signal); // R8: undefined = core default
  const issues = report.pages.flatMap((p) => p.issues);
  const baselineDiff: BaselineDiff | undefined = baseline === undefined ? undefined : diffAgainstBaseline(report, baseline);
  // E1.3 FR-1 + M4 decision: with a baseline, the threshold applies to NEW
  // issues only (a new warning does NOT gate at the default error threshold —
  // the exit-code contract is unchanged); incomplete still fails the gate.
  const gateIssues = baselineDiff?.newIssues ?? issues;
  const gateFailed = report.incomplete || countIssuesAtOrAbove(gateIssues, threshold) > 0; // 'off' never counts
  const cancelled = ctx.signal.aborted || report.stopReason === 'aborted';

  // E1.4: for sarif/md, --out writes the RENDERED document (the CI artifact);
  // json/human keep the raw report. Cancelled sarif runs still write the
  // rendered partial (valid — incomplete rides in properties), stdout silent.
  const renderArtifact = (): string | undefined => {
    if (format === 'sarif') return renderSarif(report, { sourceMap, ...(baselineDiff === undefined ? {} : { baseline: baselineDiff }) });
    if (format === 'md') return renderMarkdown(report, baselineDiff === undefined ? {} : { baseline: { path: baselinePath!, diff: baselineDiff } });
    if (format === 'html') return renderHtml(report);
    return undefined;
  };
  if (typeof ctx.flags.out === 'string') {
    const artifact = renderArtifact();
    await writeFileAtomic(ctx.flags.out, artifact ?? `${JSON.stringify(report, null, 2)}\n`);
  }

  // I2: cancellation/incomplete checks PRECEDE any baseline write — a SIGINT'd
  // run exits 2 with no write; an incomplete run never bakes a partial set.
  if (cancelled) {
    const { io } = ctx;
    if (format === 'human') io.out(humanSummary(report, threshold, {}));
    else if (format === 'json') io.out(jsonDocument(report));
    // sarif/md with --out already wrote the artifact; without --out a cancelled
    // CI render prints nothing (stdout contract) and the exit code says it.
    io.err('cancelled\n');
    return EXIT.CONFIG_ERROR; // E14: SIGINT -> 2 (no history write, no baseline write)
  }
  if (updatePath !== undefined) {
    if (report.incomplete) {
      throw new UsageError(
        `cannot --update-baseline from an incomplete report (stopReason: ${report.stopReason ?? 'unknown'}) — re-run to completion first`,
      );
    }
    await writeBaselineAtomic(updatePath, buildBaseline(report, d.clock()));
  }

  // E2.1 --with-gsc: annotate by-rule groups with clicks/impressions summed
  // over the FULL distinct affected-URL set (stdout-only — --out stays raw, M2).
  const gscIo = ctx.io;
  let gscAnnotator: ((g: { ruleId: string }, urls: readonly string[]) => { clicks: number; impressions: number } | undefined) | undefined;
  if (ctx.flags['with-gsc'] === true) {
    const credPath = process.env.LUMEN_GSC_CREDENTIALS;
    if (deps?.performanceProvider === undefined && (credPath === undefined || credPath === '')) {
      gscIo.err('GSC not configured — audit ran without traffic annotations (set LUMEN_GSC_CREDENTIALS)\n');
    } else {
      const gsc = deps?.performanceProvider ?? createGscProvider({
        credentialsPath: credPath ?? '',
        fetcher: createNodeFetcher(),
        cache: new InMemoryCache(),
        pacer: new GcraPacer(GSC_PACING.rpm, GSC_PACING.burst, Date.now, () => new Promise((r) => setTimeout(r, 1))),
        clock: Date.now,
      });
      try {
        const perf = await gsc.performance(new URL(url.origin), { days: 28, by: 'page' });
        const byPage = new Map(perf.rows.map((r) => [r.key, r]));
        gscAnnotator = (g, urls) => {
          void g;
          let clicks = 0;
          let impressions = 0;
          let seen = false;
          for (const u of urls) {
            const row = byPage.get(u) ?? byPage.get(u.replace(/\/$/, ''));
            if (row !== undefined) {
              clicks += row.clicks;
              impressions += row.impressions;
              seen = true;
            }
          }
          return seen ? { clicks, impressions } : undefined;
        };
      } catch (e) {
        gscIo.err(`GSC annotation failed (${clean(e instanceof Error ? e.message : String(e), 160)}) — audit ran without traffic annotations\n`);
      }
    }
  }

  const { io } = ctx;
  if (format === 'sarif') {
    // CI renders print to stdout only without --out (artifact-only otherwise).
    if (typeof ctx.flags.out !== 'string') io.out(renderSarif(report, { sourceMap, ...(baselineDiff === undefined ? {} : { baseline: baselineDiff }) }));
  } else if (format === 'md') {
    if (typeof ctx.flags.out !== 'string') io.out(renderMarkdown(report, baselineDiff === undefined ? {} : { baseline: { path: baselinePath!, diff: baselineDiff } }));
  } else if (format === 'html') {
    if (typeof ctx.flags.out !== 'string') io.out(renderHtml(report));
  } else if (format === 'json') {
    // M2: the baseline section is stdout-only; --out keeps the raw report.
    const annotated = gscAnnotator === undefined ? report : annotateWithGsc(report, gscAnnotator);
    io.out(
      jsonDocument(
        baselineDiff === undefined ? annotated : { ...annotated, baseline: baselineSection(baselinePath!, baselineDiff) },
      ),
    );
  } else {
    const annotated = gscAnnotator === undefined ? report : annotateWithGsc(report, gscAnnotator);
    io.out(
      humanSummary(annotated, threshold, {
        baselinePath,
        diff: baselineDiff,
        verbose: ctx.flags.verbose === true,
        gscNote: gscAnnotator !== undefined,
      }),
    );
  }
  // Stage 3: one audit-digest line per completed run (failures included —
  // incomplete is labeled with its stop reason, never hidden).
  await d.history.append({
    url: url.href,
    score: report.summary.score ?? 0,
    pagesAudited: report.summary.pagesAudited ?? report.pages.length,
    incomplete: report.incomplete,
    ...(report.incomplete && report.stopReason !== undefined ? { stopReason: report.stopReason } : {}),
    countsBySeverity: report.summary.countsBySeverity,
    provider: 'lumen-audit',
    retrievedAt: d.clock(),
  });
  // FR-2: an update run's job is the WRITE — the gate is skipped and the run
  // exits 0 (the adopt flow's first command must not fail on existing findings).
  if (updatePath !== undefined) return EXIT.OK;
  return gateFailed ? EXIT.ISSUES : EXIT.OK;
};

/** Attaches {clicks, impressions} to each by-rule group (E2.1 --with-gsc). */
const annotateWithGsc = (
  report: SiteAuditReport,
  annotator: (g: { ruleId: string }, urls: readonly string[]) => { clicks: number; impressions: number } | undefined,
): SiteAuditReport => {
  const groups = (report.summary.byRule ?? []).map((g) => {
    const urls = [
      ...new Set(
        report.pages.flatMap((p) => p.issues.filter((i) => i.ruleId === g.ruleId).map((i) => i.url ?? p.url)),
      ),
    ];
    const traffic = annotator(g, urls);
    return traffic === undefined ? g : { ...g, traffic };
  });
  return { ...report, summary: { ...report.summary, byRule: groups } };
};

/** stdout-only baseline section (M2): --out keeps the raw report untouched. */
const baselineSection = (path: string, diff: BaselineDiff): Record<string, unknown> => ({
  path,
  new: diff.newIssues.map((i) => ({ ruleId: i.ruleId, severity: i.severity, url: i.url })),
  existingCount: diff.existingCount,
  fixed: diff.fixed.map((e) => e.url),
  unknownCount: diff.unknown.length,
});

interface HumanOptions {
  baselinePath?: string;
  diff?: BaselineDiff;
  verbose?: boolean;
  gscNote?: boolean;
}

/**
 * Human output (E1.2 FR-5): findings GROUPED by rule in ranked order, a
 * `→ fix:` line under each group, up to 3 sample URLs (+N more; --verbose
 * lists all). With a baseline: the new/existing/fixed sections and the
 * partial-comparison hint (E1.3 FR-5).
 */
export const humanSummary = (report: SiteAuditReport, threshold: FailThreshold, o: HumanOptions = {}): string => {
  const c = report.summary.countsBySeverity;
  const lines = [
    `audit: ${clean(report.pages[0]?.url ?? '')}`,
    `  pages: ${report.summary.pagesAudited ?? report.pages.length} audited${report.summary.pagesSkipped ? `, ${report.summary.pagesSkipped} skipped` : ''}`,
    `  score: ${report.summary.score ?? 'n/a'}`,
    `  issues: ${c.error} error / ${c.warning} warning / ${c.info} info`,
    `  failThreshold: ${threshold}${report.incomplete ? '  (report incomplete — gate fails, E1)' : ''}`,
  ];
  if (o.gscNote === true) lines.push('  traffic: annotated with GSC clicks/impressions (28d)');
  const groups = report.summary.byRule ?? [];
  for (const g of groups) {
    const traffic = (g as { traffic?: { clicks: number; impressions: number } }).traffic;
    const trafficNote = traffic === undefined ? '' : ` · ${traffic.clicks} clicks/${traffic.impressions} imps (28d, gsc)`;
    lines.push(`  [${g.severity}] ${g.ruleId} — ${g.affectedPages} page${g.affectedPages === 1 ? '' : 's'}${trafficNote}`);
    const fix = g.fixHint ?? `no fix hint provided (${g.ruleId})`;
    lines.push(`    → fix: ${clean(fix, 160)}${g.helpUrl !== undefined ? ` (${g.helpUrl})` : ''}`);
    const urls = o.verbose ? [...new Set(report.pages.flatMap((p) => p.issues.filter((i) => i.ruleId === g.ruleId).map((i) => i.url ?? p.url)))] : g.sampleUrls;
    for (const u of urls.slice(0, o.verbose ? urls.length : 3)) lines.push(`    ${clean(u, 120)}`);
    if (!o.verbose && g.affectedPages > 3) lines.push(`    +${g.affectedPages - 3} more (pass --verbose)`);
  }
  if (o.diff !== undefined) {
    lines.push(`  baseline: ${clean(o.baselinePath ?? '', 120)}`);
    lines.push(`    new: ${o.diff.newIssues.length} (gated) · existing: ${o.diff.existingCount} (reported, not gated) · fixed: ${o.diff.fixed.length} · unknown: ${o.diff.unknown.length}`);
    for (const i of o.diff.newIssues.slice(0, 10)) {
      lines.push(`    + [${i.severity}] ${clean(i.ruleId, 60)}: ${clean(i.message, 100)} — ${clean(i.url ?? '', 120)}`);
    }
    for (const e of o.diff.fixed.slice(0, 10)) lines.push(`    - fixed: ${clean(e.url, 120)}`);
    if (report.incomplete) lines.push('    baseline comparison is partial (report incomplete)');
  }
  return `${lines.join('\n')}\n`;
};
