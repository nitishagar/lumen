import { describe, expect, it } from 'vitest';
import type { AuditRule } from '@lumen-seo/core';
import { runSiteAudit } from '../run.js';
import { FakeFetcher } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';

const ORIGIN = 'https://example.com';

const page = (path: string, body: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: 200,
  contentType: 'text/html',
  body,
  ...extra,
});

const linkPage = (...hrefs: string[]): string =>
  `<!doctype html><html lang="en"><head><title>Ample page title length</title></head><body>${hrefs
    .map((h) => `<a href="${h}">link</a>`)
    .join('')}</body></html>`;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('crawler (core loop)', () => {
  it('crawler: drains frontier to stopReason completed and incomplete false', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': page('/', linkPage('/a', '/b')),
      'https://example.com/a': page('/a', linkPage('/')),
      'https://example.com/b': page('/b', '<html></html>'),
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.stopReason).toBe('completed');
    expect(report.incomplete).toBe(false);
    expect(report.pages).toHaveLength(3);
    expect(report.pages.map((p) => p.url).sort()).toEqual(['https://example.com/', 'https://example.com/a', 'https://example.com/b']);
    expect(report.summary.pagesAudited).toBe(3);
    expect(report.summary.pagesSkipped).toBe(0);
  });

  it('crawler: respects global concurrency cap under contention', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': { ...page('/', linkPage('/1', '/2', '/3', '/4', '/5')), defer: true },
      'https://example.com/1': { ...page('/1', ''), defer: true },
      'https://example.com/2': { ...page('/2', ''), defer: true },
      'https://example.com/3': { ...page('/3', ''), defer: true },
      'https://example.com/4': { ...page('/4', ''), defer: true },
      'https://example.com/5': { ...page('/5', ''), defer: true },
    });
    const deps = makeTestDeps(fetcher);
    const pending = runSiteAudit(new URL(ORIGIN), { crawl: { maxConcurrency: 3 } }, deps);
    await tick();
    expect(fetcher.inFlight).toBe(1); // seed alone — links unknown until it settles
    fetcher.release();
    await tick();
    expect(fetcher.inFlight).toBe(3); // pool cap
    fetcher.release();
    await tick();
    expect(fetcher.inFlight).toBe(2);
    fetcher.release();
    const report = await pending;
    expect(report.stopReason).toBe('completed');
    expect(report.pages).toHaveLength(6);
    expect(fetcher.maxInFlight).toBeLessThanOrEqual(3);
    expect(fetcher.maxInFlight).toBe(3);
  });

  it('crawler: stops at page budget with stopReason page_budget and incomplete true', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': page('/', linkPage('/a', '/b', '/c')),
      'https://example.com/a': page('/a', ''),
      'https://example.com/b': page('/b', ''),
      'https://example.com/c': page('/c', ''),
    });
    const report = await runSiteAudit(new URL(ORIGIN), { crawl: { maxPages: 2 } }, makeTestDeps(fetcher));
    expect(report.stopReason).toBe('page_budget');
    expect(report.incomplete).toBe(true);
    expect(report.pages).toHaveLength(2); // seed + one link — never overshoots under concurrency
    expect(fetcher.countFor('https://example.com/c')).toBe(0);
  });

  it('crawler: stops at time budget with stopReason time_budget and incomplete true', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': { ...page('/', linkPage('/a', '/b')), defer: true },
      'https://example.com/a': page('/a', ''),
      'https://example.com/b': page('/b', ''),
    });
    const deps = makeTestDeps(fetcher);
    const pending = runSiteAudit(new URL(ORIGIN), { crawl: { maxDurationMs: 1_000 } }, deps);
    await tick();
    deps.time.value = 2_000; // past the deadline before the next dispatch
    fetcher.release();
    const report = await pending;
    expect(report.stopReason).toBe('time_budget');
    expect(report.incomplete).toBe(true);
    expect(report.pages).toHaveLength(1);
    expect(fetcher.countFor('https://example.com/a')).toBe(0);
  });

  it('crawler: depth-capped URLs are not enqueued and run completes', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': page('/', linkPage('/a')),
    });
    const report = await runSiteAudit(new URL(ORIGIN), { crawl: { maxDepth: 0 } }, makeTestDeps(fetcher));
    expect(report.stopReason).toBe('completed'); // depth-bounded drain still completes (A5)
    expect(report.incomplete).toBe(false);
    expect(report.pages).toHaveLength(1);
    expect(fetcher.countFor('https://example.com/a')).toBe(0);
  });

  it('crawler: empty body is parsed as an empty document (rules fire)', async () => {
    const seen: string[] = [];
    const probe: AuditRule = {
      id: 'probe-title-missing',
      severity: 'error',
      categories: ['meta'],
      check(pageCtx) {
        seen.push(`title=${pageCtx.dom('title').length}`);
        return pageCtx.dom('title').length === 0
          ? [{ ruleId: 'probe-title-missing', severity: 'error', message: 'no title', evidence: {} }]
          : [];
      },
    };
    const fetcher = new FakeFetcher({ 'https://example.com/': page('/', '') });
    const report = await runSiteAudit(new URL(ORIGIN), { extraRules: [probe] }, makeTestDeps(fetcher));
    expect(report.pages[0]?.skipped).toBeUndefined();
    expect(report.pages[0]?.bytes).toBe(0);
    expect(seen).toEqual(['title=0']);
    // the probe rule fired on the empty document alongside the built-ins
    expect(report.pages[0]?.issues.some((i) => i.ruleId === 'probe-title-missing')).toBe(true);
  });

  it('determinism spot-check: repeated runs with identical inputs produce identical reports', async () => {
    const routes = {
      'https://example.com/': page('/', linkPage('/a')),
      'https://example.com/a': page('/a', linkPage('/')),
    };
    const run = async (): Promise<string> => {
      const fetcher = new FakeFetcher(routes);
      const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
      return JSON.stringify(report);
    };
    expect(await run()).toBe(await run());
  });

  it('crawler: fragment-variant links do not re-crawl the same page', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': page('/', linkPage('/a', '/a#top', '/a#section')),
      'https://example.com/a': page('/a', ''),
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages).toHaveLength(2);
    expect(fetcher.countFor('https://example.com/a')).toBe(1);
  });
});
