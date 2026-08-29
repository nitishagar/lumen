/**
 * Test-only doubles (I9/I10): a fake clock whose sleep ADVANCES it, a
 * recording fetcher fed from hand-written fixtures, and deps assembly.
 * Nothing here is exported from the package barrel; it exists so every
 * provider test runs with zero live network and zero wall-clock reads.
 */
import type { Fetcher } from '@lumen-seo/core';
import type { CacheStore } from './cache.js';
import { InMemoryCache } from './cache.js';
import type { ProviderDeps } from './deps.js';

/** Deterministic clock: `sleep` advances it, so GCRA/TTL tests never wait real time. */
export class FakeClock {
  private t: number;

  constructor(start = 0) {
    this.t = start;
  }

  now = (): number => this.t;

  advance = (ms: number): void => {
    this.t += ms;
  };

  set = (ms: number): void => {
    this.t = ms;
  };

  get current(): number {
    return this.t;
  }

  sleep = async (ms: number): Promise<void> => {
    this.t += ms;
  };
}

export interface RecordedCall {
  url: URL;
  init: RequestInit | undefined;
}

export type Responder = (url: URL, init: RequestInit | undefined, callIndex: number) => Response | Promise<Response>;

const identityResponder: Responder = () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });

/** An injected Fetcher that records every call and answers from a fixture responder. */
export function fakeFetcher(respond: Responder = identityResponder): Fetcher & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async fetch(url: URL, init?: RequestInit): Promise<Response> {
      calls.push({ url, init });
      return respond(url, init, calls.length - 1);
    },
  };
}

/** Convenience responder: routes by exact href prefix or, when given a queue, pops sequentially. */
export function routeResponse(routes: Array<{ match: (u: URL) => boolean; response: () => Response }>): Responder {
  return (url) => {
    for (const r of routes) if (r.match(url)) return r.response();
    throw new Error(`unexpected fetch in fixture: ${url.href}`);
  };
}

export interface DepsOverrides {
  env?: Record<string, string | undefined>;
  cache?: CacheStore;
  userAgent?: string;
}

export function makeDeps(fetcher: Fetcher, clock: FakeClock, o: DepsOverrides = {}): ProviderDeps {
  return {
    fetcher,
    cache: o.cache ?? new InMemoryCache(clock.now),
    clock: clock.now,
    sleep: clock.sleep,
    env: (name) => o.env?.[name],
    userAgent: o.userAgent ?? 'lumen/0.0.0 (+https://github.com/nitishagar/lumen)',
  };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const htmlResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

export const textResponse = (body: string, status = 200, contentType = 'text/plain'): Response =>
  new Response(body, { status, headers: { 'content-type': contentType } });
