import { describe, expect, it } from 'vitest';
import type { Issue, PageReport } from '@lumen-seo/core';
import { scorePage, scoreReport } from './score.js';

const issue = (severity: Issue['severity']): Issue => ({
  ruleId: `rule-${severity}`,
  severity,
  message: 'm',
  evidence: {},
});

const page = (issues: Issue[], skipped?: { reason: string }): PageReport => ({
  url: 'https://example.com/',
  status: 200,
  issues,
  score: null,
  timingMs: 0,
  bytes: 0,
  robotsAllowed: true,
  ...(skipped !== undefined ? { skipped } : {}),
});

describe('scorer (A7/I3)', () => {
  it('score: bounds 0-100 and monotone (adding issues never raises score)', () => {
    expect(scorePage([])).toBe(100);
    expect(scorePage([issue('error')])).toBe(90);
    expect(scorePage([issue('warning')])).toBe(97);
    expect(scorePage([issue('info')])).toBe(100); // info weighs 0
    // floor: 10+ errors cannot go below 0
    expect(scorePage(Array.from({ length: 20 }, () => issue('error')))).toBe(0);
    // monotone: appending issues never raises the score (page and report level)
    const base = [issue('error'), issue('warning')];
    expect(scorePage(base)).toBeGreaterThanOrEqual(scorePage([...base, issue('error')]));
    expect(scorePage(base)).toBeGreaterThanOrEqual(scorePage([...base, issue('warning')]));
    const pages = [page(base), page([issue('warning')])];
    expect(scoreReport(pages)).toBeGreaterThanOrEqual(scoreReport([...pages, page([issue('error'), issue('error')])]));
  });

  it('score: no issues -> 100; zero audited pages -> 0 (never zero-filled as clean)', () => {
    expect(scorePage([])).toBe(100);
    expect(scoreReport([page([])])).toBe(100);
    expect(scoreReport([])).toBe(0);
    expect(scoreReport([page([], { reason: 'non_html' }), page([], { reason: 'robots_disallowed' })])).toBe(0);
    // skipped pages contribute neither score nor denominator
    expect(scoreReport([page([]), page([], { reason: 'oversized' })])).toBe(100);
  });
});
