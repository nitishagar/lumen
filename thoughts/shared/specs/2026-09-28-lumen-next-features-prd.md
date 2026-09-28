---
date: 2026-09-28
author: Nitish Agarwal (product owner) — drafted with Claude
status: draft for review
type: product requirements document
product: lumen (@lumen-seo/*)
baseline_commit: 3ae6113 (main)
supersedes: none — builds on thoughts/shared/research/2026-09-16-lumen-feature-inventory-missing.md and the shipped 2026-09-16 red-team-swarm plan (PR #37)
---

# lumen — PRD: from "shipped" to "adopted" (v0.3 → v0.6)

## 0. TL;DR

lumen is well built and almost nobody uses it. The engine is solid: 20 rules, 7 free/BYOK providers, 5 MCP tools, a provenance contract, 941 tests, an offline eval gate and an adversarial swarm. **Adoption is close to zero, and the biggest reasons are distribution and first-run problems, not missing features.**

| Signal (observed 2026-09-28) | Value |
|---|---|
| GitHub repo `nitishagar/lumen` | **PRIVATE**. `https://github.com/nitishagar/lumen` → 404 |
| Docs site `nitishagar.github.io/lumen` | **404** (Pages went offline when the repo was made private) |
| npm `@lumen-seo/cli` downloads | 296 in the last 30 days, of which 250 were on launch day (09-04). **6 in the last 7 days** |
| Stars / forks / external issues | 0 / 0 / 0 |
| npm latest | 0.2.1 (18 rules). `main` has 20 rules, audit history and CSV export, **all unreleased**. The README already claims 20 |
| MCP Registry / .mcpb / Claude Code plugin | not listed or packaged |

Anyone who finds lumen on npm follows a README where every link (repo, docs, CI badge, SECURITY advisory URL, CHANGELOG) returns 404. Anyone who installs it and points it at their dev server (`http://localhost:3000`) gets `refusing non-public target`. Anyone who uses it through an agent gets 10 issues in page order, with no fix hints and no page URLs for most of them.

**Strategy:** position lumen as *the deterministic, honest SEO engine that coding agents and CI call*. Stop competing on data breadth, which is where paid APIs and 17k-star prompt skills already win. Ship in four increments:

1. **v0.3 "Open the doors"** (P0, about 2 weeks): public again, release what's on `main`, list in the MCP Registry, add a first-run `init`/`doctor` flow.
2. **v0.4 "CI-native and agent-useful"** (P1): audit localhost and preview URLs, baselines and diffs, SARIF plus a GitHub Action, output agents can act on.
3. **v0.5 "Table stakes + AI-search readiness"** (P1): rule pack v2 (structured data, sitemap/robots/canonical/hreflang integrity) and an honest GEO readiness pack.
4. **v0.6 "First-party data"** (P2): Google Search Console and Bing Webmaster providers. Real clicks and positions replace best-effort SERP scraping.

---

## 1. Product context

### 1.1 What lumen is (from the repo, not the pitch)

- **Promise:** "Lightweight, pluggable, MCP-first SEO toolkit — free services only, bring your own keys, provenance on every number." (`README.md:8`)
- **Surfaces:** CLI `lumen` (7 commands) · stdio MCP server (5 tools) · thin Cloudflare Worker gateway (REST subset + `POST /mcp`; audit and rank return `LOCAL_ONLY_CAPABILITY` remotely).
- **Engine:** bounded, robots-respecting crawler (defaults 100 pages / depth 5 / 300 s / concurrency 5 / 250 ms per host, `packages/core/src/budgets.ts:15-23`); 20 rules (`packages/audit/src/rules/rule-set.ts:28-48`); severity scoring; exit codes 0/1/2.
- **Providers:** google-suggest, wikipedia-demand, pagespeed, crux, openpagerank, tranco, ddg-serp (`packages/providers/src/builtins.ts:10-18`). BYOK keys are read from env vars by name.
- **Non-negotiable principles** (see research §Implicit Spec). Every feature below must keep them:
  - **P-Honest:** never fabricate a number. Missing data is reported as missing, `incomplete:true` is a first-class state, and gray/heuristic labels travel with the value.
  - **P-BYOK:** config holds env-var *names*, never values. No key means no call.
  - **P-NoTelemetry:** nothing leaves the machine except calls to the providers the user configured (`no-telemetry.test.ts` in cli and mcp).
  - **P-Polite:** robots is honored, the UA identifies lumen and can't be suppressed, pacing stays within documented quotas.
  - **P-Thin-Worker:** the Worker never fetches arbitrary target URLs.
  - **P-Locked-Contract:** `site/src/data/locked-names.json`, the evalite snapshots and the CI gates change together.

### 1.2 What shipped since the last research (PR #37, merged to `main`, unreleased)

- Rules 18 → 20: `hreflang-present` (info) and `duplicate-content` (warning, sha256 body hash).
- `AuditHistoryEntry` (with `incomplete` and `stopReason`), a kind-aware JSONL history store, and `lumen rank --history --kind rank|audit --format json|csv` (CSV cells are formula-neutralized).
- Red-team swarm harness (15 adversaries, report-only in CI), a live LLM-judge gate (**never run with a real key**), and the evalite offline gate (14 evals, threshold 100).
- `CHANGELOG.md` has **no `[Unreleased]` section** for any of this. The README already says "20 built-in rules", while npm ships 18.

### 1.3 Market scan (September 2026)

| Alternative | Shape | Strength | Where lumen can win |
|---|---|---|---|
| [claude-seo](https://github.com/AgriciDaniel/claude-seo) (≈17.8k★) | Claude Code skill: 26 sub-skills, 19 sub-agents, Playwright, PDF | Breadth, GEO/AEO, huge distribution through the plugin marketplace | It is prompts, not an engine. Results depend on the LLM, and it has no CI gate and no provenance. lumen could be the **deterministic tool it calls** |
| [librecrawl-technical-seo-audit-mcp](https://github.com/adityaarsharma/librecrawl-technical-seo-audit-mcp) (≈41★) | Python/Docker MCP, 37 tools, 50+ checks | Schema/Rich Results, hreflang, security headers, PDF/CSV | Heavy install (Docker/venv) and no CI story. lumen is a single `npx` |
| [seo-audit-skill](https://github.com/seo-skills/seo-audit-skill) | CLI with 332 rules, GitHub Actions | Rule count | lumen can win on precision, honesty and agent ergonomics, not raw rule count |
| GSC MCP servers ([mcp-server-gsc](https://github.com/ahonn/mcp-server-gsc), [getmcpads GSC](https://github.com/getmcpads-com/google-search-console-mcp-server)) | Single-source MCP | First-party clicks and positions | They are narrow. lumen can **combine** GSC data with audit findings ("this page lost clicks *and* has a canonical conflict") |
| DataForSEO MCP / SiteAudit MCP | Paid / freemium SaaS | Volumes, backlinks, multi-engine SERP | lumen's position is "free, local, honest", so it doesn't compete here |
| [SEOnaut](https://github.com/stjudewashere/seonaut) | Go + MySQL web app | Dashboard UX | Needs a server. lumen is local-first and agent-first |

**What the market tells us:**
1. The table stakes for a "technical SEO audit" in 2026 are structured data, sitemap/robots validation, canonical and hreflang integrity, and security headers. lumen checks presence only, or not at all.
2. **GEO/AEO (AI-search readiness)** is the demand driver: AI Overviews appear on about 25% of Google queries ([LLMrefs](https://llmrefs.com/generative-engine-optimization)). Checks for AI-crawler access (GPTBot/OAI-SearchBot/ClaudeBot/Claude-SearchBot/PerplexityBot/Google-Extended) and llms.txt are now standard in competing audits ([Anagram](https://www.anagram.ai/blog/ai-crawler-user-agent-list-2026-14-bots-and-robotstxt-tokens-to-know)).
3. **Distribution runs through registries.** The official MCP Registry feeds most clients and third-party directories ([MCP Registry quickstart](https://modelcontextprotocol.io/registry/quickstart)). `.mcpb` bundles give one-click install in Claude Desktop ([mcpb](https://github.com/modelcontextprotocol/mcpb)). The Claude Code plugin marketplace is how claude-seo reached 17.8k★.
4. **Free first-party data exists and lumen doesn't use it.** The Search Console API is free (search analytics, URL inspection, sitemaps). Bing Webmaster Tools gives **exact, free keyword volumes** and IndexNow ([Bing](https://www.bing.com/indexnow)). That directly weakens lumen's current "no free search-volume source" disclaimer, at least for Bing.

---

## 2. Problem statement

> A developer shipping a website wants an agent or CI step to tell them, *truthfully and specifically*, what SEO problems their site has and how to fix them, before and after they deploy. lumen's engine can do this, but today (a) nobody can find it, (b) it refuses the URL they most want to test, (c) on an existing site it fails CI on day one with no way to accept a baseline, and (d) through MCP it returns output an agent can't prioritize or act on.

### 2.1 Evidence of each friction point (verified on `main` @ 3ae6113)

| # | Friction | Evidence |
|---|---|---|
| F1 | Undiscoverable: the repo is private, so docs 404 and npm README links 404 | `gh repo view` → `visibility: PRIVATE`; `curl` both URLs → 404; handoff ledger 2026-09-18 21:10 records the deliberate flip |
| F2 | Unreleased value: 20 rules and history/export live only on `main` | `npm view @lumen-seo/cli versions` → `0.2.0, 0.2.1`; CHANGELOG has no Unreleased section |
| F3 | Localhost, preview and staging URLs can't be audited | `lumen audit http://localhost:8765/` → `error: refusing non-public target … loopback … blocked`. There's no opt-in: `packages/core/src/ssrf.ts:110`, no `allowPrivate` in cli/audit |
| F4 | No baseline: an existing site with N findings fails the gate forever | Gate = `incomplete ‖ countAtOrAbove(issues, threshold) > 0` (`cmd/audit.ts`). There's no baseline or diff input |
| F5 | MCP audit output can't be acted on | `packages/mcp/src/server.ts:411-423`: `topIssues = issues.slice(0,10)` in page order with no severity ranking, **no `fixHint`**, and `url` only on crawl-level issues. An agent asked "what should I fix first?" can't answer from the concise payload |
| F6 | Human CLI output drops fix hints | Rule files reference `fixHint` 19 times across meta/content/links/social/technical, `sanitizeIssue` keeps it, but no CLI or MCP renderer references `fixHint` (`grep` of `packages/cli/src`, `packages/mcp/src`) |
| F7 | No CI-native format | Output is only human, JSON or `--out` JSON. There's no SARIF, Markdown summary or GitHub Action. `--format` exists only on `rank --history` |
| F8 | BYOK cold start: the most visible value (CWV, authority) needs 1–3 keys with no guided setup | 3 env vars (`LUMEN_PSI_KEY`, `LUMEN_CRUX_KEY`, `LUMEN_OPR_KEY`). `config show` reports set/unset but gives no remediation walk-through |
| F9 | MCP surface is tools-only | No MCP prompts or resources are registered (`server.ts`). Clients' slash-command and resource UIs show nothing for lumen |

---

## 3. Target users and jobs-to-be-done

| Persona | Share of focus | Job to be done | Where they meet lumen today |
|---|---|---|---|
| **A. Agent-first builder** (indie dev, uses Claude Code/Cursor, ships marketing sites and docs sites) | **Primary** | "While I build, have my agent check SEO and fix it in the same session." | MCP. Blocked by F3 (localhost), F5 (output), F9 (no prompts) |
| **B. Platform/frontend engineer** (owns CI for a web property) | **Primary** | "Fail the PR if it introduces an SEO regression, not for the 400 issues we already have." | CLI in CI. Blocked by F4 (baseline), F7 (SARIF/Action), F3 (preview URLs) |
| **C. Technical SEO / consultant** | Secondary | "Give me evidence I can defend: sources, timestamps, reproducible runs, exportable." | CLI JSON/CSV. Underserved by rule depth and the lack of first-party data |
| D. Plugin author | Tertiary | "Add my org's rules without forking." | Plugin SPI exists (Node-only). No authoring guide or published test kit |

**Explicitly not targeted:** marketers who want dashboards and backlink/volume databases (P-Honest forbids fabricating those), and multi-tenant SaaS.

---

## 4. Goals, non-goals, success metrics

### 4.1 Goals (next 2 quarters)

- **G1 Discoverability.** A developer searching npm, the MCP Registry, the Claude Code plugins or GitHub can find lumen and reach working docs in one click.
- **G2 Time to first value under 60 s**, keyless, including against `localhost`.
- **G3 CI adoption without pain.** Teams can adopt the gate on an existing site on day one (baseline) and see findings inline in PRs (SARIF/Action).
- **G4 Agent actionability.** One MCP call returns ranked, grouped, fixable findings that fit an agent's context budget.
- **G5 Credible coverage.** Cover the 2026 table stakes (structured data, sitemap/robots/canonical/hreflang integrity, AI-search readiness) without breaking P-Honest.

### 4.2 Non-goals

- Backlink graphs, clickstream, or estimated Google volumes (still refused).
- A hosted SaaS or dashboard, or running a public multi-tenant gateway.
- Headless JS rendering in core. It is at most an optional plugin; see §7 E2.4.
- Telemetry of any kind, including opt-in "anonymous usage stats". Metrics come from public signals (§4.3).

### 4.3 Success metrics (public signals only, because of P-NoTelemetry)

| Metric | Baseline (2026-09-28) | Target end of v0.4 (≈ 2026-11-15) | Target end of v0.6 (≈ 2027-01-31) |
|---|---|---|---|
| npm weekly downloads `@lumen-seo/cli` | 6 | 150 | 500 |
| GitHub stars | 0 (private) | 100 | 400 |
| GitHub "Used by" / Action dependents | 0 | 10 | 50 |
| External issues + PRs opened | 0 | 5 | 25 |
| Listed in MCP Registry + ≥2 directories (Glama, Smithery/mcp.so) | no | yes | yes |
| Time-to-first-audit (5-person hallway test, fresh machine, `npx`) | not measured | ≤ 60 s median | ≤ 60 s median |
| Rules with a `fixHint` and a docs anchor | partial, not surfaced | 100 %, surfaced in CLI, MCP and SARIF | 100 % |

**Guardrails** (must never regress): swarm and eval gates stay at 100% on the gated set; zero fabricated values; the `no-telemetry` tests stay green; the Worker bundle stays ≤ 1.5 MiB gzip; the default crawl politeness settings stay the same.

---

## 5. Prioritized roadmap overview

| ID | Epic | Priority | Release | Personas | Size |
|---|---|---|---|---|---|
| E0.1 | Public availability and link integrity | **P0** | v0.3 | all | S |
| E0.2 | Release what's on `main` (v0.3.0) | **P0** | v0.3 | all | S |
| E0.3 | Distribution: MCP Registry, `.mcpb`, Claude Code plugin, directories | **P0** | v0.3 | A | M |
| E0.4 | First-run: `lumen init` + `lumen doctor` | **P0** | v0.3 | A, B | M |
| E1.1 | Audit local and preview targets (explicit private-host opt-in) | **P1** | v0.4 | A, B | M |
| E1.2 | Actionable findings: ranked, grouped, fix hints, docs anchors (CLI + MCP) | **P1** | v0.4 | A, B, C | M |
| E1.3 | Baseline and diff gate | **P1** | v0.4 | B | M |
| E1.4 | CI-native outputs: SARIF, Markdown summary, GitHub Action | **P1** | v0.4 | B | M |
| E1.5 | MCP prompts and resources | P1 | v0.4 | A | S |
| E1.6 | Rule pack v2: integrity (structured data, sitemap, robots, canonical, hreflang, headers) | P1 | v0.5 | all | L |
| E1.7 | AI-search readiness pack (GEO) | P1 | v0.5 | A, C | M |
| E2.1 | Google Search Console provider (BYOK credentials) | P2 | v0.6 | A, C | L |
| E2.2 | Bing Webmaster provider (free exact Bing volumes) + IndexNow (opt-in write) | P2 | v0.6 | C | M |
| E2.3 | Trends and shareable reports (`lumen history`, HTML report) | P2 | v0.6 | B, C | M |
| E2.4 | Plugin ecosystem (authoring guide, published rule test kit, optional render plugin) | P2 | later | D | M |
| E2.5 | Gateway hardening (auth, shared pacing) | P3 | later | — | M |
| H | Hygiene and trust debt (§8) | P0–P2 | rolling | — | S |

Rationale for the order: nothing matters until G1 is solved (E0.x). After that, the two primary personas are blocked by the same four items (E1.1–E1.4), and those items mostly reuse existing code (history store, JSON report, `--format` parsing, exit gate). New detection breadth (E1.6/E1.7) and new data sources (E2.x) come after, because they only pay off once people are actually running lumen.

---

## 6. Requirements — P0 / P1

Each epic lists user stories, functional requirements (FR), acceptance criteria (AC, testable), the principles it touches, and dependencies.

### E0.1 Public availability and link integrity — P0

**Story:** As a developer who found `@lumen-seo/cli` on npm, I click "Docs" and "GitHub" and both work.

- **FR-1** Repo visibility is public (**Decision D1**, §10). If D1 stays private, docs move to a host that serves them publicly, and every public link (npm package READMEs, badges, `SECURITY.md` advisory URL, `locked-names.json` URLs, CLI UA string `+https://github.com/nitishagar/lumen`) is repointed.
- **FR-2** A link-integrity CI check fetches every absolute URL in the published package READMEs, root README and `locked-names.json` weekly and on release, and fails on a non-2xx. It runs as a scheduled workflow, never in the per-PR offline gate.
- **FR-3** The Pages deploy workflow runs and the site returns 200.

**AC:** `curl -I` on the repo, docs site, each npm README link and the SECURITY advisory URL all return 2xx. The link-check workflow is green.
**Principles:** P-Polite (the UA URL must resolve, because site owners use it to identify the crawler).

### E0.2 Release v0.3.0 from `main` — P0

**Story:** As an npm user, I get the 20 rules and history/export the README advertises.

- **FR-1** Add a `CHANGELOG.md` `[0.3.0]` section covering PR #37: `hreflang-present`, `duplicate-content`, audit history kind, `rank --history --kind/--format`, CSV provenance, the eval and swarm gates (dev-only).
- **FR-2** Tag `v0.3.0` → `release.yml` publishes core → audit → providers → mcp → cli in order.
- **FR-3** The post-publish smoke (`npx -y @lumen-seo/cli@0.3.0 audit https://example.com --json`) passes in a clean container.

**AC:** `npm view @lumen-seo/cli version` = 0.3.0. `lumen audit --json` on the fixture site lists 20 rule ids in `rulesEvaluated` (or equivalent). The README and rules reference agree with npm.

### E0.3 Distribution — P0

**Story:** As a Claude Code / Claude Desktop / Cursor / VS Code user, I find lumen where I already look for MCP servers and install it with one action.

- **FR-1 MCP Registry:** add a `server.json` (namespace `io.github.nitishagar/lumen`, npm package `@lumen-seo/cli`, args `["mcp"]`, env var *names* declared as optional secrets). Publish from `release.yml` after npm publish, using the [Publish MCP Server action](https://github.com/marketplace/actions/publish-mcp-server) or `mcp-publisher`.
- **FR-2 `.mcpb` bundle:** build `lumen.mcpb` in release (manifest with `user_config` fields for the 3 keys, declared `sensitive: true`) and attach it to the GitHub Release. Keys entered in Claude Desktop reach lumen as env vars, which preserves P-BYOK.
- **FR-3 Claude Code plugin:** a `lumen` plugin (MCP server config + one skill "seo-check" that tells the agent to call `lumen_audit_site` and act on grouped findings), with marketplace metadata in the repo.
- **FR-4 Directory listings:** Glama, mcp.so/Smithery and awesome-mcp-servers PRs, plus a "Used with claude-seo" note (see D5).
- **FR-5 `lumen mcp --print` gains targets** `mcpb`, `registry` (prints `server.json`) and `claude-plugin`, so the onboarding code stays the single source of truth.

**AC:** `mcp-publisher` validation passes. The registry API returns lumen. The `.mcpb` installs in Claude Desktop and the 5 tools list. `/plugin install` works from the repo marketplace. Locked-names gains the new snippets and the site gate is green.
**Principles:** P-BYOK (no key values in any manifest), P-Locked-Contract.

### E0.4 First-run: `lumen init` and `lumen doctor` — P0

**Story (A):** "I ran lumen once and I don't know what I'm missing or how to get the CWV numbers."
**Story (B):** "In CI I want a clear failure if a key is misconfigured, not a silently thinner report."

- **FR-1 `lumen init [--yes]`** writes a commented-equivalent `lumen.config.json` (defaults plus the `byok` name map), adds `.lumen/` to `.gitignore` if a repo is detected, and prints the `claude mcp add …` command and links to the 3 free-key signup pages. It never writes secret values and never overwrites an existing config without `--force`.
- **FR-2 `lumen doctor [--json] [--online]`** reports: Node version vs `engines`; config path and validity; each provider → `ready | not-configured (set $LUMEN_PSI_KEY — https://…) | disabled`. With `--online`, it makes **one** paced, cached probe per configured provider (reusing the provider pacers). Exit 0 if everything configured is healthy, 2 if a configured provider is broken. Being unconfigured is not an error.
- **FR-3** Human output from `report` and `authority` ends with a one-line hint when a leg is `not-configured` ("run `lumen doctor` for setup").
- **FR-4** CLI command count 7 → 9: update `COMMAND_NAMES`, help, locked-names, the site CLI reference, and the snapshot gates.

**AC:** On a clean machine with no keys, `lumen doctor` exits 0 and names all 3 missing env vars with URLs. With a deliberately invalid PSI key, `lumen doctor --online` exits 2 and names pagespeed. No key value appears in any output (extend the `no-telemetry` sentinel test to both commands).
**Principles:** P-BYOK, P-NoTelemetry (the `--online` probe only reaches configured providers), P-Polite.

---

### E1.1 Audit local and preview targets — P1 (highest-leverage feature)

**Story (A):** "Audit `http://localhost:4321` before I deploy."
**Story (B):** "In CI, audit the preview server on `127.0.0.1` or a private staging host."

- **FR-1** New CLI flag `--allow-private` plus config `crawl.allowPrivateHosts: string[]` (exact hostnames or CIDRs, e.g. `["localhost", "10.0.0.0/8"]`). The flag alone allows loopback only (`localhost`, `127.0.0.0/8`, `::1`); any other private range must be listed explicitly.
- **FR-2** The opt-in is **scoped to the seed's origin**. Redirects or links to a *different* private host still fail SSRF checks, and per-hop revalidation stays in place (research invariant "SSRF revalidated per hop").
- **FR-3** The MCP stdio server accepts private targets **only** when the process was launched with `lumen mcp --allow-private` (set by the user in client config, never by a tool argument). The Worker **never** accepts it (P-Thin-Worker). The MCP tool schema is unchanged.
- **FR-4** On localhost targets, robots and politeness still apply, but `perHostMinDelayMs` defaults to 0 (the user owns the server). Reports carry `target.scope: "private"` so results aren't mistaken for production.
- **FR-5** Rules that depend on production context (`insecure-http`, `canonical` pointing to the production origin) evaluate against an optional `--canonical-origin https://example.com`, so a localhost audit doesn't flood `insecure-http` or canonical mismatch findings.

**AC:** `lumen audit http://localhost:PORT --allow-private` audits the fixture server with exit 0/1. Without the flag it still refuses with exit 2 and the error message names the flag. A redirect from localhost to `169.254.169.254` is refused even with the flag. Swarm corpus: add 3 adversaries (redirect-to-metadata, DNS-rebind-to-private, tool-arg-tries-to-enable-private) and all must be refused.
**Principles:** research invariant "SSRF revalidated per hop"; security review required (`security-reviewer` agent).

### E1.2 Actionable findings — P1

**Story (A):** "Ask the agent 'what do I fix first?' and get the answer from one tool call."

- **FR-1 Ranking:** issues are sorted by severity (error > warning > info), then by number of affected pages (descending), then by rule id. This is used by CLI human output, MCP `topIssues`, SARIF and Markdown.
- **FR-2 Grouping:** add `summary.byRule[]`: `{ruleId, severity, affectedPages, sampleUrls[≤3], fixHint, helpUrl}`. MCP concise returns `topRules` (≤10 groups) **instead of** raw `topIssues` (**Decision D2**, because this is a schema change), and detailed still returns every page.
- **FR-3** Every issue carries `url` (page-level included), `fixHint` and `helpUrl` (a stable anchor on the rules-reference page, e.g. `…/docs/rules-reference/#title-length`).
- **FR-4** Every built-in rule has a `fixHint`. A gate test fails if a new rule lacks one. Plugin rules without one render "no fix hint provided by plugin <name>".
- **FR-5** CLI human output groups by rule, prints `→ fix: …` under each group and limits sample URLs to 3 with "+N more" (a `--verbose` flag lists all).
- **FR-6** Concise payload budget: the MCP concise audit response for the 100-page fixture site stays ≤ 4 KB of JSON (checked with an eval latency/size case).

**AC:** For a fixture with 1 error on page 5 and 30 infos on pages 1–4, the first `topRules` entry is the error with its page URL and fix. The eval snapshot is updated deliberately and the snapshot diff is reviewed. A fixHint coverage test enforces 20/20.
**Principles:** P-Honest (`affectedPages` counts only audited pages; skipped pages aren't counted as passing), P-Locked-Contract.

### E1.3 Baseline and diff gate — P1

**Story (B):** "Adopt lumen on a site with 400 existing warnings and only fail PRs that add new ones."

- **FR-1 `lumen audit … --baseline <file>`:** the gate counts only issues whose **fingerprint** is not in the baseline. Fingerprint = `sha256(ruleId + normalizedUrl + evidence.selector?)` and deliberately excludes the message text, so copy tweaks don't un-baseline an issue.
- **FR-2 `lumen audit … --update-baseline <file>`** writes the current fingerprints (atomic write, sorted, with a version field) and exits 0.
- **FR-3** Output shows three sections: `new` (gated), `existing` (reported, not gated) and `fixed` (in the baseline but no longer seen *on pages that were audited this run*). Pages that weren't audited are `unknown`, never "fixed" (P-Honest, crawl-evidence honesty).
- **FR-4 `lumen diff <a.json> <b.json>`** compares two saved reports (or `--from-history <n>` against the audit history kind shipped in PR #37) and gives the same new/existing/fixed breakdown plus the score delta.
- **FR-5** An `incomplete` run still fails the gate even when there are zero new issues (existing invariant). Output adds the hint "baseline comparison is partial".
- **FR-6** MCP `lumen_audit_site` gets an optional `baseline` argument? **No.** It stays CLI-only in v0.4 to avoid giving agents filesystem paths through MCP. Revisit in v0.5 (see D2).

**AC:** Fixture v1 → `--update-baseline` → fixture v2 (adds 1 error, fixes 1 warning): exit 1, new=1, fixed=1. Renaming a title's text on an existing issue doesn't create a new one. A baseline written by 0.4 is readable by later versions (version field plus a test).

### E1.4 CI-native outputs — P1

**Story (B):** "Findings show up as annotations on the PR diff and in the job summary."

- **FR-1 `--format human|json|sarif|md`** on `audit` (`--json` stays as an alias for `--format json`). SARIF 2.1.0: one `rule` per lumen rule (with `helpUri` and `shortDescription`), `result.locations` = page URL as `artifactLocation.uri`, and when a `--source-map` glob is given (e.g. `site/src/pages/**`), a best-effort route → file mapping. When the mapping is ambiguous the result stays URL-only and is never guessed (P-Honest). Provenance goes in `run.properties` (tool version, crawl budgets, startedAt/completedAt, incomplete/stopReason).
- **FR-2 `--format md`** writes a job summary Markdown (score, new/fixed if baselined, top rule groups with fixes). The Action pipes it to `$GITHUB_STEP_SUMMARY`.
- **FR-3 GitHub Action** `nitishagar/lumen-action` (or `lumen/action` subfolder, D1-dependent). Inputs: `url`, `start-command` + `wait-on` (starts the preview server and implies `--allow-private` for loopback), `baseline`, `fail-threshold`, `max-pages`, `upload-sarif` (default true). Composite action using `npx @lumen-seo/cli@<pinned>`, SHA-pinned dependencies.
- **FR-4** Docs: a "Lumen in CI" page with copy-paste workflows for GitHub Actions, GitLab CI and a generic shell.

**AC:** The SARIF output validates against the 2.1.0 schema (offline, vendored schema) and uploads cleanly with `github/codeql-action/upload-sarif` on a demo repo. The Action's end-to-end workflow on the repo's own site build (Astro preview on localhost) runs green, and a seeded regression turns it red with an annotation.

### E1.5 MCP prompts and resources — P1

**Story (A):** "In Claude Code I type `/lumen` and see useful starting points."

- **FR-1 Prompts:** `lumen-prelaunch-check(url)` (audit + page report on the home page + authority, then a prioritized fix list), `lumen-fix-top-issues(url)` (audit, group, then edit the source files for the top N), `lumen-keyword-brief(seed, domain?)`.
- **FR-2 Resources:** `lumen://rules` (the rule catalog with fixHints/helpUrls), `lumen://audit/latest/{domain}` (latest audit from local history, stdio only), `lumen://history/rank/{domain}`.
- **FR-3** The Worker registers prompts and `lumen://rules` only. History resources are local-only and return the typed LOCAL_ONLY capability error.

**AC:** `tools/list` still returns exactly 5 tools (the contract is unchanged). `prompts/list` = 3 and `resources/list` ≥ 1, both covered by new evalite snapshot cases.

### E1.6 Rule pack v2 — integrity — P1

**Story (all):** "lumen catches the problems that actually get pages de-indexed."

Candidate rules. All use local evidence only, so there is no new provider. Default severities are shown. Ship in priority order and re-check each against the 20-rule contract.

| Rule id | Kind | Default | Detects | Evidence honesty note |
|---|---|---|---|---|
| `structured-data-invalid` | page | error | JSON-LD that doesn't parse; `@context` missing or not schema.org | parse errors only; no "rich result eligible" claims |
| `structured-data-required-props` | page | warning | Required properties missing for the common types (Article, Product, Organization, BreadcrumbList, FAQPage, LocalBusiness), per a vendored, versioned table | the table version goes in the report provenance |
| `canonical-target-invalid` | crawl | error | Canonical points to a non-200, redirect, noindex or cross-host target (fetched within the budget) | an unfetched target is `unknown`, not a pass |
| `sitemap-invalid` | site | warning | Sitemap XML malformed, >50k URLs / >50 MB, or wrong host | new "site" rule kind (see FR-2) |
| `sitemap-url-nonindexable` | crawl | warning | URLs in the sitemap that return non-200, noindex, or a canonical pointing elsewhere | only counts sampled URLs; the report states the sample size |
| `robots-invalid` | site | warning | Unknown directives, a sitemap line pointing to 404, an accidental `Disallow: /` on production | — |
| `hreflang-reciprocity` | crawl | warning | Missing return tags, missing self-reference, invalid lang/region codes (upgrades `hreflang-present`) | — |
| `orphan-page` | crawl | info | URLs in the sitemap that no crawled page links to | only when the crawl finished (`incomplete=false`) |
| `meta-refresh-redirect` | page | warning | `<meta http-equiv=refresh>` | — |
| `security-headers` | page | info | HSTS on https, `X-Content-Type-Options`, CSP presence | presence only, not a security grade |
| `twitter-card-missing` | page | info | twitter:card absent when OG is present | — |
| `thin-content` | page | info | Visible text word count below a threshold (configurable, default 200) | shows the threshold used |
| `broken-external-link` | crawl | warning | **Opt-in** (`crawl.checkExternal: true`): HEAD/GET to external links, per-host paced, capped (default 200) | off by default for politeness; the cap is reported |

- **FR-1** A rule id added to the registry updates locked-names, the rules reference, READMEs and snapshots together (P-Locked-Contract). Each rule ships with a fixHint and a helpUrl (E1.2).
- **FR-2** Introduce a third rule kind, `site` (runs once per audit against robots.txt, the sitemap and the home page), next to `page` and `crawl`. The plugin SPI gets the same kind (additive, with a version bump of the SPI types).
- **FR-3** Scoring: site-kind issues are attributed to the seed page for the score, so scoring semantics don't change for pages.

**AC:** Each rule has a positive fixture, a negative fixture and a "not fetched → unknown" fixture. The swarm gets ≥ 2 adversaries for parser robustness (malicious JSON-LD size bomb, XML entity expansion in the sitemap). Both must be bounded by body caps and never crash the audit.

### E1.7 AI-search readiness pack (GEO) — P1

**Story (A, C):** "Is my site reachable and legible to AI search engines, without snake oil?"

- **FR-1 `ai-crawler-access`** (site, info): builds a matrix from robots.txt for a vendored, dated list of AI user-agent tokens, split into *training* (GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended, Bytespider) and *retrieval/search* (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot). It flags the case where retrieval bots are blocked, which is usually unintended. It reports the matrix and never recommends a training policy (that's the owner's choice).
- **FR-2 `llms-txt`** (site, info): checks `/llms.txt` presence and format (H1 title, blockquote summary, link lists per the llmstxt.org shape) and that the links resolve (sampled). The docs **state plainly** that llms.txt is a proposal with unproven ranking impact.
- **FR-3 `content-in-raw-html`** (page, warning): the ratio of visible text in the server HTML vs a heuristic SPA-shell signature (e.g. `<div id="root"></div>` with less than N words). It flags pages whose primary content probably needs JS, which most AI crawlers don't execute. It is labeled a heuristic.
- **FR-4** These rules are grouped under the category `ai-search`. `lumen audit --only ai-search` runs just this category (a new `--only <category|ruleId,…>` flag that also helps E1.2).
- **FR-5** The site and docs gain a "What lumen does and doesn't claim about AI search" section, in line with P-Honest.

**AC:** The UA list is vendored with `asOf` and a source URL recorded in the report provenance. Fixture robots files produce the expected matrix. The docs gate checks that the disclaimer is present.

---

## 7. Requirements — P2 / P3 (sketched; detailed when scheduled)

### E2.1 Google Search Console provider — P2

- A new boundary `search-performance` with provider `gsc`. Credentials are **BYOK by name**: `LUMEN_GSC_CREDENTIALS` = *path* to a service-account JSON (or an OAuth installed-app token file created by `lumen auth gsc`, Decision D4). The file contents are never logged or echoed.
- CLI: `lumen performance <site> [--days 28] [--by query|page]`. MCP: gated behind an explicit contract change (a 6th tool `lumen_search_performance`, D2).
- **Killer combo:** `lumen audit --with-gsc` annotates rule groups with clicks and impressions for affected pages, so findings can be ranked by traffic at risk. This is the differentiator against single-source GSC MCP servers.
- The `rank` command prefers GSC average position (first-party, labeled) over `ddg-serp` (best-effort) when configured, and the provenance says which source was used.
- Respect API quotas with a GCRA pacer from the documented limits. Cache for 24 h.

### E2.2 Bing Webmaster provider + IndexNow — P2

- `bing-webmaster` under `keywords` gives **exact Bing query volumes** (labeled `source: bing, scope: bing-only`). This is the first real volume number lumen can show honestly. Key `LUMEN_BING_KEY`.
- `lumen indexnow submit <urls…|--from-sitemap>` is lumen's **first write action**. It requires an explicit `--yes`, verifies the key file is hosted at `/<key>.txt` first, is CLI-only (never exposed as an MCP tool in v0.6), and runs a dry run by default.
- Update the landing page "what we don't do" copy accordingly: "no free *Google* volume source".

### E2.3 Trends and shareable reports — P2

- `lumen history audit|rank [--domain] [--since]` promotes the `rank --history --kind` surface to a first-class command (keep the old flags as deprecated aliases for one minor version).
- `--format html` gives a single self-contained static report (no external requests, attributions footer, provenance per metric) for consultants to send to clients.
- A scheduled-monitoring *recipe* (a GitHub Actions cron workflow template that commits audit history to a branch). lumen itself doesn't add a daemon.
- History retention: `history.maxGenerations` (currently a single `.1`) and `lumen history prune`.

### E2.4 Plugin ecosystem — P2

- Publish `@lumen-seo/audit/testing` (fake fetcher + page fixtures) as a supported export, plus a plugin authoring guide and a `lumen-plugin-template` repo.
- An optional `@lumen-seo/plugin-render` (Playwright peer dependency) provides a rendered-DOM `PageContext` for SPA sites. It is explicitly outside core to keep lumen lightweight, and it is labeled as rendered evidence in provenance.

### E2.5 Gateway hardening — P3

- Optional bearer-token auth (`WORKER_AUTH_TOKEN` secret) and an origin allowlist instead of `*` CORS. A shared pacer via Durable Objects only if the gateway gets real traffic. Until then, keep the Worker documented as "self-deploy, personal use".

---

## 8. Hygiene and trust debt (rolling, mostly P0/P1)

| Item | Why it matters | Priority |
|---|---|---|
| Add a CHANGELOG `[Unreleased]` discipline and a PR-template checkbox | F2 happened because there was no forcing function | P0 |
| README ↔ npm drift check: CI asserts the README rule count = registry count = the published `latest` at release | Prevents claims ahead of shipped reality (P-Honest applies to marketing too) | P0 |
| Run the live LLM-judge gate once with a real key and record the result in `docs/evals.md` | It has never been exercised, so an unverified gate is a trust liability | P1 |
| Add `evals/.last-run.json` to `.gitignore` | Stray untracked file flagged in the 09-18 handoff | P1 |
| Deepen `redactUrl` secret-param redaction; SHA-pin third-party Actions | Recorded security follow-ups from PR #37 | P1 |
| Gray endpoints (google-suggest, ddg-serp) break silently in practice | Add a weekly scheduled *live* canary (outside the offline gate) that opens an issue on parse/blocked drift | P1 |
| Name a swarm threshold and move it from report-only to gating | The harness exists but can't yet block regressions | P2 |
| Package versions are `0.0.0` in source and rewritten at publish | Contributors can't tell what version they're on. Consider `changesets` | P2 |

---

## 9. Release plan

| Release | Target window | Contents | Exit criteria |
|---|---|---|---|
| **v0.3.0** "Open the doors" | 2026-09-29 → 10-12 | E0.1–E0.4, P0 hygiene | All §4.3 "Listed" rows = yes; links 2xx; `doctor`/`init` shipped; announcement (Show HN / r/SEO / r/webdev / MCP Discord) *after* the links work |
| **v0.4.0** "CI-native" | 10-13 → 11-15 | E1.1–E1.5 | Action e2e green on the lumen site; SARIF validated; security review PASS on E1.1 |
| **v0.5.0** "Table stakes + AI search" | 11-16 → 12-20 | E1.6, E1.7 | ≥ 12 new rules, each with fixtures and a fixHint; swarm parser adversaries pass |
| **v0.6.0** "First-party data" | 2027-01 | E2.1–E2.3 | GSC and Bing providers behind BYOK; `audit --with-gsc` ranking; HTML report |

Go-to-market beats per release: v0.3 launch post ("the honest SEO engine for agents") · v0.4 "SEO regression gate in 5 lines of YAML" · v0.5 "AI-crawler access audit — what your robots.txt actually tells ChatGPT and Claude" · v0.6 "rank findings by traffic at risk".

---

## 10. Decisions needed (owner: product)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Repo visibility | (a) public again (b) stay private and move docs, source links and the Action elsewhere | **(a).** The repo was made private on 09-18 when it had 0★ and 0 forks, but an Apache-2.0 tool that asks people to trust its provenance needs visible source, and the docs, badges, advisory URL and UA link all assume a public repo |
| D2 | MCP contract changes (the concise `topRules` replacing `topIssues`; a possible 6th tool) | (a) additive only (b) breaking change in 0.x with a changelog note | **(b) for `topRules`** (0.x, very few users today, so this is the cheapest time). Add tools only when a new *capability* justifies it (GSC), never for convenience |
| D3 | Private-host opt-in scope (E1.1) | flag only / flag + config CIDRs / also a per-call MCP arg | **Flag + config, launch-time only for MCP.** A tool argument would let a prompt-injected agent reach internal networks |
| D4 | GSC authentication UX | service-account path only / + OAuth installed-app flow (`lumen auth gsc`) | Start with service account (simple, BYOK-shaped). Add OAuth in v0.6.x if issues ask for it |
| D5 | Relationship with claude-seo (≈17.8k★) | ignore / compete / **complement** (offer lumen as its deterministic audit backend, contribute an extension) | **Complement.** Their users are our persona A, and "deterministic numbers with provenance" fills their stated gap |
| D6 | Headless rendering | never / optional plugin / core | **Optional plugin (E2.4)**, and only after v0.5 |

---

## 11. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gray endpoints (Google Suggest, DDG HTML) get blocked or change | High | Keywords and rank degrade | Live canary (§8); GSC and Bing first-party replacements (E2.1/E2.2); already reports `unavailable` honestly |
| `--allow-private` becomes an SSRF foothold | Medium | High | Launch-time only, origin-scoped, per-hop revalidation, swarm adversaries, mandatory security review (E1.1) |
| Rule breadth race vs 300+-rule tools | High | Medium | Compete on precision, fixability and honesty; publish a false-positive policy; track reported false positives as a quality metric |
| GEO checks read as snake oil | Medium | Reputation | Info severity, explicit disclaimers, no ranking claims (E1.7 FR-5) |
| Contract churn breaks early integrators | Low (few users) | Medium | Front-load breaking changes into v0.4, then commit to additive-only changes from v0.5 |
| The maintainer is the bottleneck (single maintainer) | High | High | Plugin SPI + template (E2.4), `good first issue` labels on the rule-pack items (each rule is independent and fixture-driven) |

---

## 12. Appendix

### A. Verified facts used in this PRD

- Visibility and links: `gh repo view nitishagar/lumen --json visibility` → `PRIVATE`; `curl` repo and docs → 404 (2026-09-28).
- Downloads: `api.npmjs.org/downloads/point/last-week/@lumen-seo/cli` → 6; last-month → 296; daily range shows 250 on 2026-09-04.
- Localhost refusal: `node packages/cli/bin/lumen.js audit http://localhost:8765/` → `error: refusing non-public target "localhost:8765" (private, loopback, link-local, and ULA ranges are blocked)`; `packages/core/src/ssrf.ts:110`.
- MCP concise audit shape: `packages/mcp/src/server.ts:411-423` (`issues.slice(0, 10)`, fields `ruleId/severity/message/url?`).
- `fixHint` preserved in stored reports (`packages/audit/src/report/sanitize.ts`) but not referenced by any renderer in `packages/cli/src` or `packages/mcp/src`.
- No MCP prompts or resources are registered in `packages/mcp/src/server.ts`.
- Rules: 20 entries in `packages/audit/src/rules/rule-set.ts`; npm latest 0.2.1 predates PR #37 (merged 2026-09-19).

### B. External sources

- MCP Registry quickstart — https://modelcontextprotocol.io/registry/quickstart
- MCPB (desktop extensions) — https://github.com/modelcontextprotocol/mcpb · https://blog.modelcontextprotocol.io/posts/2025-11-20-adopting-mcpb/
- Publish MCP Server GitHub Action — https://github.com/marketplace/actions/publish-mcp-server
- claude-seo — https://github.com/AgriciDaniel/claude-seo
- librecrawl-technical-seo-audit-mcp — https://github.com/adityaarsharma/librecrawl-technical-seo-audit-mcp
- seo-audit-skill — https://github.com/seo-skills/seo-audit-skill
- SEOnaut — https://github.com/stjudewashere/seonaut
- GSC MCP servers — https://github.com/ahonn/mcp-server-gsc · https://github.com/getmcpads-com/google-search-console-mcp-server
- SEO MCP landscape — https://seoprofy.com/blog/best-mcp-server-for-seo/ · https://backlinkcrm.io/seo-mcp-servers/
- GEO / AI search — https://llmrefs.com/generative-engine-optimization · https://apexdigital.ro/blog/geo-audit-2026/
- AI crawler user agents — https://www.anagram.ai/blog/ai-crawler-user-agent-list-2026-14-bots-and-robotstxt-tokens-to-know · https://nohacks.co/blog/ai-user-agents-landscape-2026
- Bing Webmaster keyword volumes and IndexNow — https://mediaofficers.com/insights/bing-keyword-research-tool · https://www.bing.com/indexnow

### C. Hand-off

Each P0/P1 epic is sized to fit one `/create_plan_light` (S/M) or `/create_plan_generic_v2_7` (L: E1.6) run. Suggested first plan: **E0.1 + E0.2 + E0.3 together** ("v0.3 release train"), then **E1.1 + E1.2** (they share the audit report shape and the security review).
