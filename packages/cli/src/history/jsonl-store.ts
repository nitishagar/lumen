/**
 * JsonlHistoryStore (E4/B4/B5/B6/R9) — the surfaces implementation of core's
 * LOCKED `HistoryStore { append, list }` over `HistoryEntry` (SC-15, Stage 3
 * kinds: `rank` + `audit`).
 *
 * - one file per domain: `<root>/rank/<slug>-<sha256:8>/history.jsonl`;
 *   audit digests live beside it at `<root>/audit/<slug>-<sha256:8>/history.jsonl`
 *   (rank paths are byte-identical before/after kinds — `domainDir` defaults
 *   `kind='rank'` so every pre-kinds caller resolves the legacy path);
 * - each line is EXACTLY one HistoryEntry (found is derived, never stored);
 * - append-only, one small O_APPEND write per entry (cross-process safety, B6);
 * - size-triggered rotation (default 1 MiB) per kind file: current file
 *   renamed to the literal `history.1.jsonl` (single generation, oldest
 *   rotated copy overwritten — inherited per kind, documented) BEFORE the
 *   append that would exceed the cap;
 * - reads tolerate and skip a truncated/malformed final line (crash safety);
 * - appends are serialized through an in-process promise queue (E13);
 * - `list()` with no kind reads `rank` only (every pre-kinds caller keeps its
 *   exact behavior); `kind: 'audit'` reads audit digests; `kind: 'all'`
 *   merges both sorted by retrievedAt.
 */
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry, HistoryListQuery, HistoryStore } from '@lumen-seo/core';
import { ConfigError, isRankEntry } from '@lumen-seo/core';
import { normalizeDomain } from '../domain.js';

export const DEFAULT_MAX_HISTORY_BYTES = 1_048_576; // 1 MiB (B4)
const HISTORY_FILE = 'history.jsonl';
const ROTATED_FILE = 'history.1.jsonl'; // literal name, single generation (R9)

/** Storage subdir per kind (`rank` keeps the legacy unprefixed layout). */
export const kindDir = (root: string, kind: 'rank' | 'audit'): string => join(root, kind);

export const domainDir = (root: string, domain: string, kind: 'rank' | 'audit' = 'rank'): string => {
  let ascii: string;
  try {
    ascii = normalizeDomain(domain);
  } catch (e) {
    throw new ConfigError([{ path: 'history', message: (e as Error).message }]); // I15
  }
  const slug =
    ascii.replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'domain';
  const hash8 = createHash('sha256').update(ascii).digest('hex').slice(0, 8);
  return join(kindDir(root, kind), `${slug}-${hash8}`);
};

/** Audit digests group by the audited URL's hostname (one dir per domain). */
const auditDirFor = (root: string, url: string): string => {
  let host = 'unknown';
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable URL — grouped, never dropped.
  }
  return domainDir(root, host === '' ? 'unknown' : host, 'audit');
};

const sizeOf = async (file: string): Promise<number> => {
  try {
    return (await stat(file)).size;
  } catch {
    return 0; // ENOENT -> empty
  }
};

const isCounts = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.error === 'number' && typeof c.warning === 'number' && typeof c.info === 'number';
};

const isRankShape = (v: Record<string, unknown>): boolean =>
  typeof v.keyword === 'string' &&
  typeof v.domain === 'string' &&
  (v.position === null || typeof v.position === 'number') &&
  typeof v.provider === 'string' &&
  (v.url === undefined || typeof v.url === 'string') &&
  typeof v.retrievedAt === 'string';

const isAuditShape = (v: Record<string, unknown>): boolean =>
  v.keyword === undefined &&
  typeof v.url === 'string' &&
  typeof v.score === 'number' &&
  typeof v.pagesAudited === 'number' &&
  typeof v.incomplete === 'boolean' &&
  isCounts(v.countsBySeverity) &&
  v.provider === 'lumen-audit' &&
  typeof v.retrievedAt === 'string';

const isEntry = (v: unknown): v is HistoryEntry => {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return isRankShape(e) || isAuditShape(e);
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
  append(e: HistoryEntry): Promise<void> {
    const task = this.#queue.then(() => this.#append(e));
    this.#queue = task.catch(() => undefined); // queue never wedges on failure
    return task;
  }

  async list(q?: HistoryListQuery): Promise<HistoryEntry[]> {
    const kind = q?.kind ?? 'rank';
    if (kind === 'all') {
      const [rank, audit] = await Promise.all([
        this.#listKind('rank', q),
        this.#listKind('audit', q),
      ]);
      const merged = [...rank, ...audit].sort((a, b) => (a.retrievedAt < b.retrievedAt ? -1 : 1));
      return q?.limit === undefined ? merged : merged.slice(-q.limit);
    }
    return this.#listKind(kind, q);
  }

  async #listKind(kind: 'rank' | 'audit', q?: HistoryListQuery): Promise<HistoryEntry[]> {
    let entries: HistoryEntry[];
    if (q?.domain === undefined && (kind !== 'audit' || q?.url === undefined)) {
      entries = await this.#listAllDomains(kind);
    } else if (q?.domain !== undefined) {
      const dir = domainDir(this.#root, q.domain, kind);
      entries = (await this.#readGeneration(join(dir, ROTATED_FILE))).concat(
        await this.#readGeneration(join(dir, HISTORY_FILE)),
      );
    } else {
      // Audit-by-URL without a domain: fan out, then match the exact URL.
      entries = await this.#listAllDomains(kind);
    }
    if (q?.keyword !== undefined) {
      // Audit digests carry no keyword — the filter naturally excludes them.
      entries = entries.filter((e) => isRankEntry(e) && e.keyword === q.keyword);
    }
    if (q?.domain !== undefined && kind === 'rank') {
      entries = entries.filter((e) => isRankEntry(e) && e.domain === q.domain);
    }
    // Audit reads are dir-scoped by domain already; both shapes match on url.
    if (q?.url !== undefined) entries = entries.filter((e) => e.url === q.url);
    return q?.limit === undefined ? entries : entries.slice(-q.limit);
  }

  async #append(e: HistoryEntry): Promise<void> {
    const dir = isRankEntry(e) ? domainDir(this.#root, e.domain) : auditDirFor(this.#root, e.url);
    await mkdir(dir, { recursive: true });
    const file = join(dir, HISTORY_FILE);
    if ((await sizeOf(file)) >= this.#maxBytes) {
      await rename(file, join(dir, ROTATED_FILE)).catch(() => undefined); // .1 overwritten (R9)
    }
    await appendFile(file, `${JSON.stringify(e)}\n`, 'utf8');
  }

  /** Parses one generation file; a malformed/truncated FINAL line is skipped. */
  async #readGeneration(file: string): Promise<HistoryEntry[]> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return []; // missing generation
    }
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const out: HistoryEntry[] = [];
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

  async #listAllDomains(kind: 'rank' | 'audit'): Promise<HistoryEntry[]> {
    const { readdir } = await import('node:fs/promises');
    let entries: Dirent[];
    try {
      entries = await readdir(kindDir(this.#root, kind), { withFileTypes: true });
    } catch {
      return [];
    }
    const all: HistoryEntry[] = [];
    for (const d of entries) {
      if (!d.isDirectory()) continue;
      const dir = join(kindDir(this.#root, kind), d.name);
      all.push(...(await this.#readGeneration(join(dir, ROTATED_FILE))));
      all.push(...(await this.#readGeneration(join(dir, HISTORY_FILE))));
    }
    return all.sort((a, b) => (a.retrievedAt < b.retrievedAt ? -1 : 1));
  }
}
