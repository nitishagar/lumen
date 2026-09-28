# PRD Roadmap Ledger — 2026-09-28 lumen next features (v0.3 → v0.6)

> Master state tracker for implementing every epic in
> `thoughts/shared/specs/2026-09-28-lumen-next-features-prd.md` (baseline `main` @ 3ae6113).
> Updated as work progresses; newest entries at the bottom of each table.
> Per-bundle detail lives in each bundle's `HANDOFF_LEDGER.md`.

## Workflow

```
research_codebase_generic_v2_7 → RESEARCH (this bundle) → per-bundle: create_plan_generic_v2_7 → implement_plan_v2_7
```

Artifacts:
- Research doc: `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md`
- Verification surface: `thoughts/shared/VERIFICATION_SURFACE.md`
- Plan bundle: `thoughts/shared/plans/2026-09-28-lumen-prd-roadmap/` (this dir)

## Epic state

| Epic | Desc | Pri | Bundle | State |
|---|---|---|---|---|
| E0.1 | Public availability + link integrity | P0 | 1 | code-complete (owner-gated: visibility flip) |
| E0.2 | Release v0.3.0 from main | P0 | 1 | code-complete (owner-gated: npm token + tag) |
| E0.3 | Distribution: MCP Registry, .mcpb, plugin, dirs | P0 | 1 | code-complete (owner-gated: registry/dirs) |
| E0.4 | First-run: `lumen init` + `lumen doctor` | P0 | 2 | code-complete (reviewed; validate green) |
| E1.1 | Audit local/preview targets (`--allow-private`) | P1 | 3 | code-complete (security review PASS) |
| E1.2 | Actionable findings (ranked/grouped/fixHint) | P1 | 4 | not-started |
| E1.3 | Baseline and diff gate | P1 | 4 | not-started |
| E1.4 | CI-native outputs (SARIF/md/Action) | P1 | 5 | not-started |
| E1.5 | MCP prompts and resources | P1 | 5 | not-started |
| E1.6 | Rule pack v2 (integrity, 13 rules + site kind) | P1 | 6 | not-started |
| E1.7 | AI-search readiness pack (GEO) | P1 | 6 | not-started |
| E2.1 | GSC provider | P2 | 7 | not-started |
| E2.2 | Bing Webmaster + IndexNow | P2 | 7 | not-started |
| E2.3 | Trends + shareable reports | P2 | 8 | not-started |
| E2.4 | Plugin ecosystem | P2 | 8 | not-started |
| E2.5 | Gateway hardening | P3 | 8 | not-started |
| H | Hygiene items (§8, P0–P2) | mixed | 1,6,8 | P0 rows done in B1; P1/P2 rows pending |

Bundle staging (advisor-reviewed 2026-09-28): S1 release-train · S2 first-run · S3 private-targets (security review = blocking gate) · S4 report-shape migration E1.2+E1.3 as ONE contract change · S5 CI outputs + MCP prompts · S6 rule pack + GEO · S7 first-party providers · S8 reports/plugins/gateway + hygiene tail.

## External/credential gates (blocked on user)

| Item | Needs | State |
|---|---|---|
| Repo visibility flip (D1) | owner decision (outward-facing) | pending ask |
| npm publish v0.3.0 | npm account/token (whoami → E401) | pending ask |
| MCP Registry publish | GitHub OIDC via CI (no manual cred needed) | to verify |
| Directory listings (Glama/Smithery) | owner accounts | pending ask |
| GSC / Bing keys | owner's own BYOK keys (not needed for dev) | n/a for build |

## Progress log (append-only)

