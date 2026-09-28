/**
 * E1.1 engine-level tests: `target.scope` honesty label on reports and the
 * FR-5 `--canonical-origin` insecure-http suppression. FakeFetcher only —
 * zero network.
 */
import { describe, expect, it } from 'vitest';
import { runSiteAudit } from './run.js';
import { robotsGate } from './crawl/robots-policy.js';
import { LumenRobotsUnreachableError } from './types.js';
import { createFetcher } from '@lumen-seo/core';
import { createPrivateScopePolicy } from '@lumen-seo/core';
import type { CrawlerDeps } from './types.js';
import { FakeFetcher } from './testing/fake-fetcher.js';
import type { FakeRoute } from './testing/fake-fetcher.js';
import { makeTestDeps } from './testing/deps.js';

const html = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page."></head><body>${body}</body></html>`;

const site = (origin: string): Record<string, FakeRoute> => ({
  [`${origin}/robots.txt`]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nAllow: /\n' },
  [`${origin}/`]: { status: 200, contentType: 'text/html', body: html('<h1>Home</h1>') },
});

const scopeOf = (report: { configSnapshot: Record<string, unknown> }): string | undefined =>
  (report.configSnapshot as { target?: { scope?: string } }).target?.scope;

describe('target.scope (FR-4 honesty label)', () => {
  it('a loopback seed reports scope "private" without any opt-in', async () => {
    const origin = 'http://localhost:4321';
    const report = await runSiteAudit(new URL(origin), {}, makeTestDeps(new FakeFetcher(site(origin))));
    expect(scopeOf(report)).toBe('private');
  });

  it('a public seed reports scope "public"', async () => {
    const origin = 'https://example.com';
    const report = await runSiteAudit(new URL(origin), {}, makeTestDeps(new FakeFetcher(site(origin))));
    expect(scopeOf(report)).toBe('public');
  });

  it('an explicit config targetScope wins over the derived label (allowlisted DNS-name seed)', async () => {
    const origin = 'http://staging.internal:8080';
    const report = await runSiteAudit(
      new URL(origin),
      { targetScope: 'private' },
      makeTestDeps(new FakeFetcher(site(origin))),
    );
    expect(scopeOf(report)).toBe('private');
  });
});

describe('insecure-http + --canonical-origin (FR-5)', () => {
  const httpOrigin = 'http://localhost:4321';

  it('a private http page still fires insecure-http without a canonical origin', async () => {
    const report = await runSiteAudit(new URL(httpOrigin), {}, makeTestDeps(new FakeFetcher(site(httpOrigin))));
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'insecure-http');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('with a https canonical origin the private-page plain-http finding is suppressed', async () => {
    const report = await runSiteAudit(
      new URL(httpOrigin),
      { canonicalOrigin: 'https://example.com' },
      makeTestDeps(new FakeFetcher(site(httpOrigin))),
    );
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'insecure-http');
    expect(issues).toEqual([]);
  });

  it('a PUBLIC http seed still fires insecure-http even with a canonical origin (only private pages are preview-shaped)', async () => {
    const origin = 'http://example.com';
    const report = await runSiteAudit(
      new URL(origin),
      { canonicalOrigin: 'https://example.com' },
      makeTestDeps(new FakeFetcher(site(origin))),
    );
    const issues = report.pages.flatMap((p) => p.issues).filter((i) => i.ruleId === 'insecure-http');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('a malformed canonicalOrigin is a typed error', async () => {
    await expect(
      runSiteAudit(new URL(httpOrigin), { canonicalOrigin: 'not a url' }, makeTestDeps(new FakeFetcher({}))),
    ).rejects.toThrow(/canonicalOrigin/);
  });
});

describe('redirect-escape regression (security review C1): robots/sitemap legs', () => {
  it('robots.txt fetched with redirect:"manual" — a 302 to a metadata IP is refused, never followed natively', async () => {
    const redirectModes: (string | undefined)[] = [];
    const fetcher = createFetcher({
      allowPrivate: createPrivateScopePolicy({ seedOrigin: new URL('http://localhost:4321'), loopback: true }),
      delegate: async (url, init) => {
        redirectModes.push(init?.redirect);
        if (url.pathname === '/robots.txt') {
          return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/robots.txt' } });
        }
        throw new Error(`transport reached a non-robots URL: ${url.href}`);
      },
    });
    const deps: CrawlerDeps = {
      fetcher,
      now: () => 0,
      delay: Object.assign(async () => undefined, { cancel: () => undefined }) as never,
      jitter: () => 0,
      randomId: () => 'test',
    };
    // The escaped hop throws SsrfBlockedError inside the iterator; the robots
    // gate converts it to its typed unreachable refusal (crawl refused).
    await expect(robotsGate(new URL('http://localhost:4321'), deps)).rejects.toBeInstanceOf(
      LumenRobotsUnreachableError,
    );
    expect(redirectModes).toEqual(['manual']);
  });
});
