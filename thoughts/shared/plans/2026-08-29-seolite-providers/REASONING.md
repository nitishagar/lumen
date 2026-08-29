# REASONING — providers aspect implementation (feat/lumen-providers)

Implementer log for the `@lumen-seo/providers` build (protocol
implement_plan_v2_5). Core source was read in full before coding; where the
plan's prose assumed shapes core does not have, **core wins** and the delta
is recorded here. All renames per RENAMES.md applied throughout
(`@lumen-seo/providers`, `LUMEN_PSI_KEY`/`LUMEN_CRUX_KEY`/`LUMEN_OPR_KEY`,
UA `lumen/<v> (+https://github.com/nitishagar/lumen)`).

## Core-vs-plan deltas (core wins; all additive, verified by core-deltas compile gate + existing core suite)

1. **A9 deltas were NOT in core** — applied additively in this branch exactly
   as the plan authorizes ("applied additively in this branch, conflict-free
   by construction"): `ProvenanceKind += 'gray'`; `KeywordIdea.retrievedAt?`;
   `SerpResult.source?/retrievedAt?/estimateLabel?`;
   `AuthoritySignal.retrievedAt?/estimateLabel?`;
   `CruxRecord.retrievedAt?`; `PageSpeedReport.retrievedAt?/field?`.
   Existing core `models.test.ts` uses `hasExactly` on its own fixtures, so
   optional-field additions break nothing (whole core suite re-ran green).
2. **`retrievedAt` is an ISO-8601 string, not a ms number** (plan's snippet
   used `deps.clock()` directly): core `Metric<T>` (SC-17) fixed the
   convention — `isoNow(deps.clock())` produces `new Date(t).toISOString()`,
   deterministic under the fake clock.
3. **`PageSpeedReport.field`** (new core type `PageSpeedField`): the plan's
   "each metric wrapped {value, source…}" conflicts with the LOCKED flat
   `metrics {lcp, cls, tbt, fcn}` model. Core wins: flat numbers; the
   report-level `source` is the lab provenance; real-user field data rides
   the additive optional `field { overall, metrics, source(kind field) }`,
   omitted entirely when `loadingExperience` is absent. Field `tbt` is
   honestly `null` (TBT is Lighthouse-lab-only; field has FID/INP).
4. **`registerBuiltIns` signature adapted**: core has NO mutable registry —
   `createProviderRegistry(selection, byok, available)` returns a frozen
   object. The plan pre-authorized a one-file adaptation
   (`registry-wiring.ts`): `registerBuiltIns(selection, config, deps) →
   ProviderRegistry`. Unknown names get core's ConfigError listing our
   built-ins (verified by test).
5. **Capability names**: plan says `keyword`; core `ProviderBoundary` is
   `keywords`. Core wins (`PROVIDER_CAPABILITIES` uses core's literal).
6. **`CruxOpts` has no `scope`** (locked: formFactor only). Handled in
   `opts-bridge.ts` (BA12, its exact purpose): runtime extension
   `scope?: 'origin'|'url'`, default **origin** (better data availability;
   one quota unit per site rather than per page for the audit-engine
   consumer). Recorded, not silently chosen.
7. **BYOK keys travel in headers, not URL params** (PSI/CrUX
   `x-goog-api-key`, OPR `Authorization: Bearer`): plan snippets put `?key=`
   in the CrUX URL. Header is the stronger I16 posture (URLs can end up in
   logs/errors); documented in the package README.
8. **`ProvidersConfig` lives in this package** (per-provider `{envVar, rpm,
   burst, refreshDays, maxRows}`): core's `ResolvedConfig` has no
   provider-knobs section (its `byok` map is validated by core's registry —
   `byokMapFromConfig` feeds it the explicit overrides).
9. **Worker-safe entry is a real subpath** (`@lumen-seo/providers/worker` →
   `src/worker.ts`), mirroring core's `@lumen-seo/core/node` pattern:
   re-exporting `createWorkerSafeProviders` from the main barrel would make
   "importing the worker-safe factory" load cheerio via the barrel's
   ddg-serp import. The module-graph test walks `worker.ts`'s local import
   graph (same technique as core's entry-isolation test) and asserts no
   cheerio / no `ddg-serp.ts` reachable.
10. **Phase-order deviation**: the plan schedules the wiring factories in
    Phase 1, but they construct the provider classes that only exist from
    Phases 2–5. Split: Phase 1a (constants + config guards + opts-bridge +
    their tests) landed first; the factories + worker entry + wiring tests
    landed as their own commit immediately after Phase 5 ("Phase 1b").
    Every commit is green; nothing was stubbed.
11. **no-direct-fetch scan scope**: production sources only
    (`src/**` minus `*.test.ts`/`testing.ts`) — `testing.ts` must declare a
    method literally named `fetch` to implement the injected `Fetcher`
    interface; a companion assertion verifies the doubles never touch the
    global (`globalThis.fetch`, bare `await fetch(`).
12. **Tranco freshness windows**: plan TC-TRC-3's "cached list <14d → 0
    fetches" and the 7-day refresh default interact — resolved as specified
    by the defaults table: refresh triggers after `refreshDays` (7d); a
    failed refresh inside the 14d ceiling serves the cached list with the
    age disclosed in the estimateLabel; past 14d → typed `stale_cache`. The
    "<14d → 0 fetches" assertion is exercised with a 5-day-old list (inside
    the refresh window). The store entry itself is written with a 365d TTL —
    freshness is provider-owned (fetchedAt), not store-owned, so a >14d-old
    entry is still retrievable to distinguish stale-serve from stale_cache.
13. **GCRA burst semantics**: tolerance = `(burst − 1)·interval` so exactly
    `burst` requests admit back-to-back from idle (plan TC-CRUX-4's "10
    immediate, 11th waits") and the worst rolling 60 s window bound is
    `1 + ⌊(60s + τ)/i⌋ = rpm + burst`. A 1e-3 ms FP epsilon absorbs float64
    ulp rounding at epoch-scale clock values (1.7e12 ms) without affecting
    the bound (found by a concurrency-dependent test failure, fixed in the
    wiring commit).
14. **Wikipedia other-4xx → blocked** (not upstream): a 403 from Wikimedia
    is in practice UA-policy rejection — `blocked` is the actionable class.
    5xx stays `upstream_error` everywhere (never "CAPTCHA").
15. **wikipedia-demand ignores `lang` in v1** (BA4: en.wikipedia only) — the
    idea's label explicitly names en.wikipedia so the output stays honest.

## Test inventory (119 tests, 11 files — `npm test -w @lumen-seo/providers`)

shared.test.ts (TC-SHARED-1/2/3/4/5/9/10 + TC-REG-6 mechanism) ·
core-deltas.test.ts (A9 gate) · config.test.ts (TC-REG-1/2/4, R5 names,
opts-bridge) · keyword-providers.test.ts (TC-SUG-1..5, TC-WIKI-1/2/3) ·
google-byok.test.ts (TC-PSI-1..6, TC-CRUX-1..5) ·
authority-providers.test.ts (TC-OPR-1..4, TC-TRC-1..4 + misc) ·
ddg-serp.test.ts (TC-DDG-1..5) · registry-wiring.test.ts (TC-REG-1/2/3/4/5/6
through the factories) · provenance-sweep.test.ts (TC-SHARED-6/8) ·
no-direct-fetch.test.ts (TC-SHARED-7) · index.test.ts (placeholder smoke,
kept green). Whole-repo suite: 297 tests / 27 files green; root
`npm run lint` + `npm run typecheck` green.

## Commits (feat/lumen-providers, on top of 61aaa05)

1. `feat(providers): shared plumbing + A9 core payload deltas (Phase 0)`
2. `feat(providers): built-in metadata, BYOK config guards, opts bridge (Phase 1)`
3. `feat(providers): google-suggest + wikipedia-demand keyword providers (Phase 2)`
4. `feat(providers): pagespeed + crux Google BYOK pair (Phase 3)`
5. `feat(providers): openpagerank + tranco authority providers (Phase 4)`
6. `feat(providers): ddg-serp gray SERP provider (Phase 5)`
7. `feat(providers): registry wiring + Worker-safe entry (Phase 1 factories)`
8. `test(providers): provenance sweep, no-direct-fetch gate, key-leak probe + package README (Phase 6)`

## Merge notes for the orchestrator

- Core edits in this branch are the three additive A9 one-liners (plus the
  `PageSpeedField` export) — conflict-free by construction if P1/P2 branches
  touch core elsewhere; re-run the core suite after merge order anyway.
- `cheerio` moved from core devDependencies context into providers
  **dependencies** (package-lock updated; npm workspaces link `*` — the
  `workspace:` protocol is pnpm/yarn-only).
- P4 surfaces should import `@lumen-seo/providers/worker` (not `.`) inside
  Worker bundles; R7's `WORKER_ENABLE_PSI` default-true posture is safe —
  PSI/CrUX live in the worker-safe six.
