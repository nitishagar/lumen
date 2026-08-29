import { describe, expect, it } from 'vitest';
import { validatePublicHttpUrl } from './url-guard.js';

describe('validatePublicHttpUrl (I12)', () => {
  it('accepts public http/https urls and normalizes IDN to punycode', () => {
    const ok = validatePublicHttpUrl('https://Example.com/Path?q=1');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.url.hostname).toBe('example.com');
    const idn = validatePublicHttpUrl('https://münchen.de/');
    expect(idn.ok).toBe(true);
    if (idn.ok) expect(idn.url.hostname).toBe('xn--mnchen-3ya.de');
  });

  it('rejects missing, malformed, and non-http schemes with typed messages', () => {
    expect(validatePublicHttpUrl(undefined).ok).toBe(false);
    expect(validatePublicHttpUrl('').ok).toBe(false);
    expect(validatePublicHttpUrl('not a url').ok).toBe(false);
    const ftp = validatePublicHttpUrl('ftp://example.com/');
    expect(ftp.ok).toBe(false);
    if (!ftp.ok) expect(ftp.message).toContain('unsupported scheme');
  });

  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.20/x',
    'http://172.16.3.4/',
    'http://169.254.169.254/latest/meta-data', // cloud metadata
    'http://localhost/',
    'http://app.localhost/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::5]/',
    'http://[::ffff:10.0.0.1]/',
    'http://0.0.0.0/',
  ])('refuses private/loopback/link-local/ULA target %s', (target) => {
    const r = validatePublicHttpUrl(target);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('refusing non-public target');
  });
});
