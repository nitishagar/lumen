/**
 * Integrity page rules (E1.6): structured data, meta-refresh, security
 * headers, twitter card, thin content — plus E1.7's content-in-raw-html
 * heuristic. Local evidence only; parse problems are reported, never
 * "rich result eligible" claims made. All parsers are bounded (element /
 * block caps) so hostile input degrades to an issue, never a hang.
 */
import type { CheerioAPI } from 'cheerio';
import type { AuditRule, Issue, Severity } from '@lumen-seo/core';
import type { ResolvedThresholds } from '../types.js';
import { isBlockedHost } from '@lumen-seo/core';

/** JSON-LD safety bounds: blocks examined per page and cumulative bytes read. */
export const MAX_JSONLD_BLOCKS = 50;
export const MAX_JSONLD_BYTES = 250_000;

/** schema.org required properties for the common types (E1.6: vendored, versioned table). */
export const SCHEMA_REQUIRED_PROPS_VERSION = '2026-09-28-v1';
export const SCHEMA_REQUIRED_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  article: ['headline', 'author', 'datePublished'],
  product: ['name', 'image', 'offers'],
  organization: ['name', 'url'],
  breadcrumblist: ['itemlistelement'],
  faqpage: ['mainentity'],
  localbusiness: ['name', 'address', 'telephone'],
});

const lowerType = (t: string): string => t.toLowerCase().replace(/^https?:\/\/schema\.org\//, '').trim();

const jsonLdIssues = (severity: Severity, dom: CheerioAPI): Issue[] => {
  const issues: Issue[] = [];
  let blocks = 0;
  let bytes = 0;
  dom('script[type="application/ld+json"]').each((_, el) => {
    if (blocks >= MAX_JSONLD_BLOCKS) {
      if (issues[issues.length - 1]?.message.includes('JSON-LD blocks') === false) {
        issues.push({
          ruleId: 'structured-data-invalid',
          severity,
          message: `more than ${MAX_JSONLD_BLOCKS} JSON-LD blocks — only the first ${MAX_JSONLD_BLOCKS} were judged`,
          evidence: { selector: 'script[type="application/ld+json"]' },
          fixHint: 'consolidate JSON-LD into fewer, complete blocks',
        });
      }
      return;
    }
    if (bytes >= MAX_JSONLD_BYTES) {
      issues.push({
        ruleId: 'structured-data-invalid',
        severity,
        message: `JSON-LD byte cap (${MAX_JSONLD_BYTES}) reached after ${blocks} block(s) — remaining blocks unjudged`,
        evidence: { selector: 'script[type="application/ld+json"]' },
        fixHint: 'consolidate JSON-LD into fewer, complete blocks',
      });
      return;
    }
    blocks += 1;
    const raw = dom(el).text();
    bytes += raw.length;
    if (raw.length > MAX_JSONLD_BYTES) {
      issues.push({
        ruleId: 'structured-data-invalid',
        severity,
        message: `a JSON-LD block is ${raw.length} bytes — over the ${MAX_JSONLD_BYTES}-byte cap, so its contents were not judged`,
        evidence: { selector: 'script[type="application/ld+json"]', snippet: raw.slice(0, 80) },
        fixHint: 'shrink the JSON-LD block (a payload this large is usually generated junk)',
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      issues.push({
        ruleId: 'structured-data-invalid',
        severity,
        message: `a JSON-LD block does not parse as JSON (${raw.length} bytes)`,
        evidence: { selector: 'script[type="application/ld+json"]', snippet: raw.slice(0, 80) },
        fixHint: 'fix the JSON-LD syntax — search engines drop unparseable structured data',
      });
      return;
    }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      if (typeof root !== 'object' || root === null) continue;
      const record = root as Record<string, unknown>;
      if (record['@context'] === undefined) {
        issues.push({
          ruleId: 'structured-data-invalid',
          severity,
          message: 'a JSON-LD block is missing @context',
          evidence: { selector: 'script[type="application/ld+json"]' },
          fixHint: 'add "@context": "https://schema.org" to the JSON-LD block',
        });
        continue;
      }
      if (typeof record['@context'] !== 'string' || !record['@context'].toLowerCase().includes('schema.org')) {
        issues.push({
          ruleId: 'structured-data-invalid',
          severity,
          message: `a JSON-LD block uses an unsupported @context "${String(record['@context']).slice(0, 60)}"`,
          evidence: { selector: 'script[type="application/ld+json"]' },
          fixHint: 'set "@context" to "https://schema.org"',
        });
      }
    }
  });
  return issues;
};

const requiredPropsIssues = (severity: Severity, dom: CheerioAPI): Issue[] => {
  const issues: Issue[] = [];
  let blocks = 0;
  dom('script[type="application/ld+json"]').each((_, el) => {
    if (blocks >= MAX_JSONLD_BLOCKS) return;
    blocks += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dom(el).text()) as unknown;
    } catch {
      return; // parse problems belong to structured-data-invalid
    }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      if (typeof root !== 'object' || root === null) continue;
      const record = root as Record<string, unknown>;
      const type = typeof record['@type'] === 'string' ? lowerType(record['@type']) : '';
      const required = SCHEMA_REQUIRED_PROPS[type];
      if (required === undefined) continue;
      const missing = required.filter((k) => record[k] === undefined);
      if (missing.length > 0) {
        issues.push({
          ruleId: 'structured-data-required-props',
          severity,
          message: `schema.org ${record['@type'] as string} is missing required properties: ${missing.join(', ')} (table ${SCHEMA_REQUIRED_PROPS_VERSION})`,
          evidence: { selector: 'script[type="application/ld+json"]' },
          fixHint: `add the missing ${record['@type'] as string} properties (${missing.join(', ')}) per schema.org`,
        });
      }
    }
  });
  return issues;
};

