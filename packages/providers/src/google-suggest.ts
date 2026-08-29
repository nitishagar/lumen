/**
 * google-suggest — Google autocomplete (`client=firefox`) as a gray
 * KeywordProvider (A5). Undocumented endpoint: labeled gray on every idea,
 * cached aggressively (24 h), paced 30/min + burst 5 (worst 35/min), and
 * every failure mode maps to a typed error — 5xx is upstream (retryable
 * class), never misreported as a CAPTCHA.
 */
import type { KeywordIdea, IdeasOpts, KeywordProvider } from '@lumen-seo/core';
import type { ProviderDeps } from './deps.js';
import { isoNow } from './deps.js';
import { BlockedError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { json, retryAfterMs } from './http.js';
import { ATTRIBUTION, ESTIMATE_LABELS } from './provenance.js';
import { toSuggestOpts } from './opts-bridge.js';
import type { Pacer } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;

const isSuggestShape = (body: unknown): body is [string, string[]] =>
  Array.isArray(body) &&
  typeof body[0] === 'string' &&
  Array.isArray(body[1]) &&
  body[1].every((t) => typeof t === 'string');

export class GoogleSuggestProvider implements KeywordProvider {
  readonly name = 'google-suggest';

  constructor(
    private readonly deps: ProviderDeps,
    private readonly pacer: Pacer,
    private readonly attribution: string = ATTRIBUTION['google-suggest'],
  ) {}
  async ideas(seed: string, o: IdeasOpts): Promise<KeywordIdea[]> {
    return withProviderErrors(this.name, async () => {
      const opts = toSuggestOpts(o);
      const cacheKey = `suggest:${opts.lang}:${seed}`;
      const cached = await this.deps.cache.get<KeywordIdea[]>(cacheKey);
      if (cached !== undefined) return cached;

      const url = new URL('https://suggestqueries.google.com/complete/search');
      url.searchParams.set('client', 'firefox');
      url.searchParams.set('hl', opts.lang);
      url.searchParams.set('q', seed);

      await this.pacer.acquire();
      const res = await this.deps.fetcher.fetch(url, {
        headers: { 'user-agent': this.deps.userAgent },
        signal: o.signal,
      });
      if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
      if (res.status >= 500) throw new UpstreamError(this.name, res.status); // retryable class, NOT "CAPTCHA"
      if (res.status >= 400) throw new BlockedError(this.name, `HTTP ${res.status} from gray endpoint`);
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('html')) {
        throw new BlockedError(this.name, 'HTML body — likely CAPTCHA (documented brittle, A5)');
      }
      const body = await json(res, this.name);
      if (!isSuggestShape(body)) throw new ParseError(this.name, 'unexpected suggestion shape');

      const retrievedAt = isoNow(this.deps.clock);
      const terms = body[1].filter((t) => t.length > 0).slice(0, opts.limit ?? body[1].length);
      const ideas: KeywordIdea[] = terms.map((term) => ({
        term,
        estimateLabel: ESTIMATE_LABELS['google-suggest'], // I3: gray label on EVERY idea
        lang: opts.lang,
        source: { provider: this.name, kind: 'gray', attribution: this.attribution },
        retrievedAt,
      }));
      await this.deps.cache.set(cacheKey, ideas, this.deps.clock() + TTL_MS); // write only after success
      return ideas;
    });
  }
}
