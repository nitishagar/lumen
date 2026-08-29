import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CheerioAPI } from 'cheerio';
import type {
  AuthorityProvider,
  AuthorityOpts,
  AuthoritySignal,
  CruxProvider,
  CruxRecord,
  HistogramBin,
  IdeasOpts,
  KeywordProvider,
  KeywordIdea,
  PageSpeedProvider,
  PageSpeedReport,
  SearchOpts,
  SerpProvider,
  SerpResult,
} from './index.js';
import type {
  Issue,
  PageContext,
  PageReport,
  SiteAuditReport,
} from './index.js';
import type { CrawlBudgets } from './index.js';
import type {
  HistoryListQuery,
  HistoryStore,
  Metric,
  Provenance,
  ProvenanceKind,
  RankHistoryEntry,
} from './index.js';
import type { AuditRule, RuleOpts } from './index.js';
import type { Severity } from './index.js';
import {
  DEFAULT_BUDGETS,
  mkMetric,
  mkSource,
} from './index.js';

const hasExactly = (obj: object, keys: readonly string[]): void => {
  expect(Object.keys(obj).sort(), JSON.stringify(obj)).toEqual([...keys].sort());
};

/** Required-only fixtures: assert the ARCHITECTURE-required field NAMES exactly (SC-9). */
describe('payload model contracts (SC-9)', () => {
  it('KeywordIdea carries exactly {term, source, estimateLabel?, lang?}', () => {
    const source = mkSource('google-suggest', 'heuristic');
    const minimal: KeywordIdea = { term: 'seo toolkit', source };
    hasExactly(minimal, ['term', 'source']);
    const full: KeywordIdea = {
      term: 'seo toolkit',
      source,
      estimateLabel: 'low',
      lang: 'en',
    };
    hasExactly(full, ['term', 'source', 'estimateLabel', 'lang']);
  });

  it('SerpResult carries exactly {position, url, title, snippet?}', () => {
    const minimal: SerpResult = {
      position: 1,
      url: 'https://example.com/a',
      title: 'A',
    };
    hasExactly(minimal, ['position', 'url', 'title']);
    const full: SerpResult = { ...minimal, snippet: 'snip' };
    hasExactly(full, ['position', 'url', 'title', 'snippet']);
  });

  it('PageSpeedReport carries exactly {scores, metrics, source}', () => {
    const report: PageSpeedReport = {
      scores: {
        performance: 92,
        seo: 100,
        accessibility: null, // honesty: category not computable is null, never 0
        bestPractices: 87,
      },
      metrics: { lcp: 2100, cls: 0.05, tbt: null, fcn: 900 },
      source: mkSource('pagespeed', 'official'),
    };
    hasExactly(report, ['scores', 'metrics', 'source']);
    hasExactly(report.scores, ['performance', 'seo', 'accessibility', 'bestPractices']);
    hasExactly(report.metrics, ['lcp', 'cls', 'tbt', 'fcn']);
    expectTypeOf<PageSpeedReport['scores']['performance']>().toEqualTypeOf<number | null>();
    expectTypeOf<PageSpeedReport['metrics']['lcp']>().toEqualTypeOf<number | null>();
  });

  it('CruxRecord carries exactly {metrics: Record<name, {p75, histogramBins}>, source}', () => {
    const bins: HistogramBin[] = [
      { start: 0, end: 2500, density: 0.71 },
      { start: 2500, density: 0.29 }, // last bin is open-ended: end omitted
    ];
    const record: CruxRecord = {
      metrics: {
        largest_contentful_paint: { p75: 2312, histogramBins: bins },
        cumulative_layout_shift: { p75: null, histogramBins: bins },
      },
      source: mkSource('crux', 'field'),
    };
    hasExactly(record, ['metrics', 'source']);
    hasExactly(record.metrics['largest_contentful_paint']!, ['p75', 'histogramBins']);
    hasExactly(bins[0]!, ['start', 'end', 'density']);
    expectTypeOf<CruxRecord['metrics'][string]['p75']>().toEqualTypeOf<number | null>();
  });

  it('AuthoritySignal carries exactly {domain, kind, value, provider, attribution}', () => {
    const rank: AuthoritySignal = {
      domain: 'example.com',
      kind: 'rank',
      value: 42,
      provider: 'tranco',
      attribution: 'Tranco list, https://tranco-list.eu',
    };
    hasExactly(rank, ['domain', 'kind', 'value', 'provider', 'attribution']);
    expectTypeOf<AuthoritySignal['kind']>().toEqualTypeOf<'rank' | 'score'>();
  });

  it('PageContext carries exactly {url, status, headers, dom, bytes, timingMs, robotsAllowed}', () => {
    const dom = (() => 'fixture-cheerio-api') as unknown as CheerioAPI; // type-only dep (BA-12)
    const ctx: PageContext = {
      url: new URL('https://example.com/page'),
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      dom,
      bytes: 1234,
      timingMs: 45,
      robotsAllowed: true,
    };
    hasExactly(ctx, ['url', 'status', 'headers', 'dom', 'bytes', 'timingMs', 'robotsAllowed']);
    expectTypeOf<PageContext['dom']>().toEqualTypeOf<CheerioAPI>();
  });

  it('Issue carries exactly {ruleId, severity, message, evidence, fixHint?, url?}', () => {
    const minimal: Issue = {
      ruleId: 'title-missing',
      severity: 'error',
      message: 'page has no <title>',
      evidence: {},
    };
    hasExactly(minimal, ['ruleId', 'severity', 'message', 'evidence']);
    const full: Issue = {
      ...minimal,
      evidence: { selector: 'head > title', snippet: '<title></title>' },
      fixHint: 'add a descriptive title',
      url: 'https://example.com/page', // additive (audit-engine A12)
    };
    hasExactly(full, ['ruleId', 'severity', 'message', 'evidence', 'fixHint', 'url']);
    expectTypeOf<Issue['severity']>().toEqualTypeOf<Severity>();
  });

  it('PageReport carries the P1-defined shape plus audit additive optional fields', () => {
    const minimal: PageReport = {
      url: 'https://example.com/page',
      status: 200,
      title: 'Page',
      issues: [],
      score: null, // honesty: not computable is null, never 0
      timingMs: 45,
      bytes: 1234,
      robotsAllowed: true,
    };
    hasExactly(minimal, ['url', 'status', 'title', 'issues', 'score', 'timingMs', 'bytes', 'robotsAllowed']);
    const skipped: PageReport = {
      url: 'https://example.com/private',
      status: null,
      issues: [],
      score: null,
      timingMs: null,
      bytes: null,
      robotsAllowed: false,
      depth: 1,
      skipped: { reason: 'robots_disallowed' }, // object form, never a bare string (A4/A12)
      redirectChain: ['https://example.com/a', 'https://example.com/b'],
    };
    hasExactly(skipped, [
      'url', 'status', 'issues', 'score', 'timingMs', 'bytes', 'robotsAllowed',
      'depth', 'skipped', 'redirectChain',
    ]);
    expectTypeOf<PageReport['score']>().toEqualTypeOf<number | null>();
    expectTypeOf<PageReport['status']>().toEqualTypeOf<number | null>();
    expectTypeOf<NonNullable<PageReport['skipped']>['reason']>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<PageReport['metrics']>>().toEqualTypeOf<Record<string, Metric<number>>>();
  });

  it('SiteAuditReport carries required fields plus additive stopReason / summary extras', () => {
    const report: SiteAuditReport = {
      id: '20260829-example-com-abc12345',
      startedAt: '2026-08-29T10:00:00.000Z',
      completedAt: '2026-08-29T10:00:31.250Z',
      pages: [],
      summary: {
        countsBySeverity: { error: 0, warning: 2, info: 1 },
        score: 91,
      },
      incomplete: false,
      configSnapshot: { failThreshold: 'error' },
    };
    hasExactly(report, ['id', 'startedAt', 'completedAt', 'pages', 'summary', 'incomplete', 'configSnapshot']);
    hasExactly(report.summary, ['countsBySeverity', 'score']);
    expectTypeOf<SiteAuditReport['summary']['score']>().toEqualTypeOf<number | null>();
    expectTypeOf<SiteAuditReport['summary']['countsBySeverity']>().toEqualTypeOf<Record<Severity, number>>();

    const partial: SiteAuditReport = {
      ...report,
      stopReason: 'time_budget',
      incomplete: true,
      summary: {
        countsBySeverity: { error: 0, warning: 0, info: 0 },
        score: null,
        pagesAudited: 3,
        pagesSkipped: 1,
        byRule: { 'title-missing': 2 },
        ruleErrors: { 'broken-internal-link': 1 },
      },
    };
    expect(partial.stopReason).toBe('time_budget');
    expectTypeOf<SiteAuditReport['stopReason']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SiteAuditReport['summary']['ruleErrors']>().toEqualTypeOf<Record<string, number> | undefined>();
  });
});