- 2026-09-28 — Oriented: PRD + prior research (2026-09-16 feature inventory) + v2.7 commands read fully. Repo `~/repos/learn/lumen` on `main` @ 3ae6113 (PRD baseline), clean except untracked `evals/` + `thoughts/shared/specs/`. PR #37 confirmed merged (20 rules in tree). gh authed (nitishagar), npm NOT authed.
- 2026-09-28 — Research phase COMPLETE. Artifacts: `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md` (scale: large), `thoughts/shared/VERIFICATION_SURFACE.md` (new, durable). Process: 1 advisor checkpoint (12-line cap; led to 5-seam merge + restructure of bundle staging: E1.2+E1.3 as one report-shape plan, E1.1 standalone with security gate) → 5 discovery agents (batched 2/2/1) → synthesis → adversarial audit (SAMPLED-REFUTAL-RATE 3/25; fixes applied: fixHint census corrected (status-error + robots-noindex lack hints), sanitize allowlist strips helpUrl unless allowlist+Issue+renderers move together, `--from-history` has no data source (AuditHistoryEntry is a digest), config-key registration sites enumerated, fingerprint normalization pinned to url-normalize, ≤4KB size oracle gap flagged, HC2 reworded as fact-not-batching, D2 kept open). Research doc now authoritative for planning.
- 2026-09-28 — Bundle 1 (E0.1+E0.2+E0.3+hygiene-P0) IMPLEMENTED + reviewed. Full validate green (87 files/975 tests + cli-smoke). Implementation review PASS (agent_57c26dc9; 2 Important fixed: real payload↔server.json anti-drift oracle in onboard.test.ts via fs, 403 added to HEAD fallback list); test review PASS (agent_e98b5a9f; 2 Important fixed: 8-URL concurrency bound test, main() exit-code seam with 3 contract tests). Distribution artifacts live: server.json, mcpb/, .claude-plugin/marketplace.json, plugin-lumen/ (seo-check skill); `lumen mcp --print` 7 targets; contract-counts drift gate; onboard-artifacts shape gate; weekly link-check workflow; release.yml + registry/mcpb jobs + npm-version drift step; PR template + CHANGELOG [Unreleased]/[0.3.0]; docs/distribution.md runbook. Factual amendment: publish-workspaces.mjs nested node_modules filter (pre-existing validate red at baseline, verified in worktree @ 3ae6113). Next: Bundle 2 (E0.4 init/doctor).
- 2026-09-28 — Bundle 2 (E0.4 init/doctor) IMPLEMENTED + reviewed + committed. Session-recovery: prior session degraded mid-implementation; its uncommitted tree was AUDITED (not trusted) — diffs reviewed line-by-line, typecheck + CLI suite + validate green before extending. Completed: missing init.test.ts (14) / doctor.test.ts (14) / authority.test.ts (3) + report hint tests (2); quickstart first-run section; doctor `providersOverride` test seam (plan amendment). Full validate green (90 files/1008 tests + cli-smoke + lint). Implementation review (agent_82af9aef): FAIL 1C+2I+7M → ALL fixed — C1: FR-3 doctor hints were dead code for `authority` (skip-rule early-return returned before the hint; empty-byok default makes composition wire the provider which then fails with NotConfiguredError → rendered `unavailable`, hint ignored; same hole in `report`) — both commands now key the hint on the typed outcome, human-output only; I1 hint tests; I2 init typed missing-dir/non-writable-dir UsageError + tests; M1 doctor distinguishes missing config file (JSON `config.exists:false`); M2/M3/M5/M7 fixed; M4/M6 factual plan amendments. HYGIENE NOTE (pre-existing seam, deferred): `effectiveByok` falls back to capability-keyed DEFAULT_BYOK_ENV_NAMES while `byokReady` looks up provider names — with empty config.byok the composition skip rule silently defers to provider-level NotConfiguredError (honest degradation, but inconsistent with the init-written provider-keyed byok shape). Next: Bundle 3 (E1.1 --allow-private, SECURITY REVIEW = blocking gate).
- 2026-09-28 — Bundle 3 (E1.1 --allow-private) IMPLEMENTED + security-reviewed + committed. Flow: IMPLICIT_SPEC + PLAN authored from research Seam 2 → validator agent_3269b323 (round 1 FAIL: C1 allowIp(host,ip) signature couldn't enforce origin scoping — same-host/different-port redirect bypass; I1 corpus expectation factually wrong; I2 worker gate vacuous under minification; I3 target.scope under-labels DNS seeds; 6M) → amendments → round 2 PASS (3 mechanical fixes folded). Implementation: core private-scope.ts (pure policy factory, origin-gated, /0 refusal, hostname grammar), fetcher `allowPrivate?` seam (default byte-identical), `crawl.allowPrivateHosts` config key (4-site contract), per-run seed policy in audit runner + pageMeta (fetcher-in-fetch), perHostMinDelayMs→0 on loopback seeds, `target.scope` honesty label, `--canonical-origin` insecure-http suppression, flags on audit/report/mcp, MCP launch-time-only scope (no tool arg), worker source ban (bundle-scan), swarm corpus case, spawn e2e on a REAL loopback server (7 AC tests). SECURITY REVIEW (BLOCKING) agent_4674554c round 1 FAIL: **C1 robots/sitemap legs lacked redirect:'manual' — undici followed redirects natively, bypassing the guard AND the policy (pre-existing strict-mode hole too)**; I2 v4 CIDR sign bug (≥128.0.0.0 ranges dead); M3/M4/M6 minors → all fixed (manual redirect at 5 sites, >>>0 bounds, hostname grammar, docs) → round 2 **PASS "Ship it."** M5 accepted (DNS-name-resolving-loopback labels 'public' — hostname-based honesty edge). FakeFetcher pageCalls() redefined (manual-redirect minus robots/.xml infrastructure). Full validate 94 files / 1047 tests + cli-smoke. Next: Bundle 4 (E1.2+E1.3 report-shape migration as ONE contract change) — spec + plan authored, validation pending.
