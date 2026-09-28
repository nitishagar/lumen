/**
 * Integrity crawl rules (E1.6): canonical targets, sitemap-URL indexability,
 * hreflang reciprocity, orphan pages, and the OPT-IN broken-external-link
 * check. Local evidence only — a rule judges what the crawl ALREADY fetched;
 * an unfetched target is `unknown` (info) or not-judged, never a pass and
 * never a new fetch. All per-page DOM signals (noindex/canonical/hreflang)
 * are retained at record time (`index.metaOf`); cross-run fetch outcomes
 * (external links) arrive via RuleContext. Rules stay pure + fixture-testable.
 */
import type { CrawlRule, RuleContext } from '../types.js';
import type { Issue, Severity } from '@lumen-seo/core';
import { isBlockedHost } from '@lumen-seo/core';

/** Samples at most this many sitemap URLs that are IN the crawl index (the report states the sample size). */
export const SITEMAP_SAMPLE_CAP = 25;

/** Valid BCP-47-ish language/region shape (lang or lang-REGION, optional subtags). */
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i;
/** Google's documented x-default value is valid — and exempt from self/return checks. */
const isXDefault = (lang: string): boolean => lang.trim().toLowerCase() === 'x-default';

const normalizeHref = (href: string, base: string): string | undefined => {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.href;
  } catch {
    return undefined;
  }
};

export const canonicalTargetInvalid = (severity: Severity): CrawlRule => ({
  id: 'canonical-target-invalid',
  severity,
  categories: ['links', 'integrity'],
  checkCrawl(index) {
    const issues: Issue[] = [];
    let judged = 0;
    let unknown = 0;
    for (const page of index.pages) {
      const href = index.metaOf?.(page.url)?.canonicalHref;
      if (href === undefined) continue;
      judged += 1;
      const target = normalizeHref(href, page.url);
      if (target === undefined) {
        issues.push({
          ruleId: 'canonical-target-invalid',
          severity,
          message: 'canonical href is not a valid absolute URL',
          evidence: { selector: 'link[rel="canonical"]', snippet: href.slice(0, 120) },
          url: page.url,
          fixHint: 'point the canonical at a real, crawlable absolute URL',
        });
        continue;
      }
      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
      } catch {
        continue;
      }
      if (isBlockedHost(targetUrl.hostname)) {
        issues.push({
          ruleId: 'canonical-target-invalid',
          severity,
          message: `canonical points at a non-public target (${targetUrl.host})`,
          evidence: { selector: 'link[rel="canonical"]', snippet: target },
          url: page.url,
          fixHint: 'point the canonical at the public production URL',
        });
        continue;
      }
      const observed = index.statusOf(target);
      if (observed === undefined) {
        // Never fetched → never judged. Same-origin unfetched targets get an
        // honest INFO "unknown" note (cross-host stays silent — out of scope).
        unknown += 1;
        if (targetUrl.host === new URL(page.url).host) {
          issues.push({
            ruleId: 'canonical-target-invalid',
            severity: 'info',
            message: `canonical target ${target} was not crawled this run — not judged (judged ${judged - unknown}/${judged} canonicals)`,
            evidence: { selector: 'link[rel="canonical"]', snippet: target },
            url: page.url,
            fixHint: 'raise --max-pages so the canonical target is fetched, or verify it manually',
          });
        }
        continue;
      }
      if (observed.status >= 400) {
        issues.push({
          ruleId: 'canonical-target-invalid',
          severity,
          message: `canonical points at a non-200 page (HTTP ${observed.status})`,
          evidence: { selector: 'link[rel="canonical"]', snippet: target },
          url: page.url,
          fixHint: 'point the canonical at a live page (search engines drop dead canonicals)',
        });
        continue;
      }
      if (observed.finalUrl !== target) {
        issues.push({
          ruleId: 'canonical-target-invalid',
          severity,
          message: `canonical points at ${target}, which redirects to ${observed.finalUrl}`,
          evidence: { selector: 'link[rel="canonical"]', snippet: target },
          url: page.url,
          fixHint: 'canonicalize directly to the final URL — redirecting canonicals waste crawl budget',
        });
        continue;
      }
      if (index.metaOf?.(target)?.noindex === true) {
        issues.push({
          ruleId: 'canonical-target-invalid',
          severity,
          message: 'canonical points at a page marked noindex — contradictory signals',
          evidence: { selector: 'link[rel="canonical"]', snippet: target },
          url: page.url,
          fixHint: 'remove the noindex from the canonical target (or point the canonical elsewhere)',
        });
        continue;
      }
      if (targetUrl.host !== new URL(page.url).host) {
        issues.push({
          ruleId: 'canonical-target-invalid',
          severity,
          message: `canonical points cross-host at ${targetUrl.host} (verify this is intentional)`,
          evidence: { selector: 'link[rel="canonical"]', snippet: target },
          url: page.url,
          fixHint: 'cross-host canonicals transfer signals away — confirm the target is the preferred URL',
        });
      }
    }
    return issues;
  },
});

