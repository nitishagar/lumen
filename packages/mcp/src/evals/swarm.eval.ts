/**
 * Red-team swarm eval (Stage 1): the adversary corpus (`data/adversaries.json`)
 * through fixture-backed tools with programmed taxonomy faults. Offline,
 * zero-network, no credentials — every case runs against `fixtureDeps()` or
 * `fixtureRemoteDeps()` with `withProviderFaults()` wrappers, never live
 * providers. Report-only by construction (user-confirmed: adversarial
 * findings never fail CI; a threshold gate arrives only when named): the
 * default eval gate opts the swarm out via `SWARM_SKIP=1` (set by
 * `npm run test:evals` — the file registers as `evalite.skip` there, so the
 * gate stays behavior-identical to the pre-swarm 14-eval run), this file is
 * invoked WITHOUT `--threshold` (`npm run test:swarm` → `evalite run swarm`),
 * tasks catch every outcome into scores (an unexpected throw becomes a `fail`
 * verdict with reason — a thrown task never reaches the runner), and each
 * completed case appends one scrubbed JSONL line to the scoreboard.
 *
 * Later stages land their adversary cases in the corpus first (judge
 * key-absent, concurrent history rotation, rule-evasion inputs) — the corpus
 * is the locked adversary registry.
 *
 * Run: npm run test:swarm -w @lumen-seo/mcp   (from packages/mcp: npx evalite run swarm)
 */
import { evalite } from 'evalite';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectClient, fixtureAuditRunner, fixtureDeps, fixtureRemoteDeps, parseToolJson } from '../testkit/index.js';
import { withProviderFaults } from '../swarm/faults.js';
import { Scoreboard, defaultScoreboardPath } from '../swarm/scoreboard.js';
import { loadCorpus, selectCases } from '../swarm/corpus.js';
import type { AdversaryCase, AdversaryExpect } from '../swarm/corpus.js';

const GATED_OUT = process.env.SWARM_SKIP === '1';
// The default gate (SWARM_SKIP=1) loads no corpus and writes no scoreboard:
// a swarm-side regression (invalid corpus, IO fault) can never fail the gate.
const corpus = GATED_OUT
  ? []
  : selectCases(loadCorpus(new URL('./data/adversaries.json', import.meta.url)), process.env.SWARM_ONLY);
const scoreboard = new Scoreboard(defaultScoreboardPath());

interface SwarmOutcome {
  isError: boolean;
  payload: unknown;
  text: string;
}

interface SwarmEvalOutput {
  verdict: 'pass' | 'fail' | 'unscored';
  reason: string;
  scoreboardWriteError?: string;
}

/** 1 if every expected key/value matches the output (JSON-strict), else false. */
const subsetMatch = (payload: unknown, expected: Record<string, unknown>): boolean => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const o = payload as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => JSON.stringify(o[key]) === JSON.stringify(value));
};

const evaluate = (entry: AdversaryCase, outcome: SwarmOutcome): { verdict: 'pass' | 'fail'; reason: string } => {
  const e: AdversaryExpect = entry.expect;
  if (outcome.isError !== e.isError) {
    return { verdict: 'fail', reason: `expected isError=${String(e.isError)}, got ${String(outcome.isError)} :: ${outcome.text.slice(0, 200)}` };
  }
  if (e.code !== undefined) {
    const code = (outcome.payload as { code?: unknown } | null)?.code;
    if (code !== e.code) return { verdict: 'fail', reason: `expected code "${e.code}", got ${JSON.stringify(code)}` };
  }
  for (const s of e.textContains ?? []) {
    if (!outcome.text.includes(s)) return { verdict: 'fail', reason: `expected text to contain "${s}" :: ${outcome.text.slice(0, 200)}` };
  }
  if (e.unavailableLegs !== undefined) {
    const legs = (outcome.payload ?? {}) as Record<string, unknown>;
    for (const leg of e.unavailableLegs) {
      const v = legs[leg] as { status?: unknown } | undefined;
      if (v === undefined || v === null || typeof v !== 'object' || (v as { status?: unknown }).status !== 'unavailable') {
        return { verdict: 'fail', reason: `expected leg "${leg}" to read {status:'unavailable'} :: ${outcome.text.slice(0, 200)}` };
      }
    }
  }
  if (e.jsonSubset !== undefined && !subsetMatch(outcome.payload, e.jsonSubset)) {
    return { verdict: 'fail', reason: `payload subset mismatch for ${JSON.stringify(e.jsonSubset)} :: ${outcome.text.slice(0, 200)}` };
  }
  return { verdict: 'pass', reason: e.code ?? (e.unavailableLegs !== undefined ? `legs unavailable: ${e.unavailableLegs.join(',')}` : 'outcome matches') };
};

(GATED_OUT ? evalite.skip : evalite)('swarm-adversaries', {
  // SWARM_SKIP=1 skips under test:evals; the GATED lane is
  // `npm run test:swarm` (evalite run swarm --threshold 100) — an `unscored`
  // verdict scores 0 against the threshold (named per the PRD hygiene row).
  data: corpus.map((c) => ({ input: c, expected: c.expect })),
  task: async (input): Promise<SwarmEvalOutput> => {
    const entry = input as AdversaryCase;
    let verdict: 'pass' | 'fail' | 'unscored' = 'fail';
    let reason = 'unset';
    try {
      const base = entry.deps === 'remote' ? fixtureRemoteDeps() : fixtureDeps();
      const deps = withProviderFaults(
        entry.auditIssues === undefined
          ? base
          : {
              ...base,
              auditRunner: fixtureAuditRunner({
                issues: entry.auditIssues.map((i) => ({ ...i, evidence: {} })),
              }),
            },
        entry.providerFaults,
      );
      const client: Client = await connectClient(deps);
      try {
        const res = (await client.callTool({ name: entry.tool, arguments: entry.args })) as {
          content: { type: string; text?: string }[];
          isError?: boolean;
        };
        const text = res.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
        let payload: unknown = text;
        try {
          payload = parseToolJson(res as never) as unknown;
        } catch {
          // Non-JSON text (wire-protocol errors) stays raw; textContains still applies.
        }
        ({ verdict, reason } = evaluate(entry, { isError: res.isError === true, payload, text }));
      } catch (err) {
        verdict = 'fail';
        reason = `client threw: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        await client.close().catch(() => undefined);
      }
    } catch (err) {
      verdict = 'fail';
      reason = `harness threw: ${err instanceof Error ? err.message : String(err)}`;
    }
    const output: SwarmEvalOutput = { verdict, reason };
    try {
      await scoreboard.append({ adversary: entry.id, tool: entry.tool, verdict, reason });
    } catch (err) {
      output.scoreboardWriteError = err instanceof Error ? err.message : String(err);
    }
    return output;
  },
  scorers: [
    {
      name: 'adversary-holds',
      scorer: ({ output }) => ((output as SwarmEvalOutput).verdict === 'pass' ? 1 : 0),
    },
  ],
});
