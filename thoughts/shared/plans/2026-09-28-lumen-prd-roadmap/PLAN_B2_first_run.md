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
#### `packages/cli/src/cmd/init.ts` (new; test flat at `packages/cli/src/init.test.ts` per the `src/*.test.ts` convention)
Writes `lumen.config.json` via `writeFileAtomic` to the resolved config path (`resolveConfigPath(ctx.configPathFlag)` — flag > `LUMEN_CONFIG` > cwd default): defaults (`failThreshold`, `crawl` defaults from core budgets, `byok` keyed by PROVIDER names via `BYOK_ENV_VARS` from `@lumen-seo/providers` → `{pagespeed: 'LUMEN_PSI_KEY', crux: 'LUMEN_CRUX_KEY', openpagerank: 'LUMEN_OPR_KEY'}`) — all values sourced from core/provider constants, never hand-copied. **The byok map is keyed by provider names, not capability names** — `createProviderRegistry` rejects byok keys that are not builtin provider names (`core/src/registry.ts:74-81`), so capability keys (`psi`) would poison every provider command after init. Prints: what was written, the `onboardPayload('claude')` line (single source: includes `--transport stdio`), the 3 signup URLs (pinned constants below), pointer to `lumen doctor`. Refuses existing config without `--force` (exit 2, path named). `.gitignore`: if cwd has `.git` and no `.lumen/` line, append `.lumen/` (dedup, newline-safe).
Flags: `--yes` (no prompt; non-interactive today), `--force` (overwrite).

Pinned signup URLs (constants): PSI `https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com` · CrUX `https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com` · OPR `https://www.openpagerank.com/`.
#### `packages/cli/src/args.ts` + `help.ts` + `run.ts`
`init` command (no positionals; flags `--yes`, `--force`) + USAGE entry + ROOT_USAGE + `case 'init'` in the dispatch switch (`run.ts:87-112`).

### Success Criteria
- [ ] Local: `npx vitest run packages/cli/src/init.test.ts` → writes valid config; **registry round-trip oracle**: `createProviderRegistry(config.providers, config.byok, availableProviders(config))` on the written file does not throw (would fail on capability-keyed byok); refuses existing without `--force`; dedups gitignore; no secret values · miss localizes to: init command.
- [ ] End-to-end: `node packages/cli/bin/lumen.js init --yes` in a temp cwd via spawn test → exit 0, file exists, second run without `--force` → exit 2.
- [ ] Manual: printed guidance reads correctly.

## Phase 2: `lumen doctor`