export const structuredDataInvalid = (severity: Severity): AuditRule => ({
  id: 'structured-data-invalid',
  severity,
  categories: ['technical', 'integrity'],
  check(page): Issue[] {
    return jsonLdIssues(severity, page.dom);
  },
});

export const structuredDataRequiredProps = (severity: Severity): AuditRule => ({
  id: 'structured-data-required-props',
  severity,
  categories: ['technical', 'integrity'],
  check(page): Issue[] {
    return requiredPropsIssues(severity, page.dom);
  },
});

export const metaRefreshRedirect = (severity: Severity): AuditRule => ({
  id: 'meta-refresh-redirect',
  severity,
  categories: ['technical', 'integrity'],
  check(page): Issue[] {
    const refresh = page.dom('meta[http-equiv="refresh" i]').attr('content');
    if (refresh === undefined) return [];
    return [
      {
        ruleId: 'meta-refresh-redirect',
        severity,
        message: `page redirects via <meta http-equiv="refresh"> (${refresh.slice(0, 80)})`,
        evidence: { selector: 'meta[http-equiv="refresh"]', snippet: refresh.slice(0, 120) },
        fixHint: 'replace the meta refresh with a real HTTP 3xx redirect (it is unreliable and delays crawlers)',
      },
    ];
  },
});

export const securityHeaders = (severity: Severity): AuditRule => ({
  id: 'security-headers',
  severity,
  categories: ['technical', 'integrity'],
  check(page): Issue[] {
    if (page.url.protocol !== 'https:') return []; // HSTS is meaningless on http; presence-only rule
    const missing: string[] = [];
    if (page.headers.get('strict-transport-security') === null) missing.push('Strict-Transport-Security');
    if (page.headers.get('x-content-type-options') === null) missing.push('X-Content-Type-Options');
    if (page.headers.get('content-security-policy') === null) missing.push('Content-Security-Policy');
    if (missing.length === 0) return [];
    return [
      {
        ruleId: 'security-headers',
        severity,
        message: `missing security headers: ${missing.join(', ')} (presence check — not a security grade)`,
        evidence: { selector: 'headers' },
        fixHint: `send the missing header(s) from the server: ${missing.join(', ')}`,
      },
    ];
  },
});

export const twitterCardMissing = (severity: Severity): AuditRule => ({
  id: 'twitter-card-missing',
  severity,
  categories: ['social'],
  check(page): Issue[] {
    if (page.dom('meta[name="twitter:card" i]').length > 0) return [];
    if (page.dom('meta[property^="og:"]').length === 0) return []; // PRD: only when OG is present
    return [
      {
        ruleId: 'twitter-card-missing',
        severity,
        message: 'Open Graph tags are present but twitter:card is missing',
        evidence: { selector: 'meta[name="twitter:card"]' },
        fixHint: 'add <meta name="twitter:card" content="summary_large_image"> (or summary)',
      },
    ];
  },
});

const WORD_RE = /[\p{L}\p{N}']+/gu;
export const visibleWordCount = (dom: CheerioAPI): number => {
  // Detached clone — never mutate the shared page DOM mid-rule-loop.
  const detached = dom('body').clone();
  detached.find('script, style, svg, noscript').remove();
  return (detached.text().match(WORD_RE) ?? []).length;
};

export const thinContent = (severity: Severity, t: ResolvedThresholds): AuditRule => ({
  id: 'thin-content',
  severity,
  categories: ['content', 'integrity'],
  check(page): Issue[] {
    const words = visibleWordCount(page.dom);
    if (words >= t.thinContentMinWords) return [];
    return [
      {
        ruleId: 'thin-content',
        severity,
        message: `page has only ${words} visible words (threshold: ${t.thinContentMinWords})`,
        evidence: { selector: 'body' },
        fixHint: `expand the page to at least ${t.thinContentMinWords} words of substantive visible text (word counting is script-aware latin-centric; CJK pages need the threshold tuned)`,
      },
    ];
  },
});

/**
 * E1.7 FR-3 (heuristic, labeled): primary content probably requires JS. A
 * root-ish empty container plus few visible words is the SPA-shell signature.
 */
/** An inner HTML of <= this many chars (whitespace-stripped) counts as an empty shell container. */
const SPA_SHELL_MAX_INNER_CHARS = 40;
export const contentInRawHtml = (severity: Severity, t: ResolvedThresholds): AuditRule => ({
  id: 'content-in-raw-html',
  severity,
  categories: ['ai-search'],
  check(page): Issue[] {
    const words = visibleWordCount(page.dom);
    if (words >= t.thinContentMinWords) return [];
    // The DOM the rules see was parsed from the RAW server HTML — an empty
    // root container in it means the shell ships without content.
    let hasEmptyRoot = false;
    page.dom('div#root, div#app, div#__next').each((_, el) => {
      const inner = page.dom(el).html() ?? '';
      if (inner.replace(/\s/g, '').length <= SPA_SHELL_MAX_INNER_CHARS) hasEmptyRoot = true;
    });
    if (!hasEmptyRoot) return [];
    return [
      {
        ruleId: 'content-in-raw-html',
        severity,
        message: `server HTML looks like an SPA shell (empty root container, ${words} visible words) — primary content probably requires JavaScript (HEURISTIC)`,
        evidence: { selector: 'div#root' },
        fixHint: 'server-render the primary content (most AI crawlers do not execute JavaScript); verify against the rendered page before acting',
      },
    ];
  },
});

/** Kept for the cross-host canonical judgment used by the crawl rule (shared logic). */
export const isCrossHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).host !== new URL(b).host;
  } catch {
    return true;
  }
};
export { isBlockedHost };
