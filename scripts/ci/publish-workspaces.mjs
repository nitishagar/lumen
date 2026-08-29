#!/usr/bin/env node
/**
 * publish-workspaces.mjs — tag-driven ordered npm publish for the lumen
 * monorepo (ci-deploy P6b, PLAN Phase 6).
 *
 * Usage:
 *   node scripts/ci/publish-workspaces.mjs --tag v0.1.0 [--dry-run]
 *        [--root <dir>] [--lockfile <path>]
 *
 * Contract (PLAN Phase 6 + IMPLICIT_SPEC I14/I17/E5):
 *  - The tag is validated as SemVer (`v0.1.0` ⇒ `0.1.0`); anything else is a
 *    typed error. The workflow passes `github.ref_name` of a `v*` tag.
 *  - The publish set is the product workspaces under `packages/` (the private
 *    root-level `site` workspace is excluded) derived from
 *    `package-lock.json` — adding a workspace never requires editing this
 *    script or CI.
 *  - Publish order is topological over internal workspace dependencies
 *    (dependencies first, deterministic alphabetical tie-break): for the
 *    architecture graph this is core → audit → providers → mcp → cli. A
 *    dependency cycle is a typed error — publishing would be impossible.
 *  - Every workspace manifest is rewritten to the tag version: `version` set,
 *    internal dep ranges pinned to the exact tag version in all four dep
 *    sections, `private` cleared (npm refuses to publish private packages).
 *    In real mode the rewritten manifests are written to the runner-local
 *    checkout so `npm publish` reads them, and the ORIGINAL bytes are
 *    restored when the run ends (success or failure). Nothing is ever
 *    committed — workflows never push (E5).
 *  - Each package is published with exactly
 *    `npm publish -w <pkg> --access public --tag latest`.
 *  - Duplicate publish at the same version is IDEMPOTENT SUCCESS: npm signals
 *    it as EPUBLISHCONFLICT / HTTP 403 ("You cannot publish over the
 *    previously published versions"), 409 legacy — matched via status ∈
 *    {403, 409} OR message /cannot publish over/i. A rerun of a partially
 *    published set therefore completes green (I14).
 *  - Registry-lag E404 is retried with bounded backoff: 3 attempts, 15 s
 *    apart (I17). Any other failure is a typed error naming the package and
 *    stops the run immediately.
 *  - `--dry-run` prints the ordered plan and exits 0 without publishing or
 *    touching a single file.
 *
 * Exit codes: 0 ok (including idempotent duplicates) · 1 failure · 2 usage.
 * Zero runtime dependencies; deterministic; no network in dry-run mode.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..', '..');

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const MAX_ATTEMPTS = 3; // I17: bounded retry — 3 attempts total
const RETRY_DELAY_MS = 15000; // I17: 15 s backoff between attempts
const PUBLISH_TIMEOUT_MS = 600000; // bound a hung registry round-trip per attempt instead of the Actions job default
const NAMESPACE_PREFIX = '@lumen-seo/';

/** Full SemVer grammar (semver.org), anchored — no leading zeros, prerelease + build allowed. */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Typed error: `.kind` ∈ usage|invalid-tag|lockfile|no-workspaces|manifest|deps|cycle|e404|publish-failed, `.pkg` names the workspace where applicable. */
export class PublishScriptError extends Error {
  constructor(message, { kind, pkg } = {}) {
    super(message);
    this.name = 'PublishScriptError';
    this.kind = kind;
    this.pkg = pkg;
  }
}

/** `v0.1.0` → `0.1.0`; anything not full SemVer (with optional `v`) is a typed error. */
export function parseTag(raw) {
  const tag = typeof raw === 'string' ? raw.trim() : '';
  if (tag === '') throw new PublishScriptError('--tag is required (e.g. --tag v0.1.0)', { kind: 'invalid-tag' });
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (!SEMVER_RE.test(version)) {
    throw new PublishScriptError(`invalid SemVer tag "${tag}" — expected vMAJOR.MINOR.PATCH (e.g. v0.1.0)`, { kind: 'invalid-tag' });
  }
  return version;
}

