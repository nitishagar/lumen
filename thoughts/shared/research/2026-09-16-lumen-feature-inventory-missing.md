---
date: 2026-09-16T16:27:24+05:30
researcher: Nitish Agarwal
git_commit: 48db2654ce20cfe9a24bdf5a7ba1ae9504916853
branch: evals/evalite
repository: nitishagar/lumen
topic: "Understand the current feature set and make a list of feature set missing and we use /create_plan_generic_v2_6 and /implement_plan_v2_6 focus on using red-team swarm agent for verification. See lumen main aim: https://github.com/nitishagar/lumen Use ~/repos/learn"
tags: [research, codebase, audit, providers, cli, mcp, worker, evals, feature-inventory]
scale: medium
status: complete
last_updated: 2026-09-16
last_updated_by: Nitish Agarwal
---

# Research: lumen current feature set vs missing (for plan/implement with red-team swarm verification)

## Research Question

Understand the current feature set and make a list of feature set missing and we use /create_plan_generic_v2_6 and /implement_plan_v2_6 focus on using red-team swarm agent for verification. See lumen main aim: https://github.com/nitishagar/lumen Use ~/repos/learn

## Summary

lumen at `48db265` (branch `evals/evalite`) is v0.2.1 + evals work: a TypeScript monorepo (`packages/core|audit|providers|mcp|cli` + Astro docs `site`) shipping a bounded robots-respecting site audit (18 rules, severity scoring), 7 free/BYOK data providers over 5 boundaries, 7 CLI commands, 5 MCP tools over stdio plus a thin Cloudflare Worker gateway (REST subset + Streamable HTTP), provenance-on-every-number, JSONL rank history, evalite offline tool-contract gate, and a tag-driven publish pipeline. `npm test` is green: 79 files / 880 tests. The stated aim (lightweight, pluggable, MCP-first SEO toolkit: local audits, keyword ideas, rank checks, CWV reports — CLI + MCP + Worker, free-only BYOK, provenance) is substantially shipped; the site explicitly disclaims what has no free source (search-volume DB, backlink graph, clickstream). Observed missing vs the aim and vs a complete product surface: live LLM-judge scorer is a skipped stub; Worker is a deliberately thin subset (audit + rank are local-only remotely; tranco unselected; PSI strict opt-in default OFF; ddg-serp excluded Worker-side); history covers rank only; plugins are Node-only; rule coverage stops at 18 with no sitemap/robots/schema/hreflang/duplicate-content/structured-data generation-or-checks beyond the listed 18; no monitoring/diff/alerting/dashboard/export beyond JSON/human + `--out`; Worker gateway is authless permissive-CORS with per-request BYOK headers and no shared cross-isolate pacing; no red-team swarm verification harness exists yet (only red-team round-1 hardening + no-telemetry/source-gate tests). Scale profile: medium.

## Detailed Findings

### Stated aim (lumen main aim, observed)

- Aim is "Lightweight, pluggable, MCP-first SEO toolkit — free services only, bring your own keys, provenance on every number" — `README.md:8` [V]. Status line says v0.2.x first public release with CLI + five MCP tools + docs site live — `README.md:10` [V].
- About-line scope: "Local site audits, keyword ideas, rank checks, CWV reports — CLI + MCP server + Cloudflare Worker" — GitHub About text observed via fetch [R] (page chrome truncated the fetch; local README/docs corroborate each element individually — see seams below).
- Landing page enumerates what ships (audit 18 rules, PSI+CrUX BYOK page reports, suggest+demand keywords, best-effort rank, OPR+Tranco authority) and what deliberately does not (no free search-volume database, no free backlink graph, no free clickstream panel — "so lumen doesn't fabricate one") — `site/src/pages/index.astro:57-68` [V].
- Canonical contract counts: 18 rules, 7 providers, 5 MCP tools, 7 CLI commands, exit codes 0/1/2, Node >= 22.7, Apache-2.0 — `lumen-social-pack/README.md:29-37` [V] (launch copy written against v0.2.0-prep state; counts still match code — see below).

### Seam A — Audit engine (crawler, 18 rules, scoring, report)

- The 18 built-ins are locked in one table with order preserved: 6 meta (title-missing/description-missing error; title-length/description-length warning; canonical-present info; robots-noindex info), 4 content (h1-missing error; h1-multiple info; lang-attr warning; image-alt-coverage warning), 2 crawl (broken-internal-link error; redirect-chain warning), 5 technical by category-count with one double-counted (viewport-meta, status-error, insecure-http, mixed-content, response-latency; redirect-chain carries both `links`+`technical`), 1 social (og-tags-missing info); 16 page-kind + 2 crawl-kind — `packages/audit/src/rules/rule-set.ts:28-46` [V].
- Rule wiring: built-ins + plugin `extraRules` validated once through core's `createRuleRegistry`; unknown override id throws ConfigError listing known ids; emitted plugin-issue severities are normalized to the effective (override) severity, evidence untouched — `packages/audit/src/rules/rule-set.ts:70-113` [V].
- Crawler pieces located: frontier (bounded FIFO), per-host rate limiter, robots-policy, sitemap discovery, url-normalize/dedupe, capped body reader, fetch-page, crawl loop, `run.ts` pipeline entry, `config.ts` limits — locator return lists `packages/audit/src/crawl/*.ts`, `packages/audit/src/report/*.ts`, `packages/audit/src/testing/fake-fetcher.ts`, tests `e2e/crawler/rules/assemble` [R] (paths confirmed to exist; contents not line-verified beyond rule-set).
- Scoring + report (descriptive): severity weights error 10 / warning 3 / info 0; per-page 100 minus weights floored at 0; report = mean over audited pages; zero audited pages scores 0; interrupted runs labeled `incomplete: true` with stop reason — `site/src/pages/docs/rules-reference.astro:82-98,132-138` [V] (docs; engine asserts mirror in `assemble/score` tests per locator [R]).
- PII hygiene: `sanitizeText` strips control chars and caps at 300; `sanitizeIssue` is explicit-allowlist, no `...issue` spread — `packages/audit/src/report/sanitize.ts:11-24` [R] (excerpt seen via sub-agent).

