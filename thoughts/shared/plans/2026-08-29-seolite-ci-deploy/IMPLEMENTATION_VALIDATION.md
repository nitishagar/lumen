# IMPLEMENTATION_VALIDATION — P6b (ci-deploy, Phases 4–7)

Adversarial review of `git diff 215dc24..HEAD` against PLAN.md Phases 4–7,
IMPLICIT_SPEC.md, and the "P6b implementation log" section of REASONING.md.

## Plan conformance

- PASS — `pages.yml` (`.github/workflows/pages.yml:1-44`) matches PLAN Phase 4
  sketch exactly (build/deploy jobs, permissions, `configure-pages@v5` →
  `upload-pages-artifact@v3` → `deploy-pages@v4`), with the documented
  seolite→lumen rename applied consistently (`@lumen-seo/site`, `site/dist`,
  `/lumen/` base). Rename is evidence-backed (REASONING.md:184-188 cites
  `site/astro.config.mjs` verification) — justified, not scope creep.
- PASS — `deploy-worker.yml` (`.github/workflows/deploy-worker.yml:1-61`)
  matches PLAN Phase 5 sketch verbatim (guard-step pattern, `if:
  steps.guard.outputs.skip != 'true'` gating every later step).
- PASS — `release.yml` (`.github/workflows/release.yml:1-67`) matches PLAN
  Phase 6 structurally (build-and-test → github-release → publish, guard
  step). Two deviations, both justified with concrete evidence:
  - Flow-style `env: { X: ${{ ... }} }` → block-style `env:` (release.yml:26-27,
    45-47, 60-62). Justified: flow mappings cannot embed `${{ }}` expressions
    in YAML — this is a real parse-time illegality, not a style preference,
    and actionlint caught it (REASONING.md:252-255).
  - Multi-line plain-scalar `run: gh release view … \|\| gh release create …`
    → block scalar `run: |` (release.yml:32-36). Justified: a plain YAML
    scalar folds the newline+backslash into a literal space, so the intended
    shell line-continuation degenerates into a stray argument on the first
    `gh` invocation — a genuine correctness bug in the plan's sketch, caught
    by hand-review since actionlint doesn't evaluate shell semantics across
    folded scalars (REASONING.md:256-261). Verified: `.github/workflows/release.yml:32-36`
    is real block-scalar YAML, semantics unchanged from the plan's intent.
