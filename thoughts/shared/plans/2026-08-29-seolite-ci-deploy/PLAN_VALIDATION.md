# PLAN_VALIDATION — ci-deploy bundle (adversarial review)

- Date: 2026-08-29. Reviewer: adversarial plan reviewer (did not author the bundle). Default stance: FAIL until evidence.
- Under review: `IMPLICIT_SPEC.md` + `PLAN.md` in this directory.
- Cross-referenced: `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` (Seam 5, I1–I17), `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md`, `thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` (R4, R6, R10).
- Local repo re-derived at review time: 5 commits (init → research → audit → architecture → plan bundles), all author+committer = `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`, no trailers; no remote, no `.github/`, no LICENSE, no `package.json`. PLAN's "Current State" is accurate (its "4 commits" count is stale by the plan-bundles commit, all still compliant).

---

## Checklist item 1 — Every relevant invariant → named mechanism: **FAIL** (I11 mechanism is self-defeating; I9 and I8 pass)

- I9 CI-green gate: PASS. Named mechanism exists: `ci.yml` jobs `lint`/`typecheck`/`test` + branch protection required contexts (PLAN Phase 3); scoped branch tests are an explicit ARCHITECTURE-authorized deviation ("per-branch CI runs its own package scope (`npm test -w <pkg>`)" — ARCHITECTURE.md M1), fail-safe to full.
- I8 attribution: PASS as scoped. LICENSE Apache-2.0 gate is a named automated check (`check-commits.mjs --license`, 3 content markers); attribution display deliberately NOT CI-gated — documented in IMPLICIT_SPEC §1 (I8 row: "CI does not grep for it in v1") and matches ARCHITECTURE (providers own `attribution` metadata, site owns display). "Where applicable" = LICENSE only; the scoping is explicit, not an omission.
- I11 commit identity / no-co-author: **FAIL**. The mechanism is named and automated (`identity` job + `scripts/ci/check-commits.mjs`, author AND committer must equal Nitish, trailer regexes, dependabot allowlist), but it contradicts the plan's own locked merge procedure. PLAN "Phases" header locks: *"All merges via PR + squash (`gh pr create` → `gh pr merge --squash …)`"*. Every GitHub-created squash merge has **committer = `GitHub <noreply@github.com>` (web-flow)**, GPG-signed with GitHub's key; only the author is the PR submitter (evidence: https://github.com/web-flow "Git committer for all web commits (merge/revert/edit/etc.) made on GitHub.com"; https://github.com/orgs/community/discussions/135214; https://github.com/blog/changelog squash authorship). Consequences, re-derived:
  1. The first squash merge after protection lands turns main's `identity` job red — `github.event.before` push-range check sees committer `GitHub <noreply@github.com>` ∉ {Nitish, dependabot[bot]} → exit 1.
  2. It does NOT block the merge (PR-side required checks run on the PR's locally-authored head/merge commits and stay green), so merges proceed while **main is permanently red** — the worst failure mode: the I11 gate false-alarms forever and the real gate (Phase 3 criterion "`gh run list --workflow=ci.yml … conclusion` = `success` on main") is unsatisfiable from day one.
  3. Squash-merged dependabot PRs fail the same way (author dependabot[bot], committer GitHub — only the name is allowlisted, not the committer).
  4. The plan's only adversarial probe is a deliberately RED commit (Phase 3 last criterion); no GREEN squash-merge probe exists, which is exactly why this defect survives the plan's own verification.
  - **Fix**: allowlist committer `web-flow` / `GitHub <noreply@github.com>` when author is the required identity (or gate on author + trailers only, which is what DCO-style checks do), keep the author+trailer checks strict; add a Phase 3 success criterion that a compliant squash merge through protection yields `conclusion = success` on main.

## Checklist item 2 — Failure semantics (deploy failures, rerun safety, skip-when-secret-absent): **MINOR-FAIL** (guard approach verified correct; two concrete defects elsewhere)

- Guard-step skip approach: **PASS — the plan's approach is actually correct.** GitHub's contexts-availability table does exclude `secrets` AND `env` from job-level `if` (`jobs.<job_id>.if`), while step-level `env` can reference `secrets` and `steps.*.outputs` are available in step-level `if`. The plan's pattern (secret → step `env` → shell `-z` test → `$GITHUB_OUTPUT` → later steps' `if`) is the canonical workaround, and in both `deploy-worker.yml` (Phase 5) and `release.yml` publish (Phase 6) the guard is the FIRST step — before checkout/`npm ci`/wrangler/npm publish — satisfying E2's "before any expensive or authenticated step", job ends green with `::notice::`. `accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` passing empty string is harmless (wrangler-action treats empty input as unset).
- Deploy-failure semantics: PASS. pages.yml — failed `deploy-pages` leaves the previous deployment serving (deployment-based, atomic); deploy-worker — failed `wrangler deploy` leaves the last version serving; both rerun-safe. GH Release idempotent (`gh release view || gh release create --verify-tag`). Force-retag correctly ruled out.
- Rerun safety of publish: **FAIL (minor)**. `publish-workspaces.mjs` keys idempotency on "E409 'cannot publish over'". npm's actual duplicate-publish failure surfaces as **EPUBLISHCONFLICT** and modern npm/cli/registry report **403** ("You cannot publish over the previously published versions") — E409 is the legacy status (evidence: https://blog.npmjs.org/post/81614852121/error-code-epublishconflict-and-cannot-publish-over.html; https://github.com/npm/cli/issues/5058). The unit tests can't catch this (injected runner, no registry calls), so the rerun-safety linchpin would break in production on a partially-published set. Fix: match status ∈ {403, 409} or message `/cannot publish over/i`.
- Identity job edge: **FAIL (minor)**. First push that creates a new branch sends `github.event.before` = 40 zero chars; `git log 0000000..HEAD` errors → spurious red `identity` run on every new branch (and would taint the Phase 3 scratch-branch probe, which is a new branch). The `test` job is unaffected (merge-base path). Fix: all-zero `before` ⇒ fall back to `origin/main..HEAD` or exit 0 with notice.

## Checklist item 3 — All consumers enumerated; script names match other plans (R4): **MINOR-FAIL** (names conform; one consumption path broken)

- Names conform: root `lint`/`typecheck`/`test` imposed on P1 (scaffold-core) and consumed by ci.yml + `validate`; `npm run build -w @seolite/site` matches R4 verbatim (workspace `@seolite/site`, output `site/dist/`, base `/seolite/`); `npm run build -w @seolite/mcp` and `packages/mcp/wrangler.jsonc` contract imposed on P4 per ARCHITECTURE; publish order core→audit→providers→mcp→cli matches ARCHITECTURE's package set (5 published, `@seolite/site` private/excluded); scoped `npm test -w …` matches ARCHITECTURE M1.
- **FAIL (minor)**: `select-workspaces.mjs` stdout contract is inconsistent between its Phase 1 spec ("outputs … as `test -w @seolite/x -w …`"; success criterion expects human-readable closure incl. `@seolite/core`) and its ci.yml consumption (`node … >> "$GITHUB_OUTPUT"`, which requires `key=value` lines). Raw non-`key=value` output makes the runner reject/ignore it → `steps.sel.outputs.scope` empty → `npm test` (full) — i.e. the scoped branch-test optimization silently never engages, while the plan claims it does. Additionally `npm test ${{ steps.sel.outputs.scope }}` is an unquoted expansion (SC2086) that actionlint's embedded shellcheck will flag on the plan's own sketch. Fix: lock the script contract to `scope=-w …` / `scope=FULL`, unit-test that exact format, quote or array-ify the expansion.

## Checklist item 4 — No correctness-for-simplicity trades: **PASS**

- No test retries / flake tolerance (explicit); fail-safe direction everywhere: selection failure ⇒ full suite; missing lockfile ⇒ Phase 1b; scaffold absent ⇒ Phase 1b; Pages/Worker/publish all rerun-safe rather than "assume it worked". Scoped branch tests trade coverage only against a reverse-dependency closure (dependents always re-tested) and are ARCHITECTURE-authorized with full-suite fallback; PRs and main always run full. `fetch-depth: 0` chosen for correctness (ranges/merge-base) at negligible cost. No trade found beyond those already flagged in items 1–3.

## Checklist item 5 — No unjustified patterns (actionlint pinning, act rejection): **PASS**

- actionlint 1.7.12 pinned (docker tag + brew) with concrete justification: semantic context/expr checks (the exact `secrets`-in-job-if trap), action-input metadata, shellcheck of `run:` blocks; yamllint rejected as style-only redundancy; "no npx actionlint" justified (no maintained npm dist). `act` rejection justified in bounding assumption 11 + NOT-DOING (runtime/credential divergence for 4 small workflows) with a named replacement strategy (actionlint + script unit tests + dry-run modes + post-push `gh run watch`). Major-tag pinning vs full-SHA is a recorded decision with trigger condition for the upgrade path (any non-official third-party action); the only non-GitHub action is Cloudflare's official wrangler-action. Justified, not smuggled.

## Checklist item 6 — No TBDs / mechanisms-in-spec: **PASS**

- All four workflows sketched to step level; all three scripts have specified I/O, exit codes, retry/idempotency behavior; Pages enablement, protection, and secret setup are exact `gh api` sequences (E4); the only contingency (Phase 1b) is itself fully specified (minimal package.json + lockfile + LICENSE). No "TBD", no "decide later", no open questions. Residual "P5 must configure SSG base /seolite/" is a contract imposition, not a TBD.

## Checklist item 7 — Success criteria exact + verifiable: **PASS (with one inherited unsatisfiable criterion)**

- Contexts match ci.yml job ids EXACTLY: `["identity","workflow-lint","lint","typecheck","test"]` ↔ jobs `identity`, `workflow-lint`, `lint`, `typecheck`, `test` (check-run names default to job ids). `npm run validate` staged P6a/P6b with exact line. Pages enablement sequence complete: 404 probe → `POST /repos/.../pages -f build_type=workflow` → verify `build_type` + `has_pages` → `gh run watch` → `curl -fsSI` HTTP/2 200. Phase 7 re-verifies protection contexts and full workflow inventory. Every criterion is an executable command with an expected value.
- Caveat (cross-ref item 1): Phase 3's "main ci.yml run = success" criterion is unsatisfiable under the locked squash-merge procedure until the committer allowlist fix lands — the criterion is well-formed but the plan as written fails its own gate on the first protected merge.

## Checklist item 8 — Resource math + races: **PASS**

- Actions: public repo ⇒ $0 standard minutes (research [V]); bounding math shown (~155 runs/mo × ~6 min ≈ 930 min/mo; 10× headroom) — arithmetic checks out; concurrency groups keep run volume bounded (`ci-{ref}` cancels superseded branch runs, never on main). Storage: only the Pages artifact (≪1 GB site per assumption 12, retention ~1 day, internal to deploy flow) — negligible. Pages: ~20 deploys/mo vs 1 GB/100 GB-mo soft limits.
- Race between pages.yml and ci.yml on main pushes: none. Independent triggers on the same push, disjoint concurrency groups (`pages` serial, `ci-refs/heads/main` no-cancel), no shared mutable state; deploy-from-green-main holds mechanically because main only receives protection-gated merges; deploy-worker is path-filtered and serialized (group `deploy-worker`, `cancel-in-progress: false`); npm publishes serialize per version by registry immutability.

---

## Additional conformance checks (no findings)

- R6 M0 merge order: honored — P6a lands after scaffold stub, before any other aspect merge; Phase 1b contingency keeps the order unblocking ("scaffold rebases onto it" is additive).
- R10: honored verbatim — publish-on-tag gated on `NODE_AUTH_TOKEN`, E409-as-idempotent (subject to the item-2 error-code fix), no publish in normal CI.
- I10/I16/I17: Node 22 pin + committed lockfile + no network in tests; tokens only via inputs/env, no echo; bounded retry confined to publish (tests explicitly retry-free).
- E5 (workflows never write to the repo): honored — version rewriting is runner-local; GH Releases, not commits; protection forbids force-push/deletion.

## Verdict rationale

One mechanism-defeating defect (I11 identity gate vs GitHub-created squash-merge committer) invalidates the plan's flagship invariant gate and one Phase 3 success criterion under the plan's own locked merge procedure; three further concrete defects are small and locally fixable. Everything else (guard-step design, consumer names, sequencing, cost math, criteria exactness) is evidence-backed and internally consistent.

## Round 2 (2026-08-29, fresh adversarial reviewer — rework verification)

Scope: verify the round-1 MAJOR is actually fixed (identity gate × GitHub squash merges), spot-check the three minors, re-derive everything the rework touched (`check-commits.mjs` contract, `identity` job, Phase 3 probes) against five scenarios (first push/unborn main, new-branch push, PR squash merge, direct push to main, dependabot PR), and scan for new TBDs. Default stance: FAIL until earned.

### Round-1 items

1. **MAJOR — I11 identity gate false-reds forever on its own squash merges: RESOLVED.** The two-tier rule now appears consistently in all four homes (IMPLICIT_SPEC I11 row; PLAN Overview identity bullet; Approach "Identity gate"; Phase 1 spec clause (b)): AUTHOR strict {`Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`, `dependabot[bot]` sole exception}; COMMITTER ∈ {Nitish, `GitHub <noreply@github.com>`/web-flow, `dependabot[bot]` only alongside a dependabot author}. The false-green hole is locked shut by an explicit fixture — "wrong author with web-flow committer [must FAIL]" (Phase 1 + Testing Strategy) — and structurally: web-flow commits are created only by GitHub's merge machinery on PRs that already passed the author-strict check, so the permissive committer tier adds no bypass. The green probe round-1 demanded now exists in Phase 3: the protected squash merge of P6a's own PR must yield `gh api .../commits/main --jq '.commit.committer.email'` = `noreply@github.com` AND `gh run list --workflow=ci.yml --branch main … conclusion` = `success`.
   - Re-derivation of PR-side runs (round-1's "PR checks run on locally-authored head commits" was imprecise): on `pull_request`, `github.sha` is GitHub's transient test-merge commit on `refs/pull/N/merge`, so the range `base.sha..github.sha` includes that machine-created commit. Verified against real-world evidence (actions/checkout issue #494 shows the merge-ref commit authored by the PR author, `jsoref@users.noreply.github.com`): in this repo the merge-ref author is always Nitish or `dependabot[bot]`, and its committer is GitHub-created (web-flow or a user noreply address) — both tiers pass ⇒ no PR-side false-red, including for P6a's own landing PR. No `--no-merges` needed.
2. **Minor — publish idempotency keyed on legacy E409: RESOLVED.** Phase 6 + Failure handling + IMPLICIT_SPEC I14 + Testing Strategy now match EPUBLISHCONFLICT reality: idempotent success when status ∈ {403, 409} OR message matches `/cannot publish over/i`, with the {403,409}+message handling covered by unit tests on the injected runner.
3. **Minor — zero-SHA `github.event.before` spurious red: RESOLVED.** ci.yml sketch: 40-zero `before` ⇒ `BASE=origin/main` (comment names the new-branch case); `git rev-parse -q --verify` ⇒ unborn main (bootstrap) ⇒ `BASE=""`; `check-commits.mjs` contract: empty `--base` ⇒ range check skipped, exit 0 with `::notice::`, LICENSE gate still runs. The Phase 3 red probe deliberately exercises this path (new scratch branch; the bad commit is still flagged because `origin/main` does not contain it).
4. **Minor — select-workspaces stdout contract + unquoted expansion: RESOLVED.** Script contract locked to exactly one `$GITHUB_OUTPUT`-ready `scope=<value>` line (`scope=-w @seolite/x …` or `scope=ALL`), charset `[A-Za-z0-9@/._- ]`, `key=value` format asserted in unit tests and in the Phase 1 success criteria (exact `scope=-w @seolite/core …` / `scope=ALL` outputs); runner consumes via `read -ra WS <<< "${{ steps.sel.outputs.scope }}"` + `npm test "${WS[@]}"` (array-split, shellcheck-clean). `ALL` vs round-1's suggested `FULL` is an equivalent rename — producer, consumer, and tests all say `ALL`.

### Re-derivation of reworked surfaces (five scenarios)

| Scenario | identity behavior | Verdict |
|---|---|---|
| First push creating main (unborn main) | `before`=40 zeros ⇒ origin/main fallback ⇒ unresolvable ⇒ BASE="" ⇒ range skipped + `::notice::`; LICENSE gate still runs | no false-red; no material false-green (nothing yet to judge) |
| New-branch push | zero-SHA ⇒ `origin/main..HEAD`; Nitish commits pass; non-compliant commit goes red (Phase 3 red probe) | correct |
| PR squash merge to main | push range `before..sha` = squash commit only: author is Nitish (multi-commit squash) or the PR head author (single-commit squash, already author-gated PR-side), committer web-flow ⇒ pass; green probe asserts exactly this | correct |
| Direct push to main | mechanically blocked by protection (PR required, `enforce_admins: true`, both re-verified by Phase 3 criteria); identity job on main runs as defense-in-depth | correct |
| Dependabot PR | branch commits author+committer `dependabot[bot]` (author exception + pairing rule); squash merge author=Nitish/committer=web-flow passes, and even the alternate squash-authorship variant (author=dependabot preserved) passes both tiers; dependabot messages carry no `Co-Authored-By:` | correct |

Additional false-red/false-green sweep: PR with advanced base (range picks up newer main commits — all Nitish/web-flow ⇒ pass); local branch commits (author+committer Nitish per Current State verification); web-UI edit commits (author Nitish, committer web-flow ⇒ pass); Nitish-author + dependabot-committer correctly rejected by the pairing rule. Residual nano-edge, recorded for honesty and not gate-affecting: a force-pushed rewritten branch could leave `github.event.before` unfetchable and red a *branch* push run — branch runs are not required contexts, main cannot be force-pushed, and PR runs use `base.sha`, so no merge-blocking impact.

### New TBDs / conformance

- **No new TBDs or open questions introduced.** Every reworked section is closed-form: the two-tier rule, dependabot pairing rule, fixture list, probe assertions, and the fallback ladder (`BEFORE` → `origin/main` → skip+`::notice::`) are fully specified; Phase 1b and Phase 5's "block and surface the gap" remain defined contingencies, not TBDs.
- R6 merge order still honored (Phase header: after scaffold-core's scaffold stub, before any other aspect merge; Phase 1b keeps the order unblocking). R10 still honored (tag `v*` → `NODE_AUTH_TOKEN`-gated publish; the {403,409} superset only strengthens R10's E409-idempotent intent; no publish in normal CI).
- Round-1 items 4–8 re-checked on the reworked text: unchanged conclusions. The previously unsatisfiable Phase 3 "main run = success" criterion is now satisfiable by construction and explicitly probed.

VERDICT: PASS
