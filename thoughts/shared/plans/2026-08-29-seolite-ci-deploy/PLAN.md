---
date: 2026-08-29
protocol: create_plan_generic_v2_5
scale: large
aspect: ci-deploy
deliverables: P6a (M0: ci.yml + gates + protection) and P6b (M2: pages.yml, deploy-worker.yml, release, validate meta-gate)
repo: github.com/nitishagar/seolite (greenfield; local repo exists with research+architecture docs only, no remote yet)
status: complete
---

# PLAN — seolite ci-deploy (P6a + P6b)

## SIGNPOST

This plan builds the repo's CI/CD spine: the **first green gate** of the repository (P6a, lands in M0 before any other aspect merge) and the **free-tier deploy + release layer** (P6b, lands in M2). Done looks like:

- M0: every push/PR runs lint + typecheck + test (workspace-scoped on branches, full on main), plus commit-identity and Apache-license gates; branch protection on `main` enforces green-before-merge via `gh api`; all verified with `gh workflow list` / `gh run watch`.
- M2: GitHub Pages deploys from main via the Actions `build_type=workflow` flow; a Cloudflare Worker deploy job that skips cleanly while `CLOUDFLARE_API_TOKEN` is absent (this machine has none); tag-driven release with token-gated npm publish (skip-cleanly semantics); `npm run validate` = the orchestrator's final validation gate; status badges on README.
- Zero open questions: every decision below is locked with evidence; conservative defaults are recorded as bounding assumptions (see IMPLICIT_SPEC.md §3, 13 items).

## Overview

ci-deploy is the enforcement and delivery layer for the seolite monorepo (6 workspaces: `packages/{core,audit,providers,cli,mcp}`, `site`). It has two landings:

