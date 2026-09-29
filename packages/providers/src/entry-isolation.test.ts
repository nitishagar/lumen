/**
 * Entry-isolation for the providers package (E2.1, validator I8): the MAIN
 * barrel and the worker-safe subpath must never reach the node-only GSC
 * provider (node:crypto/node:fs) — the existing worker graph test cannot see
 * a `node:` leak from THIS package. Walks the module graph via import
 * reflection is unavailable in vite; instead we assert by STATICALLY
 * collecting the transitive imports of the two entry sources.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Resolves a relative import inside packages/providers/src — NodeNext `.js`
 *  specifiers map back to their `.ts` sources (the pattern core's own
 *  entry-isolation test uses; without it the walk sees only the entry file). */
const resolveLocal = (from: string, spec: string): string | null => {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // external — not our graph
  const base = resolve(dirname(from), spec.replace(/\.js$/, '.ts'));
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next shape
    }
  }
  return null;
};

const IMPORT_RE = /from\s+'(\.[^']+)'/g;

const transitiveLocalImports = (entry: string, seen = new Set<string>()): Set<string> => {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const resolved = resolveLocal(entry, m[1]!);
    if (resolved !== null) transitiveLocalImports(resolved, seen);
  }
  return seen;
};

describe('providers entry isolation (E2.1: node-gsc is node-only)', () => {
  it('the main barrel graph never reaches node-gsc.ts (and the walk is real)', () => {
    const graph = transitiveLocalImports(join(HERE, 'index.ts'));
    expect(graph.size).toBeGreaterThan(5); // sanity: a real transitive walk, not the entry alone
    const offenders = [...graph].filter((p) => p.endsWith('node-gsc.ts'));
    expect(offenders, 'node-gsc reachable from the package barrel').toEqual([]);
  });

  it('the worker subpath graph never reaches node-gsc.ts (and the walk is real)', () => {
    const graph = transitiveLocalImports(join(HERE, 'worker.ts'));
    expect(graph.size).toBeGreaterThan(5); // sanity
    const offenders = [...graph].filter((p) => p.endsWith('node-gsc.ts'));
    expect(offenders, 'node-gsc reachable from the worker subpath').toEqual([]);
  });

  it('node-gsc.ts itself stays node-only (node: imports present)', () => {
    const src = readFileSync(join(HERE, 'node-gsc.ts'), 'utf8');
    expect(src).toContain("from 'node:crypto'");
    expect(src).toContain("from 'node:fs'");
  });
});
