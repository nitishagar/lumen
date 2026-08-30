/**
 * robots.txt policy (I4 / SC-14, BA-1/BA-9): `robots-parser` (pure JS,
 * RFC 9309) behind a core-owned `RobotsPolicy` wrapper — the vendoring escape
 * hatch if the unmaintained package ever breaks.
 *
 * Failure matrix (Google-compatible, conservative on fetch failure):
 * - 2xx → parse the body;
 * - 4xx (incl. 404) → allow-all;
 * - 429 / 5xx / network failure → disallow-all (any fetcher error degrades
 *   here — the seed's own SSRF block is enforced at page-fetch time);
 * - unparseable body → allow-all (documented).
 *
 * robots.txt itself is fetched through the SAME guarded Fetcher, so UA
 * (SC-12), SSRF (I12), timeout, and Retry-After semantics all apply.
 */
import robotsParserImport from 'robots-parser';
import type { Fetcher } from './fetcher.js';
import { USER_AGENT } from './ua.js';

/** Structural type for robots-parser's parse result (its shipped d.ts binds oddly under NodeNext). */
interface ParsedRobots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
}

// Single cast at the wrapper boundary — BA-1's vendoring escape hatch.
const robotsParser = robotsParserImport as unknown as (url: string, robotstxt: string) => ParsedRobots;

export interface RobotsPolicy {
  isAllowed(url: URL): boolean;
  /** Seconds (per RFC 9309), present only when a matching group declared one. */
  crawlDelay?: number;
  /** Absolute sitemap URLs from `Sitemap:` directives — P2 seeds discovery from these. */
  readonly sitemaps: readonly URL[];
}

export interface LoadRobotsOptions {
  signal?: AbortSignal;
}

const allowAll: RobotsPolicy = Object.freeze({ isAllowed: () => true, sitemaps: Object.freeze([]) });
const disallowAll: RobotsPolicy = Object.freeze({ isAllowed: () => false, sitemaps: Object.freeze([]) });

export const loadRobots = async (
  fetcher: Fetcher,
  site: URL,
  o: LoadRobotsOptions = {},
): Promise<RobotsPolicy> => {
  const robotsUrl = new URL('/robots.txt', site);

  let res: Response;
  try {
    res = await fetcher.fetch(robotsUrl, o.signal === undefined ? undefined : { signal: o.signal });
  } catch {
    return disallowAll; // network failure (incl. blocked target) → disallow-all (BA-9)
  }

  if (res.status === 429 || res.status >= 500) return disallowAll;
  if (res.status >= 400) return allowAll;

  let body: string;
  try {
    body = await res.text();
  } catch {
    return allowAll; // unreadable body → treat as unparseable
  }

  let parsed: ParsedRobots;
  try {
    parsed = robotsParser(robotsUrl.href, body);
  } catch {
    return allowAll; // unparseable body → allow-all (documented, Google-compatible)
  }

  const crawlDelay = parsed.getCrawlDelay(USER_AGENT);
  // Sitemap: values are site-controlled and frequently relative (or garbage);
  // resolve against the robots URL and drop anything invalid — a throw here
  // would reject the entire audit run (red-team round 1).
  const sitemaps = parsed
    .getSitemaps()
    .map((s) => {
      try {
        return new URL(s, robotsUrl);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => u !== null);
  return Object.freeze({
    isAllowed: (url: URL): boolean => parsed.isAllowed(url.href, USER_AGENT) ?? true,
    ...(crawlDelay !== undefined ? { crawlDelay } : {}),
    sitemaps: Object.freeze(sitemaps),
  });
};
