import { describe, expect, it } from 'vitest';
import { InMemoryCache } from './cache.js';
import { OpenPageRankProvider } from './openpagerank.js';
import { TrancoProvider } from './tranco.js';
import { ATTRIBUTION } from './provenance.js';
import { GcraPacer } from './throttle.js';
import { FakeClock, fakeFetcher, jsonResponse, makeDeps, textResponse } from './testing.js';
import { oprDomainError, oprQuotaError, oprSingle, trancoCsv, trancoMeta } from './fixtures/index.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 29); // 2026-08-29T00:00:00Z
const KEY = 'LUMEN_TEST_KEY_123';

const oprProvider = (
  clock: FakeClock,
  respond: Parameters<typeof fakeFetcher>[0],
  env: Record<string, string | undefined> = { LUMEN_OPR_KEY: KEY },
) => {
  const fetcher = fakeFetcher(respond);
  const p = new OpenPageRankProvider({}, makeDeps(fetcher, clock, { env }), clock.now, clock.sleep);
  return { p, fetcher };
};

describe('TC-OPR-1: key REQUIRED', () => {
  it('absent key → not_configured naming LUMEN_OPR_KEY, 0 fetches', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = oprProvider(clock, () => jsonResponse(oprSingle), {});
    await expect(p.authority('example.com', {})).rejects.toMatchObject({
      code: 'not_configured',
      provider: 'openpagerank',
      envVar: 'LUMEN_OPR_KEY',
    });
    expect(fetcher.calls).toHaveLength(0);
  });
});

describe('TC-OPR-2: per-domain request shape + signals', () => {
  it('carries exactly domains[0]=example.com and a Bearer header; fixture yields score + rank signals', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = oprProvider(clock, () => jsonResponse(oprSingle));
    const signals = await p.authority('https://Example.com/path', {});
    expect(fetcher.calls).toHaveLength(1);
    const url = fetcher.calls[0]!.url;
    expect(url.href).toBe('https://openpagerank.com/api/v1.0/getPageRank?domains%5B0%5D=example.com');
    expect(url.searchParams.get('domains[0]')).toBe('example.com'); // documented bulk param, single element (BA8)
    expect((fetcher.calls[0]!.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(signals).toHaveLength(2);
    for (const s of signals) {
      expect(s.domain).toBe('example.com');
      expect(s.provider).toBe('openpagerank');
      expect(s.attribution).toBe(ATTRIBUTION.openpagerank);
      expect(s.estimateLabel).toMatch(/proxy/);
      expect(s.retrievedAt).toBe(new Date(NOW).toISOString());
    }
    expect(signals.find((s) => s.kind === 'score')!.value).toBe(6.15);
    expect(signals.find((s) => s.kind === 'rank')!.value).toBe(4821);
  });

  it('the module contains no batch loop over domains (source assertion)', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('./openpagerank.ts', import.meta.url), 'utf8'));
    expect(source).not.toMatch(/domains\[\$\{i\}\]|for\s*\(.*domains|\.map\(.*domains\[/);
    expect(source).toContain('domains[0]');
  });
});

describe('TC-OPR-3: per-domain error matrix', () => {
  it('per-domain error/non-200 → signals omitted ([]) with no value: undefined', async () => {
    const clock = new FakeClock(NOW);
    const { p } = oprProvider(clock, () => jsonResponse(oprDomainError));
    expect(await p.authority('nope.example', {})).toEqual([]);
  });

  it('non-finite values are omitted from signals, never value: undefined', async () => {
    const clock = new FakeClock(NOW);
    const body = JSON.stringify({ domains: [{ domain: 'x.example', page_rank_decimal: null, rank: 'not-a-number' }] });
    const { p } = oprProvider(clock, () => jsonResponse(body));
    expect(await p.authority('x.example', {})).toEqual([]);
  });

  it('quota-error fixture → rate_limited with reason monthly-quota; 429 → RateLimitedError w/ Retry-After; 503 → upstream; malformed → parse_error', async () => {
    const quota = oprProvider(new FakeClock(NOW), () => jsonResponse(oprQuotaError));
    await expect(quota.p.authority('example.com', {})).rejects.toMatchObject({
      code: 'rate_limited',
      detail: { reason: 'monthly-quota' },
    });
    const limited = oprProvider(new FakeClock(NOW), () => new Response('', { status: 429, headers: { 'retry-after': '5' } }));
    await expect(limited.p.authority('example.com', {})).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 5_000,
    });
    const down = oprProvider(new FakeClock(NOW), () => new Response('oops', { status: 503 }));
    await expect(down.p.authority('example.com', {})).rejects.toMatchObject({ code: 'upstream_error', status: 503 });
    const malformed = oprProvider(new FakeClock(NOW), () => textResponse('{oops', 200, 'application/json'));
    await expect(malformed.p.authority('example.com', {})).rejects.toMatchObject({ code: 'parse_error' });
  });
});