export const sitemapUrlNonindexable = (severity: Severity): CrawlRule => ({
  id: 'sitemap-url-nonindexable',
  severity,
  categories: ['integrity'],
  checkCrawl(index, o: RuleContext) {
    const issues: Issue[] = [];
    const sitemapUrls = o.siteEvidence?.sitemapUrls ?? [];
    const inIndex = sitemapUrls.filter((u) => index.statusOf(u) !== undefined);
    const sample = inIndex.slice(0, SITEMAP_SAMPLE_CAP);
    if (sample.length === 0) return issues;
    const bad: Issue[] = [];
    for (const url of sample) {
      const status = index.statusOf(url);
      const meta = index.metaOf?.(url);
      const reasons: string[] = [];
      if (status !== undefined && (status.status < 200 || status.status >= 300)) reasons.push(`HTTP ${status.status}`);
      if (meta?.noindex === true) reasons.push('noindex');
      if (status !== undefined && status.finalUrl !== url) reasons.push(`redirects to ${status.finalUrl}`);
      if (reasons.length > 0) {
        bad.push({
          ruleId: 'sitemap-url-nonindexable',
          severity,
          message: `a sitemap URL is not indexable: ${url} (${reasons.join(', ')})`,
          evidence: { selector: 'sitemap' },
          url,
          fixHint: 'remove the URL from the sitemap or fix the page (search engines learn to distrust sitemaps that list junk)',
        });
      }
    }
    if (bad.length > 0) {
      // The honesty header precedes the findings: only SAMPLED urls are judged.
      issues.push({
        ruleId: 'sitemap-url-nonindexable',
        severity: 'info', // the header is provenance, not a finding (M8)
        message: `checked ${sample.length} of ${inIndex.length} sitemap URLs present in this crawl (sample cap ${SITEMAP_SAMPLE_CAP})`,
        evidence: { selector: 'sitemap' },
        url: index.pages[0]?.url ?? '',
        fixHint: 'sampled check — the sample size is stated so the finding is never overstated',
      });
      issues.push(...bad);
    }
    return issues;
  },
});

export const hreflangReciprocity = (severity: Severity): CrawlRule => ({
  id: 'hreflang-reciprocity',
  severity,
  categories: ['meta', 'integrity'],
  checkCrawl(index) {
    const issues: Issue[] = [];
    for (const page of index.pages) {
      const links = index.metaOf?.(page.url)?.hreflang ?? [];
      if (links.length === 0) continue; // hreflang-present (absence rule) owns the no-hreflang case
      const invalid = links.filter((l) => !LANG_RE.test(l.lang.trim()) && !isXDefault(l.lang));
      if (invalid.length > 0) {
        issues.push({
          ruleId: 'hreflang-reciprocity',
          severity,
          message: `an hreflang entry uses an invalid language/region code ("${invalid[0]!.lang.slice(0, 20)}")`,
          evidence: { selector: 'link[rel="alternate"]', snippet: invalid[0]!.href.slice(0, 120) },
          url: page.url,
          fixHint: 'use valid BCP-47 codes (e.g. "de", "en-GB") in hreflang links (x-default is valid and exempt from reciprocity)',
        });
      }
      const valid = links.filter((l) => LANG_RE.test(l.lang.trim()) && !isXDefault(l.lang));
      const finalUrl = index.statusOf(page.url)?.finalUrl;
      const self = valid.find((l) => {
        const target = normalizeHref(l.href, page.url);
        return target === page.url || (finalUrl !== undefined && target === finalUrl);
      });
      if (self === undefined) {
        issues.push({
          ruleId: 'hreflang-reciprocity',
          severity,
          message: 'the hreflang cluster has no self-reference — every page must list itself',
          evidence: { selector: 'link[rel="alternate"]' },
          url: page.url,
          fixHint: 'add an hreflang entry pointing at the page itself (with x-default where useful)',
        });
      }
      for (const l of valid) {
        const target = normalizeHref(l.href, pageUrl(page.url));
        if (target === undefined) continue;
        const targetMeta = index.metaOf?.(target);
        if (targetMeta?.hreflang === undefined) continue; // target not crawled — not judged (no false positive)
        const returns = targetMeta.hreflang.some((b) => normalizeHref(b.href, target) === page.url);
        if (!returns) {
          issues.push({
            ruleId: 'hreflang-reciprocity',
            severity,
            message: `hreflang is not reciprocal: ${target} does not link back to this page`,
            evidence: { selector: 'link[rel="alternate"]', snippet: l.href.slice(0, 120) },
            url: page.url,
            fixHint: 'hreflang must be bidirectional — every page in the cluster returns the tag',
          });
        }
      }
    }
    return issues;
  },
});

