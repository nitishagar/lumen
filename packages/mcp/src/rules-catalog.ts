/**
 * The built-in rule catalog (E1.5): a WORKER-SAFE frozen literal — the Worker
 * must register prompts and the `lumen://rules` resource WITHOUT importing
 * `@lumen-seo/audit` (bundle-scan bans it from the worker graph).
 *
 * Drift is impossible to hide: `rules-catalog.test.ts` pins this list against
 * the REAL registry (`builtInRuleMetadata`) and the REAL emitted fixHints
 * (rules instantiated over violating fixture pages), so a rule change without
 * a catalog change fails validate.
 */
export interface RuleCatalogEntry {
  readonly id: string;
  readonly defaultSeverity: 'error' | 'warning' | 'info';
  readonly fixHint: string;
  readonly helpUrl: string;
}

const RULES_REFERENCE_BASE = 'https://nitishagar.github.io/lumen/docs/rules-reference/';

const entry = (id: string, defaultSeverity: RuleCatalogEntry['defaultSeverity'], fixHint: string): RuleCatalogEntry => ({
  id,
  defaultSeverity,
  fixHint,
  helpUrl: `${RULES_REFERENCE_BASE}#${id}`,
});

export const RULES_CATALOG: readonly RuleCatalogEntry[] = Object.freeze([
  entry('title-missing', 'error', 'add a unique, descriptive <title> to the <head>'),
  entry('title-length', 'warning', 'aim for 15-65 characters'),
  entry('description-missing', 'error', 'add <meta name="description" content="…"> summarizing the page'),
  entry('description-length', 'warning', 'aim for 50-165 characters'),
  entry('h1-missing', 'error', 'add exactly one <h1> describing the page topic'),
  entry('h1-multiple', 'info', 'demote extra <h1>s to <h2>+ so the outline stays unambiguous'),
  entry('canonical-present', 'info', 'add <link rel="canonical" href="…"> to declare the preferred URL'),
  entry('lang-attr', 'warning', 'set <html lang="en"> (or the page language) for accessibility and indexing'),
  entry('viewport-meta', 'warning', 'add <meta name="viewport" content="width=device-width, initial-scale=1">'),
  entry('image-alt-coverage', 'warning', 'add alt text to every <img> (alt="" for purely decorative images)'),
  entry('broken-internal-link', 'error', 'fix or remove the broken link'),
  entry('redirect-chain', 'warning', 'link and canonicalize directly to the final URL to avoid redirect chains'),
  entry('robots-noindex', 'info', 'remove the noindex directive (meta or X-Robots-Tag) if the page should be indexed; otherwise link to it from nowhere internal'),
  entry('status-error', 'error', 'fix or remove the broken URL, or return the correct status for the content that is there'),
  entry('insecure-http', 'warning', 'serve the page over https: and redirect http: to it'),
  entry('mixed-content', 'error', 'load every subresource over https:'),
  entry('response-latency', 'warning', 'reduce server response time (caching, CDN, less blocking work)'),
  entry('og-tags-missing', 'info', 'add the missing og: meta tags for link previews'),
  entry('hreflang-present', 'info', 'add hreflang link entries for each locale the page serves (skip when single-locale)'),
  entry('duplicate-content', 'warning', 'canonicalize duplicates to one URL or differentiate the content'),
]);
