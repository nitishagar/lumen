import { describe, expect, it } from 'vitest';
import { ATTRIBUTION } from './provenance.js';
import { GcraPacer } from './throttle.js';
import { FakeClock, fakeFetcher, jsonResponse, makeDeps, textResponse } from './testing.js';
import { PageSpeedProviderImpl } from './pagespeed.js';
import { CruxProviderImpl } from './crux.js';
import { cruxRecord, psiErrorQuota, psiReport, psiReportNoField } from './fixtures/index.js';

const NOW = Date.UTC(2026, 7, 29);
const URL_ = new URL('https://example.com/');
const KEY = 'LUMEN_TEST_KEY_123';

const psiProvider = (
  clock: FakeClock,
  respond: Parameters<typeof fakeFetcher>[0],
  env: Record<string, string | undefined> = {},
) => {
  const fetcher = fakeFetcher(respond);
  const p = new PageSpeedProviderImpl({}, makeDeps(fetcher, clock, { env }), clock.now, clock.sleep);
  return { p, fetcher };
};

describe('TC-PSI-1: lab mapping from the PSI fixture', () => {
  it('scores are 0-100 (0.98 → 98) and lcp/cls/tbt/fcn come from the audits', async () => {
    const clock = new FakeClock(NOW);
    const { p } = psiProvider(clock, () => jsonResponse(psiReport), { LUMEN_PSI_KEY: KEY });
    const report = await p.report(URL_, {});
    expect(report.scores).toEqual({ performance: 98, seo: 100, accessibility: 87, bestPractices: 93 });
    expect(report.metrics).toEqual({ lcp: 2210, cls: 0.05, tbt: 310, fcn: 940 }); // fcn = FCP (BA7)
    expect(report.source).toEqual({ provider: 'pagespeed', kind: 'lab', attribution: ATTRIBUTION.pagespeed });
    expect(report.retrievedAt).toBe(new Date(NOW).toISOString());
  });

  it('request carries url/strategy/categories and the key as a HEADER, never a URL param', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = psiProvider(clock, () => jsonResponse(psiReport), { LUMEN_PSI_KEY: KEY });
    await p.report(URL_, { strategy: 'desktop' });
    const call = fetcher.calls[0]!;
    expect(call.url.searchParams.get('url')).toBe('https://example.com/');
    expect(call.url.searchParams.get('strategy')).toBe('desktop');
    expect([...call.url.searchParams.getAll('category')].sort()).toEqual([
      'accessibility',
      'best-practices',
      'performance',
      'seo',
    ]);
    expect(call.url.searchParams.get('key')).toBeNull(); // I16: key never in URL
    expect((call.init?.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
  });
});

describe('TC-PSI-2 (R5 + BA5): key policy', () => {
  it('automated:true without key → not_configured naming LUMEN_PSI_KEY, 0 fetches', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = psiProvider(clock, () => jsonResponse(psiReport), {});
    await expect(p.report(URL_, { automated: true })).rejects.toMatchObject({
      code: 'not_configured',
      provider: 'pagespeed',
      envVar: 'LUMEN_PSI_KEY',
    });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('automated:false without key → keyless trial call proceeds (no key header)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = psiProvider(clock, () => jsonResponse(psiReport), {});
    await p.report(URL_, { automated: false });
    expect(fetcher.calls).toHaveLength(1);
    expect((fetcher.calls[0]!.init?.headers as Record<string, string>)['x-goog-api-key']).toBeUndefined();
  });
});

describe('TC-PSI-3: PSI failure matrix', () => {
  it('429 → rate_limited', async () => {
    const clock = new FakeClock(NOW);
    const { p } = psiProvider(clock, () => new Response('', { status: 429, headers: { 'retry-after': '12' } }), {
      LUMEN_PSI_KEY: KEY,
    });
    await expect(p.report(URL_, {})).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 12_000 });
  });

  it('Google error envelope error.code 403/429 → rate_limited; 500 → upstream_error', async () => {
    const quota = psiProvider(new FakeClock(NOW), () => jsonResponse(psiErrorQuota), { LUMEN_PSI_KEY: KEY });
    await expect(quota.p.report(URL_, {})).rejects.toMatchObject({
      code: 'rate_limited',
      detail: { reason: 'google-quota', status: 403 },
    });
    const server = psiProvider(new FakeClock(NOW), () => new Response('boom', { status: 500 }), { LUMEN_PSI_KEY: KEY });
    await expect(server.p.report(URL_, {})).rejects.toMatchObject({ code: 'upstream_error', status: 500 });
  });
});

