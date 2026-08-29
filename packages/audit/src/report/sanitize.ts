/**
 * Output sanitization (I13 — audit owns it for stored report data): crawled
 * strings stored in reports are INERT — C0/C1 control characters stripped
 * (the plan's locked regex; tab/LF survive), length-capped. Consumers (CLI
 * terminal, site HTML) still escape at render time — this guarantees the
 * stored form is safe to escape, not a license to skip escaping.
 */
import type { Issue } from '@lumen-seo/core';

/** Strip C0/C1 control characters, cap at `max` code points (default 300). */
export const sanitizeText = (s: string, max = 300): string =>
  // control chars are the rule's PURPOSE (I13) — the no-control-regex
  // lint guard is for accidental usage, intentionally suppressed here
  [...s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')].slice(0, max).join(''); // eslint-disable-line no-control-regex

/**
 * Sanitize every crawled-derived string of an issue: `message`,
 * `evidence.selector`, `evidence.snippet`, `fixHint`. `ruleId`, `severity`,
 * and the attribution `url` are engine-controlled and preserved untouched.
 */
export const sanitizeIssue = (issue: Issue): Issue => ({
  ...issue,
  message: sanitizeText(issue.message),
  evidence: {
    ...(issue.evidence.selector !== undefined ? { selector: sanitizeText(issue.evidence.selector) } : {}),
    ...(issue.evidence.snippet !== undefined ? { snippet: sanitizeText(issue.evidence.snippet) } : {}),
  },
  ...(issue.fixHint !== undefined ? { fixHint: sanitizeText(issue.fixHint) } : {}),
});
