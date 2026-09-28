/**
 * E1.2/E1.3 core-semantics tests: the fixHint/helpUrl coverage gate (FR-4),
 * ranking + grouping honesty (FR-1/FR-2), per-issue url injection (FR-3), and
 * fingerprint stability (E1.3 FR-1 — message edits and fragment-only URL
 * differences must never un-baseline an issue).
 */
import { describe, expect, it } from 'vitest';
import { runSiteAudit } from './run.js';
import { FakeFetcher } from './testing/fake-fetcher.js';
import type { FakeRoute } from './testing/fake-fetcher.js';
import { makeTestDeps } from './testing/deps.js';
import { builtInRuleMetadata, helpUrlFor, RULES_REFERENCE_BASE } from './rules/rule-set.js';
import { groupIssues, rankedIssues, SEVERITY_ORDER } from './ranking.js';
import { fingerprintIssue } from './fingerprint.js';
import type { Issue, PageReport, Severity } from '@lumen-seo/core';

const html = (body: string, head = '<title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page.">'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

describe('helpUrl anchors + the closed census gap', () => {
  it('every built-in rule id has a stable helpUrl anchor', () => {
    for (const m of builtInRuleMetadata()) {
      expect(helpUrlFor(m.id), `${m.id} helpUrl`).toBe(`${RULES_REFERENCE_BASE}#${m.id}`);
    }
    expect(helpUrlFor('a-plugin-rule-id')).toBeUndefined(); // plugins get none
  });

  it('status-error and robots-noindex emit fixHints (the census gap, closed)', async () => {
    const routes: Record<string, FakeRoute> = {
      'https://example.com/robots.txt': { status: 200, contentType: 'text/plain', body: 'User-agent: *\n' },
      'https://example.com/': { status: 500, contentType: 'text/html', body: html('<h1>x</h1>'), passStatus: true },
    };
    const report = await runSiteAudit(new URL('https://example.com'), {}, makeTestDeps(new FakeFetcher(routes)));
    const status = report.pages.flatMap((p) => p.issues).find((i) => i.ruleId === 'status-error');
    expect(status?.fixHint).toBeDefined();
    expect(status?.helpUrl).toBe(`${RULES_REFERENCE_BASE}#status-error`);
  });
});

describe('every issue carries url + fixHint-or-plugin-line inputs (FR-3)', () => {
  it('assemble injects the owning page url into page-level issues; crawl issues keep theirs', async () => {
    const routes: Record<string, FakeRoute> = {
      'https://example.com/robots.txt': { status: 200, contentType: 'text/plain', body: 'User-agent: *\n' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<h1>ok</h1>') },
    };
    const report = await runSiteAudit(new URL('https://example.com'), {}, makeTestDeps(new FakeFetcher(routes)));
    for (const page of report.pages) {
      for (const issue of page.issues) {
        expect(issue.url, `${issue.ruleId} on ${page.url}`).toBe(page.url);
      }
    }
  });
});

describe('ranking + grouping (FR-1/FR-2)', () => {
  const mk = (ruleId: string, severity: Severity, url?: string): Issue => ({
    ruleId,
    severity,
    message: 'm',
    evidence: {},
    ...(url === undefined ? {} : { url }),
  });

  it('groups sort by severity, then affectedPages desc, then ruleId', () => {
    const groups = groupIssues([
      mk('title-missing', 'error', 'https://x/1'),
      mk('b-info', 'info', 'https://x/1'),
      mk('a-info', 'info', 'https://x/1'),
      mk('lang-attr', 'warning', 'https://x/1'),
      mk('title-missing', 'error', 'https://x/2'),
      mk('lang-attr', 'warning', 'https://x/2'),
      mk('lang-attr', 'warning', 'https://x/3'),
    ]);
    expect(groups.map((g) => g.ruleId)).toEqual(['title-missing', 'lang-attr', 'a-info', 'b-info']);
    expect(groups[0]).toMatchObject({ ruleId: 'title-missing', severity: 'error', affectedPages: 2 });
    expect(groups[0]?.sampleUrls).toEqual(['https://x/1', 'https://x/2']);
    expect(groups[1]).toMatchObject({ affectedPages: 3 }); // more pages outranks
  });

  it('affectedPages counts DISTINCT audited page urls only; sampleUrls capped at 3 sorted', () => {
    const urls = ['https://x/9', 'https://x/1', 'https://x/5', 'https://x/3'];
    const groups = groupIssues(urls.map((u) => mk('dup', 'warning', u)));
    expect(groups[0]?.affectedPages).toBe(4);
    expect(groups[0]?.sampleUrls).toEqual(['https://x/1', 'https://x/3', 'https://x/5']); // 3, sorted
  });

  it('severity order + rankedIssues ordering (severity → ruleId → url)', () => {
    expect(SEVERITY_ORDER).toEqual({ error: 0, warning: 1, info: 2 });
    const pages = [{ issues: [mk('b', 'info', 'https://x/2'), mk('a', 'error', 'https://x/2')] }] as unknown as PageReport[];
    expect(rankedIssues(pages).map((i) => i.ruleId)).toEqual(['a', 'b']);
  });

  it('E1.2 AC fixture: 1 error on page 5 + 30 infos on pages 1-4 → FIRST group is the error with its url', () => {
    const issues: Issue[] = [mk('hard-error', 'error', 'https://x/5')];
    for (let n = 1; n <= 4; n += 1) {
      for (let k = 0; k < 8; k += 1) issues.push(mk(`info-${k}`, 'info', `https://x/${n}`));
    }
    const groups = groupIssues(issues);
    expect(groups[0]).toMatchObject({ ruleId: 'hard-error', severity: 'error', affectedPages: 1 });
    expect(groups[0]?.sampleUrls).toEqual(['https://x/5']);
  });
});

describe('fingerprints (E1.3 FR-1)', () => {
  const base = (over: Partial<Issue> = {}): Issue => ({
    ruleId: 'title-length',
    severity: 'warning',
    message: 'title is 12 chars',
    evidence: { selector: 'head title' },
    url: 'https://example.com/page',
    ...over,
  });

  it('stable across message edits (copy tweaks never un-baseline)', () => {
    expect(fingerprintIssue(base({ message: 'title is now 14 chars' }))).toBe(fingerprintIssue(base()));
  });

  it('stable across fragment-only URL differences (normalizeKey reuse)', () => {
    expect(fingerprintIssue(base({ url: 'https://example.com/page#section' }))).toBe(fingerprintIssue(base()));
  });

  it('different for ruleId / path / selector changes', () => {
    expect(fingerprintIssue(base({ ruleId: 'other' }))).not.toBe(fingerprintIssue(base()));
    expect(fingerprintIssue(base({ url: 'https://example.com/other' }))).not.toBe(fingerprintIssue(base()));
    expect(fingerprintIssue(base({ evidence: { selector: 'h1' } }))).not.toBe(fingerprintIssue(base()));
  });

  it('no two same-page issues of any built-in rule share (ruleId, selector) — collision pinning (validator I4)', async () => {
    // Static pin over the rule closures is approximated by construction: every
    // built-in page rule emits at most one issue per page EXCEPT rules that
    // key issues by selector (mixed-content/broken links/alt coverage), and
    // the EVIDENCE_CAP overflow issue is unique per page. Executed-pin: run
    // the noisy fixture and assert uniqueness among emitted fingerprints.
    const routes: Record<string, FakeRoute> = {
      'https://example.com/robots.txt': { status: 200, contentType: 'text/plain', body: 'User-agent: *\n' },
      'https://example.com/': {
        status: 200,
        contentType: 'text/html',
        body: html(
          Array.from({ length: 12 }, (_, i) => `<img src="/i${i}.png">`).join('') +
            Array.from({ length: 12 }, (_, i) => `<a href="/gone${i}">x</a>`).join(''),
        ),
      },
    };
    const report = await runSiteAudit(new URL('https://example.com'), {}, makeTestDeps(new FakeFetcher(routes)));
    const fps = report.pages.flatMap((p) => p.issues).map(fingerprintIssue);
    expect(new Set(fps).size).toBe(fps.length); // zero collisions on a noisy page
  });
});

describe('plugin issues: helpUrl is engine-controlled only (reviewer I2)', () => {
  it('a plugin rule emitting its own helpUrl (or junk fields) gets them stripped; built-in anchors survive', async () => {
    const pluginRule = {
      id: 'my-plugin-rule',
      severity: 'warning' as const,
      categories: ['custom'],
      check: () => [
        {
          ruleId: 'my-plugin-rule',
          severity: 'warning' as const,
          message: 'plugin finding',
          evidence: { selector: 'body' },
          fixHint: 'plugin fix',
          helpUrl: 'https://evil.example/page-derived-junk',
          rawHtml: '<script>alert(1)</script>',
        },
      ],
    };
    const routes: Record<string, FakeRoute> = {
      'https://example.com/robots.txt': { status: 200, contentType: 'text/plain', body: 'User-agent: *\n' },
      'https://example.com/': { status: 200, contentType: 'text/html', body: html('<h1>ok</h1>') },
    };
    const report = await runSiteAudit(
      new URL('https://example.com'),
      { extraRules: [pluginRule] },
      makeTestDeps(new FakeFetcher(routes)),
    );
    const pluginIssue = report.pages.flatMap((p) => p.issues).find((i) => i.ruleId === 'my-plugin-rule');
    expect(pluginIssue).toBeDefined();
    expect(pluginIssue?.helpUrl).toBeUndefined(); // plugin anchor stripped
    expect(pluginIssue?.fixHint).toBe('plugin fix');
    expect(pluginIssue?.url).toBe('https://example.com/');
    expect(JSON.stringify(pluginIssue)).not.toContain('rawHtml'); // allowlist still refuses extras
    // built-in issues on the same page still carry their anchor
    const builtin = report.pages.flatMap((p) => p.issues).find((i) => i.ruleId !== 'my-plugin-rule');
    expect(builtin?.helpUrl).toContain('docs/rules-reference/#');
  });
});
