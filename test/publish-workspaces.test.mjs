/**
 * Unit tests for scripts/ci/publish-workspaces.mjs — the tag-driven ordered
 * npm publish (ci-deploy PLAN Phase 6, TDD).
 *
 * Contract under test (PLAN Phase 6 + IMPLICIT_SPEC I14/I17):
 *  - Tag is validated as SemVer (`v0.1.0` ⇒ `0.1.0`); anything else is a typed error.
 *  - Publish set = the product workspaces under `packages/` (site excluded).
 *  - Publish order = topological over internal workspace deps (dependencies
 *    first), deterministic (alphabetical tie-break); a cycle is a typed error.
 *  - Every workspace manifest is rewritten to the tag version in memory and
 *    (in real mode) on the runner-local disk for npm to read: version set,
 *    internal `@lumen-seo/*` dep ranges pinned to the exact tag version,
 *    `private` cleared — the repo checkout is restored afterwards and NEVER
 *    committed (IMPLICIT_SPEC E5).
 *  - Publish command is exactly `npm publish -w <pkg> --access public --tag latest`.
 *  - Duplicate publish at the same version = idempotent success: status ∈
 *    {403, 409} OR message matches /cannot publish over/i (npm signals the
 *    conflict as EPUBLISHCONFLICT/403 today, 409 legacy).
 *  - Registry-lag E404 is retried with bounded backoff: 3 attempts / 15 s
 *    (I17); other failures are typed errors naming the package, no retries.
 *  - `--dry-run` prints the ordered plan, runs nothing, writes nothing.
 *
 * All runner interaction is injected (no registry calls, no network — I10).
 */
import { describe, expect, it, onTestFinished } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PublishScriptError,
  classifyFailure,
  loadPublishableWorkspaces,
  npmPublishArgs,
  parseTag,
  publishWorkspaces,
  rewriteManifest,
  topoOrder,
} from '../scripts/ci/publish-workspaces.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/ci/publish-workspaces.mjs', import.meta.url));
const FIXTURE_LOCK = fileURLToPath(new URL('./fixtures/package-lock.json', import.meta.url));
const ARCH_GRAPH = JSON.parse(readFileSync(FIXTURE_LOCK, 'utf8')); // the M2 architecture graph (mcp → audit+providers, cli → audit+mcp+providers)

describe('parseTag — SemVer validation (PLAN Phase 6)', () => {
  it('maps v0.1.0 to 0.1.0', () => {
    expect(parseTag('v0.1.0')).toBe('0.1.0');
  });

  it('accepts a full SemVer with prerelease and build metadata', () => {
    expect(parseTag('v1.2.3-rc.1+build.5')).toBe('1.2.3-rc.1+build.5');
  });

  it('rejects malformed tags with a typed error naming the tag', () => {
    for (const bad of ['v1.2', 'v01.2.3', 'release-1', 'v', '']) {
      try {
        parseTag(bad);
        expect.unreachable(`${JSON.stringify(bad)} should have been rejected`);
      } catch (err) {
        expect(err).toBeInstanceOf(PublishScriptError);
        expect(err.kind).toBe('invalid-tag');
        expect(err.message).toContain(bad === '' ? '--tag' : bad);
      }
    }
  });
});

