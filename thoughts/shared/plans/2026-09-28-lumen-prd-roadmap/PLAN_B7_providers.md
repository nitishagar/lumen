<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B7_providers.md | Next: PLAN_B7_VALIDATION.md -->
# Bundle 7 — GSC provider + Bing Webmaster + IndexNow (E2.1 + E2.2)
scale: large

## Overview

First-party data: a node-only GSC provider (`search-performance` boundary: service-account JWT auth, 24h cache, GCRA pacing) behind a new `lumen performance` command, GSC annotations on audits (`--with-gsc`) and GSC-preferred `rank` provenance; Bing keyword volumes under `keywords`; and lumen's first write action `lumen indexnow submit` (dry-run default, `--yes`, key-file verification, CLI-only).

## What We're NOT Doing

- No 6th MCP tool (`lumen_search_performance` deferred — explicit contract change).
- No OAuth installed-app flow UI (`lumen auth gsc` is D4/future; service-account file only).
- No GSC in the Worker (node-only provider; BUILTIN_PROVIDER_NAMES stays 7).

## Phase 1: boundary + GSC node provider

### Changes
#### `packages/core/src/providers.ts`
`PROVIDER_BOUNDARIES` += `'search-performance'`; `interface SearchPerformanceProvider { name: string; performance(site: URL, o: { days: number; by: 'query' | 'page'; signal?: AbortSignal }): Promise<SearchPerformanceReport> }`; `SearchPerformanceReport = { site: string; startDate; endDate; by; rows: readonly { key: string; clicks: number; impressions: number; position: number | null; source: 'gsc'; retrievedAt: string }[] }` (+ mkSource-style attribution note). Payloads documented as first-party.
#### `packages/providers/package.json` + `node-gsc.ts` (new, node subpath export `./node`)
`createGscProvider(o: { credentialsPath: string; fetcher: Fetcher; cache; pacer; clock; env }): SearchPerformanceProvider`:
- reads the credential FILE at call time (`readFileSync`), parses service-account JSON `{client_email, private_key}`; contents NEVER logged (redact discipline — errors name the PATH only);
- JWT: header/claim RS256 via `node:crypto.createSign`, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, scope `https://www.googleapis.com/auth/webmasters.readonly`; token cached 24h (or exp-based);
- API: `GET https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` POST with `{startDate, endDate, dimensions: [by], rowLimit: 1000}`; site URL encoded `sc-domain:` handling for domain properties vs URL-prefix (pass-through as given);
- GCRA pacing 600/min + InMemoryCache TTL 24h keyed by (site, days, by);
- typed errors: NotConfiguredError (no env), LumenError auth/api failures (path redacted).
#### `packages/core/src/index.ts` — export the new types.
### Success Criteria
- [ ] Provider unit tests over a local fixture HTTP server (token exchange + query; token cached — second call hits API once; error paths typed; redaction: no file contents/errors leak secrets).

## Phase 2: `lumen performance` + `--with-gsc` + rank preference

### Changes
#### `packages/cli/src/cmd/performance.ts` (new)
`lumen performance <site> [--days N] [--by query|page] [--json]`: resolves `LUMEN_GSC_CREDENTIALS` (absent → ProviderUnconfiguredError naming the env var + setup pointer), builds the node provider, renders rows (human table / json), exit 0; rows carry first-party provenance.
#### `packages/cli/src/cmd/audit.ts` + args/help
`--with-gsc` flag: when set AND credentials configured, fetch page-dimension rows (28d) and annotate each byRule group with `{clicks, impressions}` summed over its sampleUrls (+ a `gsc` note in human output); when unconfigured → a single stderr note "GSC not configured — audit ran without traffic annotations" (findings unchanged). JSON output: annotated `summary.byRule` groups (+ additive `traffic` field).
#### `packages/cli/src/cmd/rank.ts`
When credentials configured: GSC position for (keyword, domain) via the provider's performance rows filtered by query → labeled first-party result `source: gsc`; ddg-serp skipped (never double-spend); no GSC → existing ddg path. Provenance text states the source. History entries carry the source label.
#### Contracts
COMMAND_NAMES 10→11 (`performance`); help entry; locked-names cliCommands += `performance`, cliFlags += `--with-gsc`, `--days`; cli-reference row; no-telemetry case += `['performance']` (fixture deps? performance command builds its own provider — needs an injectable seam: `buildDeps`-style `deps?.performanceProvider`); help snapshots.
### Success Criteria
- [ ] Spawn/in-process: performance against fixture GSC green; sentinel test (credential file contents never on stdout/stderr); --with-gsc annotation unit test; rank source labeling test; no-telemetry green.

## Phase 3: Bing keywords + `lumen indexnow submit`

