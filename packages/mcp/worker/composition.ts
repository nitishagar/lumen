/**
 * Worker composition (E5/E13/B19): per-request instances — nothing is shared
 * between requests except read-only code. `workerDeps` is the STABLE BYOK
 * seam: BYOK env NAMES map to `x-lumen-*` request headers (RENAME of the
 * plan's x-seolite-* scheme), values are read at call time through `env(name)`
 * and are NEVER logged, stored, cached, or echoed. Provider wiring itself
 * lives in `providers.ts` — the rebase commit swaps fixtures for the real
 * `createWorkerSafeProviders` wiring without touching this file.
 */
import { USER_AGENT, createFetcher } from '@lumen-seo/core';
import { createCappingFetcher } from './capping-fetcher.js';
import type { Env, WorkerProviderDeps, WorkerRestDeps } from './providers.js';
import { workerMcpDeps, workerRestDeps } from './providers.js';
import type { McpDeps } from '../src/server.js';

/** BYOK env-var NAME -> per-request header (E5; R5 scheme, lumen tokens). */
export const HEADER_FOR_ENV: Record<string, string> = {
  LUMEN_PSI_KEY: 'x-lumen-psi-key',
  LUMEN_CRUX_KEY: 'x-lumen-crux-key',
  LUMEN_OPR_KEY: 'x-lumen-opr-key',
};

/** Always-miss cache (B19): the Worker caches nothing across requests in v1. */
export const nullCache = {
  get: async (_key: string): Promise<undefined> => undefined,
  set: async (_key: string, _value: unknown): Promise<void> => undefined,
};

/**
 * The locked ProviderDeps shape for the Worker (plan Phase 5). The capping
 * fetcher wraps core's real Fetcher so every upstream read is size-capped;
 * outbound requests flow through it exclusively (I16).
 */
export const workerDeps = (headers: Headers): WorkerProviderDeps => ({
  fetcher: cappingFetcher,
  cache: nullCache,
  clock: () => Date.now(),
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
  env: (name: string): string | undefined => {
    const header = HEADER_FOR_ENV[name];
    return header === undefined ? undefined : (headers.get(header) ?? undefined);
  },
  userAgent: USER_AGENT,
});

// The capping wrapper is built over core's SSRF-guarded fetcher (module-level
// instance is stateless — it holds no per-request data; requests carry their
// own init/state).
export const cappingFetcher = createCappingFetcher(createFetcher({ label: 'worker' }));

/** Stable seam consumed by worker/index.ts (identical in both rebase states). */
export const mcpComposition = (headers: Headers, env: Env): McpDeps =>
  workerMcpDeps(headers, env, workerDeps(headers));

/** Stable REST seam consumed by worker/rest.ts via index.ts. */
export const restComposition = (headers: Headers, env: Env): WorkerRestDeps =>
  workerRestDeps(headers, env, workerDeps(headers));
