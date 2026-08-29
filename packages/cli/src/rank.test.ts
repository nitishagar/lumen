import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RankHistoryEntry, SerpResult } from '@lumen-seo/core';
import { LumenError } from '@lumen-seo/core';
import { execute as rank } from './cmd/rank.js';
import type { CommandDeps } from './composition/node.js';
import { domainDir, JsonlHistoryStore } from './history/jsonl-store.js';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import type { CliContext } from './run.js';

let root: string;
const AT = '2026-08-29T12:00:00Z';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumen-rank-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const fixtureSerp = (o: {
  hitDomain?: string;
  position?: number;
  fail?: boolean;
} = {}) => ({
  name: 'fixture-serp',
  search: async (_q: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SerpResult[]> => {
    if (opts.signal?.aborted) throw new LumenError('aborted', 'fixture-serp');
    if (o.fail) throw new LumenError('upstream 429 (fixture)', 'fixture-serp');
    const n = opts.limit ?? 20;
    const results: SerpResult[] = Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      url: `https://other${i}.example/page`,
      title: `Result ${i + 1}`,
    }));
    if (o.hitDomain !== undefined && o.position !== undefined && o.position !== null) {
      results[o.position - 1] = {
        position: o.position,
        url: `https://${o.hitDomain}/target`,
        title: 'The hit',
      };
    }
    return results;
  },
});

const ctx = (args: string[], flags: Record<string, string | boolean> = {}): CliContext => ({
  io: new MemoryIo(),
  signal: new AbortController().signal,
  positionals: args,
  flags,
});

const deps = (serp: ReturnType<typeof fixtureSerp> | undefined, clock = () => AT): CommandDeps => ({
  clock,
  failThreshold: 'error' as const,
  keywords: [],
  serp,
  authority: [],
  authorityUnconfigured: [],
  history: new JsonlHistoryStore(root),
});

describe('rank command (B11/E4/E14/I3/I17)', () => {
  it('finds the domain, exits 0, and appends exactly one history line', async () => {
    const io = new MemoryIo();
    const d = deps(fixtureSerp({ hitDomain: 'example.com', position: 3 }));
    const code = await rank(
      { ...ctx(['best cms'], { domain: 'example.com', json: true }), io },
      d,
    );
    expect(code).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as {
      found: boolean;
      position: number;
      matchedUrl: string;
      provider: string;
      retrievedAt: string;
    };
    expect(doc).toMatchObject({
      keyword: 'best cms',
      domain: 'example.com',
      found: true,
      position: 3,
      matchedUrl: 'https://example.com/target',
      provider: 'fixture-serp',
      retrievedAt: AT,
    });
    const line = await readFile(join(domainDir(root, 'example.com'), 'history.jsonl'), 'utf8');
    const stored = JSON.parse(line) as RankHistoryEntry;
    expect(stored).toEqual({
      keyword: 'best cms',
      domain: 'example.com',
      position: 3,
      provider: 'fixture-serp',
      url: 'https://example.com/target',
      retrievedAt: AT,
    });
  });

  it('matches subdomains of the target domain', async () => {
    const d = deps(fixtureSerp({ hitDomain: 'docs.example.com', position: 2 }));
    const io = new MemoryIo();
    await rank({ ...ctx(['kw'], { domain: 'example.com', json: true }), io }, d);
    const doc = JSON.parse(io.stdout.join('')) as { found: boolean };
    expect(doc.found).toBe(true);
  });

  it('not-found is success: found:false, position:null, exit 0 (B11)', async () => {
    const io = new MemoryIo();
    const d = deps(fixtureSerp());
    const code = await rank({ ...ctx(['kw'], { domain: 'example.com', json: true }), io }, d);
    expect(code).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as { found: boolean; position: null; matchedUrl?: string };
    expect(doc.found).toBe(false);
    expect(doc.position).toBeNull();
    expect(doc.matchedUrl).toBeUndefined();
  });

  it('history line stores position:null and omits url when not found', async () => {
    const d = deps(fixtureSerp());
    await rank(ctx(['kw'], { domain: 'example.com' }), d);
    const stored = JSON.parse(
      await readFile(join(domainDir(root, 'example.com'), 'history.jsonl'), 'utf8'),
    ) as RankHistoryEntry;
    expect(stored.position).toBeNull();
    expect(stored.url).toBeUndefined();
    expect(Object.hasOwn(stored, 'found')).toBe(false);
  });

  it('--no-save writes nothing', async () => {
    const d = deps(fixtureSerp({ hitDomain: 'example.com', position: 1 }));
    const code = await rank(ctx(['kw'], { domain: 'example.com', 'no-save': true }), d);
    expect(code).toBe(0);
    await expect(
      readFile(join(domainDir(root, 'example.com'), 'history.jsonl'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('provider failure means NO history append and exit 2 with the provider name (E14/I17)', async () => {
    const io = new MemoryIo();
    const code = await run(
      ['rank', 'kw', '--domain', 'example.com'],
      io,
      deps(fixtureSerp({ fail: true })),
    );
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('fixture-serp');
    await expect(
      readFile(join(domainDir(root, 'example.com'), 'history.jsonl'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('no serp provider configured exits 2 with an actionable message', async () => {
    const io = new MemoryIo();
    const code = await run(['rank', 'kw', '--domain', 'example.com'], io, deps(undefined));
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('no serp provider configured');
  });

  it('usage validation: missing --domain, bad domain, bad keyword, bad limit', async () => {
    const d = deps(fixtureSerp());
    await expect(rank(ctx(['kw'], {}), d)).rejects.toThrow(/--domain/);
    await expect(rank(ctx(['kw'], { domain: 'https://x' }), d)).rejects.toThrow(/invalid domain/);
    await expect(rank(ctx([''], { domain: 'example.com' }), d)).rejects.toThrow(/keyword/);
    await expect(rank(ctx(['x'.repeat(121)], { domain: 'example.com' }), d)).rejects.toThrow(/120/);
    await expect(
      rank(ctx(['kw'], { domain: 'example.com', limit: '51' }), d),
    ).rejects.toThrow(/between 1 and 50/);
  });

  it('human mode renders sanitized position output', async () => {
    const io = new MemoryIo();
    const d = deps(fixtureSerp({ hitDomain: 'example.com', position: 4 }));
    await rank({ ...ctx(['kw'], { domain: 'example.com' }), io }, d);
    const text = io.stdout.join('');
    expect(text).toContain('position: 4');
    expect(text).toContain('fixture-serp');
    // eslint-disable-next-line no-control-regex -- asserting absence of escapes
    expect(text).not.toMatch(/\x1b/);
  });
});
