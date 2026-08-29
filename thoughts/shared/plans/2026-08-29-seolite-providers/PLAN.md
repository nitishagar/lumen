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
reconciliation: ../2026-08-29-seolite/RECONCILIATION.md (R1–R10 override on conflict — R5 env names, R7 worker safety)
last_updated: 2026-08-29
last_updated_by: providers plan author (post-validation rework per PLAN_VALIDATION.md)
---

# SIGNPOST

**Aspect:** `providers` — the seven built-in data providers of seolite and their registry wiring (`packages/providers` → npm `@seolite/providers`).
**One-line goal:** every external data boundary of seolite implemented as a pure, provenance-labeled, paced SPI implementation over an injected core `Fetcher` — free-only, BYOK via R5 env-var names, honest about gray data.
**Scale:** large (7 providers + shared plumbing + registry wiring + full fixture contract suite).
**Owns:** `packages/providers/**` only. Depends on `@seolite/core` (M0, P1) types only; never on sibling branches (P2/P4/P5).
**Locked contract honored:** ARCHITECTURE.md SPI signatures (`KeywordProvider`, `SerpProvider`, `PageSpeedProvider`, `CruxProvider`, `AuthorityProvider` — including the per-domain `authority(domain: string, o)`), payload required fields, Fetcher interface, registry semantics (I2), BYOK-skip semantics (I1), per-provider attribution (I8); RECONCILIATION R1–R10 (R5 env names `SEOLITE_PSI_KEY`/`SEOLITE_CRUX_KEY`/`SEOLITE_OPR_KEY`; R7 worker safety).
**Key spec file:** `./IMPLICIT_SPEC.md` (invariant bindings A1–A10, provider contract matrix, bounding assumptions BA1–BA12). Numbers in this plan (150 qpm CrUX, 60 req/min OPR, 200 req/min Wikimedia, etc.) trace to evidence cited there.
**Done means:** all seven providers + wiring green under `npm test -w @seolite/providers` with zero network, zero wall-clock dependence, provenance + attribution + estimateLabel asserted on every emitted value.

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

Shared plumbing: typed error taxonomy (`NotConfiguredError`, `RateLimitedError`, `BlockedError`, `UpstreamError`, `ParseError`, timeout/stale codes — all carry the provider name, I17), per-source **GCRA pacing** whose worst-case rolling 60 s window (`burst + rate`) is provably ≤ each documented limit, a `CacheStore` port with TTL caching appropriate to each source, BYOK resolution by R5 env-var **name** at call time, and attribution constants (verbatim CrUX CC BY 4.0, Tranco, OPR) attached to every emitted value (I8). All seven names are exported and registered with capabilities so core's `createRegistry(config)` validates selection and rejects unknown names by listing these (I2).

Everything is Node-compatible and Worker-safe except `ddg-serp` (cheerio; the Worker parses no HTML per I6/R7) — a separate `createWorkerSafeProviders` export wires the other six.

## Current State

- Greenfield: the repository (`~/repos/learn/seolite`) currently contains only the `thoughts/` tree (research + this plan bundle). `packages/providers` does not exist.
- `packages/core` is planned in M0/P1 (`scaffold-core` bundle): Fetcher (SSRF-guarded, timeout/backoff/jitter per I12/I17, typed timeout/abort rejections), config loader, SPI interfaces, payload models (`KeywordIdea`, `SerpResult`, `PageSpeedReport`, `CruxRecord`, `AuthoritySignal`), provider SPI + registry. This plan codes against those locked shapes and records two additive deltas it requires (IMPLICIT_SPEC A9).
- No code exists to preserve; no tests exist; nothing is published.

## Desired End State

- `packages/providers` builds as `@seolite/providers` (ESM, TypeScript, Node ≥ 22, npm workspace), deps limited to `@seolite/core` + `cheerio` (ddg-serp only).
- Seven providers, each: provenance + attribution + (for heuristic/gray) estimateLabel on every emitted value; correct BYOK semantics (`not_configured` typed outcome when a required key is absent; config carries R5 env-var names only, secret values rejected); GCRA pacing whose worst-case rolling window never exceeds documented limits; caching appropriate to the source (mode-aware for PSI); typed errors with provider name and type-based timeout classification; no direct `fetch()` anywhere (core Fetcher only, I12).
- Registry wiring: `BUILTIN_PROVIDER_NAMES`, `createBuiltInProviders()`, `createWorkerSafeProviders()`, `registerBuiltIns()` exported and covered by tests (I2).

