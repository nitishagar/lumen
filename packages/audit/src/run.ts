/**
 * `runSiteAudit` — the single public engine entry point (I5): one polite,
 * bounded, cancellable crawl + rules + report. Both the `lumen audit` CLI and
 * the `lumen_audit_site` MCP tool call exactly this (P4's concern).
 *
 * Pipeline (plan Approach): gate (robots) → discover (sitemaps) → crawl loop
 * (worker pool) → crawl rules → assemble. Abort anywhere resolves with a
 * partial report (`stopReason: 'aborted'`, `incomplete: true`) — it never
 * rejects (I14). Robots refusal surfaces as typed errors with zero page
 * fetches (A2).
 *
 * Determinism (I10): clock, sleep, jitter, and the report-id random component
 * are injected via `deps`; identical inputs + deps produce byte-identical
 * reports.
 */
import { AbortedError } from '@lumen-seo/core';
import type { Issue, RobotsPolicy, SiteAuditReport } from '@lumen-seo/core';
import { resolveAuditConfig } from './config.js';
import { crawl } from './crawl/crawler.js';
import { readBodyCapped } from './crawl/body-reader.js';
import { normalizeKey } from './crawl/url-normalize.js';
import type { CrawlGate, CrawledPage } from './crawl/crawler.js';
import { createRuleSet } from './rules/rule-set.js';
import type { LlmsTxtEvidence, RobotsEvidence, RuleContext, SiteContext, SiteRule, SitemapEvidence } from './types.js';
import { AI_CRAWLER_UAS } from './rules/ai-search.js';
import { SCHEMA_REQUIRED_PROPS_VERSION } from './rules/integrity.js';
import { robotsGate } from './crawl/robots-policy.js';
import { RateLimiter } from './crawl/rate-limiter.js';
import { discoverSitemaps } from './crawl/sitemap.js';
import { assembleReport } from './report/assemble.js';
import type { AuditConfig, CrawlIndex, CrawlerDeps, CrawlRule, ResolvedAuditConfig } from './types.js';
import { LumenSeedDisallowedError } from './types.js';

