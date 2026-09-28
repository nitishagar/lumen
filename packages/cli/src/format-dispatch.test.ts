/**
 * `--format` dispatch tests (E1.4 FR-1, reviewer I8): unknown formats and
 * alias conflicts are usage errors; `--format human` is byte-identical to the
 * pre-flag default; md/sarif `--out` writes the rendered artifact.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryIo } from './io.js';
import { run } from './run.js';
import { spawnCli } from './spawn.js';
import type { CommandDeps } from './composition/node.js';
import { fixtureAuditRunner, MemoryHistoryStore } from '@lumen-seo/mcp/testkit';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-format-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (): CommandDeps => ({
  clock: () => '2026-09-28T12:00:00Z',
  failThreshold: 'error',
  keywords: [],
  authority: [],
  authorityUnconfigured: [],
  history: new MemoryHistoryStore(),
  auditRunner: fixtureAuditRunner({
    issues: [{ ruleId: 'title-missing', severity: 'error', message: 'no title', evidence: {}, fixHint: 'add one' }],
  }),
});

describe('format dispatch (E1.4)', () => {
  it('unknown --format is a UsageError (exit 2) listing the valid values', async () => {
    const io = new MemoryIo();
    const code = await run(['audit', 'https://example.com', '--format', 'pdf'], io, deps());
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('--format must be one of');
    expect(io.stderr.join('')).toContain('sarif');
  });

  it('--json together with a non-json --format is a UsageError', async () => {
    const io = new MemoryIo();
    const code = await run(['audit', 'https://example.com', '--format', 'md', '--json'], io, deps());
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('alias');
  });

  it('no flags and --format human produce byte-identical output', async () => {
    const ioA = new MemoryIo();
    const ioB = new MemoryIo();
    await run(['audit', 'https://example.com'], ioA, deps());
    await run(['audit', 'https://example.com', '--format', 'human'], ioB, deps());
    expect(ioB.stdout.join('')).toBe(ioA.stdout.join(''));
  });

  it('--format md renders the summary (and --json still produces a JSON doc)', async () => {
    const io = new MemoryIo();
    const code = await run(['audit', 'https://example.com', '--format', 'md'], io, deps());
    expect(code).toBe(1); // the fixture error gates
    const out = io.stdout.join('');
    expect(out).toContain('## lumen audit');
    const ioJson = new MemoryIo();
    await run(['audit', 'https://example.com', '--json'], ioJson, deps());
    expect(() => JSON.parse(ioJson.stdout.join(''))).not.toThrow();
  });

  it('--format md --out writes the rendered artifact (spawn, real bin)', async () => {
    const out = join(dir, 'summary.md');
    const res = await spawnCli(
      ['audit', 'https://example.com', '--format', 'md', '--out', out],
      { cwd: dir, env: { LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') } },
    );
    expect(res.code).toBe(1);
    expect(res.stdout).toBe(''); // artifact-only
    const artifact = await readFile(out, 'utf8');
    expect(artifact).toContain('## lumen audit');
  });
});
