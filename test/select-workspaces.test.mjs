/**
 * Unit tests for scripts/ci/select-workspaces.mjs — the workspace-scoped
 * test selection gate (ci-deploy PLAN Phase 1, TDD).
 *
 * Contract under test (PLAN Phase 1):
 *  - Input: changed paths on stdin (CI pipes `git diff --name-only`), or
 *    `--base`/`--head` flags (the script runs `git diff` itself).
 *  - Parses `package-lock.json` `packages` entries into a workspace
 *    name<->dir map + dependency graph; `node_modules/*` and the root entry
 *    are not workspaces.
 *  - ALWAYS exits 0 and emits EXACTLY ONE `$GITHUB_OUTPUT`-ready line:
 *      scope=-w <name>[ -w <name>…]   (reverse-dependency closure, sorted)
 *      scope=ALL                      (fail-safe toward more testing)
 *  - Fail-safe ⇒ ALL: empty diff / no package paths / lockfile missing or
 *    malformed / unresolvable base / any unexpected error.
 *  - Value charset restricted to [A-Za-z0-9@/._- ] (npm names + `-w` flags).
 *
 * Tests run the real CLI (spawn + stdin) against the committed fixture
 * lockfile so the emitted `scope=` line is asserted byte-for-byte.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/ci/select-workspaces.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/package-lock.json', import.meta.url));
const MALFORMED = fileURLToPath(new URL('./fixtures/package-lock.malformed.json', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const OUTPUT_RE = /^scope=(ALL|-w [A-Za-z0-9@/._-]+( -w [A-Za-z0-9@/._-]+)*)\n$/;

function run(paths, { lockfile = FIXTURE, base, head, cwd } = {}) {
  const args = [SCRIPT];
  if (lockfile !== null) args.push('--lockfile', lockfile);
  if (base !== undefined) args.push('--base', base);
  if (head !== undefined) args.push('--head', head);
  return spawnSync(process.execPath, args, { encoding: 'utf8', input: paths, cwd });
}

function expectOneScopeLine(res, value) {
  expect(res.status).toBe(0);
  expect(res.stderr).toBe('');
  expect(res.stdout).toMatch(OUTPUT_RE);
  expect(res.stdout).toBe(`scope=${value}\n`);
  expect(res.stdout.split('\n').filter((l) => l !== '')).toHaveLength(1);
}

function git(cwd, args) {
  const res = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Nitish Agarwal',
      GIT_AUTHOR_EMAIL: '1592163+nitishagar@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'Nitish Agarwal',
      GIT_COMMITTER_EMAIL: '1592163+nitishagar@users.noreply.github.com',
    },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return (res.stdout || '').trim();
}

describe('select-workspaces.mjs — closure from the fixture lockfile', () => {
  it('expands a @seolite/core change to its full reverse-dependency closure', () => {
    expectOneScopeLine(run('packages/core/src/fetcher.ts\n'), '-w @seolite/audit -w @seolite/cli -w @seolite/core -w @seolite/mcp -w @seolite/providers');
  });

  it('expands a @seolite/providers change to its dependents', () => {
    expectOneScopeLine(run('packages/providers/src/index.ts\n'), '-w @seolite/cli -w @seolite/mcp -w @seolite/providers');
  });

  it('expands a @seolite/audit change to its dependents', () => {
    expectOneScopeLine(run('packages/audit/src/crawler.ts\n'), '-w @seolite/audit -w @seolite/cli -w @seolite/mcp');
  });

  it('expands a @seolite/mcp change to its dependents', () => {
    expectOneScopeLine(run('packages/mcp/src/worker.ts\n'), '-w @seolite/cli -w @seolite/mcp');
  });

  it('keeps a leaf change scoped to just that workspace', () => {
    expectOneScopeLine(run('packages/cli/src/index.ts\n'), '-w @seolite/cli');
  });

  it('scopes the site workspace (no dependents, no runtime deps on packages)', () => {
    expectOneScopeLine(run('site/content/docs.md\n'), '-w @seolite/site');
  });

  it('maps a changed path that IS the workspace directory itself', () => {
    expectOneScopeLine(run('packages/core\n'), '-w @seolite/audit -w @seolite/cli -w @seolite/core -w @seolite/mcp -w @seolite/providers');
  });

  it('does not let a longer sibling dir shadow a shorter prefix (packages/core2 ≠ packages/core)', () => {
    expectOneScopeLine(run('packages/core2/src/index.ts\n'), 'ALL');
  });

  it('unions and deduplicates several changed workspaces', () => {
    expectOneScopeLine(
      run('packages/audit/src/a.ts\npackages/providers/src/b.ts\npackages/audit/src/c.ts\n'),
      '-w @seolite/audit -w @seolite/cli -w @seolite/mcp -w @seolite/providers',
    );
  });

  it('ignores unmapped paths mixed with package paths (code change decides the scope)', () => {
    expectOneScopeLine(run('README.md\npackages/cli/src/index.ts\n.github/workflows/ci.yml\n'), '-w @seolite/cli');
  });
});

describe('select-workspaces.mjs — fail-safe ⇒ scope=ALL', () => {
  it('emits ALL for a docs-only diff (no package paths)', () => {
    expectOneScopeLine(run('README.md\n'), 'ALL');
  });

  it('emits ALL for an empty diff', () => {
    expectOneScopeLine(run(''), 'ALL');
  });

  it('emits ALL when a path only maps to node_modules / registry entries', () => {
    expectOneScopeLine(run('node_modules/vitest/dist/index.js\n'), 'ALL');
  });

  it('emits ALL when the lockfile is malformed', () => {
    expectOneScopeLine(run('packages/core/src/index.ts\n', { lockfile: MALFORMED }), 'ALL');
  });

  it('emits ALL when the lockfile does not exist', () => {
    expectOneScopeLine(run('packages/core/src/index.ts\n', { lockfile: join(tmpdir(), 'definitely-missing-lockfile.json') }), 'ALL');
  });

  it('emits ALL when --base cannot be resolved (flag mode, real git)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'select-ws-'));
    try {
      git(dir, ['init', '-q']);
      writeFileSync(join(dir, 'packages-core.txt'), 'x\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'chore: first']);
      const res = run('unused', { base: 'not-a-ref', head: 'HEAD', cwd: dir });
      expectOneScopeLine(res, 'ALL');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('select-workspaces.mjs — default lockfile (repo root) and flag mode', () => {
  it('uses ./package-lock.json when --lockfile is omitted and includes the changed core workspace', () => {
    const res = run('packages/core/src/fetcher.ts\n', { lockfile: null, cwd: REPO_ROOT });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(OUTPUT_RE);
    expect(res.stdout).toContain('-w @seolite/core');
  });

  it('uses ./package-lock.json for a docs-only diff ⇒ ALL (PLAN printf criterion)', () => {
    const res = run('README.md\n', { lockfile: null, cwd: REPO_ROOT });
    expectOneScopeLine(res, 'ALL');
  });

  it('computes changed paths itself from --base/--head (flag mode, real git)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'select-ws-'));
    try {
      git(dir, ['init', '-q']);
      git(dir, ['commit', '-q', '--allow-empty', '-m', 'chore: first']);
      const base = git(dir, ['rev-parse', 'HEAD']);
      mkdirSync(join(dir, 'packages', 'core', 'src'), { recursive: true });
      writeFileSync(join(dir, 'packages', 'core', 'src', 'fetcher.ts'), 'export {}\n');
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'feat: core fetcher']);
      const res = run('', { base, head: 'HEAD', cwd: dir });
      expectOneScopeLine(res, '-w @seolite/audit -w @seolite/cli -w @seolite/core -w @seolite/mcp -w @seolite/providers');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