- PASS — Publish order computed via topological sort rather than hardcoded
  (`scripts/ci/publish-workspaces.mjs:116-143`, used at :263). Deviation is
  justified: IMPLICIT_SPEC I2 ("adding a workspace never requires editing
  CI") is directly served by computing order from the lockfile graph instead
  of a hardcoded list, and the plan's own alternatives table (PLAN.md:140)
  already prefers "reverse-dependency closure from lockfile" reasoning for
  the sibling script — consistent extension, not scope creep.
- PASS — `private` flag clearing (`scripts/ci/publish-workspaces.mjs:150-162`,
  153). Justified: every current workspace manifest is `"private": true`
  (verified fact, not assumed), and `npm publish` hard-fails on a private
  package — the plan's own publish command would be inoperable without this
  fix. Restored byte-for-byte in a `finally` block (:288-290), preserving E5.
- MINOR-FAIL (documented but worth flagging back to plan authors) —
  `cli-smoke.mjs` "skip-until-surface" semantics
  (`scripts/ci/cli-smoke.mjs:175-180`): the plan (PLAN.md Phase 7) describes
  the smoke as an assertive check with three hard requirements once the CLI
  exists; it does not explicitly anticipate a landed-but-binless stub. The
  deviation is reasonably argued from E2's precedent (REASONING.md:278-286)
  and unit-tested against fixtures rather than the live repo, but it does
  mean `npm run validate` and `release.yml`'s `build-and-test` job currently
  give a false "smoke passed" signal with zero actual CLI verification until
  the surfaces merge lands `bin`. Recommend an explicit tracking issue/TODO
  so this silent skip isn't forgotten once `packages/cli` gets a `bin` field
  — not a code defect, but a process risk the plan didn't anticipate.
- PASS — Phase 5 cross-check deferral (REASONING.md:209-218): the plan says
  "does not invent the file" for `packages/mcp/wrangler.jsonc`; the workflow
  correctly stays in guard-skip mode without it, and the orchestrator note to
  verify `grep -q account_id packages/mcp/wrangler.*` at the M2 gate is
  preserved from PLAN Phase 5 success criteria.

## Spec invariants

- PASS — E2 skip-when-unconfigured guard-step pattern: both
  `deploy-worker.yml:26-38` and `release.yml:38-47` inject the secret via
  step `env`, test in shell, emit `skip` as a step output, and gate every
  subsequent step on `steps.guard.outputs.skip != 'true'`. No job-level `if`
  references `secrets`/`env` anywhere in the diff.
- PASS — E3 evidence-pinned action versions: `actions/checkout@v5`,
  `actions/setup-node@v5`, `actions/configure-pages@v5`,
  `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`,
  `cloudflare/wrangler-action@v4` — all match PLAN.md's evidence table
  (PLAN.md:40, 533) verbatim; no `@main` floats.
- PASS — E5 workflows never write to the repo: `pages.yml` deploys via
  artifact upload only; `release.yml` creates a GH Release (not a commit);
  `publish-workspaces.mjs` writes manifests only to the ephemeral runner
  checkout and restores originals in a `finally` (publish-workspaces.mjs:277-290).
  No `git commit`/`git push` anywhere in the new scripts or workflows.
- PASS — I14 duplicate-publish idempotency: `classifyFailure`
  (publish-workspaces.mjs:182-192) matches status ∈ {403, 409} via both the
  `/cannot publish over/i` message and a bare `E403`/`E409` code pattern;
  `publishOne` (:194-212) returns `'duplicate'` (treated as success) on this
  classification. Tested directly (test/publish-workspaces.test.mjs:223-251,
  318-331) including the "continues to the next package" rerun scenario.
- PASS — I17 bounded retry 3 attempts/15s: `MAX_ATTEMPTS = 3`,
  `RETRY_DELAY_MS = 15000` (publish-workspaces.mjs:53-54); loop retries only
  on `e404` and only while `attempt < MAX_ATTEMPTS` (:203-207), giving exactly
  2 backoffs across 3 attempts. Verified with injected `sleep` capturing
  `[15000, 15000]` (test/publish-workspaces.test.mjs:337-349, 356-375) — no
  real-time waits in the test suite (I10 preserved).
- PASS — I16 no secrets echoed: guard steps read secrets only into a step
  `env` var, test with `[ -z "$VAR" ]`, never `echo`/`set -x` the value
  (deploy-worker.yml:26-38, release.yml:38-47); `NODE_AUTH_TOKEN` flows to npm
  via `setup-node`'s `registry-url` + env interpolation
  (release.yml:56, 63-65), never printed by `publish-workspaces.mjs`.

## Failure/concurrency

- PASS — `pages`/`deploy-worker` concurrency groups serialize
  (`cancel-in-progress: false`) per I14 (pages.yml:9-11, deploy-worker.yml:14-16).
- PASS — MCP handshake child-process lifecycle
  (`scripts/ci/cli-smoke.mjs:106-168`): `settled` flag prevents double
  resolve/reject; timer is cleared on both `succeed`/`fail` paths; child is
  killed (`SIGKILL` on failure, `SIGTERM` on success) in every terminal path,
  so no child process is left running past the 10s timeout window.
- MINOR-FAIL — `mcpInitializeHandshake` (cli-smoke.mjs:115) spawns with
  `stdio: ['pipe', 'pipe', 'pipe']` but only drains `stdout`; `stderr` has no
  listener at all. If the MCP stub under test writes enough to stderr before
  answering `initialize`, the OS pipe buffer (typically 64KB) can fill and
  block the child's write, stalling the handshake until the 10s timeout kills
  it. Bounded by the existing timeout (no permanent hang), but this turns a
  fast smoke failure into a guaranteed-slow one and masks the real cause
  (nothing in the thrown `SmokeError` message mentions stderr backpressure).
  Low severity given the 10s ceiling, but a one-line `child.stderr.resume()`
  (or capturing it for the error message) would close the gap cheaply.
- MINOR-FAIL — `defaultPublishFn` (publish-workspaces.mjs:169-172) calls
  `spawnSync('npm', ...)` with a `maxBuffer` but no `timeout` option. A hung
  or slow-DNS `npm publish` network call has no CI-side bound other than the
  GitHub Actions job-level default timeout (6 hours) — well outside the
  "bounded retry" spirit of I17 for the surrounding classification logic.
  Not a spec violation (I17 only mandates the E404 backoff, which is
  correctly bounded), but worth a defensive `timeout:` given this runs
  unattended on tag push.

## Common defects

- PASS — no unhandled promise rejections: `main`/`cliSmokeMain` wrap all
  async work in try/catch and map to typed exit codes (publish-workspaces.mjs:317-334,
  cli-smoke.mjs:227-245).
- PASS — no swallowed exceptions: every catch either rethrows as a typed
  `PublishScriptError`/`SmokeError` with a `.kind`/`.check` tag, or (in
  `resolveBin`, cli-smoke.mjs:63-66) intentionally treats an unreadable
  manifest as "surface not landed" with a clear comment explaining why that's
  safe (manifest validity is owned by typecheck/test, not this script).
- PASS — input validation: `parseTag` requires full SemVer via an anchored
  grammar-accurate regex (publish-workspaces.mjs:58, 70-79); `--timeout-ms`
  validated as a positive finite number (cli-smoke.mjs:216).
- PASS — no off-by-one in retry counting (verified above); Kahn's-algorithm
  cycle detection compares `order.length !== names.length`
  (publish-workspaces.mjs:138-141) — correct general cycle check, not
  reliant on a fixed graph shape.
- PASS — resource cleanup: manifest rewrites always restored in `finally`
  even on mid-loop publish failure (publish-workspaces.mjs:277-290); no
  leftover mutated `package.json` in any failure path.

## Convention fit (vs. P6a scripts)

- PASS — Both new scripts mirror the P6a shape exactly: `#!/usr/bin/env node`
  header block-comment contract, zero runtime dependencies, `import.meta.url
  === pathToFileURL(...)` CLI-entry guard so pure functions are importable in
  tests without side effects, exported pure functions
  (`parseTag`/`loadPublishableWorkspaces`/`topoOrder`/`rewriteManifest` and
  `resolveBin`/`checkHelp`/`checkConfigShow`/`mcpInitializeHandshake`),
  injectable I/O (`publishFn`/`sleep`/`log`, `runBin`/`handshake`) matching
  `select-workspaces.mjs`'s and `check-commits.mjs`'s testability pattern.
- PASS — Exit code convention (0 ok / 1 failure / 2 usage) matches
  `check-commits.mjs` exactly.
- PASS — TDD order documented and evidenced (REASONING.md:222-223, 266-267):
  tests written first, red-then-green, consistent with P6a's I9 TDD
  requirement.

## Verdict

VERDICT: MINOR-FAIL

---

## Author resolution (post-review fixes, in place) — resume unavailable: reviewer ran out-of-process, author verified in-place

All three MINOR findings addressed and verified (lint/typecheck/477 tests/actionlint/validate green after the fixes):

1. **MCP handshake stderr never drained** (backpressure could mask a fast failure as a 10s timeout; cause hidden) — FIXED: `scripts/ci/cli-smoke.mjs` now drains `child.stderr` continuously (`stderrTail`, last 2 KB) and every failure message (timeout/exit/spawn) carries the server stderr tail via `withStderr`. Pinned by `test/cli-smoke.test.mjs` "reports the drained server stderr in the timeout error".
2. **Unbounded spawnSync on the npm publish path** — FIXED: `publish-workspaces.mjs` default runner now bounds each publish attempt at 600 s (`PUBLISH_TIMEOUT_MS`); a spawn-level failure (`res.error`, incl. ETIMEDOUT) is a typed `publish-failed` error naming the package, distinct from registry answers. `cli-smoke.mjs` bounded too: build 300 s (`BUILD_TIMEOUT_MS`), `--help`/`config show` 60 s (`BIN_CALL_TIMEOUT_MS`).
3. **Skip-until-bin "no tracking mechanism"** — RESOLVED BY DESIGN (no code change): the gate is self-activating — the moment the surfaces merge lands a `bin` entry, `resolveBin` returns it and every check runs; there is nothing to remember. The deferred-e2e item is additionally recorded in PLAN.md Phase 5/7 notes, REASONING.md, and the orchestrator runbook for the M2 gate.

On the two security LOW findings (pages.yml build-job permissions and release.yml workflow-level `contents: write`): both are verbatim PLAN-sketch constructs; tightening them would be an unplanned deviation from the validated plan for a non-exploitable hygiene gain, so they are recorded as accepted (see SECURITY_REVIEW.md).
