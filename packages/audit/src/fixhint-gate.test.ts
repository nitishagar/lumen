/**
 * The fixHint coverage GATE (PRD E1.2 FR-4): every built-in rule's every
 * emitted issue carries a non-empty fixHint. A new rule without one fails
 * this gate the moment its issues are triggered. Page rules are driven
 * directly over a violating-page battery (both branches where they differ);
 * crawl rules run over synthetic indexes.
 */
import { describe, expect, it } from 'vitest';
import type { AuditRule, Issue } from '@lumen-seo/core';
import { makePage } from './testing/page.js';
import { createRuleSet, BUILT_IN_RULE_IDS } from './rules/rule-set.js';
import { resolveAuditConfig } from './config.js';
import type { CrawlIndex, CrawlRule, OutLink, SiteContext, SiteRule } from './types.js';

const rs = createRuleSet(resolveAuditConfig({}));

/** One violating page per concern (both branches for canonical-present). */
const BATTERY: { name: string; html: string; opts?: Parameters<typeof makePage>[1] }[] = [
  { name: 'no-title', html: '<html><head></head><body><h1>x</h1></body></html>' },
  { name: 'long-title', html: '<html><head><title>Way too long title that goes on and on past every reasonable limit set</title></head><body><h1>x</h1></body></html>' },
  { name: 'no-description', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>' },
  { name: 'long-description', html: '<html><head><title>T</title><meta name="description" content="A description that rambles far beyond the configured maximum length for meta descriptions and just keeps going and going well past one hundred sixty five characters so the rule surely fires"></head><body><h1>x</h1></body></html>' },
  { name: 'no-h1', html: '<html><head><title>T</title></head><body><p>x</p></body></html>' },
  { name: 'two-h1', html: '<html><head><title>T</title></head><body><h1>a</h1><h1>b</h1></body></html>' },
  { name: 'no-canonical', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>' },
  { name: 'two-canonicals', html: '<html><head><title>T</title><link rel="canonical" href="/a"><link rel="canonical" href="/b"></head><body><h1>x</h1></body></html>' },
  { name: 'no-lang', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>' },
  { name: 'no-viewport', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>' },
  { name: 'img-no-alt', html: '<html><head><title>T</title><meta name="viewport" content="w"></head><body><h1>x</h1><img src="/a.png"></body></html>' },
  { name: 'insecure-http', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>', opts: { url: 'http://example.com/p' } },
  { name: 'mixed-content', html: '<html><head><title>T</title></head><body><h1>x</h1><script src="http://cdn.example/x.js"></script></body></html>', opts: { url: 'https://example.com/p' } },
  { name: 'slow', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>', opts: { timingMs: 5_000 } },
  { name: 'no-og', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>' },
  { name: 'no-hreflang', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>' },
  { name: 'noindex-meta', html: '<html><head><title>T</title><meta name="robots" content="noindex"></head><body><h1>x</h1></body></html>' },
  { name: 'noindex-header', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>', opts: { headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } } },
  { name: 'status-500', html: '<html><head><title>T</title></head><body><h1>x</h1></body></html>', opts: { status: 500 } },
  { name: 'jsonld-broken', html: '<html><head><title>T</title><script type="application/ld+json">{"@type":"Product","name":"x"</script></head><body>word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word</body></html>' },
  { name: 'jsonld-missing-props', html: '<html><head><title>T</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"x"}</script></head><body></body></html>' },
  { name: 'meta-refresh', html: '<html><head><title>T</title><meta http-equiv="refresh" content="5; url=/next"></head><body>word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word</body></html>' },
  { name: 'spa-shell', html: '<html><head><title>T</title></head><body><div id="root"></div></body></html>' },
  { name: 'og-no-twitter', html: '<html><head><title>T</title><meta property="og:title" content="T"></head><body>word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word</body></html>' },
];

const pageIssues = async (): Promise<Issue[]> => {
  const out: Issue[] = [];
  for (const rule of rs.pageRules as readonly AuditRule[]) {
    for (const fixture of BATTERY) {
      const found = await rule.check(makePage(fixture.html, fixture.opts), {}); // RuleOpts: signal only
      if (Array.isArray(found)) out.push(...found);
    }
  }
  return out;
};

const crawlIndex = (): CrawlIndex => {
  const pages = [
    { url: 'https://example.com/', status: 200, depth: 0, hops: 0, finalUrl: 'https://example.com/' },
    { url: 'https://example.com/gone', status: 404, depth: 1, hops: 0, finalUrl: 'https://example.com/gone' },
    { url: 'https://example.com/dup-a', status: 200, depth: 1, hops: 2, finalUrl: 'https://example.com/final' },
    { url: 'https://example.com/dup-b', status: 200, depth: 1, hops: 0, finalUrl: 'https://example.com/dup-b' },
  ];
  const outLinks = new Map<string, readonly OutLink[]>([
    ['https://example.com/', [{ href: '/gone', url: 'https://example.com/gone', internal: true }]],
  ]);
  const statusOf = (url: string) => pages.find((p) => p.url === url);
  const bodyHashOf = (url: string) => {
    const p = pages.find((x) => x.url === url);
    return p === undefined ? undefined : { ...p, bodyHash: 'samehash' };
  };
  return { pages, outLinks, statusOf, bodyHashOf };
};

/** An integrity-crawl battery: index shapes triggering the 5 E1.6 crawl rules. */
const crawlIndexIntegrity = (): { index: CrawlIndex; o: { depth: number; isSeed: boolean; incomplete: boolean; siteEvidence: NonNullable<import('./types.js').RuleContext['siteEvidence']> } }[] => {
  const mk = (pages: Parameters<typeof buildIndex>[0], sitemapUrls: string[] = ['https://example.com/a']) => ({
    index: buildIndex(pages),
    o: { depth: 0, isSeed: true, incomplete: false, siteEvidence: { sitemapUrls, seedUrl: 'https://example.com/' } },
  });
  return [
    // canonical-target-invalid: dead same-origin target + blocked target
    mk([
      { url: 'https://example.com/', status: 200, meta: { canonicalHref: '/dead' } },
      { url: 'https://example.com/dead', status: 404 },
    ]),
    // sitemap-url-nonindexable: sitemap URL 404s
    mk([
      { url: 'https://example.com/', status: 200, meta: { canonicalHref: '/a' } },
      { url: 'https://example.com/a', status: 200 },
      { url: 'https://example.com/gone', status: 404 },
    ], ['https://example.com/gone']),
    // hreflang-reciprocity: no self-reference
    mk([
      { url: 'https://example.com/en', status: 200, meta: { hreflang: [{ lang: 'de', href: '/de' }] } },
      { url: 'https://example.com/de', status: 200, meta: { hreflang: [{ lang: 'en', href: '/en' }] } },
    ]),
    // orphan-page: sitemap URL never linked
    mk([
      { url: 'https://example.com/', status: 200 },
      { url: 'https://example.com/orphan', status: 200 },
    ], ['https://example.com/orphan']),
    // broken-external-link: outcomes ride via siteEvidence (run.ts fetches)
    {
      index: buildIndex([{ url: 'https://example.com/', status: 200 }]),
      o: {
        depth: 0,
        isSeed: true,
        incomplete: false,
        siteEvidence: {
          sitemapUrls: [],
          seedUrl: 'https://example.com/',
          externalOutcomes: [{ url: 'https://dead.example/x', pageUrl: 'https://example.com/', status: 404 }],
          externalCap: 200,
        },
      },
    },
  ];
};

// Minimal index builder for the integrity battery (CrawlIndex shape).
const buildIndex = (pages: { url: string; status: number; meta?: { noindex?: boolean; canonicalHref?: string; hreflang?: { lang: string; href: string }[] } }[]): CrawlIndex => {
  const entries = pages.map((p) => ({ url: p.url, status: p.status, depth: 0, hops: 0, finalUrl: p.url, ...(p.meta === undefined ? {} : { meta: p.meta }) }));
  const statusMap = new Map(entries.map((e) => [e.url, e]));
  return {
    pages: entries,
    outLinks: new Map(),
    statusOf: (url) => {
      const e = statusMap.get(url);
      return e === undefined ? undefined : { status: e.status, finalUrl: e.finalUrl };
    },
    bodyHashOf: () => undefined,
    metaOf: (url) => statusMap.get(url)?.meta,
  };
};

/** A site battery: evidence shapes that trigger sitemap-invalid + robots-invalid. */
const siteBattery = (): readonly { name: string; ctx: SiteContext }[] => {
  const base = {
    seed: { url: 'https://example.com/', status: 200 },
    sitemapUrls: [],
    llmsTxt: { body: null, outcome: 'skipped' as const },
    config: resolveAuditConfig({}),
  };
  return [
    {
      name: 'malformed-sitemap',
      ctx: {
        ...base,
        robots: { body: 'User-agent: *\nDisallow: /private\n', outcome: 'ok' as const },
        sitemaps: [{ url: 'https://example.com/sitemap.xml', body: '<this is not xml', outcome: 'malformed' as const }],
      },
    },
    {
      name: 'unknown-directive',
      ctx: {
        ...base,
        robots: { body: 'User-agent: *\nFoo: bar\n', outcome: 'ok' as const },
        sitemaps: [{ url: 'https://example.com/sitemap.xml', body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc></url></urlset>', outcome: 'ok' as const }],
      },
    },
    {
      name: 'bypassed-robots',
      ctx: { ...base, robots: { body: null, outcome: 'bypassed' as const }, sitemaps: [] },
    },
  ];
};

describe('fixHint coverage gate (PRD E1.2 FR-4 — registry-wide)', () => {
  it('every built-in rule emits at least one issue across the battery', async () => {
    const issues = await pageIssues();
    const crawlIssues = (rs.crawlRules as readonly CrawlRule[]).flatMap((r) =>
      r.checkCrawl(crawlIndex(), { depth: 1, isSeed: false }),
    );
    const siteIssues = (rs.siteRules as readonly SiteRule[]).flatMap((r) =>
      siteBattery().map(({ ctx }) => r.checkSite(ctx)),
    ).flat();
    const integrityCrawlIssues = crawlIndexIntegrity().flatMap((ctx) =>
      (rs.crawlRules as readonly CrawlRule[]).map((r) => r.checkCrawl(ctx.index, ctx.o)),
    ).flat();
    const seen = new Set([...issues, ...crawlIssues, ...siteIssues, ...integrityCrawlIssues].map((i) => i.ruleId));
    const missing = BUILT_IN_RULE_IDS.filter((id) => !seen.has(id));
    expect(missing, `rules never triggered by the gate battery (extend the battery): ${missing.join(', ')}`).toEqual([]);
  });

  it('every emitted issue carries a non-empty fixHint', async () => {
    const issues = await pageIssues();
    const crawlIssues = (rs.crawlRules as readonly CrawlRule[]).flatMap((r) =>
      r.checkCrawl(crawlIndex(), { depth: 1, isSeed: false }),
    );
    const siteIssues = (rs.siteRules as readonly SiteRule[]).flatMap((r) =>
      siteBattery().map(({ ctx }) => r.checkSite(ctx)),
    ).flat();
    const integrityCrawlIssues = crawlIndexIntegrity().flatMap((ctx) =>
      (rs.crawlRules as readonly CrawlRule[]).map((r) => r.checkCrawl(ctx.index, ctx.o)),
    ).flat();
    expect(issues.length + crawlIssues.length + siteIssues.length + integrityCrawlIssues.length).toBeGreaterThan(20);
    for (const i of [...issues, ...crawlIssues, ...siteIssues, ...integrityCrawlIssues]) {
      expect(typeof i.fixHint, `${i.ruleId} emitted an issue without a fixHint`).toBe('string');
      expect((i.fixHint ?? '').trim().length, `${i.ruleId} fixHint is empty`).toBeGreaterThan(0);
    }
  });
});
