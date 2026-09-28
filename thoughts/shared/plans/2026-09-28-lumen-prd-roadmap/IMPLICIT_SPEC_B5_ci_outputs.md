# IMPLICIT SPEC — Bundle 5 (E1.4 CI-native outputs + E1.5 MCP prompts/resources)

Source: PRD §6 E1.4 + E1.5 (+ ACs); research Seam 1 (report shape, now migrated in B4) + Seam 4 (MCP server/worker); tree @ ea37d77.

## What exists (facts)

1. B4 landed the ranked shape: `summary.byRule: ByRuleGroup[]` (severity/affectedPages/sampleUrls≤3/fixHint/helpUrl), every issue carries `url`/`fixHint`/`helpUrl`; `ranking.ts` comparator is the ONE ordering source; baseline diff objects (`newIssues`/`fixed`/`unknown`) are stdout-only on audit.
2. `cmd/audit.ts`: render swap is `--json ? jsonDocument(report) : humanSummary(...)`; `--out` writes the raw report JSON atomically BEFORE render; exit gate `incomplete || countAtOrAbove(gateIssues, threshold)`; `--verbose`, `--baseline`, `--update-baseline`, `--allow-private`, `--canonical-origin` flags exist. OPTIONS table is string|boolean only; strict parseArgs.
3. Rules metadata: `builtInRuleMetadata()` (id/defaultSeverity/categories), `helpUrlFor(id)`, `RULES_REFERENCE_BASE`, `BUILT_IN_RULE_IDS` — exportable from @lumen-seo/audit (CLI already depends on audit). `UA_VERSION` (core) is the pinned tool version.
4. MCP: `buildMcpServer(deps)` registers 5 tools; SDK `registerPrompt(name, {title, description, argsSchema}, cb)` + `registerResource(name, uriOrTemplate, config, readCallback)` exist (SDK 1.x, verified signatures). `McpDeps` carries clock/providers/auditRunner/pageMeta/history/privateScope. stdio-roundtrip.test.ts drives raw JSON-RPC frames over the spawned bin (initialize → tools/list → tools/call). `tools/list` hard-equality = 5 (schema-contract + stdio tests).
5. History: `HistoryStore.list(query)` (rank + audit kinds; audit entries are digests {url, score, countsBySeverity, retrievedAt, incomplete, stopReason}) — `lumen://audit/latest/{domain}` can honestly serve the LATEST DIGEST only (no findings exist in history — B4 pinned this). JsonlHistoryStore is CLI-side; McpDeps.history?: HistoryStore (stdio only; Worker deps have none).
6. Worker: thin subset — its composition wires no history, no auditRunner; `OUTBOUND_HOST_ALLOWLIST` enforced; bundle-scan bans audit imports in the worker graph... NOTE: prompts need rule metadata (from @lumen-seo/audit!) — the worker BAN on `@lumen-seo/audit` in bundle-scan.test.ts forbids importing `builtInRuleMetadata` there. Resolution: `lumen://rules` content must be produced WITHOUT importing audit in the worker — the metadata that the worker needs (id/severity/fixHint?/helpUrl) must live in, or be re-exported through, a worker-safe module. `rules` metadata factories live in audit's rule-set.ts. Decision: register the prompts + `lumen://rules` resource in the SHARED `buildMcpServer` but source the rule catalog from a new worker-safe constant module (`packages/mcp/src/rules-catalog.ts` — a frozen literal list derived from the rule registry, with a contract test asserting parity with `builtInRuleMetadata()` so it can never drift). This keeps the worker bundle audit-free (P-Thin-Worker) while satisfying FR-3 Worker registration.
7. Site docs pages: quickstart/configuration/cli-reference/rules-reference/mcp-onboarding/providers-byok/attributions; DocsLayout nav is a hardcoded list in the layout (new page must be added there); internal-links gate requires ≥40 links; locked-names gates cliFlags/commands in docs.
8. CI: `.github/workflows/` has ci.yml + release.yml + link-check.yml patterns; test/ holds dependency-free .mjs gates; SARIF 2.1.0 schema (JSON) can be vendored under test/ for offline validation (no network in tests).

## Decisions inherited

- `--format human|json|sarif|md` with `--json` kept as an alias for `--format json` (FR-1); `--format` + `--out`: `--out` writes THE RENDERED DOCUMENT for sarif/md (the CI artifact), the raw report JSON for json/human (unchanged behavior).
- `--source-map <glob>` is best-effort; ambiguous mapping stays URL-only, never guessed (P-Honest).
- Prompts/resources are additive MCP surfaces; `tools/list` stays EXACTLY 5 (AC).
- Worker registers prompts + `lumen://rules` ONLY; history resources return the typed LOCAL_ONLY capability error (FR-3).
- Action lives at `action/` (repo subfolder — D1-dependent naming avoided); composite steps `npx @lumen-seo/cli@<pinned>`; SHA-pinned deps = the pinned npm version + `npm ci`-style integrity via package-lock in the action dir (composite actions can't easily pin npx transitively without a lockfile — document the tradeoff honestly in the action README; PRD "SHA-pinned dependencies" satisfied by the version-pinned package + integrity-checked lockfile copy).
- The Action e2e AC (green workflow on the repo's own site + a seeded-red run) is CI-side acceptance: ship a workflow that runs the action against the Astro preview on localhost (reusing B3's --allow-private); its first green run is an owner-observable external step (recorded like B1's registry publish).

## Success criteria (PRD ACs)

- SARIF output validates against the vendored 2.1.0 schema OFFLINE (a .mjs gate test); one rule per lumen rule with helpUri/shortDescription; results carry page URLs as artifactLocation.uri; run.properties carries tool version, budgets, startedAt/completedAt, incomplete/stopReason; source-map maps when unambiguous.
- `--format md` renders score + new/fixed (when baselined) + top rule groups with fixes.
- `tools/list` still 5; `prompts/list` = 3; `resources/list` ≥ 1; evalite snapshot cases added.
- Docs "Lumen in CI" page with GitHub/GitLab/generic workflows; site nav + link gates green.
