# Adversarial test review — publish-workspaces.test.mjs / cli-smoke.test.mjs

Scope: `test/publish-workspaces.test.mjs`, `test/cli-smoke.test.mjs` against
`scripts/ci/publish-workspaces.mjs`, `scripts/ci/cli-smoke.mjs`, PLAN Phases
6–7, IMPLICIT_SPEC I14/I17/E2/E5.

Run: `npx vitest run test/publish-workspaces.test.mjs test/cli-smoke.test.mjs
--project ci-scripts` → 66/66 passed, 2.49s (all `sleep` calls are injected,
no real 15s waits; deaf-server fixture pinned via `setInterval`, so the run
is not flake-prone on a slow CI box).

## Findings

PASS — SemVer validation: `parseTag` covers `v`-stripping, prerelease+build
metadata, and 5 malformed forms (`v1.2`, leading-zero, no-`v`, bare `v`,
empty) each asserting `kind: 'invalid-tag'` and the offending value named in
the message (publish-workspaces.test.mjs:47-68).

PASS — Publish-set derivation: exact 5-package set, site exclusion, internal
dep-edge capture, and 4 malformed-lockfile shapes + empty-workspace-set typed
errors (`kind: 'lockfile'` / `'no-workspaces'`) (publish-workspaces.test.mjs:70-115).
`node_modules/@lumen-seo/*` link entries in the fixture lockfile are
correctly excluded by the `packages/` dir-prefix check — verified by reading
`test/fixtures/package-lock.json`.

PASS — Topological order: real fixture graph (core→audit→providers→mcp→cli),
determinism over 5 repeated calls, alphabetical tie-break among independents,
and a genuine 2-node cycle rejected with both member names in the message
(publish-workspaces.test.mjs:117-162). Real assertion, not a tautology — the
exact order array is pinned.

PASS — `rewriteManifest`: version set, all 4 dep sections pinned for internal
names only (external `cheerio` range untouched), `private` cleared, and
input-immutability asserted via a before/after `toEqual` on the original
object (publish-workspaces.test.mjs:164-207).

PASS — `npmPublishArgs`: exact array pinned (`publish -w <pkg> --access
public --tag latest`) (publish-workspaces.test.mjs:209-221) — this is the
one place ARG construction is directly asserted, correctly complementing the
injected-runner design used everywhere else.

PASS — `classifyFailure`: 403 w/ message, legacy 409 w/ message, bare-403
without the "cannot publish over" phrase, E404, and an unclassified
ENEEDAUTH case, plus a check that stdout (not just stderr) is scanned
(publish-workspaces.test.mjs:223-253). Minor gap (not a FAIL): no case where
the "cannot publish over" phrase appears with no 403/409 numeral anywhere in
output — `classifyFailure` would return `{kind:'duplicate', status:
undefined}`; that specific status-omitted duplicate path isn't exercised.

PASS — Duplicate-publish idempotency end-to-end: `publishWorkspaces` with an
injected `publishFn` returning a 403 for one package continues past it,
counts all 5 calls, and records `outcome: 'duplicate'` for that package
(publish-workspaces.test.mjs:318-332). Matches I14.

PASS — E404 bounded retry: exact attempt count (3) and sleep schedule
(`[15000, 15000]`) asserted both for the eventually-succeeds case and the
exhausted-retries case, the latter throwing `PublishScriptError{kind:'e404',
pkg}` naming the package (publish-workspaces.test.mjs:334-377). This is a
real, precise assertion of I17, not "didn't throw."

PASS — Fail-fast on unclassified failure: no retries (`sleeps` empty), later
packages in the run never called (publish-workspaces.test.mjs:379-404) —
proves failure stops the pipeline rather than silently continuing.

PASS — Manifest restoration (E5): byte-for-byte restore on both the
all-success path and a mid-run failure path, using literal string equality
against pre-run file bytes on disk, not just in-memory state
(publish-workspaces.test.mjs:308-317, 406-416).

PASS — Dry-run: zero `publishFn` invocations, ordered plan returned, on-disk
manifests provably untouched (publish-workspaces.test.mjs:418-431).

