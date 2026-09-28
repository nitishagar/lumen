# HANDOFF LEDGER — Bundle 6 (E1.6 rule pack v2 + E1.7 GEO + --only)

Plan: PLAN_B6_rule_pack.md — validator agent_e49569aa FAIL → 3C+6I+5M amendments folded (rules-don't-fetch hoisting, CrawlIndex.meta, incomplete ctx, unknown-fixture mechanism, outcome vocab, seed-row fallback, contract enumeration, core robotsMatrix, AC reinterpretation).
Scale: large (5 phases, each validate-green).

## Position

- Phase 1 (site kind + evidence retention): DONE — RobotsGateResult.evidence, SitemapDiscovery evidence, SiteContext/SiteRule, run.ts execution point + seed attribution (fallback first-audited → discovery warning), llms.txt fetch in run.ts.
- Phase 2 (7 page rules): DONE — integrity.ts (structured-data ×2 with vendored SCHEMA_REQUIRED_PROPS table + caps, meta-refresh, security-headers, twitter-card, thin-content threshold, content-in-raw-html heuristic).
- Phase 3 (crawl rules): DONE — integrity-crawl.ts (canonical-target with unknown-info, sitemap-url-nonindexable with sample header, hreflang-reciprocity via retained meta.hreflang, orphan-page via incomplete ctx, broken-external-link via siteEvidence outcomes); fetch loops in run.ts (HEAD→GET 405, paced, capped); CrawlIndexEntry.meta {noindex, canonicalHref, hreflang} retained at recordPage.
- Phase 4 (GEO): DONE — ai-search.ts (ai-crawler-access matrix w/ RFC-9309 absent semantics + never-advises; llms-txt w/ disclaimer), core robotsMatrix export, AI_CRAWLER_UAS vendored (asOf+sourceUrl → report provenance).
- Phase 5 (--only + contracts): DONE — AuditConfig.only → createRuleSet filter (ConfigError lists valid tokens), --only flag through args/adapter/audit cmd, RULES_CATALOG 36 (prefix-parity for dynamic hints), rules-reference 36 rows + AI-disclaimer section, prose 20→36 everywhere (README ×3, audit README, onboard.ts, site index, quickstart, CHANGELOG), locked-names --only, help + snapshots, server.json sync.
- Validate: GREEN — 104 files / 1122 tests + cli-smoke; rule-pack-acceptance 10/10 (PRD ACs).

## Decisions

- Fetch loops live in run.ts (rules stay pure); /llms.txt retained into SiteContext.
- CrawlIndexEntry.meta {noindex, canonicalHref} populated at recordPage.
- canonical-target-invalid: info-grade "not judged (N/M)" for same-origin unfetched; cross-host silent.
- robots outcomes: ok|absent|bypassed; sitemap: ok|malformed|fetch_failed|oversized|skipped.
- Seed-row fallback: first audited page; none → discovery warning.
- core.robotsMatrix(body,url,tokens) — parser stays wrapped.
- Registry 20→36; ALL count surfaces move together (CHANGELOG 0.3.0 line, locked-names toBe(20), render.test 20, prose in 4 files).

## Hypotheses

(none yet)

## Confusion

(none yet)

## Open

- (none)

## Review

- Implementation review: agent_c5cede1d — FAIL (1C: x-default hreflang false-positive; 6I: untested external loop, vacuous JSON-LD bomb test, dead sourceUrl URL, missing config docs, --only×overrides hard-fail, --only ignores plugins; 12M) → ALL fixed (see PLAN amendments) → validate re-green 104 files / 1126 tests.
