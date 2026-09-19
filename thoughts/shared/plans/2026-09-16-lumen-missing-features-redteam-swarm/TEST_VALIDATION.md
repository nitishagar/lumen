<!-- SIGNPOST | 5/5: TEST_VALIDATION | what was executed, what passed, residual risks | Prev: implement+review -->

# TEST_VALIDATION — lumen missing-features + red-team swarm

Plan: `thoughts/shared/plans/2026-09-16-lumen-missing-features-redteam-swarm/PLAN.md` (rev. 2, validator-PASS).
Implemented in stage order on HEAD `48db265` (branch `evals/evalite`); no plan divergence requiring a plan change — additive decisions below are recorded, not designed around.

## Stage results

### Stage 1 — Red-team swarm harness: DONE

- New: `packages/mcp/src/swarm/faults.ts` (closed 5-fault vocabulary, typed taxonomy errors, bounded 0..250ms latency, loud admission), `scoreboard.ts` (in-process queue + single O_APPEND JSONL, 4KB cap, `redactUrl` token scrub), `corpus.ts` (loader: 1MiB cap, id regex, tool/fault registries, secret-free enforcement, `SWARM_ONLY` filter with valid-id errors), `evals/swarm.eval.ts` (catch-into-scores tasks, per-task fresh fixtures, awaited scoreboard append), `evals/data/adversaries.json` (15 cases: 6 handler-layer, 9 provider-layer).
- Wired: `test:swarm: evalite run swarm` (mcp + root passthrough), CI swarm job (`continue-on-error: true` + scoreboard artifact), `docs/evals.md` swarm section.
- Verified: 15/15 adversaries pass, exit 0; `SWARM_ONLY` filter + unknown-id listing; 21 swarm unit tests green (vocabulary, admission, durability, sentinel scrub, secret-free loader).
- Decisions: corpus loader split into `swarm/corpus.ts` (unit-testable without executing evalite); scrub is token-level (whole-string URLs never occur in reasons — proven by the failing-first sentinel test).

### Stage 2 — Live judge gate: DONE

- New: `packages/mcp/src/evals/judge.ts` (vendor-neutral `JudgeConfig`, pinned `judge-rubric-1` text naming its version, BYOK `byok.judge` default `LUMEN_JUDGE_KEY`, canonical-JSON content-addressed cache under `.evalite/judge-cache/`, stated POST retry deviation reusing core `TimeoutError`/`RetryAfterCapError`/`RetryExhaustedError` + providers `ParseError`/`retryAfterMs`, `resolveJudgeVerdict` orchestrator).
- Modified: `judge.live.eval.ts` (load-time `evalite`/`evalite.skip` branch; keyless `EVAL_LIVE=1` records `unscored: key-absent` at load, guarded); `docs/evals.md` (one-command live run, env vars, deviation, cache).
- Verified: default `test:evals` green with skip visible (behavior-identical); `EVAL_LIVE=1` keyless green + scoreboard `unscored/key-absent` row observed; 15 judge unit tests green (validation, canonicalization incl. shuffled-keys/fresh-timestamps, cache round-trip + malformed-as-absent, retry matrix incl. cap/timeout/exhaustion, sentinel key hygiene, orchestrator cache-hit zero-caller-counter).
- Decisions: closed `modelId` allowlist replaced by validated user-supplied string (plan fix); eval gate reads the module-default key name (custom `byok.judge` names are for config-aware runners — the eval file loads no config); live run with a real credential is NOT verified here (no key in this environment — residual risk 1).

### Stage 3 — History + export lifecycle: DONE

- Core: `HistoryEntry = RankHistoryEntry | AuditHistoryEntry` (+`incomplete` on audit digests — additive deviation: an unlabeled partial would be a silent half-truth), `HistoryKind = rank|audit|all`, kinded query (`kind` default `rank` = exact back-compat), `isRankEntry` discriminator.
- Store: kind-aware paths (rank legacy byte-identical; audit under `<root>/audit/` grouped by URL hostname), shared rotation/O_APPEND/queue/truncation per kind, `all` merges sorted by `retrievedAt`.
- CLI: `rank --history [--kind rank|audit] [--format json|csv] [--domain] [--limit]` with five loud UsageErrors (positional, `--no-save`, `--json`+csv, unknown kind/format); per-kind CSV headers with provenance columns (`lumen-audit` provider value for audit rows); `audit` appends one digest per completed run (cancelled runs write nothing — spec invariant).
- Tests: `rank-history.test.ts` (12: admission, rendering, filters, digest append, cancel-cleanliness, layout), store kind block (6), narrowed pre-existing assertions (`rankOnly` helper asserting no kind leaked), snapshot regen (rank-only diff verified).
- Verified: real-bin `audit` → digest row; `rank --history --kind audit --format csv` renders labeled provenance rows; default rank listing hides audit rows.

