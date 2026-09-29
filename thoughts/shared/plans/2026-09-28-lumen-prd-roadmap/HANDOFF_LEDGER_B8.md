# HANDOFF LEDGER — Bundle 8 (E2.3 + E2.4 + E2.5 + hygiene tail)

Plan: PLAN_B8_tail.md — validator agent_1303da3e PASS-with-amendments (7I + 8M folded).
Scale: large.

## Position

- Phase 1: DONE — history cmd (13th; --since ordering, csv via shared csv.ts, prune through the optional port method), maxGenerations as a NEW top-level history key (loader/vocab/DEFAULT/config-show/locked-names/configuration docs/composition plumb), N-generation rotation preserving maxG=2 behavior, audit --format html (escapeHtml + safeHref + hostile-fixture test, attributions footer, zero scripts/external requests), monitoring recipe in ci docs, rank --history deprecation note (stderr).
- Phase 2: DONE — @lumen-seo/audit/testing export + barrel; docs/plugins guide + nav + sitemap; plugin-render package (peer-optional playwright + ambient shim, publish-convention files, vitest project, tests skip w/o the peer).
- Phase 3: DONE — WORKER_AUTH_TOKEN (constant-time bearer; OPTIONS + /healthz exempt; RestErrorCode UNAUTHORIZED; Env + wrangler notes) + WORKER_ALLOWED_ORIGINS (reflect-only, Vary; * default); mcp-onboarding docs.
- Phase 4: DONE — redactUrl deepened (+6 params, userinfo); ALL third-party Actions SHA-pinned (8 actions, v4+v7 majors, fetched via gh); gray-canary gated vitest file (LIVE-VERIFIED green 2026-09-29) + weekly workflow (issues: write, gh issue create); test:swarm gated at --threshold 100 + evals.yml continue-on-error dropped; evals.md judge-deferral note; CHANGELOG entries.
- Validate: GREEN — 109 files / 1179 tests + cli-smoke (1 skipped = the gated live canary).

## Decisions

- history = NEW top-level config key (full 4+ site enumeration per I4).
- renderer:rendered label for plugin-render (no core enum change, M4).
- plugin-render meets the publish convention (I7).
- judge row + template repo = owner-gated (recorded).
- swarm: test:swarm --threshold 100, continue-on-error dropped.

## Open

- OWNER-GATED (recorded): live LLM-judge first run + docs/evals.md result; lumen-plugin-template repo publication; the canary's first weekly CI run.

## Review

- Implementation review: agent_11c4d4e5 — FAIL (2C: lockfile never regenerated — every `npm ci` workflow would break; plugin-render reports labeled 'static' contradicting every doc claim; 4I: phantom prune counts, swarm gating not wired in CI despite the ledger claim, bearer length-timing oracle, manifest/config-show gaps; 4M) → ALL fixed (lockfile committed; renderer:'rendered' + fake-launcher test; prune asserts disk; CI job truly gated; unconditional hashing; files+license+human output; limit guard; honest docs/comments) → validate re-green 109 files / 1179 tests.
