/**
 * crux — CrUX API v4 as the field CruxProvider (A1/A8/BA6). Key REQUIRED
 * (LUMEN_CRUX_KEY; a keyless call is NEVER made). Pacing 140/min + burst 10
 * → worst rolling 60 s window exactly 150 = the documented per-project
 * quota that no payment can raise. HTTP 404 means "no data for this
 * origin/url" → `null` record (honest absence, distinct from
 * not_configured). EVERY record carries the VERBATIM CC BY 4.0 attribution
 * sentence + methodology URL (A8). The key travels in the `x-goog-api-key`
 * header, never in the URL (I16).
 */
import type { CruxOpts, CruxProvider, CruxRecord, CruxMetric, HistogramBin } from '@lumen-seo/core';
import type { ProviderSettings } from './config.js';
import { resolveEnvVar } from './config.js';
import type { ProviderDeps } from './deps.js';
import { isoNow, normalizeEnvKey } from './deps.js';
import { NotConfiguredError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { json, retryAfterMs } from './http.js';
import { ATTRIBUTION } from './provenance.js';
import { toCruxQueryOpts } from './opts-bridge.js';
import { GcraPacer, resolvePacing } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const CRUX_DEFAULT_PACING = { rpm: 140, burst: 10 }; // + burst → worst 150 = documented limit (A1)

interface CruxBody {
  record?: {
    metrics?: Record<string, { percentiles?: { p75?: unknown }; histogram?: Array<{ start?: number; end?: number; density: number }> }>;
  };
}

const toBins = (histogram: unknown): HistogramBin[] => {
  if (!Array.isArray(histogram)) return [];
  const bins: HistogramBin[] = [];
  for (const bin of histogram) {
    if (bin === null || typeof bin !== 'object' || typeof (bin as HistogramBin).density !== 'number') continue;
    const b = bin as { start?: unknown; end?: unknown; density: number };
    const out: HistogramBin = { density: b.density };
    if (typeof b.start === 'number') out.start = b.start;
    if (typeof b.end === 'number') out.end = b.end;
    bins.push(out);
  }
  return bins;
};

export class CruxProviderImpl implements CruxProvider {
  readonly name = 'crux';
  private readonly envVarName: string;
  private readonly pacer: GcraPacer;

  constructor(
    cfg: ProviderSettings | undefined,
    private readonly deps: ProviderDeps,
    clock: () => number,
    sleep: (ms: number) => Promise<void>,
  ) {
    this.envVarName = resolveEnvVar('crux', cfg);
    const { rpm, burst } = resolvePacing(cfg ?? {}, CRUX_DEFAULT_PACING, 150); // clamped ≤ 150 always
    this.pacer = new GcraPacer(rpm, burst, clock, sleep);
  }

  async record(url: URL, o: CruxOpts): Promise<CruxRecord | null> {
    return withProviderErrors(this.name, async () => {
      const opts = toCruxQueryOpts(o);
      const key = normalizeEnvKey(this.deps.env(this.envVarName));
      if (key === undefined) {
        throw new NotConfiguredError(this.name, this.envVarName, 'CrUX API requires a Google Cloud API key (A1)');
      }
      const cacheKey = `crux:${opts.scope}:${opts.formFactor}:${url.href}`;
      const cached = await this.deps.cache.get<{ record: CruxRecord | null }>(cacheKey);
      if (cached !== undefined) return cached.record;

      const formFactor = opts.formFactor.toUpperCase() as 'PHONE' | 'DESKTOP' | 'TABLET';
      const body = JSON.stringify(
        opts.scope === 'url' ? { url: url.href, formFactor } : { origin: url.origin, formFactor },
      );

      await this.pacer.acquire();
      const res = await this.deps.fetcher.fetch(new URL('https://chromeuxreport.googleapis.com/v4/records:queryRecord'), {
        method: 'POST',
        headers: { 'user-agent': this.deps.userAgent, 'content-type': 'application/json', 'x-goog-api-key': key },
        body,
        signal: o.signal,
      });
      if (res.status === 404) {
        // Chrome UX Report has no data for this origin/url — honest absence (BA6), cached as null
        await this.deps.cache.set(cacheKey, { record: null }, this.deps.clock() + TTL_MS);
        return null;
      }
      if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
      if (res.status >= 500) throw new UpstreamError(this.name, res.status);
      if (res.status >= 400) throw new UpstreamError(this.name, res.status, `HTTP ${res.status} from CrUX`);

      const parsed = (await json(res, this.name)) as CruxBody;
      const metricsIn = parsed?.record?.metrics;
      if (metricsIn === undefined || typeof metricsIn !== 'object') {
        throw new ParseError(this.name, 'response without record.metrics');
      }
      const metrics: Record<string, CruxMetric> = {};
      for (const [name, metric] of Object.entries(metricsIn)) {
        const p75Raw = metric?.percentiles?.p75;
        metrics[name] = {
          p75: typeof p75Raw === 'number' && Number.isFinite(p75Raw) ? p75Raw : null,
          histogramBins: toBins(metric?.histogram),
        };
      }
      const record: CruxRecord = {
        metrics,
        source: { provider: this.name, kind: 'field', attribution: ATTRIBUTION.crux }, // VERBATIM CC BY 4.0 (A8/I8)
        retrievedAt: isoNow(this.deps.clock),
      };
      await this.deps.cache.set(cacheKey, { record }, this.deps.clock() + TTL_MS);
      return record;
    });
  }
}
