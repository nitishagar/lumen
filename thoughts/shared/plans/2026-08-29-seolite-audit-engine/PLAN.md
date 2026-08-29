# PLAN — seolite audit-engine (packages/audit)

## SIGNPOST

| field | value |
|---|---|
| bundle | `thoughts/shared/plans/2026-08-29-seolite-audit-engine/` |
| aspect | audit-engine |
| package | `packages/audit` → `@seolite/audit` |
| scale | large |
| date | 2026-08-29 |
| protocol | create_plan_generic_v2_5 |
| status | draft — zero open questions; conservative defaults locked in IMPLICIT_SPEC bounding assumptions |
| depends on | M0 merged to main: `packages/core` (Fetcher, config loader incl. `failThreshold`, provider SPI + payload models, AuditRule SPI + registry, HistoryStore interface, crawl budget types, robots directives) |
| merge order | P2 — first of M1 (P2 → P3 → P4 → P5). Depends ONLY on `@seolite/core`; zero dependency on `@seolite/providers` (no-op providers irrelevant: audit makes no provider calls) |
| test runner | Vitest (locked, ARCHITECTURE §Locked decisions) |
| DOM parser | cheerio ^1.2.0 (locked; Node-only — this package is never imported by the Worker, I6) |

## Overview

`@seolite/audit` is the crawl-and-judge engine: a bounded, polite crawler (robots-gated, rate-limited, budgeted, cancellable) plus a built-in rule set (18 rules), a severity scorer, and report assembly with output-sanitization ownership (I13). One public entry point — `runSiteAudit(seed, config, deps, signal): Promise<SiteAuditReport>` — will back both the CLI `seolite audit` command and the `seolite_audit_site` MCP tool (P4's concern; no surface logic here). The package imports only `@seolite/core` and `cheerio`; it is deterministic (injected clock/sleep/jitter), network-free in tests (fake Fetcher), and read-only against targets (safe re-run satisfies I14).

## Current State

- Greenfield: repository contains only `thoughts/` (verified 2026-08-29); no package code exists yet.
- `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` §Packages assigns this package: "bounded crawler (global concurrency cap, per-request timeout, cancellation, robots-failure conservative default, per-host rate limiting, sitemap discovery) + built-in AuditRules + severity scorer + report assembly with output sanitization ownership (I13) and partial-failure labeling."
- ARCHITECTURE §Provider SPI / payload models locks the shapes audit codes against: `Fetcher`, `AuditRule{id, severity, categories, check(page, o)}`, `PageContext{url, status, headers, dom (cheerio load), bytes, timingMs, robotsAllowed}`, `Issue{ruleId, severity, message, evidence{selector?, snippet?}, fixHint?}`, `SiteAuditReport{id, startedAt, completedAt, pages: PageReport[], summary{countsBySeverity, score}, incomplete, configSnapshot}`. Core's robots module + crawl budget types come from M0; audit owns the conservative policy on top of them.
- Research I4 (crawl etiquette), I12 (SSRF), I13 (output safety), I14 (concurrency/cancellation/partial failure), I15 (boundary inputs), I17 (retry/backoff) are the invariant classes this aspect primarily implements (research §Implicit Spec, audit round 1).
- M1 sequencing (ARCHITECTURE §Implementation sequencing): this branch is built in a worktree off post-M0 main, per-branch CI runs `npm test -w @seolite/audit`, and it merges before providers/surfaces/site.

## Desired End State

- `runSiteAudit()` crawls one host politely and boundedly: robots gate with conservative failure default, per-host rate limiting honoring crawl-delay, global concurrency cap, per-request timeout, page/depth/time budgets, sitemap-assisted discovery, manual redirect following with loop detection, non-HTML/oversized/empty-body skip handling, prompt AbortSignal cancellation.
- 18 built-in rules emit `Issue`s with evidence; rule ids are config-validatable with severity overrides.
- Report assembly produces the locked `SiteAuditReport` shape with `incomplete` + `stopReason` on bounded/aborted runs, severity counts, a 0–100 score, inert strings (I13), and a path-safe report id.
- Every invariant edge in the Testing Strategy map has a named Vitest test; the suite is deterministic and network-free.

Verify commands:

```bash
npm run typecheck -w @seolite/audit
npm run lint -w @seolite/audit
npm test -w @seolite/audit          # full suite; the phase gate throughout
npm run build -w @seolite/audit
```

## What We're NOT Doing

- No JS rendering / headless browser (static-HTML audit only; `renderer: 'static'` recorded in `configSnapshot`; A10).
- No crawl resume/checkpoint — safe re-run instead (A11); `HistoryStore` untouched (surfaces own storage).
- No provider calls of any kind (no PSI/CrUX/authority in rules — P4 combines those with audits at the surface).
- No Worker import path: Node-only package; keeping it out of the Worker bundle is P4/P6's build concern (I6).
- No cross-origin crawling (A1); no authenticated crawling (no cookies/credentials); no conditional requests.
- No DNS-rebinding defense (core Fetcher's I12 scope; research bounding assumption).
- No per-rule importance weights in scoring (severity-only in v1; extension point documented).
- No `favicon` rule (per-site signal, per-page noise — revisit when rules get depth/site context).
- No sitemap *generation*, no scheduled/daemon crawls, no stored crawl database.
- No HTML/PDF report rendering — JSON report only; rendering/escaping at display time belongs to CLI (terminal encoding) and site (HTML escaping) per ARCHITECTURE.

## Approach

Pipeline, all deps injected (Fetcher from core; `now`/`delay`/`jitter`/`randomId` injected for I10):

1. **Gate** — load robots directives for the seed origin via core's robots module through the core Fetcher. Apply the conservative policy table (Design Analysis → Defaults & policy tables). Refusal → typed error, zero page fetches. `respectRobots: false` (config, default true) skips the gate but never the rate limiter or budgets.
2. **Discover** — seed the frontier from the seed URL plus sitemap URLs (robots `Sitemap:` lines, else probe `/sitemap.xml`), filtered to same-origin http/https, robots-checked individually, deduplicated by normalized URL.
3. **Crawl loop** — worker pool at global concurrency cap; per-host minimum spacing (max of configured interval and robots crawl-delay); per-request deadline via injected delay; manual redirect following (≤ `maxRedirects` 5 per R3, loop-detected, each hop through the core Fetcher so I12 re-validates; cap reached without a repeated URL → `redirect_cap` skip); capped body read (2 MiB); content-type classification.
4. **Audit** — parse HTML with cheerio into `PageContext`; run per-page built-in rules + any core-registered plugin rules with a `RuleContext{depth, isSeed, crawl?}`; collect out-links and per-URL status into a `CrawlIndex`.
5. **Finalize** — run crawl-level rules (`broken-internal-link`, `redirect-chain`) against the `CrawlIndex`; place issues on owning pages.
6. **Assemble** — score (severity-weighted, monotone), summarize counts, sanitize strings, mint path-safe report id, set `stopReason`/`incomplete`, snapshot config (no secrets).

Cancellation (I14) is enforced at every blocking point: dispatch checks, rate-limit sleeps, request signals (`AbortSignal.any`-style combination implemented with injected delay so tests stay on fake timers), and queue drop. Abort resolves — it does not reject — with a partial report labeled `incomplete: true`.

## Design Analysis

### Invariants → mechanism

| Invariant | Mechanism in `@seolite/audit` |
|---|---|
| I4 etiquette | robots-policy table (below); per-host rate limiter (`nextAllowedAt = now + max(perHostMinDelayMs, crawlDelaySeconds × 1000)` — RFC 9309 crawl-delay is seconds; the seconds→ms conversion is pinned here and encoded in the test fixture); budgets enforced before dispatch; sitemap discovery; UA set by core Fetcher (never overridden); post-retry 429 → single Retry-After-capped retry, then `rate_limited` skip |
| I12 SSRF | every request and every redirect hop goes through the injected core Fetcher; discovered URLs filtered to http/https before enqueue |
| I13 output safety | `sanitizeText` strips C0/C1 control chars, caps length on every crawled-derived string entering `Issue.message/evidence.snippet/fixHint`; URLs serialized from `URL` objects; `reportIdFor` produces `[a-z0-9.-]`-only ids; consumers still escape at render (CLI/site ownership per ARCHITECTURE) |
| I14 concurrency/cancellation/partial failure | global semaphore (worker pool, default 5); per-request deadline; run-level `AbortSignal` checked at dispatch/sleep/fetch; stop on abort resolves with `incomplete: true`; per-page fetch failure → `fetch_error` skip, loop continues; no side effects → safe re-run |
| I15 boundary inputs | skip-reason vocabulary + hard caps; behavior table below (non-HTML, oversized, empty, redirect loop, malformed robots/sitemap, IDN, non-http(s), unknown rule ids) |
| I17 retry/backoff | delegated to core Fetcher; audit classifies only post-retry terminal outcomes |
| I2 pluggability | `createRuleSet(config)` merges built-ins + core-registered plugin rules; unknown rule id in `config.rules` → error listing available ids |
| I3 honesty | skipped pages counted in `summary.pagesSkipped`; uncrawled links never judged; score monotone; zero-audited-pages → score 0 |
| I9/I10 | every edge has a named test; `now`/`delay`/`jitter`/`randomId` injected; no `Date.now`/`Math.random` in `src/` |
| I1/I16 | self-fetching only; no telemetry; nothing else leaves the machine |

### Failure & concurrency model

- **Worker pool**: fixed pool of `concurrency` workers pulling from a FIFO frontier (`{url, depth}`); `inFlight` counter observable by tests via the fake Fetcher.
- **Per-request deadline** without real timers (deterministic tests):

```ts
const ac = new AbortController();
const onAbort = () => ac.abort();                        // run-level abort → per-request abort
signal?.addEventListener('abort', onAbort, { once: true });
const timer = deps.delay(opts.requestTimeoutMs, signal); // cancellable injected sleep (I10)
timer.then(() => ac.abort(), () => {});                  // deadline hit → abort the request
try {
  // core Fetcher enforces SSRF (I12) + its own retry/backoff (I17)
  return await deps.fetcher.fetch(url, { ...init, redirect: 'manual', signal: ac.signal });
} finally {
  signal?.removeEventListener('abort', onAbort);         // no listener leakage across 10k pages
  timer.cancel();                                        // deadline timer cancelled (no-op if fired)
}
```

- **Abort promptness**: `abort()` → (1) dispatch loop exits (no new requests), (2) rate-limit sleeps reject, (3) in-flight `AbortController`s fire, (4) pool awaits settlement, (5) report assembled with `stopReason: 'aborted'`, `incomplete: true`. Test asserts no fetch starts after abort and run resolves promptly.
- **Stop reasons**: `completed` (frontier drained) / `aborted` / `time_budget` (checked before each dispatch) / `page_budget` (fetched count reached). `incomplete = stopReason !== 'completed'` (A5).
- **Partial failure isolation**: a per-URL fetch or parse throw is caught and recorded as a `fetch_error` skip. A throwing rule is isolated per rule per page: the rule is skipped for that page and the failure is counted in the additive `summary.ruleErrors: Record<ruleId, number>` — no issue is fabricated for a rule that never ran, no console reliance — and the run continues. Crawl-level throws (robots refusal) surface as typed errors from `runSiteAudit`: `SeoliteRobotsUnreachableError`, `SeoliteSeedDisallowedError`.

### Blast radius

- **core (P1)**: consumes Fetcher, config, robots directives, payload models. Needs additive optional fields (A12): `Issue.url?`, `PageReport.depth?/redirectChain?`, `PageReport.skipped?: { reason: SkipReason }` (pinned single shape — always an object with a reason code, never a bare string), `SiteAuditReport.stopReason?`, `summary.pagesAudited?/pagesSkipped?/byRule?/ruleErrors?`, robots directives `sitemaps?: string[]`. Types-only PR to core if P1 didn't include them — default action, non-breaking.
- **providers (P3)**: zero interaction. Audit imports nothing from `@seolite/providers`; merge-order independence holds.
- **surfaces (P4)**: depends on `runSiteAudit`, the built-in rule list (for `seolite config show`), typed robots errors (exit-code mapping), and the report shape. Public API is `src/index.ts` only.
- **site-docs (P5)**: none at runtime (site has zero package deps); report JSON is the data contract; site escapes at render.

### Alternatives considered (with rejection)

1. **`redirect: 'follow'` (undici auto-redirect)** — rejected: no chain visibility for the `redirect-chain` rule, no loop detection hook, no per-hop routing through the core Fetcher for I12 re-validation.
2. **Core Fetcher exposes redirect chains** — rejected: changes the locked core Fetcher contract (`fetch(url, init) → Response`); manual hops via `init.redirect: 'manual'` need no core change.
3. **Puppeteer/Playwright rendering** — rejected: weight, CI cost, v1 scope (A10); documented honesty label instead.
4. **Streaming SAX sitemap parser** — rejected for v1: cheerio `xmlMode` + hard caps (2 MiB / 10k URLs / 10 children) bound memory adequately; simpler and tested.
5. **Fresh HEAD/GET per link to verify links** — rejected: etiquette cost, doubles requests; `broken-internal-link` piggybacks on crawl fetches only (honest: unverifiable links are never judged, I3).
6. **External queue/database frontier** — rejected: in-memory frontier bounded by maxPages clamp + seen-set cap; no persistence in v1.
7. **Per-rule weighted scoring (Lighthouse-style)** — rejected v1: severity-only scoring is explainable and needs no config surface; weights are a documented future extension.
8. **`robots-parser` npm** — not audit's decision (core P1 chooses per ARCHITECTURE); audit consumes core's directives object only, so either choice is compatible.
9. **Dedicated per-page-favicon rule** — rejected (noise; listed in NOT Doing).

### Defaults & policy tables (locked; core-owned values per RECONCILIATION R3, audit-owned knobs overridable via config)

Crawl budgets — R3-authoritative (RECONCILIATION.md R3, core-owned; audit plumbs them, never re-declares): `maxPages 100` (absolute clamp 10,000) · `maxDepth 5` · `maxDurationMs 300_000` · `maxConcurrency 5` · `perHostMinDelayMs 250` · core fetch `timeoutMs 10_000` (audit's per-request deadline composes from it) · `maxRedirects 5`. Audit-owned knobs (R3 audit list + A2/A4 policy): `maxBodyBytes 2_000_000` · `latencyThresholdMs 1_500` · evidence cap 10 per rule per page · robots-429 Retry-After cap 5 s · sitemap caps (≤10 robots-declared `Sitemap:` sources, 10 children per index, 10,000 URLs, 2 MiB) · frontier seen-set cap `100 × maxPages`. Reconciliation note: audit follows redirects manually, but adopts R3's core-owned `maxRedirects 5` — there is no audit-owned hop-count override (earlier draft's `maxRedirectHops 10` is withdrawn).

robots.txt policy (A2):

| robots fetch outcome | behavior |
|---|---|
| 2xx, parses | enforce groups; `Sitemap:` lines feed discovery |
| 2xx, malformed lines | lenient: drop bad lines, keep valid groups; zero valid groups + non-empty body → no restrictions, recorded as parse warning |
| 404/410 (any 4xx except 429) | no restrictions; probe `/sitemap.xml` |
| 429 | one retry honoring `Retry-After` (capped 5 s), then `SeoliteRobotsUnreachableError` |
| 5xx / network error / timeout (after core Fetcher retries) | `SeoliteRobotsUnreachableError` — refuse to crawl, zero page fetches (conservative, I4) |
| seed disallowed | `SeoliteSeedDisallowedError`, zero page fetches |
| `respectRobots: false` | gate skipped; rate limiting and budgets always remain |

Boundary-input behavior (I15; skip pages are recorded, never errors):

| input | behavior |
|---|---|
| non-http(s) scheme link | filtered before enqueue (I12) |
| non-HTML content type (2xx) | page recorded, `skipped: { reason: 'non_html' }`, no rules, consumes budget |
| body > 2 MiB (Content-Length or streamed) | read aborted at cap, `skipped: { reason: 'oversized' }`, no parse |
| empty body (2xx) | parsed as empty document; rules fire naturally (title-missing etc.) |
| redirect loop (URL repeats within one chain) | `skipped: { reason: 'redirect_loop' }` on that URL; chain truncated |
| redirect cap (chain reaches `maxRedirects` 5 with no repeated URL) | `skipped: { reason: 'redirect_cap' }` on that URL |
| redirect chain ≥2 hops | page fetched; `redirect-chain` rule flags; cross-origin final URL recorded, not crawled |
| IDN/unicode host | `URL` normalizes (punycode) for frontier, report id slug, and display |
| malformed sitemap XML | discovery warning (`sitemap_malformed`), fall back to link discovery |
| oversized sitemap | discovery warning (`sitemap_oversized`), fallback; entries beyond 10k ignored (counted) |
| sitemapindex | one level of nesting, ≤10 child sitemaps |
| multiple robots `Sitemap:` lines | at most 10 declared sitemap URLs fetched (audit-owned cap; bounds worst case) |
| 429 on a page (post-Fetcher-retries) | one Retry-After-capped retry, then `skipped: { reason: 'rate_limited' }` |
| unknown rule id in config | explicit error listing available rule ids (I2 edge) |

All skips serialize identically as `PageReport.skipped = { reason: <SkipReason> }` — one pinned shape, never a bare string (consumed by P4; A4/A12).

Built-in rules (18; default severity overridable via `config.rules[id].severity`; `threshold` where noted):

| # | id | default severity | categories | fires when |
|---|---|---|---|---|
| 1 | `title-missing` | error | meta | no `<title>` or empty after trim |
| 2 | `title-length` | warning | meta | title >65 or <15 chars (thresholds overridable) |
| 3 | `description-missing` | error | meta | no meta description or empty |
| 4 | `description-length` | warning | meta | description >165 or <50 chars |
| 5 | `h1-missing` | error | content | zero `<h1>` |
| 6 | `h1-multiple` | info | content | more than one `<h1>` |
| 7 | `canonical-present` | info | meta | no `<link rel="canonical">`; multiple canonicals → warning (per-issue override) |
| 8 | `lang-attr` | warning | content | `<html lang>` missing or not matching a BCP-47-ish primary tag |
| 9 | `viewport-meta` | warning | technical | no `<meta name="viewport">` |
| 10 | `image-alt-coverage` | warning | content, accessibility | any `<img>` without an `alt` attribute (one issue per page with coverage %; `alt=""` counts as present) |
| 11 | `broken-internal-link` | error | links | same-host link target fetched this crawl with status ≥400 (crawl rule; evidence = source page's anchor) |
| 12 | `redirect-chain` | warning | links, technical | page URL needed ≥2 redirect hops to reach final URL (crawl rule) |
| 13 | `robots-noindex` | info | meta, technical | `<meta name="robots" content~noindex>` or `X-Robots-Tag: noindex` header |
| 14 | `status-error` | error | technical | fetched page status ≥400 |
| 15 | `insecure-http` | warning | technical | page served over `http:` |
| 16 | `mixed-content` | error | technical | `http:` subresources (`script[src]`, stylesheet/icon `link[href]`, `img[src]`, `iframe[src]`) on an `https:` page; one issue per page with count |
| 17 | `response-latency` | warning | performance | measured `timingMs` > threshold (default 1500) |
| 18 | `og-tags-missing` | info | social | any of `og:title` / `og:description` / `og:image` absent; one issue listing the missing set |

Scoring (A7; locked):

```ts
const WEIGHT: Record<Severity, number> = { error: 10, warning: 3, info: 0 };
export function scorePage(issues: Issue[]): number {
  return Math.max(0, 100 - issues.reduce((s, i) => s + WEIGHT[i.severity], 0));
}
export function scoreReport(pages: PageReport[]): number {
  const audited = pages.filter(p => !p.skipped);
  return audited.length === 0
    ? 0                                     // honest: nothing audited ≠ clean
    : Math.round(audited.reduce((s, p) => s + scorePage(p.issues), 0) / audited.length);
}
```

Key audit-owned types (core-compatible; `o` in the locked `check(page, o)` SPI):

```ts
export type StopReason = 'completed' | 'aborted' | 'time_budget' | 'page_budget';
export type SkipReason =
  | 'robots_disallowed' | 'non_html' | 'oversized'
  | 'fetch_error' | 'rate_limited' | 'redirect_loop' | 'redirect_cap';
// serialized only as PageReport.skipped = { reason: SkipReason } — never a bare string (A4)

export interface RuleContext { depth: number; isSeed: boolean; crawl?: CrawlIndex }
export interface CrawlIndex {
  pages: { url: string; status: number; depth: number; hops: number; finalUrl: string }[];
  outLinks: Map<string, { href: string; url: string; internal: boolean }[]>;
  statusOf(url: string): { status: number; finalUrl: string } | undefined;
}
export interface CrawlRule {                       // audit-local extension; core AuditRule stays per-page
  readonly id: string; readonly severity: Severity; readonly categories: string[];
  checkCrawl(index: CrawlIndex, o: RuleContext): Issue[];
}
export interface CrawlerDeps {                     // I10: everything non-deterministic is injected
  fetcher: Fetcher;                                 // from core (I12/I17)
  now(): number;
  delay(ms: number, signal?: AbortSignal): Promise<void> & { cancel(): void }; // cancellable sleep (I10)
  jitter(): number;
  randomId(): string;                               // lowercase [a-z0-9]{6}; re-sanitized by reportIdFor (I13)
}
export function runSiteAudit(
  seed: URL, config: AuditConfig, deps: CrawlerDeps, signal?: AbortSignal,
): Promise<SiteAuditReport>;
```

Sanitization + report id (I13):

```ts
export function sanitizeText(s: string, max = 300): string {
  return [...s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')].slice(0, max).join('');
}
export function reportIdFor(host: string, startedAtIso: string, rand: string): string {
  const safe = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  const stamp = startedAtIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); // UTC ISO w/ Z
  return `audit-${safe(host) || 'site'}-${stamp}-${safe(rand) || '0'}`;      // rand sanitized too (I13)
}
// e.g. reportIdFor(new URL('https://Bücher.example').host, '2026-08-29T10:15:00.123Z', 'a1b2c3')
//   new URL(...).host === 'xn--bcher-kva.example'             // URL punycodes the IDN (A8)
//   → 'audit-xn--bcher-kva.example-20260829T101500Z-a1b2c3'   // path-safe: [a-z0-9.-] only
// Hostile rand, e.g. path traversal or control chars → sanitized through the same safe() filter:
//   reportIdFor('ok.example', '2026-08-29T10:15:00.123Z', '../evil')
//   → 'audit-ok.example-20260829T101500Z-..-evil'             // unconditionally path-safe
```

`configSnapshot` = seed URL, budgets, enabled rule ids + effective severities, `respectRobots`, `renderer: 'static'`. Never env values (ARCHITECTURE: BYOK via env var names only).

## Resource & Cost Analysis

- **Requests per run**: ≤ maxPages page fetches + 1 robots.txt + sitemap fetches bounded by ≤10 robots-declared `Sitemap:` sources × (1 + ≤10 children per index) = ≤110. Defaults: ≤211 requests; at the 10,000-page clamp ≤10,111 — finite and honestly stated.
- **Time floor from politeness**: per-host 250 ms spacing caps throughput at ~4 req/s regardless of concurrency 5, so 100 pages take ≥25 s; the R3 `maxDurationMs 300_000` budget accommodates that 12×, and at defaults the page budget (100) bites first. Whichever budget bites first sets `stopReason` honestly (A5); the robots-429 Retry-After cap (5 s) cannot starve the 300 s budget.
- **Memory caps**: body reads stop at 2 MiB; cheerio DOMs are parsed, extracted, and released per page (never retained in reports). Worst-case peak ≈ concurrency × (2 MiB body + ~10× DOM overhead) ≈ ~110 MiB on pathological 2 MiB pages; typical pages (~100 KB) make this ≪10 MiB. Frontier memory bounded by the seen-set cap (100 × maxPages entries). Report size: the structural per-page maximum is 37 issues (only `broken-internal-link` and `mixed-content` have multiplicity 10; every other rule emits ≤1 per page) → defaults (100 pages) ≤3.7k issues ≈ ~1 MB JSON; the 10,000-page clamp ≈ 370k issues ≈ ~110 MB worst case — an extreme-config bound, not a default-path one.
- **Cost**: zero external services, zero API keys (I1); only egress to the user's target; no telemetry (I16); CI cost is plain Vitest on public-repo Actions (free).

## Phases

TDD throughout (I9): each phase lists tests first (red) then implementation (green). Every phase's gate is `npm test -w @seolite/audit` plus typecheck.

### Phase 1 — Package scaffold + deterministic core loop

**Changes**

- `packages/audit/package.json` — `name: @seolite/audit`, ESM, `engines.node >=22`, deps `@seolite/core` (workspace), `cheerio ^1.2.0`; dev `vitest`, `typescript`. Scripts `test/typecheck/lint/build` per scaffold convention.
- `packages/audit/tsconfig.json`, `packages/audit/vitest.config.ts` — Node environment, `test/**/*.test.ts`, fake-timer friendly (no real network anywhere).
- `src/types.ts` — `StopReason`, `SkipReason`, `RuleContext`, `CrawlIndex`, `CrawlerDeps`, audit config types (`AuditConfig` with budgets/rules/`respectRobots`), additive report-field types (A12).
- `src/crawl/url-normalize.ts` — fragment-stripping dedupe key, http/https filter, IDN via `URL` normalization.
- `src/crawl/frontier.ts` — FIFO BFS queue with depth, seen-set, seen-set cap (100 × maxPages).
- `src/crawl/crawler.ts` — worker pool (concurrency cap), budget checks (pages/depth/time) before dispatch, per-request deadline via injected `delay`, page-record accumulation, `stopReason` plumbing; classification hook points left for Phases 2–3.
- `test/helpers/fake-fetcher.ts` — in-memory response table (url → status/headers/body or throw), records request order/timing/in-flight max, abortable pending responses; the single network boundary for all tests.

**Tests added**: `crawler: respects global concurrency cap under contention` (fake fetcher tracks in-flight max ≤ 5) · `crawler: stops at page budget with stopReason page_budget and incomplete true` · `crawler: stops at time budget with stopReason time_budget and incomplete true` · `crawler: drains frontier to stopReason completed and incomplete false` · `crawler: depth-capped URLs are not enqueued and run completes` · `frontier: dedupes fragment variants of the same URL` · `frontier: seen-set cap prevents unbounded growth` · `url-normalize: rejects non-http(s) schemes` · `url-normalize: punycodes IDN hosts` · `crawler: empty body is parsed as an empty document (rules fire)` — plus determinism spot-check `repeated runs with identical inputs produce identical reports` (I10).

**Success Criteria**

- [x] Automated: `npm test -w @seolite/audit`
- [x] Automated: `npm run typecheck -w @seolite/audit`

### Phase 2 — Robots policy, rate limiting, sitemap discovery

**Changes**

- `src/crawl/robots-policy.ts` — maps core robots directives + fetch outcomes to the A2 policy table; exports `robotsOutcomeFor(...)` and the typed errors `SeoliteRobotsUnreachableError`, `SeoliteSeedDisallowedError`; `respectRobots: false` bypass.
- `src/crawl/rate-limiter.ts` — per-host `nextAllowedAt` from injected `now`; effective delay = max(`perHostMinDelayMs`, robots crawl-delay seconds × 1000 per RFC 9309); abortable via injected `delay`.
- `src/crawl/sitemap.ts` — robots `Sitemap:` lines (≤10 declared sources fetched) else probe `/sitemap.xml`; cheerio `xmlMode` parse of `urlset`/`sitemapindex` (1 level, ≤10 children per index); caps 10k URLs / 2 MiB; malformed/oversized → warning + fallback to link discovery; same-origin http/https filter.
- `src/crawl/crawler.ts` — wire gate → discovery → loop; robots-denied URLs recorded `robots_disallowed` (skipped, not errored); crawl-delay feeds rate limiter.

**Tests added**: `robots: denied pages are skipped as robots_disallowed, not errored` · `robots: fetch failure (5xx/network after retries) refuses crawl with typed error and zero page fetches` · `robots: 429 retries once honoring Retry-After cap then refuses` · `robots: 404 means no restrictions and crawl proceeds` · `robots: malformed lines are dropped, valid groups enforced` · `robots: crawl-delay (seconds per RFC 9309) is converted to ms and overrides the configured interval (injected clock)` · `robots: seed disallowed → typed error, zero page fetches` · `rate-limiter: request starts are spaced ≥ min interval per host` · `sitemap: Sitemap: directive URLs seed the frontier` · `sitemap: falls back to /sitemap.xml probe when robots lists none` · `sitemap: malformed XML → warning + link-discovery fallback` · `sitemap: oversized sitemap is capped with warning` · `sitemap: sitemapindex nested one level, child cap enforced` · `sitemap: multiple robots Sitemap: lines are capped at 10 sources` · `sitemap: cross-origin and non-http(s) locs filtered`.

**Success Criteria**

- [x] Automated: `npm test -w @seolite/audit`
- [x] Automated: `npm run typecheck -w @seolite/audit`

### Phase 3 — Boundary handling: redirects, body caps, per-URL failures

**Changes**

- `src/crawl/redirects.ts` — manual hop following (`redirect: 'manual'`), ≤ `maxRedirects` 5 (R3 core-owned), per-chain visited-set loop detection, chain recording (`hops`, `finalUrl`, cross-origin terminal recorded not crawled), every hop through the core Fetcher; cap reached without a repeated URL → `redirect_cap` skip.
- `src/crawl/body-reader.ts` — Content-Length pre-check + capped stream read at 2 MiB; oversized → abort read, classify `oversized`; content-type classification (`text/html`, `application/xhtml+xml` vs `non_html`).
- `src/crawl/crawler.ts` — wire both; post-Fetcher-retry 429 → one Retry-After-capped retry then `rate_limited` skip; any per-URL fetch/parse throw → `fetch_error` skip, run continues; `PageContext` built (url/status/headers/dom/bytes/timingMs/robotsAllowed) and per-page rules invoked with `RuleContext`.

**Tests added**: `redirects: loop terminates at repeated URL with skipped redirect_loop and no hang` · `redirects: chain hitting maxRedirects (5) without a repeated URL skips redirect_cap` · `redirects: cross-origin redirect target recorded but not crawled` · `redirects: each hop goes through the injected fetcher (SSRF re-validation point)` · `body: oversized Content-Length page skipped oversized without parse` · `body: streamed body aborted at cap when Content-Length absent` · `body: non-HTML content type skipped non_html and counted in pagesSkipped` · `body: HTML and XHTML both parsed` · `crawl: 429 on page retries once honoring Retry-After then skips rate_limited` · `crawl: fetch error on one page skips fetch_error and crawl continues` · `crawl: 4xx/5xx page is recorded and audited (status-error context)` · `crawl: no conditional-request headers are ever sent`.

**Success Criteria**

- [x] Automated: `npm test -w @seolite/audit`
- [x] Automated: `npm run typecheck -w @seolite/audit`

### Phase 4 — Cancellation and partial-failure labeling

**Changes**

- `src/crawl/crawler.ts` — run-level `AbortSignal` wiring: dispatch-loop check, rate-limit sleep rejection, per-request `AbortController` composition (snippet above), pool settlement, report assembly on abort (`stopReason: 'aborted'`, `incomplete: true`); bounded grace so `runSiteAudit` always resolves.
- `src/types.ts` — finalize `StopReason` propagation into report additive field.

**Tests added**: `abort: no new request starts after abort` · `abort: in-flight requests receive the abort signal` · `abort: run resolves promptly with partial report labeled incomplete` · `abort: abort during rate-limit sleep stops without dispatch` · `abort: report contains pages fetched before abort and no fabricated data` · `partial: per-page failures never mark the run incomplete by themselves` · `partial: aborted-then-rerun yields a complete report (safe re-run, no side effects)`.

**Success Criteria**

- [x] Automated: `npm test -w @seolite/audit`
- [x] Automated: `npm run typecheck -w @seolite/audit`

### Phase 5 — Built-in rules (18) and rule-set configuration

**Changes**

- `src/rules/context.ts` — link extraction (same-host classification, scheme filter, `javascript:`/other schemes kept as raw href strings only, never fetched), `CrawlIndex` population.
- `src/rules/meta.ts` — rules 1–4, 7, 13 (title/description/canonical/robots-noindex incl. `X-Robots-Tag` header check).
- `src/rules/content.ts` — rules 5, 6, 8, 10 (h1, lang, image-alt coverage with per-page aggregate issue).
- `src/rules/technical.ts` — rules 9, 14–17 (viewport, status-error, insecure-http, mixed-content with subresource scan, response-latency threshold).
- `src/rules/links.ts` — rules 11, 12 as `CrawlRule`s joined against `CrawlIndex.statusOf` (evidence-based only).
- `src/rules/social.ts` — rule 18 (og-tags).
- `src/rules/index.ts` — `createRuleSet(config)`: built-ins + core-registered plugin rules; `config.rules[id]` severity/threshold overrides; unknown id → error listing available ids; evidence cap 10/rule/page with overflow aggregation ("and N more" issue); rule throws isolated per rule per page into `summary.ruleErrors` (no fabricated issue, run continues).

**Tests added**: table-driven positive/negative fixture per rule (18 × ≥2 cases, e.g. `rule title-missing: fires on empty title, silent on present title`, `rule image-alt-coverage: alt="" counts as present`, `rule broken-internal-link: silent when target was never fetched (honesty)`, `rule mixed-content: flags http: subresources only on https: pages`, `rule redirect-chain: silent at 1 hop, warning at ≥2`) · `rules: severity override applied from config` · `rules: threshold override applied (latency, title/description lengths)` · `rules: unknown rule id in config errors listing available ids` · `rules: evidence capped at 10 per rule per page with overflow marker` · `rules: a throwing rule is isolated and recorded in summary.ruleErrors, run continues` · `rules: plugin rule from core registry receives RuleContext`.

**Success Criteria**

- [x] Automated: `npm test -w @seolite/audit`
- [x] Automated: `npm run typecheck -w @seolite/audit`

### Phase 6 — Scorer, report assembly, sanitization, end-to-end gate

**Changes**

- `src/report/score.ts` — `scorePage`/`scoreReport` (snippets above).
- `src/report/sanitize.ts` — `sanitizeText` applied at assembly to every crawled-derived `message`/`evidence.snippet`/`fixHint`; URLs serialized from `URL` objects.
- `src/report/id.ts` — `reportIdFor` (path-safe; snippet above).
- `src/report/assemble.ts` — `SiteAuditReport` assembly: required locked fields + `stopReason`, `summary.pagesAudited/pagesSkipped/byRule/ruleErrors`; issues placed on owning pages (crawl-rule issues attributed to source page via `Issue.url`); `configSnapshot` (no secrets); `renderer: 'static'`.
- `src/index.ts` — public exports (`runSiteAudit`, `createRuleSet`, built-in rule metadata, scorer, sanitizers, typed errors, types); TSDoc contract notes for P4 consumers (report strings are untrusted text — escape at render).
- E2E: `test/e2e.test.ts` — full `runSiteAudit` over a multi-page fake site exercising robots + sitemap + rules + abort + scoring in one run.

**Tests added**: `score: bounds 0–100 and monotone (adding issues never raises score)` · `score: no issues → 100; zero audited pages → 0` · `report: id is path-safe for hostile hosts AND hostile randomId components (spaces, unicode, control chars, slashes, overlong)` · `report: messages/snippets contain no C0/C1 control characters and respect length caps` · `report: summary counts match pages and byRule totals` · `report: crawl-rule issues placed on owning pages with url set` · `report: configSnapshot contains no env values` · `report: repeated identical runs produce byte-identical JSON (injected clock/jitter/randomId)` · `e2e: 5-page fixture site produces complete correct report` · `e2e: abort mid-e2e yields incomplete partial report`.

**Success Criteria**

- [x] Automated: `npm test -w @seolite/audit`
- [x] Automated: `npm run typecheck -w @seolite/audit`
- [x] Automated: `npm run lint -w @seolite/audit` (root `eslint .` — no workspace lint script in the M0 scaffold, per IMPLICIT_SPEC scaffold note)
- [x] Automated: `npm run build -w @seolite/audit` (maps to workspace `tsc --noEmit` — no workspace build script in the M0 scaffold, per IMPLICIT_SPEC scaffold note; see REASONING.md)
- [ ] Phase gate: full M1 branch CI green (per-branch scope `npm test -w @seolite/audit`); ready for orchestrator-ordered merge (P2 → P3 → P4 → P5)

## Testing Strategy

Runner: Vitest (locked). Environment: node; all HTTP through `test/helpers/fake-fetcher.ts` (no live network, I9); all time/jitter/randomness injected (I10); fake timers where sleeps matter. Edge → test map (test names abbreviated; full names in phase lists):

| # | Edge (invariant) | Named test | Phase |
|---|---|---|---|
| 1 | Concurrency cap respected (I14) | `crawler: respects global concurrency cap under contention` | 1 |
| 2 | Page budget → incomplete (I14) | `crawler: stops at page budget... incomplete true` | 1 |
| 3 | Time budget → incomplete (I14) | `crawler: stops at time budget... incomplete true` | 1 |
| 4 | Natural completion (I14) | `crawler: drains frontier to completed` | 1 |
| 5 | Determinism (I10) | `repeated runs... identical reports` / `byte-identical JSON` | 1, 6 |
| 6 | Non-http(s) filtered (I12/I15) | `url-normalize: rejects non-http(s) schemes` | 1 |
| 7 | IDN normalization (I15) | `url-normalize: punycodes IDN hosts` | 1 |
| 8 | Fragment dedupe (behavior) | `frontier: dedupes fragment variants` | 1 |
| 9 | Frontier memory cap (I15) | `frontier: seen-set cap prevents unbounded growth` | 1 |
| 10 | Empty body (I15) | `crawler: empty body is parsed as an empty document` | 1 |
| 11 | Robots-denied = skipped not errored (I4) | `robots: denied pages are skipped as robots_disallowed` | 2 |
| 12 | Robots fetch failure conservative (I4/I15) | `robots: fetch failure refuses crawl, zero page fetches` | 2 |
| 13 | Robots 429 honored (I4/I17) | `robots: 429 retries once honoring Retry-After` | 2 |
| 14 | Robots 404 unrestricted (I4) | `robots: 404 means no restrictions` | 2 |
| 15 | Malformed robots lenient (I15) | `robots: malformed lines dropped, valid groups enforced` | 2 |
| 16 | Crawl-delay honored, seconds→ms (I4) | `robots: crawl-delay (seconds per RFC 9309) converted to ms, overrides interval` | 2 |
| 17 | Seed disallowed (I4) | `robots: seed disallowed → typed error` | 2 |
| 18 | Per-host spacing (I4) | `rate-limiter: requests spaced ≥ min interval` | 2 |
| 19 | Sitemap discovery via robots (I4) | `sitemap: Sitemap: directive URLs seed the frontier` | 2 |
| 20 | Sitemap probe fallback (I4) | `sitemap: falls back to /sitemap.xml probe` | 2 |
| 21 | Malformed sitemap (I15) | `sitemap: malformed XML → warning + fallback` | 2 |
| 22 | Oversized sitemap (I15) | `sitemap: oversized sitemap capped with warning` | 2 |
| 23 | Sitemapindex caps (I15) | `sitemap: sitemapindex nested one level, child cap` | 2 |
| 24 | Multiple robots Sitemap: lines bounded (I15) | `sitemap: multiple robots Sitemap: lines are capped at 10 sources` | 2 |
| 25 | Redirect loop terminated (I15) | `redirects: loop terminates at repeated URL → redirect_loop, no hang` | 3 |
| 26 | Redirect cap without repeat (I15) | `redirects: chain hitting maxRedirects (5) without a repeated URL skips redirect_cap` | 3 |
| 27 | Cross-origin redirect recorded (I12/A1) | `redirects: cross-origin target recorded, not crawled` | 3 |
| 28 | Per-hop SSRF point (I12) | `redirects: each hop goes through the injected fetcher` | 3 |
| 29 | Oversized page (I15) | `body: oversized Content-Length page skipped oversized` + `streamed body aborted at cap` | 3 |
| 30 | Non-HTML skip (I15) | `body: non-HTML content type skipped non_html` | 3 |
| 31 | 429 on page (I4/I17) | `crawl: 429 on page retries once then skips rate_limited` | 3 |
| 32 | Partial failure isolation (I14) | `crawl: fetch error on one page... crawl continues` | 3 |
| 33 | Rule-throw isolation (I14/I9) | `rules: a throwing rule is isolated and recorded in summary.ruleErrors, run continues` | 5 |
| 34 | Cancellation promptness (I14) | `abort: no new request starts after abort` + `in-flight aborted` + `resolves promptly with incomplete report` | 4 |
| 35 | Partial report honesty (I14/I3) | `abort: report contains pages fetched before abort, no fabricated data` | 4 |
| 36 | Safe re-run (I14) | `partial: aborted-then-rerun yields complete report` | 4 |
| 37 | Rule behavior ×18 (I3) | table-driven per-rule fixtures | 5 |
| 38 | Rule config validation (I2/I15) | `rules: unknown rule id errors listing available ids` + override tests | 5 |
| 39 | Evidence caps (I13/resource) | `rules: evidence capped at 10 per rule per page` | 5 |
| 40 | Honesty on uncrawled links (I3) | `rule broken-internal-link: silent when target never fetched` | 5 |
| 41 | Score semantics (I3) | `score: bounds/monotone` + `zero audited pages → 0` | 6 |
| 42 | Path-safe ids incl. random component (I13) | `report: id path-safe for hostile hosts and hostile randomId` | 6 |
| 43 | Inert stored strings (I13) | `report: no C0/C1 control characters, length caps` | 6 |
| 44 | Assembly consistency (I3) | `report: summary counts match pages` + issue placement | 6 |
| 45 | No secrets in snapshot (I1) | `report: configSnapshot contains no env values` | 6 |
| 46 | End-to-end + abort e2e (I14) | `e2e: 5-page fixture site` + `e2e: abort mid-e2e` | 6 |

## References

- `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — Implicit Spec I1–I17 (esp. I4, I12–I17), free-source matrix, bounding assumptions
- `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — locked package boundaries, payload models, AuditRule SPI, M1 sequencing, CLI/MCP names
- `thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` — R1–R10 authoritative cross-plan decisions (R3 crawl budgets; R1 severity vocabulary); this bundle conforms, maxRedirects 5 adopted
- `thoughts/shared/plans/2026-08-29-seolite-audit-engine/IMPLICIT_SPEC.md` — aspect edges A1–A12, bounding assumptions
- RFC 9309 (robots exclusion: 4xx vs unreachable semantics, lenient parsing) — https://www.rfc-editor.org/rfc/rfc9309.html
- Sitemaps protocol (urlset/sitemapindex) — https://www.sitemaps.org/protocol.html
- cheerio (xmlMode, Node-only usage) — https://cheerio.js.org/
- Vitest (fake timers, `vi.useFakeTimers`) — https://vitest.dev/
- MDN `AbortController`/`AbortSignal` composition pattern — https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