describe('provenance + Metric wrapper (I3 / SC-17)', () => {
  it('ProvenanceKind is the closed ARCHITECTURE enum', () => {
    const kinds: readonly ProvenanceKind[] = ['official', 'community', 'heuristic', 'lab', 'field'];
    expect(kinds).toHaveLength(5);
    // every kind round-trips through mkSource untouched
    for (const kind of kinds) {
      expect(mkSource('p', kind).kind).toBe(kind);
    }
  });

  it('mkSource omits attribution when not given and keeps it when given', () => {
    expect(mkSource('tranco', 'community')).toEqual({ provider: 'tranco', kind: 'community' });
    expect(mkSource('tranco', 'community', 'Tranco list')).toEqual({
      provider: 'tranco',
      kind: 'community',
      attribution: 'Tranco list',
    });
  });

  it('mkMetric stamps the injected retrievedAt and preserves value/source — deterministic (SC-17)', () => {
    const source: Provenance = mkSource('crux', 'field');
    const at = '2026-08-29T12:00:00.000Z';
    const a = mkMetric(2312, source, at);
    const b = mkMetric(2312, mkSource('crux', 'field'), at);
    expect(a).toEqual(b); // identical outputs across runs — no hidden clock
    expect(a).not.toBe(b); // fresh wrapper each call
    expect(a).toEqual({ value: 2312, source: { provider: 'crux', kind: 'field' }, retrievedAt: at });
    hasExactly(a, ['value', 'source', 'retrievedAt']);
    expectTypeOf<Metric<number>['retrievedAt']>().toEqualTypeOf<string>();
  });
});

