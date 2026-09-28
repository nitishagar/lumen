/**
 * `lumen init` tests (PRD E0.4 FR-1). Oracles from the plan:
 * - registry round-trip: the written file loads through the REAL config
 *   loader and validates through the REAL provider registry (a byok map
 *   keyed by capability names instead of provider names would throw here);
 * - refusal without --force, overwrite with it;
 * - .gitignore dedup (one `.lumen/` line, newline-safe, no git repo → untouched);
 * - spawn end-to-end through the real bin in a temp cwd.
 * No secret values are ever written or printed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProviderRegistry, loadConfig } from '@lumen-seo/core';
import { readConfigFile } from '@lumen-seo/core/node';
import { onboardPayload } from '@lumen-seo/mcp';
import { BYOK_ENV_VARS } from '@lumen-seo/providers';
import { availableProviders } from './composition/available.js';
import { MemoryIo } from './io.js';
import { execute as init } from './cmd/init.js';
import { run } from './run.js';
import type { CliContext } from './run.js';
import { spawnCli } from './spawn.js';
import { UsageError } from './usage-error.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-init-'));
});

afterEach(async () => {
  if (process.cwd().startsWith(dir)) process.chdir(tmpdir());
  await rm(dir, { recursive: true, force: true });
});

const ctx = (flags: Record<string, string | boolean> = {}, configPath = join(dir, 'lumen.config.json')) => {
  const io = new MemoryIo();
  const c: CliContext = {
    io,
    signal: new AbortController().signal,
    positionals: [],
    flags,
    configPathFlag: configPath,
  };
  return { io, ctx: c, configPath };
};

describe('init writes a valid defaults config', () => {
  it('writes failThreshold/crawl/byok and passes the registry round-trip oracle', async () => {
    const { io, ctx: c, configPath } = ctx();
    const code = await init(c);
    expect(code).toBe(0);
    expect(existsSync(configPath)).toBe(true);

    // Real loader — the same path every command uses (would fail on unknown keys/shapes).
    const config = await loadConfig(configPath, readConfigFile);
    expect(config.failThreshold).toBe('error');
    expect(config.byok).toEqual({ ...BYOK_ENV_VARS }); // provider-name keyed, env-var NAME values

    // Real registry over the REAL built providers — capability-keyed byok would throw.
    expect(() => createProviderRegistry(config.providers, config.byok, availableProviders(config))).not.toThrow();

    const printed = io.stdout.join('');
    expect(printed).toContain('lumen.config.json');
    expect(printed).toContain('lumen doctor');
    expect(printed).toContain(onboardPayload('claude')); // plan oracle: the printed mcp-add line IS the onboard payload
    expect(printed).not.toContain('AIza'); // no literal key values
  });

  it('printed signup URLs are the pinned constants for the three keyed providers', async () => {
    const { io, ctx: c } = ctx();
    await init(c);
    const printed = io.stdout.join('');
    expect(printed).toContain('LUMEN_PSI_KEY');
    expect(printed).toContain('pagespeedonline.googleapis.com');
    expect(printed).toContain('LUMEN_CRUX_KEY');
    expect(printed).toContain('chromeuxreport.googleapis.com');
    expect(printed).toContain('LUMEN_OPR_KEY');
    expect(printed).toContain('openpagerank.com');
  });
});

describe('init refusal and --force', () => {
  it('refuses an existing config without --force (names the path, nothing overwritten)', async () => {
    const { ctx: c, configPath } = ctx();
    writeFileSync(configPath, '{"failThreshold":"warning"}', 'utf8');
    await expect(init(c)).rejects.toBeInstanceOf(UsageError);
    await expect(init(c)).rejects.toThrow(configPath);
    expect(readFileSync(configPath, 'utf8')).toBe('{"failThreshold":"warning"}');
  });

  it('--force overwrites the existing config', async () => {
    const { ctx: c, configPath } = ctx();
    writeFileSync(configPath, '{"failThreshold":"warning"}', 'utf8');
    await expect(init({ ...c, flags: { force: true } })).resolves.toBe(0);
    expect(readFileSync(configPath, 'utf8')).toContain('"failThreshold": "error"');
  });

  it('a target inside a missing directory is a typed UsageError before any write', async () => {
    const { ctx: c } = ctx({}, join(dir, 'missing-dir', 'lumen.config.json'));
    await expect(init(c)).rejects.toBeInstanceOf(UsageError);
    await expect(init(c)).rejects.toThrow('missing-dir');
    expect(existsSync(join(dir, 'missing-dir'))).toBe(false);
  });

  it('a non-writable target directory is a typed UsageError before any write', { skip: process.getuid?.() === 0 }, async () => {
    const nested = join(dir, 'ro');
    mkdirSync(nested);
    chmodSync(nested, 0o555);
    try {
      const { ctx: c } = ctx({}, join(nested, 'lumen.config.json'));
      await expect(init(c)).rejects.toBeInstanceOf(UsageError);
      expect(existsSync(join(nested, 'lumen.config.json'))).toBe(false);
    } finally {
      chmodSync(nested, 0o755);
    }
  });

  it('through run(): refusal exits 2', async () => {
    const configPath = join(dir, 'lumen.config.json');
    writeFileSync(configPath, '{}', 'utf8');
    const io = new MemoryIo();
    const code = await run(['init', '--config', configPath], io);
    expect(code).toBe(2);
    expect(io.stderr.join('')).toContain('--force');
  });
});

describe('init .gitignore handling', () => {
  it('appends one .lumen/ entry to an existing gitignore, newline-safe, deduped', async () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n', 'utf8');
    process.chdir(dir);
    try {
      const { ctx: c } = ctx();
      await init(c);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(
        'node_modules\n\n# lumen local runtime state\n.lumen/\n',
      );
      // Second run in the same repo must not duplicate the entry.
      const configPath = join(dir, 'second.json');
      await init({ ...c, configPathFlag: configPath });
      expect(readFileSync(join(dir, '.gitignore'), 'utf8').split('.lumen/').length - 1).toBe(1);
    } finally {
      process.chdir(tmpdir());
    }
  });

  it('appends to a gitignore without a trailing newline without gluing lines', async () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.gitignore'), 'node_modules', 'utf8');
    process.chdir(dir);
    try {
      const { ctx: c } = ctx();
      await init(c);
      const content = readFileSync(join(dir, '.gitignore'), 'utf8');
      expect(content.startsWith('node_modules\n')).toBe(true);
      expect(content).toContain('.lumen/\n');
    } finally {
      process.chdir(tmpdir());
    }
  });

  it('creates a fresh gitignore with no leading blank line', async () => {
    mkdirSync(join(dir, '.git'));
    process.chdir(dir);
    try {
      const { ctx: c } = ctx();
      await init(c);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('# lumen local runtime state\n.lumen/\n');
    } finally {
      process.chdir(tmpdir());
    }
  });

  it('leaves a non-git directory untouched', async () => {
    process.chdir(dir);
    try {
      const { ctx: c } = ctx();
      await init(c);
      expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    } finally {
      process.chdir(tmpdir());
    }
  });
});

describe('init spawn end-to-end (real bin)', () => {
  it('exit 0, file exists; second run without --force exits 2', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lumen-init-spawn-'));
    try {
      const first = await spawnCli(['init', '--yes'], { cwd });
      expect(first.code).toBe(0);
      expect(existsSync(join(cwd, 'lumen.config.json'))).toBe(true);
      expect(first.stdout).toContain('lumen doctor');

      const second = await spawnCli(['init', '--yes'], { cwd });
      expect(second.code).toBe(2);
      expect(second.stderr).toContain('--force');

      const forced = await spawnCli(['init', '--yes', '--force'], { cwd });
      expect(forced.code).toBe(0);
      expect(forced.stdout).toContain('wrote');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
