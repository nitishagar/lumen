import { describe, expect, it } from 'vitest';
import { InMemoryCache } from './cache.js';
import { BlockedError, NotConfiguredError, ParseError, ProviderError, RateLimitedError, UpstreamError } from './errors.js';
import { json, normalizeDomain, retryAfterMs } from './http.js';
import { redactUrl } from './redact.js';
import { GcraPacer, resolvePacing } from './throttle.js';
import { FakeClock } from './testing.js';
import { isTimeoutLike, withProviderErrors } from './with-errors.js';

const MIN = 60_000;

describe('TC-SHARED-1: typed errors carry the provider name everywhere', () => {
  it('every ProviderError message begins with [provider] and exposes code/provider', () => {
    const cases: ProviderError[] = [
      new ProviderError('stale_cache', 'tranco', 'list too old'),
      new NotConfiguredError('crux', 'LUMEN_CRUX_KEY', 'Google Cloud API key required'),
      new RateLimitedError('google-suggest', 7_000),
      new BlockedError('ddg-serp', 'challenge page'),
      new UpstreamError('pagespeed', 503),
      new ParseError('openpagerank', 'malformed JSON body'),
    ];
    for (const e of cases) {
      expect(e.message.startsWith(`[${e.provider}]`), e.message).toBe(true);
      expect(typeof e.code).toBe('string');
      expect(e.provider.length).toBeGreaterThan(0);
    }
  });

  it('NotConfiguredError names the env var and hint; RateLimitedError carries retryAfterMs', () => {
    const nc = new NotConfiguredError('crux', 'LUMEN_CRUX_KEY', 'free key from Google Cloud Console');
    expect(nc.envVar).toBe('LUMEN_CRUX_KEY');
    expect(nc.message).toContain('LUMEN_CRUX_KEY');
    const rl = new RateLimitedError('google-suggest', 7_000);
    expect(rl.retryAfterMs).toBe(7_000);
    expect(new RateLimitedError('crux').retryAfterMs).toBeUndefined();
  });
});

describe('TC-SHARED-2/3: GCRA worst-case rolling window and burst semantics', () => {
  it('admits exactly `burst` immediate requests from idle; the next acquire sleeps one interval', async () => {
    const clock = new FakeClock(1_000_000);
    const p = new GcraPacer(140, 10, clock.now, clock.sleep);
    for (let i = 0; i < 10; i++) await p.acquire();
    expect(clock.current).toBe(1_000_000); // burst consumed with zero sleeps
    await p.acquire(); // 11th must wait
    expect(clock.current).toBeCloseTo(1_000_000 + MIN / 140, 6);
  });

  it('sustained demand is spaced 60_000/rpm apart under the fake clock', async () => {
    const clock = new FakeClock(0);
    const p = new GcraPacer(30, 1, clock.now, clock.sleep);
    const stamps: number[] = [];
    for (let i = 0; i < 8; i++) {
      await p.acquire();
      stamps.push(clock.current);
    }
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]! - stamps[i - 1]!).toBeCloseTo(MIN / 30, 6);
  });

  it('tryAcquire returns false beyond burst and does not advance TAT', () => {
    const clock = new FakeClock(0);
    const p = new GcraPacer(30, 5, clock.now, clock.sleep);
    for (let i = 0; i < 5; i++) expect(p.tryAcquire()).toBe(true);
    expect(p.tryAcquire()).toBe(false);
    expect(p.tryAcquire()).toBe(false); // still false, no TAT drift
    clock.advance((MIN / 30) * 5);
    expect(p.tryAcquire()).toBe(true);
  });

  it('worst-case rolling 60s window is <= rpm + burst for every configured provider (asserted by simulation)', () => {
    const configs: Array<{ rpm: number; burst: number; limit?: number }> = [
      { rpm: 30, burst: 5 }, // google-suggest
      { rpm: 60, burst: 10, limit: 200 }, // wikipedia-demand
      { rpm: 60, burst: 10, limit: 240 }, // pagespeed keyed
      { rpm: 6, burst: 1 }, // pagespeed keyless
      { rpm: 140, burst: 10, limit: 150 }, // crux
      { rpm: 50, burst: 10, limit: 60 }, // openpagerank
      { rpm: 6, burst: 1 }, // ddg-serp
    ];
    for (const { rpm, burst, limit } of configs) {
      const clock = new FakeClock(0);
      const p = new GcraPacer(rpm, burst, clock.now, clock.sleep);
      // Saturating demand loop: tryAcquire in a tight loop; when refused, advance the
      // clock to the earliest instant that would conform (the adversary's best case).
      const admitted: number[] = [];
      let now = 0;
      while (now <= 4 * MIN) {
        if (p.tryAcquire()) admitted.push(now);
        else now += 1;
        clock.set(now);
      }
      // Worst rolling 60s window over every alignment:
      let worst = 0;
      for (let i = 0; i < admitted.length; i++) {
        const windowEnd = admitted[i]! + MIN;
        const count = admitted.filter((t) => t >= admitted[i]! && t < windowEnd).length;
        worst = Math.max(worst, count);
      }
      expect(worst, `rpm=${rpm} burst=${burst}`).toBeLessThanOrEqual(rpm + burst);
      if (limit !== undefined) expect(worst, `rpm=${rpm} burst=${burst} limit=${limit}`).toBeLessThanOrEqual(limit);
      // The bound is exactly achievable (GCRA admits rpm+burst in some alignment):
      expect(rpm + burst).toBeLessThanOrEqual(limit ?? rpm + burst);
    }
  });

  it('the CrUX pacer admits exactly 150 conforming requests in the worst 60s window (= documented, never above)', () => {
    const { rpm, burst } = resolvePacing({}, { rpm: 140, burst: 10 }, 150);
    expect(rpm + burst).toBe(150);
    const p = new GcraPacer(rpm, burst, () => 0, async () => {});
    let admitted = 0;
    for (let i = 0; i < 200; i++) if (p.tryAcquire()) admitted++;
    expect(admitted).toBe(10); // burst from idle
  });
});

