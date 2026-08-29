/**
 * Worker bundle self-cap check (E10): gzip the wrangler-emitted entry bundle
 * and fail loudly if it exceeds the 1.5 MB self-cap (platform hard limit 3 MB).
 * The self-cap exists to fail in CI before the platform's 1102/limit errors.
 * Run via `npm run check:size -w @lumen-seo/mcp` (chains `build:worker` first).
 */
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';

// wrangler --outdir emits the ENTRY-BASENAME bundle: main "worker/index.ts" -> dist/index.js
const file = new URL('../dist/index.js', import.meta.url);
if (!existsSync(file)) {
  console.error('no dist/index.js — run: npm run build:worker -w @lumen-seo/mcp');
  process.exit(2);
}
const gz = gzipSync(readFileSync(file)).length;
const LIMIT = 1_572_864; // 1.5 MB (E10)
console.log(`worker bundle ${Math.floor(gz / 1024)} KiB gzip / limit ${Math.floor(LIMIT / 1024)} KiB`);
if (gz > LIMIT) {
  console.error('WORKER BUNDLE OVER SELF-CAP — remove a dependency or raise cap consciously');
  process.exit(1);
}
