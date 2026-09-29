# IMPLICIT SPEC — Bundle 8 (E2.3 trends/reports + E2.4 plugins + E2.5 gateway + hygiene tail)

Source: PRD §6 E2.3/E2.4/E2.5 + §8 hygiene table; tree @ d0628ad.

## Facts

1. History: `rank --history --kind rank|audit --format json|csv --domain --limit` exists (cmd/rank.ts); JsonlHistoryStore does single `.1` rotation; `HistoryStore` port LOCKED `{append, list}`; `HistoryListQuery {kind?, keyword?, domain?, url?, limit?}` (no `since`); rotation constant in jsonl-store.
2. Audit formats: human|json|sarif|md via `--format` (+`--out`); renderers live in cli/src/render/.
3. Worker: rest.ts (GET health + POST /mcp), cors.ts (`*`), no auth; OUTBOUND_HOST_ALLOWLIST enforced; bundle-scan guards.
4. `@lumen-seo/audit` package.json exports only `.`; `src/testing/` has FakeFetcher/makeTestDeps/makePage (the E2.4 gap from research).
5. Hygiene state: CHANGELOG/PR-template done (B1); evals/.last-run.json NOT gitignored; redactUrl masks 6 params; Actions pinned by tag (@v4), not SHA; no live canary; swarm runs via evalite (check gating); versions 0.0.0-at-source (release rewrites).
6. Plugin rules: `config.extraRules` (AuditRule SPI; page kind only in core's SPI — audit added SiteRule/CrawlRule locally); plugins are Node-only local files loaded by core's loader.

## Decisions

- `lumen history <audit|rank>` is the 13th command; old `rank --history` flags STAY (deprecated note printed once per use).
- `--since` filters client-side (ISO date); `--format html` for AUDIT renders one self-contained static HTML (inline CSS, no external requests, attributions footer, provenance per metric/group) — consultants send the file.
- HistoryStore port grows an OPTIONAL `prune?(query, keepGenerations)` method (additive — the LOCKED shape stays for existing callers); `history.maxGenerations` config key (default 2 = current + .1) drives rotation + `lumen history prune` (CLI-only writes).
- E2.4: `@lumen-seo/audit/testing` subpath export + a plugins docs page (authoring guide: rule shape, kinds, fixHint/helpUrl expectations, severityOverrides, testing kit) + `packages/plugin-render` (Playwright PEER dep, optional import, rendered-evidence Provenance label, tests skip without playwright). `lumen-plugin-template` repo = external owner step (recorded).
- E2.5: `WORKER_AUTH_TOKEN` (bearer; 401 typed when set+missing/wrong, off when unset) + `WORKER_ALLOWED_ORIGINS` (comma list; reflect-only-those; `*` remains the documented default when unset).
- Hygiene: gitignore evals/.last-run.json; redactUrl += signature/sig/secret/sign/client_secret/userinfo; SHA-pin the third-party Actions used in workflows (fetch current SHAs via gh); weekly gray-canary workflow + scripts/ci/gray-canary.mjs (one live call each to google-suggest + ddg-serp; parse/blocked drift → exit 1 → workflow opens an issue); swarm threshold: swarm.eval joins the gated test:evals threshold (verify + wire); changesets: DEFERRED with a recorded decision (0.0.0-at-source is release-rewritten; adopting changesets is an owner workflow choice).

## Success criteria

- `lumen history audit --domain x --since ISO --json|csv` works; prune honors maxGenerations; `rank --history` still works with a deprecation note.
- `audit --format html --out r.html` produces ONE file: inline CSS only, attributions footer, per-group provenance, opens standalone.
- `/mcp` with WORKER_AUTH_TOKEN set rejects missing/wrong bearer (401) and passes right; CORS reflects only allowlisted origins when set.
- `@lumen-seo/audit/testing` importable from the workspace; plugin-render typechecks without playwright installed (peer-optional) and skips tests when absent.
- Hygiene rows green: gitignore, redaction cases, SHA-pinned actions (diff-visible), canary workflow file + script, swarm gating.
- validate green; contracts (commands 13, help, locked-names, cli-reference, no-telemetry history case) move together.
