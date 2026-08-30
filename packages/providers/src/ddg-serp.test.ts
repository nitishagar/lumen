import { describe, expect, it } from 'vitest';
import { DdgSerpProvider } from './ddg-serp.js';
import { GcraPacer } from './throttle.js';
import { FakeClock, fakeFetcher, htmlResponse, makeDeps } from './testing.js';
import { ddgChallenge, ddgDrift, ddgHtml, ddgHtmlWithChallengeWords, ddgLite, ddgNoResults } from './fixtures/index.js';

const NOW = Date.UTC(2026, 7, 29);

const ddg = (
  clock: FakeClock,
  respond: Parameters<typeof fakeFetcher>[0],
  o?: { rpm?: number; burst?: number },
) => {
  const fetcher = fakeFetcher(respond);
  const p = new DdgSerpProvider(
    makeDeps(fetcher, clock),
    new GcraPacer(o?.rpm ?? 6, o?.burst ?? 1, clock.now, clock.sleep),
  );
  return { p, fetcher };
};

describe('TC-DDG-1: html fixture parses to gray, labeled results', () => {
  it('positions 1..N, uddg decoded to absolute URLs, ads excluded, snippets attached', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, (url) => (url.hostname === 'html.duckduckgo.com' ? htmlResponse(ddgHtml) : htmlResponse(ddgLite)));
    const results = await p.search('coffee grinder', {});
    expect(results).toHaveLength(2); // the .result--ad block was excluded
    expect(results[0]).toMatchObject({
      position: 1,
      url: 'https://example.com/coffee/grinders',
      title: 'Best coffee grinders 2026',
      snippet: 'Ten hand-tested grinders, from blade to burr.',
    });
    expect(results[1]).toMatchObject({
      position: 2,
      url: 'https://wiki.coffee.example/Burr_grinder', // direct href passes through
      title: 'Burr grinder guide',
    });
    for (const r of results) {
      expect(r.source).toEqual({ provider: 'ddg-serp', kind: 'gray', attribution: expect.any(String) });
      expect(r.estimateLabel).toMatch(/best-effort.*gray/);
      expect(r.retrievedAt).toBe(new Date(NOW).toISOString());
    }
    expect(fetcher.calls[0]!.url.searchParams.get('q')).toBe('coffee grinder');
  });

  it('honors the limit opt', async () => {
    const clock = new FakeClock(NOW);
    const { p } = ddg(clock, () => htmlResponse(ddgHtml));
    expect(await p.search('coffee grinder', { limit: 1 })).toHaveLength(1);
  });
});

describe('TC-DDG-2: status split + pacing', () => {
  it('429 → rate_limited AND no fallback fetch (exactly 1 fetch)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, () => new Response('', { status: 429, headers: { 'retry-after': '20' } }));
    await expect(p.search('q', {})).rejects.toMatchObject({
      code: 'rate_limited',
      provider: 'ddg-serp',
      retryAfterMs: 20_000,
    });
    expect(fetcher.calls).toHaveLength(1); // NO lite fallback on 429 — back off
  });

  it('503 → upstream_error and no fallback', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, () => new Response('down', { status: 503 }));
    await expect(p.search('q', {})).rejects.toMatchObject({ code: 'upstream_error', status: 503 });
    expect(fetcher.calls).toHaveLength(1);
  });

  it('403 → blocked (then lite fallback fires — see TC-DDG-3)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, (url) =>
      url.hostname === 'html.duckduckgo.com'
        ? new Response('no', { status: 403 })
        : htmlResponse(ddgLite),
    );
    const results = await p.search('q', {});
    expect(results).toHaveLength(2); // lite answered after the 403
    expect(fetcher.calls).toHaveLength(2);
  });

  it('pacing: 10 s spacing between consecutive fetches; <= 7 in any rolling 60 s window', async () => {
    const clock = new FakeClock(NOW);
    const stamps: number[] = [];
    const { p } = ddg(clock, (url) => {
      stamps.push(clock.current);
      return htmlResponse(url.hostname === 'html.duckduckgo.com' ? ddgHtml : ddgLite);
    });
    await p.search('a', {});
    await p.search('b', {}); // unique queries → unique fetches
    expect(stamps[1]! - stamps[0]!).toBeCloseTo(10_000, 5); // 6/min ⇒ 10 s spacing

    const sim = new GcraPacer(6, 1, clock.now, clock.sleep);
    const admitted: number[] = [];
    let t = 0;
    while (t < 4 * 60_000) {
      clock.set(t);
      if (sim.tryAcquire()) admitted.push(t);
      else t += 1;
    }
    let worst = 0;
    for (let i = 0; i < admitted.length; i++) {
      worst = Math.max(worst, admitted.filter((x) => x >= admitted[i]! && x < admitted[i]! + 60_000).length);
    }
    expect(worst).toBeLessThanOrEqual(7);
  });
});

