/**
 * Fetcher-level private-target adversary tests (PRD E1.1 AC): the scoped
 * policy must NEVER create an SSRF foothold. Zero live network — transport
 * and DNS are stubs.
 */
import { describe, expect, it } from 'vitest';
import { createFetcher } from './fetcher.js';
import type { FetchTransport } from './fetcher.js';
import { SsrfBlockedError } from './errors.js';
import { createPrivateScopePolicy } from './private-scope.js';

const loopbackPolicy = (): ReturnType<typeof createPrivateScopePolicy> =>
  createPrivateScopePolicy({ seedOrigin: new URL('http://localhost:4321/'), loopback: true });

const cidrPolicy = (): ReturnType<typeof createPrivateScopePolicy> =>
  createPrivateScopePolicy({
    seedOrigin: new URL('http://10.1.2.3:8080/'),
    loopback: false,
    allowHosts: ['10.0.0.0/8', 'staging.internal'],
  });

const respond = (status: number, headers: Record<string, string>): Response =>
  new Response(null, { status, headers });

describe('adversary: redirect-to-metadata (AC)', () => {
  it('a loopback seed redirecting to 169.254.169.254 is refused WITH the flag', async () => {
    const delegate: FetchTransport = async (url) =>
      url.pathname === '/start' ? respond(302, { location: 'http://169.254.169.254/latest/meta-data/' }) : respond(200, {});
    const fetcher = createFetcher({ delegate, allowPrivate: loopbackPolicy() });
    await expect(fetcher.fetch(new URL('http://localhost:4321/start'))).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('a CIDR-scoped seed redirecting off-origin is refused too', async () => {
    const delegate: FetchTransport = async (url) =>
      url.pathname === '/start' ? respond(302, { location: 'http://169.254.169.254/' }) : respond(200, {});
    const fetcher = createFetcher({ delegate, allowPrivate: cidrPolicy() });
    await expect(fetcher.fetch(new URL('http://10.1.2.3:8080/start'))).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('adversary: DNS-rebind-to-private (AC)', () => {
  it('a public name resolving to 10.x is refused without an allowlist entry', async () => {
    const delegate: FetchTransport = async () => respond(200, {});
    const fetcher = createFetcher({
      delegate,
      allowPrivate: loopbackPolicy(),
      resolve: async (host) => (host === 'rebind.example' ? ['10.0.0.5'] : ['93.184.216.34']),
    });
    await expect(fetcher.fetch(new URL('http://rebind.example/'))).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('an explicit hostname allowlist entry permits its resolution (documented trust)', async () => {
    const seen: string[] = [];
    const delegate: FetchTransport = async (url) => {
      seen.push(url.href);
      return respond(200, {});
    };
    const fetcher = createFetcher({
      delegate,
      allowPrivate: createPrivateScopePolicy({
        seedOrigin: new URL('http://staging.internal:8080/'),
        loopback: false,
        allowHosts: ['staging.internal'],
      }),
      resolve: async () => ['10.0.0.5'],
    });
    const res = await fetcher.fetch(new URL('http://staging.internal:8080/'));
    expect(res.status).toBe(200);
    expect(seen).toEqual(['http://staging.internal:8080/']);
  });
});

describe('adversary: same-host/different-port redirect (C1)', () => {
  it('a redirect to a different ORIGIN of the same allowlisted host is refused', async () => {
    const delegate: FetchTransport = async (url) =>
      url.port === '8080' ? respond(302, { location: 'http://staging.internal:9999/' }) : respond(200, {});
    const fetcher = createFetcher({
      delegate,
      allowPrivate: cidrPolicy(),
      resolve: async () => ['10.0.0.5'],
    });
    await expect(fetcher.fetch(new URL('http://staging.internal:8080/'))).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('positive path: loopback origin works end-to-end with the flag', () => {
  it('fetch + same-origin redirect both pass the scoped policy', async () => {
    const seen: string[] = [];
    const delegate: FetchTransport = async (url) => {
      seen.push(url.href);
      return url.pathname === '/start' ? respond(302, { location: 'http://localhost:4321/final' }) : respond(200, {});
    };
    const fetcher = createFetcher({
      delegate,
      allowPrivate: loopbackPolicy(),
      resolve: async () => ['127.0.0.1'],
    });
    const res = await fetcher.fetch(new URL('http://localhost:4321/start'));
    expect(res.status).toBe(200);
    expect(seen).toEqual(['http://localhost:4321/start', 'http://localhost:4321/final']);
  });

  it('without a policy the guard is byte-identical to before (strict default)', async () => {
    const delegate: FetchTransport = async () => respond(200, {});
    const strict = createFetcher({ delegate });
    await expect(strict.fetch(new URL('http://localhost:4321/'))).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
