/**
 * Sitemap-assisted discovery (I4/I15): robots-declared `Sitemap:` sources
 * (at most `MAX_SITEMAP_SOURCES` fetched), else a `/sitemap.xml` probe.
 * cheerio `xmlMode` parsing of `urlset` / `sitemapindex` with hard caps —
 * one nesting level, `MAX_SITEMAP_CHILDREN` children per index,
 * `MAX_SITEMAP_URLS` URLs total, `MAX_SITEMAP_BYTES` per body. Malformed or
 * oversized sitemaps record a discovery warning and fall back to link
 * discovery. Loc entries are filtered to same-origin http(s) (A1/I12).
 */
import { AbortedError } from '@lumen-seo/core';
import { load } from 'cheerio';
import type { CrawlerDeps } from '../types.js';
import { MAX_SITEMAP_BYTES, MAX_SITEMAP_CHILDREN, MAX_SITEMAP_SOURCES, MAX_SITEMAP_URLS } from '../config.js';
import { readBodyCapped } from './body-reader.js';
import type { RateLimiter } from './rate-limiter.js';
import { normalizeKey } from './url-normalize.js';

export interface SitemapOptions {
  seed: URL;
  /** robots-declared sources (already capped by the caller) — empty means "probe". */
  sources: readonly URL[];
  deps: CrawlerDeps;
  limiter: RateLimiter;
  signal?: AbortSignal;
  onWarning?: (code: string) => void;
}

const isAbort = (e: unknown, signal?: AbortSignal): boolean =>
  e instanceof AbortedError || signal?.aborted === true;

export const discoverSitemaps = async (o: SitemapOptions): Promise<URL[]> => {
  const { seed, deps, limiter, signal } = o;
  const found: URL[] = [];
  const seen = new Set<string>();

  const accept = (loc: string): boolean => {
    let url: URL;
    try {
      url = new URL(loc, seed);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false; // I12/I15
    if (url.origin !== seed.origin) return false; // A1 — single-host crawl
    const key = normalizeKey(url);
    if (seen.has(key)) return false;
    seen.add(key);
    found.push(url);
    return true;
  };

  const fetchSource = async (source: URL, isIndexAllowed: boolean, isProbe: boolean): Promise<void> => {
    try {
      await limiter.waitForTurn(source.host, signal);
    } catch (e) {
      if (isAbort(e, signal)) throw new AbortedError('audit');
      throw e;
    }

    let res;
    try {
      res = await deps.fetcher.fetch(source, { signal });
    } catch (e) {
      if (isAbort(e, signal)) throw new AbortedError('audit');
      if (!isProbe) o.onWarning?.('sitemap_fetch_failed');
      return;
    }
    if (res.status < 200 || res.status >= 300) {
      if (!isProbe) o.onWarning?.('sitemap_fetch_failed');
      return;
    }

    const { text, oversized } = await readBodyCapped(res, MAX_SITEMAP_BYTES, { keepPartial: true });
    if (oversized) o.onWarning?.('sitemap_oversized');

    const dom = load(text, { xmlMode: true });
    const indexLocs: string[] = [];
    const urlLocs: string[] = [];
    dom('urlset > url > loc').each((_, el) => {
      urlLocs.push(dom(el).text().trim());
    });
    dom('sitemapindex > sitemap > loc').each((_, el) => {
      indexLocs.push(dom(el).text().trim());
    });
    if (urlLocs.length === 0 && indexLocs.length === 0) {
      o.onWarning?.('sitemap_malformed');
      return;
    }

    for (const loc of urlLocs) {
      if (found.length >= MAX_SITEMAP_URLS) {
        o.onWarning?.('sitemap_url_cap');
        return;
      }
      accept(loc);
    }

    if (indexLocs.length > 0) {
      if (!isIndexAllowed) return; // one nesting level only — deeper indexes ignored
      const children = indexLocs.slice(0, MAX_SITEMAP_CHILDREN);
      if (indexLocs.length > MAX_SITEMAP_CHILDREN) o.onWarning?.('sitemap_child_cap');
      for (const loc of children) {
        let child: URL;
        try {
          child = new URL(loc, seed);
        } catch {
          continue;
        }
        if (child.origin !== seed.origin) continue;
        await fetchSource(child, false, isProbe);
      }
    }
  };

  if (o.sources.length > 0) {
    if (o.sources.length > MAX_SITEMAP_SOURCES) o.onWarning?.('sitemap_source_cap');
    for (const source of o.sources.slice(0, MAX_SITEMAP_SOURCES)) {
      await fetchSource(source, true, false);
    }
  } else {
    await fetchSource(new URL('/sitemap.xml', seed), true, true);
  }

  return found.slice(0, MAX_SITEMAP_URLS);
};
