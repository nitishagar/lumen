/**
 * Deterministic `CrawlerDeps` for tests (I10): an injectable step-clock whose
 * `delay` ADVANCES the clock by the slept amount (so rate-limit spacing and
 * budgets are observable as pure functions of the sleep calls), fixed jitter,
 * and a fixed report-id random component.
 *
 * `hang: true` swaps `delay` for a never-resolving sleep that rejects only on
 * abort — for the "abort during rate-limit sleep" test.
 */
import { AbortedError } from '@lumen-seo/core';
import type { Fetcher } from '@lumen-seo/core';
import type { CancellableDelay, CrawlerDeps } from '../types.js';

export interface TestDeps extends CrawlerDeps {
  /** Current injected time (ms). */
  readonly time: { value: number };
}

export const makeTestDeps = (
  fetcher: Fetcher,
  o: { start?: number; hang?: boolean; time?: { value: number } } = {},
): TestDeps => {
  const time = o.time ?? { value: o.start ?? 0 };

  const delay = (ms: number, signal?: AbortSignal): CancellableDelay => {
    if (o.hang === true) {
      const pending = new Promise<void>((_, reject) => {
        if (signal?.aborted) {
          reject(new AbortedError('audit'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new AbortedError('audit')), { once: true });
      });
      return Object.assign(pending, { cancel: () => {} });
    }
    const pending = new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortedError('audit'));
        return;
      }
      time.value += ms; // step-clock: sleeping advances time deterministically
      resolve();
    });
    return Object.assign(pending, { cancel: () => {} });
  };

  return {
    fetcher,
    now: () => time.value,
    delay,
    jitter: () => 0.5,
    randomId: () => 'a1b2c3',
    time,
  };
};
