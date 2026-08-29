#!/usr/bin/env node
/**
 * cli-smoke.mjs — CLI / stdio-MCP smoke gate for `npm run validate`
 * (ci-deploy P6b, PLAN Phase 7).
 *
 * Usage:
 *   node scripts/ci/cli-smoke.mjs [--skip-build] [--cli-dir <dir>] [--timeout-ms <n>]
 *
 * Contract (PLAN Phase 7, renamed surface):
 *  - Builds `@lumen-seo/cli` if needed (`npm run build --if-present -w
 *    @lumen-seo/cli` — the --if-present lets the not-yet-landed stub skip
 *    cleanly, mirroring the P6a scoped-test runner).
 *  - Resolves the executable from `packages/cli/package.json` `bin` (string
 *    or object form, `lumen` preferred).
 *  - No `bin` ⇒ the CLI surface has not landed yet: the smoke prints a
 *    ::notice:: and exits 0 (E2 skip-when-unconfigured semantics, same design
 *    as the deploy-worker guard — the gate activates the moment the real CLI
 *    exposes `bin`, zero workflow/script changes).
 *  - With a bin present the smoke asserts, deterministically and with ZERO
 *    network (I4):
 *      (a) `<bin> --help` exits 0 and mentions `lumen`;
 *      (b) `<bin> config show --json` exits 0 and stdout parses as a JSON object
 *          (plain `config show` prints human-readable text — ARCHITECTURE gates
 *          JSON behind `--json` on every command);
 *      (c) `<bin> mcp` answers a JSON-RPC `initialize` request over stdio
 *          (matching id, non-empty `result.serverInfo.name`) within the
 *          10 s timeout, then is terminated.
 *  - No URL/audit checks: the SSRF guard refuses loopback targets by design
 *    (I12) — live-crawl behavior is covered by injected-fetcher unit tests in
 *    the owning packages.
 *
 * Exit codes: 0 green (or skipped) · 1 smoke failure (typed, names the check)
 * · 2 usage. Zero runtime dependencies.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const DEFAULT_TIMEOUT_MS = 10000; // PLAN Phase 7: initialize handshake budget (exported so tests pin the default)
const MCP_PROTOCOL_VERSION = '2025-06-18'; // latest MCP protocol revision; the SDK is intentionally not a dependency of this zero-dep gate
const BIN_CALL_TIMEOUT_MS = 60000; // --help / config show are local and instant; 60 s bounds a wedged CLI
const BUILD_TIMEOUT_MS = 300000; // one workspace build; bounds a hung npm build instead of the Actions job default
const LOG_PREFIX = 'cli-smoke';

/** Typed smoke failure: `.check` ∈ help|config-show|mcp-initialize. */
export class SmokeError extends Error {
  constructor(message, check) {
    super(message);
    this.name = 'SmokeError';
    this.check = check;
  }
}

function log(message) {
  process.stdout.write(`${LOG_PREFIX}: ${message}\n`);
}

/**
 * Resolve the CLI executable from `<cliDir>/package.json` `bin`. Returns
 * `{ name, path }` or null when the surface has not landed (no usable bin).
 */
export function resolveBin(cliDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
  } catch {
    return null; // unreadable manifest ⇒ surface not landed; the repo's own gates (typecheck/test) own manifest validity
  }
  const bin = manifest.bin;
  if (typeof bin === 'string' && bin !== '') return { name: 'lumen', path: resolve(cliDir, bin) };
  if (bin !== null && typeof bin === 'object') {
    const entry = Object.entries(bin).find(([key, value]) => typeof value === 'string' && value !== '' && key === 'lumen')
      ?? Object.entries(bin).find(([, value]) => typeof value === 'string' && value !== '');
    if (entry) return { name: entry[0], path: resolve(cliDir, entry[1]) };
  }
  return null;
}

/** (a) `<bin> --help` exits 0 and mentions `lumen` (stdout or stderr). */
export function checkHelp(res) {
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  if (res.status !== 0) throw new SmokeError(`--help exited with status ${res.status} (expected 0)`, 'help');
  if (!/lumen/i.test(out)) throw new SmokeError(`--help output does not mention "lumen": ${out.trim().split('\n')[0] || '(empty)'}`, 'help');
}

/** (b) `<bin> config show --json` exits 0 and stdout parses as a JSON object. */
export function checkConfigShow(res) {
  if (res.status !== 0) throw new SmokeError(`config show exited with status ${res.status} (expected 0): ${(res.stderr ?? '').trim().split('\n')[0] || '(no stderr)'}`, 'config-show');
  let parsed;
  try {
    parsed = JSON.parse((res.stdout ?? '').trim());
  } catch {
    throw new SmokeError(`config show stdout is not JSON: ${(res.stdout ?? '').trim().split('\n')[0] || '(empty)'}`, 'config-show');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SmokeError(`config show stdout is JSON but not an object: ${JSON.stringify(parsed)}`, 'config-show');
  }
  return parsed;
}

/**
 * (c) Spawn `<bin> mcp`, write a JSON-RPC `initialize` (id 1), and resolve
 * with the first matching response — id must equal the request id and
 * `result.serverInfo.name` must be a non-empty string. Rejects with a typed
 * SmokeError on timeout (child killed), early exit, or protocol violation.
 */
