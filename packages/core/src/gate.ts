/**
 * Pure, deterministic severity-gate helpers (SC-4). The CLI (P4) consumes
 * these for its exit-code contract: 0 = ok/under-threshold,
 * 1 = at least one issue at or above `failThreshold` (equality counts),
 * 2 = config/provider error.
 */
import type { FailThreshold } from './config.js';
import type { Issue } from './page.js';
import type { Severity } from './severity.js';

export const EXIT = { OK: 0, ISSUES: 1, CONFIG_ERROR: 2 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Ordered `info < warning < error` (R1). */
export const severityRank = (severity: Severity): number =>
  ({ info: 1, warning: 2, error: 3 })[severity];

/** Equality counts; `'off'` never gates. */
export const meetsThreshold = (issueSeverity: Severity, threshold: FailThreshold): boolean =>
  threshold === 'off' ? false : severityRank(issueSeverity) >= severityRank(threshold);

export const countIssuesAtOrAbove = (
  issues: readonly Issue[],
  threshold: FailThreshold,
): number => {
  let n = 0;
  for (const issue of issues) if (meetsThreshold(issue.severity, threshold)) n += 1;
  return n;
};

/** Tallies the `summary.countsBySeverity` shape (every severity present, zeroed). */
export const countIssuesBySeverity = (issues: readonly Issue[]): Record<Severity, number> => {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
};
