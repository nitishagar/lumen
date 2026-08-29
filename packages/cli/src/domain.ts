/**
 * Domain argument validation + comparison (I15/B5). IDN is normalized to
 * ASCII (punycode) via `domainToASCII`; anything that is not a bare hostname
 * (scheme, port, path, spaces, control chars, over-253) is a typed usage
 * error BEFORE the value is echoed or used.
 */
import { domainToASCII } from 'node:url';
import { UsageError } from './usage-error.js';

export const MAX_DOMAIN_LENGTH = 253;

export const normalizeDomain = (raw: string): string => {
  if (raw.length === 0) throw new UsageError('domain must not be empty');
  if (raw.length > MAX_DOMAIN_LENGTH) {
    throw new UsageError(`domain exceeds ${MAX_DOMAIN_LENGTH} characters`);
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point (I15)
  if (/[\s\x00-\x1f\x7f]/.test(raw)) throw new UsageError(`invalid domain: ${raw}`);
  // domainToASCII silently TRUNCATES a string at URL delimiters ("example.com/evil"
  // -> "example.com") — rejecting the delimiter family first guarantees we never
  // silently rewrite a malformed argument into a different domain (I15).
  if (/[/\\?#@:]/.test(raw)) throw new UsageError(`invalid domain: ${raw} (expected a bare hostname like example.com)`);
  const ascii = domainToASCII(raw.toLowerCase());
  if (ascii === null || ascii === '' || ascii.includes('/') || ascii.includes(':')) {
    throw new UsageError(`invalid domain: ${raw} (expected a bare hostname like example.com)`);
  }
  return ascii;
};

const hostOf = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return domainToASCII(parsed.hostname.toLowerCase()) ?? null;
};

/** True when the result URL's host IS the domain or a subdomain of it. */
export const matchesDomain = (resultUrl: string, normalizedDomain: string): boolean => {
  const host = hostOf(resultUrl);
  if (host === null) return false;
  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
};
