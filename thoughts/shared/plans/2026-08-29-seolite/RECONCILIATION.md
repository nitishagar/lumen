# RECONCILIATION — cross-plan authoritative decisions

Where an aspect plan's bounding assumption conflicts with another aspect's, THIS file + ARCHITECTURE.md win. Applied by orchestrator after the six planning agents authored their bundles independently.

| # | Topic | Authoritative decision | Reason |
|---|---|---|---|
| R1 | Severity vocabulary | `error \| warning \| info` (closed, ordered) everywhere | scaffold-core initially said `notice`, audit-engine said `info`; `info` is conventional; patched in scaffold-core PLAN |
| R2 | `failThreshold` default | `"error"` (only error-severity issues gate; `off` disables; opt into `warning`) | surfaces initially `warning`; gating on warnings by default makes the tool noisy out of the box; patched in surfaces PLAN |
| R3 | Crawl budgets (core-owned) | `maxPages 100` (clamp 10k) · `maxDepth 5` · `maxDurationMs 300_000` · `maxConcurrency 5` · `perHostMinDelayMs 250` · core fetch `timeoutMs 10_000` · `retries 2` · `maxRedirects 5` · audit-owned: `maxBodyBytes 2_000_000`, `latencyThresholdMs 1_500`, evidence cap 10, sitemap caps 10k URLs / 10 children / 2 MiB | single owner = core config; audit + surfaces plumb; patched in audit-engine + surfaces PLANs |
| R4 | Site workspace name | npm workspace `@seolite/site` at path `site/`; commands `npm run build -w @seolite/site`, `npm run check -w @seolite/site`; output `site/dist/`, base path `/seolite/` | ci-deploy assumed `@seolite/site`, site-docs used `-w site`; patched in site-docs PLAN |
| R5 | BYOK env var names | `SEOLITE_PSI_KEY`, `SEOLITE_CRUX_KEY`, `SEOLITE_OPR_KEY` (scheme `SEOLITE_<PROVIDER>_KEY`); config stores env-var NAMES only | site-docs already documented these; providers implements the same scheme |
| R6 | M0 merge order | scaffold-core scaffold (workspace + scripts) → ci-deploy P6a (bootstrap CI + branch protection) → scaffold-core core package code | ci-deploy's bootstrap contingency keeps this order unblocking |
| R7 | Worker safety | `createWorkerSafeProviders` excludes cheerio-based `ddg-serp`; Worker never parses HTML; `WORKER_ENABLE_PSI` default true with 2.5 MB response cap + kill-switch | providers BA9 + surfaces B10 aligned |
| R8 | MCP tool `maxPages` | no tool-level default; core config default applies (removes duplicate 50) | surfaces patch |
| R9 | History root | `./.seolite/history` (override `SEOLITE_HISTORY_DIR`), JSONL, 1 MiB rotate, slugified-ASCII domain dirname + sha256:8 suffix | surfaces owns implementation |
| R10 | npm publishing | publish-on-tag (v0.1.0) gated on `NODE_AUTH_TOKEN` secret; E409 treated as idempotent success; no publish in normal CI | ci-deploy decision stands |
