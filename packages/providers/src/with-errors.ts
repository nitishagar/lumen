/**
 * TYPE-based classification of fetch-layer failures (I17): timeout/abort is
 * recognized from the typed error NAME (`AbortError`/`TimeoutError` — core
 * Fetcher errors and DOM exceptions alike), never from message text. A
 * message that merely contains "abort"/"timeout" is NOT a timeout.
 */
import { ProviderError, UpstreamError } from './errors.js';

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
    throw new UpstreamError(name, 0, String((e as Error)?.message ?? e)); // network/other — never classified by text
  }
}
