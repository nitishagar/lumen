<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B6_rule_pack.md | Next: PLAN_B6_VALIDATION.md -->
# Bundle 6 — Rule pack v2: integrity + site kind + GEO + --only (E1.6 + E1.7)
scale: large

## Overview

Sixteen rules (13 integrity + 3 GEO), a third rule kind (`site`, running once against retained robots/sitemap/seed evidence), the `--only <category|ruleId,…>` filter, two vendored tables with provenance, the opt-in external-link check, and every contract surface (registry 20→36, rules-reference anchors, README counts, catalog parity, fixHint gate).

## Current State

(all [V] in IMPLICIT_SPEC_B6)

## Desired End State

`lumen audit` catches de-indexing integrity problems (structured data, canonicals, sitemaps, robots, hreflang, orphans, meta-refresh, security headers, thin content, opt-in external links) and answers AI-search readiness honestly (a robots matrix for vendored AI UAs with no training-policy advice, llms.txt with the unproven-impact disclaimer, raw-HTML content heuristics); `--only ai-search` runs just that category; all gates green.

## What We're NOT Doing

- No "rich result eligible" claims (parse errors only).
- No external-entity fetching in any parser (cheerio default; documented).
- No new providers; no `crawl.checkExternal` default-on (politeness).
- No `history prune`/E2.x scope.

## Approach

Phase 1 lands the `site` kind + evidence retention (the load-bearing seam) with 2 site rules; Phase 2 the page rules (7); Phase 3 the crawl rules (4 + opt-in external); Phase 4 GEO (3, incl. vendored UA table + llms.txt fetch); Phase 5 `--only` + contracts. Each phase leaves validate green.

## Design Analysis