describe('TC-OPR-4: pacing exactly 60/min = documented; 30d per-domain cache', () => {
  it('worst rolling window is exactly 60 = documented limit', () => {
    const clock = new FakeClock(0);
    const p = new GcraPacer(50, 10, clock.now, clock.sleep);
    const admitted: number[] = [];
    let t = 0;
    while (t < 300_000) {
      clock.set(t);
      if (p.tryAcquire()) admitted.push(t);
      else t += 1;
    }
    let worst = 0;
    for (let i = 0; i < admitted.length; i++) {
      worst = Math.max(worst, admitted.filter((x) => x >= admitted[i]! && x < admitted[i]! + 60_000).length);
    }
    expect(worst).toBeLessThanOrEqual(60);
    expect(worst).toBeGreaterThanOrEqual(59); // budget (nearly fully) usable
  });

  it('repeat domain = 0 fetches (30d TTL)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = oprProvider(clock, () => jsonResponse(oprSingle));
    await p.authority('example.com', {});
    await p.authority('example.com', {});
    expect(fetcher.calls).toHaveLength(1);
    clock.advance(30 * DAY - 1);
    await p.authority('example.com', {});
    expect(fetcher.calls).toHaveLength(1);
    clock.advance(1);
    await p.authority('example.com', {});
    expect(fetcher.calls).toHaveLength(2);
  });
});

// --- tranco --------------------------------------------------------------------

const trancoProvider = (
  clock: FakeClock,
  respond: Parameters<typeof fakeFetcher>[0],
  cfg?: ConstructorParameters<typeof TrancoProvider>[0],
  cache?: InMemoryCache,
) => {
  const fetcher = fakeFetcher(respond);
  const p = new TrancoProvider(cfg, makeDeps(fetcher, clock, { cache }));
  return { p, fetcher };
};

const trancoHappy = (fetchLog: URL[] = []) => (url: URL) => {
  fetchLog.push(url);
  if (url.pathname.startsWith('/api/lists/date/')) return jsonResponse(trancoMeta);
  if (url.pathname === '/download/L5ZQ4') return textResponse(trancoCsv, 200, 'text/csv');
  throw new Error(`unexpected fixture URL ${url.href}`);
};

describe('TC-TRC-1: download + index happy path', () => {
  it('meta + CSV → correct rank lookups with community kind, attribution, and label', async () => {
    const clock = new FakeClock(NOW);
    const urls: URL[] = [];
    const { p, fetcher } = trancoProvider(clock, trancoHappy(urls));
    const signals = await p.authority('example.com', {});
    expect(fetcher.calls).toHaveLength(2); // exactly 1 meta GET + 1 CSV
    expect(urls[0]!.pathname).toBe(`/api/lists/date/2026-08-29`);
    expect(urls[1]!.href).toBe('https://tranco-list.eu/download/L5ZQ4');
    expect(signals).toHaveLength(1);
    const signal = signals[0]!;
    expect(signal).toMatchObject({
      domain: 'example.com',
      kind: 'rank',
      value: 4,
      provider: 'tranco',
      attribution: ATTRIBUTION.tranco,
      retrievedAt: new Date(NOW).toISOString(),
    });
    expect(signal.estimateLabel).toBe('Tranco rank (list L5ZQ4, 2026-08-29, top 5)');
    expect(await p.authority('google.com', {})).toMatchObject([{ value: 1 }]);
  });
});

