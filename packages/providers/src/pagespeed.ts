/**
 * pagespeed — PSI v5 as the lab (+field) PageSpeedProvider (A4/BA5/BA7).
 * Keyless trial calls are allowed only when `automated !== true`; automated
 * queries require LUMEN_PSI_KEY (NotConfigured otherwise — never a keyless
 * automated call). Keyed (60+10) and trial (6+1) requests use SEPARATE
 * pacers and SEPARATE cache keys, so a trial result can never be served to
 * a keyed call. Lab data (`lighthouseResult`) is the report's `source`
 * (kind lab); real-user field data (`loadingExperience`) rides the additive
 * `field` block (kind field), omitted entirely when absent — never zeroed.
 * The key travels in the `x-goog-api-key` header, never in the URL (I16).
 */
import type { PageSpeedOpts, PageSpeedProvider, PageSpeedReport, PageSpeedScores, PageSpeedMetrics } from '@lumen-seo/core';
import type { ProviderSettings } from './config.js';
import { resolveEnvVar } from './config.js';
import type { ProviderDeps } from './deps.js';
import { isoNow, normalizeEnvKey } from './deps.js';
import { NotConfiguredError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { json, retryAfterMs } from './http.js';
import { ATTRIBUTION } from './provenance.js';
import { toReportQueryOpts } from './opts-bridge.js';
import { GcraPacer, resolvePacing } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const TTL_MS = 6 * 60 * 60 * 1000;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

const PSI_KEYED = { rpm: 60, burst: 10 }; // worst 70 = 0.29x documented 240/min (A4)
const PSI_KEYLESS = { rpm: 6, burst: 1 }; // undocumented unauthenticated bounds — stay far below

const score100 = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw * 100) : null;

const num = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) ? raw : null);

interface PsiBody {
  lighthouseResult?: {
    categories?: Record<string, { score?: unknown }>;
    audits?: Record<string, { numericValue?: unknown }>;
  };
  loadingExperience?: {
    overall_category?: unknown;
    metrics?: Record<string, { percentile?: unknown }>;
  };
  error?: { code?: unknown; message?: unknown };
}

export class PageSpeedProviderImpl implements PageSpeedProvider {
  readonly name = 'pagespeed';
  private readonly envVarName: string;
  private readonly keyedPacer: GcraPacer;
  private readonly keylessPacer: GcraPacer;

  constructor(
    private readonly cfg: ProviderSettings,
    private readonly deps: ProviderDeps,
    clock: () => number,
    sleep: (ms: number) => Promise<void>,
  ) {
    this.envVarName = resolveEnvVar('pagespeed', cfg);
    const keyed = resolvePacing(cfg, PSI_KEYED, 240);
    this.keyedPacer = new GcraPacer(keyed.rpm, keyed.burst, clock, sleep);
    const keyless = resolvePacing(undefined, PSI_KEYLESS);
    this.keylessPacer = new GcraPacer(keyless.rpm, keyless.burst, clock, sleep);
  }

  async report(url: URL, o: PageSpeedOpts): Promise<PageSpeedReport> {
    return withProviderErrors(this.name, async () => {
      const opts = toReportQueryOpts(o);
      const key = normalizeEnvKey(this.deps.env(this.envVarName));
      if (key === undefined && opts.automated) {
        throw new NotConfiguredError(this.name, this.envVarName, 'required for automated multiple queries (A4/BA5)');
      }
      const mode = key === undefined ? 'trial' : 'keyed';
      const cacheKey = `psi:${mode}:${opts.strategy}:${url.href}`; // modes NEVER share entries
      const cached = await this.deps.cache.get<PageSpeedReport>(cacheKey);
      if (cached !== undefined) return cached;

      const target = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
      target.searchParams.set('url', url.href);
      target.searchParams.set('strategy', opts.strategy);
      for (const category of CATEGORIES) target.searchParams.append('category', category);

      await (mode === 'keyed' ? this.keyedPacer : this.keylessPacer).acquire();
      const res = await this.deps.fetcher.fetch(target, {
        headers: {
          'user-agent': this.deps.userAgent,
          ...(key !== undefined ? { 'x-goog-api-key': key } : {}), // key in a header, never the URL (I16)
        },
        signal: o.signal,
      });
      if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
      if (res.status >= 500) throw new UpstreamError(this.name, res.status);
      if (res.status >= 400) throw new UpstreamError(this.name, res.status, `HTTP ${res.status} from PSI`);
      const body = (await json(res, this.name)) as PsiBody;

      // Google error envelope (can arrive on 200/4xx): 429/403-quota → rate_limited
      const envelope = body?.error;
      if (envelope !== undefined) {
        const code = typeof envelope.code === 'number' ? envelope.code : 0;
        const message = typeof envelope.message === 'string' ? envelope.message : '';
        if (code === 429 || code === 403) {
          throw new RateLimitedError(this.name, undefined, { reason: 'google-quota', status: code, message });
        }
        throw new UpstreamError(this.name, code, message || 'PSI error envelope');
      }

      const lh = body?.lighthouseResult;
      if (lh === undefined || typeof lh !== 'object') throw new ParseError(this.name, 'missing lighthouseResult');

      const scores: PageSpeedScores = {
        performance: score100(lh.categories?.performance?.score),
        seo: score100(lh.categories?.seo?.score),
        accessibility: score100(lh.categories?.accessibility?.score),
        bestPractices: score100(lh.categories?.['best-practices']?.score),
      };
      const metrics: PageSpeedMetrics = {
        lcp: num(lh.audits?.['largest-contentful-paint']?.numericValue),
        cls: num(lh.audits?.['cumulative-layout-shift']?.numericValue),
        tbt: num(lh.audits?.['total-blocking-time']?.numericValue),
        fcn: num(lh.audits?.['first-contentful-paint']?.numericValue), // BA7: fcn = FCP
      };

      const le = body.loadingExperience;
      const field =
        le !== undefined && typeof le === 'object'
          ? {
              overall: typeof le.overall_category === 'string' ? le.overall_category : 'UNKNOWN',
              metrics: {
                lcp: num(le.metrics?.LARGEST_CONTENTFUL_PAINT?.percentile),
                cls: num(le.metrics?.CUMULATIVE_LAYOUT_SHIFT?.percentile),
                tbt: null, // TBT is Lighthouse-lab-only; field data has FID/INP — honest null
                fcn: num(le.metrics?.FIRST_CONTENTFUL_PAINT?.percentile),
              } satisfies PageSpeedMetrics,
              source: { provider: this.name, kind: 'field' as const, attribution: ATTRIBUTION.pagespeed },
            }
          : undefined; // low-traffic origin → field omitted entirely (I3), never zero-filled

      const report: PageSpeedReport = {
        scores,
        metrics,
        source: { provider: this.name, kind: 'lab', attribution: ATTRIBUTION.pagespeed },
        ...(field !== undefined ? { field } : {}),
        retrievedAt: isoNow(this.deps.clock),
      };
      await this.deps.cache.set(cacheKey, report, this.deps.clock() + TTL_MS);
      return report;
    });
  }
}
