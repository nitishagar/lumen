/**
 * `createRuleSet` (I2): built-in page rules + crawl rules + core-registered
 * plugin rules, with `severityOverrides` applied and VALIDATED by core's
 * `createRuleRegistry` — an unknown rule id is a `ConfigError` listing the
 * available ids (mirroring the provider-registry edge).
 */
import { createRuleRegistry, ConfigError } from '@lumen-seo/core';
import type { AuditRule, Severity } from '@lumen-seo/core';
import { canonicalPresent, descriptionLength, descriptionMissing, hreflangPresent, robotsNoindex, titleLength, titleMissing } from './meta.js';
import { h1Missing, h1Multiple, imageAltCoverage, langAttr } from './content.js';
import { insecureHttp, mixedContent, responseLatency, statusError, viewportMeta } from './technical.js';
import { brokenInternalLink, duplicateContent, redirectChain } from './links.js';
import { ogTagsMissing } from './social.js';
import { robotsInvalid, sitemapInvalid } from './site.js';
import { aiCrawlerAccess, llmsTxt } from './ai-search.js';
import { contentInRawHtml, metaRefreshRedirect, securityHeaders, structuredDataInvalid, structuredDataRequiredProps, thinContent, twitterCardMissing } from './integrity.js';
import { brokenExternalLink, canonicalTargetInvalid, hreflangReciprocity, orphanPage, sitemapUrlNonindexable } from './integrity-crawl.js';
import type { CrawlRule, ResolvedAuditConfig, ResolvedThresholds, SiteRule } from '../types.js';

type PageRuleFactory = (severity: Severity, t: ResolvedThresholds, canonicalOrigin?: URL) => AuditRule;
type CrawlRuleFactory = (severity: Severity) => CrawlRule;
type SiteRuleFactory = (severity: Severity) => SiteRule;

interface BuiltinSpec {
  id: string;
  defaultSeverity: Severity;
  categories: readonly string[];
  make: PageRuleFactory | CrawlRuleFactory | SiteRuleFactory;
  kind: 'page' | 'crawl' | 'site';
}

