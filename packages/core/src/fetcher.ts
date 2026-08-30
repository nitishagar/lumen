/**
 * The one injectable `Fetcher` (ARCHITECTURE lock): every outbound HTTP call in
 * lumen flows through `createFetcher`, which composes
 *
 * - the pure SSRF guard + scheme whitelist, re-validated on EVERY redirect hop
 *   (I12/SC-10/SC-13), plus pre-connect validation of DNS results through the
 *   injectable `resolve` seam on Node (BA-7);
 * - a fixed, unsuppressible User-Agent (SC-12);
 * - a per-attempt timeout composed with the caller's AbortSignal (I14/F3);
 * - bounded retries (GET/HEAD only; network errors, 429, 5xx retryable —
 *   BA-5) with exponential backoff + full jitter and Retry-After honoring
 *   (delta-seconds or HTTP-date, capped at 30 s — BA-4);
 * - manual redirect iteration with a hop cap (5) and seen-set loop detection.
 *
 * Determinism seams (I9/I10): `delegate` (transport), `resolve` (DNS),
 * `sleep`, `rng`, and `now` are all injectable, so every behavior above is
 * testable with zero live network and zero wall-clock dependence.
 */
import { AbortedError, RedirectError, RetryAfterCapError, RetryExhaustedError, SsrfBlockedError, TimeoutError, UnsupportedSchemeError } from './errors.js';
import { isAllowedScheme, isBlockedHost, isBlockedIpAddress, isIpLiteral } from './ssrf.js';
import { USER_AGENT } from './ua.js';

export interface Fetcher {
  fetch(url: URL, init?: RequestInit): Promise<Response>;
}

/** Narrow transport seam — the fetcher always calls it with a parsed URL. */
export type FetchTransport = (url: URL, init?: RequestInit) => Promise<Response>;

export interface FetcherOptions {
  /** Per-attempt timeout (R3 default 10 000). */
  timeoutMs?: number;
  /** Retry budget on top of the first attempt (R3 default 2). */
  maxRetries?: number;
  /** Exponential backoff base, factor 2, full jitter (BA-4 default 500). */
  baseBackoffMs?: number;
  /** Redirect hop cap (R3 default 5). */
  maxRedirects?: number;
  /** Provider/label name carried on every typed error (I17). */
  label?: string;
  /** Transport seam (default: globalThis.fetch). */
  delegate?: FetchTransport;
  /** Hostname → resolved IPs; ANY blocked IP refuses the request pre-connect (Node: node:dns). */
  resolve?: (host: string) => Promise<string[]>;
  /** Sleep seam (default: setTimeout; fake timers / recorders in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** RNG seam for full jitter (default: Math.random; seeded in tests). */
  rng?: () => number;
  /** Clock seam, ms since epoch — used for HTTP-date Retry-After (default: Date.now). */
  now?: () => number;
}

/** Retry-After values above this surface as RetryAfterCapError instead of blocking (BA-4). */
export const RETRY_AFTER_CAP_MS = 30_000;

const DEFAULTS = {
  timeoutMs: 10_000,
  maxRetries: 2,
  baseBackoffMs: 500,
  maxRedirects: 5,
} as const;

const isRedirectStatus = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

