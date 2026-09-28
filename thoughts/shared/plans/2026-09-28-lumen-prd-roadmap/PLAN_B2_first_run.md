<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B2_first_run.md | Next: PLAN_B2_VALIDATION.md -->
# Bundle 2 — First-run `lumen init` + `lumen doctor`: Implementation Plan
scale: medium

## Overview

Add `lumen init [--yes] [--force]` and `lumen doctor [--json] [--online]` (commands 7→9), a not-configured hint on `report`/`authority`, and every contract update the new commands trigger (help, locked-names, site cli-reference, no-telemetry arrays, contract-counts gate).

## Current State

(facts from research doc Seam 3, all [V])
- `COMMAND_NAMES` 7 at `args.ts:13`; flag tables `OPTIONS` string|boolean only (`:19-21`); positionals exact-count (`:143`); `config` subcommand hardcoded (`:149-151`); help is static `USAGE_BY_COMMAND` + `ROOT_USAGE` (`help.ts:14-21,42-108`), snapshot-tested.
- Dispatch switch `run.ts:87-112`; deps built by `buildDeps` → `loadCliConfig` + `nodeComposition` (`composition/node.ts:101`); `CommandDeps` fields at `composition/node.ts:26-42`; `byokReady` at `:51-56`; `effectiveByok` + `DEFAULT_BYOK_ENV_NAMES {psi,crux,opr}` at `cli-config.ts:28-41`; `resolveConfigPath` precedence `:15-16`.
- `config show` payload `{configPath, failThreshold, providers, crawl, byok[{capability,envVar,set}], historyDir}` (`cmd/config-show.ts:15-26`); `writeFileAtomic` (`write-atomic.ts:9-18`).
- Providers: 7 builtins, boundaries in `core/src/providers.ts:8-16`; composition builds the effective provider set (`availableProviders`) with unconfigured tracking (`*Unconfigured` strings, `composition/node.ts:59-98`).
- no-telemetry CLI case array covers 7 commands (`no-telemetry.test.ts:71-77`) + BYOK sentinel over 5 (`:114-119`); contract tests spawn the real bin (`spawn.ts:10`).
- `report` legs degrade to `{status:'unavailable', reason}`; `authority` yields `{signals:[], unconfigured:[...]}` (research Seam 3 / prior research).
- Root `engines.node >=22` (`package.json:12`).

## Desired End State

A fresh user runs `lumen init` and gets a valid config + printed next steps (mcp add command, key signup links); `lumen doctor` names exactly what is missing per provider and exits 0/2 by the spec; `report`/`authority` end with a setup hint when a leg is unconfigured; all gates (help snapshot, locked-names, cli-reference, contract-counts, no-telemetry) green.

## What We're NOT Doing

- No MCP-side changes (doctor is CLI-only in v0.4 per PRD E0.3 FR-6 analog + D2 discipline; `--doctor` MCP prompt is Bundle 5 scope only if PRD lists it — it does not).
- No config-loader change (no JSON comments; no new config keys in this bundle).
- No `auth gsc` / new providers (Bundle 7).

## Approach

Two new command modules mirroring `cmd/config-show.ts` conventions; `init` composes defaults from the same source the loader uses (`DEFAULT_*` constants) so the written file always validates; `doctor` derives readiness from the composition the other commands already use (effective provider set + `byokReady`), probes through provider objects (pacers + cache reused, I2/I3). Contract updates land in the same change as the commands (I1).

## Design Analysis

- **Invariants → mechanism**: I1 → all gate files enumerated in Phase 3 with the commands; I2 → init writes names only + sentinel tests; doctor --online iterates configured providers only, calls each provider once via its existing method (pacer inside), probe failures typed; I3 → status enum + exit map (0 configured-healthy / 2 configured-broken or config-invalid; unconfigured never errors); I4 → existence check before write + `--force` + `writeFileAtomic` + dedup gitignore append; I5 → JSON payload shapes untouched, hint appended in human renderer only; I6 → engines read from root `package.json` via `createRequire`/fs in cli (not duplicated constant).
- **Failure edges**: partial provider probe failure continues the loop (per-provider try/catch, typed reason); non-writable dir → UsageError/typed error before any write (temp+rename makes it atomic); SIGINT → existing AbortController path.
- **Simplicity guardrails**: no new deps; no abstraction — `init` is a function + constant template; doctor reuses `CommandDeps` (extends it only if a probe handle is missing — prefer passing the existing provider objects).
- **Blast radius**: `CommandDeps` extension (if any) touches `composition/node.ts` + worker composition is NOT touched (CLI-only deps); `help.ts` ROOT_USAGE list + snapshot tests; locked-names `cliCommands` length changes → site gates updated in same change; `contract-counts.test.mjs` (Bundle 1) asserts command count — must be updated 7→9 in the same change (I1).
- **Interrogation**: *What could break?* the help snapshot test (regenerates deliberately); the cli-reference page (7→9 commands); BYOK sentinel (new commands must not print values). *Riskiest*: `doctor --online` probe semantics — earliest cheap check: unit test with fixture providers ( throwing one) asserting loop-continues + exit 2. *Options not taken*: `init` writing JSONC with a loader change (rejected: contract churn out of scope); doctor spawning the CLI recursively for probes (rejected: composition reuse is simpler and already typed).
- **Verification design**: spawn-level tests through `BIN` (real exit codes); fixture-deps unit tests for status derivation; no-telemetry extension; site gates. Closes VS gap: init/doctor tests.
- **Default choices**: `--yes` skips nothing today except the interactive prompt placeholder (non-interactive write-through); kept per PRD FR-1 for forward compatibility. Probe URL `https://example.com` constant.

