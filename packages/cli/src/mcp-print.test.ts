/**
 * `lumen mcp --print` contract (E11): all 8 payloads (4 targets × local /
 * remote `--url`) print deterministically to stdout, exit 0, WITHOUT starting
 * the server, and match the @lumen-seo/mcp builders byte-for-byte (the site
 * docs consume the same strings). Snapshot-tested for visible drift.
 */
import { describe, expect, it } from 'vitest';
import { onboardPayload } from '@lumen-seo/mcp';
import { run } from './run.js';
import { MemoryIo } from './io.js';

const TARGETS = ['json', 'claude', 'cursor', 'vscode'] as const;
const REMOTE = 'https://mcp.example.com/mcp';

const printPayload = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
  const io = new MemoryIo();
  const code = await run(['mcp', ...args], io);
  return { code, stdout: io.stdout.join(''), stderr: io.stderr.join('') };
};

describe('mcp --print onboarding payloads (E11)', () => {
  it.each(TARGETS)('lumen mcp --print %s (local) — spawn-equivalent output, exit 0, no server', async (target) => {
    const r = await printPayload(['--print', target]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${onboardPayload(target)}\n`);
    expect(r.stderr).toBe(''); // no startup note — the server never started
    expect(r.stdout).toMatchSnapshot(`print-${target}-local`);
  });

  it.each(TARGETS)('lumen mcp --print %s --url <remote> — remote variant matches builder', async (target) => {
    const r = await printPayload(['--print', target, '--url', REMOTE]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${onboardPayload(target, REMOTE)}\n`);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatchSnapshot(`print-${target}-remote`);
  });

  it('invalid --print target exits 2 with the allowed values (I15)', async () => {
    const r = await printPayload(['--print', 'bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--print must be one of');
  });

  it('--url without a scheme exits 2 (I15)', async () => {
    const r = await printPayload(['--print', 'json', '--url', 'not-a-url']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--url must be an http(s) URL');
  });

  it('never embeds key material in any printed payload (E11/I16)', async () => {
    for (const target of TARGETS) {
      for (const args of [['--print', target], ['--print', target, '--url', REMOTE]]) {
        const r = await printPayload(args);
        expect(r.stdout).not.toMatch(/KEY|SECRET|TOKEN|sk-/i);
      }
    }
  });
});
