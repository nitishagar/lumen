import { describe, expect, it } from 'vitest';
import type { AuditRule } from './rules.js';
import type {
  AuthorityProvider,
  CruxProvider,
  KeywordProvider,
  PageSpeedProvider,
  SerpProvider,
} from './providers.js';
import { createProviderRegistry, createRuleRegistry } from './registry.js';
import { ConfigError } from './errors.js';

const keywordProvider: KeywordProvider = { name: 'suggest-fixture', ideas: async () => [] };
const wikiProvider: KeywordProvider = { name: 'wiki-fixture', ideas: async () => [] };
const serpProvider: SerpProvider = { name: 'ddg-fixture', search: async () => [] };
const psiProvider: PageSpeedProvider = {
  name: 'pagespeed-fixture',
  report: async () => ({
    scores: { performance: null, seo: null, accessibility: null, bestPractices: null },
    metrics: { lcp: null, cls: null, tbt: null, fcn: null },
    source: { provider: 'pagespeed-fixture', kind: 'official' },
  }),
};
const cruxProvider: CruxProvider = { name: 'crux-fixture', record: async () => null };
const oprProvider: AuthorityProvider = { name: 'opr-fixture', authority: async () => [] };

const available = {
  'suggest-fixture': keywordProvider,
  'wiki-fixture': wikiProvider,
  'ddg-fixture': serpProvider,
  'pagespeed-fixture': psiProvider,
  'crux-fixture': cruxProvider,
  'opr-fixture': oprProvider,
};

const rule = (id: string, severity: AuditRule['severity'] = 'warning'): AuditRule => ({
  id,
  severity,
  categories: ['seo'],
  check: () => [],
});

describe('createProviderRegistry (SC-5 / SC-6, I2)', () => {
  it('resolves configured boundaries to the right instances', () => {
    const reg = createProviderRegistry({ keywords: 'suggest-fixture', serp: 'ddg-fixture' }, {}, available);
    expect(reg.keywords()).toBe(keywordProvider);
    expect(reg.serp()).toBe(serpProvider);
  });

  it('an unconfigured boundary resolves to absent (undefined) — I1 skip is the caller\u2019s job', () => {
    const reg = createProviderRegistry({ keywords: 'suggest-fixture' }, {}, available);
    expect(reg.pagespeed()).toBeUndefined();
    expect(reg.crux()).toBeUndefined();
    expect(reg.authority()).toBeUndefined();
  });

  it('unknown provider name → ConfigError listing the available names, sorted (I2)', () => {
    let err: unknown;
    try {
      createProviderRegistry({ keywords: 'nope-fixture' }, {}, available);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as Error).message;
    for (const name of Object.keys(available).sort()) expect(msg).toContain(name);
  });

  it('unknown byok key → ConfigError listing the available names (SC-5)', () => {
    expect(() => createProviderRegistry({}, { 'nope-fixture': 'LUMEN_X_KEY' }, available))
      .toThrow(ConfigError);
  });

  it('a configured byok name passes validation', () => {
    const reg = createProviderRegistry({}, { 'pagespeed-fixture': 'LUMEN_PSI_KEY' }, available);
    expect(reg.pagespeed()).toBeUndefined(); // selection absent is independent of byok
  });

  it('the registry is frozen after construction (no shared mutable state)', () => {
    const reg = createProviderRegistry({ keywords: 'suggest-fixture' }, {}, available);
    expect(Object.isFrozen(reg)).toBe(true);
  });
});

describe('createRuleRegistry (SC-7)', () => {
  const rules = [rule('title-missing', 'error'), rule('img-alt', 'info'), rule('meta-desc', 'warning')];

  it('get/list round-trip the rules', () => {
    const reg = createRuleRegistry(rules, {});
    expect(reg.get('title-missing')?.severity).toBe('error');
    expect(reg.get('nope')).toBeUndefined();
    expect(reg.list().map((r) => r.id).sort()).toEqual(['img-alt', 'meta-desc', 'title-missing']);
    expect(Object.isFrozen(reg.list())).toBe(true);
  });

  it('duplicate rule ids are rejected', () => {
    expect(() => createRuleRegistry([rule('a'), rule('b'), rule('a')], {})).toThrow(/duplicate rule id "a"/);
  });

  it('unknown severityOverrides id → ConfigError listing known ids (incl. plugin ids)', () => {
    const err = (() => {
      try {
        createRuleRegistry(rules, { 'nope-rule': 'info' });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect(String((err as Error).message)).toMatch(/title-missing/);
    expect(String((err as Error).message)).toMatch(/img-alt/);
    expect(String((err as Error).message)).toMatch(/meta-desc/);
  });

  it('effectiveSeverity resolves overrides over built-in defaults', () => {
    const reg = createRuleRegistry(rules, { 'title-missing': 'info', 'img-alt': 'error' });
    expect(reg.effectiveSeverity('title-missing')).toBe('info'); // overridden
    expect(reg.effectiveSeverity('img-alt')).toBe('error'); // overridden
    expect(reg.effectiveSeverity('meta-desc')).toBe('warning'); // default preserved
  });

  it('effectiveSeverity of an unknown id is undefined', () => {
    const reg = createRuleRegistry(rules, {});
    expect(reg.effectiveSeverity('nope')).toBeUndefined();
  });
});