Verify commands (all must be green at the end of every phase's final state and at merge):

```bash
npm test -w @seolite/providers          # full contract suite (fixture-only, deterministic)
npm run typecheck -w @seolite/providers # tsc --noEmit
npm run lint -w @seolite/providers      # eslint (flat config, shared repo rules)
```

## What We're NOT Doing

- **No backlink graphs, keyword-volume databases, or clickstream traffic estimates** — no free source exists (research Seam 1+3 OUT rows); authority arrives only as Open PageRank/Tranco proxies.
- **No Google Programmable Search / Bing SERP provider** — Programmable Search is closed to new customers with full API shutdown 2027-01-01; Bing retired 2025-08-11 (IMPLICIT_SPEC A10). Future BYOK SERP providers (Brave, serper) plug in via the SPI; we build none now.
- **No caller-side OPR request batching/coalescing in v1** — the locked SPI is per-domain (`authority(domain: string, o)`); the documented 100-domain bulk call stays a recorded future caller-side optimization (A2/BA8).
- **No paid APIs in any default path; no keys, key values, or telemetry in this package** (I1/I16). No .env files created; keys live in the user's environment under R5 names.
- **No caching layer product** — only the `CacheStore` port + in-memory default; a persistent store is surfaces'/CLI's later injection.
- **No CLI/MCP/REST surface work** — that is P4 (`surfaces`); we ship SPI implementations + wiring only.
- **No HTML parsing outside ddg-serp** — no robots.txt logic, no crawling (audit-engine P2's job).
- **No live-network integration tests, no CI against real APIs** — quota-burning and non-deterministic (I9/I10); fixtures only. Manual live checks are documented as a maintainer task, never automated.
- **No per-file license headers** — root Apache-2.0 LICENSE suffices (research §Seam 5; headers are a "should").

## Approach

One package, seven provider modules + shared plumbing, built strictly TDD (each phase = failing contract tests first, then implementation). All HTTP flows through the injected core `Fetcher` (`fetch(url: URL, init?: RequestInit): Promise<Response>`); providers add what the Fetcher cannot know: per-source pacing, source-shaped parsing, provenance labeling, source-appropriate caching, and typed error mapping.

Call order inside every provider method (uniform template):

```
resolve key by R5 env-var NAME (if BYOK) → NotConfiguredError if required and absent
→ cache lookup (key = provider + mode + normalized inputs) → hit? return cached values
→ pacer.acquire() (GCRA: worst-case rolling window = burst + rate ≤ documented limit)
→ deps.fetcher.fetch(url, init { headers incl. UA, Authorization? })
→ map status/body → typed errors (429→rate_limited+Retry-After; 5xx→upstream_error;
   other 4xx/CAPTCHA→blocked; malformed JSON/HTML→parse_error; no-data→null/[]/omitted)
→ map to locked payload shapes with source{provider, kind, attribution, retrievedAt}
  (+ estimateLabel for heuristic/gray values)
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
export class BlockedError extends ProviderError {}               // gray CAPTCHA / bot protection / gray 4xx
export class UpstreamError extends ProviderError { constructor(p: string, readonly status: number, m?: string) { super('upstream_error', p, m ?? `upstream HTTP ${status}`); } }
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
// packages/providers/src/throttle.ts — GCRA leaky-bucket pacing (I10: injected clock/sleep).
// A classic token bucket (capacity = rpm) allows burst + refill = 2×rpm in a rolling 60 s window —
// ABOVE the documented CrUX 150 qpm / OPR 60 rpm. GCRA pacing guarantees worst-case window
// = burst + rate·60s, and resolvePacing clamps that sum to ≤ the documented limit.
export interface Pacer { acquire(): Promise<void>; tryAcquire(): boolean }
export class GcraPacer implements Pacer {
  constructor(readonly rpm: number, readonly burst: number,
              private clock: () => number, private sleep: (ms: number) => Promise<void>) {}
  /* TAT = max(prevTAT, now) + 60_000/rpm; conform iff now >= TAT − burst·60_000/rpm;
     conforming request advances TAT; non-conforming sleeps (acquire) or returns false (tryAcquire) */
}
export interface PacingCfg { rpm?: number; burst?: number }
export function resolvePacing(cfg: PacingCfg, defaults: { rpm: number; burst: number },
                              documentedLimit?: number): { rpm: number; burst: number } {
  let { rpm, burst } = { ...defaults, ...cfg };
  if (documentedLimit) {
    burst = Math.min(burst, Math.max(1, Math.floor(documentedLimit / 2)));  // burst can never eat the whole budget
    rpm = Math.min(rpm, documentedLimit - burst);                           // ⇒ worst window = burst + rpm ≤ limit
  }
  return { rpm, burst };
}
```

```ts
// packages/providers/src/cache.ts — core defines no cache contract; the port lives here (BA2)
export interface CacheStore { get<T>(key: string): Promise<T | undefined>; set<T>(key: string, v: T, expiresAtMs: number): Promise<void> }
export class InMemoryCache implements CacheStore { /* Map + expiry via injected clock */ }
```

```ts
// packages/providers/src/http.ts — typed JSON decode: malformed JSON is parse_error EVERYWHERE (I15),
// never a raw SyntaxError falling into withProviderErrors' upstream bucket.
export async function json(res: Response, provider: string): Promise<unknown> {
  try { return await res.json(); } catch { throw new ParseError(provider, 'malformed JSON body'); }
}
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

```ts
// packages/providers/src/with-errors.ts — TYPE-based classification (no message sniffing)
export function isTimeoutLike(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError'); // fetch-layer typed errors
}
export async function withProviderErrors<T>(name: string, op: () => Promise<T>): Promise<T> {
  try { return await op(); }
  catch (e) {
    if (e instanceof ProviderError) throw e;
    if (isTimeoutLike(e))  // covers core Fetcher timeouts AND surfaces' R7 capping-Fetcher aborts (detail.aborted)
      throw new ProviderError('timeout', name, 'fetch timed out or was aborted', { aborted: (e as Error).name === 'AbortError' });
    throw new UpstreamError(name, 0, String((e as Error)?.message ?? e));  // network/other — never classified by text
  }
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
  Omit<Record<BuiltinProviderName, Provider>, 'ddg-serp'>;     // 6 — no cheerio in Worker bundles (BA9/R7)
export function registerBuiltIns(registry: ProviderRegistry, config: ProvidersConfig, deps: ProviderDeps): void;
```

Capability map: `google-suggest`/`wikipedia-demand` → keyword; `ddg-serp` → serp; `pagespeed` → pagespeed; `crux` → crux; `openpagerank`/`tranco` → authority. `registerBuiltIns` calls core's registration method (adapted in one file, `src/registry-wiring.ts`, if P1's method name differs — blast radius contained, Phase 1 verifies by test). Config guards: provider section may set `envVar` (a NAME) and knobs (`refreshDays`, `maxRows`, `rpm`/`burst` overrides — clamped by `resolvePacing` so worst-case window stays ≤ documented limits); any value-like key (`/^(api[_-]?key|key|token|secret|password)$/i`) → ConfigError (I1).

```ts
// packages/providers/src/config.ts — I1 hardening: names yes, values never; R5 names
const SECRET_LIKE = /^(api[_-]?key|key|token|secret|password)$/i;
export function assertNoSecretValues(name: string, cfg: Record<string, unknown>): void {
  for (const k of Object.keys(cfg)) if (SECRET_LIKE.test(k))
    throw new ProviderError('not_configured', name,
      `put the key in an environment variable, not config — use "envVar" to NAME it`);
}
export function resolveEnvVar(name: string, cfg?: { envVar?: string }): string {
  const byProvider: Record<string, string> = {  // R5: scheme SEOLITE_<PROVIDER>_KEY
    pagespeed: 'SEOLITE_PSI_KEY',
    crux: 'SEOLITE_CRUX_KEY',
    openpagerank: 'SEOLITE_OPR_KEY',
  };
  return cfg?.envVar ?? byProvider[name];
}
```

```ts
// packages/providers/src/registry-wiring.ts
const DOCUMENTED_LIMITS: Partial<Record<BuiltinProviderName, number>> =
  { 'wikipedia-demand': 200, pagespeed: 240, crux: 150, openpagerank: 60 };  // A1–A4; suggest/ddg/tranco undocumented
const PACING_DEFAULTS: Record<BuiltinProviderName, { rpm: number; burst: number }> = {
  'google-suggest': { rpm: 30, burst: 5 }, 'wikipedia-demand': { rpm: 60, burst: 10 },
  pagespeed: { rpm: 60, burst: 10 }, crux: { rpm: 140, burst: 10 },
  openpagerank: { rpm: 50, burst: 10 }, tranco: { rpm: 0, burst: 0 }, 'ddg-serp': { rpm: 6, burst: 1 },
};
export function createBuiltInProviders(config: ProvidersConfig, deps: ProviderDeps): Record<BuiltinProviderName, Provider> {
  const pace = (n: BuiltinProviderName) => {
    const { rpm, burst } = resolvePacing(config[n] ?? {}, PACING_DEFAULTS[n], DOCUMENTED_LIMITS[n]);
    return new GcraPacer(rpm, burst, deps.clock, deps.sleep);
  };
  return {
    'google-suggest': new GoogleSuggestProvider(deps, pace('google-suggest')),
    'wikipedia-demand': new WikipediaDemandProvider(deps, pace('wikipedia-demand')),
    'pagespeed': new PageSpeedProvider(config.pagespeed, deps),   // builds keyed (60+10) & keyless (6+1) pacers internally
    'crux': new CruxProvider(config.crux, deps, pace('crux')),
    'openpagerank': new OpenPageRankProvider(config.openpagerank, deps, pace('openpagerank')),
    'tranco': new TrancoProvider(config.tranco, deps),
    'ddg-serp': new DdgSerpProvider(config['ddg-serp'], deps, pace('ddg-serp')),
  };
}
```

### Per-provider essentials (details in Phases)

- **google-suggest** — `GET https://suggestqueries.google.com/complete/search?client=firefox&hl=<lang>&q=<seed>` → `["seed", ["s1","s2",…]]`. Pacing 30/min + burst 5 (worst 35/min; undocumented endpoint). Cache 24h. Status split: 429 → `rate_limited`; 5xx → `upstream_error`; other 4xx or HTML content-type → `blocked` (CAPTCHA); JSON-garbage/shape mismatch → `parse_error`. Ideas labeled `kind: 'gray'` + `estimateLabel: "autocomplete suggestion — undocumented Google endpoint (gray)"`.
- **wikipedia-demand** — 2 calls: title match (`/w/rest.php/v1/search/title?q=&limit=1`) then 28-day daily pageviews (`wikimedia.org/api/rest_v1/metrics/pageviews/per-article/…/daily/{start}/{end}` ending today−2d). Contact UA on both (A3). Pacing 60/min + burst 10 (worst 70 ≤ 200). Sum → single KeywordIdea with `estimateLabel: "≈N views/28d on en.wikipedia \"<article>\" — demand proxy, not search volume"`, `kind: 'heuristic'`. No match → `[]` (I3 omit).
- **pagespeed** — `GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=&strategy=&category=…(&key=)`. Keyless trial when `automated !== true`; `automated && !key` → NotConfiguredError (A4/BA5). Pacing: keyed 60/min + burst 10; keyless 6/min + burst 1. Cache 6h per (**mode, url, strategy**) — keyed and trial entries never shared. Lab: `lighthouseResult.categories.*.score × 100` + audits (`largest-contentful-paint`, `cumulative-layout-shift`, `total-blocking-time`, `first-contentful-paint` → model field `fcn`, BA7) as `kind: 'lab'`. Field: `loadingExperience.metrics.*.percentile` as `kind: 'field'`, omitted when absent (low-traffic origins — never zero-fill). Google error envelope `{error:{code,message}}` mapped: 429/403-quota → `rate_limited`; malformed JSON → `parse_error` (shared `json()` helper).
- **crux** — `POST https://chromeuxreport.googleapis.com/v4/records:queryRecord?key=…`, body `{origin|url, formFactor}`. Key REQUIRED (A1). GCRA hard-guaranteed: rate 140/min + burst 10 → worst-case rolling window exactly 150 = documented limit, never above (A1). Cache 24h per (scope, formFactor, url). HTTP 404 "no data" → `null` (contract meaning: not in dataset — distinct from `not_configured`, BA6). Every record: `source { provider:'crux', kind:'field', attribution: VERBATIM_CC_BY_STRING, retrievedAt }` where the verbatim string is `The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license` + methodology URL (A8/I8).
- **openpagerank** — **per-domain** (locked SPI `authority(domain: string, o)`): GET `https://openpagerank.com/api/v1.0/getPageRank?domains[0]=<domain>` (documented bulk param with a single element), header `Authorization: Bearer <key>` (A2: the stale `API-OPR` header is NOT used). Pacing 50/min + burst 10 → worst rolling window exactly 60 = documented limit. Per-domain cache 30d. Response `{domains:[{domain, rank, page_rank_integer, page_rank_decimal, status_code, error}]}` → AuthoritySignal `{domain, kind:'score', value: page_rank_decimal}` + `{kind:'rank', value: rank}`; a per-domain **quota** error → `RateLimitedError{detail.reason:'monthly-quota'}`; any other per-domain error or missing/non-finite values → that domain's signals **omitted** (`[]`, I3 — never `value: undefined`). Attribution string attached (BA8). The documented 100-domain bulk call is a future caller-side optimization, out of v1 scope.
- **tranco** — free tier has no per-domain query API → download-and-index (BA3): resolve `GET https://tranco-list.eu/api/lists/date/{yyyy-mm-dd}` → `{list_id, download_path}` (walk back ≤3 days if today unpublished; **all 4 dates 404 on first run → typed `upstream_error` — defined outcome, 0 CSV fetches**) → single download of `download_path` → stream-parse CSV `rank,domain` up to `maxRows` (default 100,000) → in-process Map, persisted to CacheStore with 7-day expiry. Staleness disclosed as `estimateLabel: "Tranco rank (list <id>, <date>, top <rows>)"`; cached list older than 14 days → `stale_cache`. Outside top-N → omitted (`[]`). Every signal: `kind:'community'`, attribution `"Tranco top-sites ranking — https://tranco-list.eu (Le Pochat et al.) — CC BY 4.0"` (A7).
- **ddg-serp** — `GET https://html.duckduckgo.com/html/?q=…` (primary; `lite.duckduckgo.com/lite/?q=` fallback), cheerio parse of `a.result__a` (+ `result__snippet`), `uddg=` param URL-decoded, `.result--ad` filtered, positions 1..N. Pacing 6/min (10 s spacing) + burst 1 → worst 7/min. Cache 1h. Per-endpoint status split: 429 → `rate_limited` (NO fallback — back off); 5xx → `upstream_error` (NO fallback); other 4xx or challenge/anomaly markers → `blocked`; 0 anchors with no no-results marker → `parse_error` (layout drift). **Lite-fallback trigger (defined): exactly one fallback per `search()` call, and only when the PRIMARY endpoint yields `parse_error` (drift) or `blocked` (challenge); failures of the lite endpoint propagate their own typed errors unchanged.** Values labeled `kind:'gray'` + `estimateLabel`; brittleness documented in package README (A6).

## Design Analysis

### Invariants → mechanism

| Invariant | Mechanism in this package | Verified by |
|---|---|---|
| I1 zero-cost + BYOK-skip | R5 env-var NAME in config (`SEOLITE_PSI_KEY`/`SEOLITE_CRUX_KEY`/`SEOLITE_OPR_KEY`); value resolved via `deps.env` at call time; absent required key → `NotConfiguredError` (engine catches → "not configured" surface result, BA6); value-like config keys rejected; keyless calls never made to key-required endpoints (CrUX always; PSI when `automated`) | TC-REG-3/4/6, TC-CRUX-1, TC-PSI-2, TC-OPR-1 |
| I2 pluggability | all vendor calls live here; `BUILTIN_PROVIDER_NAMES` + capability map + `registerBuiltIns`; unknown-name error is core's, fed by our name list; ddg-serp replaceable by any SerpProvider via config/registry without surface changes | TC-REG-1/2/5 |
| I3 honesty | `kind` labels per matrix (incl. `gray`); `estimateLabel` on ALL heuristic/gray outputs (suggest included); failure → `null`/`[]`/omitted field/skipped per-domain signal, never zero, never `value: undefined`; lab vs field kept distinct inside PageSpeedReport | TC-SHARED-6, TC-SUG-1, TC-WIKI-1, TC-PSI-4, TC-CRUX-3, TC-OPR-3 |
| I4 etiquette | contact UA on every request via deps; per-source GCRA pacing (worst window ≤ documented limit); Retry-After honored (Fetcher retries; provider parses final header into `retryAfterMs`); tranco downloads ≤1 meta+1 CSV per window | TC-SHARED-2/3, TC-DDG-2 |
| I8 attribution | `ATTRIBUTION` constants (CrUX = verbatim CC BY 4.0 sentence + methodology URL); attached to every emitted value; constants exported for site display | TC-SHARED-6, TC-CRUX-2, TC-TRC-4 |
| I9/I10 | injected fetcher/clock/sleep/env/cache in 100% of tests; fixtures static; fake clock for TTL/pacing | TC-SHARED-1..5 |
| I12 SSRF | zero direct `fetch(` in `src/**` (source-scan test); every call goes through injected core Fetcher | TC-SHARED-7 |
| I15 boundaries | malformed JSON → `parse_error` via shared typed `json()` helper (all providers); malformed/unexpected HTML → `parse_error`; CAPTCHA → `blocked`; 5xx → `upstream_error` (distinct); oversized CSV streamed + capped; domain normalization before lookups | TC-SHARED-9, TC-SUG-4, TC-PSI-6, TC-DDG-3/4, TC-TRC-2 |
| I16 privacy | README data-flow table; `redactUrl` strips `key`/`token` params from any message/URL string; keys never interpolated into errors | TC-SHARED-5, TC-SHARED-8 |
| I17 retry/backoff | single retry owner = core Fetcher (providers never retry → no double-retry); providers parse final Retry-After; typed errors always carry provider name; timeout classification is TYPE-based (`AbortError`/`TimeoutError`), never message sniffing | TC-SHARED-1, TC-SHARED-10, TC-*-429 tests |

### Failure handling (stimulus → typed outcome)

| Stimulus | Outcome | Notes |
|---|---|---|
| required key absent | `ProviderError('not_configured')` with `envVar` + setup hint | engine renders explicit skip (I1); never a keyless call; PSI exempt when `automated !== true` (BA5) |
| HTTP 429 (+Retry-After) | `RateLimitedError(retryAfterMs?)` | header parsed per source; core Fetcher already retried |
| HTTP 5xx (any provider, incl. suggest/ddg) | `UpstreamError(status)` | retryable class — core Fetcher already exhausted bounded retries; NEVER reported as "CAPTCHA" |
| CAPTCHA / anomaly / challenge page, other 4xx from gray endpoints | `BlockedError` | gray providers (suggest, ddg); documented degraded path |
| fetcher timeout / abort (typed: `AbortError`, `TimeoutError`) | `ProviderError('timeout')` with `detail.aborted` | type-based classification; also covers surfaces' R7 capping-Fetcher aborts |
| other network error | `UpstreamError(status 0)` | wrapped via `withProviderErrors`; no message-text classification |
| malformed JSON | `ParseError` | via shared `json()` helper in every provider (TC-SHARED-9, TC-PSI-6) |
| HTML layout drift (0 anchors, no no-results marker) | `ParseError` | conservative: treat as breakage, not empty SERP; triggers ONE ddg lite fallback |
| DDG lite fallback | fires only on primary `parse_error`/`blocked`, once per call; never on 429/5xx | lite failures propagate their own typed errors |
| CrUX 404 "no data" | `null` record | honest absence, distinct from not-configured (BA6) |
| OPR per-domain quota error | `RateLimitedError(detail.reason='monthly-quota')` | A2 |
| OPR per-domain non-quota error / missing values | that domain's signals omitted (`[]`) | I3 — never `value: undefined` |
| Tranco first run, all 4 list dates 404 | `UpstreamError('no Tranco list published in the last 3 days — retry later')` | defined outcome; 0 CSV fetches |
| Tranco cached list >14d and refresh failed | `ProviderError('stale_cache')` | <14d served with staleness label |
| domain/origin absent from list | `[]` (omitted) | I3 never zero-fill |

### Blast radius

- **New package only.** No existing package changes behavior. Consumers (enumerated per ARCHITECTURE M1): **P2 audit-engine** consumes the registry for CWV enrichment (PSI+CrUX per page — a 25-page audit = 50 CrUX + 50 PSI calls; at pace 140/min and 60/min keyed these complete in ≥22 s and ≥50 s respectively, within every limit); **P4 surfaces** (CLI/MCP/Worker wiring via `registerBuiltIns`); **site-docs** imports the exported `ATTRIBUTION` constants for I8 display. Until P2/P4 merge, no runtime consumer exists — but the registry API is exercised by P2's no-op-provider registry tests first (merge order P2 → P3 → P4).
- **Core deltas are 3 additive one-liners** (A9: `'gray'` in ProvenanceKind; optional `source`/`retrievedAt` on SerpResult; optional `retrievedAt`/`estimateLabel` on AuthoritySignal). If not already landed in core when P3 starts, they are applied additively in this branch (conflict-free by construction); Phase 0's compile test verifies them.
- **Runtime risk is contained per provider**: gray providers can only fail typed (`rate_limited`/`blocked`/`upstream_error`/`parse_error`) — surfaces degrade honestly; nothing here can crash the engine with an untyped error.
- **Registry adaptation** (`registerBuiltIns` → core's method) is isolated in `src/registry-wiring.ts`; a signature mismatch is a one-file fix. Opts normalization likewise isolated in `src/opts-bridge.ts` (Phase 1).
- **Pacing/cache bugs cannot leak across providers** — each provider owns its own pacer instance and cache-key namespace.

### Alternatives considered (decision + why)

1. **NotConfigured as result-union vs typed error** → typed error. The SPI signatures are locked (`Promise<CruxRecord|null>`, `Promise<KeywordIdea[]>`, …); a union would change core SPI. CrUX `null` stays reserved for "no data" (BA6). Rejected alternative: overloading `null` for both meanings — collision of semantics.
2. **Cache in core vs providers-local port** → providers-local `CacheStore` port + `InMemoryCache`. Core's locked scope has no cache contract; a file/SQLite store can be injected by P4 later without changes here (BA2).
3. **Classic token bucket vs GCRA pacing** → GCRA. A classic bucket (capacity = rpm) permits ~2×rpm in a rolling 60 s window — above CrUX's hard 150 qpm and OPR's 60 req/min (A1/A2). GCRA guarantees worst-case window = burst + rate, and `resolvePacing` clamps that sum ≤ documented limit; ddg's 10 s spacing was already pacing in spirit — the mechanism is now uniform and provable (TC-SHARED-2, TC-CRUX-4).
4. **OPR multi-domain batching vs per-domain requests** → per-domain. The locked SPI is `authority(domain: string, o)` — one domain per call; batching would require a core SPI change or an undeclared micro-batch buffer. Cost impact recorded honestly in the quota table (500 domains ≈ 500 req ≈ ~10 min at pace). The documented 100-domain bulk call remains a future caller-side coalescing optimization, explicitly out of v1 scope (A2/BA8).
5. **PSI: always require key vs trial-keyless** → trial-keyless for single interactive calls, key required when `automated` (mirrors Google's own docs language, A4/BA5); keyless pacing 6/min + burst 1 keeps trial mode far from undocumented unauthenticated bounds; keyed and trial results cached under separate keys so a trial result can never be served to a keyed/automated call (and vice versa).
6. **DDG: html vs lite endpoint, GET vs POST** → GET html primary with ONE lite fallback on drift/challenge only (never on 429/5xx — backing off is the correct response to rate limiting); no POST retries beyond core policy — conservative against bot protection.
7. **cheerio vs regex parsing for ddg-serp** → cheerio (locked by ARCHITECTURE for DOM parsing; Node-only, BA9).
8. **Provider-level retry vs core-only retry** → core-only (I17 single owner); providers map final outcomes. Rejected: double-retry multiplies load on fragile gray endpoints.
9. **`'gray'` mapped to `'community'` vs new enum literal** → new literal `'gray'`. I3 honesty is a product feature; collapsing gray into community would mislabel undocumented endpoints.
10. **Timeout classification by message regex vs typed errors** → typed. Message sniffing (`/timeout|abort/i`) misclassifies upstream bodies/aborts; classification now uses fetch-layer typed markers (`AbortError`/`TimeoutError` names), with `detail.aborted` distinguishing aborts.

### Defaults (locked here, all recorded as bounding assumptions BA1–BA12)

Pacing (GCRA rate + burst → worst rolling 60 s window): suggest 30+5→35 · wikipedia 60+10→70 · PSI keyed 60+10→70, keyless 6+1→7 · CrUX 140+10→150 (= documented 150, never above) · OPR 50+10→60 (= documented 60, never above) · tranco 1 meta GET + 1 CSV per 7d · ddg 6/min paced + burst 1 → worst 7. Overrides clamped so worst-case ≤ documented limit (`resolvePacing`, TC-REG-6). Cache TTLs: suggest 24h · wikipedia 24h · PSI 6h (key includes keyed/trial mode) · CrUX 24h · OPR 30d/domain · tranco 7d refresh / 14d stale ceiling · ddg 1h. R5 env names: `SEOLITE_PSI_KEY`, `SEOLITE_CRUX_KEY`, `SEOLITE_OPR_KEY`. Tranco top 100k rows. en.wikipedia only; 28-day window ending today−2d. DDG lite fallback: once per call, on drift/challenge only. Tranco first-run all-404 → `upstream_error`.

## Resource & Cost Analysis

Cost: **$0.00** — every provider is free-tier or key-free (I1). Free-tier quota budget per provider:

| Provider | Documented limit (evidence ref) | Default client pacing | Cache | Request cost per unit | Budget check (typical run) |
|---|---|---|---|---|---|
| google-suggest | undocumented; 429/CAPTCHA at scale (A5) | 30/min + burst 5 → worst 35/min | 24h | 1 GET / seed+lang | 20 seeds ≈ 20 req over ≥40 s — far under observed break points |
| wikipedia-demand | 200 req/min w/ contact UA; 429+Retry-After (A3) | 60/min + burst 10 → worst 70/min | 24h | 2 GET / seed (title match + 28d dailies) | 20 seeds = 40 req ≪ 200/min cap |
| pagespeed | ~25k/day, 240/min `[R]` corroborated; key needed for automated (A4) | keyed 60/min + burst 10 → worst 70; keyless 6/min + burst 1 | 6h (mode in key) | 1 GET / (mode, url, strategy) | 100-page audit keyed ≈ 100 req = 0.4% of daily quota |
| crux | **150 qpm/project, not increasable by payment** (A1) | 140/min + burst 10 → worst window exactly 150 | 24h | 1 POST / (origin\|url, formFactor) | 100 origins ≈ 43 s min duration; worst window provably ≤ 150 |
| openpagerank | 60 req/min + monthly domain quota (~30k domains/month docs example) (A2) | 50/min + burst 10 → worst window exactly 60; **per-domain requests** | 30d/domain | 1 GET / domain | 500 fresh domains ≈ **500 req ≈ ~10 min** at 50/min pacing; monthly domain quota unchanged ≈ 1.7% of the ~30k example; caller-side bulk batching out of v1 scope (future) |
| tranco | daily list; attribution required (A7) | 1 meta GET + 1 CSV download per ≤7 days | 7d refresh | 2 requests + ~2–3 MB gz per refresh | ≈ **8–10 requests/month** (4–5 refreshes × 2) and ≈ **9–13 MB/month** bandwidth |
| ddg-serp | undocumented; active bot protection (A6) | 6/min paced (10 s spacing) + burst 1 → worst 7/min | 1h | 1 GET / query | 20 rank checks ≈ 20 req over ≥3.3 min — deliberately crawl-pace |

Aggregate worst case for the M1/M2 consumer profile (P2 audit of 25 pages → 50 CrUX + 50 PSI calls; P4: 20 keyword lookups + 5 rank checks): CrUX 50 calls ≥ 22 s at pace; PSI keyed 50 calls ≥ 50 s; every worst-case rolling window stays ≤ its documented limit by GCRA construction. Total monthly cost unchanged at $0. CI cost: tests are offline (fixtures), so CI minutes ≈ seconds (public repo = free).

## Phases

> Every phase: write failing contract tests first (fixtures + fake clock), then implement until green. Snippets only — full files land in the branch. Phase N+1 starts only when Phase N is green.

### Phase 0 — Package scaffold + shared plumbing

**Goal:** `@seolite/providers` exists with error taxonomy, typed JSON decode, redaction, GCRA pacing + clamp, cache port, deps, provenance/attribution constants, and the A9 core-delta check.

**Changes**
- `packages/providers/package.json` — name `@seolite/providers`, ESM, `"exports": { ".": "./src/index.ts" }` (ts-down/tsc per repo convention), deps: `@seolite/workspace:*` core + `cheerio` (ddg-serp phase); dev: vitest.
- `src/errors.ts`, `src/redact.ts`, `src/throttle.ts`, `src/cache.ts`, `src/http.ts`, `src/deps.ts`, `src/provenance.ts`, `src/with-errors.ts` — as snippeted in Approach.

```ts
// src/provenance.ts — A8/I8 constants (single source of truth; site-docs renders from these exports)
export const ATTRIBUTION = {
  crux: 'The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license (https://developer.chrome.com/docs/crux/methodology)',
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
- [ ] TC-SHARED-2 (GCRA worst-case window): with sustained demand under fake clock, every rolling 60 s window conforms ≤ `burst + rpm`; for limit-bearing providers `burst + rpm ≤ documentedLimit` (assert from `resolvePacing` output) — achievable by construction
- [ ] TC-SHARED-3: `acquire()` sleeps until conforming (injected sleep) and sustained accepts are spaced `60_000/rpm` apart under fake clock; `tryAcquire` returns false beyond burst
- [ ] TC-SHARED-4: `InMemoryCache` returns `undefined` after TTL expiry under fake clock
- [ ] TC-SHARED-5: `redactUrl` replaces `key`/`token` params; original URL object unmutated
- [ ] TC-SHARED-9: malformed JSON through the shared `json()` helper → `parse_error` (never `upstream_error`)
- [ ] TC-SHARED-10: `withProviderErrors` classifies `AbortError`/`TimeoutError` → `timeout` (with `detail.aborted`), other errors → `upstream_error`; a rejection whose message merely contains "abort"/"timeout" is NOT classified by text
- [ ] A9 compile test passes (or A9 edits applied additively to core in this branch)
- [ ] `npm run typecheck -w @seolite/providers` green

### Phase 1 — Registry wiring + contract-test harness

**Goal:** all seven names exported, wired with capabilities + clamped pacing, BYOK config guards in place; harness for fixture-driven contract tests finished.

**Changes**
- `src/index.ts`, `src/registry-wiring.ts`, `src/config.ts`, `src/opts-bridge.ts` — exports, R5 env resolution, pacing clamp, guards per Approach; **`src/opts-bridge.ts` is scheduled here**: normalizes core opts (`IdeasOpts`/`SearchOpts`/report/crux/authority opts) to provider-local shapes so every provider consumes normalized opts (BA12).

```ts
// src/opts-bridge.ts — single adaptation point between core opts and provider internals (BA12)
export interface DemandOpts { lang?: string }
export function toDemandOpts(o: IdeasOpts): DemandOpts { return { lang: (o as { lang?: string }).lang }; }
/* analogous toSearchOpts / toReportOpts / toCruxOpts / toAuthorityOpts — one file, one job */
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-REG-1: `BUILTIN_PROVIDER_NAMES` contains exactly the 7 names (I2)
- [ ] TC-REG-2: each wired provider declares its capability (keyword/serp/pagespeed/crux/authority)
- [ ] TC-REG-3 (BA5-aligned): `crux` and `openpagerank` with absent key (stub `env` → undefined) reject with `not_configured` naming `SEOLITE_CRUX_KEY` / `SEOLITE_OPR_KEY` respectively — 0 fetches (fetcher spy); `pagespeed` with absent key rejects ONLY when `automated: true` (naming `SEOLITE_PSI_KEY`) and proceeds keyless when `automated: false`
- [ ] TC-REG-4: config containing `apiKey`/`token`-like keys → rejected, error names the env-var alternative
- [ ] TC-REG-5: `createWorkerSafeProviders` omits `ddg-serp`; importing the worker-safe factory does not load `cheerio` (module-graph assertion)
- [ ] TC-REG-6 (override clamp): `resolvePacing` with crux `{rpm: 500}` → `{rpm: 140, burst: 10}` (worst 150); with `{rpm: 150, burst: 50}` → burst clamped ≤ 75 and `rpm + burst ≤ 150` always; providers without documented limits pass overrides through
- [ ] `npm run typecheck -w @seolite/providers` green

### Phase 2 — google-suggest + wikipedia-demand

**Goal:** both key-free keyword providers green with full edge matrix.

**Changes** — `src/google-suggest.ts`, `src/wikipedia-demand.ts` (templates in Approach).

```ts
// src/google-suggest.ts — status/body mapping (A5)
const res = await deps.fetcher.fetch(url, { headers: uaHeaders });
if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
if (res.status >= 500) throw new UpstreamError(this.name, res.status);          // retryable class, NOT "CAPTCHA"
if (res.status >= 400) throw new BlockedError(this.name, `HTTP ${res.status} from gray endpoint`);
if ((res.headers.get('content-type') ?? '').includes('html'))
  throw new BlockedError(this.name, 'HTML body — likely CAPTCHA (documented brittle, A5)');
const body = await json(res, this.name);                                        // malformed → parse_error
if (!(isSuggestShape(body))) throw new ParseError(this.name, 'unexpected suggestion shape');
const ideas = body[1].map((term: string) => ({
  term,
  estimateLabel: 'autocomplete suggestion — undocumented Google endpoint (gray)',  // I3
  source: { provider: this.name, kind: 'gray' as const, attribution: this.attribution },
  retrievedAt: deps.clock(),
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
- [ ] TC-SUG-1: fixture JSON `[q, [s…]]` → KeywordIdea[] with `source.kind === 'gray'`, attribution, retrievedAt, AND `estimateLabel` present on every idea
- [ ] TC-SUG-2: 429 + `Retry-After: 7` → `RateLimitedError` with `retryAfterMs === 7000`
- [ ] TC-SUG-3: second identical call performs 0 fetches (spy), returns equal ideas (24h cache)
- [ ] TC-SUG-4 (mapping fixed): 500 fixture → `upstream_error`; 403 → `blocked`; HTML content-type → `blocked`; JSON content-type with garbage body → `parse_error`
- [ ] TC-SUG-5: 100 concurrent ideas() with immediate fixtures: burst 5 immediate, ≤35 in any rolling 60 s window (fake clock)
- [ ] TC-WIKI-1: fixtures (title hit + 28×dailies) → single idea, sum correct, `kind:'heuristic'`, estimateLabel says "demand proxy, not search volume"
- [ ] TC-WIKI-2: both requests carry contact UA header; pacing ≤70/min worst window ≤ 200 documented (fake clock)
- [ ] TC-WIKI-3: no title match → `[]`; 429 → `RateLimitedError` with Retry-After; malformed pageviews JSON → `ParseError`; cached second call = 0 fetches

### Phase 3 — pagespeed + crux (Google BYOK pair)

**Goal:** PSI lab/field split and CrUX quota/attribution semantics exact.

**Changes** — `src/pagespeed.ts`, `src/crux.ts`.

```ts
// src/pagespeed.ts — key policy (A4/BA5) + mode-aware cache key
const key = deps.env(resolveEnvVar(this.name, this.cfg));        // R5: SEOLITE_PSI_KEY
if (!key && o.automated) throw new NotConfiguredError(this.name, this.envVarName, 'required for automated queries');
const mode = key ? 'keyed' : 'trial';
const ck = `psi:${mode}:${strategy}:${url.href}`;                // keyed and trial entries NEVER shared
// pacers: keyed = resolvePacing(cfg, {rpm:60,burst:10}, 240); keyless = {rpm:6,burst:1}
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
if (!key) throw new NotConfiguredError(this.name, this.envVarName, 'CrUX API requires a Google Cloud API key');
const res = await deps.fetcher.fetch(CRUX_ENDPOINT, { method: 'POST', headers: uaHeaders,
  body: JSON.stringify(scope === 'url' ? { url: url.href, formFactor } : { origin: url.origin, formFactor }) });
if (res.status === 404) { await cache.set(k, { record: null }, now + TTL_24H); return null; }  // honest absence
if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
return { metrics: mapMetrics(body.record.metrics), source: { provider: this.name, kind: 'field',
  attribution: ATTRIBUTION.crux, retrievedAt: deps.clock() } };  // VERBATIM CC BY 4.0 on EVERY record (I8)
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-PSI-1: full PSI fixture → scores 0–100 (0.98 → 98) + lcp/cls/tbt/fcn from audits, `kind:'lab'`
- [ ] TC-PSI-2 (R5 + BA5): `automated:true` without key → `not_configured` naming `SEOLITE_PSI_KEY`, 0 fetches; `automated:false` without key → keyless trial call proceeds
- [ ] TC-PSI-3: 429 → `RateLimitedError`; Google error envelope `error.code` 429/403 → `rate_limited`; 500 → `upstream_error`
- [ ] TC-PSI-4: fixture without `loadingExperience` → field omitted, not zeroed; with it → `kind:'field'`
- [ ] TC-PSI-5: keyed and keyless calls never share cache entries (mode in key); cache 6h — second call 0 fetches; keyed worst window ≤70 ≤240, keyless ≤7 (fake clock)
- [ ] TC-PSI-6: truncated/invalid JSON fixture → `parse_error` (never `upstream_error`)
- [ ] TC-CRUX-1: absent key → `not_configured` naming `SEOLITE_CRUX_KEY`, 0 fetches (never keyless — A1)
- [ ] TC-CRUX-2: fixture record → metrics `{name:{p75,histogramBins}}` mapped + `attribution` equals the verbatim CC BY 4.0 string (A8)
- [ ] TC-CRUX-3: 404 no-data fixture → `null`; 429 → `RateLimitedError`; malformed → `ParseError`
- [ ] TC-CRUX-4 (worst-case window): fake-clock burst of 10 immediate tries succeeds, 11th waits; with continuous demand, total conforming requests in any rolling 60 s window = 150 ≤ documented 150, never above (GCRA construction; A1)
- [ ] TC-CRUX-5: cache 24h; `origin` vs `url` body scope per opts; formFactor default `PHONE`

### Phase 4 — openpagerank + tranco (authority pair)

**Goal:** per-domain BYOK Bearer provider and cached-list provider green.

**Changes** — `src/openpagerank.ts`, `src/tranco.ts`.

```ts
// src/openpagerank.ts — per-domain (locked SPI), Bearer, quota, honest omission (A2/BA8)
async authority(domain: string, o: AuthorityOpts): Promise<AuthoritySignal[]> {
  return withProviderErrors(this.name, async () => {
    const key = this.key(); if (!key) throw new NotConfiguredError(this.name, this.envVarName, 'free key from openpagerank');
    const ck = `opr:${normalizeDomain(domain)}`;
    const cached = await this.deps.cache.get<AuthoritySignal[]>(ck); if (cached) return cached;   // 30d/domain
    await this.pacer.acquire();   // 50/min + burst 10 → worst rolling window exactly 60 = documented (A2)
    const u = new URL('https://openpagerank.com/api/v1.0/getPageRank');
    u.searchParams.set('domains[0]', normalizeDomain(domain));   // documented bulk param, single element in v1
    const res = await this.deps.fetcher.fetch(u, { headers: { Authorization: `Bearer ${key}`, ...uaHeaders } });
    if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
    if (res.status >= 500) throw new UpstreamError(this.name, res.status);
    const body = await json(res, this.name);
    const d = (body as OprBody).domains?.[0];
    if (!d) throw new ParseError(this.name, 'response without domains[]');
    if (isQuotaError(d)) throw new RateLimitedError(this.name, undefined, { reason: 'monthly-quota' });  // A2
    if (d.error || d.status_code !== 200) return [];   // per-domain not-found/other → OMIT signals (I3)
    const score = d.page_rank_decimal ?? d.page_rank_integer;
    const signals = [
      Number.isFinite(score) ? sig(domain, 'score', score) : null,
      Number.isFinite(d.rank) ? sig(domain, 'rank', d.rank) : null,
    ].filter((s): s is AuthoritySignal => s !== null);              // NEVER value: undefined (I3)
    await this.deps.cache.set(ck, signals, this.deps.clock() + TTL_30D);
    return signals;
  });
}
// future (out of v1): caller-side coalescing could restore the documented 100-domain bulk call (BA8)
```

```ts
// src/tranco.ts — resolve → download once → parse → cache (A7/BA3)
private async list(): Promise<TrancoList> {
  const fresh = await this.deps.cache.get<TrancoList>(CACHE_KEY);
  if (fresh && this.deps.clock() - fresh.fetchedAt <= STALE_MS(14)) return this.touch(fresh); // ≤14d served, labeled
  const meta = await firstPublishedList(today, minus3Days);  // GET /api/lists/date/{d} → {list_id, download_path}; 404 → next older
  if (!meta) throw new ProviderError('upstream_error', this.name,
    'no Tranco list published in the last 3 days (tranco-list.eu) — retry later');   // defined first-run outcome
  const csv = await this.deps.fetcher.fetch(new URL(`https://tranco-list.eu${meta.download_path}`));  // 1 request
  const map = parseCsvStream(csv.body, maxRows);             // streamed, hard cap at maxRows (I15)
  await this.deps.cache.set(CACHE_KEY, { id: meta.list_id, map, fetchedAt: this.deps.clock() },
    this.deps.clock() + REFRESH_MS(7));                      // refresh failure with fresh absent → propagates; fresh >14d → stale_cache
  ...
}
// outside top-N → [] (I3); every signal: kind 'community' + Tranco attribution + list/date estimateLabel
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-OPR-1: absent key → `not_configured` naming `SEOLITE_OPR_KEY`, 0 fetches
- [ ] TC-OPR-2 (per-domain): request URL carries exactly `domains[0]=example.com` + `Authorization: Bearer` header; fixture `{domains:[{…page_rank_decimal…}]}` → score + rank signals with flat provenance + attribution; no batch loop exists in the module (source assertion)
- [ ] TC-OPR-3: fixture with one ok domain + one `error`/non-200 domain → only the ok domain emits (omission, no `value: undefined`); quota-error fixture → `RateLimitedError{reason:'monthly-quota'}`; 429 → `RateLimitedError` with Retry-After; 503 → `upstream_error`; malformed → `ParseError`
- [ ] TC-OPR-4: pacing worst window exactly 60/min = documented (fake clock); per-domain cache 30d — repeat domain = 0 fetches
- [ ] TC-TRC-1: fixtures (meta 200, CSV body) → Map built, rank lookups correct, `kind:'community'`, attribution + estimateLabel with list id/date
- [ ] TC-TRC-2: CSV capped at maxRows (fixture with 105 rows, maxRows 100); domain normalized (case/trailing dot)
- [ ] TC-TRC-3: today's meta 404 → falls back ≤3 days; **all 4 dates 404 on first run → `upstream_error` with 0 CSV fetches**; cached list <14d → 0 fetches; >14d → `stale_cache`
- [ ] TC-TRC-4: Tranco attribution string present on every signal (A7/I8)

### Phase 5 — ddg-serp

**Goal:** gray SERP provider with strict brittleness detection, defined fallback, and crawl-pace pacing.

**Changes** — `src/ddg-serp.ts`.

```ts
// src/ddg-serp.ts — per-endpoint mapping + ONE defined fallback (A6)
async search(q: string, o: SearchOpts): Promise<SerpResult[]> {
  try { return await this.searchOn(HTML_ENDPOINT, q, o); }
  catch (e) {
    const fallback = e instanceof ParseError || e instanceof BlockedError;  // drift or challenge ONLY — never 429/5xx
    if (!fallback) throw e;
    return this.searchOn(LITE_ENDPOINT, q, o);   // exactly one fallback per call; lite's typed errors propagate unchanged
  }
}
private async searchOn(host: string, q: string, o: SearchOpts): Promise<SerpResult[]> {
  const res = await this.deps.fetcher.fetch(new URL(`https://${host}?q=${encodeURIComponent(q)}`), { headers: ddgHeaders });
  if (res.status === 429) throw new RateLimitedError(this.name, retryAfterMs(res));
  if (res.status >= 500) throw new UpstreamError(this.name, res.status);            // retryable class, NOT "bot protection"
  if (res.status >= 400) throw new BlockedError(this.name, `HTTP ${res.status} — likely bot protection`);
  const html = await res.text();
  if (/anomaly|challenge|captcha/i.test(html)) throw new BlockedError(this.name, 'challenge page');
  const $ = cheerio.load(html);
  const anchors = $('div.result:not(.result--ad) a.result__a').toArray();
  const noResultsMarker = /no results/i.test($('.no-results').text() ?? '');
  if (anchors.length === 0 && !noResultsMarker)
    throw new ParseError(this.name, 'layout drift: 0 result anchors and no no-results marker — provider needs updating');
  return anchors.map((el, i) => ({ position: i + 1, url: decodeUddg($(el).attr('href')),
    title: $(el).text().trim(), snippet?, source: { provider: this.name, kind: 'gray', attribution: this.attribution },
    estimateLabel: 'best-effort SERP via undocumented HTML endpoint (gray)', retrievedAt: deps.clock() }))
    .slice(0, o.limit ?? 20);
}
```

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-DDG-1: fixture HTML → results with position 1..N, `uddg=` decoded to absolute URLs, ads excluded, `kind:'gray'` + attribution + estimateLabel
- [ ] TC-DDG-2 (split): 429 → `RateLimitedError` with Retry-After AND no fallback fetch; 503 → `upstream_error` and no fallback; 403 → `blocked`; pacing: 10 s spacing between consecutive fetches, ≤7 in any rolling 60 s window (fake clock)
- [ ] TC-DDG-3: anomaly/challenge fixture → `BlockedError`, then lite fallback attempted once (defined trigger)
- [ ] TC-DDG-4: HTML with neither anchors nor no-results marker → `ParseError`; empty SERP with marker → `[]`
- [ ] TC-DDG-5 (trigger defined): primary drift fixture + lite fixture → lite result returned with exactly 2 total fetches; lite also drifts → `parse_error` propagates; 429 from primary → exactly 1 fetch (no fallback)

### Phase 6 — Hardening, provenance sweep, docs, final green

**Goal:** whole-matrix sweep, I16 documentation, lint/typecheck, package ready for P2/P4 consumers.

**Changes**
- `test/provenance-sweep.test.ts` — runs every provider against its full happy fixture and asserts: every emitted value carries `provider`, a valid `kind`, non-empty `attribution` (verbatim CC BY string for crux), `retrievedAt`, and — for every `heuristic`/`gray` value — a non-empty `estimateLabel`.
- `test/no-direct-fetch.test.ts` — source scan: `src/**` contains no direct `fetch(` usage (I12).

```ts
// test/no-direct-fetch.test.ts
it('providers never call global fetch directly (all HTTP via injected Fetcher, I12)', () => {
  for (const f of walkFiles('src'))
    expect(readFileSync(f, 'utf8'), f).not.toMatch(/(^|[^.\w])fetch\s*\(/);
});
```
- `README.md` (package) — provider table, per-provider "what data leaves the machine" (I16), brittleness notes for gray providers, BYOK setup for the R5 env vars (`SEOLITE_PSI_KEY`, `SEOLITE_CRUX_KEY`, `SEOLITE_OPR_KEY`), replacement guide for ddg-serp (I2), OPR per-domain pacing note + future batching pointer.
- Lint/typecheck pass; exports test re-run; merge-readiness notes for orchestrator (A9 delta state recorded).

**Success criteria**
- [ ] Automated: `npm test -w @seolite/providers`
- [ ] TC-SHARED-6: provenance sweep green for all 7 providers (kind valid, attribution non-empty — verbatim CC BY string for crux — retrievedAt present, estimateLabel present on every heuristic/gray value)
- [ ] TC-SHARED-7: no-direct-fetch scan green
- [ ] TC-SHARED-8: no error message/path from any provider fixture run contains the string of an injected fake key (`SEOLITE_TEST_KEY_123` probe)
- [ ] `npm run lint -w @seolite/providers` and `npm run typecheck -w @seolite/providers` green
- [ ] Package README includes the I16 data-flow table, R5 env names, and gray-provider brittleness statements

## Testing Strategy

Principles: contract tests only, against **injected fetchers** returning fixtures shaped like the real APIs (research-verified shapes); fake clock/sleep/env everywhere; zero live network (I9/I10); each provider's pacing tested against its documented-limit constant with worst-case-window assertions. Edge → test map:

| # | Edge (spec ref) | Test | Phase |
|---|---|---|---|
| 1 | typed errors carry provider name (I17) | TC-SHARED-1 | 0 |
| 2 | pacing ≤ documented limit in worst-case rolling window (A1–A6) | TC-SHARED-2, TC-SUG-5, TC-WIKI-2, TC-PSI-5, TC-CRUX-4, TC-OPR-4, TC-DDG-2 | 0,2–5 |
| 3 | pacing override clamp: `burst + rpm ≤ documentedLimit` (BA1) | TC-REG-6 | 1 |
| 4 | cache hit avoids second fetch (BA2) | TC-SUG-3, TC-WIKI-3, TC-PSI-5, TC-CRUX-5, TC-OPR-4, TC-TRC-3, TC-DDG-5 | 2–5 |
| 5 | cache TTL expiry under fake clock (I10) | TC-SHARED-4 | 0 |
| 6 | key param redaction (I16) | TC-SHARED-5, TC-SHARED-8 | 0,6 |
| 7 | provenance + attribution + estimateLabel on every value (I3/I8) | TC-SHARED-6 (+ per-provider TCs) | 2–6 |
| 8 | no direct fetch (I12) | TC-SHARED-7 | 6 |
| 9 | key absent → NotConfigured, 0 fetches; keyless PSI trial allowed when `automated:false` (I1, BA5) | TC-REG-3, TC-CRUX-1, TC-OPR-1, TC-PSI-2 | 1,3,4 |
| 10 | secret value in config rejected (I1) | TC-REG-4 | 1 |
| 11 | worker-safe wiring excludes ddg-serp (BA9/R7) | TC-REG-5 | 1 |
| 12 | 429 + Retry-After → rate_limited + retryAfterMs (A1–A6, I17) | TC-SUG-2, TC-WIKI-3, TC-PSI-3, TC-CRUX-3, TC-OPR-3, TC-DDG-2 | 2–5 |
| 13 | HTTP 5xx → upstream_error for ALL providers incl. gray (never "CAPTCHA") | TC-SUG-4, TC-PSI-3, TC-OPR-3, TC-DDG-2 | 2–5 |
| 14 | CAPTCHA/bot-block → blocked (A5/A6) | TC-SUG-4, TC-DDG-2/3 | 2,5 |
| 15 | malformed JSON → parse_error everywhere (I15, incl. PSI) | TC-SHARED-9, TC-SUG-4, TC-WIKI-3, TC-PSI-6, TC-CRUX-3, TC-OPR-3 | 0,2–4 |
| 16 | HTML layout drift detected (A6) | TC-DDG-4 | 5 |
| 17 | DDG lite fallback: trigger (drift/challenge only, once, never on 429/5xx) (A6) | TC-DDG-3/5 | 5 |
| 18 | lab/field split; field omitted not zeroed (I3, BA7) | TC-PSI-1/4 | 3 |
| 19 | PSI keyed/trial cache-key separation (BA5) | TC-PSI-5 | 3 |
| 20 | CrUX no-data → null, distinct from not_configured (A1, BA6) | TC-CRUX-3 vs TC-CRUX-1 | 3 |
| 21 | CrUX worst-case window = 150 = documented, never above (A1) | TC-CRUX-4 | 3 |
| 22 | OPR per-domain shape, Bearer header, quota typed error, non-quota omission with no `value: undefined` (A2) | TC-OPR-2/3 | 4 |
| 23 | OPR worst window exactly 60 = documented (A2) | TC-OPR-4 | 4 |
| 24 | Tranco row cap, fallback dates, first-run all-404, stale ceiling, attribution (A7, BA3) | TC-TRC-1/2/3/4 | 4 |
| 25 | demand proxy honesty label; no-match → [] (I3, BA4) | TC-WIKI-1/3 | 2 |
| 26 | gray kind labels + estimateLabel present (A9/I3) | TC-SUG-1, TC-DDG-1 | 2,5 |
| 27 | unknown provider name → error lists available names (I2) | TC-REG-1/2 (core registry integration re-verified at M2) | 1 |
| 28 | timeout classification is type-based, not message-sniffed (I17) | TC-SHARED-10 | 0 |

Fixture discipline: one happy-path fixture + one per failure mode per provider, hand-written from the shapes recorded in research (PSI `lighthouseResult`/`loadingExperience`, CrUX `record.metrics.*.histogram`/`percentiles.p75`, OPR `domains[]`, suggest `[q,[...]]`, Wikimedia `items[].views`, Tranco `rank,domain` CSV, DDG `result__a`/`uddg`). No fixture may be fetched live; a `fixtures/README.md` pins the source URL + retrieval date for each shape.

## References

- Research: `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — §Seam 3 free data source matrix (provider limits/ToS rows), §Implicit Spec I1–I17, §Evidence Ledger (incl. refuted claims: CrUX keyless, OPR `API-OPR` header).
- Architecture: `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — packages table, Provider SPI signatures (per-domain `authority(domain, o)`), payload required fields, config/BYOK rules, M1 sequencing.
- Reconciliation: `thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` — R1–R10 authoritative (R5 BYOK env names; R7 worker safety).
- Validation: `./PLAN_VALIDATION.md` — adversarial findings resolved by this rework.
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
