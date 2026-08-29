/**
 * @lumen-seo/core/node — the Node-only surface (BA-11 / SC-8). The MAIN entry
 * (src/index.ts) never imports this file, keeping the future Worker bundle
 * free of Node built-ins (I6); `entry-isolation.test.ts` enforces that.
 *
 * Hosted here:
 * - `createNodeFetcher` — the Phase 4 fetcher wired to `node:dns` so resolved
 *   IPs are validated pre-connect (BA-7);
 * - `loadPluginRules` — dynamic import + runtime shape validation of local
 *   AuditRule plugin modules (SC-8);
 * - `readConfigFile` / `loadConfigFromDisk` — the fs-backed config reader
 *   (ENOENT → null → defaults), so the Workers-safe `loadConfig` stays pure.
 */
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import type { ConfigFileReader } from './config.js';
import { LumenError } from './errors.js';
import { createFetcher } from './fetcher.js';
import type { Fetcher, FetcherOptions } from './fetcher.js';
import { looksLikeAuditRule } from './rules.js';
import type { AuditRule } from './rules.js';

/** `node:dns` lookup for the fetcher's `resolve` seam (all addresses). */
export const resolveDns = async (host: string): Promise<string[]> => {
  const results = await lookup(host, { all: true });
  return results.map((r) => r.address);
};

/** The guarded fetcher with Node DNS validation wired in (BA-7). */
export const createNodeFetcher = (opts: FetcherOptions = {}): Fetcher =>
  createFetcher({ ...opts, resolve: opts.resolve ?? resolveDns });

/** A plugin module failed to load or does not satisfy the AuditRule shape (SC-8). */
export class PluginLoadError extends LumenError {
  /** The config-declared path (as written) plus the resolved absolute path in the message. */
  readonly file: string;

  constructor(message: string, file: string) {
    super(message);
    this.file = file;
  }
}

export const loadPluginRules = async (
  paths: readonly string[],
  o: { cwd: string },
): Promise<AuditRule[]> => {
  const rules: AuditRule[] = [];
  for (const declared of paths) {
    const abs = resolvePath(o.cwd, declared);
    let mod: { default?: unknown };
    try {
      mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
    } catch (e) {
      throw new PluginLoadError(
        `failed to import plugin "${declared}" (${abs}): ${(e as Error).message}`,
        declared,
      );
    }
    const candidate = mod.default;
    if (!looksLikeAuditRule(candidate)) {
      throw new PluginLoadError(
        `plugin "${declared}" (${abs}) must default-export an AuditRule: ` +
          '{ readonly id: string; readonly severity: "error"|"warning"|"info"; readonly categories: string[]; check(page, o) }',
        declared,
      );
    }
    rules.push(candidate);
  }
  return rules;
};

/** Reads a config file's text; `null` when it does not exist (→ defaults). */
export const readConfigFile: ConfigFileReader = async (path) => {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
};

/** `loadConfig` composed with the fs-backed reader (cwd default per BA-14). */
export const loadConfigFromDisk = (path = 'lumen.config.json') => loadConfig(path, readConfigFile);