### Changes
#### `packages/cli/src/cmd/doctor.ts` (new; test flat at `packages/cli/src/doctor.test.ts`)
Sections: node (running `process.version` vs the **cli package's own `engines.node`** read from `packages/cli/package.json` — the shipped artifact declares `>=22.7`; root package.json is private and not shipped), config (path from `resolveConfigPath`, valid/invalid + typed error), providers (all 7 builtins via `BUILTIN_PROVIDER_NAMES` + `PROVIDER_CAPABILITIES`: `{name, boundary, envVar?, status, signupUrl?}`). **Status derivation uses `resolveEnvVar(provider, providersConfigFrom(config)[provider])` → env name → `process.env[name]` set/non-empty = ready; keyed provider with unset env = not-configured + env name + signup URL; keyless builtins = ready. `byokReady` is NOT used — it returns true when no byok entry is declared, which would report `ready` on a clean machine and violate the PRD AC.** `disabled` exists in the status type but is unreachable today (no enablement config) — reserved. `--online`: for each provider that is ready-by-env or keyless, one probe call through the provider object with pinned inputs (suggest/wikipedia seed `'example'`, tranco domain `'example.com'`, ddg keyword `'example'` + domain `'example.com'`, pagespeed/crux URL `'https://example.com'`, opr domain `'example.com'`), reusing existing pacers/cache; typed failure → `broken` + reason; loop continues. Exit: 0 unless a configured provider broken or config invalid → 2. `--json` = `jsonDocument` payload with the same sections. No values printed (I2).
#### `packages/cli/src/args.ts` + `help.ts` + `run.ts`
`doctor` command (no positionals; `--json`, `--online`) + entries + `case 'doctor'` in the dispatch switch.
#### `packages/cli/src/composition/node.ts` (only if needed)
Expose provider objects doctor needs if not already on `CommandDeps` (prefer reusing existing fields).

### Success Criteria
- [ ] Local: `npx vitest run packages/cli/src/doctor.test.ts` → no-keys fixture exits 0 naming all 3 missing env vars + URLs; throwing-psi fixture with `--online` exits 2 naming pagespeed; loop continues past a throwing provider; zero network in plain mode (fetch-stub); node section's `satisfies` recomputed in the test from the parsed cli package.json engines (would FAIL if the engines source were hardcoded or pointed at the private root manifest) · miss localizes to: doctor status/exit logic.
- [ ] End-to-end: spawn test `doctor` (exit 0, no keys) + `doctor --json` parses.
- [ ] Manual: run on this machine.

## Phase 3: Hints + contract updates (I1 — one change)

### Changes
#### `packages/cli/src/cmd/report.ts`, `cmd/authority.ts`
Human output only: when a leg/provider is not-configured (report legs `status:'unavailable'` reason not-configured; authority `unconfigured[]` non-empty), append `run \`lumen doctor\` for setup` (one line).
#### Contract files, all in this change
`args.ts` COMMAND_NAMES (9), `help.ts` (both entries), `site/src/data/locked-names.json` `cliCommands` += `init`, `doctor`, `site/src/pages/docs/cli-reference.astro` (two command sections + flags), `packages/cli/src/no-telemetry.test.ts` case array += `['doctor']`, `['init','--yes','--config',<tmp>]` (a temp path via the global --config extraction — init must never write inside the repo during tests; the BYOK sentinel array gains doctor since its output names env vars), `test/contract-counts.test.mjs` command count 7→9, `help` snapshot tests regenerated deliberately.
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

## Amendments (implementation, 2026-09-28)

- AMENDED 2026-09-28 Phase 2 [factual]: doctor's `execute` gained an optional second parameter `providersOverride?: Readonly<Record<string, AnyProvider>>` (test seam replacing the real provider map for `--online` probes; production dispatch passes nothing). The plan's "expose via composition/node.ts" option was not needed — `CommandDeps` fields cannot express a name-keyed map of all 7 builtins, and a CLI-only optional param keeps the blast radius at zero.
- AMENDED 2026-09-28 Phase 1 [cosmetic]: init's fresh-`.gitignore` write no longer emits a leading blank line (addition written as-is when the file did not exist); existing-file appends keep the separating blank line.
- Tests landed: `src/init.test.ts` (14) + `src/doctor.test.ts` (14) + new `src/authority.test.ts` (3) + 2 report hint tests.

## Amendments (post-review, 2026-09-28 — reviewer agent_82af9aef)

- FIXED (reviewer C1, Critical): the FR-3 `authority` hint was unreachable in production — the skip-rule early-return returned before the hint, and with an empty `config.byok` the composition skip rule misses (`effectiveByok` falls back to capability-keyed defaults while `byokReady` looks up provider names), so the provider was wired, failed with `NotConfiguredError` at call time, and rendered as `unavailable` which the hint ignored. Both commands now key the hint on the typed outcome: hint fires on `unconfigured[]`/unwired legs OR any `NotConfiguredError` failure, human output only. Covered by new `src/authority.test.ts` + report hint tests. The `effectiveByok` fallback-map mismatch itself is recorded as a hygiene note in the master ledger (pre-existing seam; honest degradation either way).
- FIXED (I1): zero hint coverage → report/authority hint tests (human present, `--json` absent) added.
- FIXED (I2): plan-demanded non-writable-dir edge — init now types missing dir AND non-writable dir (accessSync W_OK) as `UsageError` before any write; tests added (chmod case root-skipped).
- FIXED (M1): doctor distinguishes a missing config file (`no config file — defaults in effect`; JSON `config.exists: false`) from a present valid one.
- FIXED (M2/M3/M5/M7): vacuous BIN assertion replaced with a real one; printed mcp-add line asserted as exact `onboardPayload('claude')` equality; cli-reference prose no longer claims init/doctor are MCP faces; init joined the BYOK sentinel array (E0.4 AC letter).
- AMENDED (M4, factual): the pinned ddg probe input "keyword + domain" is infeasible through the typed boundary (`SearchOpts` has no domain field) — probe is keyword-only.
- AMENDED (M6, factual): test counts are 14 init + 14 doctor (24 new-command tests) plus 3 authority + 2 report hint tests.

## References

- PRD §6 E0.4 (FR-1..FR-4, AC), §10 D2 (not touched)
- Research: `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md` Seam 3
- Conventions: `cmd/config-show.ts`, `cmd/rank.ts` flag consts, `write-atomic.ts`, `spawn.ts`

## Amendments (pre-implementation, from PLAN_B2_VALIDATION 2026-09-28)

- AMENDED 2026-09-28 Phase 1-3 [factual, validator findings F1-F5]: init's `byok` map keyed by provider names via `BYOK_ENV_VARS` (capability keys would fail registry validation) with a registry round-trip oracle; doctor status derivation via `resolveEnvVar` + env presence (NOT `byokReady`, which reports ready on clean machines); 3 signup URLs pinned; `run.ts` dispatch cases added to the Changes lists; engines read from the shipped cli package.json (`>=22.7`) with a recomputed `satisfies` test.
- Nit decisions folded in: tests flat at `src/init.test.ts`/`src/doctor.test.ts`; no-telemetry init case uses `--config <tmp>`; authority gets the doctor hint; printed mcp-add line = `onboardPayload('claude')`; probe inputs pinned per boundary; "seven commands" prose in README + cli-reference updated to nine in Phase 3.
