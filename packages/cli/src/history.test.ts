import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryStore, RankHistoryEntry } from '@lumen-seo/core';
import { ConfigError } from '@lumen-seo/core';
import { domainDir, JsonlHistoryStore } from './history/jsonl-store.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumen-history-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const entry = (i: number, domain = 'example.com'): RankHistoryEntry => ({
  keyword: `kw-${i}`,
  domain,
  position: i,
  provider: 'fixture-serp',
  url: `https://${domain}/page-${i}`,
  retrievedAt: `2026-08-29T10:00:${String(i).padStart(2, '0')}Z`,
});

describe('JsonlHistoryStore (E4/B4/B5/B6/R9)', () => {
  it('implements core HistoryStore exactly (compile-level conformance, SC-15)', () => {
    const store: HistoryStore = new JsonlHistoryStore(root);
    expect(typeof store.append).toBe('function');
    expect(typeof store.list).toBe('function');
  });

  it('writes one RankHistoryEntry per line — no extra stored fields', async () => {
    const store = new JsonlHistoryStore(root);
    await store.append(entry(1));
    const dir = domainDir(root, 'example.com');
    const text = await readFile(join(dir, 'history.jsonl'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'domain',
      'keyword',
      'position',
      'provider',
      'retrievedAt',
      'url',
    ]);
    expect(parsed.found).toBeUndefined(); // derived, never stored (E4)
  });

  it('omits the optional url key when there is no hit', async () => {
    const store = new JsonlHistoryStore(root);
    await store.append({ ...entry(2), position: null, url: undefined });
    const text = await readFile(join(domainDir(root, 'example.com'), 'history.jsonl'), 'utf8');
    expect(JSON.parse(text)).not.toHaveProperty('url');
    expect(JSON.parse(text)).toMatchObject({ position: null });
  });

  it('rotates at the byte cap to the literal history.1.jsonl and overwrites .1 on the second rotation', async () => {
    // Cap = exactly two lines, derived from the real serialized sizes, so the
    // sequence is deterministic regardless of exact byte counts.
    const lineLen = (i: number): number => `${JSON.stringify(entry(i))}\n`.length;
    const store = new JsonlHistoryStore(root, lineLen(1) + lineLen(2));
    const dir = domainDir(root, 'example.com');

    await store.append(entry(1));
    await store.append(entry(2));
    await store.append(entry(3)); // file (2 lines) >= cap -> rotate, then append 3
    const rotated = (await readFile(join(dir, 'history.1.jsonl'), 'utf8')).trim().split('\n');
    expect(rotated.map((l) => (JSON.parse(l) as RankHistoryEntry).keyword)).toEqual(['kw-1', 'kw-2']);
    const current = (await readFile(join(dir, 'history.jsonl'), 'utf8')).trim().split('\n');
    expect(current.map((l) => (JSON.parse(l) as RankHistoryEntry).keyword)).toEqual(['kw-3']);

    await store.append(entry(4)); // current [3,4] — back at the cap
    await store.append(entry(5)); // second rotation overwrites the .1 generation
    await store.append(entry(6));
    const rotated2 = (await readFile(join(dir, 'history.1.jsonl'), 'utf8')).trim().split('\n');
    expect(rotated2.map((l) => (JSON.parse(l) as RankHistoryEntry).keyword)).toEqual(['kw-3', 'kw-4']);
    const current2 = (await readFile(join(dir, 'history.jsonl'), 'utf8')).trim().split('\n');
    expect(current2.map((l) => (JSON.parse(l) as RankHistoryEntry).keyword)).toEqual(['kw-5', 'kw-6']);
    const files = await readdir(dir);
    expect(files.filter((f) => f.startsWith('history')).sort()).toEqual([
      'history.1.jsonl',
      'history.jsonl',
    ]);
  });

  it('list reads newest-last across both generations', async () => {
    const lineLen = (i: number): number => `${JSON.stringify(entry(i))}\n`.length;
    const store = new JsonlHistoryStore(root, lineLen(1) + lineLen(2));
    for (let i = 1; i <= 6; i += 1) await store.append(entry(i));
    const all = await store.list({ domain: 'example.com' });
    expect(all.map((e) => e.keyword)).toEqual(['kw-3', 'kw-4', 'kw-5', 'kw-6']);
    const tail = await store.list({ domain: 'example.com', limit: 1 });
    expect(tail.map((e) => e.keyword)).toEqual(['kw-6']);
  });

  it('filters by keyword and domain', async () => {
    const store = new JsonlHistoryStore(root);
    await store.append({ ...entry(1), keyword: 'alpha' });
    await store.append({ ...entry(2), keyword: 'beta' });
    await store.append({ ...entry(3), domain: 'other.example', keyword: 'alpha' });
    const alpha = await store.list({ keyword: 'alpha' });
    expect(alpha).toHaveLength(2);
    const scoped = await store.list({ domain: 'other.example' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.keyword).toBe('alpha');
  });

  it('skips a truncated/malformed trailing line (crash tolerance)', async () => {
    const store = new JsonlHistoryStore(root);
    await store.append(entry(1));
    const file = join(domainDir(root, 'example.com'), 'history.jsonl');
    await writeFile(
      file,
      `${JSON.stringify(entry(9))}\n{"keyword":"half",` // crash mid-write
      ,
      'utf8',
    );
    const list = await store.list({ domain: 'example.com' });
    expect(list.map((e) => e.keyword)).toEqual(['kw-9']); // truncated line gone
  });

  it('serializes 25 concurrent appends into 25 intact well-formed lines', async () => {
    const store = new JsonlHistoryStore(root);
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.append(entry(i))));
    const text = await readFile(join(domainDir(root, 'example.com'), 'history.jsonl'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(25);
    const keywords = new Set(lines.map((l) => (JSON.parse(l) as RankHistoryEntry).keyword));
    expect(keywords.size).toBe(25);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('list with no query reads across all domains, sorted by retrievedAt', async () => {
    const store = new JsonlHistoryStore(root);
    await store.append({ ...entry(5, 'b.example'), retrievedAt: '2026-08-29T10:00:05Z' });
    await store.append({ ...entry(1, 'a.example'), retrievedAt: '2026-08-29T10:00:01Z' });
    const all = await store.list();
    expect(all.map((e) => e.domain)).toEqual(['a.example', 'b.example']);
  });
});

describe('domainDir path safety (I13/B5)', () => {
  it('maps IDN to punycode + deterministic slug-hash dirname', () => {
    const d1 = domainDir(root, 'münchen.de');
    const d2 = domainDir(root, 'xn--mnchen-3ya.de');
    expect(d1).toBe(d2);
    const name = d1.split('/').pop() as string;
    const expectedHash = createHash('sha256').update('xn--mnchen-3ya.de').digest('hex').slice(0, 8);
    expect(name).toBe(`xn--mnchen-3ya.de-${expectedHash}`);
    expect(name).toMatch(/^[a-z0-9.-]+$/); // path-safe
  });

  it('slugifies hostile-but-parseable domains deterministically and caps length', () => {
    const weird = `${'a'.repeat(200)}_!!!`;
    const d = domainDir(root, weird.toLowerCase());
    const name = d.split('/').pop() as string;
    expect(name.length).toBeLessThanOrEqual(80 + 1 + 8); // 80-char slug cap + '-' + hash8
    expect(name).toMatch(/^[a-z0-9.-]*-[0-9a-f]{8}$/);
    expect(domainDir(root, weird.toLowerCase())).toBe(d); // deterministic
  });

  it('rejects invalid domains with a typed error (I15)', () => {
    expect(() => domainDir(root, 'https://example.com')).toThrow(ConfigError);
    expect(() => domainDir(root, 'example.com:8080')).toThrow(ConfigError);
    expect(() => domainDir(root, '')).toThrow(ConfigError);
    expect(() => domainDir(root, 'a b.example')).toThrow(ConfigError);
  });
});

describe('25 concurrent rank invocations (E13/E14, Phase 6)', () => {
  it('25 interleaved `rank` runs leave exactly 25 intact, well-formed history lines', async () => {
    const { run } = await import('./run.js');
    const { MemoryIo } = await import('./io.js');
    const { fixtureSerpProvider } = await import('@lumen-seo/mcp/testkit');
    const { MemoryHistoryStore } = await import('@lumen-seo/mcp/testkit');
    void MemoryHistoryStore; // the runs write through the real JsonlHistoryStore
    const at = '2026-08-29T12:00:00Z';

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => {
        const io = new MemoryIo();
        const deps = {
          clock: (): string => at,
          failThreshold: 'error' as const,
          keywords: [],
          serp: fixtureSerpProvider({ hitDomain: 'example.com', position: 3 }),
          authority: [],
          authorityUnconfigured: [],
          history: new JsonlHistoryStore(root), // cross-instance: O_APPEND per line (B6)
        };
        return run(['rank', `kw-${i}`, '--domain', 'example.com', '--json'], io, deps).then((code) => ({
          code,
          io,
          kw: `kw-${i}`,
        }));
      }),
    );

    for (const r of results) expect(r.code).toBe(0);
    const dir = domainDir(root, 'example.com');
    const file = join(dir, 'history.jsonl');
    const raw = await readFile(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBe(25); // every append landed, none torn or lost
    const keywords = new Set<string>();
    for (const line of lines) {
      const e = JSON.parse(line) as RankHistoryEntry;
      expect(Object.keys(e).sort()).toEqual(
        ['domain', 'keyword', 'position', 'provider', 'retrievedAt', 'url'].sort(),
      );
      expect(e.provider).toBe('fixture-serp');
      expect(e.position).toBe(3);
      keywords.add(e.keyword);
    }
    expect(keywords.size).toBe(25); // every invocation's distinct line survived
  });
});
