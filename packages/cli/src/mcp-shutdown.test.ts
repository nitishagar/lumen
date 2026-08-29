/**
 * Shutdown contract for the long-running `lumen mcp` serve command (E14):
 * stdin close → graceful exit 0; SIGINT → exit 2 with `cancelled` on stderr;
 * Ctrl-C can never hang the process (bounded-timeout assertions on BOTH
 * paths, spawned through the real bin).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN } from './spawn.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-mcp-shutdown-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Session {
  stdout: string;
  stderr: string;
  exit: Promise<number | null>;
}

/** Spawns `lumen mcp` holding stdin open until the test acts on it. */
const spawnServing = (): Session => {
  const child = spawn(process.execPath, [BIN, 'mcp'], {
    cwd: dir,
    env: { ...process.env, LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session: Session = { stdout: '', stderr: '', exit: new Promise(() => {}) };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    session.stdout += d;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    session.stderr += d;
  });
  session.exit = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });
  (session as Session & { child?: ReturnType<typeof spawn> }).child = child;
  return session;
};

/** Resolves once the server announces readiness on stderr (bounded). */
const waitReady = async (session: Session): Promise<void> => {
  const deadline = Date.now() + 20_000;
  while (!session.stderr.includes('stdio transport ready')) {
    if (Date.now() > deadline) {
      throw new Error(`server never became ready; stderr: ${JSON.stringify(session.stderr)}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** Fails the test (deterministically, no Vitest global timer reliance). */
const withTimeout = async (p: Promise<unknown>, ms: number, what: string): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${what} did not happen within ${ms}ms (E14 hang)`)), ms);
  });
  try {
    await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

describe('mcp shutdown contract (E14)', () => {
  it(
    'stdin close → graceful stop, exit 0, within a bounded timeout',
    async () => {
      const session = spawnServing();
      await waitReady(session);
      const child = (session as Session & { child: ReturnType<typeof spawn> }).child;
      child.stdin.end(); // client disconnect
      await withTimeout(session.exit, 10_000, 'exit after stdin close');
      expect(await session.exit).toBe(0);
    },
    40_000,
  );

  it(
    'SIGINT → prompt exit 2 with `cancelled` on stderr, within a bounded timeout (no hang)',
    async () => {
      const session = spawnServing();
      await waitReady(session);
      const child = (session as Session & { child: ReturnType<typeof spawn> }).child;
      child.kill('SIGINT');
      await withTimeout(session.exit, 10_000, 'exit after SIGINT');
      expect(await session.exit).toBe(2);
      expect(session.stderr).toContain('cancelled');
    },
    40_000,
  );
});
