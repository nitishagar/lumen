import { describe, expect, it } from 'vitest';
import type { Issue } from './page.js';
import { EXIT, countIssuesAtOrAbove, countIssuesBySeverity, meetsThreshold, severityRank } from './gate.js';

const issue = (severity: Issue['severity']): Issue => ({
  ruleId: 'x',
  severity,
  message: 'm',
  evidence: {},
});

describe('severity gate helpers (SC-4)', () => {
  it('severity ordering is info < warning < error (R1)', () => {
    expect(severityRank('info')).toBeLessThan(severityRank('warning'));
    expect(severityRank('warning')).toBeLessThan(severityRank('error'));
  });

  it('equality at the threshold FAILS the gate (exit-1 class)', () => {
    expect(meetsThreshold('error', 'error')).toBe(true);
    expect(meetsThreshold('warning', 'warning')).toBe(true);
    expect(meetsThreshold('info', 'info')).toBe(true);
  });

  it('an issue below the threshold passes', () => {
    expect(meetsThreshold('info', 'error')).toBe(false);
    expect(meetsThreshold('warning', 'error')).toBe(false);
    expect(meetsThreshold('info', 'warning')).toBe(false);
  });

  it('an issue above the threshold fails', () => {
    expect(meetsThreshold('error', 'warning')).toBe(true);
    expect(meetsThreshold('warning', 'info')).toBe(true);
  });

  it("'off' never gates anything", () => {
    expect(meetsThreshold('error', 'off')).toBe(false);
    expect(meetsThreshold('warning', 'off')).toBe(false);
    expect(meetsThreshold('info', 'off')).toBe(false);
  });

  it('countIssuesAtOrAbove tallies at-or-above correctly', () => {
    const issues = [issue('error'), issue('error'), issue('warning'), issue('info')];
    expect(countIssuesAtOrAbove(issues, 'error')).toBe(2);
    expect(countIssuesAtOrAbove(issues, 'warning')).toBe(3);
    expect(countIssuesAtOrAbove(issues, 'info')).toBe(4);
    expect(countIssuesAtOrAbove(issues, 'off')).toBe(0);
    expect(countIssuesAtOrAbove([], 'error')).toBe(0);
  });

  it('countIssuesBySeverity produces the summary countsBySeverity shape', () => {
    const issues = [issue('error'), issue('warning'), issue('warning'), issue('info')];
    expect(countIssuesBySeverity(issues)).toEqual({ error: 1, warning: 2, info: 1 });
    expect(countIssuesBySeverity([])).toEqual({ error: 0, warning: 0, info: 0 });
  });

  it('EXIT contract: 0 ok / 1 issues at or above threshold / 2 config-provider error', () => {
    expect(EXIT).toEqual({ OK: 0, ISSUES: 1, CONFIG_ERROR: 2 });
  });
});
