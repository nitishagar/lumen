---
date: 2026-08-29
reviewer: adversarial-test-reviewer (implement_plan_v2_5)
scope: test files introduced by `git diff 407a6d4..HEAD` — Phases 4-6 (packages/cli, packages/mcp, packages/mcp/worker)
---

# TEST_VALIDATION — seolite/lumen surfaces, Phases 4-6

Default posture: every item below started at FAIL and was promoted only on direct evidence read from the test file plus the implementation it exercises.

## Files reviewed

- `packages/cli/src/cancellation.test.ts`
- `packages/cli/src/history.test.ts` (Phase-6 addendum: 25-concurrent-rank block)
- `packages/cli/src/mcp-print.test.ts` + `__snapshots__/mcp-print.test.ts.snap`
- `packages/cli/src/mcp-shutdown.test.ts`
- `packages/cli/src/no-telemetry.test.ts`
- `packages/cli/src/stdio-roundtrip.test.ts`
- `packages/mcp/src/bundle-scan.test.ts`
- `packages/mcp/src/capabilities.test.ts`
- `packages/mcp/src/concurrency.test.ts`
- `packages/mcp/src/no-telemetry.test.ts`
- `packages/mcp/src/onboard.test.ts` + `__snapshots__/onboard.test.ts.snap`
- `packages/mcp/src/output-shapes.test.ts`
- `packages/mcp/src/schema-contract.test.ts`
- `packages/mcp/worker/capping-fetcher.test.ts`
- `packages/mcp/worker/worker.test.ts`

Cross-checked against implementation: `packages/mcp/src/server.ts`, `schemas.ts`, `strict-args.ts`, `local-only.ts`, `testkit/{index,providers}.ts`, `worker/{outbound-recorder,composition,capping-fetcher,rest}.ts`, `packages/cli/src/{io,spawn,run}.ts`, `packages/mcp/package.json` / `vitest.worker.config.ts` build chaining.

## Charge 1 — Invariant coverage

All Phase 4-6 edges/invariants relevant to this diff have at least one real test. Mapped against IMPLICIT_SPEC and the PLAN Testing Strategy table:

| Edge/Invariant | Test found | Verdict |
|---|---|---|
| E6/I6 transport parity + typed local-only | `capabilities.test.ts`, `worker.test.ts` (`audit_site`/`rank_check` → `LOCAL_ONLY_CAPABILITY`) | PASS |
| E7/B7 wire schema (guaranteed set + opportunistic snapshot) | `schema-contract.test.ts` | PASS |
| E8/I3 concise/detailed shapes, provenance | `output-shapes.test.ts` | PASS |
| I12 SSRF ordering (local-only short-circuits before URL validation; full composition validates before use) | `capabilities.test.ts` (`remote shape... plan short-circuit`, `full composition: URL validation precedes any use`) — confirmed against `server.ts:99-105` | PASS |
| E13 concurrency (stdio interleaving) | `concurrency.test.ts` (25 interleaved calls); `history.test.ts` (25 concurrent `rank` invocations through real `JsonlHistoryStore`, cross-instance O_APPEND) | PASS |
| E14 cancellation (client `notifications/cancelled`, SIGINT mid-audit, `seolite/lumen mcp` shutdown) | `concurrency.test.ts` (client-cancel), `cancellation.test.ts` (real SIGINT to own process), `mcp-shutdown.test.ts` (spawned child, stdin-close vs SIGINT) | PASS |
| E2 stdio protocol purity | `stdio-roundtrip.test.ts` (per-line JSON-RPC parse assertion) | PASS |
| E11 onboarding payloads, no key material | `onboard.test.ts` (mcp pkg) + `mcp-print.test.ts` (cli pkg), both snapshot-tested, 8 payloads × 2 layers | PASS |
| E9 REST subset + error envelope + CORS | `worker.test.ts` (healthz, page-report, keyword-ideas, 404/405, OPTIONS preflight) | PASS |
| E10/I6 bundle budget + no-cheerio/no-audit-engine | `bundle-scan.test.ts` (parses real esbuild metafile + scans emitted bundle text) | PASS |
| I6/B10 oversize upstream capping | `capping-fetcher.test.ts` (Content-Length pre-check, mid-stream abort, byte-identical happy path) | PASS |
| I16 no-telemetry / outbound enumeration | `no-telemetry.test.ts` (cli: global fetch stubbed to throw across 7 commands + 5 tools + sentinel-key grep), `no-telemetry.test.ts` (mcp: same stub, both full and remote compositions), `worker.test.ts` (`outboundRecorder` allowlist, BYOK header non-echo) | PASS |
| E5 BYOK header→env mapping, non-echo | `worker.test.ts` (`workerDeps().env` maps exactly 3 names, prefix non-over-match; sentinel never in response body) | PASS |
| I17 typed provider failure carries provider name | `output-shapes.test.ts` (`rank_check` SERP failure, `keyword_ideas` all-fail → `UPSTREAM_FAILED` naming provider) | PASS |
| B11 not-found rank is success | `output-shapes.test.ts` (`rank_check concise`, miss case `found:false`, exit-equivalent `isError` undefined) | PASS |
| I15 boundary inputs (overlong seed, bad enum, out-of-range limit, malformed domain) | `schema-contract.test.ts` (invalid-args), `output-shapes.test.ts` (`invalid domain (port/path smuggled)` → `INVALID_ARGUMENTS`) — confirmed against `server.ts` `normalizeDomainArg` | PASS |
| B21 pre-rebase fixture-only worker composition, zero outbound | `worker.test.ts` (`every outbound call stays inside the host allowlist... zero pre-rebase`) | PASS |