const pageUrl = (u: string): string => u; // clarity helper for normalizeHref(base)

export const orphanPage = (severity: Severity): CrawlRule => ({
  id: 'orphan-page',
  severity,
  categories: ['integrity'],
  checkCrawl(index, o: RuleContext) {
    // PRD: only when the crawl FINISHED (an incomplete crawl proves nothing).
    if (o.incomplete === true) return [];
    const issues: Issue[] = [];
    const linked = new Set<string>();
    for (const links of index.outLinks.values()) {
      for (const l of links) linked.add(l.url.replace(/#.*$/, ''));
    }
    const sitemapUrls = o.siteEvidence?.sitemapUrls ?? [];
    for (const entry of index.pages) {
      if (entry.status < 200 || entry.status >= 300) continue;
      const inSitemap = sitemapUrls.some((u) => u === entry.url);
      if (!inSitemap) continue;
      const linkedTo = linked.has(entry.url) || entry.url === index.pages[0]?.url;
      if (!linkedTo) {
        issues.push({
          ruleId: 'orphan-page',
          severity,
          message: `sitemap URL ${entry.url} is not linked from any crawled page (orphan)`,
          evidence: { selector: 'sitemap' },
          url: entry.url,
          fixHint: 'link the page from relevant internal pages (or remove it from the sitemap if it is intentionally standalone)',
        });
      }
    }
    return issues;
  },
});

/** Pre-computed external-link outcomes (the fetch loop lives in run.ts — rules never fetch). */
export type ExternalLinkOutcome = { url: string; pageUrl: string; status: number | null; error?: string };

export const brokenExternalLink = (severity: Severity): CrawlRule => ({
  id: 'broken-external-link',
  severity,
  categories: ['links', 'integrity'],
  checkCrawl(_index, o: RuleContext) {
    const issues: Issue[] = [];
    const outcomes = o.siteEvidence?.externalOutcomes ?? [];
    if (outcomes.length === 0) return issues;
    issues.push({
      ruleId: 'broken-external-link',
      severity: 'info',
      message: `checked ${outcomes.length} external links (cap ${o.siteEvidence?.externalCap ?? 200}; opt-in via crawl.checkExternal)`,
      evidence: { selector: 'a[href]' },
      url: o.siteEvidence?.seedUrl ?? '',
      fixHint: 'the external check is bounded by the configured cap — raise crawl.externalLinkCap to widen it',
    });
    for (const oc of outcomes) {
      if (oc.status === null || oc.status === 404 || oc.status === 410 || (oc.status >= 500 && oc.status < 600)) {
        issues.push({
          ruleId: 'broken-external-link',
          severity,
          message: `external link is broken${oc.error === undefined ? ` (HTTP ${oc.status ?? 'no response'})` : ` (${oc.error})`}: ${oc.url}`,
          evidence: { selector: 'a[href]', snippet: oc.url.slice(0, 120) },
          url: oc.pageUrl,
          fixHint: 'fix or remove the dead external link',
        });
      }
    }
    return issues;
  },
});
