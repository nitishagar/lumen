/**
 * Typed HTTP response helpers shared by every provider: malformed JSON is
 * `parse_error` EVERYWHERE (I15) — never a raw SyntaxError escaping into the
 * generic upstream bucket — plus Retry-After parsing and domain
 * normalization for the authority lookups (I15/BA11).
 */
import { ParseError } from './errors.js';

/**
 * Decodes a response body as JSON; a malformed body is a typed `parse_error`
 * naming the provider (I15).
 */
export async function json(res: Response, provider: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ParseError(provider, 'malformed JSON body');
  }
}

/** Parses `Retry-After` (delta-seconds or HTTP-date) into ms; undefined when absent/unparseable. */
export function retryAfterMs(res: Response, clock: () => number = Date.now): number | undefined {
  const header = res.headers.get('retry-after');
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^[+-]?\d+$/.test(trimmed)) return Math.max(0, Number.parseInt(trimmed, 10) * 1000);
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - clock());
  return undefined;
}

/**
 * Normalizes a user-supplied domain before Tranco/OPR lookup: trims, strips
 * scheme/path/query, lowercases, drops a port and leading/trailing dots
 * (I15/BA11). IDNA punycode conversion is intentionally out of scope in v1.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim();
  if (d.includes('://')) {
    try {
      d = new URL(d).hostname;
    } catch {
      // fall through to textual cleanup
    }
  }
  d = d.split('/')[0]!;
  d = d.split('?')[0]!;
  d = d.split('#')[0]!;
  const colon = d.lastIndexOf(':');
  if (colon !== -1 && /^\d+$/.test(d.slice(colon + 1))) d = d.slice(0, colon);
  d = d.toLowerCase();
  while (d.startsWith('.')) d = d.slice(1);
  while (d.endsWith('.')) d = d.slice(0, -1);
  return d;
}
