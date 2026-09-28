/**
 * E1.5 tests: prompts + resources are ADDITIVE — tools/list stays exactly 5;
 * prompts/list = 3; resources/list ≥ 1 (the static catalog); history
 * resources are TEMPLATES (readable, listed under templates only); the
 * Worker shape returns the typed LOCAL_ONLY payload on history reads; and the
 * worker-safe RULES_CATALOG is parity-pinned against the REAL registry
 * (metadata + emitted fixHints — drift fails validate).
 */
import { describe, expect, it } from 'vitest';
import { createRuleSet, builtInRuleMetadata, helpUrlFor } from '@lumen-seo/audit';
import { resolveAuditConfig } from '@lumen-seo/audit';
import type { AuditRule, Issue } from '@lumen-seo/core';
import { RULES_CATALOG } from './rules-catalog.js';
import { connectClient, fixtureDeps, fixtureRemoteDeps } from './testkit/index.js';

// The audit testkit page helper lives in @lumen-seo/audit's src (not exported
// from the package index) — a minimal local equivalent keeps this test
// self-contained.
import { load as loadDom } from 'cheerio';

describe('RULES_CATALOG parity (worker-safe literal vs the real registry)', () => {
  it('ids, severities, and helpUrls match builtInRuleMetadata + helpUrlFor exactly', () => {
    const meta = builtInRuleMetadata();
    expect(RULES_CATALOG).toHaveLength(meta.length);
    expect(RULES_CATALOG.map((r) => r.id)).toEqual(meta.map((m) => m.id));
    for (const r of RULES_CATALOG) {
      expect(r.defaultSeverity, r.id).toBe(meta.find((m) => m.id === r.id)?.defaultSeverity);
      expect(r.helpUrl, r.id).toBe(helpUrlFor(r.id));
    }
  });

  it('fixHints match what the rules ACTUALLY emit (instantiated over violating pages)', async () => {
    // Reuse the fixhint-gate battery approach: run every page rule over a
    // violating page set; every emitted issue's fixHint must equal the
    // catalog entry (canonical-present pinned to the missing-canonical branch).
    const rs = createRuleSet(resolveAuditConfig({}));
    const head = (title: string) => `<title>${title}</title><meta name="description" content="${'d'.repeat(60)}">`;
    const battery = [
      `<html><head>${head('')}</head><body></body></html>`, // title-missing
      `<html><head>${head('t'.repeat(80))}</head><body></body></html>`, // title-length
      `<html><head><title>T</title></head><body></body></html>`, // description-missing
      `<html><head><title>T</title><meta name="description" content="${'d'.repeat(200)}"></head><body></body></html>`, // description-length
      `<html lang><head>${head('T')}</head><body></body></html>`, // lang-attr
      `<html><head>${head('T')}</head><body><img src="/a.png"></body></html>`, // image-alt-coverage
      `<html><head>${head('T')}</head><body></body></html>`, // canonical-present (missing branch), og, hreflang
    ];
    const emitted = new Map<string, string>();
    for (const rule of rs.pageRules as readonly AuditRule[]) {
      for (const html of battery) {
        const found: Issue[] = await rule.check(loadDomPage(html, 'https://example.com/p'), {});
        for (const i of found) {
          if (!emitted.has(i.ruleId)) emitted.set(i.ruleId, i.fixHint ?? '');
        }
      }
    }
    for (const r of RULES_CATALOG) {
      const actual = emitted.get(r.id);
      if (actual !== undefined) {
        expect(actual, r.id).toBe(r.fixHint);
        continue;
      }
      // Rules the battery above does not emit get SPOT-CHECKED against the
      // catalog (the full-execution census lives in audit's fixhint-gate test,
      // which enforces a hint on every emitted issue of every built-in).
      expect(typeof r.fixHint, r.id).toBe('string');
      expect(r.fixHint.length, r.id).toBeGreaterThan(0);
    }
    // canonical-present is pinned to the MISSING-canonical branch explicitly.
    expect(RULES_CATALOG.find((r) => r.id === 'canonical-present')?.fixHint).toContain('link rel="canonical"');
  });
});

