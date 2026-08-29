# RENAMES — lumen (supersedes all naming in every plan/research doc)

User decision 2026-08-29: the product name is **lumen** (repo `nitishagar/lumen`). Every occurrence of the old codename in the plan bundles, IMPLICIT specs, and research doc is superseded by this mapping. Plans keep their historical paths under `thoughts/shared/plans/2026-08-29-seolite-*` (history is history); all NEW code, config, workflows, site content, commits, and docs use the tokens below. In case of conflict: this file > RECONCILIATION.md > ARCHITECTURE.md > aspect plans.

| Old token | New token (authoritative) |
|---|---|
| product name `seolite` | `lumen` |
| repo `nitishagar/seolite` | `nitishagar/lumen` (renamed via API; GitHub redirects old URLs) |
| packages `@seolite/{core,audit,providers,cli,mcp}` | `@lumen-seo/{core,audit,providers,cli,mcp}` (npm scope `@lumen-seo`; unscoped `lumen` package is TAKEN on npm — never publish unscoped `lumen`; fallback if org unavailable at publish: unscoped `lumen-{core,audit,providers,cli,mcp}`) |
| site workspace `@seolite/site` | `@lumen-seo/site` |
| CLI bin `seolite` | `lumen` (users type `lumen …`; `npx @lumen-seo/cli` to run) |
| MCP tool prefix `seolite_*` | `lumen_*` (`lumen_audit_site`, `lumen_page_report`, `lumen_keyword_ideas`, `lumen_rank_check`, `lumen_authority`) |
| env prefix `SEOLITE_*` | `LUMEN_*` (`LUMEN_PSI_KEY`, `LUMEN_CRUX_KEY`, `LUMEN_OPR_KEY`, `LUMEN_CONFIG`, `LUMEN_HISTORY_DIR`) |
| config file `seolite.config.json` | `lumen.config.json` |
| history/state dir `.seolite/` | `.lumen/` |
| User-Agent `seolite/<version> (+repo)` | `lumen/<version> (+https://github.com/nitishagar/lumen)` |
| Pages base `/seolite/` | `/lumen/` (site URL `https://nitishagar.github.io/lumen/`) |
| Worker route/branding strings `seolite` | `lumen` |
| Tagline | **"See your site clearly."** (lumen = unit of light; pairs with the data-honesty ethos) |

Unchanged: all invariants I1–I17, RECONCILIATION R1–R10, payload shapes, severity vocab, budgets, exit codes, merge order, CI gates, Apache-2.0 + attribution duties.