export const runSiteAudit = async (
  seed: URL,
  config: AuditConfig = {},
  deps: CrawlerDeps,
  signal?: AbortSignal,
): Promise<SiteAuditReport> => {
  const resolved = resolveAuditConfig(config);
  const warnings: string[] = [];
  const onWarning = (code: string): void => {
    warnings.push(code);
  };
  const limiter = new RateLimiter(deps, resolved.crawl.perHostMinDelayMs);

  if (signal?.aborted) return emptyAbortedReport(resolved, seed, deps, warnings); // zero requests

  // Rule-set construction VALIDATES severity overrides AND the --only filter —
  // do it before any network activity so a bad token errors with zero fetches (M17).
  const ruleSet = createRuleSet(resolved);

  // 1. Gate — robots.txt, conservative on failure (A2). `respectRobots: false`
  //    skips the gate but never the rate limiter or budgets.
  let policy: RobotsPolicy = Object.freeze({ isAllowed: () => true, sitemaps: Object.freeze([]) });
  let probeSitemap = true;
  // Retained evidence for site rules (E1.6 FR-2): the gate's raw robots body
  // and outcome; 'bypassed' is the respectRobots:false shape (no body).
  let robotsEvidence: RobotsEvidence = { body: null, outcome: 'bypassed' };
  if (resolved.respectRobots) {
    let gate: Awaited<ReturnType<typeof robotsGate>>;
    try {
      gate = await robotsGate(seed, deps, signal);
    } catch (e) {
      if (e instanceof AbortedError || signal?.aborted === true) {
        return emptyAbortedReport(resolved, seed, deps, warnings);
      }
      throw e;
    }
    policy = gate.policy;
    if (policy.crawlDelay !== undefined) limiter.setCrawlDelay(policy.crawlDelay); // RFC 9309 seconds
    probeSitemap = gate.probeSitemap;
    robotsEvidence = gate.evidence;
    if (!policy.isAllowed(seed)) throw new LumenSeedDisallowedError(seed.href);
  }

  // 2. Discover — robots `Sitemap:` sources (≤ MAX_SITEMAP_SOURCES) or the
  //    /sitemap.xml probe; same-origin http(s) only; discovery failures warn
  //    and fall back to link discovery.
  let discovered: URL[] = [];
  let sitemapEvidence: SitemapEvidence[] = [];
  const sources = probeSitemap ? [] : [...policy.sitemaps]; // source cap applied inside discovery
  try {
    const discovery = await discoverSitemaps({ seed, sources, deps, limiter, signal, onWarning });
    discovered = discovery.urls;
    sitemapEvidence = discovery.evidence;
  } catch (e) {
    if (!(e instanceof AbortedError) && signal?.aborted !== true) throw e;
    discovered = [];
  }

  // 3. Crawl — worker pool behind the robots+politeness gate, running the
  //    per-page rule set (built-ins + plugin rules with effective severities).
  const crawlGate: CrawlGate = {
    isAllowed: (url) => (resolved.respectRobots ? policy.isAllowed(url) : true),
    waitForTurn: (url, sig, deadlineMs) => limiter.waitForTurn(url.host, sig, deadlineMs),
  };
  const result = await crawl({
    seed,
    config: resolved,
    deps,
    rules: ruleSet.pageRules,
    signal,
    gate: crawlGate,
    discovered,
    onWarning,
  });

  // 4. Finalize — crawl-level rules (broken-internal-link, redirect-chain)
  //    place their issues on OWNING pages via Issue.url (I3).
  const ruleErrors = { ...result.ruleErrors };
  // E1.6: the opt-in external-link check fetches HERE (run.ts owns the limiter
  // and deps — rules never fetch): one HEAD per unique external link, GET on
  // 405, per-host paced, capped. Outcomes ride into the rule context.
  let externalOutcomes: { url: string; pageUrl: string; status: number | null; error?: string }[] | undefined;
  if (resolved.crawl.checkExternal === true) {
    externalOutcomes = await fetchExternalLinks(result, resolved.crawl.externalLinkCap ?? 200, deps, limiter, signal);
    if (signal?.aborted === true) warnings.push('external_link_check_aborted');
  }
  applyCrawlRuleIssues(result.pages, result.index, ruleSet.crawlRules, ruleErrors, signal, result.stop !== 'completed', {
    sitemapUrls: discovered.map((u) => u.href),
    seedUrl: seed.href,
    ...(externalOutcomes === undefined ? {} : { externalOutcomes }),
    ...(resolved.crawl.checkExternal === true ? { externalCap: resolved.crawl.externalLinkCap ?? 200 } : {}),
  });

  // 4b. Site rules (E1.6 FR-2) — once per audit against the retained
  // evidence; issues attribute to the SEED page's row (FR-3: scoring
  // semantics unchanged). Fetch-needing evidence (llms.txt) is collected
  // HERE, next to the limiter/deps the rules never see.
  let llmsTxtEvidence: LlmsTxtEvidence = { body: null, outcome: 'skipped' };
  if (siteRulesWanted(ruleSet, resolved)) {
    llmsTxtEvidence = await fetchLlmsTxt(seed, deps, limiter, signal);
    if (llmsTxtEvidence.outcome === 'fetch_failed' && signal?.aborted === true) {
      warnings.push('llms_txt_check_aborted');
    }
  }
  // E1.6 AC: the vendored required-props table version rides in the report.
  if (ruleSet.siteRules.length >= 0 && 'structured-data-required-props' in ruleSet.effectiveSeverity) {
    warnings.push(`schema_required_props_version:${SCHEMA_REQUIRED_PROPS_VERSION}`);
  }
  // E1.7 AC: the vendored UA list's provenance rides in the report.
  if (ruleSet.siteRules.some((r) => r.id === 'ai-crawler-access')) {
    warnings.push(`ai_crawler_uas_asOf:${AI_CRAWLER_UAS.asOf}`);
    warnings.push(`ai_crawler_uas_source:${AI_CRAWLER_UAS.sourceUrl}`);
  }
  const siteIssues = runSiteRules(ruleSet.siteRules, {
    seed: { url: seed.href, status: seedRowStatus(result.pages, seed) },
    robots: robotsEvidence,
    sitemaps: sitemapEvidence,
    sitemapUrls: discovered.map((u) => u.href),
    llmsTxt: llmsTxtEvidence,
    config: resolved,
    signal,
  }, ruleErrors, warnings);
  attributeSiteIssues(result.pages, siteIssues, seed, warnings);

  return assembleReport(
    result.pages,
    result.stop,
    result.startedAtMs,
    result.completedAtMs,
    ruleErrors,
    resolved,
    seed,
    deps,
    warnings,
    ruleSet.effectiveSeverity,
  );
};

/** Abort during gate/discovery: a zero-page partial report, honestly labeled (I14). */
const emptyAbortedReport = (
  resolved: ResolvedAuditConfig,
  seed: URL,
  deps: CrawlerDeps,
  warnings: string[],
): SiteAuditReport => assembleReport([], 'aborted', deps.now(), deps.now(), {}, resolved, seed, deps, warnings, {});

/**
 * The opt-in external-link check (E1.6): one HEAD per unique external link
 * (GET on 405), per-host paced through the SAME limiter, capped. Outcomes
 * only — the judgment lives in the rule. Politeness is why this is opt-in.
 */
