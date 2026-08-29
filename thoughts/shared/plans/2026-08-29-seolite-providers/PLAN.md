---
date: 2026-08-29T00:00:00+05:30
protocol: create_plan_generic_v2_5
aspect: providers
package: "@seolite/providers"
scale: large
status: planned
depends_on: [P1 scaffold-core (M0) — core SPI, Fetcher, payload models]
merge_order: P3 (after P2 audit-engine, before P4 surfaces; depends ONLY on core)
spec: ./IMPLICIT_SPEC.md
last_updated: 2026-08-29
last_updated_by: providers plan author
---

# SIGNPOST

**Aspect:** `providers` — the seven built-in data providers of seolite and their registry wiring (`packages/providers` → npm `@seolite/providers`).
**One-line goal:** every external data boundary of seolite implemented as a pure, provenance-labeled, rate-limit-respecting SPI implementation over an injected core `Fetcher` — free-only, BYOK via env-var names, honest about gray data.
**Scale:** large (7 providers + shared plumbing + registry wiring + full fixture contract suite).
**Owns:** `packages/providers/**` only. Depends on `@seolite/core` (M0, P1) types only; never on sibling branches (P2/P4/P5).
**Locked contract honored:** ARCHITECTURE.md SPI signatures (`KeywordProvider`, `SerpProvider`, `PageSpeedProvider`, `CruxProvider`, `AuthorityProvider`), payload required fields, Fetcher interface, registry semantics (I2), BYOK-skip semantics (I1), per-provider attribution (I8).
**Key spec file:** `./IMPLICIT_SPEC.md` (invariant bindings A1–A10, provider contract matrix, bounding assumptions BA1–BA12). Numbers in this plan (150 qpm CrUX, 60 req/min OPR, 200 req/min Wikimedia, etc.) trace to evidence cited there.
**Done means:** all seven providers + wiring green under `npm test -w @seolite/providers` with zero network, zero wall-clock dependence, provenance + attribution asserted on every emitted value.

---

## Overview

`packages/providers` turns the research-verified free data sources (research §Seam 3 matrix) into the seven built-in implementations of the locked provider SPI:

| name | answers | SPI | key | kind |
|---|---|---|---|---|
| `google-suggest` | what do people type after this seed? | KeywordProvider | none | gray |
| `wikipedia-demand` | is there real demand for this term? | KeywordProvider | none | heuristic |
| `pagespeed` | how fast/healthy is this URL (lab + field)? | PageSpeedProvider | optional trial / required automated | lab (+field) |
| `crux` | what do real users experience here? | CruxProvider | REQUIRED | field |
| `openpagerank` | how strong is this domain (proxy)? | AuthorityProvider | REQUIRED | heuristic |
| `tranco` | is this domain top-N overall? | AuthorityProvider | none | community |
| `ddg-serp` | where does this rank today (best-effort)? | SerpProvider | none | gray |

Shared plumbing: typed error taxonomy (`NotConfiguredError`, `RateLimitedError`, `BlockedError`, `UpstreamError`, `ParseError`, timeout/stale codes — all carry the provider name, I17), per-source token-bucket throttles testable with a fake clock, a `CacheStore` port with TTL caching appropriate to each source, BYOK resolution by env-var **name** at call time, and attribution constants (CrUX CC BY 4.0, Tranco, OPR) attached to every emitted value (I8). All seven names are exported and registered with capabilities so core's `createRegistry(config)` validates selection and rejects unknown names by listing these (I2).

Everything is Node-compatible and Worker-safe except `ddg-serp` (cheerio; the Worker parses no HTML per I6) — a separate `createWorkerSafeProviders` export wires the other six.

## Current State

- Greenfield: the repository (`~/repos/learn/seolite`) currently contains only the `thoughts/` tree (research + this plan bundle). `packages/providers` does not exist.
- `packages/core` is planned in M0/P1 (`scaffold-core` bundle): Fetcher (SSRF-guarded, timeout/backoff/jitter per I12/I17), config loader, SPI interfaces, payload models (`KeywordIdea`, `SerpResult`, `PageSpeedReport`, `CruxRecord`, `AuthoritySignal`), provider SPI + registry. This plan codes against those locked shapes and records two additive deltas it requires (IMPLICIT_SPEC A9).
- No code exists to preserve; no tests exist; nothing is published.

## Desired End State

- `packages/providers` builds as `@seolite/providers` (ESM, TypeScript, Node ≥ 22, npm workspace), deps limited to `@seolite/core` + `cheerio` (ddg-serp only).
- Seven providers, each: provenance + attribution on every emitted value; correct BYOK semantics (`not_configured` typed outcome when key absent; config carries env-var names only, secret values rejected); client-side throttle ≤ documented limits; caching appropriate to the source; typed errors with provider name; no direct `fetch()` anywhere (core Fetcher only, I12).
- Registry wiring: `BUILTIN_PROVIDER_NAMES`, `createBuiltInProviders()`, `createWorkerSafeProviders()`, `registerBuiltIns()` exported and covered by tests (I2).
- Full contract test suite against injected fetchers/fixtures with fake clock — no live network, no real time (I9/I10).

