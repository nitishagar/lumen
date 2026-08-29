import { describe, expect, it } from 'vitest';
import { runSiteAudit } from '../run.js';
import { FakeFetcher } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';
const SITEMAP = 'https://example.com/sitemap.xml';

const html = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>Ample page title length</title></head><body>${body}</body></html>`;

const urlset = (locs: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<url><loc>${l}</loc></url>`)
    .join('')}</urlset>`;

const sitemapindex = (locs: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<sitemap><loc>${l}</loc></sitemap>`)
    .join('')}</sitemapindex>`;

describe('sitemap discovery', () => {
  it('sitemap: Sitemap: directive URLs seed the frontier', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\n` },
      [SITEMAP]: { status: 200, contentType: 'application/xml', body: urlset(['https://example.com/orphan', 'https://example.com/']) },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
      'https://example.com/orphan': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    // /orphan is unlinked but crawled via the sitemap
    expect(report.pages.map((p) => p.url).sort()).toEqual(['https://example.com/', 'https://example.com/orphan']);
    expect(report.incomplete).toBe(false);
  });

  it('sitemap: falls back to /sitemap.xml probe when robots lists none', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\n' }, // no Sitemap lines
      [SITEMAP]: { status: 200, contentType: 'application/xml', body: urlset(['https://example.com/from-probe']) },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
      'https://example.com/from-probe': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(fetcher.countFor(SITEMAP)).toBe(1);
    expect(report.pages.map((p) => p.url)).toContain('https://example.com/from-probe');
  });

  it('sitemap: malformed XML -> warning + link-discovery fallback', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\n` },
      [SITEMAP]: { status: 200, contentType: 'application/xml', body: '<this is not xml at all' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<a href="/via-link">l</a>') },
      'https://example.com/via-link': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.configSnapshot.discoveryWarnings).toContain('sitemap_malformed');
    expect(report.pages.map((p) => p.url)).toContain('https://example.com/via-link');
    expect(report.incomplete).toBe(false);
  });

  it('sitemap: oversized sitemap is capped with warning', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\n` },
      [SITEMAP]: { status: 200, contentType: 'application/xml', body: urlset(['https://example.com/']), contentLength: 3_000_000 },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.configSnapshot.discoveryWarnings).toContain('sitemap_oversized');
    // truncated body still parsed what it could — no crash, crawl completes
    expect(report.incomplete).toBe(false);
  });

  it('sitemap: sitemapindex nested one level, child cap enforced', async () => {
    const children = Array.from({ length: 12 }, (_, i) => `https://example.com/s-${i}.xml`);
    const routes: Record<string, unknown> = {
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\n` },
      [SITEMAP]: { status: 200, contentType: 'application/xml', body: sitemapindex(children) },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    };
    for (let i = 0; i < 12; i++) {
      routes[`https://example.com/s-${i}.xml`] = {
        status: 200,
        contentType: 'application/xml',
        body: urlset([`https://example.com/from-child-${i}`]),
      };
      routes[`https://example.com/from-child-${i}`] = { status: 200, contentType: 'text/html', body: html('') };
    }
    const fetcher = new FakeFetcher(routes as never);
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(fetcher.countFor('https://example.com/s-9.xml')).toBe(1); // first 10 children fetched
    expect(fetcher.countFor('https://example.com/s-10.xml')).toBe(0); // cap
    expect(fetcher.countFor('https://example.com/s-11.xml')).toBe(0);
    expect(report.configSnapshot.discoveryWarnings).toContain('sitemap_child_cap');
    expect(report.pages.map((p) => p.url)).toContain('https://example.com/from-child-9');
  });

  it('sitemap: multiple robots Sitemap: lines are capped at 10 sources', async () => {
    const sources = Array.from({ length: 12 }, (_, i) => `https://example.com/sm-${i}.xml`);
    const routes: Record<string, unknown> = {
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: sources.map((s) => `Sitemap: ${s}`).join('\n') },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    };
    for (let i = 0; i < 12; i++) {
      routes[`https://example.com/sm-${i}.xml`] = {
        status: 200,
        contentType: 'application/xml',
        body: urlset([`https://example.com/x-${i}`]),
      };
      routes[`https://example.com/x-${i}`] = { status: 200, contentType: 'text/html', body: html('') };
    }
    const fetcher = new FakeFetcher(routes as never);
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(fetcher.countFor('https://example.com/sm-9.xml')).toBe(1);
    expect(fetcher.countFor('https://example.com/sm-10.xml')).toBe(0);
    expect(fetcher.countFor('https://example.com/sm-11.xml')).toBe(0);
    expect(report.configSnapshot.discoveryWarnings).toContain('sitemap_source_cap');
  });

  it('sitemap: cross-origin and non-http(s) locs are filtered', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: `Sitemap: ${SITEMAP}\n` },
      [SITEMAP]: {
        status: 200,
        contentType: 'application/xml',
        body: urlset([
          'https://example.com/kept',
          'https://elsewhere.example/dropped-cross-origin',
          'ftp://example.com/dropped-ftp',
          'javascript:void(0)',
        ]),
      },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
      'https://example.com/kept': { status: 200, contentType: 'text/html', body: html('') },
    });
    await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(fetcher.pageCalls().map((c) => c.url).sort()).toEqual(['https://example.com/', 'https://example.com/kept']);
  });

  it('sitemap: robots-declared source that 404s warns; the silent probe does not', async () => {
    const fetcher = new FakeFetcher({
      [ROBOTS]: { status: 200, contentType: 'text/plain', body: 'Sitemap: https://example.com/missing.xml\n' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    expect(report.configSnapshot.discoveryWarnings).toContain('sitemap_fetch_failed');
  });
});
