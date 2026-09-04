#!/usr/bin/env node
/**
 * `lumen` bin (E1/E2). The workspace ships TypeScript sources (BA-13 — no
 * build step until M2 publishing), so this entry:
 *
 *  1. ensures Node executes TypeScript with the TRANSFORM lane. Strip-only
 *     lanes (the default without flags) cannot execute the real
 *     @lumen-seo/providers + @lumen-seo/audit engines — their sources use TS
 *     parameter properties (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX) — so one
 *     re-exec with `--experimental-transform-types` (Node 22.7+) is issued.
 *     The re-exec forwards SIGINT/SIGTERM/SIGHUP and relays the exit code so
 *     every spawn-tested shutdown contract (E14) holds for THIS process.
 *  2. registers the `.js` → `.ts` resolve remap for intra-package imports;
 *  3. imports `src/run.ts` and sets `process.exitCode` — NEVER process.exit()
 *     on success paths, so stdout always flushes (E2).
 */
const lane = process.features.typescript; // undefined | true | 'strip' | 'transform'
const { existsSync } = await import('node:fs');

// Published installs ship compiled dist/ — plain ESM, no flags, no loader.
// Node >= 22.18 refuses type-stripped .ts under node_modules in every lane,
// so the compiled entry is used ONLY in real installs (bin path under
// node_modules). Inside the repo workspace the sibling packages still export
// TypeScript sources, so those runs stay on the dev lanes below.
const distEntry = new URL('../dist/run.js', import.meta.url);
if (import.meta.url.includes('/node_modules/') && existsSync(distEntry)) {
  const { run } = await import(distEntry.href);
  process.exitCode = await run(process.argv.slice(2));
} else if (lane === 'transform' || lane === true) {
  const { register } = await import('node:module');
  register('./ts-remap-loader.mjs', import.meta.url);
  const { run } = await import('../src/run.ts');
  process.exitCode = await run(process.argv.slice(2));
} else {
  const { spawn } = await import('node:child_process');
  const child = spawn(
    process.execPath,
    ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env },
  );
  const forward = (sig) => child.kill(sig);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, forward);
  const code = await new Promise((resolve) => child.once('exit', (c) => resolve(c)));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(sig, forward);
  process.exitCode = code ?? 2;
}
