/**
 * Renderer + source-map tests (E1.4): SARIF structure field-by-field, md
 * sections, and the best-effort mapping matrix (0/1/2 candidates — ambiguity
 * stays URL-only, never guessed).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { BaselineDiff } from '@lumen-seo/audit';
import { buildBaseline, diffAgainstBaseline } from '@lumen-seo/audit';
import type { Issue, SiteAuditReport } from '@lumen-seo/core';
import { renderSarif } from './render/sarif.js';
import { renderMarkdown } from './render/markdown.js';
import { buildRouteFileMap, globToRegExp } from './render/source-map.js';

const report = (issues: Issue[], over: Partial<SiteAuditReport> = {}): SiteAuditReport => ({
  id: 'test',
  startedAt: '2026-09-28T10:00:00Z',
  completedAt: '2026-09-28T10:00:05Z',
  pages: [
    { url: 'https://example.com/about', status: 200, issues, score: 80, timingMs: 10, bytes: 100, robotsAllowed: true, depth: 0 },
  ],
  summary: {
    countsBySeverity: { error: issues.filter((i) => i.severity === 'error').length, warning: issues.filter((i) => i.severity === 'warning').length, info: issues.filter((i) => i.severity === 'info').length },
    score: 80,
    pagesAudited: 1,
    pagesSkipped: 0,
    byRule: Object.entries(
      issues.reduce<Record<string, { severities: Issue['severity'][]; urls: Set<string> }>>((m, i) => {
        const g = m[i.ruleId] ?? { severities: [], urls: new Set<string>() };
        g.severities.push(i.severity);
        g.urls.add(i.url ?? '');
        m[i.ruleId] = g;
        return m;
      }, {}),
    ).map(([ruleId, g]) => ({
      ruleId,
      severity: g.severities.includes('error') ? 'error' : g.severities.includes('warning') ? 'warning' : 'info',
      affectedPages: g.urls.size,
      sampleUrls: [...g.urls],
      fixHint: 'fixture fix',
      helpUrl: `https://nitishagar.github.io/lumen/docs/rules-reference/#${ruleId}`,
    })),
  },
  incomplete: false,
  configSnapshot: { seed: 'https://example.com', target: { scope: 'public' }, crawl: { maxPages: 100 } },
  stopReason: 'completed',
  ...over,
});

const issue = (ruleId: string, severity: Issue['severity']): Issue => ({
  ruleId,
  severity,
  message: 'fixture finding',
  evidence: { selector: 'head title' },
  url: 'https://example.com/about',
  fixHint: 'fixture fix',
  helpUrl: 'https://nitishagar.github.io/lumen/docs/rules-reference/#' + ruleId,
});

describe('renderSarif', () => {
  it('emits 2.1.0 with all catalog rules, one result per issue, level mapping, provenance in run.properties', () => {
    const doc = JSON.parse(renderSarif(report([issue('title-missing', 'error'), issue('og-tags-missing', 'info')])));
    expect(doc.$schema).toContain('sarif-schema-2.1.0.json');
    expect(doc.version).toBe('2.1.0');
    const run = doc.runs[0] as unknown as {
      tool: { driver: { name: string; informationUri: string; rules: { id: string; helpUri?: string; help?: { text: string } }[] } };
      results: { ruleId: string; level: string; locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[];
      properties: Record<string, unknown>;
    };
    void run;
    expect(run.tool.driver.name).toBe('lumen');
    expect(run.tool.driver.informationUri).toContain('nitishagar.github.io/lumen');
    expect(run.tool.driver.rules).toHaveLength(36); // ALL built-ins (plugin ids would append)
    const byId = new Map(run.tool.driver.rules.map((r) => [r.id, r]));
    expect(byId.get('title-missing')?.helpUri).toContain('#title-missing');
    expect(byId.get('title-missing')?.help?.text).toContain('<title>');
    expect(run.results).toHaveLength(2);
    expect(run.results[0]).toMatchObject({ ruleId: 'title-missing', level: 'error' });
    expect(run.results[1]).toMatchObject({ ruleId: 'og-tags-missing', level: 'note' }); // info → note
    expect(run.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe('https://example.com/about');
    expect(run.properties).toMatchObject({
      seed: 'https://example.com',
      targetScope: 'public',
      pagesAudited: 1,
      incomplete: false,
      startedAt: '2026-09-28T10:00:00Z',
      completedAt: '2026-09-28T10:00:05Z',
    });
    expect((run.properties.crawl as { maxPages: number }).maxPages).toBe(100);
  });

  it('plugin rule ids present in results append plugin rules without helpUri', () => {
    const doc = JSON.parse(renderSarif(report([issue('my-plugin-rule', 'warning')])));
    const ids = doc.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ids).toContain('my-plugin-rule');
    expect(ids).toHaveLength(37);
    const plugin = doc.runs[0].tool.driver.rules.find((r: { id: string }) => r.id === 'my-plugin-rule');
    expect(plugin.helpUri).toBeUndefined();
  });

  it('baseline counts ride in run.properties.baseline when provided', () => {
    const r = report([issue('title-missing', 'error')]);
    const baseline = buildBaseline(report([]), '2026-09-28T09:00:00Z');
    const diff: BaselineDiff = diffAgainstBaseline(r, baseline);
    const doc = JSON.parse(renderSarif(r, { baseline: diff }));
    expect(doc.runs[0].properties.baseline).toMatchObject({ newIssues: 1, existingCount: 0 });
  });
});

describe('renderMarkdown', () => {
  it('score/pages/counts + top-rules table with fix + helpUrl anchor', () => {
    const md = renderMarkdown(report([issue('title-missing', 'error'), issue('og-tags-missing', 'info')]));
    expect(md).toContain('## lumen audit');
    expect(md).toContain('**score:** 80/100');
    expect(md).toContain('### top rules');
    expect(md).toContain('`title-missing`](https://nitishagar.github.io/lumen/docs/rules-reference/#title-missing)');
    expect(md).toContain('fixture fix'); // the group's fixHint (from the issue)
  });

  it('baselined: new/fixed/unknown counts + new-findings table; incomplete warning line', () => {
    const r = report([issue('title-missing', 'error')], { incomplete: true, stopReason: 'time_budget' });
    const baseline = buildBaseline(report([]), 't');
    const md = renderMarkdown(r, { baseline: { path: 'bl.json', diff: diffAgainstBaseline(r, baseline) } });
    expect(md).toContain('### baseline (`bl.json`)');
    expect(md).toContain('**new:** 1');
    expect(md).toContain('| `title-missing` |');
    expect(md).toContain('incomplete run');
  });
});

describe('source-map', () => {
  let dir: string;
  const setup = (files: Record<string, string>): string => {
    dir = mkdtempSync(join(tmpdir(), 'lumen-smap-'));
    for (const [f, body] of Object.entries(files)) {
      const p = join(dir, f);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, body, 'utf8');
    }
    return dir;
  };
  afterAll(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('exact / suffixed / indexed candidates resolve; ambiguity stays URL-only', () => {
    const root = setup({
      'src/pages/about.astro': 'a',
      'src/pages/blog/index.astro': 'b',
      'src/pages/dupe.html': 'c',
      'src/pages/dupe.md': 'd', // ambiguous: dupe matches two extensions
    });
    const map = buildRouteFileMap('src/pages/**', root);
    expect(map('https://example.com/about')).toBe('src/pages/about.astro');
    expect(map('https://example.com/blog')).toBe('src/pages/blog/index.astro');
    expect(map('https://example.com/dupe')).toBeUndefined(); // 2 candidates → URL-only
    expect(map('https://example.com/nowhere')).toBeUndefined(); // 0 candidates
  });

  it('the site root maps to an index file inside the glob', () => {
    const root = setup({ 'src/pages/index.astro': 'i' });
    const map = buildRouteFileMap('src/pages/**', root);
    expect(map('https://example.com/')).toBe('src/pages/index.astro');
  });

  it('glob translator supports ** and * segments', () => {
    expect(globToRegExp('src/**/*.astro').test('src/pages/deep/a.astro')).toBe(true);
    expect(globToRegExp('src/**/*.astro').test('src/a.astro')).toBe(true); // ** also matches zero segments
    expect(globToRegExp('src/*.astro').test('src/pages/a.astro')).toBe(false); // * stops at /
    expect(globToRegExp('src/pages/*').test('src/pages/about.astro')).toBe(true);
  });
});
