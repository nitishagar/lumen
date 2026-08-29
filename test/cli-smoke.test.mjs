/**
 * Unit tests for scripts/ci/cli-smoke.mjs — the CLI/stdio-MCP smoke gate
 * (ci-deploy PLAN Phase 7, TDD).
 *
 * Contract under test (PLAN Phase 7):
 *  - The bin entry is resolved from `packages/cli/package.json` (string or
 *    object form, `lumen` preferred); with no bin the CLI surface has not
 *    landed yet → the smoke SKIPS cleanly with a ::notice:: and exits 0
 *    (E2 skip-when-unconfigured semantics applied to surface absence — the
 *    gate activates the moment the real CLI exposes `bin`, zero changes).
 *  - `<bin> --help` exits 0 and mentions `lumen`.
 *  - `<bin> config show --json` exits 0 and stdout parses as JSON (the CLI's
 *    plain `config show` prints human-readable text; ARCHITECTURE gates JSON
 *    behind `--json` on every command).
 *  - `<bin> mcp` answers a JSON-RPC `initialize` over stdio with a matching
 *    id and a non-empty `result.serverInfo.name` within the 10 s timeout,
 *    then is terminated.
 *  - Failures are typed errors naming the failed check; the CLI exits 1.
 *
 * The MCP handshake tests spawn REAL fixture server processes (no mocking of
 * the subject); everything is local and deterministic (I4: zero network;
 * I10: no wall-clock dependence beyond the explicit short timeout fixture).
 */
import { describe, expect, it, onTestFinished } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_TIMEOUT_MS,
  SmokeError,
  checkConfigShow,
  checkHelp,
  mcpInitializeHandshake,
  resolveBin,
  runSmoke,
} from '../scripts/ci/cli-smoke.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/ci/cli-smoke.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Executable fixture bin: an argument-dispatched fake `lumen` CLI. */
function makeBin(behavior = {}) {
  const cliDir = mkdtempSync(join(tmpdir(), 'lumen-cli-smoke-'));
  onTestFinished(() => rmSync(cliDir, { recursive: true, force: true }));
  const binDir = join(cliDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, 'lumen.mjs');
  writeFileSync(
    binPath,
    `#!/usr/bin/env node
const mode = process.argv[2] ?? '';
const b = ${JSON.stringify(behavior)};
if (mode === '--help') {
  if (b.helpStatus === 1) { process.stderr.write('boom\\n'); process.exit(1); }
  process.stdout.write(b.helpOutput ?? 'lumen — lightweight, pluggable, MCP-first SEO toolkit\\n');
  process.exit(0);
}
if (mode === 'config' && process.argv[3] === 'show') {
  if (b.configStatus === 1) { process.stderr.write('no config\\n'); process.exit(1); }
  if (!process.argv.includes('--json')) {
    // mirrors the real CLI surface (ARCHITECTURE: --json on every command):
    // plain "config show" prints human-readable text, JSON requires the flag
    process.stdout.write(b.configHumanOutput ?? 'config: /tmp/lumen.config.json\\nfailThreshold: error\\n');
    process.exit(0);
  }
  process.stdout.write(b.configOutput ?? '{"profile":"default","failThreshold":"error"}\\n');
  process.exit(0);
}
if (mode === 'mcp') {
  if (b.mcpExitImmediately) { process.exit(3); }
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let req;
      try { req = JSON.parse(line); } catch { continue; }
      if (req.method !== 'initialize') continue;
      if (b.mcpNoisyDeaf) { process.stderr.write('server hit an error state\\n'); } // written AFTER the request arrives → ordered before the parent's (generous) timer
      if (b.mcpDeaf || b.mcpNoisyDeaf) continue;
      if (b.mcpWrongId) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id + 7, result: { serverInfo: { name: 'lumen-mcp' } } }) + '\\n');
      } else if (b.mcpNoServerInfo) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }) + '\\n');
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: req.params.protocolVersion, serverInfo: { name: 'lumen-mcp', version: '0.0.0' } } }) + '\\n');
      }
    }
  });
  if (b.mcpDeaf || b.mcpNoisyDeaf) { setInterval(() => {}, 10000); } // stay alive (loop pinned) until the smoke kills us — a deaf server must never exit on its own
  else process.stdin.on('end', () => process.exit(0));
} else {
  process.stderr.write('unknown argv\\n');
  process.exit(2);
}
`,
  );
  chmodSync(binPath, 0o755);
  writeFileSync(join(cliDir, 'package.json'), `${JSON.stringify({ name: '@lumen-seo/cli', version: '0.0.0', bin: { lumen: './bin/lumen.mjs' } }, null, 2)}\n`);
  return { cliDir, binPath };
}

