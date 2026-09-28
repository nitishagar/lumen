/**
 * `lumen doctor` tests (PRD E0.4 FR-2). Oracles from the plan:
 * - no-keys machine: exit 0, all three missing env-var NAMES + signup URLs named;
 * - throwing pagespeed with --online: exit 2 naming pagespeed, the loop
 *   CONTINUES (a later provider still probes ok) — partial failure never aborts;
 * - plain mode makes ZERO network calls (global fetch stubbed to throw);
 * - the node section's `satisfies` is recomputed in this test from the
 *   SHIPPED cli package.json engines (would fail if doctor hardcoded the
 *   range or read the private root manifest);
 * - spawn-level: real bin exit codes and `--json` parseability.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyProvider, PageSpeedReport } from '@lumen-seo/core';
import { BUILTIN_PROVIDER_NAMES, PROVIDER_CAPABILITIES } from '@lumen-seo/providers';
import { MemoryIo } from './io.js';
import {
  cliEnginesRange,
  deriveProviderStatuses,
  execute as doctor,
  probeProviders,
  satisfiesEngines,
} from './cmd/doctor.js';
import type { CliContext } from './run.js';
import { spawnCli } from './spawn.js';

const KEYED = ['LUMEN_PSI_KEY', 'LUMEN_CRUX_KEY', 'LUMEN_OPR_KEY'] as const;

let dir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-doctor-'));
  for (const k of KEYED) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  await writeFile(join(dir, 'lumen.config.json'), '{}', 'utf8');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of KEYED) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await rm(dir, { recursive: true, force: true });
});

const ctx = (flags: Record<string, string | boolean> = {}, configPath = join(dir, 'lumen.config.json')) => {
  const io = new MemoryIo();
  const c: CliContext = { io, signal: new AbortController().signal, positionals: [], flags, configPathFlag: configPath };
  return { io, ctx: c };
};

/** Minimal ok fixture for any boundary — probeProvider only calls the one boundary method. */
const okProvider = (name: string): AnyProvider =>
  ({
    name,
    ideas: async () => [],
    search: async () => [],
    report: async (): Promise<PageSpeedReport> =>
      ({
        scores: { performance: 100, seo: 100, accessibility: 100, bestPractices: 100 },
        metrics: {},
        source: { provider: name, kind: 'lab', note: 'fixture' },
      }) as unknown as PageSpeedReport,
    record: async () => null,
    authority: async () => [],
  }) as unknown as AnyProvider;

const failingProvider = (name: string, message: string): AnyProvider =>
  ({ name, report: async (): Promise<PageSpeedReport> => { throw new Error(message); } }) as unknown as AnyProvider;

