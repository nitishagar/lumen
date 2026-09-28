<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B4_report_shape.md | Next: PLAN_B4_VALIDATION.md -->
# Bundle 4 — Actionable findings + baseline/diff (E1.2 + E1.3, one report-shape migration)
scale: large

## Overview

Migrate the audit report shape in ONE change: every issue carries `url` + `fixHint` + `helpUrl`; `summary.byRule` becomes a sorted group array (`ByRuleGroup[]`); MCP concise returns `topRules` (≤10 groups) instead of `topIssues` (D2); CLI human output groups by rule with fixes and `--verbose`; fingerprints + `--baseline`/`--update-baseline` + `lumen diff` with new/existing/fixed sections and an incomplete-fails-gate rule; fixHint coverage gate 20/20; concise ≤4 KB observed by a new eval size case.

## Current State

(all [V] from IMPLICIT_SPEC_B4)

## Desired End State

`lumen audit` human output groups findings by rule with `→ fix:` lines; the JSON report carries per-issue provenance (`url`, `fixHint`, `helpUrl`) and `summary.byRule[]` groups; MCP concise gives `topRules`; a 400-warning site adopts lumen via `--update-baseline` and only NEW findings gate; `lumen diff` explains regressions between two reports; a fixHint gate enforces 20/20 built-ins.

## What We're NOT Doing

- No `--from-history` (deferred — IMPLICIT_SPEC deviation section; the port is LOCKED and the digest has no findings).
- No SARIF/md renderers (Bundle 5 consumes this shape).
- No MCP baseline argument (FR-6: CLI-only).
- No schema versioning ceremony beyond the baseline file's `version: 1` field.

## Approach

Core owns the shape (`Issue.helpUrl?`, `ByRuleGroup`, fingerprint function, baseline read/write types live in core/audit); audit assembles groups + fingerprints; CLI renders/groups/gates and owns the baseline file I/O; MCP maps the new shape. Every contract gate moves in the same change.

## Design Analysis

