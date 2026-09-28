# HANDOFF LEDGER — Bundle 5 (E1.4 CI outputs + E1.5 MCP prompts/resources)

Plan: PLAN_B5_ci_outputs.md — validator agent_a6995f9e PASS-with-amendments (1C+6I+8M, ALL folded).
Scale: medium.

## Position

- Phase 1 (renderers + format flag): DONE — render/sarif+markdown+source-map (pure), --format/--source-map flags, --out writes rendered artifact for sarif/md (stdout silent), --json alias conflict is a UsageError.
- Phase 2 (MCP): DONE — 3 prompts (deterministic instructions over the 5 tools), lumen://rules static resource (worker-safe RULES_CATALOG, parity-gated incl. fixHints), history TEMPLATE resources (stdio: latest digest/rank entries; worker/none: LOCAL_ONLY payload inside a successful read), tools/list STILL 5.
- Phase 3 (Action/docs/gate): DONE — action/ composite (loopback implies --allow-private; 2-run render design), lumen-action-e2e workflow (green PR path + seed_regression dispatch red path with outcome assertion), vendored sarif-2.1.0 schema + zero-dep validator (anyOf/oneOf/$ref) gate, docs/ci page + nav + sitemap, locked-names/cli-reference/snapshots.
- Validate: GREEN — 101 files / 1103 tests + cli-smoke; evals 16/16.

## Decisions

- Action implies --allow-private on loopback URL hostname (C1) — e2e workflow backgrounds astro preview itself.
- History resources = templates without listCallback (templates-list visibility only, both transports; SDK behavior).
- LOCAL_ONLY resource read = 200-result carrying the JSON payload (not CallToolResult-shaped, not a throw).
- SARIF validator: hand-rolled, anyOf/oneOf + local $ref, zero deps.
- Catalog fixHints pinned by instantiating rules on the test side.
- source-map: exact / path.* / path/index.* over {astro,html,md,mdx}; exactly-one wins.
- Cancelled sarif run writes partial rendered SARIF (--out precedes cancelled check), stdout silent.
- targetScope in run.properties from configSnapshot.target?.scope.

## Hypotheses

(none yet)

## Confusion

(none yet)

## Open

- CI-side acceptance (owner-observable): first green run of lumen-action-e2e on a PR; seeded-red dispatch run.

## Review

- Implementation review: agent_a62e2e1a — FAIL (3C: workflow ./.action path nonexistent, audit/latest served the OLDEST entry, seeded-red regex was a no-op; 6I incl. z.number rejecting string prompt args, untested format dispatch, unwired codeql upload; 8M) → ALL fixed → validate re-green 103 files / 1112 tests.
