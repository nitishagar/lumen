# HANDOFF LEDGER — Bundle 1 (v0.3 release train)

Plan: PLAN_B1_release_train.md (validated PASS 2026-09-28; amended twice, factual only).
Scale: medium.

## Position

COMPLETE — all 5 phases implemented, full `npm run validate` green, both reviews PASS.

## Final state

- Phase 1: `test/contract-counts.test.mjs` (6 tests), PR-template CHANGELOG checkbox, CHANGELOG `[Unreleased]` + `[0.3.0]`.
- Phase 2: `OnboardTarget` 4→7 (`mcpb|registry|claude-plugin`), `PRINT_TARGETS` 7, 14 print payload cases, adapted names-only oracle for distribution targets.
- Phase 3: `server.json`, `mcpb/{manifest.json,server.js,README.md}`, `.claude-plugin/marketplace.json`, `plugin-lumen/{.claude-plugin/plugin.json,.mcp.json,skills/seo-check/SKILL.md}`, `mcpName` in cli package.json, `docs/distribution.md` runbook, `test/onboard-artifacts.test.mjs` (shape checks) + payload↔file oracle in `onboard.test.ts` (fs read of server.json).
- Phase 4: `scripts/ci/link-check.mjs` (collectUrls/checkUrl/runCheck/main seams; HEAD→GET on 403/405/501; 1 retry on network errors only; concurrency 5; UA `lumen-link-check/…`), `test/link-check.test.mjs` (12 tests), `.github/workflows/link-check.yml` (weekly cron + dispatch + tags).
- Phase 5: release.yml gains `publish.outputs.skip`, post-publish npm-version drift assertion, `registry` job (mcp-publisher + OIDC, runner-local version substitution), `mcpb` job (@anthropic-ai/mcpb pack + `gh release upload --clobber`); locked-names snippets (mcpbInstall, pluginMarketplaceAdd, pluginInstall); mcp-onboarding page section; cli-reference print targets.

## Decisions

- mcpb bundle delegates to npm via npx launcher (P-Thin, no vendored node_modules).
- Anti-drift payload↔file comparison lives in the mcp TS suite (ci-scripts is dependency-free; cannot import TS) — plan amendment recorded.
- eslint: `scripts/ci/link-check.mjs` added as the second sanctioned `fetch` call site (I16/I17) with rationale; `mcpb/*.js` added to node-globals block.
- Factual amendment: `publish-workspaces.mjs` path filter now excludes nested `node_modules/` entries (pre-existing red at baseline, verified via worktree @ 3ae6113; doc-comment contradiction).

## Hypotheses

- "validate red is my fault" → REFUTED via clean worktree run at 3ae6113 (pre-existing lockfile-entry bug).

## Confusion

- Vitest snapshot regexes/self-contradictory first-draft assertions in my own new tests (fixed before review).

## Open

- Owner-gated: D1 visibility flip, `NODE_AUTH_TOKEN`, first tag run (registry/mcpb jobs), directory submissions, release-prep version-bump PR (docs/distribution.md has the exact steps).
- Reviewer nits (documented, non-blocking): per-file loudness in contract-counts; value-pairing regex misses unquoted values; snippet-internal URLs not collected by the JSON walk.
