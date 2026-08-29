import { describe, expect, it } from 'vitest';
import type { Issue } from '@lumen-seo/core';
import { applyCrawlRuleIssues } from './run.js';
import type { CrawledPage } from './crawl/crawler.js';
import type { CrawlIndex, CrawlRule } from './types.js';

const page = (url: string): CrawledPage => ({
  url,
  finalUrl: url,
  hops: 0,
  status: 200,
  timingMs: 0,
  bytes: 0,
  robotsAllowed: true,
  depth: 0,
  issues: [],
  outLinks: [],
});

const index = (): CrawlIndex => ({
  pages: [{ url: 'https://example.com/', status: 200, depth: 0, hops: 0, finalUrl: 'https://example.com/' }],
  outLinks: new Map(),
  statusOf: () => undefined,
});

const rule = (id: string, behavior: () => Issue[]): CrawlRule => ({
  id,
  severity: 'warning',
  categories: ['test'],
  checkCrawl: behavior,
});

const issueFor = (url: string): Issue => ({
  ruleId: 'r',
  severity: 'warning',
  message: 'm',
  evidence: {},
  url,
});

describe('finalize: crawl-rule issues on owning pages (I3/I14)', () => {
  it('places url-carrying issues on the owning page, drops url-less issues, keeps others untouched', () => {
    const seed = page('https://example.com/');
    const other = page('https://example.com/a');
    const throwing = rule('boom', () => {
      throw new Error('crawl rule blew up');
    });
    const placing = rule('placing', () => [issueFor('https://example.com/'), issueFor('https://example.com/a')]);
    const unattributed = rule('unattributed', () => [{ ruleId: 'u', severity: 'info', message: 'no url', evidence: {} }]);
    const ruleErrors: Record<string, number> = {};
    applyCrawlRuleIssues([seed, other], index(), [throwing, placing, unattributed], ruleErrors);
    // throwing rule isolated — counted, no fabricated issue, run continued
    expect(ruleErrors).toEqual({ boom: 1 });
    // the placing rule's issue (ruleId 'r') landed on each owning page
    expect(seed.issues.map((i) => i.ruleId)).toEqual(['r']);
    expect(other.issues.map((i) => i.ruleId)).toEqual(['r']);
    expect(seed.issues.some((i) => i.ruleId === 'u')).toBe(false);
    expect(seed.issues.some((i) => i.ruleId === 'boom')).toBe(false);
  });

  it('counts each throwing rule per invocation and preserves pre-existing ruleErrors', () => {
    const a = rule('a', () => {
      throw new Error('x');
    });
    const b = rule('b', () => {
      throw new Error('y');
    });
    const ruleErrors = { pre: 2 };
    applyCrawlRuleIssues([page('https://example.com/')], index(), [a, b], ruleErrors);
    expect(ruleErrors).toEqual({ pre: 2, a: 1, b: 1 });
  });
});
