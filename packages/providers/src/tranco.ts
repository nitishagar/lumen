/**
 * tranco — the daily Tranco top-sites list as a community AuthorityProvider
 * (A7/BA3). The free tier has no per-domain query API, so the whole list is
 * downloaded and indexed locally: ONE metadata GET (`/api/lists/date/{d}`,
 * walking back ≤3 days when today's list is unpublished) + ONE CSV download
 * per refresh window (default 7 days). First run with all 4 dates 404 is a
 * defined typed `upstream_error` (0 CSV fetches). A cached list is served up
 * to 14 days (staleness disclosed in the estimateLabel); past 14 days with a
 * failed refresh → typed `stale_cache`. Domains outside the indexed top-N →
 * `[]` (omitted, never a zero rank). Every signal carries the Tranco
 * attribution (A7/I8).
 */
import type { AuthorityOpts, AuthorityProvider, AuthoritySignal } from '@lumen-seo/core';
import type { ProviderSettings } from './config.js';
import type { ProviderDeps } from './deps.js';
import { isoNow } from './deps.js';
import { ParseError, ProviderError, RateLimitedError, UpstreamError } from './errors.js';
import { json, normalizeDomain, retryAfterMs } from './http.js';
import { ATTRIBUTION } from './provenance.js';
import { withProviderErrors } from './with-errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY = 'tranco:list:v1';
const DEFAULT_MAX_ROWS = 100_000;
const DEFAULT_REFRESH_DAYS = 7;
const STALE_CEILING_DAYS = 14;
const MAX_DATE_WALK = 3; // today + 3 older dates = 4 attempts

interface TrancoList {
  id: string;
  date: string; // yyyy-mm-dd of the published list
  rows: number;
  map: Record<string, number>;
  fetchedAt: number;
}

const isoDate = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Streams `rank,domain` CSV lines into a domain→rank map, hard-capped at maxRows (I15). */
async function parseCsv(body: ReadableStream<Uint8Array> | null, maxRows: number): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  if (body === null) throw new ParseError('tranco', 'CSV response has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const count = () => Object.keys(map).length;
  const handleLine = (line: string): void => {
    const match = /^(\d+),(\S+)$/.exec(line.trim());
    if (match !== null) map[match[2]!.toLowerCase()] = Number(match[1]);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (count() >= maxRows) {
        await reader.cancel(); // hard cap reached — stop downloading (I15)
        return map;
      }
    }
  }
  if (buffer.trim() !== '') handleLine(buffer); // final line without trailing newline
  if (count() === 0) throw new ParseError('tranco', 'CSV parse yielded no rows');
  return map;
}

export class TrancoProvider implements AuthorityProvider {
  readonly name = 'tranco';
  private readonly refreshMs: number;
  private readonly staleMs: number;
  private readonly maxRows: number;

  constructor(
    cfg: ProviderSettings | undefined,
    private readonly deps: ProviderDeps,
  ) {
    const refreshDays = Math.max(1, cfg?.refreshDays ?? DEFAULT_REFRESH_DAYS);
    this.refreshMs = refreshDays * DAY_MS;
    this.staleMs = Math.max(STALE_CEILING_DAYS, refreshDays) * DAY_MS; // stale ceiling ≥ refresh window
    this.maxRows = Math.max(1, cfg?.maxRows ?? DEFAULT_MAX_ROWS);
  }

  async authority(domain: string, _o?: AuthorityOpts): Promise<AuthoritySignal[]> {
    return withProviderErrors(this.name, async () => {
      const normalized = normalizeDomain(domain);
      const { list, servedStale } = await this.list();
      const rank = list.map[normalized];
      if (rank === undefined) return []; // outside top-N → omitted (I3), never rank 0
      const label = `Tranco rank (list ${list.id}, ${list.date}, top ${list.rows.toLocaleString('en-US')})` +
        (servedStale ? ` — list fetched ${Math.floor((this.deps.clock() - list.fetchedAt) / DAY_MS)}d ago` : '');
      return [
        {
          domain: normalized,
          kind: 'rank',
          value: rank,
          provider: this.name,
          attribution: ATTRIBUTION.tranco, // A7: attribution on EVERY signal
          retrievedAt: isoNow(this.deps.clock),
          estimateLabel: label, // staleness disclosed
        },
      ];
    });
  }

