#!/usr/bin/env node
/**
 * `lumen` bin (E1/E2). The workspace ships TypeScript sources (BA-13 — no
 * build step until M2 publishing), so this entry:
 *
 *  1. ensures Node can execute TypeScript (native stripping on Node >= 22.18
 *     / 23.6+; re-execs once with --experimental-strip-types on 22.6–22.17);
 *  2. registers the `.js` → `.ts` resolve remap for intra-package imports;
 *  3. imports `src/run.ts` and sets `process.exitCode` — NEVER process.exit()
 *     on success paths, so stdout always flushes (E2).
 */
const needStripFlag = process.features.typescript === undefined;

if (needStripFlag) {
  // Node 22.6–22.17: type stripping exists behind a flag. Re-exec the same
  // command once with it enabled; the flag is on by default from 22.18 on.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env },
  );
  process.exitCode = result.status ?? 2;
} else {
  const { register } = await import('node:module');
  register('./ts-remap-loader.mjs', import.meta.url);
  const { run } = await import('../src/run.ts');
  process.exitCode = await run(process.argv.slice(2));
}
