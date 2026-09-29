/**
 * E2.1/E2.2 CLI tests: `lumen performance` (fixture provider seam),
 * `--with-gsc` annotations (full-URL-set sums, stdout-only), rank's
 * GSC-preferred first-party labeling, and `lumen indexnow submit`
 * (dry-run default, --yes POST, key-file mismatch refusal) — all through
 * injected fixture transports, zero live network.
 */
import { describe, expect, it } from 'vitest';
import type { Fetcher } from '@lumen-seo/core';
import { createFetcher } from '@lumen-seo/core';
import type { FetchTransport } from '@lumen-seo/core';
import type { SearchPerformanceProvider } from '@lumen-seo/core';
import type { CommandDeps } from './composition/node.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';

const fixtureGsc = (rows: { key: string; clicks: number; impressions: number; position: number | null }[]): SearchPerformanceProvider => ({
  name: 'gsc-fixture',
  performance: async (site, o) => ({
    site: site.href,
    startDate: '2026-09-01',
    endDate: '2026-09-29',
    by: o.by,
    rows: rows.map((r) => ({ ...r, source: { provider: 'gsc', kind: 'official' } })),
  }),
});

const deps = (over: Partial<CommandDeps> = {}): CommandDeps => ({
  clock: () => '2026-09-29T12:00:00Z',
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: { append: async () => undefined, list: async () => [] },
  ...over,
});

describe('lumen performance (E2.1)', () => {
  it('renders rows with first-party labels; --json parses', async () => {
    const io = new MemoryIo();
    const code = await run(
      ['performance', 'https://example.com', '--json'],
      io,
      deps({ performanceProvider: fixtureGsc([{ key: 'widget', clicks: 10, impressions: 500, position: 4.5 }]) }),
    );
    expect(code).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as { rows: { key: string; clicks: number; source: { provider: string } }[] };
    expect(doc.rows[0]).toMatchObject({ key: 'widget', clicks: 10 });
    expect(doc.rows[0]?.source.provider).toBe('gsc');

    const human = new MemoryIo();
    await run(['performance', 'https://example.com'], human, deps({ performanceProvider: fixtureGsc([{ key: 'widget', clicks: 10, impressions: 500, position: 4.5 }]) }));
    expect(human.stdout.join('')).toContain('first-party');
    expect(human.stdout.join('')).toContain('widget');
  });

  it('without credentials AND without a fixture: typed ProviderUnconfigured naming the env var (exit 2)', async () => {
    const saved = process.env.LUMEN_GSC_CREDENTIALS;
    delete process.env.LUMEN_GSC_CREDENTIALS;
    const io = new MemoryIo();
    const code = await run(['performance', 'https://example.com'], io, deps());
    if (saved === undefined) delete process.env.LUMEN_GSC_CREDENTIALS;
    else process.env.LUMEN_GSC_CREDENTIALS = saved;
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('LUMEN_GSC_CREDENTIALS');
  });
});

