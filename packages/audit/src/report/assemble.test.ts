import { describe, expect, it } from 'vitest';
import { runSiteAudit } from '../run.js';
import { FakeFetcher } from '../testing/fake-fetcher.js';
import type { FakeRoute } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';
const SITEMAP = 'https://example.com/sitemap.xml';

const html = (body: string, head = '<title>Ample page title length</title>'): string =>
  `<!doctype html><html lang="en"><head>${head}<meta name="description" content="An adequately long meta description for the page."></head><body>${body}</body></html>`;

const routes = (): Record<string, FakeRoute> => ({
  [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\n` },
  [SITEMAP]: {
    status: 200,
    contentType: 'application/xml',
    body:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      ['about', 'blog', 'contact'].map((p) => `<url><loc>${ORIGIN}/${p}</loc></url>`).join('') +
      '</urlset>',
  },
  [`${ORIGIN}/`]: {
    status: 200,
    contentType: 'text/html',
    body: html('<a href="/about">about</a><a href="/missing">missing</a><img src="/hero.png">'),
  },
  [`${ORIGIN}/about`]: { status: 200, contentType: 'text/html', body: html('<h1>About</h1>') },
  [`${ORIGIN}/blog`]: {
    status: 200,
    contentType: 'text/html',
    // redirected page: the core fetcher reports the final URL
    body: html('<h1>Blog</h1>', '<title>Ample page title length</title>'),
    finalUrl: `${ORIGIN}/blog-final`,
  },
  [`${ORIGIN}/contact`]: { status: 200, contentType: 'text/html', body: html('') },
  [`${ORIGIN}/missing`]: { status: 404, contentType: 'text/html', body: html('') },
});

describe('report assembly (I3/I13/A6)', () => {
  it('report: summary counts match pages and byRule totals', async () => {
    const fetcher = new FakeFetcher(routes());
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const counts = { error: 0, warning: 0, info: 0 };
    const byRule: Record<string, number> = {};
    for (const page of report.pages) {
      for (const issue of page.issues) {
        counts[issue.severity] += 1;
        byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1;
      }
    }
    expect(report.summary.countsBySeverity).toEqual(counts);
    expect(report.summary.byRule).toEqual(byRule);
    expect(Object.keys(report.summary.byRule ?? {}).length).toBeGreaterThan(0);
    const audited = report.pages.filter((p) => p.skipped === undefined);
    expect(report.summary.pagesAudited).toBe(audited.length);
    expect(report.summary.pagesSkipped).toBe(report.pages.length - audited.length);
  });

  it('report: configSnapshot contains no env values and carries the resolved config + renderer honesty label', async () => {
    const fetcher = new FakeFetcher(routes());
    const report = await runSiteAudit(
      new URL(ORIGIN),
      { respectRobots: true, crawl: { maxPages: 7 }, severityOverrides: { 'og-tags-missing': 'warning' } },
      makeTestDeps(fetcher),
    );
    const snap = report.configSnapshot;
    expect(snap.renderer).toBe('static');
    expect(snap.respectRobots).toBe(true);
    expect((snap.crawl as { maxPages: number }).maxPages).toBe(7);
    expect((snap.rules as Record<string, string>)['og-tags-missing']).toBe('warning'); // effective severities
    // no env var VALUE may leak into the snapshot (BYOK carries names only)
    const secret = 'super-secret-env-value-42';
    process.env.LUMEN_AUDIT_TEST_SECRET = secret;
    try {
      const snapText = JSON.stringify(snap);
      expect(snapText).not.toContain(secret);
      expect(snapText).not.toMatch(/LUMEN_AUDIT_TEST_SECRET/);
    } finally {
      delete process.env.LUMEN_AUDIT_TEST_SECRET;
    }
  });

  it('report: messages/snippets contain no C0/C1 control characters and respect length caps', async () => {
    const hostileTitle = `Bad\u0000Title\u0001${'t'.repeat(400)}`;
    const hostile = routes();
    hostile[`${ORIGIN}/contact`] = {
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>${hostileTitle}</title></head><body></body></html>`,
    };
    const fetcher = new FakeFetcher(hostile);
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    // eslint-disable-next-line no-control-regex -- asserting the ABSENCE of control chars requires matching them
    const dirty = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
    for (const page of report.pages) {
      if (page.title !== undefined) {
        expect(dirty.test(page.title)).toBe(false);
        expect([...page.title].length).toBeLessThanOrEqual(300);
      }
      for (const issue of page.issues) {
        expect(dirty.test(issue.message)).toBe(false);
        expect([...issue.message].length).toBeLessThanOrEqual(300);
        if (issue.evidence.selector !== undefined) expect(dirty.test(issue.evidence.selector)).toBe(false);
        if (issue.evidence.snippet !== undefined) {
          expect(dirty.test(issue.evidence.snippet)).toBe(false);
          expect([...issue.evidence.snippet].length).toBeLessThanOrEqual(300);
        }
        if (issue.fixHint !== undefined) expect(dirty.test(issue.fixHint)).toBe(false);
      }
    }
    const contact = report.pages.find((p) => p.url === `${ORIGIN}/contact`);
    // the HTML parser normalizes NUL to U+FFFD at parse time (spec behavior);
    // the sanitizer guarantees nothing RAW survives into storage either way
    expect(contact?.title?.startsWith('Bad')).toBe(true);
    expect(contact?.title?.includes('\uFFFD') ?? false).toBe(true);
  });

  it('report: id is path-safe end-to-end even with hostile deps.randomId and an IDN seed', async () => {
    const fetcher = new FakeFetcher(routes());
    const deps = { ...makeTestDeps(fetcher), randomId: () => '../evil' };
    const report = await runSiteAudit(new URL('https://Bücher.example'), {}, deps);
    expect(report.id).toMatch(/^audit-[a-z0-9.-]+-\d{8}T\d{6}Z-\.\.-evil$/);
    // injected clock starts at 0 -> 1970-01-01T00:00:00.000Z stamp; host punycoded
    expect(report.id).toBe('audit-xn--bcher-kva.example-19700101T000000Z-..-evil');
  });

  it('report: repeated identical runs produce byte-identical JSON (injected clock/jitter/randomId)', async () => {
    const run = async (): Promise<string> => {
      const fetcher = new FakeFetcher(routes());
      const report = await runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 2 } }, makeTestDeps(fetcher));
      return JSON.stringify(report);
    };
    expect(await run()).toBe(await run());
  });

  // edge-map #44 (issue placement) is covered by
  // "rules: crawl-rule issues land on owning pages with url set" in rule-set.test.ts
});
