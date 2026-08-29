/**
 * Typed error hierarchy (I15/I17 style): callers never pattern-match message
 * strings. Every error class extends `LumenError` and carries an optional
 * `label` naming the provider/context it originated from.
 */

/** One actionable validation problem, named by its config path. */
export interface ConfigErrorDetail {
  path: string;
  message: string;
}

export class LumenError extends Error {
  /** Provider or fetcher label the failure is attributed to (I17). */
  readonly label?: string;

  constructor(message: string, label?: string) {
    super(message);
    this.name = new.target.name;
    this.label = label;
  }
}

/** Invalid configuration — `details` names every offending key and the valid options. */
export class ConfigError extends LumenError {
  readonly details: readonly ConfigErrorDetail[];

  constructor(details: readonly ConfigErrorDetail[]) {
    super(`invalid config: ${details.map((d) => `${d.path}: ${d.message}`).join('; ')}`);
    this.details = Object.freeze([...details]);
  }
}

/** Non-http(s) target URL (I15) — the fetcher accepts only http/https. */
export class UnsupportedSchemeError extends LumenError {
  readonly scheme: string;

  constructor(scheme: string, target: string, label?: string) {
    super(`unsupported scheme "${scheme}" for target ${target} (only http/https are fetched)`, label);
    this.scheme = scheme;
  }
}

/** Target refused by the SSRF guard (I12) — private/loopback/link-local/etc. */
export class SsrfBlockedError extends LumenError {
  constructor(target: string, label?: string) {
    super(`refusing to fetch non-public target ${target} (SSRF guard)`, label);
  }
}

/** The per-attempt deadline elapsed before the transport settled (I17). */
export class TimeoutError extends LumenError {
  readonly timeoutMs: number;

  constructor(target: string, timeoutMs: number, label?: string) {
    super(`request to ${target} timed out after ${timeoutMs}ms`, label);
    this.timeoutMs = timeoutMs;
  }
}

/** The CALLER's AbortSignal fired — fails fast, consumes no retries (I14/F3). */
export class AbortedError extends LumenError {
  constructor(label?: string) {
    super('request aborted by caller signal', label);
  }
}

/** `Retry-After` beyond the 30 s cap surfaces as a typed error instead of blocking the run (BA-4). */
export class RetryAfterCapError extends LumenError {
  readonly retryAfterMs: number;
  readonly capMs: number;

  constructor(retryAfterMs: number, capMs: number, label?: string) {
    super(`Retry-After of ${retryAfterMs}ms exceeds the ${capMs}ms cap — refusing to block the run`, label);
    this.retryAfterMs = retryAfterMs;
    this.capMs = capMs;
  }
}

export type RedirectErrorReason = 'loop' | 'hop-cap' | 'scheme';

/** Redirect discipline failure (SC-13/I15) — `reason` distinguishes the cause. */
export class RedirectError extends LumenError {
  readonly reason: RedirectErrorReason;

  constructor(reason: RedirectErrorReason, message: string, label?: string) {
    super(message, label);
    this.reason = reason;
  }
}

export interface RetryExhaustedOptions {
  attempts: number;
  status?: number;
  label?: string;
  cause?: unknown;
}

/** Retry budget exhausted (I17) — carries the attempt count and final status/cause. */
export class RetryExhaustedError extends LumenError {
  readonly attempts: number;
  readonly status?: number;

  constructor(message: string, opts: RetryExhaustedOptions) {
    super(message, opts.label);
    this.attempts = opts.attempts;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}