- **Invariants → mechanism**: P-Honest (unknown ≠ pass; sample sizes stated; thresholds shown; heuristic labels; UA matrix never advises training policy; llms.txt disclaimer) → SiteContext carries raw evidence + outcomes so rules report `unknown` when evidence is missing; provenance (tables' versions, UA asOf) rides configSnapshot; P-Locked-Contract → registry/rules-reference/README/catalog/fixhint-gate/snapshots in the same changes; parse robustness → every new parser path bounded by existing body caps + per-rule element caps (JSON-LD blocks capped at 50, sampled bytes counted; sitemap sampling documented).
- **Failure edges**: robots fetch failed → site rules report unknown (matrix `unknown`, robots-invalid skipped); sitemap absent → sitemap rules unknown/not-run (never "pass"); canonical-target fetch budget — sample ≤10 canonical targets within the crawl's existing fetched set + statusOf (NO extra fetches: judge from what the crawl ALREADY fetched; unfetched → unknown — keeps the rule local-evidence-only per PRD "fetched within the budget"); sitemap-url-nonindexable samples ≤25 sitemap URLs already IN the crawl index (no new fetches; the sample size is in the message); orphan-page only when `incomplete === false`; external-link HEAD then GET-on-405, per-host pacing via the existing rate limiter, cap default 200.
- **Simplicity guardrails**: SiteContext is a plain interface (no class); vendored tables are frozen literals + parity/version gates; no deps.
- **Blast radius**: run.ts (evidence retention + site-rule execution point + --only filter), types.ts (SiteRule, SiteContext, thresholds += thinContentMinWords, config += crawl.checkExternal/externalLinkCap), core config.ts (2 crawl keys), rules/* (16 new rule factories + registry rows), score attribution (site issues appended to the SEED page's issues pre-score? — NO: score computed per page from its issues; site issues attributed by appending them to the seed PAGE's issue list at assemble-time with a `siteRule: true` marker? Simpler and FR-3-conformant: append site issues to the seed page's issues BEFORE scoring (they carry url = seed) — scoring semantics unchanged, byRule grouping sees them naturally), mcp RULES_CATALOG += 16 entries (parity gate), rules-reference rows, README 20→36 prose, cli --only flag + help, no-telemetry unchanged (external check is config-gated; the no-telemetry suite runs without that config).
- **Interrogation**: *What could break?* (a) registry count gates everywhere (contract-counts prose, rules-reference "The 20 rules" prose, README, catalog length parity, fixhint battery ids) — enumerated in Phase 5; (b) assemble byRule + SARIF render 20→36 automatically (catalog-driven); (c) evalite tool-list untouched; (d) external-link check adds an outbound surface — must NOT run in no-telemetry (config-gated) and is paced/capped; (e) thin-content word counting on cheerio text — CJK caveat documented. *Riskiest*: evidence retention in run.ts — earliest check: site-rule unit tests over a fixture crawl with robots/sitemap evidence. *Options not taken*: fetching canonical/sitemap targets inside rules (rejected: local-evidence-only, honest unknown); a per-rule enable map (rejected: --only + the single opt-in config key cover it).
- **Verification design**: per-rule positive/negative/unknown fixtures (PRD AC); parser-robustness unit tests (JSON-LD bomb = one 2 MB script block with 10k keys; XML entity expansion doc); matrix fixtures per UA group; --only filter matrix (category, ruleId list, unknown → UsageError); contracts gates.

## Phase 1: site kind + evidence retention + 2 site rules

### Changes
#### `packages/audit/src/types.ts`
`SiteContext { seed: PageContext-like; robots: { body: string | null; fetchOutcome: 'ok'|'absent'|'unreachable'|'disallowed' }; sitemaps: { url: string; body: string | null; outcome: 'ok'|'malformed'|'skipped' }[]; sitemapUrls: string[] (discovered, capped); config: ResolvedAuditConfig; signal? }`; `SiteRule { id; severity; categories; checkSite(ctx): Issue[] }` (issues MUST carry url = seed href).
#### `packages/audit/src/run.ts`
Retain the robots raw body + fetch outcome (the gate already fetches robots once); retain sitemap raw bodies + outcomes from discovery (caps already enforced); build SiteContext post-crawl; run site rules once; append their issues to the SEED page's report row pre-scoring (FR-3).
#### Rules (site): `sitemap-invalid` (malformed XML, >50k URL claims from the body we saw, wrong host), `robots-invalid` (unknown directives, Disallow: / on the seed host when production-scope, sitemap line 404s among RETAINED outcomes).
### Success Criteria
- [ ] Site-rule fixtures green (positive/negative/unknown); scoring attribution test (site issue moves the seed page score, not others).

## Phase 2: page rules (7)

`structured-data-invalid` (JSON-LD parse + @context schema.org; ≤50 blocks, ≤2 MB cumulative), `structured-data-required-props` (vendored versioned table for Article/Product/Organization/BreadcrumbList/FAQPage/LocalBusiness — minimal required props), `meta-refresh-redirect`, `security-headers` (HSTS-on-https, XCTO, CSP presence), `twitter-card-missing` (only when OG present), `thin-content` (word count < thresholds.thinContentMinWords, default 200; threshold in message; CJK caveat in fixHint), `content-in-raw-html` (GEO, warning, heuristic label — SPA-shell signature: root-ish empty container + <N words).
### Success Criteria
- [ ] Fixtures per rule; JSON-LD size-bomb unit test (2 MB block → one issue, no hang); required-props table version in configSnapshot.

## Phase 3: crawl rules (4 + opt-in external)

`canonical-target-invalid` (judged from ALREADY-FETCHED targets via CrawlIndex.statusOf; unfetched → unknown via a message-level note? NO — a canonical pointing to an unfetched URL simply does not fire (never fetched → never judged, existing honesty pattern) — the rule fires on non-200/redirect-chain/noindex/cross-host AMONG FETCHED targets), `sitemap-url-nonindexable` (sample ≤25 sitemap URLs that ARE in the crawl index; non-200/noindex/canonical-elsewhere; sample size in message), `hreflang-reciprocity` (return tags, self-reference, valid lang/region codes — upgrades hreflang-present), `orphan-page` (sitemap URLs no crawled page links to; only when !incomplete), `broken-external-link` (opt-in crawl.checkExternal; HEAD→GET on 405; per-host paced via the crawler's limiter; cap crawl.externalLinkCap default 200; cap in message).
#### `packages/core/src/config.ts` + types + docs
`crawl.checkExternal` (boolean, default false), `crawl.externalLinkCap` (int ≥1, default 200) — 4 registration sites.
### Success Criteria
- [ ] Fixtures incl. never-fetched-never-judged; external-check politeness test (paced, capped, OFF by default; no-telemetry suite unaffected).

## Phase 4: GEO site/page rules + vendored tables

`ai-crawler-access` (site, info): vendored AI UA list `{ asOf: '2026-09-01', sourceUrl }` (training: GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended, Bytespider; retrieval: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot) → per-token robots query (robots-parser re-parse of the retained body per token) → matrix in ONE issue message (+ evidence listing blocked retrieval bots); flags ONLY blocked-retrieval; matrix provenance (asOf/sourceUrl) in configSnapshot. `llms-txt` (site, info): one bounded same-origin GET (≤2 MB; robots-polite), checks H1+blockquote summary+link lists shape (llmstxt.org), sampled link resolution ≤5 from RETAINED crawl outcomes; message carries the "unproven proposal" disclaimer text. Docs: "What lumen does and doesn't claim about AI search" section (site gate asserts the disclaimer string).
### Success Criteria
- [ ] Matrix fixtures (blocked training vs blocked retrieval vs mixed); UA provenance in report; docs disclaimer gate.

## Phase 5: `--only` + contracts

`--only <category|ruleId,…>` on audit (filter BEFORE rule-set execution; unknown category/ruleId → UsageError listing valid ones; note: `--only` does not disable the robots gate/budgets). Contracts: BUILT_IN_RULES 36 rows; RULES_CATALOG += 16 (parity); rules-reference 36 rows + anchors + ai-search section + AI-disclaimer section; README "20 rules" → 36 (prose gate patterns); cli-reference --only row; help + snapshots; fixhint battery extended to emit all 36; config docs (checkExternal/externalLinkCap/thinContentMinWords).
### Success Criteria
- [ ] `--only ai-search` runs exactly the 3 GEO rules; `--only title-missing,viewport-meta` works; unknown → exit 2.
- [ ] `npm run validate` green (all count/parity/anchor gates updated together).

## Testing Strategy

- Per-rule positive/negative/unknown fixtures (PRD AC) — one describe per rule.
- Parser robustness: JSON-LD bomb, sitemap entity-expansion doc test (cheerio does not resolve DTD entities — assert no expansion occurs on a crafted body).
- Matrix + provenance tests; --only matrix; external-link pacing/cap/off-by-default.
- Contract gates: contract-counts prose, anchors, catalog parity, fixhint battery, snapshots, no-telemetry.

## Amendments

(empty at authoring)

## References

- PRD §6 E1.6 (table + FR-1..3 + AC) + E1.7 (FR-1..5 + AC)
- Research: Seam 1 (rules/report/evidence), HC3 (site kind), allowlist/politeness edges
- Conventions: rule factory pattern, EVIDENCE_CAP overflow, `links.ts` honesty idioms

## Amendments (pre-implementation, from PLAN_B6_VALIDATION 2026-09-28 — validator agent_e49569aa)

- AMENDED Phase 3/4 [C1, Critical]: rules CANNOT fetch — `checkCrawl` is sync and receives only the index; the fixhint battery drives rules synchronously. Both fetch loops hoist into `run.ts` (which owns deps/limiter/signal): external-link outcomes recorded index-style; `/llms.txt` body+outcome retained into `SiteContext.llmsTxt`. Rules stay pure/fixture-testable.
- AMENDED [C2, Critical]: `CrawlIndexEntry` += `meta?: { noindex?: boolean; canonicalHref?: string }`, populated in the crawler's recordPage (dom in scope) — canonical-target-invalid and sitemap-url-nonindexable get their data source.
- AMENDED [C3, Critical]: `applyCrawlRuleIssues` context += `incomplete` (run.ts holds result.stop) — orphan-page's only-when-complete gets its input.
- AMENDED [I1]: the AC's "unknown fixture" mechanism is defined: (a) canonical-target-invalid emits an INFO-grade "canonical target not crawled — not judged (judged N/M)" for same-origin unfetched targets (severity-divergence precedent exists); cross-host unfetched stays silent; (b) site rules carry unknown in the message; (c) for all other rules the unknown fixture ≡ assert-no-emission under missing evidence (recorded AC interpretation).
- AMENDED [I2]: robots outcomes are `ok | absent | bypassed` (gate errors THROW before site rules — unreachable/disallowed can never reach them; bypassed = respectRobots:false, matrix unknown); sitemap outcomes += `fetch_failed | oversized`.
- AMENDED [I3]: seed-row fallback — when no seed row exists (dropped at the post-wait budget check), site issues go to the FIRST AUDITED page's row; when there are no audited pages at all, they surface via a discovery warning (summary-level visibility) instead of being silently dropped.
- AMENDED [I4]: Phase 5 contract list += CHANGELOG 0.3.0 "18 → 20" line (unreleased — amend to the new count), site locked-names test `toBe(20)` → registry-driven, cli render.test `toHaveLength(20)` → catalog-driven, stale "20" prose in audit README + mcp onboard.ts + site index.astro + quickstart, locked-names cliFlags += `--only`.
- AMENDED [I5]: the AI matrix re-parse goes through a NEW core export (`robotsMatrix(body, url, tokens)`) — robots-parser stays behind core's wrapper; audit gains no new dependency.
- AMENDED [I6, AC reinterpretation recorded]: the swarm drives canned fixture reports and can never parse hostile bodies — parser-robustness adversaries are exercised as unit tests over the REAL engine (JSON-LD size bomb, sitemap entity expansion — cheerio verified NOT to expand DTD entities) + `adversaries.json` entries documented as such; the PRD AC's intent (bounded, never crash) is met by the unit lane.
- AMENDED [M1]: the UA matrix issue compacts the matrix (token:allowed/blocked/unknown per line, ≤300 code points via a compact notation); M2: the >50 MB clause is expressed honestly as "beyond lumen's 2 MB evidence cap"; M3: SiteContext.seed typed to the fields that survive (url/status); M4: plugin SPI gains the site kind additively (SiteRule in audit-local types + a core SPI version note in the plugin docs/CHANGELOG); M5: hreflang-present STAYS (absence-only) — reciprocity fires on defective presence.

## Amendments (implementation, 2026-09-28)

- AMENDED Phase 1 [factual, honesty-semantics]: `sitemap-invalid` does NOT fire on absent sitemap evidence (a site without a sitemap is valid — absence is not `sitemap-invalid`); it fires on malformed/oversized/fetch-failed (fetch-failed = unknown message)/count/host findings. `robots-invalid` fires its unknown ONLY on `bypassed` (respectRobots:false); absent robots (4xx) is a valid state → silent. `ai-crawler-access` on ABSENT robots reports the honest RFC 9309 allow-all matrix (not unknown); unknown only on bypassed.
- AMENDED Phase 3 [factual]: `broken-external-link` outcomes ride via `RuleContext.siteEvidence.externalOutcomes` (fetched in run.ts: HEAD → GET on 405, per-host paced, capped); the rule is pure. `hreflang-reciprocity` reads per-page hreflang pairs retained in `index.metaOf(url).hreflang` at record time (the DOM does not survive the crawl).
- AMENDED Phase 5 [factual]: the SARIF renderer's rule list is catalog-driven — the mcp RULES_CATALOG grew to 36 (parity test order-insensitive; dynamic-hint rules pin the catalog PREFIX, e.g. security-headers/thin-content); registry payloads (server.json description + snapshots) updated 20→36; site gates registry-driven; AI-UA provenance rides configSnapshot.discoveryWarnings (`ai_crawler_uas_asOf/source`).
- Evidence: full `npm run validate` green — 104 files / 1122 tests + cli-smoke; rule-pack-acceptance.test.ts (10): --only matrix, unknown fixtures, AI-matrix semantics, UA provenance, JSON-LD bomb bounded, sitemap entity-expansion inert.

## Amendments (post-review, 2026-09-28 — reviewer agent_c5cede1d)

- FIXED (C1): hreflang-reciprocity false-positived on `x-default` (the most common pattern) — x-default is now valid and exempt from self/return checks.
- FIXED (I2): the external-link check has engine-level tests — off-by-default, cap bounds fetches (cap 1 with 2 links → 1 finding), 5xx flagged.
- FIXED (I3): the JSON-LD bomb test is real now (1.5 MB payload under the body cap) — plus a new oversized-BLOCK flag (`> MAX_JSONLD_BYTES` → "contents not judged") and a parse-error pair test.
- FIXED (I4): UA sourceUrl points at the vendored module (docs/ai-crawlers.md never existed).
- FIXED (I5): configuration.astro documents checkExternal/externalLinkCap/thinContentMinWords; the stale "everything else is fixed" claim corrected.
- FIXED (I6): --only no longer hard-fails on standing severity overrides for unfiltered rules (validation shims over the UNFILTERED registry; filtered specs execute).
- FIXED (I7): --only filters plugin rules too (extraSpecs; plugins aren't --only tokens but a filtered run must not execute them).
- FIXED (M8-M19): sample header → info; oversized sitemap = one evidence row (truncated text never judged 'ok') + probe-path evidence; byte-cap/block-cap truncation notices; compact matrix message with per-token snippet in evidence; dead honesty branches removed; X-Robots-Tag noindex retained in meta; stale counts (audit package.json, rule-set comment, fixhint title); CHANGELOG [Unreleased] entries + SPI site-kind note; abort warnings for the llms/external loops; --only validated BEFORE any network fetch (rule-set construction hoisted above the gate); visibleWordCount uses a detached clone; acceptance warts fixed (non-empty --only assertion, orphan positive case, entity non-expansion).
- Evidence: full `npm run validate` green — 104 files / 1126 tests + cli-smoke.