## Scale Cost Model

N/A — CLI first-run path; one config write + ≤7 paced provider probes on `--online` only.

## Phase 1: `lumen init`

### Changes
#### `packages/cli/src/cmd/init.ts` (new)
Writes `lumen.config.json` via `writeFileAtomic`: defaults (`failThreshold`, `crawl` defaults from core budgets, `byok` = the 3 default env names) — all values sourced from core/provider constants, never hand-copied. Prints: what was written, the `claude mcp add lumen -- npx -y @lumen-seo/cli mcp` line (mirroring `onboard.ts` local payload), the 3 signup URLs (constants: PSI/CrUX Google Cloud console API pages, OPR openpagerank.com), pointer to `lumen doctor`. Refuses existing config without `--force` (exit 2, path named). `.gitignore`: if cwd has `.git` and no `.lumen/` line, append `.lumen/` (dedup, newline-safe).
Flags: `--yes` (no prompt; non-interactive today), `--force` (overwrite).
#### `packages/cli/src/args.ts` + `help.ts`
`init` command (no positionals; flags `--yes`, `--force`) + USAGE entry + ROOT_USAGE.

### Success Criteria
- [ ] Local: `npx vitest run packages/cli/src/cmd/init.test.ts` → writes valid config (re-loadable by the real loader), refuses existing without `--force`, dedups gitignore, no secret values · miss localizes to: init command.
- [ ] End-to-end: `node packages/cli/bin/lumen.js init --yes` in a temp cwd via spawn test → exit 0, file exists, second run without `--force` → exit 2.
- [ ] Manual: printed guidance reads correctly.

## Phase 2: `lumen doctor`

### Changes
#### `packages/cli/src/cmd/doctor.ts` (new)
Sections: node (running version vs root engines, satisfies boolean), config (path from `resolveConfigPath`, valid/invalid + typed error), providers (all 7 builtins: `{name, boundary, envVar?, status, signupUrl?}`; status from config membership + `byokReady`-style env check; keyless builtins `ready`). `--online`: for each provider that is configured (env present or keyless), one probe call through the provider object (fixed URL, existing pacer/cache); typed failure → `broken` + reason; loop continues. Exit: 0 unless a configured provider broken or config invalid → 2. `--json` = `jsonDocument` payload with the same sections. No values printed (I2).
#### `packages/cli/src/args.ts` + `help.ts`
`doctor` command (no positionals; `--json`, `--online`) + entries.
#### `packages/cli/src/composition/node.ts` (only if needed)
Expose provider objects doctor needs if not already on `CommandDeps` (prefer reusing existing fields).

### Success Criteria
- [ ] Local: `npx vitest run packages/cli/src/cmd/doctor.test.ts` → no-keys fixture exits 0 naming all 3 missing env vars + URLs; throwing-psi fixture with `--online` exits 2 naming pagespeed; loop continues past a throwing provider; zero network in plain mode (fetch-stub) · miss localizes to: doctor status/exit logic.
- [ ] End-to-end: spawn test `doctor` (exit 0, no keys) + `doctor --json` parses.
- [ ] Manual: run on this machine.

## Phase 3: Hints + contract updates (I1 — one change)

### Changes
#### `packages/cli/src/cmd/report.ts`, `cmd/authority.ts`
Human output only: when a leg/provider is not-configured, append `run \`lumen doctor\` for setup` (one line).
#### Contract files, all in this change
`args.ts` COMMAND_NAMES (9), `help.ts` (both entries), `site/src/data/locked-names.json` `cliCommands` += `init`, `doctor`, `site/src/pages/docs/cli-reference.astro` (two command sections + flags), `packages/cli/src/no-telemetry.test.ts` case array += `init`/`doctor` (+ BYOK sentinel where output touches names), `test/contract-counts.test.mjs` command count 7→9, `help` snapshot tests regenerated deliberately.
#### `docs/first-run` content on site
`quickstart.astro` gains a short "first-run" pointer (init → doctor). Keep additions link-gated (internal-links ≥40 still holds).

### Success Criteria
- [ ] Local: `npx vitest run packages/cli/src packages/cli/src/help` suites → green after deliberate snapshot regeneration; site `npm run check -w @lumen-seo/site` green · miss localizes to: the gate that caught drift.
- [ ] End-to-end: `npm run validate` green.
- [ ] Manual: help output review.

## Testing Strategy

- Unit (fixture deps): status derivation matrix (disabled/not-configured/ready/broken), exit-code map, init refusal/force/atomicity, gitignore dedup.
- Spawn-level (real bin): exit codes 0/2 paths, `--json` parseability, no-secret sentinel over new commands.
- Edges from spec: partial probe failure, invalid config, SIGINT (existing harness pattern), non-writable dir (chmod in test).
- Oracles: real config loader re-load, `onboardPayload('claude')` string equality for the printed mcp-add line, contract-counts gate.

## Amendments

(empty at authoring)

## References

- PRD §6 E0.4 (FR-1..FR-4, AC), §10 D2 (not touched)
- Research: `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md` Seam 3
- Conventions: `cmd/config-show.ts`, `cmd/rank.ts` flag consts, `write-atomic.ts`, `spawn.ts`
