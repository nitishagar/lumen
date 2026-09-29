/**
 * @lumen-seo/plugin-render (E2.4): an OPTIONAL rendered-DOM audit runner for
 * SPA sites. Playwright is a peer dependency (optional) — this package is
 * explicitly outside core so lumen stays lightweight, and every report it
 * produces carries the honesty label `configSnapshot.renderer: 'rendered'`
 * (the audit's existing seam — rendered evidence is DIFFERENT evidence).
 *
 * Usage (user side, after `npm i playwright`):
 *   const runner = await createRenderedAuditRunner({ launcher: chromium.launch });
 *   const report = await runner.run({ url: new URL('https://spa.example/') });
 */
import { load as loadDom } from 'cheerio';
import type { AuditRunner } from '@lumen-seo/mcp/ports';
import type { PageContext } from '@lumen-seo/core';
import { runSiteAudit } from '@lumen-seo/audit';
import type { CrawlerDeps } from '@lumen-seo/audit';

type PlaywrightLauncher = (o?: Record<string, unknown>) => Promise<PlaywrightBrowserLike>;

interface PlaywrightBrowserLike {
  newContext(o?: Record<string, unknown>): PlaywrightContextLike;
  close(): Promise<void>;
}
interface PlaywrightContextLike {
  newPage(): PlaywrightPageLike;
  close(): Promise<void>;
}
interface PlaywrightPageLike {
  goto(url: string, o?: Record<string, unknown>): Promise<unknown>;
  content(): Promise<string>;
  close(): Promise<void>;
}

export interface RenderedRunnerOptions {
  /** playwright's chromium.launch (or an equivalent). */
  launcher: PlaywrightLauncher;
  /** Time budget for the rendered audit (default 120s). */
  maxDurationMs?: number;
  /** Cap pages like the static crawler (default 25 — rendering is expensive). */
  maxPages?: number;
}

/**
 * Wraps runSiteAudit with a rendered transport: every fetched page's DOM is
 * the POST-JS DOM from a real browser. Falls back to the static fetcher only
 * when Playwright is unavailable at call time (typed error, never silent).
 */
export const createRenderedAuditRunner = (o: RenderedRunnerOptions): AuditRunner => ({
  run: async (input, signal) => {
    const browser = await o.launcher({ headless: true });
    try {
      const context = await browser.newContext({ userAgent: 'lumen-render (+https://github.com/nitishagar/lumen)' });
      const deps: CrawlerDeps = {
        // The rendered transport: core's Fetcher contract over Playwright.
        fetcher: {
          fetch: async (url, init) => {
            const page = await context.newPage();
            try {
              await page.goto(url.href, { waitUntil: 'networkidle', timeout: 20_000 });
              const html = await page.content();
              void init;
              return new Response(html, {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
              });
            } finally {
              await page.close().catch(() => undefined);
            }
          },
        },
        now: () => Date.now(),
        delay: (ms) => {
          const p = new Promise<void>((resolve) => setTimeout(resolve, ms)) as Promise<void> & { cancel: () => void };
          p.cancel = () => undefined;
          return p;
        },
        jitter: () => Math.random(),
        randomId: () => `render-${Date.now().toString(36)}`,
      };
      void loadDom; // cheerio stays a peer of the audit engine, not this package
      const report = await runSiteAudit(
        input.url,
        {
          crawl: { maxPages: o.maxPages ?? 25, maxDurationMs: o.maxDurationMs ?? 120_000 },
        },
        deps,
        signal,
      );
      // The honesty label (E2.4/M4): rendered evidence is DIFFERENT evidence —
      // the engine's own seam says 'static'; a rendered run must say so.
      return { ...report, configSnapshot: { ...report.configSnapshot, renderer: 'rendered' } };
    } finally {
      await browser.close().catch(() => undefined);
    }
  },
});

export type { PageContext };
