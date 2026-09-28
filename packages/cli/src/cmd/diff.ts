/**
 * `lumen diff <a.json> <b.json>` (PRD E1.3 FR-4, report-to-report form):
 * the same new/existing/fixed honesty rules as the baseline gate, over two
 * SAVED audit reports (`--out` files), plus the score delta. Exit 1 when the
 * newer report (b) has new findings — CI-usable; 2 on usage/read errors.
 * (`--from-history` is deferred to v0.5: the audit history kind is a digest
 * with no findings — recorded in the PRD-plan ledger.)
 */
import { readFile } from 'node:fs/promises';
import { EXIT } from '@lumen-seo/core';
import type { SiteAuditReport } from '@lumen-seo/core';
import { diffReports } from '@lumen-seo/audit';
import { jsonDocument } from '../io.js';
import type { CliContext } from '../run.js';
import { clean } from '../term.js';
import { UsageError } from '../usage-error.js';

const readReport = async (path: string): Promise<SiteAuditReport> => {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read report ${path}: ${(e as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw) as SiteAuditReport;
    if (!Array.isArray(parsed.pages) || parsed.summary === undefined) {
      throw new Error('not a lumen audit report (expected {pages[], summary})');
    }
    return parsed;
  } catch (e) {
    throw new UsageError(`report ${path} is not a valid lumen audit report: ${(e as Error).message}`);
  }
};

export const execute = async (ctx: CliContext): Promise<number> => {
  const { io } = ctx;
  const [aPath, bPath] = ctx.positionals;
  if (aPath === undefined || bPath === undefined) {
    throw new UsageError('lumen diff <a.json> <b.json> — two saved audit reports are required');
  }
  const a = await readReport(aPath);
  const b = await readReport(bPath);
  const diff = diffReports(a, b);
  const payload = {
    a: { path: aPath, seed: String(a.configSnapshot?.seed ?? ''), score: a.summary.score },
    b: { path: bPath, seed: String(b.configSnapshot?.seed ?? ''), score: b.summary.score },
    newIssues: diff.newIssues.map((i) => ({ ruleId: i.ruleId, severity: i.severity, url: i.url, message: i.message })),
    existingCount: diff.existingCount,
    fixed: diff.fixed.map((e) => e.url),
    unknownCount: diff.unknown.length,
    scoreDelta: diff.scoreDelta,
    incomplete: a.incomplete === true || b.incomplete === true,
  };
  if (ctx.flags.json === true) {
    io.out(jsonDocument(payload));
  } else {
    io.out(`diff: ${clean(aPath)} → ${clean(bPath)}\n`);
    const delta = diff.scoreDelta === null ? 'n/a' : `${diff.scoreDelta >= 0 ? '+' : ''}${diff.scoreDelta}`;
    io.out(`  score: ${a.summary.score ?? 'n/a'} → ${b.summary.score ?? 'n/a'} (${delta})\n`);
    io.out(`  new: ${diff.newIssues.length} · existing: ${diff.existingCount} · fixed: ${diff.fixed.length} · unknown: ${diff.unknown.length}\n`);
    for (const i of diff.newIssues.slice(0, 20)) {
      io.out(`  + [${i.severity}] ${clean(i.ruleId, 60)}: ${clean(i.message, 100)} — ${clean(i.url ?? '', 120)}\n`);
    }
    for (const e of diff.fixed.slice(0, 20)) io.out(`  - fixed: ${clean(e.url, 120)}\n`);
    if (payload.incomplete) io.out('  note: one or both reports are incomplete — the comparison is partial\n');
  }
  return diff.newIssues.length > 0 ? EXIT.ISSUES : EXIT.OK;
};
