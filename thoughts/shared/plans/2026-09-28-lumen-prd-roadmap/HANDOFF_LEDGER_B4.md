# HANDOFF LEDGER — Bundle 4 (E1.2 actionable findings + E1.3 baseline/diff — ONE report-shape migration)

Plan: PLAN_B4_report_shape.md — validation round 1 FAIL (C1 baseline format can't compute `fixed` honestly; 4I+6M) → amendments folded → re-confirmation in flight.
Scale: large.

## Position

- Phase 1 (shape): DONE — Issue.helpUrl, byRule ranked groups (0.x breaking per D2), per-issue url injection, status-error/robots-noindex hints, fixHint gate 20/20 (fixhint-gate.test.ts), ranking + fingerprint units.
- Phase 2 (baseline/diff engine): DONE — baseline.ts (single module) with {fp,url} entries, fixed/unknown honesty, diffReports + scoreDelta.
- Phase 3 (CLI): DONE — grouped human output with fix lines/+N more/--verbose, --baseline gate (threshold applies to NEW issues), --update-baseline (cancelled→2 no write; incomplete→typed refusal), lumen diff (10th command), contracts (locked-names, cli-reference, rules-reference anchors + site gate, no-telemetry diff case, snapshots).
- Phase 4 (MCP): DONE — topRules replaces topIssues in concise AND detailed; testkit inline grouping + pages option; concise-payload-budget eval (100-page fixture ≤4KB).
- Validate: GREEN — 98 files / 1074 tests + cli-smoke (2026-09-28).

## State changes

(planned — see plan + amendments)

## Decisions

- baseline entries: {fp, url}[] (validator C1) — fixed/unknown split needs the URL per entry.
- gate = incomplete || newAtOrAbove(threshold) > 0 (threshold still applies to new issues; doc note M4).
- --update-baseline: cancelled → exit 2 no write; incomplete → typed refusal (I2).
- topRules replaces topIssues in BOTH concise and detailed (D2; M1).
- fingerprint collision policy: gate counts instances; pinned by test (I4).

## Hypotheses

(none yet)

## Confusion

(none yet)

## Open

- (none)

## Review

- Implementation review: agent_1d86a0d4 — FAIL (1C: --update-baseline didn't exit 0 / didn't skip the gate; 3I: skipped pages counted as audited for `fixed`, plugin helpUrl leak, nine→ten prose drift; 6M incl. missing render tests, vacuous AC coverage) → ALL fixed (see PLAN amendments) → validate re-green 98 files / 1078 tests.