function internalDeps(entry) {
  const deps = new Set();
  for (const section of DEP_SECTIONS) {
    const map = entry !== null && typeof entry === 'object' ? entry[section] : undefined;
    if (map === null || typeof map !== 'object') continue;
    for (const dep of Object.keys(map)) deps.add(dep);
  }
  return [...deps].filter((dep) => dep.startsWith(NAMESPACE_PREFIX)).sort();
}

/**
 * Publish set from the lockfile: workspaces whose directory is under
 * `packages/` (name → {name, dir, deps}). Root-level workspaces (the private
 * docs site) and registry/node_modules entries are excluded.
 */
export function loadPublishableWorkspaces(lock) {
  const packages = lock !== null && typeof lock === 'object' ? lock.packages : undefined;
  if (packages === undefined || packages === null || typeof packages !== 'object') {
    throw new PublishScriptError('lockfile has no usable "packages" map', { kind: 'lockfile' });
  }
  const byName = new Map();
  for (const [dir, entry] of Object.entries(packages)) {
    if (dir === '' || !dir.startsWith('packages/')) continue; // root + registry + root-level workspaces (site) are not publishable
    const name = entry !== null && typeof entry === 'object' ? entry.name : undefined;
    if (typeof name !== 'string' || name === '') {
      throw new PublishScriptError(`workspace at "${dir}" has no usable name in the lockfile`, { kind: 'lockfile' });
    }
    if (byName.has(name)) throw new PublishScriptError(`duplicate workspace name ${name} in the lockfile`, { kind: 'lockfile' });
    byName.set(name, { name, dir, deps: internalDeps(entry) });
  }
  if (byName.size === 0) throw new PublishScriptError('no publishable workspaces found under packages/', { kind: 'no-workspaces' });
  return byName;
}

