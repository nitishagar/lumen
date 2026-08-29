import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetcher } from './fetcher.js';
import type { FetchTransport } from './fetcher.js';
import {
  AbortedError,
  LumenError,
  RedirectError,
  RetryAfterCapError,
  RetryExhaustedError,
  SsrfBlockedError,
  TimeoutError,
} from './errors.js';

const URL_ = new URL('https://example.com/');

/** Delegate returning scripted statuses, optionally with headers; records call count. */
const scripted = (script: { status: number; headers?: Record<string, string> }[]) => {
  const state = { calls: 0 };
  const delegate: FetchTransport = async () => {
    const step = script[Math.min(state.calls, script.length - 1)]!;
    state.calls += 1;
    return new Response(null, { status: step.status, headers: step.headers });
  };
  return { delegate, calls: () => state.calls };
};

const recorder = () => {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => { sleeps.push(ms); } };
};

const seededRng = (values: number[]) => {
  const state = { calls: 0 };
  return { calls: () => state.calls, rng: () => values[Math.min(state.calls++, values.length - 1)]! };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('per-attempt timeout (SC-11)', () => {
  it('delegate hangs → TimeoutError when retries are 0 (no retries consumed)', async () => {
    vi.useFakeTimers();
    const delegate: FetchTransport = () => new Promise<Response>(() => {});
    const fetcher = createFetcher({ delegate, timeoutMs: 100, maxRetries: 0, label: 'pagespeed' });
    const p = fetcher.fetch(URL_);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('delegate always hangs with retries → RetryExhaustedError after exactly 3 attempts', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const delegate: FetchTransport = () => {
      calls += 1;
      return new Promise<Response>(() => {});
    };
    const fetcher = createFetcher({ delegate, timeoutMs: 100, maxRetries: 2, label: 'pagespeed' });
    const caught = fetcher.fetch(URL_).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000); // enough for timeouts + backoff sleeps
    const err = await caught;
    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect(calls).toBe(3);
    expect((err as RetryExhaustedError).attempts).toBe(3);
  });
});

describe('exponential backoff with full jitter (SC-11, BA-4)', () => {
  it('seeded rng → sleeps are rng() × base × 2^attempt, within [0, 2^attempt × base]', async () => {
    const { delegate, calls } = scripted([{ status: 500 }, { status: 500 }, { status: 200 }]);
    const { sleeps, sleep } = recorder();
    const { calls: rngCalls, rng } = seededRng([0.5, 0.99]);
    const fetcher = createFetcher({ delegate, sleep, rng, baseBackoffMs: 500, maxRetries: 2 });
    const res = await fetcher.fetch(URL_);
    expect(res.status).toBe(200);
    expect(calls()).toBe(3); // attempt count bounded: 1 + maxRetries
    expect(rngCalls()).toBe(2);
    expect(sleeps).toEqual([0.5 * 500 * 1, 0.99 * 500 * 2]); // 250, 990
    expect(sleeps[0]).toBeGreaterThanOrEqual(0);
    expect(sleeps[0]).toBeLessThanOrEqual(500); // cap attempt 0
    expect(sleeps[1]).toBeLessThanOrEqual(1000); // cap attempt 1 — exponential growth
  });

  it('retry budget is bounded: a persistently failing GET stops after maxRetries + 1 attempts', async () => {
    const { delegate, calls } = scripted([{ status: 500 }]);
    const { sleep } = recorder();
    const { rng } = seededRng([0]);
    const fetcher = createFetcher({ delegate, sleep, rng, maxRetries: 2 });
    await expect(fetcher.fetch(URL_)).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(calls()).toBe(3);
  });
});

describe('Retry-After (SC-11, BA-4)', () => {
  it('429 + Retry-After: 2 → sleeps exactly 2 s (no jitter), then succeeds', async () => {
    const { delegate } = scripted([{ status: 429, headers: { 'retry-after': '2' } }, { status: 200 }]);
    const { sleeps, sleep } = recorder();
    const { calls: rngCalls, rng } = seededRng([0.5]);
    const fetcher = createFetcher({ delegate, sleep, rng });
    const res = await fetcher.fetch(URL_);
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([2000]);
    expect(rngCalls()).toBe(0); // Retry-After is authoritative — jitter not applied
  });

  it('503 + Retry-After is honored the same way', async () => {
    const { delegate } = scripted([{ status: 503, headers: { 'retry-after': '1' } }, { status: 200 }]);
    const { sleeps, sleep } = recorder();
    const fetcher = createFetcher({ delegate, sleep });
    await fetcher.fetch(URL_);
    expect(sleeps).toEqual([1000]);
  });

  it('HTTP-date form is parsed against the injected clock (F1)', async () => {
    const fixed = Date.UTC(2026, 7, 29, 12, 0, 0);
    const header = new Date(fixed + 3000).toUTCString();
    const { delegate } = scripted([{ status: 429, headers: { 'retry-after': header } }, { status: 200 }]);
    const { sleeps, sleep } = recorder();
    const fetcher = createFetcher({ delegate, sleep, now: () => fixed });
    await fetcher.fetch(URL_);
    expect(sleeps).toEqual([3000]);
  });

  it('a past HTTP-date sleeps 0 (not negative), then retries', async () => {
    const fixed = Date.UTC(2026, 7, 29, 12, 0, 0);
    const header = new Date(fixed - 5000).toUTCString();
    const { delegate } = scripted([{ status: 429, headers: { 'retry-after': header } }, { status: 200 }]);
    const { sleeps, sleep } = recorder();
    const fetcher = createFetcher({ delegate, sleep, now: () => fixed });
    await fetcher.fetch(URL_);
    expect(sleeps).toEqual([0]);
  });

  it('an invalid Retry-After value falls back to backoff (attempt 0 cap)', async () => {
    const { delegate } = scripted([{ status: 429, headers: { 'retry-after': 'not-a-date' } }, { status: 200 }]);
    const { sleeps, sleep } = recorder();
    const { rng } = seededRng([0.5]);
    const fetcher = createFetcher({ delegate, sleep, rng, baseBackoffMs: 500 });
    await fetcher.fetch(URL_);
    expect(sleeps).toEqual([250]);
  });

  it('Retry-After beyond the 30 s cap → RetryAfterCapError, nothing slept (BA-4)', async () => {
    const { delegate, calls } = scripted([{ status: 429, headers: { 'retry-after': '3600' } }]);
    const { sleeps, sleep } = recorder();
    const fetcher = createFetcher({ delegate, sleep, label: 'pagespeed' });
    const err = await fetcher.fetch(URL_).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryAfterCapError);
    expect(err).toBeInstanceOf(LumenError);
    expect((err as RetryAfterCapError).retryAfterMs).toBe(3_600_000);
    expect((err as RetryAfterCapError).capMs).toBe(30_000);
    expect(sleeps).toEqual([]);
    expect(calls()).toBe(1);
  });
});

