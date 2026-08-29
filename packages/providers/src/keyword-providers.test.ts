import { describe, expect, it } from 'vitest';
import { GcraPacer } from './throttle.js';
import { FakeClock, fakeFetcher, htmlResponse, jsonResponse, makeDeps, textResponse } from './testing.js';
import { GoogleSuggestProvider } from './google-suggest.js';
import { WikipediaDemandProvider } from './wikipedia-demand.js';
import {
  googleSuggestJson,
  wikiPageviews,
  wikiPageviewsTotal,
  wikiTitleHit,
  wikiTitleMiss,
} from './fixtures/index.js';

const DAY = 24 * 60 * 60 * 1000;
/** 2026-08-29T00:00:00Z — fixed "today" for the wikipedia window math. */
const NOW = Date.UTC(2026, 7, 29);

const suggestProvider = (clock: FakeClock, respond: Parameters<typeof fakeFetcher>[0], o?: { rpm?: number; burst?: number }) => {
  const fetcher = fakeFetcher(respond);
  const p = new GoogleSuggestProvider(
    makeDeps(fetcher, clock),
    new GcraPacer(o?.rpm ?? 30, o?.burst ?? 5, clock.now, clock.sleep),
  );
  return { p, fetcher };
};

describe('TC-SUG-1: suggest fixture maps to gray, labeled ideas', () => {
  it('returns ideas with kind gray, attribution, retrievedAt, and estimateLabel on every one', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = suggestProvider(clock, () => jsonResponse(googleSuggestJson));
    const ideas = await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(1);
    expect(ideas.map((i) => i.term)).toEqual([
      'coffee grinder',
      'coffee grinder brush',
      'coffee grinder manual',
      'coffee grinder electric',
    ]);
    for (const idea of ideas) {
      expect(idea.source).toEqual({ provider: 'google-suggest', kind: 'gray', attribution: expect.any(String) });
      expect(idea.estimateLabel).toMatch(/autocomplete suggestion.*gray/);
      expect(idea.retrievedAt).toBe(new Date(NOW).toISOString());
      expect(idea.lang).toBe('en');
    }
  });

  it('sends client/hl/q params and the contact UA', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = suggestProvider(clock, () => jsonResponse(googleSuggestJson));
    await p.ideas('kaffee', { lang: 'de' });
    const url = fetcher.calls[0]!.url;
    expect(url.hostname).toBe('suggestqueries.google.com');
    expect(url.pathname).toBe('/complete/search');
    expect(url.searchParams.get('client')).toBe('firefox');
    expect(url.searchParams.get('hl')).toBe('de');
    expect(url.searchParams.get('q')).toBe('kaffee');
    expect(fetcher.calls[0]!.init?.headers).toMatchObject({ 'user-agent': expect.stringMatching(/^lumen\//) });
  });

  it('honors the limit opt', async () => {
    const clock = new FakeClock(NOW);
    const { p } = suggestProvider(clock, () => jsonResponse(googleSuggestJson));
    expect(await p.ideas('coffee grinder', { limit: 2 })).toHaveLength(2);
  });
});

describe('TC-SUG-2/3/4: suggest failure matrix + cache', () => {
  it('429 with Retry-After: 7 → rate_limited with retryAfterMs 7000', async () => {
    const clock = new FakeClock(NOW);
    const { p } = suggestProvider(clock, () => new Response('[]', { status: 429, headers: { 'retry-after': '7' } }));
    await expect(p.ideas('x', {})).rejects.toMatchObject({ code: 'rate_limited', provider: 'google-suggest', retryAfterMs: 7000 });
  });

  it('second identical call performs 0 fetches and returns equal ideas (24h cache)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = suggestProvider(clock, () => jsonResponse(googleSuggestJson));
    const first = await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(1);
    const second = await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(1); // cache hit
    expect(second).toEqual(first);
    clock.advance(24 * 60 * 60 * 1000 - 1);
    await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(1); // still fresh
    clock.advance(1);
    await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(2); // TTL boundary passed
  });

  it('500 → upstream_error; 403 → blocked; HTML content-type → blocked; JSON garbage → parse_error', async () => {
    const cases: Array<[Response, string]> = [
      [new Response('boom', { status: 500 }), 'upstream_error'],
      [new Response('no', { status: 403 }), 'blocked'],
      [htmlResponse('<html><form>CAPTCHA</form></html>', 200), 'blocked'],
      [textResponse('{"trunc', 200, 'application/json'), 'parse_error'],
      [jsonResponse(['unexpected', { weird: true }]), 'parse_error'],
    ];
    for (const [res, code] of cases) {
      const provider = suggestProvider(new FakeClock(NOW), () => res);
      await expect(provider.p.ideas('x', {}), code).rejects.toMatchObject({ code, provider: 'google-suggest' });
    }
  });
});