### Stage 4 — Rules + pipeline: DONE

- Pipeline: `CrawledPage.bodyHash?` + `CrawlIndexEntry.bodyHash?` + `bodyHashOf` (sha256 over UTF-8 bytes of exact capped text, computed pre-parse, copied at index build; unhashed = unknown-by-construction).
- Rules: `hreflang-present` info in `meta.ts` (mirrors `canonicalPresent`; multiples normal, only zero fires); `duplicate-content` warning in `links.ts` (exact-hash groups ≥2, per-page evidence cap mirroring rule 11); registry 18→20.
- Contracts: all enumerated count-18 sites updated (rule-set test, rules-reference ×5 incl. 2 new rows, index ×3, quickstart, audit package.json/README, root README ×3); CHANGELOG history untouched (correctly historical); `locked-names.json` has no rule count (verified, not touched).
- Tests: rule fire/no-fire/vacuous/unknown-exclusion, count-20 + new metadata rows, FakeFetcher pipeline test (identical bodies flagged on both, oversize excluded), corpus `auditIssues` injection + `dup-content-surfaces/gates` (surfacing + threshold flip), `rank-history-read` (MCP history path).
- Verified: real-bin audit fires `hreflang-present`; error/info gate exits unchanged (1/1 on the error-bearing fixture); golden-dataset green (no fixture impact).

## Full battery (final state)

- `npm run lint` — clean (exit 0).
- `npm run typecheck` (all workspaces) — clean.
- `npm test` — 934 passed / 2 failed of 936 (baseline was 880). The 2 failures are `help-spawn root-help` + `json-contract stdout-empty`: bin-spawn timeout flakes in this sandbox, PROVEN pre-existing by running them on the stashed clean tree (same 2 fail), and both pass in isolation with my changes (15/15). Never stash-and-run here again: the clean-tree run mangled the snapshot via obsolete-snapshot cleanup (recovered from the stash; verified rank-only diff + 11/11 green).
- `npm run test:evals` — 29/29 pass, threshold 100% (includes `swarm.eval.ts` by glob — intentional, documented: deterministic honesty assertions gate; report-only job stays the artifact run).
- `npm run test:swarm` — 15/15 pass, exit 0 (zero-network structural: fixture-only deps, no Fetcher seam; `unshare -rn` unavailable in this sandbox — Operation not permitted).
- `check:size` — worker 290 KiB gzip / 1536 KiB cap.
- Site `build` + `test` — 193/193 green over rebuilt dist (rules-reference/index/quickstart edits gated).

## Residual risks

