/**
 * Spawn helper for CLI contract tests (real child process, real bin, real
 * Node type-stripping path — the same path users hit via `npx @lumen-seo/cli`).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(pkgRoot, 'bin', 'lumen.js');

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** stdin data written once at start, then stdin is closed. */
  stdin?: string;
  /** Resolve as soon as the given predicate sees a stderr line (for SIGINT tests). */
  signalAfterMs?: number;
  signal?: 'SIGINT';
}

export const spawnCli = (
  args: readonly string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let sentSignal = false;
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
    if (opts.signalAfterMs !== undefined && opts.signal !== undefined) {
      setTimeout(() => {
        if (!sentSignal && child.exitCode === null) {
          sentSignal = true;
          child.kill(opts.signal);
        }
      }, opts.signalAfterMs);
    }
  });

/** Deterministic ISO clock injection for in-process command tests (I10). */
export const fixedClock = (iso: string): (() => string) => () => iso;