### Changes
#### `packages/providers/src/bing-webmaster.ts` (new — node-only too? Bing Webmaster API is a simple apikey REST: worker-safe)
`createBingKeywordProvider(o: { fetcher; cache; pacer; env }): KeywordProvider` name `'bing-webmaster'`: `ideas(seed)` → `GET https://ssl.bing.com/webmaster/api.svc/json/GetKeywordData?apikey=…&q=…` (apikey VALUE from env at call time — `LUMEN_BING_KEY`); maps to KeywordIdea with `source: mkSource('bing-webmaster', 'official', 'Bing keyword volume — exact, scope: bing-only')`; typed not_configured when the env var is absent. Registered in createBuiltInProviders → BUILTIN_PROVIDER_NAMES 7→8 (+ worker allowlist + builtins.ts metadata + doctor signup? Bing key is account-level: KEYED_SIGNUP_URLS analog in doctor? doctor uses BUILTIN_PROVIDER_NAMES — grows to 8; PROVIDER_CAPABILITIES += 'bing-webmaster': 'keywords').
#### `packages/cli/src/cmd/indexnow.ts` (new)
`lumen indexnow submit <urls…> [--from-sitemap <url>] [--key <key>] [--yes]`: 
- key required (flag or `LUMEN_INDEXNOW_KEY`); verification GET `https://<host>/<key>.txt` must return the key EXACTLY (mismatch → UsageError exit 2, no POST);
- DRY RUN by default: prints the exact payload + POST target, exit 0, "dry run — pass --yes to submit";
- `--yes`: POST JSON `{host, key, keyLocation, urlList}` to `https://api.indexnow.org/indexnow`; prints response status; urls capped 10_000; `--from-sitemap` fetches+parses the sitemap (bounded, same-origin only) for urlList;
- SSRF: all fetches through the guarded fetcher; `--yes` on loopback/private targets refused unless allow-private-style scope (config reuse).
#### Contracts
COMMAND_NAMES 11→12 (`indexnow` with subcommand `submit` — parseCommand pattern like `config show`); BUILTIN_PROVIDER_NAMES 8 → doctor/registry/catalog updates (BUILTIN list, PROVIDER_CAPABILITIES, BYOK signup URL for bing? Bing key has no signup URL — omit), worker OUTBOUND_HOST_ALLOWLIST += ssl.bing.com (worker CAN run bing keywords — it's worker-safe; verify allowlist test), help/locked-names/cli-reference/no-telemetry (indexnow dry-run case), snapshots.
### Success Criteria
- [ ] Bing provider unit tests (fixture API; not-configured typed; volume labels); indexnow spawn tests: dry run default (no POST seen by fixture), --yes POSTs correct payload, key mismatch refuses exit 2; tools/list still 5; no-telemetry green.

## Testing Strategy

- Provider units over local fixture servers (auth exchange, cache, pacing counted, typed errors, redaction sentinels).
- CLI in-process + spawn (performance, rank labeling, indexnow dry/yes/mismatch).
- Contract gates (commands 12, snapshots, locked-names, no-telemetry).

## Amendments

(empty at authoring)

## References

- PRD §6 E2.1, E2.2; §10 D2 (6th tool deferred)
- Research: Seam D (providers), BYOK discipline
- Conventions: `google-suggest.ts` provider shape, `node.ts` subpath pattern, `rank.ts` flag consts

## Amendments (pre-implementation, from PLAN_B7_VALIDATION 2026-09-28 — validator agent_e00e4b1c)

- AMENDED Phase 3 [C1, Critical]: `KeywordIdea` gains additive-optional `volume?: number` (core payloads — the point of bing is the exact number); keyword shape tests updated.
- AMENDED Phase 3 [C2, Critical]: `BYOK_ENV_VARS` += `'bing-webmaster': 'LUMEN_BING_KEY'` — without it doctor reports bing "ready" on a clean machine; init's byok map gains the name; hardcoded 7-name tests updated.
- AMENDED Phase 3 [I3]: indexnow needs an indexnow-specific positional rule (subcommand must be `submit`; 0 urls with `--from-sitemap`, otherwise ≥1; unknown subcommand → error listing `submit`) — the exact-count parser cannot express it.
- AMENDED Phase 1 [I4]: the OAuth token cache honors `expires_in` (refresh ~60s early); the 24h cache is the RESPONSE cache only.
- AMENDED Phase 2 [I5]: `--with-gsc` sums clicks/impressions over the FULL distinct affected-URL set (not the ≤3 samples); annotations are stdout-only (the M2 raw-report `--out` contract is unchanged).
- AMENDED Phase 3 [I6]: bing is bundled-but-UNEXPOSED in the Worker v1 (no env-header/composition/CORS/allowlist plumbing — recorded; revisit with the 6th-tool contract change). No `ssl.bing.com` allowlist addition.
- AMENDED [I8]: a providers-side entry-isolation test: the main barrel and `worker.ts` graphs never reach `node-gsc.ts` (the existing bundle-scan cannot catch a `node:` leak in the providers package).
- AMENDED [I9]: no-telemetry seams: `performance` gets an injectable provider seam (case passes a dummy `LUMEN_GSC_CREDENTIALS` + fixture provider); indexnow verification GET goes through the SSRF guard like any fetch — spawn tests use an injected-transport seam rather than loopback servers; the dry-run no-telemetry case stubs the verifier.
- AMENDED [M10-M15]: hardcoded 7-name tests updated (config.test, doctor.test providers length); locked-names `providers`/`envVars` extended + `indexnow submit` subcommand mapping; stale "ten commands" prose → twelve; rank derives `sc-domain:<domain>` (URL-prefix properties unsupported — documented); distribution artifacts (server.json/mcpb env names) DEFER the new names (MCP doesn't expose GSC/Bing — recorded); `SearchPerformanceReport.rows[].source` uses the `Provenance` object convention; GSC pacing constants live in node-gsc.ts (DOCUMENTED_LIMITS is builtin-keyed); the searchAnalytics call is a POST; test additions: --with-gsc unconfigured stderr note, --from-sitemap cap, doctor 8th row + init byok bing, keyword volume shape.

## Amendments (implementation, 2026-09-29)

- AMENDED Phase 1 [factual]: the `search-performance` registry guard is a plain boolean predicate (TS type-predicate narrowing was impossible for a structural union this broad); GSC pacing constants live in node-gsc.ts (GSC_PACING) as planned.
- AMENDED Phase 2 [factual, seam]: the audit `--with-gsc` block runs the fixture provider WITHOUT requiring the env var (deps.performanceProvider takes precedence); annotations sum over the full distinct affected-URL set with trailing-slash tolerance; stdout-only (raw --out untouched).
- AMENDED Phase 3 [factual]: indexnow's positional validation moved BEFORE the generic exact-count check (the strict parser would otherwise reject N urls); its deps seam is a duck-typed `fetcher` on the deps object (tests + no-telemetry inject it); the no-telemetry indexnow case was NOT added (the harness's zero-fetch stub conflicts with mandatory key verification — the providers-commands suite covers indexnow with injected transports; recorded as an accepted deviation).
- AMENDED [factual]: worker providers map gains bing-webmaster (WorkerSafeProviders type now requires it) but the worker composition never selects it and no allowlist host was added (bundled-but-unexposed per I6).
- AMENDED [factual]: rank's GSC path derives the site as `https://<domain>` (sc-domain: URL-prefix properties unsupported — documented in the command's human output note).
- Evidence: full `npm run validate` green — 107 files / 1148 tests + cli-smoke.

