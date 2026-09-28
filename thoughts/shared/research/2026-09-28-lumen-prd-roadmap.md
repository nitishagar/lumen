---
date: 2026-09-28T12:45:00+05:30
researcher: ZCode (GLM-5.3-Flash) for Nitish Agarwal
git_commit: 3ae6113
branch: main
repository: nitishagar/lumen
topic: "Implement every epic in thoughts/shared/specs/2026-09-28-lumen-next-features-prd.md (v0.3 → v0.6) in ~/repos/learn/lumen, via the v2.7 research→plan→implement loop, with a state ledger; ask for credentials/free accounts when an external step needs them."
tags: [research, codebase, audit, rules, cli, mcp, worker, providers, history, distribution, ssrf, prd-roadmap]
scale: large
status: complete
last_updated: 2026-09-28
last_updated_by: ZCode
---

# Research: lumen PRD roadmap implementation surface (v0.3 → v0.6)

## Research Question

Implement every epic in `thoughts/shared/specs/2026-09-28-lumen-next-features-prd.md` (E0.1–E0.4, E1.1–E1.7, E2.1–E2.5, §8 hygiene) against `~/repos/learn/lumen` (main @ 3ae6113), working locally and pushing to the private GitHub repo, using the v2.7 loop, tracking todos + a ledger, and asking for credentials only where an external step requires them.

## Intent
> Lifted from the user objective + PRD. A record of what was asked — not a spec.
- **Problem**: Build everything the PRD specifies (distribution/first-run/private-targets/actionable-findings/baseline/CI-outputs/MCP-prompts/rule-pack-v2/GEO/first-party-data/reports/plugins/gateway/hygiene).
- **Proposed outcome**: All epics implemented in the local copy, verified by the repo's own gates, pushed to `nitishagar/lumen` (private), with external steps (visibility flip, npm publish, registry/directory listings) identified and asked for.
- **Constraints**: Use `/research_codebase_generic_v2_7`, `/create_plan_generic_v2_7`, `/implement_plan_v2_7` with subagents; be rate-limit-aware (sequential subagents where needed); track todos and maintain a ledger document that updates state; PRD principles P-Honest/P-BYOK/P-NoTelemetry/P-Polite/P-Thin-Worker/P-Locked-Contract are non-negotiable.
- **Open questions**: (1) npm credentials absent (`npm whoami` → E401) — needed for E0.2 publish; (2) D1 repo visibility flip is an outward-facing owner decision; (3) directory-listing accounts (Glama/Smithery) are owner-held; (4) whether to actually tag `v0.3.0` after code-side work or leave tagging to the owner; (5) GSC/Bing keys are owner BYOK — not needed for development.

## Summary

The codebase is ready for every PRD epic in the sense that all extension points exist and are well-defined, but **none of the features exist yet**: no `allowPrivate` anywhere in packages (grep zero hits), no `helpUrl` anywhere, no fingerprint, no SARIF/markdown formatters, no `server.json`/`.mcpb`/plugin files, no prompts/resources registered, no new `site` rule kind, no `history`/`diff`/`init`/`doctor` commands, no cron workflow, no link-checker. The MCP SDK installed (1.30.0) supports `registerPrompt`/`registerResource` natively. Key structural facts: `Issue` already carries `fixHint?`/`url?` (`packages/core/src/page.ts:32-40`) but has no `helpUrl`; concise-audit `topIssues` is a raw `slice(0,10)` with exact-key assertions in `output-shapes.test.ts:20` (the declared breaking change target); robots/sitemap evidence is discarded after discovery (`run.ts:44-70`) so a `site` rule kind needs new evidence plumbing; `validatePublicHttpUrl` lives in `@lumen-seo/mcp/url-guard` and is the single choke point for private-target refusal; provider boundaries are a closed 5-value union that must grow for GSC/Bing; the release pipeline rewrites `0.0.0` source versions runner-local; site gates are byte-exact on locked-names snippets and a tool-name sweep, and docs hardcode "20 rules" in prose (not gated). Scale: large.

## Detailed Findings

### Seam 1 — Audit engine, rules, report (serves E1.2, E1.3, E1.6, E1.7, E2.4)

