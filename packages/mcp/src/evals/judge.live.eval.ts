/**
 * LLM-as-judge eval case (Stage 2): enabled ONLY under `EVAL_LIVE=1` with a
 * present judge key — otherwise `evalite.skip`, byte-for-byte the old
 * behavior (the default `npm run test:evals` never sees it). Vendor-neutral:
 * `modelId` is user-supplied (`LUMEN_JUDGE_MODEL`, recorded verbatim, no
 * in-repo allowlist), the credential is a BYOK env-var name read at call
 * time (`LUMEN_JUDGE_KEY`, the module default — this eval loads no user
 * config, so custom `byok.judge` names are not honored here), and the
 * transport is a dependency-free fetch POST to the user's
 * OpenAI-compatible endpoint (`LUMEN_JUDGE_BASE_URL`, https only).
 *
 * Live runs (no `--threshold` in the documented command) score 0/1 per the
 * pinned rubric; verdicts cache content-addressed so reruns are free.
 * `EVAL_LIVE=1` without a key stays green AND records
 * `unscored: key-absent` to the swarm scoreboard at load (guarded — collection
 * never breaks on scoreboard IO).
 *
 *   EVAL_LIVE=1 LUMEN_JUDGE_KEY=<k> LUMEN_JUDGE_BASE_URL=https://<host>/v1/chat/completions \
 *     LUMEN_JUDGE_MODEL=<model-id> npx evalite run judge.live
 */
import { evalite } from 'evalite';
import { connectClient, fixtureDeps, parseToolJson } from '../testkit/index.js';
import { Scoreboard } from '../swarm/scoreboard.js';
import {
  DEFAULT_JUDGE_KEY_ENV,
  JUDGE_RUBRIC_VERSION,
  judgeCall,
  resolveJudgeKey,
  resolveJudgeVerdict,
} from './judge.js';

const EVAL_LIVE = process.env.EVAL_LIVE === '1';
const KEY_NAME = DEFAULT_JUDGE_KEY_ENV;
const LIVE_KEY = resolveJudgeKey((n) => process.env[n], KEY_NAME);
const LIVE = EVAL_LIVE && LIVE_KEY !== undefined;

const scoreboard = new Scoreboard();

if (EVAL_LIVE && LIVE_KEY === undefined) {
  // Recorded unscored state (green skip): never throws into collection.
  await scoreboard
    .append({ adversary: 'judge-quality', tool: 'lumen_page_report', verdict: 'unscored', reason: 'key-absent' })
    .catch(() => undefined);
}

interface JudgeTaskOutput {
  input: { tool: string; args: Record<string, unknown> };
  toolOutput: unknown;
}

(LIVE ? evalite : evalite.skip)('judge-quality', {
  // SKIPPED unless EVAL_LIVE=1 with a present key (offline default untouched).
  data: [
    {
      input: { tool: 'lumen_page_report', args: { url: 'https://example.com' } },
      expected: 'a provenance-carrying page report whose unavailable legs say why',
    },
  ],
  task: async (input): Promise<JudgeTaskOutput> => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    const client = await connectClient(fixtureDeps());
    try {
      const toolOutput = parseToolJson(await client.callTool({ name: tool, arguments: args }) as never) as unknown;
      return { input: { tool, args }, toolOutput };
    } catch (e) {
      return { input: { tool, args }, toolOutput: { harnessError: e instanceof Error ? e.message : String(e) } };
    } finally {
      await client.close();
    }
  },
  scorers: [
    {
      name: 'report-faithfulness-rubric',
      description:
        'Pinned rubric judge-rubric-1 (temperature 0): every metric carries source+retrievedAt; unavailable sections state the reason instead of zero.',
      scorer: async ({ output }) => {
        const { input, toolOutput } = output as JudgeTaskOutput;
        const baseUrl = process.env.LUMEN_JUDGE_BASE_URL;
        const result = await resolveJudgeVerdict(
          {
            modelId: process.env.LUMEN_JUDGE_MODEL ?? '',
            temperature: 0,
            rubricVersion: JUDGE_RUBRIC_VERSION,
            apiKeyEnv: KEY_NAME,
            ...(baseUrl === undefined || baseUrl === '' ? {} : { baseUrl }),
          },
          input,
          toolOutput,
          {
            env: (n) => process.env[n],
            caller: (o) => judgeCall(o),
            cacheDir: process.env.JUDGE_CACHE_DIR ?? '.evalite/judge-cache',
            appendFinding: (f) => scoreboard.append(f),
          },
        );
        return result.score;
      },
    },
  ],
});
