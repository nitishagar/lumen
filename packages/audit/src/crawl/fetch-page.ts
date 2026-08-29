/**
 * One page fetch through the core Fetcher, classified into audit's skip
 * vocabulary (A4). Redirects are followed BY the core fetcher (its
 * `redirect: 'manual'` iterator re-validates SSRF per hop, enforces the R3
 * hop cap of 5, and detects loops); audit maps the typed outcomes:
 *
 * - `RedirectError{loop}`    → `redirect_loop`
 * - `RedirectError{hop-cap}` → `redirect_cap`
 * - `RedirectError{scheme}`  → `fetch_error` (redirect to a non-http(s) target)
 * - `RetryExhaustedError{429}` / `RetryAfterCapError` → `rate_limited`
 *   (core already retried honoring Retry-After up to its 30 s cap)
 * - anything else            → `fetch_error`
 *
 * A raw 429 RESPONSE (only possible with a non-retrying fetcher) gets exactly
 * one audit-level retry honoring `Retry-After`, capped at 5 s.
 */
import { AbortedError, RedirectError, RetryAfterCapError, RetryExhaustedError } from '@lumen-seo/core';
import type { CrawlerDeps, SkipReason } from '../types.js';
import { retryAfterMsCapped } from './robots-policy.js';

const PAGE_RETRY_AFTER_CAP_MS = 5_000;

export interface PageFetchOutcome {
  /** Final response — absent when the outcome is a skip. */
  res?: Response;
  timingMs: number;
  skip?: SkipReason;
}

const classifyError = (e: unknown): SkipReason => {
  if (e instanceof RedirectError) {
    if (e.reason === 'loop') return 'redirect_loop';
    if (e.reason === 'hop-cap') return 'redirect_cap';
    return 'fetch_error';
  }
  if (e instanceof RetryAfterCapError) return 'rate_limited';
  if (e instanceof RetryExhaustedError && e.status === 429) return 'rate_limited';
  return 'fetch_error';
};

export const fetchPage = async (url: URL, deps: CrawlerDeps, signal?: AbortSignal): Promise<PageFetchOutcome> => {
  const t0 = deps.now();
  const isAbort = (e: unknown): boolean => e instanceof AbortedError || signal?.aborted === true;

  let res: Response | undefined;
  try {
    // `redirect: 'manual'` makes the transport surface each hop to the core
    // fetcher's own iterator — per-hop SSRF revalidation (I12), R3 hop cap,
    // loop detection. No conditional-request headers are ever sent (A11).
    res = await deps.fetcher.fetch(url, { redirect: 'manual', signal });
  } catch (e) {
    if (isAbort(e)) throw new AbortedError('audit');
    return { timingMs: deps.now() - t0, skip: classifyError(e) };
  }

  if (res.status === 429) {
    const wait = retryAfterMsCapped(res.headers.get('retry-after')) ?? Math.round(deps.jitter() * PAGE_RETRY_AFTER_CAP_MS);
    try {
      await deps.delay(wait, signal);
      const retry = await deps.fetcher.fetch(url, { redirect: 'manual', signal });
      if (retry.status !== 429) return { res: retry, timingMs: deps.now() - t0 };
    } catch (e) {
      if (isAbort(e)) throw new AbortedError('audit');
      return { timingMs: deps.now() - t0, skip: classifyError(e) };
    }
    return { timingMs: deps.now() - t0, skip: 'rate_limited' };
  }

  return { res, timingMs: deps.now() - t0 };
};