Verify commands (all must be green at the end of every phase's final state and at merge):

```bash
npm test -w @seolite/providers          # full contract suite (fixture-only, deterministic)
npm run typecheck -w @seolite/providers # tsc --noEmit
npm run lint -w @seolite/providers      # eslint (flat config, shared repo rules)
```

## What We're NOT Doing

- **No backlink graphs, keyword-volume databases, or clickstream traffic estimates** — no free source exists (research Seam 1+3 OUT rows); authority arrives only as Open PageRank/Tranco proxies.
- **No Google Programmable Search / Bing SERP provider** — Programmable Search is closed to new customers with full API shutdown 2027-01-01; Bing retired 2025-08-11 (IMPLICIT_SPEC A10). Future BYOK SERP providers (Brave, serper) plug in via the SPI; we build none now.
- **No paid APIs in any default path; no keys, key values, or telemetry in this package** (I1/I16). No .env files created; keys live in the user's environment.
- **No caching layer product** — only the `CacheStore` port + in-memory default; a persistent store is surfaces'/CLI's later injection.
- **No CLI/MCP/REST surface work** — that is P4 (`surfaces`); we ship SPI implementations + wiring only.
- **No HTML parsing outside ddg-serp** — no robots.txt logic, no crawling (audit-engine P2's job).
- **No live-network integration tests, no CI against real APIs** — quota-burning and non-deterministic (I9/I10); fixtures only. Manual live checks are documented as a maintainer task, never automated.
- **No per-file license headers** — root Apache-2.0 LICENSE suffices (research §Seam 5; headers are a "should").

## Approach

One package, seven provider modules + shared plumbing, built strictly TDD (each phase = failing contract tests first, then implementation). All HTTP flows through the injected core `Fetcher` (`fetch(url: URL, init?: RequestInit): Promise<Response>`); providers add what the Fetcher cannot know: per-source client throttles, source-shaped parsing, provenance labeling, source-appropriate caching, and typed error mapping.

Call order inside every provider method (uniform template):

```
resolve key by env-var NAME (if BYOK) → NotConfiguredError if required and absent
→ cache lookup (key = provider + normalized inputs) → hit? return cached values
→ throttle.acquire() (token bucket, injected clock)
→ deps.fetcher.fetch(url, init { headers incl. UA, Authorization? })
→ map status/body → typed errors (429→rate_limited+Retry-After; 5xx→upstream_error;
   CAPTCHA→blocked; malformed→parse_error; no-data→null/[])
→ map to locked payload shapes with source{provider, kind, attribution, retrievedAt}
→ write cache with TTL → return
```

Provenance kinds (core enum + additive `'gray'`, A9): `gray` = google-suggest/ddg-serp; `heuristic` = wikipedia-demand/openpagerank; `community` = tranco; `lab` = PSI Lighthouse; `field` = CrUX and PSI-embedded CrUX buckets.

### Shared plumbing (built once in Phase 0)

```ts
// packages/providers/src/errors.ts
export type ProviderErrorCode =
  | 'not_configured' | 'rate_limited' | 'blocked' | 'upstream_error'
  | 'parse_error' | 'timeout' | 'stale_cache';

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, readonly provider: string,
              message: string, readonly detail?: Record<string, unknown>) {
    super(`[${provider}] ${message}`); this.name = 'ProviderError';
  }
}
export class NotConfiguredError extends ProviderError {          // I1: typed skip signal, not a crash
  constructor(provider: string, readonly envVar: string, setupHint: string) {
    super('not_configured', provider, `API key missing: set ${envVar} (${setupHint})`);
  }
}
export class RateLimitedError extends ProviderError {
  constructor(provider: string, readonly retryAfterMs?: number, detail?: Record<string, unknown>) {
    super('rate_limited', provider, `rate limited${retryAfterMs ? `; retry after ${retryAfterMs}ms` : ''}`, detail);
  }
}
export class BlockedError extends ProviderError {}               // gray CAPTCHA / bot protection
export class UpstreamError extends ProviderError { constructor(p: string, readonly status: number, m: string) { super('upstream_error', p, m); } }
export class ParseError extends ProviderError {}
```

```ts
// packages/providers/src/redact.ts — I16: keys never leak into messages
export function redactUrl(u: URL | string): string {
  const c = new URL(u); for (const p of ['key', 'token', 'apikey', 'api_key']) if (c.searchParams.has(p)) c.searchParams.set(p, '[redacted]');
  return c.href;
}
```

```ts
// packages/providers/src/throttle.ts — client-side cap per source; fully fake-clock testable (I10)
export interface Throttle { acquire(): Promise<void>; tryAcquire(): boolean }
export class TokenBucketThrottle implements Throttle {
  constructor(readonly rpm: number, private clock: () => number, private sleep: (ms: number) => Promise<void>) {}
  /* refill by elapsed; acquire() sleeps via injected sleep until a token frees; tryAcquire() returns false instead */
}
```

```ts
// packages/providers/src/cache.ts — core defines no cache contract; the port lives here (BA2)
export interface CacheStore { get<T>(key: string): Promise<T | undefined>; set<T>(key: string, v: T, expiresAtMs: number): Promise<void> }
export class InMemoryCache implements CacheStore { /* Map + expiry via injected clock */ }
```

```ts
// packages/providers/src/deps.ts — everything non-deterministic is injected (I9/I10)
export interface ProviderDeps {
  fetcher: Fetcher;                    // @seolite/core — SSRF-guarded, timeout+bounded retry+Retry-After (I12/I17)
  cache: CacheStore;
  clock: () => number;                 // I10
  sleep: (ms: number) => Promise<void>;
  env: (name: string) => string | undefined;   // values read at call time, never stored (I1)
  userAgent: string;                   // I4/A3: "seolite/<version> (+https://github.com/nitishagar/seolite)"
}
```

### Registry wiring (Phase 1, I2)

```ts
// packages/providers/src/index.ts
export const BUILTIN_PROVIDER_NAMES = ['google-suggest','wikipedia-demand','pagespeed',
  'crux','openpagerank','tranco','ddg-serp'] as const;
export type BuiltinProviderName = (typeof BUILTIN_PROVIDER_NAMES)[number];

export function createBuiltInProviders(config: ProvidersConfig, deps: ProviderDeps):
  Record<BuiltinProviderName, Provider>;                       // all 7 (Node runtime)
export function createWorkerSafeProviders(config: ProvidersConfig, deps: ProviderDeps):
  Omit<Record<BuiltinProviderName, Provider>, 'ddg-serp'>;     // 6 — no cheerio in Worker bundles (BA9)
export function registerBuiltIns(registry: ProviderRegistry, config: ProvidersConfig, deps: ProviderDeps): void;
```

Capability map: `google-suggest`/`wikipedia-demand` → keyword; `ddg-serp` → serp; `pagespeed` → pagespeed; `crux` → crux; `openpagerank`/`tranco` → authority. `registerBuiltIns` calls core's registration method (adapted in one file, `src/registry-wiring.ts`, if P1's method name differs — blast radius contained, Phase 1 verifies by test). Config guards: provider section may set `envVar` (a NAME) and knobs (`refreshDays`, `maxRows`, `rpm` overrides ≤ documented limits); any value-like key (`/^(api[_-]?key|key|token|secret|password)$/i`) → ConfigError (I1).

### Per-provider essentials (details in Phases)

- **google-suggest** — `GET https://suggestqueries.google.com/complete/search?client=firefox&hl=<lang>&q=<seed>` → `["seed", ["s1","s2",…]]`. Throttle 30/min (undocumented endpoint; conservative). Cache 24h. `content-type` not JSON / shape mismatch → `blocked` (CAPTCHA) or `parse_error`. Ideas labeled `kind: 'gray'`.
- **wikipedia-demand** — 2 calls: title match (`/w/rest.php/v1/search/title?q=&limit=1`) then 28-day daily pageviews (`wikimedia.org/api/rest_v1/metrics/pageviews/per-article/…/daily/{start}/{end}` ending today−2d). Contact UA on both (A3). Throttle 60/min. Sum → single KeywordIdea with `estimateLabel: "≈N views/28d on en.wikipedia \"<article>\" — demand proxy, not search volume"`, `kind: 'heuristic'`. No match → `[]` (I3 omit).
- **pagespeed** — `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=&strategy=&category=…(&key=)`. Keyless trial when `automated !== true`; `automated && !key` → NotConfiguredError (A4/BA5). Throttle 60/min keyed, 6/min keyless; cache 6h per (url, strategy). Lab: `lighthouseResult.categories.*.score × 100` + audits (`largest-contentful-paint`, `cumulative-layout-shift`, `total-blocking-time`, `first-contentful-paint` → model field `fcn`, BA7) as `kind: 'lab'`. Field: `loadingExperience.metrics.*.percentile` as `kind: 'field'`, omitted when absent (low-traffic origins — never zero-fill). Google error envelope `{error:{code,message}}` mapped: 429/403-quota → `rate_limited`.
- **crux** — `POST https://chromeuxreport.googleapis.com/v4/records:queryRecord?key=…`, body `{origin|url, formFactor}`. Key REQUIRED (A1). Token bucket hard-capped at documented 150 qpm, default operating rate 140/min (BA1) — fake-clock test asserts ≤150/min in every 60s window. Cache 24h per (scope, formFactor, url). HTTP 404 "no data" → `null` (contract meaning: not in dataset — distinct from `not_configured`, BA6). Every record: `source { provider:'crux', kind:'field', attribution: CRUX_ATTRIBUTION, retrievedAt }` where `CRUX_ATTRIBUTION = 'Chrome UX Report (CrUX) data by Google — licensed under CC BY 4.0 (https://developer.chrome.com/docs/crux/methodology)'` (A8/I8).
- **openpagerank** — GET `https://openpagerank.com/api/v1.0/getPageRank?domains[i]=…`, header `Authorization: Bearer <key>` (A2: the stale `API-OPR` header is NOT used). Batches ≤100 domains; throttle 50/min; per-domain cache 30d. Response `{domains:[{domain, rank, page_rank_integer, page_rank_decimal, status_code, error}]}` → AuthoritySignal `{domain, kind:'score', value: page_rank_decimal}` + `{kind:'rank', value: rank}`; per-domain `error` indicating quota → `rate_limited` with `detail.reason:'monthly-quota'`. Attribution string attached (BA8).
- **tranco** — free tier has no per-domain query API → download-and-index (BA3): resolve `GET https://tranco-list.eu/api/lists/date/{yyyy-mm-dd}` → `{list_id, download_path}` (walk back ≤3 days if today unpublished) → single download of `download_path` → stream-parse CSV `rank,domain` up to `maxRows` (default 100,000) → in-process Map, persisted to CacheStore with 7-day expiry. Staleness disclosed as `estimateLabel: "Tranco rank (list <id>, <date>, top <rows>)"`; cached list older than 14 days → `stale_cache`. Outside top-N → omitted (`[]`). Every signal: `kind:'community'`, attribution `"Tranco top-sites ranking — https://tranco-list.eu (Le Pochat et al.) — CC BY 4.0"` (A7).
- **ddg-serp** — `GET https://html.duckduckgo.com/html/?q=…` (primary; `lite.duckduckgo.com/lite/?q=` fallback), cheerio parse of `a.result__a` (+ `result__snippet`), `uddg=` param URL-decoded, `.result--ad` filtered, positions 1..N. Throttle 1 req/10s (6/min). Cache 1h. Anomaly/challenge markers → `blocked`; 0 results with neither result anchors nor a no-results marker → `parse_error` (layout drift); 429 → `rate_limited`. Values labeled `kind:'gray'`; brittleness documented in package README (A6).

## Design Analysis

### Invariants → mechanism

| Invariant | Mechanism in this package | Verified by |
|---|---|---|
| I1 zero-cost + BYOK-skip | env-var NAME in config; value resolved via `deps.env` at call time; absent required key → `NotConfiguredError` (engine catches → "not configured" surface result, BA6); value-like config keys rejected; keyless calls never made to key-required endpoints (CrUX always; PSI when `automated`) | TC-REG-3/4, TC-CRUX-1, TC-PSI-2, TC-OPR-1 |
| I2 pluggability | all vendor calls live here; `BUILTIN_PROVIDER_NAMES` + capability map + `registerBuiltIns`; unknown-name error is core's, fed by our name list; ddg-serp replaceable by any SerpProvider via config/registry without surface changes | TC-REG-1/2/5 |
| I3 honesty | `kind` labels per matrix (incl. `gray`); `estimateLabel` on all heuristic/gray outputs; failure → `null`/`[]`/omitted field, never zero; lab vs field kept distinct inside PageSpeedReport | TC-SHARED-6, TC-CRUX-4, TC-PSI-6, TC-WIKI-3 |
| I4 etiquette | contact UA on every request via deps; per-source throttles; Retry-After honored (Fetcher retries; provider parses final header into `retryAfterMs`); tranco downloads ≤1/window | TC-SHARED-2/3, TC-DDG-2 |
| I8 attribution | `ATTRIBUTION` constants; attached to every emitted value; CrUX string includes CC BY 4.0 + methodology link; constants exported for site display | TC-SHARED-6, TC-CRUX-2, TC-TRC-4 |
| I9/I10 | injected fetcher/clock/sleep/env/cache in 100% of tests; fixtures static; fake clock for TTL/throttle | TC-SHARED-1..5 |
| I12 SSRF | zero direct `fetch(` in `src/**` (source-scan test); every call goes through injected core Fetcher | TC-SHARED-7 |
| I15 boundaries | malformed JSON/HTML → `parse_error`; CAPTCHA → `blocked`; oversized CSV streamed + capped; domain normalization before lookups | TC-SUG-4, TC-DDG-3/4, TC-TRC-2/3 |
| I16 privacy | README data-flow table; `redactUrl` strips `key`/`token` params from any message/URL string; keys never interpolated into errors | TC-SHARED-8 |
| I17 retry/backoff | single retry owner = core Fetcher (providers never retry → no double-retry); providers parse final Retry-After; typed errors always carry provider name | TC-SHARED-1, TC-*-429 tests |

### Failure handling (stimulus → typed outcome)

| Stimulus | Outcome | Notes |
|---|---|---|
| required key absent | `ProviderError('not_configured')` with `envVar` + setup hint | engine renders explicit skip (I1); never a keyless call |
| HTTP 429 (+Retry-After) | `RateLimitedError(retryAfterMs?)` | header parsed per source; core Fetcher already retried |
| CAPTCHA / anomaly page / bot block | `BlockedError` | gray providers (suggest, ddg); documented degraded path |
| HTTP 5xx / network after Fetcher retries | `UpstreamError(status)` | wrapped via `withProviderErrors` helper |
| fetcher timeout rejection | `ProviderError('timeout')` | message redacted |
| malformed JSON / unexpected shape | `ParseError` | real API shapes fixed in fixtures |
| HTML layout drift (0 anchors, no no-results marker) | `ParseError` | conservative: treat as breakage, not empty SERP |
| CrUX 404 "no data" | `null` record | honest absence, distinct from not-configured (BA6) |
| Tranco list >14d stale and refresh failed | `ProviderError('stale_cache')` | <14d served with staleness label |
| OPR monthly quota exhausted | `RateLimitedError(detail.reason='monthly-quota')` | A2 |
| domain/origin absent from list | `[]` (omitted) | I3 never zero-fill |

Every method is wrapped in one helper so unexpected rejections still exit typed:

```ts
// src/with-errors.ts
export async function withProviderErrors<T>(name: string, op: () => Promise<T>): Promise<T> {
  try { return await op(); }
  catch (e) {
    if (e instanceof ProviderError) throw e;
    const msg = String((e as Error)?.message ?? e);
    throw /timeout|abort/i.test(msg) ? new ProviderError('timeout', name, msg)
                                     : new ProviderError('upstream_error', name, msg);
  }
}
```

### Blast radius

- **New package only.** No existing package changes behavior; `@seolite/providers` is imported first by P4 (surfaces) — until then nothing else references it (merge order P2 → P3 → P4 protects this).
- **Core deltas are 3 additive one-liners** (A9: `'gray'` in ProvenanceKind; optional `source`/`retrievedAt` on SerpResult; optional `retrievedAt`/`estimateLabel` on AuthoritySignal). If not already landed in core when P3 starts, they are applied additively in this branch (conflict-free by construction); Phase 0's compile test verifies them.
- **Runtime risk is contained per provider**: gray providers can only fail typed (`rate_limited`/`blocked`/`parse_error`) — surfaces degrade honestly; nothing here can crash the engine with an untyped error.
- **Registry adaptation** (`registerBuiltIns` → core's method) is isolated in `src/registry-wiring.ts`; a signature mismatch is a one-file fix.
- **Cache/throttle bugs cannot leak across providers** — each provider owns its own throttle instance and cache-key namespace.

### Alternatives considered (decision + why)

1. **NotConfigured as result-union vs typed error** → typed error. The SPI signatures are locked (`Promise<CruxRecord|null>`, `Promise<KeywordIdea[]>`, …); a union would change core SPI. CrUX `null` stays reserved for "no data" (BA6). Rejected alternative: overloading `null` for both meanings — collision of semantics.
2. **Cache in core vs providers-local port** → providers-local `CacheStore` port + `InMemoryCache`. Core's locked scope has no cache contract; a file/SQLite store can be injected by P4 later without changes here (BA2).
3. **Throttle inside core Fetcher vs per-provider** → per-provider token buckets. Source limits are provider knowledge (CrUX 150 qpm vs Wikimedia 200/min vs DDG undocumented); the Fetcher must stay source-agnostic. Fake-clock `tryAcquire` makes limits provable (TC-SHARED-2/3).
4. **Tranco: CSV download vs per-domain API** → CSV download+index. The free tier offers daily list downloads only (A7); cost is one request per refresh window (~2–3 MB) with local Map lookups. Rejected: hammering list metadata endpoints per domain.
5. **PSI: always require key vs trial-keyless** → trial-keyless for single interactive calls, key required when `automated` (mirrors Google's own docs language, A4/BA5); keyless throttle 6/min keeps trial mode far from undocumented unauthenticated bounds.
6. **DDG: html vs lite endpoint, GET vs POST** → GET html primary with lite fallback (both documented-observed shapes in fixtures); no POST retries beyond core policy — conservative against bot protection.
7. **cheerio vs regex parsing for ddg-serp** → cheerio (locked by ARCHITECTURE for DOM parsing; Node-only, BA9).
8. **Provider-level retry vs core-only retry** → core-only (I17 single owner); providers map final outcomes. Rejected: double-retry multiplies load on fragile gray endpoints.
9. **`'gray'` mapped to `'community'` vs new enum literal** → new literal `'gray'`. I3 honesty is a product feature; collapsing gray into community would mislabel undocumented endpoints.

### Defaults (locked here, all recorded as bounding assumptions BA1–BA12)

Throttles: suggest 30/min · wikipedia 60/min · PSI 60/min keyed, 6/min keyless · CrUX 140/min (hard cap 150) · OPR 50/min · tranco 1 download/7d · ddg 6/min. Cache TTLs: suggest 24h · wikipedia 24h · PSI 6h · CrUX 24h · OPR 30d/domain · tranco 7d refresh / 14d stale ceiling · ddg 1h. Env names: `SEOLITE_PSI_API_KEY`, `SEOLITE_CRUX_API_KEY`, `SEOLITE_OPENPAGERANK_API_KEY`. Tranco top 100k rows. en.wikipedia only; 28-day window ending today−2d.

## Resource & Cost Analysis

Cost: **$0.00** — every provider is free-tier or key-free (I1). Free-tier quota budget per provider:

| Provider | Documented limit (evidence ref) | Default client throttle | Cache | Request cost per unit | Budget check (typical run) |
|---|---|---|---|---|---|
| google-suggest | undocumented; 429/CAPTCHA at scale (A5) | 30 req/min | 24h | 1 GET / seed+lang | 20 seeds ≈ 20 req over ≥40 s — far under observed break points |
| wikipedia-demand | 200 req/min w/ contact UA; 429+Retry-After (A3) | 60 req/min | 24h | 2 GET / seed (title match + 28d dailies) | 20 seeds = 40 req ≪ 200/min cap |
| pagespeed | ~25k/day, 240/min `[R]` corroborated; key needed for automated (A4) | 60/min keyed · 6/min keyless | 6h | 1 GET / (url, strategy) | 100-page audit keyed ≈ 100 req = 0.4% of daily quota |
| crux | **150 qpm/project, not increasable by payment** (A1) | 140/min (hard cap 150) | 24h | 1 POST / (origin\|url, formFactor) | 100 origins ≈ 43 s min duration; ≤140 req/min guaranteed by bucket |
| openpagerank | 60 req/min + monthly domain quota (~30k/month docs example) (A2) | 50/min, ≤100 domains/batch | 30d/domain | 1 GET / ≤100 domains | 500 fresh domains ≈ 5 req/min-bounded ≈ 1.7% of example monthly quota |
| tranco | daily list; attribution required (A7) | 1 download / ≤7 days | 7d refresh | ~2–3 MB gz download | ~12–17 MB/month bandwidth, 4–5 requests/month total |
| ddg-serp | undocumented; active bot protection (A6) | 6 req/min (1/10 s) | 1h | 1 GET / query | 20 rank checks ≈ 20 req over ≥3.3 min — deliberately crawl-pace |

Aggregate worst case for the M2 CLI smoke profile (1 audit of 25 pages + PSI/CrUX per page + 20 keyword lookups + 5 rank checks): ≤ ~60 outbound requests/provider/minute ceilings never approached; total monthly cost unchanged at $0. CI cost: tests are offline (fixtures), so CI minutes ≈ seconds (public repo = free).

## Phases

> Every phase: write failing contract tests first (fixtures + fake clock), then implement until green. Snippets only — full files land in the branch. Phase N+1 starts only when Phase N is green.

### Phase 0 — Package scaffold + shared plumbing

**Goal:** `@seolite/providers` exists with error taxonomy, redaction, throttle, cache port, deps, provenance/attribution constants, and the A9 core-delta check.

**Changes**
- `packages/providers/package.json` — name `@seolite/providers`, ESM, `"exports": { ".": "./src/index.ts" }` (ts-down/tsc per repo convention), deps: `@seolite/workspace:*` core + `cheerio` (ddg-serp phase); dev: vitest.
- `src/errors.ts`, `src/redact.ts`, `src/throttle.ts`, `src/cache.ts`, `src/deps.ts`, `src/provenance.ts`, `src/with-errors.ts` — as snippeted in Approach.
- `test/helpers/clock.ts` — `fixedClock()` returning `{ now, advance }`; `test/helpers/fake-fetcher.ts` — scriptable stub recording calls.

```ts
// src/provenance.ts — A8/I8 constants (single source of truth; site-docs renders from here)
export const ATTRIBUTION = {
  crux: 'Chrome UX Report (CrUX) data by Google — licensed under CC BY 4.0 (https://developer.chrome.com/docs/crux/methodology)',
  tranco: 'Tranco top-sites ranking — https://tranco-list.eu (Le Pochat et al.) — CC BY 4.0',
  openpagerank: 'Open PageRank domain score — https://openpagerank.com (openpagerank.keywordseverywhere.com/docs)',
  pagespeed: 'Lighthouse / PageSpeed Insights API (Google)',
  wikipedia: 'Wikimedia pageviews (CC0) — used as a demand proxy, not search volume',
  'google-suggest': 'Google autocomplete suggestions — undocumented endpoint (gray)',
  'ddg-serp': 'DuckDuckGo SERP via best-effort HTML retrieval (gray)',
} as const;
```

```ts
// test/core-deltas.test.ts — A9 compile-time gate
import type { ProvenanceKind, SerpResult, AuthoritySignal } from '@seolite/core';
const gray: ProvenanceKind = 'gray';          // must compile
const s: SerpResult = { position: 1, url: 'https://x', title: 'x', source: { provider: 'ddg-serp', kind: 'gray', attribution: 'a' } };
const a: AuthoritySignal = { domain: 'x.com', kind: 'rank', value: 7, provider: 'tranco', attribution: 't', retrievedAt: 0, estimateLabel: 'l' };
it('core payload deltas A9 are present', () => { expect(gray).toBe('gray'); });
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-SHARED-1: every ProviderError subclass message/detail begins with `[provider]`
- [ ] TC-SHARED-2: `TokenBucketThrottle.tryAcquire` under fake clock issues ≤ rpm in every rolling 60 s window
- [ ] TC-SHARED-3: `acquire()` blocks (via injected sleep) and releases with correct spacing under fake clock
- [ ] TC-SHARED-4: `InMemoryCache` returns `undefined` after TTL expiry under fake clock
- [ ] TC-SHARED-5: `redactUrl` replaces `key`/`token` params; original URL object unmutated
- [ ] A9 compile test passes (or A9 edits applied additively to core in this branch)
- [ ] `npm run typecheck -w @seolite/providers` green

### Phase 1 — Registry wiring + contract-test harness

**Goal:** all seven names exported, wired with capabilities, BYOK config guards in place; harness for fixture-driven contract tests finished.

**Changes**
- `src/index.ts`, `src/registry-wiring.ts`, `src/config.ts` — exports + guards per Approach.

```ts
// src/config.ts — I1 hardening: names yes, values never
const SECRET_LIKE = /^(api[_-]?key|key|token|secret|password)$/i;
export function assertNoSecretValues(name: string, cfg: Record<string, unknown>): void {
  for (const k of Object.keys(cfg)) if (SECRET_LIKE.test(k))
    throw new ProviderError('not_configured', name,
      `put the key in an environment variable, not config — use "envVar" to NAME it`);
}
export function resolveEnvVar(name: string, cfg?: { envVar?: string }): string {
  const byProvider: Record<string, string> = { pagespeed: 'SEOLITE_PSI_API_KEY', crux: 'SEOLITE_CRUX_API_KEY', openpagerank: 'SEOLITE_OPENPAGERANK_API_KEY };
  return cfg?.envVar ?? byProvider[name];
}
```

```ts
// src/registry-wiring.ts
export function createBuiltInProviders(config: ProvidersConfig, deps: ProviderDeps): Record<BuiltinProviderName, Provider> {
  const t = (rpm: number) => new TokenBucketThrottle(rpm, deps.clock, deps.sleep);
  return {
    'google-suggest': new GoogleSuggestProvider(deps, t(30)),
    'wikipedia-demand': new WikipediaDemandProvider(deps, t(60)),
    'pagespeed': new PageSpeedProvider(config.pagespeed, deps, t(60)),
    'crux': new CruxProvider(config.crux, deps, t(140)),
    'openpagerank': new OpenPageRankProvider(config.openpagerank, deps, t(50)),
    'tranco': new TrancoProvider(config.tranco, deps),
    'ddg-serp': new DdgSerpProvider(config['ddg-serp'], deps),
  };
}
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-REG-1: `BUILTIN_PROVIDER_NAMES` contains exactly the 7 names (I2)
- [ ] TC-REG-2: each wired provider declares its capability (keyword/serp/pagespeed/crux/authority)
- [ ] TC-REG-3: each BYOK provider with absent key (stub `env` → undefined) rejects with `not_configured` naming its env var — never performs a fetch (fetcher spy = 0 calls)
- [ ] TC-REG-4: config containing `apiKey`/`token`-like keys → rejected, error names the env-var alternative
- [ ] TC-REG-5: `createWorkerSafeProviders` omits `ddg-serp`; importing the worker-safe factory does not load `cheerio` (module-graph assertion)
- [ ] `npm run typecheck -w @seolite/providers` green

### Phase 2 — google-suggest + wikipedia-demand

**Goal:** both key-free keyword providers green with full edge matrix.

**Changes** — `src/google-suggest.ts`, `src/wikipedia-demand.ts` (templates in Approach).

```ts
// src/google-suggest.ts — core decision points
const res = await deps.fetcher.fetch(url);                       // UA via init headers
if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
if (res.status >= 400 || !(res.headers.get('content-type') ?? '').includes('json'))
  throw new BlockedError(this.name, `HTTP ${res.status} — likely CAPTCHA (documented brittle, A5)`);
const body: unknown = await res.json().catch(() => { throw new ParseError(this.name, 'non-JSON body'); });
if (!(Array.isArray(body) && Array.isArray(body[1]))) throw new ParseError(this.name, 'unexpected suggestion shape');
const ideas = (body[1] as string[]).map((term) => ({
  term, source: { provider: this.name, kind: 'gray' as const, attribution: this.attribution }, retrievedAt: deps.clock(),
}));
await deps.cache.set(cacheKey, ideas, deps.clock() + TTL_24H);   // cache write AFTER success
```

```ts
// src/wikipedia-demand.ts — honesty core
const idea: KeywordIdea = {
  term: seed,
  estimateLabel: `≈${views.toLocaleString('en-US')} views/28d on ${lang}.wikipedia "${article}" — demand proxy, not search volume`,
  lang, source: { provider: this.name, kind: 'heuristic', attribution: this.attribution },
};
// no article match → return []  (I3: omitted, never zero-filled)
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-SUG-1: fixture JSON `[q, [s…]]` → KeywordIdea[] with `source.kind === 'gray'` + attribution + retrievedAt
- [ ] TC-SUG-2: 429 + `Retry-After: 7` → `RateLimitedError` with `retryAfterMs === 7000`
- [ ] TC-SUG-3: second identical call performs 0 fetches (spy), returns equal ideas (24h cache)
- [ ] TC-SUG-4: non-JSON body → `blocked` when content-type is HTML (CAPTCHA), `parse_error` for other garbage
- [ ] TC-SUG-5: throttle: 100 concurrent ideas() with immediate fixtures issues ≤30 fetches/min (fake clock)
- [ ] TC-WIKI-1: fixtures (title hit + 28×dailies) → single idea, sum correct, `kind:'heuristic'`, estimateLabel says "demand proxy, not search volume"
- [ ] TC-WIKI-2: both requests carry contact UA header; throttle ≤60/min (fake clock)
- [ ] TC-WIKI-3: no title match → `[]`; 429 → `RateLimitedError` with Retry-After; malformed pageviews JSON → `ParseError`; cached second call = 0 fetches

### Phase 3 — pagespeed + crux (Google BYOK pair)

**Goal:** PSI lab/field split and CrUX quota/attribution semantics exact.

**Changes** — `src/pagespeed.ts`, `src/crux.ts`.

```ts
// src/pagespeed.ts — key policy (A4/BA5)
const key = deps.env(resolveEnvVar(this.name, this.cfg));
if (!key && o.automated) throw new NotConfiguredError(this.name, this.envVarName, 'required for automated queries');
// keyless trial proceeds with the 6/min throttle and source metadata noting trial mode
```

```ts
// src/pagespeed.ts — lab/field split (I3, BA7)
const lh = body.lighthouseResult;
const lab = { scores: mapScores(lh.categories), metrics: {
  lcp: lh.audits['largest-contentful-paint'].numericValue,
  cls: lh.audits['cumulative-layout-shift'].numericValue,
  tbt: lh.audits['total-blocking-time'].numericValue,
  fcn: lh.audits['first-contentful-paint'].numericValue,   // BA7: 'fcn' = FCP
} };   // each wrapped { value, source: { provider, kind: 'lab', attribution }, retrievedAt }
const field = body.loadingExperience ? {   // kind 'field'; OMITTED when absent — never zero (I3)
  overall: body.loadingExperience.overall_category,
  metrics: mapLoadingMetrics(body.loadingExperience.metrics) } : undefined;
```

```ts
// src/crux.ts — quota + attribution + null semantics (A1/A8/BA6)
static readonly DOCUMENTED_RPM = 150; static readonly DEFAULT_RPM = 140;   // invariant: never > 150
if (!key) throw new NotConfiguredError(this.name, this.envVarName, 'CrUX API requires a Google Cloud API key');
const res = await deps.fetcher.fetch(CRUX_ENDPOINT, { method: 'POST', headers: uaHeaders,
  body: JSON.stringify(scope === 'url' ? { url: url.href, formFactor } : { origin: url.origin, formFactor }) });
if (res.status === 404) { await cache.set(k, { record: null }, now + TTL_24H); return null; }  // honest absence
if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
return { metrics: mapMetrics(body.record.metrics), source: { provider: this.name, kind: 'field',
  attribution: ATTRIBUTION.crux, retrievedAt: deps.clock() } };   // CC BY 4.0 on EVERY record (I8)
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-PSI-1: full PSI fixture → scores 0–100 (0.98 → 98) + lcp/cls/tbt/fcn from audits, `kind:'lab'`
- [ ] TC-PSI-2: `automated:true` without key → `not_configured` naming `SEOLITE_PSI_API_KEY`, 0 fetches; keyless single call proceeds (trial)
- [ ] TC-PSI-3: 429 → `RateLimitedError`; Google error envelope `error.code` 429/403 → `rate_limited`; 500 → `upstream_error`
- [ ] TC-PSI-4: fixture without `loadingExperience` → field omitted, not zeroed; with it → `kind:'field'`
- [ ] TC-PSI-5: cache 6h — second call 0 fetches; keyless throttle ≤6/min, keyed ≤60/min (fake clock)
- [ ] TC-CRUX-1: absent key → `not_configured`, 0 fetches (never keyless — A1)
- [ ] TC-CRUX-2: fixture record → metrics `{name:{p75,histogramBins}}` mapped + `attribution` = CC BY 4.0 string on the record
- [ ] TC-CRUX-3: 404 no-data fixture → `null`; 429 → `RateLimitedError`; malformed → `ParseError`
- [ ] TC-CRUX-4: fake-clock burst of 200 calls issues ≤140/min and never >150 in any 60 s window (A1)
- [ ] TC-CRUX-5: cache 24h; `origin` vs `url` body scope per opts; formFactor default `PHONE`

### Phase 4 — openpagerank + tranco (authority pair)

**Goal:** BYOK Bearer provider and cached-list provider green.

**Changes** — `src/openpagerank.ts`, `src/tranco.ts`.

```ts
// src/openpagerank.ts — Bearer + batching + monthly quota (A2/BA8)
const u = new URL('https://openpagerank.com/api/v1.0/getPageRank');
batch.forEach((d, i) => u.searchParams.append(`domains[${i}]`, normalizeDomain(d)));   // ≤100 per batch
const res = await deps.fetcher.fetch(u, { headers: { Authorization: `Bearer ${key}`, ...uaHeaders } });
if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
for (const d of body.domains) {
  if (isQuotaError(d.error)) throw new RateLimitedError(this.name, undefined, { reason: 'monthly-quota' });
  out.push(sig(d.domain, 'score', d.page_rank_decimal ?? d.page_rank_integer),
           sig(d.domain, 'rank', d.rank));   // provenance flat fields per locked model (+retrievedAt/estimateLabel, A9)
}
```

```ts
// src/tranco.ts — resolve → download once → parse → cache (A7/BA3)
private async list(): Promise<TrancoList> {
  const fresh = await this.deps.cache.get<TrancoList>(CACHE_KEY);
  if (fresh && this.deps.clock() < fresh.fetchedAt + STALE_MS(14)) return this.touch(fresh); // ≤14d served, labeled
  const meta = await firstList(today, minus3Days);   // GET /api/lists/date/{d} → {list_id, download_path}; 404 → walk back
  const csv = await this.deps.fetcher.fetch(new URL(`https://tranco-list.eu${meta.download_path}`));  // 1 request
  const map = parseCsvStream(csv.body, maxRows);     // streamed, hard cap at maxRows (I15)
  await this.deps.cache.set(CACHE_KEY, { id: meta.list_id, map, fetchedAt: this.deps.clock() }, this.deps.clock() + REFRESH_MS(7));
  ...
}
// outside top-N → [] (I3); every signal: kind 'community' + Tranco attribution + list/date estimateLabel
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-OPR-1: absent key → `not_configured` naming `SEOLITE_OPENPAGERANK_API_KEY`, 0 fetches
- [ ] TC-OPR-2: fixture `{domains:[…]}` → score + rank signals with flat provenance + attribution; batches chunked ≤100; Bearer header present
- [ ] TC-OPR-3: 429 → `RateLimitedError`; per-domain quota error → `RateLimitedError{reason:'monthly-quota'}`; malformed → `ParseError`
- [ ] TC-OPR-4: throttle ≤50/min (fake clock); per-domain cache 30d — repeat domain = 0 fetches
- [ ] TC-TRC-1: fixtures (meta 200, CSV body) → Map built, rank lookups correct, `kind:'community'`, attribution + estimateLabel with list id/date
- [ ] TC-TRC-2: CSV capped at maxRows (fixture with 105 rows, maxRows 100); domain normalized (case/trailing dot)
- [ ] TC-TRC-3: today's meta 404 → falls back ≤3 days; cached list <14d → 0 fetches; >14d → `stale_cache`
- [ ] TC-TRC-4: Tranco attribution string present on every signal (A7/I8)

### Phase 5 — ddg-serp

**Goal:** gray SERP provider with strict brittleness detection and crawl-pace throttle.

**Changes** — `src/ddg-serp.ts`.

```ts
// src/ddg-serp.ts — parse + drift detection (A6)
const res = await deps.fetcher.fetch(new URL(`https://${host}?q=${encodeURIComponent(q)}`), { headers: ddgHeaders });
if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
if (res.status >= 400) throw new BlockedError(this.name, `HTTP ${res.status} — bot protection (documented brittle)`);
const html = await res.text();
if (/anomaly|challenge|captcha/i.test(html)) throw new BlockedError(this.name, 'challenge page');
const $ = cheerio.load(html);
const anchors = $('div.result:not(.result--ad) a.result__a').toArray();
const noResultsMarker = /no results/i.test($('.no-results').text() ?? '');
if (anchors.length === 0 && !noResultsMarker)
  throw new ParseError(this.name, 'layout drift: 0 result anchors and no no-results marker — provider needs updating');
const results = anchors.map((el, i) => ({ position: i + 1, url: decodeUddg($(el).attr('href')),
  title: $(el).text().trim(), snippet?, source: { provider: this.name, kind: 'gray', attribution: this.attribution },
  retrievedAt: deps.clock() })).slice(0, o.limit ?? 20);
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-DDG-1: fixture HTML → results with position 1..N, `uddg=` decoded to absolute URLs, ads excluded, `kind:'gray'` + attribution
- [ ] TC-DDG-2: 429 → `RateLimitedError` with Retry-After; HTTP ≥400 → `BlockedError`; throttle ≤6/min (fake clock, 1/10s spacing)
- [ ] TC-DDG-3: anomaly/challenge fixture → `BlockedError` (typed degraded path, documented)
- [ ] TC-DDG-4: HTML with neither anchors nor no-results marker → `ParseError`; empty SERP with marker → `[]`
- [ ] TC-DDG-5: lite-endpoint fallback fixture parses; second identical query within 1h = 0 fetches

### Phase 6 — Hardening, provenance sweep, docs, final green

**Goal:** whole-matrix sweep, I16 documentation, lint/typecheck, package ready for P4.

**Changes**
- `test/provenance-sweep.test.ts` — runs every provider against its full happy fixture and asserts: every emitted value carries `provider`, a valid `kind`, non-empty `attribution`, and `retrievedAt` (flat or wrapped form per model).
- `test/no-direct-fetch.test.ts` — source scan: `src/**` contains no direct `fetch(` usage (I12).

```ts
// test/no-direct-fetch.test.ts
it('providers never call global fetch directly (all HTTP via injected Fetcher, I12)', () => {
  for (const f of walkFiles('src'))
    expect(readFileSync(f, 'utf8'), f).not.toMatch(/(^|[^.\w])fetch\s*\(/);
});
```
- `README.md` (package) — provider table, per-provider "what data leaves the machine" (I16), brittleness notes for gray providers, BYOK setup for the three env vars, replacement guide for ddg-serp (I2).
- Lint/typecheck pass; exports test re-run; merge-readiness notes for orchestrator (A9 delta state recorded).

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-SHARED-6: provenance sweep green for all 7 providers (kind valid, attribution non-empty, retrievedAt present)
- [ ] TC-SHARED-7: no-direct-fetch scan green
- [ ] TC-SHARED-8: no error message/path from any provider fixture run contains the string of an injected fake key (`SEOLITE_TEST_KEY_123` probe)
- [ ] `npm run lint -w @seolite/providers` and `npm run typecheck -w @seolite/providers` green
- [ ] Package README includes the I16 data-flow table and gray-provider brittleness statements

## Testing Strategy

Principles: contract tests only, against **injected fetchers** returning fixtures shaped like the real APIs (research-verified shapes); fake clock/sleep/env everywhere; zero live network (I9/I10); each provider's throttle tested against its documented limit constant. Edge → test map:

| # | Edge (spec ref) | Test | Phase |
|---|---|---|---|
| 1 | typed errors carry provider name (I17) | TC-SHARED-1 | 0 |
| 2 | throttle ≤ documented limit, any 60s window (A1–A6) | TC-SHARED-2, TC-SUG-5, TC-WIKI-2, TC-PSI-5, TC-CRUX-4, TC-OPR-4, TC-DDG-2 | 0,2–5 |
| 3 | cache hit avoids second fetch (BA2) | TC-SUG-3, TC-WIKI-3, TC-PSI-5, TC-CRUX-5, TC-OPR-4, TC-TRC-3, TC-DDG-5 | 2–5 |
| 4 | cache TTL expiry under fake clock (I10) | TC-SHARED-4 | 0 |
| 5 | key param redaction (I16) | TC-SHARED-5, TC-SHARED-8 | 0,6 |
| 6 | provenance + attribution on every value (I3/I8) | TC-SHARED-6 (+ per-provider TCs) | 2–6 |
| 7 | no direct fetch (I12) | TC-SHARED-7 | 6 |
| 8 | key absent → NotConfigured, 0 fetches (I1) | TC-REG-3, TC-CRUX-1, TC-OPR-1, TC-PSI-2 | 1,3,4 |
| 9 | secret value in config rejected (I1) | TC-REG-4 | 1 |
| 10 | worker-safe wiring excludes ddg-serp (BA9/I6) | TC-REG-5 | 1 |
| 11 | 429 + Retry-After → rate_limited + retryAfterMs (A1–A6, I17) | TC-SUG-2, TC-WIKI-3, TC-PSI-3, TC-CRUX-3, TC-OPR-3, TC-DDG-2 | 2–5 |
| 12 | CAPTCHA/bot-block → blocked (A5/A6) | TC-SUG-4, TC-DDG-2/3 | 2,5 |
| 13 | malformed JSON/HTML → parse_error (I15) | TC-SUG-4, TC-WIKI-3, TC-CRUX-3, TC-OPR-3, TC-DDG-4 | 2–5 |
| 14 | layout drift detected (A6) | TC-DDG-4 | 5 |
| 15 | lab/field split; field omitted not zeroed (I3, BA7) | TC-PSI-1/4 | 3 |
| 16 | CrUX no-data → null, distinct from not_configured (A1, BA6) | TC-CRUX-3 vs TC-CRUX-1 | 3 |
| 17 | CrUX ≤150 qpm hard invariant (A1) | TC-CRUX-4 | 3 |
| 18 | OPR Bearer header + monthly quota typed error (A2) | TC-OPR-2/3 | 4 |
| 19 | Tranco row cap, fallback dates, stale ceiling, attribution (A7, BA3) | TC-TRC-1/2/3/4 | 4 |
| 20 | demand proxy honesty label; no-match → [] (I3, BA4) | TC-WIKI-1/3 | 2 |
| 21 | gray kind labels present (A9/I3) | TC-SUG-1, TC-DDG-1 | 2,5 |
| 22 | unknown provider name → error lists available names (I2) | TC-REG-1/2 (core registry integration re-verified at M2) | 1 |

Fixture discipline: one happy-path fixture + one per failure mode per provider, hand-written from the shapes recorded in research (PSI `lighthouseResult`/`loadingExperience`, CrUX `record.metrics.*.histogram`/`percentiles.p75`, OPR `domains[]`, suggest `[q,[...]]`, Wikimedia `items[].views`, Tranco `rank,domain` CSV, DDG `result__a`/`uddg`). No fixture may be fetched live; a `fixtures/README.md` pins the source URL + retrieval date for each shape.

## References

- Research: `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — §Seam 3 free data source matrix (provider limits/ToS rows), §Implicit Spec I1–I17, §Evidence Ledger (incl. refuted claims: CrUX keyless, OPR `API-OPR` header).
- Architecture: `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — packages table, Provider SPI signatures, payload required fields, config/BYOK rules, M1 sequencing.
- Spec: `./IMPLICIT_SPEC.md` — invariant bindings, aspect edges A1–A10, bounding assumptions BA1–BA12.
- External (evidence anchors, as captured in research ledger):
  - CrUX API (key required; 150 qpm verbatim; CC BY 4.0): developer.chrome.com/docs/crux/api, developer.chrome.com/docs/crux/methodology
  - PSI API v5 (key optional for trial; needed for automated): developers.google.com/speed/docs/insights/v5/get-started
  - Wikimedia API rate limits (contact UA; 200 req/min; 429+Retry-After): mediawiki.org/wiki/Wikimedia_APIs/Rate_limits; pageviews REST: wikimedia.org/api/rest_v1/
  - Open PageRank (Bearer; 60 req/min; monthly quota): openpagerank.keywordseverywhere.com/docs
  - Tranco (daily list; attribution): tranco-list.eu
  - Google autocomplete endpoint spec + gray posture: suggestqueries.google.com/complete/search?client=firefox (community-spec: fullstackoptimization.com)
  - DDG html/lite endpoints + bot-protection reports: html.duckduckgo.com/html, lite.duckduckgo.com/lite (community: duckduckgo-search issue reports)
  - Excluded by evidence: Programmable Search JSON API (closed to new customers; shutdown 2027-01-01), Bing Search API (retired 2025-08-11)
