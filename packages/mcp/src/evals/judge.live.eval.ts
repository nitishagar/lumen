/**
 * LLM-as-judge eval case — SKIPPED in the offline gate (I9: no live network,
 * no credentials in CI). The case is written and skipped with a reason per the
 * trial contract; it becomes runnable the day a judge key is provided:
 *
 *   EVAL_LIVE=1 OPENAI_API_KEY=<key> npx evalite run judge.live
 *
 * Judge discipline (per the eval design note): pinned judge model, temperature
 * 0, rubric fixed in code, verdicts cached on (input, output, rubric) by the
 * evalite cache so unchanged cases never re-call the judge.
 */
import { evalite } from 'evalite';
import { connectClient, fixtureDeps, parseToolJson } from '../testkit/index.js';

evalite.skip('judge-quality', {
  // SKIPPED: no judge credentials in this environment (EVAL_LIVE gate).
  // Pin the judge model + temperature 0 before enabling.
  data: [
    {
      input: { tool: 'lumen_page_report', args: { url: 'https://example.com' } },
      expected: 'a provenance-carrying page report whose unavailable legs say why',
    },
  ],
  task: async (input) => {
    const client = await connectClient(fixtureDeps());
    try {
      return parseToolJson(await client.callTool({ name: input.tool, arguments: input.args }) as never) as Record<string, unknown>;
    } finally {
      await client.close();
    }
  },
  scorers: [
    {
      name: 'report-faithfulness-rubric',
      description:
        'Pinned judge (e.g. openai:gpt-4.1-mini, temperature 0) scoring the report against the fixed rubric: every metric carries source+retrievedAt; unavailable sections state the reason instead of zero.',
      scorer: () => 0,
    },
  ],
});
