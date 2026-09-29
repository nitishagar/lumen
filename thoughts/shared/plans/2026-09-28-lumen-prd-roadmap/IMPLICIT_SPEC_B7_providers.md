# IMPLICIT SPEC — Bundle 7 (E2.1 GSC provider + E2.2 Bing Webmaster + IndexNow)

Source: PRD §6 E2.1 + E2.2 (+§7); research Seam D/providers; tree @ 714dc70.

## What exists (facts)

1. Provider architecture: boundaries in `core/src/providers.ts` (5 closed values + `isProviderBoundary`); provider interfaces (KeywordProvider.ideas / SerpProvider.search / …); providers package has GCRA throttle, InMemoryCache, `with-errors`, redact, mkSource provenance; `createBuiltInProviders(deps)` builds the 7 worker-safe builtins from `ProviderSettings`.
2. Providers package is Worker-SAFE — no `node:` imports. GSC needs `node:crypto` (JWT RS256) + `node:fs` (credential file) → the GSC provider MUST be node-only: a `@lumen-seo/providers/node` subpath factory consumed by the CLI only (mirrors `@lumen-seo/core/node`). NOT in BUILTIN_PROVIDER_NAMES (the Worker can never run it; the 7 stay frozen).
3. BYOK names-not-values: env NAME from config/env; values read at call time. `LUMEN_GSC_CREDENTIALS` holds a PATH (contents never logged/echoed — redact discipline); `LUMEN_BING_KEY` holds the key VALUE (read at call time, never stored).
4. CLI: COMMAND_NAMES = 10 (diff included); dispatch switch; strict parseArgs; help snapshots; locked-names cliCommands; contract-counts derives.
5. `rank` uses SerpProvider; provenance labels source per result. `audit` human output groups by rule (B4); JSON output is the raw report.
6. `indexnow submit` is lumen's FIRST WRITE action: explicit `--yes`, key-file verification (GET `https://<host>/<key>.txt` must return the key), dry run by default, CLI-only (never MCP), bounded url list (--from-sitemap, capped).

## Decisions

- MCP: NO 6th tool (PRD gates `lumen_search_performance` behind an explicit contract change — deferred; recorded).
- GSC auth: service-account JWT (RS256 via node:crypto) → oauth2 token exchange, scope `webmasters.readonly`; 24h token cache; GCRA pacing (600 req/min conservative documented ceiling); 24h response cache.
- `--with-gsc` annotation joins GSC page rows to rule groups by page URL (clicks/impressions in human + JSON output); silently absent when GSC unconfigured (honest: no annotation ≠ no findings).
- rank + GSC: when `LUMEN_GSC_CREDENTIALS` is set AND the boundary resolves, GSC average position for (keyword, domain) is the FIRST-PARTY result (labeled `source: gsc`), ddg-serp is the fallback (labeled); both never run simultaneously for the same check.
- Bing keyword volumes: `source: bing, scope: bing-only` labels ride the KeywordIdea provenance; the label wording mirrors the landing-page honesty rule ("no free Google volume source").
- IndexNow payload: `{host, key, keyLocation, urlList}` POST `https://api.indexnow.org/indexnow`; urls capped 10k; per-host verification GET is SSRF-guarded like any fetch.

## Success criteria

- `lumen performance <site> --json` works against a fixture GSC (in-process fake server for auth+API); credential file contents never appear in output (sentinel test); GSC errors typed (NotConfigured / auth / API).
- `--with-gsc` annotates groups; rank prefers GSC with labeled provenance; ddg fallback labeled.
- `lumen indexnow submit` dry-runs by default (no POST); `--yes` POSTs (fixture server); key-file mismatch refuses with exit 2; MCP tools/list still exactly 5.
- Contracts: COMMAND_NAMES 11, help/locked-names/cli-reference/no-telemetry/indexnow cases, validate green.
