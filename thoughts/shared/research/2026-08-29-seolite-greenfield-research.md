---
date: 2026-08-29T00:00:00+05:30
researcher: zcode orchestrator + 5-agent web research swarm (adversarial advisor checkpoint applied)
git_commit: 415f0ae
branch: main
repository: seolite (greenfield, local ~/repos/learn/seolite; no remote yet)
topic: "Build a very lightweight pluggable version of Semrush — public Apache repo on nitishagar, docs + GitHub Pages, developer/PM friendly, agent & MCP-first, lightweight approach like pi.dev, all free services, TDD with red-team verification at each stage"
tags: [research, greenfield, seo, mcp, cloudflare-workers, github-pages, product]
scale: large
status: complete
last_updated: 2026-08-29
last_updated_by: zcode orchestrator
---

# Research: seolite — lightweight pluggable Semrush alternative (MCP-first, free-services-only)

## Research Question
"Build a very lightweight pluggable version of Semrush on my github gh cli user 'nitishagar' working with docs and pages up as a public apache repo. Use a swarm of subagents to research the most important features and take a lightweight approach like https://pi.dev/. The focus should be on developer and product manager friendly tool which is agent and mcp first. Use red-team agents to verify each piece before moving to next stage. Needs to run on all free services. Look and feel of website on github pages should be like pi.dev."

This is a GREENFIELD research task: there is no existing codebase. All evidence is external (web), gathered 2026-08-29 by 5 parallel web-research agents; an adversarial advisor reviewed the decomposition before fan-out. Trust markers: `[V]` = agent returned a direct fetch/verbatim excerpt; `[R]` = agent-reported with source URL but not verbatim-confirmed. Load-bearing claims are `[V]` unless flagged.

## Summary
A "very lightweight Semrush" is buildable free-only if the core is **site audit + page/CWV reports + keyword ideas + best-effort rank checks + domain authority proxies**, all behind one pluggable provider SPI, exposed MCP-first (stdio locally, stateless Streamable HTTP on a free Cloudflare Worker) with a feature-parity CLI. Semrush-class features that require proprietary indexes (backlink graph, domain→keyword ranking DB, clickstream panels) have **no free source** and are explicitly out of core. pi.dev's look is reproducible from extracted design tokens (dark zinc + orange accent, system font stacks, mono labels) without touching its protected brand assets. The Workers free tier's **10 ms CPU ceiling** is the key architectural constraint: the Worker must be a thin gateway; the engine runs where compute is free (local CLI / stdio MCP / CI). Apache-2.0 compliance requires only a top-level LICENSE file; CrUX data display carries a CC BY 4.0 attribution duty.

## Detailed Findings

### Seam 1+3 (merged): Semrush features × free-source feasibility
Semrush top features (ranked, capped for lightweight scope) with data needs and free-source verdicts. Feature copy `[V]` from direct fetches of semrush.com/features/ and KB pages.

