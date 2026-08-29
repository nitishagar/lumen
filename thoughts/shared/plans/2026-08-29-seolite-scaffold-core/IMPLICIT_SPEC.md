---
date: 2026-08-29
aspect: scaffold-core (P1 of M0)
project: seolite
plan_protocol: create_plan_generic_v2_5 (scale=large)
inherits: /Users/nagarwal/repos/learn/seolite/thoughts/shared/research/2026-08-29-seolite-greenfield-research.md — Implicit Spec I1–I17 + research bounding assumptions (cited, not restated)
conforms_to: /Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md (locked decisions, package table, SPI signatures, payload required fields, sequencing)
status: complete
---

# IMPLICIT SPEC — aspect: scaffold-core (M0)

## 1. Inherited invariants (I1–I17)

This aspect inherits, verbatim and in full, the Implicit Spec I1–I17 and the research-level
bounding assumptions defined in
`thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` (section "Implicit Spec",
lines 100–126). They are requirements, not designs. Index only (definitions live in the
research doc — do not rely on this index alone):

| # | Short name | Relevance to scaffold-core |
|---|---|---|
| I1 | Zero-cost defaults | BYOK config stores env-var NAMES only; skip-never-crash semantics referenced |
| I2 | Pluggability at every data boundary | provider SPI + registry; unknown-name error |
| I3 | Data honesty | provenance wrapper on every metric; failure ≠ zero-fill |
| I4 | Crawl etiquette | User-Agent, robots default-respect, Retry-After honored |
| I5 | MCP-first parity | not exercised in M0 beyond keeping core transport-agnostic |
| I6 | Worker stays thin | core main entry must stay importable in Workers (no Node-only side effects) |
| I7 | Look derived, not copied | not exercised in M0 |
| I8 | License & attribution | Apache-2.0 LICENSE at root; author/copyright fields |
| I9 | TDD gate | tests before implementation per phase; deterministic; CI-runnable commands |
| I10 | Determinism | no live network, no wall-clock dependence in tests |
| I11 | Repo hygiene | identity Nitish Agarwal; no AI trailers; public-repo conventions |
| I12 | SSRF safety | Fetcher blocklists + per-hop re-validation + scheme whitelist |
| I13 | Output safety | not owned by core (audit package owns sanitization); core emits no markup |
| I14 | Concurrency/cancellation/partial failure | crawl budget types; AbortSignal threading; per-request timeout |
| I15 | Boundary inputs | config unknown keys, non-http(s) schemes, redirect loops, malformed robots, IDN hosts |
| I16 | Privacy / no telemetry | zero telemetry in core; BYOK names never values |
| I17 | Retry & backoff | timeout, bounded retries, backoff+jitter, Retry-After, typed errors with provider name |

## 2. Aspect-specific edges (SC = scaffold-core)

These are requirements for this aspect only. They refine — never weaken — I1–I17.

- **SC-1 Workspace layout** — The monorepo MUST contain exactly the packages and names of the
  ARCHITECTURE.md package table: `packages/core`→`@seolite/core`, `packages/audit`→`@seolite/audit`,
  `packages/providers`→`@seolite/providers`, `packages/cli`→`@seolite/cli`, `packages/mcp`→`@seolite/mcp`,
  plus a non-published `site/` placeholder. Every package MUST be independently testable via
  `npm test -w <pkg>` and type-checkable via `npm run typecheck -w <pkg>`. Root scripts MUST fan out
  via npm `--workspaces`. All packages MUST declare `engines.node >= 22` and `"type": "module"`.

- **SC-2 Toolchain contract** — TypeScript strict, ESM-only, Node >= 22, with ONE shared base
  tsconfig extended by every package; Vitest is the only test runner; `lint`, `typecheck`, and `test`
  MUST all be runnable from the repo root (this trio is the contract the bootstrap CI workflow
  from the ci-deploy aspect will invoke — the workflow file itself is out of scope here).

- **SC-3 Config surface** — `seolite.config.json` supports exactly these top-level keys:
  `providers` (per-boundary provider-name selection), `severityOverrides` (ruleId → severity),
  `crawl` (budget numbers), `failThreshold`, `byok` (provider name → env-var NAME),
  `plugins` (array of local file paths). Unknown keys at ANY level MUST produce a typed config
  error that lists the valid keys for that level. Malformed JSON, or JSON that is not an object,
  MUST produce a typed config error. A missing config file MUST NOT be an error — full defaults apply.
  Numeric fields MUST be range-validated (positive integers where bounded, e.g. `maxPages >= 1`).

