/**
 * The crawl engine (plan Phases 1–4): a bounded, polite worker pool.
 *
 * - FIFO BFS frontier, global concurrency cap, page/depth/time budgets with
 *   honest stop reasons (A3/A5);
 * - per-URL failure isolation: a page that cannot be fetched/parsed is
 *   recorded as a skip and the run continues (I14);
 * - AbortSignal cancellation at every blocking point — abort RESOLVES with a
 *   partial report, never rejects (I14).
 *
 * Robots gating, rate limiting, and sitemap discovery (Phase 2) and
 * redirect/body-cap classification (Phase 3) are wired in by the caller via
 * `CrawlOptions.gate` and `CrawlOptions.limiter`.
 */
import { AbortedError } from '@lumen-seo/core';
import type { AuditRule, Issue, PageContext } from '@lumen-seo/core';
import { load as loadDom } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { EVIDENCE_CAP, SEEN_SET_FACTOR } from '../config.js';
import type {
  CrawlIndex,
  CrawlIndexEntry,
  CrawlerDeps,
  OutLink,
  ResolvedAuditConfig,
  RuleContext,
  SkipReason,
  StopReason,
} from '../types.js';
import { extractLinks } from './links.js';
import { Frontier } from './frontier.js';
import type { FrontierEntry } from './frontier.js';
import { fetchPage } from './fetch-page.js';
import { isHtmlContentType, readBodyCapped } from './body-reader.js';
import type { BodyResult } from './body-reader.js';
import { normalizeKey } from './url-normalize.js';

/** Internal per-page record — everything assembly needs, nothing DOM-shaped retained. */
export interface CrawledPage {
  /** Requested URL (normalized key). */
  url: string;
  finalUrl: string;
  hops: number;
  status: number | null;
  timingMs: number | null;
  bytes: number | null;
  robotsAllowed: boolean;
  depth: number;
  skipped?: { reason: SkipReason };
  title?: string;
  issues: Issue[];
  outLinks: OutLink[];
  redirectChain?: string[];
}

export interface CrawlResult {
  pages: CrawledPage[];
  stop: StopReason;
  startedAtMs: number;
  completedAtMs: number;
  ruleErrors: Record<string, number>;
  index: CrawlIndex;
  seed: URL;
}

/** Phase-2 collaborator seam: robots gating + politeness. */
export interface CrawlGate {
  /** Robots decision for a URL about to be dispatched (never fetched when false). */
  isAllowed(url: URL): boolean;
  /** Wait for the per-host politeness slot (abortable). */
  waitForTurn(url: URL, signal?: AbortSignal): Promise<void>;
}

export interface CrawlOptions {
  seed: URL;
  config: ResolvedAuditConfig;
  deps: CrawlerDeps;
  rules: readonly AuditRule[];
  signal?: AbortSignal;
  /** Additional frontier seeds (sitemap discovery, Phase 2), depth 0. */
  discovered?: readonly URL[];
  gate?: CrawlGate;
  /** Extra URLs known to discovery but robots-denied — recorded as skips (Phase 2). */
  onWarning?: (code: string) => void;
}

