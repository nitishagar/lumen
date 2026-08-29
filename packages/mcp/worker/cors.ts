/**
 * Permissive CORS for `/mcp` + `/api/v1/*` (E9/B9): browser Streamable-HTTP
 * clients are first-class, so preflight allows the content/protocol headers
 * AND the BYOK header names (`x-lumen-*`, RENAMES-mapped from the plan's
 * x-seolite-* scheme) — key VALUES ride those headers and are never echoed.
 * `/healthz` is not covered (no browser surface), matching the locked REST
 * subset exactly.
 */
const ALLOWED_HEADERS = [
  'Content-Type',
  'Accept',
  'Authorization',
  'mcp-session-id',
  'MCP-Protocol-Version',
  'x-lumen-psi-key',
  'x-lumen-crux-key',
  'x-lumen-opr-key',
].join(', ');

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Expose-Headers': 'mcp-session-id',
  'Access-Control-Max-Age': '86400',
};

export const corsPreflight = (_pathname: string): Response =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

/** Applies the CORS headers to a route response (E9). */
export const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Preflight + CORS apply only to the locked CORS surface. */
export const isCorsSurface = (pathname: string): boolean =>
  pathname === '/mcp' || pathname.startsWith('/api/v1/');
