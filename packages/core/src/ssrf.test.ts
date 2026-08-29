import { describe, expect, it } from 'vitest';
import { isBlockedTarget } from './ssrf.js';
import { createFetcher } from './fetcher.js';
import type { FetchTransport } from './fetcher.js';
import { LumenError, RedirectError, SsrfBlockedError } from './errors.js';

const blocked = (u: string) => expect(isBlockedTarget(new URL(u)), u).toBe(true);
const allowed = (u: string) => expect(isBlockedTarget(new URL(u)), u).toBe(false);

describe('pure SSRF blocklist predicate (SC-10, I12 + BA-6)', () => {
  it('blocks every I12 IPv4 range exactly', () => {
    blocked('http://127.0.0.1/');
    blocked('http://127.99.3.4/'); // whole 127/8, not just .0.0.1
    blocked('http://10.0.0.1/');
    blocked('http://10.255.255.255/');
    blocked('http://172.16.0.1/');
    blocked('http://172.31.255.255/');
    blocked('http://192.168.1.1/');
    blocked('http://192.168.0.255/');
    blocked('http://169.254.169.254/'); // cloud metadata
    blocked('http://169.254.0.1/');
  });

  it('blocks conservative IPv4 additions (unspecified 0.0.0.0/8)', () => {
    blocked('http://0.0.0.0/');
    blocked('http://0.1.2.3/');
  });

  it('allows public IPv4, including range edges just outside the blocks', () => {
    allowed('http://172.15.255.255/');
    allowed('http://172.32.0.1/');
    allowed('http://11.0.0.1/');
    allowed('http://126.255.255.255/');
    allowed('http://128.0.0.1/');
    allowed('http://169.253.169.254/');
    allowed('http://169.255.0.1/');
    allowed('http://192.169.1.1/');
    allowed('http://8.8.8.8/');
    allowed('http://1.1.1.1/');
  });

  it('blocks every I12 IPv6 range (bracketed literals)', () => {
    blocked('http://[::1]/');
    blocked('http://[0:0:0:0:0:0:0:1]/'); // canonicalized to [::1] by URL
    blocked('http://[fe80::1]/');
    blocked('http://[fe8f::1]/'); // inside fe80::/10
    blocked('http://[febf::ffff]/'); // top of fe80::/10
    blocked('http://[fc00::1]/');
    blocked('http://[fd12:3456:789a::1]/'); // inside fc00::/7
    blocked('http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/'); // top of fc00::/7
    blocked('http://[::]/'); // unspecified (BA-6)
    // zone ids: Node's URL rejects them in http URLs outright ("Invalid URL"),
    // so they can never reach the fetcher — nothing to guard here.
  });

  it('blocks IPv4-mapped and IPv4-compatible IPv6 forms (BA-6)', () => {
    blocked('http://[::ffff:127.0.0.1]/');
    blocked('http://[::ffff:10.0.0.1]/');
    blocked('http://[::ffff:169.254.169.254]/');
    blocked('http://[::127.0.0.1]/'); // IPv4-compatible
    blocked('http://[::ffff:7f00:1]/'); // mapped, hex form
  });

  it('allows public IPv6, including mapped-public and site-local-deprecated (not in the list)', () => {
    allowed('http://[2606:4700::1111]/');
    allowed('http://[2001:4860:4860::8888]/');
    allowed('http://[::ffff:8.8.8.8]/'); // mapped PUBLIC v4 passes
    allowed('http://[fec0::1]/'); // deprecated site-local — not in I12/BA-6 list
    allowed('http://[ff00::1]/'); // multicast — not in the list
  });

  it('blocks localhost names (RFC 6761 — resolve to loopback), case-insensitively', () => {
    blocked('http://localhost/');
    blocked('http://LOCALHOST:3000/');
    blocked('http://sub.localhost/');
    allowed('http://localhost.com.au/'); // a real public domain, not a .localhost subdomain
    allowed('http://example.com/');
    allowed('http://my-localhost.example.com/');
  });

  it('ports are ignored; scheme case is normalized by URL', () => {
    blocked('http://127.0.0.1:8080/');
    blocked('https://[::1]:443/');
    allowed('HTTP://EXAMPLE.COM/');
    allowed('https://EXAMPLE.com:8443/');
  });

  it('public IDN hosts are allowed (I15)', () => {
    allowed('http://ünicode.example.com/');
    allowed('http://xn--nicode-2ya.example.com/');
  });

  it('non-http(s) schemes are blocked by the predicate (scheme whitelist)', () => {
    blocked('file:///etc/passwd');
    blocked('ftp://example.com/');
    blocked('javascript:alert(1)');
    blocked('data:text/html,hi');
  });
});

