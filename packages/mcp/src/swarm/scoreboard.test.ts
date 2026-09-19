/**
 * Scoreboard tests (Stage 1): serialized O_APPEND durability, the 4KB line
 * cap, and the secret-scrub guarantee (sentinel probe).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SCOREBOARD_LINE_BYTES, Scoreboard } from './scoreboard.js';

const SENTINEL = '__SWARM_SENTINEL_9f3__';
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

const tmpBoard = async (): Promise<{ board: Scoreboard; file: string }> => {
  const dir = await mkdtemp(join(tmpdir(), 'lumen-swarm-'));
  dirs.push(dir);
  const file = join(dir, 'scoreboard.jsonl');
  return { board: new Scoreboard(file), file };
};

describe('scoreboard durability', () => {
  it('appends one JSON line per completed case', async () => {
    const { board, file } = await tmpBoard();
    await board.append({ adversary: 'a1', tool: 'lumen_authority', verdict: 'pass', reason: 'ok' });
    const text = await readFile(file, 'utf8');
    const row = JSON.parse(text.trim()) as Record<string, unknown>;
    expect(row).toMatchObject({ adversary: 'a1', tool: 'lumen_authority', verdict: 'pass', reason: 'ok' });
    expect(typeof row.retrievedAt).toBe('string');
  });

  it('concurrent appends all land (serialized queue, single O_APPEND writes)', async () => {
    const { board, file } = await tmpBoard();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        board.append({ adversary: `a${i}`, tool: 'lumen_authority', verdict: i % 2 === 0 ? 'pass' : 'fail', reason: `r${i}` }),
      ),
    );
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(20);
    expect(lines.map((l) => (JSON.parse(l) as { adversary: string }).adversary).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `a${i}`).sort(),
    );
  });

  it('caps lines at 4KB by truncating the reason', async () => {
    const { board, file } = await tmpBoard();
    await board.append({ adversary: 'big', tool: 't', verdict: 'fail', reason: `x${'y'.repeat(20000)}` });
    const line = (await readFile(file, 'utf8')).trim();
    expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(MAX_SCOREBOARD_LINE_BYTES);
    expect(JSON.parse(line) as object).toHaveProperty('reason');
  });
});

describe('scoreboard scrub (sentinel probe)', () => {
  it('redacts secret-bearing URLs and never stores the sentinel value', async () => {
    const { board, file } = await tmpBoard();
    await board.append({
      adversary: 'sentinel',
      tool: 'lumen_page_report',
      verdict: 'fail',
      reason: `upstream said https://provider.example/x?key=${SENTINEL}&q=1`,
    });
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(SENTINEL);
    expect(text).toContain('redacted');
  });

  it('scrubs uppercase-scheme URLs too (token match is case-insensitive)', async () => {
    const { board, file } = await tmpBoard();
    await board.append({
      adversary: 'sentinel-upper',
      tool: 'lumen_page_report',
      verdict: 'fail',
      reason: `upstream said HTTPS://provider.example/x?key=${SENTINEL}`,
    });
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(SENTINEL);
    expect(text).toContain('redacted');
  });
});