### Seam B — Providers / BYOK / provenance (7 sources, 5 boundaries, GCRA pacing)

- Seven canonical names: `google-suggest, wikipedia-demand, pagespeed, crux, openpagerank, tranco, ddg-serp` — `packages/providers/src/builtins.ts:10-18` [V].
- Capability map: suggest+wiki→`keywords`; pagespeed→`pagespeed`; crux→`crux`; opr+tranco→`authority`; ddg→`serp` — `packages/providers/src/builtins.ts:23-31` [V].
- Documented per-60s limits: wikipedia 200, pagespeed 240, crux 150, openpagerank 60; suggest/ddg/tranco undocumented (conservative defaults) — `packages/providers/src/builtins.ts:39-44` [V].
- Default GCRA pacing (worst rolling-60s = rpm+burst): suggest 30+5=35; wikipedia-demand 60+10=70 (0.35× documented); pagespeed keyed 60+10=70 (0.29×) with separate keyless 6+1 pacer; crux 140+10=150 (= limit, never above); openpagerank 50+10=60 (= limit); tranco 1+1 (not rate-bound: 1 meta + 1 CSV per refresh window); ddg-serp 6+1 (10s spacing, worst 7/min) — `packages/providers/src/builtins.ts:47-55` [V] (audit fix: wikipedia row was omitted in draft; now included).
- Cache TTLs: suggest 24h; wikipedia 24h (28d window, 2d lag); pagespeed 6h (keyed/keyless modes never share cache key `psi:{mode}:{strategy}:{href}`); crux 24h; openpagerank 30d/domain; tranco refresh 7d / stale ceiling 14d / maxRows 100k / walk ≤3d; ddg 1h — provider files per audit sample [R] (CONFIRMED by auditor against `google-suggest.ts:18`, `wikipedia-demand.ts:21`, `pagespeed.ts:24`, `crux.ts:23`, `openpagerank.ts:24`, `ddg-serp.ts:24`, `tranco.ts:24-26`).
- BYOK: config carries env-var NAMES never values; three default names `LUMEN_PSI_KEY, LUMEN_CRUX_KEY, LUMEN_OPR_KEY`; secret-like keys (`apiKey/key/token/secret/password`) rejected with env-var hint; env name must match `^[A-Z_][A-Z0-9_]*$`, resolved at call time via `deps.env`; empty/whitespace key treated as absent — `packages/providers/src/config.ts:25-57`, `packages/providers/src/deps.ts:31` [R].
- Key-handling edges: PSI key sent in `x-goog-api-key` header never URL; OPR uses `Authorization: Bearer` (not `API-OPR`), single `domains[0]=` per call; PSI `automated===true` without key → NotConfigured (never a keyless automated call); CrUX without key → NotConfigured (never called); OPR 401/403 → NotConfigured, quota-text/429 → `rate_limited{reason:monthly-quota}`; CrUX 404 → cached `{record:null}` honest absence; wiki no-match → `[]` never zero-filled; ddg fallback `html→lite` exactly once only on Parse/Blocked; 429→rate_limited no fallback; 5xx→upstream no fallback — provider files [R].
- Provenance: CrUX carries verbatim CC BY 4.0 sentence + methodology URL on every record; gray/heuristic labels (suggest gray undocumented endpoint; ddg best-effort; opr proxy; wiki demand-proxy labeled) — `packages/providers/src/provenance.ts:7-20` [R]. Malformed JSON always `parse_error` never SyntaxError; `Retry-After` delta-seconds or HTTP-date → ms else undefined — `packages/providers/src/http.ts:13-22` [R].
- Registry wiring: Node adds `ddg-serp` via GcraPacer and constructs a frozen registry; Worker-safe factory excludes `ddg-serp` (cheerio Node-only; graph never reaches cheerio) — `packages/providers/src/registry-wiring.ts:21`, `packages/providers/src/worker.ts:22-23` [V] (worker.ts read directly).
- Source gate: prod provider sources contain zero `fetch(` — all outbound flows through injected Fetcher — `packages/providers/src/no-direct-fetch.test.ts:26` [R].

### Seam C — CLI + MCP surfaces + composition wiring + Worker gateway

