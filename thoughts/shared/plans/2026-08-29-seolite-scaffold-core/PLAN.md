<!-- SIGNPOST | 2/5: PLAN | seolite / scaffold-core (P1 of M0) | 2026-08-29 | protocol: create_plan_generic_v2_5 -->

# PLAN — seolite · scaffold-core (M0)

**scale**: large
**aspect bundle**: `thoughts/shared/plans/2026-08-29-seolite-scaffold-core/` (this dir + `IMPLICIT_SPEC.md`)
**status**: complete — zero open questions, zero TBD; RECONCILIATION.md R1–R10 applied as authoritative; PLAN_VALIDATION.md findings F1–F8 resolved

---

## Overview

M0 is the foundation everything else in seolite compiles against. This plan delivers two things and
nothing else: (1) the npm-workspaces monorepo scaffold — root tooling (strict ESM TypeScript on
Node >= 22, Vitest, ESLint), repo identity (Apache-2.0 LICENSE, README stub, .gitignore), and
placeholder packages matching the ARCHITECTURE.md package table exactly; and (2) `@seolite/core` —
the payload models, config loader (with `failThreshold` semantics and I15 unknown-key errors),
provider/AuditRule SPIs + registries (I2 unknown-name errors), the SSRF-guarded resilient `Fetcher`
(I12/I17/I4), the robots.txt policy (I4), the `HistoryStore` interface, and provenance helpers
(I3). Everything is built test-first (I9): each phase is a red-green cycle, and every I-edge that
touches core has a named deterministic test (I10 — no live network, no wall clock).

## Current State

- Repo `~/repos/learn/seolite`, branch `main` @ `dfcec53` (docs-only commits landed after plan
  authoring; claims below re-verified at `dfcec53`). Contains only `.gitignore` (already
  covers `node_modules/`, `dist/`, `.env*`, `coverage/`, `.wrangler/`, `.wt/`, logs) and `thoughts/`.
  No `packages/`, no LICENSE, no README, no tooling — verified 2026-08-29.