- **SC-4 failThreshold semantics** — Severity is the closed set `error | warning | notice`
  (ordered `notice < warning < error`). `failThreshold` accepts one of those three plus `off`;
  default `error`. The exit-code contract is: 0 = ok/under-threshold, 1 = at least one issue at or
  above `failThreshold` (equality counts), 2 = config/provider error. Core MUST expose pure,
  deterministic threshold-comparison helpers; the CLI (P4) consumes them.

- **SC-5 BYOK env-var names** — `byok` values MUST match a valid env-var NAME pattern
  (`^[A-Z_][A-Z0-9_]*$`). The loader MUST NOT read, resolve, log, or persist env-var VALUES;
  values are read at call time by providers (P3). A `byok` key that is not a known provider name
  MUST raise the I2 unknown-name error listing available provider names.

- **SC-6 Provider SPI + registry** — Core MUST define the five locked provider interfaces
  (`KeywordProvider`, `SerpProvider`, `PageSpeedProvider`, `CruxProvider`, `AuthorityProvider`)
  with exactly the ARCHITECTURE.md signatures, plus their opts types (each opts MUST include an
  optional `AbortSignal` for I14 cancellation). The registry MUST validate every configured name
  against the set of providers it is given; unknown name → typed error listing the available
  names. A boundary that is not configured MUST resolve to "absent" so callers can apply I1
  skip-with-explicit-reason semantics (the skip behavior itself is P3/P4).

- **SC-7 AuditRule SPI + rule registry** — Core MUST define the locked `AuditRule` interface and a
  rule registry that: rejects duplicate rule ids; validates `severityOverrides` against the union
  of built-in and plugin rule ids (unknown override id → typed error listing known ids); and
  exposes `effectiveSeverity(ruleId)` resolving overrides over built-in defaults.

- **SC-8 Plugins (Node-only)** — `plugins` entries are local module paths loaded dynamically in
  Node only, behind a `@seolite/core/node` subpath export. Each plugin module MUST default-export
  a value that satisfies `AuditRule` (runtime shape-validated; failure → typed error naming the
  file). The main core entry MUST remain importable in non-Node runtimes (I6) — no Node-only
  side effects at import time.

- **SC-9 Payload models** — Core MUST define exact TypeScript models containing EXACTLY the
  required fields/names from ARCHITECTURE.md for `KeywordIdea`, `SerpResult`, `PageSpeedReport`,
  `CruxRecord`, `AuthoritySignal`, `PageContext`, `Issue`, `SiteAuditReport` (plus `PageReport`,
  which the architecture leaves to P1 to define). Every metric value MUST be wrapped as
  `{ value, source: { provider, kind, attribution? }, retrievedAt }` with `kind` in the closed set
  `official | community | heuristic | lab | field`. Honesty nullability is encoded in types:
  `CruxRecord` nullable when not configured, audit `score` nullable when not computable, and rank
  history `position` nullable when not found (never zero-filled, I3). Any field added beyond the
  architecture list MUST be limited to gaps the architecture explicitly delegates to P1.

- **SC-10 Fetcher SSRF guard** — All outbound HTTP in core flows through the one locked `Fetcher`
  interface. It MUST accept only `http`/`https` schemes (case-insensitive, post-normalization);
  non-http(s) targets → typed error (I15). It MUST refuse, at minimum, the exact I12 blocklist
  (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10) and MAY
  conservatively extend it (e.g. unspecified addresses, IPv4-mapped IPv6). The guard MUST
  re-validate every redirect hop target. The blocklist decision logic MUST be pure and unit-testable
  without any network. On Node, hostname resolution results MUST be validated before connect;
  DNS-rebinding ToCToU remains out of scope per the inherited I12 bounding assumption.

- **SC-11 Fetcher resilience (I17)** — Every request MUST have a per-attempt timeout; retries MUST
  be bounded; backoff MUST be exponential with jitter; `Retry-After` MUST be honored where present
  (429/503); failures MUST surface as typed, actionable errors carrying the provider/label name.
  Clock/sleep/randomness/transport/hostname-resolution collaborators MUST be injectable so every
  resilience behavior is testable with zero live network and zero wall-clock dependence (I9/I10).

- **SC-12 User-Agent (I4)** — Every request MUST carry a fixed UA identifying the tool with a
  contact URL (`seolite/<version> (+https://github.com/nitishagar/seolite)`). Callers MUST NOT be
  able to suppress or override it in v1.

- **SC-13 Redirect discipline (I15)** — Redirect following MUST enforce: a hop cap, loop detection
  (repeat-target detection), and per-hop scheme + SSRF re-validation, each with a typed error
  distinguishing the cause.

