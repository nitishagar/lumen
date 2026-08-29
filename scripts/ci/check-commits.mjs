#!/usr/bin/env node
/**
 * check-commits.mjs — commit-identity + Apache-LICENSE gate (ci-deploy P6a).
 *
 * Two-tier identity rule (PLAN Phase 1 / IMPLICIT_SPEC I11):
 *   AUTHOR     (strict)  "Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>"
 *                        with "dependabot[bot]" as the sole exception.
 *   COMMITTER  (two-tier) Nitish, OR "GitHub <noreply@github.com>" (web-flow —
 *                        the committer GitHub stamps on every squash/rebase
 *                        merge it creates, i.e. this repo's merge procedure),
 *                        OR "dependabot[bot]" but ONLY alongside a dependabot
 *                        author.
 *   TRAILERS   forbidden: /^co-authored-by:/im and /^generated[-_ ]?(by|with)/im
 *              (no AI co-author / generated-by attribution — repo policy).
 *
 * Usage:
 *   node scripts/ci/check-commits.mjs --base <sha> --head <sha>
 *       Validates the NEW commits in base..head. An EMPTY --base skips the
 *       range check with a ::notice:: and exits 0 (the zero-SHA guard for
 *       first pushes of a new branch / unborn base is resolved by the caller
 *       before invoking this script).
 *   node scripts/ci/check-commits.mjs --license [--license-file <path>]
 *       Asserts LICENSE exists and carries the three Apache-2.0 markers.
 *
 * Exit codes: 0 ok (or skipped), 1 violations, 2 usage error.
 *
 * Zero runtime dependencies — Node >= 22 built-ins only (deterministic, I10).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NITISH_NAME = 'Nitish Agarwal';
const NITISH_EMAIL = '1592163+nitishagar@users.noreply.github.com';
const DEPENDABOT_NAME = 'dependabot[bot]';
const WEBFLOW_NAME = 'GitHub';
const WEBFLOW_EMAIL = 'noreply@github.com';

export const LICENSE_MARKERS = [
  'Apache License',
  'Version 2.0, January 2004',
  'http://www.apache.org/licenses/',
];

const TRAILER_PATTERNS = [/^co-authored-by:/im, /^generated[-_ ]?(by|with)/im];

// One NUL-separated field per identity, %B = raw message. `-z` terminates
// each log entry with NUL instead of a newline so the parser can split the
// stream unambiguously (commit messages cannot contain NUL bytes).
const GIT_LOG_FORMAT = '%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B';

export function isNitish(name, email) {
  return name === NITISH_NAME && email === NITISH_EMAIL;
}

export function isDependabot(name) {
  return name === DEPENDABOT_NAME;
}

/** Parse `git log -z --format=<GIT_LOG_FORMAT>` output into records. */
export function parseGitLog(text) {
  if (text === '') return [];
  const fields = text.split('\0');
  if (fields[fields.length - 1] === '') fields.pop(); // entry terminator
  if (fields.length % 6 !== 0) {
    throw new Error(`unexpected git log output shape: ${fields.length} fields is not a multiple of 6`);
  }
  const records = [];
  for (let i = 0; i < fields.length; i += 6) {
    records.push({
      sha: fields[i],
      authorName: fields[i + 1],
      authorEmail: fields[i + 2],
      committerName: fields[i + 3],
      committerEmail: fields[i + 4],
      body: fields[i + 5],
    });
  }
  return records;
}

/** Validate one record; returns [{ kind, message }] with actionable messages. */
export function validateRecord(record) {
  const problems = [];
  const body = typeof record.body === 'string' ? record.body : '';

  if (!isNitish(record.authorName, record.authorEmail) && !isDependabot(record.authorName)) {
    problems.push({
      kind: 'author',
      message:
        `author must be "Nitish Agarwal <${NITISH_EMAIL}>" (or "dependabot[bot]"); ` +
        `got "${record.authorName} <${record.authorEmail}>"`,
    });
  }

  const committerNitish = isNitish(record.committerName, record.committerEmail);
  const committerWebflow = record.committerName === WEBFLOW_NAME && record.committerEmail === WEBFLOW_EMAIL;
  const committerDependabotPaired = isDependabot(record.committerName) && isDependabot(record.authorName);
  if (!committerNitish && !committerWebflow && !committerDependabotPaired) {
    problems.push({
      kind: 'committer',
      message:
        `committer must be "Nitish Agarwal <${NITISH_EMAIL}>", "GitHub <${WEBFLOW_EMAIL}>" ` +
        `(web-flow squash/rebase merges), or "dependabot[bot]" (only alongside a dependabot[bot] author); ` +
        `got "${record.committerName} <${record.committerEmail}>"`,
    });
  }

  for (const pattern of TRAILER_PATTERNS) {
    const offending = body.split('\n').find((line) => pattern.test(line));
    if (offending !== undefined) {
      problems.push({
        kind: 'trailer',
        message:
          `forbidden trailer: ${JSON.stringify(offending)} — no AI co-author/generated ` +
          `trailers are allowed in this repo (matches /${pattern.source}/)`,
      });
    }
  }

  return problems;
}