- Locked inputs this plan conforms to:
  - Research: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/research/2026-08-29-seolite-greenfield-research.md`
    — invariants I1–I17, bounding assumptions, evidence ledger (npm workspaces sufficiency,
    robots-parser staleness note, Workers Node-compat, Vitest >= 4.1 lock).
  - Architecture: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md`
    — locked decisions (TypeScript ESM-only Node>=22, npm workspaces, Vitest everywhere, one
    injectable `Fetcher`, cheerio Node-side, robots decision delegated to P1), the package table,
    the exact SPI signatures, the exact payload required fields, and M0 sequencing ("P1
    scaffold-core … bootstrap CI … must be green before any other merge").
  - Reconciliation: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md`
    — R1–R10 cross-plan authoritative decisions applied throughout (R1 severity vocabulary
    `error|warning|info`, R2 `failThreshold` default `"error"`, R3 budgets incl. `maxPages`
    clamp 10 000, R4 `@seolite/site` workspace, R5 BYOK env-var scheme, R6 M0 merge order).
- Local environment verified 2026-08-29: Node v24.16.0, npm 11.13.0 (both satisfy engines >=22);
  `robots-parser` latest is 3.0.1 (unmoved since 2023, consistent with research), `vitest` 4.1.11
  (satisfies the >=4.1 lock), `cheerio` 1.2.0.
- Nothing else exists: no CI workflow, no packages, no source files. Blast radius of this aspect is
  maximal — every M1 aspect plans against the shapes defined here.

## Desired End State

Observable end state after this plan completes:

- `npm install` succeeds cleanly at repo root; `git status` shows only intended tracked files.
- Repo root has: `package.json` (workspaces + CI-contract scripts), `tsconfig.base.json`,
  `vitest.shared.ts` + root `vitest.config.ts`, `eslint.config.js`, full Apache-2.0 `LICENSE`
  (copyright 2026 Nitish Agarwal), `README.md` stub, `CONTRIBUTING.md` stub, extended
  `.gitignore`, and `packages/{core,audit,providers,cli,mcp}` placeholders plus the private
  `@seolite/site` workspace placeholder at `site/` (R4) — names exactly per the ARCHITECTURE
  package table + RECONCILIATION R4.
- `@seolite/core` exports, all test-covered: payload models with exactly the required fields;
  `Metric` provenance wrapper + deterministic helpers; `loadConfig` with I15/SC-3 error behavior;
  severity gate helpers (SC-4); `createProviderRegistry` / `createRuleRegistry` (I2/SC-6/SC-7);
  `createFetcher` with SSRF/timeout/retry/backoff+jitter/Retry-After/UA/redirect discipline
  (SC-10..SC-13); robots policy (SC-14); `HistoryStore` interface (SC-15); `@seolite/core/node`
  subpath (plugin loader, resolver-wired fetcher, SC-8/BA-11).
- Verify commands (all must be green from repo root):

```bash
npm install
npm run lint          # root trio = the exact contract P6a's CI workflow invokes
npm run typecheck
npm test              # root Vitest projects run across all packages
npm test -w @seolite/core
```

- Nothing outside this scope is created (no CI workflow file, no audit rules, no providers, no
  CLI/MCP, no site build).

## What We're NOT Doing

- No `.github/workflows/*` files — bootstrap CI is the ci-deploy aspect's P6a deliverable landing
  in M0; we ship only the npm script contract it invokes (BA-10).
- No CI-enforcement content (required checks, branch protection) inside CONTRIBUTING — that is
  ci-deploy's P6a scope; this plan ships only the CONTRIBUTING stub that links to it.
- No crawler, AuditRule implementations, severity scorer, or report assembly — P2 (audit-engine).
- No built-in providers (google-suggest, wikipedia-demand, pagespeed, crux, openpagerank, tranco,
  ddg-serp) or BYOK skip semantics — P3 (providers).
- No CLI commands, MCP server, JSONL HistoryStore implementation, or plugin runtime wiring — P4
  (surfaces). Core defines the interfaces only.
- No docs site, design tokens, or Pages deploy — P5 (site-docs).
- No npm publishing config, `publishConfig` dist overrides, or `npm publish` — M2.
- No DNS-rebinding ToCToU defense — out of scope for v1 per inherited I12 bounding assumption.
- No config formats beyond JSON (no YAML/TOML), no config file search up the tree, no
  hot-reload of plugins (BA-14).
- No README onboarding snippets (claude/cursor/mcpServers) — lands with surfaces/site-docs; stub only.
- No telemetry, ever (I16) — trivially enforced here by adding nothing that could.

## Approach

1. **Bootstrap-first, then lock shapes, then behavior.** Phase 1 makes every package installable,
   type-checkable, and testable (placeholder smoke tests) so the root trio is green from day one —
   that trio is the CI gate P6a wires. Phases 2–5 build `@seolite/core` in dependency order:
   models → config/registries → Fetcher → robots/node surface, so each phase depends only on
   already-merged shapes.
2. **TDD per phase (I9).** Tests are written first in every phase and define the contract; each
   red-green cycle ends with the phase's Success Criteria commands green. Tests are deterministic:
   the Fetcher's transport, resolver, clock, sleep, and RNG are injectable, so SSRF/redirect/retry/
   Retry-After/timeout behaviors are exercised against fakes with fake timers — zero live network
   (I10, BA-15).
3. **Conformance over cleverness.** Locked signatures from ARCHITECTURE.md are reproduced verbatim;
   required payload fields keep their exact names; additions are limited to gaps the architecture
   delegates to P1 (PageReport, opts types, HistoryEntry, ResolvedConfig). A model-contract test
   pins the required fields so a future edit that drops one fails CI.
4. **Runtime-safety split.** The core main entry stays Workers-safe (pure URL/IP policy, no Node
   built-ins, no side effects); Node-only capabilities live behind `@seolite/core/node`
   (BA-11) — this keeps the future Worker bundle thin (I6) and the Worker script-size budget safe.

## Design Analysis

### Invariants → mechanism map

| Invariant | Mechanism in this aspect (details in phases) |
|---|---|
| I1 zero-cost defaults | `byok` stores env-var NAMES only (SC-5); registries return "absent" for unconfigured boundaries so P3/P4 implement skip-with-reason; no paid anything in deps |
| I2 pluggability | 5 locked provider interfaces + `createProviderRegistry`; unknown name → error listing available; fixtures in tests prove the edge without real providers |
| I3 honesty | `Metric{value, source{provider,kind,attribution?}, retrievedAt}` wrapper; `kind` closed enum; nullable `score`/`position`/`CruxRecord`; deterministic `mkMetric` (SC-9, SC-17) |
| I4 etiquette | fixed UA with contact URL, cannot be suppressed (SC-12); robots policy with conservative failure matrix (SC-14); Retry-After honored (SC-11) |
| I6 thin Worker | core main entry imports no Node built-ins and no cheerio runtime (type-only import, BA-12); Node-only code isolated in `@seolite/core/node` |
| I8/I11 identity | full Apache-2.0 LICENSE (2026 Nitish Agarwal), author fields, repo conventions honored |
| I9/I10 TDD + determinism | tests-first phases; injectable transport/resolver/clock/sleep/rng; fake timers; zero live network |
| I12 SSRF | pure blocklist predicate (I12 ranges + conservative additions, BA-6), scheme whitelist, per-hop re-validation, Node resolver validation (SC-10) |
| I14 cancellation/concurrency | `AbortSignal` in every SPI opts + fetcher composition; `CrawlBudgets` incl. `maxConcurrency` type owned by core (cap enforcement is P2) |
| I15 boundaries | config unknown keys → error listing valid keys; non-http(s) → typed error; redirect loop + hop cap typed errors; malformed robots → documented policy (SC-3/SC-13/SC-14) |
| I16 no telemetry | nothing in core calls home; `.gitignore` keeps local state (`.seolite/`) out of the repo |
| I17 retry | per-attempt timeout, bounded retries (GET/HEAD default, BA-5), exponential backoff + full jitter, Retry-After (capped, BA-4), typed errors with provider label |

### Failure & concurrency

- **Per-request failure containment**: the Fetcher converts every failure mode (blocked target,
  timeout, redirect loop/hop cap, retries exhausted, abort, Retry-After over cap) into a distinct
  typed `SeoliteError` subclass (`SsrfBlockedError`, `TimeoutError`, `RedirectError`,
  `RetryExhaustedError`, `AbortedError`, `RetryAfterCapError`) carrying the provider/label —
  callers never pattern-match strings, and P2/P3 can label
  partial results honestly (I3) instead of zero-filling.
- **Cancellation**: caller `AbortSignal` is composed with the internal per-attempt deadline; an
  aborted signal fails immediately without consuming retries (test-enforced). Crawl-level global
  concurrency and duration budgets are typed in core (`CrawlBudgets`) but enforced by P2's crawler —
  core only guarantees per-request timeout + signal propagation.
- **Partial failure**: nothing in core aggregates; `SiteAuditReport.incomplete` and severity
  counting exist as types + pure helpers so P2 can't invent a divergent shape.
- **Determinism under concurrency**: core has no shared mutable state; registries and configs are
  frozen on construction (validation happens once, at construction, then read-only).

### Blast radius on later aspects

- **P2 audit-engine** codes against `PageContext`, `Issue`, `SiteAuditReport`, `CrawlBudgets`,
  `AuditRule`, rule registry, robots policy, and the Fetcher. Any rename here breaks P2 first —
  hence the model-contract test and verbatim signatures.
- **P3 providers** codes against the five provider interfaces, `Metric`/`Provenance`, `Fetcher`
  (injected, never `fetch` directly), and BYOK name resolution. The "absent boundary" registry
  contract is what makes its I1 skip semantics uniform.
- **P4 surfaces** codes against `ResolvedConfig`, severity gate helpers (exit codes 0/1/2),
  `HistoryStore`, and plugin loading via `@seolite/core/node`.
- **P6a CI** invokes exactly `npm run lint`, `npm run typecheck`, `npm test` — the trio green at
  the end of Phase 6 is the handoff.
- Changing anything in this bundle after M0 requires an ARCHITECTURE.md change first (its own rule);
  the plan therefore over-invests in exactness now, which is cheaper than re-planning M1.

### Alternatives considered (with rejection reasons)

1. **robots.txt: vendored minimal checker** — rejected: wildcard (`*`, `$`) and
   longest-most-specific match semantics are subtle; a hand-rolled checker re-encodes upstream's
   test matrix at higher risk. **google robotstxt C++ port / Wasm** — rejected: weight and
   Workers-safety friction. **Chosen: `robots-parser@3.0.1` behind a core-owned `RobotsPolicy`
   wrapper** (BA-1): grammar is frozen (RFC 9309) so staleness is low-risk, and the wrapper is the
   vendoring escape hatch.
2. **zod (or similar) for config validation** — rejected: the schema is small and flat, and I15
   demands a precise "valid keys are: …" error format; hand-rolled validators give exact messages
   with zero new dependencies.
3. **Biome/Oxlint** — rejected for the linter: ESLint 9 flat config + typescript-eslint is the
   conservative ecosystem default M1 planners will not have to learn; speed is irrelevant at this
   repo size.
4. **pnpm / Turborepo** — rejected: ARCHITECTURE.md locks npm workspaces (sufficient for <=5
   packages, adoptable later without restructure).
5. **tsc project references / composite builds for in-workspace resolution** — rejected for M0:
   more config surface with no cross-package runtime consumer until M1; chosen pattern is
   `exports` → TS source (Vitest-native) with `publishConfig` dist overrides deferred to M2 (BA-13).
6. **Native fetch `redirect: 'follow'`** — rejected: per-hop SSRF re-validation (I12) requires
   manual hop iteration; mechanism detail lives in Phase 4.
7. **Custom structural DOM type instead of cheerio's** — rejected: ARCHITECTURE.md pins
   `PageContext.dom` as a cheerio load; a structural clone would diverge from the lock. Type-only
   import keeps the runtime vendor-free (BA-12).
8. **`vitest.workspace.ts`** — rejected: deprecated in Vitest 4; use root `projects` + shared
   `vitest.shared.ts` merged by each package config.

### Default choices

All conservative defaults chosen autonomously (no open questions) are recorded with rationale in
`IMPLICIT_SPEC.md` §3 (BA-1..BA-15): robots-parser choice, severity/failThreshold defaults, budget
and retry numbers, backoff/Retry-After cap, retry scope, SSRF list extension, DNS scope, fixed UA,
robots failure matrix, CI ownership boundary, Node-only subpath, cheerio type-only dependency,
in-workspace module resolution, config discovery, and test conventions. This plan implements them
as stated; none is revisitable without editing IMPLICIT_SPEC.md first.

## Resource & Cost Analysis

- **npm installs (free, one-time + cached)**: the runtime dep of core is `robots-parser` (~10 KB,
  zero transitive deps); `cheerio` is a devDependency (type-only usage — runtime cheerio
  ownership is P2/audit's). Dev deps:
  `typescript`, `vitest@^4.1`, `@types/node`, `eslint@^9`, `typescript-eslint`, `@eslint/js`. No
  paid registry, no account services. Fresh `npm install` is the only cost; CI caches it.
- **CI minutes (free for public repos per research Seam 5)**: the bootstrap trio (lint + typecheck +
  test) on ubuntu-latest/Node 22 is well under ~2 minutes at M0 size; P6a's workflow is the only
  consumer. M0 adds no scheduled/parallel jobs.
- **Worker script size budget note (I6)**: the core MAIN entry must remain free of Node built-ins,
  dynamic `import()` of local paths, and cheerio runtime code, so the future `@seolite/mcp` Worker
  bundle (3 MB gzipped free-tier ceiling) is not taxed by core — core contributes only small pure
  modules. Node-only code is quarantined in the `./node` subpath, which the Worker must never
  import; a Phase 5 test asserts the main entry's import graph stays Node-free.
- **Local disk/state**: `.seolite/` runtime dir gitignored; no daemons, no databases.

---

## Phases

> TDD: in every phase the listed tests are written first (red), then implementation (green).
> "Files" are paths under `/Users/nagarwal/repos/learn/seolite/`.

### Phase 1 — Workspace scaffold & toolchain baseline

**Changes**

| File | Why |
|---|---|
| `package.json` (root) | Workspaces root: name `seolite`, `private: true`, `"type": "module"`, `engines.node >=22`, `workspaces: ["packages/*", "site"]` (R4 — `site` is the private `@seolite/site` workspace), CI-contract scripts (below). Dev deps pinned to majors: typescript, vitest@^4.1, @types/node, eslint@^9, typescript-eslint, @eslint/js. |
| `tsconfig.base.json` | ONE strictness contract for all packages: `strict`, `target: ES2023`, `module/moduleResolution: NodeNext` (ESM-only, `.js` import extensions), `verbatimModuleSyntax`, `isolatedModules`, `noUncheckedIndexedAccess`, `skipLibCheck`. `exactOptionalPropertyTypes` deliberately OFF (M1 friction) — default choice. |
| `vitest.shared.ts` + `vitest.config.ts` (root) | Shared Vitest defaults + root `projects: ['packages/*/vitest.config.ts']` (Vitest 4 style; no deprecated workspace file). |
| `eslint.config.js` | ESLint 9 flat config, typescript-eslint recommended, ignores `node_modules`, `dist`, `thoughts`. |
| `.gitignore` (extend) | Add `.seolite/` (runtime history dir) and `*.tsbuildinfo`. |
| `LICENSE` | Full Apache-2.0 text with "Copyright 2026 Nitish Agarwal" (I8). |
| `README.md` | Stub: name, one-liner ("lightweight, pluggable, MCP-first SEO toolkit — free services only"), status: under active development, license pointer. |
| `CONTRIBUTING.md` | Stub owned by this aspect (F7): build/dev/test commands (the root trio), commit/PR conventions per ARCHITECTURE.md repo conventions, link to the CI-enforcement docs owned by ci-deploy (P6a). |
| `packages/{core,audit,providers,cli,mcp}/package.json` | Five placeholders named exactly `@seolite/{core,audit,providers,cli,mcp}`, v0.0.0, `"type":"module"`, `private: true`, engines, scripts (`test: vitest run`, `typecheck: tsc --noEmit`), `exports` → `./src/index.ts` (BA-13). |
| `packages/*/tsconfig.json`, `packages/*/vitest.config.ts` | Each extends base / merges shared test config. |
| `packages/*/src/index.ts` + `src/index.test.ts` | Placeholder barrel + one smoke test per package so `npm test` is green everywhere from day one. |
| `site/package.json` | Private placeholder workspace `@seolite/site` (R4; F2): name/version/type/engines + `private: true` ONLY — no scripts, so the root `test` projects glob (`packages/*/vitest.config.ts`) and `--workspaces --if-present` fan-outs are unaffected; gives `npm run build -w @seolite/site` (P5/P6b contract) a resolvable target from day one. |
| `site/README.md` | One-line pointer: docs site owned by site-docs aspect. |

Illustrative snippets (shape only, not final content):

```jsonc
// package.json (root) — the CI contract for P6a
{
  "name": "seolite", "private": true, "type": "module",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*", "site"], // R4: site = private @seolite/site workspace
  "scripts": {
    "test": "vitest run",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint ."
  }
}
```

```jsonc
// tsconfig.base.json — the strictness contract (excerpt)
{ "compilerOptions": {
    "target": "ES2023", "lib": ["ES2023"],
    "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "verbatimModuleSyntax": true,
    "isolatedModules": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true } }
```

```ts
// vitest.config.ts (root) — Vitest 4 projects
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { projects: ['packages/*/vitest.config.ts'] } });
```

**Success Criteria**
- [x] Automated: `npm install` exits 0 and creates a lockfile
- [x] Automated: `npm run lint`
- [x] Automated: `npm run typecheck`
- [x] Automated: `npm test` (5 placeholder smoke tests green across packages)
- [x] Automated: `test -f LICENSE && grep -q "Version 2.0, January 2004" LICENSE && grep -q "Nitish Agarwal" LICENSE && test -f CONTRIBUTING.md && grep -q "@seolite/site" site/package.json`
- [x] Automated: `test -d packages/core && test -d packages/audit && test -d packages/providers && test -d packages/cli && test -d packages/mcp && test -d site`

### Phase 2 — `@seolite/core` types, payload models & provenance helpers

**Changes** (all under `packages/core/src/`)

| File | Why |
|---|---|
| `severity.ts` | `type Severity = 'error' \| 'warning' \| 'info'` (closed, ordered) — SC-4 basis. |
| `provenance.ts` | `Provenance{provider, kind, attribution?}`, `ProvenanceKind` closed enum `official\|community\|heuristic\|lab\|field`, `Metric<T>{value, source, retrievedAt}`, deterministic `mkSource`/`mkMetric` (retrievedAt injected) — I3/SC-9/SC-17. |
| `payloads.ts` | Exact required fields per ARCHITECTURE: `KeywordIdea`, `SerpResult`, `PageSpeedReport`, `CruxRecord` (+ `HistogramBin`), `AuthoritySignal`. Nullability encodes honesty (`CruxRecord` return `Promise<CruxRecord \| null>`). |
| `page.ts` | `PageContext{url,status,headers,dom,bytes,timingMs,robotsAllowed}` (`dom: CheerioAPI` — type-only import, BA-12), `Issue`, `PageReport` (P1-defined gap: url,status,title?,issues,score:number\|null,metrics?,timingMs,bytes,robotsAllowed), `SiteAuditReport{…, incomplete, configSnapshot}`. |
| `budgets.ts` | `CrawlBudgets{maxPages,maxDepth,maxDurationMs,maxConcurrency,perHostMinDelayMs}` + `DEFAULT_BUDGETS` (BA-3) — I14 types; enforcement is P2's. |
| `providers.ts` | The five LOCKED provider interfaces verbatim + `ProviderBoundary` union + opts types (`IdeasOpts`, `SearchOpts`, `PageSpeedOpts`, `CruxOpts`, `AuthorityOpts`) each with `signal?: AbortSignal` — I14. |
| `rules.ts` | `AuditRule` verbatim + `RuleOpts{signal?}`. |
| `history.ts` | `RankHistoryEntry{keyword,domain,position:number\|null,provider,url?,retrievedAt:ISO}`, `interface HistoryStore { append(e): Promise<void>; list(q?: {keyword?;domain?;limit?}): Promise<RankHistoryEntry[]> }` — SC-15, no impl. |
| `models.test.ts` | Written FIRST: model-contract test constructing fixtures asserting every ARCHITECTURE-required field exists with the required name/type (guards future edits); `mkMetric` stamps injected time and preserves value/source (determinism). |

Illustrative snippets:

```ts
// provenance.ts — the I3 wrapper, verbatim fields
export type ProvenanceKind = 'official' | 'community' | 'heuristic' | 'lab' | 'field';
export interface Provenance { provider: string; kind: ProvenanceKind; attribution?: string }
export interface Metric<T> { value: T; source: Provenance; retrievedAt: string } // ISO-8601
export const mkMetric = <T>(value: T, source: Provenance, retrievedAt: string): Metric<T> =>
  ({ value, source, retrievedAt }); // retrievedAt injected — never new Date() inside (I10)
```

```ts
// providers.ts — locked signatures (excerpt; others identical in shape)
export interface KeywordProvider { readonly name: string;
  ideas(seed: string, o: IdeasOpts): Promise<KeywordIdea[]> }
export interface IdeasOpts { lang?: string; limit?: number; signal?: AbortSignal }
```

**Success Criteria**
- [ ] Automated: `npm test -w @seolite/core -- models.test`
- [ ] Automated: `npm run typecheck -w @seolite/core`
- [ ] Automated: `npm test -w @seolite/core` (phase-1 smoke still green)

### Phase 3 — Config loader, severity gate & registries

**Changes** (under `packages/core/src/`)

| File | Why |
|---|---|
| `errors.ts` | `SeoliteError` base + `ConfigError{details[]}` — typed, actionable (I17 style), each detail names the offending key + lists valid options. |
| `config.ts` | `loadConfig(path?, read?)`: SC-3 full behavior — missing file → defaults; malformed/non-object JSON → ConfigError; unknown key at any level → ConfigError listing valid keys for that level; range validation (positive integers) with `maxPages` hard-clamped at 10 000 (R3); enum restriction: `failThreshold` ∈ `error\|warning\|info\|off` and `severityOverrides` values ∈ `error\|warning\|info` (R1), else ConfigError; `byok` value pattern `^[A-Z_][A-Z0-9_]*$` (SC-5; cross-plan names per R5); outputs frozen `ResolvedConfig{providers,severityOverrides,crawl,failThreshold,byok,plugins}`. `read` injectable → no filesystem in tests. |
| `gate.ts` | `severityRank`, `meetsThreshold(issueSev, threshold)`, `countIssuesAtOrAbove(issues, threshold)`, `EXIT` codes 0/1/2 constants — SC-4 pure helpers for P4. |
| `registry.ts` | `createProviderRegistry(selection, byok, available)` → validates names + byok keys (I2: unknown → error listing available, sorted); accessors per boundary return the instance or `undefined` (absent → I1 skip is caller's job). `createRuleRegistry(rules, severityOverrides)` → duplicate-id error; unknown override id → error listing known ids; `get/list/effectiveSeverity`. |
| `config.test.ts`, `gate.test.ts`, `registry.test.ts` | Written FIRST: full SC-3/SC-4/SC-5/SC-6/SC-7 edge matrix incl. invalid `failThreshold`/`severityOverrides` enums and the `maxPages` 10 000 clamp (see Testing Strategy), using fixture providers/rules and an injected in-memory `read`. |

Illustrative snippets:

```ts
// config.ts — I15 edge shape (illustrative error content)
// throw new ConfigError([
//   { path: 'crawl.maxPagez',
//     message: 'unknown key. Valid keys under "crawl": maxPages, maxDepth, maxDurationMs, maxConcurrency, perHostMinDelayMs' }
// ]);
export const VALID_TOP_LEVEL_KEYS =
  ['providers', 'severityOverrides', 'crawl', 'failThreshold', 'byok', 'plugins'] as const;
```

```ts
// registry.ts — locked contract (excerpt)
export function createProviderRegistry(
  selection: Partial<Record<ProviderBoundary, string>>,
  byok: Record<string, string>,
  available: Record<string, object>,
): ProviderRegistry; // unknown name -> ConfigError listing Object.keys(available).sort()
```

**Success Criteria**
- [ ] Automated: `npm test -w @seolite/core -- config.test`
- [ ] Automated: `npm test -w @seolite/core -- registry.test`
- [ ] Automated: `npm test -w @seolite/core -- gate.test`
- [ ] Automated: `npm run typecheck -w @seolite/core`

### Phase 4 — Fetcher: SSRF guard, resilience, User-Agent, redirects

**Changes** (under `packages/core/src/`)

| File | Why |
|---|---|
| `ssrf.ts` | Pure predicate `isBlockedTarget(url: URL): boolean` — scheme whitelist (http/https post-normalization), exact I12 ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10) + conservative additions (0.0.0.0/8, `::`, IPv4-mapped `::ffff:0:0/96`, BA-6); handles brackets/ports/IDN-normalized hosts via `URL`. Zero I/O → testable anywhere (SC-10). |
| `errors.ts` (extend) | `SsrfBlockedError`, `TimeoutError`, `RetryExhaustedError`, `RedirectError{reason:'loop'\|'hop-cap'\|'scheme'}`, `AbortedError` (caller signal aborted; no retries consumed), `RetryAfterCapError` (Retry-After beyond the 30 s cap, BA-4) — all carry `provider`/label when given (I17). |
| `ua.ts` | `USER_AGENT = 'seolite/<version> (+https://github.com/nitishagar/seolite)'` — always applied, never suppressible (SC-12). `<version>` sourcing: a literal constant in `ua.ts`, kept in sync with `packages/core/package.json` `version` by a unit test — deterministic, no runtime JSON import, Workers-safe (F6). |
| `fetcher.ts` | `createFetcher(opts): Fetcher` implementing the LOCKED interface. Opts: `timeoutMs`, `maxRetries`, `baseBackoffMs`, `maxRedirects`, `label?`, plus determinism seams `delegate?` (transport), `resolve?` (hostname→IPs), `sleep?`, `rng?`, `now?` (clock — fixed epoch in tests, e.g. Retry-After HTTP-date parsing and deadline bookkeeping; BA-15). Manual redirect loop (hop cap 5, seen-set loop detection, per-hop scheme+SSRF re-check), per-attempt deadline composed with caller signal, bounded retries (GET/HEAD; network/429/5xx), exponential backoff + full jitter, Retry-After (seconds or HTTP-date, capped 30 s → `RetryAfterCapError` beyond, BA-4). |
| `ssrf.test.ts`, `fetcher-resilience.test.ts`, `fetcher-basics.test.ts` | Written FIRST: full SC-10..SC-13 matrix against injected delegates + fake timers (see Testing Strategy). |

Illustrative snippets:

```ts
// fetcher.ts — signature and seam surface only
export interface FetcherOptions {
  timeoutMs?: number; maxRetries?: number; baseBackoffMs?: number;
  maxRedirects?: number; label?: string;
  delegate?: Fetch;                       // injected transport (tests; default: globalThis.fetch)
  resolve?: (host: string) => Promise<string[]>; // Node: dns lookup; Workers: undefined
  sleep?: (ms: number) => Promise<void>;  // fake timers in tests
  rng?: () => number;                     // seeded jitter in tests
  now?: () => number;                     // clock seam: fixed epoch in tests (Retry-After HTTP-date, deadlines)
}
export const createFetcher = (opts?: FetcherOptions): Fetcher => { /* … */ };
```

```ts
// redirect loop — per-hop re-validation (illustrative branch)
// for (let hop = 0; hop <= maxRedirects; hop++) {
//   assertPublicUrl(current);                    // scheme + blocklist, every hop (I12)
//   const res = await attempt(current, signal);  // deadline + retry wrapper
//   if (!isRedirect(res)) return res;
//   current = new URL(res.headers.get('location')!, current);
//   if (seen.has(current.href)) throw new RedirectError('loop');
// }
```

**Success Criteria**
- [ ] Automated: `npm test -w @seolite/core -- ssrf.test`
- [ ] Automated: `npm test -w @seolite/core -- fetcher-resilience.test`
- [ ] Automated: `npm test -w @seolite/core -- fetcher-basics.test`
- [ ] Automated: `npm run typecheck -w @seolite/core`

### Phase 5 — robots.txt policy, Node-only surface (`@seolite/core/node`)

**Changes**

| File | Why |
|---|---|
| `packages/core/package.json` (edit) | Add dep `robots-parser`; add devDep `cheerio` (type-only usage per BA-12 — runtime cheerio ownership is P2/audit); add `exports: { ".": "./src/index.ts", "./node": "./src/node.ts" }`. |
| `src/robots.ts` | Decision BA-1: `robots-parser` behind core-owned `RobotsPolicy{isAllowed(url): boolean; crawlDelay?: number; sitemaps: URL[]}` + `loadRobots(fetcher, siteUrl, opts)` implementing SC-14 matrix (2xx parse; 4xx allow-all; 429/5xx/network → disallow-all; unparseable body → allow-all). robots fetched through the guarded Fetcher (UA/SSRF/timeout inherit). |
| `src/node.ts` | Node-only subpath: `createNodeFetcher(opts)` (wires `resolve` from `node:dns` onto Phase 4 fetcher) and `loadPluginRules(paths, {cwd})` — dynamic import, default-export shape-validated as `AuditRule`, failure → typed error naming the file (SC-8). Main entry stays Node-free (import-graph test). |
| `src/robots.test.ts`, `src/plugins.test.ts`, `src/entry-isolation.test.ts` | Written FIRST: SC-14 matrix (fixture robots bodies via injected fetcher), SC-8 (valid plugin, wrong-shape plugin, missing file, syntax-error module), and a main-entry import-graph guard (no `node:` specifiers, no `./node.ts` re-export) for I6. |

Illustrative snippets:

```ts
// robots.ts — policy types only
export interface RobotsPolicy {
  isAllowed(url: URL): boolean;
  crawlDelay?: number;      // seconds, if any group matched
  sitemaps: URL[];          // for P2 sitemap discovery
}
export const loadRobots = async (fetcher: Fetcher, site: URL,
  o?: { signal?: AbortSignal }): Promise<RobotsPolicy> => { /* … */ };
```

```ts
// node.ts — Node-only quarantine (excerpt)
export const loadPluginRules = async (paths: string[], o: { cwd: string })
  : Promise<AuditRule[]> => { /* dynamic import + shape validation */ };
```

**Success Criteria**
- [ ] Automated: `npm test -w @seolite/core -- robots.test`
- [ ] Automated: `npm test -w @seolite/core -- plugins.test`
- [ ] Automated: `npm test -w @seolite/core -- entry-isolation.test`
- [ ] Automated: `node -e "import('robots-parser').then(m=>process.exit(typeof m==='object'?0:1))"` (dep resolves)

### Phase 6 — M0 exit gate (CI-contract handoff to P6a)

**Changes**

| File | Why |
|---|---|
| (none new — verification pass) | Run the root trio; fix any lint/type fallout; confirm file inventory matches the ARCHITECTURE package table + this plan's Desired End State; confirm `git status` tracks only intended files. Handoff note for the ci-deploy aspect: its M0 workflow invokes exactly `npm run lint`, `npm run typecheck`, `npm test` (BA-10) — no flags, no extra steps. |

**Success Criteria**
- [ ] Automated (from repo root): `npm run lint && npm run typecheck && npm test`
- [ ] Automated: `npm test -w @seolite/core` (full core edge matrix)
- [ ] Automated: `git status --porcelain` shows no untracked build/runtime artifacts (`.seolite/`, `node_modules/`, `coverage/` ignored)

---

## Testing Strategy

Runner: **Vitest** (locked). All tests colocated `src/*.test.ts`, deterministic (injected
transport/resolver/clock/sleep/rng + fake timers; zero live network) per I9/I10 and BA-15.
Every IMPLICIT_SPEC edge → owning test:

| IMPLICIT_SPEC edge | Test (file → cases) |
|---|---|
| SC-1 workspace layout, SC-2 toolchain | Phase 1/6 commands (`npm test`, trio green); per-package smoke tests `index.test.ts`; `test -d packages/*` checks |
| SC-3 unknown keys → error listing valid keys | `config.test.ts` → unknown top-level key; unknown key under `providers`/`crawl`/`byok`/`severityOverrides`; malformed JSON; non-object JSON; missing file → defaults; range violations (0/negative/non-integer `maxPages` etc.); invalid enum: `failThreshold: 'fatal'` → ConfigError listing `error\|warning\|info\|off`; `severityOverrides` value outside `error\|warning\|info` → ConfigError (F4); `maxPages: 20000` → resolved `crawl.maxPages === 10000` (R3 clamp, F5) |
| SC-3 + BA-14 discovery | `config.test.ts` → loads explicit path via injected `read`; cwd default documented |
| SC-4 failThreshold semantics | `gate.test.ts` → equality at threshold fails (exit 1 class); issue below threshold passes; `off` never gates; ordering info<warning<error; `countIssuesAtOrAbove` tallies `countsBySeverity` correctly |
| SC-5 BYOK names | `config.test.ts` → invalid env-var name pattern rejected; valid name accepted verbatim; loader asserts values are never read from env |
| SC-5/SC-6 unknown provider name (I2) | `registry.test.ts` → unknown `providers.keywords` name → error listing available fixture names; unknown `byok` key → same; absent boundary → accessor returns `undefined` |
| SC-7 unknown rule id / duplicates | `registry.test.ts` → `severityOverrides` with unknown id → error listing known ids (incl. plugin id); duplicate plugin id rejected; `effectiveSeverity` resolves override over default |
| SC-8 plugins | `plugins.test.ts` → valid default-export rule loads; wrong shape → typed error naming file; missing file; module that throws on import; main entry does NOT import plugin machinery |
| SC-9 payload required fields | `models.test.ts` → model-contract fixtures for all 8 architecture-listed models + PageReport; `kind` closed enum; nullable honesty fields (`CruxRecord`, `score`, `position`) |
| SC-10 SSRF blocklist | `ssrf.test.ts` → each I12 range as literal (IPv4 + IPv6), mapped-IPv6 form, `0.0.0.0`, `::`, bracketed IPv6, port ignored, scheme case-insensitivity, IDN host allowed when public; non-http(s) schemes (`file:`, `ftp:`) → typed error |
| SC-10 per-hop re-validation | `ssrf.test.ts` → public → 302 → `169.254.169.254` → `SsrfBlockedError`; public → 302 → `http://localhost/` blocked; 302 → `ftp:` → RedirectError('scheme') |
| SC-10 Node resolver validation | `node` path exercised in `entry-isolation.test.ts`/`fetcher-basics.test.ts` via injected `resolve` returning a private IP → blocked pre-connect |
| SC-11 timeout | `fetcher-resilience.test.ts` → delegate hangs → fake timers advance → `TimeoutError` (no retries); with retries → `RetryExhaustedError` after 3 attempts |
| SC-11 backoff+jitter | `fetcher-resilience.test.ts` → seeded `rng` → observed sleep ∈ [0, 2^attempt × base]; attempt count bounded; exponential growth verified |
| SC-11 Retry-After | `fetcher-resilience.test.ts` → 429 + `Retry-After: 2` → slept 2 s then retried (503 too); HTTP-date form parsed (seeded `now` — F1); invalid header → fallback backoff; `Retry-After: 3600` → `RetryAfterCapError` (30 s cap, BA-4) |
| SC-11 retry scope | `fetcher-resilience.test.ts` → 500/network-error retried on GET; POST not retried by default; caller abort mid-flight fails immediately with `AbortedError` without consuming retries (F3) |
| SC-11 typed errors + label | `fetcher-resilience.test.ts` → every error class (incl. `AbortedError`, `RetryAfterCapError` — F3) carries `label` ('pagespeed' fixture) and is `instanceof SeoliteError` |
| SC-12 User-Agent | `fetcher-basics.test.ts` → UA header present on initial + robots-style calls; caller-supplied UA overridden; init headers merged without dropping caller keys; UA `<version>` equals `packages/core/package.json` `version` (sync test, F6) |
| SC-13 redirect discipline | `ssrf.test.ts`/`fetcher-resilience.test.ts` → 6-hop chain → RedirectError('hop-cap') at 5; A→B→A → RedirectError('loop'); all hops re-validated (combined with SC-10 redirect cases) |
| SC-14 robots matrix | `robots.test.ts` → 200 + allow/deny rules via policy; 404 → allow-all; 500, 429, network throw → disallow-all; garbage body → allow-all; `crawlDelay`/`sitemaps` surfaced; robots request itself carries UA + goes through guarded fetcher (fixture delegate asserts) |
| SC-15 HistoryStore | `models.test.ts` → interface fixture (in-memory) type-checks + `position: null` preserved; no storage impl ships in core (compile-level) |
| SC-16 identity / no telemetry | Phase 1 LICENSE grep commands; `entry-isolation.test.ts` → core main entry import graph contains no `node:` specifiers and no outbound-call modules; dep list reviewed in review gate |
| SC-17 provenance determinism | `models.test.ts` → `mkMetric` with injected `retrievedAt` → identical outputs across two runs; no `Date.now()`/`new Date()` in core src (grep check in review gate) |

Phase gate discipline: a phase is not done until its Success Criteria commands are green AND the
previous phases' commands still pass (root trio at Phase 6 is the cumulative gate).

## References

- `/Users/nagarwal/repos/learn/seolite/thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — I1–I17, bounding assumptions, evidence ledger (npm workspaces, robots-parser staleness, Workers limits, Vitest >=4.1)
- `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — locked decisions, package table, SPI signatures, payload required fields, M0 sequencing
- `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` — R1–R10 authoritative cross-plan decisions (severity vocabulary, failThreshold default, budget clamp, `@seolite/site` workspace, BYOK scheme, M0 merge order)
- `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite-scaffold-core/IMPLICIT_SPEC.md` — this aspect's edges SC-1..SC-17 + BA-1..BA-15
- `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite-scaffold-core/PLAN_VALIDATION.md` — adversarial review; findings F1–F8 all resolved in this revision
- RFC 9309 (Robots Exclusion Protocol grammar) — basis for BA-1 staleness-risk reasoning
- https://www.apache.org/licenses/LICENSE-2.0.txt — full license text for LICENSE (I8)
- https://docs.npmjs.com/cli/using-npm/workspaces — workspaces + `--workspaces` script fan-out
- Vitest 4 docs (projects config replacing workspace file; `vi.useFakeTimers`) — https://vitest.dev
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/ — why core main entry stays Node-free (I6)
- https://developer.chrome.com/docs/crux/api — `CruxRecord` histogram-bin shape reference
- registry.npmjs.org entries verified 2026-08-29: `robots-parser@3.0.1`, `vitest@4.1.11`, `cheerio@1.2.0`, `@modelcontextprotocol/sdk@1.30.0` (not used in M0)
