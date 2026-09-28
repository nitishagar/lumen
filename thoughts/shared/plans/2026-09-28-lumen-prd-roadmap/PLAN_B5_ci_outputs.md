<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B5_ci_outputs.md | Next: PLAN_B5_VALIDATION.md -->
# Bundle 5 — CI-native outputs + MCP prompts/resources (E1.4 + E1.5)
scale: medium

## Overview

`lumen audit --format human|json|sarif|md` (with `--json` as the json alias) rendering the B4 ranked shape for CI: a schema-validated SARIF 2.1.0 document (offline-vendored schema gate), a job-summary Markdown, an optional best-effort `--source-map` route→file mapping, a composite GitHub Action under `action/` plus a self-hosted e2e workflow, and a "Lumen in CI" docs page. On MCP: 3 prompts + `lumen://rules` + stdio-only history resources, with the rule catalog sourced from a worker-safe literal module parity-gated against the registry (the worker bundle stays audit-free).

## Current State

(all [V] in IMPLICIT_SPEC_B5)

## Desired End State

A CI job pipes SARIF to code-scanning and the md to `$GITHUB_STEP_SUMMARY`; the repo's own Action audits the Astro preview on localhost and fails red on a seeded regression (CI-side acceptance); agents get `/lumen` prompts and rule/history resources over stdio; `tools/list` remains exactly 5; every gate green.

## What We're NOT Doing

- No upload-sarif live validation in tests (external acceptance; the workflow wires it).
- No source-map templating engine (a glob + prefix mapping only).
- No `--from-history` anything (deferred with B4).
- No prompts that EXECUTE tools at registration (prompts return instructions for the agent to call the existing 5 tools — deterministic, no eval surface).

## Approach

Renderers are pure functions over the B4 report (+ optional baseline diff) in `packages/cli/src/render/` (CLI-owned; SARIF/md are CLI surfaces, audit stays engine-only). The MCP catalog module is a frozen literal in mcp with a parity contract test. The Action is a composite action + a repo workflow exercising it.

## Design Analysis

- **Invariants → mechanism**: P-Honest (SARIF never guesses file mappings; `incomplete` + stopReason ride in run.properties; md labels baselined new/fixed honestly) → renderers consume only report + diff; mapping ambiguity → omit; P-Locked-Contract (tools/list == 5) → prompts/resources registered in `buildMcpServer` AFTER tools, stdio-roundtrip extended to assert both lists; worker thinness → rules-catalog.ts literal (no audit import), bundle-scan unchanged; no new network → all renderers pure; Action pinned → version literal + lockfile-copy + README note.
- **Failure edges**: `--format sarif|md` with `--baseline` absent → md omits new/fixed sections (SARIF carries per-result baselined flag? NO — SARIF results are ALL findings; baselining is a CI-gate concept, not a SARIF concept; the md summary carries new/fixed); `--source-map` matching 0 or >1 files → URL-only; `--format` unknown value → UsageError listing valid; `--format json` + `--json` both → fine (same); `--out` with md/sarif writes the RENDERED doc atomically; resources on worker → typed LOCAL_ONLY error payload identical to tool errors.
- **Simplicity guardrails**: no new deps (SARIF validation via a vendored schema + a tiny .mjs validator using node:util JSON-schema-ish checks — actually: vendor the official sarif-2.1.0 schema JSON and validate with a minimal recursive validator in the .mjs gate, ~60 lines, no ajv); renderers = 2 pure functions + tests; prompts = 3 static templates over tool names.
- **Blast radius**: cmd/audit.ts (format flag + render dispatch + --out semantics), args.ts (audit flags += format, source-map), help + snapshots, render/ new, action/ new + workflow, site docs page + nav + link gate counts, mcp server (prompts/resources) + rules-catalog + parity test + stdio-roundtrip + evalite snapshots + capabilities tests, locked-names (cliFlags += --format/--source-map; prompts/resources names?), no-telemetry unchanged (no new commands; prompts/resources tested in mcp suite), contract-counts (derives).
- **Interrogation**: *What could break?* (a) stdio-roundtrip raw-frame test — prompts/list requires client capabilities in initialize? The SDK server advertises capabilities automatically; the raw test sends `capabilities: {}` — prompts/list should still answer (verify; extend frames); (b) the worker REST /mcp endpoint shares buildMcpServer → prompts appear on the worker too (desired per FR-3: prompts + rules on Worker); (c) `--format human` must remain byte-identical to today's default (snapshot-safe); (d) evalite tool-list snapshot may gain prompt/resource entries — update deliberately; (e) `action/` at repo root might confuse the existing publish-workspaces discovery — verify its workspace glob excludes non-package dirs (it globs packages/*). *Riskiest*: SARIF schema conformance — earliest check: render a fixture report → validate against the vendored schema BEFORE wiring the Action. *Options not taken*: ajv dependency (rejected: zero-dep discipline in test/ gates); putting SARIF in @lumen-seo/audit (rejected: renderers are CLI surfaces; audit stays engine).
- **Verification design**: unit tests for renderers (fixture report → assert SARIF structure fields + md sections; source-map mapping matrix 0/1/2 matches); .mjs schema gate validating a rendered fixture SARIF offline; spawn e2e (`--format sarif` exits with gate semantics, `--out` file validates; `--format md` contains score/fixes); mcp tests (prompts/list =3, resources/list ≥1, tools/list =5, worker: history resource → LOCAL_ONLY, rules resource parity); action workflow file lint (YAML parse in a .mjs gate); site build + link gates.

