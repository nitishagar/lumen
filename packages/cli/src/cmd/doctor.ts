/**
 * `lumen doctor` (PRD E0.4 FR-2): honest setup report.
 *
 * Plain mode makes ZERO network calls. `--online` makes exactly one paced,
 * cached probe per ready provider THROUGH the provider objects themselves
 * (their GCRA pacers and caches apply); unconfigured providers are never
 * called (no key, no call). Being unconfigured is never an error; a broken
 * configured provider or an invalid config file exits 2. Env-var NAMES are
 * printed — values are never read into any output (I16).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXIT } from '@lumen-seo/core';
import type {
  AnyProvider,
  AuthorityProvider,
  CruxProvider,
  KeywordProvider,
  PageSpeedProvider,
  ProviderBoundary,
  ResolvedConfig,
  SerpProvider,
} from '@lumen-seo/core';
import { BUILTIN_PROVIDER_NAMES, PROVIDER_CAPABILITIES, resolveEnvVar } from '@lumen-seo/providers';
import type { CliContext } from '../run.js';
import { loadCliConfig, resolveConfigPath } from '../cli-config.js';
import { availableProviders } from '../composition/available.js';
import { jsonDocument } from '../io.js';
import { clean } from '../term.js';

type BuiltinProviderName = (typeof BUILTIN_PROVIDER_NAMES)[number];
export type ProviderHealth = 'ready' | 'not-configured' | 'disabled'; // 'disabled' reserved — no enablement config exists today

export interface ProviderStatus {
  readonly name: BuiltinProviderName;
  readonly boundary: ProviderBoundary;
  readonly status: ProviderHealth;
  readonly envVar?: string;
  readonly signupUrl?: string;
  probe?: 'ok' | 'broken';
  reason?: string;
}

const KEYED_SIGNUP_URLS: Partial<Record<BuiltinProviderName, string>> = {
  pagespeed: 'https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com',
  crux: 'https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com',
  openpagerank: 'https://www.openpagerank.com/',
};

/** Env-var NAME for a provider: its config.byok override, else the scheme default ('' for keyless). */
export const envVarFor = (byok: Readonly<Record<string, string>>, name: BuiltinProviderName): string =>
  resolveEnvVar(name, byok[name] !== undefined ? { envVar: byok[name]! } : undefined);

/**
 * Provider statuses without any I/O: keyless builtins are ready; a keyed
 * provider is ready iff its resolved env var is set and non-empty.
 * `resolveEnvVar` is the single source for the name (byok override → default),
 * NOT `byokReady` — that returns true when no byok entry is declared, which
 * would report ready on a clean machine and violate the PRD acceptance.
 */
export const deriveProviderStatuses = (byok: Readonly<Record<string, string>>): ProviderStatus[] =>
  BUILTIN_PROVIDER_NAMES.map((name) => {
    const boundary = PROVIDER_CAPABILITIES[name];
    const envVar = envVarFor(byok, name);
    if (envVar === '') return { name, boundary, status: 'ready' as const };
    if ((process.env[envVar] ?? '').trim() === '') {
      return { name, boundary, status: 'not-configured' as const, envVar, signupUrl: KEYED_SIGNUP_URLS[name] };
    }
    return { name, boundary, status: 'ready' as const, envVar };
  });

/** The shipped engines contract is the CLI package's own manifest (the root one is private, never published). */
export const cliEnginesRange = (): string => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    engines?: { node?: string };
  };
  return manifest.engines?.node ?? 'unknown';
};

