/**
 * E1.1 acceptance tests (PRD AC): a REAL loopback HTTP server, the REAL bin.
 * - `audit http://127.0.0.1:PORT --allow-private` audits the fixture server (exit 0/1);
 * - without the flag it refuses with exit 2 and the message names the flag;
 * - config-only opt-in (crawl.allowPrivateHosts) works without the flag;
 * - `0.0.0.0/0` in config is a loud config error (exit 2).
 * The redirect-to-metadata adversary is exercised at fetcher level
 * (private-scope-fetcher.test.ts in core); this suite proves the CLI path.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnCli } from './spawn.js';

const PAGE = `<!doctype html><html lang="en"><head><title>Loopback fixture with a fine title</title>
<meta name="description" content="An adequately long meta description for the fixture page."></head>
<body><h1>Loopback fixture</h1><p>hello</p></body></html>`;

let server: Server;
let port: number;
let dir: string;
let base: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no loopback port');
  port = addr.port;
  base = `http://127.0.0.1:${port}`;
  dir = await mkdtemp(join(tmpdir(), 'lumen-allow-private-'));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

const configAt = async (name: string, body: string): Promise<string> => {
  const p = join(dir, name);
  await writeFile(p, body, 'utf8');
  return p;
};

describe('audit on a loopback target (real server, real bin)', () => {
  it('AC: --allow-private audits the fixture server (exit 0/1)', async () => {
    const res = await spawnCli(['audit', base, '--allow-private', '--max-pages', '1'], {
      cwd: dir,
      env: { LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') },
    });
    expect([0, 1]).toContain(res.code);
    expect(res.stdout).toContain('audit:');
    expect(res.stdout).toContain(base);
  });

  it('AC: without the flag it refuses with exit 2 naming the flag', async () => {
    const res = await spawnCli(['audit', base, '--max-pages', '1'], { cwd: dir });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--allow-private');
    expect(res.stdout).toBe('');
  });

  it('report on loopback: --allow-private works, without it refuses', async () => {
    const ok = await spawnCli(['report', base, '--allow-private'], { cwd: dir });
    expect(ok.code).toBe(0);
    const refused = await spawnCli(['report', base], { cwd: dir });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--allow-private');
  });

  it('AC: config-only opt-in (crawl.allowPrivateHosts with the literal) needs no flag', async () => {
    const cfg = await configAt('allow.json', JSON.stringify({ crawl: { allowPrivateHosts: ['127.0.0.0/8'] } }));
    const res = await spawnCli(['audit', base, '--max-pages', '1', '--config', cfg], { cwd: dir });
    expect([0, 1]).toContain(res.code);
  });

  it('AC: a config-listed host does NOT extend to other private hosts (origin scoping end-to-end)', async () => {
    // The allowlist admits 127.0.0.0/8 as the SEED — a different private host
    // never becomes the seed through admission, so this stays refused.
    const cfg = await configAt('allow.json', JSON.stringify({ crawl: { allowPrivateHosts: ['127.0.0.0/8'] } }));
    const res = await spawnCli(['audit', 'http://10.1.2.3:9/', '--max-pages', '1', '--config', cfg], { cwd: dir });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/refusing non-public target/);
  });

  it('0.0.0.0/0 in config is a loud config error (exit 2), never allow-everything', async () => {
    const cfg = await configAt('allowall.json', JSON.stringify({ crawl: { allowPrivateHosts: ['0.0.0.0/0'] } }));
    const res = await spawnCli(['audit', base, '--max-pages', '1', '--config', cfg], { cwd: dir });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('allowPrivateHosts');
  });

  it('--canonical-origin with a non-URL value is a usage error', async () => {
    const res = await spawnCli(['audit', base, '--allow-private', '--canonical-origin', 'not a url'], { cwd: dir });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--canonical-origin');
  });
});
