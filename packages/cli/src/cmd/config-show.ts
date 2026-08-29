/**
 * `lumen config show` (E5): the resolved config with BYOK env-var NAMES and a
 * `set: boolean` flag ONLY — values are never read here, never printed (I16).
 */
import { resolve } from 'node:path';
import { EXIT } from '@lumen-seo/core';
import type { CliContext } from '../run.js';
import { effectiveByok, loadCliConfig, resolveHistoryDir } from '../cli-config.js';
import { jsonDocument } from '../io.js';
import { clean } from '../term.js';

export const execute = async (ctx: CliContext): Promise<number> => {
  const { path, config } = await loadCliConfig(ctx.configPathFlag);
  const byok = effectiveByok(config);
  const payload = {
    configPath: resolve(path),
    failThreshold: config.failThreshold,
    providers: config.providers,
    crawl: config.crawl,
    byok: Object.entries(byok).map(([capability, envVar]) => ({
      capability,
      envVar,
      set: process.env[envVar] !== undefined,
    })),
    historyDir: resolveHistoryDir(),
  };
  const { io } = ctx;
  if (ctx.flags.json === true) {
    io.out(jsonDocument(payload));
    return EXIT.OK;
  }
  io.out(`config: ${clean(payload.configPath)}\n`);
  io.out(`failThreshold: ${clean(String(payload.failThreshold))}\n`);
  io.out(`history: ${clean(payload.historyDir)}\n`);
  io.out('providers:\n');
  const entries = Object.entries(payload.providers);
  if (entries.length === 0) io.out('  (defaults — none selected)\n');
  for (const [boundary, name] of entries) io.out(`  ${clean(boundary)}: ${clean(String(name))}\n`);
  io.out('byok (names only — values are never shown):\n');
  for (const b of payload.byok) {
    io.out(`  ${clean(b.capability)}: ${clean(b.envVar)} (${b.set ? 'set' : 'not set'})\n`);
  }
  return EXIT.OK;
};
