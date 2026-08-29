import { describe, expect, it } from 'vitest';
import { RetryExhaustedError } from '@lumen-seo/core';
import { runSiteAudit } from '../run.js';
import { robotsGate } from './robots-policy.js';
import { FakeFetcher, exhausted } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';
import { LumenRobotsUnreachableError, LumenSeedDisallowedError } from '../types.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';

const html = (body: string, head = '<title>Ample page title length</title>'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

describe('robots gate (A2 policy table)', () => {
  it('robots: denied pages are skipped as robots_disallowed, not errored', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/private">p</a><a href="/open">o</a>') },
      'https://example.com/open': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const denied = report.pages.find((p) => p.url === 'https://example.com/private');
    expect(denied?.skipped).toEqual({ reason: 'robots_disallowed' });
    expect(denied?.issues).toEqual([]);
    expect(denied?.robotsAllowed).toBe(false);
    expect(denied?.status).toBeNull(); // never zero-filled (I3)
    expect(fetcher.countFor('https://example.com/private')).toBe(0); // zero fetches for denied URLs
    expect(report.summary.pagesSkipped).toBe(1);
    expect(report.summary.pagesAudited).toBe(2);
    expect(report.incomplete).toBe(false);
  });

  it('robots: fetch failure (5xx/network after retries) refuses crawl with typed error and zero page fetches', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 503, contentType: 'text/plain', body: '' }, // fake throws RetryExhausted(503) like core
    });
    await expect(runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher))).rejects.toBeInstanceOf(LumenRobotsUnreachableError);
    expect(fetcher.pageCalls()).toHaveLength(0);
  });

  it('robots: network-level failure also refuses with the typed error', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { throw: new Error('ECONNRESET') },
    });
    await expect(runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher))).rejects.toBeInstanceOf(LumenRobotsUnreachableError);
    expect(fetcher.pageCalls()).toHaveLength(0);
  });

  it('robots: 429 retries once honoring Retry-After cap then refuses', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: [
        { status: 429, contentType: 'text/plain', body: '', headers: { 'retry-after': '2' }, passStatus: true },
        { status: 429, contentType: 'text/plain', body: '', headers: { 'retry-after': '2' }, passStatus: true },
      ],
    });
    const deps = makeTestDeps(fetcher);
    await expect(runSiteAudit(new URL(ORIGIN), {}, deps)).rejects.toBeInstanceOf(LumenRobotsUnreachableError);
    expect(fetcher.countFor(ROBOTS)).toBe(2); // exactly one retry
    expect(deps.time.value).toBe(2_000); // Retry-After: 2s honored via the injected clock
    expect(fetcher.pageCalls()).toHaveLength(0);
  });

  it('robots: Retry-After above the 5s cap is clamped', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: [
        { status: 429, contentType: 'text/plain', body: '', headers: { 'retry-after': '600' }, passStatus: true },
        { status: 429, contentType: 'text/plain', body: '', headers: { 'retry-after': '600' }, passStatus: true },
      ],
    });
    const deps = makeTestDeps(fetcher);
    await expect(runSiteAudit(new URL(ORIGIN), {}, deps)).rejects.toBeInstanceOf(LumenRobotsUnreachableError);
    expect(deps.time.value).toBe(5_000); // clamped to the audit-owned cap
  });

  it('robots: 429 exhausting the fetcher retries gets one final audit-level attempt, then refuses', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: [
        { throw: exhausted(429) },
        { throw: exhausted(429) },
      ],
    });
    const deps = makeTestDeps(fetcher);
    await expect(runSiteAudit(new URL(ORIGIN), {}, deps)).rejects.toBeInstanceOf(LumenRobotsUnreachableError);
    expect(fetcher.countFor(ROBOTS)).toBe(2);
    expect(deps.time.value).toBe(2_500); // jitter() 0.5 x 5000 cap
  });

  it('robots: 429 then success proceeds with the crawl', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: [
        { status: 429, contentType: 'text/plain', body: '', headers: { 'retry-after': '1' }, passStatus: true },
        { status: 200, contentType: 'text/plain', body: '' },
      ],
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages).toHaveLength(1);
  });

  it('robots: 404 means no restrictions and crawl proceeds (sitemap probe attempted)', async () => {
    const fetcher = new FakeFetcher({
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
      // no robots route → default 404; no sitemap route → probe 404, silent
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages).toHaveLength(1);
    expect(fetcher.countFor(ROBOTS)).toBe(1);
    expect(fetcher.countFor('https://example.com/sitemap.xml')).toBe(1); // probe fallback
    expect(report.configSnapshot.discoveryWarnings).toEqual([]);
  });

  it('robots: malformed lines are dropped, valid groups enforced', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: {
        status: 200,
        contentType: 'text/plain',
        body: 'this is : not robots syntax at all\n%%%%%%\nUser-agent: *\nDisallow: /private\n',
      },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/private">p</a><a href="/fine">f</a>') },
      'https://example.com/fine': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.pages.find((p) => p.url === 'https://example.com/private')?.skipped).toEqual({ reason: 'robots_disallowed' });
    expect(report.pages.find((p) => p.url === 'https://example.com/fine')?.skipped).toBeUndefined();
  });

  it('robots: crawl-delay (seconds per RFC 9309) spaces page fetches by seconds x 1000', async () => {
    const time = { value: 0 };
    const fetcher = new FakeFetcher(
      {
        [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nCrawl-delay: 1\n' },
        'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a>') },
        'https://example.com/a': { status: 200, contentType: 'text/html', body: html('') },
      },
      () => time.value,
    );
    const deps = makeTestDeps(fetcher, { time });
    await runSiteAudit(new URL(ORIGIN), {}, deps);
    const pageTimes = fetcher.pageCalls().map((c) => c.at);
    expect(pageTimes.length).toBeGreaterThanOrEqual(2);
    const sorted = [...pageTimes].sort((x, y) => x - y);
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(1_000); // crawl-delay 1s → 1000ms spacing
  });

  it('robots: seed disallowed -> typed error, zero page fetches', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /\n' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    await expect(runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher))).rejects.toBeInstanceOf(LumenSeedDisallowedError);
    expect(fetcher.pageCalls()).toHaveLength(0);
  });

  it('respectRobots: false skips the gate but keeps budgets and rate limiting', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /\n' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/a">a</a>') },
      'https://example.com/a': { status: 200, contentType: 'text/html', body: html('') },
    });
    const deps = makeTestDeps(fetcher);
    const report = await runSiteAudit(new URL(ORIGIN), { respectRobots: false }, deps);
    expect(fetcher.countFor(ROBOTS)).toBe(0); // gate skipped entirely
    expect(report.pages).toHaveLength(2);
    expect(deps.time.value).toBeGreaterThanOrEqual(250); // politeness still enforced
  });

  it('robotsGate: unit-level probe decision honors Sitemap: lines', async () => {
    const withLines = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'Sitemap: https://example.com/s.xml\n' },
    });
    const gate = await robotsGate(new URL(ORIGIN), makeTestDeps(withLines));
    expect(gate.probeSitemap).toBe(false);
    expect(gate.policy.sitemaps.map((u) => u.href)).toEqual(['https://example.com/s.xml']);
  });

  it('robotsGate: RetryExhaustedError without status (network) refuses', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { throw: new RetryExhaustedError('network fail', { attempts: 3 }) },
    });
    await expect(robotsGate(new URL(ORIGIN), makeTestDeps(fetcher))).rejects.toBeInstanceOf(LumenRobotsUnreachableError);
  });
});
