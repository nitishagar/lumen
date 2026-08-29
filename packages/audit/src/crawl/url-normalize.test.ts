import { describe, expect, it } from 'vitest';
import { isHttpUrl, normalizeKey, parseCandidateUrl } from './url-normalize.js';

describe('url-normalize', () => {
  it('rejects non-http(s) schemes', () => {
    const base = new URL('https://example.com/page');
    for (const raw of [
      'javascript:void(0)',
      'mailto:support@example.com',
      'tel:+15551234567',
      'data:text/html,hello',
      'ftp://example.com/file',
      'file:///etc/hostname',
    ]) {
      expect(parseCandidateUrl(raw, base), raw).toBeUndefined();
    }
    expect(isHttpUrl(new URL('ftp://example.com/'))).toBe(false);
    expect(isHttpUrl(new URL('https://example.com/'))).toBe(true);
    expect(isHttpUrl(new URL('http://example.com/'))).toBe(true);
  });

  it('keeps http and https candidates and resolves them against the base', () => {
    const base = new URL('https://example.com/dir/page?q=1');
    expect(parseCandidateUrl('/about', base)?.href).toBe('https://example.com/about');
    expect(parseCandidateUrl('sub', base)?.href).toBe('https://example.com/dir/sub');
    expect(parseCandidateUrl('http://other.example/x', base)?.href).toBe('http://other.example/x');
    expect(parseCandidateUrl('//other.example/y', base)?.href).toBe('https://other.example/y');
  });

  it('punycodes IDN hosts (WHATWG URL normalization, A8)', () => {
    const idn = new URL('https://Bücher.example/seite');
    expect(idn.hostname).toBe('xn--bcher-kva.example');
    const candidate = parseCandidateUrl('https://bücher.example/seite', new URL('https://example.com/'));
    expect(candidate?.hostname).toBe('xn--bcher-kva.example');
  });

  it('normalizeKey strips the fragment but keeps path/query intact', () => {
    expect(normalizeKey(new URL('https://example.com/a/b?x=1#frag'))).toBe('https://example.com/a/b?x=1');
    expect(normalizeKey(new URL('https://example.com/a/b?x=1#frag'))).toBe(
      normalizeKey(new URL('https://example.com/a/b?x=1#other')),
    );
    expect(normalizeKey(new URL('https://example.com/a?b=1'))).not.toBe(normalizeKey(new URL('https://example.com/a?b=2')));
    // does not mutate the caller's URL
    const u = new URL('https://example.com/x#keep');
    normalizeKey(u);
    expect(u.hash).toBe('#keep');
  });

  it('returns undefined for unparsable references', () => {
    expect(parseCandidateUrl('http://[::1', new URL('https://example.com/'))).toBeUndefined();
  });
});
