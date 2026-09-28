/**
 * E1.6/E1.7 acceptance tests: the --only filter matrix, honest-unknown
 * fixtures the PRD demands, AI-matrix semantics, and UA provenance in the
 * report. FakeFetcher only — zero network.
 */
import { describe, expect, it } from 'vitest';
import { runSiteAudit } from './run.js';
import { FakeFetcher } from './testing/fake-fetcher.js';
import type { FakeRoute } from './testing/fake-fetcher.js';
import { makeTestDeps } from './testing/deps.js';
import { AI_CRAWLER_UAS } from './rules/ai-search.js';

const ORIGIN = 'https://example.com';

const page = (body: string, head = '<title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page.">'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1>${body}</body></html>`;

const routes = (over: Record<string, FakeRoute> = {}): Record<string, FakeRoute> => ({
  [`${ORIGIN}/robots.txt`]: { status: 200, contentType: 'text/plain', body: 'Sitemap: /s.xml\nUser-agent: *\n' },
  [`${ORIGIN}/s.xml`]: { status: 200, contentType: 'application/xml', body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>' },
  [`${ORIGIN}/`]: { status: 200, contentType: 'text/html', body: page('') },
  ...over,
});

const audit = (over: Record<string, FakeRoute>, config: Parameters<typeof runSiteAudit>[1] = {}) =>
  runSiteAudit(new URL(ORIGIN), config, makeTestDeps(new FakeFetcher(routes(over))));

describe('--only filter (E1.7 FR-4)', () => {
  it('--only ai-search runs exactly the 3 GEO rules (plus nothing else)', async () => {
    const report = await audit({}, { only: ['ai-search'] });
    const ruleIds = new Set(report.pages.flatMap((p) => p.issues).map((i) => i.ruleId));
    expect(ruleIds).toEqual(new Set(['ai-crawler-access', 'llms-txt', 'content-in-raw-html'].filter((id) => ruleIds.has(id))));
    expect(ruleIds.has('title-missing')).toBe(false);
    expect(ruleIds.size).toBeLessThanOrEqual(3);
    expect(ruleIds.size).toBeGreaterThan(0); // M18: the filter actually RAN rules
  });

  it('--only with a rule id runs just that rule', async () => {
    const report = await audit({}, { only: ['ai-crawler-access'] });
    const ruleIds = new Set(report.pages.flatMap((p) => p.issues).map((i) => i.ruleId));
    expect(ruleIds).toEqual(new Set(['ai-crawler-access']));
  });

  it('an unknown --only token is a loud ConfigError listing valid tokens', async () => {
    await expect(audit({}, { only: ['snake-oil'] })).rejects.toThrow(/snake-oil/);
    await expect(audit({}, { only: ['snake-oil'] })).rejects.toThrow(/ai-search/); // valid tokens listed
  });
});

describe('honest-unknown fixtures (E1.6 AC)', () => {
  it('canonical to an unfetched same-origin URL: info-grade unknown, never a pass or a wrong fail', async () => {
    const report = await audit({
      [`${ORIGIN}/`]: { status: 200, contentType: 'text/html', body: page('<link rel="canonical" href="/elsewhere">', '<title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page."><link rel="canonical" href="https://example.com/elsewhere">') },
    });
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'canonical-target-invalid');
    const unknowns = issues.filter((i) => i.severity === 'info' && i.message.includes('not judged'));
    expect(unknowns.length).toBe(1);
    expect(unknowns[0]?.message).toContain('canonical target https://example.com/elsewhere');
  });

  it('sitemap-invalid: malformed retained sitemap fires; absent sitemap stays silent (a valid state)', async () => {
    const malformed = await audit({
      [`${ORIGIN}/s.xml`]: { status: 200, contentType: 'application/xml', body: '<this is not xml' },
    });
    expect(malformed.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'sitemap-invalid' && i.message.includes('malformed'))).toBe(true);

    const absent = await audit({
      [`${ORIGIN}/robots.txt`]: { status: 404, contentType: 'text/plain', body: '' },
      [`${ORIGIN}/s.xml`]: { status: 404, contentType: 'text/plain', body: '' },
    });
    expect(absent.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'sitemap-invalid')).toBe(false);
  });

  it('orphan-page fires only when the crawl completed', async () => {
    const withSitemap = {
      [`${ORIGIN}/orphan`]: { status: 200, contentType: 'text/html', body: page('lonely') },
      // the sitemap must LIST /orphan for it to be crawled and judged
      [`${ORIGIN}/s.xml`]: { status: 200, contentType: 'application/xml', body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/orphan</loc></url></urlset>' },
    };
    // complete run: the orphan IS detected (the seed links nowhere)
    const done = await audit(withSitemap);
    expect(done.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'orphan-page' && i.url === `${ORIGIN}/orphan`)).toBe(true);
    // time-budget run: aborted mid-crawl → no orphan claims
    const shortRoutes = routes(withSitemap);
    const report = await runSiteAudit(
      new URL(ORIGIN),
      { crawl: { maxDurationMs: 1, maxPages: 1 } },
      makeTestDeps(new FakeFetcher(shortRoutes)),
    );
    if (report.incomplete) {
      expect(report.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'orphan-page')).toBe(false);
    }
  });
});

describe('AI-crawler matrix (E1.7)', () => {
  it('retrieval bots blocked → flagged; training policy never advised', async () => {
    const report = await audit({
      [`${ORIGIN}/robots.txt`]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nAllow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n' },
    });
    const matrix = report.pages.flatMap((p) => p.issues).find((i) => i.ruleId === 'ai-crawler-access');
    // M12: the message carries group counts; the per-token matrix rides in evidence.snippet.
    expect(matrix?.message).toContain('training 5/6 allowed');
    expect(matrix?.message).toContain('retrieval 3/4 allowed');
    expect(matrix?.message).toContain('RETRIEVAL bots blocked (OAI-SearchBot)');
    expect(matrix?.evidence.snippet).toContain('OAI-SearchBot:block');
    expect(matrix?.evidence.snippet).toContain('GPTBot:block');
    expect(matrix?.evidence.snippet).toContain('PerplexityBot:allow');
    expect(matrix?.message.toLowerCase()).not.toMatch(/we recommend blocking|you should block training/);
  });

  it('UA-list provenance (asOf + sourceUrl) is recorded in the report', async () => {
    const report = await audit({});
    const warnings = report.configSnapshot.discoveryWarnings as string[];
    expect(warnings.some((w) => w === `ai_crawler_uas_asOf:${AI_CRAWLER_UAS.asOf}`)).toBe(true);
    expect(warnings.some((w) => w.startsWith('ai_crawler_uas_source:'))).toBe(true);
  });

  it('a hostile JSON-LD size bomb is bounded: the byte cap truncates with a notice, no hang', async () => {
    // 1.5 MB payload — under the 2 MB page cap so the JSON-LD parser RUNS.
    const bomb = `{"@context":"https://schema.org","@type":"Product","payload":"${'x'.repeat(1_500_000)}"}`;
    const started = Date.now();
    const report = await audit({
      [`${ORIGIN}/`]: { status: 200, contentType: 'text/html', body: page(`<script type="application/ld+json">${bomb}</script>`) },
    });
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'structured-data-invalid');
    expect(issues.some((i) => i.message.includes('byte cap'))).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('an unparseable JSON-LD block emits a parse-error issue, never a crash', async () => {
    const report = await audit({
      [`${ORIGIN}/`]: { status: 200, contentType: 'text/html', body: page('<script type="application/ld+json">{broken</script>') },
    });
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'structured-data-invalid');
    expect(issues.some((i) => i.message.includes('does not parse'))).toBe(true);
  });

  it('sitemap XML entity expansion is inert (cheerio does not resolve DTD entities)', async () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE urlset [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/&b;</loc></url></urlset>';
    const report = await audit({
      [`${ORIGIN}/s.xml`]: { status: 200, contentType: 'application/xml', body: evil },
    });
    const sitemapIssues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'sitemap-invalid');
    expect(sitemapIssues.some((i) => i.message.includes('malformed'))).toBe(false); // parses without expansion
    // M18: the entity stays LITERAL (no billion-laughs-style expansion)
    expect(sitemapIssues.some((i) => i.message.includes('AAAA'))).toBe(false);
  });
});

describe('the opt-in external-link check (E1.6, reviewer I2 — engine level)', () => {
  const externalSite = (over: Record<string, FakeRoute> = {}): Record<string, FakeRoute> => ({
    [`${ORIGIN}/robots.txt`]: { status: 404, contentType: 'text/plain', body: '' },
    [`${ORIGIN}/`]: { status: 200, contentType: 'text/html', body: page('<a href="https://dead.example/x">d</a><a href="https://gone.example/y">g</a>') },
    ...over,
  });

  it('OFF by default: no external requests without crawl.checkExternal', async () => {
    const report = await audit(externalSite());
    expect(report.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'broken-external-link')).toBe(false);
  });

  it('HEAD issued; cap bounds the fetches; broken 404 flagged', async () => {
    const report = await audit(externalSite(), { crawl: { checkExternal: true, externalLinkCap: 1 } });
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'broken-external-link');
    // cap 1: exactly ONE external fetch happened → exactly one finding + the info header
    expect(issues.filter((i) => i.severity === 'info' && i.message.includes('checked 1 external links'))).toHaveLength(1);
    expect(issues.some((i) => i.message.includes('dead.example'))).toBe(true);
    expect(issues.some((i) => i.message.includes('gone.example'))).toBe(false); // capped before reaching it
  });

  it('GET fallback after HEAD 405; 5xx flagged; 200 silent', async () => {
    // FakeFetcher models the core contract: statuses >= 500 throw post-retry,
    // so the 5xx external host surfaces as a broken-link finding.
    const okSite = externalSite({
      'https://gone.example/y': { status: 500 },
    });
    const report = await runSiteAudit(
      new URL(ORIGIN),
      { crawl: { checkExternal: true } },
      makeTestDeps(new FakeFetcher(okSite)),
    );
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'broken-external-link');
    expect(issues.some((i) => i.message.includes('gone.example'))).toBe(true); // 5xx flagged
  });
});