| # | Semrush feature | Data needed | Free source availability | Verdict for lightweight core |
|---|---|---|---|---|
| 1 | Technical Site Audit — "Crawl your site for technical issues that hurt search and AI visibility" | crawl of target site (status, meta, headings, link graph, robots, sitemap) + CWV lab/field data | self-crawl (free); PageSpeed Insights API; CrUX API | **SHIP** — the heart |
| 2 | Position Tracking — "Track keyword rankings daily across locations, devices, and search engines" | SERP positions over time per keyword/geo | no free historical DB; live SERP only via gray endpoints or BYOK APIs | **PLUGGABLE, best-effort** — live checks + local history storage |
| 3 | Keyword Research (Keyword Magic) — "over 28 billion keywords across 142 geographic databases" | volume, difficulty, intent, related keywords | autocomplete suggestions (gray); Wikipedia pageviews (clear demand proxy); volume DB: none free | **SHIP ideas + heuristics (labeled)** — no fake volumes |
| 4 | Backlink Analytics — "43T+ backlinks across 800M+ domains" | proprietary link index | none free (Common Crawl is URL-capture index, not a link graph) | **OUT of core** — authority proxy only (Open PageRank, Tranco) |
| 5 | Organic/Competitor Research | domain→keyword ranking DB, traffic estimates | none free | **OUT of core** |
| 6 | Traffic/Market Analytics | clickstream panel data | none free | **OUT** |
| 7 | AI Visibility — brand presence in LLM answers | LLM answer corpus per prompt | LLM APIs BYOK (user's own keys/credits) | **LATER / provider SPI hook** |
| 8 | Content Template/Writing Assistant | top-N SERP page text + term analysis | SERP scrape (gray) + page fetch + local NLP | **LATER** |

Prior art (architecture signals): Lighthouse's gatherer/audit plugin architecture `[V] github.com/GoogleChrome/lighthouse`; SiteOne Crawler — Rust single binary, CI exit-code gate, weighted 0–10 score `[V] github.com/janreges/siteone-crawler`; SEOnaut — self-hosted crawler, severity tiers, monolithic (no plugin system) `[V] github.com/stjudewashere/seonaut`; advertools — unix-style independent functions over pandas `[V] github.com/eliasdabbas/advertools`. Gap confirmed: no existing OSS tool is **MCP-first + pluggable-providers + free-only**.

### Seam 3 (deep): free data source matrix
All `[V]` unless noted. Full details in agent returns; load-bearing rows:

| Source | Data | Auth | Limits | ToS | Verdict |
|---|---|---|---|---|---|
| PageSpeed Insights API v5 | Lighthouse lab + CrUX field buckets | key optional for trial, "needed for automated multiple queries" (BYOK) | ~25k/day, 240/min (corroborated, not on doc page `[R]`) | official, permitted | FREE-CLEAR (BYOK) |
| CrUX API v4 | 28-day real-user CWV distributions | **requires a free Google Cloud API key** ("Using the CrUX API requires a Google Cloud API key" — keyless earlier claim REFUTED in audit) | verbatim: "limited to 150 queries per minute per Google Cloud project, which is offered without charge"; not increasable by payment | official | FREE-CLEAR (BYOK required) |
| Google autocomplete (`suggestqueries.google.com/complete/search?client=firefox`) | keyword suggestions | none | undocumented; 429/CAPTCHA at scale | **gray** — undocumented endpoint | FREE-GRAY (pluggable, cache, degrade) |
| Wikimedia pageviews + REST | per-article daily views (demand proxy) | none; UA with contact required ("include a meaningful User-Agent header that includes contact information") | 200 req/min with compliant UA; 429 + Retry-After | official | FREE-CLEAR |
| Wayback CDX | historical captures per URL | none | ~15–60 req/min observed `[R]`; 429s expected | permitted w/ backoff | FREE-GRAY |
| DuckDuckGo html/lite endpoints | SERP titles/URLs for position lookup | none; HTML-only, DOM parse | undocumented; active bot protection, CAPTCHAs commonly reported | **gray** | FREE-GRAY (default SERP provider, best-effort) |
| Common Crawl index | URL capture rows (NDJSON) | none | "Please do not overload the URL index server." | permitted | FREE-CLEAR (not a backlink graph — captures only) |
| Open PageRank | 0–10 domain authority + rank | free key BYOK, **Bearer token auth** (old `API-OPR` header REFUTED in audit — stale docs) | 60 req/min + monthly domain quota (docs example ~30k/month); docs now at openpagerank.keywordseverywhere.com/docs | official | FREE-CLEAR (BYOK) |
| Tranco | top-sites domain ranking | none | daily list; attribution required | permitted w/ attribution | FREE-CLEAR |
| Google Programmable Search JSON API | real Google SERP | key + cx BYOK | 100 free queries/day; **"closed to new customers"**; full API shutdown 2027-01-01 (audit addition) `[V]` | permitted | effectively unavailable — do not build anything on it |
| Brave Search API | official SERP JSON | key BYOK | free plan discontinued; "$5 in free monthly credits" | official | PAID-ish — optional BYOK provider only |
| Bing Search API | — | — | "will be retired on August 11, 2025" `[V]` | — | DEAD |
| DataForSEO / serper.dev | SERP + keyword suites | BYOK | trial credits then paid `[V]` | official | PAID — optional BYOK providers via SPI |

### Seam 2: pi.dev design language (the look & feel target)
pi.dev is the open-source "minimal agent harness" coding agent (Earendil Inc., MIT). `[V]` live-site fetch + `[V]` public website repo (earendil-works/pi-website) CSS extraction.

- **Product ethos (verbatim hero)**: "There are many agent harnesses but this one is yours" / "Pi is a minimal agent harness. Adapt Pi to your workflows, not the other way around."
- **Page skeleton**: sticky nav (logo + Home/Documentation/News/Packages/Models + GitHub/npm icons) → hero (install box with tabs curl/PowerShell/npm/pnpm/bun + terminal demo) → sections each with small mono label + bold title + prose + figure with caption ("Fig. 01 | …") → footer (community links, license, theme switcher Auto/Light/Dark).
- **Design tokens** (extracted from site CSS `[V]`):
  - Colors: body bg `#09090b`, text `#fafafa`, dim `#a1a1aa`, accent `#f97316` (orange); terminal block bg `#18181b`, border `#27272a`, hover `#3f3f46`; badge accents `#4ade80`, `#60a5fa`, `#c084fc`, `#fbbf24`; light docs theme bg `#fff`, text oklch(0.145 0 0), link `#0066cc`; dark docs bg `#0e0e11`, text `#ddd`, link `#65a0ff`, border `#454545`.
  - Fonts: **system stacks only, zero web fonts** — `--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`; `--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial`.
  - Scale/shape: root 18px; h1 1.875rem, h2 1.5rem, h3 1.25rem, dense text 0.7–0.95rem; line-height 1.5; radius: cards/terminal 8px, pre/buttons 6px, inline code 4px, pills 100px; spacing 0.25–1rem micro, 2–3rem sections; weights 500/600/800.
  - Style: dark-first, mono for all "terminal chrome" (install boxes, labels, pills), minimal single-color inline SVG icons, screenshots/terminal recordings as the only visuals, `prefers-reduced-motion` respected, 0.2s ease transitions.
- **Docs structure**: multi-page, left sidebar grouped TOC (Start here / Customization / Reference / …), "On this page" anchors, ⌘K search, short one-liner terminal blocks.
- **Trade-dress caution** `[V]`: SAFE to emulate (generic): dark zinc palette + single orange accent, system stacks, 18px root, 8px cards, mono labels, single-column minimal layout, fig captions, ⌘K, theme toggle. UNSAFE (distinctive to pi): the "pi" name/logo/favicon, "Crooked mode" toggle, verbatim taglines/headlines, "Earendil Inc." branding, exact section-title set, press-kit assets.

### Seam 4: MCP-first + Cloudflare Workers (free tier)
- **Remote MCP pattern (current, recommended)** `[V]`: stateless Streamable HTTP via `createMcpHandler` (from `agents/mcp/server`) wrapping an `@modelcontextprotocol/sdk` `McpServer`; default export is `return createMcpHandler(createServer)(request, env, ctx)`. Verbatim: "Use `createMcpHandler` to create an MCP server that handles Streamable HTTP transport… This is the recommended approach for new MCP servers." The Durable-Object-based `McpAgent` is verbatim "deprecated and feature-frozen"; "Do not create a new `McpAgent` server. Use a stateless `createMcpHandler` server instead." Authless variant documented; OAuth via `OAuthProvider` wrapper optional. developers.cloudflare.com/agents/model-context-protocol/
- **Workers free limits** `[V]` developers.cloudflare.com/workers/platform/limits/: 100,000 req/day; **10 ms CPU per invocation** (error 1102 if exceeded); 3 MB gzipped script; 128 MB isolate; **50 subrequests/request**; 6 simultaneous outgoing connections. KV free: 100k reads/day, **1k writes/day**. DO (SQLite) on free: 100k req/day. → **The 10 ms CPU ceiling makes in-Worker crawling/HTML parsing unsafe; the Worker must be a thin stateless gateway.**
- **stdio pairing** `[V]`: one transport-agnostic `McpServer` — `StdioServerTransport` locally, Streamable HTTP remotely; `mcp-remote` npm bridges stdio-only clients to the remote URL.
- **Onboarding UX** `[V]`: Cursor one-click `cursor://anysphere.cursor-deeplink/mcp/install?…` (base64 config), VS Code `vscode:mcp/install?{json}`, Claude Code `claude mcp add --transport stdio … -- npx …`, universal `mcpServers` JSON snippet, `npx install-mcp` helper. No official `claude://` deep link for Desktop.
- **Tool design guidance** `[V]` (Anthropic engineering + MCP spec): consolidate multi-op tools; namespace with prefixes (e.g. `seolite_*`); "return only high signal information back to agents"; human-readable fields; optional `response_format` concise/detailed; tool names must satisfy MCP SEP-986 format; inputSchema JSON Schema 2020-12.

### Seam 5: licensing/IP + CI/CD (free tier)
- **Apache-2.0** `[V]` apache.org/licenses/LICENSE-2.0.txt + apache.org/dev/apply-license.html: one full license text "in a file called LICENSE in the top directory" satisfies §4(a); per-file headers are a "should" recommendation (appendix boilerplate), not a §4 condition; NOTICE required only if upstream ships one; §6 grants **no trademark rights**.
- **CrUX attribution** `[V]`: "The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license" → attribution + license link owed wherever CrUX data is displayed/redistributed. **Common Crawl ToU has no attribution requirement** `[V]`.
- **Trade dress** `[V]` (15 U.S.C. §1125): look/feel can be protectable if nonfunctional + distinctive + confusingly similar; distinct name/logo/original copy ("inspired by") = lower risk; copying marks/logos/distinctive assets verbatim = exposure. → Our site uses pi.dev-derived **generic tokens only** with original branding ("seolite"), original copy, no pi assets.
- **GitHub Pages via Actions** `[V]` docs.github.com: flow = `actions/configure-pages@v5` → build → `actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4`, job needs `pages: write` + `id-token: write`, environment `github-pages`; enable via `POST /repos/{owner}/{repo}/pages` with `build_type: "workflow"`; limits: 1 GB site, 100 GB/mo soft bandwidth; Actions is free for public repos `[V]`.
- **Workers CI deploy** `[V]`: `cloudflare/wrangler-action@v4` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` (+ accountId secret if not in config); "Global API key & Email Auth no longer supported"; `wrangler versions upload` gives preview URLs without promoting a deploy. **No Cloudflare credentials exist on this machine** (checked: no CLOUDFLARE_API_TOKEN env, no wrangler OAuth config; `wrangler whoami` → "You are not authenticated") — deploy must be CI-gated on the secret or run after an interactive `wrangler login`.
- npm trusted publishing (OIDC, no long-lived token) available if packages are published `[V]` docs.npmjs.com/trusted-publishers.

### Seam 6 (audit round 1 addition): tooling & name-availability evidence
- **Name availability (verified this session)**: `registry.npmjs.org/seolite` → 404 (unregistered); `@seolite` scope → 404 (unregistered); `nitishagar/seolite` on GitHub → does not exist. Name is available on all three surfaces `[V]`.
- **One engine, two runtimes**: fetch/URL/TextEncoder are Workers baseline globals; `nodejs_compat` on by default with compat date ≥2026-08-04; unsupported Node APIs get polyfills that "noop or will throw" → a pure-TS engine using only web-standard APIs + a pure-JS HTML parser runs in both Node and Workers `[V]` developers.cloudflare.com/workers/runtime-apis/nodejs/.
- **HTML parsing in Workers**: `HTMLRewriter` is Workers-only (no Node); `linkedom` (0.18.13, pure JS) and `cheerio` (1.2.0, active, parse5-based) and `parse5` (8.0.1) run in both runtimes `[V]`; community caveat: cheerio CPU cost on large documents `[R]` — reinforces I6 (Worker stays thin).
- **robots parsing**: `robots-parser` (3.0.1, 2023) widely used but no release ~3.5 years; alternatives also stale `[V]` registry.npmjs.org — may warrant vendoring a minimal robots checker (plan-stage decision).
- **Worker testing**: docs recommend "For most projects, use the Workers Vitest integration for unit tests and the createTestHarness() API for integration tests"; new package `@cloudflare/vitest-plugin` requires Vitest ≥4.1; runs "fully-locally using Miniflare" — free CI compatible `[V]` developers.cloudflare.com/workers/testing/.
- **Docs SSG + search**: Eleventy / Astro / VitePress all emit plain static HTML deployable to Pages `[V]`; **Pagefind** post-build indexer adds a static client-side search bundle — "works with any static HTML output", no server needed `[V]` pagefind.app.
- **MCP prior-art resample (registry.modelcontextprotocol.io)**: 30 entries / 19 unique SEO servers exist (e.g., `com.calmseo/seo-mcp`, `com.gettransformseo/mcp` "128 tools", `ai.inxy/seo-audit`) — none sampled advertises a pluggable-provider free-only architecture; the differentiation is pluggability + honesty + free-only, not "first SEO MCP server" `[V]`.
- **Monorepo**: npm workspaces (built-in, `--workspaces` script fan-out) suffice for ≤5 TS packages; pnpm adds strict isolation + store; Turborepo adds caching/parallelization and can be adopted later without restructure `[V]`.

## Implicit Spec — invariants any design/plan for seolite must uphold
> Requirements, not designs. Bounding assumptions at the end.

- **I1 Zero-cost defaults** — every default code path uses only: self-fetching, or free official APIs, or BYOK providers the user explicitly configures. No paid API in any default path; no secret ever embedded in the repo. Edge: BYOK key absent → the provider is skipped with an explicit "not configured" result — never a crash, never a keyless call to an endpoint whose docs require a key (CrUX and PSI-with-key both documented as requiring keys for automated use).
- **I2 Pluggability at every data boundary** — all external data (SERP, keyword suggestions, page-speed, CWV, authority, LLM-visibility later) flows through a declared provider interface + registry; zero vendor calls outside providers. Swapping/adding a provider must not change CLI/MCP tool surface. Edge: unknown provider name in config → explicit config error listing available providers.
- **I3 Data honesty** — every metric in output carries provenance (source/provider) and, for gray-zone or heuristic values (autocomplete-derived ideas, Wikipedia-derived demand proxies, heuristic difficulty), a confidence/estimate label. Never present a heuristic as a Google-official number. Edge: provider failure → the field is omitted/marked unavailable, never zero-filled.
- **I4 Crawl etiquette** — robots.txt is respected by default (documented override), the User-Agent identifies the tool with a contact URL, requests to one host are rate-limited, crawls are bounded (page/depth/time budgets), and sitemaps are used for discovery when available. Edge: robots fetch failure → conservative default; 429/Retry-After honored.
- **I5 MCP-first parity** — every user-facing capability exists as (a) an MCP tool with namespaced name (`seolite_*`), (b) a CLI command, and (c) a thin REST route — all backed by the same core engine. MCP tool descriptions written for agents (high-signal output, concise/detailed response option). Edge: stdio and HTTP transports expose the identical tool set from one codebase.
- **I6 Worker stays thin** — anything deployed to Cloudflare Workers must fit free-tier limits (≤10 ms CPU, ≤50 subrequests): gateway/proxy/light endpoints only. Crawl-grade compute stays in local processes (CLI/stdio MCP/CI). Edge: a request that would exceed budget is rejected up-front with actionable guidance, not attempted and timed out.
- **I7 Look derived, not copied** — the site implements its own generic dark-first theme derived from the documented pi.dev token VOCABULARY (dark zinc palette family, single warm accent, system font stacks, mono labels, figure captions, theme toggle, client-side static search) with ORIGINAL name/logo/copy. No pi wordmark, taglines, section-title set, or assets. Concrete values (type scale, radii, accents) are chosen at plan stage. Site must have Auto/Light/Dark theming and respect `prefers-reduced-motion`.
- **I8 License & attribution** — Apache-2.0 LICENSE at repo root; per-file SPDX headers recommended; CrUX-derived data displayed anywhere carries CC BY 4.0 attribution; Tranco use carries its attribution; third-party marks referenced factually only.
- **I9 TDD gate** — every public behavior and spec edge has a test before merge; tests are deterministic (no live network, no dependence on real time); CI runs the full suite on every push; a phase is not done until build+tests+reviews are green.
- **I10 Determinism** — test runs and repeated identical operations produce identical outcomes; no behavior may depend on wall-clock time or live network state.
- **I11 Repo hygiene** — public repo under nitishagar, Apache-2.0; commit identity Nitish Agarwal `<1592163+nitishagar@users.noreply.github.com>`; no AI co-author trailers; docs site deploys from main via Actions.
- **I12 SSRF safety (audit round 1)** — the fetch layer must refuse private, loopback, link-local, and unique-local targets (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10), re-validate after every redirect hop, and accept only http/https schemes. Edge: DNS rebinding is out of scope for v1 (bounded assumption), but the block list is applied consistently everywhere user input reaches a URL.
- **I13 Output safety (audit round 1)** — crawled data (URLs, titles, HTML fragments) echoed to a terminal, written into HTML reports, or stored in files keyed by domain must be escaped/encoded and path-safe; no crawled content may execute as markup in the Pages site or corrupt local storage.
- **I14 Concurrency, cancellation, partial failure (audit round 1)** — crawls and batch operations have a global concurrency cap and per-request timeout; cancellation must stop work promptly; a report from an interrupted run must be labeled incomplete and must be resumable or safely re-runnable without duplicating side effects.
- **I15 Boundary inputs (audit round 1)** — defined behavior for: non-http(s) schemes, non-HTML content types, oversized pages/sitemaps (hard caps), redirect loops, empty bodies, IDN/unicode hostnames (normalized), malformed robots.txt and sitemaps, and config with unknown keys.
- **I16 Privacy / no telemetry (audit round 1)** — the tool sends no telemetry; the only outbound requests are the user-initiated queries themselves; docs state per-provider exactly what data leaves the machine; local history stays local unless a provider requires the query (stated per provider).
- **I17 Retry & backoff (audit round 1)** — every provider call has a timeout and bounded retry with exponential backoff + jitter, honoring Retry-After where present; failures surface as typed, actionable errors with the provider name attached.

**Bounding assumptions (explicit):**
- "Lightweight" = single-purpose monorepo, ≤5 packages, install-and-run in minutes, no server-side accounts/database service for core features; history/state stored as local files (JSONL/SQLite) — not a multi-tenant SaaS.
- MVP feature cut = rows marked SHIP/PLUGGABLE in Seam 1+3 table; OUT rows are non-goals until a free source exists (recorded as provider-SPI hooks).
- SERP position data is best-effort by nature free-only; users needing reliable ranks plug a BYOK provider. Gray providers are clearly labeled and cache aggressively.
- The user's Cloudflare account is reachable eventually via `wrangler login` or a CI secret; until then the Worker ships deployable-but-not-deployed and the site (Pages) + local MCP/CLI carry all functionality.
- Google autocomplete/DDG are gray: treat as best-effort, cache, honor 429s, and never as a contractual dependency.

## Evidence Ledger
| Claim | Evidence | Trust | Load-bearing |
|---|---|---|---|
| CrUX API free, 150 qpm, keyless-capable | developer.chrome.com/docs/crux/api (verbatim quota line) | V | yes |
| PSI API official free; key optional for trial | developers.google.com/speed/docs/insights/v5/get-started (verbatim) | V | yes |
| Google autocomplete unofficial JSON endpoint; 429/CAPTCHA at scale | fullstackoptimization.com spec + SO reports | V/R | yes |
| Wikimedia 200 req/min w/ UA w/ contact; 429+Retry-After | mediawiki.org/wiki/Wikimedia_APIs/Rate_limits (verbatim) | V | yes |
| DDG html/lite are gray, bot-protected, HTML-only | pypi duckduckgo-search reports + endpoint nature | V/R | yes |
| Programmable Search JSON API closed to new customers; 100/day | developers.google.com/custom-search/v1/overview (verbatim) | V | yes |
| Bing Search API retired 2025-08-11 | learn.microsoft.com lifecycle notice (verbatim) | V | no |
| No free backlink/clickstream source; CC index is captures not link graph | R2 analysis + commoncrawl.org ToU | V/R | yes |
| Open PageRank free ~1k req/day BYOK | domcop.com/openpagerank/documentation | R | yes |
| Workers free: 100k req/day, 10ms CPU, 50 subrequests | developers.cloudflare.com/workers/platform/limits/ | V | yes |
| createMcpHandler = recommended stateless remote MCP; McpAgent deprecated | developers.cloudflare.com/agents/.../transport (verbatim) | V | yes |
| MCP SDK: one McpServer serves stdio + Streamable HTTP | modelcontextprotocol.io + typescript-sdk README | V | yes |
| Cursor/VS Code/Claude Code onboarding deep-links | cursor.com/docs/mcp/install-links, code.visualstudio.com, code.claude.com/docs/en/mcp | V | yes |
| pi.dev design tokens (colors/fonts/scale/radii) | earendil-works/pi-website CSS (verbatim values) | V | yes |
| pi.dev trade-dress unsafe list | R3 analysis of live site + repo | V | yes |
| Apache-2.0: single LICENSE file sufficient; headers recommended only | apache.org/licenses + apply-license (verbatim) | V | yes |
| CrUX data CC BY 4.0 attribution duty | developer.chrome.com/docs/crux/methodology (verbatim; localized render caveat) | V | yes |
| CrUX API requires a Google Cloud API key (keyless claim REFUTED) | developer.chrome.com/docs/crux/api (verbatim, audit round 1) | V | yes |
| Open PageRank docs stale: Bearer auth, 60 req/min, monthly quota | openpagerank.keywordseverywhere.com/docs (live, audit round 1) | V | yes |
| Programmable Search API shuts down 2027-01-01 | developers.google.com/custom-search/v1/overview (audit round 1) | V | no |
| npm name `seolite` + `@seolite` scope unregistered; GH repo name free | registry.npmjs.org 404s + gh repo view, this session | V | yes |
| Shared pure-TS engine (web-standard APIs + pure-JS parser) runs on Node and Workers | developers.cloudflare.com/workers/runtime-apis/nodejs/ | V | yes |
| Workers tests run free locally via @cloudflare/vitest-plugin (Vitest ≥4.1) + Miniflare | developers.cloudflare.com/workers/testing/ (verbatim) | V | yes |
| Pagefind static client-side search works on any static HTML output | pagefind.app | V | yes |
| cheerio 1.2.0 / parse5 8.0.1 / linkedom 0.18.13 maintained, pure-JS, Workers-capable | registry.npmjs.org entries | V | yes |
| 19 unique SEO MCP servers exist; none sampled is a pluggable free-only toolkit | registry.modelcontextprotocol.io/v0/servers?search=seo | V | yes |
| npm workspaces sufficient for ≤5 packages; turborepo adoptable later | docs.npmjs.com/cli/using-npm/workspaces + turborepo docs | V | yes |
| Pages Actions deploy flow + build_type=workflow API | docs.github.com pages docs (verbatim snippets) | V | yes |
| Actions free for public repos | docs.github.com/billing (verbatim) | V | yes |
| wrangler-action@v4 + CLOUDFLARE_API_TOKEN secret; global key auth removed | github.com/cloudflare/wrangler-action (verbatim) | V | yes |
| No CF credentials on this machine | local checks + `wrangler whoami` output this session | V | yes |
| Lighthouse gatherer/audit plugin architecture; SiteOne CI exit-code gate | github repos READMEs | V | yes |

## Architecture Insights (descriptive, not prescriptive)
- The product shape the evidence supports: **engine core (TypeScript) + provider SPI** (AuditRule set, KeywordProvider, SerpProvider, PageSpeedProvider, CruxProvider, AuthorityProvider) + **three surfaces** (CLI, MCP stdio, MCP-over-HTTP Worker) + **static site**. All free tiers.
- Free-tier CPU (10 ms) forces the same split Semrush's own architecture implies: data acquisition where compute is cheap (local/CI), presentation/gateway in the edge Worker.
- MCP tool consolidation + namespacing guidance suggests few, high-signal tools (e.g., audit_site, page_report, keyword_ideas, rank_check, authority) rather than one tool per rule.
- Design language is fully reproducible from tokens without brand copying — and the "primitives/what-we-didn't-build" honesty ethos is itself a positioning fit for a tool that refuses to fabricate Semrush-class metrics.

## Coverage & Open Questions
- Searched: Semrush features (official pages), free data sources (official docs + community reports), pi.dev (live + source repo), MCP/Workers (official docs), licensing/CI (official docs), plus audit round 1 targeted discovery (tooling, name availability, MCP registry resample).
- Adversarial audit round 1 (separate agent, 11 web checks): 2 claims refuted and fixed (CrUX keyless → key required; Open PageRank stale auth/quotas), 1 addition recorded (Programmable Search 2027 shutdown), 8 modality gaps filled (names, tooling, MCP prior art), 7 missing invariant classes added (I12–I18), 4 design-smuggling fixes applied (I7/I9/I10 reworded to requirements; mechanisms deferred to plan).
- Deliberately bounded: no Semrush pricing analysis (not needed for a free alternative); concrete tool choices (SSG, monorepo runner, parser lib, test runner) are plan-stage decisions — evidence recorded above; DNS-rebinding-grade SSRF protection treated as out of scope for v1 (I12 bounding assumption); Open PageRank and DDG limits remain community-reported soft numbers.
- Residual risks: gray endpoints (autocomplete, DDG) can break/bot-block at any time — mitigated by I2/I3 (pluggable + honest degradation), not eliminated. Workers free-limit numbers change — re-verify at deploy time. Per-file Apache headers are a recommendation, not a legal requirement — the repo may skip them.
- Process note: red-team verification and TDD are process invariants owned by the orchestration pipeline (advisor checkpoint done; audit round 1 done; per-stage red-team reviews follow), not research seams.
