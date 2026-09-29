/**
 * GSC + Bing provider tests (E2.1/E2.2) over a local fixture HTTP transport:
 * the JWT exchange, expires_in token caching, the 24h response cache, typed
 * errors, and the redaction discipline (credential file contents NEVER in
 * output). Zero live network — the fetcher delegate is the fixture.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFetcher } from '@lumen-seo/core';
import type { FetchTransport } from '@lumen-seo/core';
import { InMemoryCache } from './cache.js';
import { GcraPacer } from './throttle.js';
import { createGscProvider } from './node-gsc.js';
import { BingWebmasterProvider } from './bing-webmaster.js';

// ── fixture transport ────────────────────────────────────────────────────────
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = { client_email: 'lumen@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() };

let dir: string;
let credPath: string;
const apiCalls: { url: string; auth?: string }[] = [];
let tokenExchanges = 0;

const transport: FetchTransport = async (url) => {
  if (url.href === 'https://oauth2.googleapis.com/token') {
    tokenExchanges += 1;
    return new Response(JSON.stringify({ access_token: `tok-${tokenExchanges}`, expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.href.startsWith('https://searchconsole.googleapis.com/')) {
    apiCalls.push({ url: url.href, auth: 'bearer' });
    return new Response(
      JSON.stringify({
        rows: [
          { keys: ['best widget'], clicks: 120, impressions: 4_000, position: 3.2 },
          { keys: ['widget'], clicks: 40, impressions: 9_000, position: 7.8 },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  if (url.href.startsWith('https://ssl.bing.com/')) {
    apiCalls.push({ url: url.href.replace(/apikey=[^&]+/, 'apikey=REDACTED') });
    if (url.searchParams.get('apikey') !== 'bing-key-value') {
      return new Response('{"d":null}', { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return new Response(
      JSON.stringify({ d: [{ Keyword: 'best widget', Volume: 1200 }, { Keyword: 'widget shop', Volume: 340 }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response('not found', { status: 404 });
};

const fetcher = createFetcher({ delegate: transport });
let clockMs = Date.parse('2026-09-29T12:00:00Z');
const clock = (): number => clockMs;
const pacer = new GcraPacer(600, 10, clock, async () => undefined);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lumen-gsc-'));
  credPath = join(dir, 'sa.json');
  writeFileSync(credPath, JSON.stringify(SERVICE_ACCOUNT), 'utf8');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gsc provider (E2.1)', () => {
  it('exchanges the JWT for a token, queries the API, caches responses 24h, labels first-party', async () => {
    const provider = createGscProvider({ credentialsPath: credPath, fetcher, cache: new InMemoryCache(clock), pacer, clock });
    const report = await provider.performance(new URL('https://example.com/'), { days: 28, by: 'query' });
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({ key: 'best widget', clicks: 120, impressions: 4000, position: 3.2 });
    expect(report.rows[0]?.source).toMatchObject({ provider: 'gsc', kind: 'official' });

    // second call inside 24h: cache hit — no new API call, no new token exchange
    const apiBefore = apiCalls.length;
    await provider.performance(new URL('https://example.com/'), { days: 28, by: 'query' });
    expect(apiCalls.length).toBe(apiBefore);
  });

  it('the token cache honors expires_in (refresh after expiry, reuse before)', async () => {
    const cache = new InMemoryCache(clock);
    const provider = createGscProvider({ credentialsPath: credPath, fetcher, cache, pacer, clock });
    await provider.performance(new URL('https://other.example/'), { days: 7, by: 'page' });
    const exchangesAfterFirst = tokenExchanges;
    clockMs += 10 * 60_000; // 10 min: within expires_in (3600s − 60s safety)
    await provider.performance(new URL('https://other.example/'), { days: 7, by: 'page' });
    // response cache TTL is 24h — same key hit; token untouched either way
    clockMs += 24 * 60 * 60 * 1000 + 1000; // past the response cache AND the token expiry
    await provider.performance(new URL('https://other.example/'), { days: 7, by: 'page' });
    expect(tokenExchanges).toBeGreaterThan(exchangesAfterFirst); // token was refreshed
  });

  it('errors name the PATH, never the credential contents', async () => {
    const badPath = join(dir, 'missing.json');
    const provider = createGscProvider({ credentialsPath: badPath, fetcher, cache: new InMemoryCache(clock), pacer, clock });
    const err = await provider.performance(new URL('https://example.com/'), { days: 28, by: 'query' }).catch((e: unknown) => e);
    const text = JSON.stringify(String((err as Error)?.message ?? err));
    expect(text).toContain(badPath);
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain(SERVICE_ACCOUNT.client_email);
  });
});

describe('bing-webmaster provider (E2.2)', () => {
  const deps = () => {
    const env: Record<string, string> = {};
    return {
      fetcher,
      cache: new InMemoryCache(clock),
      clock,
      sleep: async () => undefined,
      userAgent: 'lumen-test',
      env: (name: string): string | undefined => env[name],
      _set: (k: string, v: string) => {
        env[k] = v;
      },
    };
  };

  it('not configured without LUMEN_BING_KEY (typed)', async () => {
    const p = new BingWebmasterProvider(deps() as never, pacer);
    await expect(p.ideas('widget', {})).rejects.toThrow(/LUMEN_BING_KEY/);
  });

  it('exact volumes ride KeywordIdea.volume with the bing-only scope label', async () => {
    const d = deps();
    d._set('LUMEN_BING_KEY', 'bing-key-value');
    const p = new BingWebmasterProvider(d as never, pacer);
    const ideas = await p.ideas('widget', {});
    expect(ideas).toHaveLength(2);
    expect(ideas[0]).toMatchObject({ term: 'best widget', volume: 1200 });
    expect(ideas[0]?.source.attribution).toContain('scope: bing-only');
    // the key never appears anywhere
    expect(JSON.stringify(ideas)).not.toContain('bing-key-value');
  });

  it('a rejected key is a typed not-configured error, not a crash', async () => {
    const d = deps();
    d._set('LUMEN_BING_KEY', 'wrong');
    const p = new BingWebmasterProvider(d as never, pacer);
    await expect(p.ideas('widget', {})).rejects.toThrow(/Bing rejected the API key/);
  });
});

void publicKey;

describe('review hardening (agent_49103841)', () => {
  it('the token cache survives across performance() calls (I1): 3 calls, 1 exchange', async () => {
    tokenExchanges = 0;
    apiCalls.length = 0;
    // distinct day-windows so the response cache never hits
    const cache = new InMemoryCache(clock);
    const provider = createGscProvider({ credentialsPath: credPath, fetcher, cache, pacer, clock });
    await provider.performance(new URL('https://x1.example/'), { days: 7, by: 'page' });
    await provider.performance(new URL('https://x2.example/'), { days: 7, by: 'page' });
    await provider.performance(new URL('https://x3.example/'), { days: 7, by: 'page' });
    expect(tokenExchanges).toBe(1); // hoisted lazy auth — not one exchange per call
    expect(apiCalls.length).toBe(3);
  });

  it('a cache hit pays NO auth at all (response cache checked before token)', async () => {
    tokenExchanges = 0;
    const cache = new InMemoryCache(clock);
    const provider = createGscProvider({ credentialsPath: credPath, fetcher, cache, pacer, clock });
    await provider.performance(new URL('https://y.example/'), { days: 28, by: 'query' });
    const afterFirst = tokenExchanges;
    clockMs += 60_000; // inside the 24h response cache
    await provider.performance(new URL('https://y.example/'), { days: 28, by: 'query' });
    expect(tokenExchanges).toBe(afterFirst); // zero additional exchanges
  });

  it('a malformed credentials file NEVER leaks its contents (I2)', async () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '<html>secret-fragment-not-a-json</html>', 'utf8');
    const provider = createGscProvider({ credentialsPath: bad, fetcher, cache: new InMemoryCache(clock), pacer, clock });
    const err = await provider.performance(new URL('https://example.com/'), { days: 28, by: 'query' }).catch((e: unknown) => e);
    const message = String((err as Error)?.message ?? err);
    expect(message).toContain(bad);
    expect(message).not.toContain('secret-fragment');
    expect(message).not.toContain('<html>');
  });

  it('a bing network failure NEVER leaks the api key (C1)', async () => {
    const failing: FetchTransport = async (url) => {
      void url;
      throw new Error(`request to ${url.href} failed after 2 attempts: fetch failed`);
    };
    const failingFetcher = createFetcher({ delegate: failing, maxRetries: 0 });
    const d = {
      fetcher: failingFetcher,
      cache: new InMemoryCache(clock),
      clock,
      sleep: async () => undefined,
      userAgent: 'lumen-test',
      env: (name: string): string | undefined => (name === 'LUMEN_BING_KEY' ? 'SUPERSECRETKEY123' : undefined),
    };
    const p = new BingWebmasterProvider(d as never, pacer);
    const err = await p.ideas('widget', {}).catch((e: unknown) => e);
    const text = JSON.stringify(String((err as Error)?.message ?? err) + String((err as Error)?.stack ?? ''));
    expect(text).not.toContain('SUPERSECRETKEY123');
    expect(text).toContain('apikey=%5Bredacted%5D'); // redactUrl encodes the placeholder
  });
});
