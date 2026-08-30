/**
 * Everything non-deterministic is injected (I9/I10/I12): the SSRF-guarded
 * core Fetcher (the ONLY way providers reach the network), the cache port,
 * the clock and sleep seams, the environment reader (BYOK values are read
 * at call time and never stored — I1), and the contact User-Agent (I4/A3).
 */
import type { Fetcher } from '@lumen-seo/core';
import type { CacheStore } from './cache.js';

export interface ProviderDeps {
  /** Core Fetcher — SSRF-guarded, timeout + bounded retry + Retry-After honoring (I12/I17). */
  readonly fetcher: Fetcher;
  readonly cache: CacheStore;
  /** Milliseconds since epoch; injected so TTLs and pacing are deterministic (I10). */
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Env-var lookup; secret VALUES never appear in config or state (I1/I16). */
  readonly env: (name: string) => string | undefined;
  /** Contact UA sent on every request (I4/A3 — Wikimedia policy requires contact info). */
  readonly userAgent: string;
}

/** Renders the injected clock as the ISO-8601 timestamp every payload carries (SC-17: no hidden clock). */
export const isoNow = (clock: () => number): string => new Date(clock()).toISOString();

/**
 * An empty or whitespace-only key value (e.g. `PSI_API_KEY=` in an env file)
 * is treated as absent (red-team round 1): keyed mode used to send
 * `x-goog-api-key: ''` and misread the resulting 403 as quota exhaustion.
 */
export const normalizeEnvKey = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t === undefined || t === '' ? undefined : t;
};