describe('loadPublishableWorkspaces — publish set from the lockfile', () => {
  it('selects exactly the five product packages from the architecture graph', () => {
    const ws = loadPublishableWorkspaces(ARCH_GRAPH);
    expect([...ws.keys()].sort()).toEqual([
      '@lumen-seo/audit',
      '@lumen-seo/cli',
      '@lumen-seo/core',
      '@lumen-seo/mcp',
      '@lumen-seo/providers',
    ]);
  });

  it('excludes the private site workspace (root-level, not under packages/)', () => {
    const ws = loadPublishableWorkspaces(ARCH_GRAPH);
    expect(ws.has('@lumen-seo/site')).toBe(false);
  });

  it('captures internal dependency edges for ordering', () => {
    const ws = loadPublishableWorkspaces(ARCH_GRAPH);
    expect(ws.get('@lumen-seo/audit').deps).toEqual(['@lumen-seo/core']);
    expect(ws.get('@lumen-seo/cli').deps).toEqual(['@lumen-seo/audit', '@lumen-seo/mcp', '@lumen-seo/providers']);
    expect(ws.get('@lumen-seo/core').deps).toEqual([]);
  });

  it('throws a typed lockfile error on a structurally useless lockfile', () => {
    for (const bad of [null, {}, { packages: null }, { lockfileVersion: 3 }]) {
      try {
        loadPublishableWorkspaces(bad);
        expect.unreachable(`${JSON.stringify(bad)} should have been rejected`);
      } catch (err) {
        expect(err).toBeInstanceOf(PublishScriptError);
        expect(err.kind).toBe('lockfile');
      }
    }
  });

  it('throws a typed error when no publishable workspace exists', () => {
    try {
      loadPublishableWorkspaces({ packages: { site: { name: '@lumen-seo/site' } } });
      expect.unreachable('site-only lockfile should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(PublishScriptError);
      expect(err.kind).toBe('no-workspaces');
    }
  });
});

describe('topoOrder — deterministic dependency-first publish order', () => {
  it('orders the architecture graph core → audit → providers → mcp → cli', () => {
    const ws = loadPublishableWorkspaces(ARCH_GRAPH);
    const edges = new Map([...ws.values()].map((w) => [w.name, w.deps]));
    expect(topoOrder([...ws.keys()], edges)).toEqual([
      '@lumen-seo/core',
      '@lumen-seo/audit',
      '@lumen-seo/providers',
      '@lumen-seo/mcp',
      '@lumen-seo/cli',
    ]);
  });

  it('is deterministic across runs', () => {
    const ws = loadPublishableWorkspaces(ARCH_GRAPH);
    const edges = new Map([...ws.values()].map((w) => [w.name, w.deps]));
    const first = topoOrder([...ws.keys()], edges);
    for (let i = 0; i < 5; i++) expect(topoOrder([...ws.keys()], edges)).toEqual(first);
  });

  it('puts independent packages in alphabetical order', () => {
    const names = ['@lumen-seo/cli', '@lumen-seo/audit', '@lumen-seo/core'];
    expect(topoOrder(names, new Map(names.map((n) => [n, []])))).toEqual([
      '@lumen-seo/audit',
      '@lumen-seo/cli',
      '@lumen-seo/core',
    ]);
  });

  it('rejects a dependency cycle with a typed error naming the members', () => {
    const names = ['a', 'b'];
    const edges = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ]);
    try {
      topoOrder(names, edges);
      expect.unreachable('cycle should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(PublishScriptError);
      expect(err.kind).toBe('cycle');
      expect(err.message).toContain('a');
      expect(err.message).toContain('b');
    }
  });
});

describe('rewriteManifest — runner-local version + internal dep pinning', () => {
  const internalNames = new Set(['@lumen-seo/core', '@lumen-seo/audit']);

  it('sets the exact tag version', () => {
    const out = rewriteManifest({ name: '@lumen-seo/audit', version: '0.0.0' }, '0.1.0', internalNames);
    expect(out.version).toBe('0.1.0');
  });

  it('pins internal dep ranges to the exact tag version in every dep section', () => {
    const manifest = {
      name: '@lumen-seo/cli',
      version: '0.0.0',
      dependencies: { '@lumen-seo/audit': '*', '@lumen-seo/core': '^0.0.0' },
      devDependencies: { '@lumen-seo/core': 'workspace:*' },
      optionalDependencies: { '@lumen-seo/audit': '~0' },
      peerDependencies: { '@lumen-seo/core': '>' },
    };
    const out = rewriteManifest(manifest, '0.1.0', internalNames);
    expect(out.dependencies).toEqual({ '@lumen-seo/audit': '0.1.0', '@lumen-seo/core': '0.1.0' });
    expect(out.devDependencies).toEqual({ '@lumen-seo/core': '0.1.0' });
    expect(out.optionalDependencies).toEqual({ '@lumen-seo/audit': '0.1.0' });
    expect(out.peerDependencies).toEqual({ '@lumen-seo/core': '0.1.0' });
  });

  it('leaves external dependency ranges untouched', () => {
    const manifest = {
      name: '@lumen-seo/audit',
      version: '0.0.0',
      dependencies: { '@lumen-seo/core': '*', cheerio: '^1.2.0' },
    };
    expect(rewriteManifest(manifest, '0.1.0', internalNames).dependencies.cheerio).toBe('^1.2.0');
  });

  it('clears the private flag so npm publish accepts the package', () => {
    const out = rewriteManifest({ name: '@lumen-seo/core', version: '0.0.0', private: true }, '0.1.0', internalNames);
    expect('private' in out).toBe(false);
  });

  it('does not mutate the input manifest', () => {
    const manifest = { name: '@lumen-seo/core', version: '0.0.0', private: true, dependencies: { '@lumen-seo/audit': '*' } };
    rewriteManifest(manifest, '0.1.0', internalNames);
    expect(manifest).toEqual({ name: '@lumen-seo/core', version: '0.0.0', private: true, dependencies: { '@lumen-seo/audit': '*' } });
  });
});

