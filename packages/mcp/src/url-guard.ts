/**
 * Public-URL validation for every user-supplied URL on every surface (I12):
 * CLI positional args, MCP tool `url` params, REST `?url=`. Composes core's
 * pure predicates — scheme whitelist + private/loopback/link-local/ULA
 * blocklist — BEFORE the value is echoed or reaches any provider. WHATWG URL
 * normalizes IDN hostnames to punycode on construction.
 */
import { isAllowedScheme, isBlockedHost } from '@lumen-seo/core';

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; message: string };

const truncate = (s: string, max = 200): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export const validatePublicHttpUrl = (raw: string | null | undefined): UrlGuardResult => {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, message: 'a url is required' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: `malformed url: ${truncate(raw)}` };
  }
  if (!isAllowedScheme(url.protocol)) {
    return { ok: false, message: `unsupported scheme "${url.protocol}" — only http/https are allowed` };
  }
  if (isBlockedHost(url.hostname)) {
    return {
      ok: false,
      message: `refusing non-public target "${url.host}" (private, loopback, link-local, and ULA ranges are blocked)`,
    };
  }
  return { ok: true, url };
};
