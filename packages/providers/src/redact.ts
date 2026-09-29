/**
 * I16: secret-bearing query params never leak into messages or logs. URL
 * objects passed in are never mutated — redaction builds a fresh URL.
 */
const SECRET_PARAMS = [
  'key',
  'token',
  'apikey',
  'api_key',
  'api-key',
  'access_token',
  'signature',
  'sig',
  'sign',
  'secret',
  'client_secret',
  'session_id',
] as const;
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
  // Credentials in the userinfo (user:pass@host) are secrets too.
  if (c.username !== '' || c.password !== '') {
    c.username = '';
    c.password = '';
  }
  return c.href;
}
