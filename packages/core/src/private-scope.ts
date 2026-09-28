/**
 * Scoped private-target opt-in (PRD E1.1 / D3) — the pure decision logic that
 * MAY relax the SSRF host/resolved-IP checks for ONE seed origin. Pure and
 * Worker-safe: no I/O, no environment reads.
 *
 * Invariants (HC1):
 * - ORIGIN-SCOPED: every decision first requires `url.origin === seedOrigin.origin`.
 *   A redirect or link to any other origin is refused by the blocklist path,
 *   even when the target is loopback or explicitly allowlisted.
 * - The flag alone permits LOOPBACK only (localhost, `*.localhost`, 127/8, ::1);
 *   any other private range must be named in `crawl.allowPrivateHosts` as an
 *   exact hostname or CIDR.
 * - `allowIp` receives the HOP URL (not a bare hostname) so the origin check
 *   provably precedes every allowlist clause — a same-host/different-port
 *   redirect is a different origin and stays refused.
 * - `0.0.0.0/0` / `::/0` are refused at construction: they are
 *   allow-everything-private, not a scope.
 * - A HOSTNAME allowlist entry is a trust statement about that name's
 *   resolution at call time (consistent with the documented v1 DNS-rebind
 *   bounding) — docs recommend CIDR/literal entries instead.
 */
import { ConfigError } from './errors.js';
import { ipv4ToInt, isBlockedHost, normalizeHost, parseIpv6 } from './ssrf.js';

export interface SsrfPolicy {
  /** May this URL's (private) host be fetched? Consulted only when the blocklist already said blocked. */
  allowHost: (url: URL) => boolean;
  /** May this (private) resolved IP be contacted for this hop URL? Origin check included. */
  allowIp: (url: URL, ip: string) => boolean;
}

export interface PrivateScopeOptions {
  /** The ONLY origin whose private hosts may be fetched. */
  seedOrigin: URL;
  /** Flag-level scope: loopback only (`--allow-private` without config entries). */
  loopback: boolean;
  /** `crawl.allowPrivateHosts`: exact hostnames or CIDR ranges. */
  allowHosts?: readonly string[];
}

/** Loopback-only hostnames: `localhost`, `*.localhost`, 127.0.0.0/8, `::1` (+ mapped-127 forms). */
export const isLoopbackHostname = (hostname: string): boolean => {
  const host = normalizeHost(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4ToInt(host);
  if (v4 !== null) return v4 >>> 24 === 127;
  const v6 = parseIpv6(host);
  if (v6 === null) return false;
  if (v6 === 1n) return true; // ::1
  if (v6 >> 32n === 0xffffn) return Number(v6 & 0xffffffffn) >>> 24 === 127; // ::ffff:127.x
  return false;
};

/** Loopback-only resolved IPs (as returned by a DNS resolver). */
export const isLoopbackIpAddress = (ip: string): boolean => {
  const host = normalizeHost(ip);
  const v4 = ipv4ToInt(host);
  if (v4 !== null) return v4 >>> 24 === 127;
  const v6 = parseIpv6(host);
  if (v6 === null) return false;
  if (v6 === 1n) return true;
  if (v6 >> 32n === 0xffffn) return Number(v6 & 0xffffffffn) >>> 24 === 127;
  return false;
};

interface Cidr {
  readonly kind: 'v4' | 'v6';
  readonly v4Lo?: number;
  readonly v4Hi?: number;
  readonly v6Prefix?: bigint;
  readonly bits?: number;
}

/** Human-readable reason an entry is invalid, or null when it is a usable hostname-or-CIDR. */
export const allowPrivateEntryError = (raw: string): string | null => {
  const entry = raw.trim();
  if (entry === '') return 'empty entry';
  const slash = entry.indexOf('/');
  if (slash === -1) {
    // exact hostname entry (may be an IP literal) — same normalization as the
    // blocklist. Grammar check: anything containing userinfo/ports/zone-ids or
    // other URL furniture can never match a url.hostname, so it is rejected
    // loudly rather than accepted as a silently-inert entry (review M4).
    const host = normalizeHost(entry);
    const isV6Literal = parseIpv6(host) !== null;
    if (host === '' || (!isV6Literal && !/^[a-z0-9._-]+$/.test(host))) {
      return `not a hostname: "${entry}"`;
    }
    return null;
  }
  const addr = entry.slice(0, slash);
  const prefixText = entry.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return `bad prefix length in "${entry}"`;
  const bits = Number(prefixText);
  const ALLOW_ALL = 'would allow every private target — name the ranges you actually need';
  const v4 = ipv4ToInt(addr);
  if (v4 !== null) {
    if (bits === 0) return `"${entry}" ${ALLOW_ALL}`;
    if (bits > 32) return `v4 prefix must be 1..32 in "${entry}"`;
    return null;
  }
  const v6 = parseIpv6(addr);
  if (v6 !== null) {
    if (bits === 0) return `"${entry}" ${ALLOW_ALL}`;
    if (bits > 128) return `v6 prefix must be 1..128 in "${entry}"`;
    return null;
  }
  return `not a hostname or CIDR: "${entry}"`;
};

const parseCidr = (entry: string): Cidr | null => {
  const slash = entry.indexOf('/');
  if (slash === -1) return null;
  const bits = Number(entry.slice(slash + 1));
  const v4 = ipv4ToInt(entry.slice(0, slash));
  if (v4 !== null) {
    // >>> 0 keeps the bounds in the UNSIGNED domain ipv4ToInt produces —
    // a signed mask makes every range >= 128.0.0.0 compare against negatives
    // and match nothing (security-review I2).
    const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) & 0xffffffff;
    return { kind: 'v4', v4Lo: (v4 & mask) >>> 0, v4Hi: ((v4 & mask) | (~mask & 0xffffffff)) >>> 0 };
  }
  const v6 = parseIpv6(entry.slice(0, slash));
  if (v6 !== null) return { kind: 'v6', v6Prefix: v6 >> (128n - BigInt(bits)), bits };
  return null;
};