describe('audit --with-gsc (E2.1)', () => {
  const auditDeps = (provider?: SearchPerformanceProvider): CommandDeps =>
    deps({
      performanceProvider: provider,
      auditRunner: {
        run: async () => ({
          id: 't',
          startedAt: '2026-09-29T12:00:00Z',
          completedAt: '2026-09-29T12:00:01Z',
          pages: [
            {
              url: 'https://example.com/a',
              status: 200,
              issues: [{ ruleId: 'title-missing', severity: 'error', message: 'm', evidence: {}, fixHint: 'f' }],
              score: 90,
              timingMs: 1,
              bytes: 1,
              robotsAllowed: true,
              depth: 0,
            },
          ],
          summary: {
            countsBySeverity: { error: 1, warning: 0, info: 0 },
            score: 90,
            pagesAudited: 1,
            pagesSkipped: 0,
            byRule: [{ ruleId: 'title-missing', severity: 'error', affectedPages: 1, sampleUrls: ['https://example.com/a'] }],
          },
          incomplete: false,
          configSnapshot: { seed: 'https://example.com' },
          stopReason: 'completed',
        }),
      },
    });

  it('annotates the group with summed clicks/impressions over ALL affected urls (json + human)', async () => {
    const gsc = fixtureGsc([
      { key: 'https://example.com/a', clicks: 5, impressions: 100, position: null },
      { key: 'https://example.com/b', clicks: 7, impressions: 40, position: null },
    ]);
    const io = new MemoryIo();
    const code = await run(['audit', 'https://example.com', '--with-gsc', '--json'], io, auditDeps(gsc));
    expect(code).toBe(1);
    const doc = JSON.parse(io.stdout.join('')) as { summary: { byRule: { traffic?: { clicks: number; impressions: number } }[] } };
    expect(doc.summary.byRule[0]?.traffic).toMatchObject({ clicks: 5, impressions: 100 });

    const human = new MemoryIo();
    await run(['audit', 'https://example.com', '--with-gsc'], human, auditDeps(gsc));
    expect(human.stdout.join('')).toContain('5 clicks/100 imps');
  });

  it('unconfigured (no env, no fixture): stderr note, findings unchanged', async () => {
    const saved = process.env.LUMEN_GSC_CREDENTIALS;
    delete process.env.LUMEN_GSC_CREDENTIALS;
    const io = new MemoryIo();
    const code = await run(['audit', 'https://example.com', '--with-gsc', '--json'], io, auditDeps());
    if (saved === undefined) delete process.env.LUMEN_GSC_CREDENTIALS;
    else process.env.LUMEN_GSC_CREDENTIALS = saved;
    expect(code).toBe(1);
    expect(io.stderr.join('')).toContain('GSC not configured');
    const doc = JSON.parse(io.stdout.join('')) as { summary: { byRule: { traffic?: unknown }[] } };
    expect(doc.summary.byRule[0]?.traffic).toBeUndefined();
  });
});

describe('rank prefers GSC (E2.1)', () => {
  it('a GSC row wins, labeled first-party; history records gsc; serp never called', async () => {
    let serpCalled = 0;
    const d = deps({
      performanceProvider: fixtureGsc([{ key: 'widget', clicks: 3, impressions: 50, position: 2.4 }]),
      serp: {
        name: 'fixture-serp',
        search: async () => {
          serpCalled += 1;
          return [];
        },
      },
    });
    const io = new MemoryIo();
    const code = await run(['rank', 'widget', '--domain', 'example.com', '--json'], io, d);
    expect(code).toBe(0);
    expect(serpCalled).toBe(0); // never double-spends
    const doc = JSON.parse(io.stdout.join('')) as { provider: string; position: number; source?: string };
    expect(doc.provider).toBe('gsc');
    expect(doc.position).toBe(2);
    expect(doc.source).toContain('first-party');
  });

  it('no GSC row for the keyword: falls through to the SERP path', async () => {
    const d = deps({
      performanceProvider: fixtureGsc([{ key: 'unrelated', clicks: 1, impressions: 2, position: 1 }]),
      serp: {
        name: 'fixture-serp',
        search: async () => [{ title: 't', url: 'https://example.com/x', position: 4, source: { provider: 'fixture-serp', kind: 'gray' } }],
      },
    });
    const io = new MemoryIo();
    const code = await run(['rank', 'widget', '--domain', 'example.com', '--json'], io, d);
    expect(code).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as { provider: string };
    expect(doc.provider).toBe('fixture-serp');
  });
});