describe('crawl budgets (I14 / R3)', () => {
  it('DEFAULT_BUDGETS matches RECONCILIATION R3 exactly', () => {
    expect(DEFAULT_BUDGETS).toEqual({
      maxPages: 100,
      maxDepth: 5,
      maxDurationMs: 300_000,
      maxConcurrency: 5,
      perHostMinDelayMs: 250,
    });
    expectTypeOf<CrawlBudgets>().not.toBeNever();
  });
});

describe('provider SPI (locked signatures, SC-6)', () => {
  it('all five interfaces typecheck against minimal fixtures with signal-bearing opts', () => {
    const keywords: KeywordProvider = {
      name: 'fixture-keywords',
      ideas: async (_seed: string, o: IdeasOpts) => {
        expectTypeOf<IdeasOpts['signal']>().toEqualTypeOf<AbortSignal | undefined>();
        void o.signal;
        return [];
      },
    };
    const serp: SerpProvider = {
      name: 'fixture-serp',
      search: async (q: string, o: SearchOpts) => {
        expectTypeOf<SearchOpts['signal']>().toEqualTypeOf<AbortSignal | undefined>();
        void q;
        void o.signal;
        return [];
      },
    };
    const pagespeed: PageSpeedProvider = {
      name: 'fixture-pagespeed',
      report: async (_url: URL) => ({
        scores: { performance: null, seo: null, accessibility: null, bestPractices: null },
        metrics: { lcp: null, cls: null, tbt: null, fcn: null },
        source: mkSource('fixture-pagespeed', 'official'),
      }),
      // url param must be a URL per the locked signature
    } satisfies PageSpeedProvider;
    const crux: CruxProvider = {
      name: 'fixture-crux',
      record: async (_url: URL, _o: object) => null, // nullable when not configured (I3)
    };
    const authority: AuthorityProvider = {
      name: 'fixture-authority',
      authority: async (_domain: string, _o: AuthorityOpts) => [],
    };
    for (const p of [keywords, serp, pagespeed, crux, authority]) {
      expect(typeof p.name).toBe('string');
    }
    expectTypeOf<CruxProvider['record']>().returns.toEqualTypeOf<Promise<CruxRecord | null>>();
    expectTypeOf<PageSpeedProvider['report']>().parameter(0).toEqualTypeOf<URL>();
    void pagespeed;
  });
});

