import { expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * I12 source gate: production sources contain ZERO direct `fetch(` calls —
 * all HTTP flows through the injected core Fetcher. Test doubles
 * (`*.test.ts`, `testing.ts`) are excluded because implementing the Fetcher
 * interface requires a method literally named `fetch` (the doubles never
 * call the global).
 */
const srcDir = fileURLToPath(new URL('.', import.meta.url));

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
};

it('providers never call global fetch directly (all HTTP via injected Fetcher, I12)', async () => {
  const all = await walk(srcDir);
  const production = all.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('testing.ts'));
  expect(production.length).toBeGreaterThan(10); // sanity: the scan found the package
  const offenders: string[] = [];
  for (const file of production) {
    const source = await readFile(file, 'utf8');
    if (/(^|[^.\w])fetch\s*\(/.test(source)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

it('test doubles also avoid the global (their fetch( occurrences are interface methods only)', async () => {
  const source = await readFile(join(srcDir, 'testing.ts'), 'utf8');
  expect(source).not.toContain('globalThis.fetch');
  expect(source).not.toMatch(/(^|[^.\w])await\s+fetch\s*\(/);
});
