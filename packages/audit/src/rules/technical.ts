/**
 * Technical rules 9, 14–17 (plan built-in table): viewport meta, status
 * errors, plain-http pages, mixed content, response latency.
 */
import type { AuditRule, Issue, Severity } from '@lumen-seo/core';
import { EVIDENCE_CAP } from '../config.js';
import type { ResolvedThresholds } from '../types.js';

export const viewportMeta = (severity: Severity): AuditRule => ({
  id: 'viewport-meta',
  severity,
  categories: ['technical'],
  check(page): Issue[] {
    if (page.dom('meta[name="viewport"]').length > 0) return [];
    return [
      {
        ruleId: 'viewport-meta',
        severity,
        message: 'page has no <meta name="viewport">',
        evidence: { selector: 'meta[name="viewport"]' },
        fixHint: 'add <meta name="viewport" content="width=device-width, initial-scale=1">',
      },
    ];
  },
});

export const statusError = (severity: Severity): AuditRule => ({
  id: 'status-error',
  severity,
  categories: ['technical'],
  check(page): Issue[] {
    if (page.status < 400) return [];
    return [
      {
        ruleId: 'status-error',
        severity,
        message: `page returned HTTP ${page.status}`,
        evidence: { selector: 'status' },
      },
    ];
  },
});

export const insecureHttp = (severity: Severity): AuditRule => ({
  id: 'insecure-http',
  severity,
  categories: ['technical'],
  check(page): Issue[] {
    if (page.url.protocol !== 'http:') return [];
    return [
      {
        ruleId: 'insecure-http',
        severity,
        message: 'page is served over plain http:',
        evidence: { selector: 'status', snippet: page.url.href },
        fixHint: 'serve the page over https: and redirect http: to it',
      },
    ];
  },
});

// Stylesheet/icon family per the plan's mixed-content scope (`shortcut` is
// redundant — `rel="shortcut icon"` splits to tokens containing `icon`).
const ICON_LINK_RELS = new Set(['stylesheet', 'icon', 'apple-touch-icon', 'mask-icon']);

export const mixedContent = (severity: Severity): AuditRule => ({
  id: 'mixed-content',
  severity,
  categories: ['technical'],
  check(page): Issue[] {
    if (page.url.protocol !== 'https:') return []; // http subresources only matter on https pages
    const insecure: string[] = [];
    const push = (url: string | undefined): void => {
      if (url === undefined) return;
      if (url.toLowerCase().startsWith('http:')) insecure.push(url);
    };
    page.dom('script[src]').each((_, el) => push(page.dom(el).attr('src')));
    page.dom('iframe[src]').each((_, el) => push(page.dom(el).attr('src')));
    page.dom('img[src]').each((_, el) => push(page.dom(el).attr('src')));
    page.dom('link[href]').each((_, el) => {
      const rel = (page.dom(el).attr('rel') ?? '').toLowerCase().split(/\s+/);
      if (rel.some((r) => ICON_LINK_RELS.has(r))) push(page.dom(el).attr('href'));
    });
    if (insecure.length === 0) return [];
    const shown = insecure.slice(0, EVIDENCE_CAP).join(' | ');
    const more = insecure.length > EVIDENCE_CAP ? ` (+${insecure.length - EVIDENCE_CAP} more)` : '';
    return [
      {
        ruleId: 'mixed-content',
        severity,
        message: `${insecure.length} insecure http: subresource(s) on an https: page`,
        evidence: { selector: 'script[src], iframe[src], img[src], link[href]', snippet: `${shown}${more}` },
        fixHint: 'load every subresource over https:',
      },
    ];
  },
});

export const responseLatency = (severity: Severity, t: ResolvedThresholds): AuditRule => ({
  id: 'response-latency',
  severity,
  categories: ['performance'],
  check(page): Issue[] {
    if (page.timingMs <= t.latencyMs) return [];
    return [
      {
        ruleId: 'response-latency',
        severity,
        message: `response took ${page.timingMs}ms (threshold ${t.latencyMs}ms)`,
        evidence: { selector: 'status', snippet: `${page.timingMs}ms` },
        fixHint: 'reduce server response time (caching, CDN, less blocking work)',
      },
    ];
  },
});
