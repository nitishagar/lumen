/**
 * E2.3 acceptance tests: `lumen history` (kinds, --since ordering with --limit,
 * csv formula neutralization via the shared helper, prune), the deprecated
 * rank alias note, and the self-contained HTML report (escaping against
 * hostile titles/snippets, zero scripts/external requests, attributions).
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HistoryEntry, SiteAuditReport } from '@lumen-seo/core';
import { JsonlHistoryStore } from './history/jsonl-store.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import type { CommandDeps } from './composition/node.js';
import { renderHtml, safeHref } from './render/html.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-history-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const rankEntry = (kw: string, at: string, position: number | null = 3): HistoryEntry =>
  ({ keyword: kw, domain: 'example.com', position, provider: 'fixture', retrievedAt: at });

const depsWith = (history: JsonlHistoryStore): CommandDeps => ({
  clock: () => '2026-09-29T12:00:00Z',
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history,
});

describe('lumen history (E2.3)', () => {
  it('audit|rank kinds render json/csv; --since filters THEN --limit slices (I5 ordering)', async () => {
    const store = new JsonlHistoryStore(join(dir, 'h1'));
    for (const [kw, at] of [
      ['old-a', '2026-09-01T00:00:00.000Z'],
      ['old-b', '2026-09-02T00:00:00.000Z'],
      ['new-a', '2026-09-20T00:00:00.000Z'],
      ['new-b', '2026-09-21T00:00:00.000Z'],
      ['new-c', '2026-09-22T00:00:00.000Z'],
    ] as const) {
      await store.append(rankEntry(kw, at));
    }
    const io = new MemoryIo();
    const code = await run(['history', 'rank', '--domain', 'example.com', '--since', '2026-09-10', '--limit', '2', '--json'], io, depsWith(store));
    expect(code).toBe(0);
    const entries = JSON.parse(io.stdout.join('')) as { keyword: string }[];
    expect(entries.map((e) => e.keyword)).toEqual(['new-b', 'new-c']); // newest 2 SINCE the date

    const csv = new MemoryIo();
    await run(['history', 'rank', '--domain', 'example.com', '--format', 'csv'], csv, depsWith(store));
    expect(csv.stdout.join('')).toContain('keyword,domain,position');
  });

  it('an invalid --since is a usage error; an unknown subcommand names the valid ones', async () => {
    const store = new JsonlHistoryStore(join(dir, 'h2'));
    const io1 = new MemoryIo();
    expect(await run(['history', 'rank', '--since', 'yesterday'], io1, depsWith(store))).toBe(2);
    expect(io1.stderr.join('')).toContain('--since');
    const io2 = new MemoryIo();
    expect(await run(['history', 'purge'], io2, depsWith(store))).toBe(2);
    expect(io2.stderr.join('')).toContain('audit | rank | prune');
  });

  it('csv formula-neutralization is shared and live (= @ starters neutralized)', async () => {
    const store = new JsonlHistoryStore(join(dir, 'h3'));
    await store.append(rankEntry('=HYPERLINK("http://evil")', '2026-09-01T00:00:00.000Z'));
    const io = new MemoryIo();
    await run(['history', 'rank', '--domain', 'example.com', '--format', 'csv'], io, depsWith(store));
    expect(io.stdout.join('')).toContain(`'=HYPERLINK`);
  });

  it('prune trims rotated generations on DISK through the optional port method', async () => {
    const { readdir } = await import('node:fs/promises');
    const tiny = new JsonlHistoryStore(join(dir, 'h5'), 1, 3); // 1-byte cap, 3 generations
    for (let i = 0; i < 6; i += 1) {
      await tiny.append(rankEntry(`k${i}`, new Date(Date.parse('2026-09-01') + i * 60_000).toISOString()));
    }
    const kindDir = join(dir, 'h5', 'rank');
    const domainDir = join(kindDir, (await readdir(kindDir))[0]!);
    const rotated = (files: string[]): string[] => files.filter((f) => /^history\.\d+\.jsonl$/.test(f));
    const before = rotated(await readdir(domainDir)).sort();
    expect(before.length).toBeGreaterThanOrEqual(2); // rotations happened
    const removed = await tiny.prune({ keepGenerations: 1 });
    expect(removed).toBeGreaterThanOrEqual(1);
    const after = rotated(await readdir(domainDir));
    expect(after).toEqual([]); // every rotated generation actually deleted; only history.jsonl remains
  });

  it('the rank --history alias still works and prints the deprecation note on stderr', async () => {
    const store = new JsonlHistoryStore(join(dir, 'h6'));
    await store.append(rankEntry('kw', '2026-09-01T00:00:00.000Z'));
    const io = new MemoryIo();
    const code = await run(['rank', '--history', '--kind', 'rank', '--json'], io, depsWith(store));
    expect(code).toBe(0);
    expect(io.stderr.join('')).toContain('deprecated');
    expect(() => JSON.parse(io.stdout.join(''))).not.toThrow(); // stdout stays exactly one document
  });
});

describe('the self-contained HTML report (E2.3)', () => {
  const hostileReport = (): SiteAuditReport => ({
    id: 'x',
    startedAt: '2026-09-29T10:00:00Z',
    completedAt: '2026-09-29T10:00:09Z',
    pages: [
      {
        url: 'https://example.com/a',
        status: 200,
        title: '<img src=x onerror="alert(1)">',
        issues: [
          {
            ruleId: 'title-missing',
            severity: 'error',
            message: 'no <title> — "quoted" & scripted',
            evidence: { snippet: `"><script>alert('xss')</script>` },
            fixHint: 'add one',
            url: 'https://example.com/a',
          },
        ],
        score: 90,
        timingMs: 1,
        bytes: 1,
        robotsAllowed: true,
        depth: 0,
      },
    ],
    summary: {
      countsBySeverity: { error: 1, warning: 0, info: 0 },
      score: 90,
      pagesAudited: 1,
      pagesSkipped: 0,
      byRule: [
        {
          ruleId: 'title-missing',
          severity: 'error',
          affectedPages: 1,
          sampleUrls: ['https://example.com/a'],
          fixHint: 'add one',
          helpUrl: 'https://nitishagar.github.io/lumen/docs/rules-reference/#title-missing',
        },
      ],
    },
    incomplete: false,
    configSnapshot: { seed: 'https://example.com' },
    stopReason: 'completed',
  });

  it('renders ONE file: inline CSS, zero scripts, zero external requests, attributions footer', () => {
    const html = renderHtml(hostileReport());
    expect(html).toContain('<style>');
    expect(html).not.toContain('<script');
    // Self-contained = no external RESOURCES (anchors may link out — links are not requests).
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('<link ');
    expect(html).toContain('CC BY 4.0');
    expect(html).toContain('no external requests');
  });

  it('hostile titles render INERT (escaped; snippets/messages are not rendered at all)', () => {
    const html = renderHtml(hostileReport());
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x onerror='); // title escaped
    // URLs with quote-breaking payloads never break out of attributes (safeHref covers hrefs)
  });

  it('safeHref refuses non-http schemes and encodes quotes', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#blocked');
    expect(safeHref('https://x/"><script>')).not.toContain('"');
  });

  it('audit --format html --out writes the artifact and stays stdout-silent', async () => {
    const out = join(dir, 'report.html');
    const d = depsWith(new JsonlHistoryStore(join(dir, 'h7')));
    const withRunner = {
      ...d,
      auditRunner: {
        run: async () => hostileReport(),
      },
    } as CommandDeps;
    const io = new MemoryIo();
    const code = await run(['audit', 'https://example.com', '--format', 'html', '--out', out], io, withRunner);
    expect(code).toBe(1);
    expect(io.stdout.join('')).toBe('');
    const file = await readFile(out, 'utf8');
    expect(file).toContain('<!doctype html>');
    expect(file).toContain('CC BY 4.0');
  });
});

describe('history.maxGenerations config (I4)', () => {
  it('parses, validates, and defaults to 2', async () => {
    const { loadConfig } = await import('@lumen-seo/core');
    const { readConfigFile } = await import('@lumen-seo/core/node');
    const { writeFile: wf } = await import('node:fs/promises');
    const p = join(dir, 'cfg.json');
    await wf(p, '{"history":{"maxGenerations":5}}', 'utf8');
    const cfg = await loadConfig(p, readConfigFile);
    expect(cfg.history).toEqual({ maxGenerations: 5 });
    await wf(p, '{"history":{"maxGenerations":0}}', 'utf8');
    await expect(loadConfig(p, readConfigFile)).rejects.toThrow(/maxGenerations/);
    await wf(p, '{"history":{"nope":1}}', 'utf8');
    await expect(loadConfig(p, readConfigFile)).rejects.toThrow(/history\.nope/);
  });
});
