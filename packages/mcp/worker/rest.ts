/**
 * REST subset (E9): `GET /api/v1/page-report` and `GET /api/v1/keyword-ideas`
 * — the locked slice that fits the Workers free tier. The page-report route
 * NEVER fetches or parses the target URL (I6/I12): it serves PSI/CrUX (which
 * receive the URL as a parameter) and says so in `limitations`. Every error is
 * the single typed envelope `{error:{code,message,provider?}}`.
 */
import type { CruxRecord, KeywordIdea, PageSpeedReport } from '@lumen-seo/core';
import { validatePublicHttpUrl } from '../src/url-guard.js';
import type { Env, WorkerRestDeps } from './providers.js';

export type RestErrorCode =
  | 'INVALID_URL'
  | 'INVALID_ARGUMENTS'
  | 'MISSING_PARAM'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'PROVIDER_UNCONFIGURED'
  | 'UPSTREAM_FAILED'
  | 'PAYLOAD_TOO_LARGE';

export class RestError extends Error {
  constructor(
    readonly code: RestErrorCode,
    readonly status: number,
    message: string,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'RestError';
  }
}

export const errorJson = (
  code: RestErrorCode,
  status: number,
  message: string,
  provider?: string,
): Response =>
  Response.json(
    { error: { code, message, ...(provider === undefined ? {} : { provider }) } },
    { status },
  );

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

const legReason = (e: unknown): string =>
  e instanceof Error ? e.message : 'provider call failed';

export const jsonResponse = (payload: unknown, status = 200): Response => Response.json(payload, { status });

/** GET /api/v1/page-report?url=&strategy= (PSI/CrUX only — I6). */
export const pageReportRoute = async (
  request: Request,
  env: Env,
  deps: WorkerRestDeps,
): Promise<Response> => {
  if (request.method !== 'GET') {
    return errorJson('METHOD_NOT_ALLOWED', 405, 'use GET for /api/v1/page-report');
  }
  const u = new URL(request.url);
  const raw = u.searchParams.get('url');
  const guard = validatePublicHttpUrl(raw);
  if (!guard.ok) return errorJson('INVALID_URL', 400, guard.message);
  const url = guard.url;

  const strategyParam = u.searchParams.get('strategy') ?? 'mobile';
  if (strategyParam !== 'mobile' && strategyParam !== 'desktop') {
    return errorJson('INVALID_ARGUMENTS', 400, 'strategy must be mobile or desktop');
  }

  const retrievedAt = deps.clock();
  // PSI/CrUX receive the target URL as a parameter; the Worker itself never
  // fetches it (I6 — asserted by the outbound recorder in worker.test.ts).
  const labP: Promise<ReturnType<typeof unavailable> | (PageSpeedReport & { retrievedAt: string })> =
    env.WORKER_ENABLE_PSI === 'false' // B10 kill-switch
      ? Promise.resolve(unavailable('psi disabled (WORKER_ENABLE_PSI=false)'))
      : deps.pageSpeed === undefined
        ? Promise.resolve(unavailable('pagespeed provider not configured'))
        : deps.pageSpeed
            .report(url, { strategy: strategyParam, signal: request.signal })
            .then((r) => ({ ...r, retrievedAt }))
            .catch((e: unknown) => {
              if (e instanceof Error && e.name === 'UpstreamTooLargeError') {
                throw new RestError('PAYLOAD_TOO_LARGE', 413, legReason(e));
              }
              return unavailable(legReason(e));
            });
  const fieldP: Promise<ReturnType<typeof unavailable> | CruxRecord> =
    deps.crux === undefined
      ? Promise.resolve(unavailable('crux provider not configured'))
      : deps.crux
          .record(url, { signal: request.signal })
          .then((r) => (r === null ? unavailable('no CrUX field data (insufficient coverage or key not accepted)') : r))
          .catch((e: unknown) => {
            if (e instanceof Error && e.name === 'UpstreamTooLargeError') {
              throw new RestError('PAYLOAD_TOO_LARGE', 413, legReason(e));
            }
            return unavailable(legReason(e));
          });

  let lab: Awaited<typeof labP>;
  let field: Awaited<typeof fieldP>;
  try {
    [lab, field] = await Promise.all([labP, fieldP]);
  } catch (e) {
    if (e instanceof RestError) return errorJson(e.code, e.status, e.message);
    return errorJson('UPSTREAM_FAILED', 502, legReason(e));
  }

  const attribution: { provider: string; attribution: string }[] = [];
  if (!('status' in lab)) {
    attribution.push({ provider: lab.source.provider, attribution: lab.source.attribution ?? lab.source.kind });
  }
  if (!('status' in field)) {
    attribution.push({ provider: field.source.provider, attribution: field.source.attribution ?? field.source.kind });
  }

  return jsonResponse({
    url: url.href,
    strategy: strategyParam,
    lab,
    field,
    limitations: [
      'lab data is a single synthetic Lighthouse run, not field data',
      // I6/E9: the honest limitation — meta/HTML analysis is local-only.
      'page meta/HTML analysis is local-only: npx @lumen-seo/cli report <url>',
    ],
    attribution,
  });
};

/** GET /api/v1/keyword-ideas?q=&limit=&lang= */
export const keywordIdeasRoute = async (
  request: Request,
  _env: Env,
  deps: WorkerRestDeps,
): Promise<Response> => {
  if (request.method !== 'GET') {
    return errorJson('METHOD_NOT_ALLOWED', 405, 'use GET for /api/v1/keyword-ideas');
  }
  const u = new URL(request.url);
  const q = u.searchParams.get('q');
  if (q === null || q === '') return errorJson('MISSING_PARAM', 400, 'q (seed keyword) is required');
  if (q.length > 120) return errorJson('INVALID_ARGUMENTS', 400, 'q exceeds 120 characters (I15)');

  const limitParam = u.searchParams.get('limit');
  let limit = 20; // plan default (keyword ideas limit 20, max 50)
  if (limitParam !== null) {
    if (!/^[0-9]+$/.test(limitParam)) {
      return errorJson('INVALID_ARGUMENTS', 400, 'limit must be a positive integer');
    }
    limit = Number(limitParam);
    if (limit < 1 || limit > 50) return errorJson('INVALID_ARGUMENTS', 400, 'limit must be between 1 and 50');
  }
  const lang = u.searchParams.get('lang') ?? undefined;

  if (deps.keyword.length === 0) {
    return errorJson('PROVIDER_UNCONFIGURED', 503, 'no keywords provider configured');
  }
  const ideas: KeywordIdea[] = [];
  const seen = new Set<string>();
  for (const p of deps.keyword) {
    let result: KeywordIdea[];
    try {
      result = await p.ideas(q, { lang, limit, signal: request.signal });
    } catch (e) {
      return errorJson('UPSTREAM_FAILED', 502, legReason(e), p.name);
    }
    for (const idea of result) {
      if (seen.has(idea.term)) continue; // dedupe across providers, first wins
      seen.add(idea.term);
      ideas.push(idea);
      if (ideas.length >= limit) break;
    }
    if (ideas.length >= limit) break;
  }
  const attribution = [
    ...new Map(
      ideas
        .filter((i) => i.source.attribution !== undefined)
        .map((i) => [i.source.provider, i.source.attribution as string]),
    ).entries(),
  ].map(([provider, a]) => ({ provider, attribution: a }));

  return jsonResponse({ query: q, ideas, attribution });
};
