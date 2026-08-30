/**
 * Registries (I2/SC-6/SC-7). Validation happens once, at construction; the
 * resulting registries are frozen and read-only.
 *
 * - `createProviderRegistry` validates configured names AND byok keys against
 *   the providers it is actually given — unknown → ConfigError listing the
 *   available names, sorted. An unconfigured boundary resolves to `undefined`
 *   ("absent") so P3/P4 implement I1 skip-with-explicit-reason semantics.
 * - `createRuleRegistry` rejects duplicate rule ids and unknown
 *   `severityOverrides` ids (listing known ids, plugin ids included).
 */
import { ConfigError } from './errors.js';
import type { ConfigErrorDetail } from './errors.js';
import type {
  AuthorityProvider,
  AnyProvider,
  CruxProvider,
  KeywordProvider,
  PageSpeedProvider,
  ProviderBoundary,
  SerpProvider,
} from './providers.js';
import { PROVIDER_BOUNDARIES } from './providers.js';
import type { AuditRule } from './rules.js';
import { isSeverity } from './severity.js';
import type { Severity } from './severity.js';

export interface ProviderRegistry {
  keywords(): KeywordProvider | undefined;
  serp(): SerpProvider | undefined;
  pagespeed(): PageSpeedProvider | undefined;
  crux(): CruxProvider | undefined;
  authority(): AuthorityProvider | undefined;
}

/** Runtime boundary-shape guards — a selected provider must implement its boundary. */
const implementsBoundary = {
  keywords: (p: AnyProvider): p is KeywordProvider =>
    typeof (p as Partial<KeywordProvider>).ideas === 'function',
  serp: (p: AnyProvider): p is SerpProvider =>
    typeof (p as Partial<SerpProvider>).search === 'function',
  pagespeed: (p: AnyProvider): p is PageSpeedProvider =>
    typeof (p as Partial<PageSpeedProvider>).report === 'function',
  crux: (p: AnyProvider): p is CruxProvider =>
    typeof (p as Partial<CruxProvider>).record === 'function',
  authority: (p: AnyProvider): p is AuthorityProvider =>
    typeof (p as Partial<AuthorityProvider>).authority === 'function',
} as const;

export const createProviderRegistry = (
  selection: Readonly<Partial<Record<ProviderBoundary, string>>>,
  byok: Readonly<Record<string, string>>,
  available: Readonly<Record<string, AnyProvider>>,
): ProviderRegistry => {
  const names = Object.keys(available).sort();
  const availableList = names.length > 0 ? names.join(', ') : '(none)';
  const details: ConfigErrorDetail[] = [];

  for (const [boundary, name] of Object.entries(selection) as [ProviderBoundary, string][]) {
    const instance = available[name];
    if (instance === undefined) {
      details.push({
        path: `providers.${boundary}`,
        message: `unknown provider name "${name}". Available: ${availableList}`,
      });
    } else if (!implementsBoundary[boundary](instance)) {
      details.push({
        path: `providers.${boundary}`,
        message: `provider "${name}" does not implement the "${boundary}" boundary`,
      });
    }
  }

  for (const key of Object.keys(byok)) {
    if (!(key in available)) {
      details.push({
        path: `byok.${key}`,
        message: `unknown provider name "${key}". Available: ${availableList}`,
      });
    }
  }

  if (details.length > 0) throw new ConfigError(details);

  const pick = (boundary: ProviderBoundary): AnyProvider | undefined => {
    const name = selection[boundary];
    return name === undefined ? undefined : available[name];
  };

  const as = <T extends AnyProvider>(p: AnyProvider | undefined): T | undefined =>
    p === undefined ? undefined : (p as T); // boundary shape verified above

  return Object.freeze({
    keywords: () => as<KeywordProvider>(pick('keywords')),
    serp: () => as<SerpProvider>(pick('serp')),
    pagespeed: () => as<PageSpeedProvider>(pick('pagespeed')),
    crux: () => as<CruxProvider>(pick('crux')),
    authority: () => as<AuthorityProvider>(pick('authority')),
  });
};

export interface RuleRegistry {
  get(id: string): AuditRule | undefined;
  list(): readonly AuditRule[];
  /** Override-if-present over the rule's built-in default severity. */
  effectiveSeverity(ruleId: string): Severity | undefined;
}

export const createRuleRegistry = (
  rules: readonly AuditRule[],
  severityOverrides: Readonly<Record<string, Severity>>,
): RuleRegistry => {
  const details: ConfigErrorDetail[] = [];

  const byId = new Map<string, AuditRule>();
  const duplicates = new Set<string>();
  for (const rule of rules) {
    if (byId.has(rule.id)) {
      duplicates.add(rule.id);
      continue;
    }
    byId.set(rule.id, rule);
  }
  for (const id of duplicates) {
    details.push({ path: `rules.${id}`, message: `duplicate rule id "${id}"` });
  }

  // A rule whose own severity is not one of the three known values would
  // poison the report downstream (NaN score, null count buckets) — reject it
  // at registration with a typed ConfigError instead (red-team round 1).
  for (const rule of byId.values()) {
    if (!isSeverity(rule.severity)) {
      details.push({
        path: `rules.${rule.id}.severity`,
        message: 'must be one of: error, warning, info',
      });
    }
  }

  const known = [...byId.keys()].sort();
  for (const [id, severity] of Object.entries(severityOverrides)) {
    if (!byId.has(id)) {
      details.push({
        path: `severityOverrides.${id}`,
        message: `unknown rule id "${id}". Known rule ids: ${known.length > 0 ? known.join(', ') : '(none)'}`,
      });
    } else if (!isSeverity(severity)) {
      details.push({ path: `severityOverrides.${id}`, message: 'must be one of: error, warning, info' });
    }
  }

  if (details.length > 0) throw new ConfigError(details);

  const frozenList: readonly AuditRule[] = Object.freeze([...rules]);
  return Object.freeze({
    get: (id: string): AuditRule | undefined => byId.get(id),
    list: () => frozenList,
    effectiveSeverity: (id: string): Severity | undefined => {
      const rule = byId.get(id);
      if (rule === undefined) return undefined;
      return severityOverrides[id] ?? rule.severity;
    },
  });
};

/** Boundary list re-exported for error messages and callers. */
export { PROVIDER_BOUNDARIES };
