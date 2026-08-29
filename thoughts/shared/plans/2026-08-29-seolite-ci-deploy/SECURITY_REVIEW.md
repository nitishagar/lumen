# Security Review — feat/ci-deploy-p6b (diff 215dc24..HEAD)

Scope: `.github/workflows/{pages,deploy-worker,release}.yml`,
`scripts/ci/{publish-workspaces,cli-smoke}.mjs`, `package.json`, `README.md`
(tests reviewed for consistency, not separately audited).

## Findings

### 1. [LOW] `pages.yml` `build` job over-permissioned
- File: `.github/workflows/pages.yml:96`
- The `build` job declares `permissions: { contents: read, pages: write, id-token: write }`, but it only checks out, builds, and calls `actions/upload-pages-artifact`, which does not require `pages: write` or `id-token: write` (those are needed by the `deploy` job's `actions/deploy-pages` step, which already has its own correct permissions block at line 111). Granting the build job OIDC (`id-token: write`) and Pages-write it doesn't use is an unnecessary privilege grant.
- Impact: low — no untrusted input reaches this job (push-to-main only), but it widens the blast radius if the build job's dependencies (npm packages via `npm ci`) were ever compromised.
- Fix: drop `pages: write` and `id-token: write` from the `build` job; leave `contents: read` only.

### 2. [LOW] `release.yml` grants `contents: write` to all three jobs, but only one needs it
- File: `.github/workflows/release.yml:140`
- `permissions: { contents: write }` is set at workflow level, so `build-and-test` (runs `npm run validate`) and `publish` (runs `npm publish` via `NODE_AUTH_TOKEN`) both inherit write access to repo contents they never use — only `github-release` (the `gh release create` step) needs it.
- Impact: low — same reasoning as #1; least-privilege hygiene rather than an exploitable path, since none of these jobs run against untrusted/attacker-controlled input (trigger is `push: tags: ['v*']`, requiring existing push access).
- Fix: move `permissions: { contents: write }` to the `github-release` job only; add `permissions: { contents: read }` (or omit, since default is now restricted) to the other two.

## Verified as sound (no finding)

- **Secrets never touch argv or logs.** `CLOUDFLARE_API_TOKEN`/`NODE_AUTH_TOKEN` are injected only via step `env:` (deploy-worker.yml:42, release.yml:171/188) or action `with:` inputs (deploy-worker.yml:64), tested only via shell `-z` checks, never `echo`'d, never written to disk. `npm publish` reads `NODE_AUTH_TOKEN` from the process environment automatically — the token never appears in `npmPublishArgs()` (publish-workspaces.mjs:652), keeping it out of argv/process listings. No `set -x`/verbose flags anywhere in the new workflows.
- **No unsafe `${{ }}` splicing into `run:` script bodies.** Every workflow value derived from `github.*` or `secrets.*` is passed through a step `env:` map first (`CF_TOKEN`, `NPM_TOKEN`, `TAG`) and referenced in shell as a quoted env var (`"$TAG"`, `$GITHUB_REF_NAME`, `$GITHUB_REPOSITORY`) — the classic script-injection pattern (direct `${{ github.ref_name }}` inlined into the script text) is absent throughout.
- **Tag validation gates all downstream use.** `TAG=github.ref_name` is quoted (`"$TAG"`) so shell metacharacters in the tag can't be interpreted (env var content isn't re-evaluated by bash), and `parseTag()` (publish-workspaces.mjs:557) anchors the *entire* string against a strict SemVer regex before anything else runs — the validated `version` is used only as a JSON `version`/dependency-range value (rewriteManifest, publish-workspaces.mjs:637), never as a path or shell argument. All `npm`/`gh` invocations use `spawnSync`/`run:` with array args or quoted env-var refs, not string-interpolated shell commands.
- **File writes stay in-bounds.** `publish-workspaces.mjs` only writes to `<root>/<dir>/package.json` where `dir` is filtered to `packages/*` from the (repo-committed, not attacker-supplied-at-runtime) lockfile; `cli-smoke.mjs`'s `--cli-dir` is a local/test-only override, never fed by tag/ref data in the real CI invocation. No traversal vector reachable from workflow inputs.
- **Restore-on-failure is guaranteed.** All manifest rewrites happen inside a `try` block that pushes `{path, original}` onto `mutated` immediately after each write, before any `npm publish` call begins; the `finally` block restores every entry in `mutated` regardless of which publish call throws (publish-workspaces.mjs:764-777) — confirmed by the "restores manifests even when a publish fails mid-run" test.
- **Triggers.** All three workflows use `push`/`workflow_dispatch` only — no `pull_request_target`, no `workflow_run` on forks. No untrusted fork PR can execute these jobs or reach the secrets.
- **Supply chain.** All actions (`actions/checkout@v5`, `actions/setup-node@v5`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`, `cloudflare/wrangler-action@v4`) are pinned to major-version tags, consistent with the plan's documented accepted-risk posture; no new unpinned or unexpected action introduced.

VERDICT: MINOR-FAIL

---

## Author resolution

Both LOW findings accepted as-is: each permission assignment is verbatim from the validated PLAN sketch (Phase 4 build-job permissions; Phase 6 workflow-level `contents: write`), GitHub's own documented Pages flow uses the same shape, and neither is exploitable (no untrusted input reaches those jobs; only trusted actions are used). Recorded here rather than diverged from the plan; can be tightened in a follow-up if the maintainers want strict least privilege.
