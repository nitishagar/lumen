<!-- SIGNPOST | 1/5: SPEC | requirements only, no designs | Next: PLAN_B2_first_run.md
     Pipeline: SPEC -> PLAN -> PLAN_VALIDATION -> implement+review -> tests+TEST_VALIDATION -> green -->
# IMPLICIT SPEC — Bundle 2: First-run `lumen init` + `lumen doctor` (E0.4)

> Requirements only. Source: PRD §6 E0.4; research doc Seam 3 + Implicit Spec. Scale: medium.

## Scope

Two new CLI commands (7→9) + not-configured hints on `report`/`authority` + all contract gates (COMMAND_NAMES, help, locked-names `cliCommands`, site cli-reference, no-telemetry case arrays). External signup pages are linked by name+URL; no secrets anywhere.

## Invariants (must hold)

- **I1 Contract gates move together** — `COMMAND_NAMES` 7→9 updates: `help.ts` ROOT_USAGE + `USAGE_BY_COMMAND` entries, locked-names `cliCommands` (site byte/tool gates), `site` cli-reference page, no-telemetry CLI case array, existing count assertions (`test/contract-counts.test.mjs` from Bundle 1 counts commands).
- **I2 P-BYOK / P-NoTelemetry** — `init` never writes or prints a secret value (writes env-var *names* only); `doctor` prints set/unset + names + signup URLs, never values; the BYOK sentinel tests extend to both commands; `doctor --online` reaches only *configured* providers through the existing provider path (one paced call each, cache reused) — nothing else outbound; plain `doctor` makes zero network calls.
- **I3 Honesty of statuses** — each provider reports exactly one of `ready | not-configured (with the env var name to set + signup URL) | disabled`; unconfigured is never an error; `doctor` exit is 0 when everything *configured* is healthy and 2 only when a configured provider is broken (or the config file itself is invalid); `--online` probes report typed provider failures, never stack traces.
- **I4 Idempotent init** — never overwrites an existing `lumen.config.json` without `--force`; `.gitignore` append is deduped (no duplicate `.lumen/` lines) and only when a git repo is detected; writes are atomic-adjacent (temp+rename) so a crash cannot leave a half file; exit 2 on refusal, 0 on success.
- **I5 Existing behaviors unchanged** — `report`/`authority` payloads (JSON shape) unchanged; the hint is human-output-only (one trailing line when a leg/provider is not-configured); config resolution precedence (flag > `LUMEN_CONFIG` > cwd) untouched.
- **I6 Node/engines check is honest** — doctor reports the running Node version and the engines requirement and labels satisfaction, derived from the workspace's declared engines (no hardcoded version list duplicated).

## Failure/partial edges

- `init` in a non-writable directory → typed error exit 2, no partial file (temp+rename).
- `init` with existing config and no `--force` → exit 2 with the existing path named (no silent merge).
- `doctor` with invalid config JSON → config section shows invalid + the parse error, exit 2; providers section still renders from defaults where safe.
- `doctor --online` where a provider throws (network/parse/quota) → that provider shows broken with its typed reason; other providers still probed (partial failure does not abort the loop).
- SIGINT during `doctor --online` → cancelled, exit 2, no partial output contract violation.

## Bounding assumptions

- "Commented-equivalent config" is realized as valid `lumen.config.json` (defaults + `byok` name map) — the loader rejects unknown keys, so comments inside JSON are not possible without a loader change; the explanation is printed to stdout next to the write (PRD intent preserved: the user learns what each key does).
- Signup URLs pinned in code as constants (PSI + CrUX via Google Cloud console API-library pages; OPR via openpagerank.com) and surfaced in doctor/init/locked-names — no values, no tracking params.
- Probe target URL is a fixed, documented public page (e.g. `https://example.com`) — one call per configured provider, through its existing pacer + cache.

## Intent open questions → closure

| Question | Closure |
|---|---|
| Exact signup URLs for the 3 keys | Pinned constants in plan Phase 1 |
| What "configured" means for keyless builtins (suggest/wiki/tranco/ddg) | Plan Phase 1: same effective set `availableProviders` resolves; keyless ones are `ready` without keys |
| Does `init` need to handle monorepo/nested gitignore | No — cwd-level `.gitignore` only, documented in help |
