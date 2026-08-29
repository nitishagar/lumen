/**
 * Social rule 18 (plan built-in table): Open Graph tag coverage.
 */
import type { AuditRule, Issue, Severity } from '@lumen-seo/core';

const OG_TAGS = ['og:title', 'og:description', 'og:image'] as const;

export const ogTagsMissing = (severity: Severity): AuditRule => ({
  id: 'og-tags-missing',
  severity,
  categories: ['social'],
  check(page): Issue[] {
    const missing: string[] = [];
    for (const tag of OG_TAGS) {
      if (page.dom(`meta[property="${tag}"]`).length === 0) missing.push(tag);
    }
    if (missing.length === 0) return [];
    return [
      {
        ruleId: 'og-tags-missing',
        severity,
        message: `missing Open Graph tag(s): ${missing.join(', ')}`,
        evidence: { selector: 'meta[property^="og:"]' },
        fixHint: 'add the missing og: meta tags for link previews',
      },
    ];
  },
});
