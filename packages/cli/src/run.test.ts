import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from './run.js';
import { MemoryIo } from './io.js';

let dir: string;
let savedEnv: (string | undefined)[];

const ENV_KEYS = ['LUMEN_CONFIG', 'LUMEN_HISTORY_DIR', 'LUMEN_PSI_KEY', 'LUMEN_CRUX_KEY'] as const;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-run-'));
  savedEnv = ENV_KEYS.map((k) => process.env[k]);
});

afterEach(async () => {
  ENV_KEYS.forEach((k, i) => {
    const v = savedEnv[i];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  await rm(dir, { recursive: true, force: true });
});

describe('exit envelope (E1)', () => {
  it('help paths exit 0 with stdout usage and empty stderr', async () => {
    for (const argv of [[], ['--help'], ['-h'], ['rank', '--help']] as const) {
      const io = new MemoryIo();
      const code = await run(argv, io);
      expect(code, `argv=${argv.join(' ')}`).toBe(0);
      expect(io.stderr).toEqual([]);
      expect(io.stdout.join('')).toContain('Usage');
    }
  });

  it('unknown command exits 2 with a stderr message and empty stdout', async () => {
    const io = new MemoryIo();
    expect(await run(['nope'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('unknown command "nope"');
    expect(io.stdout).toEqual([]);
  });

  it('unknown flag exits 2 (strict parseArgs) with a usage hint', async () => {
    const io = new MemoryIo();
    expect(await run(['config', 'show', '--bogus'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('lumen config --help');
  });

  it('config error exits 2 with actionable details', async () => {
    process.env.LUMEN_CONFIG = join(dir, 'lumen.config.json');
    await writeFile(join(dir, 'lumen.config.json'), '{ "failThreshold": "critical" }', 'utf8');
    const io = new MemoryIo();
    expect(await run(['config', 'show'], io)).toBe(2);
    expect(io.stderr.join('')).toContain('config error');
    expect(io.stderr.join('')).toContain('failThreshold');
  });

  it('internal errors map to a truncated internal message, exit 2, no stack traces', async () => {
    const io = new MemoryIo();
    // A directory as --config makes the fs reader reject with EISDIR — a
    // non-Lumen error exercising the internal-error branch (B18).
    expect(await run(['config', 'show', '--config', dir], io)).toBe(2);
    const errText = io.stderr.join('');
    expect(errText).toContain('internal error');
    expect(errText).not.toMatch(/\n\s*at /); // no stack frames on any stream
  });
});

describe('config show (E5/I16)', () => {
  it('prints env-var NAMES and set flags, never values', async () => {
    const sentinel = 'k-sentinel-value-9f1c';
    process.env.LUMEN_CONFIG = join(dir, 'lumen.config.json');
    process.env.LUMEN_HISTORY_DIR = join(dir, '.lumen', 'history');
    process.env.LUMEN_PSI_KEY = sentinel;
    await writeFile(
      join(dir, 'lumen.config.json'),
      JSON.stringify({ byok: { 'fixture-psi': 'LUMEN_PSI_KEY' } }),
      'utf8',
    );
    const io = new MemoryIo();
    expect(await run(['config', 'show', '--json'], io)).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as {
      byok: { capability: string; envVar: string; set: boolean }[];
      historyDir: string;
      failThreshold: string;
    };
    expect(doc.byok).toEqual([{ capability: 'fixture-psi', envVar: 'LUMEN_PSI_KEY', set: true }]);
    expect(doc.historyDir).toBe(join(dir, '.lumen', 'history'));
    expect(doc.failThreshold).toBe('error'); // R2 default
    // The sentinel VALUE must never appear anywhere (I16).
    expect(io.stdout.join('') + io.stderr.join('')).not.toContain(sentinel);
  });

  it('falls back to the three default env names when byok is unconfigured', async () => {
    process.env.LUMEN_CONFIG = join(dir, 'lumen.config.json');
    await writeFile(join(dir, 'lumen.config.json'), '{}', 'utf8');
    const io = new MemoryIo();
    expect(await run(['config', 'show', '--json'], io)).toBe(0);
    const doc = JSON.parse(io.stdout.join('')) as { byok: { capability: string; envVar: string }[] };
    expect(doc.byok.map((b) => b.envVar)).toEqual([
      'LUMEN_PSI_KEY',
      'LUMEN_CRUX_KEY',
      'LUMEN_OPR_KEY',
    ]);
  });

  it('human mode never prints values either', async () => {
    const sentinel = 'k-sentinel-human-42ab';
    process.env.LUMEN_CRUX_KEY = sentinel;
    process.env.LUMEN_CONFIG = join(dir, 'lumen.config.json');
    await writeFile(join(dir, 'lumen.config.json'), '{}', 'utf8');
    const io = new MemoryIo();
    expect(await run(['config', 'show'], io)).toBe(0);
    const text = io.stdout.join('');
    expect(text).toContain('LUMEN_CRUX_KEY');
    expect(text).not.toContain(sentinel);
    expect(text).toMatch(/set|not set/);
  });
});