const ENGINES_RE = /^>=([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?$/;

/** Supports the only range style the shipped manifest declares (`>=X.Y[.Z]`); unknown shapes report honestly. */
export const satisfiesEngines = (version: string, range: string): boolean | undefined => {
  const m = ENGINES_RE.exec(range.trim());
  if (m === null) return undefined;
  const want = [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  const have = version.split('.').map((x) => Number(x));
  for (let i = 0; i < 3; i += 1) {
    const h = have[i] ?? 0;
    if (h > want[i]!) return true;
    if (h < want[i]!) return false;
  }
  return true;
};

const PROBE_URL = new URL('https://example.com');

/** One paced, cached probe per provider, through the provider object itself. */
export const probeProvider = async (p: AnyProvider, boundary: ProviderBoundary, signal: AbortSignal): Promise<void> => {
  // The providers map is keyed by capability by construction, so the
  // per-case cast is sound; the union itself cannot narrow on a boundary.
  switch (boundary) {
    case 'keywords':
      await (p as KeywordProvider).ideas('example', { signal });
      return;
    case 'serp':
      await (p as SerpProvider).search('example', { limit: 1, signal });
      return;
    case 'pagespeed':
      await (p as PageSpeedProvider).report(PROBE_URL, { strategy: 'mobile', signal });
      return;
    case 'crux':
      await (p as CruxProvider).record(PROBE_URL, { signal });
      return;
    case 'authority':
      await (p as AuthorityProvider).authority('example.com', { signal });
      return;
  }
};

/**
 * Probes every ready provider once; a typed failure marks that provider
 * broken and the loop continues (partial failure never aborts the report).
 * A provider missing from the registry counts as broken, not silently ready.
 */
export const probeProviders = async (
  providers: ProviderStatus[],
  registry: Readonly<Record<string, AnyProvider>>,
  signal: AbortSignal,
): Promise<number> => {
  let broken = 0;
  for (const p of providers) {
    if (p.status !== 'ready') continue; // no key, no call
    const impl = registry[p.name];
    if (impl === undefined) {
      p.probe = 'broken';
      p.reason = 'provider missing from the built-in registry';
      broken += 1;
      continue;
    }
    try {
      await probeProvider(impl, p.boundary, signal);
      p.probe = 'ok';
    } catch (err) {
      if (signal.aborted) throw err; // SIGINT stays a cancellation, not a broken provider
      p.probe = 'broken';
      p.reason = clean(err instanceof Error ? `${err.name}: ${err.message}` : String(err), 200);
      broken += 1;
    }
  }
  return broken;
};

/**
 * @param providersOverride test seam — replaces the real provider map for
 * `--online` probes (fixture providers); production dispatch passes nothing.
 */
export const execute = async (
  ctx: CliContext,
  providersOverride?: Readonly<Record<string, AnyProvider>>,
): Promise<number> => {
  const { io, signal } = ctx;
  const online = ctx.flags.online === true;
  const configPath = resolve(resolveConfigPath(ctx.configPathFlag));

  // An invalid config file is REPORTED, not fatal to the report: the provider
  // sections derive from an empty byok map (→ default env names) so the user
  // still learns what to set, while the exit code names the config error.
  let config: ResolvedConfig | undefined;
  let configError: string | undefined;
  try {
    config = (await loadCliConfig(ctx.configPathFlag)).config;
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }
  const providers = deriveProviderStatuses(config?.byok ?? {});

  let broken = 0;
  if (online && config !== undefined) {
    broken = await probeProviders(providers, providersOverride ?? availableProviders(config), signal);
  }

  const engines = cliEnginesRange();
  const satisfies = satisfiesEngines(process.versions.node, engines);
  const configExists = existsSync(configPath); // absent file loads as defaults — report that honestly
  const payload = {
    node: { version: process.versions.node, engines, satisfies },
    config: {
      path: configPath,
      valid: configError === undefined,
      ...(configError !== undefined ? { error: configError } : {}),
      ...(configExists ? {} : { exists: false }),
    },
    providers,
    online,
  };
  const exit = configError !== undefined || broken > 0 ? EXIT.CONFIG_ERROR : EXIT.OK;

  if (ctx.flags.json === true) {
    io.out(jsonDocument(payload));
    return exit;
  }
  io.out(
    `node: ${process.versions.node} (engines ${engines} — ${
      satisfies === undefined ? 'unknown range' : satisfies ? 'ok' : 'NOT satisfied'
    })\n`,
  );
  io.out(
    `config: ${clean(configPath)} — ${
      configError !== undefined
        ? `INVALID: ${clean(configError, 300)}`
        : configExists
          ? 'valid'
          : 'no config file — defaults in effect (run "lumen init" to write one)'
    }\n`,
  );
  io.out('providers:\n');
  for (const p of providers) {
    if (p.status === 'ready') {
      const probe = p.probe === 'ok' ? ' — probe ok' : p.probe === 'broken' ? ` — BROKEN: ${p.reason ?? ''}` : '';
      io.out(`  ${p.name} (${p.boundary}): ready${p.envVar !== undefined ? ` [${p.envVar}]` : ''}${probe}\n`);
    } else {
      io.out(
        `  ${p.name} (${p.boundary}): not-configured — set ${p.envVar}${p.signupUrl !== undefined ? ` — ${p.signupUrl}` : ''}\n`,
      );
    }
  }
  if (online) io.out(`doctor: ${broken} broken of ${providers.filter((x) => x.status === 'ready').length} probed\n`);
  return exit;
};
