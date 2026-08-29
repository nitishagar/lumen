/**
 * The single network boundary for every test in this package (I9 — no live
 * network; the plan's `test/helpers/fake-fetcher.ts`, colocated under `src/`
 * per the repo's vitest include convention).
 *
 * The fake models the CORE FETCHER contract, not the raw transport:
 * - it returns FINAL responses (redirects already followed — core's fetcher
 *   iterates hops internally and never surfaces 3xx to callers);
 * - redirect failures surface as core's typed `RedirectError` (`loop`,
 *   `hop-cap`), post-retry 429/5xx as `RetryExhaustedError`, caller aborts as
 *   `AbortedError` — exactly what `@lumen-seo/core`'s fetcher throws;
 * - `finalUrl` simulates undici's `Response.url` after a followed chain.
 *
 * It records every call (URL, wall-time from the injected clock, init) and
 * tracks peak in-flight concurrency for the worker-pool cap test.
 */
import {
  AbortedError,
  RedirectError,
  RetryExhaustedError,
} from '@lumen-seo/core';
import type { Fetcher } from '@lumen-seo/core';

export interface FakeRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Build the body from encoded chunks (streamed read tests); no Content-Length is derived. */
  chunks?: readonly string[];
  contentType?: string;
  /** Explicit Content-Length override (e.g. oversized pages without a real body). */
  contentLength?: number;
  /** Simulate a followed redirect: `Response.url` reports this final URL. */
  finalUrl?: string;
  /** Simulate a redirect-discipline failure the core fetcher would throw. */
  redirectError?: 'loop' | 'hop-cap';
  /** Fetcher-level failure (network error, exhausted retries, …). */
  throw?: Error;
  /** Resolve only when the test calls `release()` (pending-response tests). */
  defer?: boolean;
  /**
   * Return 429/5xx responses AS-IS instead of throwing `RetryExhaustedError`
   * (core's real fetcher always throws for retryable GET statuses; this opt-in
   * models a non-retrying fetcher so audit's header-driven 429 path is testable).
   */
  passStatus?: boolean;
}

export interface FakeCall {
  url: string;
  at: number;
  init?: RequestInit;
}

const encoder = new TextEncoder();

export class FakeFetcher implements Fetcher {
  private readonly routes: Map<string, readonly FakeRoute[]>;
  private readonly callsByRoute = new Map<string, number>();
  private readonly deferred = new Map<string, ((res: Response) => void)[]>();
  readonly log: FakeCall[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly now: () => number;

  constructor(routes: Record<string, FakeRoute | readonly FakeRoute[]>, now: () => number = () => 0) {
    this.routes = new Map(
      Object.entries(routes).map(([url, route]) => [url, Array.isArray(route) ? route : [route]]),
    );
    this.now = now;
  }

  private routeFor(url: string): FakeRoute {
    const seq = this.routes.get(url);
    if (seq === undefined) return { status: 404, body: '' }; // realistic default: not found
    const n = this.callsByRoute.get(url) ?? 0;
    this.callsByRoute.set(url, n + 1);
    return seq[Math.min(n, seq.length - 1)]!;
  }

  private buildResponse(route: FakeRoute): Response {
    const status = route.status ?? 200;
    const headers = new Headers(route.headers ?? {});
    const contentType = route.contentType ?? headers.get('content-type') ?? undefined;
    if (contentType !== undefined) headers.set('content-type', contentType);

    let body: ReadableStream<Uint8Array> | string | null = null;
    if (route.chunks !== undefined) {
      const parts = route.chunks.map((c) => encoder.encode(c));
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      });
    } else {
      body = route.body ?? '';
      if (route.contentLength !== undefined) {
        headers.set('content-length', String(route.contentLength));
      } else {
        headers.set('content-length', String(encoder.encode(route.body ?? '').length));
      }
    }

    const res = new Response(body, { status, headers });
    if (route.finalUrl !== undefined) {
      Object.defineProperty(res, 'url', { value: route.finalUrl });
    } else {
      Object.defineProperty(res, 'url', { value: '' });
    }
    return res;
  }

  private releaseDeferred(url: string, res: Response): void {
    const waiters = this.deferred.get(url) ?? [];
    this.deferred.set(url, []);
    for (const w of waiters) w(res);
  }

  /** Settle deferred (pending) responses for `url` (or all deferred urls when omitted). */
  release(url?: string): void {
    if (url !== undefined) {
      const route = this.routeFor(url);
      this.releaseDeferred(url, this.buildResponse(route));
      return;
    }
    for (const key of [...this.deferred.keys()]) this.release(key);
  }

  async fetch(url: URL, init: RequestInit = {}): Promise<Response> {
    this.log.push({ url: url.href, at: this.now(), init });
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw new AbortedError('audit');

    const route = this.routeFor(url.href);

    if (route.defer === true) {
      this.inFlight++;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        const res = await new Promise<Response>((resolve, reject) => {
          const waiters = this.deferred.get(url.href) ?? [];
          waiters.push(resolve);
          this.deferred.set(url.href, waiters);
          signal?.addEventListener(
            'abort',
            () => {
              const remaining = (this.deferred.get(url.href) ?? []).filter((w) => w !== resolve);
              this.deferred.set(url.href, remaining);
              reject(new AbortedError('audit'));
            },
            { once: true },
          );
        });
        return res;
      } finally {
        this.inFlight--;
      }
    }

    if (route.throw !== undefined) throw route.throw;
    if (route.redirectError === 'loop') {
      throw new RedirectError('loop', `redirect loop at ${url.href}`, 'audit');
    }
    if (route.redirectError === 'hop-cap') {
      throw new RedirectError('hop-cap', `redirect chain exceeded 5 hops at ${url.href}`, 'audit');
    }

    const res = this.buildResponse(route);
    if (res.status === 429 || res.status >= 500) {
      if (route.passStatus !== true) {
        // core's fetcher throws the post-retry terminal outcome for retryable GET statuses
        throw new RetryExhaustedError(`request to ${url.href} still failing with status ${res.status}`, {
          attempts: 1,
          status: res.status,
          label: 'audit',
        });
      }
    }
    return res;
  }

  /** Calls whose init carried `redirect: 'manual'` (every crawler page fetch). */
  pageCalls(): FakeCall[] {
    return this.log.filter((c) => (c.init as { redirect?: string } | undefined)?.redirect === 'manual');
  }

  countFor(url: string): number {
    let n = 0;
    for (const c of this.log) if (c.url === url) n++;
    return n;
  }
}

/** Helper: a `RetryExhaustedError` carrying a status (core's post-retry terminal outcome). */
export const exhausted = (status: number): RetryExhaustedError =>
  new RetryExhaustedError(`still failing with status ${status}`, { attempts: 3, status, label: 'audit' });
