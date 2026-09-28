/**
 * Scoped private-target policy tests (PRD E1.1): the pure decision matrix —
 * flag-only loopback scope, config hostname/CIDR entries, ORIGIN scoping
 * (every refusal path), loud validation of malformed / allow-everything
 * entries, and normalization parity with the SSRF blocklist.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors.js';
import {
  allowPrivateEntryError,
  createPrivateScopePolicy,
  isLoopbackHostname,
  isLoopbackIpAddress,
} from './private-scope.js';

const seed = (href: string): URL => new URL(href);

describe('flag-only loopback scope', () => {
  const p = createPrivateScopePolicy({ seedOrigin: seed('http://localhost:4321/'), loopback: true });

  it('permits loopback hosts at the seed origin only', () => {
    expect(p.allowHost(seed('http://localhost:4321/'))).toBe(true);
    expect(p.allowHost(seed('http://127.0.0.1:4321/x'))).toBe(false); // different origin (host literal differs)
    expect(p.allowHost(seed('http://sub.localhost:4321/'))).toBe(false); // different private HOST — FR-2 refuses (origin gate)
    expect(p.allowHost(new URL('http://[::1]:4321/'))).toBe(false); // different origin
    expect(p.allowHost(seed('http://localhost:9999/'))).toBe(false); // different port = different origin
    expect(p.allowHost(seed('http://10.0.0.5:4321/'))).toBe(false); // flag alone never covers private ranges
    expect(p.allowHost(seed('http://169.254.169.254:4321/'))).toBe(false);
  });

  it('permits loopback resolved IPs at the seed origin', () => {
    expect(p.allowIp(seed('http://localhost:4321/'), '127.0.0.1')).toBe(true);
    expect(p.allowIp(seed('http://localhost:4321/'), '::1')).toBe(true);
    expect(p.allowIp(seed('http://localhost:4321/'), '::ffff:127.0.0.1')).toBe(true);
    expect(p.allowIp(seed('http://localhost:4321/'), '10.0.0.5')).toBe(false);
    expect(p.allowIp(seed('http://localhost:4321/'), '169.254.169.254')).toBe(false);
    // cross-origin hop: even a loopback IP is refused off the seed origin
    expect(p.allowIp(seed('http://other.example/'), '127.0.0.1')).toBe(false);
  });
});

describe('config-hosts scope (crawl.allowPrivateHosts)', () => {
  // The origin gate (FR-2) means a CIDR/hostname entry can ever permit only the
  // SEED's own origin: admission of the seed itself + its resolved IPs. A link
  // to a DIFFERENT private host stays refused even when CIDR-covered.
  const p = createPrivateScopePolicy({
    seedOrigin: seed('http://staging.internal:8080/'),
    loopback: false,
    allowHosts: ['staging.internal', '10.0.0.0/8', 'fd00::/8', '127.0.0.1'],
  });

  it('permits the seed host (hostname entry + CIDR literal forms); other private hosts stay origin-refused', () => {
    expect(p.allowHost(seed('http://staging.internal:8080/'))).toBe(true); // seed itself, exact entry
    expect(p.allowHost(seed('http://10.1.2.3:8080/'))).toBe(false); // different origin — even though 10/8 listed
    expect(p.allowHost(seed('http://192.168.1.1:8080/'))).toBe(false);
    expect(p.allowHost(new URL('http://[fd12::1]:8080/'))).toBe(false); // different origin — though fd00::/8 listed
    expect(p.allowHost(new URL('http://[fe80::1]:8080/'))).toBe(false);
  });

  it('a CIDR-listed literal seed passes admission through its own origin', () => {
    const literalSeed = createPrivateScopePolicy({
      seedOrigin: seed('http://10.1.2.3:8080/'),
      loopback: false,
      allowHosts: ['10.0.0.0/8'],
    });
    expect(literalSeed.allowHost(seed('http://10.1.2.3:8080/'))).toBe(true); // seed itself, in 10/8
  });

  it('allowIp: hostname entries TRUST the name (documented M4); CIDR covers the seed; off-origin refused', () => {
    expect(p.allowIp(seed('http://staging.internal:8080/'), '10.2.3.4')).toBe(true); // hostname entry trusts resolution
    expect(p.allowIp(seed('http://staging.internal:8080/'), '169.254.169.254')).toBe(true); // the M4 trade-off, by design
    expect(p.allowIp(seed('http://staging.internal:8080/'), '10.2.3.4')).toBe(true); // also via 10/8
    expect(p.allowIp(seed('http://staging.internal:9999/'), '10.2.3.4')).toBe(false); // different origin (C1)
    expect(p.allowIp(seed('http://unlisted.example:8080/'), '10.9.9.9')).toBe(false); // DNS-rebind adversary (AC)
  });

  it('CIDR bounds are unsigned: high network addresses (192.168/12/169.254 ranges) match (review I2)', () => {
    for (const [cidr, host] of [
      ['192.168.0.0/16', '192.168.1.1'],
      ['172.16.0.0/12', '172.20.1.1'],
      ['169.254.0.0/16', '169.254.169.254'],
      ['192.168.1.0/24', '192.168.1.77'],
      ['128.0.0.0/1', '200.1.2.3'],
      ['10.1.2.3/32', '10.1.2.3'],
    ] as const) {
      const p = createPrivateScopePolicy({
        seedOrigin: new URL(`http://${host}:8080/`),
        loopback: false,
        allowHosts: [cidr],
      });
      expect(p.allowHost(new URL(`http://${host}:8080/`)), `${cidr} admits ${host}`).toBe(true);
      expect(p.allowIp(new URL(`http://${host}:8080/`), host), `${cidr} admits ip ${host}`).toBe(true);
    }
  });

  it('entries that can never match a URL hostname are rejected loudly (review M4)', () => {
    for (const bad of ['user@10.0.0.1', '10.0.0.1:8080', '%%', 'exa mple']) {
      expect(allowPrivateEntryError(bad), bad).not.toBeNull();
    }
    expect(allowPrivateEntryError('[::1]:8080')).not.toBeNull(); // ports are URL furniture, not hosts
    expect(allowPrivateEntryError('[fd00::1]')).toBeNull(); // bracketed v6 literal IS a host form
  });

  it('loopback flag composes with config entries at the seed origin', () => {
    const both = createPrivateScopePolicy({
      seedOrigin: seed('http://10.2.3.4:4321/'),
      loopback: true,
      allowHosts: ['10.0.0.0/8'],
    });
    expect(both.allowHost(seed('http://10.2.3.4:4321/'))).toBe(true); // seed in 10/8
    expect(both.allowIp(seed('http://10.2.3.4:4321/'), '127.0.0.1')).toBe(true); // loopback scope + seed origin
    expect(both.allowIp(seed('http://10.2.3.4:4321/'), '10.9.9.9')).toBe(true); // CIDR + seed origin
  });
});

describe('loud validation (never silently widen the guard)', () => {
  it('refuses allow-everything CIDRs', () => {
    expect(allowPrivateEntryError('0.0.0.0/0')).toContain('allow every private target');
    expect(allowPrivateEntryError('::/0')).toContain('allow every private target');
    expect(() => createPrivateScopePolicy({ seedOrigin: seed('http://localhost/'), loopback: true, allowHosts: ['0.0.0.0/0'] }))
      .toThrow(ConfigError);
  });

  it('refuses malformed entries with the offending value named', () => {
    for (const bad of ['10.0.0.0/33', '::/129', '300.1.2.3/8', 'not a host', '10.0.0.0/x', '']) {
      expect(allowPrivateEntryError(bad), bad).not.toBeNull();
    }
    expect(() =>
      createPrivateScopePolicy({ seedOrigin: seed('http://localhost/'), loopback: true, allowHosts: ['10.0.0.0/33'] }),
    ).toThrow(/10\.0\.0\.0\/33/);
  });
});

describe('loopback predicates (normalization parity with the blocklist)', () => {
  it('isLoopbackHostname matches localhost forms and 127/8 and ::1, nothing wider', () => {
    for (const yes of ['localhost', 'localhost.', 'SUB.LOCALHOST', '127.0.0.1', '127.8.8.8', '[::1]', '::ffff:127.0.0.1']) {
      expect(isLoopbackHostname(yes), yes).toBe(true);
    }
    for (const no of ['0.0.0.0', '10.0.0.1', '169.254.1.1', '::', '::ffff:10.0.0.1', 'example.com', 'localhos']) {
      expect(isLoopbackHostname(no), no).toBe(false);
    }
  });

  it('isLoopbackIpAddress matches resolved loopback forms only', () => {
    expect(isLoopbackIpAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackIpAddress('::1')).toBe(true);
    expect(isLoopbackIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackIpAddress('0.0.0.0')).toBe(false);
    expect(isLoopbackIpAddress('fe80::1')).toBe(false);
  });
});

describe('a public seed origin grants nothing extra', () => {
  it('flag + entries never relax a public seed origin', () => {
    const p = createPrivateScopePolicy({
      seedOrigin: seed('https://example.com/'),
      loopback: true,
      allowHosts: ['10.0.0.0/8', 'localhost'],
    });
    // https://example.com is not blocked, so allowHost is never consulted —
    // assert the policy still refuses anything OFF the seed origin:
    expect(p.allowHost(seed('http://localhost:4321/'))).toBe(false);
    expect(p.allowIp(seed('http://localhost:4321/'), '127.0.0.1')).toBe(false);
  });
});
