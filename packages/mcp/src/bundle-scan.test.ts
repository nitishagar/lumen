/**
 * Bundle-scan test (E10/I6): the Worker module graph must never contain
 * cheerio (HTML parsing is Node-side only) or the audit engine (crawling is
 * local-only). Parses the esbuild metafile emitted by `build:worker` —
 * which `npm test -w @lumen-seo/mcp` chains BEFORE this suite runs. This is
 * the surfaces-level guard alongside the providers aspect's TC-REG-5 test
 * (which guarantees `createWorkerSafeProviders` never loads cheerio post-rebase).
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BANNED_FRAGMENTS = ['cheerio', '@lumen-seo/audit', 'packages/audit/'] as const;

const metafileUrl = new URL('../dist/metafile.json', import.meta.url);

describe('worker bundle scan (E10/I6)', () => {
  it('dist/metafile.json exists (run npm run build:worker -w @lumen-seo/mcp first)', () => {
    expect(existsSync(metafileUrl)).toBe(true);
  });

  it('Worker module graph contains no cheerio and no audit engine', () => {
    if (!existsSync(metafileUrl)) {
      throw new Error('no dist/metafile.json — run: npm run build:worker -w @lumen-seo/mcp');
    }
    const meta = JSON.parse(readFileSync(metafileUrl, 'utf8')) as { inputs: Record<string, unknown> };
    const inputs = Object.keys(meta.inputs);
    expect(inputs.length).toBeGreaterThan(10); // a real graph, not an empty build
    for (const fragment of BANNED_FRAGMENTS) {
      const offenders = inputs.filter((k) => k.toLowerCase().includes(fragment.toLowerCase()));
      expect(offenders, `banned module fragment "${fragment}" found in the Worker graph`).toEqual([]);
    }
  });

  it('the emitted entry bundle itself never names the banned modules', () => {
    const bundleUrl = new URL('../dist/index.js', import.meta.url);
    if (!existsSync(bundleUrl)) {
      throw new Error('no dist/index.js — run: npm run build:worker -w @lumen-seo/mcp');
    }
    const source = readFileSync(bundleUrl, 'utf8');
    expect(source).not.toMatch(/cheerio/i);
    expect(source).not.toMatch(/@lumen-seo\/audit/);
  });

  it('no Worker SOURCE references the private-target opt-in (E1.1 FR-3/D3)', async () => {
    // Source-level (dist identifiers are minified away) and DIRECTORY-scoped:
    // private-scope.ts legitimately enters the worker graph via the core
    // barrel — only Worker sources may not USE the policy.
    const { readdir } = await import('node:fs/promises');
    const workerDir = new URL('../worker/', import.meta.url);
    const files: string[] = [];
    const walk = async (dir: URL): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(new URL(`${e.name}/`, dir));
        else if (e.name.endsWith('.ts')) files.push(new URL(e.name, dir).pathname);
      }
    };
    await walk(workerDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} references the private-target opt-in`).not.toMatch(/createPrivateScopePolicy|allowPrivate/);
    }
  });
});
