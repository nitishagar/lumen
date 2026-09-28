/**
 * `lumen init` (PRD E0.4 FR-1): write a defaults `lumen.config.json` — BYOK
 * env-var NAMES only, never values (I16) — append `.lumen/` to `.gitignore`
 * when a git repo is detected, and print the next steps. Every written value
 * comes from the same constants the engine validates against, so the file is
 * loadable and registry-valid by construction. Refuses an existing config
 * without `--force`; the write is atomic so a crash cannot leave a half file.
 */
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_BUDGETS, EXIT } from '@lumen-seo/core';
import { onboardPayload } from '@lumen-seo/mcp';
import { BYOK_ENV_VARS } from '@lumen-seo/providers';
import type { CliContext } from '../run.js';
import { resolveConfigPath } from '../cli-config.js';
import { clean } from '../term.js';
import { UsageError } from '../usage-error.js';
import { writeFileAtomic } from '../write-atomic.js';

const SIGNUP_LINES = [
  '  LUMEN_PSI_KEY   https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com',
  '  LUMEN_CRUX_KEY  https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com',
  '  LUMEN_OPR_KEY   https://www.openpagerank.com/',
];

export const execute = async (ctx: CliContext): Promise<number> => {
  const { io } = ctx;
  const target = resolve(resolveConfigPath(ctx.configPathFlag));
  if (existsSync(target) && ctx.flags.force !== true) {
    throw new UsageError(`config already exists at ${target} — pass --force to overwrite`);
  }
  if (!existsSync(dirname(target))) {
    // Typed before any write — the atomic writer's ENOENT would otherwise surface as an internal error.
    throw new UsageError(`config directory does not exist: ${dirname(target)}`);
  }
  try {
    accessSync(dirname(target), constants.W_OK);
  } catch {
    // Same: EACCES at write time would surface as an internal error, not guidance.
    throw new UsageError(`config directory is not writable: ${dirname(target)}`);
  }
  const body = `${JSON.stringify(
    {
      failThreshold: 'error',
      crawl: { ...DEFAULT_BUDGETS },
      byok: { ...BYOK_ENV_VARS },
    },
    null,
    2,
  )}\n`;
  await writeFileAtomic(target, body);

  // `.lumen/` is local runtime state — ignore it when a git repo is detected
  // (worktrees carry `.git` as a file; both shapes count). Deduped, atomic.
  let gitignoreNote = '';
  if (existsSync(resolve('.git'))) {
    const gitignorePath = resolve('.gitignore');
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
    const hasEntry = existing.split('\n').some((line) => line.trim() === '.lumen/');
    if (!hasEntry) {
      const addition = '# lumen local runtime state\n.lumen/\n';
      const base =
        existing.length === 0 ? '' : existing.endsWith('\n') ? `${existing}\n` : `${existing}\n\n`;
      await writeFileAtomic(gitignorePath, `${base}${addition}`);
      gitignoreNote = ' (added .lumen/ to .gitignore)';
    }
  }

  io.out(`wrote ${clean(target)} (defaults — edit to taste)${gitignoreNote}\n`);
  io.out(`MCP: ${onboardPayload('claude')}\n`);
  io.out('optional keys — set the env var; lumen reads the value at call time (names only here, never values):\n');
  for (const line of SIGNUP_LINES) io.out(`${line}\n`);
  io.out('run "lumen doctor" to check setup.\n');
  return EXIT.OK;
};
