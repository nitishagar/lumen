/**
 * Site rules (E1.6 FR-2 — the third rule kind): run ONCE per audit against
 * the RETAINED robots/sitemap evidence. Pure functions over `SiteContext` —
 * fetching happens in run.ts, never here. Missing evidence is reported as
 * `unknown` in the message, never a silent pass (P-Honest).
 */
import type { Issue, Severity } from '@lumen-seo/core';
import type { SiteContext, SiteRule } from '../types.js';

const MAX_SITEMAP_URLS_CLAIM = 50_000;
/** Counts `<loc>` occurrences cheaply — enough for the >50k-URL claim. */
const countLocs = (body: string): number => (body.match(/<loc>/g) ?? []).length;

/** Hosts named in the sitemap bodies that differ from the seed host. */
const crossHostLocs = (ctx: SiteContext): string[] => {
  let seedHost: string;
  try {
    seedHost = new URL(ctx.seed.url).host;
  } catch {
    return [];
  }
  const bad = new Set<string>();
  for (const sm of ctx.sitemaps) {
    if (sm.body === null) continue;
    for (const m of sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      try {
        const host = new URL(m[1]!, ctx.seed.url).host;
        if (host !== seedHost) bad.add(host);
      } catch {
        // unparseable loc — malformed-XML territory, not wrong-host
      }
    }
  }
  return [...bad];
};

export const sitemapInvalid = (severity: Severity): SiteRule => ({
  id: 'sitemap-invalid',
  severity,
  categories: ['technical', 'integrity'],
  checkSite(ctx): Issue[] {
    const issues: Issue[] = [];
    const url = ctx.seed.url;
    // A site with NO sitemap evidence (probe 404, no robots Sitemap: lines)
    // is a valid state — `sitemap-invalid` judges EXISTING sitemaps only.
    for (const sm of ctx.sitemaps) {
      if (sm.outcome === 'skipped') continue;
      if (sm.outcome === 'fetch_failed') {
        issues.push({
          ruleId: 'sitemap-invalid',
          severity,
          message: `sitemap ${sm.url} could not be fetched this run — validity unknown (not judged, not a pass)`,
          evidence: { selector: 'sitemap' },
          url,
          fixHint: 'make the sitemap reachable so its validity can be judged',
        });
        continue;
      }
      if (sm.outcome === 'malformed') {
        issues.push({
          ruleId: 'sitemap-invalid',
          severity,
          message: `sitemap ${sm.url} is malformed XML (no <urlset>/<sitemapindex> found)`,
          evidence: { selector: 'sitemap' },
          url,
          fixHint: 'fix the XML so the sitemap declares <urlset> or <sitemapindex> with <loc> entries',
        });
      } else if (sm.outcome === 'oversized') {
        issues.push({
          ruleId: 'sitemap-invalid',
          severity,
          message: `sitemap ${sm.url} exceeds lumen's 2 MB evidence cap — only its first bytes were judged`,
          evidence: { selector: 'sitemap' },
          url,
          fixHint: 'split the sitemap into smaller indexes (50,000 URLs / 50 MB is the protocol limit)',
        });
      } else if (sm.body !== null) {
        const locs = countLocs(sm.body);
        if (locs > MAX_SITEMAP_URLS_CLAIM) {
          issues.push({
            ruleId: 'sitemap-invalid',
            severity,
            message: `sitemap ${sm.url} declares ~${locs} URLs — above the 50,000-URL protocol limit`,
            evidence: { selector: 'sitemap' },
            url,
            fixHint: 'split the sitemap with a <sitemapindex> (50,000 URLs per file maximum)',
          });
        }
      }
    }
    for (const host of crossHostLocs(ctx)) {
      issues.push({
        ruleId: 'sitemap-invalid',
        severity,
        message: `sitemap lists URLs on a different host (${host}) — sitemap URLs must share the sitemap's host`,
        evidence: { selector: 'sitemap' },
        url,
        fixHint: 'list only same-host URLs in the sitemap (cross-host entries are ignored by search engines)',
      });
    }
    return issues;
  },
});

