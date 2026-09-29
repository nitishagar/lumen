/**
 * bing-webmaster — the FIRST exact volume source (E2.2): Bing Webmaster's
 * keyword API under the `keywords` boundary. API-key auth (the key VALUE
 * lives in `LUMEN_BING_KEY`, read at call time — never stored, never logged;
 * redact() already masks `apikey` query params). Every idea is labeled
 * `source: bing, scope: bing-only` — the honest framing is "exact for Bing,
 * nothing about Google".
 */
import type { IdeasOpts, KeywordIdea, KeywordProvider } from '@lumen-seo/core';
import type { ProviderDeps } from './deps.js';
import { isoNow } from './deps.js';
import { BlockedError, NotConfiguredError, ParseError, RateLimitedError, UpstreamError } from './errors.js';
import { json, retryAfterMs } from './http.js';
import { redactUrl } from './redact.js';
import { mkSource } from '@lumen-seo/core';
import type { Pacer } from './throttle.js';
import { withProviderErrors } from './with-errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const PROVENANCE = mkSource('bing-webmaster', 'official', 'Bing keyword volume — exact, scope: bing-only (nothing about Google)');

interface BingApiDeps extends ProviderDeps {
  env(name: string): string | undefined;
}

const isIdeasShape = (body: unknown): body is { d?: { Keyword?: string; Volume?: number }[] } =>
  typeof body === 'object' && body !== null && Array.isArray((body as { d?: unknown }).d);

export class BingWebmasterProvider implements KeywordProvider {
  readonly name = 'bing-webmaster';

  constructor(
    private readonly deps: BingApiDeps,
    private readonly pacer: Pacer,
  ) {}

  async ideas(seed: string, o: IdeasOpts): Promise<KeywordIdea[]> {
    return withProviderErrors(this.name, async () => {
      const apiKey = this.deps.env('LUMEN_BING_KEY');
      if (apiKey === undefined || apiKey === '') {
        throw new NotConfiguredError('bing-webmaster', 'LUMEN_BING_KEY', 'set LUMEN_BING_KEY to your Bing Webmaster API key');
      }
      const cacheKey = `bing-ideas:${o.lang ?? 'en'}:${seed}`;
      const cached = await this.deps.cache.get<KeywordIdea[]>(cacheKey);
      if (cached !== undefined) return cached;

      // The documented keyword-data surface (Bing Webmaster API). NOTE: the
      // exact param shape is UNVERIFIED against a live key — acceptance with a
      // real account is an owner-gated external step (recorded in the bundle
      // ledger); failures surface as typed errors, never misleading zeros.
      const url = new URL('https://ssl.bing.com/webmaster/api.svc/json/GetKeywordData');
      url.searchParams.set('apikey', apiKey);
      url.searchParams.set('q', seed);

      await this.pacer.acquire();
      let res: Response;
      try {
        res = await this.deps.fetcher.fetch(url, {
          headers: { 'user-agent': this.deps.userAgent },
          signal: o.signal,
        });
      } catch (e) {
        // C1: the key rides the URL query — network-failure messages embed the
        // URL verbatim, so the rethrown message is redacted before it can leak.
        if (e instanceof Error) {
          e.message = e.message.replaceAll(url.href, redactUrl(url));
        }
        throw e;
      }
      if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
      if (res.status === 401) throw new NotConfiguredError(this.name, 'LUMEN_BING_KEY', 'Bing rejected the API key (HTTP 401)');
      if (res.status === 400 || res.status === 403) throw new BlockedError(this.name, `HTTP ${res.status} from the Bing keyword API`);
      if (res.status >= 500) throw new UpstreamError(this.name, res.status);
      const body = await json(res, this.name);
      if (!isIdeasShape(body)) throw new ParseError(this.name, 'unexpected Bing keyword shape');

      const ideas: KeywordIdea[] = (body.d ?? [])
        .filter((row) => typeof row.Keyword === 'string')
        .map((row) => ({
          term: row.Keyword as string,
          source: PROVENANCE,
          volume: typeof row.Volume === 'number' ? row.Volume : undefined,
          lang: o.lang,
          retrievedAt: isoNow(this.deps.clock),
        }));
      await this.deps.cache.set(cacheKey, ideas, this.deps.clock() + TTL_MS);
      return ideas;
    });
  }
}
