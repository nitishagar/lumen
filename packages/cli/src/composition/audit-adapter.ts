/**
 * The real audit engine + page-meta adapter (Phase 6 rebase commit — the
 * mapping documented at `@lumen-seo/mcp/ports.ts`).
 *
 * - AuditRunner: the caller's ResolvedConfig (already loaded by the core
 *   loader) feeds `runSiteAudit(seed, config, deps, signal)` from
 *   @lumen-seo/audit — crawl budgets from core's config (R3) with the
 *   `--max-pages` override applied on top (`undefined` → core's config
 *   default, R8; the engine hard-clamps at MAX_PAGES_CEILING), and the
 *   configured severityOverrides honored by the engine's rule set. Typed
 *   robots errors (LumenSeedDisallowedError, LumenRobotsUnreachableError)
 *   propagate to run()'s exit envelope (exit 2 with guidance).
 * - PageMetaFetcher: one fetch through core's Fetcher — `redirect: 'manual'`
 *   so every hop is SSRF-revalidated by core's redirect iterator (I12) —
 *   then cheerio meta extraction, Node-side only. Every extracted string is
 *   engine-sanitized (sanitizeText, I13); a non-HTML/oversize body degrades
 *   to `null` ("page meta unavailable"), never a partial guess (I3).
 */
import { randomUUID } from 'node:crypto';
import { load as loadDom } from 'cheerio';
import { AbortedError } from '@lumen-seo/core';
import type { ResolvedConfig, SiteAuditReport } from '@lumen-seo/core';
import { createNodeFetcher } from '@lumen-seo/core/node';
import { runSiteAudit, sanitizeText } from '@lumen-seo/audit';
import type { AuditConfig, CancellableDelay, CrawlerDeps } from '@lumen-seo/audit';
import type { AuditInput, AuditRunner, PageMeta, PageMetaFetcher } from '@lumen-seo/mcp/ports';

/** Page-meta body cap (bytes) — aligned with the audit engine's default maxBodyBytes. */
const META_MAX_BYTES = 2_000_000;

/**
 * Cancellable sleep — the engine's single time seam (I10). Abort rejects with
 * core's AbortedError (the convention the crawler's rate limiter and robots
 * gate rely on); `cancel()` stops the timer without rejecting.
 */
const delay = (ms: number, signal?: AbortSignal): CancellableDelay => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const pending = new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new AbortedError('audit'));
      return;
    }
    timer = setTimeout(resolve, ms);
    onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(new AbortedError('audit'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  }) as CancellableDelay;
  pending.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  };
  return pending;
};

/** Production CrawlerDeps (ports.ts mapping): real fetcher, wall clock, random jitter/id. */
const crawlerDeps = (): CrawlerDeps => ({
  fetcher: createNodeFetcher(),
  now: () => Date.now(),
  delay,
  jitter: () => Math.random(),
  randomId: () => randomUUID(),
});

export const createAuditRunner = (config: ResolvedConfig): AuditRunner => ({
  run: async (input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport> => {
    const auditConfig: AuditConfig = {
      crawl: { ...config.crawl, ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }) },
      severityOverrides: { ...config.severityOverrides },
    };
    return runSiteAudit(input.url, auditConfig, crawlerDeps(), signal);
  },
});

/** Reads the body up to META_MAX_BYTES; oversize → null (no unbounded reads, even without Content-Length). */
const readCapped = async (res: Response): Promise<string | null> => {
  const reader = res.body?.getReader();
  if (reader === undefined) return null;
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done === true) break;
    total += value.byteLength;
    if (total > META_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode()); // flush
  return parts.join('');
};

export const createPageMetaFetcher = (): PageMetaFetcher => {
  const fetcher = createNodeFetcher();
  const textOrNull = (s: string | undefined): string | null => {
    const t = sanitizeText(s ?? '').trim();
    return t === '' ? null : t;
  };
  return {
    fetch: async (url: URL, signal?: AbortSignal): Promise<PageMeta | null> => {
      const res = await fetcher.fetch(url, { redirect: 'manual', signal });
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.includes('text/html')) return null;
      const html = await readCapped(res);
      if (html === null) return null;
      const dom = loadDom(html);
      return {
        url: res.url === '' ? url.href : res.url, // final URL after core's redirect iteration
        title: textOrNull(dom('head title').first().text()),
        description: textOrNull(dom('meta[name="description"]').attr('content')),
        canonical: textOrNull(dom('link[rel="canonical"]').attr('href')),
        lang: textOrNull(dom('html').attr('lang')),
        h1: dom('h1')
          .map((_, el) => sanitizeText(dom(el).text()).trim())
          .get()
          .filter((t) => t !== ''),
      };
    },
  };
};
