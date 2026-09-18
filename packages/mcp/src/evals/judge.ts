/**
 * Vendor-neutral live-judge interface (Stage 2): the skipped `judge.live`
 * scorer enabled without touching the offline default. No vendor is pinned
 * in-repo — `modelId` is a user-supplied string recorded verbatim, the
 * credential is a BYOK env-var NAME resolved at call time, and the default
 * transport is a dependency-free fetch POST to a user-configured
 * OpenAI-compatible endpoint (key in the Authorization header, never the
 * URL). Verdicts are content-addressed cached (canonical JSON, volatile
 * timestamps stripped) so unchanged cases never re-call the judge.
 *
 * Retry is the stated deviation from the Fetcher discipline (spec permits a
 * stated deviation): POST scoring calls carry an idempotency-safe identical
 * body and never mutate vendor state, so ≤2 retries on 429/5xx and transport
 * failures (mirroring the core Fetcher's treatment of network errors), with
 * Retry-After honored but capped at 30s (above → `RetryAfterCapError`, never
 * a long sleep) and full-jitter base 500ms otherwise. Timeouts never retry —
 * a timed-out attempt surfaces immediately as `TimeoutError`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RetryAfterCapError, RetryExhaustedError, TimeoutError } from '@lumen-seo/core';
import { ParseError, UpstreamError, retryAfterMs } from '@lumen-seo/providers';

export const JUDGE_RUBRIC_VERSION = 'judge-rubric-1' as const;

/** Fixed rubric text — pinned in code, versioned above. */
export const JUDGE_RUBRIC = [
  'You score lumen MCP tool outputs for data honesty (rubric judge-rubric-1).',
  'Score 1 only if every metric carries source+retrievedAt, every unavailable leg states its reason,',
  'no number is zero-filled, and the verdict cites the breached output line; otherwise score 0 with reason.',
  'Reply with exactly {"score": 0|1, "reason": "<cited line or ok>"}.',
].join(' ');

/** Default BYOK env-var NAME for the judge credential (BYOK names-not-values). */
export const DEFAULT_JUDGE_KEY_ENV = 'LUMEN_JUDGE_KEY';export const JUDGE_TIMEOUT_MS = 30_000;
export const JUDGE_MAX_RETRIES = 2;
export const JUDGE_BACKOFF_MS = 500;
export const JUDGE_RETRY_AFTER_CAP_MS = 30_000;
export const MAX_MODEL_ID_LENGTH = 128;

export interface JudgeConfig {
  /** User-supplied model id, recorded verbatim (no in-repo allowlist — vendor-neutral). */
  modelId: string;
  temperature: 0;
  rubricVersion: typeof JUDGE_RUBRIC_VERSION;
  /** Env-var NAME holding the credential (never the value). */
  apiKeyEnv: string;
  /** Fetch-path endpoint; must be https. Only used when calling via fetch instead of an SDK. */
  baseUrl?: string;
}

export const validateJudgeConfig = (c: JudgeConfig): void => {
  if (typeof c.modelId !== 'string' || c.modelId === '' || c.modelId.length > MAX_MODEL_ID_LENGTH) {
    throw new Error(`judge modelId must be a non-empty string ≤${MAX_MODEL_ID_LENGTH} chars`);
  }
  if (c.temperature !== 0) throw new Error('judge temperature must be 0 (deterministic verdicts)');
  if (c.rubricVersion !== JUDGE_RUBRIC_VERSION) {
    throw new Error(`judge rubricVersion must be "${JUDGE_RUBRIC_VERSION}"`);
  }
  if (typeof c.apiKeyEnv !== 'string' || c.apiKeyEnv === '') {
    throw new Error('judge apiKeyEnv must be an env-var NAME (BYOK names-not-values)');
  }
  if (c.baseUrl !== undefined) assertHttpsBaseUrl(c.baseUrl);
};

export const assertHttpsBaseUrl = (baseUrl: string): void => {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`judge baseUrl must be an https URL (got ${JSON.stringify(baseUrl)})`);
  }
  if (u.protocol !== 'https:') throw new Error('judge baseUrl must be an https URL (refusing non-https judge transport)');
};

/** Empty/whitespace key counts as absent (mirrors provider BYOK handling). */
export const resolveJudgeKey = (
  env: (name: string) => string | undefined,
  name: string,
): string | undefined => {
  const v = env(name);
  return v === undefined || v.trim() === '' ? undefined : v;
};