- CLI has 7 commands (`audit, report, keywords, rank, authority, mcp, config` + `show` subcommand): `COMMAND_NAMES` in `packages/cli/src/args.ts:13`, positionals per command, strict parse (unknown flag → UsageError → exit 2), help interception prints to stdout exit 0 — `packages/cli/src/args.ts:13-122`, `packages/cli/src/run.ts:66-79` [R].
- Exit contract single source: `EXIT = {OK:0, ISSUES:1, CONFIG_ERROR:2}` — `packages/core/src/gate.ts:11` [V]. `audit` gate: `report.incomplete || countIssuesAtOrAbove(issues, threshold) > 0 → 1 else 0`; cancelled → 2; `--max-pages` clamped 1..10000 else UsageError; `--out` via atomic write; `--json` vs human summary — `packages/cli/src/cmd/audit.ts:30-50`, `packages/cli/src/write-atomic.ts:9` [R].
- Per-command behavior: `report` three legs (lab/field/meta) each degrade to `{status:'unavailable', reason}`; `keywords` round-robin interleave then slice to limit, per-item source provenance, failures → unavailable; `rank` requires `--domain` else UsageError, not-found yields `found:false, position:null` exit 0, appends one RankHistoryEntry unless `--no-save`; `authority` all-BYOK-missing yields `{signals:[], unconfigured:[...]}` exit 0; `mcp --print` targets json/claude/cursor/vscode exit 0; `config show` prints names/paths/thresholds but never secret values — `packages/cli/src/cmd/*.ts` [R].
- History: root `LUMEN_HISTORY_DIR ?? ./.lumen/history`; one file per domain `<root>/rank/<slug80>-<sha256:8>/history.jsonl`; 1 MiB default rotation to literal single-generation `history.1.jsonl` (oldest rotated copy overwritten) before the exceeding append; one O_APPEND write per entry; appends serialized via in-process promise queue; reads skip truncated/malformed final line; `list({keyword,domain,limit})` filters and `slice(-limit)`; single-domain list reads rotated-then-current; all-domains fans out over `rank/*` dirs sorted by `retrievedAt` — `packages/cli/src/cli-config.ts:25`, `packages/cli/src/history/jsonl-store.ts:22-36,71-144` [V] (jsonl-store read directly; audit G4 fixed).
- Composition: `mcpDepsFromCommand` maps CLI deps (clock, keyword/authority/serp/pageSpeed/crux providers, auditRunner, pageMeta, history) to MCP deps; `availableProviders` builds the 7 built-ins from config; `byokReady` false when configured env name missing/empty; audit-adapter merges `input.maxPages` over `config.crawl` (undefined → core default); page-meta fetch capped 2 MiB, oversize → null, manual-redirect SSRF-revalidated — `packages/cli/src/composition/*.ts` [R].
- MCP: single factory `buildMcpServer(deps)` registers exactly the 5 locked tools — `packages/mcp/src/server.ts:88`, `TOOL_NAMES` in `packages/mcp/src/schemas.ts:12-18` [V]. Schemas are `z.strictObject` (wire `additionalProperties:false`) with `response_format concise|detailed default concise`, `failThreshold info|warning|error|off default error`, `limit 1..50 default 20`, `strategy mobile|desktop default mobile`, `maxPages 1..10000 optional no default`, seed/keyword ≤120 chars, domain ≤253, lang regex — `packages/mcp/src/schemas.ts:21-66` [V].
- Guards: every handler runs `strictArgs` then `validatePublicHttpUrl` → `INVALID_URL`; absent capability (auditRunner/serp/…) → typed `LOCAL_ONLY_CAPABILITY` with CLI pointer; results are JSON-in-text with `ok` vs `err({isError:true})`; concise trims (audit topIssues:10; page_report lab scores+metrics/field p75/meta title+lang; rank base; authority base) while detailed adds stopReason/timestamps/pages[], attributions/limitations, results+recentHistory:10, unavailable[] — `packages/mcp/src/server.ts:53-101,184-406`, `strict-args.ts:14`, `url-guard.ts:14`, `local-only.ts:17` [R] (excerpts seen).
- Worker gateway (thin, corrected per audit G6): routes `GET /healthz → {ok:true}`, `GET /api/v1/page-report`, `GET /api/v1/keyword-ideas`, `POST /mcp` (per-request `buildMcpServer`, stateless, own permissive CORS) — `packages/mcp/worker/index.ts:31-56` [V] (read directly). Provider split is two-layer: (a) Worker-safe layer excludes ONLY `ddg-serp` (cheerio Node-only) — `packages/providers/src/worker.ts:2-23` [V]; (b) Worker composition additionally leaves `tranco` unselected (bulk-CSV parsing cannot fit CPU ceiling) — `packages/mcp/worker/providers.ts:11-17` [V]. PSI is STRICT OPT-IN: `workerConfig = env.WORKER_ENABLE_PSI==='true' ? {pagespeed:{}} : {}` (default OFF; kill-switch `"false"` omits pagespeed so REST+MCP legs answer explicit unavailability) — `packages/mcp/worker/providers.ts:57-71` [V]. No serp/auditRunner/pageMeta/history in Worker McpDeps → `lumen_audit_site` + `lumen_rank_check` answer LOCAL_ONLY_CAPABILITY remotely — `packages/mcp/worker/providers.ts:81-95` [V]. REST: page-report never fetches/parses the target URL; keyword-ideas `q ≤ 120`, `limit ≤ 50 default 20`, dedupe first-wins — `packages/mcp/worker/rest.ts` [R]. Budgets: capping fetcher 2.5 MiB (Content-Length pre-reject + mid-stream cancel → UpstreamTooLarge/PAYLOAD_TOO_LARGE); bundle ≤1.5 MiB gzip self-cap; no KV/DO/sessions — `worker/index.ts:9-14`, `capping-fetcher.ts:10` [R].

### Seam D — Core platform / config / budgets / security hardening

