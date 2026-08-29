/**
 * `createRuleSet` (I2): built-in page rules + crawl rules + core-registered
 * plugin rules, with `severityOverrides` applied and VALIDATED by core's
 * `createRuleRegistry` — an unknown rule id is a `ConfigError` listing the
 * available ids (mirroring the provider-registry edge).
 */
import { createRuleRegistry } from '@lumen-seo/core';
import type { AuditRule, Severity } from '@lumen-seo/core';
import { canonicalPresent, descriptionLength, descriptionMissing, robotsNoindex, titleLength, titleMissing } from './meta.js';
import { h1Missing, h1Multiple, imageAltCoverage, langAttr } from './content.js';
import { insecureHttp, mixedContent, responseLatency, statusError, viewportMeta } from './technical.js';
import { brokenInternalLink, redirectChain } from './links.js';
import { ogTagsMissing } from './social.js';
import type { CrawlRule, ResolvedAuditConfig, ResolvedThresholds } from '../types.js';

type PageRuleFactory = (severity: Severity, t: ResolvedThresholds) => AuditRule;
type CrawlRuleFactory = (severity: Severity) => CrawlRule;

interface BuiltinSpec {
  id: string;
  defaultSeverity: Severity;
  categories: readonly string[];
  make: PageRuleFactory | CrawlRuleFactory;
  kind: 'page' | 'crawl';
}

/** The 18 built-ins (plan table, order preserved). */
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
  { id: 'insecure-http', defaultSeverity: 'warning', categories: ['technical'], make: (s: Severity) => insecureHttp(s), kind: 'page' },
  { id: 'mixed-content', defaultSeverity: 'error', categories: ['technical'], make: (s: Severity) => mixedContent(s), kind: 'page' },
  { id: 'response-latency', defaultSeverity: 'warning', categories: ['performance'], make: (s: Severity, t: ResolvedThresholds) => responseLatency(s, t), kind: 'page' },
  { id: 'og-tags-missing', defaultSeverity: 'info', categories: ['social'], make: (s: Severity) => ogTagsMissing(s), kind: 'page' },
];

export const BUILT_IN_RULE_IDS: readonly string[] = BUILT_IN_RULES.map((r) => r.id);

/** Machine-readable built-in metadata for `lumen config show` (P4). */
export const builtInRuleMetadata = (): { id: string; defaultSeverity: Severity; categories: readonly string[] }[] =>
  BUILT_IN_RULES.map(({ id, defaultSeverity, categories }) => ({ id, defaultSeverity, categories: [...categories] }));

export interface RuleSet {
  pageRules: readonly AuditRule[];
  crawlRules: readonly CrawlRule[];
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

export const createRuleSet = (config: ResolvedAuditConfig): RuleSet => {
  const t = config.thresholds;

  // Validation happens ONCE, through core's registry: unknown override ids
  // throw ConfigError listing every known id (built-ins + plugins).
  const shims = BUILT_IN_RULES.filter((r) => r.kind === 'crawl').map(asAuditRule);
  const registry = createRuleRegistry(
    [
      ...BUILT_IN_RULES.filter((r) => r.kind === 'page').map((r) => (r.make as PageRuleFactory)(r.defaultSeverity, t)),
      ...shims,
      ...config.extraRules,
    ],
    config.severityOverrides,
  );

  const effective: Record<string, Severity> = {};
  const pageRules: AuditRule[] = [];
  const crawlRules: CrawlRule[] = [];

  for (const spec of BUILT_IN_RULES) {
    const severity = registry.effectiveSeverity(spec.id) ?? spec.defaultSeverity;
    effective[spec.id] = severity;
    if (spec.kind === 'page') pageRules.push((spec.make as PageRuleFactory)(severity, t));
    else crawlRules.push((spec.make as CrawlRuleFactory)(severity));
  }
  for (const plugin of config.extraRules) {
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

  return { pageRules, crawlRules, thresholds: t, effectiveSeverity: effective };
};