1. No live judge run performed (no credential in this environment) — cache-miss path is unit-proven with scripted fetch, not vendor-proven.
2. ~~Full-suite spawn flakes (2 tests) are environment-load sensitive; CI (resourced runners) is the tiebreaker.~~ RESOLVED as a separate item: root cause was vitest's 5s default `testTimeout` vs ~1.5s cold bin spawns × 2–4 sequential spawns per contract test (`Test timed out in 5000ms`, green in isolation, reproduced on the clean tree). Fix: `testTimeout: 20_000` scoped to the spawn-heavy `@lumen-seo/cli` project (`packages/cli/vitest.config.ts`); unit packages keep the fast default. Full `npm test` now green: 84 files / 936 tests, zero failures, repeated.
3. First-live-judge cost, domain-count history axis, and `.evalite/` growth remain unmodeled (named in the plan's cost model).
4. `docs/evals/IMPLEMENTATION_VALIDATION.md` modification and `evals/` dir pre-date this work (untouched).

## Continuation session (2026-09-18) — post-review corrections and fixes

A fresh adversarial implementation reviewer (IMPLEMENTATION_VALIDATION.md in this bundle) returned MINOR-FAIL with 8 localized findings; all were fixed in place and re-verified. Corrections to the record above, then the fixes:

- **Correction (Stage 3 tests):** `rank-history.test.ts` had 11 tests (not 12 as claimed above); the "9 provider-layer" corpus cases include 3 faultless handler-arg cases. Post-fix counts: `rank-history.test.ts` 12 tests, corpus loader 7 (was 6), judge 15 (judgeKeyName case replaced by a module-default case), full suite **84 files / 938 tests, zero failures**.
- **Correction (Stage 1 verification):** the "snapshot regen (rank-only diff verified)" claim above was false as written — the prior regen had also left 5 mis-keyed orphan entries in the worktree snapshot file (surfaced as vitest "5 obsolete"). A green-tree `vitest run -u` pruned them; the committed-vs-worktree snapshot diff is now genuinely rank-only, and the full run reports zero obsolete.

Fixes (each verified):

1. **Swarm excluded from the default eval gate** (reviewer F1): `test:evals` now runs `SWARM_SKIP=1 evalite run --threshold 100`; `swarm.eval.ts` registers via `evalite.skip` under that env and loads no corpus/writes no scoreboard, so the gated set is exactly the pre-swarm 14 evals (observed: `Evals 14`, both skip files visible, threshold 100% passed) — matching the user-confirmed report-only assumption. `npm run test:swarm` unchanged (15/15, exit 0). CI comment + docs/evals.md tell one story now.
2. **Snapshot orphans pruned** (F2): see correction above.
3. **`src/swarm` excluded from `tsconfig.build.json`** (F3): harness code no longer compiles into production `dist/` (verified: `dist/swarm` absent, build clean, check:size 290 KiB/1536).
4. **Dead `judgeKeyName()` removed** (F4): no config-aware runner exists; the eval reads the module-default env name only (stated in code + docs). Header/docs no longer claim non-existent runners honor `byok.judge`.
5. **Corpus load-time fault-spec validation** (F5): shared `validateFaultSpecs()` (vocabulary, latencyMs 0..250, providerIndex shape, duplicate slots) now runs in the loader — an invalid corpus fails before any case executes; the wrapper keeps only the deps-dependent range checks. +1 loader test (latency/index/duplicate-slot assertions).
6. **Judge retry deviation stated accurately** (F6): docs now say ≤2 retries on 429/5xx AND transport failures (mirroring the core Fetcher's network-error handling); timeouts never retry. Code was already correct.
7. **Non-retryable judge 4xx throws typed `UpstreamError`** (F7) carrying the status (was a plain Error with `.status`); test asserts the type.
8. **`AuditHistoryEntry.stopReason?`** (F8): incomplete digests now carry why the run stopped (`aborted`/`time_budget`/`page_budget`), per the partial-failure taxonomy invariant; +1 test (incomplete digest labeled, complete digest unfielded).

### Security review (separate reviewer, same session) — VERDICT: PASS

No CRITICAL/HIGH findings. Two LOW findings sat in NEW code from this change and were hardened in place before commit (re-verified: 84 files / **941 tests** green, gate `Evals 14`, swarm 15/15, check:size 290 KiB/1536):

- **CSV formula/CR hardening** (`cmd/rank.ts` `csvCell`): cells starting `=`/`@` are apostrophe-neutralized, `\r` now triggers quoting (a bare CR could previously break the row); leading `-` stays faithful (legit keywords, cannot open a formula cell alone). +1 test.
- **Scoreboard scrub case-insensitivity** (`swarm/scoreboard.ts` `URL_TOKEN_RE` + `i`): `HTTPS://…` tokens now match and scrub. +1 sentinel test.
- **Judge cache boundary guard** (`evals/judge.ts`): `readVerdictCache` treats non-sha256-hex keys as absent, `writeVerdictCache` throws; cache tests re-keyed to 64-hex. +1 test.

Recorded follow-ups (not fixed — pre-existing/shared or CI-convention, flagged by the reviewer as unreachable today): `redactUrl`'s predicate covers 6 exact param names and never userinfo — deeper secret shapes land verbatim if scoreboard reasons ever carry live provider output; CI actions are tag-pinned (`@v7`) matching the repo's existing convention; corpus 1 MiB cap checked after `readFileSync` (repo-relative path only).
