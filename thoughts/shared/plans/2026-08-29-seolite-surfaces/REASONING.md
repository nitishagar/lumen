# REASONING — seolite-surfaces implementation log (append-only)

## 2026-08-29 — orientation (resuming at Phase 4)

- Bundle validated (PLAN_VALIDATION.md VERDICT: PASS, rev 2). Phases 1–3 were committed
  by the prior agent (05447fc, 7da381d, 407a6d4) but their PLAN.md checkboxes were left
  unticked; suite verified green at baseline (294 tests) before resuming. Ticked 1–3 as
  part of the Phase 4 commit (bookkeeping repair, no code change).
- The prior agent left untracked WIP: `packages/mcp/src/{server,schemas,onboard,local-only,
  strict-args}.ts` + `testkit/`. Reconciled strictly against plan Phase 4: tool names use the
  RENAMES.md mapping (`lumen_*`, `npx @lumen-seo/cli`, env `LUMEN_*`); E8 concise shapes,
  strictArgs guard, R8 no-maxPages-default, and the I5 failThreshold enum all conform. The
  WIP draft was kept (plan-conformant) with two fixes noted below.
- **Environment note (skill deviation):** no Agent/Task tool is exposed in this runtime, so
  the skill's build-verifier sub-agent contract is executed in-context (mechanical: run
  typecheck/lint/tests, relay `file:line` errors, fix to CLEAN). The fresh adversarial
  reviewers (impl/test/security) are spawned via the locally installed `claude -p` CLI in
  the worktree cwd, which restores the "different agent than the author" guarantee.

## 2026-08-29 — Phase 4 fixes vs the WIP draft

- **I15 bug (silent domain rewrite):** `domainToASCII('example.com/evil')` returns
  `'example.com'` — WHATWG/IDNA truncates at URL delimiters. The draft's
  `ascii.includes('/')` check could never fire, so a malformed `domain` argument was
  silently rewritten to a different domain (and stored in history). Fixed in BOTH the mcp
  rank_check handler (`normalizeDomainArg`) and the CLI's `normalizeDomain`
  (packages/cli/src/domain.ts): reject the delimiter family `[/\\?#@:]` BEFORE
  normalization. Duplicated in mcp because the dependency direction is cli → mcp.
- **E14 stdio shutdown:** the installed SDK's `StdioServerTransport.close()` only PAUSES
  stdin (verified in sdk/dist/esm/server/stdio.js) — after SIGINT-triggered `server.close()`
  the stdin fd keeps the event loop alive and the process would hang. The abort path
  destroys stdin in addition to closing the server. Justified by the plan's own hard
  requirement ("Ctrl-C can never hang the process — spawn-tested both ways"), which is now
  spawn-tested in packages/cli/src/mcp-shutdown.test.ts (SIGINT → exit 2, stdin close →
  exit 0, both bounded).
- **E7 wire facts (snapshot-documented, B7):** installed @modelcontextprotocol/sdk 1.30 +
  zod v4 strictObject emits `additionalProperties: false`, property-level `default`s, and
  `$schema: http://json-schema.org/draft-07/schema#` (the SDK's converter speaks draft-07,
  not 2020-12 — the E7 guaranteed set of assertions is unaffected; opportunistic set is
  pinned via jest-style inline + file snapshots so an SDK upgrade is a visible diff).
- **Cancellation test determinism:** the client's `notifications/cancelled` can no-op if it
  arrives before the server starts the handler (no controller registered yet). The test
  waits for handler start (`vi.waitFor(started)`) before aborting — the SDK itself is
  correct (verified with an isolated probe).
- `packages/mcp/src/index.ts` replaced the placeholder barrel with the real exports
  (buildMcpServer, McpDeps, schemas, onboardPayload, localOnly, strictArgs); ports/url-guard/
  testkit stay on their pre-existing subpath exports.
- `packages/cli/src/composition/mcp.ts` maps CommandDeps → McpDeps for the stdio root
  (plan Approach #1); `run.ts` `mcp` case wired (was a Phase-4 stub).
- Phase-4 mcp `test` script chains `test:worker` (pre-committed by the prior agent per the
  Phase 5 spec), so until Phase 5 lands the Phase 4 gate uses `npx vitest run packages/mcp`
  + typecheck; the full `npm test -w @lumen-seo/mcp` gate is run from Phase 5 on.

## 2026-08-29 — Phase 5 notes

- **wrangler dry-run does NOT write the bundle**: `wrangler deploy --dry-run --outdir dist`
  emits only README + metafile in wrangler 4.127 (both `deploy` and `versions upload`
  dry-runs). `build:worker` therefore chains (a) `wrangler deploy --dry-run` as the real
  production-pipeline compile validation and (b) an esbuild bundle of the same entry to
  `dist/index.js` + `dist/metafile.json` for `check:size` (E10 gzip) and the bundle-scan
  test (which the plan describes as parsing "the esbuild metafile/wrangler output").
  esbuild added as a devDep of @lumen-seo/mcp (was already in the tree via vitest).
  Measured bundle: 285 KiB gzip vs the 1.5 MB self-cap.
- **agents createMcpHandler API**: the installed agents@0.22 handler is typed against the
  MCP SDK v2 `Server` and takes a FACTORY `() => McpServer` (not a server instance as the
  plan snippet showed); the per-request-built server is supplied via the factory closure,
  preserving B8's stateless semantics (fresh server + fresh BYOK composition per request).
  The v1.30 McpServer is runtime-compatible through the handler's legacy lane; the type
  bridge is a documented cast. Also: the handler natively applies CORS — we pass
  `corsOptions: false` so the plan's own `worker/cors.ts` (with the x-lumen-* BYOK header
  names, E9) stays authoritative, and `allowedOriginHostnames: '*'` for B9's permissive
  authless v1.
