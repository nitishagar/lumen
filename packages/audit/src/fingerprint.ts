/**
 * Issue fingerprints (E1.3 FR-1): `sha256(ruleId + normalizedUrl +
 * evidence.selector?)` — the stable identity a baseline gates on. The MESSAGE
 * TEXT IS DELIBERATELY EXCLUDED so copy tweaks never un-baseline an issue.
 *
 * - `normalizedUrl` reuses the frontier's ONE normalizer (`normalizeKey`:
 *   WHATWG href, fragment stripped, host punycoded/lowercased) — drift between
 *   normalize-at-issue-time and normalize-at-compare-time would produce false
 *   "new" findings (research-pinned decision).
 * - Collision policy (validator I4): among the built-ins, at most ONE issue per
 *   (ruleId, page) lacks a selector — the EVIDENCE_CAP overflow issue
 *   (`evidence: {}`), which is unique per page by construction — so the
 *   3-tuple is currently collision-free. The gate counts ISSUE INSTANCES whose
 *   fingerprint is absent from the baseline; a disambiguator (e.g. snippet
 *   hash) is revisited only when a real rule needs one.
 */
import { createHash } from 'node:crypto';
import type { Issue } from '@lumen-seo/core';
import { normalizeKey } from './crawl/url-normalize.js';

export const fingerprintIssue = (issue: Issue): string => {
  const urlPart = issue.url === undefined ? '' : normalizeKey(new URL(issue.url));
  const material = `${issue.ruleId}\n${urlPart}\n${issue.evidence.selector ?? ''}`;
  return createHash('sha256').update(material, 'utf8').digest('hex');
};
