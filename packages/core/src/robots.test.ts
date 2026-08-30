import { describe, expect, it } from 'vitest';
import { createFetcher } from './fetcher.js';
import type { FetchTransport } from './fetcher.js';
import { loadRobots } from './robots.js';
import { USER_AGENT } from './ua.js';

/** A fetcher whose transport serves a fixed robots response (or throws), recording requests. */
const robotsFetcher = (res: () => Response | Promise<Response>) => {
  const requests: { url: string; userAgent: string | null }[] = [];
  const delegate: FetchTransport = async (url: URL, init?: RequestInit) => {
    requests.push({ url: url.href, userAgent: new Headers(init?.headers).get('user-agent') });
    return res();
  };
  return { fetcher: createFetcher({ delegate, sleep: async () => {} }), requests };
};

const site = new URL('https://example.com/');

describe('robots.txt policy matrix (SC-14 / BA-9)', () => {
  it('2xx → body parsed: allow/deny enforced, crawlDelay + sitemaps surfaced', async () => {
    const { fetcher } = robotsFetcher(() =>
      new Response(
        [
          'User-agent: *',
          'Disallow: /private/',
          'Crawl-delay: 7',
          'Sitemap: https://example.com/sitemap.xml',
          'Sitemap: https://s3.example.com/other.xml',
        ].join('\n'),
        { status: 200 },
      ),
    );
    const policy = await loadRobots(fetcher, site);
    expect(policy.isAllowed(new URL('https://example.com/'))).toBe(true);
    expect(policy.isAllowed(new URL('https://example.com/private/x'))).toBe(false);
    expect(policy.crawlDelay).toBe(7); // seconds per RFC 9309
    expect(policy.sitemaps).toEqual([
      new URL('https://example.com/sitemap.xml'),
      new URL('https://s3.example.com/other.xml'),
    ]);
  });

  it('a group matching the lumen UA token wins over the * group', async () => {
    const { fetcher } = robotsFetcher(() =>
      new Response(
        ['User-agent: lumen', 'Disallow: /only-lumen/', 'User-agent: *', 'Disallow: /everyone/'].join('\n'),
        { status: 200 },
      ),
    );
    const policy = await loadRobots(fetcher, site);
    expect(policy.isAllowed(new URL('https://example.com/only-lumen/x'))).toBe(false);
    expect(policy.isAllowed(new URL('https://example.com/everyone/x'))).toBe(true); // * group not applied
  });

  it('4xx (incl. 404) → allow-all, no sitemaps, no crawl delay', async () => {
    for (const status of [404, 410]) {
      const { fetcher } = robotsFetcher(() => new Response('gone', { status }));
      const policy = await loadRobots(fetcher, site);
      expect(policy.isAllowed(new URL('https://example.com/anything')), String(status)).toBe(true);
      expect(policy.sitemaps).toEqual([]);
      expect(policy.crawlDelay).toBeUndefined();
    }
  });

  it('429 and 5xx → disallow-all (conservative, I4)', async () => {
    for (const status of [429, 500, 503]) {
      const { fetcher } = robotsFetcher(() => new Response('nope', { status }));
      const policy = await loadRobots(fetcher, site);
      expect(policy.isAllowed(new URL('https://example.com/')), String(status)).toBe(false);
      expect(policy.sitemaps).toEqual([]);
    }
  });

  it('network failure → disallow-all', async () => {
    const { fetcher } = robotsFetcher(() => Promise.reject(new TypeError('fetch failed')));
    const policy = await loadRobots(fetcher, site);
    expect(policy.isAllowed(new URL('https://example.com/'))).toBe(false);
  });

  it('unparseable body → allow-all (documented, Google-compatible)', async () => {
    const { fetcher } = robotsFetcher(() => new Response('\x00\x01 {{{ garbage \x7f', { status: 200 }));
    const policy = await loadRobots(fetcher, site);
    expect(policy.isAllowed(new URL('https://example.com/anything'))).toBe(true);
    expect(policy.sitemaps).toEqual([]);
  });

  it('relative Sitemap: directives resolve against the robots URL; unconstructable ones are dropped, never thrown', async () => {
    // Relative Sitemap: values are common in the wild; a throw here would
    // reject the entire audit run (red-team round 1). Values that cannot
    // form a URL even against the robots URL are dropped.
    const { fetcher } = robotsFetcher(() =>
      new Response(
        ['User-agent: *', 'Disallow:', 'Sitemap: /sitemap.xml', 'Sitemap: http://exa mple.com/x', 'Sitemap: https://cdn.example.com/s.x.xml'].join('\n'),
        { status: 200 },
      ),
    );
    const policy = await loadRobots(fetcher, site);
    expect(policy.sitemaps).toEqual([
      new URL('https://example.com/sitemap.xml'),
      new URL('https://cdn.example.com/s.x.xml'),
    ]);
  });

  it('a path with no matching group is allowed (undefined → true)', async () => {
    const { fetcher } = robotsFetcher(() =>
      new Response(['User-agent: otherbot', 'Disallow: /'].join('\n'), { status: 200 }),
    );
    const policy = await loadRobots(fetcher, site);
    expect(policy.isAllowed(new URL('https://example.com/anything'))).toBe(true);
  });
});

describe('robots request plumbing (I4)', () => {
  it('robots.txt is fetched from the site root through the guarded fetcher with the lumen UA', async () => {
    const { fetcher, requests } = robotsFetcher(() => new Response('', { status: 200 }));
    await loadRobots(fetcher, new URL('https://example.com/deep/path?q=1'));
    expect(requests.map((r) => r.url)).toEqual(['https://example.com/robots.txt']);
    expect(requests[0]?.userAgent).toBe(USER_AGENT); // SC-12 applies to robots too
  });

  it('an SSRF-blocked robots target degrades to disallow-all (fetch failure matrix)', async () => {
    const fetcher = createFetcher({ label: 'robots' });
    const policy = await loadRobots(fetcher, new URL('http://127.0.0.1:8080/'));
    expect(policy.isAllowed(new URL('http://127.0.0.1:8080/x'))).toBe(false);
  });
});