describe('provider status derivation (pure)', () => {
  it('no keys: the 3 keyed providers are not-configured with env names + signup URLs, keyless are ready', () => {
    const statuses = deriveProviderStatuses({});
    expect(statuses).toHaveLength(BUILTIN_PROVIDER_NAMES.length);
    for (const s of statuses) {
      expect(s.boundary).toBe(PROVIDER_CAPABILITIES[s.name]);
      if (['pagespeed', 'crux', 'openpagerank'].includes(s.name)) {
        expect(s.status).toBe('not-configured');
        expect(s.envVar).toMatch(/^LUMEN_[A-Z_]+_KEY$/);
        expect(s.signupUrl).toMatch(/^https:\/\//);
      } else {
        expect(s.status).toBe('ready');
        expect(s.envVar).toBeUndefined();
      }
    }
  });

  it('a set env name makes its provider ready; a byok override renames the env var', () => {
    process.env.LUMEN_PSI_KEY = 'set';
    const withKey = deriveProviderStatuses({});
    expect(withKey.find((s) => s.name === 'pagespeed')).toMatchObject({ status: 'ready', envVar: 'LUMEN_PSI_KEY' });

    const overridden = deriveProviderStatuses({ pagespeed: 'MY_PSI_NAME' });
    expect(overridden.find((s) => s.name === 'pagespeed')).toMatchObject({ status: 'not-configured', envVar: 'MY_PSI_NAME' });
  });
});

describe('engines contract (recomputed from the shipped manifest)', () => {
  it('doctor reports the cli package.json engines and a satisfies value that recomputes', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      engines?: { node?: string };
    };
    const engines = manifest.engines?.node ?? '';
    expect(engines).toBe(cliEnginesRange()); // the shipped range, not a hardcoded constant

    const { io, ctx: c } = ctx({ json: true });
    await doctor(c);
    const payload = JSON.parse(io.stdout.join('')) as {
      node: { engines: string; satisfies: boolean | undefined };
    };
    expect(payload.node.engines).toBe(engines);
    // Independent recomputation of the `>=X.Y` comparison.
    const m = /^>=?(\d+)(?:\.(\d+))?/.exec(engines);
    expect(m).not.toBeNull();
    const [haveMajor, haveMinor] = process.versions.node.split('.').map(Number);
    const wantMajor = Number(m![1]);
    const wantMinor = Number(m![2] ?? 0);
    const expected =
      haveMajor! > wantMajor || (haveMajor === wantMajor && haveMinor! >= wantMinor);
    expect(payload.node.satisfies).toBe(expected);
  });

  it('satisfiesEngines matrix: >=22.7 boundary, patch-insensitive, unknown ranges report unknown', () => {
    expect(satisfiesEngines('22.6.1', '>=22.7')).toBe(false);
    expect(satisfiesEngines('22.7.0', '>=22.7')).toBe(true);
    expect(satisfiesEngines('23.1.0', '>=22.7')).toBe(true);
    expect(satisfiesEngines('22.12.3', '>=22.7')).toBe(true);
    expect(satisfiesEngines('21.9.0', '>=22')).toBe(false);
    expect(satisfiesEngines('22.0.0', '>=22')).toBe(true);
    expect(satisfiesEngines('22.7.0', '~22')).toBeUndefined();
  });
});

describe('doctor plain mode (zero network)', () => {
  it('exit 0 naming every missing env var + signup URL; fetch stubbed to throw', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('NETWORK LEAK: plain doctor dialed out');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { io, ctx: c } = ctx();
    const code = await doctor(c);
    expect(code).toBe(0);
    const printed = io.stdout.join('');
    expect(printed).toContain('LUMEN_PSI_KEY');
    expect(printed).toContain('LUMEN_CRUX_KEY');
    expect(printed).toContain('LUMEN_OPR_KEY');
    expect(printed).toContain('pagespeedonline.googleapis.com');
    expect(printed).toContain('chromeuxreport.googleapis.com');
    expect(printed).toContain('openpagerank.com');
    expect(printed).not.toContain('BROKEN');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an invalid config is reported (exit 2) but provider sections still derive', async () => {
    await writeFile(join(dir, 'lumen.config.json'), '{"failThreshold":"bogus"}', 'utf8');
    const { io, ctx: c } = ctx();
    const code = await doctor(c);
    expect(code).toBe(2);
    const printed = io.stdout.join('');
    expect(printed).toContain('INVALID');
    expect(printed).toContain('LUMEN_PSI_KEY'); // derived from an empty byok map, not the config
  });

  it('--json emits one parseable document with all sections', async () => {
    process.env.LUMEN_PSI_KEY = 'set';
    const { io, ctx: c } = ctx({ json: true });
    const code = await doctor(c);
    expect(code).toBe(0);
    const payload = JSON.parse(io.stdout.join('')) as {
      node: object;
      config: { valid: boolean; path: string };
      providers: { name: string; status: string }[];
      online: boolean;
    };
    expect(payload.node).toBeTruthy();
    expect(payload.config.valid).toBe(true);
    expect(payload.online).toBe(false);
    expect(payload.providers).toHaveLength(7);
    expect(payload.providers.find((p) => p.name === 'pagespeed')?.status).toBe('ready');
    expect(payload.providers.find((p) => p.name === 'openpagerank')?.status).toBe('not-configured');
  });
});

