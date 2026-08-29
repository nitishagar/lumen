---
date: 2026-08-29
planner: ci-deploy plan author (create_plan_generic_v2_5, scale=large)
aspect: ci-deploy (P6a in M0, P6b in M2)
inherits: thoughts/shared/research/2026-08-29-seolite-greenfield-research.md (Implicit Spec I1–I17)
contract: thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md
status: complete
---

# IMPLICIT_SPEC — ci-deploy (seolite)

## 1. Global invariants inherited (I1–I17) and their ci-deploy interpretation

Every invariant from the research Implicit Spec applies to this aspect unless the owning aspect is named. Where ci-deploy is the *enforcer* of another aspect's invariant, the mechanism is a CI gate; where another aspect owns the substance, ci-deploy only contracts the interface.

| ID | Requirement (short) | ci-deploy interpretation |
|----|---------------------|--------------------------|
| I1 | Zero-cost defaults; BYOK absent → skip with explicit "not configured", never crash | **Directly implemented at the CI layer**: `deploy-worker` and `npm publish` jobs must detect absent secrets and skip cleanly (green pipeline, notice in log). The repo's own deploy path obeys the same skip-when-unconfigured semantics it ships to users. |
| I2 | Pluggability at data boundaries | Not owned here. CI does not gate provider internals; scoped test selection (Phase 2) must map package paths → workspace names mechanically (from `package-lock.json`), so adding a workspace never requires editing CI. |
| I3 | Data honesty / provenance | Not owned here. No CI mechanism beyond ensuring tests (which assert provenance fields) run on every merge. |
| I4 | Crawl etiquette | Not owned here. CI test jobs must be deterministic and must never perform live crawls (I9/I10 forbid it); the CLI smoke in `npm run validate` performs no network requests at all. |
| I5 | MCP-first parity | Not owned here. CI enforces that the MCP stdio handshake smoke (Phase 7 `cli-smoke.mjs`) stays green on main, guarding the parity surface at the integration gate. |
| I6 | Worker stays thin | Not owned here. CI only deploys what `packages/mcp` produces; a Worker that violated I6 would still pass CI — enforcement is P4's + review's job. CI's role: deploy only from green main. |
| I7 | Look derived, not copied | Not owned here (site-docs owns). CI deploys whatever the `site` build emits; no gate on design tokens. |
| I8 | Apache-2.0 + attributions | **CI gate**: LICENSE file present at repo root with Apache-2.0 content markers, enforced from the first green run. Per-file SPDX headers are NOT enforced (research: recommendation only). CrUX/Tranco attribution display is site/providers' duty; CI does not grep for it in v1. |
| I9 | TDD gate; deterministic tests; full suite on every push; phase not done until green | **The core of this aspect**: `ci.yml` runs lint+typecheck+test on every push/PR (full suite on main and PRs, workspace-scoped on branches); `npm run validate` is the orchestrator's final gate; no merge to main with red checks (aspect edge E1). |
| I10 | Determinism | CI jobs pin Node 22 via setup-node; dependency versions pinned by committed `package-lock.json`; no CI step depends on wall-clock or live network (the only outbound calls CI makes are registry installs and the wrangler/npm publishes, which are not tests). |
| I11 | Repo hygiene: public repo, Apache, commit identity Nitish Agarwal `<1592163+nitishagar@users.noreply.github.com>`, NO AI co-author/generated trailers | **CI gate, two-tier**: every new commit must be AUTHORED by Nitish Agarwal (`dependabot[bot]` sole exception); COMMITTER accepted as Nitish, `dependabot[bot]` (alongside a dependabot author), or `GitHub <noreply@github.com>`/web-flow — the unavoidable signature of GitHub-created squash/rebase merges, which the plan's locked merge procedure itself produces (an author-AND-committer-strict rule would leave main permanently red after the first protected squash merge); message must contain no `Co-Authored-By:`/`Generated-…` trailers; zero-SHA `github.event.before` (new branch) falls back to `origin/main..HEAD`. Gate checks new commits only; existing history verified compliant 2026-08-29. |
| I12 | SSRF safety | Not owned here. Consequence for CI: the CLI smoke must NOT exercise live audits against loopback fixture servers (the SSRF guard refuses private targets by design) — smoke covers help/config/stdio-MCP only; fetch-level tests use injected fetchers inside vitest (P1/P2's tests). |
| I13 | Output safety | Not owned here. CI's contribution: reports/logs produced by CI are GitHub artifacts, not Pages content. |
| I14 | Concurrency/cancellation/partial failure | Mirrored at CI level: workflow `concurrency` groups cancel superseded branch runs; deploys serialize (`cancel-in-progress: false`); publish treats duplicate-publish at the tag version as idempotent success — npm signals it as EPUBLISHCONFLICT/HTTP 403 ("cannot publish over the previously published versions"), 409 legacy (rerun safety, Phase 6). |
| I15 | Boundary inputs | Not owned here. |
| I16 | No telemetry | CI itself sends nothing beyond GitHub/npm/Cloudflare endpoints inherent to Actions. No secrets echoed into logs (tokens passed via action inputs / env, never `set -x`). |
| I17 | Retry & backoff | Applied to the only CI-owned network operations that need it: workspace publish retries registry-lag E404s with bounded backoff (3 attempts, 15s), honoring the "bounded retry, typed errors" pattern. Test-suite retries are FORBIDDEN (would mask flaky = non-deterministic tests, violating I9/I10). |

## 2. Aspect edges (requirements specific to ci-deploy)

- **E1 CI-green-before-merge (hard sequencing requirement).** P6a lands in M0 and is green on main before ANY other aspect merge (P2, P3, P4, P5). Branch protection via `gh api` (exact commands in PLAN Phase 3) enforces it mechanically: required checks `identity`, `workflow-lint`, `lint`, `typecheck`, `test`, PR-required with 0 approvals (solo maintainer), strict up-to-date, enforce_admins. Merge order inside M0: scaffold-core scaffold → P6a → scaffold-core core package (contingency if scaffold is not yet merged: Phase 1b fallback in PLAN — P6a adds the minimal bootstrap files it gates on; deterministic in both cases).
- **E2 deploy-never-fails-on-missing-secrets.** `CLOUDFLARE_API_TOKEN` / `NODE_AUTH_TOKEN` do not exist on this machine (research-verified). Their jobs must detect absence and terminate green with a `::notice::` before any expensive or authenticated step. Mechanism constraint (docs-verified 2026-08-29): the `secrets` AND `env` contexts are NOT available in job-level `if` — the gate is a guard *step* (secret injected via step `env`, checked in shell, result exported as step output); all later steps of the job are conditioned on that output. A skipped deploy must never block or fail the pipeline, and `wrangler`/`npm publish` must never be reached without credentials.
- **E3 Evidence-pinned actions.** Every `uses:` in every workflow is pinned to a major version backed by recorded evidence: `actions/checkout@v5`, `actions/setup-node@v5`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`, `cloudflare/wrangler-action@v4` (research [V]); `rhysd/actionlint` docker tag `1.7.12` (verified current release). `actionlint` runs as a required check so a workflow that misuses contexts (e.g. `secrets` in job-level `if`) cannot merge. Version freshness is maintained by dependabot (github-actions + npm ecosystems) landing as part of P6a.
- **E4 Orchestrator-run GitHub API operations are documented as exact commands.** Pages enablement (`build_type=workflow`), branch protection, repo merge-settings, and secret setup are NOT performed by workflows; the PLAN records the exact `gh api` command sequences for the orchestrator to run (M0: protection; M2: Pages + optional secrets).
- **E5 Workflows never write to the repository.** No CI step commits or pushes (Pages deploys are artifact-based; releases create GH Releases, not commits). This keeps the identity gate sound: every commit on main is a human-reviewed merge.

## 3. Bounding assumptions (autonomous mode — conservative defaults, no open questions)

1. Remote is `github.com/nitishagar/seolite`, public, created by the orchestrator before P6a merges (name verified available in research).
2. M0 merge order: scaffold-core scaffold stub → P6a → scaffold-core core package; if the scaffold stub is absent at P6a merge time, P6a Phase 1b adds the minimal bootstrap files (root `package.json` + lockfile, LICENSE) itself.
3. Site workspace is named `@seolite/site` (private), builds via `npm run build -w @seolite/site`, and emits static output to `site/dist/` (contract imposed on P5).
4. `packages/mcp/wrangler.jsonc` (or `.toml`) commits `account_id` (non-secret identifier) and `main`; the `CLOUDFLARE_ACCOUNT_ID` secret is an optional override passed to wrangler-action.
5. No Cloudflare/npm credentials exist locally or in CI during v1 development; gated jobs are verified in skip-mode only. First real deploys happen when the user adds secrets (documented steps), possibly after M2.
6. Node 22.x latest minor is acceptable (Node >=22 is the locked engine; exact deps pinned by `package-lock.json`; Node 20 is being removed from runners in 2026 — 22 is the safe pin).
7. Public repo ⇒ GitHub Actions standard-runner minutes and Pages are $0; no larger runners, no self-hosted runners.
8. Solo maintainer ⇒ PR-required-with-0-approvals protection; merges are squash merges whose message the orchestrator sets explicitly (conventional, no trailers); `dependabot[bot]` is allowlisted in the identity gate.
9. First release tag is `v0.1.0`; all workspace packages share the tag's version (single-version monorepo; internal `@seolite/*` deps rewritten to exact tag version at publish time).
10. Pages serves `https://nitishagar.github.io/seolite/`; no custom domain, no HTTPS cert management needed.
11. `act` is not used for local workflow verification (Docker/action/runtime divergence; not worth it for 4 small workflows) — local verification = `actionlint` + script unit tests + dry-run modes; live verification = `gh workflow list` / `gh run watch` post-push.
12. The site is small (≪1 GB) and traffic negligible (≪100 GB/mo) — no Pages-limit engineering.
13. `npm run validate` grows in two locked stages: P6a = typecheck+lint+test; P6b adds site build + CLI smoke. Root `package.json` script edits are single-line additive merges (conflict surface acknowledged, owned by this aspect after M0).
