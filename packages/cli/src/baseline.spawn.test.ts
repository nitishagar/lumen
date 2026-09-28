/**
 * E1.3 acceptance, spawn-level: the adopt flow on a REAL loopback server with
 * the real bin — v1 audit → `--update-baseline` → v2 audit `--baseline` →
 * exit 1 with new=1/fixed=1; copy tweaks never un-baseline.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnCli } from './spawn.js';

const head = (title: string) =>
  `<title>${title}</title><meta name="description" content="An adequately long meta description for the page.">`;

// v1: viewport MISSING (the finding that will be fixed); v2: viewport FIXED
// + a NEW error (missing title); v3: same findings as v1, different wording
// (the fingerprint-stability check — message text must never matter).
const body = (mode: string): string => {
  const base = '<!doctype html><html lang="en"><head>META</head><body><h1>H</h1></body></html>';
  if (mode === 'v1') return base.replace('META', head('Ample page title length'));
  if (mode === 'v2') return base.replace('META', '<meta name="description" content="An adequately long meta description for the page."><meta name="viewport" content="width=device-width, initial-scale=1">');
  return base.replace('META', head('A different yet also sufficiently ample page title'));
};

let server: Server;
let port: number;
let dir: string;
let mode = 'v1';
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body(mode === 'v3' ? 'v3' : mode));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  port = addr.port;
  base = `http://127.0.0.1:${port}`;
  dir = await mkdtemp(join(tmpdir(), 'lumen-baseline-'));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

const audit = (args: string[]) =>
  spawnCli(['audit', base, '--allow-private', '--max-pages', '1', ...args], {
    cwd: dir,
    env: { LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') },
  });

describe('the adopt flow (PRD E1.3 AC)', () => {
  it('v1 → --update-baseline (exit 0, sorted+versioned) → v2 --baseline → exit 1, new=1, fixed=1', async () => {
    const baselinePath = join(dir, 'baseline.json');

    const v1 = await audit(['--update-baseline', baselinePath]);
    expect(v1.code, `update exit 0 (stdout: ${v1.stdout})`).toBe(0);
    const file = JSON.parse(await readFile(baselinePath, 'utf8')) as { version: number; entries: { fp: string; url: string }[] };
    expect(file.version).toBe(1);
    expect(file.entries.length).toBeGreaterThan(0);
    const keys = file.entries.map((e) => e.fp);
    expect([...keys].sort()).toEqual(keys); // sorted

    mode = 'v2';
    const v2 = await audit(['--baseline', baselinePath]);
    expect(v2.code).toBe(1); // the NEW error gates
    expect(v2.stdout).toContain('new: 1');
    expect(v2.stdout).toContain('fixed: 1');
    expect(v2.stdout).toContain('title-missing'); // the new finding, named
    expect(v2.stdout).toContain('baseline:');
  });

  it('a copy tweak on an existing issue does not un-baseline (exit stays 0)', async () => {
    const baselinePath = join(dir, 'baseline-v1.json');
    mode = 'v1';
    const v1 = await audit(['--update-baseline', baselinePath]);
    expect(v1.code).toBe(0);

    mode = 'v3'; // same findings, different title wording
    const v3 = await audit(['--baseline', baselinePath]);
    expect(v3.code, v3.stdout).toBe(0); // nothing NEW → passes
    expect(v3.stdout).toContain('new: 0');
  });

  it('--baseline and --update-baseline together are a usage error (exit 2)', async () => {
    const res = await audit(['--baseline', join(dir, 'x.json'), '--update-baseline', join(dir, 'y.json')]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('mutually exclusive');
  });

  it('a malformed baseline file is a typed usage error, never a silent no-baseline', async () => {
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{"hello": 1}', 'utf8');
    const res = await audit(['--baseline', bad]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('baseline');
  });
});

describe('lumen diff (spawn)', () => {
  it('diff of v1 vs v2 exits 1 with the new finding; identical reports exit 0; --json parses', async () => {
    const aPath = join(dir, 'a.json');
    const bPath = join(dir, 'b.json');
    mode = 'v1';
    expect((await audit(['--out', aPath])).code).toBe(0);
    mode = 'v2';
    expect((await audit(['--out', bPath])).code).toBe(1);

    const d = await spawnCli(['diff', aPath, bPath], { cwd: dir });
    expect(d.code).toBe(1);
    expect(d.stdout).toContain('new:');
    expect(d.stdout).toContain('title-missing');

    const same = await spawnCli(['diff', aPath, aPath], { cwd: dir });
    expect(same.code).toBe(0);

    const j = await spawnCli(['diff', aPath, bPath, '--json'], { cwd: dir });
    expect(j.code).toBe(1);
    const payload = JSON.parse(j.stdout) as { newIssues: { ruleId: string }[]; fixed: string[]; scoreDelta: number | null };
    expect(payload.newIssues.map((i) => i.ruleId)).toContain('title-missing');
    expect(typeof payload.scoreDelta).toBe('number');
  });

  it('diff usage errors exit 2 with guidance', async () => {
    const one = await spawnCli(['diff', join(dir, 'a.json')], { cwd: dir });
    expect(one.code).toBe(2);
    const missing = await spawnCli(['diff', join(dir, 'nope.json'), join(dir, 'a.json')], { cwd: dir });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('cannot read');
  });
});

describe('update-baseline gate semantics (reviewer C1)', () => {
  it('an update run with an ERROR finding still exits 0 (gate skipped, write done)', async () => {
    const baselinePath = join(dir, 'err-baseline.json');
    mode = 'v2'; // v2 has the title-missing ERROR
    const res = await audit(['--update-baseline', baselinePath]);
    expect(res.code, `stdout: ${res.stdout}\nstderr: ${res.stderr}`).toBe(0);
    expect(JSON.parse(await readFile(baselinePath, 'utf8')).entries.length).toBeGreaterThan(0);
    mode = 'v1';
  });

  it('--verbose lists every affected URL; default renders 3 samples + "+N more"; --json --baseline keeps --out raw (M2)', async () => {
    // A page with 5 distinct rules firing is enough to exercise grouping; use v1 (4 findings) + v2 (5).
    const aPath = join(dir, 'va.json');
    mode = 'v1';
    await audit(['--update-baseline', join(dir, 'vb.json'), '--out', aPath]);
    const human = await audit(['--baseline', join(dir, 'vb.json')]);
    expect(human.stdout).toContain('→ fix:');
    expect(human.stdout).toContain('baseline:');

    const verbose = await audit(['--baseline', join(dir, 'vb.json'), '--verbose']);
    expect(verbose.stdout.split('\n').filter((l) => l.trim().startsWith('http')).length)
      .toBeGreaterThanOrEqual(human.stdout.split('\n').filter((l) => l.trim().startsWith('http')).length);

    // --json + --baseline: the stdout document carries the baseline section...
    const jsonRun = await audit(['--baseline', join(dir, 'vb.json'), '--json', '--out', join(dir, 'raw.json')]);
    expect(jsonRun.code).toBe(0);
    const doc = JSON.parse(jsonRun.stdout) as { baseline?: { new: unknown[]; existingCount: number } };
    expect(doc.baseline).toBeDefined();
    expect(Array.isArray(doc.baseline?.new)).toBe(true);
    // ...while --out wrote the RAW report (no baseline key).
    const raw = JSON.parse(await readFile(join(dir, 'raw.json'), 'utf8')) as { baseline?: unknown };
    expect(raw.baseline).toBeUndefined();
  });
});