const hostInCidr = (c: Cidr, hostname: string): boolean => {
  const host = normalizeHost(hostname);
  const v4 = ipv4ToInt(host);
  if (c.kind === 'v4') return v4 !== null && v4 >= c.v4Lo! && v4 <= c.v4Hi!;
  const v6 = parseIpv6(host);
  return v6 !== null && (v6 >> (128n - BigInt(c.bits!))) === c.v6Prefix!;
};

const ipInCidr = (c: Cidr, ip: string): boolean => hostInCidr(c, ip);

/**
 * Builds the scoped policy. Throws `ConfigError` on malformed entries so a bad
 * allowlist surfaces as exit 2 BEFORE any fetch (loud validation, never silent).
 */
export const createPrivateScopePolicy = (opts: PrivateScopeOptions): SsrfPolicy => {
  const hostnames = new Set<string>();
  const cidrs: Cidr[] = [];
  for (const raw of opts.allowHosts ?? []) {
    const error = allowPrivateEntryError(raw);
    if (error !== null) throw new ConfigError([{ path: 'crawl.allowPrivateHosts', message: error }]);
    const cidr = parseCidr(raw.trim());
    if (cidr !== null) cidrs.push(cidr);
    else hostnames.add(normalizeHost(raw));
  }
  const seed = opts.seedOrigin;
  const originOk = (url: URL): boolean => url.origin === seed.origin;

  const hostnameAllowed = (hostname: string): boolean =>
    (opts.loopback && isLoopbackHostname(hostname)) ||
    hostnames.has(normalizeHost(hostname)) ||
    cidrs.some((c) => hostInCidr(c, hostname));

  return {
    allowHost: (url) => originOk(url) && hostnameAllowed(url.hostname),
    allowIp: (url, ip) =>
      originOk(url) &&
      ((opts.loopback && isLoopbackIpAddress(ip)) ||
        cidrs.some((c) => ipInCidr(c, ip)) ||
        hostnames.has(normalizeHost(url.hostname))),
  };
};

/** True when the seed itself is a blocked (private/loopback/etc.) host — report labeling (FR-4). */
export const seedIsPrivate = (seed: URL): boolean => isBlockedHost(seed.hostname);
