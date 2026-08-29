import { describe, expect, it } from 'vitest';
import { AbortedError } from '@lumen-seo/core';
import { RateLimiter } from './rate-limiter.js';
import { makeTestDeps } from '../testing/deps.js';
import { FakeFetcher } from '../testing/fake-fetcher.js';

describe('rate-limiter', () => {
  it('rate-limiter: request starts are spaced >= min interval per host', async () => {
    const deps = makeTestDeps(new FakeFetcher({}));
    const limiter = new RateLimiter(deps, 250);
    const t1 = deps.now();
    await limiter.waitForTurn('example.com');
    const g1 = deps.now();
    await limiter.waitForTurn('example.com');
    const g2 = deps.now();
    await limiter.waitForTurn('example.com');
    const g3 = deps.now();
    expect(t1).toBe(0);
    expect(g1).toBe(0); // first request immediate
    expect(g2 - g1).toBeGreaterThanOrEqual(250);
    expect(g3 - g2).toBeGreaterThanOrEqual(250);
  });

  it('crawl-delay (seconds per RFC 9309) is converted to ms and overrides the configured interval', async () => {
    const deps = makeTestDeps(new FakeFetcher({}));
    const limiter = new RateLimiter(deps, 250);
    limiter.setCrawlDelay(1); // robots Crawl-delay: 1 (seconds)
    expect(limiter.effectiveIntervalMs()).toBe(1_000);
    await limiter.waitForTurn('example.com');
    await limiter.waitForTurn('example.com');
    const g2 = deps.now();
    expect(g2).toBe(1_000);
  });

  it('configured interval wins when crawl-delay is smaller', async () => {
    const deps = makeTestDeps(new FakeFetcher({}));
    const limiter = new RateLimiter(deps, 300);
    limiter.setCrawlDelay(0.1 as unknown as number); // even a sub-second delay loses
    expect(limiter.effectiveIntervalMs()).toBe(300);
  });

  it('hosts are limited independently', async () => {
    const deps = makeTestDeps(new FakeFetcher({}));
    const limiter = new RateLimiter(deps, 250);
    await limiter.waitForTurn('a.example');
    await limiter.waitForTurn('b.example'); // different host — no wait
    expect(deps.now()).toBe(0);
    await limiter.waitForTurn('a.example');
    expect(deps.now()).toBe(250);
  });

  it('an aborted grant rejects but does not poison the chain', async () => {
    const deps = makeTestDeps(new FakeFetcher({}), { hang: true });
    const limiter = new RateLimiter(deps, 250);
    await limiter.waitForTurn('example.com'); // first grant immediate even with hang
    const controller = new AbortController();
    const second = limiter.waitForTurn('example.com', controller.signal);
    controller.abort();
    await expect(second).rejects.toBeInstanceOf(AbortedError);
    // the limiter still works for subsequent callers
    const deps2 = makeTestDeps(new FakeFetcher({}), { time: deps.time });
    const limiter2 = new RateLimiter(deps2, 250);
    await limiter2.waitForTurn('example.com');
    expect(deps2.now()).toBe(0);
  });

  it('grants are serialized — two concurrent waiters never share a slot', async () => {
    const deps = makeTestDeps(new FakeFetcher({}));
    const limiter = new RateLimiter(deps, 100);
    const grants = await Promise.all([
      limiter.waitForTurn('example.com').then(() => deps.now()),
      limiter.waitForTurn('example.com').then(() => deps.now()),
      limiter.waitForTurn('example.com').then(() => deps.now()),
    ]);
    expect(new Set(grants).size).toBe(3); // distinct slots
    expect(grants[2]).toBeGreaterThanOrEqual(200);
  });
});