describe('TC-SUG-5: suggest pacing (30/min + burst 5 → worst 35/min)', () => {
  it('burst 5 immediate; <=35 requests in any rolling 60s window under sustained demand', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = suggestProvider(clock, () => jsonResponse(googleSuggestJson), { rpm: 30, burst: 5 });
    const launches = Array.from({ length: 100 }, (_, i) => p.ideas(`seed-${i}`, {}));
    const settled = await Promise.allSettled(launches);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(100);
    expect(fetcher.calls).toHaveLength(100); // sanity: all unique seeds fetched

    // The pacer enforces the window; assert its worst-case by simulation (adversary advances 1ms at a time):
    const sim = new GcraPacer(30, 5, clock.now, clock.sleep);
    const admitted: number[] = [];
    let t = NOW;
    while (t < NOW + 4 * 60_000) {
      clock.set(t);
      if (sim.tryAcquire()) admitted.push(t);
      else t += 1;
    }
    for (let i = 0; i < admitted.length; i++) {
      const inWindow = admitted.filter((x) => x >= admitted[i]! && x < admitted[i]! + 60_000).length;
      expect(inWindow).toBeLessThanOrEqual(35);
    }
  });

  it('concurrent immediate calls admit only burst 5 without sleeping; the rest wait via injected sleep', async () => {
    const clock = new FakeClock(NOW);
    const slept: number[] = [];
    const fetcher = fakeFetcher(() => jsonResponse(googleSuggestJson));
    const deps = makeDeps(fetcher, clock);
    const pacer = new GcraPacer(30, 5, clock.now, async (ms) => {
      slept.push(ms);
      clock.sleep(ms);
    });
    const p = new GoogleSuggestProvider(deps, pacer);
    await Promise.all(Array.from({ length: 8 }, (_, i) => p.ideas(`s${i}`, {})));
    expect(fetcher.calls).toHaveLength(8);
    expect(slept.length).toBeGreaterThan(0); // pacing actually engaged beyond the burst
  });
});

// --- wikipedia-demand -----------------------------------------------------------

const wikiProvider = (clock: FakeClock, respond: Parameters<typeof fakeFetcher>[0]) => {
  const fetcher = fakeFetcher(respond);
  const p = new WikipediaDemandProvider(
    makeDeps(fetcher, clock),
    new GcraPacer(60, 10, clock.now, clock.sleep),
  );
  return { p, fetcher };
};

const wikiHappy = () => (url: URL) => {
  if (url.pathname === '/w/rest.php/v1/search/title') return jsonResponse(wikiTitleHit);
  if (url.pathname.includes('/metrics/pageviews/per-article/')) return jsonResponse(wikiPageviews);
  throw new Error(`unexpected fixture URL ${url.href}`);
};