- **Invariants → mechanism**: P-Honest (affectedPages = distinct audited page URLs per rule; `fixed` only among pages audited THIS run) → grouping counts distinct `url`s of issues ON fetched pages; fingerprint normalization → `normalizeKey` reused verbatim (import from audit's url-normalize, not re-implemented); incomplete-fails-gate → baseline gate ANDs with the existing incomplete check, hint string in human + JSON output; allowlist discipline → `helpUrl` added to `sanitizeIssue` allowlist + core `Issue` + renderers in the same commit.
- **Failure edges**: baseline file unreadable/malformed → ConfigError-flavored UsageError exit 2 (never a silent "no baseline"); fingerprint of an issue WITHOUT url (page-level issues get url injected at assemble) — after this bundle EVERY issue has url, so fingerprint is total; `--update-baseline` + `--baseline` together → UsageError; diff of reports with different seeds → allowed, but output labels the seeds honestly.
- **Simplicity guardrails**: one comparator module (`ranking.ts` in audit), one fingerprint module (`fingerprint.ts` in audit), baseline file I/O in ONE cli module (`baseline.ts`); no new deps.
- **Blast radius**: core Issue type + sanitize allowlist + assemble (byRule array, page-issue url injection) + mcp auditPayload (topRules) + evalite snapshots + cli audit cmd (human grouping, baseline flags, gate) + NEW `lumen diff` command (COMMAND_NAMES 9→10, help, locked-names, cli-reference, no-telemetry case, help snapshots) + site docs + fixHint gate test + rules (status-error, robots-noindex hints).
- **Interrogation**: *What could break?* (a) `summary.byRule` shape change breaks `output-shapes.test.ts`/evalite snapshots — they move deliberately in this change (D2 discipline); (b) page-level issue `url` injection must use the PAGE's url at assemble time (crawl-rule issues already carry url) — no behavior change for crawl issues; (c) fingerprints across normalization: `normalizeKey` keeps query+path, strips fragment — baseline stability across title-text edits holds (message excluded); (d) gate semantics: `new > 0` gates regardless of severity? PRD FR-1: "gate counts only issues whose fingerprint is not in the baseline" — count = new issues at/above failThreshold? NO — reread: the baseline gate replaces the absolute gate: fail = new issues exist (any severity? PRD AC: fixture v2 adds 1 error → exit 1; "only fail PRs that add new ones"). Decision: gate = `incomplete || newAtOrAbove(threshold) > 0` — the threshold STILL applies to new issues (consistent with the exit-code contract; a new info with threshold=error does not gate). Recorded in plan; PRD silent on the interaction, this preserves the locked exit contract. *Riskiest*: byRule migration vs eval snapshots — regenerate deliberately and review the diff. *Options not taken*: additive `byRuleGroups` beside `byRule` map (rejected: two sources of truth, PRD names `summary.byRule[]`); storing fingerprints in history (rejected: LOCKED port, deferred).
- **Verification design**: unit tests for comparator/fingerprint (normalization pinned: fragment-only difference → same fingerprint; message edit → same fingerprint); baseline I/O (atomic write, sorted, version read-tolerance); grouping honesty (affectedPages = distinct audited pages); gate matrix (new>0 → 1; all-baselined → 0; incomplete → 2? no — incomplete → gate fails per FR-5, exit 1... wait: existing invariant maps incomplete to EXIT.ISSUES=1 via gateFailed — keep); spawn e2e for the PRD AC (v1 → update-baseline → v2 fixture: exit 1, new=1, fixed=1); evalite size case ≤4KB; help/locked-names/cli-reference/no-telemetry gates.

## Phase 1: shape — core + audit (Issue.helpUrl, byRule groups, url injection, fingerprints)

### Changes
#### `packages/core/src/issues.ts`
`Issue` += `helpUrl?: string` (doc: stable anchor `https://nitishagar.github.io/lumen/docs/rules-reference/#<ruleId>`; engine-controlled, never page-derived).
#### `packages/audit/src/report/sanitize.ts`
`sanitizeIssue` allowlist += `helpUrl` (engine-controlled → preserved untouched, like `url`).
#### `packages/audit/src/rules/technical.ts` + `meta.ts` (robots-noindex)
`status-error` + `robots-noindex` gain fixHints (bring 19→21/20 rules covered; exact copy decided at implementation: status-error → 'fix or remove the broken URL, or return the correct status'; robots-noindex → 'remove the noindex directive (meta or X-Robots-Tag) if the page should be indexed').
#### `packages/audit/src/rules/rule-set.ts`
`builtInRuleMetadata()`/registration: every built-in rule gains `helpUrl` — assembled as `…/#<id>`; expose `helpUrlFor(ruleId)` from audit (used by assemble + mcp + tests).
#### NEW `packages/audit/src/ranking.ts`
`SEVERITY_ORDER`, `compareIssues(a, b)` (severity → ruleId asc as tiebreak at ISSUE level), `groupIssues(pages): ByRuleGroup[]` where `ByRuleGroup = { ruleId, severity (max present), affectedPages (distinct urls), sampleUrls[≤3] (sorted), fixHint?, helpUrl }`, sorted by (severity rank, affectedPages desc, ruleId). `summarizeByRule` replaces the counts map.
#### NEW `packages/audit/src/fingerprint.ts`
`fingerprintIssue(issue: Issue): string` = sha256 hex of `ruleId + '\n' + normalizeKey(new URL(url)) + '\n' + (evidence.selector ?? '')` (field separators prevent ambiguity; message excluded by design).
#### `packages/audit/src/report/assemble.ts`
Inject `url` into every page-level issue at assemble (page.url); page-level issues without url cease to exist. `summary.byRule` = grouped array (E1.2 FR-2). Crawl-rule issues keep their url.
#### `packages/core/src/page.ts` (types)
`SiteAuditReport.summary.byRule: readonly ByRuleGroup[]`; `ByRuleGroup` type exported from core.
### Success Criteria
- [ ] `npx vitest run packages/audit packages/core` green after deliberate snapshot updates (reviewed diff).
- [ ] fixHint gate: new `rule-set.test` case asserting all 20 built-ins have fixHint + helpUrl.

## Phase 2: baseline + diff engine (audit-owned, pure)

### Changes
#### NEW `packages/audit/src/baseline.ts`
`BaselineFile = { version: 1; seed: string; writtenAt: string; fingerprints: string[] }`; `buildBaseline(report): BaselineFile` (sorted unique fingerprints); `diffAgainstBaseline(report, baseline): { newIssues: Issue[]; existingCount: number; fixed: string[] (fingerprints in baseline whose ruleId+normalizedUrl… no — fixed = baseline fingerprints whose (ruleId, normalizedUrl) no longer appears among audited pages' fingerprints; pages NOT audited this run are excluded from fixed computation — but the report only carries audited pages, so `fixed` is computed over baseline fingerprints whose page WAS audited this run (page-level check: normalizedUrl ∈ auditedUrlSet) — not-audited pages' fingerprints are `unknown`, never fixed) }`.
#### NEW `packages/audit/src/diff-reports.ts`
`diffReports(a: SiteAuditReport, b: SiteAuditReport)` → same new/existing/fixed breakdown (a=baseline side) + `scoreDelta: bScore - aScore`; fixed restricted to URLs audited in BOTH runs.
### Success Criteria
- [ ] Unit matrix: fingerprint stability (title edit → same fp; fragment-only URL diff → same fp; selector diff → new fp); AC fixture v1→v2 (new=1, fixed=1); incomplete-run honesty.

## Phase 3: CLI — grouping render, baseline gate, `lumen diff`

### Changes
#### `packages/cli/src/cmd/audit.ts`
Flags `--baseline <file>`, `--update-baseline <file>` (mutually exclusive; update exits 0 after atomic write — gate skipped by design, PRD FR-2). Gate: `incomplete || (baseline ? newAtOrAbove > 0 : countAtOrAbove > 0)`; human output gains the three sections (new/existing counts + fixed list + "baseline comparison is partial" hint when incomplete); JSON report output += `baseline` section (`{ path, new: issues[], existingCount, fixed: string[], unknownPages: n }` — additive, only when baselined). Human grouping (FR-5): top groups by the comparator, `→ fix: <fixHint ?? "no fix hint provided by plugin <name>">`, sample URLs ≤3 + "+N more", `--verbose` lists all.
#### `packages/cli/src/baseline.ts` (new)
`readBaseline(path)` (version-tolerant, malformed → UsageError), `writeBaselineAtomic(path, file)`.
#### `packages/cli/src/cmd/diff.ts` (new command)
`lumen diff <a.json> <b.json>`: loads both reports (validate shape honestly), prints new/existing/fixed + score delta, exit 1 when b has new issues (CI-usable), 0 otherwise, 2 on usage/read errors. `--json` = one document.
#### `packages/cli/src/args.ts` + `help.ts` + `run.ts`
COMMAND_NAMES 9→10 (`diff`), flags table, dispatch, USAGE entries, ROOT usage.
#### Contract files (same change)
`locked-names.json` cliCommands += `diff`, cliFlags += `--baseline`, `--update-baseline`, `--verbose`; `cli-reference.astro` command section + flags; `no-telemetry.test.ts` case += `['diff','--help']`-style zero-outbound case (diff with two fixture report files); help snapshots regenerated; contract-counts (derives — verify); site quickstart "baseline" pointer; rules-reference page: the two new fixHints (site rule-count gates unchanged).
### Success Criteria
- [ ] Spawn e2e: PRD AC — fixture v1 audit → `--update-baseline` (exit 0, file sorted+versioned) → v2 audit `--baseline` → exit 1, new=1, fixed=1; title-text edit does NOT un-baseline.
- [ ] `npm run validate` green.

## Phase 4: MCP topRules + ≤4KB eval observation

### Changes
#### `packages/mcp/src/server.ts`
`auditPayload` concise: `topRules` (≤10 groups from `summary.byRule`, mapped {ruleId, severity, affectedPages, sampleUrls, fixHint, helpUrl}) REPLACES `topIssues` (D2). Detailed: full report pages (unchanged shape) — issues now carry url/fixHint/helpUrl.
#### `packages/mcp/src/evals/` size case
New evalite case: 100-page fixture report → concise payload JSON length ≤ 4096 bytes (observation + failure = score 0).
#### Contract
`output-shapes.test.ts` + `tool-contract.eval.ts` + evalite snapshots move deliberately; schema docs (tools docs page if it names topIssues — grep) updated.
### Success Criteria
- [ ] mcp suites green; concise payload ≤4KB observed; `tools/list` still exactly 5.

## Testing Strategy

- Unit: comparator ordering, grouping honesty (distinct audited pages, ≤3 samples), fingerprint pinning, baseline I/O, diff engine, gate matrix.
- Spawn: AC e2e (baseline adopt flow), diff exit codes, `--verbose`.
- Contract gates: help snapshots, locked-names, cli-reference, no-telemetry, site checks, evalite snapshots (deliberate, reviewed), ≤4KB size case.
- Security: no new outbound surfaces (no-telemetry array gains diff); sanitize allowlist still refuses page-derived extras (test with a fake plugin rule emitting helpUrl — engine-controlled helpUrl survives, page-derived junk doesn't).

## Amendments

(empty at authoring)

## References

- PRD §6 E1.2 + E1.3 (+ D2), §10 D2
- Research: Seam 1 (report shape, sanitize allowlist, fixHint census), Seam 3 (exit gate, history digest, config-key sites), HC2
- Conventions: `url-normalize.ts` (normalization reuse), `write-atomic.ts`, `spawn.ts`, evalite case shapes
