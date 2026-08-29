/**
 * REBASE SEAM (Phase 6 rebase commit — plan Phase 3/6, B21).
 *
 * Pre-rebase (this branch is core-only by ARCHITECTURE M1) the CLI wires
 * DETERMINISTIC FIXTURE implementations of the AuditRunner and
 * PageMetaFetcher ports so the whole surface — commands, exit codes, MCP
 * tools — is fully exercisable with zero live network (I9/I10). The report
 * shape is a real core SiteAuditReport; severity counts derive from the URL
 * hash, so identical inputs give identical outputs.
 *
 * REBASE: replace both factories with the real engine per the mapping
 * documented at `@lumen-seo/mcp/ports.ts` (runSiteAudit from @lumen-seo/audit
 * with config-load + budget override; cheerio page-meta fetch), and add
 * `@lumen-seo/audit` to packages/cli/package.json. Nothing else changes.
 */
import { createHash } from 'node:crypto';
import type { ResolvedConfig, SiteAuditReport, Severity } from '@lumen-seo/core';
import { countIssuesBySeverity, MAX_PAGES_CEILING } from '@lumen-seo/core';
import type { AuditInput, AuditRunner, PageMeta, PageMetaFetcher } from '@lumen-seo/mcp/ports';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const hashOf = (s: string): Buffer => createHash('sha256').update(s).digest();

const issue = (ruleId: string, severity: Severity, message: string) => ({
  ruleId,
  severity,
  message,
  evidence: {},
});

/** Deterministic severity pattern from the seed URL (I10): identical in, identical out. */
const severityCountsFor = (url: URL): Record<Severity, number> => {
  const h = hashOf(url.href);
  return {
    error: h[0]! % 3, // 0..2
    warning: h[1]! % 3,
    info: h[2]! % 3,
  };
};

export const createFixtureAuditRunner = (
  config: ResolvedConfig,
  clock: () => string = () => new Date().toISOString(),
): AuditRunner => ({
  run: async (input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport> => {
    if (signal?.aborted) {
      throw Object.assign(new Error('aborted by caller signal'), { name: 'AbortedError' });
    }
    const maxPages = Math.min(input.maxPages ?? config.crawl.maxPages, MAX_PAGES_CEILING);
    const counts = severityCountsFor(input.url);
    const pageCount = 1 + (hashOf(input.url.href)[3]! % 4); // 1..4 fixture pages
    const startedAt = clock();
    const issues = [
      ...Array.from({ length: counts.error }, (_, i) => issue(`fixture/error-${i}`, 'error', `fixture error ${i} on ${input.url.hostname}`)),
      ...Array.from({ length: counts.warning }, (_, i) => issue(`fixture/warn-${i}`, 'warning', `fixture warning ${i}`)),
      ...Array.from({ length: counts.info }, (_, i) => issue(`fixture/info-${i}`, 'info', `fixture info ${i}`)),
    ];
    const pages = [];
    for (let p = 0; p < Math.min(pageCount, maxPages); p += 1) {
      await sleep(2); // cancellation checkpoint between pages (E14)
      if (signal?.aborted) {
        return partialReport(input, startedAt, clock, pages, 'aborted', config);
      }
      pages.push({
        url: p === 0 ? input.url.href : new URL(`page-${p}`, input.url).href,
        status: 200,
        title: `Fixture page ${p}`,
        issues: issues.filter((_, i) => i % Math.max(1, pageCount) === p),
        score: 100 - counts.error * 5 - counts.warning * 2,
        timingMs: 42 + p,
        bytes: 2048 * (p + 1),
        robotsAllowed: true,
        depth: p,
      });
    }
    const all = pages.flatMap((pg) => pg.issues);
    return {
      id: `fixture-${hashOf(input.url.href).toString('hex').slice(0, 8)}`,
      startedAt,
      completedAt: clock(),
      pages,
      summary: {
        countsBySeverity: countIssuesBySeverity(all),
        score: pages.length > 0 ? Math.round(pages.reduce((s, pg) => s + (pg.score ?? 0), 0) / pages.length) : null,
        pagesAudited: pages.length,
        pagesSkipped: 0,
      },
      incomplete: false,
      configSnapshot: { crawl: config.crawl, failThreshold: config.failThreshold },
      stopReason: 'completed',
    };
  },
});

const partialReport = (
  input: AuditInput,
  startedAt: string,
  clock: () => string,
  pages: SiteAuditReport['pages'],
  stopReason: string,
  config: ResolvedConfig,
): SiteAuditReport => ({
  id: `fixture-${hashOf(input.url.href).toString('hex').slice(0, 8)}`,
  startedAt,
  completedAt: clock(),
  pages,
  summary: {
    countsBySeverity: countIssuesBySeverity(pages.flatMap((p) => p.issues)),
    score: null,
    pagesAudited: pages.length,
    pagesSkipped: 0,
  },
  incomplete: true,
  configSnapshot: { crawl: config.crawl, failThreshold: config.failThreshold },
  stopReason,
});

export const createFixturePageMetaFetcher = (): PageMetaFetcher => ({
  fetch: async (url: URL): Promise<PageMeta> => ({
    url: url.href,
    title: `Fixture page: ${url.hostname}`,
    description: `Deterministic fixture description for ${url.pathname}`,
    canonical: url.href,
    lang: 'en',
    h1: [`Fixture H1 for ${url.pathname}`],
  }),
});
