/**
 * `lumen rank --history` tests (Stage 3): history-mode admission (no
 * positional, no provider call, no writes), kind/format registries with loud
 * errors, provenance-carrying CSV, filters, and exit-code parity (0/2 only).
 * Audit-digest appends (one line per completed `lumen audit`) live here too.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditHistoryEntry, RankHistoryEntry } from '@lumen-seo/core';
import { execute as audit } from './cmd/audit.js';
import { execute as rank } from './cmd/rank.js';
import type { CommandDeps } from './composition/node.js';
import { domainDir, JsonlHistoryStore } from './history/jsonl-store.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import type { CliContext } from './run.js';
import type { AuditRunner } from '@lumen-seo/mcp/ports';

let root: string;
const AT = '2026-08-29T12:00:00Z';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumen-rank-history-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctx = (args: string[], flags: Record<string, string | boolean> = {}): CliContext => ({
  io: new MemoryIo(),
  signal: new AbortController().signal,
  positionals: args,
  flags,
});

/** serp: undefined proves --history never touches the provider. */
const deps = (clock = () => AT): CommandDeps => ({
  clock,
  failThreshold: 'error' as const,
  keywords: [],
  serp: undefined,
  authority: [],
  authorityUnconfigured: [],
  history: new JsonlHistoryStore(root),
});

const seedRank = async (d: CommandDeps): Promise<void> => {
  await d.history.append({
    keyword: 'broadfork',
    domain: 'example.com',
    position: 3,
    provider: 'ddg-serp',
    url: 'https://example.com/broadfork',
    retrievedAt: AT,
  });
  await d.history.append({
    keyword: 'spade',
    domain: 'example.com',
    position: null,
    provider: 'ddg-serp',
    retrievedAt: AT,
  });
};

const seedAudit = async (d: CommandDeps): Promise<void> => {
  await d.history.append({
    url: 'https://example.com/',
    score: 88,
    pagesAudited: 12,
    incomplete: false,
    countsBySeverity: { error: 1, warning: 2, info: 3 },
    provider: 'lumen-audit',
    retrievedAt: AT,
  });
};

describe('rank --history admission', () => {
  it('reads without a keyword, provider, or write (exit 0)', async () => {
    const d = deps();
    await seedRank(d);
    const io = new MemoryIo();
    const code = await rank({ ...ctx([], { history: true, json: true }), io }, d);
    expect(code).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as RankHistoryEntry[];
    expect(doc).toHaveLength(2);
    expect(doc[0]).toMatchObject({ keyword: 'broadfork', position: 3 });
  });

  it('positional + --history is a UsageError (exit 2, via run)', async () => {
    const io = new MemoryIo();
    expect(await run(['rank', 'broadfork', '--history'], io, deps())).toBe(2);
    expect(io.stderr.join('')).toContain('--history takes no positional');
  });

  it('--no-save + --history is a UsageError', async () => {
    const io = new MemoryIo();
    await expect(rank({ ...ctx([], { history: true, 'no-save': true }), io }, deps())).rejects.toThrow(
      /--no-save does not apply/,
    );
  });

  it('--json + --format csv is a UsageError (one shape only)', async () => {
    const io = new MemoryIo();
    await expect(rank({ ...ctx([], { history: true, json: true, format: 'csv' }), io }, deps())).rejects.toThrow(
      /pick one output shape/,
    );
  });

  it('unknown --kind/--format fail listing the valid options', async () => {
    const io = new MemoryIo();
    await expect(rank({ ...ctx([], { history: true, kind: 'nope' }), io }, deps())).rejects.toThrow(
      /--kind must be one of: rank, audit/,
    );
    await expect(rank({ ...ctx([], { history: true, format: 'xml' }), io }, deps())).rejects.toThrow(
      /--format must be one of: json, csv/,
    );
  });
});

