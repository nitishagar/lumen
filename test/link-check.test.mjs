/**
 * link-check.test.mjs — offline tests for the link-integrity gate: URL
 * extraction hygiene (prose punctuation), locked-names field collection,
 * politeness contract (HEAD→GET fallback, retry-once, concurrency cap,
 * identifying UA), and the failure report shape. The fetcher is injected —
 * no network here, ever (per-PR offline gate).
 */
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectUrls, checkUrl, runCheck, main } from '../scripts/ci/link-check.mjs';

const makeRepo = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-linkcheck-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
};

const fixtureFiles = {
  'README.md': [
    '# lumen',
    'Docs: https://nitishagar.github.io/lumen/.',
    'Badge <img src="https://img.shields.io/badge/x-y">',
    'Repo (https://github.com/nitishagar/lumen) and [label](https://github.com/nitishagar/lumen/blob/main/LICENSE).',
  ].join('\n'),
  'SECURITY.md': 'Advisories: https://github.com/nitishagar/lumen/security/advisories/new',
  'site/src/data/locked-names.json': JSON.stringify({
    repoUrl: 'https://github.com/nitishagar/lumen',
    siteUrl: 'https://nitishagar.github.io/lumen/',
    packages: { cli: '@lumen-seo/cli' }, // non-URL strings ignored
    snippets: { installGlobal: 'npm install -g @lumen-seo/cli' },
  }),
  'packages/cli/README.md': 'cli — see https://nitishagar.github.io/lumen/docs/quickstart/',
  'packages/core/README.md': 'core',
};

describe('collectUrls — extraction hygiene (I5)', () => {
  it('collects every absolute URL, strips JSON-value trailing punctuation, dedupes with merged sources', () => {
    // The char class already excludes `>`/`)` from matches inside prose; the
    // stripTrailing branches matter for JSON-walked values (locked-names
    // fields) that can legitimately end in punctuation.
    const urls = collectUrls(fixtureRepo());
    const byUrl = new Map(urls.map((u) => [u.url, u]));
    expect(byUrl.get('https://nitishagar.github.io/lumen/')).toBeDefined(); // '.' stripped
    expect(byUrl.get('https://img.shields.io/badge/x-y')).toBeDefined(); // '>' stripped
    expect(byUrl.get('https://github.com/nitishagar/lumen')).toBeDefined();
    expect(byUrl.get('https://github.com/nitishagar/lumen/blob/main/LICENSE')).toBeDefined(); // ')' stripped
    expect(byUrl.get('https://github.com/nitishagar/lumen/security/advisories/new')).toBeDefined();
    expect(byUrl.get('https://nitishagar.github.io/lumen/docs/quickstart/')).toBeDefined();
    // locked-names URL fields collected; npm-name strings and snippet text never fetched
    expect(byUrl.get('https://github.com/nitishagar/lumen').sources).toContain('README.md');
    expect(byUrl.get('https://github.com/nitishagar/lumen').sources).toContain('site/src/data/locked-names.json');
    expect(urls.every((u) => !u.url.startsWith('npm:'))).toBe(true);
  });

  it('no source files → loud error, not a decorative green run', () => {
    const empty = makeRepo({});
    expect(() => collectUrls(empty)).toThrow(/no link-check source files/);
  });
});

let fixtureRepoCache;
const fixtureRepo = () => (fixtureRepoCache ??= makeRepo(fixtureFiles));