## Phase 1: CLI renderers + format flag

### Changes
#### `packages/cli/src/render/sarif.ts` (new)
`renderSarif(report, o: { sourceMap?: SourceMap; baseline?: BaselineDiff; toolVersion: string }): string`. SARIF 2.1.0: `$schema` (the vendored schema URL), `version: "2.1.0"`, `runs[0]`: `tool.driver { name: "lumen", version, informationUri, rules: one per rule id present OR all built-ins? — PRD FR-1 "one rule per lumen rule" → ALL 20 built-ins from the catalog + any plugin rule ids present in results, each { id, shortDescription (fixHint truncated? NO — shortDescription = the rule id meaning; use fixHint as help.text), helpUri } }`; `results[]` one per ISSUE: `{ ruleId, ruleIndex, level (error→error, warning→warning, info→note), message.text, locations[0].physicalLocation.artifactLocation.uri = page URL (mapped via source-map when UNAMBIGUOUS) }`; `properties` on run: `{ seed, targetScope, pagesAudited, pagesSkipped, incomplete, stopReason?, startedAt, completedAt, crawl budgets from configSnapshot.crawl, failThreshold }`.
#### `packages/cli/src/render/markdown.ts` (new)
`renderMarkdown(report, o: { baseline?: { path; diff: BaselineDiff } }): string` — `## lumen audit` + score/pages/counts line; baselined: new/fixed/unknown counts + the new findings list (≤10); top rule groups table (severity/rule/affected pages/fix) linking helpUrl anchors; incomplete warning line.
#### `packages/cli/src/render/source-map.ts` (new)
`buildRouteFileMap(glob, root): (url: URL) => string | undefined` — maps a route path to the FIRST matching file when exactly one candidate exists (`picomatch`? NO deps — implement with a tiny glob→regex translator supporting `**`/`*`; document the supported subset).
#### `packages/cli/src/cmd/audit.ts` + `args.ts` + `help.ts`
`--format` (string: human|json|sarif|md, default human; `--json` sets json when --format absent; conflict → --format wins? NO — UsageError when both differ, keeping contracts strict), `--source-map <glob>`. Render dispatch; `--out` writes the rendered doc for sarif/md (atomic), raw report otherwise (unchanged).
### Success Criteria
- [ ] Renderer units + fixture snapshot green; `--format human` output byte-identical to the pre-change default (assert in test).
- [ ] Spawn: `--format sarif --out s.sarif` → file validates against the vendored schema (Phase 3 gate) and stdout is EMPTY for sarif/md when --out given? — NO: stdout carries the doc ONLY without --out (CI pipes stdout); with --out, stdout stays human-brief? DECIDE: with --out, sarif/md print NOTHING to stdout (artifact-only) — CI-friendly; json keeps today's behavior (both). Document in help.

