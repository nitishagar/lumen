/**
 * Capability-map tests (E6/I6): a capability absent from the injected deps
 * still LISTS its tool (identical set on both transports) but answers with a
 * typed LOCAL_ONLY_CAPABILITY error naming the CLI command to run instead.
 * Descriptions disclose the transport-dependent capability.
 */
import { describe, expect, it } from 'vitest';
import { connectClient, fixtureDeps, fixtureRemoteDeps, parseToolJson } from './testkit/index.js';

describe('local-only capability (E6/I6)', () => {
  it('audit_site answers LOCAL_ONLY_CAPABILITY naming the CLI when no runner is wired', async () => {
    const client = await connectClient(fixtureRemoteDeps());
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string; tool: string; message: string }>(res as never);
    expect(payload.code).toBe('LOCAL_ONLY_CAPABILITY');
    expect(payload.tool).toBe('lumen_audit_site');
    expect(payload.message).toContain('npx @lumen-seo/cli audit');
    await client.close();
  });

  it('rank_check answers LOCAL_ONLY_CAPABILITY when no SERP provider is wired', async () => {
    const client = await connectClient(fixtureRemoteDeps());
    const res = await client.callTool({
      name: 'lumen_rank_check',
      arguments: { keyword: 'seo', domain: 'example.com' },
    });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string; message: string }>(res as never);
    expect(payload.code).toBe('LOCAL_ONLY_CAPABILITY');
    expect(payload.message).toContain('npx @lumen-seo/cli rank');
    await client.close();
  });

  it('descriptions disclose local-only only when the capability is absent', async () => {
    const full = await connectClient(fixtureDeps());
    const remote = await connectClient(fixtureRemoteDeps());
    const fullTools = (await full.listTools()).tools as unknown as { name: string; description: string }[];
    const remoteTools = (await remote.listTools()).tools as unknown as {
      name: string;
      description: string;
    }[];
    const desc = (tools: typeof fullTools, name: string): string =>
      tools.find((t) => t.name === name)!.description;
    expect(desc(remoteTools, 'lumen_audit_site')).toMatch(/unavailable over remote MCP/);
    expect(desc(fullTools, 'lumen_audit_site')).not.toMatch(/unavailable over remote MCP/);
    expect(desc(remoteTools, 'lumen_rank_check')).toMatch(/unavailable over remote MCP/);
    expect(desc(fullTools, 'lumen_rank_check')).not.toMatch(/unavailable over remote MCP/);
    await Promise.all([full.close(), remote.close()]);
  });

  it('page_report over the remote shape serves PSI/CrUX and marks meta local-only (E6)', async () => {
    // Remote deps have no pageMeta but the plan's Worker DOES wire PSI/CrUX —
    // add them to the remote shape to exercise the served path.
    const deps = { ...fixtureRemoteDeps(), pageSpeed: fixtureDeps().pageSpeed, crux: fixtureDeps().crux };
    const client = await connectClient(deps);
    const res = await client.callTool({
      name: 'lumen_page_report',
      arguments: { url: 'https://example.com' },
    });
    expect(res.isError).toBeUndefined();
    const payload = parseToolJson<{ meta: { status: string; reason: string }; limitations: string[] }>(
      res as never,
    );
    expect(payload.meta.status).toBe('unavailable');
    expect(payload.meta.reason).toContain('npx @lumen-seo/cli report');
    expect(payload.limitations.join(' ')).toContain('local-only');
    await client.close();
  });

  it('keyword_ideas and authority stay served over the remote shape (E6 map)', async () => {
    const client = await connectClient(fixtureRemoteDeps());
    const ideas = await client.callTool({ name: 'lumen_keyword_ideas', arguments: { seed: 'seo' } });
    expect(ideas.isError).toBeUndefined();
    const authority = await client.callTool({
      name: 'lumen_authority',
      arguments: { domain: 'example.com' },
    });
    expect(authority.isError).toBeUndefined();
    await client.close();
  });

  it('remote shape: the tool is unserved entirely, so even an invalid URL answers local-only (E6 plan short-circuit)', async () => {
    // The plan's Phase 4 handler short-circuits to localOnly BEFORE URL
    // validation — the local-only path never uses or echoes the URL, so I12
    // is not implicated. URL validation applies when the capability EXISTS.
    const client = await connectClient(fixtureRemoteDeps());
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'http://127.0.0.1:8080/admin' },
    });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string }>(res as never);
    expect(payload.code).toBe('LOCAL_ONLY_CAPABILITY');
    await client.close();
  });

  it('full composition: URL validation precedes any use — private targets refused (I12)', async () => {
    const client = await connectClient(fixtureDeps());
    const res = await client.callTool({
      name: 'lumen_audit_site',
      arguments: { url: 'http://127.0.0.1:8080/admin' },
    });
    expect(res.isError).toBe(true);
    const payload = parseToolJson<{ code: string; message: string }>(res as never);
    expect(payload.code).toBe('INVALID_URL');
    expect(payload.message).toContain('refusing non-public target');
    await client.close();
  });
});