describe('per-hop re-validation through the fetcher (SC-10 / SC-13)', () => {
  const redirectMap = (hops: Record<string, string>, final: string): FetchTransport => {
    const routes: Record<string, string> = { ...hops };
    routes[final] = '';
    return async (url: URL) =>
      routes[url.href] === undefined
        ? new Response('not found', { status: 404 })
        : routes[url.href] === ''
          ? new Response('ok', { status: 200 })
          : Response.redirect(routes[url.href]!, 302);
  };

  it('public → 302 → 169.254.169.254 is blocked (metadata SSRF via redirect)', async () => {
    const fetcher = createFetcher({
      delegate: redirectMap(
        { 'https://good.example.com/': 'http://169.254.169.254/latest/meta-data/' },
        'http://169.254.169.254/latest/meta-data/',
      ),
    });
    const err = await fetcher.fetch(new URL('https://good.example.com/')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err).toBeInstanceOf(LumenError);
  });

  it('public → 302 → http://localhost/ is blocked', async () => {
    const fetcher = createFetcher({
      delegate: redirectMap({ 'https://good.example.com/': 'http://localhost/x' }, 'http://localhost/x'),
    });
    await expect(fetcher.fetch(new URL('https://good.example.com/'))).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('302 → ftp: is a RedirectError with reason "scheme"', async () => {
    const fetcher = createFetcher({
      delegate: redirectMap({ 'https://good.example.com/': 'ftp://evil.example.com/' }, 'ftp://evil.example.com/'),
    });
    const err = await fetcher.fetch(new URL('https://good.example.com/')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedirectError);
    expect((err as RedirectError).reason).toBe('scheme');
  });

  it('a 6-redirect chain errors with RedirectError "hop-cap" at the default cap of 5', async () => {
    const hops: Record<string, string> = {};
    for (let i = 0; i < 6; i++) hops[`https://h${i}.example.com/`] = `https://h${i + 1}.example.com/`;
    const fetcher = createFetcher({ delegate: redirectMap(hops, 'https://h6.example.com/') });
    const err = await fetcher.fetch(new URL('https://h0.example.com/')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedirectError);
    expect((err as RedirectError).reason).toBe('hop-cap');
  });

  it('exactly 5 redirects followed by a 200 succeeds at the default cap', async () => {
    const hops: Record<string, string> = {};
    for (let i = 0; i < 5; i++) hops[`https://h${i}.example.com/`] = `https://h${i + 1}.example.com/`;
    const fetcher = createFetcher({ delegate: redirectMap(hops, 'https://h5.example.com/') });
    const res = await fetcher.fetch(new URL('https://h0.example.com/'));
    expect(res.status).toBe(200);
  });

  it('A → B → A is a RedirectError "loop"', async () => {
    const fetcher = createFetcher({
      delegate: redirectMap(
        { 'https://a.example.com/': 'https://b.example.com/', 'https://b.example.com/': 'https://a.example.com/' },
        'https://unreachable.example.com/',
      ),
    });
    const err = await fetcher.fetch(new URL('https://a.example.com/')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedirectError);
    expect((err as RedirectError).reason).toBe('loop');
  });

  it('relative Location headers resolve against the current hop and stay public', async () => {
    const delegate: FetchTransport = async (url: URL) =>
      url.pathname === '/start'
        ? new Response(null, { status: 302, headers: { location: '/end' } })
        : new Response('done', { status: 200 });
    const fetcher = createFetcher({ delegate });
    const res = await fetcher.fetch(new URL('https://example.com/start'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('done');
  });
});