describe('checkUrl — politeness + honesty contract (I5)', () => {
  it('HEAD 2xx passes without a GET', async () => {
    const calls = [];
    const ok = await checkUrl('https://x.test/a', async (url, init) => {
      calls.push(init.method);
      return { ok: true, status: 200, body: { cancel: async () => {} } };
    });
    expect(ok).toEqual({ ok: true });
    expect(calls).toEqual(['HEAD']);
  });

  it('HEAD 403/405/501 falls back to GET once', async () => {
    const calls = [];
    for (const status of [403, 405, 501]) {
      calls.length = 0;
      const ok = await checkUrl('https://x.test/a', async (url, init) => {
        calls.push(init.method);
        return init.method === 'HEAD'
          ? { ok: false, status, body: { cancel: async () => {} } }
          : { ok: true, status: 200, body: { cancel: async () => {} } };
      });
      expect(ok, `status ${status} should fall back to GET`).toEqual({ ok: true });
      expect(calls).toEqual(['HEAD', 'GET']);
    }
  });

  it('non-2xx on HEAD fails immediately with the status (honest, no GET, no retry on HTTP status)', async () => {
    let attempts = 0;
    const res = await checkUrl('https://x.test/404', async () => {
      attempts++;
      return { ok: false, status: 404, body: { cancel: async () => {} } };
    });
    expect(res).toEqual({ ok: false, status: 404 });
    expect(attempts).toBe(1);
  });

  it('network errors retry exactly once (RETRIES=1) then fail with the cause', async () => {
    let attempts = 0;
    const res = await checkUrl('https://x.test/net', async () => {
      attempts++;
      throw new Error('getaddrinfo ENOTFOUND');
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOTFOUND/);
    expect(attempts).toBe(2); // 1 + RETRIES
  });

  it('sends the identifying lumen UA (P-Polite)', async () => {
    let ua;
    await checkUrl('https://x.test/ua', async (url, init) => {
      ua = init.headers['user-agent'];
      return { ok: true, status: 200, body: { cancel: async () => {} } };
    });
    expect(ua).toMatch(/^lumen-link-check\/.*\(\+https:\/\/github\.com\/nitishagar\/lumen\)$/);
  });
});

describe('runCheck — concurrency cap + failure report shape', () => {
  it('bounds concurrency at 5 even with more URLs than workers (I5)', async () => {
    let inFlight = 0;
    let peak = 0;
    // 8 URLs: an unbounded implementation would peak at 8, the cap holds 5.
    const urls = Array.from({ length: 8 }, (_, i) => `https://u${i}.test/x`);
    const root = makeRepo({ 'README.md': urls.map((u) => `see ${u}`).join('\n') });
    const { checked, failures } = await runCheck({
      root,
      fetchImpl: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { ok: true, status: 200, body: { cancel: async () => {} } };
      },
    });
    expect(checked).toBe(8);
    expect(failures).toHaveLength(0);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('reports failures with sources', async () => {
    const root = makeRepo({ 'README.md': 'bad: https://fail.test/x and https://ok.test/y' });
    const { checked, failures } = await runCheck({
      root,
      fetchImpl: async (url) =>
        url.startsWith('https://fail.test')
          ? { ok: false, status: 500, body: { cancel: async () => {} } }
          : { ok: true, status: 200, body: { cancel: async () => {} } },
    });
    expect(checked).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0].url).toBe('https://fail.test/x');
    expect(failures[0].status).toBe(500);
    expect(failures[0].sources).toContain('README.md');
  });
});

describe('main — the exit-code contract CI keys on (I5)', () => {
  const rootWithFailure = () => makeRepo({ 'README.md': 'bad: https://fail.test/x and good: https://ok.test/y' });
  const fetcher = async (url) =>
    url.startsWith('https://fail.test')
      ? { ok: false, status: 500, body: { cancel: async () => {} } }
      : { ok: true, status: 200, body: { cancel: async () => {} } };

  it('a failing URL → exit 1, with the FAIL line naming URL and source', async () => {
    const lines = [];
    const code = await main({ argv: ['node', 'link-check.mjs'], fetchImpl: fetcher, log: (l) => lines.push(l), root: rootWithFailure() });
    expect(code).toBe(1);
    const joined = lines.join('\n');
    expect(joined).toContain('FAIL https://fail.test/x');
    expect(joined).toContain('HTTP 500');
    expect(joined).toContain('referenced by README.md');
    expect(joined).toContain('2 URLs, 1 failed');
  });

  it('all URLs healthy → exit 0', async () => {
    const root = makeRepo({ 'README.md': 'good: https://ok.test/y' });
    const code = await main({
      argv: ['node', 'link-check.mjs'],
      fetchImpl: async () => ({ ok: true, status: 200, body: { cancel: async () => {} } }),
      log: () => {},
      root,
    });
    expect(code).toBe(0);
  });

  it('--json emits one parseable document with the failure list (CI annotations)', async () => {
    const lines = [];
    const code = await main({ argv: ['node', 'link-check.mjs', '--json'], fetchImpl: fetcher, log: (l) => lines.push(l), root: rootWithFailure() });
    expect(code).toBe(1);
    const payload = JSON.parse(lines.join(''));
    expect(payload.checked).toBe(2);
    expect(payload.failed).toBe(1);
    expect(payload.failures[0].url).toBe('https://fail.test/x');
    expect(payload.failures[0].sources).toEqual(['README.md']);
  });
});
