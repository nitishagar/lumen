/**
 * Worker tests (E6/E9/E10/E13/I16) under Miniflare (@cloudflare/vitest-plugin,
 * fully local — zero live network). The suite runs against the FIXTURE worker
 * composition pre-rebase (B21) and re-runs unchanged post-rebase against the
 * real `createWorkerSafeProviders` wiring, when the outbound-host allowlist
 * assertions below activate against real provider traffic.
 */
import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { allCallsAllowed, outboundRecorder, OUTBOUND_HOST_ALLOWLIST } from './outbound-recorder.js';
import { workerDeps, HEADER_FOR_ENV } from './composition.js';
import type { Env } from './providers.js';
import { pageReportRoute } from './rest.js';
import { restComposition } from './composition.js';

const MCP_URL = 'http://example.com/mcp';

interface JsonRpcResponse {
  jsonrpc?: '2.0';
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** POSTs one JSON-RPC frame to /mcp and parses the response (JSON or SSE). */
const rpc = async (body: unknown): Promise<JsonRpcResponse> => {
  const res = await SELF.fetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (text === '') return {}; // notifications answered 202 with no body (stateless)
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    // SSE-framed: take the last data: payload.
    const frames = [...text.matchAll(/^data: (.+)$/gm)].map((m) => m[1] ?? '');
    expect(frames.length).toBeGreaterThan(0);
    return JSON.parse(frames[frames.length - 1] ?? '{}') as JsonRpcResponse;
  }
  return JSON.parse(text) as JsonRpcResponse;
};

/** Full stateless handshake: initialize + initialized notification. */
const initialize = async (): Promise<void> => {
  await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'worker-test', version: '0.0.0' },
    },
  });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
};

const callTool = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  (
    await rpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name, arguments: args },
    })
  ).result ?? {};

