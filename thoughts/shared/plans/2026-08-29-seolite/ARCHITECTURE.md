# seolite — Architecture Contract (plan-of-plans)

Status: authored by orchestrator from RESEARCH.md (thoughts/shared/research/2026-08-29-seolite-greenfield-research.md); reviewed by advisor checkpoint before per-aspect planning. Every per-aspect planner MUST conform to the interfaces and names here; changing them requires changing this file first.

## Product definition (one paragraph)
seolite is a lightweight, pluggable, open-source (Apache-2.0) SEO toolkit for developers and PMs. Agent-first: every capability is an MCP tool, a CLI command, and a thin REST route backed by one core engine. Runs on free services only: local Node process (CLI/stdio MCP), GitHub Pages (site/docs), GitHub Actions (CI + site deploy), Cloudflare Workers free tier (thin remote-MCP/REST gateway). Data honesty is a feature: provenance labels on every metric, no fabricated Semrush-class numbers.

## Locked decisions (from research evidence; planners take as given)
- TypeScript, ESM-only, Node >= 22, npm workspaces (no turborepo in v1 — adoptable later without restructure).
- Vitest everywhere; Workers tests via `@cloudflare/vitest-plugin` (Vitest >= 4.1, Miniflare, fully local/free).
- All HTTP through one injectable `Fetcher` (SSRF-guarded per I12; timeout/backoff/jitter per I17; UA per I4).
- DOM parsing: `cheerio` (pure JS, maintained, Workers-capable) — used Node-side only; the Worker parses no HTML (I6).
- robots.txt: `robots-parser` npm or a minimal vendored checker (planner P1 decides, must be pure-JS).
- MCP: `@modelcontextprotocol/sdk` `McpServer`; remote via Cloudflare `createMcpHandler` (stateless; NOT deprecated McpAgent); same tool registry for stdio + HTTP.
- Site SSG: planner P5 chooses (evidence: Astro / Eleventy / VitePress all emit static; Pagefind for client-side search) — must deploy via Actions upload-pages-artifact.
- Name: `seolite` (npm name, `@seolite` scope, and GitHub repo all verified available 2026-08-29). Author/copyright: Nitish Agarwal. No AI co-author trailers in any commit.

## Packages (npm workspaces)
| Path | Package | Purpose |
|---|---|---|
| `packages/core` | `@seolite/core` | types + payload models, config loader (incl. `failThreshold`), Fetcher (SSRF/timeout/backoff), robots, provider SPI + registry, AuditRule SPI + rule registry, HistoryStore interface, crawl budget types. Zero vendor calls. |
| `packages/audit` | `@seolite/audit` | bounded crawler (global concurrency cap, per-request timeout, cancellation, robots-failure conservative default, per-host rate limiting, sitemap discovery) + built-in AuditRules + severity scorer + report assembly with **output sanitization ownership** (I13: escaped strings, path-safe ids) and partial-failure labeling. |
| `packages/providers` | `@seolite/providers` | built-in providers: `google-suggest` (gray, cached), `wikipedia-demand`, `pagespeed` (BYOK), `crux` (BYOK), `openpagerank` (BYOK, Bearer), `tranco`, `ddg-serp` (gray best-effort). Owns BYOK-absent skip semantics (I1) and per-provider `attribution` metadata (I8). Provenance on every value. |
| `packages/cli` | `@seolite/cli` | `bin: seolite` — commands below; JSONL HistoryStore implementation (rank history, `.seolite/` dir, path-safe); stdio MCP launcher (`seolite mcp`); terminal output encoding (I13). |
| `packages/mcp` | `@seolite/mcp` | MCP tool definitions + transport adapters; `worker/` Cloudflare Worker (createMcpHandler + REST routes). |
| `site/` | (not published) | docs/landing static site, pi.dev-derived design per I7; owns HTML escaping of any rendered crawled data (I13) + attribution display (I8). |

## Provider SPI (signatures are the contract; planners may refine internals only)
```ts
interface Fetcher { fetch(url: URL, init?: RequestInit): Promise<Response> } // SSRF-guarded, injectable
interface KeywordProvider { readonly name: string; ideas(seed: string, o: IdeasOpts): Promise<KeywordIdea[]> }
interface SerpProvider   { readonly name: string; search(q: string, o: SearchOpts): Promise<SerpResult[]> }
interface PageSpeedProvider { readonly name: string; report(url: URL, o): Promise<PageSpeedReport> }
interface CruxProvider   { readonly name: string; record(url: URL, o): Promise<CruxRecord | null> }
interface AuthorityProvider { readonly name: string; authority(domain: string, o): Promise<AuthoritySignal[]> }
interface AuditRule { readonly id: string; readonly severity: Severity; readonly categories: string[];
                      check(page: PageContext, o): Promise<Issue[]> | Issue[] }
// Registry: createRegistry(config) validates names (I2 edge: unknown name -> explicit error listing options)
```
- Payload model required fields (P1 defines exact TS; M1 planners code against these):
  `KeywordIdea{term, source{provider,kind,attribution?}, estimateLabel?, lang?}`; `SerpResult{position, url, title, snippet?}`; `PageSpeedReport{scores{performance,seo,accessibility,bestPractices}, metrics{lcp,cls,tbt,fcn}, source{...}}`; `CruxRecord{metrics: {name: {p75, histogramBins}}, source{...}}` (null when not configured); `AuthoritySignal{domain, kind:'rank'|'score', value, provider, attribution}`; `PageContext{url, status, headers, dom (cheerio load), bytes, timingMs, robotsAllowed}`; `Issue{ruleId, severity, message, evidence{selector?, snippet?}, fixHint?}`; `SiteAuditReport{id, startedAt, completedAt, pages: PageReport[], summary{countsBySeverity, score}, incomplete, configSnapshot}`.
