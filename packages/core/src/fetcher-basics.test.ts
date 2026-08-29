import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createFetcher } from './fetcher.js';
import type { FetchTransport } from './fetcher.js';
import { LumenError, SsrfBlockedError, UnsupportedSchemeError } from './errors.js';
import { USER_AGENT } from './ua.js';

describe('User-Agent discipline (SC-12, I4)', () => {
  it('every request carries the fixed lumen UA with contact URL', async () => {
    const seen: string[] = [];
    const delegate: FetchTransport = async () => {
      seen.push(USER_AGENT);
      return new Response('ok');
    };
    const fetcher = createFetcher({ delegate });
    await fetcher.fetch(new URL('https://example.com/'));
    expect(seen).toEqual([USER_AGENT]);
    expect(USER_AGENT).toMatch(/^lumen\/[\d.]+ \(\+https:\/\/github\.com\/nitishagar\/lumen\)$/);
  });

  it('a caller-supplied user-agent is overridden; other caller headers survive', async () => {
    let captured: Headers | undefined;
    const delegate: FetchTransport = async (_url: URL, init?: RequestInit) => {
      captured = new Headers(init?.headers);
      return new Response('ok');
    };
    const fetcher = createFetcher({ delegate });
    await fetcher.fetch(new URL('https://example.com/'), {
      headers: { 'user-agent': 'sneaky/1.0', 'accept-language': 'de' },
    });
    expect(captured?.get('user-agent')).toBe(USER_AGENT); // cannot be suppressed/overridden in v1
    expect(captured?.get('accept-language')).toBe('de'); // caller keys merged, not dropped
  });

  it('UA <version> stays in sync with packages/core/package.json version (F6)', async () => {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
    expect(USER_AGENT.startsWith(`lumen/${pkg.version} `)).toBe(true);
  });
});

describe('fetcher basics', () => {
  it('GET returns the transport response; URL and method are passed through', async () => {
    const calls: { url: string; method: string }[] = [];
    const delegate: FetchTransport = async (url: URL, init?: RequestInit) => {
      calls.push({ url: url.href, method: init?.method ?? 'GET' });
      return new Response('body', { status: 201, headers: { 'x-test': 'yes' } });
    };
    const fetcher = createFetcher({ delegate });
    const res = await fetcher.fetch(new URL('https://example.com/a?b=1'));
    expect(res.status).toBe(201);
    expect(res.headers.get('x-test')).toBe('yes');
    expect(await res.text()).toBe('body');
    expect(calls).toEqual([{ url: 'https://example.com/a?b=1', method: 'GET' }]);
  });

  it('non-http(s) target URL is a typed UnsupportedSchemeError, no transport call', async () => {
    let calls = 0;
    const delegate: FetchTransport = async () => {
      calls += 1;
      return new Response('ok');
    };
    const fetcher = createFetcher({ delegate });
    for (const bad of ['file:///etc/passwd', 'ftp://example.com/x']) {
      const err = await fetcher.fetch(new URL(bad)).catch((e: unknown) => e);
      expect(err, bad).toBeInstanceOf(UnsupportedSchemeError);
      expect(err).toBeInstanceOf(LumenError);
    }
    expect(calls).toBe(0);
  });

  it('hostname resolving to a private IP is blocked pre-connect (Node resolver seam, SC-10)', async () => {
    let calls = 0;
    const delegate: FetchTransport = async () => {
      calls += 1;
      return new Response('ok');
    };
    const fetcher = createFetcher({ delegate, resolve: async () => ['203.0.113.10', '10.0.0.5'] });
    await expect(fetcher.fetch(new URL('https://example.com/'))).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(calls).toBe(0); // refused BEFORE connecting
  });

  it('a hostname resolving only to public IPs proceeds', async () => {
    const resolvedHosts: string[] = [];
    const delegate: FetchTransport = async () => new Response('ok');
    const fetcher = createFetcher({
      delegate,
      resolve: async (host) => {
        resolvedHosts.push(host);
        return ['203.0.113.10'];
      },
    });
    const res = await fetcher.fetch(new URL('https://example.com/'));
    expect(res.status).toBe(200);
    expect(resolvedHosts).toEqual(['example.com']);
  });

  it('IP-literal URLs skip DNS resolution (already covered by the pure policy)', async () => {
    const resolvedHosts: string[] = [];
    const delegate: FetchTransport = async () => new Response('ok');
    const fetcher = createFetcher({
      delegate,
      resolve: async (host) => {
        resolvedHosts.push(host);
        return ['10.0.0.5']; // would block if consulted for the literal
      },
    });
    await expect(fetcher.fetch(new URL('https://203.0.113.10/'))).resolves.toBeInstanceOf(Response);
    expect(resolvedHosts).toEqual([]);
  });
});
