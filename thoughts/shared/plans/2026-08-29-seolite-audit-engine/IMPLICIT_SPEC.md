# IMPLICIT SPEC — seolite audit-engine (packages/audit)

| field | value |
|---|---|
| bundle | `thoughts/shared/plans/2026-08-29-seolite-audit-engine/` |
| aspect | audit-engine (P2 of M1) |
| package | `packages/audit` (`@seolite/audit`) |
| date | 2026-08-29 |
| inherits | global Implicit Spec I1–I17 from `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` (cited below, not restated) |
| contract | ARCHITECTURE.md at `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` is locked; where this file and ARCHITECTURE disagree, ARCHITECTURE wins |

Requirements only. Designs/mechanisms live in PLAN.md.

## Inherited invariants — binding status for this aspect

Cited from research §Implicit Spec. (I7 look, I8 license/attribution, I11 repo hygiene do not bind this aspect.)

- **I1 zero-cost defaults** — binds: the audit engine only self-fetches the user's target site. No provider, API key, or paid service appears anywhere in `packages/audit`.
- **I2 pluggability** — binds: rules are registered/validated by id; an unknown rule id in config is an explicit error listing available ids (mirrors the provider-registry edge). No vendor calls.
- **I3 data honesty** — binds: every issue carries observed evidence only; a link is reported broken only if its target was fetched during this crawl and returned ≥400; skipped pages are counted and labeled, never silently dropped, never zero-filled as "clean".
- **I4 crawl etiquette** — binds fully (this aspect is its primary owner): robots.txt respected by default with a documented override; conservative behavior on robots fetch failure; per-host rate limiting including robots crawl-delay; bounded crawls (pages/depth/time); sitemap-based discovery when available; 429/Retry-After honored; User-Agent identifying the tool is set by the core Fetcher (audit never overrides).
- **I5 MCP-first parity** — binds partially: `runSiteAudit` is the single engine both the CLI and the stdio MCP tool will call; zero surface logic in this package.
- **I6 Worker stays thin** — binds: this package is Node-only (cheerio). It must never be imported by the Worker bundle; crawl-grade compute stays local (CLI/stdio/CI).
- **I9 TDD gate** — binds: every edge in the edge→test map (PLAN.md Testing Strategy) has a named, deterministic test before merge; no live network in tests.
- **I10 determinism** — binds: clock, sleep, and jitter are injected dependencies; no behavior depends on wall-clock time or live network state.
- **I12 SSRF safety** — binds: every request, including every redirect hop, flows through the core Fetcher which enforces I12; audit additionally filters discovered URLs to http/https only.
- **I13 output safety** — binds (this aspect owns it for stored report data): crawled strings stored in reports are inert (control characters stripped, length-capped, valid text); report ids are path-safe; consumers (CLI terminal, site HTML) still escape at render time — audit guarantees the stored form is safe to escape, not a license to skip escaping.
- **I14 concurrency, cancellation, partial failure** — binds fully: global concurrency cap, per-request timeout, prompt cancellation via AbortSignal, `incomplete` labeling on interrupted runs, and safe re-runnability (crawls are read-only GETs with no side effects).
- **I15 boundary inputs** — binds: defined behavior (skip-vs-error decision) for non-http(s) schemes, non-HTML content types, oversized pages/sitemaps, redirect loops, empty bodies, IDN/unicode hostnames, malformed robots.txt and sitemaps, and config with unknown rule ids (unknown config keys are core's rejection).
- **I16 no telemetry** — binds: the only outbound traffic is the user-initiated crawl itself; nothing else leaves the machine.
- **I17 retry & backoff** — binds via delegation: bounded retry/backoff/Retry-After live in the core Fetcher; audit treats a response that is still 429/5xx after the Fetcher's retries as a terminal per-URL outcome (skip with reason), never a crash.

## Aspect edges (A1–A12)

- **A1 Single-host crawl.** v1 crawls exactly one host: the seed's origin. Cross-origin links and redirect targets are recorded (for honesty and evidence) but never fetched. No cross-origin fan-out in v1.
- **A2 Robots policy outcomes are enumerable.** robots.txt 2xx → enforce groups, use `Sitemap:` lines; any 4xx except 429 → no restrictions (no robots.txt present); 429 → one Retry-After-capped retry, then refuse to crawl; 5xx / network error / timeout (after core Fetcher retries) → refuse to crawl (conservative, typed error, zero page fetches); malformed content → lenient line-level parsing (drop bad lines, keep valid groups); seed URL disallowed → typed error, zero page fetches. The override (`respectRobots: false`) is an explicit config option, default true, documented.
- **A3 Budgets are hard.** maxPages / maxDepth / maxDuration are enforced unconditionally; every URL actually fetched (regardless of outcome) consumes page budget. maxPages is clamped to an absolute ceiling to bound memory. Frontier growth itself is capped.
- **A4 Skip-vs-error vocabulary.** A page that is not audited appears in the report as `PageReport.skipped = { reason: <SkipReason> }` — one pinned serialized shape (an object with a reason code, never a bare string) carrying exactly one of: `robots_disallowed | non_html | oversized | fetch_error | rate_limited | redirect_loop | redirect_cap`. Skipped pages carry no issues and contribute no score. Skipped is never reported as an error-severity issue (e.g., robots-denied pages are skipped, not errored).
- **A5 Incomplete semantics.** The run ends with exactly one stop reason: `completed` (frontier drained) | `aborted` (signal) | `time_budget` | `page_budget` (frontier not yet empty). `incomplete = stopReason !== 'completed'`. Depth-capped URLs never enter the frontier, so a depth-bounded drain still completes (coverage semantics documented; users raise maxDepth).
- **A6 Report data contract.** `SiteAuditReport` carries ARCHITECTURE's required fields (`id, startedAt, completedAt, pages, summary{countsBySeverity, score}, incomplete, configSnapshot`) plus audit's additive fields (`stopReason`, summary extras). `configSnapshot` contains no secret values (env var names only, per ARCHITECTURE config rules).
- **A7 Evidence honesty.** Only verified failures produce issues. Links never fetched are never judged. Latency issues come from measured timing of this crawl. Score contributions are severity-weighted and monotone (more issues never raise the score).
- **A8 Determinism.** All time and randomness enter as injected dependencies (`now`, `delay`, `jitter`, `randomId`). Test runs are network-free (fake Fetcher) and repeat runs produce byte-identical reports given identical inputs and injected sources.
- **A9 No provider dependency.** `@seolite/audit` imports only `@seolite/core` and `cheerio`. It works with zero providers present (M1 parallelism; P2 merges before P3).
- **A10 Static-HTML auditing.** v1 audits server-rendered HTML as fetched. No headless browser, no JS execution, no rendered-DOM checks. The report's `configSnapshot` records `renderer: 'static'` so consumers can state this honestly.
- **A11 Read-only, safe re-run.** Plain GETs only, no conditional-request headers, no cookies/credentials, no writes to the target. I14's "resumable or safely re-runnable" is satisfied via safe re-run (stateless); resume/checkpoint is a non-goal for v1.
- **A12 Core contract deltas are types-only and additive.** Audit consumes core's Fetcher, config, `AuditRule`/`Severity`/`Issue`/`PageContext`/`PageReport`/`SiteAuditReport`/robots-directive types as declared in ARCHITECTURE. Where audit needs more (optional `Issue.url`, `PageReport.depth/redirectChain`, `PageReport.skipped` pinned as `{ reason: SkipReason }` — object with a reason code, never a bare string, `SiteAuditReport.stopReason`, `summary` extras incl. `ruleErrors`, robots `sitemaps` list), these are optional additive fields — if P1 did not ship them, they land via one types-only PR to core before P2's rule phases merge. Stringly-typed unions (`stopReason`, skip reasons) are declared by audit and stored as `string` in core to avoid a reverse dependency.

## Bounding assumptions (conservative defaults; where a user might have been asked, we fixed the answer)

- Defaults: core-owned per RECONCILIATION R3 — maxPages 100 (hard clamp 10,000), maxDepth 5, maxDurationMs 300,000, maxConcurrency 5, perHostMinDelayMs 250, core fetch timeoutMs 10,000 (audit's per-request deadline composes from it), maxRedirects 5 (adopted by audit's manual redirect following; no audit-owned hop override). Audit-owned: response body cap 2 MiB, latency threshold 1,500 ms, evidence cap 10 issues per rule per page, robots-429 Retry-After cap 5 s, sitemap caps (≤10 robots-declared sitemap sources, 10 children per index, 10,000 URLs, 2 MiB), frontier seen-set cap 100 × maxPages. Rationale: politeness-first, memory-safe; core-owned values are plumbed from core config, audit-owned ones overridable via config.
- Severity vocabulary is `error | warning | info` (matching core's `Severity`); scoring is severity-only (error −10, warning −3, info 0, floor 0 per page; site score = rounded mean over audited pages; zero audited pages → score 0, never 100).
- `favicon` is dropped from the v1 rule set (per-site signal, per-page noise); everything else from the aspect brief's tentative list is in.
- Core additive optional fields (A12) are acceptable to add post-M0 as a types-only PR; this is the default action, not an open question.
- Static-HTML-only auditing (A10) is accepted as v1 scope; JS-rendered gaps are documented, not hidden.
- Depth-capped coverage (A5) counts as a completed run; documented in report output so consumers can state coverage honestly.
- DNS-rebinding-grade SSRF protection stays out of scope per the research bounding assumption; audit relies on core's Fetcher (I12) applied at every hop.
- Scaffold (M0) provides per-workspace `test` / `typecheck` / `lint` / `build` npm scripts; if names differ, only the verify commands in PLAN.md change.