1. **P6a (M0, before any other aspect merge)** — `.github/workflows/ci.yml` with five required checks: `identity` (AUTHOR must be `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>` — `dependabot[bot]` sole exception; COMMITTER accepted as Nitish OR GitHub's squash-merge signature `GitHub <noreply@github.com>`/web-flow OR `dependabot[bot]` alongside a dependabot author; rejection of `Co-Authored-By:`/`Generated-…` trailers; zero-SHA new-branch guard), `workflow-lint` (actionlint 1.7.12), `lint`, `typecheck`, `test` (Node 22, npm workspaces; workspace-scoped selection on branch pushes via reverse-dependency closure from `package-lock.json`, full suite on main and PRs); `.github/dependabot.yml`; `.github/workflows/*` validated by actionlint both locally and in CI; repo metadata it owns (LICENSE verification-or-add, CONTRIBUTING.md, SECURITY.md, root `validate` script); branch protection applied via exact `gh api` commands immediately after landing.
2. **P6b (M2)** — `pages.yml` (configure-pages@v5 → site build → upload-pages-artifact@v3 → deploy-pages@v4, `pages: write` + `id-token: write`, environment `github-pages`), Pages enablement via exact `gh api` sequence (`build_type=workflow`), `deploy-worker.yml` (cloudflare/wrangler-action@v4, guard-step skip when `CLOUDFLARE_API_TOKEN` absent), `release.yml` (tag → build+test → GH Release → token-gated ordered npm publish with idempotent rerun), extended `npm run validate` (+ site build + CLI/stdio-MCP smoke), README badges.

All decisions locked; every `uses:` pinned to an evidence-backed major; no secrets required for the pipeline to stay green.

## Current State

- Local repo `~/repos/learn/seolite` on `main`, 5 commits (init, research, audit, architecture contract, plan bundles) — all authored `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`, no trailers (verified 2026-08-29). **No remote, no package.json, no workflows, no LICENSE** — only `thoughts/` and `.gitignore`.
- No Cloudflare credentials on this machine (`wrangler whoami` → not authenticated; research [V]). No npm token. No GitHub repo yet (name `nitishagar/seolite` verified available).
- Sibling plan bundles (scaffold-core etc.) are being authored in parallel; interfaces come from ARCHITECTURE.md, which is the only coordination surface needed here.
- Locked context: TS ESM, Node >=22, npm workspaces, Vitest everywhere, cheerio Node-side, MCP via `@modelcontextprotocol/sdk`, Pages via Actions, wrangler-action@v4, Apache-2.0, no AI co-author trailers.

## Desired End State

**M0 (P6a landed, before any M1 merge):**
- `main` protected: PRs required (0 approvals), strict up-to-date, `enforce_admins`, force-push/deletion denied; required checks `identity`, `workflow-lint`, `lint`, `typecheck`, `test`.
- Every push to any branch: identity + workflow-lint always; lint + typecheck full; test full on main/PRs, reverse-dependency-scoped on branches (fail-safe to full).
- LICENSE (Apache-2.0) verified present; CONTRIBUTING.md + SECURITY.md stubs exist; `.github/dependabot.yml` active; root `npm run validate` = typecheck + lint + test.
- CI scripts (`scripts/ci/check-commits.mjs`, `scripts/ci/select-workspaces.mjs`) unit-tested (they are the repo's first tests, keeping `vitest run` non-empty from day one).

**M2 (P6b landed):**
- `pages.yml` deploys the site on every main push; `gh api repos/nitishagar/seolite/pages` shows `build_type: "workflow"`; `https://nitishagar.github.io/seolite/` serves the built site.
- `deploy-worker.yml` on main pushes touching `packages/mcp/**`: with no secret → guard step emits `::notice::` and the job ends green in seconds; once the secret exists → `wrangler deploy` from `packages/mcp`.
- Pushing tag `v0.1.0` → full test → GH Release with generated notes → token-gated publish of the five `@seolite/*` packages in dependency order (skips cleanly without `NODE_AUTH_TOKEN`; rerun-safe via already-published idempotency).
- `npm run validate` = typecheck + lint + test + site build + CLI/stdio-MCP smoke; run by the orchestrator as the final M2 validation gate.
- README carries CI/Pages/License badges (+ npm badge after first successful publish).

**Verify commands (the durable evidence):**
```bash
npm run validate                                                     # final gate (P6a scope in M0; extended in M2)
actionlint                                                           # local workflow validation (brew-installed, see Testing Strategy)
gh workflow list --repo nitishagar/seolite                           # ci.yml (+ pages, deploy-worker, release in M2)
gh run list --workflow=ci.yml --repo nitishagar/seolite --limit 1 \
  --json conclusion,workflowName --jq '.[0].conclusion'              # "success"
gh api repos/nitishagar/seolite/pages --jq '.build_type'             # "workflow" (M2)
gh api repos/nitishagar/seolite/branches/main/protection \
  --jq '.required_status_checks.contexts'                            # ["identity","workflow-lint","lint","typecheck","test"]
curl -fsSI https://nitishagar.github.io/seolite/ | head -1           # HTTP/2 200 (M2)
gh api repos/nitishagar/seolite/actions/workflows --jq '.workflows[].path'  # all four workflow paths
```

## What We're NOT Doing

- **No `act` local workflow execution** — Docker/runtime/credential divergence and maintenance cost outweigh value for four small workflows (bounding assumption 11).
- **No full-SHA action pinning** — major-tag pins backed by evidence + dependabot freshness; SHA pinning documented as the upgrade path if untrusted third-party actions are ever added (Design Analysis → Alternatives).
- **No npm OIDC trusted publishing in v1** — requires a pre-existing npm package configured on npmjs.com; first publish is token-gated; migration documented (References), not built.
- **No Pages legacy/branch deploy** — `build_type=workflow` only (locked by research evidence).
- **No preview/staging environments** — no `wrangler versions upload` preview channel, no per-PR Pages previews, no Vercel/Netlify; deploys come only from green `main`.
- **No Windows/macOS CI matrix, no Node 24 matrix** — ubuntu-latest + Node 22 only (locked stack); no larger/self-hosted runners.
- **No per-file SPDX header enforcement, no CrUX-attribution grep in CI** — I8 says headers are recommended-only; attribution display is site/providers' duty (their plans own it).
- **No test retries, no flaky-test tolerance** — I9/I10: a flaky test is a bug; CI never masks it.
- **No CI commits to the repo** (no generated changelogs, no version-bump commits from CI; version setting happens inside the publish job in-memory on the runner, never pushed).
- **No custom domain, no analytics on the site, no scheduled (cron) workflows, no artifact-retention tuning** (GitHub defaults).

## Approach

Two landings, both PR-gated by the very checks they introduce.

**P6a (M0).** Land, in one PR after scaffold-core's scaffold stub: (a) `scripts/ci/check-commits.mjs` and `scripts/ci/select-workspaces.mjs` with vitest unit tests (TDD per I9 — these are also the first tests in the repo); (b) `.github/workflows/ci.yml` with the five jobs; (c) `.github/dependabot.yml`; (d) metadata it owns: LICENSE verify-or-add (canonical Apache-2.0 text), CONTRIBUTING.md, SECURITY.md stubs, root `validate` script line. Validate all workflows with actionlint locally, open PR, watch checks green, squash-merge, then apply repo settings + branch protection via `gh api` (exact commands in Phase 3) so every subsequent merge — scaffold-core's core package first — passes through the gate.

**P6b (M2).** Land after the integration pieces exist: `pages.yml` (two jobs: build with `configure-pages@v5` + upload artifact; deploy with `deploy-pages@v4` into `github-pages` environment), `deploy-worker.yml` (guard-step secret detection → wrangler-action@v4), `release.yml` (tag-triggered: build+test → GH Release → guarded ordered publish via `scripts/ci/publish-workspaces.mjs`), extension of `validate` (site build + `scripts/ci/cli-smoke.mjs` incl. a stdio MCP initialize-handshake), README badges. The orchestrator then runs the documented `gh api` sequences: enable Pages (`build_type=workflow`), re-verify protection contexts, (optionally, when the user obtains credentials) add `CLOUDFLARE_API_TOKEN` / `NODE_AUTH_TOKEN` secrets — each addition activates its job with zero workflow changes (the skip-cleanly design means secret-absence is a modeled state, not an error).

**Key mechanism decisions (all evidence-backed):**
- *Secret-presence skip*: guard step (secret injected via step `env`, checked in shell, output consumed by later steps' `if`) — because `secrets` and `env` contexts are NOT available in job-level `if` (GitHub docs, verified 2026-08-29). actionlint would catch the illegal patterns anyway.
- *Workspace-scoped branch tests*: `select-workspaces.mjs` computes changed packages from `git diff --name-only $(git merge-base origin/main HEAD)` and expands to the reverse-dependency closure parsed from `package-lock.json`, emitting exactly one `$GITHUB_OUTPUT`-ready `scope=<value>` line (`-w @seolite/x -w …`, or `scope=ALL` when the diff has no package paths / the lockfile cannot be parsed / the base is unresolvable — fail-safe toward more testing); the runner consumes it via a quoted, array-split expansion (shellcheck-clean).
- *Identity gate*: strict on AUTHOR (must be Nitish Agarwal, `dependabot[bot]` sole exception), deliberately two-tier on COMMITTER (Nitish, or `GitHub <noreply@github.com>`/web-flow — the committer GitHub stamps on every squash/rebase merge it creates, i.e. the locked merge procedure's own signature, or `dependabot[bot]` alongside a dependabot author); checks only new commits (push range `github.event.before..sha` with a zero-SHA guard falling back to `origin/main..HEAD` on new branches, PR range `merge-base(base)..head`), so the compliant existing history is never re-judged and the gate never false-alarms on its own merge flow.
- *Pages flow*: research-pinned action chain, artifact path contracted as `site/dist` (imposed on site-docs, P5).
- *Publish path*: token-gated publish-on-tag chosen over unconditional-on-tag (would fail this machine's reality) and no-publish-v1 (would break the documented `npx @seolite/cli` onboarding surface, ARCHITECTURE CLI/MCP sections); single-version policy with internal dep ranges rewritten to the tag version before publish.

## Design Analysis

### Invariants → mechanism

| Invariant / edge | Mechanism |
|---|---|
| E1 CI-green-before-merge | `ci.yml` five jobs; branch protection (Phase 3 `gh api`): required contexts `["identity","workflow-lint","lint","typecheck","test"]`, `strict: true`, PR required (0 approvals), `enforce_admins: true`, force-push/deletions denied, linear history required. Applied in M0 before any M1 merge. |
| I9 full suite every push | `test` job: full `npm test` when `github.ref == refs/heads/main` or `pull_request` event; scoped `npm test -w <pkg>…` on branch pushes via select script; selection failure ⇒ full. |
| I9 TDD | CI scripts themselves are tested first (Phase 1); `vitest run` non-empty from P6a's first green run. |
| I11 commit identity | `identity` job, two-tier rule: AUTHOR must be `Nitish Agarwal / 1592163+nitishagar@users.noreply.github.com` (`dependabot[bot]` sole exception); COMMITTER must be Nitish, `GitHub <noreply@github.com>` (web-flow — the committer on every GitHub-created squash/rebase merge, i.e. the locked merge procedure's own signature), or `dependabot[bot]` when the author is dependabot; message body must match none of `/^co-authored-by:/i`, `/^generated[-_ ]?(by\|with)/i`; zero-SHA `before` (new branch) ⇒ base falls back to `origin/main`; new-commits-only range. Runs on every push (incl. main — catches squash-merge-message violations) and PR. |
| I8 Apache compliance | `identity` job also asserts `LICENSE` exists and contains `Apache License`, `Version 2.0, January 2004`, `http://www.apache.org/licenses/` (full-text presence ⇒ §4(a) satisfied; research [V] single LICENSE file suffices). |
| I1 skip-when-unconfigured (at deploy layer) | Guard-step pattern in `deploy-worker.yml` and `release.yml` publish job; `::notice::` documents the skip; job green; `wrangler`/`npm publish` unreachable without credentials. |
| E3 evidence-pinned actions | All `uses:` from the evidence table; `workflow-lint` job runs `rhysd/actionlint:1.7.12` docker image over all workflow files (catches illegal context use, unknown action inputs); `.github/dependabot.yml` (github-actions + npm, weekly, max 5 PRs) keeps majors fresh; dependabot PRs ride the same green-required gates. |
| I10 determinism | `actions/setup-node@v5` `node-version: 22`; committed `package-lock.json`; no network in tests; CI emits no timestamps into artifacts it gates on. |
| I14 mirrored | `concurrency` groups: `ci-{ref}` cancels superseded branch runs (never on main); `pages` and `deploy-worker` groups serialize (`cancel-in-progress: false`). |
| I17 bounded retry | Publish-only: 3 attempts / 15 s backoff on registry-lag E404; typed failure with package name attached. No retries anywhere in test/lint/typecheck. |
| I16 no telemetry | Workflows talk only to github.com, registry.npmjs.org, api.npmjs.org, api.cloudflare.com; tokens only via action inputs / env, never echoed. |

### Failure handling

- **Failed test/lint/typecheck/identity on a PR** → required check red → merge blocked by protection. Recovery: fix and push; `strict: true` forces rebase onto updated main.
- **Broken workflow YAML / illegal expression** → `workflow-lint` (actionlint) fails the PR before it can land; if a bad workflow somehow reaches main, `gh run list` in the phase success criteria detects it and a follow-up PR reverts (workflows are versioned like code).
- **Failed Pages deploy** → previous deployment keeps serving (deploy-pages is atomic per deployment; the site is never half-updated). Rerun (`gh run rerun` or next main push) is safe: artifact upload is idempotent per run.
- **Failed Worker deploy** → Cloudflare keeps the last successful version serving; `wrangler deploy` failure leaves the running Worker untouched. Rerun safe (deploy is idempotent for the same source). **Missing token** → modeled skip (green), never a failure (E2).
- **Failed / interrupted publish** → npm versions are immutable. `publish-workspaces.mjs` treats a duplicate-publish response as idempotent success when the registry already holds the tag version: npm signals this as **EPUBLISHCONFLICT / HTTP 403** ("You cannot publish over the previously published versions"), with 409 as the legacy status — the script matches status ∈ {403, 409} OR message `/cannot publish over/i` (a rerun of a partially-published set then completes green); retries registry-lag E404 3×/15 s; anything else fails with the package name attached. A release that must actually change content ⇒ new tag/new version (never force-retag; force-retagging is not attempted by this plan).
- **GH Release step** is idempotent: `gh release view $TAG || gh release create $TAG --generate-notes` (rerun-safe).
- **select-workspaces edge cases**: no package paths in the diff (docs/`.github`/`scripts`-only change), empty diff, lockfile parse failure, or unresolvable base ⇒ `scope=ALL` (root vitest discovery runs everything — fail-safe toward more testing). The script ALWAYS exits 0 and emits exactly one `scope=<value>` line whose value matches `^(ALL\|-w [A-Za-z0-9@/._-]+( -w [A-Za-z0-9@/._-]+)*)$` (npm names + `-w` flags only — safe to expand in the runner shell).
- **New-branch push (zero-SHA `github.event.before` = 40 zeros)**: `git log 0000000…` would error ⇒ the identity job substitutes `origin/main` as the range base; if `origin/main` is unresolvable the range check exits 0 with a `::notice::` (possible only before the first push; the LICENSE check still runs). Without this guard, every first push of a new branch would spurious-red `identity`.
- **Squash-merge committer semantics**: `gh pr merge --squash` produces a commit AUTHORED by the merger (Nitish) and COMMITTED by `GitHub <noreply@github.com>` (web-flow, GPG-signed by GitHub). The gate's author-strict/committer-two-tier rule accepts exactly that signature; without the web-flow committer tier, the first protected squash merge would leave main's `identity` check permanently red while merges continued (PR-side checks run on locally-authored head commits). Dependabot's squash-merged PRs are authored by the merger too, so only its branch commits carry the dependabot identity.
- **First workflow run on an empty-ish repo** (P6a merge itself): root scripts exist (scaffold contract), P6a's script tests make `vitest run` non-empty, LICENSE exists ⇒ green. Contingency if scaffold is absent: Phase 1b adds minimal `package.json`+lockfile+LICENSE before Phase 2.

### Blast radius on other aspects

- **scaffold-core (P1)**: contracts imposed — root `package.json` has scripts `lint`, `typecheck`, `test` (root-level Vitest discovery across workspaces), every workspace package has a working `test` script, committed `package-lock.json`, `engines.node >=22`. If scaffold hasn't merged when P6a does, Phase 1b supplies the minimal versions and scaffold rebases (additive, single-line conflicts at worst — root `package.json` scripts block is co-owned additively thereafter: P6a adds `validate`, P6b extends it).
- **audit-engine (P2) / providers (P3) / surfaces (P4)**: merge gates — their branches must be green; scoped selection protects them from sibling-branch test breakage pre-merge. Package names must match ARCHITECTURE (`@seolite/core`, …) so path→workspace mapping via `package-lock.json` is automatic; no CI edits needed when workspaces are added.
- **surfaces (P4)**: `deploy-worker.yml` expects `packages/mcp/wrangler.jsonc` (or `.toml`) with committed non-secret `account_id`, `main` entry, and `npm run build -w @seolite/mcp` to produce deployable output; `cli-smoke.mjs` resolves the CLI entry from `packages/cli/package.json` `bin` field and expects `seolite config show` to print JSON, `--help` to exit 0, and `seolite mcp` to answer an MCP `initialize` request over stdio.
- **site-docs (P5)**: workspace `@seolite/site` (private), build script emitting to `site/dist/`, base path `/seolite/` (Pages project path — P5 must configure the SSG base; `configure-pages@v5` exposes it for frameworks that auto-detect).
- **Orchestrator**: executes `gh api` sequences (Phases 3, 4), sets secrets when available (documented, optional), and runs `npm run validate` as the final M2 gate. Nothing else in the pipeline requires human configuration — secret absence is a modeled, green state.
- **Greenfield default**: this aspect's files are additive; the only shared-surface edits are the root `package.json` scripts block and README badge block (single-line merges).

### Alternatives (decided, with evidence)

- **Actions version pinning strategy**: (a) *major tags + dependabot* — CHOSEN: matches research evidence (`configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4`, `wrangler-action@v4` [V]; `checkout@v5`/`setup-node@v5` verified current, June-2026 Node-24 runner enforcement makes v4/v3 pins hazardous); transparent diffs for a solo maintainer. (b) Full-SHA pinning — stricter supply chain, but unreadable bump diffs and no benefit today (no untrusted third-party actions; the only non-GitHub action is Cloudflare's official wrangler-action). Recorded upgrade path: switch to SHA pins if any non-official action is ever introduced. (c) `@main` floating refs — rejected (unreproducible, violates E3).
- **Pages `build_type=workflow` vs legacy**: workflow build — CHOSEN: research [V] documents exactly this flow (`configure-pages` → build → `upload-pages-artifact` → `deploy-pages`, enabled via `POST /repos/{owner}/{repo}/pages` with `build_type: "workflow"`); legacy branch-push deploy cannot run our SSG build. Cost: one-time `gh api` enable.
- **Secret-presence gating**: (a) *guard step + step-output conditions* — CHOSEN: docs-verified (secrets unavailable in job-level `if`; env unavailable in job-level `if`), zero configuration, cannot drift. (b) Job-level `if: secrets.X != ''` — impossible (workflow parse error). (c) Job-level `if: env.HAS_X != ''` — not available per current contexts table. (d) Repository *variable* flag (`vars.DEPLOY == 'true'`) — shows a cleaner "Skipped" status but adds a second setting that can drift from the secret; rejected.
- **Release/publish path**: (a) *NODE_AUTH_TOKEN-gated publish on tag* — CHOSEN: names verified available, `npx @seolite/cli` is a documented product surface (onboarding + remote-MCP fallback error), machine has no token ⇒ gate required. (b) publish-on-tag unconditional — fails the pipeline on this machine; violates E2 spirit. (c) no-publish-v1 — breaks the CLI onboarding surface; rejected. Trusted publishing (OIDC) documented as post-first-publish migration, not v1.
- **Workspace-scoped branch tests**: (a) *reverse-dependency closure from lockfile* — CHOSEN: safe (dependents always re-tested) and mechanical. (b) changed-paths-only — misses dependent packages. (c) always full — simplest but ignores the locked requirement and wastes minutes on every branch push; kept only as the fail-safe fallback.
- **Workflow validation tooling**: *actionlint* — CHOSEN (semantic checks: expressions/contexts, action inputs, shellcheck of `run:` blocks); *yamllint* — style-only, redundant alongside actionlint; *act* — rejected (see NOT-DOING).
- **Defaults locked**: Node `22`; ubuntu-latest; `fetch-depth: 0` (tiny repo; merge-base/identity ranges need history); no setup-node npm cache in P6a (lockfile may not exist yet — cache added in P6b workflows where lockfile is guaranteed); first release `v0.1.0`; squash-merge policy with explicit conventional subjects.

## Resource & Cost Analysis

**Actions minutes (public repo ⇒ $0, unlimited standard-runner minutes — research [V]).** Volume math anyway, to stay honest about runner load:
- ci.yml per push: `identity` ~0.5 min + `workflow-lint` ~0.5 min + `lint` ~1 min + `typecheck` ~1 min + `test` ~2–4 min ≈ **~7 min/run** (branch pushes save the test delta via scoping).
- Expected usage: build phase ~15 branches × ~8 pushes + ~15 PR runs + ~20 main runs ≈ 155 runs/mo × ~6 min avg ≈ **~930 min/mo → $0**. Post-M2 steady state ~30 runs/mo ≈ 200 min → $0. Even 10× that stays free on a public repo.
- Storage: no artifacts retained except the Pages artifact (retention 1 day, internal to the deploy flow) and nothing else configured ⇒ negligible.

**Pages (free soft limits — research [V]):** site ≪ 1 GB limit; bandwidth ≪ 100 GB/mo; deploys ~20/mo ≪ Actions-served build capacity. Bounding assumption 12: no limit engineering.

**Cloudflare Workers (deployed only once the user adds a token):** free tier 100k req/day, 10 ms CPU (research [V]) — the thin gateway fits; CI cost of deploys: ~2 min/deploy, $0.

**npm:** publishing is free; token-gated so no cost until real.

**Human time (the real cost):** P6a ≈ one focused session (scripts are ~150 LOC total with tests); P6b ≈ one session; orchestrator `gh api` runs are minutes.

## Phases

> Merge/sequencing contract: **Phase 1–3 = P6a (M0)**, land after scaffold-core's scaffold stub and before any other aspect merge; **Phase 4–7 = P6b (M2)**, land during the M2 integration window on green main. All merges via PR + squash (`gh pr create` → `gh pr merge --squash --subject "<type>: …" --body ""`): the squash commit is AUTHORED by the merger (Nitish) and COMMITTED by `GitHub <noreply@github.com>` (web-flow) — the identity gate accepts exactly that signature (Phase 1 contract); no trailers.

### Phase 1 — CI support scripts + owned metadata (TDD) [P6a, M0]

**Changes:**
- `scripts/ci/check-commits.mjs` — input: range (`--base`/`--head`; empty `--base` ⇒ range check skipped, exit 0 with `::notice::`); reads `git log --format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B` for new commits; fails with per-commit, actionable errors when: (a) AUTHOR ∉ {`Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`, `dependabot[bot]`}; (b) COMMITTER ∉ {Nitish identity, `GitHub <noreply@github.com>` (web-flow — GitHub-created squash/rebase merges), `dependabot[bot]` (only alongside a dependabot author)}; (c) message body matches `/^co-authored-by:/im` or `/^generated[-_ ]?(by|with)/im`. Also `--license` mode: asserts `LICENSE` exists and contains the three Apache-2.0 markers. Exit codes: 0 ok, 1 violations (list them).
- `scripts/ci/select-workspaces.mjs` — input: diff paths (stdin or `git diff` invocation); parses `package-lock.json` `packages` entries to build workspace name↔dir map + dependency graph; ALWAYS exits 0 and emits exactly one `$GITHUB_OUTPUT`-ready line `scope=<value>` — value is the changed workspaces expanded to the reverse-dependency closure as `-w @seolite/x -w @seolite/y…` (space-joined), or `ALL` when the diff contains no package paths / the lockfile cannot be parsed / the base is unresolvable (fail-safe toward full suite). Value charset restricted to `[A-Za-z0-9@/._- ]` (npm names + `-w` flags only) so the runner shell can split it safely.
- Vitest unit tests for both (fixture lockfile; fixture git-log records covering: Nitish-authored/Nitish-committed compliant, Nitish-authored + `GitHub <noreply@github.com>`-committed squash merge [PASS], wrong author, wrong author with web-flow committer [must FAIL], dependabot branch commit, trailer variants, empty base, license markers; no network, deterministic — I10).
- Metadata: verify `LICENSE` (add canonical Apache-2.0 full text if scaffold-core hasn't — text is verbatim from apache.org, research [V]); add `CONTRIBUTING.md` (setup, `npm run validate`, PR + commit-identity rules incl. "no AI co-author trailers — CI enforces", Apache licensing note); add `SECURITY.md` (supported = main, GitHub private vulnerability reporting link); add root script `"validate": "npm run typecheck && npm run lint && npm test"` (additive single line).
- If `package-lock.json` still absent at merge-prep time → **Phase 1b (contingency)**: add minimal root `package.json` (name `seolite`, private, workspaces `packages/*`, `site`, engines node >=22, the four scripts) + run `npm install` to commit the lockfile; scaffold-core rebases onto it.

**Success Criteria:**
- [x] Automated: `npm test` green (includes the two new script test files).
- [x] Automated: `node scripts/ci/check-commits.mjs --license` exits 0.
- [x] Automated: `printf 'packages/core/src/fetcher.ts\n' | node scripts/ci/select-workspaces.mjs` prints exactly `scope=-w @seolite/core …` (fixture closure incl. `@seolite/core`; fixture mode `--lockfile test/fixtures/package-lock.json`), and `printf 'README.md\n' | node scripts/ci/select-workspaces.mjs` prints exactly `scope=ALL` (GITHUB_OUTPUT `key=value` format asserted in unit tests).
- [x] Automated: `npm run validate` exits 0.

### Phase 2 — ci.yml + dependabot + workflow-lint [P6a, M0]

**Changes (sketch):**
```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:                      # all branches (worktree branches + main)
  pull_request:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

jobs:
  identity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci
      - name: Commit identity + Apache LICENSE gate
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            BASE="${{ github.event.pull_request.base.sha }}"
          else
            BEFORE="${{ github.event.before }}"
            if [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
              BASE="origin/main"    # zero-SHA guard: first push of a new branch → check commits not yet on main
              git rev-parse -q --verify "$BASE" >/dev/null || BASE=""   # unborn main (bootstrap) → range check off
            else BASE="$BEFORE"; fi
          fi
          node scripts/ci/check-commits.mjs --base "$BASE" --head "${{ github.sha }}"
          node scripts/ci/check-commits.mjs --license

  workflow-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: actionlint (pinned)
        run: docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v5
        with: { node-version: 22 }
      - run: npm ci
      - name: Resolve test scope
        id: sel
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ] || [ "${{ github.ref }}" = "refs/heads/main" ]; then
            echo "scope=ALL" >> "$GITHUB_OUTPUT"           # full suite on main + PRs
          else
            BASE="$(git merge-base origin/main HEAD 2>/dev/null || true)"
            git diff --name-only "$BASE" "${{ github.sha }}" \
              | node scripts/ci/select-workspaces.mjs >> "$GITHUB_OUTPUT"   # script always exits 0; emits scope=… or scope=ALL
          fi
      - name: Run tests
        run: |
          if [ "${{ steps.sel.outputs.scope }}" = "ALL" ]; then
            npm test
          else
            read -ra WS <<< "${{ steps.sel.outputs.scope }}"   # scope = "-w @seolite/x -w @seolite/y" (charset-restricted, Phase 1)
            npm test "${WS[@]}"                                # array-split: shellcheck-clean, correct word boundaries
          fi
```
```yaml
# .github/dependabot.yml
version: 2
updates:
  - { package-ecosystem: github-actions, directory: /, schedule: { interval: weekly }, open-pull-requests-limit: 5 }
  - { package-ecosystem: npm, directory: /, schedule: { interval: weekly }, open-pull-requests-limit: 5 }
```
- Local gate before pushing: `actionlint` over all workflow files (brew-installed; see Testing Strategy).

**Success Criteria:**
- [x] Automated: `actionlint` exits 0 locally for `.github/workflows/*.yml`.
- [x] Automated: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` exits 0 (CI parity with local).
- [x] Automated: `npm run validate` exits 0 on the branch.

### Phase 3 — Land P6a, then lock `main` (branch protection via gh api) [P6a, M0]

**Changes:** PR → checks green → squash-merge (`feat: bootstrap CI gates — identity, license, workflow-lint, lint, typecheck, scoped tests`). Then the orchestrator runs, exactly:

```bash
# 0. Repo settings: squash+rebase only, delete branches on merge, linear-friendly
gh api -X PATCH repos/nitishagar/seolite \
  -f allow_squash_merge=true -f allow_merge_commit=false -f allow_rebase_merge=true \
  -f delete_branch_on_merge=true -f has_wiki=false

# 1. Protect main: PR required (0 approvals), green checks, strict, admins included
gh api -X PUT repos/nitishagar/seolite/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true,
    "contexts": ["identity", "workflow-lint", "lint", "typecheck", "test"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false, "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "required_linear_history": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

# 2. Verify protection + CI state
gh api repos/nitishagar/seolite/branches/main/protection \
  --jq '{contexts: .required_status_checks.contexts, strict: .required_status_checks.strict, admins: .enforce_admins.enabled, prs: .required_pull_request_reviews.required_approving_review_count}'
gh workflow list --repo nitishagar/seolite
gh run watch "$(gh run list --workflow=ci.yml --repo nitishagar/seolite --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```
(Required-token note: local `gh` authenticated as `nitishagar` has admin; the contexts must equal the job names above verbatim.)

**Success Criteria:**
- [x] Automated: `gh api repos/nitishagar/seolite/branches/main/protection --jq '.required_status_checks.contexts'` = `["identity","workflow-lint","lint","typecheck","test"]`.
- [x] Automated: `gh api repos/nitishagar/seolite/branches/main/protection --jq '.required_pull_request_reviews.required_approving_review_count'` = `0` and `.enforce_admins.enabled` = `true`.
- [x] Automated: `gh run list --workflow=ci.yml --repo nitishagar/seolite --limit 1 --json conclusion --jq '.[0].conclusion'` = `success` on main.
- [x] Automated (GREEN squash-merge probe): the protected squash merge of this phase's PR is itself the probe — its commit is authored by Nitish and committed by `GitHub <noreply@github.com>` (web-flow); after merge, `gh api repos/nitishagar/seolite/commits/main --jq '.commit.committer.email'` = `noreply@github.com` AND `gh run list --workflow=ci.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` = `success` — proving the committer tier accepts the plan's own merge signature.
- [x] Automated: a deliberately non-compliant commit pushed to a NEW scratch branch shows a failed `identity` check with an actionable message — exercising the zero-SHA guard path (`before` = 40 zeros ⇒ base falls back to `origin/main`, which does not contain the bad commit, so it is still flagged) (one-time adversarial probe, then delete branch) — validates the gate actually gates.

### Phase 4 — pages.yml + Pages enablement + badges [P6b, M2]

**Changes (sketch):**
```yaml
# .github/workflows/pages.yml
name: Deploy Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: read, pages: write, id-token: write }
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build -w @seolite/site     # P5 contract: emits site/dist, base path /seolite/
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: site/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions: { pages: write, id-token: write }
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
- Orchestrator API sequence (documented; run after this workflow is on main):
```bash
gh api repos/nitishagar/seolite/pages                                   # expect 404 (not yet enabled)
gh api -X POST repos/nitishagar/seolite/pages -f build_type=workflow    # enable Actions-built Pages
gh api repos/nitishagar/seolite/pages --jq '{build_type: .build_type, html_url: .html_url}'
gh run watch "$(gh run list --workflow=pages.yml --repo nitishagar/seolite --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```
- README badges (additive block; README body remains scaffold-core's): CI badge, Pages badge, License (Apache-2.0) badge. npm badge deferred to Phase 6.

**Success Criteria:**
- [ ] Automated: `gh api repos/nitishagar/lumen/pages --jq '.build_type'` = `workflow`. *(orchestrator-run: Pages enablement API sequence; not executable locally. Plan's `seolite` URLs realized as `lumen` per the rename mapping.)*
- [ ] Automated: `gh run list --workflow=pages.yml --repo nitishagar/lumen --limit 1 --json conclusion --jq '.[0].conclusion'` = `success`. *(orchestrator-run post-merge)*
- [ ] Automated: `curl -fsSI https://nitishagar.github.io/lumen/ | head -1` = `HTTP/2 200`. *(orchestrator-run post-deploy)*
- [ ] Automated: `actionlint` green with pages.yml present; `gh api repos/nitishagar/lumen --jq '.has_pages'` = `true`. *(actionlint part verified green locally via the pinned docker image; `has_pages` is orchestrator-run)*

### Phase 5 — deploy-worker.yml (skip-cleanly gated) [P6b, M2]

**Changes (sketch — guard-step pattern; docs-verified: `secrets`/`env` unavailable in job-level `if`):**
```yaml
# .github/workflows/deploy-worker.yml
name: Deploy Worker
on:
  push:
    branches: [main]
    paths: ['packages/mcp/**', '.github/workflows/deploy-worker.yml']
  workflow_dispatch:
concurrency:
  group: deploy-worker
  cancel-in-progress: false
permissions: { contents: read }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Guard — skip cleanly when CLOUDFLARE_API_TOKEN is absent
        id: guard
        env:
          CF_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          if [ -z "$CF_TOKEN" ]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            echo "::notice::CLOUDFLARE_API_TOKEN not configured — skipping Worker deploy (Worker remains deployable-but-not-deployed; add the secret to activate)"
          else
            echo "skip=false" >> "$GITHUB_OUTPUT"
          fi
      - uses: actions/checkout@v5
        if: steps.guard.outputs.skip != 'true'
      - uses: actions/setup-node@v5
        if: steps.guard.outputs.skip != 'true'
        with: { node-version: 22, cache: npm }
      - run: npm ci
        if: steps.guard.outputs.skip != 'true'
      - run: npm run build -w @seolite/mcp
        if: steps.guard.outputs.skip != 'true'
      - name: wrangler deploy
        if: steps.guard.outputs.skip != 'true'
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}   # optional override; account_id normally committed in packages/mcp/wrangler config
          command: deploy
          workingDirectory: packages/mcp
```
- Cross-check `packages/mcp/wrangler.jsonc` exists with committed `account_id` + `main` (P4 contract; non-secret identifier — Cloudflare docs) before merging this phase; if absent, phase blocks and surfaces the gap to the orchestrator (does not invent the file).
- Secret setup instructions for the user (documented in CONTRIBUTING/README deploy section, executed only when the user has credentials): create a Workers-scoped API token; `gh secret set CLOUDFLARE_API_TOKEN --repo nitishagar/seolite` (+ optional `CLOUDFLARE_ACCOUNT_ID`).

**Success Criteria:**
- [x] Automated: `actionlint` green with deploy-worker.yml present.
- [ ] Automated (skip-mode, no secret — the expected state on this machine): push to main touching `packages/mcp/**` → `gh run list --workflow=deploy-worker.yml --limit 1 --json conclusion --jq '.[0].conclusion'` = `success`, log contains the `::notice::` skip line, and the run duration is seconds (guard-only). *(orchestrator-run post-merge; guard logic verified by inspection + actionlint)*
- [ ] Automated: `grep -q account_id packages/mcp/wrangler.*` passes (config contract satisfied). *(DEFERRED to the surfaces merge: `packages/mcp` is still a stub on main — no wrangler config, no build script. The workflow is committed now and skips cleanly without the secret; the contract becomes verifiable when the real Worker lands. Do not invent the file.)*

### Phase 6 — release.yml: tag → GH Release → token-gated npm publish [P6b, M2]

**Changes (sketch):**
```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']
permissions: { contents: write }        # GH Release only; nothing commits to the repo
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run validate            # typecheck + lint + test + site build + cli smoke
  github-release:
    needs: build-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: gh release view "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" \
             || gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" \
                --verify-tag --generate-notes
        env: { GH_TOKEN: ${{ github.token }} }
  publish:
    needs: [build-and-test, github-release]
    runs-on: ubuntu-latest
    steps:
      - name: Guard — skip cleanly when NODE_AUTH_TOKEN is absent
        id: guard
        env: { NPM_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }} }
        run: |
          if [ -z "$NPM_TOKEN" ]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            echo "::notice::NODE_AUTH_TOKEN not configured — tag v* produced a GitHub Release only; no npm publish"
          else echo "skip=false" >> "$GITHUB_OUTPUT"; fi
      - uses: actions/checkout@v5
        if: steps.guard.outputs.skip != 'true'
      - uses: actions/setup-node@v5
        if: steps.guard.outputs.skip != 'true'
        with: { node-version: 22, cache: npm, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
        if: steps.guard.outputs.skip != 'true'
      - name: Publish workspaces in dependency order
        if: steps.guard.outputs.skip != 'true'
        env: { NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}, TAG: ${{ github.ref_name }} }
        run: node scripts/ci/publish-workspaces.mjs --tag "$TAG"
```
- `scripts/ci/publish-workspaces.mjs` (unit-tested ordering logic with an injected runner): validates tag is SemVer (`v0.1.0` ⇒ `0.1.0`); rewrites every workspace `package.json` version to the tag version and internal `@seolite/*` dependency ranges to the exact tag version (runner-local, never committed); publishes `@seolite/core → audit → providers → mcp → cli` via `npm publish -w <pkg> --access public --tag latest`; **duplicate publish at the same version ⇒ idempotent success** — npm emits this as EPUBLISHCONFLICT / HTTP 403 ("You cannot publish over the previously published versions"; 409 is the legacy status), so the script matches status ∈ {403, 409} OR message `/cannot publish over/i` (rerun of a partially-published set completes green); E404 during dependent resolution ⇒ retry 3× / 15 s (I17); other failures ⇒ typed error naming the package. Local dry-run: `node scripts/ci/publish-workspaces.mjs --tag v0.1.0 --dry-run`.
- README: add npm badge after first verified publish.

**Decision record (locked):** NODE_AUTH_TOKEN-gated publish-on-tag. Evidence: `npx @seolite/cli` is a documented onboarding surface (ARCHITECTURE CLI + MCP sections); npm names verified unregistered/available; machine has no npm token ⇒ unconditional publish would violate the no-fail spirit of E2; no-publish-v1 would strand the CLI/MCP onboarding; OIDC trusted publishing requires a pre-existing package + npmjs.com config ⇒ documented migration path post-first-publish.

**Success Criteria:**
- [x] Automated: `node scripts/ci/publish-workspaces.mjs --tag v0.1.0 --dry-run` exits 0 and prints the ordered publish plan.
- [x] Automated: `npm test` green (publish-order unit tests included). *(40 publish-workspaces tests with an injected runner, no registry calls; full suite 477 green)*
- [ ] Automated (skip-mode): push `v0.1.0` with no `NODE_AUTH_TOKEN` → `gh run list --workflow=release.yml --limit 1 --json conclusion --jq '.[0].conclusion'` = `success`; `gh release view v0.1.0 --repo nitishagar/lumen` exists; log shows the `::notice::` skip. *(orchestrator-run at tag time)*
- [ ] Automated (post-token, whenever the user adds it): `npm view @lumen-seo/cli version` returns the tag version; re-running the publish job is green via duplicate-publish idempotency ({403, 409} + `/cannot publish over/i`). *(user/orchestrator-run; idempotency logic unit-tested)*

### Phase 7 — validate meta-gate (final form) + M2 end-to-end verification [P6b, M2]

**Changes:**
- `scripts/ci/cli-smoke.mjs` (deterministic, zero network — I4/I12-respecting): builds `@seolite/cli` if needed (`npm run build -w @seolite/cli`), resolves the entry from `packages/cli/package.json` `bin`; asserts (a) `<bin> --help` exits 0 and mentions `seolite`; (b) `<bin> config show` exits 0 and stdout parses as JSON; (c) spawn `<bin> mcp`, write JSON-RPC `initialize` (id 1, protocolVersion per installed SDK default), assert a response with matching id and `result.serverInfo.name` within 10 s, then terminate. No URL audits (SSRF guard would refuse loopback by design — I12; live-crawl behavior is covered by P2/P4's injected-fetcher vitest tests).
- Extend root script: `"validate": "npm run typecheck && npm run lint && npm test && npm run build -w @seolite/site && node scripts/ci/cli-smoke.mjs"`.
- Final verification sweep (orchestrator, M2 close): run the Desired-End-State verify commands; optionally enable private vulnerability reporting: `gh api -X PUT repos/nitishagar/seolite/private-vulnerability-reporting`.

**Success Criteria:**
- [x] Automated: `npm run validate` exits 0 on main (the orchestrator's final M2 gate). *(verified green locally on `feat/ci-deploy-p6b`: typecheck + lint + 477 tests + site build + cli-smoke skip; the on-main re-check after merge remains the orchestrator's M2 gate. Full cli-smoke e2e activates when the surfaces merge lands the CLI `bin` entry.)*
- [ ] Automated: `gh api repos/nitishagar/lumen/branches/main/protection --jq '.required_status_checks.contexts'` still = `["identity","workflow-lint","lint","typecheck","test"]` (deploy workflows deliberately NOT required checks — skipped/path-filtered checks must never block merges). *(orchestrator-run; nothing in this branch touches protection)*
- [ ] Automated: `gh api repos/nitishagar/lumen/actions/workflows --jq '.workflows[].path'` lists all four (ci, pages, deploy-worker, release). *(orchestrator-run; all four workflow files verified present in the tree)*
- [x] Automated: `actionlint` green over all four workflows. *(pinned rhysd/actionlint:1.7.12 docker image, local = CI engine)*

## Testing Strategy

**Workflow validation — actionlint, not yamllint (decided).** actionlint statically checks workflow semantics: expression contexts (it would flag `secrets:` in a job-level `if` — the exact trap this plan avoids), action inputs against known action metadata, and shellchecks `run:` blocks. yamllint adds only style rules on top of a semantic checker; both together is redundant for four small workflows. Pinned toolchain:
- Local (dev machine, darwin): `brew install actionlint` (v1.7.12 current release, verified); run `actionlint` from repo root before every workflow-affecting commit.
- CI: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` as the required `workflow-lint` job (docker image tag pinned; same engine locally).

**Script correctness — vitest unit tests (TDD).** `check-commits.mjs` (fixture git-log records: Nitish/Nitish compliant, Nitish-authored + `GitHub <noreply@github.com>`-committed squash [PASS], wrong author, wrong author with web-flow committer [FAIL], trailer, dependabot branch commit, empty base, license variants) and `select-workspaces.mjs` (fixture lockfile: leaf change, core change ⇒ dependents included, docs-only ⇒ `scope=ALL`, malformed lockfile ⇒ `scope=ALL`; asserts the exact `scope=` `key=value` line format) — deterministic, offline, fast. `publish-workspaces.mjs` ordering + duplicate-publish ({403, 409} + `/cannot publish over/i`) + E404 handling tested with an injected command runner (no registry calls in tests).

**Local dry-runs (act-free verification of the deploy paths).**
- Site flow: `npm run build -w @seolite/site` proves the build step; upload/deploy steps are runner-only, verified post-push.
- Publish flow: `node scripts/ci/publish-workspaces.mjs --tag vX.Y.Z --dry-run` + `npm publish` never invoked locally.
- Worker flow: verified in skip-mode post-push (guard runs, wrangler never reached); real-mode only after the user adds the secret.
- `npm run validate` is the composed local equivalent of everything CI checks (minus runner-only deploy steps).

**Live verification (post-push, the real gate).** `gh workflow list` (workflows loaded/recognized), `gh run watch --exit-status` (checks green), the `gh api` assertions in phase success criteria (protection, Pages `build_type`, workflow inventory), `curl -sI https://nitishagar.github.io/seolite/` (Pages live), and the Phase 3 adversarial probe (a deliberately non-compliant commit must be rejected by the identity gate) — proving the gates gate, not merely pass.

**Explicitly rejected:** `act` (runtime divergence, no credentials locally); yamllint (redundant); test retries (masks non-determinism); a "workflow-lint via npx" step (no maintained npm distribution; docker tag pinning is cleaner).

## References

- Research: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — Seam 5 (Pages Actions flow + `build_type=workflow`, wrangler-action@v4 + `CLOUDFLARE_API_TOKEN`, Actions free for public repos, Apache §4(a) single-LICENSE compliance, no CF credentials on machine); I1, I8–I11, I14, I17; Evidence Ledger.
- Architecture contract: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — locked P6a/P6b split, M0/M2 sequencing, commit-identity rules, workspace/package names, CLI exit-code contract.
- GitHub docs (fetched 2026-08-29): Pages via Actions + `POST /repos/{owner}/{repo}/pages` `build_type: "workflow"`; contexts availability (secrets/env NOT in job-level `if`; secrets available in workflow-level `env`); branch protection API (`PUT /repos/{owner}/{repo}/branches/{branch}/protection`); docs.github.com/billing (Actions free for public repos); Pages limits (1 GB / 100 GB-mo soft).
- Action evidence: `actions/checkout` v5.1.0 + `actions/setup-node` v5 (node24 runtime era; Node 20 removed from runners Sept 2026); `actions/upload-pages-artifact` v3 / `actions/deploy-pages` v4 / `actions/configure-pages` v5 (research [V], corroborated); `cloudflare/wrangler-action` v4 (`apiToken`, optional `accountId`, `command`, `workingDirectory`; global-key auth removed).
- `rhysd/actionlint` v1.7.12 (static workflow checker; docker image `rhysd/actionlint:1.7.12`).
- npm: publish docs + trusted-publishing (OIDC) migration path (docs.npmjs.com/trusted-publishers); duplicate-publish semantics — EPUBLISHCONFLICT, HTTP 403 "cannot publish over the previously published versions", legacy 409 (npm blog; npm/cli#5058); workspace publish flags (`-w`, `--access public`, `--tag`).
- GitHub web-flow committer: `github.com/web-flow` ("Git committer for all web commits (merge/revert/edit/etc.) made on GitHub.com") + community discussion #135214 — GitHub-created squash/rebase merges are authored by the merger and committed by web-flow; basis for the identity gate's committer tier.
- Cloudflare: Workers free limits (100k req/day, 10 ms CPU) — developers.cloudflare.com/workers/platform/limits/; `wrangler deploy` semantics (failed deploy leaves previous version serving).