/** Kahn topological sort over internal edges; alphabetical tie-break; cycle ⇒ typed error. */
export function topoOrder(names, edges) {
  const indegree = new Map(names.map((name) => [name, 0]));
  const dependents = new Map(names.map((name) => [name, []]));
  for (const [name, deps] of edges) {
    for (const dep of deps) {
      if (!indegree.has(name) || !indegree.has(dep)) continue; // edges outside the publish set are validated elsewhere
      indegree.set(name, indegree.get(name) + 1);
      dependents.get(dep).push(name);
    }
  }
  const ready = names.filter((name) => indegree.get(name) === 0).sort();
  const order = [];
  while (ready.length > 0) {
    const name = ready.shift();
    order.push(name);
    for (const dependent of dependents.get(name)) {
      const next = indegree.get(dependent) - 1;
      indegree.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
    ready.sort();
  }
  if (order.length !== names.length) {
    const cycle = names.filter((name) => !order.includes(name)).sort();
    throw new PublishScriptError(`dependency cycle among workspaces — cannot order a publish: ${cycle.join(', ')}`, { kind: 'cycle', pkg: cycle.join(', ') });
  }
  return order;
}

/**
 * The runner-local publish manifest: tag version, internal dep ranges pinned
 * to the exact tag version in every dep section, `private` cleared. Returns a
 * new object; the input is never mutated.
 */
export function rewriteManifest(manifest, version, internalNames) {
  const next = structuredClone(manifest);
  next.version = version;
  delete next.private; // npm refuses to publish "private": true — the flag is runner-local only (never committed)
  for (const section of DEP_SECTIONS) {
    const map = next[section];
    if (map === null || typeof map !== 'object') continue;
    for (const dep of Object.keys(map)) {
      if (internalNames.has(dep)) map[dep] = version;
    }
  }
  return next;
}

/** The exact publish command (PLAN Phase 6): npm publish -w <pkg> --access public --tag latest */
export function npmPublishArgs(name) {
  return ['publish', '-w', name, '--access', 'public', '--tag', 'latest'];
}

function defaultPublishFn(root) {
  return (name) =>
    spawnSync('npm', npmPublishArgs(name), { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: PUBLISH_TIMEOUT_MS });
}

const defaultSleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Classify a failed npm publish result (PLAN Phase 6):
 *  - duplicate   → status ∈ {403, 409} OR message matches /cannot publish over/i
 *  - e404        → registry lag, retryable (I17)
 *  - publish-failed → anything else
 */
export function classifyFailure(res) {
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  if (/cannot publish over/i.test(out)) {
    const m = out.match(/\b(403|409)\b/);
    return { kind: 'duplicate', status: m ? m[1] : undefined };
  }
  const m = out.match(/\bcode E(\d{3})\b/) ?? out.match(/\bnpm error E?(\d{3})\b/) ?? out.match(/\bE(\d{3})\b/);
  if (m !== null && m[1] === '404') return { kind: 'e404', status: '404' };
  if (m !== null && (m[1] === '403' || m[1] === '409')) return { kind: 'duplicate', status: m[1] };
  return { kind: 'publish-failed', status: m !== null ? m[1] : res.status };
}

async function publishOne(name, publishFn, sleep, log) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await publishFn(name);
    if (res.error !== undefined && res.error !== null) {
      // spawn-level failure (ETIMEDOUT on the bounded spawn, npm missing, …) — not a registry answer, not retryable as E404
      throw new PublishScriptError(`npm publish for ${name} failed to run: ${res.error.message}`, { kind: 'publish-failed', pkg: name });
    }
    if (res.status === 0) return 'published';
    const cls = classifyFailure(res);
    if (cls.kind === 'duplicate') {
      log(`::notice::${name} is already published at this version (EPUBLISHCONFLICT) — treating as idempotent success (I14)`);
      return 'duplicate';
    }
    if (cls.kind === 'e404' && attempt < MAX_ATTEMPTS) {
      log(`${name}: E404 (registry lag) — attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${RETRY_DELAY_MS / 1000}s (I17)`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new PublishScriptError(`npm publish failed for ${name}${cls.status !== undefined ? ` (status ${cls.status})` : ''}: ${String(res.stderr ?? res.stdout ?? '').trim().split('\n')[0] || 'no output'}`, { kind: cls.kind, pkg: name });
  }
  /* unreachable — the loop either returns or throws */
  throw new PublishScriptError(`npm publish failed for ${name}`, { kind: 'publish-failed', pkg: name });
}

function logPlan(version, tag, planned, log) {
  log(`publish-workspaces: tag ${tag} → version ${version}`);
  log(`publish-workspaces: DRY-RUN — ordered publish plan (${planned.length} packages, dependencies first):`);
  planned.forEach((entry, i) => {
    const deps = DEP_SECTIONS
      .flatMap((section) => Object.keys(entry.rewritten[section] ?? {}))
      .filter((dep) => dep.startsWith(NAMESPACE_PREFIX));
    const depNote = deps.length > 0 ? `; ${deps.map((dep) => `${dep} → ${version}`).join(', ')}` : '';
    log(`  ${i + 1}. ${entry.name} (${entry.dir}): version → ${version}${depNote}`);
    log(`     npm ${npmPublishArgs(entry.name).join(' ')}`);
  });
  log('publish-workspaces: dry-run complete — nothing was written, no package was published');
}

/**
 * Orchestrate the whole publish. Injectable for unit tests: `publishFn(name)
 * → {status, stdout, stderr}` and `sleep(ms)` (no registry calls, no waiting).
 * Real mode writes the rewritten manifests to disk for npm to read and
 * restores the original bytes in a finally block — the checkout is never left
 * modified (E5).
 */
export async function publishWorkspaces({ tag, lock, root = DEFAULT_ROOT, dryRun = false, publishFn, sleep = defaultSleep, log = (msg) => process.stdout.write(`${msg}\n`) }) {
  const version = parseTag(tag);
  const workspaces = loadPublishableWorkspaces(lock);

  const entries = [];
  for (const { name, dir } of workspaces.values()) {
    const manifestPath = join(root, dir, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      throw new PublishScriptError(`cannot read package.json for ${name} (${manifestPath}): ${err.message}`, { kind: 'manifest', pkg: name });
    }
    if (manifest.name !== name) {
      throw new PublishScriptError(`manifest mismatch for ${name}: package.json at ${dir} declares name "${manifest.name}"`, { kind: 'manifest', pkg: name });
    }
    entries.push({ name, dir, manifestPath, manifest });
  }

  const internalNames = new Set(workspaces.keys());
  for (const { name, dir, deps } of workspaces.values()) {
    for (const dep of deps) {
      if (!internalNames.has(dep)) {
        throw new PublishScriptError(`${name} (packages under ${dir}) depends on "${dep}", which is not a publishable workspace — refusing to publish a broken dependency graph`, { kind: 'deps', pkg: name });
      }
    }
  }

  const order = topoOrder([...workspaces.keys()], new Map(entries.map((entry) => [entry.name, workspaces.get(entry.name).deps])));
  const planned = order.map((name) => {
    const entry = entries.find((candidate) => candidate.name === name);
    return { name: entry.name, dir: entry.dir, manifestPath: entry.manifestPath, rewritten: rewriteManifest(entry.manifest, version, internalNames) };
  });

  if (dryRun) {
    logPlan(version, tag, planned, log);
    return { version, order };
  }

  const run = publishFn ?? defaultPublishFn(root);
  const mutated = [];
  const results = [];
  try {
    for (const entry of planned) {
      const original = readFileSync(entry.manifestPath, 'utf8');
      writeFileSync(entry.manifestPath, `${JSON.stringify(entry.rewritten, null, 2)}\n`);
      mutated.push({ path: entry.manifestPath, original });
    }
    for (const entry of planned) {
      log(`[${results.length + 1}/${planned.length}] ${entry.name}: publishing ${entry.name}@${version} (npm ${npmPublishArgs(entry.name).join(' ')})`);
      const outcome = await publishOne(entry.name, run, sleep, log);
      results.push({ name: entry.name, dir: entry.dir, outcome });
    }
  } finally {
    for (const { path, original } of mutated) writeFileSync(path, original); // restore the checkout byte-for-byte (E5)
  }
  log(`publish-workspaces: done — ${results.filter((r) => r.outcome === 'published').length} published, ${results.filter((r) => r.outcome === 'duplicate').length} already present (idempotent)`);
  return { version, results };
}

function usage(message) {
  return `${message}\nusage: node scripts/ci/publish-workspaces.mjs --tag v0.1.0 [--dry-run] [--root <dir>] [--lockfile <path>]`;
}

function parseArgs(argv) {
  const args = { tag: undefined, dryRun: false, root: DEFAULT_ROOT, lockfile: undefined };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=', 2);
    const value = () => (inlineValue !== undefined ? inlineValue : argv[++i]);
    switch (flag) {
      case '--tag': args.tag = value(); break;
      case '--dry-run': args.dryRun = true; break;
      case '--root': args.root = value(); break;
      case '--lockfile': args.lockfile = value(); break;
      default: throw new PublishScriptError(usage(`unknown argument: ${argv[i]}`), { kind: 'usage' });
    }
  }
  if (args.tag === undefined) throw new PublishScriptError(usage('--tag is required'), { kind: 'usage' });
  return args;
}

/** CLI entry. Returns the process exit code. */
export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  try {
    const lockfilePath = args.lockfile !== undefined ? resolve(args.lockfile) : join(resolve(args.root), 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockfilePath, 'utf8'));
    await publishWorkspaces({ tag: args.tag, lock, root: resolve(args.root), dryRun: args.dryRun });
    return 0;
  } catch (err) {
    const pkgNote = err instanceof PublishScriptError && err.pkg ? ` [${err.pkg}]` : '';
    process.stderr.write(`publish-workspaces: error${pkgNote}: ${err.message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
