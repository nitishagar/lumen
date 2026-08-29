/**
 * openpagerank — Open PageRank as a heuristic AuthorityProvider (A2/BA8).
 * The locked SPI is per-domain (`authority(domain, o)`), so v1 issues ONE
 * request per domain using the documented bulk param with a single element
 * (`domains[0]=…`) — the 100-domain bulk call stays a recorded future
 * caller-side optimization. Bearer auth (the stale `API-OPR` header was
 * refuted), paced 50/min + burst 10 → worst rolling 60 s window exactly 60
 * = the documented limit. Monthly-quota exhaustion surfaces as a typed
 * rate_limited with reason `monthly-quota`; any other per-domain error or
 * missing/non-finite value OMITS that domain's signals (`[]`) — never
 * `value: undefined` (I3).
 */
import type { AuthorityOpts, AuthorityProvider, AuthoritySignal } from '@lumen-seo/core';
import type { ProviderSettings } from './config.js';
import { resolveEnvVar } from './config.js';
import type { ProviderDeps } from './deps.js';
import { isoNow } from './deps.js';
import { NotConfiguredError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { json, normalizeDomain, retryAfterMs } from './http.js';
import { ATTRIBUTION, ESTIMATE_LABELS } from './provenance.js';
import { GcraPacer, resolvePacing } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // per-domain, 30d
const OPR_DEFAULT_PACING = { rpm: 50, burst: 10 }; // + burst → worst 60 = documented limit (A2)

interface OprDomain {
  domain?: unknown;
  rank?: unknown;
  page_rank_integer?: unknown;
  page_rank_decimal?: unknown;
  status_code?: unknown;
  error?: unknown;
}

const finiteNumber = (raw: unknown): number | null => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

export class OpenPageRankProvider implements AuthorityProvider {
  readonly name = 'openpagerank';
  private readonly envVarName: string;
  private readonly pacer: GcraPacer;

  constructor(
    cfg: ProviderSettings | undefined,
    private readonly deps: ProviderDeps,
    clock: () => number,
    sleep: (ms: number) => Promise<void>,
  ) {
    this.envVarName = resolveEnvVar('openpagerank', cfg);
    const { rpm, burst } = resolvePacing(cfg ?? {}, OPR_DEFAULT_PACING, 60); // clamped ≤ 60 always
    this.pacer = new GcraPacer(rpm, burst, clock, sleep);
  }

  async authority(domain: string, _o?: AuthorityOpts): Promise<AuthoritySignal[]> {
    return withProviderErrors(this.name, async () => {
      const key = this.deps.env(this.envVarName);
      if (key === undefined) {
        throw new NotConfiguredError(this.name, this.envVarName, 'free key from openpagerank.com');
      }
      const normalized = normalizeDomain(domain);
      const cacheKey = `opr:${normalized}`;
      const cached = await this.deps.cache.get<AuthoritySignal[]>(cacheKey);
      if (cached !== undefined) return cached;

      const url = new URL('https://openpagerank.com/api/v1.0/getPageRank');
      url.searchParams.set('domains[0]', normalized); // documented bulk param, single element in v1 (BA8)
      await this.pacer.acquire();
      const res = await this.deps.fetcher.fetch(url, {
        headers: { 'user-agent': this.deps.userAgent, authorization: `Bearer ${key}` }, // A2: Bearer, NOT API-OPR
      });
      if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
      if (res.status >= 500) throw new UpstreamError(this.name, res.status);
      if (res.status >= 400) throw new UpstreamError(this.name, res.status, `HTTP ${res.status} from Open PageRank`);
      const body = (await json(res, this.name)) as { domains?: OprDomain[] };
      const entry = body?.domains?.[0];
      if (entry === undefined) throw new ParseError(this.name, 'response without domains[]');

      const errText = typeof entry.error === 'string' ? entry.error : '';
      const statusCode = finiteNumber(entry.status_code);
      if (/quota/i.test(errText) || statusCode === 429) {
        throw new RateLimitedError(this.name, undefined, { reason: 'monthly-quota' }); // A2
      }
      if (errText !== '' || (statusCode !== null && statusCode !== 200)) return []; // per-domain error → omitted (I3)

      const score = finiteNumber(entry.page_rank_decimal) ?? finiteNumber(entry.page_rank_integer);
      const rank = finiteNumber(entry.rank);
      const retrievedAt = isoNow(this.deps.clock);
      const signals: AuthoritySignal[] = [];
      if (score !== null) signals.push(this.signal(normalized, 'score', score, retrievedAt));
      if (rank !== null) signals.push(this.signal(normalized, 'rank', rank, retrievedAt));
      await this.deps.cache.set(cacheKey, signals, this.deps.clock() + TTL_MS);
      return signals; // never value: undefined (I3)
    });
  }

  private signal(domain: string, kind: 'rank' | 'score', value: number, retrievedAt: string): AuthoritySignal {
    return {
      domain,
      kind,
      value,
      provider: this.name,
      attribution: ATTRIBUTION.openpagerank,
      retrievedAt,
      estimateLabel: ESTIMATE_LABELS.openpagerank, // I3: heuristic label on every signal
    };
  }
}