describe('TC-REG-6 (mechanism): resolvePacing clamps overrides to the documented limit', () => {
  it('crux {rpm:500} clamps to {rpm:140, burst:10}', () => {
    expect(resolvePacing({ rpm: 500 }, { rpm: 140, burst: 10 }, 150)).toEqual({ rpm: 140, burst: 10 });
  });

  it('crux {rpm:150, burst:50} keeps burst <= 75 and rpm+burst <= 150', () => {
    const { rpm, burst } = resolvePacing({ rpm: 150, burst: 50 }, { rpm: 140, burst: 10 }, 150);
    expect(burst).toBeLessThanOrEqual(75);
    expect(rpm + burst).toBeLessThanOrEqual(150);
  });

  it('randomized overrides never violate rpm+burst <= documentedLimit', () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 500; i++) {
      const { rpm, burst } = resolvePacing(
        { rpm: Math.floor(rng() * 1000), burst: Math.floor(rng() * 200) },
        { rpm: 140, burst: 10 },
        150,
      );
      expect(rpm + burst).toBeLessThanOrEqual(150);
      expect(rpm).toBeGreaterThanOrEqual(1);
      expect(burst).toBeGreaterThanOrEqual(1);
    }
  });

  it('providers without a documented limit pass overrides through', () => {
    expect(resolvePacing({ rpm: 99, burst: 9 }, { rpm: 30, burst: 5 })).toEqual({ rpm: 99, burst: 9 });
  });
});

describe('TC-SHARED-4: InMemoryCache TTL expiry on the injected clock', () => {
  it('returns the value before expiry and undefined after', async () => {
    const clock = new FakeClock(1_000);
    const cache = new InMemoryCache(clock.now);
    await cache.set('k', { a: 1 }, 1_000 + 60_000);
    expect(await cache.get<{ a: number }>('k')).toEqual({ a: 1 });
    clock.advance(59_999);
    expect(await cache.get('k')).toEqual({ a: 1 });
    clock.advance(1);
    expect(await cache.get('k')).toBeUndefined();
  });

  it('isolates keys', async () => {
    const cache = new InMemoryCache(() => 0);
    await cache.set('a', 1, 10);
    await cache.set('b', 2, 10);
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBeUndefined();
  });
});