describe('lumen indexnow submit (E2.2)', () => {
  const transportOf = (log: { method: string; url: string; body?: string }[]): FetchTransport => {
    const respond = (body: unknown, status = 200): Response =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    return async (url, init) => {
      log.push({ method: init?.method ?? 'GET', url: url.href, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.pathname === '/mykey.txt') return respond('mykey');
      if (url.pathname === '/wrong.txt') return respond('something-else');
      if (url.href === 'https://api.indexnow.org/indexnow') return respond('', 202);
      if (url.pathname === '/sitemap.xml') {
        return respond(
          '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>',
          200,
        );
      }
      return respond('nope', 404);
    };
  };
  const depsWith = (transport: FetchTransport): CommandDeps => ({ ...deps(), fetcher: createFetcher({ delegate: transport }) } as CommandDeps);
  const KEY_ENV = process.env.LUMEN_INDEXNOW_KEY;

  it('dry run by default: verification GET happens, NO POST, payload printed', async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    const io = new MemoryIo();
    process.env.LUMEN_INDEXNOW_KEY = 'mykey';
    const code = await run(['indexnow', 'submit', 'https://example.com/a', 'https://example.com/b'], io, depsWith(transportOf(log)));
    if (KEY_ENV === undefined) delete process.env.LUMEN_INDEXNOW_KEY;
    else process.env.LUMEN_INDEXNOW_KEY = KEY_ENV;
    expect(code).toBe(0);
    expect(io.stdout.join('')).toContain('DRY RUN');
    expect(io.stdout.join('')).toContain('api.indexnow.org');
    expect(log.some((l) => l.method === 'POST')).toBe(false); // nothing sent
    expect(log.some((l) => l.url.endsWith('/mykey.txt'))).toBe(true); // verified first
  });

  it('--yes POSTs the exact payload per host and reports acceptance', async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    const io = new MemoryIo();
    process.env.LUMEN_INDEXNOW_KEY = 'mykey';
    const code = await run(['indexnow', 'submit', '--yes', 'https://example.com/a'], io, depsWith(transportOf(log)));
    if (KEY_ENV === undefined) delete process.env.LUMEN_INDEXNOW_KEY;
    else process.env.LUMEN_INDEXNOW_KEY = KEY_ENV;
    expect(code).toBe(0);
    const post = log.find((l) => l.method === 'POST');
    expect(post?.url).toBe('https://api.indexnow.org/indexnow');
    const payload = JSON.parse(post?.body ?? '{}') as { host: string; key: string; urlList: string[] };
    expect(payload).toMatchObject({ host: 'example.com', key: 'mykey', urlList: ['https://example.com/a'] });
    expect(io.stdout.join('')).toContain('accepted');
  });

  it('a mismatching key file refuses with exit 2 and NO POST', async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    const io = new MemoryIo();
    const code = await run(['indexnow', 'submit', '--key', 'wrong', '--yes', 'https://example.com/a'], io, depsWith(transportOf(log)));
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('key verification failed');
    expect(log.some((l) => l.method === 'POST')).toBe(false);
  });

  it('--from-sitemap submits the sitemap urls', async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    const io = new MemoryIo();
    process.env.LUMEN_INDEXNOW_KEY = 'mykey';
    const code = await run(['indexnow', 'submit', '--from-sitemap', 'https://example.com/sitemap.xml', '--yes'], io, depsWith(transportOf(log)));
    if (KEY_ENV === undefined) delete process.env.LUMEN_INDEXNOW_KEY;
    else process.env.LUMEN_INDEXNOW_KEY = KEY_ENV;
    expect(code).toBe(0);
    const post = JSON.parse(log.find((l) => l.method === 'POST')?.body ?? '{}') as { urlList: string[] };
    expect(post.urlList).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('no key: typed usage error naming the flag/env', async () => {
    const saved = process.env.LUMEN_INDEXNOW_KEY;
    delete process.env.LUMEN_INDEXNOW_KEY;
    const io = new MemoryIo();
    const code = await run(['indexnow', 'submit', 'https://example.com/a'], io, depsWith(transportOf([])));
    if (saved === undefined) delete process.env.LUMEN_INDEXNOW_KEY;
    else process.env.LUMEN_INDEXNOW_KEY = saved;
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('--key');
  });
});

void { fetcherType: null as unknown as Fetcher };