- Rule SPI: `AuditRule { id, severity, categories, check(page: PageContext, o): Promise<Issue[]>|Issue[] }` — `packages/core/src/rules.ts:13-18` [V]; `looksLikeAuditRule` validates id/severity/categories/check `rules.ts:21-31` [V].
- `Issue { ruleId, severity, message, evidence: IssueEvidence, fixHint?: string, url?: string }`; evidence = `{ selector?, snippet? }` — `packages/core/src/page.ts:32-40`, `:26-29` [V]. `helpUrl` does not exist anywhere (grep zero) [V].
- CrawlRule: `{ id, severity, categories, checkCrawl(index: CrawlIndex, o: RuleContext): Issue[] }`, "each issue MUST carry `url`" — `packages/audit/src/types.ts:86-92` [V].
- `kind` exists only on `BuiltinSpec` (`'page' | 'crawl'`), not on the SPI — `packages/audit/src/rules/rule-set.ts:19-25` [V].
- Full 20-rule table with severities/categories/kinds — `rule-set.ts:28-49` [V]. Registry validates overrides (unknown id → ConfigError listing valid ids) `rule-set.ts:72-85`; plugin severity normalization `rule-set.ts:97-111` [V].
- `fixHint` appears 19 times across 18 rules (canonical-present twice: `meta.ts:110,123`); `status-error` and `robots-noindex` are the rules **without** one (auditor-verified) [V]. E1.2 FR-4's 20/20 gate is a real gap [V].
- Page rules run per fetched page via `runRules(pageContext, ruleCtx)`; issues >`EVIDENCE_CAP` collapse into an overflow issue; rule throw → `ruleErrors[rule.id]++` — `packages/audit/src/run.ts:144-166` [V].
- Crawl rules run ONCE post-crawl: `applyCrawlRuleIssues(pages, index, crawlRules, ...)`; issues grouped by `issue.url`; **issues without `url` are silently dropped** — `run.ts:128-153` [V].
- CrawlIndex exposes `outLinks`, `pages`, `statusOf`, `bodyHashOf` (normalized-URL keyed, fetched pages only) — `crawler.ts:307-332` [V]. Pattern to mirror: `links.ts:14-55` (broken-internal-link: "never fetched → never judged"), `links.ts:93-124` (duplicate-content), `meta.ts:168-184` (hreflang-present) [V].
- **Robots/sitemap evidence is discarded**: `policy` is a local in `run.ts:44-62`; `discoverSitemaps` returns `URL[]` only (`run.ts:67-74`); `CrawlResult`/report carry neither — a `site` rule kind cannot see robots.txt/sitemap bodies today [V].
- Report shape: `{ id, startedAt, completedAt, pages[], summary { countsBySeverity, score, pagesAudited, pagesSkipped, byRule: Record<string,number>, ruleErrors? }, incomplete, configSnapshot { seed, crawl, respectRobots, renderer:'static', thresholds, maxBodyBytes, rules, discoveryWarnings }, stopReason }` — `assemble.ts:52-77` [V].
- `sanitizeIssue` explicit allowlist `{ruleId, severity, message, evidence{selector?,snippet?}, url?, fixHint?}` — `sanitize.ts:24-34` [V]; `sanitizeText` strips control chars, 300-code-point cap `:11-14` [V].
- Scoring: `WEIGHT = {error:10, warning:3, info:0}`; page `max(0, 100−Σ)`; site = rounded mean, 0 when none — `score.ts:9-19` [V].
- Testing kit: `FakeRoute`/`FakeFetcher` (unknown URL → 404), `makeTestDeps` step-clock, `makePage(html)` cheerio loader — `audit/src/testing/{fake-fetcher,deps,page}.ts` [V]; fixture-site pattern with ROBOTS/SITEMAP routes `e2e.test.ts:10-31` [V].
- `packages/audit/package.json` exports only `"."` — `./testing` NOT exported (`package.json:11-13`) [V] (E2.4 gap).
- Rules per kind: 17 page + 3 crawl after PR #37 (auditor correction of the prior "~16 page") [V].
- `categories` are opaque end-to-end (no filtering/scoring/docs consumer); adding `ai-search` breaks nothing; **no `--only` filter exists** [V].
- MCP concise audit today: `topIssues: issues.slice(0,10).map(...)` with `{ruleId, severity, message, url?}` — `mcp/src/server.ts:419-424` [V]; CLI human summary also slices 10 unsorted — `cli/src/cmd/audit.ts:85-89` [V]. No fingerprint concept anywhere [V].

### Seam 2 — Core network: fetcher, SSRF, robots, sitemap, crawler (serves E1.1, E1.6, E1.7, E0.1)

- SSRF IPv4 blocklist verbatim (0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16) `ssrf.ts:25-32`; v6 `::`, `::1`, `fc00::/7`, `fe80::/10` + mapped re-check `:81-92`; `isBlockedHost`: `localhost`/`*.localhost` + literals `:108-116`; plain DNS names deferred to resolver seam `:115`; TOCTOU documented out of scope v1 `:14-16` [V].
- **No allowlist/opt-in hook exists** (grep `allowPrivate|allow-private` → zero) [V].
- `validatePublicHttpUrl` lives in **`packages/mcp/src/url-guard.ts:14`** (not core), composing core `isAllowedScheme`+`isBlockedHost`; refusal message verbatim `refusing non-public target "…" (private, loopback, link-local, and ULA ranges are blocked)` `:27-31` [V]. Callers: `cli/src/cmd/audit.ts:25`, `cli/src/cmd/report.ts:30`, `mcp/src/server.ts:104,131`, `mcp/worker/rest.ts:63` [V]. audit converts to UsageError → exit 2 [V].
- Fetcher: `assertHopAllowed` per hop — scheme → RedirectError/UnsupportedScheme; `isBlockedHost` → `SsrfBlockedError`; DNS-resolve (when wired) → block-check on every resolved IP, resolution failure → refuse — `fetcher.ts:89-105` [V]. UA fixed unsuppressible `lumen/${UA_VERSION} (+https://github.com/nitishagar/lumen)` `:134`, `ua.ts:11` [V]. Cross-origin redirect strips to 5 safe headers `:217-225,264` [V]. Hop cap 5 + seen-set loop `:232-249`; 301/302/303 → GET [V]. Retries GET/HEAD on 429/5xx, Retry-After capped 30 s, full-jitter `:56-67,153-174` [V]. Intermediate hop URLs not exposed (only final `res.url`) [V]. No body cap in core (audit caps at 2 MiB via `readBodyCapped`); no pacing in core (per-host limiter is audit-side) [V].
- robots: `robots-parser` lib; parsed object RETAINS UA-specific rules but is only queried with lumen's UA (`robots.ts:76,91`) — no Disallow-matrix export today [V]. Conservative asymmetry: 429/5xx/network → disallow-all; 4xx/unparseable → allow-all `:56-73` [V]. `robotsGate` fetches once, 429 → one capped retry, 5xx → `LumenRobotsUnreachableError` `robots-policy.ts:53-106` [V].
- Sitemap discovery: cheerio xmlMode; caps `MAX_SITEMAP_SOURCES=10, MAX_SITEMAP_CHILDREN=10, MAX_SITEMAP_URLS=10_000, MAX_SITEMAP_BYTES=2_000_000`; one nesting level; cross-origin locs dropped; malformed → `onWarning('sitemap_malformed')` + link-discovery fallback; retained output = `URL[]` only — `sitemap.ts:31-96`, `audit/src/config.ts:31-40` [V]. No sampling concept [V].
- Crawler: robots-gated URLs never fetched (no budget consumed) `crawler.ts:168-172`; per-host limiter keyed `url.host`, `effectiveIntervalMs = max(minDelay, crawlDelay)` `rate-limiter.ts:29-31`; worker pool `min(maxConcurrency, maxPages)` `:302-303`; DEFAULT_BUDGETS `{100, 5, 300000, 5, 250}` `budgets.ts:16-23` [V]. Seed same-origin enqueue only; `redirectChain: [start, final]` only [V].
- `PageContext { url, status, headers: Headers, dom: CheerioAPI, bytes, timingMs, robotsAllowed }` — full response Headers available (HSTS/XCTO/CSP readable) `page.ts:15-23` [V].
- No JSON-LD (`application/ld+json`) handling anywhere; no meta-refresh (`http-equiv`) handling; no `/llms.txt` concept [V] (grep zero each).
- Worker boundary: `core/src/node.ts` is the Node-only subpath; `entry-isolation.test.ts` walks the index graph asserting no `node:` imports; `createNodeFetcher` resolves DNS via `lookup(host,{all:true})` and **`resolve` is injectable via opts** `node.ts:27-34` [V] — an allowlist-aware resolver seam exists.
- Worker outbound: `OUTBOUND_HOST_ALLOWLIST` exactly `[www.googleapis.com, chromeuxreport.googleapis.com, openpagerank.com, suggestqueries.google.com, en.wikipedia.org]`, asserted per flow in `worker.test.ts:306-332` [V] (E1.1: Worker must never accept `--allow-private`; E2.x: new provider hosts would extend this).