describe('TC-TRC-2: row cap + normalization', () => {
  it('CSV is capped at maxRows (fixture 105 rows, maxRows 100)', async () => {
    const clock = new FakeClock(NOW);
    const rows = Array.from({ length: 105 }, (_, i) => `${i + 1},domain${i + 1000}.example`).join('\n') + '\n';
    const { p } = trancoProvider(
      clock,
      (url) =>
        url.pathname.startsWith('/api/lists/date/')
          ? jsonResponse(trancoMeta)
          : textResponse(rows, 200, 'text/csv'),
      { maxRows: 100 },
    );
    const inList = await p.authority('domain1000.example', {});
    const beyondCap = await p.authority('domain1104.example', {}); // row 105 — capped out
    expect(inList).toMatchObject([{ value: 1 }]);
    expect(beyondCap).toEqual([]);
  });

  it('domains are normalized (case, scheme/path, trailing dot) before lookup', async () => {
    const clock = new FakeClock(NOW);
    const { p } = trancoProvider(clock, trancoHappy());
    expect(await p.authority('https://EXAMPLE.com./deep/path', {})).toMatchObject([{ domain: 'example.com', value: 4 }]);
  });

  it('domain outside the list → [] (never rank 0)', async () => {
    const clock = new FakeClock(NOW);
    const { p } = trancoProvider(clock, trancoHappy());
    expect(await p.authority('not-in-list.example', {})).toEqual([]);
  });
});