/** The built-ins (plan table + E1.6/E1.7 additions, order preserved). */
export const BUILT_IN_RULES: readonly BuiltinSpec[] = [
  { id: 'title-missing', defaultSeverity: 'error', categories: ['meta'], make: (s: Severity) => titleMissing(s), kind: 'page' },
  { id: 'title-length', defaultSeverity: 'warning', categories: ['meta'], make: (s: Severity, t: ResolvedThresholds) => titleLength(s, t), kind: 'page' },
  { id: 'description-missing', defaultSeverity: 'error', categories: ['meta'], make: (s: Severity) => descriptionMissing(s), kind: 'page' },
  { id: 'description-length', defaultSeverity: 'warning', categories: ['meta'], make: (s: Severity, t: ResolvedThresholds) => descriptionLength(s, t), kind: 'page' },
  { id: 'h1-missing', defaultSeverity: 'error', categories: ['content'], make: (s: Severity) => h1Missing(s), kind: 'page' },
  { id: 'h1-multiple', defaultSeverity: 'info', categories: ['content'], make: (s: Severity) => h1Multiple(s), kind: 'page' },
  { id: 'canonical-present', defaultSeverity: 'info', categories: ['meta'], make: (s: Severity) => canonicalPresent(s), kind: 'page' },
  { id: 'lang-attr', defaultSeverity: 'warning', categories: ['content'], make: (s: Severity) => langAttr(s), kind: 'page' },
  { id: 'viewport-meta', defaultSeverity: 'warning', categories: ['technical'], make: (s: Severity) => viewportMeta(s), kind: 'page' },
  { id: 'image-alt-coverage', defaultSeverity: 'warning', categories: ['content', 'accessibility'], make: (s: Severity) => imageAltCoverage(s), kind: 'page' },
  { id: 'broken-internal-link', defaultSeverity: 'error', categories: ['links'], make: (s: Severity) => brokenInternalLink(s), kind: 'crawl' },
  { id: 'redirect-chain', defaultSeverity: 'warning', categories: ['links', 'technical'], make: (s: Severity) => redirectChain(s), kind: 'crawl' },
  { id: 'robots-noindex', defaultSeverity: 'info', categories: ['meta', 'technical'], make: (s: Severity) => robotsNoindex(s), kind: 'page' },
  { id: 'status-error', defaultSeverity: 'error', categories: ['technical'], make: (s: Severity) => statusError(s), kind: 'page' },
  { id: 'insecure-http', defaultSeverity: 'warning', categories: ['technical'], make: (s: Severity, _t, c) => insecureHttp(s, c), kind: 'page' },
  { id: 'mixed-content', defaultSeverity: 'error', categories: ['technical'], make: (s: Severity) => mixedContent(s), kind: 'page' },
  { id: 'response-latency', defaultSeverity: 'warning', categories: ['performance'], make: (s: Severity, t: ResolvedThresholds) => responseLatency(s, t), kind: 'page' },
  { id: 'og-tags-missing', defaultSeverity: 'info', categories: ['social'], make: (s: Severity) => ogTagsMissing(s), kind: 'page' },
  { id: 'hreflang-present', defaultSeverity: 'info', categories: ['meta'], make: (s: Severity) => hreflangPresent(s), kind: 'page' },
  { id: 'duplicate-content', defaultSeverity: 'warning', categories: ['content'], make: (s: Severity) => duplicateContent(s), kind: 'crawl' },
  { id: 'structured-data-invalid', defaultSeverity: 'error', categories: ['technical', 'integrity'], make: (s: Severity) => structuredDataInvalid(s), kind: 'page' },
  { id: 'structured-data-required-props', defaultSeverity: 'warning', categories: ['technical', 'integrity'], make: (s: Severity) => structuredDataRequiredProps(s), kind: 'page' },
  { id: 'meta-refresh-redirect', defaultSeverity: 'warning', categories: ['technical', 'integrity'], make: (s: Severity) => metaRefreshRedirect(s), kind: 'page' },
  { id: 'security-headers', defaultSeverity: 'info', categories: ['technical', 'integrity'], make: (s: Severity) => securityHeaders(s), kind: 'page' },
  { id: 'twitter-card-missing', defaultSeverity: 'info', categories: ['social'], make: (s: Severity) => twitterCardMissing(s), kind: 'page' },
  { id: 'thin-content', defaultSeverity: 'info', categories: ['content', 'integrity'], make: (s: Severity, t) => thinContent(s, t), kind: 'page' },
  { id: 'content-in-raw-html', defaultSeverity: 'warning', categories: ['ai-search'], make: (s: Severity, t) => contentInRawHtml(s, t), kind: 'page' },
  { id: 'canonical-target-invalid', defaultSeverity: 'error', categories: ['links', 'integrity'], make: (s: Severity) => canonicalTargetInvalid(s), kind: 'crawl' },
  { id: 'sitemap-url-nonindexable', defaultSeverity: 'warning', categories: ['integrity'], make: (s: Severity) => sitemapUrlNonindexable(s), kind: 'crawl' },
  { id: 'hreflang-reciprocity', defaultSeverity: 'warning', categories: ['meta', 'integrity'], make: (s: Severity) => hreflangReciprocity(s), kind: 'crawl' },
  { id: 'orphan-page', defaultSeverity: 'info', categories: ['integrity'], make: (s: Severity) => orphanPage(s), kind: 'crawl' },
  { id: 'broken-external-link', defaultSeverity: 'warning', categories: ['links', 'integrity'], make: (s: Severity) => brokenExternalLink(s), kind: 'crawl' },
  { id: 'sitemap-invalid', defaultSeverity: 'warning', categories: ['technical', 'integrity'], make: (s: Severity) => sitemapInvalid(s), kind: 'site' },
  { id: 'robots-invalid', defaultSeverity: 'warning', categories: ['technical', 'integrity'], make: (s: Severity) => robotsInvalid(s), kind: 'site' },
  { id: 'ai-crawler-access', defaultSeverity: 'info', categories: ['ai-search'], make: (s: Severity) => aiCrawlerAccess(s), kind: 'site' },
  { id: 'llms-txt', defaultSeverity: 'info', categories: ['ai-search'], make: (s: Severity) => llmsTxt(s), kind: 'site' },
];

export const BUILT_IN_RULE_IDS: readonly string[] = BUILT_IN_RULES.map((r) => r.id);

/** Machine-readable built-in metadata for `lumen config show` (P4). */
/** Stable docs anchor for a built-in rule (E1.2 FR-3); plugin rules have none. */
export const RULES_REFERENCE_BASE = 'https://nitishagar.github.io/lumen/docs/rules-reference/';
export const helpUrlFor = (ruleId: string): string | undefined =>
  BUILT_IN_RULES.some((r) => r.id === ruleId) ? `${RULES_REFERENCE_BASE}#${ruleId}` : undefined;

export const builtInRuleMetadata = (): { id: string; defaultSeverity: Severity; categories: readonly string[] }[] =>
  BUILT_IN_RULES.map(({ id, defaultSeverity, categories }) => ({ id, defaultSeverity, categories: [...categories] }));