function makeCliDir(manifest) {
  const cliDir = mkdtempSync(join(tmpdir(), 'lumen-cli-nobin-'));
  onTestFinished(() => rmSync(cliDir, { recursive: true, force: true }));
  writeFileSync(join(cliDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return cliDir;
}

describe('resolveBin — bin resolution from packages/cli/package.json', () => {
  it('resolves the object form, preferring the lumen key', () => {
    const { cliDir } = makeBin({});
    const bin = resolveBin(cliDir);
    expect(bin).not.toBeNull();
    expect(bin.name).toBe('lumen');
    expect(bin.path).toBe(join(cliDir, 'bin', 'lumen.mjs'));
  });

  it('resolves the string bin form', () => {
    const cliDir = makeCliDir({ name: '@lumen-seo/cli', version: '0.0.0', bin: './cli.mjs' });
    const bin = resolveBin(cliDir);
    expect(bin).not.toBeNull();
    expect(bin.name).toBe('lumen');
    expect(bin.path).toBe(join(cliDir, 'cli.mjs'));
  });

  it('uses another key when lumen is absent from the object form', () => {
    const cliDir = makeCliDir({ name: '@lumen-seo/cli', version: '0.0.0', bin: { 'lumen-audit': './a.mjs' } });
    expect(resolveBin(cliDir)).toEqual({ name: 'lumen-audit', path: join(cliDir, 'a.mjs') });
  });

  it('returns null when no bin is declared (CLI surface not landed)', () => {
    const cliDir = makeCliDir({ name: '@lumen-seo/cli', version: '0.0.0' });
    expect(resolveBin(cliDir)).toBeNull();
  });

  it('returns null when bin is not a usable string/object', () => {
    const cliDir = makeCliDir({ name: '@lumen-seo/cli', version: '0.0.0', bin: 7 });
    expect(resolveBin(cliDir)).toBeNull();
  });
});

describe('checkHelp — <bin> --help exits 0 and mentions lumen', () => {
  it('accepts a zero-status help output naming the product', () => {
    expect(() => checkHelp({ status: 0, stdout: 'lumen v0.1.0', stderr: '' })).not.toThrow();
  });

  it('rejects a non-zero exit with a typed error naming the check', () => {
    try {
      checkHelp({ status: 1, stdout: 'lumen v0.1.0', stderr: 'boom' });
      expect.unreachable('non-zero --help should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('help');
      expect(err.message).toContain('--help');
    }
  });

  it('rejects output that never mentions lumen', () => {
    try {
      checkHelp({ status: 0, stdout: 'usage: thing', stderr: '' });
      expect.unreachable('help without the product name should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('help');
      expect(err.message).toContain('lumen');
    }
  });

  it('scans stderr too (some CLIs print help there)', () => {
    expect(() => checkHelp({ status: 0, stdout: '', stderr: 'lumen — SEO toolkit' })).not.toThrow();
  });
});

describe('checkConfigShow — <bin> config show exits 0 with JSON on stdout', () => {
  it('accepts zero-status JSON output', () => {
    const parsed = checkConfigShow({ status: 0, stdout: '{"profile":"default"}\n', stderr: '' });
    expect(parsed).toEqual({ profile: 'default' });
  });

  it('rejects non-zero exits with a typed error naming the check', () => {
    try {
      checkConfigShow({ status: 1, stdout: '', stderr: 'no config' });
      expect.unreachable('non-zero config show should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('config-show');
    }
  });

  it('rejects stdout that does not parse as JSON', () => {
    try {
      checkConfigShow({ status: 0, stdout: 'not json at all', stderr: '' });
      expect.unreachable('non-JSON config show should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('config-show');
      expect(err.message).toContain('JSON');
    }
  });

  it('rejects a JSON scalar instead of an object (config is a mapping)', () => {
    try {
      checkConfigShow({ status: 0, stdout: '42', stderr: '' });
      expect.unreachable('scalar config show should fail');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('config-show');
    }
  });
});

describe('mcpInitializeHandshake — JSON-RPC initialize over stdio (real processes)', () => {
  it('pins the plan-mandated 10 s default timeout', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10000);
  });

  it('completes against a compliant fixture server and reports serverInfo.name', async () => {
    const { cliDir } = makeBin({});
    const result = await mcpInitializeHandshake({
      command: resolveBin(cliDir).path,
      args: ['mcp'],
      timeoutMs: 5000,
    });
    expect(result.name).toBe('lumen-mcp');
    expect(result.raw.result.protocolVersion).toBe('2025-06-18');
  });

  it('sends a JSON-RPC initialize request with id 1 and the pinned protocol version', async () => {
    const { cliDir } = makeBin({});
    // the fixture echoes protocolVersion back — the happy-path assertion above
    // pins the request shape; here we pin the id matching contract on the response.
    const result = await mcpInitializeHandshake({ command: resolveBin(cliDir).path, timeoutMs: 5000 });
    expect(result.raw.id).toBe(1);
    expect(result.raw.jsonrpc).toBe('2.0');
  });

  it('rejects a response whose id does not match the request', async () => {
    const { cliDir } = makeBin({ mcpWrongId: true });
    try {
      await mcpInitializeHandshake({ command: resolveBin(cliDir).path, timeoutMs: 5000 });
      expect.unreachable('mismatched id should reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('mcp-initialize');
      expect(err.message).toContain('id');
    }
  });

  it('rejects a response without a non-empty result.serverInfo.name', async () => {
    const { cliDir } = makeBin({ mcpNoServerInfo: true });
    try {
      await mcpInitializeHandshake({ command: resolveBin(cliDir).path, timeoutMs: 5000 });
      expect.unreachable('missing serverInfo.name should reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('mcp-initialize');
      expect(err.message).toContain('serverInfo.name');
    }
  });

  it('rejects with a timeout error when the server never answers (short fixture timeout)', async () => {
    const { cliDir } = makeBin({ mcpDeaf: true });
    try {
      await mcpInitializeHandshake({ command: resolveBin(cliDir).path, timeoutMs: 250 });
      expect.unreachable('timeout should reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('mcp-initialize');
      expect(err.message).toContain('timed out');
    }
  });

  it('reports the drained server stderr in the timeout error (no pipe backpressure masking)', async () => {
    const { cliDir } = makeBin({ mcpNoisyDeaf: true });
    try {
      // generous budget: the pinned subject here is stderr DRAIN+REPORTING, not the timeout boundary (pinned by the deaf test above)
      await mcpInitializeHandshake({ command: resolveBin(cliDir).path, timeoutMs: 1500 });
      expect.unreachable('timeout should reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('mcp-initialize');
      expect(err.message).toContain('timed out');
      expect(err.message).toContain('server hit an error state');
    }
  });

  it('rejects when the server exits before answering', async () => {
    const { cliDir } = makeBin({ mcpExitImmediately: true });
    try {
      await mcpInitializeHandshake({ command: resolveBin(cliDir).path, timeoutMs: 5000 });
      expect.unreachable('early exit should reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SmokeError);
      expect(err.check).toBe('mcp-initialize');
    }
  });
});

describe('runSmoke — orchestration', () => {
  it('passes all three checks against a compliant fixture bin', async () => {
    const { cliDir } = makeBin({});
    const logs = [];
    const result = await runSmoke({ cliDir, timeoutMs: 5000, log: (m) => logs.push(m) });
    expect(result.skipped).toBe(false);
    expect(result.serverName).toBe('lumen-mcp');
    expect(logs.join('\n')).toContain('--help');
    expect(logs.join('\n')).toContain('config show');
    expect(logs.join('\n')).toContain('mcp');
  });

  it('skips cleanly (exit-ok semantics) when the CLI declares no bin', async () => {
    const cliDir = makeCliDir({ name: '@lumen-seo/cli', version: '0.0.0' });
    const logs = [];
    let spawns = 0;
    const result = await runSmoke({
      cliDir,
      log: (m) => logs.push(m),
      runBin: () => { spawns++; return { status: 0, stdout: '', stderr: '' }; },
      handshake: async () => { spawns++; return { name: 'x', raw: {} }; },
    });
    expect(result.skipped).toBe(true);
    expect(spawns).toBe(0);
    expect(logs.join('\n')).toContain('::notice::');
  });

  it('propagates the first failing check', async () => {
    const { cliDir } = makeBin({ helpStatus: 1 });
    await expect(runSmoke({ cliDir, timeoutMs: 5000, log: () => {} })).rejects.toBeInstanceOf(SmokeError);
  });
});

describe('cliSmokeMain — CLI surface', () => {
  function runMain(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
  }

  it('against a bin-less fixture (surface not landed): exits 0 with a ::notice:: skip', () => {
    // Synthetic fixture, deliberately NOT the live repo: the repo gains a real
    // `bin` the moment the CLI lands, so a repo-dependent assertion would
    // silently flip from "skip" to "full smoke" mid-integration.
    const cliDir = mkdtempSync(join(tmpdir(), 'lumen-cli-smoke-stub-'));
    onTestFinished(() => rmSync(cliDir, { recursive: true, force: true }));
    writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@lumen-seo/cli-stub', private: true }));
    const res = runMain(['--skip-build', '--cli-dir', cliDir]);
    expect(res.status).toBe(0);
    expect(`${res.stdout}${res.stderr}`).toContain('::notice::');
  });

  it('against a compliant fixture bin: all checks pass, exit 0', () => {
    const { cliDir } = makeBin({});
    const res = runMain(['--skip-build', '--cli-dir', cliDir]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('lumen-mcp');
  });

  it('against a broken fixture bin: exit 1 with the failing check named', () => {
    const { cliDir } = makeBin({ configOutput: 'not json' });
    const res = runMain(['--skip-build', '--cli-dir', cliDir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('config-show');
  });

  it('exits 2 on an unknown flag (usage)', () => {
    const res = runMain(['--frobnicate']);
    expect(res.status).toBe(2);
  });
});