/** robots.txt grammar directives lumen understands; anything else in a group context is suspicious. */
const KNOWN_DIRECTIVES = new Set([
  'user-agent', 'disallow', 'allow', 'sitemap', 'crawl-delay', 'comment', 'host',
]);

export const robotsInvalid = (severity: Severity): SiteRule => ({
  id: 'robots-invalid',
  severity,
  categories: ['technical', 'integrity'],
  checkSite(ctx): Issue[] {
    if (ctx.robots.outcome === 'bypassed') {
      // respectRobots:false — we deliberately did not fetch robots, so the
      // rule cannot judge anything (honest unknown, not a silent pass).
      return [
        {
          ruleId: 'robots-invalid',
          severity,
          message: 'robots.txt not judged — the robots gate was disabled (respectRobots: false)',
          evidence: { selector: 'robots.txt' },
          url: ctx.seed.url,
          fixHint: 're-enable the robots gate (or accept that robots.txt is unjudged this run)',
        },
      ];
    }
    if (ctx.robots.outcome === 'absent' || ctx.robots.body === null) {
      return []; // no robots.txt is a valid, common state — nothing to judge
    }
    const issues: Issue[] = [];
    const lines = ctx.robots.body.split('\n');
    for (const [n, raw] of lines.entries()) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const colon = line.indexOf(':');
      if (colon === -1) {
        issues.push({
          ruleId: 'robots-invalid',
          severity,
          message: `robots.txt line ${n + 1} has no directive separator: "${line.slice(0, 60)}"`,
          evidence: { selector: 'robots.txt', snippet: line.slice(0, 120) },
          url: ctx.seed.url,
          fixHint: 'use "Directive: value" lines (User-agent, Disallow, Allow, Sitemap, Crawl-delay)',
        });
        continue;
      }
      const directive = line.slice(0, colon).trim().toLowerCase();
      if (!KNOWN_DIRECTIVES.has(directive)) {
        issues.push({
          ruleId: 'robots-invalid',
          severity,
          message: `robots.txt line ${n + 1} uses an unknown directive "${directive}"`,
          evidence: { selector: 'robots.txt', snippet: line.slice(0, 120) },
          url: ctx.seed.url,
          fixHint: 'remove or correct the directive — unknown directives are ignored by crawlers and may be typos',
        });
      }
    }
    // A blanket Disallow: / is an accident on a production site; on a private
    // target it is the owner's choice (staging) — only fire on public scope.
    const scope = (ctx.config as unknown as { targetScope?: string }).targetScope;
    const blanket = lines.some((l) => {
      const m = /^\s*disallow\s*:\s*\/\s*(#.*)?$/i.exec(l);
      return m !== null;
    });
    if (blanket && scope !== 'private') {
      issues.push({
        ruleId: 'robots-invalid',
        severity,
        message: 'robots.txt disallows the entire site ("Disallow: /") — production pages cannot be crawled',
        evidence: { selector: 'robots.txt' },
        url: ctx.seed.url,
        fixHint: 'replace "Disallow: /" with the paths you actually want excluded (or remove it to allow crawling)',
      });
    }
    // A robots-declared sitemap that failed to fetch this run.
    const declared = lines
      .map((l) => /^sitemap\s*:\s*(\S+)\s*$/i.exec(l.trim())?.[1])
      .filter((u): u is string => u !== undefined);
    for (const sm of ctx.sitemaps) {
      if (sm.outcome === 'fetch_failed' && declared.some((d) => sm.url.startsWith(d))) {
        issues.push({
          ruleId: 'robots-invalid',
          severity,
          message: `robots.txt declares sitemap ${sm.url} but it could not be fetched this run`,
          evidence: { selector: 'robots.txt' },
          url: ctx.seed.url,
          fixHint: 'make the declared sitemap reachable (or update the Sitemap: line)',
        });
      }
    }
    return issues;
  },
});
