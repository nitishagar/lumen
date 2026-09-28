<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B1_release_train.md | Next: PLAN_B1_VALIDATION.md -->
# Bundle 1 — v0.3 release train: Implementation Plan
scale: medium

## Overview

Make the v0.3 release real: a contract-count drift gate, CHANGELOG 0.3.0 + discipline, three distribution artifacts (`server.json`, `lumen.mcpb`, Claude Code plugin) wired into `release.yml`, three new `lumen mcp --print` targets, a scheduled link-integrity check, and the owner runbook for the external steps. No runtime audit/MCP behavior changes.

## Current State

(facts from `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md`, all [V])
- `mcp --print` has 4 targets (`packages/cli/src/cmd/mcp.ts:23`), payloads in `packages/mcp/src/onboard.ts:12-31`, 8 snapshot cases in `packages/mcp/src/onboard.test.ts`, 8-payload contract in `packages/cli/src/mcp-print.test.ts:2`.
- No `server.json`, no `.mcpb`, no plugin files, no mcpb tooling anywhere (find empty).
- `release.yml`: `build-and-test` → `github-release` → `publish` (guarded on `NODE_AUTH_TOKEN`, runner-local rewrite via `scripts/ci/publish-workspaces.mjs`, duplicate-publish idempotent). No registry/mcpb jobs. No scheduled workflow exists.
- `CHANGELOG.md` latest section `[0.2.1]`; no `[Unreleased]`. `.github/PULL_REQUEST_TEMPLATE.md` exists without a CHANGELOG checkbox.
- Root vitest `ci-scripts` project runs `test/**/*.test.mjs` (`vitest.config.ts`) — existing script tests: `test/cli-smoke.test.mjs` etc.
- `locked-names.json` snippets: `{installGlobal, npxAudit, claudeMcpAdd, mcpServersJson}`; site gates: byte-exact snippets + tool sweep (`site/tests/locked-names.test.ts:30-48`), internal-links ≥40, attribution hrefs.
- Root README + 5 package READMEs carry absolute repo/docs URLs; `SECURITY.md:15` advisory URL.
- npm `@lumen-seo/cli` has no `mcpName` (registry validation would fail).

## Desired End State

A pushed `v0.3.0` tag runs the existing validate+release+publish and additionally: publishes `server.json` to the MCP Registry via `mcp-publisher` (OIDC), builds `lumen.mcpb` and attaches it to the GitHub Release, and asserts the published npm version matches the tag. CI fails if README/docs rule-count prose drifts from the rule registry. A weekly link check exercises every absolute URL the published materials expose. `lumen mcp --print {mcpb,registry,claude-plugin}` prints the onboarding payloads. All site gates green.

## What We're NOT Doing

- No MCP payload/schema change (D2 belongs to Bundle 4); no new CLI audit flags; no rule changes.
- No repo-visibility change, no npm publish, no directory submissions (owner-gated; runbook only).
- No npm dependency added for runtime; `@anthropic-ai/mcpb` is used only in the release workflow (npx), not in devDependencies.
- No SARIF/Action (Bundle 5), no init/doctor (Bundle 2).

## Approach

Artifacts are repo-root files (single source of truth for the release workflow); `--print` payloads are deterministic constants in `onboard.ts` (shippable via npm) with a repo test asserting constants == artifact files, so the two cannot drift (I1, PRD E0.3 FR-5 "onboarding code stays the single source of truth"). Release jobs chain npm publish → registry publish (dependency, not convention) and run version substitution runner-local (I3, I6).

## Design Analysis