const fetchExternalLinks = async (
  result: { pages: readonly CrawledPage[] },
  cap: number,
  deps: CrawlerDeps,
  limiter: RateLimiter,
  signal: AbortSignal | undefined,
): Promise<{ url: string; pageUrl: string; status: number | null; error?: string }[]> => {
  const seen = new Set<string>();
  const targets: { url: string; pageUrl: string }[] = [];
  for (const page of result.pages) {
    for (const link of page.outLinks) {
      if (link.internal) continue;
      const key = normalizeKey(new URL(link.url, page.url));
      if (seen.has(key) || seen.size >= cap) continue;
      seen.add(key);
      targets.push({ url: key, pageUrl: page.url });
    }
  }
  const outcomes: { url: string; pageUrl: string; status: number | null; error?: string }[] = [];
  for (const t of targets) {
    try {
      await limiter.waitForTurn(new URL(t.url).host, signal);
    } catch {
      break; // abort — abandon the rest of the check
    }
    try {
      let res = await deps.fetcher.fetch(new URL(t.url), { method: 'HEAD', redirect: 'manual', signal });
      if (res.status === 405) res = await deps.fetcher.fetch(new URL(t.url), { method: 'GET', redirect: 'manual', signal });
      outcomes.push({ url: t.url, pageUrl: t.pageUrl, status: res.status });
    } catch (e) {
      if (signal?.aborted === true) break;
      outcomes.push({ url: t.url, pageUrl: t.pageUrl, status: null, error: e instanceof Error ? e.name : 'fetch failed' });
    }
  }
  return outcomes;
};

/** Whether any site rule that needs llms.txt evidence is enabled (avoids a pointless fetch). */
const siteRulesWanted = (ruleSet: { siteRules: readonly { id: string }[] }, _resolved: ResolvedAuditConfig): boolean =>
  ruleSet.siteRules.some((r) => r.id === 'llms-txt');

/** One bounded, robots-polite same-origin GET of /llms.txt (E1.7 FR-2). */
const fetchLlmsTxt = async (
  seed: URL,
  deps: CrawlerDeps,
  limiter: RateLimiter,
  signal: AbortSignal | undefined,
): Promise<LlmsTxtEvidence> => {
  try {
    await limiter.waitForTurn(seed.host, signal);
    const res = await deps.fetcher.fetch(new URL('/llms.txt', seed), { redirect: 'manual', signal });
    if (res.status === 404) return { body: null, outcome: 'absent' };
    if (res.status < 200 || res.status >= 300) return { body: null, outcome: 'fetch_failed' };
    const { text, oversized } = await readBodyCapped(res, 2_000_000, { keepPartial: true });
    if (oversized) return { body: text, outcome: 'fetch_failed' };
    return { body: text, outcome: 'ok' };
  } catch {
    return { body: null, outcome: 'fetch_failed' };
  }
};

/** Run site rules with per-rule isolation (a throw counts into ruleErrors, run continues). */
const runSiteRules = (
  siteRules: readonly SiteRule[],
  ctx: SiteContext,
  ruleErrors: Record<string, number>,
  warnings: string[],
): Issue[] => {
  const issues: Issue[] = [];
  for (const rule of siteRules) {
    try {
      for (const issue of rule.checkSite(ctx)) issues.push(issue);
    } catch {
      ruleErrors[rule.id] = (ruleErrors[rule.id] ?? 0) + 1;
      warnings.push(`site_rule_failed:${rule.id}`);
    }
  }
  return issues;
};

/** FR-3 attribution: the seed row owns site issues; fallback = first audited page; none -> a discovery warning (never silently dropped). */
const attributeSiteIssues = (pages: readonly CrawledPage[], issues: readonly Issue[], seed: URL, warnings: string[]): void => {
  if (issues.length === 0) return;
  const target =
    pages.find((p) => p.url === normalizeKey(seed)) ??
    pages.find((p) => p.skipped === undefined) ??
    pages[0];
  if (target === undefined) {
    warnings.push('site_rule_issues_dropped_no_pages');
    return;
  }
  for (const issue of issues) {
    const list = target.issues as Issue[];
    list.push({ ...issue, url: target.url });
  }
};

/** The seed's surviving status for SiteContext (null when never fetched). */
const seedRowStatus = (pages: readonly CrawledPage[], seed: URL): number | null =>
  pages.find((p) => p.url === normalizeKey(seed))?.status ?? null;

/**
 * Finalize (I3/I14): run the crawl-level rules against the index and place
 * each issue on its OWNING page (`Issue.url`). A throwing crawl rule is
 * isolated per rule into `ruleErrors` — no fabricated issue, run continues.
 * Issues without `url` are dropped (a crawl-rule issue is never attributed to
 * the wrong page). Exported for direct isolation testing with stub rules.
 */
export const applyCrawlRuleIssues = (
  pages: readonly CrawledPage[],
  index: CrawlIndex,
  crawlRules: readonly CrawlRule[],
  ruleErrors: Record<string, number>,
  signal?: AbortSignal,
  incomplete = false,
  siteEvidence?: RuleContext['siteEvidence'],
): void => {
  const byPage = new Map<string, Issue[]>();
  for (const rule of crawlRules) {
    try {
      const found = rule.checkCrawl(index, { depth: 0, isSeed: true, signal, incomplete, siteEvidence });
      for (const issue of found) {
        if (issue.url === undefined) continue;
        const list = byPage.get(issue.url) ?? [];
        list.push(issue);
        byPage.set(issue.url, list);
      }
    } catch {
      ruleErrors[rule.id] = (ruleErrors[rule.id] ?? 0) + 1;
    }
  }
  for (const page of pages) {
    const extra = byPage.get(page.url);
    if (extra !== undefined) page.issues.push(...extra);
  }
};