  /**
   * Fresh-cache fast path (0 fetches) → refresh (1 meta GET + 1 CSV) →
   * stale-served within the ceiling → typed stale_cache past it.
   */
  private async list(): Promise<{ list: TrancoList; servedStale: boolean }> {
    const cached = await this.deps.cache.get<TrancoList>(CACHE_KEY);
    const now = this.deps.clock();
    if (cached !== undefined && now - cached.fetchedAt <= this.refreshMs) return { list: cached, servedStale: false };

    try {
      const list = await this.refresh();
      return { list, servedStale: false };
    } catch (e) {
      if (e instanceof ProviderError && cached !== undefined && now - cached.fetchedAt > this.staleMs) {
        throw new ProviderError(
          'stale_cache',
          this.name,
          `cached Tranco list is ${Math.floor((now - cached.fetchedAt) / DAY_MS)}d old (> ${Math.floor(this.staleMs / DAY_MS)}d ceiling) and refresh failed: ${e.message}`,
        );
      }
      if (cached !== undefined) return { list: cached, servedStale: true }; // ≤14d: serve, staleness disclosed
      throw e; // first run: the refresh error itself (typed) propagates
    }
  }

  /** ≤4 metadata GETs (date walk) + exactly 1 CSV download (A7/BA3). */
  private async refresh(): Promise<TrancoList> {
    const meta = await this.resolveLatestList();
    const downloadUrl = meta.download.startsWith('http')
      ? new URL(meta.download)
      : new URL(`https://tranco-list.eu${meta.download}`);
    const res = await this.deps.fetcher.fetch(downloadUrl, { headers: { 'user-agent': this.deps.userAgent } });
    if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
    if (res.status >= 400) throw new UpstreamError(this.name, res.status, `CSV download HTTP ${res.status}`);
    const map = await parseCsv(res.body, this.maxRows);
    const list: TrancoList = {
      id: meta.listId,
      date: meta.date,
      rows: Object.keys(map).length,
      map,
      fetchedAt: this.deps.clock(),
    };
    await this.deps.cache.set(CACHE_KEY, list, this.deps.clock() + 365 * DAY_MS); // store never evicts; provider owns freshness
    return list;
  }

  /** GET /api/lists/date/{yyyy-mm-dd} walking back ≤3 days on 404; all-miss → typed upstream_error. */
  private async resolveLatestList(): Promise<{ listId: string; download: string; date: string }> {
    const today = Math.floor(this.deps.clock() / DAY_MS) * DAY_MS;
    for (let back = 0; back <= MAX_DATE_WALK; back++) {
      const date = isoDate(today - back * DAY_MS);
      const url = new URL(`https://tranco-list.eu/api/lists/date/${date}`);
      const res = await this.deps.fetcher.fetch(url, { headers: { 'user-agent': this.deps.userAgent } });
      if (res.status === 404) continue; // unpublished — walk back
      if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res, this.deps.clock));
      if (res.status >= 500) throw new UpstreamError(this.name, res.status);
      if (res.status >= 400) throw new UpstreamError(this.name, res.status, `HTTP ${res.status} from Tranco metadata`);
      const body = (await json(res, this.name)) as { list_id?: unknown; download?: unknown; download_path?: unknown };
      const listId = typeof body?.list_id === 'string' ? body.list_id : undefined;
      const download =
        typeof body?.download === 'string' ? body.download : typeof body?.download_path === 'string' ? body.download_path : undefined;
      if (listId === undefined || download === undefined) {
        throw new ParseError(this.name, 'metadata response missing list_id/download');
      }
      return { listId, download, date };
    }
    throw new UpstreamError(
      this.name,
      404,
      'no Tranco list published in the last 3 days (tranco-list.eu) — retry later',
    );
  }
}