- **Invariants → mechanism**: I1 → `OnboardTarget` union + `PRINT_TARGETS` + tests in one change; I2 → manifest fields only (`isSecret`, `sensitive: true`), extended never-embeds test; I3 → `if:` guards + runner-local `jq`/node substitution; I4 → `test/contract-counts.test.mjs` parsing `rule-set.ts` registry vs README/docs prose; I5 → `link-check.yml` with `schedule`/`workflow_dispatch`/tag triggers only; I6 → `mcpName` in `packages/cli/package.json` + version substitution; I7 → CHANGELOG sections + PR checkbox; I8 → run site suite.
- **Failure edges**: link check network flake → one retry per URL then fail with the failing URL list; mcpb pack failure → job fails before release attach (release exists but without asset — rerunnable, `--clobber` on upload); registry publish without npm publish → blocked by `needs: publish` + skip propagation.
- **Simplicity guardrails**: no new abstraction — one .mjs checker script, one vitest ci-scripts test per script, JSON files, workflow YAML; `@anthropic-ai/mcpb` via npx in CI rather than a wrapper script.
- **Blast radius**: `onboard.ts` is consumed by `cmd/mcp.ts` (print path) and site docs (indirectly via locked-names); extending the union is additive; no other callers (`grep OnboardTarget` → onboard.ts, cmd/mcp.ts, tests). `release.yml` new jobs depend on existing ones without altering them. `package.json` (cli) gains one static field.
- **Interrogation**: *What could break?* site tool sweep picks up any new `lumen_*` string in built HTML — new snippets must not name MCP tools not in the locked five; publish-workspaces rewrite must preserve `mcpName` (it mutates parsed JSON: version/private/deps only — verified `publish-workspaces.mjs:174-185`). *Riskiest step*: the registry-publish job (untestable offline) — earliest check: `mcp-publisher publish --dry-run` is not supported, so validation is the JSON-shape test + actionlint; the job itself is owner-gated on first tag run and marked as such in the runbook. *Options not taken*: vendoring node_modules into the mcpb (rejected: bundle bloat vs P-Thin); committing versioned server.json per release (rejected: I3 "nothing commits from runners" + version lies between releases).
- **Verification design**: uses `test/**/*.test.mjs` ci-scripts project (new tests run in `npm test`), onboard/mcp-print suites, site `check`, actionlint via existing workflow-lint job. Closes VS gaps: link-checker (self-hosted), contract-count drift gate.
- **Default choices**: checker in plain Node `.mjs` following `scripts/ci/` conventions; cron Monday 03:00 UTC weekly; HEAD with GET fallback on 405/403/501.

## Scale Cost Model

N/A — packaging/docs/workflows; no hot-path or perf-sensitive runtime change. (Dominant new operation: link check ≈ 40–100 HTTP requests weekly, bounded concurrency 5 — negligible.)

## Phase 1: Drift gates + CHANGELOG discipline

### Changes
#### `test/contract-counts.test.mjs` (new)
Parses `packages/audit/src/rules/rule-set.ts` for `{ id: '…'` entries → registry count; asserts the number in root README prose ("20 built-in rules"), `site/src/pages/docs/rules-reference.astro` heading/prose, and CHANGELOG `[0.3.0]` claim all equal the registry count; asserts `COMMAND_NAMES` count == locked-names `cliCommands.length` (7) and `TOOL_NAMES` count == `mcpTools.length` (5) by regex on source + JSON read (ci-scripts project is dependency-free: regex the TS source, no TS import).
#### `.github/PULL_REQUEST_TEMPLATE.md`
Add checkbox: `CHANGELOG.md [Unreleased] updated for user-facing changes`.
#### `CHANGELOG.md`
Add `## [Unreleased]` (empty template) above `## [0.3.0] — 2026-09-28`; `[0.3.0]` records PR #37 content (2 rules, audit history kind, `rank --history --kind/--format` CSV provenance, evalite/swarm gates dev-only) + this bundle (distribution artifacts, print targets, link check, drift gate).

### Success Criteria
- [x] Local: `npx vitest run test/contract-counts.test.mjs` → 0 failed; deliberately asserting counts (7 commands, 5 tools, 20 rules) fails loudly if a rule is added without README/docs updates (a miss localizes to: prose vs registry drift).
- [x] End-to-end: `npm test` green (ci-scripts project picks the new file).
- [ ] Manual: CHANGELOG section review.

## Phase 2: `lumen mcp --print` new targets

