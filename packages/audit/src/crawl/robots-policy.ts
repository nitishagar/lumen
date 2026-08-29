/**
 * The A2 robots gate: fetch `/robots.txt` ONCE through the core Fetcher,
 * classify the outcome per the conservative policy table, and parse via
 * core's `loadRobots` — fed a replay of the already-fetched response so the
 * whole gate costs exactly one network request.
 *
 * Policy table (A2 / RFC 9309):
 * - 2xx               → enforce groups (core `loadRobots`, lenient line-level parse);
 *                      `Sitemap:` lines feed discovery; none listed → probe `/sitemap.xml`.
 * - 4xx except 429    → no restrictions (no robots.txt present); probe `/sitemap.xml`.
 * - 429               → ONE audit-level retry honoring `Retry-After` (capped 5 s; the
 *                      core Fetcher has already honored it up to its own 30 s cap),
 *                      then refuse — `LumenRobotsUnreachableError`.
 * - 5xx / network / timeout after fetcher retries → refuse, zero page fetches
 *                      — `LumenRobotsUnreachableError` (conservative, I4).
 *
 * Core's `loadRobots` collapses unreachable outcomes into disallow-all; audit
 * needs the distinction (refuse-with-typed-error vs. enforce-groups), so the
 * classification happens here against the fetch outcome, and only 2xx bodies
 * are handed to core's parser.
 */
import { AbortedError, RetryExhaustedError, loadRobots } from '@lumen-seo/core';
import type { RobotsPolicy } from '@lumen-seo/core';
import { ROBOTS_RETRY_AFTER_CAP_MS } from '../config.js';
import { LumenRobotsUnreachableError } from '../types.js';
import type { CrawlerDeps } from '../types.js';

export interface RobotsGateResult {
  policy: RobotsPolicy;
  /** Probe `/sitemap.xml` when robots listed no `Sitemap:` lines (incl. 4xx robots). */
  probeSitemap: boolean;
}

const ALLOW_ALL: RobotsPolicy = Object.freeze({ isAllowed: () => true, sitemaps: Object.freeze([]) });

const isAbort = (e: unknown, signal?: AbortSignal): boolean =>
  e instanceof AbortedError || signal?.aborted === true;

/** `Retry-After` in ms, clamped to the audit-owned 5 s cap; `undefined` when absent/invalid. */
export const retryAfterMsCapped = (header: string | null): number | undefined => {
  if (header === null) return undefined;
  const trimmed = header.trim();
  const seconds = Number.parseInt(trimmed, 10);
  if (Number.isInteger(seconds) && /^[+-]?\d+$/.test(trimmed)) {
    return Math.min(Math.max(seconds, 0) * 1_000, ROBOTS_RETRY_AFTER_CAP_MS);
  }
  return undefined;
};

/** Internal marker: the fetcher exhausted its retries on a 429 (one audit-level retry allowed). */
class Robots429Exhausted extends Error {}

export const robotsGate = async (
  site: URL,
  deps: CrawlerDeps,
  signal?: AbortSignal,
): Promise<RobotsGateResult> => {
  const robotsUrl = new URL('/robots.txt', site);
  const { fetcher } = deps;
  const unreachable = (): LumenRobotsUnreachableError => new LumenRobotsUnreachableError(site.origin);

  const attempt = (): Promise<Response> =>
    fetcher.fetch(robotsUrl, { signal }).catch((e: unknown) => {
      if (isAbort(e, signal)) throw new AbortedError('audit');
      if (e instanceof RetryExhaustedError && e.status === 429) throw new Robots429Exhausted();
      throw unreachable(); // 5xx / network / timeout after core's retries
    });

  let res: Response;
  try {
    res = await attempt();
  } catch (e) {
    if (!(e instanceof Robots429Exhausted)) throw e;
    // one final audit-level attempt after a bounded, jitter-derived pause
    // (core already retried honoring Retry-After up to its 30 s cap)
    await deps.delay(deps.jitter() * ROBOTS_RETRY_AFTER_CAP_MS, signal); // abort rejects propagate
    try {
      res = await fetcher.fetch(robotsUrl, { signal });
    } catch (e2) {
      if (isAbort(e2, signal)) throw new AbortedError('audit');
      throw unreachable();
    }
  }

  if (res.status === 429) {
    // a non-retrying fetcher surfaced the 429 raw: honor the header (capped)
    const wait = retryAfterMsCapped(res.headers.get('retry-after')) ?? Math.round(deps.jitter() * ROBOTS_RETRY_AFTER_CAP_MS);
    await deps.delay(wait, signal); // abort rejects propagate
    try {
      res = await fetcher.fetch(robotsUrl, { signal });
    } catch (e) {
      if (isAbort(e, signal)) throw new AbortedError('audit');
      throw unreachable();
    }
    if (res.status === 429) throw unreachable();
  }

  if (res.status >= 500) throw unreachable();
  if (res.status >= 400) return { policy: ALLOW_ALL, probeSitemap: true };

  // 2xx — parse via core's `loadRobots`, replaying the fetched response
  // (its body is untouched so far: exactly one network fetch for the gate).
  const finalRes = res;
  const policy = await loadRobots({ fetch: async () => finalRes }, site);
  return { policy, probeSitemap: policy.sitemaps.length === 0 };
};