No IMPLICIT_SPEC edge in scope (E1-E15, relevant B-items) for Phases 4-6 was found uncovered.

## Charge 2 — Real assertions

Spot-checked for tautology; none found. Representative non-trivial assertions:
- `history.test.ts` rotation test derives the byte cap from the *real* serialized entry length (`lineLen(i)`) rather than a magic number, then asserts exact keyword sequences survive two rotation cycles — a genuine behavioral check, not a shape check.
- `capping-fetcher.test.ts` proves the pre-check path never touches the body (`bodyRead` flag) and the mid-stream path delivers strictly ≤ cap bytes before throwing — asserts the *mechanism*, not just "throws eventually."
- `schema-contract.test.ts`'s wire-schema test enumerates `required` fields per tool against a hand-built expectation map (not just "not empty"), and separately locks the `failThreshold` enum to the identical 4-value set shared with the CLI flag — a real parity check across two independently-generated schemas.
- `worker.test.ts`'s BYOK test asserts prefix-non-overmatch (`LUMEN_PSI_KEY_OTHER` → undefined) in addition to the mapped case — catches a plausible off-by-one in a naive `startsWith` implementation.
- `capabilities.test.ts` distinguishes the *short-circuit* local-only path (invalid URL still reports `LOCAL_ONLY_CAPABILITY`, not `INVALID_URL`) from the *full-composition* path (URL validated before use) — this is checking ordering of two code paths, verified against `server.ts:99-105`, not restating a fixture.

## Charge 3 — Over-mocking

- `testkit/providers.ts` fixtures are real, parameterizable implementations of the core SPI (deterministic outputs, injectable failure modes) — not stubs that make the subject vacuous. `buildMcpServer` itself is never mocked; every MCP test exercises the real server via `InMemoryTransport` or (Worker) `SELF.fetch` through Miniflare.
- `no-telemetry.test.ts` (both packages) stub only `globalThis.fetch` — the one seam the invariant is about — while the rest of the stack (server, schemas, fixture providers) runs for real. This is the correct, minimal mock for the property being tested.
- **MINOR** — `packages/mcp/src/concurrency.test.ts` "25 concurrent calls... history has exactly 25 intact lines" uses `MemoryHistoryStore`, whose `append` is a synchronous array push with no queueing/await point (`testkit/index.ts:88-90`). Under Node's single-threaded execution, `Promise.all` over calls that each do one synchronous push cannot race regardless of implementation, so this test cannot actually detect a broken serialization mechanism in a real store — it only proves the *handlers* are pure/non-interfering, which is a real (if narrower) claim than what the `describe` block's phrasing about "history" implies. The genuine cross-write race (real O_APPEND concurrency) is correctly tested elsewhere against the real `JsonlHistoryStore` (`packages/cli/src/history.test.ts`), so the invariant IS covered — just not by this file, despite what the name suggests. Rename/scope note only; not a coverage gap.

