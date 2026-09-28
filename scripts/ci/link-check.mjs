/**
 * link-check.mjs — link-integrity gate (PRD E0.1 FR-2): every absolute URL in
 * the root README, the package READMEs, SECURITY.md, and the URL-valued
 * fields of locked-names.json must return 2xx. Runs scheduled/release-only
 * (link-check.yml) — never in the per-PR offline gate. Polite by design:
 * bounded concurrency, identifying UA, per-attempt timeout, HEAD→GET
 * fallback on method-restricted servers, exactly one retry on network
 * errors. A failure lists the URL and every file that references it.
 *
 * Dependency-free plain Node (matches scripts/ci/ conventions); the fetcher
 * is injectable for offline tests.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.LUMEN_LINKCHECK_ROOT ?? process.cwd();
const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const RETRIES = 1;
const USER_AGENT = 'lumen-link-check/0.0.0 (+https://github.com/nitishagar/lumen)';

/** Trailing punctuation that URL regexes pick up from prose/badges. */
const stripTrailing = (url) => url.replace(/[>)\]"'.,;]+$/g, '');

export function collectSources(root = ROOT) {
  const files = [];
  const pushIf = (p) => {
    if (existsSync(join(root, p))) files.push(p);
  };
  pushIf('README.md');
  pushIf('SECURITY.md');
  pushIf('site/src/data/locked-names.json');
  const pkgs = join(root, 'packages');
  if (statSync(pkgs, { throwIfNoEntry: false })?.isDirectory()) {
    for (const dir of readdirSync(pkgs)) pushIf(`packages/${dir}/README.md`);
  }
  if (files.length === 0) throw new Error('no link-check source files found');
  return files;
}

export function collectUrls(root = ROOT) {
  const byUrl = new Map(); // url -> Set<source file>
  const add = (raw, source) => {
    const url = stripTrailing(raw);
    if (!/^https?:\/\//.test(url)) return;
    if (!byUrl.has(url)) byUrl.set(url, new Set());
    byUrl.get(url).add(source);
  };
  for (const file of collectSources(root)) {
    const text = readFileSync(join(root, file), 'utf8');
    if (file.endsWith('.json')) {
      // URL-valued fields only: walk values, never keys or arbitrary strings.
      const walk = (node) => {
        if (typeof node === 'string') {
          if (/^https?:\/\//.test(node)) add(node, file);
        } else if (Array.isArray(node)) node.forEach(walk);
        else if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
      };
      walk(JSON.parse(text));
    } else {
      for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+/g)) add(m[0], file);
    }
  }
  return [...byUrl.entries()]
    .map(([url, sources]) => ({ url, sources: [...sources].sort() }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

const HEAD_ONLY_FALLBACK = [403, 405, 501]; // method-restricted servers — a GET is justified

const handle = (res) => {
      // Drain+cancel so sockets close promptly under concurrency.
      try {
        res.body?.cancel();
      } catch {
        // body already consumed or null — nothing to release
      }
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status };
};

const checkOnce = async (url, fetchImpl) => {
  try {
    const head = handle(await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': USER_AGENT, accept: '*/*' } }));
    if (head.ok || !HEAD_ONLY_FALLBACK.includes(head.status)) return head;
  } catch (err) {
    // Transport-level failure: a GET would fail identically — fail now, the
    // outer loop owns the single retry.
    return { ok: false, error: String(err?.cause?.message ?? err?.message ?? err) };
  }
  try {
    return handle(await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': USER_AGENT, accept: '*/*' } }));
  } catch (err) {
    return { ok: false, error: String(err?.cause?.message ?? err?.message ?? err) };
  }
};

export async function checkUrl(url, fetchImpl = fetch) {
  let last = { ok: false, error: 'untried' };
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    last = await checkOnce(url, fetchImpl);
    // HTTP statuses are deterministic answers — retrying only burns the
    // target's quota; the single retry is for transient network errors.
    if (last.ok || last.status !== undefined) return last;
  }
  return last;
}

export async function runCheck({ fetchImpl = fetch, log = console.log, root = ROOT, json = false } = {}) {
  const targets = collectUrls(root);
  const failures = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const result = await checkUrl(t.url, fetchImpl);
      if (!result.ok) failures.push({ ...t, ...result });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  if (json) {
    log(JSON.stringify({ checked: targets.length, failed: failures.length, failures }, null, 2));
  } else {
    log(`link-check: ${targets.length} URLs, ${failures.length} failed`);
    for (const f of failures) {
      log(`FAIL ${f.url} — ${f.status !== undefined ? `HTTP ${f.status}` : f.error}`);
      for (const s of f.sources) log(`     referenced by ${s}`);
    }
  }
  return { checked: targets.length, failures };
}

/** CI entry: exit 1 iff any URL failed — the contract link-check.yml keys on. */
export const main = async ({ argv = process.argv, fetchImpl = fetch, log = console.log, root = ROOT } = {}) => {
  const { failures } = await runCheck({ fetchImpl, log, root, json: argv.includes('--json') });
  return failures.length === 0 ? 0 : 1;
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  process.exit(await main());
}
