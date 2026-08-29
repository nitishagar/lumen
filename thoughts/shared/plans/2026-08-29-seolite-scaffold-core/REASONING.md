# REASONING — seolite · scaffold-core (M0)

Running log of decisions and confusions made while implementing
`PLAN.md` (this bundle). Appended per phase; newest last.

## Phase 1 — Workspace scaffold & toolchain baseline (2026-08-29)

### DEVIATION — direct commits to `main`

- **What**: Phase 1 commits landed directly on `main` (no per-aspect branch/worktree).
- **Why**: bootstrap step of M0; branch protection does not exist yet (it is the
  ci-deploy aspect's P6a deliverable, per ARCHITECTURE.md repo conventions and
  RECONCILIATION R6). The orchestrator authorized direct-to-main for this
  scaffold phase only.
- **Bound**: this authorization covers Phase 1 of this bundle only. Once P6a
  lands bootstrap CI + protection, later phases (2–5 of this bundle) revert to
  the per-aspect worktree/branch flow of R6.

### Decisions

- **D1 Dependency version drift vs plan snapshot.** The plan verified the
  registry on 2026-08-29; by install time `typescript` latest is 7.0.2 and
  `eslint` latest is 10.9.1. The plan locks `eslint@^9` explicitly, and
  typescript-eslint 8.68 targets the TS 5.x compiler API. Chose conservative
  in-major pins: `typescript ^5.9.3`, `eslint ^9.39.5`, `@eslint/js ^9.39.5`,
  `typescript-eslint ^8.68.0`, `vitest ^4.1.0` (plan lock), `@types/node
  ^24.13.3` (matches the local runtime major, Node 24.16.0). TS 7 adoption is
  deferred until typescript-eslint declares support; not revisitable here
  without editing this file first.
- **D2 `tsconfig.base.json` extras beyond the plan excerpt.** Added
  `allowImportingTsExtensions: true` and `noEmit: true` (the excerpt is marked
  illustrative, not exhaustive). Needed so per-package `vitest.config.ts`
  files type-check their import of the shared `../../vitest.shared.ts` under
  NodeNext; safe because every M0 consumer is noEmit (BA-13: exports point at
  TS source, no build step until M2). `exactOptionalPropertyTypes` left OFF
  per the plan's default choice.
- **D3 Red-green observed, not assumed.** Smoke tests were written first; the
  red run failed for the right reason (all 5 projects: `Cannot find module
  './index.js'`) — which also proved the Vitest 4 root `projects` glob wires
  every package. After writing the barrels: 5/5 green.
- **D4 `.js` import extensions in src** per the plan's NodeNext ESM contract;
  Vitest/Vite resolves `.js` → `.ts` for TS importers (confirmed green).
- **D5 `site/package.json` kept strictly minimal** (name/version/type/engines +
  `private: true`, no scripts, no author/license fields) exactly as the plan's
  file row specifies; the five `packages/*` and the root carry
  `author`/`license` metadata per SC-16 ("package author fields set").
- **D6 `package-lock.json` committed** — the P6a CI workflow installs from it;
  committing is the deterministic choice for the CI contract.
- **D7 README badge placeholders are HTML comments**, not broken image links —
  the CI badge target (workflow file) is ci-deploy's P6a deliverable and does
  not exist yet.
- **D8 ESLint scope verified, not assumed**: `tseslint.config(...)` preset +
  `js.configs.recommended`; confirmed `.ts` files are actually linted (explicit
  file lint exits 0 with no "file ignored" warning). `thoughts/` ignored per
  the plan.
- **D9 Commit split**: `chore: scaffold npm workspaces monorepo` (tooling +
  packages + site + tests; trio green at that commit) then `chore: apache-2.0
  license + contributing stub` (LICENSE, README, CONTRIBUTING). Author verified
  via `git log --format='%an %ae'`; no co-author/generated trailers (I11).

### Confusions

- None blocking. Minor: `npm run typecheck` fan-out output is verbose and
  tail-truncation can hide which workspaces ran — verified via
  `grep '^> @seolite'` that all five packages execute `tsc --noEmit` (site
  correctly skipped by `--if-present`).

