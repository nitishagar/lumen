/**
 * Judge interface tests (Stage 2): config validation, BYOK key handling,
 * canonical cache keys, cache round-trip, retry deviation, verdict parsing,
 * and the never-log-the-key guarantee (sentinel probe).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RetryAfterCapError, RetryExhaustedError, TimeoutError } from '@lumen-seo/core';
import { ParseError, UpstreamError } from '@lumen-seo/providers';
import {
  DEFAULT_JUDGE_KEY_ENV,
  JUDGE_RUBRIC_VERSION,
  assertHttpsBaseUrl,
  buildJudgeMessages,
  cacheKeyFor,
  canonicalJson,
  judgeCall,
  parseJudgeVerdict,
  readVerdictCache,
  resolveJudgeKey,
  resolveJudgeVerdict,
  validateJudgeConfig,
  writeVerdictCache,
} from './judge.js';
import type { JudgeConfig } from './judge.js';

const SENTINEL = '__JUDGE_SENTINEL_7c1__';
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

const tmpDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'lumen-judge-'));
  dirs.push(dir);
  return dir;
};

const envelope = (content: string, status: number, headers: Record<string, string> = {}): Response =>
  new Response(content, { status, headers });

const verdictBody = (score: number, reason: string): string =>
  JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score, reason }) } }] });

describe('judge config', () => {
  it('accepts a well-formed vendor-neutral config', () => {
    expect(() =>
      validateJudgeConfig({
        modelId: 'openai:gpt-4.1-mini',
        temperature: 0,
        rubricVersion: JUDGE_RUBRIC_VERSION,
        apiKeyEnv: DEFAULT_JUDGE_KEY_ENV,
        baseUrl: 'https://api.example/v1/chat/completions',
      }),
    ).not.toThrow();
  });

  it('rejects empty/overlong model ids, non-zero temperature, wrong rubric, http base', () => {
    const base = {
      modelId: 'm',
      temperature: 0 as const,
      rubricVersion: JUDGE_RUBRIC_VERSION,
      apiKeyEnv: 'LUMEN_JUDGE_KEY',
    };
    expect(() => validateJudgeConfig({ ...base, modelId: '' })).toThrow(/modelId/);
    expect(() => validateJudgeConfig({ ...base, modelId: `x${'y'.repeat(128)}` })).toThrow(/modelId/);
    expect(() => validateJudgeConfig({ ...base, temperature: 1 as unknown as 0 })).toThrow(/temperature/);
    expect(() => validateJudgeConfig({ ...base, rubricVersion: 'v9' as never })).toThrow(/rubricVersion/);
    expect(() => assertHttpsBaseUrl('http://api.example/v1')).toThrow(/https/);
    expect(() => assertHttpsBaseUrl('not a url')).toThrow(/https/);
  });

  it('module default names the env var; empty is absent', () => {
    expect(DEFAULT_JUDGE_KEY_ENV).toBe('LUMEN_JUDGE_KEY');
    expect(resolveJudgeKey(() => '  ', 'K')).toBeUndefined();
    expect(resolveJudgeKey(() => 'sekret', 'K')).toBe('sekret');
  });
});

describe('canonical cache keys', () => {
  it('shuffled keys and fresh timestamps hit the same key', () => {
    const a = { tool: 't', output: { b: 1, a: 2, retrievedAt: '2026-01-01T00:00:00Z' } };
    const b = { output: { a: 2, retrievedAt: '2026-09-18T00:00:00Z', b: 1 }, tool: 't' };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(cacheKeyFor({ x: 1 }, { y: 2 }, JUDGE_RUBRIC_VERSION)).toBe(
      cacheKeyFor({ x: 1 }, { y: 2 }, JUDGE_RUBRIC_VERSION),
    );
  });

  it('round-trips verdicts; malformed entries read as absent', async () => {
    const dir = await tmpDir();
    const k1 = 'a'.repeat(64);
    const k2 = 'b'.repeat(64);
    expect(await readVerdictCache(dir, k1)).toBeUndefined();
    await writeVerdictCache(dir, k1, {
      score: 1,
      reason: 'ok',
      modelId: 'm',
      rubricVersion: JUDGE_RUBRIC_VERSION,
      retrievedAt: new Date().toISOString(),
    });
    expect(await readVerdictCache(dir, k1)).toMatchObject({ score: 1, reason: 'ok' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, `${k2}.json`), '{oops', 'utf8');
    expect(await readVerdictCache(dir, k2)).toBeUndefined(); // malformed file reads as absent
  });

  it('cache store boundary rejects non-sha256 keys (read absent, write loud)', async () => {
    const dir = await tmpDir();
    expect(await readVerdictCache(dir, '../../etc/passwd')).toBeUndefined();
    const verdict = {
      score: 1 as const,
      reason: 'ok',
      modelId: 'm',
      rubricVersion: JUDGE_RUBRIC_VERSION,
      retrievedAt: new Date().toISOString(),
    };
    await expect(writeVerdictCache(dir, '../../escape', verdict)).rejects.toThrow(/64-char sha256/);
  });
});

describe('judgeCall retry deviation', () => {
  const call = (
    fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
    extra: Partial<Parameters<typeof judgeCall>[0]> = {},
  ) =>
    judgeCall({
      baseUrl: 'https://judge.example/v1/chat/completions',
      apiKey: 'k',
      modelId: 'm',
      system: 's',
      user: '{}',
      sleep: () => Promise.resolve(),
      rng: () => 0,
      fetchImpl: fetchImpl as typeof fetch,
      ...extra,
    });

  it('retries 429 then succeeds (attempts counted, Retry-After honored)', async () => {
    const seen: string[] = [];
    const sleeps: number[] = [];
    const fetchImpl = async (): Promise<Response> => {
      seen.push('call');
      if (seen.length === 1) return envelope('slow down', 429, { 'retry-after': '0' });
      return envelope(verdictBody(1, 'ok'), 200);
    };
    const text = await call(fetchImpl, { sleep: async (ms) => void sleeps.push(ms) });
    expect(seen).toHaveLength(2);
    expect(sleeps).toEqual([0]);
    expect(parseJudgeVerdict(text)).toEqual({ score: 1, reason: 'ok' });
  });

  it('does not retry non-retryable 4xx (typed UpstreamError, status surfaces, no sleep)', async () => {
    const sleeps: number[] = [];
    const fetchImpl = async (): Promise<Response> => envelope('bad key', 403);
    const err = await call(fetchImpl, { sleep: async (ms) => void sleeps.push(ms) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).status).toBe(403);
    expect((err as Error).message).toContain('HTTP 403');
    expect(sleeps).toHaveLength(0);
  });

  it('exhaustion surfaces attempts/status/cause; Retry-After over cap refuses to sleep', async () => {
    const fetchImpl = async (): Promise<Response> => envelope('boom', 500);
    const err = await call(fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect((err as RetryExhaustedError).attempts).toBe(3);
    const capped = async (): Promise<Response> => envelope('slow', 429, { 'retry-after': '99999' });
    await expect(call(capped)).rejects.toBeInstanceOf(RetryAfterCapError);
  });

  it('timeouts never retry (TimeoutError, single attempt)', async () => {
    let calls = 0;
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      calls += 1;
      const signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    };
    await expect(call(fetchImpl, { timeoutMs: 20 })).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });
});

describe('verdicts + key hygiene (sentinel probe)', () => {
  it('parses {score, reason}; rejects non-JSON and bad shapes', () => {
    expect(parseJudgeVerdict('{"score":0,"reason":"no source"}')).toEqual({ score: 0, reason: 'no source' });
    expect(() => parseJudgeVerdict('nope')).toThrow(ParseError);
    expect(() => parseJudgeVerdict('{"score":2,"reason":"x"}')).toThrow(ParseError);
  });

  it('key rides the Authorization header and never lands in the cache file', async () => {
    const dir = await tmpDir();
    let auth: string | null = null;
    const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
      auth = new Headers(init.headers).get('authorization');
      return envelope(verdictBody(1, 'fine'), 200);
    };
    const raw = await judgeCall({
      baseUrl: 'https://judge.example/v1/chat/completions',
      apiKey: SENTINEL,
      modelId: 'm',
      system: 's',
      user: '{}',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(auth).toBe(`Bearer ${SENTINEL}`);
    const { score, reason } = parseJudgeVerdict(raw);
    await writeVerdictCache(dir, 'c'.repeat(64), {
      score,
      reason,
      modelId: 'm',
      rubricVersion: JUDGE_RUBRIC_VERSION,
      retrievedAt: new Date().toISOString(),
    });
    expect(await readFile(join(dir, `${'c'.repeat(64)}.json`), 'utf8')).not.toContain(SENTINEL);
  });

  it('messages pin the rubric and canonicalize the payload', () => {
    const { system, user } = buildJudgeMessages('t', { b: 1 }, { a: 1 });
    expect(system).toContain(JUDGE_RUBRIC_VERSION);
    expect(user).toBe(canonicalJson({ tool: 't', args: { b: 1 }, output: { a: 1 } }));
  });
});

describe('resolveJudgeVerdict orchestration', () => {
  const config: JudgeConfig = {
    modelId: 'test-model',
    temperature: 0,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    apiKeyEnv: 'LUMEN_JUDGE_KEY',
    baseUrl: 'https://judge.example/v1/chat/completions',
  };
  const input = { tool: 'lumen_page_report', args: { url: 'https://example.com' } };
  const output = { url: 'https://example.com/', lab: { scores: { performance: 1 } } };

  const rig = async () => {
    const dir = await tmpDir();
    const rows: { verdict: string; reason: string }[] = [];
    let calls = 0;
    return {
      dir,
      rows,
      calls: () => calls,
      deps: {
        env: (n: string) => (n === 'LUMEN_JUDGE_KEY' ? 'k' : undefined),
        caller: async (): Promise<string> => {
          calls += 1;
          return JSON.stringify({ score: 1, reason: 'all labeled' });
        },
        cacheDir: dir,
        appendFinding: async (f: { verdict: 'pass' | 'fail' | 'unscored'; reason: string }): Promise<void> => {
          rows.push({ verdict: f.verdict, reason: f.reason });
        },
      },
    };
  };

  it('live miss calls once, caches, and records pass; rerun hits cache with zero calls', async () => {
    const r = await rig();
    const first = await resolveJudgeVerdict(config, input, output, r.deps);
    expect(first).toEqual({ score: 1, cached: false });
    expect(r.calls()).toBe(1);
    expect(r.rows).toHaveLength(1);
    const second = await resolveJudgeVerdict(config, input, output, r.deps);
    expect(second).toEqual({ score: 1, cached: true });
    expect(r.calls()).toBe(1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]?.reason).toContain('cached:');
  });

  it('absent key records unscored without calling', async () => {
    const r = await rig();
    const noKey = { ...r.deps, env: () => undefined };
    const result = await resolveJudgeVerdict(config, input, output, noKey);
    expect(result).toEqual({ score: 0, cached: false, unscored: 'key-absent' });
    expect(r.calls()).toBe(0);
    expect(r.rows).toEqual([{ verdict: 'unscored', reason: 'key-absent' }]);
  });

  it('present key without endpoint is a loud misconfiguration error', async () => {
    const r = await rig();
    const { baseUrl: _drop, ...noEndpoint } = config;
    await expect(resolveJudgeVerdict(noEndpoint, input, output, r.deps)).rejects.toThrow(/LUMEN_JUDGE_BASE_URL/);
    expect(r.calls()).toBe(0);
  });
});