describe('TC-TRC-3: date walk, all-404 first run, freshness windows', () => {
  it("today's meta 404 → walks back ≤3 days and succeeds on an older date", async () => {
    const clock = new FakeClock(NOW);
    const metaDates: string[] = [];
    const { p, fetcher } = trancoProvider(clock, (url) => {
      if (url.pathname.startsWith('/api/lists/date/')) {
        metaDates.push(url.pathname.slice('/api/lists/date/'.length));
        return url.pathname.endsWith('2026-08-27')
          ? jsonResponse(trancoMeta)
          : new Response('{}', { status: 404 });
      }
      return textResponse(trancoCsv, 200, 'text/csv');
    });
    const signals = await p.authority('example.com', {});
    expect(metaDates).toEqual(['2026-08-29', '2026-08-28', '2026-08-27']); // walk-back, 3rd attempt hit
    expect(fetcher.calls).toHaveLength(4); // 3 meta + 1 CSV
    expect(signals[0]!.estimateLabel).toContain('2026-08-27');
  });

  it('all 4 dates 404 on FIRST run → upstream_error with 0 CSV fetches', async () => {
    const clock = new FakeClock(NOW);
    let csvFetches = 0;
    const { p, fetcher } = trancoProvider(clock, (url) => {
      if (url.pathname.startsWith('/api/lists/date/')) return new Response('{}', { status: 404 });
      csvFetches++;
      return textResponse(trancoCsv, 200, 'text/csv');
    });
    await expect(p.authority('example.com', {})).rejects.toMatchObject({
      code: 'upstream_error',
      provider: 'tranco',
      message: expect.stringContaining('no Tranco list published in the last 3 days'),
    });
    expect(fetcher.calls).toHaveLength(4); // 4 meta GETs, no CSV
    expect(csvFetches).toBe(0);
  });

  it('cached list within the refresh window → 0 fetches; 7-14d refresh failure → served with disclosed staleness', async () => {
    const clock = new FakeClock(NOW);
    const cache = new InMemoryCache(clock.now);
    const { p: first } = trancoProvider(clock, trancoHappy(), undefined, cache);
    await first.authority('example.com', {}); // populate the cache

    clock.advance(5 * DAY);
    const { p: fresh, fetcher: f1 } = trancoProvider(clock, () => {
      throw new Error('must not fetch — cache is fresh');
    }, undefined, cache);
    expect(await fresh.authority('example.com', {})).toMatchObject([{ value: 4 }]);
    expect(f1.calls).toHaveLength(0);

    clock.advance(3 * DAY); // 8d old — past refresh window, inside 14d ceiling
    const { p: stale, fetcher: f2 } = trancoProvider(clock, () => new Response('{}', { status: 404 }), undefined, cache);
    const signals = await stale.authority('example.com', {});
    expect(f2.calls).toHaveLength(4); // refresh attempted (all 404)…
    expect(signals[0]!.estimateLabel).toContain('list fetched 8d ago'); // …and stale served, disclosed
  });

  it('cached list >14d with failed refresh → typed stale_cache', async () => {
    const clock = new FakeClock(NOW);
    const cache = new InMemoryCache(clock.now);
    const { p: first } = trancoProvider(clock, trancoHappy(), undefined, cache);
    await first.authority('example.com', {});
    clock.advance(15 * DAY);
    const { p: stale } = trancoProvider(clock, () => new Response('{}', { status: 404 }), undefined, cache);
    await expect(stale.authority('example.com', {})).rejects.toMatchObject({
      code: 'stale_cache',
      provider: 'tranco',
    });
  });

  it('successful refresh after the window replaces the list', async () => {
    const clock = new FakeClock(NOW);
    const cache = new InMemoryCache(clock.now);
    const { p: first } = trancoProvider(clock, trancoHappy(), undefined, cache);
    await first.authority('example.com', {});
    clock.advance(8 * DAY);
    const rows = '1,example.com\n'; // new list: example.com is now #1
    const { p: refreshed } = trancoProvider(clock, (url) => {
      if (url.pathname.startsWith('/api/lists/date/')) return jsonResponse(trancoMeta);
      return textResponse(rows, 200, 'text/csv');
    }, undefined, cache);
    expect(await refreshed.authority('example.com', {})).toMatchObject([{ value: 1 }]);
  });
});

describe('TC-TRC-4: attribution on every signal (A7/I8)', () => {
  it('every emitted signal carries the Tranco attribution verbatim', async () => {
    const clock = new FakeClock(NOW);
    const { p } = trancoProvider(clock, trancoHappy());
    for (const domain of ['google.com', 'example.com', 'wikipedia.org']) {
      const signals = await p.authority(domain, {});
      expect(signals.length).toBeGreaterThan(0);
      expect(signals.every((s) => s.attribution === ATTRIBUTION.tranco)).toBe(true);
    }
  });
});

describe('tranco misc failure mapping', () => {
  it('meta 5xx on first date → upstream_error; malformed meta JSON → parse_error; empty CSV → parse_error', async () => {
    const fiveHundred = trancoProvider(new FakeClock(NOW), () => new Response('oops', { status: 500 }));
    await expect(fiveHundred.p.authority('example.com', {})).rejects.toMatchObject({ code: 'upstream_error', status: 500 });

    const malformed = trancoProvider(new FakeClock(NOW), (url) =>
      url.pathname.startsWith('/api/lists/date/') ? textResponse('{bad', 200, 'application/json') : textResponse('', 200, 'text/csv'),
    );
    await expect(malformed.p.authority('example.com', {})).rejects.toMatchObject({ code: 'parse_error' });

    const emptyCsv = trancoProvider(new FakeClock(NOW), (url) =>
      url.pathname.startsWith('/api/lists/date/') ? jsonResponse(trancoMeta) : textResponse('\n', 200, 'text/csv'),
    );
    await expect(emptyCsv.p.authority('example.com', {})).rejects.toMatchObject({ code: 'parse_error' });
  });
});