describe('retry scope (SC-11, BA-5)', () => {
  it('network errors are retried on GET', async () => {
    let calls = 0;
    const delegate: FetchTransport = async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response('ok');
    };
    const { sleep } = recorder();
    const { rng } = seededRng([0, 0]);
    const fetcher = createFetcher({ delegate, sleep, rng });
    const res = await fetcher.fetch(URL_);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('POST is NOT retried by default: a 5xx response is returned as-is, one call', async () => {
    const { delegate, calls } = scripted([{ status: 500 }]);
    const { sleep } = recorder();
    const fetcher = createFetcher({ delegate, sleep });
    const res = await fetcher.fetch(URL_, { method: 'POST', body: 'x' });
    expect(res.status).toBe(500);
    expect(calls()).toBe(1);
  });

  it('4xx responses are never retried (returned as-is)', async () => {
    const { delegate, calls } = scripted([{ status: 404 }]);
    const fetcher = createFetcher({ delegate, sleep: async () => {} });
    const res = await fetcher.fetch(URL_);
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
  });
});

describe('caller cancellation (I14, F3)', () => {
  it('an already-aborted signal fails immediately with AbortedError, zero transport calls', async () => {
    const { delegate, calls } = scripted([{ status: 200 }]);
    const fetcher = createFetcher({ delegate });
    const ac = new AbortController();
    ac.abort();
    await expect(fetcher.fetch(URL_, { signal: ac.signal })).rejects.toBeInstanceOf(AbortedError);
    expect(calls()).toBe(0);
  });

  it('abort mid-flight fails immediately with AbortedError without consuming retries', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const delegate: FetchTransport = () => {
      calls += 1;
      return new Promise<Response>(() => {}); // hangs, ignores the signal
    };
    const ac = new AbortController();
    const fetcher = createFetcher({ delegate, timeoutMs: 10_000, maxRetries: 2 });
    const p = fetcher.fetch(URL_, { signal: ac.signal });
    const assertion = expect(p).rejects.toBeInstanceOf(AbortedError);
    await vi.advanceTimersByTimeAsync(50);
    ac.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(calls).toBe(1); // no retry after the abort
  });
});