describe('AuditRule SPI (SC-7)', () => {
  it('typechecks the locked shape and supports sync + async check', () => {
    const rule: AuditRule = {
      id: 'fixture-rule',
      severity: 'info',
      categories: ['seo'],
      check: (page: PageContext, o: RuleOpts) => {
        expectTypeOf<PageContext>().toMatchTypeOf<object>();
        expectTypeOf<RuleOpts['signal']>().toEqualTypeOf<AbortSignal | undefined>();
        void o.signal;
        void page;
        return [];
      },
    };
    const asyncRule: AuditRule = {
      id: 'fixture-async-rule',
      severity: 'warning',
      categories: ['a11y'],
      check: async () => [],
    };
    expect(rule.check).toBeTypeOf('function');
    expect(asyncRule.check).toBeTypeOf('function');
  });
});

describe('HistoryStore interface (SC-15)', () => {
  it('an in-memory fixture satisfies the interface and preserves position: null', async () => {
    const store: HistoryStore = new (class implements HistoryStore {
      #rows: RankHistoryEntry[] = [];
      async append(e: RankHistoryEntry): Promise<void> {
        this.#rows.push(e);
      }
      async list(q?: HistoryListQuery): Promise<RankHistoryEntry[]> {
        let rows = [...this.#rows];
        if (q?.keyword !== undefined) rows = rows.filter((r) => r.keyword === q.keyword);
        if (q?.domain !== undefined) rows = rows.filter((r) => r.domain === q.domain);
        if (q?.limit !== undefined) rows = rows.slice(0, q.limit);
        return rows;
      }
    })();

    const notFound: RankHistoryEntry = {
      keyword: 'seo toolkit',
      domain: 'example.com',
      position: null, // never zero-filled (I3)
      provider: 'ddg-serp',
      retrievedAt: '2026-08-29T12:00:00.000Z',
    };
    const found: RankHistoryEntry = {
      keyword: 'seo toolkit',
      domain: 'example.com',
      position: 3,
      provider: 'ddg-serp',
      url: 'https://example.com/',
      retrievedAt: '2026-08-29T12:00:00.000Z',
    };
    await store.append(notFound);
    await store.append(found);

    const all = await store.list();
    expect(all.map((r) => r.position)).toEqual([null, 3]); // null preserved, not 0
    expect(await store.list({ keyword: 'seo toolkit', domain: 'example.com', limit: 1 })).toHaveLength(1);
    hasExactly(notFound, ['keyword', 'domain', 'position', 'provider', 'retrievedAt']);
  });
});
