import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Main-entry import-graph guard (I6 / SC-8 / SC-16): everything reachable
 * from src/index.ts must be Workers-safe — no `node:` specifiers, no
 * `./node.ts`, and cheerio only as a type-only import (BA-12).
 */
const srcDir = fileURLToPath(new URL('.', import.meta.url));

const importSpecifiers = (source: string): string[] => {
  const specifiers: string[] = [];
  const patterns = [
    /import\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
    /export\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const m of source.matchAll(pattern)) specifiers.push(m[1]!);
  }
  return specifiers;
};

const resolveLocal = (fromFile: string, spec: string): string => {
  const base = resolve(dirname(fromFile), spec);
  // Source-graph scan: NodeNext '.js' specifiers map to their '.ts' siblings.
  return base.endsWith('.js') ? base.replace(/\.js$/, '.ts') : base;
};

const collectGraph = async (entry: string): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    const source = await readFile(file, 'utf8');
    files.set(file, source);
    for (const spec of importSpecifiers(source)) {
      if (!spec.startsWith('.')) continue;
      const local = resolveLocal(file, spec);
      if (!files.has(local)) queue.push(local);
    }
  }
  return files;
};

describe('main entry isolation (I6 / BA-11)', () => {
  it('the src/index.ts import graph contains no node: specifiers and never reaches node.ts', async () => {
    const graph = await collectGraph(join(srcDir, 'index.ts'));
    expect(graph.size).toBeGreaterThan(5); // sanity: the scan actually walked the graph
    const offenders: string[] = [];
    for (const [file, source] of graph) {
      for (const spec of importSpecifiers(source)) {
        if (spec.startsWith('node:')) offenders.push(`${file}: ${spec}`);
        if (/\/node(\.ts|\.js)?$/.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
    expect([...graph.keys()].some((f) => f.endsWith('node.ts'))).toBe(false);
  });

  it('cheerio appears only as a type-only import in the graph (BA-12)', async () => {
    const graph = await collectGraph(join(srcDir, 'index.ts'));
    const cheerioLines: string[] = [];
    for (const source of graph.values()) {
      for (const line of source.split('\n')) {
        if (line.includes("from 'cheerio'")) cheerioLines.push(line.trim());
      }
    }
    expect(cheerioLines.length).toBeGreaterThan(0); // PageContext.dom is cheerio-typed
    for (const line of cheerioLines) expect(line.startsWith('import type')).toBe(true);
  });

  it('the Node surface is reachable only via the @lumen-seo/core/node subpath (src/node.ts)', async () => {
    const entry = await readFile(join(srcDir, 'index.ts'), 'utf8');
    expect(entry).not.toContain('./node'); // main barrel never re-exports the Node surface
    const nodeSource = await readFile(join(srcDir, 'node.ts'), 'utf8');
    expect(nodeSource).toContain('node:'); // ...and the Node surface actually uses Node built-ins
  });
});
