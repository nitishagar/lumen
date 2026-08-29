/**
 * CLI-side config/history path resolution (B12/B13, R9, E5).
 *
 * - config path: `--config` flag > `LUMEN_CONFIG` env > `./lumen.config.json`;
 * - history root: `LUMEN_HISTORY_DIR` env > `./.lumen/history`;
 * - BYOK: config stores env-var NAMES only; the effective map falls back to
 *   the three default names (E5). Values are read from the environment at
 *   call time and are NEVER persisted or printed (I16).
 */
import { resolve } from 'node:path';
import type { ResolvedConfig } from '@lumen-seo/core';
import { loadConfig } from '@lumen-seo/core';
import { readConfigFile } from '@lumen-seo/core/node';

export const resolveConfigPath = (flag?: string): string =>
  flag ?? process.env.LUMEN_CONFIG ?? 'lumen.config.json';

export const loadCliConfig = async (flag?: string): Promise<{ path: string; config: ResolvedConfig }> => {
  const path = resolveConfigPath(flag);
  const config = await loadConfig(path, readConfigFile);
  return { path, config };
};

export const resolveHistoryDir = (): string =>
  process.env.LUMEN_HISTORY_DIR ?? resolve('.', '.lumen', 'history');

/** Default env-var NAMES per capability (E5); `byok` in lumen.config.json overrides. */
export const DEFAULT_BYOK_ENV_NAMES: Readonly<Record<'psi' | 'crux' | 'opr', string>> = {
  psi: 'LUMEN_PSI_KEY',
  crux: 'LUMEN_CRUX_KEY',
  opr: 'LUMEN_OPR_KEY',
};

/** Effective BYOK map: config entries, else the three default names (E5). */
export const effectiveByok = (config: ResolvedConfig): Readonly<Record<string, string>> => {
  const entries = Object.entries(config.byok);
  return entries.length > 0 ? Object.fromEntries(entries) : { ...DEFAULT_BYOK_ENV_NAMES };
};

/** Reads a BYOK value at call time (never cached — I1/I16). */
export const readByokValue = (envName: string): string | undefined => process.env[envName];
