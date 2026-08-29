/**
 * Content rules 5, 6, 8, 10 (plan built-in table): h1 presence/multiplicity,
 * html lang validity, image alt coverage.
 */
import type { AuditRule, Issue, Severity } from '@lumen-seo/core';

export const h1Missing = (severity: Severity): AuditRule => ({
  id: 'h1-missing',
  severity,
  categories: ['content'],
  check(page): Issue[] {
    if (page.dom('h1').length > 0) return [];
    return [
      {
        ruleId: 'h1-missing',
        severity,
        message: 'page has no <h1> heading',
        evidence: { selector: 'h1' },
        fixHint: 'add exactly one <h1> describing the page topic',
      },
    ];
  },
});

export const h1Multiple = (severity: Severity): AuditRule => ({
  id: 'h1-multiple',
  severity,
  categories: ['content'],
  check(page): Issue[] {
    const count = page.dom('h1').length;
    if (count <= 1) return [];
    return [
      {
        ruleId: 'h1-multiple',
        severity,
        message: `page has ${count} <h1> headings (expected one)`,
        evidence: { selector: 'h1' },
        fixHint: 'demote extra <h1>s to <h2>+ so the outline stays unambiguous',
      },
    ];
  },
});

const LANG_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

export const langAttr = (severity: Severity): AuditRule => ({
  id: 'lang-attr',
  severity,
  categories: ['content'],
  check(page): Issue[] {
    const lang = page.dom('html').attr('lang');
    if (lang !== undefined && LANG_RE.test(lang.trim())) return [];
    return [
      {
        ruleId: 'lang-attr',
        severity,
        message:
          lang === undefined
            ? '<html> has no lang attribute'
            : `<html lang="${lang}"> is not a valid BCP-47-style language tag`,
        evidence: { selector: 'html[lang]' },
        fixHint: 'set <html lang="en"> (or the page language) for accessibility and indexing',
      },
    ];
  },
});

export const imageAltCoverage = (severity: Severity): AuditRule => ({
  id: 'image-alt-coverage',
  severity,
  categories: ['content', 'accessibility'],
  check(page): Issue[] {
    const images = page.dom('img');
    const total = images.length;
    if (total === 0) return [];
    const missing: string[] = [];
    images.each((_, el) => {
      const el_ = page.dom(el);
      if (el_.attr('alt') === undefined) missing.push(el_.attr('src') ?? el_.attr('title') ?? '(no src)');
    });
    if (missing.length === 0) return [];
    const coverage = Math.round(((total - missing.length) / total) * 100);
    return [
      {
        ruleId: 'image-alt-coverage',
        severity,
        message: `${missing.length} of ${total} images lack an alt attribute (alt coverage ${coverage}%; alt="" counts as present)`,
        evidence: { selector: 'img', snippet: missing.join(' | ') },
        fixHint: 'add alt text to every <img> (alt="" for purely decorative images)',
      },
    ];
  },
});