## Amendments (post-review, 2026-09-29 — reviewer agent_49103841)

- FIXED (C1, Critical): Bing transport failures rethrow with the URL redacted (redactUrl masks apikey) — the key can no longer leak via RetryExhausted-style messages; failing-transport test asserts no key + redacted placeholder.
- FIXED (I1): ONE lazy GscAuth per provider instance (the token cache now survives across calls — 3 calls = 1 exchange, tested) and the response cache is checked BEFORE any auth (cache hits pay zero exchanges, tested).
- FIXED (I2): JSON.parse of the credentials file is wrapped — malformed content throws a path-only error (file fragments never echoed; tested with an HTML-error-page file).
- FIXED (I3): the Bing endpoint is the documented GetKeywordData surface; the param shape is recorded as UNVERIFIED against a live key (owner-gated external acceptance step, recorded in the ledger); failures are typed.
- FIXED (I4): `sc-domain:` passes through to the API verbatim (domain properties queried as domain properties); rank's human output notes the https:// URL-prefix limitation.
- FIXED (I5): rank's GSC failure degrades to the labeled SERP path with a stderr note (never hard-fails); tested.
- FIXED (I6): `lumen keywords` renders exact volumes ("1,234 vol/mo (exact)") when present; tested.
- FIXED (I7): Bing error taxonomy mirrors google-suggest (429 → RateLimitedError with Retry-After, 401 → not-configured, other 4xx → BlockedError).
- FIXED (I8): the entry-isolation gate resolves NodeNext `.js`→`.ts` specifiers (core's pattern) + graph-size sanity assertions — the walk is real now.
- FIXED (minors): bidirectional-ish slash tolerance in --with-gsc matching (audit URL side normalized too — full normalization both directions kept one-way + slash); bing cache key includes lang; indexnow multi-host atomicity (verify-all-before-any-POST, tested), --from-sitemap cross-origin drop (tested), args-rule trio (tested); dead code removed (suggestKey, duplicate IndexNowDeps); GSC_PACING reused at all three CLI sites; "unknown subcommand undefined" cosmetic; stale seven/eight comments; providers-byok prose; CHANGELOG tail; doctor regex note; indexnow redirect-manual strictness documented.
- Evidence: full `npm run validate` green — 107 files / 1158 tests + cli-smoke (gsc-bing 10, entry-isolation 3, providers-commands 17).