/** Validate many records; every violation carries the commit sha. */
export function validateRecords(records) {
  const violations = [];
  for (const record of records) {
    for (const problem of validateRecord(record)) {
      violations.push({ sha: record.sha, short: record.sha.slice(0, 7), ...problem });
    }
  }
  return violations;
}

/** Check LICENSE content for the three Apache-2.0 markers. */
export function checkLicenseText(text) {
  const missing = LICENSE_MARKERS.filter((marker) => !text.includes(marker));
  return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing };
}

function usage() {
  console.error(`Usage:
  node scripts/ci/check-commits.mjs --base <sha> --head <sha>   # identity gate over base..head
  node scripts/ci/check-commits.mjs --license [--license-file <path>]  # Apache-2.0 LICENSE gate
Exit codes: 0 ok/skipped, 1 violations, 2 usage.`);
}

function parseArgs(argv) {
  const args = { base: undefined, head: undefined, license: false, licenseFile: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.split('=', 2);
    const value = (needle) => {
      if (inlineValue !== undefined) return inlineValue;
      if (i + 1 >= argv.length) {
        console.error(`Missing value for ${needle}`);
        process.exit(2);
      }
      return argv[++i];
    };
    switch (flag) {
      case '--base': args.base = value('--base'); break;
      case '--head': args.head = value('--head'); break;
      case '--license': args.license = true; break;
      case '--license-file': args.licenseFile = value('--license-file'); break;
      case '--help':
      case '-h': usage(); process.exit(0); break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(2);
    }
  }
  return args;
}

function runLicenseCheck(licenseFile) {
  const file = licenseFile !== undefined ? resolve(licenseFile) : join(process.cwd(), 'LICENSE');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(
      `::error::LICENSE not found (expected ${file}) — the repo root must carry the full ` +
        'Apache-2.0 license text (research: a single LICENSE file satisfies Apache-2.0 §4(a)).',
    );
    return 1;
  }
  const result = checkLicenseText(text);
  if (!result.ok) {
    console.error(
      `::error::LICENSE (${file}) is missing Apache-2.0 content marker(s): ` +
        result.missing.map((m) => JSON.stringify(m)).join(', ') +
        ' — restore the canonical Apache-2.0 text.',
    );
    return 1;
  }
  console.log(`LICENSE OK — Apache-2.0 markers present (${file})`);
  return 0;
}

function runRangeCheck(base, head) {
  if (base.trim() === '') {
    console.log('::notice::empty --base — commit range check skipped (unborn or unresolvable base resolved by the caller)');
    return 0;
  }
  let output;
  try {
    output = execFileSync('git', ['log', '-z', `--format=${GIT_LOG_FORMAT}`, `${base}..${head}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = String((err.stderr && err.stderr.trim().split('\n')[0]) || err.message);
    console.error(`::error::git log ${base}..${head} failed: ${detail}`);
    return 1;
  }
  const records = parseGitLog(output);
  const violations = validateRecords(records);
  if (violations.length > 0) {
    console.error(`::error::commit identity gate failed — ${violations.length} violation(s) across ${records.length} new commit(s) in range ${base}..${head}`);
    for (const v of violations) console.error(`  ${v.short} (${v.kind}) ${v.message}`);
    console.error(
      `Remediation: every new commit must be authored by "Nitish Agarwal <${NITISH_EMAIL}>" (dependabot[bot] excepted), ` +
        `must carry no "Co-Authored-By:"/"Generated-*" trailers, and its committer must be you, "GitHub <${WEBFLOW_EMAIL}>" ` +
        '(web-flow, created by squash/rebase merges on GitHub), or dependabot[bot] on dependabot commits. ' +
        'Rewrite the offending commits (git rebase -i + git commit --amend --reset-author).',
    );
    return 1;
  }
  console.log(`commit identity OK — ${records.length} new commit(s) in range ${base}..${head}`);
  return 0;
}

function main(argv) {
  const args = parseArgs(argv);
  const wantsLicense = args.license;
  const wantsRange = args.base !== undefined || args.head !== undefined;
  if (!wantsLicense && !wantsRange) {
    usage();
    return 2;
  }
  if (wantsLicense && runLicenseCheck(args.licenseFile) !== 0) return 1;
  if (wantsRange && runRangeCheck(args.base ?? '', args.head ?? 'HEAD') !== 0) return 1;
  return 0;
}

// CLI entry only when executed directly (never on import — unit tests import
// the pure functions above).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
