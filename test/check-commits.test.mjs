/**
 * Unit tests for scripts/ci/check-commits.mjs — the commit-identity +
 * Apache-LICENSE gate (ci-deploy PLAN Phase 1, TDD).
 *
 * Two layers:
 *  1. Pure-function tests over fixture git-log records (deterministic, offline).
 *  2. CLI end-to-end tests against throwaway git repositories (still offline:
 *     no network, deterministic env-specified authors/committers).
 *
 * Contract under test (PLAN Phase 1 / I11):
 *  - AUTHOR must be Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>
 *    — "dependabot[bot]" is the sole exception.
 *  - COMMITTER must be Nitish, "GitHub <noreply@github.com>" (web-flow — the
 *    committer GitHub stamps on squash/rebase merges it creates), or
 *    "dependabot[bot]" ONLY alongside a dependabot author.
 *  - Message body must not contain Co-Authored-By:/Generated-* trailers.
 *  - Empty --base ⇒ range check skipped, exit 0, ::notice::.
 *  - Only NEW commits (base..head) are judged.
 *  - --license mode asserts the three Apache-2.0 markers in LICENSE.
 *  - Exit codes: 0 ok/skipped, 1 violations.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LICENSE_MARKERS,
  checkLicenseText,
  parseGitLog,
  validateRecord,
  validateRecords,
} from '../scripts/ci/check-commits.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/ci/check-commits.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const NITISH = { name: 'Nitish Agarwal', email: '1592163+nitishagar@users.noreply.github.com' };
const WEBFLOW = { name: 'GitHub', email: 'noreply@github.com' };
const DEPENDABOT = { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' };
const INTRUDER = { name: 'John Doe', email: 'john@example.com' };

function rec(overrides = {}) {
  return {
    sha: '0123456789abcdef0123456789abcdef01234567',
    authorName: NITISH.name,
    authorEmail: NITISH.email,
    committerName: NITISH.name,
    committerEmail: NITISH.email,
    body: 'feat: add thing\n\nwhy: because\n',
    ...overrides,
  };
}

function kinds(violations) {
  return violations.map((v) => v.kind);
}

describe('parseGitLog', () => {
  it('parses NUL-separated `git log -z` output into 6-field records', () => {
    const sha1 = '1'.repeat(40);
    const sha2 = '2'.repeat(40);
    const r1 = [sha1, NITISH.name, NITISH.email, WEBFLOW.name, WEBFLOW.email, 'feat: a\n\nbody a\n'].join('\0');
    const r2 = [sha2, DEPENDABOT.name, DEPENDABOT.email, DEPENDABOT.name, DEPENDABOT.email, 'chore: b\n'].join('\0');
    const records = parseGitLog(`${r1}\0${r2}\0`);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      sha: sha1,
      authorName: NITISH.name,
      authorEmail: NITISH.email,
      committerName: WEBFLOW.name,
      committerEmail: WEBFLOW.email,
      body: 'feat: a\n\nbody a\n',
    });
    expect(records[1].body).toBe('chore: b\n');
  });

  it('returns [] for empty output (no commits in range)', () => {
    expect(parseGitLog('')).toEqual([]);
  });
});

describe('validateRecords — author tier (strict)', () => {
  it('accepts a Nitish-authored, Nitish-committed commit', () => {
    expect(validateRecords([rec()])).toEqual([]);
  });

  it('accepts dependabot-authored + dependabot-committed branch commits', () => {
    const v = validateRecords([
      rec({ authorName: DEPENDABOT.name, authorEmail: DEPENDABOT.email, committerName: DEPENDABOT.name, committerEmail: DEPENDABOT.email }),
    ]);
    expect(v).toEqual([]);
  });

  it('rejects a wrong author even when the committer is Nitish', () => {
    const v = validateRecords([rec({ authorName: INTRUDER.name, authorEmail: INTRUDER.email })]);
    expect(kinds(v)).toEqual(['author']);
    expect(v[0].message).toContain('Nitish Agarwal');
    expect(v[0].message).toContain('john@example.com');
  });

  it('rejects a wrong author even when the committer is GitHub web-flow (author tier is strict)', () => {
    const v = validateRecords([rec({ authorName: INTRUDER.name, authorEmail: INTRUDER.email, committerName: WEBFLOW.name, committerEmail: WEBFLOW.email })]);
    expect(kinds(v)).toEqual(['author']);
  });

  it('accepts GitHub web-flow as committer on a Nitish-authored commit (squash-merge signature)', () => {
    const v = validateRecords([rec({ committerName: WEBFLOW.name, committerEmail: WEBFLOW.email })]);
    expect(v).toEqual([]);
  });
});

describe('validateRecords — committer tier (two-tier rule)', () => {
  it('rejects a dependabot committer when the author is not dependabot (pairing rule)', () => {
    const v = validateRecords([rec({ committerName: DEPENDABOT.name, committerEmail: DEPENDABOT.email })]);
    expect(kinds(v)).toEqual(['committer']);
  });

  it('accepts a dependabot committer when the author is dependabot', () => {
    const v = validateRecords([rec({ authorName: DEPENDABOT.name, authorEmail: DEPENDABOT.email, committerName: DEPENDABOT.name, committerEmail: DEPENDABOT.email })]);
    expect(v).toEqual([]);
  });

  it('rejects an unknown committer', () => {
    const v = validateRecords([rec({ committerName: INTRUDER.name, committerEmail: INTRUDER.email })]);
    expect(kinds(v)).toEqual(['committer']);
    expect(v[0].message).toContain('noreply@github.com');
  });

  it('rejects a wrong email for the Nitish committer name', () => {
    const v = validateRecords([rec({ committerEmail: 'nitish@evil.example' })]);
    expect(kinds(v)).toEqual(['committer']);
  });
});

describe('validateRecords — trailer rules (no AI attribution)', () => {
  it('rejects a Co-Authored-By trailer in the body', () => {
    const v = validateRecords([rec({ body: 'feat: x\n\nCo-Authored-By: Claude <claude@anthropic.com>\n' })]);
    expect(kinds(v)).toEqual(['trailer']);
    expect(v[0].message).toContain('Co-Authored-By');
  });

  it('rejects a "Generated with" footer', () => {
    const v = validateRecords([rec({ body: 'feat: x\n\nGenerated with Claude Code\n' })]);
    expect(kinds(v)).toEqual(['trailer']);
  });

  it('rejects a "Generated-By" footer', () => {
    const v = validateRecords([rec({ body: 'feat: x\n\nGenerated-By: tool v1\n' })]);
    expect(kinds(v)).toEqual(['trailer']);
  });

  it('rejects a trailer variant with underscore separator ("generated_with")', () => {
    const v = validateRecords([rec({ body: 'feat: x\n\ngenerated_with tool\n' })]);
    expect(kinds(v)).toEqual(['trailer']);
  });

  it('flags trailers anywhere in the body (multiline anchor), including the subject line', () => {
    const v = validateRecords([rec({ body: 'co-authored-by: someone <s@example.com>\n' })]);
    expect(kinds(v)).toEqual(['trailer']);
  });

  it('does not flag trailer-like text that is not at a line start', () => {
    const v = validateRecords([rec({ body: 'feat: x\n\nsee Co-Authored-By: format in docs\n' })]);
    expect(v).toEqual([]);
  });

  it('collects author and trailer violations from the same commit', () => {
    const v = validateRecords([rec({ authorName: INTRUDER.name, body: 'feat: x\n\nCo-Authored-By: Claude <c@example.com>\n' })]);
    expect(kinds(v)).toEqual(['author', 'trailer']);
  });

  it('reports violations per commit with the sha attached', () => {
    const v = validateRecords([rec(), rec({ sha: 'f'.repeat(40), authorName: INTRUDER.name })]);
    expect(v).toHaveLength(1);
    expect(v[0].sha).toBe('f'.repeat(40));
    expect(v[0].short).toBe('fffffff');
  });
});

describe('checkLicenseText', () => {
  it('accepts the canonical Apache-2.0 text (all three markers)', () => {
    const text = [
      'Copyright 2026 Nitish Agarwal',
      '',
      '                                 Apache License',
      '                           Version 2.0, January 2004',
      '                        http://www.apache.org/licenses/',
      '',
      '   Licensed under the Apache License, Version 2.0 (the "License");',
    ].join('\n');
    expect(checkLicenseText(text)).toEqual({ ok: true, missing: [] });
  });

  it('reports which markers are missing', () => {
    const res = checkLicenseText('MIT License\n\nPermission is hereby granted...\n');
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(LICENSE_MARKERS);
  });

  it('reports a single missing marker', () => {
    const res = checkLicenseText('Apache License\nVersion 2.0, January 2004\n');
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['http://www.apache.org/licenses/']);
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end (real git, throwaway repos, still offline & deterministic)
// ---------------------------------------------------------------------------

function git(cwd, args, env = {}) {
  const res = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return (res.stdout || '').trim();
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'check-commits-'));
  git(dir, ['init', '-q']);
  return dir;
}

function commit(dir, message, author = NITISH, committer = author) {
  git(dir, ['commit', '-q', '--allow-empty', '-m', message], {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  });
  return git(dir, ['rev-parse', 'HEAD']);
}

function runScript(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

describe('check-commits.mjs CLI (range mode)', () => {
  it('exits 0 for a compliant range', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      commit(dir, 'feat: second');
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('commit identity OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 for the GitHub squash-merge signature (Nitish authored, web-flow committed)', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      commit(dir, 'feat: squash-merged via GitHub', NITISH, WEBFLOW);
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 for dependabot branch commits (author + committer pairing)', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      commit(dir, 'chore: bump vitest from 4 to 5', DEPENDABOT, DEPENDABOT);
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with an actionable author message for a wrong author', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      const bad = commit(dir, 'feat: sneaky', INTRUDER, INTRUDER);
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('::error::');
      expect(res.stderr).toContain('author must be');
      expect(res.stderr).toContain(bad.slice(0, 7));
      expect(res.stderr).toContain('john@example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails for a wrong author even with the web-flow committer (author tier is strict)', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      commit(dir, 'feat: sneaky', INTRUDER, WEBFLOW);
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('author must be');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails for a dependabot committer without a dependabot author', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      commit(dir, 'feat: x', NITISH, DEPENDABOT);
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('committer must be');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on a Co-Authored-By trailer', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      commit(dir, 'feat: x\n\nCo-Authored-By: Claude <claude@anthropic.com>');
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('forbidden trailer');
      expect(res.stderr).toContain('Co-Authored-By');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('only judges NEW commits (a non-compliant commit before --base is out of range)', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'chore: non-compliant history', INTRUDER, INTRUDER);
      const base = commit(dir, 'feat: compliant');
      const res = runScript(['--base', base, '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the range check with a ::notice:: when --base is empty (zero-SHA / unborn-base guard)', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'chore: first');
      const res = runScript(['--base', '', '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('::notice::');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips with an explicit notice when the base cannot be resolved and no origin/main fallback exists (not silently green)', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'chore: first');
      const res = runScript(['--base', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('::notice::');
      expect(res.stdout).toContain('skipped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check-commits.mjs CLI (--license mode)', () => {
  it('exits 0 against the real repo root LICENSE (canonical Apache-2.0)', () => {
    const res = runScript(['--license'], REPO_ROOT);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('LICENSE OK');
  });

  it('exits 0 when LICENSE carries all three markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-ok-'));
    try {
      writeFileSync(join(dir, 'LICENSE'), 'Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/LICENSE-2.0\n');
      const res = runScript(['--license'], dir);
      expect(res.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 and names the missing markers for a non-Apache LICENSE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-mit-'));
    try {
      writeFileSync(join(dir, 'LICENSE'), 'MIT License\n');
      const res = runScript(['--license'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Apache-2.0');
      expect(res.stderr).toContain('http://www.apache.org/licenses/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with an actionable message when LICENSE is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-missing-'));
    try {
      const res = runScript(['--license'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('check-commits.mjs CLI (argument handling)', () => {
  it('exits 2 on usage errors (no mode requested)', () => {
    const res = runScript([], REPO_ROOT);
    expect(res.status).toBe(2);
  });

  it('exits 2 on an unknown flag', () => {
    const res = runScript(['--bogus'], REPO_ROOT);
    expect(res.status).toBe(2);
  });
});

describe('check-commits.mjs CLI (unreachable base — force-push fallback)', () => {
  const BOGUS = 'f'.repeat(40);

  it('falls back to origin/main..head and exits 0 when --base is unreachable (force-push)', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      git(dir, ['update-ref', 'refs/remotes/origin/main', base]);
      commit(dir, 'feat: second');
      const res = runScript(['--base', BOGUS, '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('::notice::');
      expect(res.stdout).toContain('origin/main');
      expect(res.stdout).toContain('commit identity OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fallback still judges the new commits — violations fail (fail-safe)', () => {
    const dir = makeRepo();
    try {
      const base = commit(dir, 'chore: first');
      git(dir, ['update-ref', 'refs/remotes/origin/main', base]);
      const bad = commit(dir, 'feat: sneaky', INTRUDER, INTRUDER);
      const res = runScript(['--base', BOGUS, '--head', 'HEAD'], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('::error::');
      expect(res.stderr).toContain(bad.slice(0, 7));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips with a notice when base is unreachable and origin/main is unresolvable', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'chore: first');
      const res = runScript(['--base', BOGUS, '--head', 'HEAD'], dir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('::notice::');
      expect(res.stdout).toContain('skipped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('red-team round 1: dependabot identity is email-pinned', () => {
  it('a commit authored dependabot[bot] with an attacker email is rejected', () => {
    const res = validateRecord({
      sha: 'a'.repeat(40),
      authorName: 'dependabot[bot]',
      authorEmail: 'attacker@evil.example',
      committerName: 'GitHub',
      committerEmail: 'noreply@github.com',
      body: 'chore: bump',
    });
    expect(res.some((p) => p.kind === 'author')).toBe(true);
  });

  it('the real bot identity (name + noreply email) is accepted', () => {
    const res = validateRecord({
      sha: 'b'.repeat(40),
      authorName: 'dependabot[bot]',
      authorEmail: '49699333+dependabot[bot]@users.noreply.github.com',
      committerName: 'dependabot[bot]',
      committerEmail: '49699333+dependabot[bot]@users.noreply.github.com',
      body: 'chore: bump',
    });
    expect(res).toHaveLength(0);
  });
});
