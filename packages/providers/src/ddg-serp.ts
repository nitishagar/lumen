/**
 * ddg-serp — DuckDuckGo html/lite as a gray SerpProvider (A6/BA9).
 * Node-only (cheerio is the locked DOM parser; the Worker-safe factory
 * excludes this provider per R7). Crawl-paced 6/min (10 s spacing) + burst 1
 * → worst 7/min. Status split per endpoint: 429 → rate_limited (NO fallback
 * — back off), 5xx → upstream_error (NO fallback), other 4xx or
 * challenge/anomaly markers → blocked, zero anchors with no no-results
 * marker → parse_error (layout drift). The lite endpoint is tried EXACTLY
 * ONCE per call and only after the primary yielded parse_error (drift) or
 * blocked (challenge) — never after 429/5xx. Every result is labeled gray +
 * best-effort.
 */
import * as cheerio from 'cheerio';
import type { SearchOpts, SerpProvider, SerpResult } from '@lumen-seo/core';
import type { ProviderDeps } from './deps.js';
import { isoNow } from './deps.js';
import { BlockedError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { retryAfterMs } from './http.js';
import { ATTRIBUTION, ESTIMATE_LABELS } from './provenance.js';
import { toSerpQueryOpts } from './opts-bridge.js';
import type { Pacer } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const TTL_MS = 60 * 60 * 1000;
const HTML_HOST = 'html.duckduckgo.com';
const LITE_HOST = 'lite.duckduckgo.com';

/** Resolves a result href: DDG redirect (`uddg=` param) → decoded absolute target, else the href itself. */
const decodeTarget = (href: string | undefined): string => {
  if (href === undefined || href === '') return '';
  let u: URL;
  try {
    u = new URL(href, `https://${HTML_HOST}`); // protocol-relative //duckduckgo.com/l/… resolves
  } catch {
    return href;
  }
  const uddg = u.searchParams.get('uddg');
  if (uddg !== null) {
    try {
      return new URL(uddg).href;
    } catch {
      return uddg;
    }
  }
  return u.href;
};

export class DdgSerpProvider implements SerpProvider {
  readonly name = 'ddg-serp';

  constructor(
    private readonly deps: ProviderDeps,
    private readonly pacer: Pacer,
    private readonly attribution: string = ATTRIBUTION['ddg-serp'],
  ) {}

  async search(q: string, o: SearchOpts): Promise<SerpResult[]> {
    return withProviderErrors(this.name, async () => {
      try {
        return await this.searchOn(HTML_HOST, q, o); // primary
      } catch (e) {
        const fallback = e instanceof ParseError || e instanceof BlockedError; // drift or challenge ONLY
        if (!fallback) throw e; // 429/5xx/upstream: backing off is the correct response — no fallback
        return this.searchOn(LITE_HOST, q, o); // exactly ONE fallback; lite errors propagate unchanged
      }
    });
  }

  private async searchOn(host: string, q: string, o: SearchOpts): Promise<SerpResult[]> {
    const opts = toSerpQueryOpts(o);
    const cacheKey = `ddg:${host}:${q}`;
    const cached = await this.deps.cache.get<SerpResult[]>(cacheKey);
    if (cached !== undefined) return cached.slice(0, opts.limit);

    const url = new URL(`https://${host}/${host === LITE_HOST ? 'lite/' : 'html/'}`);
    url.searchParams.set('q', q);

    await this.pacer.acquire();
    const res = await this.deps.fetcher.fetch(url, { headers: { 'user-agent': this.deps.userAgent }, signal: o.signal });
    if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
    if (res.status >= 500) throw new UpstreamError(this.name, res.status); // retryable class, NOT "bot protection"
    if (res.status >= 400) throw new BlockedError(this.name, `HTTP ${res.status} — likely bot protection`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const anchors =
      host === LITE_HOST
        ? $('a.result-link').toArray()
        : $('div.result:not(.result--ad) a.result__a').toArray(); // ads excluded
    if (anchors.length === 0) {
      // Challenge detection runs ONLY when zero anchors parsed (red-team
      // round 1): legitimate results may quote "captcha"/"challenge"/
      // "anomaly" in titles/snippets, and a whole-body scan used to
      // misclassify every such SERP as bot protection.
      const bodyText = $('body').text();
      if (/anomaly|challenge|captcha/i.test(html)) throw new BlockedError(this.name, 'challenge page');
      if (!/no\s+results/i.test(bodyText)) {
        throw new ParseError(
          this.name,
          'layout drift: 0 result anchors and no no-results marker — provider needs updating',
        );
      }
    }

    const retrievedAt = isoNow(this.deps.clock);
    const results: SerpResult[] = anchors.map((el, i) => {
      const snippet =
        host === LITE_HOST
          ? $('td.result-snippet').eq(i).text().trim()
          : $(el).closest('.result').find('a.result__snippet').text().trim();
      const result: SerpResult = {
        position: i + 1,
        url: decodeTarget($(el).attr('href')),
        title: $(el).text().trim(),
        ...(snippet !== '' ? { snippet } : {}),
        source: { provider: this.name, kind: 'gray', attribution: this.attribution },
        retrievedAt,
        estimateLabel: ESTIMATE_LABELS['ddg-serp'], // I3: best-effort honesty label
      };
      return result;
    });
    await this.deps.cache.set(cacheKey, results, this.deps.clock() + TTL_MS);
    return results.slice(0, opts.limit);
  }
}