export function mcpInitializeHandshake({ command, args = ['mcp'], timeoutMs = DEFAULT_TIMEOUT_MS, protocolVersion = MCP_PROTOCOL_VERSION }) {
  const id = 1;
  const request = {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'lumen-ci-smoke', version: '0.0.0' } },
  };
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let buffer = '';
    let stderrTail = ''; // drained continuously so a chatty server cannot deadlock on a full pipe buffer
    const withStderr = (message) => (stderrTail.trim() !== '' ? `${message}; server stderr: ${stderrTail.trim().slice(-500)}` : message);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      rejectPromise(err);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM'); // terminate the server after the handshake (PLAN Phase 7)
      resolvePromise(value);
    };
    const timer = setTimeout(() => fail(new SmokeError(withStderr(`initialize handshake timed out after ${timeoutMs}ms with no response`), 'mcp-initialize')), timeoutMs);
    child.on('error', (err) => fail(new SmokeError(withStderr(`failed to spawn ${command}: ${err.message}`), 'mcp-initialize')));
    child.on('exit', (code) => fail(new SmokeError(withStderr(`mcp server exited before answering the initialize request (exit code ${code})`), 'mcp-initialize')));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });
    child.stderr.on('error', () => {}); // stream errors never own the outcome
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line === '') continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // tolerate banner lines; JSON-RPC responses are newline-delimited JSON
        }
        if (message === null || typeof message !== 'object' || message.id === undefined || message.method !== undefined) continue; // not a response
        if (message.id !== id) {
          fail(new SmokeError(`initialize response has id ${JSON.stringify(message.id)}, expected ${id}`, 'mcp-initialize'));
          return;
        }
        const name = message.result !== null && typeof message.result === 'object' ? message.result?.serverInfo?.name : undefined;
        if (typeof name !== 'string' || name === '') {
          fail(new SmokeError(`initialize response is missing a non-empty result.serverInfo.name: ${line.slice(0, 200)}`, 'mcp-initialize'));
          return;
        }
        succeed({ name, raw: message });
        return;
      }
    });
    child.stdin.on('error', () => {}); // EPIPE when the server dies mid-write — the exit/error handlers own the failure
    child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

/**
 * Run the whole smoke against `cliDir`. Injectable for unit tests: `runBin(argv)
 * → {status, stdout, stderr}` and `handshake(timeoutMs) → {name, raw}`.
 * Returns `{ skipped: true }` when the CLI surface has not landed.
 */
export async function runSmoke({ cliDir, timeoutMs = DEFAULT_TIMEOUT_MS, runBin, handshake, log: emit = log }) {
  const bin = resolveBin(cliDir);
  if (bin === null) {
    emit('::notice::@lumen-seo/cli has no bin entry yet — skipping the CLI/stdio-MCP smoke (the gate activates automatically when the CLI lands)');
    return { skipped: true };
  }
  emit(`smoking ${bin.name} at ${bin.path}`);

  const run = runBin ?? ((argv) => spawnSync(bin.path, argv, { encoding: 'utf8', timeout: BIN_CALL_TIMEOUT_MS }));

  emit('check (a): --help exits 0 and mentions lumen');
  checkHelp(run(['--help']));
  emit('check (a): ok');

  emit('check (b): config show --json exits 0 with JSON on stdout');
  checkConfigShow(run(['config', 'show', '--json']));
  emit('check (b): ok');

  emit('check (c): stdio MCP initialize handshake (matching id + serverInfo.name)');
  const doHandshake = handshake ?? (async () => mcpInitializeHandshake({ command: bin.path, args: ['mcp'], timeoutMs }));
  const result = await doHandshake();
  emit(`check (c): ok — serverInfo.name=${result.name}`);
  return { skipped: false, serverName: result.name };
}

function usage(message) {
  return `${message}\nusage: node scripts/ci/cli-smoke.mjs [--skip-build] [--cli-dir <dir>] [--timeout-ms <n>]`;
}

function parseArgs(argv) {
  const args = { skipBuild: false, cliDir: join(DEFAULT_ROOT, 'packages', 'cli'), timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=', 2);
    const value = () => (inlineValue !== undefined ? inlineValue : argv[++i]);
    switch (flag) {
      case '--skip-build': args.skipBuild = true; break;
      case '--cli-dir': args.cliDir = value(); break;
      case '--timeout-ms': args.timeoutMs = Number(value()); break;
      default: throw new SmokeError(usage(`unknown argument: ${argv[i]}`));
    }
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) throw new SmokeError(usage('--timeout-ms must be a positive number'));
  return args;
}

function buildCli(root) {
  // --if-present: the pre-surfaces stub has no build script; the real CLI builds when it lands.
  const res = spawnSync('npm', ['run', 'build', '--if-present', '-w', '@lumen-seo/cli'], { cwd: root, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS });
  if (res.status !== 0) throw new SmokeError(`npm run build -w @lumen-seo/cli exited with status ${res.status}: ${(res.stderr ?? res.stdout ?? '').trim().split('\n').slice(-3).join(' | ') || '(no output)'}`, 'build');
}

/** CLI entry. Returns the process exit code. */
export async function cliSmokeMain(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  try {
    if (!args.skipBuild) buildCli(DEFAULT_ROOT);
    const result = await runSmoke({ cliDir: resolve(args.cliDir) });
    if (result.skipped) return 0;
    log(`smoke green — ${result.serverName} answered the initialize handshake`);
    return 0;
  } catch (err) {
    const check = err instanceof SmokeError && err.check ? ` [${err.check}]` : '';
    process.stderr.write(`${LOG_PREFIX}: FAIL${check}: ${err.message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cliSmokeMain().then((code) => {
    process.exitCode = code;
  });
}