- Config file `lumen.config.json` (override via `LUMEN_CONFIG`): top keys `providers, severityOverrides, crawl, failThreshold, byok, plugins`; missing file → full defaults (not an error); unknown key at any closed level → ConfigError listing valid keys with `path`; `providers.*` unknown lists 5 boundaries; `crawl.*` unknown lists 5 budgets; `severityOverrides` values must be valid Severity; `failThreshold ∈ error|warning|info|off`; `byok` open name→name map (never resolves values; loader output never contains a secret value); `plugins` must be string[] local paths; budgets integers ≥1 (`perHostMinDelayMs` ≥0); `maxPages` hard-clamped to 10000 (not an error) — `packages/core/src/config.ts`, `config.test.ts` [R].
- Crawl budgets default `{maxPages:100, maxDepth:5, maxDurationMs:300000, maxConcurrency:5, perHostMinDelayMs:250}`, ceiling `MAX_PAGES_CEILING=10000` — `packages/core/src/budgets.ts:15-23` [V].
- Entry isolation: barrel `index.ts` never re-exports `./node`; `src/index.ts` graph contains no `node:` specifiers and never reaches `node.ts`; Node-only imports (`node:dns/promises, fs, path, url`) live in `node.ts` (`createNodeFetcher` wires DNS resolver; `readConfigFile` ENOENT→null) — `packages/core/src/index.ts:79`, `entry-isolation.test.ts:51`, `node.ts:14-77` [R].
- Fetcher (observed): per-attempt timeout 10s, maxRetries 2 (3 attempts), baseBackoff 500ms, maxRedirects 5, `RETRY_AFTER_CAP_MS=30000` (above → RetryAfterCapError, not sleep); retries GET/HEAD only on 429/5xx (transport errors retryable); delay = Retry-After when present else full-jitter `rng()*base*2^attempt`; exhausted → RetryExhausted; UA fixed unsuppressible `lumen/... (+https://github.com/nitishagar/lumen)`; cross-origin redirect strips to allowlist (accept, accept-language, content-language, content-type, range) dropping auth/keys; hop cap 5 with seen-set loop → RedirectError; 301/302/303 downgrade to GET dropping body — `packages/core/src/fetcher.ts:54-244` [V] (lines 50-179 read directly; remainder via excerpt).
- SSRF: scheme whitelist http/https only; v4 blocks 0/8,10/8,127/8,169.254/16,172.16/12,192.168/16 + v6 ::,::1,fc00::/7,fe80::/10,mapped; `localhost/*.localhost`+literals blocked; plain DNS goes to resolver with per-hop revalidation incl. redirects; resolution failure → refuse (conservative) — `packages/core/src/ssrf.ts:20-108`, `fetcher.ts:88-105` [R].
- Robots: fetched via same Fetcher as `GET /robots.txt`; 429/5xx/network-throw → disallow-all; 4xx/unparseable → allow-all; crawl-delay honored; sitemaps resolved vs robots URL (invalid dropped); IDN punycoded via WHATWG URL — `packages/core/src/robots.ts:50-76`, `url-guard.ts:6` [R].
- Redaction/telemetry: secret query params (`key,token,apikey,api_key,api-key,access_token`) redacted; invalid URL → `[invalid-url]`; 5 MCP tools never call global fetch in no-telemetry test; CLI sentinel BYOK values never appear in output — `providers/src/redact.ts:5-8`, `mcp/src/no-telemetry.test.ts:18`, `cli/src/no-telemetry.test.ts:111` [R]. Prior red-team round 1 (credential leaks, budget enforcement, gate activation) landed in PR #21 per CHANGELOG [R].
- Packaging quirk (v0.2.1): registry artifacts ship compiled `dist/` JS + `.d.ts` (plain node, no flags) because Node ≥22.18 refuses type-stripped `.ts` under `node_modules`; TS sources remain repo truth; publish compiles per workspace and repoints exports runner-local — `README.md:53`, `docs/release.md:63-69`, `CHANGELOG.md:11-23` [V].

### Seam E — Site / docs / evals / CI / release

- Docs site (Astro): pages quickstart, cli-reference (7 commands/4 flags/exit codes), rules-reference (18 rules/severities/scoring), providers-byok (7 providers/5 boundaries/BYOK semantics/etiquette), configuration (budgets/thresholds/plugins/error behavior), mcp-onboarding (Claude/Cursor/VS Code/remote gateway/local-only audit), attributions (Apache-2.0, CrUX CC BY 4.0, Tranco citation, OPR factual, Wikimedia UA, pi.dev design note, trademarks) — `site/src/pages/docs/*.astro`, `site/src/pages/index.astro` [V] (read).
- Locked contract: `site/src/data/locked-names.json` pins product/tagline/urls, cliBin, 7 cliCommands, 4 cliFlags, 3 exitCodes, 5 mcpTools, 3 envVars, configFile+6 configKeys, historyDir `.lumen`, 7 providers, 4 restRoutes, snippets — file read fully (69 lines) [V]. Gates: G7 locked-names (byte-exact snippets + tool sweep), G9 attribution presence, G6 internal-links vs built dist (externals never fetched), meta/a11y/artifact gates — `site/tests/*.test.ts` [R].
- Evals: framework evalite 0.19.0 pinned, in-process offline testkit fixtures, zero network by construction (provable via `unshare -rn`); gate `evalite run --threshold 100` (any score <1 fails); cases include tool-list snapshot, input-schema snapshot (order-insensitive canonical()), output-shape/provenance, golden dataset, latency budget (authority <1000ms), strict-args rejection, url-guard private-block — `docs/evals.md:3-45`, `packages/mcp/src/evals/tool-contract.eval.ts`, `snapshots/tool-list.snapshot.json`, `package.json test:evals` [R]. Live judge case `judge.live.eval.ts` is committed SKIPPED (`evalite.skip('judge-quality')`), scorer body `() => 0`, enable is deliberate 2-step (implement scorer with pinned judge model + temp 0 + fixed rubric + verdict cache, flip to `evalite`, run with `EVAL_LIVE=1 OPENAI_API_KEY=<key>`) — file read fully (40 lines) [V].
- CI/release: `ci.yml` five checks (identity/license, workflow-lint, lint, typecheck, test; scope ALL on main/PR else select-workspaces; builds worker+site before test); `evals.yml` runs offline gate on push+PR; `release.yml` tag-driven (`v*`) full `validate` (typecheck+lint+worker build+site build+tests+CLI smoke) then topological publish core→audit→providers→mcp→cli (manifest rewrites runner-local); `deploy-worker.yml` wrangler deploy on mcp path change; identity gate bans AI co-author trailers; `cli-smoke.mjs` zero-network asserts — `.github/workflows/*`, `scripts/ci/*`, root `package.json validate` [R]. Test health observed directly: `npm test` → 79 files / 880 tests passed (~38s) [V].
- Open backlog at fetch time: 8 open Dependabot bumps (esbuild, typescript-eslint, @types/node, workers-types, wrangler, upload-pages-artifact, deploy-pages, configure-pages) — `gh pr list` [R]. No open issues/PRs beyond bots at fetch time [R].

### Feature inventory: shipped vs missing (observed gaps, facts only)

Shipped (aim element → evidence):

