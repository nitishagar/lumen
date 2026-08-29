import { describe, expect, it } from 'vitest';
import { runSiteAudit } from './run.js';
import { FakeFetcher } from './testing/fake-fetcher.js';
import type { FakeRoute } from './testing/fake-fetcher.js';
import { makeTestDeps } from './testing/deps.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';
const SITEMAP = 'https://example.com/s.xml';

const html = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page."></head><body>${body}</body></html>`;

const fivePageSite = (): Record<string, FakeRoute> => ({
  [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\nUser-agent: *\nDisallow: /private\n` },
  [SITEMAP]: {
    status: 200,
    contentType: 'application/xml',
    body:
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      ['about', 'blog', 'contact', 'policies'].map((p) => `<url><loc>${ORIGIN}/${p}</loc></url>`).join('') +
      '</urlset>',
  },
  [`${ORIGIN}/`]: {
    status: 200,
    contentType: 'text/html',
    body: html('<h1>Home</h1><a href="/about">about</a><a href="/blog">blog</a><a href="/private">secret</a>'),
  },
  [`${ORIGIN}/about`]: { status: 200, contentType: 'text/html', body: html('<h1>About</h1><img src="/logo.png" alt="logo">') },
  [`${ORIGIN}/blog`]: { status: 200, contentType: 'text/html', body: html('<h1>Blog</h1><h1>Second</h1>') },
  [`${ORIGIN}/contact`]: { status: 200, contentType: 'text/html', body: html('') },
  // passStatus: a 500 that REACHED the auditor (core's fetcher throws the
  // post-retry terminal outcome for 5xx; passStatus models a non-retrying
  // transport so the status-error rule sees the response)
  [`${ORIGIN}/policies`]: { status: 500, contentType: 'text/html', body: html(''), passStatus: true },
  [`${ORIGIN}/private`]: { status: 200, contentType: 'text/html', body: html('<h1>Hidden</h1>') },
});

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('e2e (plan Phase 6)', () => {
  it('e2e: 5-page fixture site produces complete correct report', async () => {
    const fetcher = new FakeFetcher(fivePageSite());
    const report = await runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 2 } }, makeTestDeps(fetcher));

    // honest completion over exactly the 5 audited pages; /private is robots-denied
    expect(report.stopReason).toBe('completed');
    expect(report.incomplete).toBe(false);
    expect(report.summary.pagesAudited).toBe(5);
    const denied = report.pages.find((p) => p.url === `${ORIGIN}/private`);
    expect(denied?.skipped).toEqual({ reason: 'robots_disallowed' });
    expect(denied?.issues).toEqual([]);
    expect(denied?.status).toBeNull();

    // robots gate ran BEFORE any page fetch; sitemap discovery fed the frontier
    expect(fetcher.countFor(ROBOTS)).toBe(1);
    expect(fetcher.countFor(SITEMAP)).toBe(1);
    const firstPageCall = fetcher.pageCalls()[0]?.url;
    expect(fetcher.log.findIndex((c) => c.url === ROBOTS)).toBeLessThan(
      fetcher.log.findIndex((c) => c.url === firstPageCall),
    );
    expect(report.pages.map((p) => p.url)).toContain(`${ORIGIN}/policies`); // discovered via sitemap

    // rules fired with evidence: 500 page audited (status-error), h1-multiple on /blog
    const policies = report.pages.find((p) => p.url === `${ORIGIN}/policies`);
    expect(policies?.issues.some((i) => i.ruleId === 'status-error' && i.message.includes('500'))).toBe(true);
    const blog = report.pages.find((p) => p.url === `${ORIGIN}/blog`);
    expect(blog?.issues.some((i) => i.ruleId === 'h1-multiple')).toBe(true);

    // score matches the severity-weighted recomputation over audited pages
    const WEIGHT = { error: 10, warning: 3, info: 0 } as const;
    const audited = report.pages.filter((p) => p.skipped === undefined);
    const expected = Math.round(
      audited.reduce((s, p) => s + Math.max(0, 100 - p.issues.reduce((a, i) => a + WEIGHT[i.severity], 0)), 0) /
        audited.length,
    );
    expect(report.summary.score).toBe(expected);
    expect(report.summary.score).toBeGreaterThanOrEqual(0);
    expect(report.summary.score).toBeLessThanOrEqual(100);
    expect(report.configSnapshot.renderer).toBe('static');
  });

  it('e2e: abort mid-e2e yields incomplete partial report', async () => {
    const site = fivePageSite();
    site[`${ORIGIN}/`] = {
      status: 200,
      contentType: 'text/html',
      body: html('<a href="/about">a</a><a href="/blog">b</a><a href="/contact">c</a>'),
      defer: true,
    };
    site[`${ORIGIN}/about`] = { status: 200, contentType: 'text/html', body: html(''), defer: true };
    site[`${ORIGIN}/blog`] = { status: 200, contentType: 'text/html', body: html(''), defer: true };
    site[`${ORIGIN}/contact`] = { status: 200, contentType: 'text/html', body: html(''), defer: true };
    const fetcher = new FakeFetcher(site);
    const controller = new AbortController();
    const pending = runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 2 } }, makeTestDeps(fetcher), controller.signal);
    await tick();
    fetcher.release(`${ORIGIN}/`); // seed completes; about+blog enter flight
    await tick();
    controller.abort();
    const report = await pending;
    expect(report.stopReason).toBe('aborted');
    expect(report.incomplete).toBe(true);
    expect(report.pages.map((p) => p.url)).toEqual([`${ORIGIN}/`]); // only what completed — nothing fabricated
    expect(report.summary.pagesAudited).toBe(1);
    // partial report is still a well-formed report: id, snapshot, summary present
    expect(report.id).toMatch(/^audit-example\.com-/);
    expect(report.configSnapshot.renderer).toBe('static');
  });
});