const textPayload = (result: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse((result.content as { type: string; text: string }[])[0]?.text ?? '{}') as Record<string, unknown>;

afterEach(() => {
  outboundRecorder.reset();
});

describe('MCP over POST /mcp (E6/I5/E13)', () => {
  it('tools/list returns the identical five-tool set (parity with stdio factory)', async () => {
    await initialize();
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (res.result?.tools as { name: string }[]).map((t) => t.name).sort();
    expect(tools).toEqual(
      ['lumen_audit_site', 'lumen_authority', 'lumen_keyword_ideas', 'lumen_page_report', 'lumen_rank_check'].sort(),
    );
  });

  it('audit_site and rank_check answer LOCAL_ONLY_CAPABILITY naming the CLI (E6/I6)', async () => {
    await initialize();
    for (const [name, args] of [
      ['lumen_audit_site', { url: 'https://example.com' }],
      ['lumen_rank_check', { keyword: 'k', domain: 'example.com' }],
    ] as const) {
      const result = await callTool(name, args);
      expect(result.isError).toBe(true);
      const payload = textPayload(result) as { code: string; message: string };
      expect(payload.code).toBe('LOCAL_ONLY_CAPABILITY');
      expect(payload.message).toContain('npx @lumen-seo/cli');
    }
  });

  it('page_report serves PSI/CrUX fixtures and includes the local-only limitation (E6)', async () => {
    await initialize();
    const result = await callTool('lumen_page_report', { url: 'https://example.com' });
    expect(result.isError).toBeUndefined();
    const payload = textPayload(result) as {
      lab: { scores: { performance: number } };
      field: { source: { provider: string } };
      limitations: string[];
    };
    expect(payload.lab.scores.performance).toBe(84); // fixture PSI
    expect(payload.field.source.provider).toBe('fixture-crux');
    expect(payload.limitations.join(' ')).toContain('local-only');
  });

  it('keyword_ideas and authority are served over HTTP (E6 map)', async () => {
    await initialize();
    const ideas = textPayload(await callTool('lumen_keyword_ideas', { seed: 'seo' })) as { ideas: unknown[] };
    expect(ideas.ideas.length).toBeGreaterThan(0);
    const authority = textPayload(await callTool('lumen_authority', { domain: 'example.com' })) as {
      signals: unknown[];
    };
    expect(authority.signals.length).toBeGreaterThan(0);
  });
});

describe('REST subset (E9)', () => {
  it('/healthz responds {"ok":true}', async () => {
    const res = await SELF.fetch('http://example.com/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('/api/v1/page-report validates ?url= and NEVER fetches the target (I6/I12)', async () => {
    const missing = await SELF.fetch('http://example.com/api/v1/page-report');
    expect(missing.status).toBe(400);
    const missingBody = (await missing.json()) as { error: { code: string } };
    expect(missingBody.error.code).toBe('INVALID_URL');

    const privateUrl = await SELF.fetch(
      'http://example.com/api/v1/page-report?url=http://169.254.169.254/latest/meta-data',
    );
    expect(privateUrl.status).toBe(400);
    const privateBody = (await privateUrl.json()) as { error: { code: string; message: string } };
    expect(privateBody.error.code).toBe('INVALID_URL');
    expect(privateBody.error.message).toContain('refusing non-public target');

    const okRes = await SELF.fetch('http://example.com/api/v1/page-report?url=https://example.com/page');
    expect(okRes.status).toBe(200);
    const body = (await okRes.json()) as {
      url: string;
      lab: { scores: { performance: number } };
      limitations: string[];
    };
    expect(body.url).toBe('https://example.com/page');
    expect(body.lab.scores.performance).toBe(84);
    expect(body.limitations.join(' ')).toContain('local-only');
    // The target was never fetched: the outbound recorder saw no request to it.
    expect(outboundRecorder.calls().every((c) => !c.host.endsWith('example.com'))).toBe(true);
  });

  it('/api/v1/keyword-ideas serves fixture suggestions; q is required (E9)', async () => {
    const missing = await SELF.fetch('http://example.com/api/v1/keyword-ideas');
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('MISSING_PARAM');

    const res = await SELF.fetch('http://example.com/api/v1/keyword-ideas?q=seo&limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { query: string; ideas: { term: string }[] };
    expect(body.query).toBe('seo');
    expect(body.ideas.length).toBeGreaterThan(0);
    expect(body.ideas.length).toBeLessThanOrEqual(3);
  });

  it('unknown route -> 404 envelope; wrong method -> 405 envelope', async () => {
    const notFound = await SELF.fetch('http://example.com/nope');
    expect(notFound.status).toBe(404);
    expect(((await notFound.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    const notAllowed = await SELF.fetch('http://example.com/api/v1/keyword-ideas', { method: 'POST' });
    expect(notAllowed.status).toBe(405);
    expect(((await notAllowed.json()) as { error: { code: string } }).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('GET on /mcp (stateless, no session) -> typed JSON-RPC protocol error', async () => {
    const res = await SELF.fetch(MCP_URL, { method: 'GET' });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error?: { code: number; message: string } };
    expect(body.error?.code).toBeDefined();
    expect(body.error?.message).toBeDefined();
  });
});

describe('BYOK header pass-through (E5/I16)', () => {
  it('workerDeps().env maps exactly the three LUMEN_* names to x-lumen-* headers', () => {
    const headers = new Headers({
      'x-lumen-psi-key': 'psi-header-value',
      'x-lumen-crux-key': 'crux-header-value',
      'x-lumen-opr-key': 'opr-header-value',
      'x-other': 'nope',
    });
    const deps = workerDeps(headers);
    expect(deps.env('LUMEN_PSI_KEY')).toBe('psi-header-value');
    expect(deps.env('LUMEN_CRUX_KEY')).toBe('crux-header-value');
    expect(deps.env('LUMEN_OPR_KEY')).toBe('opr-header-value');
    expect(deps.env('LUMEN_PSI_KEY_OTHER')).toBeUndefined(); // prefix must not over-match
    expect(deps.env('SOMETHING_ELSE')).toBeUndefined();
    expect(Object.values(HEADER_FOR_ENV).sort()).toEqual(
      ['x-lumen-crux-key', 'x-lumen-opr-key', 'x-lumen-psi-key'].sort(),
    );
  });

  it('BYOK header values never appear in any response body (E5/I16)', async () => {
    const sentinel = 'sentinel-key-value-MUST-NOT-ECHO';
    const res = await SELF.fetch('http://example.com/api/v1/page-report?url=https://example.com/page', {
      headers: { 'x-lumen-psi-key': sentinel, 'x-lumen-crux-key': sentinel },
    });
    const body = await res.text();
    expect(body).not.toContain(sentinel);
    const mcpRes = await SELF.fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-lumen-psi-key': sentinel,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'worker-test', version: '0.0.0' },
        },
      }),
    });
    expect(await mcpRes.text()).not.toContain(sentinel);
  });
});

describe('CORS + outbound enumeration (E9/I16)', () => {
  it('preflight allows the x-lumen-* BYOK headers on /mcp and /api/v1 (E9)', async () => {
    for (const path of ['/mcp', '/api/v1/page-report']) {
      const res = await SELF.fetch(`http://example.com${path}`, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      const headers = res.headers;
      expect(headers.get('access-control-allow-origin')).toBe('*');
      expect(headers.get('access-control-allow-headers')).toContain('x-lumen-psi-key');
      expect(headers.get('access-control-allow-headers')).toContain('x-lumen-crux-key');
      expect(headers.get('access-control-allow-headers')).toContain('x-lumen-opr-key');
    }
  });

  it('responses on the CORS surface carry the CORS headers', async () => {
    const res = await SELF.fetch('http://example.com/api/v1/keyword-ideas?q=seo');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('every outbound call stays inside the host allowlist (I16 — zero pre-rebase)', async () => {
    await SELF.fetch('http://example.com/api/v1/page-report?url=https://target-site.example/page');
    await SELF.fetch('http://example.com/api/v1/keyword-ideas?q=seo');
    await initialize();
    await callTool('lumen_page_report', { url: 'https://example.com' });
    // Pre-rebase the fixture providers fetch NOTHING: the recorder must be
    // empty (the I1 zero-key/no-outbound assertion strengthens post-rebase).
    expect(outboundRecorder.calls()).toEqual([]);
    expect(allCallsAllowed()).toBe(true);
    expect(OUTBOUND_HOST_ALLOWLIST.length).toBeGreaterThan(0); // allowlist documented
  });
});

describe('budget kill-switch (B10/E10)', () => {
  it('WORKER_ENABLE_PSI=false disables the PSI leg with an explicit reason', async () => {
    const env: Env = { WORKER_ENABLE_PSI: 'false' };
    const req = new Request('http://example.com/api/v1/page-report?url=https://example.com/page');
    const res = await pageReportRoute(req, env, restComposition(new Headers(), env));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lab: { status: string; reason: string } };
    expect(body.lab.status).toBe('unavailable');
    expect(body.lab.reason).toContain('psi disabled');
  });
});