PASS — Deps-outside-publish-set and missing/mismatched-manifest typed errors,
each naming the offending package, `publishCalls` proven 0 for the deps case
(publish-workspaces.test.mjs:433-467).

PASS — CLI dry-run end-to-end via `spawnSync` on the real script (not the
exported functions): ordered plan print order asserted strictly ascending by
locating each package name's line index; usage exit 2 for missing `--tag`
and unknown flag; exit 1 with the bad tag value in stderr; exit 1 on a
lockfile cycle with both member names in stderr (publish-workspaces.test.mjs:470-548).
This is real process-level coverage of the CLI surface, not a mock of the
subject.

PASS — `resolveBin`: object form preferring `lumen`, string form, fallback to
another key when `lumen` absent, null on no-bin and on a non-string/object
bin value (cli-smoke.test.mjs:107-138).

PASS — `checkHelp`/`checkConfigShow` unit paths cover zero/non-zero status,
missing product-name mention, stderr-only mention, non-JSON stdout, and a
JSON-scalar-not-object rejection, each asserting `SmokeError.check` and a
substring of the message (cli-smoke.test.mjs:140-208) — genuine outcome
assertions, not "no throw."

PASS — `mcpInitializeHandshake` runs against REAL spawned fixture server
processes (not mocks of the subject under test): happy path asserts
`serverInfo.name` and echoed `protocolVersion`; request-shape pinned (id 1,
jsonrpc 2.0); wrong-id rejection; missing-`serverInfo.name` rejection;
timeout rejection against a genuinely-deaf server (fixture pinned via
`setInterval` so it cannot exit early — the exact flake class the recent
`5ad3e2b` commit fixed); early-exit rejection (cli-smoke.test.mjs:210-277).
Satisfies the "must run real child processes" requirement.

PASS — `runSmoke` orchestration: full green path against a real fixture bin
(log lines asserted to mention `--help`/`config show`/`mcp`), clean skip with
zero spawns when no bin is declared, and propagation of the first failing
check as a rejected promise (cli-smoke.test.mjs:279-310).

PASS — `cliSmokeMain` process-level: real repo stub skip (`::notice::`),
compliant fixture bin full green run (`res.stdout` contains `lumen-mcp`),
broken fixture bin exit 1 naming `config-show` in stderr, unknown-flag usage
exit 2 (cli-smoke.test.mjs:312-341) — all via real `spawnSync` of the actual
script file, no mocking of the CLI/MCP subject.

Minor gap (not a FAIL): the 10s `DEFAULT_TIMEOUT_MS` constant itself is never
asserted — tests always pass an explicit `timeoutMs` (5000/250) to
`mcpInitializeHandshake`/`runSmoke`, and `cliSmokeMain`'s real-process tests
never exercise a slow/deaf server through the default-timeout code path. The
timeout *mechanism* is proven at short, fast values; the specific "10s" PLAN
number is only encoded in the source, not verified by a test.

## Determinism check

No wall-clock dependence in the executed test paths: the 15s publish
backoffs are captured via an injected `sleep` stub (never actually slept),
and the only real elapsed-time wait is the 250ms deaf-server timeout test,
which is short, bounded, and immune to early-exit races after `5ad3e2b`. No
port binding (stdio only). No test-order dependence observed (temp dirs are
per-test via `mkdtempSync` + `onTestFinished` cleanup).

VERDICT: PASS

---

## Author post-pass strengthening (reviewer's two minor notes, applied)

- Added: message-only duplicate-publish classification (no numeric status) — `test/publish-workspaces.test.mjs` "classifies the message-only duplicate form even without a numeric status".
- Added: the plan-mandated 10 s default is now pinned — `DEFAULT_TIMEOUT_MS` exported and asserted `=== 10000`.
- Added: stderr-drain reporting pinned by the new noisy-deaf handshake test (deterministic: fixture writes stderr only after the request arrives; 1500 ms budget).
- Suite state after strengthening: 69/69 in the two ci-scripts files, 10/10 consecutive stable runs; full suite 45 files / 478 tests green.