describe('TC-DDG-3: challenge page → blocked, then ONE lite fallback', () => {
  it('anomaly fixture → BlockedError from html, lite fixture answers', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, (url) =>
      url.hostname === 'html.duckduckgo.com' ? htmlResponse(ddgChallenge) : htmlResponse(ddgLite),
    );
    const results = await p.search('q', {});
    expect(results).toHaveLength(2);
    expect(fetcher.calls).toHaveLength(2);
    expect(fetcher.calls[1]!.url.hostname).toBe('lite.duckduckgo.com');
    expect(results[0]!.url).toBe('https://example.com/coffee/grinders'); // lite uddg decoded too
  });
});

describe('TC-DDG-4: drift and honest empty SERPs', () => {
  it('html with neither anchors nor no-results marker → parse_error', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, (url) =>
      url.hostname === 'html.duckduckgo.com' ? htmlResponse(ddgDrift) : htmlResponse(ddgDrift),
    );
    await expect(p.search('q', {})).rejects.toMatchObject({
      code: 'parse_error',
      message: expect.stringContaining('layout drift'),
    });
    expect(fetcher.calls).toHaveLength(2); // drift on primary → one lite fallback attempted (also drifted)
  });

  it('empty SERP WITH the no-results marker → [] (not an error)', async () => {
    const clock = new FakeClock(NOW);
    const { p } = ddg(clock, () => htmlResponse(ddgNoResults));
    expect(await p.search('q', {})).toEqual([]);
  });
});

describe('TC-DDG-5: the fallback trigger is defined exactly', () => {
  it('primary drift + lite fixture → lite result, exactly 2 fetches', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, (url) =>
      url.hostname === 'html.duckduckgo.com' ? htmlResponse(ddgDrift) : htmlResponse(ddgLite),
    );
    const results = await p.search('q', {});
    expect(results).toHaveLength(2);
    expect(fetcher.calls).toHaveLength(2);
  });

  it('lite ALSO drifts → its parse_error propagates (no second fallback)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, () => htmlResponse(ddgDrift));
    await expect(p.search('q', {})).rejects.toMatchObject({ code: 'parse_error', provider: 'ddg-serp' });
    expect(fetcher.calls).toHaveLength(2); // exactly one fallback, never two
  });

  it('429 from primary → exactly 1 fetch (no fallback ever fires on rate limiting)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, () => new Response('', { status: 429 }));
    await expect(p.search('q', {})).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fetcher.calls).toHaveLength(1);
  });

  it('cached query repeats with 0 fetches (1h TTL, per endpoint)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, () => htmlResponse(ddgHtml));
    await p.search('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(1);
    await p.search('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(1);
    clock.advance(60 * 60 * 1000);
    await p.search('coffee grinder', {});
    expect(fetcher.calls).toHaveLength(2); // TTL elapsed
  });
});

describe('red-team round 1: challenge marker must not fire on real results', () => {
  it('a legitimate SERP whose titles/snippets quote captcha/challenge/anomaly parses to results (no fallback)', async () => {
    const clock = new FakeClock(NOW);
    const { p, fetcher } = ddg(clock, () => htmlResponse(ddgHtmlWithChallengeWords));
    const results = await p.search('how to solve captcha', {});
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('How to solve every CAPTCHA');
    expect(fetcher.calls).toHaveLength(1); // no lite fallback — the primary answered
  });
});
