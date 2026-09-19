# IMPLEMENTATION_VALIDATION — lumen `evals/evalite` branch (adversarial impl+test review, 2026-09-06)

Reviewer did not write the code. Reviewed: single commit `fd09763` on `evals/evalite` (diff `main..evals/evalite`), trial branches `evals/trial-promptfoo` (f8cee76) / `evals/trial-evalite` (a0e7e3c) exist separately, docs/evals/* on branch. Default stance FAIL until earned with file:line evidence. Not committed.

## 1. Plan conformance (PLAN_1_lumen.md) — PASS (divergences justified)

- Winner is evalite, not the plan's "expected promptfoo" — sanctioned: PLAN_1:65 says "expected", comparison.md decides from measured data (131 vs 128 observed rubric, comparison.md:16).
- Snapshot cases moved from promptfoo to evalite trial — sanctioned deviation, documented with the root cause (promptfoo's standalone mcp provider has no list/snapshot surface) in docs/evals/promptfoo-notes.md (Q4) and comparison.md:15.
- promptfoo mcp config shape `id: mcp` + `config:` — sanctioned deviation, documented in promptfoo-notes.md (config-shape trap, ~20 min).
- Separate `.github/workflows/evals.yml` — PLAN_1:43 explicitly allows "(or a separate evals.yml if cleaner)". PASS.
- `denied-tool-not-called` drops the plan's `recordingFetcher` zero-outbound assertion (PLAN_1:57): the plan's mechanism is inapplicable at this seam — `fixtureRemoteDeps` (testkit/index.ts:126-133) wires no fetcher-bearing provider at all, so the deny is structural before any fetch could exist; rationale documented in code (tool-contract.eval.ts:283-285). Justified divergence.
- Divergence NOT sanctioned: CI trigger scope — see §2.

## 2. Spec invariants (IMPLICIT_SPEC 1–12) — FAIL (two misses)

- Inv 1 offline-by-default: PASS. No network seam in the suite — all tasks run `connectClient(fixtureDeps())`/`fixtureRemoteDeps()` (tool-contract.eval.ts:55,79,112,151,195,229,253,286); zero-network proof recorded via `unshare -rn` (evalite-run-log.md §1); the promptfoo trial's undici/proxy-choke gotcha is documented (promptfoo-notes.md).
- Inv 2 npm test untouched: PASS. Root `package.json` diff adds only `test:evals` (line 19-20); lockfile shows a single hoisted vitest 4.1.11, no nested conflict; hoisting guard recorded ("880 passed, byte-identical pass-set", evalite-run-log.md §1).
- Inv 3 CI fails on eval failure: **FAIL.** Exit propagation works (`evalite run --threshold 100`, packages/mcp/package.json:24; CLI flags verified against `evalite --help`), judge is `evalite.skip`'d so it cannot redden the gate — but `.github/workflows/evals.yml:4-6` triggers on `push: branches: [main]` + PRs only. Spec invariant 3 says "Evals run on **every push**"; PLAN_1:43 said "on push + pull_request" (all branches, matching ci.yml's own convention). Pushes to non-main branches never run evals. Fix: drop the `branches:` filter (or list `branches: ['**']`).
- Inv 4 flaky judge: PASS-with-caveat offline (judge is skipped, so containment is vacuous); see §3 for the doc claims that overreach.
- Inv 5 no secrets: PASS. Only env-var NAMES (judge.live.eval.ts:6; docs/evals.md:26); no key values anywhere in the diff; commit carries no Co-authored-by (verified `%B` of fd09763) — identity gate (`scripts/ci/check-commits.mjs:132-135`) satisfied.
- Inv 6 SUT untouched: PASS. `git diff main..evals/evalite -- packages/mcp/src/schemas.ts packages/cli packages/core packages/providers packages/audit packages/site` is EMPTY; the Step-5 regression (`schemas.ts:58` max(253)→max(200)) is recorded red then reverted green (evalite-run-log.md §2-3); the only src changes are new `packages/mcp/src/evals/**` files.
- Inv 7 pinned deps: PASS. `"evalite": "0.19.0"` exact (packages/mcp/package.json:37) matching lockfile (package-lock.json:6479-6482).
- Inv 8/9 case-count contract: **FAIL.** 11 data cases + 1 skipped judge fits 8-12; deterministic ≥3 (10 of 11); latency ✓; tool-list + per-tool input-schema snapshots ✓ (tool-contract.eval.ts:47-95). But **negative cases = 1** (`denied-tool-not-called`, :274-301) against the required ≥2 negative families (injection/denied/bad-input, IMPLICIT_SPEC:16) and inv 9's per-family boundary inputs. The strict-args / url-guard / injection negatives exist only in the promptfoo trial suite, which is NOT on this final branch (no root `evals/` in the diff) — the adopted gate lost them, and golden.json (data/golden.json:1-43) is all happy-path. Fix in place: add 2 in-process negative cases (unknown arg → `-32602`/strictArgs error via `callToolJson`; private URL → url-guard deny — both surfaces are reachable in-process per promptfoo-notes.md findings 3-4).
- Inv 10 branch/artifact layout: PASS. Trials on `evals/trial-*` with their own commits; final branch `evals/evalite` = chosen winner; artifacts at `docs/evals/` (survey, 2×notes, 2×run-logs, comparison) + `docs/evals.md`; no push (no new remote refs).
- Inv 11 conventions: PASS. `*.eval.ts` colocated TS outside the vitest include (`vitest.shared.ts:12`); TS-strict applies (evalite-notes.md surprises); no `fetch(` introduced; CommonJS/naming conventions untouched.
- Inv 12 trial integrity: PASS. Both trials green+red+green with measured data (both run-logs), notes record setup minutes/config lines/runtime/offline proof/failure quality/surprises, early-stop none (comparison.md:29).

## 3. Test quality — PASS

- Real assertions: every scorer is a binary 0/1 over concrete expectations — tool names vs committed snapshot (:66), order-insensitive canonical schema compare (:92, with the wire-vs-SDK key-order trap documented in evalite-run-log.md), provenance fields incl. `retrievedAt` (:131-136), count bounds + deterministic first term (:164-166), severity counts + gate (:208-209), golden expected-keys JSON-strict (:36-37,239), latency < 1000 ms (:265-269), deny code (:297-298). No tautologies; `audit-site-findings-shape` injects a fixture issue but asserts the SUT's counting/gating logic (:207-212), which is the legitimate seam.
- Determinism: `FIXED_CLOCK` pins `retrievedAt: '2026-08-29T12:00:00Z'` (testkit index.ts:113; expected at tool-contract.eval.ts:107); latency budget 1000 ms for an in-process fixture call is generous — flake-safe; no wall-clock dependencies elsewhere.
- Leak check: PASS — every task closes the client in `finally` on all paths (tool-contract.eval.ts:59-61,80-87,115-117,155-157,198-200,232-234,258-260,290-292; judge.live.eval.ts:28-30).
- Snapshot regeneration: documented (docs/evals.md:35-36) — the pointer to the "probe" in 00-repo-survey.md describes the stdio entry but gives no verbatim command (minor, folded into §6).
- Over-mocking: none beyond the sanctioned testkit seam (the plan's premise: fixtures ARE lumen's offline seam).

## 4. Anti-pattern sweep — PASS

- No needless abstraction/config: cases are code+JSON; only new config is two npm scripts + one gitignore line (evalite-notes.md).
- State: none beyond evalite's gitignored `.evalite/` storage (.gitignore:18-19).
- Leaked processes/timers: none — in-process transports closed in `finally` (§3); no intervals introduced.
- Stray artifacts: `git ls-files` clean — no `.promptfoo-cache`, `.last-run.json`, `.evalite`, or run JSON committed.

## 5. Commit hygiene — PASS

- Single commit `fd09763`, message in prompt-file form naming framework + coverage ("evals: adopt evalite — 11-case offline gate for the MCP tool contract") with a body stating the comparison outcome; no Co-authored-by/AI trailers (identity-gate safe, check-commits.mjs:132-135); no stray artifacts in the tree (§4).
- Note: the final branch carries BOTH trials' docs in one commit rather than cherry-picked merges — plan does not forbid it and the artifacts belong on the final branch per PLAN_1:65.

## 6. Feasibility/reality — MINOR-FAIL (doc accuracy)

- Run instructions match reality: `npm run test:evals` → `-w @lumen-seo/mcp` → `evalite run --threshold 100` (package.json:19-20 → packages/mcp/package.json:24); flags verified against the installed CLI (`evalite run [--threshold value]`); the netns proof command is runnable as written; judge enable command would run (but see below).
- **MINOR-FAIL — the live-judge story is partly fictional.** docs/evals.md:26 says `EVAL_LIVE=1 OPENAI_API_KEY=<key> npx evalite run judge.live` enables the judge and :46 says it "does not run without EVAL_LIVE" — but `judge.live.eval.ts:15` is a hard `evalite.skip` and NOTHING reads `EVAL_LIVE`; the documented gate is a no-op (enabling requires deleting `.skip` and pinning the provider, as the file's own comments say). docs/evals.md:42 further asserts promptfoo-style verdict caching "keyed on input/output/rubric" applies via evalite — no such provider-call cache exists in the committed code (the scorer is a `() => 0` stub, judge.live.eval.ts:37); the promptfoo-notes correctly mark judge caching UNVERIFIED. Spec inv 1 requires a live gate that works as documented. Fix: either wire the skip to `process.env.EVAL_LIVE` or correct docs/evals.md to say the case is enabled by removing `.skip` + pinning.
- **MINOR-FAIL — measured numbers don't match the tree.** evalite-notes.md claims "tool-contract.eval.ts ~250" (actual 301) and "snapshot JSON ~430 lines" (actual 179), with an internal contradiction ("~280 total" vs components summing ~754); comparison.md:13 repeats "~710 (incl. 430-line wire-generated snapshot)" (actual code+data sum: 563). The weighted rubric totals (131/128) are not reproducible from the committed artifacts (per-dimension weights live in the uncommitted survey doc — re-scores are shown, weights aren't). The trial's deliverable is measured data; the table should match `wc -l` and state where weights come from.
- comparison.md ↔ notes consistency otherwise PASS: setup minutes (35/40), runtimes (~10 s vs ~2-3 s/0.15 s), offline proof method, rubric re-score lists, early-stop "none", runner-up rationale all agree across comparison.md and both notes files.

## Verdict

Two spec-invariant misses (CI trigger scope; negative-case family count) and three minor doc/build-hygiene issues (fictional EVAL_LIVE gate + caching claim; dist emits eval files importing a devDep and referencing JSON tsc doesn't emit — verified by running `tsc -p packages/mcp/tsconfig.build.json --outDir /tmp/...`; measured-line-count drift). All concrete and fixable in place; core mechanics (offline proof, regression detection, gate wiring, hygiene) are real and verified.

VERDICT: MINOR-FAIL — the evalite adoption is sound and evidence-backed, but the committed gate is missing its second negative family, the evals job doesn't run on every push, and the docs promise a live gate and numbers they don't have.

## Re-validation (post-fix, commit b01dc2b)

Re-verified each rev-1 finding against the tree at b01dc2b (note: this validation file itself was committed as part of b01dc2b — against the review instruction "do NOT commit"; process nit, not re-litigated).

1. Inv 8/9 negative families — RESOLVED. Three new evals with real content assertions: `strict-args-unknown-rejected` (isError===true AND `-32602` AND `Unrecognized key` AND the offending key name echoed, tool-contract.eval.ts:302-335), `url-guard-blocks-private` (code `INVALID_URL` + message mentions loopback, :336-361), `unknown-tool-not-executed` (isError + hostile tool name echoed, never executed, :362-394). All close the client in `finally`. Gate re-run in review: **14 evals, Score 100%, Threshold 100% (passed)**, judge file contributes 0 evals (skip works). Families now: denied + bad-input + hostile-input — inv 8/9 satisfied. Observation (non-blocking): 14 data cases exceeds the spec's "8–12" band if "case" = data case (10 if "case" = eval block, in range); the overshoot is the direct result of the mandated negative-coverage fix — record the counting unit in docs/evals.md or drop one redundant positive if the band is read strictly.
2. Inv 3 CI trigger — RESOLVED. `.github/workflows/evals.yml:3-6` now `on: push:` (no branch filter) + `pull_request:` — every push runs the evals job, matching ci.yml's own convention.
3. Live-gate doc fiction — PARTIALLY RESOLVED. The rewritten "How to run against a live model" section is now honest (hard `evalite.skip`, scorer is a `() => 0` stub, enabling = replace skip + implement a pinned scorer, "nothing reads EVAL_LIVE in the committed suite today") — the inv-1 gate fiction is gone. **Residual:** the "How the judge model is pinned and cached" section still asserts as fact that "promptfoo-style verdict caching (keyed on input/output/rubric) applies to the judge's provider calls" — no judge implementation exists and no evalite provider-call cache was demonstrated; this claim was half of rev-1 finding 3 and is unchanged. Fix: qualify it as the intended design for the not-yet-written judge, or cite the mechanism.
4. Build hygiene — RESOLVED. `tsconfig.build.json` now excludes `src/evals`; re-ran `tsc -p packages/mcp/tsconfig.build.json --outDir /tmp/...` — zero eval files emitted into dist (verified).
5. Doc accuracy — NOT-RESOLVED (regressed into two new specifics). (a) evalite-notes.md still claims "tool-contract.eval.ts 301" / "563 total, measured" — measured NOW: tool-contract.eval.ts is **395** lines post-fix (wc -l), total 657, not 563; the "measured" numbers were updated for the eval count (7→10) but not the line counts. (b) comparison.md now publishes the weights table (sums to 53 ✓, source named ✓) — which makes the totals checkable, and they FAIL to reproduce: evalite scores (2,3,3,3,2,1,2,2,3,3,3,3,2,3) × the committed weights (4,5,5,5,4,4,3,3,4,4,5,3,2,2) = **135, not 131**; promptfoo (2,0,2,3,3,1,2,3,3,3,3,3,3,3) × same = **124, not 128**. Either the weights line or the totals line is wrong — recompute one of them.

REVISED VERDICT: MINOR-FAIL — CI trigger, negative coverage, and build hygiene are genuinely fixed and re-verified (gate green 14/14), but the measured-data artifacts remain self-inconsistent (stale line counts; rubric totals irreproducible from the now-published weights) and the judge-caching overclaim survives in docs/evals.md.
