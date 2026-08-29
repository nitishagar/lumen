# REASONING — seolite ci-deploy (P6a: Phases 1–3)

Log of decisions and deviations while implementing Phases 1–3 of
`PLAN.md` (P6a bootstrap CI). Phases 4–7 (P6b: pages/worker/release) are
deliberately NOT started here — they belong to the M2 window.

## Phase 1 — CI support scripts + metadata (TDD)

- **TDD order held.** `test/check-commits.test.mjs` + `test/select-workspaces.test.mjs` +
  `test/fixtures/package-lock.json` were written and run FIRST: 19 red tests
  ("Cannot find module .../scripts/ci/*.mjs"). Then the scripts were
  implemented; final state 62 tests green (5 package + 57 ci-scripts),
  `npm run validate` green.
- **Root vitest registration (deviation, harness).** Root `vitest.config.ts`
  uses Vitest 4 `projects: ['packages/*/vitest.config.ts']`, so files under
  `test/*.test.mjs` would never run. Added an inline `ci-scripts` project
  (`environment: node`, `include: ['test/**/*.test.mjs']`). Without it the
  Phase 1 criterion "`npm test` green (includes the two new script test
  files)" is unsatisfiable. Additive single-line-scope change to a
  scaffold-core-owned file (acknowledged co-ownership surface).
- **ESLint node globals (deviation, harness).** `js.configs.recommended`
  flags `process`/`console` as `no-undef` in plain `.mjs` (verified with a
  probe file). Added a scoped block in `eslint.config.js`:
  `files: ['scripts/**/*.mjs', 'test/**/*.mjs'], languageOptions.globals = globals.node`
  (via the `globals` package — a direct dependency of ESLint itself).
- **`git log` record separation (deviation, flag only).** The plan's exact
  `--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B` leaves records separated by
  a newline, which makes naive `\0`-splitting ambiguous (the next record's sha
  glues onto the previous body). Added the `git log -z` flag — entries are
  NUL-terminated, so `\0`-splitting yields exactly 6 fields per record. The
  format string itself is exactly the plan's. Verified byte layout with `od -c`.
- **CLI entry guard.** Both scripts only run their CLI main when executed
  directly (`import.meta.url === pathToFileURL(argv[1])`), so unit tests can
  import the pure functions (`parseGitLog`, `validateRecord(s)`,
  `checkLicenseText`) without side effects.
- **Identity semantics implemented exactly per contract:** author-strict
  (Nitish name+email exact, `dependabot[bot]` sole exception), committer
  two-tier (Nitish | `GitHub <noreply@github.com>` web-flow | `dependabot[bot]`
  ONLY alongside a dependabot author), trailer rejection
  (`/^co-authored-by:/im`, `/^generated[-_ ]?(by|with)/im`), new-commits-only
  range, empty `--base` ⇒ `::notice::` + exit 0 (zero-SHA / unborn-base guard
  resolved by the caller), unresolvable base ⇒ loud exit 1, exit codes
  0/1/2 (ok / violations / usage).
- **select-workspaces semantics implemented exactly per contract:** parses
  `packages` entries (skips root `""` and `node_modules/*`; duplicate or
  charset-invalid workspace names ⇒ fail-safe), longest-prefix path→workspace
  mapping, reverse-dependency closure over dependencies/devDependencies/
  optionalDependencies/peerDependencies, ALWAYS exit 0, exactly one
  `scope=<value>` line matching `^scope=(ALL|-w [A-Za-z0-9@/._-]+( -w …)*)\n$`.
  Fail-safe ⇒ ALL: empty diff, no package paths, malformed/missing lockfile,
  unresolvable `--base`, any unexpected error (wrapped in top-level catch).
  Unmapped paths mixed WITH package paths are ignored (code change decides
  the scope); a path under an unknown workspace dir (e.g. `packages/core2`)
  ⇒ ALL (new workspace not yet in the lockfile cannot be scoped safely).
- **Phase 1 printf criterion note.** The scaffold lockfile currently has no
  inter-workspace dependencies, so on the DEFAULT lockfile
  `printf 'packages/core/src/fetcher.ts\n' | node scripts/ci/select-workspaces.mjs`
  prints exactly `scope=-w @seolite/core` and `printf 'README.md\n' | …`
  prints exactly `scope=ALL`. The fixture lockfile (`--lockfile
  test/fixtures/package-lock.json`) models the M1 dependency graph and yields
  the full closure `scope=-w @seolite/audit -w @seolite/cli -w @seolite/core
  -w @seolite/mcp -w @seolite/providers`. The durable unit test asserts the
  fixture output byte-exact and the default-lockfile output by format +
  inclusion (so it stays true when M1 adds real inter-deps).
- **Phase 1b contingency not needed** — scaffold-core's scaffold (root
  package.json + lockfile + LICENSE with all three Apache-2.0 markers) was
  already on main.
- Metadata landed: root `validate` script (additive line), SECURITY.md stub
  (supported = main, GitHub private-vulnerability-reporting link, SSRF/BYOK
  scope notes), CONTRIBUTING.md extended with the CI contract table, the
  identity-gate rules ("no AI co-author trailers — CI enforces"), squash-merge
  procedure, and the security reporting pointer. LICENSE verified (markers
  present; `check-commits.mjs --license` exits 0).

## Phase 2 — ci.yml + dependabot.yml

