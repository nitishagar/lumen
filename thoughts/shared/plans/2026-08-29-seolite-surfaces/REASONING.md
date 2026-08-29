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