describe('rank --history rendering', () => {
  it('csv carries the rank provenance header + rows (empty position renders empty)', async () => {
    const d = deps();
    await seedRank(d);
    const io = new MemoryIo();
    expect(await rank({ ...ctx([], { history: true, format: 'csv' }), io }, d)).toBe(0);
    const lines = io.stdout.join('').trim().split('\n');
    expect(lines[0]).toBe('keyword,domain,position,provider,url,retrievedAt');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('broadfork,example.com,3,ddg-serp,https://example.com/broadfork,');
    expect(lines[2]).toContain('spade,example.com,,ddg-serp,,');
  });

  it('--kind audit renders the audit header; default kind hides audit rows', async () => {
    const d = deps();
    await seedRank(d);
    await seedAudit(d);
    const ioDefault = new MemoryIo();
    await rank({ ...ctx([], { history: true, format: 'csv' }), io: ioDefault }, d);
    expect(ioDefault.stdout.join('')).not.toContain('lumen-audit');
    const io = new MemoryIo();
    expect(await rank({ ...ctx([], { history: true, kind: 'audit', format: 'csv' }), io }, d)).toBe(0);
    const lines = io.stdout.join('').trim().split('\n');
    expect(lines[0]).toBe('url,score,pagesAudited,countsError,countsWarning,countsInfo,incomplete,provider,retrievedAt');
    expect(lines[1]).toContain('https://example.com/,88,12,1,2,3,false,lumen-audit,');
  });

  it('csv neutralizes formula-leading cells and quotes CR (spreadsheet-safe export)', async () => {
    const d = deps();
    await d.history.append({
      keyword: '=SUM(A1:A9)',
      domain: 'example.com',
      position: 1,
      provider: 'ddg-serp',
      retrievedAt: AT,
    });
    await d.history.append({
      keyword: 'row\rbreak',
      domain: 'example.com',
      position: 2,
      provider: 'ddg-serp',
      retrievedAt: AT,
    });
    const io = new MemoryIo();
    expect(await rank({ ...ctx([], { history: true, format: 'csv' }), io }, d)).toBe(0);
    const text = io.stdout.join('');
    const lines = text.trim().split('\n');
    expect(lines[1]).toContain("'=SUM(A1:A9)");
    expect(text).toContain('"row\rbreak"'); // CR quotes the cell, never splits the row
    expect(text.split('\n')).toHaveLength(4); // header + 2 rows + trailing newline only
  });

  it('--domain/--limit filter in history mode; human shape lists rows', async () => {
    const d = deps();
    await seedRank(d);
    const io = new MemoryIo();
    expect(await rank({ ...ctx([], { history: true, domain: 'example.com', limit: '1', json: true }), io }, d)).toBe(0);
    expect(JSON.parse(io.stdout.join('')) as unknown[]).toHaveLength(1);
    const human = new MemoryIo();
    expect(await rank({ ...ctx([], { history: true }), io: human }, d)).toBe(0);
    expect(human.stdout.join('')).toContain('history (rank): 2 entries');
  });
});

describe('audit digest appends (Stage 3)', () => {
  const runner: AuditRunner = {
    run: async (input) => ({
      id: 'fixture',
      startedAt: AT,
      completedAt: AT,
      pages: [{ url: input.url.href, status: 200, issues: [], score: 90, timingMs: 5, bytes: 50, robotsAllowed: true }],
      summary: { countsBySeverity: { error: 0, warning: 1, info: 0 }, score: 90, pagesAudited: 1, pagesSkipped: 0 },
      incomplete: false,
      configSnapshot: {},
      stopReason: 'completed',
    }),
  };

  it('completed audit appends exactly one labeled digest line', async () => {
    const d: CommandDeps = { ...deps(), auditRunner: runner };
    const io = new MemoryIo();
    expect(await audit({ ...ctx(['https://example.com/']), io }, d)).toBe(0);
    const rows = await d.history.list({ kind: 'audit' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      url: 'https://example.com/',
      score: 90,
      pagesAudited: 1,
      incomplete: false,
      provider: 'lumen-audit',
    } as Partial<AuditHistoryEntry>);
    expect((rows[0] as AuditHistoryEntry).stopReason).toBeUndefined();
  });

  it('incomplete audit digest carries incomplete:true with its stop reason', async () => {
    const partial: AuditRunner = {
      run: async (input) => ({
        id: 'fixture',
        startedAt: AT,
        completedAt: AT,
        pages: [{ url: input.url.href, status: 200, issues: [], score: 40, timingMs: 5, bytes: 50, robotsAllowed: true }],
        summary: { countsBySeverity: { error: 0, warning: 0, info: 0 }, score: 40, pagesAudited: 1, pagesSkipped: 0 },
        incomplete: true,
        configSnapshot: {},
        stopReason: 'page_budget',
      }),
    };
    const d: CommandDeps = { ...deps(), auditRunner: partial };
    expect(await audit({ ...ctx(['https://example.com/']), io: new MemoryIo() }, d)).toBe(1); // incomplete gates
    const rows = await d.history.list({ kind: 'audit' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ incomplete: true, stopReason: 'page_budget' } as Partial<AuditHistoryEntry>);
  });

  it('cancelled audit writes nothing (no side effects on abort)', async () => {
    const d: CommandDeps = { ...deps(), auditRunner: runner };
    const ac = new AbortController();
    ac.abort();
    const io = new MemoryIo();
    expect(await audit({ io, signal: ac.signal, positionals: ['https://example.com/'], flags: {} }, d)).toBe(2);
    expect(await d.history.list({ kind: 'audit' })).toHaveLength(0);
    expect(await d.history.list({ kind: 'all' })).toHaveLength(0);
  });

  it('audit digest lands under <root>/audit beside <root>/rank', async () => {
    const d: CommandDeps = { ...deps(), auditRunner: runner };
    await seedRank(d);
    await audit({ ...ctx(['https://example.com/']), io: new MemoryIo() }, d);
    const text = await readFile(join(domainDir(root, 'example.com', 'audit'), 'history.jsonl'), 'utf8');
    expect(JSON.parse(text.trim()) as object).toMatchObject({ provider: 'lumen-audit' });
  });
});
