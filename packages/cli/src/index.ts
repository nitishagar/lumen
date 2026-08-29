/**
 * @lumen-seo/cli — programmatic surface (the bin is `bin/lumen.js`).
 * Commands live under `src/cmd/`; `run()` is the exit-code contract (E1).
 */
export const packageName = '@lumen-seo/cli';
export { run } from './run.js';
export type { CliContext } from './run.js';
export { clean, cleanLines } from './term.js';
export { UsageError } from './usage-error.js';
export { loadCliConfig, resolveConfigPath, resolveHistoryDir } from './cli-config.js';
