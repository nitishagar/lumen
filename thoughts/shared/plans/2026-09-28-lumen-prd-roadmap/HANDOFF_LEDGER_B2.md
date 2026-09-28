# HANDOFF LEDGER — Bundle 2 (E0.4 first-run: init + doctor)

Plan: PLAN_B2_first_run.md (validated PASS 2026-09-28 after F1–F5 amendments; validator agent_0152bac0).
Scale: medium.

## Position

- Phase 1 (init): DONE
- Phase 2 (doctor): DONE
- Phase 3 (hints + contracts): DONE (incl. post-review C1 fix: authority/report FR-3 hints now fire in BOTH not-configured shapes)
- Validate: GREEN — `npm run validate` 90 files / 1008 tests + cli-smoke + lint (2026-09-28, post-review)
- Review: implementation review agent_82af9aef — FAIL(1C,2I,7M) → all 10 findings fixed → validate re-green. C1 was real: FR-3 authority hint was dead code in production (early-return path + NotConfiguredError-at-call-time path both missed it).

## State changes (landed)

- cmd/init.ts, cmd/doctor.ts (+ optional `providersOverride` test seam on execute), args.ts COMMAND_NAMES 7→9, help.ts (ROOT_USAGE + 2 USAGE entries + mcp `--print` 7-target line from the B1 conformance note), run.ts dispatch, report/authority doctor hints (human output only), locked-names cliCommands 9, site cli-reference (9 commands) + quickstart first-run section, README seven→nine, no-telemetry cases (doctor + init with `--config <tmp>`; BYOK sentinel + doctor), help snapshots regenerated, tests src/init.test.ts (12) + src/doctor.test.ts (12).

## Decisions

- byok map keyed by provider names via `BYOK_ENV_VARS` (registry round-trip oracle).
- doctor status via `resolveEnvVar` + env presence (NOT byokReady); `disabled` reserved-unreachable.
- engines from the shipped `packages/cli/package.json` (`>=22.7`); tiny `>=X.Y` comparator with honest `unknown` fallback.
- init target path = `resolveConfigPath(flag)` so the no-telemetry case can pass `--config <tmp>`.
- doctor probes pinned inputs: ideas('example'), search('example'), report/record(https://example.com), authority('example.com').
- Also fixing Bundle 1 conformance gap: help.ts mcp `--print` line now lists 7 targets.
- Test seam (plan amendment): `execute(ctx, providersOverride?)` instead of composition changes.

## Verification evidence

- `npx vitest run packages/cli/src/init.test.ts packages/cli/src/doctor.test.ts packages/cli/src/authority.test.ts` → 31/31.
- `npx vitest run --root packages/cli` → 20 files / 178 tests green.
- `npm run validate` → 90 files / 1008 tests green + cli-smoke green + lint clean + site checks green (post-review rerun).

## Session-recovery note

- This bundle was started in a prior session that degraded mid-implementation and stopped; the working tree it left behind was AUDITED (not trusted): git diff reviewed line-by-line, `no-telemetry.test.ts` read in full (coherent), typecheck + full CLI suite + full validate green before further edits.

## Hypotheses

(none)

## Confusion

- One Bash read returned garbled output mid-PRIOR-session; disregarded and re-derived from verified reads.

## Open

- (none — owner-gated external items tracked in master LEDGER)
