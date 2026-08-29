/**
 * Crawl-level link rules 11–12 (plan built-in table), run at finalize against
 * the `CrawlIndex`. Honesty rules (I3): a link target is reported broken ONLY
 * if it was fetched during THIS crawl and returned >= 400 — links never
 * fetched are never judged. `redirect-chain` fires on pages whose requested
 * URL redirected (final URL differs; core's fetcher owns hop iteration and
 * does not expose intermediate hops — see REASONING).
 */
import type { Issue, Severity } from '@lumen-seo/core';
import { EVIDENCE_CAP } from '../config.js';
import type { CrawlIndex, CrawlRule } from '../types.js';
import { normalizeKey } from '../crawl/url-normalize.js';

export const brokenInternalLink = (severity: Severity): CrawlRule => ({
  id: 'broken-internal-link',
  severity,
  categories: ['links'],
  checkCrawl(index: CrawlIndex): Issue[] {
    const issues: Issue[] = [];
    for (const [pageUrl, links] of index.outLinks) {
      let found = 0;
      let overflow = 0;
      for (const link of links) {
        if (!link.internal) continue;
        const key = safeKey(link.url);
        if (key === undefined) continue;
        const observed = index.statusOf(key);
        if (observed === undefined || observed.status < 400) continue; // never fetched → never judged
        found++;
        if (found > EVIDENCE_CAP) {
          overflow++;
          continue;
        }
        issues.push({
          ruleId: 'broken-internal-link',
          severity,
          message: `link target returned HTTP ${observed.status}`,
          evidence: { selector: `a[href="${link.href}"]`, snippet: `${link.url} -> ${observed.finalUrl}` },
          fixHint: 'fix or remove the broken link',
          url: pageUrl,
        });
      }
      if (overflow > 0) {
        issues.push({
          ruleId: 'broken-internal-link',
          severity,
          message: `+${overflow} more broken link(s) on this page (evidence capped at ${EVIDENCE_CAP} per rule per page)`,
          evidence: {},
          url: pageUrl,
        });
      }
    }
    return issues;
  },
});

const safeKey = (url: string): string | undefined => {
  try {
    return normalizeKey(new URL(url));
  } catch {
    return undefined;
  }
};

export const redirectChain = (severity: Severity): CrawlRule => ({
  id: 'redirect-chain',
  severity,
  categories: ['links', 'technical'],
  checkCrawl(index: CrawlIndex): Issue[] {
    const issues: Issue[] = [];
    for (const page of index.pages) {
      if (page.hops < 1) continue; // silent when the URL was not redirected
      issues.push({
        ruleId: 'redirect-chain',
        severity,
        message: `URL redirects before serving content (requested ${page.url}, served ${page.finalUrl})`,
        evidence: { selector: 'status', snippet: `${page.url} -> ${page.finalUrl}` },
        fixHint: 'link and canonicalize directly to the final URL to avoid redirect chains',
        url: page.url,
      });
    }
    return issues;
  },
});
