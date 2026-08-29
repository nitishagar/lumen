/**
 * Typed provider error taxonomy (I1/I17). Every error carries the provider
 * NAME and a machine-readable `code`; callers never pattern-match message
 * text. Extends core `LumenError` so engines/surfaces can catch the whole
 * lumen error family with one instanceof check while still switching on
 * `code` for actionable behavior (not_configured → skip, rate_limited →
 * back off, parse_error → report drift, …).
 */
import { LumenError } from '@lumen-seo/core';

export type ProviderErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'blocked'
  | 'upstream_error'
  | 'parse_error'
  | 'timeout'
  | 'stale_cache';

export class ProviderError extends LumenError {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: ProviderErrorCode, provider: string, message: string, detail?: Record<string, unknown>) {
    super(`[${provider}] ${message}`, provider);
    this.code = code;
    this.provider = provider;
    if (detail !== undefined) this.detail = detail;
  }
}

/** I1: a required BYOK key is absent — a typed skip signal, never a crash and never a keyless call. */
export class NotConfiguredError extends ProviderError {
  /** The R5 env-var NAME the user must set (e.g. `LUMEN_CRUX_KEY`). */
  readonly envVar: string;

  constructor(provider: string, envVar: string, setupHint: string) {
    super('not_configured', provider, `API key missing: set ${envVar} (${setupHint})`, { envVar });
    this.envVar = envVar;
  }
}

export class RateLimitedError extends ProviderError {
  readonly retryAfterMs?: number;

  constructor(provider: string, retryAfterMs?: number, detail?: Record<string, unknown>) {
    super(
      'rate_limited',
      provider,
      `rate limited${retryAfterMs !== undefined ? `; retry after ${retryAfterMs}ms` : ''}`,
      { ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), ...detail },
    );
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** Gray CAPTCHA / bot protection / UA-gated 4xx — a degraded-path outcome, distinct from 5xx. */
export class BlockedError extends ProviderError {
  constructor(provider: string, message: string) {
    super('blocked', provider, message);
  }
}

/** HTTP 5xx (retryable class — the core Fetcher already exhausted its bounded retries) or a network failure. */
export class UpstreamError extends ProviderError {
  readonly status: number;

  constructor(provider: string, status: number, message?: string) {
    super('upstream_error', provider, message ?? `upstream HTTP ${status}`, { status });
    this.status = status;
  }
}

/** Malformed JSON/HTML or an unexpected response shape (I15) — never misclassified as upstream. */
export class ParseError extends ProviderError {
  constructor(provider: string, message: string) {
    super('parse_error', provider, message);
  }
}
