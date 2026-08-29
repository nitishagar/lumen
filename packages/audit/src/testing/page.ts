/** PageContext construction for rule tests (cheerio + Headers, no network). */
import type { PageContext } from '@lumen-seo/core';
import { load } from 'cheerio';

export const makePage = (
  html: string,
  o: {
    url?: string;
    status?: number;
    headers?: Record<string, string>;
    bytes?: number;
    timingMs?: number;
  } = {},
): PageContext => ({
  url: new URL(o.url ?? 'https://example.com/page'),
  status: o.status ?? 200,
  headers: new Headers(o.headers ?? { 'content-type': 'text/html' }),
  dom: load(html),
  bytes: o.bytes ?? html.length,
  timingMs: o.timingMs ?? 10,
  robotsAllowed: true,
});