describe('TC-WIKI-1: demand proxy happy path', () => {
  it('title hit + 28 dailies → one heuristic idea with the correct sum and honesty label', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = wikiProvider(clock, wikiHappy());
    const ideas = await p.ideas('coffee grinder', {});
    expect(ideas).toHaveLength(1);
    const idea = ideas[0]!;
    expect(idea.term).toBe('coffee grinder');
    expect(idea.estimateLabel).toBe(
      `≈${wikiPageviewsTotal.toLocaleString('en-US')} views/28d on en.wikipedia "Coffee grinder" — demand proxy, not search volume`,
    );
    expect(idea.estimateLabel).toContain('demand proxy, not search volume');
    expect(idea.source).toEqual({ provider: 'wikipedia-demand', kind: 'heuristic', attribution: expect.any(String) });
    expect(idea.retrievedAt).toBe(new Date(NOW).toISOString());
    // window: 28d ending today−2d → 20260731..20260827 for NOW = 2026-08-29
    const pvUrl = fetcher.calls.find((c) => c.url.pathname.includes('pageviews'))!.url;
    expect(pvUrl.pathname).toContain('/daily/20260731/20260827');
    expect(pvUrl.pathname).toContain('/Coffee_grinder/');
  });
});

describe('TC-WIKI-2: etiquette', () => {
  it('both requests carry the contact UA; pacing worst window <= 70 <= documented 200', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = wikiProvider(clock, wikiHappy());
    await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(2);
    for (const call of fetcher.calls) {
      expect(call.init?.headers).toMatchObject({ 'user-agent': /lumen\/.*github/ });
    }
    // simulate the configured pacer's worst-case window bound
    const sim = new GcraPacer(60, 10, clock.now, clock.sleep);
    const admitted: number[] = [];
    let t = 0;
    while (t < 240_000) {
      clock.set(t);
      if (sim.tryAcquire()) admitted.push(t);
      else t += 1;
    }
    let worst = 0;
    for (let i = 0; i < admitted.length; i++) {
      worst = Math.max(worst, admitted.filter((x) => x >= admitted[i]! && x < admitted[i]! + 60_000).length);
    }
    expect(worst).toBeLessThanOrEqual(70);
    expect(worst).toBeLessThanOrEqual(200);
  });
});

describe('TC-WIKI-3: demand failure matrix', () => {
  it('no title match → [] (omitted, never zero)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = wikiProvider(clock, (url) => {
      if (url.pathname === '/w/rest.php/v1/search/title') return jsonResponse(wikiTitleMiss);
      throw new Error('pageviews should not be fetched when no article matched');
    });
    expect(await p.ideas('zzz nonexistent', {})).toEqual([]);
    expect(fetcher.calls).toHaveLength(1);
  });

  it('429 + Retry-After → rate_limited with parsed retryAfterMs', async () => {
    const clock = new FakeClock(NOW);
    const { p } = wikiProvider(clock, () => new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    await expect(p.ideas('x', {})).rejects.toMatchObject({
      code: 'rate_limited',
      provider: 'wikipedia-demand',
      retryAfterMs: 30_000,
    });
  });

  it('malformed pageviews JSON → parse_error (never upstream)', async () => {
    const clock = new FakeClock(NOW);
    const { p } = wikiProvider(clock, (url) => {
      if (url.pathname === '/w/rest.php/v1/search/title') return jsonResponse(wikiTitleHit);
      return textResponse('{not json', 200, 'application/json');
    });
    await expect(p.ideas('x', {})).rejects.toMatchObject({ code: 'parse_error', provider: 'wikipedia-demand' });
  });

  it('cached second call = 0 fetches (24h per article+window)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = wikiProvider(clock, wikiHappy());
    await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(2);
    await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(2);
    clock.advance(DAY); // new UTC day → new window key → refetch
    await p.ideas('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(4);
  });

  it('5xx on title search → upstream_error (not blocked, not CAPTCHA)', async () => {
    const clock = new FakeClock(NOW);
    const { p } = wikiProvider(clock, () => new Response('oops', { status: 503 }));
    await expect(p.ideas('x', {})).rejects.toMatchObject({ code: 'upstream_error', status: 503 });
  });
});