/** Minimal PageContext equivalent for driving page rules directly. */
const loadDomPage = (html: string, url: string) => ({
  url: new URL(url),
  status: 200,
  headers: new Headers({ 'content-type': 'text/html' }),
  dom: loadDom(html),
  bytes: html.length,
  timingMs: 10,
  robotsAllowed: true,
});

describe('prompts + resources (E1.5, additive)', () => {
  it('prompts/list = 3 with expected names; resources/list >= 1; tools/list STILL exactly 5', async () => {
    const client = await connectClient(fixtureDeps());
    const prompts = (await client.listPrompts()).prompts;
    expect(prompts.map((p) => p.name).sort()).toEqual(['lumen-fix-top-issues', 'lumen-keyword-brief', 'lumen-prelaunch-check']);
    const resources = (await client.listResources()).resources;
    expect(resources.length).toBeGreaterThanOrEqual(1);
    expect(resources.map((r) => r.uri)).toContain('lumen://rules');
    const tools = (await client.listTools()).tools;
    expect(new Set(tools.map((t) => t.name))).toEqual(
      new Set(['lumen_authority', 'lumen_audit_site', 'lumen_keyword_ideas', 'lumen_page_report', 'lumen_rank_check']),
    );
    expect(tools).toHaveLength(5);
    await client.close();
  });

  it('lumen://rules reads the catalog (parity with the registry)', async () => {
    const client = await connectClient(fixtureDeps());
    const res = await client.readResource({ uri: 'lumen://rules' });
    const catalog = JSON.parse((res.contents[0] as { text: string }).text ?? '[]') as { id: string }[];
    expect(catalog.map((r) => r.id)).toEqual(RULES_CATALOG.map((r) => r.id));
    await client.close();
  });

  it('a prompt returns deterministic instructions naming the existing tools', async () => {
    const client = await connectClient(fixtureDeps());
    const p = await client.getPrompt({ name: 'lumen-prelaunch-check', arguments: { url: 'https://example.com' } });
    const text = p.messages[0]?.content as { type: string; text: string };
    expect(text.text).toContain('lumen_audit_site');
    expect(text.text).toContain('https://example.com');
    await client.close();
  });

  it('history templates read entries; audit/latest returns the LATEST (newest-last store order)', async () => {
    const { MemoryHistoryStore } = await import('./testkit/index.js');
    const history = new MemoryHistoryStore();
    const clockBase = Date.parse('2026-09-01T00:00:00Z');
    await history.append({ url: 'https://example.com/', score: 11, pagesAudited: 1, incomplete: false, countsBySeverity: { error: 0, warning: 0, info: 0 }, provider: 'lumen-audit', retrievedAt: new Date(clockBase).toISOString() });
    await history.append({ url: 'https://example.com/', score: 99, pagesAudited: 1, incomplete: false, countsBySeverity: { error: 0, warning: 0, info: 0 }, provider: 'lumen-audit', retrievedAt: new Date(clockBase + 86_400_000 * 27).toISOString() });
    const client = await connectClient({ ...fixtureDeps(), history });
    const latest = await client.readResource({ uri: 'lumen://audit/latest/example.com' });
    const payload = JSON.parse((latest.contents[0] as { text: string }).text) as { score?: number };
    expect(payload.score).toBe(99); // the NEWEST append, not the first
    const rankRes = await client.readResource({ uri: 'lumen://history/rank/example.com' });
    expect(() => JSON.parse((rankRes.contents[0] as { text: string }).text)).not.toThrow();
    await client.close();
  });

  it('the Worker shape (no history) returns the typed LOCAL_ONLY payload on history reads', async () => {
    const client = await connectClient(fixtureRemoteDeps());
    const res = await client.readResource({ uri: 'lumen://audit/latest/example.com' });
    const payload = JSON.parse((res.contents[0] as { text: string }).text ?? '{}') as { code?: string; message?: string };
    expect(payload.code).toBe('LOCAL_ONLY_CAPABILITY');
    expect(payload.message).toContain('npx @lumen-seo/cli');
    // and the Worker still registers prompts + lumen://rules
    const prompts = (await client.listPrompts()).prompts;
    expect(prompts).toHaveLength(3);
    const resources = (await client.listResources()).resources;
    expect(resources.map((r) => r.uri)).toContain('lumen://rules');
    await client.close();
  });
});
