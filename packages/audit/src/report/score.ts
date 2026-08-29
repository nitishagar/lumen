/**
 * Severity-weighted scoring (plan A7, locked snippet): error −10, warning −3,
 * info 0, floor 0 per page; site score = rounded mean over AUDITED pages.
 * Monotone by construction — more issues never raise a score. Zero audited
 * pages → 0 (honest: nothing audited ≠ clean, I3).
 */
import type { Issue, PageReport, Severity } from '@lumen-seo/core';

export const WEIGHT: Record<Severity, number> = { error: 10, warning: 3, info: 0 };

export function scorePage(issues: Issue[]): number {
  return Math.max(0, 100 - issues.reduce((s, i) => s + WEIGHT[i.severity], 0));
}

export function scoreReport(pages: PageReport[]): number {
  const audited = pages.filter((p) => !p.skipped);
  return audited.length === 0
    ? 0 // honest: nothing audited ≠ clean
    : Math.round(audited.reduce((s, p) => s + scorePage(p.issues), 0) / audited.length);
}
