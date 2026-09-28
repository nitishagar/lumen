/**
 * In-process evalite suite over the lumen MCP tool contract (offline trial:
 * evals/trial-evalite). Deterministic only — every case runs against the
 * testkit fixture composition, never live network. Wire-level behavior that
 * needs no fixtures lives in the promptfoo suite (root `evals/`); the
 * tool-list + input-schema snapshots live HERE because only the in-process
 * client can assert tools/list directly.
 *
 * Run: npm run test:evals -w @lumen-seo/mcp   (from packages/mcp: npx evalite run)
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { evalite } from 'evalite';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectClient, fixtureAuditRunner, fixtureDeps, fixtureRemoteDeps, parseToolJson } from '../testkit/index.js';
import type { McpDeps } from '../server.js';

interface ToolSnapshotEntry {
  name: string;
  inputSchema: unknown;
}

const snapshotPath = new URL('./snapshots/tool-list.snapshot.json', import.meta.url);
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as ToolSnapshotEntry[];

const callToolJson = async (client: Client, name: string, args: Record<string, unknown>): Promise<unknown> => {
  const res = await client.callTool({ name, arguments: args });
  return parseToolJson(res as never);
};

const close = async (client: Client): Promise<void> => {
  await client.close();
};

/** 1 if every expected key/value matches the output (JSON-strict), else 0. */
const matchesExpected = (output: unknown, expected: Record<string, unknown>): boolean =>
  Object.entries(expected).every(([key, value]) => JSON.stringify((output as Record<string, unknown>)[key]) === JSON.stringify(value));

