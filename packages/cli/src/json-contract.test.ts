import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnCli } from './spawn.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-json-'));
  await writeFile(join(dir, 'lumen.config.json'), JSON.stringify({ failThreshold: 'warning' }), 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('--json single-document contract via the real bin (E2)', () => {
  it('prints exactly one JSON document with a trailing newline and nothing on stderr', async () => {
    const r = await spawnCli(['config', 'show', '--json', '--config', join(dir, 'lumen.config.json')]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(r.stdout.match(/\n/g)).toHaveLength(1); // one document, one newline
    const doc = JSON.parse(r.stdout) as { failThreshold: string };
    expect(doc.failThreshold).toBe('warning'); // config resolution through the flag (B12)
  });

  it('LUMEN_CONFIG env resolves the same file (B12)', async () => {
    const r = await spawnCli(['config', 'show', '--json'], {
      env: { LUMEN_CONFIG: join(dir, 'lumen.config.json') },
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).failThreshold).toBe('warning');
  });

  it('default ./lumen.config.json from cwd is used when flag and env are absent', async () => {
    const r = await spawnCli(['config', 'show', '--json'], { cwd: dir });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).failThreshold).toBe('warning');
  });

  it('error paths keep stdout empty — diagnostics go to stderr only', async () => {
    const r = await spawnCli(['config', 'show', '--json', '--config', join(dir, 'missing.json')]);
    expect(r.code).toBe(0); // missing file -> defaults, not an error
    const bad = await spawnCli(['config', 'show', '--json', '--config', dir]); // EISDIR
    expect(bad.code).toBe(2);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toContain('internal error');
  });
});
