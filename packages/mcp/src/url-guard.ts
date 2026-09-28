/**
 * Public-URL validation for every user-supplied URL on every surface (I12):
 * CLI positional args, MCP tool `url` params, REST `?url=`. Composes core's
 * pure predicates — scheme whitelist + private/loopback/link-local/ULA
 * blocklist — BEFORE the value is echoed or reaches any provider. WHATWG URL
 * normalizes IDN hostnames to punycode on construction.
 */
import { isAllowedScheme, isBlockedHost } from '@lumen-seo/core';
import type { SsrfPolicy } from '@lumen-seo/core';

export type UrlGuardResult =
  | { ok: true; url: URL }
  | { ok: false; message: string; /** true when the refusal was the private-host blocklist (E1.1 hint). */ blockedHost?: boolean };

const truncate = (s: string, max = 200): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * `policyFor` (E1.1): consulted ONLY when the blocklist refuses — a scoped
 * policy may admit a private host at the seed origin. Callers that do not
 * pass one (the Worker, every provider) get the strict guard unchanged.
 */
export const validatePublicHttpUrl = (
  raw: string | null | undefined,
  policyFor?: (url: URL) => SsrfPolicy | undefined,
): UrlGuardResult => {
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
  if (isBlockedHost(url.hostname) && !(policyFor?.(url)?.allowHost(url) ?? false)) {
    return {
      ok: false,
      blockedHost: true,
      message: `refusing non-public target "${url.host}" (private, loopback, link-local, and ULA ranges are blocked)`,
    };
  }
  return { ok: true, url };
};