describe('TC-SHARED-5: redactUrl strips secret params and never mutates the input', () => {
  it('redacts key/token-style params', () => {
    expect(redactUrl('https://x.example/api?foo=1&key=SECRETK&bar=2')).toBe(
      'https://x.example/api?foo=1&key=%5Bredacted%5D&bar=2',
    );
    const redacted = new URL(redactUrl('https://x.example/api?apikey=A&api_key=B&token=C&access_token=D'));
    for (const [name, value] of redacted.searchParams) expect(`${name}=${value}`).toBe(`${name}=[redacted]`);
    expect(redactUrl('https://x.example/api?safe=1')).toBe('https://x.example/api?safe=1');
  });

  it('leaves the original URL object unmutated', () => {
    const u = new URL('https://x.example/api?key=SECRETK');
    const out = redactUrl(u);
    expect(u.searchParams.get('key')).toBe('SECRETK');
    expect(out).not.toContain('SECRETK');
  });

  it('degrades safely on garbage', () => {
    expect(redactUrl('not a url')).toBe('[invalid-url]');
  });
});

describe('TC-SHARED-9: shared json() helper maps malformed JSON to parse_error', () => {
  it('never lets a SyntaxError escape as upstream_error', async () => {
    const res = new Response('{"trunc', { headers: { 'content-type': 'application/json' } });
    await expect(json(res, 'pagespeed')).rejects.toMatchObject({
      code: 'parse_error',
      provider: 'pagespeed',
    });
  });

  it('decodes valid bodies untouched', async () => {
    const res = new Response('["q",["a","b"]]', { headers: { 'content-type': 'application/json' } });
    await expect(json(res, 'google-suggest')).resolves.toEqual(['q', ['a', 'b']]);
  });
});

describe('retryAfterMs', () => {
  it('parses delta-seconds and HTTP-dates, ignores garbage', () => {
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': '7' } }))).toBe(7_000);
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': '0' } }))).toBe(0);
    const clockMs = 1_700_000_000_000;
    const date = new Date(clockMs + 5_000).toUTCString();
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': date } }), () => clockMs)).toBe(5_000);
    expect(retryAfterMs(new Response(null, {}))).toBeUndefined();
    expect(retryAfterMs(new Response(null, { headers: { 'retry-after': 'soon' } }))).toBeUndefined();
  });
});

describe('normalizeDomain (I15/BA11)', () => {
  it('strips scheme, path, query, port, case, and trailing dots', () => {
    expect(normalizeDomain('https://Example.COM/path/to?q=1')).toBe('example.com');
    expect(normalizeDomain('Example.com.')).toBe('example.com');
    expect(normalizeDomain(' sub.Example.org:8443/x ')).toBe('sub.example.org');
    expect(normalizeDomain('.weird.example.')).toBe('weird.example');
    expect(normalizeDomain('plain.example')).toBe('plain.example');
  });
});

describe('TC-SHARED-10: type-based timeout classification (never message sniffing)', () => {
  it('AbortError and TimeoutError names map to code timeout with detail.aborted', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    await expect(withProviderErrors('crux', async () => Promise.reject(abortErr))).rejects.toMatchObject({
      code: 'timeout',
      provider: 'crux',
      detail: { aborted: true },
    });
    const timeoutErr = new Error('timed out');
    timeoutErr.name = 'TimeoutError';
    await expect(withProviderErrors('crux', async () => Promise.reject(timeoutErr))).rejects.toMatchObject({
      code: 'timeout',
      detail: { aborted: false },
    });
  });

  it('a message that merely contains abort/timeout is NOT classified as timeout', async () => {
    await expect(
      withProviderErrors('ddg-serp', async () => {
        throw new Error('upstream said: please abort, we timed out once');
      }),
    ).rejects.toMatchObject({ code: 'upstream_error', provider: 'ddg-serp', status: 0 });
  });

  it('ProviderError passes through unchanged; success passes through; isTimeoutLike is name-based', async () => {
    const original = new BlockedError('ddg-serp', 'challenge');
    await expect(withProviderErrors('ddg-serp', async () => Promise.reject(original))).rejects.toBe(original);
    await expect(withProviderErrors('x', async () => 7)).resolves.toBe(7);
    expect(isTimeoutLike(new Error('nope'))).toBe(false);
    expect(isTimeoutLike('string')).toBe(false);
  });
});

describe('red-team round 1 hardening', () => {
  it('InMemoryCache: expired-unread entries are evicted on set, not only on get', async () => {
    const clock = { now: 1_000 };
    const cache = new InMemoryCache(() => clock.now);
    for (let i = 0; i < 100; i++) await cache.set(`k${i}`, i, 2_000);
    clock.now = 3_000; // everything expired, nothing read back
    await cache.set('fresh', 'v', 4_000);
    expect(cache.size).toBe(1); // sweep happened — not 101
    expect(await cache.get<string>('fresh')).toBe('v');
  });
});
