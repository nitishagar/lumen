/**
 * URL normalization for the frontier (I12/I15).
 *
 * - The dedupe key strips the fragment only (same-document URLs collapse);
 *   everything else about the URL is significant.
 * - `URL` punycodes IDN hosts (A8) and lowercases the host — normalization is
 *   delegated entirely to the WHATWG URL parser.
 * - Candidates are http/https only (I12); every other scheme is filtered
 *   BEFORE enqueue and kept, at most, as a raw href string in `OutLink`.
 */

/** Fragment-stripped serialization — the frontier's dedupe/lookup key. */
export const normalizeKey = (url: URL): string => {
  const key = new URL(url.href); // never mutates the caller's URL
  key.hash = '';
  return key.href;
};

export const isHttpUrl = (url: URL): boolean => url.protocol === 'http:' || url.protocol === 'https:';

/**
 * Parse a discovered reference against a base and validate it for crawling.
 * Returns `undefined` for anything that must never be fetched: unparsable
 * references, non-http(s) schemes (`javascript:`, `mailto:`, `data:`, …).
 */
export const parseCandidateUrl = (raw: string, base: URL): URL | undefined => {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return undefined;
  }
  return isHttpUrl(url) ? url : undefined;
};
