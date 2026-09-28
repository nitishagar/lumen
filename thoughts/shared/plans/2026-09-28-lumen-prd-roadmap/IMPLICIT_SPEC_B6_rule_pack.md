# IMPLICIT SPEC — Bundle 6 (E1.6 rule pack v2: integrity + site kind + E1.7 GEO pack + --only)

Source: PRD §6 E1.6 (FR-1..FR-3 + rule table + AC) + E1.7 (FR-1..FR-5 + AC); research Seam 1 (rules/report/robots-sitemap evidence) + HC3; tree @ d1f4dc5.

## What exists (facts the plan builds on)

1. Rule execution: 17 page rules run per fetched page (`runRules`); 3 crawl rules run ONCE post-crawl via `applyCrawlRuleIssues` over `CrawlIndex`; issues without `url` are silently DROPPED (run.ts:128-153) — every new crawl/site rule MUST set url (B4 made per-issue url universal for page issues at assemble; crawl-rule issues already carry url).
2. **Robots/sitemap evidence is DISCARDED today**: `policy` is a local in run.ts; `discoverSitemaps` returns URL[] only; CrawlResult/CrawlIndex carry NEITHER robots bodies nor sitemap bodies nor the parsed sitemap URL list — the `site` kind CANNOT see them without an evidence-retention change (research HC3, verified).
3. `robots-parser` retains UA-specific rules but lumen queries only its own UA — an AI-crawler matrix needs per-token queries against the SAME parsed robots (robots.ts) or a re-parse of the retained body (site-kind rules are audit-side; they can re-parse the retained raw body with robots-parser per token).
4. No JSON-LD handling anywhere (grep zero); no meta-refresh; no llms.txt; no `--only` filter; categories are opaque end-to-end (adding `ai-search` breaks nothing).
5. Sitemap caps exist (10 sources / 10 children / 10k URLs / 2 MB); XML via cheerio xmlMode — no entity-expansion hardening note (cheerio does not resolve external entities by default; billion-laughs internal entity expansion is the risk to bound — cheerio/parse5 does not process DTD entity definitions, verify + document).
6. External links: `OutLink.internal` flag exists; no fetch path for external links (fetcher SSRF guard + politeness would apply; opt-in flag `crawl.checkExternal` needs a config key + a capped, per-host-paced HEAD/GET loop — NEW outbound surface, must join no-telemetry reasoning as OPT-IN config, plus the polite defaults).
7. Scoring: `WEIGHT {error:10,warning:3,info:0}`; page score = max(0,100−Σ); site = mean. FR-3: site-kind issues attribute to the SEED page → scoring semantics unchanged.
8. Contracts: rules-reference table + anchors (site gate asserts every BUILT_IN id is an anchor); README "20 rules" prose patterns (contract-counts prose gate parses `\d+ built-in rule` etc.); RULES_CATALOG (mcp) parity gate pins ids/severities/helpUrls/fixHints; fixhint-gate battery asserts every rule emits with a hint; BUILT_IN_RULES registry; `builtInRuleMetadata`.
9. Plugin SPI: `AuditRule` (page check) + audit-local `CrawlRule` (checkCrawl) — a `SiteRule` kind is additive (new interface + registry plumbing + SPI version note).
10. `--only` flag (E1.7 FR-4): needs args flag + filter point (rule-set construction or run filtering) + help/docs; ALSO helps E1.2 grouping.

## Decisions inherited / made

- The `site` kind gets ONE new execution point with a `SiteContext` carrying RETAINED evidence: the raw robots body (+ fetch outcome), the discovered sitemap URLs + their raw bodies (already capped), the seed page's PageContext, and the audit config. Evidence retention is the load-bearing change (HC3); everything else consumes it.
- E1.7's ai-crawler matrix + llms.txt are SITE rules (they need robots.txt + an llms.txt fetch — the llms.txt fetch is a NEW same-origin request, bounded 2 MB, only when the rule is enabled via --only or always? DECISION: always run; it is one bounded same-origin GET, robots-politeness respected).
- `thin-content` threshold: `thresholds.thinContentMinWords` (default 200) — audit-owned thresholds object (existing pattern).
- `broken-external-link` default OFF via `crawl.checkExternal` (config key, default false) — the only rule that can be entirely disabled; cap `crawl.externalLinkCap` default 200.
- Vendored tables: AI UA list (with asOf + sourceUrl, recorded in configSnapshot provenance) and schema.org required-props table (versioned, in report provenance) live in audit as frozen literals with gate tests.
- 13 + 3 = 16 new rules → registry 20 → 36. All FR-1 contract surfaces move together.

## Success criteria (PRD ACs)

- Every rule: positive fixture, negative fixture, and the honest-unknown fixture where the table demands it (canonical-target unfetched → unknown; sitemap-url-nonindexable sample size stated; orphan only when complete).
- Swarm: ≥2 parser-robustness adversaries (JSON-LD size bomb, sitemap XML entity expansion) — bounded by caps, never crash.
- ai-crawler matrix from fixture robots files; UA list provenance (asOf/sourceUrl) in the report; docs disclaimer gated on the site.
- fixHint + helpUrl on all 36; rules-reference rows + anchors; README counts; catalog parity; contract-counts prose.
