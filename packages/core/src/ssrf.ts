/**
 * Pure SSRF guard (I12 / SC-10, BA-6) — zero I/O, unit-testable anywhere,
 * safe to import in Workers. The decision logic only:
 *
 * - scheme whitelist: http/https only (case-insensitive, post-URL-normalization);
 * - IPv4 blocklist: 0.0.0.0/8 (unspecified, conservative addition),
 *   10/8, 127/8, 169.254/16, 172.16/12, 192.168/16 (I12 minimum);
 * - IPv6 blocklist: :: (unspecified), ::1, fc00::/7 (ULA), fe80::/10
 *   (link-local), ::ffff:0:0/96 (IPv4-mapped — embedded v4 also checked),
 *   and IPv4-compatible `::<v4>` forms;
 * - `localhost` and `*.localhost` hostnames (RFC 6761 — they resolve to
 *   loopback; conservative addition);
 * - ports are irrelevant; bracketed IPv6 and zone ids are normalized;
 * - regular DNS names pass here — Node validates RESOLVED IPs pre-connect
 *   via the injectable `resolve` seam (BA-7); DNS-rebinding ToCToU is out of
 *   scope for v1 per the inherited I12 bounding assumption.
 */

/** protocol includes the trailing colon, as `URL.protocol` provides. */
export const isAllowedScheme = (protocol: string): boolean => {
  const p = protocol.toLowerCase();
  return p === 'http:' || p === 'https:';
};

const V4_RANGES: readonly [number, number][] = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 — unspecified (BA-6)
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
];

const ipv4ToInt = (s: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m === null) return null;
  let value = 0;
  for (const part of m.slice(1)) {
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
};

const isBlockedIpv4 = (ip: number): boolean => {
  for (const [lo, hi] of V4_RANGES) if (ip >= lo && ip <= hi) return true;
  return false;
};

const parseIpv6 = (input: string): bigint | null => {
  let s = input;
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    // embedded IPv4 tail (::ffff:a.b.c.d / ::a.b.c.d) → two hex groups
    const v4 = ipv4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  let groups: string[];
  if (halves.length === 2) {
    const left = halves[0] === '' ? [] : halves[0]!.split(':');
    const right = halves[1] === '' ? [] : halves[1]!.split(':');
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  } else {
    groups = s.split(':');
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return value;
};

const V6_RANGES: readonly [bigint, bigint][] = [
  [0x00000000000000000000000000000000n, 0x00000000000000000000000000000000n], // ::
  [0x00000000000000000000000000000001n, 0x00000000000000000000000000000001n], // ::1
  [0xfc00n << 112n, 0xfdffn << 112n | ((1n << 121n) - 1n)], // fc00::/7 (ULA)
  [0xfe80n << 112n, 0xfebfn << 112n | ((1n << 118n) - 1n)], // fe80::/10 (link-local)
];

const isBlockedIpv6 = (addr: bigint): boolean => {
  for (const [lo, hi] of V6_RANGES) if (addr >= lo && addr <= hi) return true;
  // ::ffff:0:0/96 — the mapped prefix sits in bits 32..47 of the 128-bit value.
  if (addr >> 32n === 0xffffn) return isBlockedIpv4(Number(addr & 0xffffffffn)); // IPv4-mapped
  if (addr >> 32n === 0n) return isBlockedIpv4(Number(addr & 0xffffffffn)); // IPv4-compatible ::<v4>
  return false;
};

/** Strips brackets and a zone id from a URL hostname. */
const normalizeHost = (hostname: string): string => {
  let host = hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zone = host.indexOf('%');
  if (zone !== -1) host = host.slice(0, zone);
  return host.toLowerCase();
};

/** Host-only blocklist decision (scheme NOT considered — see isBlockedTarget). */
export const isBlockedHost = (hostname: string): boolean => {
  const host = normalizeHost(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4ToInt(host);
  if (v4 !== null) return isBlockedIpv4(v4);
  const v6 = parseIpv6(host);
  if (v6 !== null) return isBlockedIpv6(v6);
  return false; // plain DNS name — resolver seam owns it (BA-7)
};

/** True when the hostname is an IPv4/IPv6 literal (no DNS resolution needed). */
export const isIpLiteral = (hostname: string): boolean => {
  const host = normalizeHost(hostname);
  return ipv4ToInt(host) !== null || parseIpv6(host) !== null;
};

/** Blocklist decision for a bare IP string (as returned by a DNS resolver). */
export const isBlockedIpAddress = (ip: string): boolean => {
  const host = normalizeHost(ip);
  const v4 = ipv4ToInt(host);
  if (v4 !== null) return isBlockedIpv4(v4);
  const v6 = parseIpv6(host);
  return v6 !== null && isBlockedIpv6(v6);
};

/**
 * The complete pure predicate: non-http(s) schemes and non-public hosts are
 * both "blocked". The fetcher distinguishes the typed error (scheme vs SSRF).
 */
export const isBlockedTarget = (url: URL): boolean =>
  !isAllowedScheme(url.protocol) || isBlockedHost(url.hostname);