/** Timestamp-shaped fields excluded from the cache key (fresh stamps must hit). */
const VOLATILE_KEYS = new Set(['retrievedAt', 'startedAt', 'completedAt']);

const canonicalValue = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonicalValue);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !VOLATILE_KEYS.has(k))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, val]) => [k, canonicalValue(val)]),
    );
  }
  return v;
};

/** Canonical JSON: sorted keys, volatile timestamps stripped (stable cache keys). */
export const canonicalJson = (v: unknown): string => JSON.stringify(canonicalValue(v));

export const cacheKeyFor = (input: unknown, output: unknown, rubricVersion: string): string =>
  createHash('sha256').update(canonicalJson({ input, output, rubricVersion })).digest('hex');

export interface CachedVerdict {
  score: 0 | 1;
  reason: string;
  modelId: string;
  rubricVersion: string;
  retrievedAt: string;
}

export const judgeCacheDir = (): string => process.env.JUDGE_CACHE_DIR ?? '.evalite/judge-cache';

/** Cache files are content-addressed sha256 hex — the store rejects anything else. */
const KEY_RE = /^[0-9a-f]{64}$/;

/** Missing/malformed cache entries read as absent — never throw on cache. */
export const readVerdictCache = async (dir: string, key: string): Promise<CachedVerdict | undefined> => {
  if (!KEY_RE.test(key)) return undefined;
  let text: string;
  try {
    text = await readFile(join(dir, `${key}.json`), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const v = JSON.parse(text) as Partial<CachedVerdict>;
    if ((v.score !== 0 && v.score !== 1) || typeof v.reason !== 'string') return undefined;
    return v as CachedVerdict;
  } catch {
    return undefined;
  }
};

/** Whole-file temp-rename with tmp cleanup on failure (fits: small JSON files). */
export const writeVerdictCache = async (dir: string, key: string, verdict: CachedVerdict): Promise<void> => {
  if (!KEY_RE.test(key)) throw new Error('verdict cache key must be 64-char sha256 hex');
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${key}.json`);
  const tmp = join(dir, `.${key}.json.tmp-${process.pid}-${Date.now().toString(36)}`);
  try {
    await writeFile(tmp, JSON.stringify(verdict), 'utf8');
    await rename(tmp, target);
  } catch (err) {
    const fs = await import('node:fs/promises');
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
};

export interface JudgeCallOpts {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  system: string;
  user: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** OpenAI-compatible envelope → assistant content string. */
const assistantContent = (bodyText: string): string => {
  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    throw new ParseError('judge', 'malformed judge response body');
  }
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content === '') throw new ParseError('judge', 'judge response has no assistant content');
  return content;
};

/**
 * POST scoring call with the stated retry deviation (30s/attempt, ≤2 retries
 * on 429/5xx and transport failures, full-jitter base 500ms, Retry-After
 * capped at 30s). Exhaustion surfaces attempts/status/cause; a non-retryable
 * 4xx surfaces immediately as a typed `UpstreamError`; timeouts never retry.
 */
export const judgeCall = async (opts: JudgeCallOpts): Promise<string> => {
  assertHttpsBaseUrl(opts.baseUrl);
  const timeoutMs = opts.timeoutMs ?? JUDGE_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? JUDGE_MAX_RETRIES;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const rng = opts.rng ?? Math.random;
  const body = JSON.stringify({
    model: opts.modelId,
    temperature: 0,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });

  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetchImpl(opts.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        throw new TimeoutError('judge', timeoutMs, 'judge');
      }
      if (attempt >= maxRetries) {
        throw new RetryExhaustedError('judge call transport failure', { attempts: attempt + 1, label: 'judge', cause: e });
      }
      await sleep(rng() * JUDGE_BACKOFF_MS * 2 ** attempt);
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      const text = await res.text();
      return assistantContent(text);
    }
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    if (!retryable || attempt >= maxRetries) {
      if (!retryable) {
        throw new UpstreamError('judge', res.status, `judge call failed: HTTP ${res.status} ${snippet}`);
      }
      throw new RetryExhaustedError(`judge call failed: HTTP ${res.status} ${snippet}`, {
        attempts: attempt + 1,
        status: res.status,
        label: 'judge',
      });
    }
    const retryAfter = retryAfterMs(res);
    if (retryAfter !== undefined) {
      if (retryAfter > JUDGE_RETRY_AFTER_CAP_MS) throw new RetryAfterCapError(retryAfter, JUDGE_RETRY_AFTER_CAP_MS, 'judge');
      await sleep(Math.max(0, retryAfter));
    } else {
      await sleep(rng() * JUDGE_BACKOFF_MS * 2 ** attempt);
    }
  }
};

export const buildJudgeMessages = (tool: string, args: unknown, output: unknown): { system: string; user: string } => ({
  system: JUDGE_RUBRIC,
  user: canonicalJson({ tool, args, output }),
});

/** Parses `{score: 0|1, reason}` judge verdicts; anything else is a ParseError. */
export const parseJudgeVerdict = (text: string): { score: 0 | 1; reason: string } => {
  let v: unknown;
  try {
    v = JSON.parse(text) as unknown;
  } catch {
    throw new ParseError('judge', 'judge verdict is not JSON');
  }
  const o = v as { score?: unknown; reason?: unknown };
  if ((o.score !== 0 && o.score !== 1) || typeof o.reason !== 'string') {
    throw new ParseError('judge', 'judge verdict must be {"score": 0|1, "reason": string}');
  }
  return { score: o.score, reason: o.reason };
};

export interface JudgeToolInput {
  tool: string;
  args: unknown;
}

export interface JudgeCallerOpts {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  system: string;
  user: string;
}

export interface JudgeRunDeps {
  env: (name: string) => string | undefined;
  /** Transport: receives the fully-built call (default wraps `judgeCall`). */
  caller: (opts: JudgeCallerOpts) => Promise<string>;
  cacheDir: string;
  appendFinding: (f: { adversary: string; tool: string; verdict: 'pass' | 'fail' | 'unscored'; reason: string }) => Promise<void>;
  clock?: () => string;
}

export interface JudgeRunResult {
  score: 0 | 1;
  cached: boolean;
  unscored?: string;
}

/**
 * One judge verdict, end to end: key resolution → cache → live call → cache
 * write, with a scoreboard row for every outcome. Key-absent records
 * `unscored` (best-effort append — collection stays green); a missing
 * endpoint with a present key is a loud misconfiguration error.
 */
export const resolveJudgeVerdict = async (
  config: JudgeConfig,
  input: JudgeToolInput,
  output: unknown,
  deps: JudgeRunDeps,
): Promise<JudgeRunResult> => {
  validateJudgeConfig(config);
  const clock = deps.clock ?? (() => new Date().toISOString());
  const key = resolveJudgeKey(deps.env, config.apiKeyEnv);
  if (key === undefined) {
    await deps
      .appendFinding({ adversary: 'judge-quality', tool: input.tool, verdict: 'unscored', reason: 'key-absent' })
      .catch(() => undefined);
    return { score: 0, cached: false, unscored: 'key-absent' };
  }
  if (config.baseUrl === undefined) {
    throw new Error('LUMEN_JUDGE_BASE_URL is required for the fetch-path judge (https OpenAI-compatible endpoint)');
  }
  const dir = deps.cacheDir;
  const cacheKey = cacheKeyFor(input, output, config.rubricVersion);
  const cached = await readVerdictCache(dir, cacheKey);
  if (cached !== undefined) {
    await deps.appendFinding({
      adversary: 'judge-quality',
      tool: input.tool,
      verdict: cached.score === 1 ? 'pass' : 'fail',
      reason: `cached: ${cached.reason} (model ${cached.modelId}, ${cached.rubricVersion})`,
    });
    return { score: cached.score, cached: true };
  }
  const { system, user } = buildJudgeMessages(input.tool, input.args, output);
  const raw = await deps.caller({ baseUrl: config.baseUrl, apiKey: key, modelId: config.modelId, system, user });
  const { score, reason } = parseJudgeVerdict(raw);
  await writeVerdictCache(dir, cacheKey, {
    score,
    reason,
    modelId: config.modelId,
    rubricVersion: config.rubricVersion,
    retrievedAt: clock(),
  });
  await deps.appendFinding({
    adversary: 'judge-quality',
    tool: input.tool,
    verdict: score === 1 ? 'pass' : 'fail',
    reason: `${reason} (model ${config.modelId}, ${config.rubricVersion})`,
  });
  return { score, cached: false };
};
