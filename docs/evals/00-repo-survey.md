# Repo survey for AI evals — lumen (Prompt 3 Step 0)

Surveyed 2026-09-06 at commit 453ed43 (branch main → trial branch `evals/trial-promptfoo`). Evidence markers follow the research doc's convention; full ledger in `~/Documents/personal-development/thoughts/shared/research/2026-09-06-ai-eval-frameworks-two-repos.md`.

## Language, package manager, runtime, test runner
- TypeScript 5.9 (strict), npm workspaces (`package.json` `workspaces: ["packages/*", "site"]`), Node `>=22` (`engines`).
- Root scripts: `"test": "vitest run"`, `typecheck`, `lint` (eslint 9), `validate` (typecheck+lint+worker build+site build+test+cli-smoke) — `package.json:13-19`.
- vitest 4 with per-package projects; shared config `vitest.shared.ts:9-14` (`environment: 'node'`, `include: ['src/**/*.test.ts']`); root `vitest.config.ts:16-29` lists `packages/*/vitest.config.ts`, `site`, and a `ci-scripts` project. Root `npm test` expects `site/dist` built (`vitest.config.ts:6-10`) — CI builds worker+site before `npm test` on PRs/main (`.github/workflows/ci.yml:76-88`).

## Where the LLM/MCP surface lives
- MCP server: `packages/mcp/src/server.ts:88` — `buildMcpServer(deps)` registers 5 tools (`lumen_audit_site`, `lumen_page_report`, `lumen_keyword_ideas`, `lumen_rank_check`, `lumen_authority`) — names locked in `TOOL_NAMES` (`packages/mcp/src/schemas.ts:12-19`), zod v4 `z.strictObject` input schemas (`schemas.ts:35-66`).
- Handlers are pure `(args, extra)` functions over injected `McpDeps` (providers, cache, clock…). No generation step — lumen calls free SEO data providers, not LLMs; the "AI surface" is the MCP tool contract.
- Stdio entry: `packages/cli/src/cmd/mcp.ts:46-48` (`buildMcpServer` + `StdioServerTransport`); bin `packages/cli/bin/lumen.js` runs TS sources via transform lane/re-exec (no build needed in-workspace). HTTP entry: `packages/mcp/worker/index.ts` (Cloudflare Worker, out of eval scope).

## Request entry / response exit
- In-process (testkit): `connectClient(deps)` builds the server + `InMemoryTransport.createLinkedPair()` + SDK `Client` — `packages/mcp/src/testkit/index.ts:135-143`; `fixtureDeps()` gives all-5-tools-live fake providers; `recordingFetcher()` throws on any outbound fetch (`:100-110`).
- Wire (black box): spawn `node packages/cli/bin/lumen.js mcp`, JSON-RPC over stdio (mirrors `packages/cli/src/stdio-roundtrip.test.ts`).
- Responses leave as MCP tool results; provider data flows from injected `Fetcher` (`packages/core/src/fetcher.ts:23-81` — the only `fetch` in the repo is the default delegate).

## Observable from outside
- `tools/list` (names + zod-derived input schemas), `tools/call` results (structured content + error semantics), handler-side arg strictness (`strict-args.ts`), URL policy (`url-guard.ts` — private/blocked hosts), local-only capability deny (`local-only.ts`), unconfigured-provider behavior (`composition/node.ts:53-55` — skipped providers listed, never called), latency.

## What must be faked to run offline
- Upstream HTTP providers: already faked by design — `packages/providers/src/testing.ts` (`fakeFetcher`, `makeDeps`), `packages/audit/src/testing/fake-fetcher.ts`, testkit `fixtureDeps()`. For the black-box trial no fake is needed if evals stick to surfaces that never reach a provider (snapshots, denials, unconfigured-provider errors) — a key-free environment is itself the "fake".
- Model provider: none (lumen does not call an LLM). Judge cases therefore target live-config only and stay skipped offline.
- Database: none.

## Existing test structure
- Colocated `src/**/*.test.ts` per package; MCP package tests already start the server in-process (`schema-contract.test.ts` asserts `listTools()` = exactly the 5 names) and the CLI tests spawn the real bin over raw stdio. `packages/mcp/src/no-direct-fetch.test.ts`-style source gates exist in `packages/providers` (zero direct `fetch(` in src).
- CI: `identity` (commit/license gate, `scripts/ci/check-commits.mjs` — bans AI co-author trailers), `workflow-lint` (actionlint), `lint`, `typecheck`, `test`. Node 22 everywhere.

## Eval-suite constraints derived
- Eval files must not join `src/**/*.test.ts` include (default gate must not change) — evalite files named `*.eval.ts`, promptfoo configs under `evals/` (outside vitest projects globs).
- `evals/**`-only diffs still get `scope=ALL` CI test runs (`select-workspaces.mjs` fail-safe) — no CI collision.
- Commits must satisfy the identity gate (no `Co-authored-by`).
