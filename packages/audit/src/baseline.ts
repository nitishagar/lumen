/**
 * Baseline + diff semantics (PRD E1.3): the pure comparison core. The
 * baseline file stores `{ fp, url }` ENTRIES — a bare fingerprint list cannot
 * support the honest `fixed`/`unknown` split, because a hash does not reveal
 * which page it belonged to (validator C1).
 *
 * P-Honesty rules (FR-3):
 * - `new` = this run's issues whose fingerprint is absent from the baseline.
 * - `fixed` = baseline entries whose page WAS audited this run and whose
 *   fingerprint no longer appears — a page not audited this run is `unknown`,
 *   never "fixed" (crawl-evidence honesty).
 * - The gate counts issue INSTANCES whose fp ∉ baseline (validator I4).
 */
import type { Issue, SiteAuditReport } from '@lumen-seo/core';
import { fingerprintIssue } from './fingerprint.js';
import { normalizeKey } from './crawl/url-normalize.js';

export interface BaselineEntry {
  /** sha256 fingerprint of one issue (message-free by construction). */
  readonly fp: string;
  /** Normalized URL of the page the issue was on (fixed/unknown honesty). */
  readonly url: string;
}

export interface BaselineFile {
  readonly version: 1;
  readonly seed: string;
  readonly writtenAt: string;
  /** Sorted by (fp, url), deduped. */
  readonly entries: readonly BaselineEntry[];
}

export interface BaselineDiff {
  /** This run's issues whose fingerprint is not in the baseline (ranked order preserved as given). */
  readonly newIssues: readonly Issue[];
  /** Count of this run's issues already in the baseline. */
  readonly existingCount: number;
  /** Baseline entries whose page was audited this run and whose finding is gone. */
  readonly fixed: readonly BaselineEntry[];
  /** Baseline entries whose page was NOT audited this run — never claimed fixed. */
  readonly unknown: readonly BaselineEntry[];
}

/** Builds the baseline file from a completed report (sorted, deduped). */
export const buildBaseline = (report: SiteAuditReport, writtenAt: string): BaselineFile => {
  const seen = new Map<string, BaselineEntry>();
  for (const page of report.pages) {
    for (const issue of page.issues) {
      const entry: BaselineEntry = { fp: fingerprintIssue(issue), url: normalizeKey(new URL(issue.url ?? page.url)) };
      seen.set(`${entry.fp}\n${entry.url}`, entry);
    }
  }
  const entries = [...seen.values()].sort((a, b) => (a.fp < b.fp ? -1 : a.fp > b.fp ? 1 : a.url < b.url ? -1 : 1));
  return {
    version: 1,
    seed: String(report.configSnapshot.seed),
    writtenAt,
    entries,
  };
};

/** The new/existing/fixed/unknown breakdown of a run against a baseline. */
export const diffAgainstBaseline = (report: SiteAuditReport, baseline: BaselineFile): BaselineDiff => {
  const baselineFps = new Set(baseline.entries.map((e) => e.fp));
  const newIssues: Issue[] = [];
  let existingCount = 0;
  const currentFps = new Set<string>();
  // P-Honesty (FR-3): only FETCHED pages count as audited — a skipped page
  // (robots-disallowed/non-html/oversized) has no evidence either way, so its
  // baseline findings are unknown, never fixed.
  const auditedUrls = new Set<string>();
  for (const page of report.pages.filter((p) => p.skipped === undefined)) {
    auditedUrls.add(normalizeKey(new URL(page.url)));
    for (const issue of page.issues) {
      const fp = fingerprintIssue(issue);
      currentFps.add(fp);
      if (baselineFps.has(fp)) existingCount += 1;
      else newIssues.push(issue);
    }
  }
  const fixed: BaselineEntry[] = [];
  const unknown: BaselineEntry[] = [];
  for (const entry of baseline.entries) {
    if (currentFps.has(entry.fp)) continue; // still present
    if (auditedUrls.has(entry.url)) fixed.push(entry);
    else unknown.push(entry); // page not audited this run — honestly unknown
  }
  return { newIssues, existingCount, fixed, unknown };
};

/** Two saved reports compared with the same honesty rules (a = baseline side). */
export const diffReports = (
  a: SiteAuditReport,
  b: SiteAuditReport,
): BaselineDiff & { scoreDelta: number | null } => {
  const aIssues = a.pages.flatMap((p) => p.issues);
  const aFps = new Set(aIssues.map((i) => fingerprintIssue(i)));
  const bIssues = b.pages.flatMap((p) => p.issues);
  const newIssues = bIssues.filter((i) => !aFps.has(fingerprintIssue(i)));
  const bFps = new Set(bIssues.map((i) => fingerprintIssue(i)));
  const bUrls = new Set(b.pages.filter((p) => p.skipped === undefined).map((p) => normalizeKey(new URL(p.url))));
  const fixed: BaselineEntry[] = [];
  const unknown: BaselineEntry[] = [];
  const seenA = new Set<string>();
  for (const issue of aIssues) {
    const fp = fingerprintIssue(issue);
    if (bFps.has(fp) || seenA.has(fp)) continue; // dedupe a's own repeats
    seenA.add(fp);
    const url = normalizeKey(new URL(issue.url ?? 'https://unknown.invalid'));
    const entry: BaselineEntry = { fp, url };
    if (bUrls.has(url)) fixed.push(entry);
    else unknown.push(entry);
  }
  return {
    newIssues,
    existingCount: bIssues.length - newIssues.length,
    fixed,
    unknown,
    scoreDelta:
      a.summary.score === null || b.summary.score === null ? null : b.summary.score - a.summary.score,
  };
};