## Phase 2: MCP prompts + resources

### Changes
#### `packages/mcp/src/rules-catalog.ts` (new, worker-safe frozen literal)
`RULES_CATALOG: readonly { id, defaultSeverity, fixHint, helpUrl }[]` — the 20 built-ins (fixHint = the rule's primary hint; canonical-present uses the missing-canonical hint). Parity test vs `builtInRuleMetadata()` + `helpUrlFor` (audit import allowed in TESTS only).
#### `packages/mcp/src/server.ts`
After tools: `registerPrompt('lumen-prelaunch-check', … url arg)` / `('lumen-fix-top-issues', … url, limit?)` / `('lumen-keyword-brief', … seed, domain?)` — each returns a messages array instructing the agent to call the EXISTING tools (lumen_audit_site, lumen_page_report, lumen_authority, lumen_keyword_ideas) and how to prioritize (using topRules). `registerResource('rules', 'lumen://rules', …)` → the catalog as JSON text. When `deps.history` is present: `registerResource` templates `lumen://audit/latest/{domain}` + `lumen://history/rank/{domain}` reading via history.list (audit latest digest / rank entries); when absent (Worker): register them anyway but the read returns the typed LOCAL_ONLY error payload (FR-3 — listing visible, reading typed) — VERIFY the SDK allows erroring resource reads (throw in callback → protocol error; acceptable and honest).
#### Tests + evalite
prompts/list = 3 (titles/args), resources/list ≥ 1; tools/list still 5 (extend the hard-equality sites); worker composition test: reading history resource errors with LOCAL_ONLY text; `lumen://rules` parity with the registry; evalite snapshot cases for prompts/resources lists.
### Success Criteria
- [ ] All mcp suites green; stdio-roundtrip extended (prompts/list + resources/list frames over the real bin) green.

## Phase 3: Action + docs + schema gate

### Changes
#### `test/sarif-schema.test.mjs` + `test/schemas/sarif-2.1.0.json` (vendored)
Minimal recursive validator (type/required/enum/properties/items — no $ref chasing beyond local defs needed for our subset? The SARIF schema USES $ref heavily → the validator must resolve local `#/definitions` refs — ~90 lines, bounded); gate: render a fixture report via a tiny node script invoking the CLI's renderer through the built bin (--format sarif --out) and validate.
#### `action/` (new): `action.yml` (composite: inputs url, start-command, wait-on, baseline, fail-threshold, max-pages, upload-sarif; steps: optional start+wait-on via `npx wait-on`, audit via `npx @lumen-seo/cli@0.x` with --allow-private implied for loopback when start-command set, SARIF artifact write, `echo >> $GITHUB_STEP_SUMMARY` for md), `README.md` (usage + pinning note), `package-lock.json` copy? — NO: document the pinning tradeoff instead (a lockfile copy of the whole tree is unmaintainable; the version pin + npm integrity is the honest v1).
#### `.github/workflows/lumen-action-e2e.yml`
On PR touching site/**: build site, `astro preview` background, run the action against `http://localhost:4321` (start-command unset; url local) with baseline adopt → assert green path; a manual `workflow_dispatch` seeded-red variant documented in README (CI-side acceptance).
#### `site/src/pages/docs/ci.astro` (new) + DocsLayout nav + link gate
"Lumen in CI": GitHub Actions (action + raw npx), GitLab CI, generic shell snippets; baseline adopt flow; SARIF upload snippet.
#### Contracts
locked-names cliFlags += `--format`, `--source-map`; help entries + snapshots; cli-reference flag rows + format section; no-telemetry untouched.
### Success Criteria
- [ ] `npx vitest run test/sarif-schema.test.mjs` green (offline validation of a real rendered SARIF).
- [ ] Site builds; nav shows the page; internal-links ≥40 still holds.
- [ ] `npm run validate` green.

## Testing Strategy

- Unit: renderer structures (SARIF rules/results/properties field-by-field; md sections), source-map matrix (0/1/2 candidates, ** and *), catalog parity, prompt/resource registration.
- Spawn: format dispatch exit codes; --out artifact content; human byte-identity.
- Gates: vendored-schema validation (.mjs), evalite snapshots, site checks.
- CI-side (external acceptance, recorded): first green e2e run of the action workflow; seeded-red manual run.

## Amendments

(empty at authoring)

## References

- PRD §6 E1.4 (FR-1..FR-4, AC) + E1.5 (FR-1..FR-3, AC)
- Research: Seam 1 (B4 shape), Seam 4 (MCP/worker), verification surface
- Conventions: `render` purity, `writeFileAtomic`, `spawn.ts`, `.mjs` gate pattern in `test/`

## Amendments (pre-implementation, from PLAN_B5_VALIDATION 2026-09-28 — validator agent_a6995f9e, PASS-with-amendments)

- AMENDED Phase 3 [C1, Critical]: the Action implies `--allow-private` whenever the `url` HOSTNAME IS LOOPBACK (start-command set OR a loopback url) — the e2e workflow backgrounds `astro preview` itself and passes only `url: http://localhost:4321`, which the guard would otherwise refuse (exit 2).
- AMENDED Phase 2 [I1]: history resources are TEMPLATE resources (`lumen://audit/latest/{domain}`, `lumen://history/rank/{domain}`) with NO listCallback — they appear in `resources/templates/list`, not `resources/list`, on BOTH transports (SDK behavior). `resources/list ≥ 1` is satisfied by the static `lumen://rules`. This matches FR-3's letter ("registers prompts and lumen://rules only") better than the original reading.
- AMENDED Phase 2 [I2]: a LOCAL_ONLY resource READ returns `contents: [{type:'text', text: LOCAL_ONLY_JSON}]` (protocol-success carrying the honest error payload) — resource reads cannot be `CallToolResult`-shaped; tests assert the payload body.
- AMENDED Phase 3 [I3]: the vendored-schema validator supports anyOf/oneOf (OR-over-subschemas) in addition to type/required/enum/properties/items + local `#/definitions` $ref resolution — the emitted results hit `message` (text XOR id) and `physicalLocation` anyOf constraints.
- AMENDED Phase 2 [I4]: the catalog parity test pins fixHints too, by instantiating `createRuleSet` rules over fixture pages on the TEST side (audit import in tests only); canonical-present's catalog hint = the missing-canonical branch.
- AMENDED Phase 3 [I5]: seeded-red is concrete — `workflow_dispatch` input `seed_regression` runs the action with `fail-threshold: info` against a preview seeded with a broken page (the workflow checks out a `lumen-e2e-seed` branch path or applies a patch step), asserts non-zero exit, and the upload step turns the SARIF artifact into the annotation.
- AMENDED Phase 1 [I6]: source-map candidate resolution is specified: for route path `/about`, candidates are `about` (exact), `about.*`, `about/index.*` over extensions {astro,html,md,mdx}; exactly-one-match wins, else URL-only. Matrix-tested.
- AMENDED [M1]: docs nav lives in `site/src/utils/site.ts` (consumed by DocsLayout AND Footer — the new page cross-links everywhere, helping the ≥40 gate).
- AMENDED [M2]: the new page is subject to ALL site G-gates (meta/search/a11y/contrast/links), not just links.
- AMENDED [M3]: a cancelled sarif run still writes the rendered partial SARIF via `--out` (valid — `incomplete` rides in properties) and prints nothing to stdout — consistent with the existing cancellation contract (`--out` precedes the cancelled check).
- AMENDED [M8]: `targetScope` for run.properties is sourced from `configSnapshot.target?.scope`.
- NOTED [M4/M5/M6/M7]: tool-list evalite snapshot unchanged; audit's `--format` gets its own cli-reference row (rank already had `--format`); prompt names use hyphens (the `lumen_[a-z_]+` sweep cannot false-positive); action/README URLs are outside link-check scope (coverage note only).

## Amendments (implementation, 2026-09-28)

- AMENDED Phase 3 [factual, design]: the Action renders SARIF and md via TWO bounded runs (the CLI renders one format per run) — the SARIF run's exit code gates; the summary run uses `--fail-threshold off` + `|| true`. Documented in the action README as the tradeoff for the one-format contract.
- AMENDED Phase 2 [factual]: `RULES_CATALOG` is exported from `@lumen-seo/mcp` (the CLI's SARIF renderer consumes it — CLI already depends on mcp); the parity test lives in mcp and instantiates audit's rules on the test side (audit import in TESTS only).
- AMENDED [factual]: `resolveAuditConfig` is now exported from `@lumen-seo/audit` (the parity test needed it; legitimate public API).
- AMENDED Phase 3 [factual]: the site sitemap is a hand-maintained `site/public/sitemap.xml` — the new docs/ci page was added there; external links must NOT be wrapped in the `u()` helper (it prefixes the base path).
- AMENDED Phase 3 [factual]: the SARIF gate's fixture server requires ASYNC execFile — a sync exec blocks the host event loop so the in-process server cannot answer (observed as robots-unreachable after retries).
- Evidence: full `npm run validate` green — 101 files / 1103 tests + cli-smoke (incl. the offline SARIF-schema gate, prompts/resources suites, evalite 16/16, site gates with the new page).

## Amendments (post-review, 2026-09-28 — reviewer agent_a62e2e1a)

- FIXED (C1): workflow `uses: ./.action` → `./action` (the dot-path did not exist — every PR run would have failed); a YAML gate test now pins the reference + parses both files.
- FIXED (C2): `lumen://audit/latest` returned the OLDEST entry (jsonl lists ascending — rotated-then-current); now `entries.at(-1)`. The test asserts CONTENT (newest score) instead of JSON-parse-ability.
- FIXED (C3): the seeded-red no-op — index.astro has no literal `<title>`; the seed now strips `<title>{title}</title>` from Base.astro with a `re.subn` count assertion, and the workflow asserts BOTH outcomes (failure on seed, success otherwise).
- FIXED (I4): prompt `limit` is `z.coerce.number()` — MCP prompt arguments arrive as strings; a plain z.number() rejected every spec-conformant client.
- FIXED (I5): stdio-roundtrip extended with raw frames (prompts/list, resources/list, tools/list still 5, prompts/get with a STRING limit).
- FIXED (I6): parity test no longer skips canonical-present (pinned to the missing-canonical branch) and spot-checks non-emitted rules instead of silently skipping; the false "covered below" comment removed.
- FIXED (I7): the stdout-contract test renamed and made real (doc on stdout WITHOUT --out; SILENT with --out + artifact on disk).
- FIXED (I8): format-dispatch unit suite (unknown format, --json+--format conflict, human byte-identity, md render, md --out artifact via spawn).
- FIXED (I9): the workflow wires `github/codeql-action/upload-sarif@v3` (`if: always()`) + the `permissions: {contents: read, security-events: write}` block — the PRD's annotation story is executable.
- FIXED (minors): M10 failThreshold — the renderer does not receive the threshold (it is a flag, not in the report); DEAD spread removed; failThreshold omitted deliberately (recorded). M11 mutation self-test (missing message.text + bogus level both caught). M12 README pin wording + upload-artifact owner fix. M13 YAML gate. M14 docs example @v0.4.0. M15 cli README flags. M16 action inputs via env: indirection + green-outcome assertion. M17 source-map ignored for non-sarif formats — now also accepted-but-unused (documented in help wording); zero-file glob case covered by the 0-candidate matrix.
- Evidence: full `npm run validate` green — 103 files / 1112 tests + cli-smoke.