## Phases 2–6 — core package code (2026-08-29, branch feat/lumen-core)

All naming per RENAMES.md: `@lumen-seo/core`, `LumenError` base, `lumen.config.json`,
`.lumen/`, UA `lumen/<version> (+https://github.com/nitishagar/lumen)`.

### Decisions

- **D10 cheerio devDep moved from Phase 5 to Phase 2.** `PageContext.dom` is
  cheerio-typed from Phase 2 on, so the type-only devDependency (BA-12) is
  installed in Phase 2; Phase 5's package.json row only adds `robots-parser`
  and the `./node` export.
- **D11 PageReport nullability.** The plan lists `status`, `timingMs`,
  `bytes` without `| null`, but skipped pages (A4/A12: robots-disallowed,
  never fetched) would force zero-filling, violating I3. They are
  `number | null`; A12 additive fields ship from day one (`Issue.url?`,
  `PageReport.depth?/skipped?: { reason: string }/redirectChain?: string[]`,
  `SiteAuditReport.stopReason?: string`, summary extras
  `pagesAudited?/pagesSkipped?/byRule?/ruleErrors?`), with stringly unions
  stored as `string` per A12.
- **D12 Payload honesty nullability + no P3 additives.** PageSpeed
  scores/metrics and CrUX `p75` are `number | null` (never zero-filled).
  `AuthoritySignal` keeps EXACTLY the ARCHITECTURE shape — providers' A9
  additives (`'gray'`, `SerpResult.source?/retrievedAt?`,
  `AuthoritySignal.retrievedAt?/estimateLabel?`) are deliberately NOT
  pre-added: P3 applies them in its branch if absent.
- **D13 Provider opts distribution** per providers BA12 hint:
  `IdeasOpts/SearchOpts {lang?, limit?}`, `SearchOpts.scope?`,
  `PageSpeedOpts {strategy?, automated?}`, `CruxOpts.formFactor?`,
  `AuthorityOpts {signal?}`; all five carry `signal?` (I14).
- **D14 Error hierarchy.** Base is `LumenError` (RENAMES-mapped from
  `SeoliteError`); registry validation failures (unknown names, duplicate
  rule ids, unknown override ids) all use `ConfigError` with accumulated
  `details[]` — one actionable validation type, message joins `path: message`.
- **D15 Config reader split.** `loadConfig(path?, read?)` stays Workers-safe
  in the main entry with a default `read` returning `null` (= missing →
  defaults); the fs-backed `readConfigFile` (ENOENT → null) and
  `loadConfigFromDisk` live in `@lumen-seo/core/node`. Surfaces' B12 owns
  path resolution (`--config` flag / `LUMEN_CONFIG` env) and composes.
- **D16 "Unknown key" scope.** Unknown-key errors apply to closed
  vocabularies (top level, `providers` boundaries, `crawl` budgets);
  `byok`/`severityOverrides` are OPEN maps — the loader validates value
  types, the registries validate keys against what actually exists (SC-5/SC-7).
