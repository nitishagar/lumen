import { expect, it } from 'vitest';
import type {
  AuthoritySignal,
  CruxRecord,
  KeywordIdea,
  PageSpeedReport,
  ProvenanceKind,
  SerpResult,
} from '@lumen-seo/core';

/** A9 compile-time gate: the additive core payload deltas this package requires exist. */
it('core payload deltas A9 are present', () => {
  const gray: ProvenanceKind = 'gray';
  const idea: KeywordIdea = {
    term: 'x',
    source: { provider: 'google-suggest', kind: 'gray', attribution: 'a' },
    retrievedAt: '2026-08-29T00:00:00.000Z',
  };
  const s: SerpResult = {
    position: 1,
    url: 'https://x',
    title: 'x',
    source: { provider: 'ddg-serp', kind: 'gray', attribution: 'a' },
    retrievedAt: '2026-08-29T00:00:00.000Z',
    estimateLabel: 'l',
  };
  const a: AuthoritySignal = {
    domain: 'x.com',
    kind: 'rank',
    value: 7,
    provider: 'tranco',
    attribution: 't',
    retrievedAt: '2026-08-29T00:00:00.000Z',
    estimateLabel: 'l',
  };
  const report: PageSpeedReport = {
    scores: { performance: 1, seo: 1, accessibility: null, bestPractices: null },
    metrics: { lcp: 1, cls: 1, tbt: null, fcn: 1 },
    source: { provider: 'pagespeed', kind: 'lab' },
    field: { overall: 'FAST', metrics: { lcp: 1, cls: 1, tbt: null, fcn: 1 }, source: { provider: 'pagespeed', kind: 'field' } },
    retrievedAt: '2026-08-29T00:00:00.000Z',
  };
  const record: CruxRecord = {
    metrics: {},
    source: { provider: 'crux', kind: 'field', attribution: 'a' },
    retrievedAt: '2026-08-29T00:00:00.000Z',
  };
  expect([gray, idea, s, a, report, record]).toBeTruthy();
});
