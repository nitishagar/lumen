import { describe, expect, it } from 'vitest';
import { runSiteAudit } from '../run.js';
import { FakeFetcher, exhausted } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';

const html = (body: string, head = '<title>Ample page title length</title>'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

const noRobots = { status: 404, contentType: 'text/plain', body: '' };

describe('redirects (core-owned iteration, audit-owned classification)', () => {
  it('redirects: loop terminates at repeated URL with skipped redirect_loop and no hang', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { redirectError: 'loop' },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]?.skipped).toEqual({ reason: 'redirect_loop' });
    expect(report.pages[0]?.status).toBeNull();
    expect(report.incomplete).toBe(false);
  });

  it('redirects: chain hitting maxRedirects (5) without a repeated URL skips redirect_cap', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { redirectError: 'hop-cap' },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'redirect_cap' });
  });

  it('redirects: cross-origin redirect target recorded but not crawled', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': {
        status: 200,
        contentType: 'text/html',
        finalUrl: 'https://elsewhere.example/landing',
        body: html('<a href="/from-final">f</a><a href="https://elsewhere.example/x">x</a>'),
      },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const page = report.pages[0]!;
    expect(page.url).toBe('https://example.com/'); // requested URL owns the report row
    expect(page.redirectChain).toEqual(['https://example.com/', 'https://elsewhere.example/landing']);
    // nothing from the cross-origin final page is followed (A1)
    expect(fetcher.pageCalls().map((c) => c.url)).toEqual(['https://example.com/']);
    expect(report.pages).toHaveLength(1);
  });

  it('redirects: each page fetch is dispatched with redirect manual through the injected fetcher (SSRF per-hop point)', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', finalUrl: 'https://example.com/final', body: html('') },
    });
    await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const pageCalls = fetcher.pageCalls();
    expect(pageCalls).toHaveLength(1);
    expect((pageCalls[0]!.init as { redirect?: string }).redirect).toBe('manual'); // activates core's per-hop iterator
  });
});

describe('body boundaries (I15)', () => {
  it('body: oversized Content-Length page skipped oversized without parse', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html(''), contentLength: 3_000_000 },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'oversized' });
    expect(report.pages[0]?.bytes).toBe(3_000_000);
    expect(report.pages[0]?.issues).toEqual([]);
    expect(report.summary.pagesSkipped).toBe(1);
  });

  it('body: streamed body aborted at cap when Content-Length absent', async () => {
    const chunk = 'x'.repeat(600_000);
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', chunks: [chunk, chunk, chunk, chunk] }, // 2.4 MB streamed
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'oversized' });
  });

  it('body: custom maxBodyBytes is honored', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), { maxBodyBytes: 10 }, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'oversized' });
  });

  it('body: non-HTML content type skipped non_html and counted in pagesSkipped', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'application/json', body: '{"a":1}' },
      'https://example.com/img.png': { status: 200, contentType: 'image/png', body: '' },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'non_html' });
    expect(report.summary.pagesSkipped).toBe(1);
    expect(report.summary.pagesAudited).toBe(0);
    expect(report.summary.score).toBe(0); // nothing audited != clean (I3)
  });

  it('body: HTML and XHTML both parsed', async () => {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ample page title length</title></head><body><p>x</p></body></html>';
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/xhtml">x</a>') },
      'https://example.com/xhtml': { status: 200, contentType: 'application/xhtml+xml', body: xhtml },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages.find((p) => p.url === 'https://example.com/xhtml')?.skipped).toBeUndefined();
    expect(report.pages.find((p) => p.url === 'https://example.com/xhtml')?.status).toBe(200);
  });
});

describe('per-URL failure isolation (I14/I17)', () => {
  it('crawl: 429 on page retries once honoring Retry-After then skips rate_limited', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': [
        { status: 429, contentType: 'text/html', body: '', headers: { 'retry-after': '1' }, passStatus: true },
        { status: 429, contentType: 'text/html', body: '', headers: { 'retry-after': '1' }, passStatus: true },
      ],
    });
    const deps = makeTestDeps(fetcher);
    const report = await runSiteAudit(new URL(ORIGIN), {}, deps);
    expect(fetcher.countFor('https://example.com/')).toBe(2); // initial + one retry
    expect(deps.time.value).toBeGreaterThanOrEqual(1_000); // Retry-After honored
    expect(report.pages[0]?.skipped).toEqual({ reason: 'rate_limited' });
  });

  it('crawl: RetryExhaustedError(429) from the fetcher skips rate_limited without a second attempt', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { throw: exhausted(429) },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'rate_limited' });
  });

  it('crawl: fetch error on one page skips fetch_error and crawl continues', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/dead">d</a><a href="/fine">f</a>') },
      'https://example.com/dead': { throw: new Error('socket hang up') },
      'https://example.com/fine': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages.find((p) => p.url === 'https://example.com/dead')?.skipped).toEqual({ reason: 'fetch_error' });
    expect(report.pages.find((p) => p.url === 'https://example.com/fine')?.skipped).toBeUndefined();
    expect(report.incomplete).toBe(false); // per-page failures never mark the run incomplete
    expect(report.summary.pagesSkipped).toBe(1);
  });

  it('crawl: 4xx page is recorded and audited (status-error context)', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/gone">g</a>') },
      'https://example.com/gone': { status: 404, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const gone = report.pages.find((p) => p.url === 'https://example.com/gone');
    expect(gone?.status).toBe(404);
    expect(gone?.skipped).toBeUndefined(); // recorded and audited, not skipped
  });

  it('crawl: RetryExhaustedError(5xx) is a terminal fetch_error skip, never a crash', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { throw: exhausted(503) },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toEqual({ reason: 'fetch_error' });
  });

  it('crawl: no conditional-request headers are ever sent (A11)', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const forbidden = ['if-modified-since', 'if-none-match', 'if-match', 'cookie', 'authorization'];
    for (const call of fetcher.log) {
      const headers = (call.init as { headers?: Headers } | undefined)?.headers;
      if (headers === undefined) continue;
      for (const key of forbidden) expect(Headers.prototype.has.call(headers, key), key).toBe(false);
    }
  });
});