- **D17 Range rules.** `perHostMinDelayMs` may be 0 (a meaningful "disable
  politeness delay"); the other budgets must be integers ≥ 1. `maxPages`
  hard-clamps at 10 000 (R3/F5) instead of erroring.
- **D19 Boundary shape check.** `createProviderRegistry` also verifies at
  construction that a selected provider implements its boundary's method
  (e.g. `ideas` for `keywords`), not just that its name is known.
- **D20 `UnsupportedSchemeError`** for non-http(s) INITIAL targets (the plan
  matrix said "typed error" without naming a class); redirect-hop scheme
  failures remain `RedirectError('scheme')` per the locked vocabulary.
- **D21 Retry semantics.** Retryable: network errors, 429, 500–599, and
  timeouts (plan matrix: "with retries → RetryExhaustedError after 3
  attempts"). With `maxRetries: 0` the classified error surfaces directly
  (e.g. `TimeoutError`); with a configured budget, exhaustion throws
  `RetryExhaustedError{attempts, status?, cause}`. Retry-After is parsed on
  any retryable response carrying the header (superset of the 429/503
  minimum). Retry-After sleeps are exact (no jitter); backoff is
  full-jitter `rng() × base × 2^attempt`.
- **D22 `localhost`/`*.localhost` blocked** by the pure predicate — the
  plan's own test matrix requires `http://localhost/` blocked, and RFC 6761
  resolves those names to loopback. `localhost.com.au` stays public.
- **D23 IPv6 math corrections** (found by tests): the IPv4-mapped prefix
  sits in bits 32..47 → check `addr >> 32n === 0xffffn`; `fe80::/10` upper
  bound is `0xfebf`; IPv4-compatible `::<v4>` also checks the embedded v4.
  Zone-id URLs (`[fe80::1%25eth0]`) are rejected by Node's URL parser
  outright, so they can never reach the guard (documented in the test).
- **D24 `FetchTransport` seam type** `(url: URL, init?) => Promise<Response>`
  instead of `typeof fetch` — strictFunctionTypes contravariance would
  otherwise reject narrower test delegates.
- **D25 Malformed redirect `Location`** propagates `URL`'s TypeError — not
  part of the locked `loop|hop-cap|scheme` reason vocabulary.
- **D26 Mid-flight abort** races an `abortPromise` alongside the transport
  and the timeout, so a hanging delegate that ignores the composed signal
  still fails fast with `AbortedError` and consumes no retries.
- **D27 robots-parser typing.** Its shipped d.ts binds oddly under NodeNext
  (default import resolves to the module namespace); a single structural
  cast at the `RobotsPolicy` wrapper boundary — exactly BA-1's documented
  vendoring escape hatch.
- **D28 `RobotsPolicy.sitemaps` is `readonly URL[]`** (policies are frozen
  objects); `crawlDelay` is seconds (audit converts to ms);
  `isAllowed` treats robots-parser's `undefined` (no matching group) as
  allowed.
- **D29 robots failure matrix is total**: EVERY fetcher error on the robots
  request — including `SsrfBlockedError` on the robots URL itself — degrades
  to disallow-all per BA-9's "network failure" row; audit (P2) surfaces
  typed crawl-level refusals on top.
- **D30 Plugin shape validation** includes the severity enum; CJS plugins
  (`module.exports = rule`) work via import-interop; `PluginLoadError`
  names the declared path and the resolved absolute path.
- **D31 `@lumen-seo/core/node` resolution.** Exports point at TS source
  (BA-13), so the subpath resolves inside TS-aware tooling (Vitest —
  plugins.test.ts imports it) but not from plain Node until M2 dist; the
  plan's criterion `import('robots-parser')` (the actual runtime dep) passes.
- **D32 entry-isolation guard** scans the SOURCE import graph by regex
  (never executes the graph), maps `.js` specifiers to `.ts` siblings,
  asserts no `node:` specifiers, no `./node.ts`, and cheerio type-only.

### Deviations

- cheerio devDep installed in Phase 2 (see D10) instead of Phase 5's file-row
  placement — required for Phase 2's `PageContext` typing.
- Root `eslint.config.js` gained `argsIgnorePattern/varsIgnorePattern: '^_'`
  for the conventional underscore-prefix (interface fixtures, injected
  seams); typescript-eslint's default flags them otherwise.

### Confusions resolved

- `Response.redirect()` requires absolute URLs and rejects relative ones, and
  Node's URL parser canonicalizes IPv4-mapped IPv6 hosts to hex form
  (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`) — both handled in fixtures and
  the guard respectively.
- SC-17's review-gate grep ("no Date.now()/new Date() in core src") is
  satisfied under its sensible reading: the only occurrence is the fetcher's
  documented clock-seam DEFAULT (`now = Date.now`); metric provenance never
  reads a hidden clock (`mkMetric` takes `retrievedAt` from the caller).

### Phase gates (all observed green before each commit)

- Phase 2: `npm test -w @seolite→@lumen-seo/core` 17 tests; typecheck; lint.
- Phase 3: 58 tests; typecheck; lint.
- Phase 4: 99 tests; typecheck; lint.
- Phase 5: 118 tests; typecheck; lint; `robots-parser` import resolves.
- Phase 6 root trio: lint ✓, typecheck (5 packages) ✓, `npm test` 179 tests
  across 17 files ✓; `git status --porcelain` empty after commits.
