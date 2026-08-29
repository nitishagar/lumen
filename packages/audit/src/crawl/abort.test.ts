import { describe, expect, it } from 'vitest';
import { runSiteAudit } from '../run.js';
import { FakeFetcher } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';

const html = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>Ample page title length</title></head><body>${body}</body></html>`;

const noRobots = { status: 404, contentType: 'text/plain', body: '' };

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('abort (I14)', () => {
  it('abort: no new request starts after abort', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a>'), defer: true },
      'https://example.com/a': { status: 200, contentType: 'text/html', body: html(''), defer: true },
      'https://example.com/b': { status: 200, contentType: 'text/html', body: html(''), defer: true },
      'https://example.com/c': { status: 200, contentType: 'text/html', body: html(''), defer: true },
      'https://example.com/d': { status: 200, contentType: 'text/html', body: html(''), defer: true },
    });
    const controller = new AbortController();
    const pending = runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 2 } }, makeTestDeps(fetcher), controller.signal);
    await tick();
    fetcher.release('https://example.com/'); // seed settles; a+b enter flight
    await tick();
    expect(fetcher.inFlight).toBe(2);
    controller.abort();
    const report = await pending;
    expect(report.stopReason).toBe('aborted');
    expect(fetcher.countFor('https://example.com/c')).toBe(0); // dispatch loop exits on abort
    expect(fetcher.countFor('https://example.com/d')).toBe(0);
  });

  it('abort: in-flight requests receive the abort signal', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a>'), defer: true },
      'https://example.com/a': { status: 200, contentType: 'text/html', body: html(''), defer: true },
    });
    const controller = new AbortController();
    const pending = runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 1 } }, makeTestDeps(fetcher), controller.signal);
    await tick();
    fetcher.release('https://example.com/');
    await tick();
    const call = fetcher.log.find((c) => c.url === 'https://example.com/a');
    const signal = (call?.init as { signal?: AbortSignal } | undefined)?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    controller.abort();
    await pending;
    expect(signal?.aborted).toBe(true); // the fetcher saw the caller's abort
  });

  it('abort: run resolves promptly with partial report labeled incomplete', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html(''), defer: true },
    });
    const controller = new AbortController();
    const pending = runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher), controller.signal);
    await tick();
    controller.abort();
    const outcome = await Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);
    expect(outcome).toBe('resolved');
    const report = await pending;
    expect(report.incomplete).toBe(true);
    expect(report.stopReason).toBe('aborted');
  });

  it('abort: abort during rate-limit sleep stops without dispatch', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'Sitemap: https://example.com/s.xml\n' },
      'https://example.com/s.xml': { status: 200, contentType: 'application/xml', body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    const controller = new AbortController();
    const deps = makeTestDeps(fetcher, { hang: true }); // rate-limit sleeps never settle until abort
    const pending = runSiteAudit(new URL(ORIGIN), {}, deps, controller.signal);
    await tick();
    // robots + sitemap fetched (immediate first grants); the SEED is stuck in
    // its per-host rate-limit sleep when the abort lands.
    expect(fetcher.countFor(ROBOTS)).toBe(1);
    expect(fetcher.countFor('https://example.com/s.xml')).toBe(1);
    controller.abort();
    const report = await pending;
    expect(report.stopReason).toBe('aborted');
    expect(fetcher.pageCalls()).toHaveLength(0); // nothing was dispatched after the sleep
    expect(report.pages).toEqual([]); // no fabricated data
  });

  it('abort: report contains pages fetched before abort and no fabricated data', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a>'), defer: true },
      'https://example.com/a': { status: 200, contentType: 'text/html', body: html(''), defer: true },
    });
    const controller = new AbortController();
    const deps = makeTestDeps(fetcher);
    const pending = runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 1 } }, deps, controller.signal);
    await tick();
    fetcher.release('https://example.com/'); // seed completes; /a enters flight
    await tick();
    controller.abort();
    const report = await pending;
    expect(report.pages).toHaveLength(1); // only the completed seed
    expect(report.pages[0]?.url).toBe('https://example.com/');
    expect(report.pages[0]?.status).toBe(200);
    expect(report.pages[0]?.issues).toEqual([]);
    expect(report.summary.pagesAudited).toBe(1);
  });

  it('abort: aborting before the run starts yields an empty aborted report, not a rejection', async () => {
    const fetcher = new FakeFetcher({ [ROBOTS]: noRobots });
    const controller = new AbortController();
    controller.abort();
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher), controller.signal);
    expect(report.stopReason).toBe('aborted');
    expect(report.incomplete).toBe(true);
    expect(report.pages).toEqual([]);
    expect(fetcher.log).toHaveLength(0);
  });
});

describe('partial-failure labeling (I14)', () => {
  it('partial: per-page failures never mark the run incomplete by themselves', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/dead1">1</a><a href="/dead2">2</a>') },
      'https://example.com/dead1': { throw: new Error('ECONNREFUSED') },
      'https://example.com/dead2': { throw: new Error('ENOTFOUND') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.incomplete).toBe(false);
    expect(report.stopReason).toBe('completed');
    expect(report.summary.pagesSkipped).toBe(2);
    expect(report.pages.every((p) => p.skipped === undefined || p.skipped.reason === 'fetch_error')).toBe(true);
  });

  it('partial: aborted-then-rerun yields a complete report (safe re-run, no side effects)', async () => {
    const routes: Record<string, unknown> = {
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a>') },
      'https://example.com/a': { status: 200, contentType: 'text/html', body: html(''), defer: true },
    };
    const firstFetcher = new FakeFetcher(routes as never);
    const controller = new AbortController();
    const first = runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 1 } }, makeTestDeps(firstFetcher), controller.signal);
    await tick();
    controller.abort();
    const aborted = await first;
    expect(aborted.incomplete).toBe(true);

    const secondFetcher = new FakeFetcher({
      [ROBOTS]: noRobots,
      'https://example.com/sitemap.xml': noRobots,
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a>') },
      'https://example.com/a': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 1 } }, makeTestDeps(secondFetcher));
    expect(report.incomplete).toBe(false);
    expect(report.stopReason).toBe('completed');
    expect(report.pages).toHaveLength(2);
  });
});
