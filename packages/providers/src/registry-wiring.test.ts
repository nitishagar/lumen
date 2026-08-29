import { describe, expect, it } from 'vitest';
import { ConfigError } from '@lumen-seo/core';
import type { AuthorityProvider, CruxProvider, PageSpeedProvider } from '@lumen-seo/core';
import { BUILTIN_PROVIDER_NAMES, PROVIDER_CAPABILITIES } from './builtins.js';
import { fakeFetcher, FakeClock, jsonResponse, makeDeps } from './testing.js';
import { createBuiltInProviders, registerBuiltIns } from './registry-wiring.js';
import { createWorkerSafeProviders } from './worker.js';
import { googleSuggestJson, psiReport } from './fixtures/index.js';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOW = Date.UTC(2026, 7, 29);

const wired = (env: Record<string, string | undefined> = {}) => {
  const clock = new FakeClock(NOW);
  const fetcher = fakeFetcher(() => jsonResponse(googleSuggestJson));
  const deps = makeDeps(fetcher, clock, { env });
  return { providers: createBuiltInProviders({}, deps), fetcher, clock, deps };
};

describe('TC-REG-1/2: factory wires all seven names with their declared capabilities', () => {
  it('createBuiltInProviders returns exactly the seven built-ins', () => {
    const { providers } = wired();
    expect(Object.keys(providers).sort()).toEqual([...BUILTIN_PROVIDER_NAMES].sort());
    for (const name of BUILTIN_PROVIDER_NAMES) expect(providers[name]!.name).toBe(name);
  });

  it('each provider implements its declared core boundary', () => {
    const { providers } = wired();
    for (const [name, boundary] of Object.entries(PROVIDER_CAPABILITIES)) {
      const p = providers[name as keyof typeof providers] as unknown as Record<string, unknown>;
      const method = { keywords: 'ideas', serp: 'search', pagespeed: 'report', crux: 'record', authority: 'authority' }[
        boundary
      ];
      expect(typeof p[method], `${name}.${method}`).toBe('function');
    }
  });

  it('registerBuiltIns validates selection and feeds core\'s unknown-name error with our name list', () => {
    const deps = makeDeps(fakeFetcher(), new FakeClock(NOW));
    const registry = registerBuiltIns(
      { keywords: 'google-suggest', serp: 'ddg-serp', pagespeed: 'pagespeed', crux: 'crux', authority: 'tranco' },
      {},
      deps,
    );
    expect(registry.keywords()!.name).toBe('google-suggest');
    expect(registry.serp()!.name).toBe('ddg-serp');
    expect(registry.pagespeed()!.name).toBe('pagespeed');
    expect(registry.crux()!.name).toBe('crux');
    expect(registry.authority()!.name).toBe('tranco');

    expect(() => registerBuiltIns({ keywords: 'made-up-provider' } as never, {}, deps)).toThrow(ConfigError);
    try {
      registerBuiltIns({ keywords: 'made-up-provider' } as never, {}, deps);
      expect.unreachable('must throw');
    } catch (e) {
      const message = (e as ConfigError).details.map((d) => d.message).join('; ');
      expect(message).toContain('unknown provider name "made-up-provider"');
      for (const name of BUILTIN_PROVIDER_NAMES) expect(message).toContain(name);
    }
  });
});

describe('TC-REG-3 (BA5-aligned): BYOK-absent behavior through the wiring', () => {
  it('crux + openpagerank with absent keys reject not_configured naming their env vars, 0 fetches', async () => {
    const { providers, fetcher } = wired({});
    const crux = providers.crux as CruxProvider;
    await expect(crux.record(new URL('https://example.com/'), {})).rejects.toMatchObject({
      code: 'not_configured',
      envVar: 'LUMEN_CRUX_KEY',
    });
    const opr = providers.openpagerank as AuthorityProvider;
    await expect(opr.authority('example.com', {})).rejects.toMatchObject({
      code: 'not_configured',
      envVar: 'LUMEN_OPR_KEY',
    });
    expect(fetcher.calls).toHaveLength(0); // never a keyless call to key-required endpoints
  });

  it('pagespeed rejects ONLY when automated:true; trial proceeds keyless when automated:false', async () => {
    const clock = new FakeClock(NOW);
    const fetcher = fakeFetcher(() => jsonResponse(psiReport));
    const deps = makeDeps(fetcher, clock, { env: {} });
    const providers = createBuiltInProviders({}, deps);
    const psi = providers.pagespeed as PageSpeedProvider;
    await expect(psi.report(new URL('https://example.com/'), { automated: true })).rejects.toMatchObject(
      { code: 'not_configured', envVar: 'LUMEN_PSI_KEY' },
    );
    expect(fetcher.calls).toHaveLength(0);
    await psi.report(new URL('https://example.com/'), { automated: false });
    expect(fetcher.calls).toHaveLength(1);
  });

  it('env-var NAME override flows through (custom envVar honored)', async () => {
    const clock = new FakeClock(NOW);
    const fetcher = fakeFetcher(() => jsonResponse(psiReport));
    const deps = makeDeps(fetcher, clock, { env: { MY_PSI_VAR: 'k' } });
    const providers = createBuiltInProviders({ pagespeed: { envVar: 'MY_PSI_VAR' } }, deps);
    const psi = providers.pagespeed as PageSpeedProvider;
    await psi.report(new URL('https://example.com/'), { automated: true });
    expect(fetcher.calls).toHaveLength(1); // key found via the overridden NAME
  });
});

