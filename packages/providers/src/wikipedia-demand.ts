/**
 * wikipedia-demand — en.wikipedia pageviews as a demand PROXY
 * KeywordProvider (A3/BA4). Two calls per seed: a title match, then the
 * trailing-28-day daily pageview series ending today−2d (Wikimedia data
 * lag). Contact UA on every request (Wikimedia policy), paced 60/min +
 * burst 10 (worst 70 = 0.35× documented 200/min), cached 24 h. No article
 * match → `[]` (omitted, never zero-filled); every emitted idea is labeled
 * "demand proxy, not search volume".
 */
import type { IdeasOpts, KeywordIdea, KeywordProvider } from '@lumen-seo/core';
import type { ProviderDeps } from './deps.js';
import { isoNow } from './deps.js';
import { BlockedError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { json, retryAfterMs } from './http.js';
import { ATTRIBUTION } from './provenance.js';
import { toDemandOpts } from './opts-bridge.js';
import type { Pacer } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 28;
const LAG_DAYS = 2; // last 2 days of pageview data are still settling

const ymd = (t: number): string => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

interface TitleSearchBody {
  pages?: Array<{ id: number; key: string; title: string }>;
}
interface PageviewsBody {
  items?: Array<{ project: string; article: string; timestamp: string; views: number }>;
}

export class WikipediaDemandProvider implements KeywordProvider {
  readonly name = 'wikipedia-demand';

  constructor(
    private readonly deps: ProviderDeps,
    private readonly pacer: Pacer,
    private readonly attribution: string = ATTRIBUTION.wikipedia,
  ) {}

  async ideas(seed: string, o: IdeasOpts): Promise<KeywordIdea[]> {
    return withProviderErrors(this.name, async () => {
      const { lang } = toDemandOpts(o); // v1: en.wikipedia only (BA4) — label says so explicitly
      const today = Math.floor(this.deps.clock() / DAY_MS) * DAY_MS; // UTC day of the injected clock
      const end = today - LAG_DAYS * DAY_MS;
      const cacheKey = `wiki:${lang}:${seed}:${ymd(end)}`;
      const cached = await this.deps.cache.get<KeywordIdea[]>(cacheKey);
      if (cached !== undefined) return cached;

      const article = await this.matchArticle(seed, o);
      if (article === null) return []; // no match → omitted (I3), never zero-filled
      const views = await this.pageviews(article.key, end, o);

      const idea: KeywordIdea = {
        term: seed,
        estimateLabel: `≈${views.toLocaleString('en-US')} views/${WINDOW_DAYS}d on en.wikipedia "${article.title}" — demand proxy, not search volume`,
        lang,
        source: { provider: this.name, kind: 'heuristic', attribution: this.attribution },
        retrievedAt: isoNow(this.deps.clock),
      };
      await this.deps.cache.set(cacheKey, [idea], this.deps.clock() + TTL_MS);
      return [idea];
    });
  }

  /** Contact-UA-bearing title match; returns null when nothing matches. */
  private async matchArticle(seed: string, o: IdeasOpts): Promise<{ key: string; title: string } | null> {
    const url = new URL('https://en.wikipedia.org/w/rest.php/v1/search/title');
    url.searchParams.set('q', seed);
    url.searchParams.set('limit', '1');
    const res = await this.get(url, o);
    const body = (await json(res, this.name)) as TitleSearchBody;
    const pages = body?.pages;
    if (!Array.isArray(pages)) throw new ParseError(this.name, 'unexpected title-search response shape');
    const page = pages[0];
    if (page === undefined) return null; // empty pages[] → no match → omitted (I3)
    if (typeof page.key !== 'string' || typeof page.title !== 'string') {
      throw new ParseError(this.name, 'unexpected title-search response shape');
    }
    return page;
  }

  private async pageviews(articleKey: string, end: number, o: IdeasOpts): Promise<number> {
    const start = end - (WINDOW_DAYS - 1) * DAY_MS; // 28 daily points inclusive
    const url = new URL(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/all-agents/` +
        `${encodeURIComponent(articleKey)}/daily/${ymd(start)}/${ymd(end)}`,
    );
    const res = await this.get(url, o);
    const body = (await json(res, this.name)) as PageviewsBody;
    if (!Array.isArray(body?.items)) throw new ParseError(this.name, 'unexpected pageviews response shape');
    return body.items.reduce((sum, item) => sum + (typeof item.views === 'number' ? item.views : 0), 0);
  }

  /** One paced, contact-UA-bearing GET with the shared typed status mapping (A3). */
  private async get(url: URL, o: IdeasOpts): Promise<Response> {
    await this.pacer.acquire();
    const res = await this.deps.fetcher.fetch(url, {
      headers: { 'user-agent': this.deps.userAgent }, // A3: Wikimedia requires contact info
      signal: o.signal,
    });
    if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
    if (res.status >= 500) throw new UpstreamError(this.name, res.status);
    if (res.status >= 400) throw new BlockedError(this.name, `HTTP ${res.status} (UA policy?)`);
    return res;
  }
}
