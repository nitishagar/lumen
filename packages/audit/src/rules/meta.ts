/**
 * Meta rules 1–4, 7, 13 (plan built-in table): title, meta description,
 * canonical, robots-noindex (meta + `X-Robots-Tag`).
 */
import type { AuditRule, Issue, Severity } from '@lumen-seo/core';
import type { CheerioAPI } from 'cheerio';
import type { ResolvedThresholds } from '../types.js';

const trim = (s: string | undefined): string => (s ?? '').trim();

export const titleMissing = (severity: Severity): AuditRule => ({
  id: 'title-missing',
  severity,
  categories: ['meta'],
  check(page): Issue[] {
    const title = trim(page.dom('title').first().text());
    if (title !== '') return [];
    return [
      {
        ruleId: 'title-missing',
        severity,
        message: 'page has no <title> element (or it is empty)',
        evidence: { selector: 'title' },
        fixHint: 'add a unique, descriptive <title> to the <head>',
      },
    ];
  },
});

export const titleLength = (severity: Severity, t: ResolvedThresholds): AuditRule => ({
  id: 'title-length',
  severity,
  categories: ['meta'],
  check(page): Issue[] {
    const title = trim(page.dom('title').first().text());
    if (title === '') return []; // missing is title-missing's case — no double report
    const len = [...title].length;
    if (len >= t.titleMinChars && len <= t.titleMaxChars) return [];
    return [
      {
        ruleId: 'title-length',
        severity,
        message: `title length ${len} is outside the recommended ${t.titleMinChars}-${t.titleMaxChars} characters`,
        evidence: { selector: 'title', snippet: title },
        fixHint: `aim for ${t.titleMinChars}-${t.titleMaxChars} characters`,
      },
    ];
  },
});

export const descriptionMissing = (severity: Severity): AuditRule => ({
  id: 'description-missing',
  severity,
  categories: ['meta'],
  check(page): Issue[] {
    const content = trim(page.dom('meta[name="description"]').attr('content'));
    if (content !== '') return [];
    return [
      {
        ruleId: 'description-missing',
        severity,
        message: 'page has no meta description (or it is empty)',
        evidence: { selector: 'meta[name="description"]' },
        fixHint: 'add <meta name="description" content="…"> summarizing the page',
      },
    ];
  },
});

export const descriptionLength = (severity: Severity, t: ResolvedThresholds): AuditRule => ({
  id: 'description-length',
  severity,
  categories: ['meta'],
  check(page): Issue[] {
    const content = trim(page.dom('meta[name="description"]').attr('content'));
    if (content === '') return [];
    const len = [...content].length;
    if (len >= t.descriptionMinChars && len <= t.descriptionMaxChars) return [];
    return [
      {
        ruleId: 'description-length',
        severity,
        message: `meta description length ${len} is outside the recommended ${t.descriptionMinChars}-${t.descriptionMaxChars} characters`,
        evidence: { selector: 'meta[name="description"]', snippet: content },
        fixHint: `aim for ${t.descriptionMinChars}-${t.descriptionMaxChars} characters`,
      },
    ];
  },
});

const canonicalLinks = (dom: CheerioAPI): number =>
  dom('link[rel]').filter((_, el) => (dom(el).attr('rel') ?? '').split(/\s+/).includes('canonical')).length;

export const canonicalPresent = (severity: Severity): AuditRule => ({
  id: 'canonical-present',
  severity,
  categories: ['meta'],
  check(page): Issue[] {
    const count = canonicalLinks(page.dom);
    if (count === 0) {
      return [
        {
          ruleId: 'canonical-present',
          severity,
          message: 'page declares no <link rel="canonical">',
          evidence: { selector: 'link[rel="canonical"]' },
          fixHint: 'add <link rel="canonical" href="…"> to declare the preferred URL',
        },
      ];
    }
    if (count > 1) {
      // per-issue severity bump: conflicting canonicals are worse than none
      const bumped: Severity = severity === 'info' ? 'warning' : severity;
      return [
        {
          ruleId: 'canonical-present',
          severity: bumped,
          message: `page declares ${count} conflicting canonical links`,
          evidence: { selector: 'link[rel="canonical"]' },
          fixHint: 'keep exactly one canonical link',
        },
      ];
    }
    return [];
  },
});

const noindexIn = (value: string): boolean =>
  value
    .split(/[,]/)
    .map((part) => part.trim().toLowerCase())
    .includes('noindex');

export const robotsNoindex = (severity: Severity): AuditRule => ({
  id: 'robots-noindex',
  severity,
  categories: ['meta', 'technical'],
  check(page): Issue[] {
    const metaContent = page.dom('meta[name="robots"]').attr('content');
    const headerValues: string[] = [];
    page.headers.forEach((value, name) => {
      if (name.toLowerCase() === 'x-robots-tag') headerValues.push(value);
    });
    const viaMeta = metaContent !== undefined && noindexIn(metaContent);
    const viaHeader = headerValues.some((v) => noindexIn(v));
    if (!viaMeta && !viaHeader) return [];
    return [
      {
        ruleId: 'robots-noindex',
        severity,
        message: viaMeta
          ? 'page is marked noindex via <meta name="robots">'
          : 'page is marked noindex via the X-Robots-Tag header',
        evidence: viaMeta ? { selector: 'meta[name="robots"]', snippet: metaContent } : { selector: 'X-Robots-Tag' },
      },
    ];
  },
});
