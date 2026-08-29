/**
 * lumen Worker (I6/E6/E9/E10/E13): the thin remote surface. Three hard edges:
 * 1. `POST /mcp` — MCP over Streamable HTTP via `createMcpHandler` (stateless,
 *    per-request `buildMcpServer` — B8; the deprecated McpAgent is forbidden).
 *    A capability absent from the Worker-safe deps answers the typed
 *    LOCAL_ONLY_CAPABILITY error pointing at the CLI (E6).
 * 2. REST subset — `/api/v1/page-report` + `/api/v1/keyword-ideas` + `/healthz`
 *    (E9); page-report never fetches the target URL.
 * 3. Budgets — capping fetcher (2.5 MB), no KV/DO/sessions, bundle ≤ 1.5 MB
 *    gzip self-cap (E10), per-request composition (E13).
 * No telemetry: nothing is logged; outbound flows only through the capping
 * fetcher (I16).
 */
import { createMcpHandler } from 'agents/mcp/server';
import type { Server } from '@modelcontextprotocol/server';
import { buildMcpServer } from '../src/server.js';
import { mcpComposition } from './composition.js';
import type { Env } from './providers.js';
import { corsPreflight, isCorsSurface, withCors } from './cors.js';
import { errorJson, jsonResponse, keywordIdeasRoute, pageReportRoute } from './rest.js';
import { restComposition } from './composition.js';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return isCorsSurface(url.pathname)
        ? corsPreflight(url.pathname)
        : errorJson('NOT_FOUND', 404, 'unknown route');
    }
    if (url.pathname === '/healthz') return jsonResponse({ ok: true });
    if (url.pathname === '/api/v1/page-report') {
      return withCors(await pageReportRoute(request, env, restComposition(request.headers, env)));
    }
    if (url.pathname === '/api/v1/keyword-ideas') {
      return withCors(await keywordIdeasRoute(request, env, restComposition(request.headers, env)));
    }
    if (url.pathname === '/mcp') {
      // Fresh per-request server over the per-request BYOK composition (E13);
      // the factory form matches the installed agents createMcpHandler API.
      // Non-POST methods reach the handler and get its typed JSON-RPC protocol
      // error (405) — stateless has no session stream to hold.
      // The installed agents handler is typed against the MCP SDK v2 Server;
      // the v1 McpServer is runtime-compatible via its legacy lane (B8) — the
      // cast documents exactly that bridge.
      const handler = createMcpHandler(() => buildMcpServer(mcpComposition(request.headers, env)) as unknown as Server, {
        route: '/mcp',
        corsOptions: false, // this Worker applies its own permissive CORS (E9)
        allowedOriginHostnames: '*', // B9: authless, permissive v1
      });
      return withCors(await handler(request, env, ctx));
    }
    return errorJson('NOT_FOUND', 404, 'unknown route');
  },
} satisfies ExportedHandler<Env>;