export const crawl = async (o: CrawlOptions): Promise<CrawlResult> => {
  const { config, deps, signal } = o;
  const budgets = config.crawl;
  const startedAtMs = deps.now();
  const ruleErrors: Record<string, number> = {};
  const pages: CrawledPage[] = [];
  const outLinksByKey = new Map<string, OutLink[]>();
  const statusByPage = new Map<string, CrawledPage>();
  const seedKey = normalizeKey(o.seed);

  const frontier = new Frontier(budgets.maxDepth, SEEN_SET_FACTOR * budgets.maxPages);
  frontier.add(o.seed, 0);
  for (const url of o.discovered ?? []) frontier.add(url, 0);

  const state = { stop: 'completed' as StopReason, fetched: 0, active: 0 };
  // Waiter SET: several idle workers can be parked at once; a single slot
  // would silently drop all but the last registrant and deadlock the pool.
  const activityWaiters = new Set<(value?: undefined) => void>();
  const waitForActivity = (): Promise<void> => new Promise((resolve) => { activityWaiters.add(resolve); });
  const notify = (): void => {
    const current = [...activityWaiters];
    activityWaiters.clear();
    for (const w of current) w();
  };
  const isAborted = (e: unknown): boolean => e instanceof AbortedError || signal?.aborted === true;
  const stopped = (): boolean => signal?.aborted === true || state.stop !== 'completed';

  const markSkip = (entry: FrontierEntry, reason: SkipReason, partial: Partial<CrawledPage> = {}): void => {
    pages.push({
      url: entry.key,
      finalUrl: partial.finalUrl ?? entry.key,
      hops: 0,
      status: null,
      timingMs: partial.timingMs ?? null,
      bytes: partial.bytes ?? null,
      robotsAllowed: partial.robotsAllowed ?? true,
      depth: entry.depth,
      skipped: { reason },
      issues: [],
      outLinks: [],
    });
  };

  const recordPage = (entry: FrontierEntry, page: CrawledPage): void => {
    pages.push(page);
    if (page.status !== null && page.status !== undefined) statusByPage.set(entry.key, page);
    outLinksByKey.set(entry.key, page.outLinks);
  };

  const runRules = async (ctx: PageContext, ruleCtx: RuleContext): Promise<Issue[]> => {
    const issues: Issue[] = [];
    for (const rule of o.rules) {
      try {
        const found = await rule.check(ctx, ruleCtx);
        if (!Array.isArray(found)) continue;
        if (found.length > EVIDENCE_CAP) {
          issues.push(...found.slice(0, EVIDENCE_CAP));
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            message: `+${found.length - EVIDENCE_CAP} more occurrence(s) (evidence capped at ${EVIDENCE_CAP} per rule per page)`,
            evidence: {},
          });
        } else {
          issues.push(...found);
        }
      } catch {
        ruleErrors[rule.id] = (ruleErrors[rule.id] ?? 0) + 1; // rule-throw isolation (I14/I9)
      }
    }
    return issues;
  };

  const processEntry = async (entry: FrontierEntry): Promise<void> => {
    if (o.gate !== undefined && !o.gate.isAllowed(entry.url)) {
      markSkip(entry, 'robots_disallowed', { robotsAllowed: false });
      return; // robots-denied URLs are never fetched and consume NO budget (A3/A4)
    }

    // Budget reservation is synchronous (check + increment with no await
    // between) so concurrent workers can never overshoot `maxPages` (A3).
    // Every actually-fetched URL consumes budget, whatever its outcome.
    if (state.fetched >= budgets.maxPages) {
      state.stop = 'page_budget';
      return; // entry dropped: a known-but-uncrawled URL, honestly labeled incomplete
    }
    state.fetched += 1;

    try {
      await o.gate?.waitForTurn(entry.url, signal);
    } catch (e) {
      if (isAborted(e)) throw new AbortedError('audit');
      throw e;
    }

    const outcome = await fetchPage(entry.url, deps, signal);
    if (outcome.skip !== undefined) {
      markSkip(entry, outcome.skip, { timingMs: outcome.timingMs });
      return;
    }
    const res = outcome.res as Response; // present whenever skip is undefined
    const timingMs = outcome.timingMs;

    const finalUrlHref = res.url !== '' ? res.url : entry.url.href;
    let body: BodyResult;
    try {
      body = await readBodyCapped(res, config.maxBodyBytes);
    } catch (e) {
      if (isAborted(e)) throw new AbortedError('audit');
      markSkip(entry, 'fetch_error', { timingMs, finalUrl: finalUrlHref });
      return;
    }
    if (body.oversized) {
      markSkip(entry, 'oversized', { timingMs, finalUrl: finalUrlHref, bytes: body.bytes });
      return;
    }
    if (!isHtmlContentType(res)) {
      markSkip(entry, 'non_html', { timingMs, finalUrl: finalUrlHref, bytes: body.bytes });
      return;
    }

    let dom: CheerioAPI;
    try {
      dom = loadDom(body.text); // empty body parses as an empty document (I15)
    } catch {
      markSkip(entry, 'fetch_error', { timingMs, finalUrl: finalUrlHref, bytes: body.bytes });
      return;
    }

    const pageContext: PageContext = {
      url: new URL(finalUrlHref),
      status: res.status,
      headers: res.headers,
      dom,
      bytes: body.bytes,
      timingMs,
      robotsAllowed: o.gate !== undefined ? o.gate.isAllowed(entry.url) : true,
    };

    const ruleCtx: RuleContext = { depth: entry.depth, isSeed: entry.key === seedKey, signal };
    const issues = await runRules(pageContext, ruleCtx);

    const { outLinks, internal } = extractLinks(dom, pageContext.url, o.seed.origin);
    for (const link of internal) frontier.add(link, entry.depth + 1);

    const redirected = finalUrlHref !== entry.key;
    recordPage(entry, {
      url: entry.key,
      finalUrl: finalUrlHref,
      hops: redirected ? 1 : 0,
      status: res.status,
      timingMs,
      bytes: body.bytes,
      robotsAllowed: pageContext.robotsAllowed,
      depth: entry.depth,
      title: dom('title').first().text() || undefined,
      issues,
      outLinks,
      ...(redirected ? { redirectChain: [entry.key, finalUrlHref] } : {}),
    });
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped()) return;
      const entry = frontier.take();
      if (entry === undefined) {
        if (state.active === 0) return; // frontier drained AND nothing in flight → completed
        await waitForActivity();
        continue;
      }
      if (deps.now() - startedAtMs >= budgets.maxDurationMs) {
        frontier.unshift(entry);
        state.stop = 'time_budget';
        notify();
        return;
      }
      state.active += 1;
      try {
        await processEntry(entry);
      } catch (e) {
        if (isAborted(e)) {
          state.stop = 'aborted';
          return;
        }
        markSkip(entry, 'fetch_error'); // outermost per-URL isolation (defensive; unreachable by design)
      } finally {
        state.active -= 1;
        notify();
      }
    }
  };

  const workerCount = Math.max(1, Math.min(budgets.maxConcurrency, budgets.maxPages));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (signal?.aborted === true && state.stop === 'completed') state.stop = 'aborted';

  const indexEntries: CrawlIndexEntry[] = [];
  for (const page of pages) {
    if (page.status === null) continue;
    indexEntries.push({
      url: page.url,
      status: page.status,
      depth: page.depth,
      hops: page.hops,
      finalUrl: page.finalUrl,
    });
  }
  const statusMap = new Map(indexEntries.map((e) => [e.url, e]));
  const index: CrawlIndex = {
    pages: indexEntries,
    outLinks: outLinksByKey,
    statusOf: (url: string) => {
      const e = statusMap.get(url);
      return e === undefined ? undefined : { status: e.status, finalUrl: e.finalUrl };
    },
  };

  return {
    pages,
    stop: state.stop,
    startedAtMs,
    completedAtMs: deps.now(),
    ruleErrors,
    index,
    seed: o.seed,
  };
};