- **SC-14 robots.txt (I4)** — robots parsing MUST use a pure-JS checker (decision delegated to P1
  by ARCHITECTURE.md; chosen checker recorded in the plan's bounding assumptions) behind a
  core-owned policy interface exposing at least `isAllowed(url)`, plus crawl-delay and sitemap
  discovery for P2. Semantics: 2xx → parse; 4xx (incl. 404) → allow-all; 429/5xx/network
  failure → disallow-all (conservative, I4); unparseable body → allow-all (documented,
  Google-compatible). robots.txt itself MUST be fetched through the same guarded Fetcher (SSRF,
  UA, timeout apply).

- **SC-15 HistoryStore interface** — Core MUST define the `HistoryStore` interface and
  `RankHistoryEntry` (keyword, domain, position nullable, provider, optional url, ISO-8601
  `retrievedAt`) with at least `append` and filtered `list`. Core MUST NOT implement storage;
  the JSONL implementation belongs to the surfaces aspect (P4).

- **SC-16 Repo identity (I8/I11/I16)** — Full Apache-2.0 text at repo root with copyright
  "2026 Nitish Agarwal"; package author fields set; no telemetry dependencies, calls, or
  identifiers anywhere in core; `.gitignore` covers local runtime state (`.seolite/`).

- **SC-17 Provenance helpers (I3)** — Core MUST provide small deterministic helpers for building
  provenance-wrapped metrics; `retrievedAt` MUST come from the caller/injected time, never from a
  hidden wall-clock read, so outputs and tests are reproducible (I10).

## 3. Bounding assumptions (autonomous-mode conservative defaults; no open questions)

- **BA-1 robots checker**: `robots-parser@3.0.1` (npm) wrapped behind a core-owned policy interface.
  Rationale: robots grammar is frozen (RFC 9309) and a self-vendored checker re-implements subtle
  wildcard/longest-match semantics with high correctness risk; the wrapper is the vendoring escape
  hatch if the unmaintained package ever breaks.
- **BA-2 Severity model**: three levels (`error|warning|notice`); `failThreshold` default `"error"`,
  `"off"` disables gating. Conservative for CI gates (fewest false failures).
- **BA-3 Default budgets/fetch numbers**: crawl `{maxPages:100, maxDepth:5, maxDurationMs:300000,
  maxConcurrency:5, perHostMinDelayMs:250}`; fetch `{timeoutMs:10000, retries:2 (3 attempts),
  maxRedirects:5}`. All overridable via config/fetcher options; numbers picked small-and-safe.
- **BA-4 Backoff/Retry-After**: exponential base 500 ms, factor 2, full jitter; `Retry-After`
  honored on 429/503 in seconds-form or HTTP-date form, capped at 30 s — a larger value surfaces as
  a typed error rather than blocking the run.
- **BA-5 Retry scope**: GET/HEAD only by default; retryable outcomes: network errors, 429, 5xx.
- **BA-6 SSRF list extension**: I12 minimum plus unspecified-address and IPv4-mapped-IPv6 forms
  (conservative superset; documented).
- **BA-7 DNS scope**: Node fetcher validates resolved IPs pre-connect; Workers-side fetcher applies
  the pure URL policy only (safe because the Worker never fetches user-supplied target URLs per
  ARCHITECTURE REST design).
- **BA-8 User-Agent**: fixed, no override option in v1 (honest identification beats configurability).
- **BA-9 robots failure matrix**: as SC-14 (2xx parse / 4xx allow / 429+5xx+network disallow /
  unparseable allow). Matches Google's documented robots behavior; "conservative" applies to fetch
  failure per I4.
- **BA-10 CI ownership**: the bootstrap CI workflow FILE belongs to the ci-deploy aspect (P6a,
  lands in M0 per ARCHITECTURE.md); this aspect ships the npm script contract that workflow
  invokes, and the M0 exit gate is that trio green locally.
- **BA-11 Node-only surface**: `@seolite/core/node` subpath hosts Node-only code (plugin loader,
  resolver-wired fetcher construction); main entry stays Workers-safe.
- **BA-12 cheerio in core**: dependency of `@seolite/core` for TYPE-ONLY use (typing
  `PageContext.dom` per ARCHITECTURE); core performs no cheerio calls and no vendor HTTP calls.
- **BA-13 Module resolution in-workspace**: package `exports` point at TS source for M0/M1
  (Vitest-native, no build step); `publishConfig` dist overrides deferred to M2 publishing.
- **BA-14 Config discovery**: `seolite.config.json` in the process cwd; no config-file search up the
  tree, no alternate formats (JSON only), no env-var path override in v1.
- **BA-15 Tests**: colocated `src/*.test.ts`; determinism via injected transport/resolver/clock/rng
  and fake timers; zero live network in any test (I9/I10).