## Charge 4 — Determinism / flake risk

- Time: all tests inject a clock (`FIXED_CLOCK`, `clock: () => '2026-08-29T12:00:00Z'`) or use a fixed sentinel timestamp; no test asserts against `Date.now()`/wall clock directly.
- Ordering: `history.test.ts`'s rotation and "list with no query... sorted by retrievedAt" tests use hand-assigned, monotonic `retrievedAt` values and assert exact array order — safe.
- Async races handled with `vi.waitFor(...)` polling on an observable side effect (`runner.started()`, `started`/`aborted` flags) before firing the cancel/signal, in `cancellation.test.ts` and `concurrency.test.ts`'s client-cancel test — this is the correct pattern to avoid a signal racing ahead of handler registration, and it is explicitly commented as such.
- Bounded-timeout guards (`withTimeout` helper, explicit `deadline` loops) are used in every spawn-based test (`mcp-shutdown.test.ts`, `stdio-roundtrip.test.ts`) rather than relying on Vitest's own per-test timeout to fail cleanly — good, gives an actionable error message instead of a bare timeout.
- **MINOR** — `cancellation.test.ts` sends a real `process.kill(process.pid, 'SIGINT')` to the *test runner's own OS process*. This is safe under the project's Vitest config (`forks` pool default, no explicit `pool`/`isolate` override) as long as Node's default SIGINT-terminates-process behavior is suppressed by the presence of the `run()`-registered listener (true here, and the test correctly waits for `runner.started()` — which fires only after `run()` has registered its SIGINT handler — before sending the signal). The listener is removed in `run.ts`'s `finally` block after the call settles. This holds today, but the test's correctness depends on an assumption not enforced by the test itself: that no other listener-free window exists between file/worker startup and handler registration, and that no other test file is mid-execution in the same forked process when the signal fires (Vitest's default forks pool generally runs one file at a time per worker, so this is low risk, not zero). Flagging as a determinism-adjacent observation, not a functional bug — the pattern is well-guarded (`vi.waitFor` before signaling), and I found no evidence of an actual flake in the code as written.

No test found to be non-deterministic, order-dependent across files, or racy given the guards in place.

## Testing Strategy rows verified covered (Phases 4-6 subset)

Wire schemas · invalid-args-rejected · local-only-typed-error · response-format-diff · spawn-initialize-list-call · interleaved-calls · client-cancel · payload-snapshots (mcp + cli) · parity-and-rest · target-url-never-fetched · header-passthrough · outbound-recorder-allowlist · content-length-and-stream-cap · bundle-scan+check:size · sigint-and-stdin-close · sigint-stops-and-labels · sentinel-key-grep (cli) · outbound-allowlist (mcp) · 25-concurrent rank invocations (Phase 6 addendum to history.test.ts).

## Findings

None reach FAIL severity. Two MINOR observations recorded above (test-naming/scope precision on `mcp/concurrency.test.ts`'s history claim; a documented-but-unenforced process-signal assumption in `cli/cancellation.test.ts`). Neither represents a missing invariant test, a tautological assertion, or a meaningfully mocked-into-meaninglessness subject.

VERDICT: PASS — Phases 4-6 test suite covers every relevant IMPLICIT_SPEC edge with real, non-tautological assertions against genuine fixtures; only two MINOR non-blocking observations found.