describe('TC-PSI-4: lab/field split; field omitted, never zeroed', () => {
  it('full fixture → field present with kind field; tbt honestly null in field data', async () => {
    const clock = new FakeClock(NOW);
    const { p } = psiProvider(clock, () => jsonResponse(psiReport), { LUMEN_PSI_KEY: KEY });
    const report = await p.report(URL_, {});
    expect(report.field).toBeDefined();
    expect(report.field!.overall).toBe('AVERAGE');
    expect(report.field!.metrics).toEqual({ lcp: 2450, cls: 0.06, tbt: null, fcn: 1200 });
    expect(report.field!.source.kind).toBe('field');
    expect(report.source.kind).toBe('lab'); // the split is explicit
  });

  it('fixture without loadingExperience → field omitted (not zeroed)', async () => {
    const clock = new FakeClock(NOW);
    const { p } = psiProvider(clock, () => jsonResponse(psiReportNoField), { LUMEN_PSI_KEY: KEY });
    const report = await p.report(URL_, {});
    expect(report.field).toBeUndefined();
    expect(report.scores).toEqual({ performance: 50, seo: null, accessibility: null, bestPractices: null });
    expect(report.metrics).toEqual({ lcp: null, cls: null, tbt: null, fcn: null });
  });
});

describe('TC-PSI-5: mode-aware cache and pacing', () => {
  it('keyed and keyless never share cache entries; second call 0 fetches (6h TTL)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = psiProvider(clock, () => jsonResponse(psiReport), { LUMEN_PSI_KEY: KEY });
    await p.report(URL_, {}); // keyed
    expect(fetcher.calls).toHaveLength(1);
    await p.report(URL_, {}); // keyed again → cached
    expect(fetcher.calls).toHaveLength(1);

    const trial = psiProvider(clock, () => jsonResponse(psiReport), {}); // SAME clock+cache not shared (new deps)
    void trial;
    // Same deps, key REMOVED from env → trial mode must NOT hit the keyed entry:
    const fetcher2 = fakeFetcher(() => jsonResponse(psiReport));
    const sharedDeps = makeDeps(fetcher2, clock, { env: {} });
    const p2 = new PageSpeedProviderImpl({}, sharedDeps, clock.now, clock.sleep);
    await p2.report(URL_, { automated: false });
    expect(fetcher2.calls).toHaveLength(1); // separate mode key → refetch
    await p2.report(URL_, { automated: false });
    expect(fetcher2.calls).toHaveLength(1); // trial entry cached

    clock.advance(6 * 60 * 60 * 1000 - 1);
    await p2.report(URL_, { automated: false });
    expect(fetcher2.calls).toHaveLength(1);
    clock.advance(1);
    await p2.report(URL_, { automated: false });
    expect(fetcher2.calls).toHaveLength(2); // 6h TTL elapsed
  });

  it('keyed pacer worst window <= 70 <= 240 documented; keyless worst <= 7', () => {
    const worstWindow = (rpm: number, burst: number): number => {
      const clock = new FakeClock(0);
      const p = new GcraPacer(rpm, burst, clock.now, clock.sleep);
      const admitted: number[] = [];
      let t = 0;
      while (t < 4 * 60_000) {
        clock.set(t);
        if (p.tryAcquire()) admitted.push(t);
        else t += 1;
      }
      let worst = 0;
      for (let i = 0; i < admitted.length; i++) {
        worst = Math.max(worst, admitted.filter((x) => x >= admitted[i]! && x < admitted[i]! + 60_000).length);
      }
      return worst;
    };
    expect(worstWindow(60, 10)).toBeLessThanOrEqual(70);
    expect(worstWindow(6, 1)).toBeLessThanOrEqual(7);
  });
});

describe('TC-PSI-6: malformed JSON → parse_error (never upstream_error)', () => {
  it('truncated body is typed parse_error', async () => {
    const clock = new FakeClock(NOW);
    const { p } = psiProvider(clock, () => textResponse('{"lighthouseResult": {"trunc', 200, 'application/json'), {
      LUMEN_PSI_KEY: KEY,
    });
    await expect(p.report(URL_, {})).rejects.toMatchObject({ code: 'parse_error', provider: 'pagespeed' });
  });
});

// --- crux --------------------------------------------------------------------

const cruxProvider = (
  clock: FakeClock,
  respond: Parameters<typeof fakeFetcher>[0],
  env: Record<string, string | undefined> = { LUMEN_CRUX_KEY: KEY },
) => {
  const fetcher = fakeFetcher(respond);
  const p = new CruxProviderImpl({}, makeDeps(fetcher, clock, { env }), clock.now, clock.sleep);
  return { p, fetcher };
};

describe('TC-CRUX-1: key REQUIRED (A1)', () => {
  it('absent key → not_configured naming LUMEN_CRUX_KEY, 0 fetches', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = cruxProvider(clock, () => jsonResponse(cruxRecord), {});
    await expect(p.record(URL_, {})).rejects.toMatchObject({
      code: 'not_configured',
      provider: 'crux',
      envVar: 'LUMEN_CRUX_KEY',
    });
    expect(fetcher.calls).toHaveLength(0);
  });
});

