# HANDOFF_LEDGER — lumen missing-features + red-team swarm

Append-only resume point. One line per entry with provenance (what/where/when). Prior session's final state is summarized in HANDOFF.md (2026-09-18); this ledger starts at the ship/verify continuation.

## Position

- 2026-09-18T21:55 +05:30 — ALL GATES PASSED: impl reviewer resumed → **VERDICT: PASS** (8/8 CONFIRMED, round-2 section in IMPLEMENTATION_VALIDATION.md); security reviewer → **VERDICT: PASS** (0 CRITICAL/HIGH; 2 LOWs + 1 INFO hardened in place with tests); final battery: lint 0 / typecheck 0 / **84 files 941 tests** / gate Evals 14 threshold 100% / swarm 15/15 / size 290/1536. Next: commit on `evals/evalite` → flip repo private → push → PR (base main; branch is 3 evalite commits + this work) → ask user for judge key.

## State changes

- (prior session, uncommitted) 34 tracked files + 8 new paths at `48db265` on `evals/evalite` — inventory in HANDOFF.md §Change inventory. Nothing committed yet.
- 2026-09-18T21:10 — this file created.
- 2026-09-18T21:15–21:35 — review fixes (8): `packages/mcp/package.json` (`test:evals` → `SWARM_SKIP=1 evalite run --threshold 100`); `src/evals/swarm.eval.ts` (load-time `evalite.skip` under SWARM_SKIP; no corpus load/scoreboard when gated out); `src/swarm/faults.ts` (+`validateFaultSpecs`, wrapper keeps deps-dependent checks only); `src/swarm/corpus.ts` (+load-time fault-spec validation); `src/evals/judge.ts` (−`judgeKeyName`, retry docs accurate, non-retryable 4xx → typed `UpstreamError`, −`Statusful`); `src/evals/judge.live.eval.ts` (header claim fixed); `packages/mcp/tsconfig.build.json` (+exclude `src/swarm`); `packages/core/src/history.ts` (+`AuditHistoryEntry.stopReason?`); `packages/cli/src/cmd/audit.ts` (populates stopReason when incomplete); `.github/workflows/evals.yml` + `docs/evals.md` (one consistent gate story); tests: `judge.test.ts`, `corpus.test.ts` (+1), `rank-history.test.ts` (+1); snapshot orphans pruned via green-tree `vitest run -u`.
- 2026-09-18T21:45–21:55 — security hardenings (from security review PASS-with-LOWs): `cmd/rank.ts` csvCell (formula-neutralize `=`/`@`, quote `\r`), `swarm/scoreboard.ts` URL_TOKEN_RE case-insensitive, `evals/judge.ts` cache-key hex guard at store boundary (read=absent, write=loud); +3 tests (rank-history 13, scoreboard 5, judge 16).
- Bundle docs: TEST_VALIDATION continuation section (corrections + 8 fixes + security section), PLAN automated boxes ticked, IMPLEMENTATION_VALIDATION.md (reviewer, 2 rounds, final PASS).

## Decisions

- 2026-09-18T21:10 — Review order: implementation review THEN security review, sequential (user ratelimit constraint); reviewers read the working tree directly (diff + untracked files).
- 2026-09-18T21:10 — `evals/` untracked dir (`evals/.last-run.json` — evalite scratch) predates this work — NOT committed; flagged in final report.
- 2026-09-18T21:10 — Repo `nitishagar/lumen` PUBLIC → user goal says private. 0 forks / 0 stars (verified) so the flip is consequence-free; will `gh repo edit --visibility private` then push. SSH auth verified.
- 2026-09-18T21:20 — Swarm gate exclusion mechanism: env opt-out (`SWARM_SKIP=1`) in the gate script + load-time `evalite.skip` branch (mirrors the judge.live pattern), rather than renaming files or filtering paths — keeps `test:evals` byte-identical in scored set (14) and standalone `evalite run swarm` working. Chosen for convention fit + evalite 0.19 having no exclude flag.
- 2026-09-18T21:25 — `judgeKeyName` removed (dead code: no config-aware runner exists) rather than wiring config loading into the eval (would break the hermetic-default-gate requirement). Recorded in TEST_VALIDATION addendum.
- 2026-09-18T21:30 — Judge retry docs corrected to match code (+transport failures, timeouts never retry) instead of narrowing the code: behavior mirrors core Fetcher's network-error treatment; safer than strict 429/5xx-only.
- 2026-09-18T21:30 — Site build/tests NOT re-run this session (site untouched by review fixes; handoff verified 193/193).
- 2026-09-18T21:50 — Security LOWs fixed (new-code hardening, not scope-widening): CSV `=`/`@` neutralized but leading `-` preserved (legit keywords; cannot open a formula cell alone); `redactUrl` depth NOT changed (pre-existing shared predicate, plan-pinned "no new predicate" — recorded as follow-up); action pinning left at repo convention.
- 2026-09-18T21:55 — Commit strategy: single commit on `evals/evalite` (code+docs+thoughts bundle+pre-existing `docs/evals/IMPLEMENTATION_VALIDATION.md` review-log addendum), PR base `main` (branch = 3 evalite commits + this work). Per-stage commit splitting rejected: stages share files (docs/evals.md, package.json), risk > value.

## Confusion

- 2026-09-18T21:31 — Battery "5 obsolete snapshots" vs git showing HEAD==worktree keys: resolved — the prior session's worktree snap file carried 5 mis-keyed orphan entries (reviewer F2 correct; TEST_VALIDATION's "rank-only diff" claim was false); a green-tree `vitest run -u` pruned them; full run now reports zero obsolete and the diff vs HEAD is genuinely rank-only.

## Open

- ~~Reviewer MINOR-fix confirmation~~ DONE (PASS).
- ~~Security review~~ DONE (PASS, LOWs hardened).
- Live judge run NOT verified (needs user key: `EVAL_LIVE=1 LUMEN_JUDGE_KEY=… LUMEN_JUDGE_BASE_URL=… LUMEN_JUDGE_MODEL=…`) — residual risk 1 in TEST_VALIDATION; will ask user at handoff.
- PLAN manual checkboxes left unticked (human gate): P1 scoreboard-unscored/unknown-id/mid-run-cancel (agent observed unknown-id + cancel-cleanliness via tests; mid-run-cancel partial-line not directly observed), P2 live run (blocked on key), P3 real-bin renders (agent observed pre-fix), P4 fixture thresholds (agent observed via tests).
- Commit/push/PR/private-flip: in flight (next).
