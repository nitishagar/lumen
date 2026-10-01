/**
 * TYPE-based classification of fetch-layer failures (I17): timeout/abort is
 * recognized from the typed error NAME (`AbortError`/`TimeoutError` — core
 * Fetcher errors and DOM exceptions alike), never from message text. A
 * message that merely contains "abort"/"timeout" is NOT a timeout.
 */
import { RetryExhaustedError } from '@lumen-seo/core';
import { ProviderError, RateLimitedError, UpstreamError } from './errors.js';

export const isTimeoutLike = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');

export async function withProviderErrors<T>(name: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (isTimeoutLike(e)) {
      // Covers core Fetcher timeouts AND caller AbortSignals (R7 capping fetchers).
      throw new ProviderError('timeout', name, 'fetch timed out or was aborted', {
        aborted: (e as Error).name === 'AbortError',
      });
    }
    if (e instanceof RetryExhaustedError) {
      // Type-based (I17): exhaustion carries the numeric status — 429 keeps
      // its rate_limited identity instead of collapsing to status-0 upstream
      // noise, and the rebuilt message drops the internal request URL.
      if (e.status === 429) throw new RateLimitedError(name, undefined, { attempts: e.attempts });
      throw new UpstreamError(
        name,
        e.status ?? 0,
        `request failed after ${e.attempts} attempt${e.attempts === 1 ? '' : 's'}${e.status === undefined ? '' : ` (HTTP ${e.status})`}`,
      );
    }
    throw new UpstreamError(name, 0, String((e as Error)?.message ?? e)); // network/other — never classified by text
  }
}