describe('TC-REG-4: wiring rejects secret-bearing config at construction', () => {
  it('createBuiltInProviders throws before any provider exists', () => {
    const deps = makeDeps(fakeFetcher(), new FakeClock(NOW));
    expect(() => createBuiltInProviders({ crux: { apiKey: 'x' } as unknown as never }, deps)).toThrow(
      /environment variable.*LUMEN_CRUX_KEY/s,
    );
    expect(() => createWorkerSafeProviders({ openpagerank: { token: 'x' } as unknown as never }, deps)).toThrow(
      /LUMEN_OPR_KEY/,
    );
  });
});

describe('TC-REG-5: the worker-safe factory excludes ddg-serp and never loads cheerio', () => {
  it('createWorkerSafeProviders returns the six non-cheerio providers', () => {
    const providers = createWorkerSafeProviders({}, makeDeps(fakeFetcher(), new FakeClock(NOW)));
    expect(Object.keys(providers).sort()).toEqual(
      [...BUILTIN_PROVIDER_NAMES].filter((n) => n !== 'ddg-serp').sort(),
    );
  });

  it('the worker entry import graph contains no cheerio and never reaches ddg-serp.ts', async () => {
    const srcDir = fileURLToPath(new URL('.', import.meta.url));
    const importSpecifiers = (source: string): string[] => {
      const specifiers: string[] = [];
      const patterns = [
        /import\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
        /export\s[^;'"]*?from\s*['"]([^'"]+)['"]/g,
        /^\s*import\s*['"]([^'"]+)['"]/gm,
        /import\(\s*['"]([^'"]+)['"]\s*\)/g,
      ];
      for (const pattern of patterns) for (const m of source.matchAll(pattern)) specifiers.push(m[1]!);
      return specifiers;
    };
    const resolveLocal = (fromFile: string, spec: string): string => {
      const base = resolve(dirname(fromFile), spec);
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
    const graph = await collectGraph(join(srcDir, 'worker.ts'));
    expect(graph.size).toBeGreaterThan(5); // the scan actually walked
    for (const [file, source] of graph) {
      expect(source.includes("from 'cheerio'"), `${file} must not import cheerio`).toBe(false);
    }
    expect([...graph.keys()].some((f) => f.endsWith('ddg-serp.ts'))).toBe(false);
    // sanity: the MAIN entry DOES reach ddg-serp (it is the Node surface)
    const mainGraph = await collectGraph(join(srcDir, 'index.ts'));
    expect([...mainGraph.keys()].some((f) => f.endsWith('ddg-serp.ts'))).toBe(true);
  });

  it('the /worker subpath is exported by package.json', async () => {
    const pkg = JSON.parse(await readFile(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'package.json'), 'utf8'));
    expect(pkg.exports['./worker']).toBe('./src/worker.ts');
  });
});

describe('TC-REG-6 (wiring-level): pacing overrides clamp per provider', () => {
  it('crux {rpm:500} through the factory still bounds the worst window at 150', async () => {
    const clock = new FakeClock(NOW);
    const deps = makeDeps(fakeFetcher(() => jsonResponse('{"record":{"metrics":{}}}')), clock, {
      env: { LUMEN_CRUX_KEY: 'k' },
    });
    const providers = createBuiltInProviders({ crux: { rpm: 500 } }, deps);
    // 10 immediate + the 11th must wait (fetcher responses are instant; clock only moves via sleep)
    const target = new URL('https://example.com/');
    const crux = providers.crux as CruxProvider;
    const first = await Promise.all(
      Array.from({ length: 10 }, (_, i) => crux.record(new URL(`https://example.com/p${i}`), {})),
    );
    expect(first).toHaveLength(10);
    expect(clock.current).toBeCloseTo(NOW, 6); // full burst, no waiting (µs FP noise at most)
    const promise = crux.record(target, {});
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // 11th is parked in the pacer's injected sleep
  });
});