export interface RuleSet {
  pageRules: readonly AuditRule[];
  crawlRules: readonly CrawlRule[];
  /** E1.6 FR-2: the third rule kind — once per audit against the retained site evidence. */
  siteRules: readonly SiteRule[];
  thresholds: ResolvedThresholds;
  /** ruleId -> effective severity (override over built-in default). */
  effectiveSeverity: Readonly<Record<string, Severity>>;
}

const asAuditRule = (spec: BuiltinSpec): AuditRule => ({
  id: spec.id,
  severity: spec.defaultSeverity,
  categories: [...spec.categories],
  check: () => [], // shim: crawl rules do not run per page; registration only
});

/** All category names across the registry (for --only validation). */
export const ALL_CATEGORIES: readonly string[] = [...new Set(BUILT_IN_RULES.flatMap((r) => [...r.categories]))].sort();

export const createRuleSet = (config: ResolvedAuditConfig): RuleSet => {
  const t = config.thresholds;

  // E1.7 FR-4: --only filters by category or rule id; an unknown token is a
  // loud ConfigError listing every valid token (never a silent full run).
  let specs = BUILT_IN_RULES;
  let onlyUnfiltered = false;
  if (config.only !== undefined && config.only.length > 0) {
    const valid = new Set<string>([...BUILT_IN_RULES.map((r) => r.id), ...ALL_CATEGORIES]);
    const unknown = config.only.filter((token) => !valid.has(token));
    if (unknown.length > 0) {
      throw new ConfigError([
        {
          path: 'only',
          message: `unknown category or rule id: ${unknown.join(', ')}. Valid: ${[...valid].sort().join(', ')}`,
        },
      ]);
    }
    specs = BUILT_IN_RULES.filter(
      (r) => config.only!.includes(r.id) || r.categories.some((c) => config.only!.includes(c)),
    );
    // I6: severity overrides are validated against the FULL registry, so a
    // standing override for an unfiltered rule never hard-fails a --only run.
    onlyUnfiltered = true;
  }

  // Validation happens ONCE, through core's registry: unknown override ids
  // throw ConfigError listing every known id (built-ins + plugins).
  // I7: --only filters PLUGIN rules by id/category too (they are not --only
  // tokens themselves, but a filtered run should not execute them).
  const extraSpecs = config.only !== undefined && config.only.length > 0
    ? config.extraRules.filter((p) => config.only!.includes(p.id) || p.categories.some((c) => config.only!.includes(c)))
    : config.extraRules;
  const shims = (onlyUnfiltered ? BUILT_IN_RULES : specs).filter((r) => r.kind !== 'page').map(asAuditRule); // registration only
  const registry = createRuleRegistry(
    [
      ...(onlyUnfiltered ? BUILT_IN_RULES : specs).filter((r) => r.kind === 'page').map((r) => (r.make as PageRuleFactory)(r.defaultSeverity, t, config.canonicalOrigin)),
      ...shims,
      ...config.extraRules,
    ],
    config.severityOverrides,
  );

  const effective: Record<string, Severity> = {};
  const pageRules: AuditRule[] = [];
  const crawlRules: CrawlRule[] = [];
  const siteRules: SiteRule[] = [];

  for (const spec of specs) {
    const severity = registry.effectiveSeverity(spec.id) ?? spec.defaultSeverity;
    effective[spec.id] = severity;
    if (spec.kind === 'page') pageRules.push((spec.make as PageRuleFactory)(severity, t, config.canonicalOrigin));
    else if (spec.kind === 'crawl') crawlRules.push((spec.make as CrawlRuleFactory)(severity));
    else siteRules.push((spec.make as SiteRuleFactory)(severity));
  }
  for (const plugin of extraSpecs) {
    effective[plugin.id] = registry.effectiveSeverity(plugin.id) ?? plugin.severity;
    const sev = effective[plugin.id]!;
    // The configured (effective) severity GOVERNS: core's registry rewrites
    // rule.severity, but a plugin's check() may emit issues with a hardcoded
    // severity — scoring (I2/I3) must honor the user's override, so emitted
    // issues are normalized to the effective severity (evidence untouched).
    pageRules.push({
      ...plugin,
      severity: sev,
      check: async (page, o) => {
        const found = await plugin.check(page, o);
        return (Array.isArray(found) ? found : []).map((i) => (i.severity === sev ? i : { ...i, severity: sev }));
      },
    });
  }

  return { pageRules, crawlRules, siteRules, thresholds: t, effectiveSeverity: effective };
};
