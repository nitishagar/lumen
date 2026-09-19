# HANDOFF — lumen missing-features + red-team swarm (research → plan → implement → sandbox fix)

Date: 2026-09-18. Branch `evals/evalite` at `48db265` (no new commits — everything below is uncommitted working-tree state).
Bundle: `thoughts/shared/plans/2026-09-16-lumen-missing-features-redteam-swarm/` (IMPLICIT_SPEC.md, PLAN.md, PLAN_VALIDATION.md, TEST_VALIDATION.md, this file).
Research: `thoughts/shared/research/2026-09-16-lumen-feature-inventory-missing.md`.

## What was asked, what was delivered

1. **Research** (v2.6): inventory lumen's shipped feature set vs missing relative to the repo aim, with the red-team swarm harness as the required verification focus. → Research doc (scale: medium), 18→ reassigned: 5 hard cores, workload envelope, evidence ledger. Tests at the time: 880 green.
2. **Plan** (v2.6): 4-stage implementation plan (swarm → judge → history/export → 2 rules). Validator round 1 returned MAJOR-FAIL (5 structural defects); all were redesigned, round 2 returned MINOR-FAIL (fixed in place), resumed reviewer confirmed **PASS**.
3. **Implement**: all 4 stages built and verified. **Sandbox fix** (separate item): spawn-test timeout flakes resolved via scoped `testTimeout`.

## Change inventory (34 tracked files + 8 new paths, +869/−117)

- **Stage 1 (swarm)**: NEW `mcp/src/swarm/{faults,scoreboard,corpus}.ts`, `mcp/src/evals/swarm.eval.ts`, `mcp/src/swarm/*.test.ts` (3), `mcp/src/evals/data/adversaries.json` (15 cases); MOD `mcp/package.json` (`test:swarm`), root `package.json` (passthrough), `.github/workflows/evals.yml` (report-only job + artifact), `docs/evals.md` (swarm section + threshold note).
- **Stage 2 (judge)**: NEW `mcp/src/evals/judge.ts`, `mcp/src/evals/judge.test.ts`; MOD `judge.live.eval.ts` (load-time live/skip branch), `docs/evals.md` (live-run docs).
- **Stage 3 (history)**: MOD `core/history.ts` (+`AuditHistoryEntry`, `HistoryEntry` union, kinds, `isRankEntry`), `core/index.ts`, `cli/history/jsonl-store.ts` (kind-aware, rank byte-identical), `cli/args.ts` + `cli/cmd/rank.ts` (`--history/--kind/--format`, 5 UsageErrors) + `cli/help.ts` + snapshot, `cli/cmd/audit.ts` (digest append, cancel writes nothing), `mcp/testkit` (`MemoryHistoryStore` kinds), `mcp/concurrency.test.ts`, `core/models.test.ts`, `cli/history.test.ts`; NEW `cli/rank-history.test.ts` (14 tests).
- **Stage 4 (rules)**: MOD `audit/types.ts` (`bodyHash?` + `bodyHashOf`), `audit/crawl/crawler.ts` (raw-bytes sha256 pipeline), `audit/rules/{meta,links,rule-set}.ts` (`hreflang-present` info, `duplicate-content` warning; 18→20), `audit/rules/{rules,rule-set}.test.ts`, `audit/run.test.ts` (index stub), `audit/crawl/crawler.test.ts` (pipeline test), READMEs + site docs (rules-reference, index, quickstart, audit package.json).
- **Sandbox fix**: `packages/cli/vitest.config.ts` (`testTimeout: 20_000`, spawn package only).

## Verification (final state, all observed)

- `npm run lint` clean; `npm run typecheck` (all workspaces) clean.
- `npm test`: **84 files / 936 tests, zero failures** (baseline 880; +56).
- `npm run test:evals`: 29/29, threshold 100% (includes swarm file by glob — intentional, documented).
- `npm run test:swarm`: 15/15, exit 0. `check:size`: 290 KiB / 1536. Site build + tests: 193/193.
- Manual (real bin): audit→digest row; `rank --history --kind audit --format csv` renders provenance rows; `hreflang-present` fires on example.com; error/info gates exit 1/1 correctly.

## Key decisions & deviations (all recorded in TEST_VALIDATION.md)

- Corpus loader split into `swarm/corpus.ts`; token-level scoreboard scrub; `AuditHistoryEntry` carries `incomplete` (unlabeled partials would be half-truths); `HistoryListQuery.kind` gains `'all'` for merged reads; no new tunable knobs anywhere; judge `modelId` is user-supplied verbatim (no allowlist); swarm cases gate `test:evals` too (deterministic honesty assertions — documented in `docs/evals.md`).
- Pre-existing, untouched: `docs/evals/IMPLEMENTATION_VALIDATION.md` modification, `evals/` dir, 8 Dependabot PRs, refused surface (volume/backlink/clickstream), Worker subset, gateway auth.

## Environment lessons (will bite again)

- `unshare -rn` is blocked here — zero-network is argued structurally (fixture-only deps), not namespace-proven.
- **Never stash-and-run tests**: the clean-tree run let vitest prune the help snapshot (obsolete-cleanup); recovered from the stash. Regen snapshots only on green trees, inspect the diff.
- Failure signature `Test timed out in 5000ms` on spawn tests = budget, not product (fixed).

## To continue

- Review the diff (`git status --short`, 42 paths incl. bundle/thoughts), then commit on `evals/evalite` or a feature branch and open a PR (CI runs lint/typecheck/test/evals + the new report-only swarm job).
- NOT verified live: judge cache-miss path needs a real key (`EVAL_LIVE=1 LUMEN_JUDGE_KEY=… LUMEN_JUDGE_BASE_URL=… LUMEN_JUDGE_MODEL=… npx evalite run judge.live` from `packages/mcp`).
- Suggested follow-ups (out of scope, not planned): swarm threshold gate (needs a named threshold), SARIF export, further rule batches, Dependabot backlog.