describe('doctor --online probes (fixture providers)', () => {
  it('a throwing pagespeed exits 2 naming pagespeed; the loop continues (crux probes ok)', async () => {
    process.env.LUMEN_PSI_KEY = 'set';
    process.env.LUMEN_CRUX_KEY = 'set';
    const override: Record<string, AnyProvider> = {
      pagespeed: failingProvider('pagespeed', 'quota exceeded'),
      crux: okProvider('crux'),
      'google-suggest': okProvider('google-suggest'),
      'wikipedia-demand': okProvider('wikipedia-demand'),
      tranco: okProvider('tranco'),
      'ddg-serp': okProvider('ddg-serp'),
    };
    const { io, ctx: c } = ctx({ online: true });
    const code = await doctor(c, override);
    expect(code).toBe(2);
    const printed = io.stdout.join('');
    expect(printed).toMatch(/pagespeed.*BROKEN/s);
    expect(printed).toContain('quota exceeded');
    expect(printed).toMatch(/crux.*probe ok/s);
    expect(printed).toContain('1 broken of 6 probed');
  });

  it('all-healthy probes exit 0', async () => {
    process.env.LUMEN_PSI_KEY = 'set';
    const override: Record<string, AnyProvider> = {
      pagespeed: okProvider('pagespeed'),
      'google-suggest': okProvider('google-suggest'),
      'wikipedia-demand': okProvider('wikipedia-demand'),
      tranco: okProvider('tranco'),
      'ddg-serp': okProvider('ddg-serp'),
    };
    const { io, ctx: c } = ctx({ online: true });
    const code = await doctor(c, override);
    expect(code).toBe(0);
    expect(io.stdout.join('')).toContain('0 broken of 5 probed');
  });

  it('a ready provider missing from the registry counts broken, not silently ready', async () => {
    process.env.LUMEN_PSI_KEY = 'set';
    const { io, ctx: c } = ctx({ online: true });
    const code = await doctor(c, { 'google-suggest': okProvider('google-suggest') }); // pagespeed absent
    expect(code).toBe(2);
    expect(io.stdout.join('')).toMatch(/pagespeed.*BROKEN/s);
  });

  it('unconfigured providers are never probed even in --online mode (only the 4 keyless are counted)', async () => {
    const { io, ctx: c } = ctx({ online: true });
    const code = await doctor(c, {}); // empty registry: every READY provider is missing → broken
    expect(code).toBe(2);
    // probed = ready providers only (4 keyless); the 3 keyed ones have no env → never probed
    expect(io.stdout.join('')).toContain('4 broken of 4 probed');
    expect(io.stdout.join('')).toContain('not-configured — set LUMEN_PSI_KEY');
  });

  it('an aborted signal rethrows as a cancellation, not a broken provider', async () => {
    process.env.LUMEN_PSI_KEY = 'set';
    const ac = new AbortController();
    ac.abort();
    const providers = deriveProviderStatuses({});
    const registry: Record<string, AnyProvider> = {
      pagespeed: failingProvider('pagespeed', 'aborted mid-probe'),
    };
    await expect(probeProviders(providers, registry, ac.signal)).rejects.toThrow('aborted mid-probe');
  });
});

describe('probeProviders edge: non-Error rejections are typed too', () => {
  it('a string rejection becomes a reason, not a crash', async () => {
    process.env.LUMEN_PSI_KEY = 'set';
    const providers = deriveProviderStatuses({});
    const registry: Record<string, AnyProvider> = {
      pagespeed: { report: async () => { throw 'string failure'; } } as unknown as AnyProvider,
      'google-suggest': okProvider('google-suggest'),
      'wikipedia-demand': okProvider('wikipedia-demand'),
      tranco: okProvider('tranco'),
      'ddg-serp': okProvider('ddg-serp'),
    };
    const broken = await probeProviders(providers, registry, new AbortController().signal);
    expect(broken).toBe(1);
    expect(providers.find((p) => p.name === 'pagespeed')?.reason).toContain('string failure');
  });
});

describe('doctor spawn end-to-end (real bin)', () => {
  it('exit 0 on a clean machine; --json parses as one document', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lumen-doctor-spawn-'));
    try {
      const plain = await spawnCli(['doctor'], { cwd });
      expect(plain.code).toBe(0);
      expect(plain.stdout).toContain('LUMEN_PSI_KEY');

      const json = await spawnCli(['doctor', '--json'], { cwd });
      expect(json.code).toBe(0);
      const payload = JSON.parse(json.stdout) as { providers: unknown[]; config: { valid: boolean } };
      expect(payload.providers).toHaveLength(7);
      expect(payload.config.valid).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