- Local bounded polite audit + 18 rules + scoring + CI exit codes — rule-set [V], budgets [V], gate [V], e2e/crawler tests [R].
- Page/CWV reports (PSI lab + CrUX field + local meta) with BYOK — providers pagespeed/crux [R], CLI `report` [R], MCP `lumen_page_report` [R].
- Keyword ideas (suggest + wikipedia demand-proxy, labeled, no volumes) — providers builtins [V], CLI `keywords` [R], MCP tool [R].
- Rank checks (ddg best-effort + local JSONL history) — ddg provider [R], `rank` cmd + jsonl-store [V], MCP tool [R].
- Authority (OPR + Tranco labeled signals) — providers [V], CLI `authority` [R], MCP tool [R].
- MCP-first (5 tools, stdio primary, concise/detailed, strict-args, URL guard, local-only typing) + thin Worker gateway (REST subset + POST /mcp) — schemas/server [V], worker [V].
- Free-only/BYOK/provenance/no-fabrication (not-configured instead of keyless calls; missing reported, never zero-filled; gray labels; CrUX/Tranco/Wikimedia attributions) — providers/config/provenance/site [V/R].
- Docs site + evalite offline gate + CI/release/packaging hardening (v0.2.1 dist fix) — site/evals/CI/CHANGELOG [V/R].

Missing (observed absence vs aim or vs a complete surface in this scope; no design implied):

