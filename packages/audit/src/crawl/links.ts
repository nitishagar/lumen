/**
 * Out-link extraction (crawl-owned; feeds frontier growth and the
 * `CrawlIndex.outLinks` used by crawl-level rules).
 *
 * Honesty rules (I3/A1): only http(s) references are ever resolved and only
 * same-origin references are enqueued; exotic schemes (`javascript:`,
 * `mailto:`, …) survive as raw href strings in `OutLink` and are NEVER
 * fetched.
 */
import type { CheerioAPI } from 'cheerio';
import type { OutLink } from '../types.js';
import { normalizeKey, parseCandidateUrl } from './url-normalize.js';

export interface ExtractedLinks {
  outLinks: OutLink[];
  /** Same-origin candidates, deduped, safe to enqueue. */
  internal: URL[];
}

export const extractLinks = (dom: CheerioAPI, pageUrl: URL, seedOrigin: string): ExtractedLinks => {
  const outLinks: OutLink[] = [];
  const internal: URL[] = [];
  const seenInternal = new Set<string>();

  dom('a[href]').each((_, el) => {
    const href = dom(el).attr('href');
    if (href === undefined || href === '') return;
    const resolved = parseCandidateUrl(href, pageUrl);
    if (resolved === undefined) {
      outLinks.push({ href, url: href, internal: false }); // raw string only — never fetched
      return;
    }
    const isInternal = resolved.origin === seedOrigin;
    outLinks.push({ href, url: resolved.href, internal: isInternal });
    if (isInternal) {
      const key = normalizeKey(resolved);
      if (!seenInternal.has(key)) {
        seenInternal.add(key);
        internal.push(resolved);
      }
    }
  });

  return { outLinks, internal };
};
