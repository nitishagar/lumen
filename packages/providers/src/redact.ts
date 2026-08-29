/**
 * I16: secret-bearing query params never leak into messages or logs. URL
 * objects passed in are never mutated — redaction builds a fresh URL.
 */
const SECRET_PARAMS = ['key', 'token', 'apikey', 'api_key', 'api-key', 'access_token'] as const;
const REDACTED = '[redacted]';

export function redactUrl(u: URL | string): string {
  let c: URL;
  try {
    c = new URL(u);
  } catch {
    return '[invalid-url]';
  }
  for (const p of SECRET_PARAMS) {
    if (c.searchParams.has(p)) c.searchParams.set(p, REDACTED);
  }
  return c.href;
}