- Live judge quality gate: scorer is `() => 0` and skipped; no pinned judge, no rubric enforcement, no verdict cache on (input,output,rubric) — `packages/mcp/src/evals/judge.live.eval.ts:15-40` [V].
- Remote-gateway scope gaps (by construction, stated in code): audit + rank local-only remotely; tranco unselected on Worker (CPU ceiling); ddg-serp absent Worker-side (cheerio); PSI default-OFF unless `WORKER_ENABLE_PSI==='true'`; authority remote is OPR-only (no tranco leg); REST exposes only page-report + keyword-ideas + healthz — `worker/providers.ts:11-95`, `worker/index.ts:31-56`, `providers/worker.ts:22-23` [V].
- History scope: rank-only; no audit/report/keyword/authority history; single-generation rotation (older than `.1` discarded); all-domains list is a directory fan-out sorted in memory — `jsonl-store.ts:22-144` [V].
- Plugin scope: local rule files Node-only, never load in Worker — `configuration.astro:98` [V] (docs) + core config `plugins: string[]` [R].
- Rule coverage stops at 18 (observed list in rule-set [V]); absent from the 18 (observed by enumeration): sitemap.xml generation/validation beyond discovery, robots.txt generation, hreflang, duplicate-content/canonical-conflict detection beyond presence check, structured-data/schema checks, broken-external-link checks, OG/Twitter image fetch validation, accessibility beyond alt+lang+viewport, performance beyond single latency threshold + PSI/CrUX legs.
- Lifecycle/ops scope: no scheduler/monitor/diff/alerting; no dashboard; no export formats beyond JSON/human + `--out` report JSON (no CSV/SARIF observed); history has no prune/retention beyond rotation; config has no environment profiles observed.
- Gateway posture: authless + permissive CORS (observed `allowedOriginHostnames:'*'` via sub-agent excerpt [R]); BYOK per-request headers never logged (observed [R]); GCRA bound holds per-isolate not globally — multi-colo needs shared pacer, accepted out of scope in code comment — `worker/providers.ts:57-60` [V].
- Red-team swarm verification harness: absent as a harness. Observed: round-1 hardening (PR #21, CHANGELOG [R]), no-telemetry tests [R], source gates (no-direct-fetch) [R], evalite offline contract [R], bundle/concurrency/capability tests [R]. No swarm runner, no adversary-plan corpus, no chaos/fault-injection seam, no scoreboard/threshold gate for adversarial findings observed in repo enumeration.
- Maintenance backlog: 8 open Dependabot bumps observed at fetch time [R].

## Implicit Spec — invariants any change here must uphold

> Requirements, not designs.

- **Exit gate equality + off.** `failThreshold` equality counts (`meetsThreshold`: rank ≥ threshold; `off` never gates); audit `incomplete` alone fails the gate (exit 1) even with zero counted issues — `packages/core/src/gate.ts:18-29`, `packages/cli/src/cmd/audit.ts:46` [R]. Edge: threshold `off` must still emit findings, only the exit changes.
- **Unknown names fail loudly with the valid list.** Unknown config top-level/crawl/provider-boundary keys, unknown provider names per boundary, unknown rule ids in `severityOverrides` → ConfigError listing valid options — never silent default or stack trace — `packages/core/src/config.ts:139-226`, `registry.ts:50-109`, `rule-set.ts:70-83` [R]. Edge: adding a provider/rule/boundary must extend every list + locked-names + snapshots or the gates disagree.
- **Budgets clamp, never error (maxPages).** `maxPages` > 10000 clamps to 10000 through both loader and programmatic path; `max-pages` CLI flag outside 1..10000 is a UsageError (exit 2) while config over-ceiling is not an error — `packages/core/src/config.ts:234`, `packages/audit/src/config.ts:41`, `packages/cli/src/cmd/audit.ts:30` [R]. Edge: planner must not unify these into one behavior.
- **BYOK names-not-values, resolved at call time.** Config/stores carry env-var names; values are read at call time, never persisted/logged/printed (`config show` shows set/unset only; sentinel values never in output); empty/whitespace = absent; secret-like literal keys rejected — `providers/src/config.ts:25-57`, `cli-config/config-show`, `no-telemetry.test` [R]. Edge: retry/redaction paths must not interpolate values into messages.
- **No key, no call.** BYOK provider without its key answers explicit not-configured/unavailable and is never called keyless (PSI automated, CrUX always, OPR always); unconfigured providers never fail the whole report — `pagespeed.ts:70`, `crux.ts:65`, `authority.ts:21` [R]. Edge: Worker default has no PSI section at all — absence and explicit disable share the same unavailability shape.
- **Concurrency/politeness floor.** Defaults maxConcurrency 5 global + perHostMinDelayMs 250 + maxPages 100 + maxDepth 5 + maxDuration 300s; crawl-delay from robots honored; identifying UA unsuppressible; per-host rate limiting enforced by the engine (core owns types, audit enforces) — `budgets.ts:15-23` [V], `fetcher.ts:133`, `robots.ts:76` [R]. Edge: concurrent callers race on politeness state; cancellation must abort without history writes (observed: cancelled audit → zero history writes in concurrency test [R]).
- **Retry discipline.** GET/HEAD only; 429 + 5xx only (`isRetryableStatus`); full-jitter `rng()*base*2^attempt`; Retry-After honored but capped at 30s (above → RetryAfterCapError, never a long sleep); pre-aborted → AbortedError with zero calls; mid-flight abort → no retry; exhaustion → RetryExhausted with attempts/status/cause — `fetcher.ts:54-209` [V/R]. Edge: `maxRetries=0` must surface first-attempt outcome, not synthesize success.
- **SSRF revalidated per hop.** Scheme whitelist + host blocklist + (when wired) DNS-resolve IP check run on the seed URL AND every redirect hop; DNS failure → refuse; cross-origin redirect strips to safe-header allowlist; hop cap 5 + seen-set loop detection; redirect-to-non-http(s) → RedirectError(scheme) — `fetcher.ts:88-105,217-247`, `ssrf.ts` [R]. Edge: TOCTOU between check and connect is accepted at this layer (resolver seam), not solved here.
- **Robots conservative asymmetry.** robots fetch 429/5xx/network-error → disallow-all; 4xx/unparseable → allow-all; malformed robots.txt → conservative default; IDN normalized to punycode before policy — `robots.ts:50-76`, `url-guard` [R]. Edge: an attacker-controlled robots body must not widen access (parse failure closes, fetch failure closes, only explicit allow opens).
- **Crawl-evidence honesty.** Crawl rules fire only on targets actually fetched during the crawl; never-fetched targets are unknown, not invented; unfetched-link absence is not a pass — `rules-reference.astro:116-122` [V] (docs contract; engine crawl-rule tests [R]).
- **Partial-failure taxonomy.** Provider/leg failures are typed with provider name (RateLimited/Upstream/Blocked/Parse/NotConfigured/unavailable+reason); CrUX 404 caches honest null; wiki no-match is `[]`; missing data is reported missing, never zero-filled; interrupted audits are `incomplete:true` + stopReason and remain re-runnable without duplicated side effects — providers + `report`/CLI legs [R]. Edge: `detailed` may add `unavailable[]`/attribution/limitations that `concise` omits — parity is semantic, not byte.
- **Boundary inputs have defined behavior.** Non-http(s) rejected; oversized pages/sitemaps capped and skipped with reason (page-meta 2 MiB; Worker cap 2.5 MiB); `seed/keyword/q ≤ 120`, `domain ≤ 253`, `limit 1..50`, `strategy ∈ mobile|desktop`, `lang` regex, `maxPages 1..10000` (MCP has no default — core budget applies when omitted); unknown MCP args rejected listing allowed keys on both zod-wire and handler layers — `schemas.ts:21-66` [V], `worker/rest`, `strict-args` [R]. Edge: concise/detailed must not change admission — only shape.
- **History durability without loss-or-duplication.** Append serialized in-process; one O_APPEND write per entry (cross-process safe); rotation renames to `.1` (overwriting prior `.1`) before the exceeding append; reads tolerate truncated final line; single-domain reads rotated-then-current; all-domains merges + sorts by retrievedAt — `jsonl-store.ts:60-144` [V]. Edge: two processes rotating concurrently may drop one `.1` generation (single-generation design); readers must accept that.
- **Transport separation.** CLI/MCP stdio: stdout is protocol-only (every line JSON-RPC; ready banner goes to stderr); `--print` onboarding never starts serving; abort destroys stdin → exit 2 — `cmd/mcp.ts:49`, `stdio-roundtrip.test.ts:43` [R]. Worker: never fetches/parses the target URL for page-report; REST GET-only; per-request composition; nothing logged (no telemetry); keys ride headers-at-call-time — `worker/*.ts` [V/R]. Edge: adding a Worker route that fetches arbitrary URLs violates the thin-gateway invariant.
- **Worker-safe import graph.** `core/index` graph has no `node:` and never reaches `core/node`; providers `/worker` graph never reaches cheerio; MCP bundle ≤1.5 MiB gzip self-cap — `entry-isolation.test`, `worker.ts:2-7`, `bundle-scan` [R]. Edge: a Node-only import in a shared module silently breaks the Worker build, not just tests.
- **Provenance + attribution preservation.** Every external value carries `{provider, kind, retrievedAt}`; gray/heuristic/best-effort/proxy labels travel with the value; CrUX CC BY 4.0 sentence + Tranco citation + Wikimedia UA/contact survive any new surface or format — `provenance.ts`, `attributions.astro` [R/V]. Edge: a new export format (CSV/SARIF/future) must carry or reference provenance, not drop it.
- **Bounding assumptions**: single-machine CLI is the primary path (no distributed crawl coordination); free-tier quotas are the ceiling (no paid-index behavior); `main` aim scope is SEO-audit/keywords/rank/CWV surface only (no backlink/volume/clickstream fabrication — refusal is correct behavior); Node ≥22.7; Worker free-tier CPU shapes the remote subset (tranco/PSI/ddg exclusions are consequences, not regressions).

## Workload & Scale Envelope

> Numbers the planner will compute a cost model from. Facts only — no design.

- **Hot operations**: site crawl/audit is the heaviest path (bounded pages × per-page fetch + 16 page-rules + 2 crawl-rules over fetched evidence); page-report fans out to 3 legs (PSI lab + CrUX field + local meta); keyword-ideas fans out to 1–2 keyword providers (suggest + wiki) with round-robin interleave; rank-check is 1 SERP fetch + 1 history append; authority fans out to OPR + Tranco legs (local Tranco lookup after cached CSV). Relative frequency/weight: unobserved in code — no counters/RPS/latency-SLO constants found in the seams searched [R/assumption — treat as estimated, not measured].
- **Data categories**: crawl budgets cap pages (default 100, ceiling 10000), depth 5, duration 300s, concurrency 5, per-host delay 250ms — `budgets.ts:15-23` [V]. Fetch caps: page-meta 2 MiB (oversize→null) [R]; Worker capping-fetcher 2.5 MiB [R]; Tranco CSV walk maxRows 100k with 7d refresh / 14d stale ceiling [R]; history 1 MiB per-domain-file single rotation [V]; report concise trims (audit topIssues 10; rank recentHistory 10 in detailed) [R]. Entry/row/payload sizes, cardinality, fan-out, and distribution shape (uniform/heavy-tailed/medium): unobserved in code — no page-byte histograms, sitemap fan-out counts, SERP result-size distributions, or provider payload-size stats found [assumption — planner must measure or state estimates explicitly].
- **Envelope**: current scale = single-user local CLI + stdio agent + optional single-Worker gateway; no multi-tenant/RPS/partition targets in code [R]. Rate limits (per-60s documented): wikipedia 200, pagespeed 240, crux 150, opr 60; enforced GCRA worst-case (rpm+burst): suggest 35, wiki 70, psi-keyed 70 / keyless 7, crux 150, opr 60, ddg 7, tranco ~2 per refresh window — `builtins.ts:39-55` [V]. Fetcher: 10s/attempt, 2 retries, 500ms base full-jitter, 5 redirect hops, 30s Retry-After cap — `fetcher.ts:54-60` [V]. Latency SLOs: only observed budget is eval `lumen_authority <1000ms` [R]; crawl/audit/report SLOs: none observed [assumption]. Targets for plan/implement phases: not stated in repo — planner must elicit or declare (users, RPS, max-pages distribution, Worker isolates/regions, history retention).

## Hard Cores

> Factual inventory for the planner's decomposition gate — count and name only; no sequencing, scoping, or design.

- Hard core 1 — budgeted concurrent polite crawl under partial failure (budgets/concurrency/robots/rate-limit/cancellation/incomplete-report honesty).
- Hard core 2 — seven-source provider contract: BYOK secrets handling + provenance/kind labeling + GCRA pacing vs documented caps + gray-endpoint brittleness (suggest/ddg) + honest unavailability (four facets of one contract, listed explicitly per audit).
- Hard core 3 — three-surface parity with local-only split + guards (CLI↔MCP schema/failThreshold/maxPages parity; stdio protocol purity; Worker thin-subset LOCAL_ONLY typing; SSRF/strict-args/URL-guard).
- Hard core 4 — locked-contract gates (site locked-names + evalite snapshots/golden/latency + CI identity/license/scoped-tests + tag-driven topological publish + dist/entry-isolation/bundle caps; four facets, listed explicitly per audit).
- Process hard core 5 — red-team swarm verification harness definition for plan/implement phases (adversary corpus + fault injection + scoreboard/threshold gate), absent today; the user requires plan + implement to focus verification through it.

## Evidence Ledger

| Claim | Evidence | Trust | Load-bearing |
|---|---|---|---|
| Aim tagline free-only BYOK provenance | `README.md:8` | V | yes |
| v0.2.x shipped: CLI + 5 MCP tools + docs | `README.md:10` | V | yes |
| Ships vs refuses (no volume/backlink/clickstream fabrication) | `site/src/pages/index.astro:57-68` | V | yes |
| 18 built-ins, 16 page + 2 crawl, ids/severities | `packages/audit/src/rules/rule-set.ts:28-46` | V | yes |
| Plugin severity normalization + registry validation | `packages/audit/src/rules/rule-set.ts:70-113` | V | no |
| Scoring weights + mean + incomplete shape | `site/src/pages/docs/rules-reference.astro:82-98,132-138` | V | no |
| 7 provider names | `packages/providers/src/builtins.ts:10-18` | V | yes |
| 5-boundary capability map | `packages/providers/src/builtins.ts:23-31` | V | yes |
| Documented limits (wiki200/psi240/crux150/opr60) | `packages/providers/src/builtins.ts:39-44` | V | yes |
| GCRA defaults incl wiki 60+10 | `packages/providers/src/builtins.ts:47-55` | V | yes |
| Cache TTLs + tranco windows | provider `*.ts` TTL consts + `tranco.ts:24-26` | R | no |
| BYOK names-not-values + secret-like rejection + name regex | `packages/providers/src/config.ts:25-57` | R | yes |
| PSI header-key, OPR Bearer, automated-key gates, CrUX404-null, wiki-empty, ddg single-fallback | provider `pagespeed/crux/openpagerank/ddg-serp/wikipedia-demand.ts` | R | no |
| Provenance labels + CrUX sentence | `packages/providers/src/provenance.ts:7-20` | R | yes |
| Worker-safe excludes ddg (cheerio) | `packages/providers/src/worker.ts:22-23` | V | yes |
| Worker unselects tranco; PSI strict opt-in default OFF | `packages/mcp/worker/providers.ts:11-17,57-71` | V | yes |
| Worker routes healthz/page-report/keyword-ideas/POST-mcp | `packages/mcp/worker/index.ts:31-56` | V | yes |
| audit+rank LOCAL_ONLY remotely | `packages/mcp/worker/providers.ts:81-95` | V | yes |
| 5 MCP TOOL_NAMES | `packages/mcp/src/schemas.ts:12-18` | V | yes |
| Schemas strict + bounds/defaults | `packages/mcp/src/schemas.ts:21-66` | V | yes |
| Exit codes 0/1/2 | `packages/core/src/gate.ts:11` | V | yes |
| Crawl budget defaults + 10k ceiling | `packages/core/src/budgets.ts:15-23` | V | yes |
| Fetcher timeout/retries/backoff/hops/cap | `packages/core/src/fetcher.ts:54-67` | V | yes |
| Retry GET/HEAD-only + jitter formula | `packages/core/src/fetcher.ts:170-209` | V | no |
| SSRF per-hop + DNS + blocklists | `packages/core/src/fetcher.ts:88-105`, `ssrf.ts` | R | yes |
| Robots 429/5xx-close, 4xx/unparseable-open | `packages/core/src/robots.ts:50-76` | R | yes |
| History path/rotation/queue/crash-safe/list semantics | `packages/cli/src/history/jsonl-store.ts:22-144` | V | yes |
| History root resolution | `packages/cli/src/cli-config.ts:25` | V | no |
| CLI 7 commands + strict parse + help | `packages/cli/src/args.ts:13-122`, `run.ts:66-79` | R | no |
| Audit gate incomplete-fails + atomic out | `packages/cli/src/cmd/audit.ts:30-50` | R | no |
| Report/keywords/rank/authority/mcp/config-show behaviors | `packages/cli/src/cmd/*.ts` | R | no |
| Composition wiring + meta 2 MiB cap | `packages/cli/src/composition/*.ts` | R | no |
| MCP guards + concise/detailed shapes | `packages/mcp/src/server.ts:53-101,184-406` | R | no |
| LOCAL_ONLY payload shape | `packages/mcp/src/local-only.ts:17` | R | no |
| Config keys/validation/clamping | `packages/core/src/config.ts` + `config.test.ts` | R | no |
| Entry isolation (no node:/cheerio in worker graphs) | `core/src/index/node/entry-isolation.test`, `providers/worker.ts:2-7` | R | yes |
| Redaction + no-telemetry + sanitize | `providers/redact.ts`, `no-telemetry.test`, `report/sanitize.ts` | R | no |
| v0.2.1 dist packaging quirk | `CHANGELOG.md:11-23`, `docs/release.md:63-69` | V | no |
| Locked contract file | `site/src/data/locked-names.json:1-69` | V | yes |
| Docs pages per area | `site/src/pages/docs/*.astro` | V | no |
| Evalite pinned offline gate threshold 100 | `docs/evals.md:3-19`, `mcp/package.json` | R | yes |
| Judge.live skipped stub scorer ()=>0 | `packages/mcp/src/evals/judge.live.eval.ts:15-40` | V | yes |
| CI checks + scoped tests + worker/site build first | `.github/workflows/ci.yml:26-92` | R | no |
| Tag-driven topological publish order | `docs/release.md:34-35`, `release.yml` | R | no |
| Tests green 79 files / 880 tests | direct `npm test` run | V | no |
| 8 open Dependabot PRs, no other opens | `gh pr/issue list` at research time | R | no |
| Crawler/testkit/composition file inventory | locator returns | R | no |
| Relative op frequency + distributions unobserved | no counters found in searched seams | R | no |

## Architecture Insights

> Descriptive patterns/constraints — not prescriptive.

- One engine, three doors: CLI (human), stdio MCP (agent, primary), thin Worker gateway (remote subset that refuses to pretend — audit/rank answer typed local-only). Surfaces share schemas, failThreshold vocabulary, and provenance rules.
- Everything external enters through the provider interface (5 boundaries, 7 built-ins); the only `fetch` is the Fetcher default delegate, and prod provider sources are gated to zero direct `fetch(`.
- Core owns types/defaults/spis; enforcement lives at the edges (audit enforces budgets; CLI/MCP enforce admission; Worker enforces thinness via absent deps rather than flags).
- Honesty is load-bearing: not-configured, unavailable+reason, unknown-not-invented, incomplete:true, and refusal-to-fabricate (volume/backlink/clickstream) are all first-class outputs, not error paths.
- Contracts are locked in three places that must move together: `locked-names.json` (site), evalite snapshots (tool list + schemas), CI/publish gates (identity, scoped tests, topological release, dist/entry-isolation/bundle caps).

## Historical Context (from thoughts/)

No `thoughts/` history exists in this repo (checked `~/repos/learn/lumen/thoughts` — absent; nearest `thoughts/` dirs are sibling repos). Prior decisions were reconstructed from live code + `docs/evals/*` + CHANGELOG + PR titles: product renamed to lumen with `@lumen-seo` scope; core/providers/audit/site/surfaces built as staged PRs; red-team round 1 + integration hardening before v0.1.0; v0.2.0 launch prep (packaging/docs/community); v0.2.1 compiled-`dist/` fix after Node ≥22.18 refused TS under node_modules; evalite adopted (11-case offline gate) after promptfoo trial with measured totals corrected in docs. Each still matches current code where sampled (rule/provider/tool counts, dist model, evalite pin).

## Coverage & Open Questions

- Searched: README/CHANGELOG/site docs/locked-names (fully, main context); rule-set/schemas/budgets/gate/builtins/worker/providers/jsonl-store/judge.live/fetcher-50-179 (fully, main context); 5 parallel discovery sweeps (audit locate, providers+fetcher analyze, CLI+MCP+worker analyze, core+security analyze, site+evals+CI pattern-find) with 30/60-line return contracts; direct `npm test` (green 880/79); `gh pr/issue` open-state fetch; GitHub repo page fetch (chrome-heavy, About corroborated locally).
- Deliberately bounded: 1 advisor checkpoint (12-line cap) + 1 audit round (14 gaps, all addressed or recorded); non-load-bearing `[R]` claims left sampled, not fully upgraded (audit sampled 8 `[R]` + 3 `[V]`; 2 refuted-as-incomplete — GCRA omission, Worker split — both fixed to `[V]` above); crawler-loop/frontier/rate-limiter/sitemap/assemble/score bodies read only via locator/test excerpts, not line-verified.
- Residual risks / open questions (flagged, not guessed): (1) crawler throughput/bytes-per-page/sitemap fan-out/redirect amplification have no in-code numbers — planner must measure or declare estimates; (2) provider payload-size distributions + live quota consumption unobserved offline; (3) Worker multi-isolate GCRA needs shared pacer (code comment accepts out-of-scope); (4) two-process history rotation may drop one `.1` generation by design; (5) TOCTOU between SSRF check and connect is accepted at resolver seam; (6) evalite golden/latency coverage beyond authority<1000ms unexamined; (7) sibling `~/repos/learn` projects (docmatch, voltbase, sober-ai, nklient) untouched — cross-repo reuse not assessed; (8) code moves fast on `evals/evalite` branch — re-run follow-up research if the tree moves materially before planning.
