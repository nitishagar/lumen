/**
 * Baseline + diff engine tests (PRD E1.3): the adopt-flow AC, fingerprint
 * stability across copy edits, and the P-Honesty `fixed`/`unknown` split —
 * a page NOT audited this run is never claimed fixed (validator C1).
 */
import { describe, expect, it } from 'vitest';
import { runSiteAudit } from './run.js';
import { FakeFetcher } from './testing/fake-fetcher.js';
import type { FakeRoute } from './testing/fake-fetcher.js';
import { makeTestDeps } from './testing/deps.js';
import { buildBaseline, diffAgainstBaseline, diffReports } from './baseline.js';

const ORIGIN = 'https://example.com';

const page = (body: string, head = '<title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page.">'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body><h1>H</h1>${body}</body></html>`;

const site = (homeBody: string, extra: Record<string, FakeRoute> = {}): Record<string, FakeRoute> => ({
  [`${ORIGIN}/robots.txt`]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\n' },
  [`${ORIGIN}/`]: { status: 200, contentType: 'text/html', body: homeBody },
  ...extra,
});

const audit = async (routes: Record<string, FakeRoute>, maxPages?: number) =>
  runSiteAudit(new URL(ORIGIN), maxPages === undefined ? {} : { crawl: { maxPages } }, makeTestDeps(new FakeFetcher(routes)));

describe('buildBaseline', () => {
  it('produces a versioned, sorted, deduped {fp,url} entry list', async () => {
    const routes = site(page('<img src="/a.png">')); // one alt warning
    const report = await audit(routes);
    const baseline = buildBaseline(report, '2026-09-28T12:00:00Z');
    expect(baseline.version).toBe(1);
    expect(baseline.seed).toBe(`${ORIGIN}/`);
    expect(baseline.entries.length).toBeGreaterThan(0);
    const keys = baseline.entries.map((e) => `${e.fp}\n${e.url}`);
    expect(new Set(keys).size).toBe(keys.length); // deduped
    expect([...keys].sort()).toEqual(keys); // sorted
    expect(baseline.entries.every((e) => e.url.startsWith('https://example.com'))).toBe(true);
  });
});

describe('the adopt-flow AC (PRD E1.3)', () => {
  it('v1 → baseline → v2 (adds 1 error, fixes 1 warning): new=1, fixed=1; gate-able', async () => {
    // v1: one warning (missing viewport), no error
    const v1 = await audit(site(page('<p>fine</p>', '<title>Ample page title length</title><meta name="description" content="An adequately long meta description for the page.">')));
    const baseline = buildBaseline(v1, '2026-09-28T12:00:00Z');
    expect(v1.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'viewport-meta')).toBe(true);

    // v2: viewport FIXED (added), one NEW error introduced (missing title)
    const v2 = await audit(site(page('<p>fine</p>', '<meta name="description" content="An adequately long meta description for the page."><meta name="viewport" content="width=device-width, initial-scale=1">')));
    const diff = diffAgainstBaseline(v2, baseline);
    const newIds = diff.newIssues.map((i) => i.ruleId);
    expect(newIds).toContain('title-missing'); // the added error
    expect(newIds).not.toContain('viewport-meta');
    // the viewport-meta finding is the fixed one
    const v2Fps = new Set(v2.pages.flatMap((p) => p.issues).map((i) => i.ruleId));
    expect(v2Fps.has('viewport-meta')).toBe(false); // really fixed in v2
    const baselineRuleIds = v1.pages.flatMap((p) => p.issues).map((i) => i.ruleId);
    expect(baselineRuleIds).toContain('viewport-meta');
    expect(diff.fixed.length).toBe(1); // the viewport finding is gone
    expect(diff.unknown).toEqual([]); // every page audited both runs
  });

  it('renaming a title\'s TEXT on an existing issue does not create a new one (message-free fingerprints)', async () => {
    const longHeadA = '<title>Ample page title length that is quite long indeed, well beyond the configured maximum</title><meta name="description" content="An adequately long meta description for the page.">';
    const longHeadB = '<title>A completely different wording that is also far too long for any page title at all</title><meta name="description" content="An adequately long meta description for the page.">';
    const v1 = await audit(site(page('<p>x</p>', longHeadA)));
    expect(v1.pages.flatMap((p) => p.issues).some((i) => i.ruleId === 'title-length')).toBe(true);
    const baseline = buildBaseline(v1, '2026-09-28T12:00:00Z');
    const v2 = await audit(site(page('<p>x</p>', longHeadB)));
    const diff = diffAgainstBaseline(v2, baseline);
    expect(diff.newIssues.filter((i) => i.ruleId === 'title-length')).toEqual([]); // same fingerprint
    expect(diff.existingCount).toBeGreaterThan(0);
  });
});

describe('P-Honesty: fixed vs unknown (validator C1)', () => {
  it('a page-budget-limited run puts not-audited baseline pages in unknown, never fixed', async () => {
    const extra: Record<string, FakeRoute> = {};
    for (let n = 1; n <= 5; n += 1) {
      extra[`${ORIGIN}/p${n}`] = { status: 200, contentType: 'text/html', body: page('<p>x</p>') };
    }
    const full = await audit(site(page('<a href="/p1">1</a><a href="/p2">2</a><a href="/p3">3</a><a href="/p4">4</a><a href="/p5">5</a>'), extra));
    expect(full.summary.pagesAudited).toBeGreaterThan(3);
    const baseline = buildBaseline(full, '2026-09-28T12:00:00Z');

    // A capped run audits fewer pages: those pages' findings are UNKNOWN.
    const capped = await audit(
      site(page('<a href="/p1">1</a><a href="/p2">2</a><a href="/p3">3</a><a href="/p4">4</a><a href="/p5">5</a>'), extra),
      2,
    );
    const diff = diffAgainstBaseline(capped, baseline);
    expect(diff.unknown.length).toBeGreaterThan(0); // not-audited baseline entries
    // every fixed entry's page was audited in the capped run
    const auditedUrls = new Set(capped.pages.filter((p) => p.skipped === undefined).map((p) => p.url));
    for (const e of diff.fixed) {
      expect(auditedUrls.has(e.url), `fixed entry url not audited: ${e.url}`).toBe(true);
    }
  });
});

describe('diffReports (lumen diff)', () => {
  it('same breakdown + score delta; new issues in b gate (exit-1 semantics)', async () => {
    const a = await audit(site(page('<p>ok</p>')));
    const b = await audit(site(page('<img src="/no-alt.png">'))); // adds alt warning
    const diff = diffReports(a, b);
    expect(diff.newIssues.map((i) => i.ruleId)).toContain('image-alt-coverage');
    expect(diff.scoreDelta).not.toBeNull();
    if (diff.scoreDelta !== null) expect(diff.scoreDelta).toBeLessThan(0);
  });

  it('honest across differently-sized runs: a-page not in b → unknown, not fixed', async () => {
    const a = await audit(site(page('<a href="/only-a">only</a>'), { [`${ORIGIN}/only-a`]: { status: 200, contentType: 'text/html', body: page('<p>only in a</p>') } }));
    const b = await audit(site(page('<p>b</p>')));
    const diff = diffReports(a, b);
    expect(diff.unknown.some((e) => e.url === `${ORIGIN}/only-a`)).toBe(true);
    expect(diff.fixed.some((e) => e.url === `${ORIGIN}/only-a`)).toBe(false);
  });
});

describe('skipped pages are unknown, never fixed (reviewer I1)', () => {
  it('a robots-skipped page\'s baseline findings land in unknown', async () => {
    // v1: two pages, each with a finding.
    const extra: Record<string, FakeRoute> = {
      [`${ORIGIN}/hidden`]: { status: 200, contentType: 'text/html', body: page('<p>h</p>', '<title>x</title>') }, // short title → title-length warning
    };
    const v1 = await audit(site(page('<a href="/hidden">h</a>'), extra));
    const hiddenIssues = v1.pages.find((p) => p.url === `${ORIGIN}/hidden`)?.issues ?? [];
    expect(hiddenIssues.length).toBeGreaterThan(0);
    const baseline = buildBaseline(v1, '2026-09-28T12:00:00Z');

    // v2: robots.txt now disallows /hidden → the page is SKIPPED (never fetched).
    const v2Routes: Record<string, FakeRoute> = {
      ...site(page('<a href="/hidden">h</a>'), extra),
      [`${ORIGIN}/robots.txt`]: { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /hidden\n' },
    };
    const v2 = await audit(v2Routes);
    expect(v2.pages.find((p) => p.url === `${ORIGIN}/hidden`)?.skipped).toEqual({ reason: 'robots_disallowed' });
    const diff = diffAgainstBaseline(v2, baseline);
    const hiddenEntryUrls = baseline.entries.filter((e) => e.url === `${ORIGIN}/hidden`).map((e) => e.fp);
    expect(hiddenEntryUrls.length).toBeGreaterThan(0);
    for (const fp of hiddenEntryUrls) {
      expect(diff.fixed.some((e) => e.fp === fp), `${fp} wrongly claimed fixed`).toBe(false);
      expect(diff.unknown.some((e) => e.fp === fp), `${fp} should be unknown`).toBe(true);
    }
  });
});