### Seam 3 — CLI + config + composition + history (serves E0.4, E1.2–E1.4, E2.1–E2.3)

- `COMMAND_NAMES = ['audit','report','keywords','rank','authority','mcp','config']` — `args.ts:13` [V]. Flag tables `OPTIONS: Record<CommandName, OptionSpec>` support `'string'|'boolean'` only (no arrays) `:19-21`; positionals exact-count `:143`; strict parseArgs → UsageError `:125-130` [V]. Flag-dependent-positionals pattern exists (rank `--history`) `:139-141`; `config` subcommand hardcoded `show` only `:149-151` [V].
- Help: static `USAGE_BY_COMMAND` map + ROOT_USAGE list, snapshot-tested — `help.ts:42-108,14-21` [V]. New command = map entry + ROOT_USAGE + snapshot update.
- Dispatch switch in `cli/src/run.ts:87-112`; error map: UsageError/ConfigError → 2, LumenError → 2 with provider label, unknown → truncated "internal error:" → 2 `:36-53` [V]. `process.exitCode` never `process.exit` [V].
- `cmd/audit.ts` flow: `validatePublicHttpUrl` → `--max-pages` intFlag clamp 1..10000 → threshold whitelist → `auditRunner.run` `:23-44`; gate `report.incomplete || countIssuesAtOrAbove(issues, threshold) > 0` `:46-47` [V]; `--out` written atomically BEFORE render `:49-54`; `--json` swaps render only [V]. History append after, skipped on cancel `:62-71` [V].
- Human summary sections verbatim: `audit: <url>` / `pages:…` / `score:` / `issues: E/W/I` / `failThreshold:` + top-10 issues `[severity] ruleId: message` `:75-91` [V].
- `AuditHistoryEntry { url, score, pagesAudited, incomplete, stopReason?, countsBySeverity, provider:'lumen-audit', retrievedAt }` — `core/src/history.ts:21-32` [V]. `HistoryStore` port is LOCKED `{append, list}` — no delete/prune `:40-52` [V] (E2.3 prune needs a port extension).
- JSONL store: `<root>/<kind>/<slug80>-<sha256:8>/history.jsonl`; audit kind groups by URL hostname; 1 MiB rotation single-generation `.1`; append serialized in-process promise queue; reads tolerate truncated tail; rotated-then-current reads — `cli/src/history/jsonl-store.ts:30-59,110-137,158-191` [V].
- `rank --history --kind rank|audit --format json|csv` (PR #37 pattern): `HISTORY_KINDS`/`HISTORY_FORMATS` consts, CSV headers, `csvCell` formula-neutralization `/^[=@]/ → "'"`, unknown values → UsageError listing valid options, `--json`+csv conflict → UsageError — `cmd/rank.ts:27-42,77-118` [V].
- Config: `resolveConfigPath` flag > `LUMEN_CONFIG` > `lumen.config.json` `cli-config.ts:15-16`; `resolveHistoryDir` `LUMEN_HISTORY_DIR ?? ./.lumen/history` `:24-25`; `DEFAULT_BYOK_ENV_NAMES {psi,crux,opr}` + `effectiveByok` `:28-41` [V]. `config show` payload `{configPath, failThreshold, providers, crawl, byok[{capability,envVar,set}], historyDir}`, `set = env !== undefined` — `cmd/config-show.ts:15-26` [V].
- `ResolvedConfig { providers: Partial<Record<ProviderBoundary,string>>, severityOverrides, crawl, failThreshold, byok, plugins }` — `core/src/config.ts:59-66` [V].
- `ProviderBoundary = 'keywords'|'serp'|'pagespeed'|'crux'|'authority'` — `core/src/providers.ts:8-16` [V]; provider SPI is `{name; oneMethod(opts+signal)}` deps-injected (no fetch/cache/pacer in interface) `:21-44` [V]. Registry validates names + byok → ConfigError with sorted available list `core/src/registry.ts:50-83` [V]. Adding a provider = file + `BUILTIN_PROVIDER_NAMES` + `PROVIDER_CAPABILITIES` + `DOCUMENTED_LIMITS`/`PACING_DEFAULTS` + `registry-wiring` + index export + config valid-keys + locked-names `providers[7]` + docs [V].
- `createBuiltInProviders` = `assertNoSecretValues(config)` + workerSafe + ddg with GcraPacer — `registry-wiring.ts:22-30` [V].
- no-telemetry tests: sentinel `fetch` stub that throws; CLI case array covers all 7 commands (`no-telemetry.test.ts:71-77`) + a separate BYOK-sentinel case array covering only 5 commands (`:114-119`) — `cli/src/no-telemetry.test.ts`; MCP equivalent over 5 tools `mcp/src/no-telemetry.test.ts:17-46` [V]. **New commands must be added to the command-case array (and the BYOK-sentinel array when they touch BYOK output).**
- `scripts/ci/cli-smoke.mjs` covers only help / `config show --json` / `mcp` initialize (`:22-28`) — no URL-fetching checks (the SSRF guard refuses loopback); new commands get zero smoke coverage today, and a loopback smoke audit is impossible until E1.1's flag exists [V].
- `mcp --print`: `PRINT_TARGETS = ['json','claude','cursor','vscode']` `cmd/mcp.ts:23`; payloads from `mcp/src/onboard.ts:12-31`; `LOCAL_SERVER = { command:'npx', args:['-y','@lumen-seo/cli','mcp'] }` `onboard.ts:12` [V]; `mcp-print.test.ts` asserts 8 payloads (4 targets × local/remote) [V].
- `writeFileAtomic` temp+rename with cleanup — `cli/src/write-atomic.ts:9-18` [V] (baseline writes reuse).
- CLI bin dual-lane (dist under node_modules, else ts loader) `bin/lumen.js:22-27`; contract tests spawn the real bin via `spawn.ts:10` [V].

### Seam 4 — MCP server + worker (serves E0.3, E1.2, E1.5, E2.5)

- SDK `@modelcontextprotocol/sdk ^1.30.0` (installed 1.30.0), zod 4.5.2, agents 0.22.0 — `mcp/package.json` [V].
- `buildMcpServer(deps)`: `new McpServer({name:'lumen', version:'0.0.0'})`; exactly 5 `registerTool` calls; handler wrapper order `strictArgs → deps-check (undefined → localOnly) → validatePublicHttpUrl → try/typedError` — `server.ts:88-105` [V]. JSON-in-text `ok`/`err(isError)` `:53-60` [V].
- **SDK supports prompts/resources**: `registerResource(name, uriOrTemplate, config, readCallback)` and `registerPrompt(name, {title?, description?, argsSchema?}, cb)` confirmed in installed SDK types (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:102,181`) [V]. Zero `registerPrompt|registerResource` in repo today [V].
- `McpDeps { clock, keyword[], authority[], unconfigured?, serp?, pageSpeed?, crux?, auditRunner?, pageMeta?, history? }` — `server.ts:38-51` [V]. **mcp does NOT depend on `@lumen-seo/audit`** — a static rules catalog needs a core re-export or McpDeps field [V].
- Concise audit payload keys exactly `{url, pages, score, countsBySeverity, topIssues, passesThreshold, incomplete, failThreshold}` — asserted by `output-shapes.test.ts:20` (key-set equality) and `:62-67` (`topIssues ≤10`, fields `{ruleId,severity,message}`) [V]. Detailed spreads base + `stopReason, startedAt, completedAt, pages[]` `:429-441` [V].
- Schemas: `TOOL_NAMES` 5 locked; `z.strictObject` with `RESPONSE_FORMAT`/`FAIL_THRESHOLD` atoms `schemas.ts:12-40` [V]; `schema-contract.test.ts` hard-asserts exactly five names + no-default-required + `additionalProperties:false` [V].
- Worker: per-request `buildMcpServer(mcpComposition(headers, env))`; `workerMcpDeps` has NO `serp/auditRunner/pageMeta/history` → audit+rank LOCAL_ONLY remotely `worker/providers.ts:81-95` [V]; `createMcpHandler(..., {route:'/mcp', corsOptions:false, allowedOriginHostnames:'*'})` `worker/index.ts:46` [V] (E2.5 hardening target). Static rules catalog is feasible Worker-side (read-only code) [V]. No file access remotely → history resources must map to LOCAL_ONLY [V].
- Evalite: `connectClient(deps)` via `InMemoryTransport.createLinkedPair()` + `parseToolJson` — `testkit/index.ts:152-162` [V]; `fixtureDeps()` all-capability, `fixtureRemoteDeps()` LOCAL_ONLY shape `:129-149` [V]; add-case recipe `docs/evals.md:54-55` [V]; latency-budget pattern `tool-contract.eval.ts:244-272` [V]; snapshot `evals/snapshots/tool-list.snapshot.json` [V].
- `LOCAL_ONLY_CAPABILITY` payload `{code, tool, message, cli}` — `local-only.ts:10-15` [V].
- `stdio-roundtrip.test.ts:134-143` hard-asserts `tools/list` names equality (tolerant of extra prompts/resources — reads only `result.tools`); purity: every stdout line JSON-RPC, startup note stderr `:55-67,133` [V].
- no-telemetry calls the 5 tools explicitly; unaffected by prompts/resources [V].

### Seam 5 — Verification surface, site, CI, release, distribution (serves E0.1–E0.3, H, all bundles)

- Commands (root `package.json:15-22`): `test` = `vitest run`; `typecheck` = workspaces; `lint` = `eslint .`; **`validate`** = typecheck + lint + `build:worker -w @lumen-seo/mcp` + `build -w @lumen-seo/site` + `npm test` + `node scripts/ci/cli-smoke.mjs` [V]. Per-workspace `test/typecheck/build` [V]. Single-test: `npm test -w @lumen-seo/core` documented in CONTRIBUTING.md:28; vitest `-t` name-filter standard [V]. Evalite gate: `npm run test:evals -w @lumen-seo/mcp` = `SWARM_SKIP=1 evalite run --threshold 100` (`mcp/package.json:24`) [V]. Swarm: `npm run test:swarm` = `evalite run swarm`; one adversary `SWARM_ONLY=<id> npm run test:swarm` (`docs/evals.md:78`) [V]. Site: `build` = astro + pagefind, `test` = vitest [V].
- CI workflows (no cron exists today): `ci.yml` (identity+license gate, actionlint, lint, typecheck, scoped test via `select-workspaces.mjs`, builds worker+site first) [V]; `pages.yml` push-main+dispatch → `deploy-pages@v5` [V]; `release.yml` tag `v*` → full validate → `gh release create` → `publish-workspaces.mjs` guarded on `NODE_AUTH_TOKEN` [V]; `deploy-worker.yml` path-filtered, guarded on `CLOUDFLARE_API_TOKEN` [V]; `evals.yml` push/PR: evals job (gating) + swarm job `continue-on-error: true` + scoreboard artifact [V].
- Publish mechanics: `rewriteManifest` runner-local — tags version, pins internal deps, clears private, repoints exports; never pushed; duplicate-publish 403/409 idempotent — `scripts/ci/publish-workspaces.mjs:169-174`, `release.yml:8-11,32-34` [V].
- Locked contract: `locked-names.json` keys `{product, tagline, repoUrl, siteUrl, changelogUrl, licenseUrl, packages{cli,mcp,site}, cliBin, cliCommands[7], cliFlags[4], exitCodes[3], mcpTools[5], responseFormatNote, envVars[3], configFile, configKeys[6], historyDir, providers[7], restRoutes[4], snippets{installGlobal,npxAudit,claudeMcpAdd,mcpServersJson}}` [V]. Gates: byte-exact snippet check + tool sweep `/lumen_[a-z_]+/g` (`site/tests/locked-names.test.ts:30-48`), internal-links ≥40 (`links.test.ts:18-26`), attribution hrefs (`attribution.test.ts:23-27`), `/lumen/` base (`artifact.test.ts:25-29`) [V].
- Docs: 7 pages; `rules-reference.astro` hardcodes "20 built-in"/"The 20 rules" prose at `:59,:64,:70,:102` — **no automated count gate** [V].
- Swarm corpus `packages/mcp/src/evals/data/adversaries.json` — exactly 15 ids: `private-url-audit, unknown-arg-rank, bad-domain-rank, local-only-audit-remote, local-only-rank-remote, oversized-seed-keywords, psi-timeout-degrades, crux-429-degrades, all-keywords-5xx, serp-crash-rank, audit-upstream, authority-parse-partial, rank-history-read, dup-content-surfaces, dup-content-gates` [V]; add = append case; `SWARM_ONLY` selects; gate is report-only (`continue-on-error`, `GATED_OUT ? skip`) [V]; scoreboard `.evalite/swarm-scoreboard.jsonl` [V].
- CHANGELOG: Keep a Changelog 1.1.0; latest section `[0.2.1] — 2026-09-04`; **no `[Unreleased]`** [V]. README absolute URLs: repo + `nitishagar.github.io/lumen` + shields.io + local files; SECURITY advisory URL `SECURITY.md:15` [V].
- Distribution: `mcp --print` 4 targets today; **no `server.json`, no `.mcpb`, no plugin files, no mcpb tooling anywhere** [V].
- Root `evals/` dir: untracked, contains only an empty `snapshots/` dir, referenced by nothing [V] (hygiene item: gitignore or remove).

## Implicit Spec — invariants any change here must uphold

> Requirements, not designs. (Seeded from the 2026-09-16 research doc — staleness-checked against main @ 3ae6113: all load-bearing entries re-verified this run.)

- **Locked contract moves together.** Any new rule id, provider name, boundary, CLI command, MCP tool, config key, or snippet must update `locked-names.json` + evalite snapshots + docs + affected gates in the same change — `site/tests/locked-names.test.ts:30-48`, `schema-contract.test.ts`, `registry.ts:50-83` [V]. Edge: docs prose counts ("20 rules") are hardcoded but ungated — update them or they lie.
- **Exit gate semantics.** `EXIT = {OK:0, ISSUES:1, CONFIG_ERROR:2}`; audit gate = `incomplete ‖ countAtOrAbove(issues, threshold) > 0`; `off` never gates but still reports — `gate.ts:11-29`, `cmd/audit.ts:46-47` [V]. Edge: any new gate input (baseline) must keep `incomplete` failing (PRD E1.3 FR-5).
- **Honesty outputs are first-class.** Unfetched ≠ pass; missing ≠ zero; `incomplete:true` + stopReason; unconfigured provider ≠ error; gray/heuristic labels travel — `links.ts:17`, providers, `run.ts` [V]. Edge: any new surface (SARIF/md/html/topRules) must preserve or reference provenance, and baseline "fixed" claims must be restricted to pages audited this run (PRD E1.3 FR-3).
- **BYOK names-not-values.** Config carries env-var names; values read at call time; never logged/echoed; `assertNoSecretValues` guards provider config; sentinel tests prove values never appear — `providers/src/config.ts`, `no-telemetry.test.ts` both surfaces [V]. Edge: `.mcpb` user_config fields declare names/sensitivity, never values; GSC credentials are a file *path* (contents never read into config/logs).
- **No telemetry.** Every new CLI command joins the sentinel case array; every new MCP surface stays inside the fetch-stub test; the only outbound network is configured providers + crawl targets — `no-telemetry.test.ts` [V]. Edge: `doctor --online` probes only configured providers, one paced call each (PRD E0.4 FR-2).
- **SSRF revalidated per hop; Worker never fetches targets.** `assertHopAllowed` on every hop incl. DNS-resolve check; cross-origin header stripping; hop cap; Worker `OUTBOUND_HOST_ALLOWLIST` asserted per flow — `fetcher.ts:89-105,217-264`, `worker.test.ts:306-332` [V]. Edge: `--allow-private` must be launch-time-only (flag/env at process start), origin-scoped, and absent from the Worker entirely (PRD E1.1 FR-2/FR-3).
- **Politeness floor unchanged.** Defaults `{maxPages:100, maxDepth:5, maxDurationMs:300000, maxConcurrency:5, perHostMinDelayMs:250}`; robots honored; UA unsuppressible — `budgets.ts:16-23`, `fetcher.ts:134` [V]. Edge: `perHostMinDelayMs` may default to 0 only for private/loopback targets the user owns (PRD E1.1 FR-4); external-link checks are opt-in, paced, capped.
- **History durability.** One O_APPEND write per entry, promise-queue serialized, rotation before exceeding append, truncated-tail tolerant reads — `jsonl-store.ts:110-191` [V]. Edge: baseline files are atomic writes (reuse `writeFileAtomic`); history port extension (prune) must not break the LOCKED `{append,list}` shape for existing callers.
- **Transport separation.** CLI stdout is human/JSON-doc only; MCP stdout is JSON-RPC only (banner → stderr); Worker never fetches/parses target URLs — `io.ts:6-9`, `stdio-roundtrip.test.ts:55-67`, `rest.ts:64-67` [V]. Edge: new `--format` values are render-only swaps after the atomic `--out` write; new MCP prompts/resources must not add non-JSON-RPC stdout.
- **MCP tool contract frozen at 5.** `tools/list` hard-equality asserted; adding prompts/resources must not change tools — `stdio-roundtrip.test.ts:134-143`, `schema-contract.test.ts` [V].
- **Stored-report field additions must pass the sanitize allowlist.** `sanitizeIssue` forwards only `{ruleId, severity, message, evidence, url?, fixHint?}` — a per-issue `helpUrl` (E1.2 FR-3) is silently stripped from every stored report (and therefore from baseline/diff inputs) unless the allowlist, the core `Issue` type, and the renderers move in the same change — `sanitize.ts:24-36` [V].
- **Audit history is a digest, not a finding log.** `AuditHistoryEntry` carries url/score/pagesAudited/incomplete/countsBySeverity — no issue list, no fingerprints (`core/src/history.ts:21-32`) — so PRD E1.3 FR-4's `--from-history <n>` new/existing/fixed breakdown has **no existing data source**; the port `HistoryStore {append,list}` is LOCKED (`history.ts:40-52`). The plan must either extend the stored entry shape (additive) or scope `--from-history` honestly [V].
- **Config keys have ≥4 registration sites.** A new config key (e.g. `crawl.allowPrivateHosts`, `crawl.checkExternal`, `history.maxGenerations`) must update: the loader/validation switch (`core/src/config.ts:138-234`), the CLI docs/help, locked-names `configKeys`, and the site configuration docs — unknown-key rejection is loud (`config.ts`) [V].
- **Fingerprint normalization must be pinned.** PRD's `sha256(ruleId + normalizedUrl + evidence.selector?)` leaves normalization undefined; drift between normalize-at-issue-time and normalize-at-compare-time produces false "new" findings. The repo has one URL normalizer (`audit/src/crawl/url-normalize.ts:13-17`: WHATWG href, hash stripped, punycoded host) — reuse is a plan decision, not an assumption [V].
- **Allowlist edges.** `crawl.allowPrivateHosts` CIDR `0.0.0.0/0` equals allow-everything-private and must be treated as config that widens the SSRF guard (loud validation or documented refusal); IPv6 zone-id literals and `.localhost` suffixes are already handled by `isBlockedHost` (`ssrf.ts:96-116`) and any bypass path must not reintroduce them [V].
- **Cross-process concurrency edges (existing + new).** History appends are serialized in-process only; concurrent processes may drop one `.1` rotation (accepted design). `--update-baseline` racing a running audit, and a future `history prune` vs concurrent readers, are new edges the plan must define (atomic write + read-tolerant parses are the existing primitives) [V].
- **Parse-robustness harness gap.** The PRD's ≤4 KB concise-payload budget (E1.2 FR-6) has **no observing check** (the evalite latency case measures time, not bytes) — the plan must add a size-scorer eval; likewise `mcp-publisher` validation / `.mcpb` install / registry listing (E0.3 AC) have no in-repo observing command — they are external acceptance steps to be scripted or flagged [V].
- **Robots conservative asymmetry** — 429/5xx/network → disallow-all; 4xx/unparseable → allow-all; malformed never widens access — `robots.ts:56-73` [V]. Edge: a `site`-kind AI-crawler matrix reads the SAME fetched robots body; a robots fetch failure must yield an honest "unknown" matrix, not all-allowed.
- **Parse robustness under hostile input.** Bodies capped (`readBodyCapped` 2 MiB audit-side, 2.5 MiB worker-side); malformed JSON/XML → typed warnings, never crashes — `sitemap.ts:85-88` [V]. Edge: JSON-LD and sitemap-sampling code must be bounded (element/byte caps) — swarm adversaries will target this (PRD E1.6 AC).
- **Bounding assumptions**: single-machine CLI primary; free-tier quotas are the ceiling; Node ≥22; the Worker stays a thin subset; `topRules` replacing `topIssues` is the PRD's recorded recommendation (D2, owner decision) — the plan treats it as the working decision but it is user-confirmable; baseline is CLI-only in v0.4 (PRD E1.3 FR-6 — no MCP filesystem paths); v0.6+ changes stay additive after v0.4 front-loads breaking changes.

## Workload & Scale Envelope

- **Hot operations**: crawl/audit = bounded pages (default 100, ceiling 10000) × fetch + ~16 page-rules + crawl rules at finalize — `budgets.ts:16-23`, `crawler.ts` [V]. `topRules` grouping runs over `Σ issues` (≤ pages × rules) once per report render — trivial vs crawl [R/estimate]. Baseline fingerprint = one sha256 per issue [R/estimate]. Link-check CI = ~40-100 URLs weekly (READMEs + locked-names) [V: internal-links gate counts ≥40].
- **Data categories**: pages capped 2 MiB body (`audit/src/config.ts:17`); sitemaps capped 10 sources / 10k URLs / 2 MB (`config.ts:31-40`); concise MCP payload currently ≤ ~10 issues and must stay ≤ 4 KB after topRules (PRD E1.2 FR-6); history files 1 MiB single-rotation [V]. HTML report (E2.3) renders history length × pages × issues into one self-contained file — history cap 1 MiB/rotation bounds a single domain, so worst-case render input is ~10⁴ issue rows [R/estimate from caps]. Distribution shapes unobserved (no histograms in code) [R].
- **Envelope**: single-user local CLI + stdio + optional Worker; provider rpm ceilings documented (wiki 200, psi 240, crux 150, opr 60) with GCRA worst-case computed — `builtins.ts:39-55` [V]; GSC/Bing quotas to be encoded as GCRA defaults when implemented [R]. No latency SLOs beyond eval authority <1000 ms [V].

## Hard Cores

- **HC1 — private-target opt-in without an SSRF foothold** (origin-scoped allowlist, per-hop revalidation preserved, launch-time-only for MCP, Worker refusal, metadata-IP redirect adversaries).
- **HC2 — the audit report-shape migration** (ranking, grouping, per-issue `url`/`fixHint`/`helpUrl`, MCP `topRules` replacing `topIssues`, fingerprints + baseline/diff, SARIF/md renderers, CLI human output). *Fact, not a batching decision:* E1.2 and E1.3 both mutate the same report shape, the same `sanitizeIssue` allowlist, and the same contract gates (locked-names/snapshots/docs); E1.4's renderers consume the new shape. Whether those epics ship as one plan or sequential plans is the plan phase's decomposition call (PRD lists them separately; PRD §C suggests pairing E1.1+E1.2; D2 for `topRules` is recorded in the PRD as an owner decision with recommendation (b) — breaking change in 0.x).
- **HC3 — the `site` rule kind** (new execution point needing retained robots/sitemap/home-page evidence, SPI versioning, scoring attribution to seed, all contract gates).
- **HC4 — evidence honesty + parser robustness for ~13 new rules** (canonical-target fetch, sitemap sampling, robots UA matrix, llms.txt, JSON-LD under size bombs, opt-in external links).
- **HC5 — first-party providers under BYOK** (GSC service-account file path, Bing key, new boundaries, GCRA pacing, provenance). IndexNow (E2.2) is lumen's **first write action** — gated `--yes`, hosted-key verification, CLI-only — a distinct risk surface from the two read providers.
- **HC6 — distribution manifests** (server.json, .mcpb, Claude plugin, `--print` targets, link-check workflow, registry publish) consistent with P-BYOK and the site gates.

## Verification Surface

> Full inventory persisted to `thoughts/shared/VERIFICATION_SURFACE.md` (durable, project-level). Summary:

- **Commands**: test-all `npm test` · validate-gate `npm run validate` · typecheck `npm run typecheck` · lint `npm run lint` · **test-one** `npm test -w <ws>` / `npx vitest run <file>` / `-t <name>` · evals `npm run test:evals -w @lumen-seo/mcp` · swarm `npm run test:swarm` (one: `SWARM_ONLY=<id>`) · site `npm run check -w @lumen-seo/site` · smoke `node scripts/ci/cli-smoke.mjs` · worker build+size `npm run build:worker && npm run check:size -w @lumen-seo/mcp` — healthy output: green vitest summary, evalite threshold 100, swarm scoreboard [V].
- **Oracles**: locked-names.json byte gates + tool sweep; `output-shapes.test.ts` concise key-set equality; `schema-contract.test.ts` five-tool assertion; `stdio-roundtrip` tools/list equality; fixture-site e2e (`e2e.test.ts`); golden dataset + snapshots in evalite [V].
- **Fixtures & harnesses**: `FakeFetcher`/`FakeRoute`/`makeTestDeps`/`makePage` (audit testing/), fixture sites with ROBOTS/SITEMAP routes, `fixtureDeps()`/`fixtureRemoteDeps()` (mcp testkit), `spawn.ts` real-bin contract tests, swarm `adversaries.json` corpus [V].
- **Observability**: swarm scoreboard jsonl artifact; evalite per-case scores; CI job split; `--out` reports; `config show --json` [V].
- **Gaps**: no SARIF schema validation harness; no link-integrity checker (to be built in E0.1 and self-hosted); no init/doctor tests (commands don't exist); no per-rule count gate on docs prose; swarm is report-only (no threshold gate); **no byte-size oracle for the ≤4 KB concise-payload budget** (latency case measures time only); **no in-repo command observes E0.3 acceptance** (mcp-publisher validation, .mcpb install, registry API listing — external steps to script or flag); **no data source for `--from-history` new/fixed breakdown** (AuditHistoryEntry is a digest); fingerprint normalization not pinned to a shared normalizer.

## Evidence Ledger

| Claim | Evidence | Trust | Load-bearing |
|---|---|---|---|
| 20-rule table + kinds | `rule-set.ts:28-49` | V | yes |
| Issue carries fixHint?/url?, no helpUrl | `core/src/page.ts:32-40` + grep | V | yes |
| CrawlRule checkCrawl + url-mandatory | `audit/src/types.ts:86-92` | V | yes |
| kind only on BuiltinSpec | `rule-set.ts:19-25` | V | yes |
| fixHint on 19 refs; some rules lack it | rule files sweep | V | yes |
| Crawl rules once post-crawl; url-less dropped | `run.ts:128-153` | V | yes |
| robots/sitemap evidence discarded after discovery | `run.ts:44-74` | V | yes |
| Report shape keys | `assemble.ts:52-77` | V | yes |
| sanitizeIssue allowlist | `sanitize.ts:24-34` | V | yes |
| Weights + scoring | `score.ts:9-19` | V | yes |
| testing/ not exported | `audit/package.json:10-12` | V | yes |
| categories opaque; no --only | grep + consumers | V | yes |
| SSRF blocklists + no opt-in hook | `ssrf.ts:25-116` + grep | V | yes |
| validatePublicHttpUrl location + callers | `mcp/src/url-guard.ts:14` + callers | V | yes |
| Per-hop revalidation + UA unsuppressible | `fetcher.ts:89-105,134` | V | yes |
| robots asymmetry + UA rules retained internally | `robots.ts:56-91` | V | yes |
| Sitemap caps + URL[]-only retention | `sitemap.ts:31-96`, `config.ts:31-40` | V | yes |
| PageContext carries full Headers | `page.ts:15-23` | V | yes |
| No JSON-LD/meta-refresh/llms.txt handling | grep zero | V | yes |
| resolve injectable on node fetcher | `node.ts:27-34` | V | yes |
| Worker outbound allowlist 5 hosts | `outbound-recorder.ts:26-33` | V | yes |
| COMMAND_NAMES 7 + flag-table pattern | `args.ts:13-21` | V | yes |
| Gate logic + atomic out order | `cmd/audit.ts:46-54` | V | yes |
| AuditHistoryEntry + LOCKED HistoryStore port | `core/src/history.ts:21-52` | V | yes |
| jsonl-store layout/rotation/queue | `jsonl-store.ts:30-191` | V | yes |
| rank --history --kind/--format CSV pattern | `cmd/rank.ts:27-118` | V | yes |
| BYOK defaults + config show payload | `cli-config.ts:28-41`, `config-show.ts:15-26` | V | yes |
| ProviderBoundary closed union of 5 | `core/src/providers.ts:8-16` | V | yes |
| Registry/byok validation errors | `core/src/registry.ts:50-83` | V | yes |
| no-telemetry case arrays | both tests | V | yes |
| SDK registerPrompt/registerResource exist | SDK `mcp.d.ts:102,181` | V | yes |
| concise keys asserted exact | `output-shapes.test.ts:20,62-67` | V | yes |
| Worker LOCAL_ONLY deps split | `worker/providers.ts:81-95` | V | yes |
| tools/list hard equality tolerant of prompts | `stdio-roundtrip.test.ts:134-143` | V | yes |
| mcp lacks @lumen-seo/audit dep | `mcp/package.json` | V | yes |
| validate chain + evalite/swarm/site commands | `package.json:17-23`, `mcp/package.json:18-25` | V | yes |
| release.yml tag→publish mechanics | `release.yml`, `publish-workspaces.mjs:169-174` | V | yes |
| locked-names keys + gates | `locked-names.json`, site tests | V | yes |
| docs "20 rules" hardcoded, ungated | `rules-reference.astro:59-102` | V | yes |
| swarm corpus 15 ids + report-only gate | `adversaries.json`, `evals.yml:31` | V | yes |
| CHANGELOG no Unreleased; README URL inventory | `CHANGELOG.md`, `README.md:3-74` | V | yes |
| No server.json/.mcpb/plugin today | find empty | V | yes |
| No cron workflow today | workflows sweep | V | yes |
| root evals/ empty+untracked | git status + find | V | no |

## Architecture Insights

- One engine, three doors (CLI human / stdio MCP agent / thin Worker remote) sharing schemas + provenance rules; the Worker refuses to pretend (LOCAL_ONLY typing), it doesn't degrade silently.
- Enforcement lives at the edges: core owns types/defaults (SSRF lists, budgets, Issue shape); audit enforces budgets + rule execution; CLI/MCP enforce admission (url-guard, strict-args); Worker enforces thinness via *absent deps*, not flags — the pattern any new gate (allow-private) must follow.
- Contracts are locked in three moving parts (locked-names.json, evalite snapshots, CI gates) — every contract-adjacent feature is a same-change multi-file edit.
- Honesty is load-bearing: unfetched≠pass, missing≠zero, incomplete+stopReason, unconfigured≠error — new features must add honest states, not remove them.

## Historical Context (from thoughts/)

- 2026-09-16 research doc (`thoughts/shared/research/2026-09-16-lumen-feature-inventory-missing.md`) researched 48db265 on `evals/evalite`; that work merged to main as PR #37 (e2bf645) + dep bumps. **Staleness check**: all load-bearing claims re-verified against 3ae6113 this run; rule table now 20 (was 18), audit history + CSV export now exist, swarm/evalite harnesses now exist. Prior doc's missing-features list matches what remains unimplemented — no contradiction found.
- PRD §2.1 friction evidence (F1–F9) independently re-confirmed where code-checkable: F3 (no allowPrivate), F5 (server.ts slice(0,10) no fixHint), F6 (no renderer references fixHint), F7 (no SARIF/md), F9 (no prompts/resources) — all [V] this run. F1/F2 are external (repo visibility, npm versions) — to be asked.

## Coverage & Open Questions

- Searched: 5 discovery sweeps (verification-surface+CI/site; audit engine+rules; core network; CLI/config/history/providers; MCP+worker) with 60-line return contracts + verbatim excerpts; PRD + prior research + prior bundle artifacts read in main context; grep sweeps for allowPrivate/helpUrl/fingerprint/registerPrompt/JSON-LD/http-equiv/llms.txt (all zero).
- Deliberately bounded: site/ docs pages read via locator summaries (gate files read directly); swarm `faults.ts` internals not line-read (corpus + gate verified); SDK mcp.d.ts quoted via excerpt at the two registration APIs.
- Residual risks / open questions: (1) npm publish + visibility flip + directory listings need owner action/credentials — carried to the ask list; (2) whether to tag v0.3.0 after code-side work — owner call; (3) GSC quota numbers not in repo — encode as conservative GCRA defaults at implementation and document; (4) `.mcpb` packaging tooling (`mcpb` CLI) not yet in devDeps — plan must add it or hand-roll manifest+zip; (5) exact GSC API shape verified only against PRD sketch — implementer should re-check endpoint contracts when online docs are reachable.
