<!-- SIGNPOST | 1/5: SPEC | requirements only, no designs | Next: PLAN_B1_release_train.md
     Pipeline: SPEC -> PLAN -> PLAN_VALIDATION -> implement+review -> tests+TEST_VALIDATION -> green -->
# IMPLICIT SPEC — Bundle 1: v0.3 release train (E0.1 + E0.2 + E0.3 + hygiene-P0)

> Requirements only. Source: PRD `thoughts/shared/specs/2026-09-28-lumen-next-features-prd.md` §6 E0.1–E0.3, §8 P0 rows; research doc `thoughts/shared/research/2026-09-28-lumen-prd-roadmap.md` (ledger). Scale: medium.

## Scope

Code-side realization of the v0.3 release train: link-integrity check (E0.1 FR-2), CHANGELOG 0.3.0 + release runbook (E0.2), MCP Registry `server.json` + `.mcpb` + Claude Code plugin + new `lumen mcp --print` targets + directory-listing runbook (E0.3), CHANGELOG discipline + README↔registry drift gate (hygiene P0). Repo visibility flip, npm publish, and directory submissions are **external owner actions** — this bundle prepares everything they need and must not silently depend on them.

## Invariants (must hold)

- **I1 Locked contract moves together** — new `mcp --print` targets extend the `OnboardTarget` union, `PRINT_TARGETS`, the print-payload tests, and (where surfaced in site) `locked-names.json` snippets in the same change; the tools/schema/snapshot contract is untouched (`stdio-roundtrip.test.ts:134-143`, `schema-contract.test.ts`, `site/tests/locked-names.test.ts:30-48`).
- **I2 P-BYOK in manifests** — `server.json`, the mcpb manifest, and the plugin config declare env-var *names* with `isSecret`/`sensitive` flags, never values; the `never-embeds-key` test pattern covers new payloads (`onboard.test.ts`).
- **I3 Skip-cleanly release semantics** — new release jobs follow the existing guard pattern: absent external prerequisites (npm token, prior job skip) produce a skipped/notice job, never a red release run (`release.yml:44-54` pattern); nothing commits to the repository from runners (version substitution is runner-local, like `publish-workspaces.mjs:169-174`).
- **I4 Claimed counts equal shipped counts** — any prose count of rules/commands/tools in README, docs pages, and CHANGELOG must equal the registries in code (`BUILT_IN_RULE_IDS`, `COMMAND_NAMES`, `TOOL_NAMES`); a gate exists so drift fails CI (PRD hygiene row 2, P-Honest applies to marketing).
- **I5 Link checker is scheduled-only** — it never joins the per-PR offline gate (PRD E0.1 FR-2); it is polite (bounded concurrency, identifying UA, per-attempt timeout, HEAD→GET fallback) and fails on non-2xx of extracted URLs from root README, package READMEs, `locked-names.json` URLs, and the SECURITY advisory URL.
- **I6 Registry package validation** — npm `@lumen-seo/cli` carries `mcpName: io.github.nitishagar/lumen` matching `server.json` `name`; `server.json` version is substituted from the tag runner-local at publish so the committed file is not a version lie between releases.
- **I7 CHANGELOG discipline** — a maintained `[Unreleased]` section exists; the `[0.3.0]` section records exactly what PR #37 plus this bundle ship; the PR template gains a CHANGELOG checkbox (PRD hygiene row 1).
- **I8 Site gates stay green** — internal-links ≥40, byte-exact snippets, attribution hrefs, `/lumen/` base (`site/tests/*`); new snippets/pages satisfy the gates rather than weakening them.

## Failure/partial edges

- Link check on a private repo: docs/repo URLs 404 until D1 (visibility flip) — the checker must fail honestly then; its workflow going green is the D1 acceptance signal (documented in the runbook), not a reason to add exclusions.
- Registry/mcpb publish before npm publish must be impossible (job dependency, not convention): registry validation requires the npm package at the same version.
- Duplicate publish reruns stay idempotent (existing 403/409 semantics) — new jobs must be rerunnable without side effects (release upload with `--clobber` semantics or existence check).

## Bounding assumptions (confirmed against PRD)

- The PRD's decision D2 (`topRules`) is NOT touched by this bundle (no MCP payload change here).
- External gates (npm token, visibility flip, directory accounts) are owner actions; acceptance criteria that require them are marked owner-gated in the plan.
- The mcpb bundle shells out to `npx -y @lumen-seo/cli mcp` (P-Thin: no vendored node_modules snapshot in the bundle) — keys entered in Claude Desktop reach lumen as env vars per mcpb `user_config`.
- `manifest_version "0.3"` and registry schema `2025-12-11` are the pinned external shapes (fetched from official docs 2026-09-28).

## Intent open questions → closure

| Question | Closure |
|---|---|
| npm credentials for E0.2 publish | External ask (ledger); plan prepares everything + runbook |
| D1 repo visibility flip | External ask (ledger); link-check green is the acceptance signal |
| Directory listings (Glama/Smithery) | External ask; runbook documents exact steps |
| Tag v0.3.0 now or owner does it | Owner-gated; runbook documents the single tag push |
| mcpb/registry/plugin install text surfaced on site | Answered in plan Phase 5 (locked-names snippets) |
