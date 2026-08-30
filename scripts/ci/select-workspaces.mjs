#!/usr/bin/env node
/**
 * select-workspaces.mjs — workspace-scoped test selection for branch pushes
 * (ci-deploy P6a). Computes the reverse-dependency closure of the changed
 * workspaces from `package-lock.json` so dependents are always re-tested
 * (fail-safe toward MORE testing, never less).
 *
 * Input:
 *   - changed paths on stdin (CI pipes `git diff --name-only <base> <head>`), or
 *   - `--base <rev> --head <rev>` flags (the script runs `git diff --name-only -z` itself).
 *
 * Output contract (PLAN Phase 1): ALWAYS exits 0 and emits EXACTLY ONE
 * `$GITHUB_OUTPUT`-ready line on stdout:
 *     scope=-w <name>[ -w <name>…]   # reverse-dependency closure, name-sorted
 *     scope=ALL                      # fail-safe: empty/unmapped diff, missing
 *                                    # or malformed lockfile, unresolvable base
 * The value is restricted to [A-Za-z0-9@/._- ] (npm names + `-w` flags) so the
 * runner shell can split it safely into an array.
 *
 * Fail-safe ⇒ `scope=ALL` on ANY unexpected error. Zero runtime dependencies.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ALL = 'ALL';
const NAME_CHARSET = /^[A-Za-z0-9@/._-]+$/;
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function parseArgs(argv) {
  const args = { lockfile: 'package-lock.json', base: undefined, head: undefined };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=', 2);
    const value = () => (inlineValue !== undefined ? inlineValue : argv[++i]);
    switch (flag) {
      case '--lockfile': args.lockfile = value(); break;
      case '--base': args.base = value(); break;
      case '--head': args.head = value(); break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function readStdinPaths() {
  if (process.stdin.isTTY) return [];
  const text = readFileSync(0, 'utf8');
  return text.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line !== '');
}

function gitDiffPaths(base, head) {
  const res = spawnSync('git', ['diff', '--name-only', '-z', base, head], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null; // unresolvable base ⇒ fail-safe
  return String(res.stdout).split('\0').filter((p) => p !== '');
}

/**
 * Parse the lockfile into { packages, dirByName, nameByDir }. Returns null on
 * any structural surprise (missing/unreadable/malformed, no workspace entries,
 * entries without a usable name) — the caller fails safe to ALL.
 */
function loadWorkspaces(lockfilePath) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch {
    return null;
  }
  const packages = lock !== null && typeof lock === 'object' ? lock.packages : null;
  if (packages === null || typeof packages !== 'object') return null;

  const dirByName = new Map();
  const nameByDir = new Map();
  for (const [dir, entry] of Object.entries(packages)) {
    // Root entry + registry entries are not workspaces. Registry copies can
    // be nested under a workspace dir whenever hoisting conflicts (e.g.
    // site/node_modules/cookie), so test any node_modules SEGMENT, not just
    // a root-level prefix.
    if (dir === '' || dir.split('/').includes('node_modules')) continue;
    const name = entry !== null && typeof entry === 'object' ? entry.name : undefined;
    if (typeof name !== 'string' || !NAME_CHARSET.test(name)) return null;
    if (dirByName.has(name)) return null; // duplicate workspace name ⇒ untrustworthy graph
    dirByName.set(dir, name);
    nameByDir.set(name, dir);
  }
  if (dirByName.size === 0) return null;
  return { packages, dirByName, nameByDir };
}

/** dep name -> Set of workspace names that depend on it (any dep section). */
function buildDependents(workspaces) {
  const dependents = new Map();
  for (const [dir, entry] of Object.entries(workspaces.packages)) {
    const name = workspaces.dirByName.get(dir);
    if (name === undefined) continue;
    for (const section of DEP_SECTIONS) {
      const deps = entry !== null && typeof entry === 'object' ? entry[section] : undefined;
      if (deps === null || typeof deps !== 'object') continue;
      for (const dep of Object.keys(deps)) {
        if (workspaces.nameByDir.has(dep)) {
          if (!dependents.has(dep)) dependents.set(dep, new Set());
          dependents.get(dep).add(name);
        }
      }
    }
  }
  return dependents;
}

/** Longest-prefix match of a path against workspace dirs (dir itself counts). */
function mapPathToWorkspaceDir(path, dirsByLengthDesc) {
  for (const dir of dirsByLengthDesc) {
    if (path === dir || path.startsWith(`${dir}/`)) return dir;
  }
  return null;
}

function closureNames(changedDirs, workspaces, dependents) {
  const names = new Set();
  const queue = [];
  for (const dir of changedDirs) {
    const name = workspaces.dirByName.get(dir);
    if (!names.has(name)) {
      names.add(name);
      queue.push(name);
    }
  }
  while (queue.length > 0) {
    const name = queue.pop();
    for (const dependent of dependents.get(name) ?? []) {
      if (!names.has(dependent)) {
        names.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return names;
}

function scopeLine(value) {
  return `scope=${value}\n`;
}

function emitAll() {
  process.stdout.write(scopeLine(ALL));
  process.exit(0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const workspaces = loadWorkspaces(resolve(args.lockfile));
  if (workspaces === null) emitAll();

  const paths = args.base !== undefined
    ? gitDiffPaths(args.base, args.head ?? 'HEAD')
    : readStdinPaths();
  if (paths === null || paths.length === 0) emitAll();

  const dirsByLengthDesc = [...workspaces.dirByName.keys()].sort((a, b) => b.length - a.length);
  const changedDirs = new Set();
  for (const path of paths) {
    const dir = mapPathToWorkspaceDir(path, dirsByLengthDesc);
    if (dir !== null) changedDirs.add(dir);
  }
  if (changedDirs.size === 0) emitAll(); // no package paths in the diff

  const dependents = buildDependents(workspaces);
  const names = closureNames(changedDirs, workspaces, dependents);
  const value = [...names].sort().map((name) => `-w ${name}`).join(' ');
  if (!/^-w [A-Za-z0-9@/._-]+( -w [A-Za-z0-9@/._-]+)*$/.test(value)) emitAll(); // charset guard
  process.stdout.write(scopeLine(value));
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`::notice::select-workspaces failed (${err && err.message}) — failing safe to the full test suite`);
  emitAll();
}