- Every metric value wrapped: `{ value, source: { provider, kind: 'official'|'community'|'heuristic'|'lab'|'field' }, retrievedAt }` (I3).
- Config: `seolite.config.json` — provider selection, severity overrides, crawl budgets, BYOK via env var NAMES (values read from env at call time, never persisted). Optional local plugin files: `plugins: ["./my-rule.js"]` implementing AuditRule (loaded dynamically, Node-only).

## MCP tools (consolidated per Anthropic guidance; names locked)
`seolite_audit_site` (crawl+report, bounded; **local/stdio only** — see REST note), `seolite_page_report` (single URL: PSI+CrUX when BYOK configured, plus meta fetch on stdio), `seolite_keyword_ideas`, `seolite_rank_check` (keyword + domain via SerpProvider), `seolite_authority` (domain signals). All take optional `response_format: 'concise'|'detailed'` (default concise, high-signal). Over remote HTTP, `seolite_audit_site` returns a typed "local-only capability" error pointing to `npx @seolite/cli` (I6).

## CLI (names locked; exit codes for CI gates)
`seolite audit <url> [--max-pages N] [--out report.json]`, `seolite report <url>`, `seolite keywords <seed>`, `seolite rank <keyword> --domain <domain>` (appends to local history), `seolite authority <domain>`, `seolite mcp`, `seolite config show`. Exit: 0 ok/under-threshold, 1 issues at/above `failThreshold`, 2 config/provider error. `--json` on every command.

## REST routes on the Worker (thin, stateless)
`POST /mcp` (Streamable HTTP MCP), `GET /api/v1/page-report?url=` (**PSI/CrUX-derived data only — the Worker never fetches/parses the target URL**, resolving I5-vs-I6), `GET /api/v1/keyword-ideas?q=`, `GET /healthz`. BYOK passed per-request via headers (`x-seolite-psi-key` etc.), never logged or stored. REST is an explicit SUBSET of MCP/CLI surface: audit (crawl) stays local-only per I6; this bounded deviation from full triple-parity is recorded in research I5.

## Repository & CI conventions
- Public repo `nitishagar/seolite`, Apache-2.0 LICENSE at root, README with MCP onboarding snippets (claude mcp add / cursor deeplink / mcpServers JSON), CONTRIBUTING.
- CI (Actions, public-repo free): lint+typecheck+test on push/PR (Node 22), Workers tests via vitest-plugin, Pages deploy workflow (configure-pages → build → upload-pages-artifact → deploy-pages, enabled via API build_type=workflow), optional `wrangler-action@v4` deploy job gated on `CLOUDFLARE_API_TOKEN` secret (absent on this machine — job must skip cleanly when secret missing).
- Branching: `main` protected by green CI; implementation happens in per-aspect worktrees; commits: plain conventional messages, author Nitish Agarwal `<1592163+nitishagar@users.noreply.github.com>`, NO co-author/generated trailers.

## Implementation sequencing (worktrees; merge order fixed to avoid cross-blocking)
- M0 (serial, merges to main first): P1 scaffold-core — workspace scaffold, bootstrap CI (P6's first deliverable lands here: lint+typecheck+test workflow must be green before any other merge), core package (Fetcher, config incl. `failThreshold`, SPI + full payload models, HistoryStore interface) with TDD. Everything else plans against these shapes.
- M1 (parallel worktrees off post-M0 main; each branch depends ONLY on core, never on sibling branches): P2 audit-engine (registry works with no-op providers until P3 merges), P3 providers (pure SPI implementations), P4 surfaces (packages/cli + packages/mcp + JSONL HistoryStore impl, against core models with fixture providers), P5 site-docs (content from locked names; zero runtime deps on packages). Merge order: P2 → P3 → P4 → P5, each rebased by the orchestrator before merge; per-branch CI runs its own package scope (`npm test -w <pkg>`), full suite on main post-merge.
- M2: integration gate on main — full suite, CLI smoke against a local fixture http server, MCP inspector smoke, site build; then repo publish + Pages enable + (only if `CLOUDFLARE_API_TOKEN` secret exists) Worker deploy; P6's deploy workflows finalize here.

## Per-aspect plan bundles
`thoughts/shared/plans/2026-08-29-seolite-<aspect>/` with IMPLICIT_SPEC.md (inherits global I1–I17 + aspect edges) and PLAN.md (v2.5 template, zero open questions, snippets only). Aspects: `scaffold-core`, `audit-engine`, `providers`, `surfaces` (owns packages/cli AND packages/mcp + storage), `site-docs`, `ci-deploy` (P6a bootstrap CI in M0, P6b deploy workflows in M2).