### Changes
#### `packages/mcp/src/onboard.ts`
Extend `OnboardTarget` with `'mcpb' | 'registry' | 'claude-plugin'`; add deterministic payload constants mirroring the repo-root artifact files: `mcpb` → install instruction + manifest summary (no JSON dump of the whole manifest; the exact text pinned in tests); `registry` → pretty-printed `server.json` content as shipped (constants must equal the file — enforced by Phase 3's test); `claude-plugin` → marketplace add + install commands. Never embeds key values (I2).
#### `packages/cli/src/cmd/mcp.ts`
`PRINT_TARGETS` gains the three names (validation error message lists all 7).
#### Tests
`packages/mcp/src/onboard.test.ts` — 8→14 snapshot cases. The existing generic sentinel (`/KEY|SECRET|TOKEN|sk-/i`, `onboard.test.ts:29-34`, `mcp-print.test.ts:49-55`) stays for the 4 legacy targets; the 3 new targets get a pinned adapted oracle: (a) the only KEY/SECRET/TOKEN occurrences allowed are the exact names `LUMEN_PSI_KEY|LUMEN_CRUX_KEY|LUMEN_OPR_KEY` and the JSON field `isSecret`/`sensitive`; (b) no occurrence pairs a name with a value (regex `/LUMEN_[A-Z_]+KEY['"]?\s*[:=]\s*['"][^'"]+/` must not match); a hit = FAIL (names travel, values never). `packages/cli/src/mcp-print.test.ts` — 14 payloads. New `test/onboard-artifacts.test.mjs` (ci-scripts): reads repo-root `server.json`, `mcpb/manifest.json`, `.claude-plugin/marketplace.json` and asserts the `registry`/`mcpb`/`claude-plugin` print payloads match the files' content/shape — the anti-drift oracle.

### Success Criteria
- [x] Local: `npx vitest run packages/mcp/src/onboard.test.ts packages/cli/src/mcp-print.test.ts` → 14 payload cases pass · miss localizes to: onboard payload drift.
- [x] End-to-end: `npm test` green; `node packages/cli/bin/lumen.js mcp --print registry` prints JSON parseable by `JSON.parse` (spawn test covers via contract suite).
- [ ] Manual: payloads read correctly.

## Phase 3: Distribution artifacts + anti-drift test

### Changes
#### `server.json` (repo root)
Per registry quickstart (fetched 2026-09-28): `$schema …/2025-12-11/server.schema.json`, `name: io.github.nitishagar/lumen`, `description`, `repository {url, source: github}`, `version: 0.3.0` (tag-substituted runner-local at publish), `packages[]` with camelCase `registryType: npm`, `identifier: @lumen-seo/cli`, `transport {type: stdio}`, `environmentVariables[]` for `LUMEN_PSI_KEY`, `LUMEN_CRUX_KEY`, `LUMEN_OPR_KEY` — `isRequired: false`, `isSecret: true`, format `string` (names only, I2).
#### `mcpb/` (repo root, committed — `dist/` is gitignored)
`mcpb/manifest.json`: mcpb manifest v0.3 — `manifest_version: "0.3"`, name `lumen`, version `0.3.0` (bumped by the release-prep PR, see Phase 5 runbook), author, `server {type: "node", entry_point: "server.js", mcp_config {command: "node", args: ["${__dirname}/server.js"], env: {"LUMEN_PSI_KEY": "${user_config.LUMEN_PSI_KEY}", "LUMEN_CRUX_KEY": "${user_config.LUMEN_CRUX_KEY}", "LUMEN_OPR_KEY": "${user_config.LUMEN_OPR_KEY}"}}}` — the env substitution is the documented user_config→env delivery (keys entered in Claude Desktop reach lumen as env vars); `user_config` with the 3 key names (`type: "string"`, `sensitive: true`, `required: false`); `compatibility {runtimes: {node: ">=22"}}`.
`mcpb/server.js`: ~10-line launcher — `spawn('npx', ['-y', '@lumen-seo/cli', 'mcp'], { stdio: 'inherit', env: process.env })` with a clear stderr note if npx is missing (the bundle delegates to the npm package: P-Thin, no vendored node_modules).
`mcpb/README.md`: what the bundle is + the npx-delegation note.
#### `.claude-plugin/marketplace.json` + `plugin-lumen/` (plugin source)
Marketplace metadata listing plugin `lumen` (source `./plugin-lumen`); plugin: `.claude-plugin/plugin.json` (name/description/version/author), `.mcp.json` (stdio server `npx -y @lumen-seo/cli mcp`), `skills/seo-check/SKILL.md` (frontmatter name/description; body: run `lumen_audit_site`, then act on ranked/grouped findings, respect fixHints, cite provenance). No key values (I2).
#### `packages/cli/package.json`
`"mcpName": "io.github.nitishagar/lumen"` (matches `server.json.name`; preserved by `rewriteManifest` — verified mutation set is version/private/deps only, `publish-workspaces.mjs:174-185`).
#### `docs/distribution.md` (repo docs, runbook)
Owner-gated external steps in order: release-prep PR (bump `server.json` + `mcpb/manifest.json` versions to the next tag — human commit, keeps I6 honest between releases) → D1 visibility flip → tag v0.3.0 → verify npm → registry API check (`curl registry.modelcontextprotocol.io/v0.1/servers?search=…`) → mcpb install check → directory submissions (Glama, Smithery/mcp.so, awesome-mcp-servers PR) → post-publish smoke command (`npx -y @lumen-seo/cli@0.3.0 audit https://example.com --json`).
#### `test/onboard-artifacts.test.mjs` (from Phase 2, landed here with the files)

### Success Criteria
- [x] Local: `npx vitest run test/onboard-artifacts.test.mjs` → artifacts exist, JSON-parse, key names match the BYOK defaults, `sensitive/isSecret` true on all three, print payloads == files, manifest shape = mcpb v0.3 required fields with the `${user_config.*}` env delivery · miss localizes to: artifact/payload drift. (`mcpb pack` itself runs only in the release workflow — first tag is owner-gated; the schema-shape test is the offline oracle.)
- [x] End-to-end: `npm run validate` green (site gates + full suite; workflow-lint will catch YAML errors in Phase 5).
- [ ] Manual: read-through of runbook steps.

## Phase 4: Link-integrity check

### Changes
#### `scripts/ci/link-check.mjs` (new)
Dependency-free Node script: extract absolute `https?://` URLs from `README.md`, `packages/*/README.md`, `SECURITY.md`, and URL-valued fields in `site/src/data/locked-names.json`; strip trailing punctuation/`>`; dedupe; `USER_AGENT: lumen-link-check/0.0 (+repo)`; concurrency 5; per-attempt timeout 10 s; HEAD → GET fallback on 405/403/501; one retry on network error; exit 1 listing failing URLs + source file, else exit 0 with counts. `--json` flag for CI annotations.
#### `test/link-check.test.mjs` (new)
Offline tests: extraction correctness (trailing `>`/`)` cases), dedupe, locked-names field collection, failure-exit listing shape (fetcher injected/mocked at module seam).
#### `.github/workflows/link-check.yml` (new)
`schedule` (weekly cron), `workflow_dispatch`, `push: tags: ['v*']`; runs the script; never in ci.yml (I5).

### Success Criteria
- [x] Local: `npx vitest run test/link-check.test.mjs` → green; `node scripts/ci/link-check.mjs` exit 0 today is NOT expected (repo private → repo/docs URLs 404): the honest run fails listing them (documented; flips green after D1).
- [x] End-to-end: `npm test` green (offline tests); workflow YAML passes actionlint in CI.
- [ ] Manual (owner, post-D1): workflow run green on `workflow_dispatch`.

## Phase 5: Release workflow wiring + site snippets

### Changes
#### `.github/workflows/release.yml`
Add two jobs after `publish`: `registry` (needs publish; skipped when publish skipped via its `outputs.skip` propagation; installs the mcp-publisher binary from the registry release URL, `login github-oidc` with `permissions: {id-token: write, contents: read}`, substitutes tag version into a runner-local copy of `server.json`, `publish`); `mcpb` (needs github-release; packs via `npx -y @anthropic-ai/mcpb pack mcpb lumen.mcpb`, uploads to the release with `gh release upload --clobber`). Add drift assertion step to `publish` job: after publish, `npm view @lumen-seo/cli version` == tag version (I4 at release time).
#### `site/src/data/locked-names.json` + `site/src/pages/docs/mcp-onboarding.astro`
Add snippets `mcpbInstall` and `claudePluginInstall` (exact text mirroring print payloads); render both on the mcp-onboarding page (byte-exact gate satisfied — snippets still consumed verbatim from locked-names).
#### `site/src/pages/docs/cli-reference.astro`
Document the 7 `--print` targets.

### Success Criteria
- [x] Local: `npm run check -w @lumen-seo/site` → green (byte-exact snippets, links, attribution, artifact gates) · miss localizes to: site gate that caught it.
- [x] End-to-end: `npm run validate` green; actionlint passes on the amended release.yml in CI.
- [ ] Manual (owner, first tag): registry API returns lumen; `.mcpb` attaches to release; `/plugin marketplace add nitishagar/lumen` + `/plugin install lumen@<marketplace>` work.

## Testing Strategy

- ci-scripts vitest tests (offline, dependency-free): contract counts, onboard↔artifact anti-drift, link-check extraction/failure shape.
- Existing oracles reused: onboard snapshot + never-embeds tests, mcp-print contract, site gates (locked-names byte-exact + links ≥40 + attributions), `spawn.ts` real-bin contract.
- Edges covered: URL extraction punctuation, lock-file field collection, publish-skip propagation (workflow `if:` reviewed by actionlint + human), no secrets in artifacts (never-embeds over 14 payloads).
- No TS runtime change → no evalite/snapshot updates required; suites must stay green unchanged (that is itself the regression check for "no MCP wire change").

## Amendments

(empty at authoring)

## References

- PRD: `thoughts/shared/specs/2026-09-28-lumen-next-features-prd.md` §6 E0.1–E0.3, §8, §10 D1/D5
- Research: `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md` (Seam 4/5 + Verification Surface)
- External shapes (fetched 2026-09-28): registry quickstart (server.schema.json 2025-12-11, `mcpName`, `mcp-publisher`, `login github-oidc`), mcpb MANIFEST.md (v0.3, user_config.sensitive)
- Onboard/mcp-print: `packages/mcp/src/onboard.ts`, `packages/cli/src/cmd/mcp.ts:23`
- Release mechanics: `scripts/ci/publish-workspaces.mjs:169-185`, `.github/workflows/release.yml`

## Amendments

- AMENDED 2026-09-28 Phase E validation fixes [factual]: mcpb artifacts committed at repo-root `mcpb/` (gitignore F1); adapted never-embeds oracle pinned for the 3 new targets (F2); concrete mcpb manifest + launcher + `${user_config.*}` env delivery (F3); release-prep version-bump step in runbook (F4). Validator resumed: PASS.
- Residual notes folded in: (a) the `mcpb` print payload is a summary (counts + names) and must not quote `${user_config.*}` mappings verbatim (would false-positive the value-pairing regex); (b) the runbook release-prep step also bumps `.claude-plugin` `plugin.json` version; (c) the `publish` job declares job-level `outputs: {skip}` so `registry` can propagate the skip.
- AMENDED 2026-09-28 Phase 5 [factual]: `npm run validate` was red at BASELINE (verified in a clean worktree @ 3ae6113): `publish-workspaces.mjs` treated committed nested lockfile entries (`packages/mcp/node_modules/@cloudflare/workerd-darwin-64`, no name field) as publishable workspaces, contradicting its own doc comment "registry/node_modules entries are excluded". Fix: the path filter now excludes `node_modules/` — one line, no mechanism/interface change; the pre-existing test (`test/publish-workspaces.test.mjs:526`) passes unmodified (42/42).

### Evidence (literal tool output, 2026-09-28)
- `npx vitest run test/contract-counts.test.mjs` → `Tests  6 passed (6)`
- `npx vitest run packages/mcp/src/onboard.test.ts packages/cli/src/mcp-print.test.ts test/onboard-artifacts.test.mjs test/contract-counts.test.mjs` → `Test Files  4 passed (4) / Tests  44 passed (44)`
- `npx vitest run test/link-check.test.mjs` → `Tests  8 passed (8)`
- `npx vitest run test/publish-workspaces.test.mjs` (after factual amendment) → `Tests  42 passed (42)`
- `npm run lint` → clean · `npm run validate` → typecheck + lint + worker build + site build + `Test Files 87 passed (87) / Tests 970 passed` + `cli-smoke: smoke green`
- AMENDED 2026-09-28 Phase 3 [factual]: the payload↔file anti-drift comparison lives in the mcp TS suite (`onboard.test.ts` reads repo-root `server.json` via fs) instead of the dependency-free ci-scripts test, which cannot import the TS payload constant; the ci-scripts test keeps the file-shape checks. Reviewer finding (anti-drift oracle was decorative) fixed by this test.
