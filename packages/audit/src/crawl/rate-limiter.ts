/**
 * Per-host rate limiting (I4): request starts are spaced by
 * `max(perHostMinDelayMs, robots crawl-delay × 1000)` — RFC 9309 declares
 * crawl-delay in SECONDS; the seconds→ms conversion is pinned here.
 *
 * Grants are serialized through a promise chain so two workers can never
 * claim the same slot, and every wait goes through the injected `delay`
 * (abortable, deterministic — I10).
 */
import type { CrawlerDeps } from '../types.js';

export class RateLimiter {
  private readonly nextAllowedAt = new Map<string, number>();
  private tail: Promise<void> = Promise.resolve();
  private crawlDelayMs = 0;
  private readonly deps: Pick<CrawlerDeps, 'now' | 'delay'>;
  private readonly minIntervalMs: number;

  constructor(deps: Pick<CrawlerDeps, 'now' | 'delay'>, minIntervalMs: number) {
    this.deps = deps;
    this.minIntervalMs = minIntervalMs;
  }

  /** RFC 9309 crawl-delay in seconds — overrides the configured interval when larger. */
  setCrawlDelay(seconds: number): void {
    this.crawlDelayMs = Math.max(0, seconds) * 1_000;
  }

  effectiveIntervalMs(): number {
    return Math.max(this.minIntervalMs, this.crawlDelayMs);
  }

  /**
   * Resolve when a request to `host` may start. Rejects (abort) if `signal` fires while waiting.
   *
   * `deadlineMs` (absolute, `deps.now()` clock) caps the politeness wait
   * (red-team round 1): without it, a hostile robots crawl-delay parks the
   * whole worker pool past the audit's maxDurationMs. The caller re-checks
   * the budget after the wait and stops without fetching.
   */
  waitForTurn(host: string, signal?: AbortSignal, deadlineMs?: number): Promise<void> {
    const grant = this.tail.then(async () => {
      const interval = this.effectiveIntervalMs();
      const now = this.deps.now();
      const next = this.nextAllowedAt.get(host) ?? Number.NEGATIVE_INFINITY;
      const dueWait = next - now;
      const wait = deadlineMs === undefined ? dueWait : Math.min(dueWait, deadlineMs - now);
      if (wait > 0) await this.deps.delay(wait, signal);
      const grantedAt = this.deps.now();
      this.nextAllowedAt.set(host, Math.max(grantedAt, next) + interval);
    });
    this.tail = grant.catch(() => {}); // a failed (aborted) grant must not poison the chain
    return grant;
  }
}