describe('typed errors carry the provider label (SC-11, I17)', () => {
  it('every error class is a LumenError and carries label "pagespeed"', async () => {
    const label = 'pagespeed';

    const timeoutErr = await (() => {
      vi.useFakeTimers();
      const delegate: FetchTransport = () => new Promise<Response>(() => {});
      const fetcher = createFetcher({ delegate, timeoutMs: 100, maxRetries: 0, label });
      const caught = fetcher.fetch(URL_).catch((e: unknown) => e);
      return vi.advanceTimersByTimeAsync(100).then(() => caught);
    })();

    const capErr = await createFetcher({
      delegate: scripted([{ status: 429, headers: { 'retry-after': '3600' } }]).delegate,
      sleep: async () => {},
      label,
    }).fetch(URL_).catch((e: unknown) => e);

    const exhaustedErr = await createFetcher({
      delegate: scripted([{ status: 503 }]).delegate,
      sleep: async () => {},
      rng: () => 0,
      label,
    }).fetch(URL_).catch((e: unknown) => e);

    const ssrfErr = await createFetcher({ label }).fetch(new URL('http://127.0.0.1/')).catch((e: unknown) => e);

    const ac = new AbortController();
    ac.abort();
    const abortErr = await createFetcher({ label }).fetch(URL_, { signal: ac.signal }).catch((e: unknown) => e);

    const hops: Record<string, string> = {};
    for (let i = 0; i < 6; i++) hops[`https://h${i}.example.com/`] = `https://h${i + 1}.example.com/`;
    const redirectErr = await createFetcher({
      label,
      delegate: async (url: URL) =>
        url.href in hops ? Response.redirect(hops[url.href]!, 302) : new Response('ok'),
    }).fetch(new URL('https://h0.example.com/')).catch((e: unknown) => e);

    const cases: [string, unknown, unknown][] = [
      ['TimeoutError', timeoutErr, TimeoutError],
      ['RetryAfterCapError', capErr, RetryAfterCapError],
      ['RetryExhaustedError', exhaustedErr, RetryExhaustedError],
      ['SsrfBlockedError', ssrfErr, SsrfBlockedError],
      ['AbortedError', abortErr, AbortedError],
      ['RedirectError', redirectErr, RedirectError],
    ];
    for (const [name, err, cls] of cases) {
      expect(err, name).toBeInstanceOf(cls);
      expect(err, name).toBeInstanceOf(LumenError);
      expect((err as LumenError).label, name).toBe(label);
    }
    expect((redirectErr as RedirectError).reason).toBe('hop-cap');
    expect((exhaustedErr as RetryExhaustedError).status).toBe(503);
  });
});
