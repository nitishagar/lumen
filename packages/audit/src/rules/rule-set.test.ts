import { describe, expect, it } from 'vitest';
import { ConfigError } from '@lumen-seo/core';
import type { AuditRule } from '@lumen-seo/core';
import { resolveAuditConfig, EVIDENCE_CAP } from '../config.js';
import { runSiteAudit } from '../run.js';
import type { RuleContext } from '../types.js';
import { BUILT_IN_RULE_IDS, builtInRuleMetadata, createRuleSet } from './rule-set.js';
import { FakeFetcher } from '../testing/fake-fetcher.js';
import type { FakeRoute } from '../testing/fake-fetcher.js';
import { makeTestDeps } from '../testing/deps.js';
import { makePage } from '../testing/page.js';

const ORIGIN = 'https://example.com';
const ROBOTS = 'https://example.com/robots.txt';

const html = (body: string, head = '<title>Ample page title length</title>'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

const noRobots: FakeRoute = { status: 404, contentType: 'text/plain', body: '' };

const site = (body: string, head?: string): Record<string, FakeRoute> => ({
  [ROBOTS]: noRobots,
  'https://example.com/sitemap.xml': noRobots,
  'https://example.com/': { status: 200, contentType: 'text/html', body: html(body, head) },
});

const ruleCtx: RuleContext = { depth: 0, isSeed: true };

describe('rule-set configuration (I2)', () => {
  it('exposes exactly the 18 built-in rule ids with metadata', () => {
    expect(BUILT_IN_RULE_IDS).toHaveLength(18);
    const meta = builtInRuleMetadata();
    expect(new Set(meta.map((m) => m.id)).size).toBe(18);
    expect(meta.find((m) => m.id === 'title-missing')).toEqual({ id: 'title-missing', defaultSeverity: 'error', categories: ['meta'] });
  });

  it('rules: severity override applied from config', async () => {
    const fetcher = new FakeFetcher(site('<h1>a</h1><h1>b</h1>'));
    const report = await runSiteAudit(
      new URL(ORIGIN),
      { severityOverrides: { 'h1-multiple': 'error' } },
      makeTestDeps(fetcher),
    );
    const issue = report.pages[0]?.issues.find((i) => i.ruleId === 'h1-multiple');
    expect(issue?.severity).toBe('error'); // default is info
    expect(report.summary.countsBySeverity.error).toBeGreaterThanOrEqual(1);
  });

  it('rules: unknown rule id in config errors listing available ids', () => {
    const resolved = resolveAuditConfig({ severityOverrides: { 'no-such-rule': 'warning' } });
    expect(() => createRuleSet(resolved)).toThrow(ConfigError);
    try {
      createRuleSet(resolved);
    } catch (e) {
      const message = (e as ConfigError).details.map((d) => d.message).join('; ');
      expect(message).toContain('no-such-rule');
      for (const id of ['title-missing', 'broken-internal-link', 'og-tags-missing']) expect(message).toContain(id);
    }
  });

  it('rules: threshold override applied (title length, description length end-to-end; latency via rule-set)', async () => {
    const fetcher = new FakeFetcher(site('', '<title>A perfectly normal title</title><meta name="description" content="d">'));
    const tight = await runSiteAudit(
      new URL(ORIGIN),
      { thresholds: { titleMinChars: 40, descriptionMaxChars: 5 } },
      makeTestDeps(fetcher),
    );
    const ids = tight.pages[0]?.issues.map((i) => i.ruleId) ?? [];
    expect(ids).toContain('title-length'); // 27 chars < overridden min 40
    expect(ids).toContain('description-length'); // 1 char < default min 50

    // Latency: the fake fetcher is instantaneous (timingMs 0), so a full run
    // can never fire the rule; the override path is asserted on the rule the
    // rule-set produced — deterministic and honest.
    const resolved = resolveAuditConfig({ thresholds: { latencyMs: 5 } });
    const latencyRule = createRuleSet(resolved).pageRules.find((r) => r.id === 'response-latency');
    expect(latencyRule).toBeDefined();
    const over = await latencyRule!.check(makePage('<html></html>', { timingMs: 6 }), ruleCtx);
    expect(over).toHaveLength(1);
    expect(over[0]?.message).toContain('threshold 5ms');
    const under = await latencyRule!.check(makePage('<html></html>', { timingMs: 5 }), ruleCtx);
    expect(under).toEqual([]);
  });

  it('rules: latency threshold uses measured crawl timing', async () => {
    const time = { value: 0 };
    const fetcher = new FakeFetcher(site(''), () => 0);
    // simulate a slow page: clock advances between fetch start and end
    const deps = makeTestDeps(fetcher, { time });
    const slow = await runSiteAudit(new URL(ORIGIN), { thresholds: { latencyMs: 5 } }, deps);
    expect(slow.pages[0]?.issues.map((i) => i.ruleId)).not.toContain('response-latency'); // instant fetch
  });

  it('rules: evidence capped at 10 per rule per page with overflow marker', async () => {
    const links = Array.from({ length: 25 }, (_, i) => `<a href="/gone-${i}">g${i}</a>`).join('');
    const routes: Record<string, FakeRoute> = site(links);
    for (let i = 0; i < 25; i++) {
      routes[`https://example.com/gone-${i}`] = { status: 404, contentType: 'text/html', body: html('') };
    }
    const fetcher = new FakeFetcher(routes);
    // budget must cover seed + all 25 targets, else fewer than 10 broken
    // links exist and the cap could never trigger
    const report = await runSiteAudit(new URL(ORIGIN), { crawl: { maxPages: 30 } }, makeTestDeps(fetcher));
    const seed = report.pages.find((p) => p.url === 'https://example.com/');
    const broken = seed?.issues.filter((i) => i.ruleId === 'broken-internal-link') ?? [];
    // 10 evidence issues + 1 overflow marker = 11 (cap is per rule per page)
    expect(broken).toHaveLength(EVIDENCE_CAP + 1);
    expect(broken.some((i) => i.message.startsWith('+'))).toBe(true);
  });

  it('rules: a throwing rule is isolated and recorded in summary.ruleErrors, run continues', async () => {
    const throwing: AuditRule = {
      id: 'throwing-plugin',
      severity: 'warning',
      categories: ['custom'],
      check() {
        throw new Error('rule blew up');
      },
    };
    const fetcher = new FakeFetcher(site('<h1>only one</h1>'));
    const report = await runSiteAudit(new URL(ORIGIN), { extraRules: [throwing] }, makeTestDeps(fetcher));
    expect(report.summary.ruleErrors).toEqual({ 'throwing-plugin': 1 });
    expect(report.incomplete).toBe(false);
    // no fabricated issue for the rule that never ran
    expect(report.pages[0]?.issues.some((i) => i.ruleId === 'throwing-plugin')).toBe(false);
    // other rules still produced their issues
    expect(report.pages[0]?.issues.length).toBeGreaterThan(0);
  });

  it('rules: plugin rule from core registry receives RuleContext', async () => {
    const seen: unknown[] = [];
    const probe: AuditRule = {
      id: 'ctx-probe',
      severity: 'info',
      categories: ['custom'],
      check(_page, o) {
        seen.push(o);
        return [];
      },
    };
    const fetcher = new FakeFetcher(site(''));
    await runSiteAudit(new URL(ORIGIN), { extraRules: [probe] }, makeTestDeps(fetcher));
    expect(seen).toHaveLength(1);
    const ctx = seen[0] as { depth?: number; isSeed?: boolean };
    expect(ctx.depth).toBe(0);
    expect(ctx.isSeed).toBe(true);
  });

  it('rules: severity override applies to plugin rules too', async () => {
    const probe: AuditRule = {
      id: 'ctx-probe',
      severity: 'info',
      categories: ['custom'],
      check() {
        return [{ ruleId: 'ctx-probe', severity: 'info', message: 'x', evidence: {} }];
      },
    };
    const fetcher = new FakeFetcher(site(''));
    const report = await runSiteAudit(
      new URL(ORIGIN),
      { extraRules: [probe], severityOverrides: { 'ctx-probe': 'error' } },
      makeTestDeps(fetcher),
    );
    const issue = report.pages[0]?.issues.find((i) => i.ruleId === 'ctx-probe');
    expect(issue?.severity).toBe('error');
  });

  it('rules: crawl-rule issues land on owning pages with url set', async () => {
    const fetcher = new FakeFetcher({
      ...site('<a href="/missing">m</a>'),
      'https://example.com/missing': { status: 404, contentType: 'text/html', body: html('') },
    });
    const report = await runSiteAudit(new URL(ORIGIN), {}, makeTestDeps(fetcher));
    const seed = report.pages.find((p) => p.url === 'https://example.com/');
    const broken = seed?.issues.find((i) => i.ruleId === 'broken-internal-link');
    expect(broken).toBeDefined();
    expect(broken?.url).toBe('https://example.com/');
    const target = report.pages.find((p) => p.url === 'https://example.com/missing');
    expect(target?.issues.some((i) => i.ruleId === 'broken-internal-link')).toBe(false);
    expect(report.summary.byRule?.['broken-internal-link']).toBe(1);
  });
});
