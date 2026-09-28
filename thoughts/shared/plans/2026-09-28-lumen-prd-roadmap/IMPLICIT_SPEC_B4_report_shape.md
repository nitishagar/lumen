# IMPLICIT SPEC — Bundle 4 (E1.2 actionable findings + E1.3 baseline/diff: ONE report-shape migration)

Source: PRD §6 E1.2 + E1.3 (+D2); research Seam 1 (report shape/sanitize/fixHint census) + Seam 3 (exit gate/history); verified against tree (B3 working tree).

## What exists (facts the plan builds on)

1. Report shape: `{ id, startedAt, completedAt, pages[{url, status, issues[], skipped?, robotsAllowed, timingMs, bytes, redirectChain}], summary { countsBySeverity, score, pagesAudited, pagesSkipped, byRule: Record<string,number>, ruleErrors? }, incomplete, configSnapshot { seed, target.scope, crawl, respectRobots, renderer, thresholds, maxBodyBytes, rules, discoveryWarnings }, stopReason }` — `assemble.ts`.
2. `Issue = { ruleId, severity, message, evidence{selector?,snippet?}, fixHint?, url? }` (core/issues.ts). `url` exists only on crawl-level issues; PAGE-level issues carry no `url` today (E1.2 FR-3 gap).
3. `sanitizeIssue` explicit allowlist `{ruleId, severity, message, evidence{selector?,snippet?}, url?, fixHint?}` — a new per-issue `helpUrl` is silently stripped unless allowlist + Issue type + renderers move in the SAME change (research-refuted pitfall).
4. fixHint census: 19 hints across 18 rules; `status-error` and `robots-noindex` have NONE (E1.2 FR-4 20/20 gate is a real gap). Rule ids are the stable anchors: `…/docs/rules-reference/#<ruleId>`.
5. MCP concise: `topIssues: issues.slice(0,10)` unsorted (server.ts:439-444); CLI human summary also slices 10 unsorted (cmd/audit.ts humanSummary). D2 (recorded owner decision, recommendation (b)): concise returns `topRules` (≤10 groups) INSTEAD of `topIssues` — breaking, front-loaded in 0.4.
6. `summary.byRule: Record<string, number>` (counts) exists — the PRD's new `summary.byRule[]` array REPLACES it (same name, different shape; 0.x breaking discipline).
7. Ranking comparator (E1.2 FR-1): severity (error>warning>info) → affected pages desc → ruleId asc. Shared by CLI human output, MCP topRules, and later SARIF/md (B5).
8. Fingerprint (E1.3 FR-1): `sha256(ruleId + normalizedUrl + evidence.selector?)` — normalization MUST reuse the frontier's `normalizeKey` (WHATWG href, fragment stripped, punycoded host, lowercased) — the one normalizer in the repo (research-pinned). Message text deliberately excluded.
9. History: `AuditHistoryEntry` is a DIGEST (url, score, counts — no issues, no fingerprints); `HistoryStore {append,list}` is LOCKED. `--from-history` for E1.3 FR-4 has NO data source — honest scoping required (deviation recorded; revisit v0.5).
10. Exit gate: `report.incomplete || countIssuesAtOrAbove(issues, threshold) > 0` — any baseline gate must keep incomplete failing (FR-5) and add the "comparison is partial" hint.
11. CLI contract surface: COMMAND_NAMES 9 (after B3); new `lumen diff` → 10; flag tables string|boolean only; help snapshots; locked-names cliCommands/cliFlags; contract-counts derives from source; no-telemetry case array must gain `diff`; site cli-reference/quickstart gates.
12. Eval harness: `packages/mcp/src/evals/` evalite cases (tool-contract, swarm-scoreboard) — concise-payload ≤4 KB (FR-6) needs a NEW size-scorer/observation (none exists today).
13. `writeFileAtomic` (cli) exists for `--update-baseline` atomicity. Baseline file: `{ version: 1, fingerprints: string[] sorted, writtenAt, seed }`.

## Decisions inherited

- E1.2+E1.3 land as ONE contract change (HC2): both mutate the report shape, sanitize allowlist, and the same gates.
- D2: `topRules` REPLACES `topIssues` in concise payloads (breaking change in 0.x, owner-recommended option (b), recorded in the PRD as the working decision).
- Baseline is CLI-only in v0.4 (PRD E1.3 FR-6 — no MCP filesystem paths).
- P-Honest: affectedPages counts only AUDITED pages; `fixed` claims restricted to pages audited this run; pages not audited → `unknown`, never "fixed".

## Deviation from PRD (recorded, owner-visible)

- E1.3 FR-4's `--from-history <n>` is DEFERRED: the audit history kind stores a digest without issues/fingerprints (verified), the HistoryStore port is LOCKED, and back-filling would bloat the 1 MiB-rotation JSONL. `lumen diff <a.json> <b.json>` ships fully; `--from-history` is recorded in the ledger + CHANGELOG as deferred to v0.5.
