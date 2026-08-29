/**
 * JsonlHistoryStore (E4/B4/B5/B6/R9) — the surfaces implementation of core's
 * LOCKED `HistoryStore { append, list }` over `RankHistoryEntry` (SC-15).
 *
 * - one file per domain: `<root>/rank/<slug>-<sha256:8>/history.jsonl`;
 * - each line is EXACTLY a RankHistoryEntry (found is derived, never stored);
 * - append-only, one small O_APPEND write per entry (cross-process safety, B6);
 * - size-triggered rotation (default 1 MiB): current file renamed to the
 *   literal `history.1.jsonl` (single generation, oldest rotated copy
 *   overwritten) BEFORE the append that would exceed the cap;
 * - reads tolerate and skip a truncated/malformed final line (crash safety);
 * - appends are serialized through an in-process promise queue (E13).
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryListQuery, HistoryStore, RankHistoryEntry } from '@lumen-seo/core';
import { ConfigError } from '@lumen-seo/core';
import { normalizeDomain } from '../domain.js';

export const DEFAULT_MAX_HISTORY_BYTES = 1_048_576; // 1 MiB (B4)
const HISTORY_FILE = 'history.jsonl';
const ROTATED_FILE = 'history.1.jsonl'; // literal name, single generation (R9)

export const domainDir = (root: string, domain: string): string => {
  let ascii: string;
  try {
    ascii = normalizeDomain(domain);
  } catch (e) {
    throw new ConfigError([{ path: 'history', message: (e as Error).message }]); // I15
  }
  const slug =
    ascii.replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'domain';
  const hash8 = createHash('sha256').update(ascii).digest('hex').slice(0, 8);
  return join(root, 'rank', `${slug}-${hash8}`);
};

const sizeOf = async (file: string): Promise<number> => {
  try {
    return (await stat(file)).size;
  } catch {
    return 0; // ENOENT -> empty
  }
};

const isEntry = (v: unknown): v is RankHistoryEntry => {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.keyword === 'string' &&
    typeof e.domain === 'string' &&
    (e.position === null || typeof e.position === 'number') &&
    typeof e.provider === 'string' &&
    (e.url === undefined || typeof e.url === 'string') &&
    typeof e.retrievedAt === 'string'
  );
};

export class JsonlHistoryStore implements HistoryStore {
  readonly #root: string;
  readonly #maxBytes: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(root: string, maxBytes: number = DEFAULT_MAX_HISTORY_BYTES) {
    this.#root = root;
    this.#maxBytes = maxBytes;
  }

  /** Serialized append (E13): rotation check + one O_APPEND write per entry. */
  append(e: RankHistoryEntry): Promise<void> {
    const task = this.#queue.then(() => this.#append(e));
    this.#queue = task.catch(() => undefined); // queue never wedges on failure
    return task;
  }

  async list(q?: HistoryListQuery): Promise<RankHistoryEntry[]> {
    const dir = q?.domain === undefined ? undefined : domainDir(this.#root, q.domain);
    const generations =
      dir === undefined
        ? await this.#listAllDomains()
        : (await this.#readGeneration(join(dir, ROTATED_FILE))).concat(
            await this.#readGeneration(join(dir, HISTORY_FILE)),
          );
    let entries = generations;
    if (q?.keyword !== undefined) entries = entries.filter((e) => e.keyword === q.keyword);
    if (q?.domain !== undefined) entries = entries.filter((e) => e.domain === q.domain);
    return q?.limit === undefined ? entries : entries.slice(-q.limit);
  }

  async #append(e: RankHistoryEntry): Promise<void> {
    const dir = domainDir(this.#root, e.domain);
    await mkdir(dir, { recursive: true });
    const file = join(dir, HISTORY_FILE);
    if ((await sizeOf(file)) >= this.#maxBytes) {
      await rename(file, join(dir, ROTATED_FILE)).catch(() => undefined); // .1 overwritten (R9)
    }
    await appendFile(file, `${JSON.stringify(e)}\n`, 'utf8');
  }

  /** Parses one generation file; a malformed/truncated FINAL line is skipped. */
  async #readGeneration(file: string): Promise<RankHistoryEntry[]> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return []; // missing generation
    }
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const out: RankHistoryEntry[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        if (i === lines.length - 1) continue; // truncated trailing write (E4)
        continue; // defensive: skip any malformed line rather than fail the read
      }
      if (isEntry(parsed)) out.push(parsed);
    }
    return out;
  }

  async #listAllDomains(): Promise<RankHistoryEntry[]> {
    const { readdir } = await import('node:fs/promises');
    let entries: Dirent[];
    try {
      entries = await readdir(join(this.#root, 'rank'), { withFileTypes: true });
    } catch {
      return [];
    }
    const all: RankHistoryEntry[] = [];
    for (const d of entries) {
      if (!d.isDirectory()) continue;
      const dir = join(this.#root, 'rank', d.name);
      all.push(...(await this.#readGeneration(join(dir, ROTATED_FILE))));
      all.push(...(await this.#readGeneration(join(dir, HISTORY_FILE))));
    }
    return all.sort((a, b) => (a.retrievedAt < b.retrievedAt ? -1 : 1));
  }
}
