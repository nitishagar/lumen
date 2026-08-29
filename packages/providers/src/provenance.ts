/**
 * Attribution constants (I8/A7/A8) — the single source of truth; site-docs
 * renders these exports verbatim. The CrUX string is the VERBATIM license
 * sentence owed wherever CrUX data is displayed, plus the methodology URL.
 */
export const ATTRIBUTION = {
  crux:
    'The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license (https://developer.chrome.com/docs/crux/methodology)',
  tranco: 'Tranco top-sites ranking — https://tranco-list.eu (Le Pochat et al.) — CC BY 4.0',
  openpagerank: 'Open PageRank domain score — https://openpagerank.com (openpagerank.keywordseverywhere.com/docs)',
  pagespeed: 'Lighthouse / PageSpeed Insights API (Google)',
  wikipedia: 'Wikimedia pageviews (CC0) — used as a demand proxy, not search volume',
  'google-suggest': 'Google autocomplete suggestions — undocumented endpoint (gray)',
  'ddg-serp': 'DuckDuckGo SERP via best-effort HTML retrieval (gray)',
} as const;

export type AttributionKey = keyof typeof ATTRIBUTION;

/** Honesty labels (I3): required on every heuristic/gray emitted value. */
export const ESTIMATE_LABELS = {
  'google-suggest': 'autocomplete suggestion — undocumented Google endpoint (gray)',
  'ddg-serp': 'best-effort SERP via undocumented HTML endpoint (gray)',
  openpagerank: 'Open PageRank domain-authority proxy — not a search-engine metric',
} as const;