/** Order-insensitive JSON equality: key order differs between the wire and the in-process SDK. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

evalite('tool-list-snapshot', {
  data: [
    {
      input: 'tools/list',
      expected: snapshot.map((t) => t.name),
    },
  ],
  task: async () => {
    const client = await connectClient(fixtureDeps());
    try {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name).sort();
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'names-exactly-match-snapshot',
      scorer: ({ output, expected }) => (JSON.stringify(output) === JSON.stringify(expected) ? 1 : 0),
    },
  ],
});

evalite('input-schemas-snapshot', {
  data: [
    {
      input: 'tools/list',
      expected: snapshot,
    },
  ],
  task: async () => {
    const client = await connectClient(fixtureDeps());
    try {
      const { tools } = await client.listTools();
      return tools
        .map((t) => ({ name: t.name, inputSchema: t.inputSchema }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'schemas-exactly-match-snapshot',
      scorer: ({ output, expected }) => (expected !== undefined && canonical(output) === canonical(expected) ? 1 : 0),
    },
  ],
});

evalite('page-report-output-shape', {
  data: [
    {
      input: { tool: 'lumen_page_report', args: { url: 'https://example.com' } },
      expected: {
        shapeKeys: ['attribution', 'field', 'lab', 'limitations', 'meta', 'strategy', 'url'].sort(),
        labProvider: 'fixture-psi',
        labKind: 'lab',
        fieldProvider: 'fixture-crux',
        cruxAttribution: 'CC BY 4.0',
        retrievedAt: '2026-08-29T12:00:00Z',
      },
    },
  ],
  task: async (input) => {
    const client = await connectClient(fixtureDeps());
    try {
      return (await callToolJson(client, input.tool, input.args)) as Record<string, unknown>;
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'shape-and-provenance',
      scorer: ({ output, expected }) => {
        if (expected === undefined) return 0;
        const o = output as Record<string, unknown>;
        const keys = Object.keys(o).sort();
        if (JSON.stringify(keys) !== JSON.stringify(expected.shapeKeys)) return 0;
        const lab = o.lab as Record<string, unknown>;
        const field = o.field as Record<string, unknown>;
        const labSource = lab.source as Record<string, unknown>;
        const fieldSource = field.source as Record<string, unknown>;
        const ok =
          labSource.provider === expected.labProvider &&
          labSource.kind === expected.labKind &&
          lab.retrievedAt === expected.retrievedAt &&
          fieldSource.provider === expected.fieldProvider &&
          String(fieldSource.attribution).includes(expected.cruxAttribution);
        return ok ? 1 : 0;
      },
    },
  ],
});

evalite('keyword-ideas-output-shape', {
  data: [
    {
      input: { tool: 'lumen_keyword_ideas', args: { seed: 'seo', limit: 3 } },
      expected: { minCount: 1, maxCount: 3, firstTerm: 'seo tutorial' },
    },
  ],
  task: async (input) => {
    const client = await connectClient(fixtureDeps());
    try {
      return (await callToolJson(client, input.tool, input.args)) as { ideas: { term: string }[] };
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'count-bounds-and-deterministic-first-term',
      scorer: ({ output, expected }) => {
        if (expected === undefined) return 0;
        const ideas = (output as { ideas?: { term: string }[] }).ideas ?? [];
        return ideas.length >= expected.minCount &&
          ideas.length <= expected.maxCount &&
          ideas[0]?.term === expected.firstTerm
          ? 1
          : 0;
      },
    },
  ],
});

evalite('audit-site-findings-shape', {
  data: [
    {
      input: { tool: 'lumen_audit_site', args: { url: 'https://example.com' } },
      expected: {
        issues: [
          { ruleId: 'rule/dup-title', severity: 'error', message: 'duplicate title', evidence: {} },
        ],
        counts: { error: 1, warning: 0, info: 0 },
        passesThreshold: false,
      },
    },
  ],
  task: async (input) => {
    const issue = {
      ruleId: 'rule/dup-title',
      severity: 'error' as const,
      message: 'duplicate title',
      evidence: {},
    };
    const deps: McpDeps = { ...fixtureDeps(), auditRunner: fixtureAuditRunner({ issues: [issue] }) };
    const client = await connectClient(deps);
    try {
      return (await callToolJson(client, input.tool, input.args)) as Record<string, unknown>;
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'severity-counts-and-gate',
      scorer: ({ output, expected }) => {
        if (expected === undefined) return 0;
        const o = output as { countsBySeverity?: Record<string, number>; passesThreshold?: boolean };
        return JSON.stringify(o.countsBySeverity) === JSON.stringify(expected.counts) &&
          o.passesThreshold === expected.passesThreshold
          ? 1
          : 0;
      },
    },
  ],
});

evalite('golden-dataset', {
  data: (() => {
    const goldenPath = new URL('./data/golden.json', import.meta.url);
    const entries = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      tool: string;
      args: Record<string, unknown>;
      expect: Record<string, unknown>;
    }[];
    return entries.map((e) => ({ input: { tool: e.tool, args: e.args }, expected: e.expect }));
  })(),
  task: async (input) => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    const client = await connectClient(fixtureDeps());
    try {
      return (await callToolJson(client, tool, args)) as Record<string, unknown>;
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'expected-properties-present',
      scorer: ({ output, expected }) => (matchesExpected(output, expected as Record<string, unknown>) ? 1 : 0),
    },
  ],
});

evalite('latency-budget', {
  data: [
    {
      input: { tool: 'lumen_authority', args: { domain: 'example.com' } },
      expected: { budgetMs: 1000 },
    },
  ],
  task: async (input) => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    const client = await connectClient(fixtureDeps());
    try {
      const start = performance.now();
      await callToolJson(client, tool, args);
      return { latencyMs: performance.now() - start };
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'in-process-call-under-budget',
      scorer: ({ output, expected }) =>
        expected !== undefined &&
        (output as { latencyMs: number }).latencyMs < (expected as { budgetMs: number }).budgetMs
          ? 1
          : 0,
    },
  ],
});

evalite('denied-tool-not-called', {
  data: [
    {
      input: { tool: 'lumen_audit_site', args: { url: 'https://example.com' } },
      expected: { code: 'LOCAL_ONLY_CAPABILITY' },
    },
  ],
  task: async (input) => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    // Remote/local-only composition: no serp, no auditRunner, no pageMeta —
    // the capability is structurally unwired, so the deny fires before any
    // provider could exist to make an outbound call.
    const client = await connectClient(fixtureRemoteDeps());
    try {
      const payload = (await callToolJson(client, tool, args)) as { code?: string };
      return { code: payload.code ?? 'MISSING' };
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'deny-shown-not-executed',
      scorer: ({ output, expected }) =>
        (output as { code: string }).code === (expected as { code: string }).code ? 1 : 0,
    },
  ],
});

evalite('strict-args-unknown-rejected', {
  data: [
    {
      input: { tool: 'lumen_page_report', args: { url: 'https://example.com', bogus_arg: 1 } },
      expected: { mentionsKey: 'bogus_arg' },
    },
  ],
  task: async (input) => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    const client = await connectClient(fixtureDeps());
    try {
      const res = (await client.callTool({ name: tool, arguments: args })) as {
        content: { type: string; text?: string }[];
        isError?: boolean;
      };
      const text = res.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
      return { isError: res.isError === true, text };
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'unknown-key-rejected-by-name',
      scorer: ({ output, expected }) => {
        if (expected === undefined) return 0;
        const o = output as { isError: boolean; text: string };
        return o.isError && o.text.includes('-32602') && o.text.includes('Unrecognized key') && o.text.includes(expected.mentionsKey) ? 1 : 0;
      },
    },
  ],
});

evalite('url-guard-blocks-private', {
  data: [
    {
      input: { tool: 'lumen_page_report', args: { url: 'http://127.0.0.1:1/' } },
      expected: { code: 'INVALID_URL', mentions: 'loopback' },
    },
  ],
  task: async (input) => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    const client = await connectClient(fixtureDeps());
    try {
      return (await callToolJson(client, tool, args)) as Record<string, unknown>;
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'private-target-refused',
      scorer: ({ output, expected }) => {
        if (expected === undefined) return 0;
        const o = output as { code?: string; message?: string };
        return o.code === expected.code && String(o.message).includes(expected.mentions) ? 1 : 0;
      },
    },
  ],
});

evalite('unknown-tool-not-executed', {
  data: [
    {
      input: { tool: 'lumen_drop_tables', args: {} },
      expected: { mentions: 'lumen_drop_tables' },
    },
  ],
  task: async (input) => {
    const { tool, args } = input as { tool: string; args: Record<string, unknown> };
    const client = await connectClient(fixtureDeps());
    try {
      const res = (await client.callTool({ name: tool, arguments: args })) as {
        content: { type: string; text?: string }[];
        isError?: boolean;
      };
      const text = res.content.map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
      return { isError: res.isError === true, text };
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'tool-name-never-executed',
      scorer: ({ output, expected }) => {
        if (expected === undefined) return 0;
        const o = output as { isError: boolean; text: string };
        return o.isError && o.text.includes(expected.mentions) ? 1 : 0;
      },
    },
  ],
});

evalite('concise-payload-budget', {
  data: [
    {
      // E1.2 FR-6: the concise audit response for a 100-page site stays ≤4 KB.
      input: { tool: 'lumen_audit_site', args: { url: 'https://example.com' }, pages: 100 },
      expected: { maxBytes: 4096 },
    },
  ],
  task: async (input) => {
    const { tool, args, pages } = input as { tool: string; args: Record<string, unknown>; pages: number };
    const client = await connectClient({
      ...fixtureDeps(),
      auditRunner: fixtureAuditRunner({
        pages,
        issues: [
          { ruleId: 'title-length', severity: 'warning', message: 'title is 74 chars', evidence: { selector: 'head title' }, fixHint: 'keep titles between 15 and 65 characters', helpUrl: 'https://nitishagar.github.io/lumen/docs/rules-reference/#title-length' },
          { ruleId: 'image-alt-coverage', severity: 'warning', message: '3 of 9 images lack alt text', evidence: { selector: 'img' }, fixHint: 'add descriptive alt text to every meaningful image', helpUrl: 'https://nitishagar.github.io/lumen/docs/rules-reference/#image-alt-coverage' },
          { ruleId: 'canonical-present', severity: 'info', message: 'no canonical link', evidence: { selector: 'link[rel=canonical]' }, fixHint: 'add <link rel="canonical" href="…"> to declare the preferred URL', helpUrl: 'https://nitishagar.github.io/lumen/docs/rules-reference/#canonical-present' },
        ],
      }),
    });
    try {
      const payload = (await callToolJson(client, tool, args)) as unknown;
      return { bytes: JSON.stringify(payload).length };
    } finally {
      await close(client);
    }
  },
  scorers: [
    {
      name: 'concise-under-4kb',
      scorer: ({ output, expected }) =>
        expected !== undefined && (output as { bytes: number }).bytes <= (expected as { maxBytes: number }).maxBytes ? 1 : 0,
    },
  ],
});
