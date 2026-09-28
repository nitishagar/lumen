# Verification Surface — lumen (durable, project-level)

> How this repo verifies changes: commands, oracles, fixtures, observability, gaps.
> Established 2026-09-28 from main @ 3ae6113 by the PRD-roadmap research pass. Refresh when the tree moves materially.

## Commands

| Purpose | Command | Defined at | Healthy output |
|---|---|---|---|
| test-all | `npm test` | `package.json:18` (vitest run) | `X files / Y tests passed` summary, exit 0 |
| full gate | `npm run validate` | `package.json:20` | typecheck+lint+worker build+site build+tests+cli-smoke all green |
| typecheck | `npm run typecheck` | `package.json:19` (workspaces, `tsc --noEmit`) | silent, exit 0 |
| lint | `npm run lint` | `package.json:21` (eslint .) | silent, exit 0 |
| **test-one** | `npm test -w @lumen-seo/<ws>` · scoped file: `npx vitest run packages/<ws>/src/<file>.test.ts` · name: `… -t <test name>` | `CONTRIBUTING.md:28`; vitest.config.ts | per-file pass counts |
| evalite gate | `npm run test:evals -w @lumen-seo/mcp` | `packages/mcp/package.json:24` (`SWARM_SKIP=1 evalite run --threshold 100`) | all evals score ≥ 1, exit 0 |
| swarm (all) | `npm run test:swarm -w @lumen-seo/mcp` | `packages/mcp/package.json:25` (`evalite run swarm`) | scoreboard appended, report-only |
| swarm (one) | `SWARM_ONLY=<adversary-id> npm run test:swarm -w @lumen-seo/mcp` | `docs/evals.md:78` | single adversary verdict |
| worker build+size | `npm run build:worker -w @lumen-seo/mcp && npm run check:size -w @lumen-seo/mcp` | `packages/mcp/package.json:20-22` | bundle ≤ 1.5 MiB gzip self-cap holds |
| site build+tests | `npm run check -w @lumen-seo/site` | `site/package.json:16` | astro build + pagefind + site vitest green |
| CLI smoke (offline) | `node scripts/ci/cli-smoke.mjs` | `package.json:20` chain | zero-network assertions pass |
| dry-run publish | `node scripts/ci/publish-workspaces.mjs --tag vX.Y.Z --dry-run` | `docs/release.md:31` | manifests rewritten runner-local |

## Oracles

- `site/src/data/locked-names.json` + `site/tests/locked-names.test.ts:30-48` — byte-exact snippet gate + `/lumen_[a-z_]+/g` tool sweep over built HTML. Confirms: command/tool/snippet contract. Cannot confirm: runtime behavior.
- `packages/mcp/src/output-shapes.test.ts:20,62-67` — exact concise-payload key set + `topIssues ≤10` field set. The oracle any payload change is deliberately measured against.
- `packages/mcp/src/schema-contract.test.ts` — exactly five locked tool names, no-default-required, `additionalProperties:false`.
- `packages/cli/src/stdio-roundtrip.test.ts:134-143` — `tools/list` name equality (tolerant of prompts/resources; purity check on stdout).
- `packages/audit/src/e2e.test.ts` — fixture-site crawl e2e (rules fire, score recomputed, renderer static).
- evalite: `tool-list.snapshot.json`, `golden.json`, output-shape/provenance/latency cases (`tool-contract.eval.ts`).
- `packages/core/src/gate.test.ts:57` — exit-code contract lock.

## Fixtures & harnesses

- `packages/audit/src/testing/`: `FakeFetcher`/`FakeRoute` (per-URL routes incl. ROBOTS/SITEMAP; unknown → 404), `makeTestDeps` (step clock, fixed jitter), `makePage(html)` (cheerio). Dev-sized; the canonical way to build rule/crawler fixtures.
- `packages/mcp/src/evals/testkit/index.ts`: `connectClient(deps)` over `InMemoryTransport`, `fixtureDeps()` (all capabilities), `fixtureRemoteDeps()` (LOCAL_ONLY shape), `parseToolJson`.
- `packages/cli/src/spawn.ts`: spawns the real `bin/lumen.js` for integration tests.
- Swarm corpus: `packages/mcp/src/evals/data/adversaries.json` (15 locked ids); select via `SWARM_ONLY`.

## Observability

- Swarm scoreboard: `packages/mcp/.evalite/swarm-scoreboard.jsonl` (CI artifact on evals.yml).
- evalite per-case scores; vitest per-file summaries; `config show --json`; `--out` report files.
- CI: ci.yml (identity/workflow-lint/lint/typecheck/scoped-test), evals.yml (gating evals + report-only swarm), release.yml (tag-driven publish), pages.yml, deploy-worker.yml. No scheduled/cron workflow exists yet.

## Gaps (no existing check observes these)

- No SARIF schema validation (needed by E1.4).
- No link-integrity checker (E0.1 builds one; it should self-host on this repo).
- No init/doctor (commands don't exist → no tests).
- Docs rule-count prose ("20 rules") is ungated — updates are manual.
- Swarm gate is report-only (`continue-on-error: true`); no threshold blocks regressions.
- No JSON-LD / sitemap-sampling parser-robustness tests (E1.6 must add bounded adversaries).
- No byte-size oracle for the ≤4 KB concise MCP payload budget (E1.2 FR-6) — the evalite latency case measures time, not bytes.
- No in-repo command observes E0.3 acceptance (mcp-publisher validation, .mcpb install, registry API listing) — external steps.
- `--from-history` new/fixed breakdown (E1.3 FR-4) has no data source: `AuditHistoryEntry` is a digest without issue fingerprints.
