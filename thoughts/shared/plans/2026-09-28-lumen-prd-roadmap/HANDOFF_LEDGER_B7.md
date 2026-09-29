# HANDOFF LEDGER — Bundle 7 (E2.1 GSC + E2.2 Bing/IndexNow)

Plan: PLAN_B7_providers.md — validator agent_e00e4b1c FAIL → 2C+7I+6M folded (KeywordIdea.volume; BYOK_ENV_VARS bing; indexnow positional rule; token expires_in; full-URL-set annotation sums; bing unexposed-in-worker; providers entry-isolation test; no-telemetry seams; M10-M15 checklist).
Scale: large.

## Position

- Phase 1 (boundary + GSC node provider): DONE — core types + registry guard; node-gsc.ts (JWT RS256, expires_in token cache, 24h response cache, GCRA 600/min, path-only errors); providers entry-isolation test; ./node subpath export.
- Phase 2 (CLI): DONE — performance cmd (deps seam), --with-gsc (full-URL-set sums, stdout-only, unconfigured stderr note), rank GSC-preferred (labeled first-party, never double-spends).
- Phase 3 (bing + indexnow): DONE — bing-webmaster provider (LUMEN_BING_KEY, volume + scope labels, worker-bundled-unexposed), indexnow submit (dry-run default, --yes, key verification, --from-sitemap, cap 10k), contracts (commands 12, locked-names, cli-reference rows, providers-byok rows + BYOK copy, landing honesty copy, README counts, CHANGELOG, help snapshots, doctor/config count tests).
- Validate: GREEN — 107 files / 1148 tests + cli-smoke; gsc-bing.test (6) + entry-isolation (3) + providers-commands.test (11).

## Decisions

- SearchPerformanceReport.rows[].source = Provenance object; POST for searchAnalytics; pacing constants in node-gsc.ts.
- Token cache honors expires_in (refresh 60s early); response cache 24h.
- Bing: worker-bundled-but-unexposed v1 (no allowlist/plumbing; recorded).
- --with-gsc annotations stdout-only; sums over the full affected-URL set.
- Distribution artifacts defer the new env names (MCP doesn't expose them).

## Hypotheses

(none yet)

## Confusion

(none yet)

## Open

- OWNER-GATED external acceptance: the Bing GetKeywordData endpoint + param shape verified against a live LUMEN_BING_KEY account (recorded I3); GSC against a real service account.

## Review

- Implementation review: agent_49103841 — FAIL (1C: bing key leak via error URL; 8I incl. dead GSC token cache, JSON.parse content leak, wrong bing endpoint, sc-domain rewrite, rank hard-fail, invisible volumes, no-op isolation gate; 10M) → ALL fixed + hardening tests → validate re-green 107 files / 1158 tests.
