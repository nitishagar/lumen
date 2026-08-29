/**
 * stdio round-trip over the REAL spawned bin (E2): initialize → tools/list →
 * tools/call as raw newline-delimited JSON-RPC on the child's stdio. stdout
 * must carry protocol frames ONLY (the startup note lives on stderr).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN } from './spawn.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lumen-mcp-stdio-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface SessionResult {
  stdout: string;
  stderr: string;
  responses: Map<number, JsonRpcMessage>;
}

/**
 * Sends newline-delimited JSON-RPC frames, collects the responses for the
 * given ids, then terminates the child. Every COMPLETE stdout line must parse
 * as JSON (E2: stdout carries protocol only — any startup note on stdout
 * fails here); partial trailing lines are buffered until complete.
 */
const roundTrip = async (frames: object[], waitForResponseIds: number[]): Promise<SessionResult> => {
  const child = spawn(process.execPath, [BIN, 'mcp'], {
    cwd: dir,
    env: { ...process.env, LUMEN_HISTORY_DIR: join(dir, '.lumen', 'history') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let buffer = '';
  const responses = new Map<number, JsonRpcMessage>();
  const remaining = new Set(waitForResponseIds);

  const handleLine = (line: string): void => {
    if (line.trim() === '') return;
    let parsed: JsonRpcMessage;
    try {
      parsed = JSON.parse(line) as JsonRpcMessage; // non-JSON stdout = protocol violation (E2)
    } catch {
      throw new Error(`stdout carried a non-JSON-RPC line: ${JSON.stringify(line)}\nstderr: ${stderr}`);
    }
    if (parsed.id !== undefined && parsed.id !== null && remaining.has(parsed.id as number)) {
      responses.set(parsed.id as number, parsed);
      remaining.delete(parsed.id as number);
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // last element is a possibly-partial line
    for (const line of lines) handleLine(line);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  for (const frame of frames) {
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  }
  const deadline = Date.now() + 15_000;
  while (remaining.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  if (remaining.size > 0) {
    throw new Error(`no response for id(s): ${[...remaining].join(', ')}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  return { stdout, stderr, responses };
};

const initializeFrames = (nextId: number): object[] => [
  {
    jsonrpc: '2.0',
    id: nextId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'contract-test', version: '0.0.0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];

describe('stdio round-trip via the real bin (E2/E14)', () => {
  it(
    'initialize → tools/list → tools/call over child-process stdio; startup note is on stderr',
    async () => {
      const { stdout, stderr, responses } = await roundTrip(
        [
          ...initializeFrames(1),
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'lumen_audit_site', arguments: { url: 'https://example.com' } },
          },
        ],
        [1, 2, 3],
      );
      // E2: stdout is protocol only (enforced per-line in handleLine).
      expect(stdout.split('\n').filter((l) => l.trim() !== '').length).toBeGreaterThanOrEqual(3);
      expect(stderr).toContain('stdio transport ready');
      const tools = (responses.get(2)!.result?.tools as { name: string }[]).map((t) => t.name);
      expect(tools.sort()).toEqual(
        [
          'lumen_audit_site',
          'lumen_authority',
          'lumen_keyword_ideas',
          'lumen_page_report',
          'lumen_rank_check',
        ].sort(),
      );
      const payload = JSON.parse(
        (responses.get(3)!.result?.content as { type: string; text: string }[])[0].text,
      ) as Record<string, unknown>;
      expect(payload.url).toBe('https://example.com/');
      expect(payload.passesThreshold).toBe(true); // fixture audit runner — zero network
    },
    30_000,
  );

  it(
    'per-frame protocol purity: every stdout line parses as JSON-RPC (E2)',
    async () => {
      const { stdout } = await roundTrip([...initializeFrames(1), { jsonrpc: '2.0', id: 2, method: 'tools/list' }], [1, 2]);
      const lines = stdout.split('\n').filter((l) => l.trim() !== '');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    },
    30_000,
  );
});