- **wrangler.jsonc `main`** is resolved relative to the config file, so with the config at
  `worker/wrangler.jsonc` the entry is `./index.ts` (the plan's `worker/index.ts` path
  assumed a package-root config). `Env` lives in `worker/providers.ts` (the file that
  consumes env both pre- and post-rebase); `workerDeps` (header seam) lives in
  `worker/composition.ts` and is passed INTO providers.ts, avoiding the plan's latent
  composition<->providers import cycle.
- **testkit split**: provider fixtures moved to `src/testkit/providers.ts` (zero harness
  imports) so the Worker fixture composition does not bundle the MCP SDK Client; the
  testkit root re-exports everything, so all existing imports are unchanged. The plan's
  "testkit providers behind the identical McpDeps shape" (B21) is satisfied with the
  bundle kept lean.
- **Miniflare specifics**: vitest.worker.config.ts uses the installed plugin's
  `cloudflareTest` Vite-plugin API (1.1.x has no `./config` defineWorkersConfig subpath).
  JSON-RPC notifications over POST /mcp return HTTP 202 with an EMPTY body (the rpc test
  helper handles this); responses arrive SSE-framed when SSE is accepted. The outbound
  recorder lives in node-side module state (`worker/outbound-recorder.ts`) shared with the
  `outboundService` hook; pre-rebase it asserts ZERO outbound calls, and the host
  allowlist (googleapis/openpagerank/suggestqueries/wikipedia) activates post-rebase.
- worker typecheck is a separate tsc program (`worker/tsconfig.json`,
  types:["@cloudflare/workers-types"]) chained into `typecheck` — node and workers global
  sets conflict in one program. `@cloudflare/workers-types` added as a devDep.

## 2026-08-29 — Phase 6 notes

- Much of Phase 6 was already delivered with its owning feature: `extra.signal` flows into
  every tool handler + provider call (Phase 4 server.ts), run()'s SIGINT wiring landed in
  Phase 1-3, worker CORS in Phase 5. Phase 6 added: the repo-wide ESLint `no-restricted-globals`
  ban on `fetch` (the sanctioned site is core's default transport — note the file is
  `packages/core/src/fetcher.ts`, the plan's `fetch.ts` being a token-level inexactness;
  `globalThis.fetch(...)` is a property access and not a banned bare reference), the real
  SIGINT mid-audit test (sends an actual SIGINT to the test process while run()'s handler
  is registered — exit 2, `cancelled`, atomic incomplete:true report, zero history side
  effects), 25 concurrent `rank` invocations through the REAL JsonlHistoryStore (cross-
  instance O_APPEND integrity: exactly 25 well-formed RankHistoryEntry lines, no torn
  writes), and the CLI no-telemetry/sentinel suite (global fetch stubbed to throw across
  every command + all five tools; BYOK sentinel values never on stdout/stderr).
- Known cosmetic: 25 concurrent in-process run() calls trip Node's MaxListenersExceeded
  warning (each run registers its own SIGINT handler per the plan's E14 wiring — real CLI
  usage is one handler per process). Functionally correct; documented rather than worked
  around in production code.

## 2026-08-29 — review verdicts and MINOR dispositions

- **Implementation review: PASS** (fresh agent via `claude -p`, artifact IMPLEMENTATION_VALIDATION.md).
  One MINOR, inherited from the plan itself: `WORKER_ENABLE_PSI` gates the REST page-report
  leg but not the MCP `page_report` tool path (the plan's own Phase 5 snippets only apply
  the switch to REST). Disposition for the orchestrator's REBASE COMMIT: in
  `worker/providers.ts`, have `workerConfig(env)` omit the pagespeed provider when
  `WORKER_ENABLE_PSI === "false"` — the tool path then inherits the kill-switch through
  the composition (the plan's own R7 mechanism), with no change to index.ts/composition.ts.
  No live effect pre-rebase (fixture providers).
- **Test review: PASS** (TEST_VALIDATION.md). Two MINOR observations, both addressed:
  (1) `mcp/concurrency.test.ts`'s history claim over-stated what a MemoryHistoryStore can
  prove — reworded to claim handler-level non-interference, pointing at
  `cli/history.test.ts` for the real store-level O_APPEND race; (2) the real-SIGINT test's
  process-isolation assumption is documented in the artifact (forks pool +
  handler-registered-before-signal ordering via vi.waitFor) — accepted, no flake observed.
- **Security review: PASS** (SECURITY_VALIDATION.md) — no blocking or non-blocking findings;
  SSRF composition, BYOK flows, output encoding, and telemetry hygiene verified with
  test-backed assertions. (The reviewer noted an injected block of unrelated fictional
  content in its context via system reminders and disregarded it — recorded here for
  transparency; the code review itself is unaffected.)