describe('review hardening (agent_49103841)', () => {
  const transportOf2 = (log: { method: string; url: string; body?: string }[]): FetchTransport => {
    const respond = (body: unknown, status = 200): Response =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    return async (url, init) => {
      log.push({ method: init?.method ?? 'GET', url: url.href, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.pathname === '/mykey.txt') return respond('mykey');
      if (url.href === 'https://api.indexnow.org/indexnow') return respond('', 202);
      if (url.pathname === '/sitemap.xml') return respond('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc></url><url><loc>https://evil.com/x</loc></url></urlset>');
      return respond('nope', 404);
    };
  };
  const gscDeps = (): CommandDeps => ({ ...deps(), fetcher: createFetcher({ delegate: transportOf2([]) }) } as CommandDeps);
  void gscDeps;

  it('indexnow verifies ALL hosts before ANY POST (multi-host atomicity)', async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    const transport: FetchTransport = async (url, init) => {
      log.push({ method: init?.method ?? 'GET', url: url.href });
      if (url.host === 'good.example' && url.pathname === '/mykey.txt') return new Response('mykey');
      if (url.host === 'bad.example' && url.pathname === '/mykey.txt') return new Response('wrong', { status: 200 });
      if (url.href === 'https://api.indexnow.org/indexnow') return new Response('', { status: 202 });
      return new Response('nope', { status: 404 });
    };
    process.env.LUMEN_INDEXNOW_KEY = 'mykey';
    const io = new MemoryIo();
    const code = await run(
      ['indexnow', 'submit', '--yes', 'https://good.example/a', 'https://bad.example/b'],
      io,
      { ...deps(), fetcher: createFetcher({ delegate: transport }) } as CommandDeps,
    );
    delete process.env.LUMEN_INDEXNOW_KEY;
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('key verification failed');
    expect(log.some((l) => l.method === 'POST')).toBe(false); // atomic: nothing sent when ANY host fails
  });

  it('--from-sitemap drops cross-origin locs and caps the list', async () => {
    const log: { method: string; url: string; body?: string }[] = [];
    process.env.LUMEN_INDEXNOW_KEY = 'mykey';
    const io = new MemoryIo();
    const code = await run(
      ['indexnow', 'submit', '--from-sitemap', 'https://example.com/sitemap.xml', '--yes'],
      io,
      { ...deps(), fetcher: createFetcher({ delegate: transportOf2(log) }) } as CommandDeps,
    );
    delete process.env.LUMEN_INDEXNOW_KEY;
    expect(code).toBe(0);
    const post = JSON.parse(log.find((l) => l.method === 'POST')?.body ?? '{}') as { urlList: string[] };
    expect(post.urlList).toEqual(['https://example.com/a']); // evil.com dropped (cross-origin)
  });

  it('args rules: unknown subcommand / no urls / urls+sitemap conflict', async () => {
    const io1 = new MemoryIo();
    expect(await run(['indexnow', 'push', 'https://example.com/a'], io1, gscDeps())).toBe(2);
    expect(io1.stderr.join('')).toContain('only "lumen indexnow submit"');
    const io2 = new MemoryIo();
    expect(await run(['indexnow', 'submit'], io2, gscDeps())).toBe(2);
    expect(io2.stderr.join('')).toContain('at least one URL');
    const io3 = new MemoryIo();
    expect(await run(['indexnow', 'submit', 'https://example.com/a', '--from-sitemap', 'https://example.com/sitemap.xml'], io3, gscDeps())).toBe(2);
    expect(io3.stderr.join('')).toContain('not both');
  });

  it('performance accepts sc-domain: passthrough (domain properties)', async () => {
    const io = new MemoryIo();
    const code = await run(['performance', 'sc-domain:example.com', '--json'], io, deps({ performanceProvider: {
      name: 'gsc-fixture',
      performance: async (site) => ({ site: site.href, startDate: '2026-09-01', endDate: '2026-09-29', by: 'query', rows: [] }),
    } }));
    expect(code).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as { site: string };
    expect(doc.site).toBe('sc-domain:example.com'); // threaded through, not rewritten
  });

  it('keywords renders the exact volume (E2.2 headline number)', async () => {
    const io = new MemoryIo();
    const code = await run(
      ['keywords', 'widget'],
      io,
      deps({
        keywords: [
          {
            name: 'bing-fixture',
            ideas: async () => [
              { term: 'widget shop', source: { provider: 'bing-webmaster', kind: 'official' }, volume: 1234 },
            ],
          },
        ],
      }),
    );
    expect(code).toBe(0);
    expect(io.stdout.join('')).toContain('1,234 vol/mo (exact)');
  });

  it('rank degrades to SERP with a stderr note when GSC errors', async () => {
    const d = deps({
      performanceProvider: {
        name: 'gsc-broken',
        performance: async () => {
          throw new Error('GSC credentials file not valid JSON');
        },
      },
      serp: {
        name: 'fixture-serp',
        search: async () => [{ title: 't', url: 'https://example.com/x', position: 6, source: { provider: 'fixture-serp', kind: 'gray' } }],
      },
    });
    const io = new MemoryIo();
    const code = await run(['rank', 'widget', '--domain', 'example.com', '--json'], io, d);
    expect(code).toBe(0);
    expect(io.stderr.join('')).toContain('GSC unavailable');
    const doc = JSON.parse(io.stdout.join('')) as { provider: string };
    expect(doc.provider).toBe('fixture-serp');
  });
});
