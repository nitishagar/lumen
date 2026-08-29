/**
 * Surface ports (the rebase seam). `packages/cli` and `packages/mcp/worker`
 * both code against these interfaces; the fixtures that implement them before
 * the P2/P3 merges are swapped for the real engine/providers in exactly one
 * place per composition root (B21).
 *
 * REBASE MAPPING (documented contract — Phase 6 rebase commit):
 * - AuditRunner: load config via the core loader (applying the caller's
 *   --max-pages budget override onto core's R3 budgets), build CrawlerDeps
 *   from core (fetcher, clock, delay, jitter, randomId), and call
 *   `runSiteAudit(seed: URL, config, deps, signal)` from @lumen-seo/audit.
 *   Typed robots errors (LumenSeedDisallowedError, LumenRobotsUnreachableError)
 *   map to exit 2 with guidance. `maxPages: undefined` means core's config
 *   default applies (R3/R8 — surfaces carry NO budget default).
 * - PageMetaFetcher: fetch the URL through core's Fetcher and parse page meta
 *   with the audit engine's crawler/cheerio helpers (Node-side only).
 */
import type { SiteAuditReport } from '@lumen-seo/core';

export interface AuditInput {
  url: URL;
  /** Optional crawl-budget override; absent = core config default (R3/R8). */
  maxPages?: number;
}

export interface AuditRunner {
  run(input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport>;
}

export interface PageMeta {
  url: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  h1: readonly string[];
}

export interface PageMetaFetcher {
  fetch(url: URL, signal?: AbortSignal): Promise<PageMeta | null>;
}

export const packageName = '@lumen-seo/mcp/ports';
