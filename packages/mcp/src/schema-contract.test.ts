/**
 * Wire contract tests (E7/B7): the tools/list payload is the contract agents
 * see. The guaranteed set is asserted hard — exactly the five locked names,
 * `type: "object"`, `required` exactly the no-default fields, the identical
 * 4-value failThreshold enum (I5/R1/R2), integer bounds, and no maxPages
 * default (R8). `additionalProperties: false`, property-level defaults, and
 * the emitted `$schema` dialect are snapshot-documented per installed SDK
 * (B7); the handler-side strictArgs guard guarantees rejection of unknown
 * args regardless of what any future SDK emits.
 */
import { describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectClient, fixtureDeps, fixtureRemoteDeps } from './testkit/index.js';
import { TOOL_NAMES } from './schemas.js';

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties?: boolean;
    $schema?: string;
  };
}

const listTools = async (client: Client): Promise<ToolInfo[]> => {
  const { tools } = await client.listTools();
  return tools as unknown as ToolInfo[];
};

describe('tools/list wire schema (E7)', () => {
  it('exposes exactly the five locked tool names on the full composition', async () => {
    const client = await connectClient(fixtureDeps());
    const tools = await listTools(client);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
  });

  it('exposes the identical five names when capabilities are absent (I5 parity)', async () => {
    const client = await connectClient(fixtureRemoteDeps());
    const tools = await listTools(client);
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
  });

  it('guaranteed set: type object, required exactly the no-default fields, per tool', async () => {
    const client = await connectClient(fixtureDeps());
    const tools = await listTools(client);
    const byName = new Map(tools.map((t) => [t.name, t]));
    const expectedRequired: Record<string, string[]> = {
      lumen_audit_site: ['url'], // maxPages optional (R8); failThreshold/response_format defaulted
      lumen_page_report: ['url'], // strategy/includeCrux/response_format defaulted
      lumen_keyword_ideas: ['seed'], // lang optional; limit/response_format defaulted
      lumen_rank_check: ['keyword', 'domain'],
      lumen_authority: ['domain'],
    };
    for (const name of TOOL_NAMES) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.type, name).toBe('object');
      expect([...(tool!.inputSchema.required ?? [])].sort(), name).toEqual([...(expectedRequired[name] ?? [])].sort());
      // response_format default concise present on ALL five (E7)
      expect(tool!.inputSchema.properties.response_format, name).toMatchObject({ default: 'concise' });
    }
    await client.close();
  });

  it('failThreshold enum is the identical 4-value set as the CLI flag (I5/R1/R2)', async () => {
    const client = await connectClient(fixtureDeps());
    const tools = await listTools(client);
    const audit = tools.find((t) => t.name === 'lumen_audit_site')!;
    expect(audit.inputSchema.properties.failThreshold).toMatchObject({
      enum: ['info', 'warning', 'error', 'off'],
    });
    await client.close();
  });

  it('maxPages carries NO default (R8) and is bounded 1..10000', async () => {
    const client = await connectClient(fixtureDeps());
    const tools = await listTools(client);
    const audit = tools.find((t) => t.name === 'lumen_audit_site')!;
    const maxPages = audit.inputSchema.properties.maxPages as Record<string, unknown>;
    expect(maxPages).toBeDefined();
    expect(maxPages).not.toHaveProperty('default');
    expect(maxPages.minimum).toBe(1);
    expect(maxPages.maximum).toBe(10_000);
    await client.close();
  });

  it('bounds: seed/keyword ≤120, domain ≤253, limit 1..50 (I15)', async () => {
    const client = await connectClient(fixtureDeps());
    const tools = await listTools(client);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('lumen_keyword_ideas')!.inputSchema.properties.seed).toMatchObject({
      minLength: 1,
      maxLength: 120,
    });
    expect(byName.get('lumen_rank_check')!.inputSchema.properties.domain).toMatchObject({
      maxLength: 253,
    });
    expect(byName.get('lumen_keyword_ideas')!.inputSchema.properties.limit).toMatchObject({
      minimum: 1,
      maximum: 50,
      default: 20,
    });
    await client.close();
  });

  it('snapshots the installed SDK wire strictness + defaults + dialect (B7 opportunistic set)', async () => {
    const client = await connectClient(fixtureDeps());
    const tools = await listTools(client);
    const byName = new Map(tools.map((t) => [t.name, t]));
    // B7: with the installed SDK (@modelcontextprotocol/sdk 1.30 + zod v4
    // strictObject) the wire DOES carry additionalProperties:false, property
    // defaults, and a $schema dialect marker. If an SDK upgrade changes this,
    // this snapshot is the visible diff; the guaranteed set above and the
    // handler-side strictArgs guard still hold either way.
    expect(byName.get('lumen_audit_site')!.inputSchema.additionalProperties).toBe(false);
    expect(byName.get('lumen_audit_site')!.inputSchema.$schema).toMatchInlineSnapshot(
      `"http://json-schema.org/draft-07/schema#"`,
    );
    await client.close();
  });

  it('invalid tool args are rejected with typed validation errors (E7/I15)', async () => {
    const client = await connectClient(fixtureDeps());
    const badEnum = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'https://example.com', failThreshold: 'critical' }, // R1: not in vocabulary
    });
    expect(badEnum.isError).toBe(true);
    const badBound = await client.callTool({
      name: 'lumen_keyword_ideas',
      arguments: { seed: 'x'.repeat(121) }, // overlong seed (I15)
    });
    expect(badBound.isError).toBe(true);
    const badType = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'k', domain: 'example.com', limit: 51 },
    });
    expect(badType.isError).toBe(true);
    await client.close();
  });

  it('unknown/extra args are rejected regardless of wire strictness (E7/B7 strictArgs)', async () => {
    const client = await connectClient(fixtureDeps());
    const extra = await client.callTool({
      name: 'lumen_keyword_ideas',
      arguments: { seed: 'seo', evilParam: 'yes' },
    });
    expect(extra.isError).toBe(true);
    // With the installed SDK the strictObject wire schema rejects BEFORE the
    // handler; the resulting error text names the offender. Either rejection
    // point (wire or handler-side strictArgs guard) satisfies E7/B7.
    const raw = ((extra.content as unknown as { text?: string }[] | undefined)?.[0]?.text) ?? '';
    expect(raw).toMatch(/evilParam|Unrecognized|unknown argument/i);
    await client.close();
  });

  it('strictArgs unit: names the unknown keys and the allowed set', async () => {
    const { strictArgs } = await import('./strict-args.js');
    expect(strictArgs({ a: 1, b: 2 }, ['a'])).toEqual({
      code: 'INVALID_ARGUMENTS',
      message: 'unknown argument(s): b — allowed: a',
    });
    expect(strictArgs({ a: 1 }, ['a'])).toBeNull();
  });
});
