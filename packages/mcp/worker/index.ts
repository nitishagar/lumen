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

/** E2.5: constant-time bearer check (no early-exit timing signal). */
const bearerOk = async (request: Request, token: string): Promise<boolean> => {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (presented === '') return false;
  // No length pre-check: hash BOTH sides unconditionally so the digest
  // comparison surface is fixed-size (no length oracle by timing).
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(token);
  // Constant-time compare via a hash of both sides.
  const h = (x: Uint8Array): Promise<Uint8Array> => crypto.subtle.digest('SHA-256', x).then((d) => new Uint8Array(d));
  const [ha, hb] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i += 1) diff |= ha[i]! ^ hb[i]!;
  return diff === 0;
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const allowed = env.WORKER_ALLOWED_ORIGINS;
    if (request.method === 'OPTIONS') {
      // Preflight never carries credentials — exempt from auth (I6).
      return isCorsSurface(url.pathname)
        ? corsPreflight(url.pathname, origin, allowed)
        : errorJson('NOT_FOUND', 404, 'unknown route');
    }
    if (url.pathname === '/healthz') return jsonResponse({ ok: true }); // exempt (I6)
    // E2.5: optional bearer auth — set WORKER_AUTH_TOKEN to require it.
    if (env.WORKER_AUTH_TOKEN !== undefined && env.WORKER_AUTH_TOKEN !== '') {
      if (!(await bearerOk(request, env.WORKER_AUTH_TOKEN))) {
        return withCors(
          errorJson('UNAUTHORIZED', 401, 'missing or invalid bearer token (WORKER_AUTH_TOKEN is set on this deployment)'),
          origin,
          allowed,
        );
      }
    }
    if (url.pathname === '/api/v1/page-report') {
      return withCors(await pageReportRoute(request, env, restComposition(request.headers, env)), origin, allowed);
    }
    if (url.pathname === '/api/v1/keyword-ideas') {
      return withCors(await keywordIdeasRoute(request, env, restComposition(request.headers, env)), origin, allowed);
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
      return withCors(await handler(request, env, ctx), origin, allowed);
    }
    return errorJson('NOT_FOUND', 404, 'unknown route');
  },
} satisfies ExportedHandler<Env>;