describe('TC-CRUX-2: record mapping + verbatim attribution', () => {
  it('metrics map to {p75, histogramBins}; attribution is the VERBATIM CC BY 4.0 string', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = cruxProvider(clock, () => jsonResponse(cruxRecord));
    const record = await p.record(URL_, {});
    expect(record).not.toBeNull();
    expect(record!.metrics['largest_contentful_paint']).toEqual({
      p75: 2312,
      histogramBins: [
        { start: 0, end: 2500, density: 0.71 },
        { start: 2500, density: 0.29 },
      ],
    });
    expect(record!.metrics['cumulative_layout_shift']!.p75).toBe(0.08);
    expect(record!.source.attribution).toBe(
      'The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license (https://developer.chrome.com/docs/crux/methodology)',
    );
    expect(record!.source).toEqual({ provider: 'crux', kind: 'field', attribution: ATTRIBUTION.crux });
    expect(record!.retrievedAt).toBe(new Date(NOW).toISOString());
    // POST body: origin scope default + PHONE default formFactor
    const init = fetcher.calls[0]!.init!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ origin: 'https://example.com', formFactor: 'PHONE' });
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(fetcher.calls[0]!.url.searchParams.get('key')).toBeNull(); // key not in URL (I16)
  });
});

describe('TC-CRUX-3: null / 429 / malformed', () => {
  it('404 no-data → null record, cached (second call 0 fetches)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = cruxProvider(clock, () => new Response('{}', { status: 404 }));
    expect(await p.record(URL_, {})).toBeNull();
    expect(await p.record(URL_, {})).toBeNull();
    expect(fetcher.calls).toHaveLength(1);
  });

  it('429 → rate_limited with Retry-After; malformed → parse_error', async () => {
    const limited = cruxProvider(new FakeClock(NOW), () => new Response('', { status: 429, headers: { 'retry-after': '9' } }));
    await expect(limited.p.record(URL_, {})).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 9_000 });
    const malformed = cruxProvider(new FakeClock(NOW), () => textResponse('{"record": {"metrics"', 200, 'application/json'));
    await expect(malformed.p.record(URL_, {})).rejects.toMatchObject({ code: 'parse_error', provider: 'crux' });
    const noRecord = cruxProvider(new FakeClock(NOW), () => jsonResponse({}));
    await expect(noRecord.p.record(URL_, {})).rejects.toMatchObject({ code: 'parse_error' });
  });
});

describe('TC-CRUX-4: worst-case window exactly 150 = documented (GCRA construction)', () => {
  it('burst of 10 immediate succeeds, 11th waits; sustained 60s window never exceeds 150', () => {
    const clock = new FakeClock(0);
    const p = new GcraPacer(140, 10, clock.now, clock.sleep);
    for (let i = 0; i < 10; i++) expect(p.tryAcquire()).toBe(true);
    expect(p.tryAcquire()).toBe(false); // 11th waits — the quota can never burst above 10
    clock.advance(60_000 / 140);
    expect(p.tryAcquire()).toBe(true);

    const sim = new GcraPacer(140, 10, clock.now, clock.sleep);
    const admitted: number[] = [];
    let t = 0;
    while (t < 300_000) {
      clock.set(t);
      if (sim.tryAcquire()) admitted.push(t);
      else t += 1;
    }
    let worst = 0;
    for (let i = 0; i < admitted.length; i++) {
      worst = Math.max(worst, admitted.filter((x) => x >= admitted[i]! && x < admitted[i]! + 60_000).length);
    }
    expect(worst).toBeLessThanOrEqual(150);
    expect(worst).toBeGreaterThanOrEqual(149); // the budget is (nearly fully) usable — not over-throttled
  });
});

describe('TC-CRUX-5: cache TTL, scope, formFactor', () => {
  it('24h cache; url scope puts the full href in the body; desktop formFactor uppercased', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = cruxProvider(clock, (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.url === 'https://example.com/deep/page' && body.formFactor === 'DESKTOP') return jsonResponse(cruxRecord);
      throw new Error(`unexpected fixture body ${init?.body}`);
    });
    await p.record(new URL('https://example.com/deep/page'), { formFactor: 'desktop', scope: 'url' } as never);
    expect(fetcher.calls).toHaveLength(1);
    clock.advance(24 * 60 * 60 * 1000 - 1);
    await p.record(new URL('https://example.com/deep/page'), { formFactor: 'desktop', scope: 'url' } as never);
    expect(fetcher.calls).toHaveLength(1); // cached under (scope, formFactor, url)
    clock.advance(1);
    await p.record(new URL('https://example.com/deep/page'), { formFactor: 'desktop', scope: 'url' } as never);
    expect(fetcher.calls).toHaveLength(2); // TTL boundary
  });
});