describe('npmPublishArgs — the exact publish command (PLAN Phase 6)', () => {
  it('is npm publish -w <pkg> --access public --tag latest', () => {
    expect(npmPublishArgs('@lumen-seo/core')).toEqual([
      'publish',
      '-w',
      '@lumen-seo/core',
      '--access',
      'public',
      '--tag',
      'latest',
    ]);
  });
});

describe('classifyFailure — registry response semantics (I14)', () => {
  it('classifies the modern EPUBLISHCONFLICT 403 message as a duplicate', () => {
    const res = { status: 1, stdout: '', stderr: 'npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.1.0.' };
    expect(classifyFailure(res)).toEqual({ kind: 'duplicate', status: '403' });
  });

  it('classifies the legacy 409 status as a duplicate', () => {
    const res = { status: 1, stdout: '', stderr: 'npm error code E409\nnpm error 409 Conflict — cannot publish over the previously published version 0.1.0.' };
    expect(classifyFailure(res)).toEqual({ kind: 'duplicate', status: '409' });
  });

  it('classifies a bare 403 status line as a duplicate even without the message', () => {
    const res = { status: 1, stdout: '', stderr: 'npm error code E403\nnpm error 403 Forbidden - PUT https://registry.npmjs.org/@lumen-seo%2fcore' };
    expect(classifyFailure(res)).toEqual({ kind: 'duplicate', status: '403' });
  });

  it('classifies the message-only duplicate form even without a numeric status', () => {
    const res = { status: 1, stdout: 'npm ERR! You cannot publish over the previously published versions: 0.1.0.', stderr: '' };
    expect(classifyFailure(res)).toEqual({ kind: 'duplicate', status: undefined });
  });

  it('classifies E404 as the retryable registry-lag kind', () => {
    const res = { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/@lumen-seo%2faudit' };
    expect(classifyFailure(res)).toEqual({ kind: 'e404', status: '404' });
  });

  it('classifies anything else as a hard publish failure', () => {
    const res = { status: 1, stdout: '', stderr: 'npm error code ENEEDAUTH\nnpm error This operation requires a valid auth token' };
    expect(classifyFailure(res).kind).toBe('publish-failed');
  });

  it('is driven by the combined output, not just stderr', () => {
    const res = { status: 1, stdout: 'npm error 403 You cannot publish over the previously published versions: 0.1.0.', stderr: '' };
    expect(classifyFailure(res).kind).toBe('duplicate');
  });
});

describe('publishWorkspaces — ordered publish with injected runner (no registry)', () => {
  const ARCH_MANIFESTS = {
    'packages/core': { name: '@lumen-seo/core', version: '0.0.0', private: true },
    'packages/audit': { name: '@lumen-seo/audit', version: '0.0.0', private: true, dependencies: { '@lumen-seo/core': '*', cheerio: '^1.2.0' } },
    'packages/providers': { name: '@lumen-seo/providers', version: '0.0.0', private: true, dependencies: { '@lumen-seo/core': '*' } },
    'packages/mcp': { name: '@lumen-seo/mcp', version: '0.0.0', private: true, dependencies: { '@lumen-seo/audit': '*', '@lumen-seo/providers': '*' } },
    'packages/cli': { name: '@lumen-seo/cli', version: '0.0.0', private: true, dependencies: { '@lumen-seo/audit': '*', '@lumen-seo/mcp': '*', '@lumen-seo/providers': '*' } },
    site: { name: '@lumen-seo/site', version: '0.0.0', private: true },
  };

  const RESULT_OK = { status: 0, stdout: '', stderr: '' };
  const DUP_403 = { status: 1, stdout: '', stderr: 'npm error 403 You cannot publish over the previously published versions: 0.1.0.' };
  const NOT_FOUND = { status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/nope' };

  function makeRoot(t, lock, manifests) {
    const root = mkdtempSync(join(tmpdir(), 'lumen-publish-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    for (const [dir, manifest] of Object.entries(manifests)) {
      const abs = join(root, dir);
      mkdirSync(abs, { recursive: true });
      writeFileSync(join(abs, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return root;
  }

  it('publishes all five packages in dependency order with rewritten manifests on disk', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const calls = [];
    const diskDuringPublish = {};
    const publishFn = async (name) => {
      calls.push(name);
      const dir = root === null ? null : { '@lumen-seo/core': 'packages/core', '@lumen-seo/audit': 'packages/audit', '@lumen-seo/providers': 'packages/providers', '@lumen-seo/mcp': 'packages/mcp', '@lumen-seo/cli': 'packages/cli' }[name];
      diskDuringPublish[name] = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
      return RESULT_OK;
    };
    const result = await publishWorkspaces({ tag: 'v0.1.0', lock: ARCH_GRAPH, root, publishFn });
    expect(calls).toEqual(['@lumen-seo/core', '@lumen-seo/audit', '@lumen-seo/providers', '@lumen-seo/mcp', '@lumen-seo/cli']);
    expect(result.version).toBe('0.1.0');
    expect(result.results.map((r) => [r.name, r.outcome])).toEqual([
      ['@lumen-seo/core', 'published'],
      ['@lumen-seo/audit', 'published'],
      ['@lumen-seo/providers', 'published'],
      ['@lumen-seo/mcp', 'published'],
      ['@lumen-seo/cli', 'published'],
    ]);
    // the on-disk manifest npm saw was the rewritten one
    expect(diskDuringPublish['@lumen-seo/audit'].version).toBe('0.1.0');
    expect(diskDuringPublish['@lumen-seo/audit'].dependencies['@lumen-seo/core']).toBe('0.1.0');
    expect(diskDuringPublish['@lumen-seo/audit'].dependencies.cheerio).toBe('^1.2.0');
    expect('private' in diskDuringPublish['@lumen-seo/core']).toBe(false);
  });

  it('restores the original checkout byte-for-byte after the run (E5: nothing to commit)', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const before = new Map();
    for (const dir of Object.keys(ARCH_MANIFESTS)) before.set(dir, readFileSync(join(root, dir, 'package.json'), 'utf8'));
    await publishWorkspaces({ tag: 'v0.1.0', lock: ARCH_GRAPH, root, publishFn: async () => RESULT_OK });
    for (const dir of Object.keys(ARCH_MANIFESTS)) {
      expect(readFileSync(join(root, dir, 'package.json'), 'utf8')).toBe(before.get(dir));
    }
  });

  it('treats a duplicate publish (403 cannot publish over) as idempotent success and continues', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const calls = [];
    const result = await publishWorkspaces({
      tag: 'v0.1.0',
      lock: ARCH_GRAPH,
      root,
      publishFn: async (name) => {
        calls.push(name);
        return name === '@lumen-seo/audit' ? DUP_403 : RESULT_OK;
      },
    });
    expect(calls).toHaveLength(5);
    expect(result.results.find((r) => r.name === '@lumen-seo/audit').outcome).toBe('duplicate');
  });

  it('retries registry-lag E404 with bounded backoff — 3 attempts, 15 s apart (I17)', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const attempts = [];
    const sleeps = [];
    const result = await publishWorkspaces({
      tag: 'v0.1.0',
      lock: ARCH_GRAPH,
      root,
      publishFn: async (name) => {
        attempts.push(name);
        return name === '@lumen-seo/audit' && attempts.filter((n) => n === '@lumen-seo/audit').length < 3 ? NOT_FOUND : RESULT_OK;
      },
      sleep: async (ms) => sleeps.push(ms),
    });
    expect(attempts.filter((n) => n === '@lumen-seo/audit')).toHaveLength(3);
    expect(sleeps).toEqual([15000, 15000]);
    expect(result.results.find((r) => r.name === '@lumen-seo/audit').outcome).toBe('published');
  });

  it('fails with a typed error naming the package when E404 retries are exhausted', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const calls = [];
    const sleeps = [];
    try {
      await publishWorkspaces({
        tag: 'v0.1.0',
        lock: ARCH_GRAPH,
        root,
        publishFn: async (name) => {
          calls.push(name);
          return name === '@lumen-seo/audit' ? NOT_FOUND : RESULT_OK;
        },
        sleep: async (ms) => sleeps.push(ms),
      });
      expect.unreachable('exhausted E404 should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PublishScriptError);
      expect(err.pkg).toBe('@lumen-seo/audit');
      expect(err.kind).toBe('e404');
      expect(err.message).toContain('@lumen-seo/audit');
    }
    expect(sleeps).toEqual([15000, 15000]); // 3 attempts ⇒ 2 backoffs
    expect(calls).toEqual(['@lumen-seo/core', '@lumen-seo/audit', '@lumen-seo/audit', '@lumen-seo/audit']);
  });

  it('fails fast with a typed error on an unclassified failure — no retries, later packages untouched', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const calls = [];
    const sleeps = [];
    try {
      await publishWorkspaces({
        tag: 'v0.1.0',
        lock: ARCH_GRAPH,
        root,
        publishFn: async (name) => {
          calls.push(name);
          return name === '@lumen-seo/audit'
            ? { status: 1, stdout: '', stderr: 'npm error code ENEEDAUTH\nnpm error auth required' }
            : RESULT_OK;
        },
        sleep: async (ms) => sleeps.push(ms),
      });
      expect.unreachable('ENEEDAUTH should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PublishScriptError);
      expect(err.pkg).toBe('@lumen-seo/audit');
      expect(err.kind).toBe('publish-failed');
    }
    expect(sleeps).toEqual([]);
    expect(calls).toEqual(['@lumen-seo/core', '@lumen-seo/audit']);
  });

  it('restores manifests even when a publish fails mid-run', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const coreRaw = readFileSync(join(root, 'packages/core/package.json'), 'utf8');
    await publishWorkspaces({
      tag: 'v0.1.0',
      lock: ARCH_GRAPH,
      root,
      publishFn: async (name) => (name === '@lumen-seo/audit' ? { status: 1, stdout: '', stderr: 'npm error code ENEEDAUTH' } : RESULT_OK),
    }).catch(() => {});
    expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toBe(coreRaw);
  });

  it('dry-run: runs nothing and writes nothing, but returns the ordered plan', async (t) => {
    const root = makeRoot(t, ARCH_GRAPH, ARCH_MANIFESTS);
    const before = new Map();
    for (const dir of Object.keys(ARCH_MANIFESTS)) before.set(dir, readFileSync(join(root, dir, 'package.json'), 'utf8'));
    let publishCalls = 0;
    const result = await publishWorkspaces({ tag: 'v0.1.0', lock: ARCH_GRAPH, root, dryRun: true, publishFn: async () => { publishCalls++; return RESULT_OK; } });
    expect(publishCalls).toBe(0);
    expect(result.version).toBe('0.1.0');
    expect(result.results).toBeUndefined(); // nothing was published
    expect(result.order).toEqual(['@lumen-seo/core', '@lumen-seo/audit', '@lumen-seo/providers', '@lumen-seo/mcp', '@lumen-seo/cli']);
    for (const dir of Object.keys(ARCH_MANIFESTS)) {
      expect(readFileSync(join(root, dir, 'package.json'), 'utf8')).toBe(before.get(dir));
    }
  });

  it('refuses to publish when a package depends on a non-publishable workspace', async (t) => {
    const lock = {
      packages: {
        'packages/cli': { name: '@lumen-seo/cli', dependencies: { '@lumen-seo/site': '*' } },
        site: { name: '@lumen-seo/site', version: '0.0.0' },
      },
    };
    const root = makeRoot(t, lock, {
      'packages/cli': { name: '@lumen-seo/cli', version: '0.0.0', private: true, dependencies: { '@lumen-seo/site': '*' } },
      site: { name: '@lumen-seo/site', version: '0.0.0', private: true },
    });
    let publishCalls = 0;
    try {
      await publishWorkspaces({ tag: 'v0.1.0', lock, root, publishFn: async () => { publishCalls++; return RESULT_OK; } });
      expect.unreachable('dep on a private workspace should have been rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(PublishScriptError);
      expect(err.pkg).toBe('@lumen-seo/cli');
      expect(err.kind).toBe('deps');
    }
    expect(publishCalls).toBe(0);
  });

  it('throws a typed error when a workspace manifest is missing or mismatched', async (t) => {
    const lock = { packages: { 'packages/core': { name: '@lumen-seo/core' } } };
    const root = makeRoot(t, lock, {});
    try {
      await publishWorkspaces({ tag: 'v0.1.0', lock, root, publishFn: async () => RESULT_OK });
      expect.unreachable('missing manifest should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PublishScriptError);
      expect(err.kind).toBe('manifest');
      expect(err.pkg).toBe('@lumen-seo/core');
    }
  });
});

describe('CLI — dry-run end-to-end (spawnSync, fixture lockfile)', () => {
  const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

  function runCli(args, cwd = REPO_ROOT) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd });
  }

  it('prints the ordered plan and exits 0 without touching the tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-publish-cli-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify(ARCH_GRAPH, null, 2)}\n`);
    for (const [dir, manifest] of Object.entries({
      'packages/core': { name: '@lumen-seo/core', version: '0.0.0', private: true },
      'packages/audit': { name: '@lumen-seo/audit', version: '0.0.0', private: true, dependencies: { '@lumen-seo/core': '*' } },
      'packages/providers': { name: '@lumen-seo/providers', version: '0.0.0', private: true, dependencies: { '@lumen-seo/core': '*' } },
      'packages/mcp': { name: '@lumen-seo/mcp', version: '0.0.0', private: true, dependencies: { '@lumen-seo/audit': '*', '@lumen-seo/providers': '*' } },
      'packages/cli': { name: '@lumen-seo/cli', version: '0.0.0', private: true, dependencies: { '@lumen-seo/audit': '*', '@lumen-seo/mcp': '*', '@lumen-seo/providers': '*' } },
      site: { name: '@lumen-seo/site', version: '0.0.0', private: true },
    })) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    const res = runCli(['--tag', 'v0.1.0', '--dry-run', '--lockfile', join(root, 'package-lock.json'), '--root', root]);
    expect(res.status).toBe(0);
    const lines = res.stdout.split('\n');
    const idx = (needle) => lines.findIndex((l) => l.includes(needle));
    expect(idx('version 0.1.0')).toBeGreaterThan(-1);
    expect(idx('DRY-RUN')).toBeGreaterThan(-1);
    const order = ['@lumen-seo/core', '@lumen-seo/audit', '@lumen-seo/providers', '@lumen-seo/mcp', '@lumen-seo/cli'].map((n) => idx(n));
    expect([...order].sort((a, b) => a - b)).toEqual(order); // strictly ascending in print order
    // nothing mutated
    expect(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).toContain('"0.0.0"');
  });

  it('uses the real repo lockfile when --root/--lockfile are omitted (default plan prints 5 packages)', () => {
    const res = runCli(['--tag', 'v0.1.0', '--dry-run']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('@lumen-seo/core');
    expect(res.stdout).toContain('@lumen-seo/cli');
    expect(res.stdout).not.toContain('@lumen-seo/site'); // site is not publishable
  });

  it('exits 2 on missing --tag (usage)', () => {
    const res = runCli(['--dry-run']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('--tag');
  });

  it('exits 2 on an unknown flag (usage)', () => {
    const res = runCli(['--tag', 'v0.1.0', '--frobnicate']);
    expect(res.status).toBe(2);
  });

  it('exits 1 on an invalid tag with the offending value named', () => {
    const res = runCli(['--tag', 'not-a-version', '--dry-run']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('not-a-version');
  });

  it('exits 1 on a lockfile dependency cycle, naming the members', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-publish-cycle-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const lock = {
      packages: {
        'packages/a': { name: '@lumen-seo/a', dependencies: { '@lumen-seo/b': '*' } },
        'packages/b': { name: '@lumen-seo/b', dependencies: { '@lumen-seo/a': '*' } },
      },
    };
    writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    for (const dir of ['packages/a', 'packages/b']) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), `${JSON.stringify({ name: dir === 'packages/a' ? '@lumen-seo/a' : '@lumen-seo/b', version: '0.0.0' }, null, 2)}\n`);
    }
    const res = runCli(['--tag', 'v0.1.0', '--dry-run', '--lockfile', join(root, 'package-lock.json'), '--root', root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('@lumen-seo/a');
    expect(res.stderr).toContain('@lumen-seo/b');
  });
});