const isRetryableStatus = (status: number): boolean =>
  status === 429 || (status >= 500 && status <= 599);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const createFetcher = (opts: FetcherOptions = {}): Fetcher => {
  const {
    timeoutMs = DEFAULTS.timeoutMs,
    maxRetries = DEFAULTS.maxRetries,
    baseBackoffMs = DEFAULTS.baseBackoffMs,
    maxRedirects = DEFAULTS.maxRedirects,
    label,
    delegate = (url, init) => globalThis.fetch(url, init),
    resolve,
    sleep = defaultSleep,
    rng = Math.random,
    now = Date.now,
  } = opts;

  /** Scheme + blocklist + (when wired) resolved-IP validation for one hop. */
  const assertHopAllowed = async (url: URL, isRedirectHop: boolean): Promise<void> => {
    if (!isAllowedScheme(url.protocol)) {
      throw isRedirectHop
        ? new RedirectError('scheme', `redirect to non-http(s) target ${url.href}`, label)
        : new UnsupportedSchemeError(url.protocol, url.href, label);
    }
    if (isBlockedHost(url.hostname)) throw new SsrfBlockedError(url.href, label);
    if (resolve !== undefined && !isIpLiteral(url.hostname)) {
      let ips: string[];
      try {
        ips = await resolve(url.hostname);
      } catch {
        throw new SsrfBlockedError(url.href, label); // resolution failure → refuse (conservative)
      }
      if (ips.some((ip) => isBlockedIpAddress(ip))) throw new SsrfBlockedError(url.href, label);
    }
  };

  /** One transport call: UA applied, deadline + caller-abort raced, typed classification. */
  const attemptOnce = async (url: URL, method: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> => {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new TimeoutError(url.href, timeoutMs, label));
      }, timeoutMs);
    });

    let abortPromise: Promise<never> | undefined;
    if (signal !== undefined) {
      abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort(signal.reason);
          reject(new AbortedError(label));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    const headers = new Headers(init.headers);
    headers.set('user-agent', USER_AGENT); // fixed, unsuppressible (SC-12)
    const composedInit: RequestInit = { ...init, method, headers, signal: controller.signal };

    try {
      const racers: Promise<Response | never>[] = [delegate(url, composedInit), timeoutPromise];
      if (abortPromise !== undefined) racers.push(abortPromise);
      return await Promise.race(racers);
    } catch (e) {
      if (e instanceof TimeoutError) throw e;
      if (signal?.aborted) throw new AbortedError(label);
      if (timedOut) throw new TimeoutError(url.href, timeoutMs, label);
      throw e; // raw transport error — classified by the retry loop
    } finally {
      clearTimeout(timer);
      if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort);
    }
  };

  /** Delay before the next attempt: Retry-After when present, else full-jitter backoff. */
  const computeRetryDelayMs = (res: Response, attempt: number): number => {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter !== null) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (Number.isInteger(seconds) && /^[+-]?\d+$/.test(retryAfter.trim())) {
        const ms = seconds * 1000;
        if (ms > RETRY_AFTER_CAP_MS) throw new RetryAfterCapError(ms, RETRY_AFTER_CAP_MS, label);
        return Math.max(0, ms);
      }
      const dateMs = Date.parse(retryAfter);
      if (!Number.isNaN(dateMs)) {
        const ms = dateMs - now();
        if (ms > RETRY_AFTER_CAP_MS) throw new RetryAfterCapError(ms, RETRY_AFTER_CAP_MS, label);
        return Math.max(0, ms);
      }
      // invalid header → fall through to backoff
    }
    return rng() * baseBackoffMs * 2 ** attempt; // full jitter: uniform [0, base × 2^attempt]
  };

  const attemptWithRetries = async (url: URL, method: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> => {
    const retryableMethod = method === 'GET' || method === 'HEAD';
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new AbortedError(label);
      let outcome: Response | Error;
      try {
        outcome = await attemptOnce(url, method, init, signal);
      } catch (e) {
        outcome = e instanceof Error ? e : new Error(String(e));
      }

      if (outcome instanceof Response) {
        if (!isRetryableStatus(outcome.status) || !retryableMethod) return outcome;
        if (attempt >= maxRetries) {
          throw new RetryExhaustedError(
            `${label ?? 'request'} to ${url.href} still failing with status ${outcome.status} after ${attempt + 1} attempts`,
            { attempts: attempt + 1, status: outcome.status, label },
          );
        }
        await sleep(computeRetryDelayMs(outcome, attempt));
        continue;
      }

      // Error-class failure. Caller aborts fail fast regardless of budget.
      if (outcome instanceof AbortedError) throw outcome;
      if (attempt >= maxRetries) {
        if (maxRetries === 0) throw outcome; // zero-budget: surface the classified error (e.g. TimeoutError)
        throw new RetryExhaustedError(
          `${label ?? 'request'} to ${url.href} failed after ${attempt + 1} attempts: ${outcome.message}`,
          { attempts: attempt + 1, label, cause: outcome },
        );
      }
      await sleep(computeBackoffMs(attempt));
    }
  };

  const computeBackoffMs = (attempt: number): number => rng() * baseBackoffMs * 2 ** attempt;

  // Headers that may cross origins on a redirect hop (CORS-safelisted request
  // headers; user-agent is re-stamped per attempt and not part of init).
  // Anything else — credentials like `authorization`, provider keys like
  // `x-goog-api-key`, cookies — is dropped when a redirect leaves the origin
  // (red-team round 1): native fetch would strip them via CORS; this manual
  // loop re-sent init verbatim, leaking BYOK keys to redirect targets.
  const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);

  const stripToCrossOriginSafe = (src: RequestInit): RequestInit => {
    const headers = new Headers(src.headers);
    for (const name of [...headers.keys()]) {
      if (!CROSS_ORIGIN_SAFE_HEADERS.has(name.toLowerCase())) headers.delete(name);
    }
    return { ...src, headers };
  };

  const fetchWithRedirects = async (url: URL, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> => {
    let current = url;
    let method = (init.method ?? 'GET').toUpperCase();
    let body = init.body;
    let hopInit = init;
    const seen = new Set<string>([url.href]);

    for (let hop = 0; ; hop++) {
      await assertHopAllowed(current, hop > 0); // scheme + SSRF re-validated EVERY hop (I12)

      const perHopInit: RequestInit = body === undefined ? { ...hopInit, body: undefined } : { ...hopInit, body };
      const res = await attemptWithRetries(current, method, perHopInit, signal);

      if (!isRedirectStatus(res.status)) return res;
      const location = res.headers.get('location');
      if (location === null) return res; // 3xx without Location: treated as final

      if (hop >= maxRedirects) {
        throw new RedirectError(
          'hop-cap',
          `redirect chain exceeded ${maxRedirects} hops at ${current.href}`,
          label,
        );
      }
      // A malformed Location lets URL's TypeError propagate — not part of the locked reason vocabulary.
      const next = new URL(location, current);
      if (seen.has(next.href)) {
        throw new RedirectError('loop', `redirect loop: ${next.href} was already visited`, label);
      }
      seen.add(next.href);

      if (res.status === 301 || res.status === 302 || res.status === 303) {
        if (method !== 'GET' && method !== 'HEAD') {
          method = 'GET'; // standard downgrade; body dropped
          body = undefined;
        }
      }
      if (next.origin !== current.origin) hopInit = stripToCrossOriginSafe(hopInit);
      current = next;
    }
  };

  return {
    async fetch(url: URL, init: RequestInit = {}): Promise<Response> {
      const signal = init.signal ?? undefined;
      if (signal?.aborted) throw new AbortedError(label);
      return fetchWithRedirects(url, init, signal);
    },
  };
};