- **Workflows written per the PLAN sketch** with job ids exactly
  `identity`, `workflow-lint`, `lint`, `typecheck`, `test` (no display names —
  these ids ARE the required status-check contexts), `concurrency.group: ci-<ref>`
  with `cancel-in-progress` false on main, `permissions: contents: read`,
  actions pinned `actions/checkout@v5` + `actions/setup-node@v5` (evidence-backed
  majors), actionlint pinned `rhysd/actionlint:1.7.12`.
- **actionlint:** docker IS available on this machine, so the plan's primary
  tool ran unchanged: `docker run --rm -v "$PWD:/repo" -w /repo
  rhysd/actionlint:1.7.12 -color` → exit 0 (first pass; includes shellcheck of
  `run:` blocks and expression-context checks). The plan's "brew-installed"
  local binary was NOT used (`actionlint` not on PATH; brew not required) —
  docker locally = the same pinned engine as CI, so local/CI parity is exact.
- **Deviation: no `npm ci` in the `identity` job.** The gate scripts are
  dependency-free Node built-ins; `setup-node` suffices. Saves ~30–60 s per
  run and removes a lockfile-mismatch failure mode from the identity gate.
- **Deviation: PR identity range uses `pull_request.head.sha`, not
  `github.sha`.** On `pull_request` events `github.sha` is the ephemeral
  PR-merge commit GitHub creates on the runner — judging it could false-red
  dependabot PRs (whose merge commit is not authored by dependabot or Nitish).
  The PLAN's invariant table (I11) specifies the PR range as
  "merge-base(base)..head"; `base.sha..head.sha` implements exactly that
  new-commits-only semantics. Push events keep `github.event.before..github.sha`
  with the zero-SHA guard (`40×"0"` ⇒ `origin/main`; unborn main ⇒ empty base
  ⇒ script skips with `::notice::`).
- **Deviation: test runner uses `npm test --if-present "${WS[@]}"`.** Verified
  empirically: `npm test -w @seolite/site` exits 1 ("Missing script: test")
  because the private site workspace ships no scripts yet. `--if-present`
  lets script-less workspaces skip cleanly in scoped runs (full-suite runs on
  main/PRs are unaffected — root vitest projects already exclude site).
  When P5 adds a site test script it is picked up with zero CI changes.
  The scope VALUE contract is untouched — select-workspaces stays a
  pure-lockfile computation.

## Phase 3 — land + protection + probes

- **Landing.** Branch `ci/bootstrap`, three conventional commits (tests-first
  TDD order preserved in history: `test(ci): gate-script unit tests first
  (TDD)…` → `feat(ci): commit-identity and workspace-selection gate scripts +
  validate meta-gate` → `feat(ci): bootstrap workflow — identity,
  workflow-lint, lint, typecheck, scoped tests + dependabot`), pushed once (so
  CI only ever saw the final green state), all authored by Nitish Agarwal,
  zero trailers. The new gate was dogfooded locally before push:
  `check-commits.mjs --base origin/main --head HEAD` → 3 new commits OK;
  `--license` OK; `npm run validate` OK.
- **PR #1** <https://github.com/nitishagar/seolite/pull/1> — all five checks
  green on both the push and pull_request runs (identity 6–8 s, workflow-lint
  5–8 s, lint 11–25 s, typecheck 11–15 s, test 10–25 s).
- **Squash merge** with the plan's exact subject: `feat: bootstrap CI gates —
  identity, license, workflow-lint, lint, typecheck, scoped tests`, empty
  body, no trailers. Result commit `2bc3cc6`: author
  `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`, committer
  `GitHub <noreply@github.com>` (web-flow) — exactly the signature the
  committer tier accepts.
- **Repo settings** applied via the plan's exact `gh api` PATCH: squash+rebase
  only, merge commit disabled, delete_branch_on_merge, wiki off — verified by
  the response body.
- **Branch protection** applied via the plan's exact `gh api` PUT JSON —
  accepted verbatim on the first call (no field rejections): required contexts
  `["identity","workflow-lint","lint","typecheck","test"]` (all bound to
  app_id 15368 = Actions), `strict: true`, PR required with
  `required_approving_review_count: 0`, `enforce_admins.enabled: true`,
  force-push/deletions denied, `required_linear_history: true`.
- **GREEN probe (the protected squash merge itself).** `gh api …/commits/main
  --jq '.commit.committer.email'` = `noreply@github.com`; run 33250204552
  (<https://github.com/nitishagar/seolite/actions/runs/33250204552>) on main:
  conclusion `success`, all five jobs success. The committer tier demonstrably
  accepts the plan's own merge procedure — main is not stranded red.
- **RED probe (adversarial).** Scratch branch `ci/red-probe` with one
  deliberately hostile commit (`Mallory Intruder <mallory@evil.example>` +
  `Co-Authored-By: Claude <claude@anthropic.com>` trailer). New-branch push ⇒
  `github.event.before` = 40 zeros ⇒ zero-SHA guard engaged: the gate ran over
  `origin/main..bdb0eb6` (origin/main does not contain the bad commit, so it
  was still judged). Result: run 33250256881 — job `identity` FAILED (the
  only failure; lint/typecheck/test/workflow-lint green as expected), with
  per-violation actionable messages (author + committer + trailer classes)
  and the remediation footer. Scratch branch deleted (remote + local) after
  the probe.
- **Post-protection state.** Dependabot activated immediately
  (`dependabot/github_actions/*`, `dependabot/npm_and_yarn/*` branches) — its
  PRs will ride the same required checks; merging them is scaffold/aspect
  follow-up work, not P6a scope.
- **Phase 4–7 not started** (P6b belongs to the M2 window per R6).

