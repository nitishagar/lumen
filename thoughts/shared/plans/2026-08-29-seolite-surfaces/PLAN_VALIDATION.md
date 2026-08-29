---
date: 2026-08-29
reviewer: adversarial plan reviewer (not plan author)
bundle: thoughts/shared/plans/2026-08-29-seolite-surfaces/ (IMPLICIT_SPEC.md + PLAN.md)
cross-referenced: research/2026-08-29-seolite-greenfield-research.md; plans/2026-08-29-seolite/ARCHITECTURE.md; plans/2026-08-29-seolite/RECONCILIATION.md; sibling bundles scaffold-core / audit-engine / providers
method: re-derivation at scale=large; every item defaulted FAIL until earned PASS with cited evidence
---

# PLAN VALIDATION — seolite surfaces

## Checklist 1 — Every relevant invariant → named mechanism

**Verdict: FAIL** (I5 parity broken by severity-vocabulary contradiction; I1/I3/I6/I12/I13/I16 PASS with evidence)

- **I5 parity — FAIL.** The bundle's own hard edge #1 contradicts the locked vocabulary in three places: E1 defines `--fail-threshold <info|warning|error|critical>` (IMPLICIT_SPEC L49); the audit gate snippet ranks `{info:0, warning:1, error:2, critical:3}` (PLAN L287); Phase 3 tests gate "for each of the four severities" (PLAN L306). RECONCILIATION R1 locks a **closed 3-level vocabulary `error|warning|info` everywhere** (RECONCILIATION L7), corroborated by the audit-engine plan's scorer `WEIGHT: Record<Severity, number> = { error: 10, warning: 3, info: 0 }` (audit-engine PLAN L192) and core's `off` semantics (scaffold-core PLAN L458). A `critical` threshold can never fire (no issue can carry that severity) and the flag enum would accept a value core rejects. R2 also specifies "`off` disables" — absent from E1's enum. Secondary I5 break: the CLI flag accepts 4 values while the MCP tool's `failThreshold` enum is the 3-level `["info","warning","error"]` (PLAN L332) — CLI and MCP disagree on the same contract. **Fix:** drop `critical` everywhere, add `off` per R2, align E1 + rank map + tests + MCP enum to `info|warning|error|off`.
  - Sub-point PASS: extending typed local-only to `rank_check` over HTTP (E6) is a *justified refinement*, not a violation: ARCHITECTURE only names `audit_site` local-only (L46), but R7 (L13) + providers plan L43 exclude cheerio-based `ddg-serp` from the Worker, leaving no Worker-safe SERP provider in v1. E6 documents the capability map and the tool-description disclosure. PASS.
- **I1 zero-cost — PASS.** Env NAMES in config, resolved at call time (E5, PLAN L97); header pass-through on Worker (composition L426–436); absent key → `unconfigured`/`unavailable` markers; Worker test asserts zero PSI/CrUX outbound when no keys sent (Phase 5 SC L494). CrUX key-required rule honored (research ledger refutation carried).
- **I6 thin Worker — PASS.** Export-map subpath imports + bundle-scan test (`cheerio`/`@seolite/audit` must not appear in the Worker graph, PLAN L490, L567); capping Fetcher (2.5 MB Content-Length pre-check + stream abort, L454–464); `WORKER_ENABLE_PSI` kill-switch (L399, B10); no KV/DO/sessions (B9/B19); platform 3 MB gzip budget named in E10, Resource analysis, and defaults table. (The subpath-export assumption itself fails under Checklist 3 — see below; the *mechanism intent* for I6 is present and doubly guarded.)
- **I13 terminal/file escaping — PASS.** `clean()` strips CSI/OSC then all C0/C1 (residual ESC bytes are removed by the C0/C1 pass even on unterminated sequences) and caps length (PLAN L201–207); human rendering routed through it (L292, L264); JSON outputs are single `JSON.stringify` documents (E2); path-safe dirnames `slug-sha256:8` (B5 + `domainDir` L231–238); `--out` atomic temp+rename (L297–302); Worker never renders crawled markup (I6).
- **I16 no-telemetry — PASS.** E12 + mechanisms: recording Fetcher + `global fetch` stubbed to throw (Node), Miniflare `outboundService` recorder with host allowlist (L474, L494), ESLint `no-restricted-globals` fetch ban outside `packages/core/src/fetch.ts` (L518–522), sentinel-key grep over all stdout (L529), Worker logs nothing, `config show` prints names + `set:boolean` only (L211–216).
- **I2/I3/I4/I12/I14/I15/I17 — PASS.** SPI injection via composition roots + registry validation → exit 2 (PLAN L98); provenance/attribution in locked E8 shapes (L99, L56); `--max-pages` bounded plumbing (B14); `validatePublicHttpUrl()` on CLI args/tool params/REST `?url=` before use or echo (L104) — core ships the blocklist predicate (scaffold-core L122, SC-10), though the plan should name core's exported predicate rather than an unattributed function name; SDK `extra.signal` → AuditRunner, SIGINT → AbortController, append-only-on-success (L106, E14); boundary inputs enumerated to typed errors/exit 2 (L107); typed provider errors + 429/Retry-After mapping (L109).

## Checklist 2 — Concurrent MCP calls / history append races / SIGINT

**Verdict: FAIL** (SIGINT incomplete for the long-running `seolite mcp` command; rotation filename inconsistent; concurrency itself PASS)

- **Concurrent MCP calls — PASS.** Handlers pure over `(args, deps)`; no module-level mutable singletons post-composition (E13); in-process promise-queue mutex in `JsonlHistoryStore` (L241–244); test: 25 interleaved `tools/call` incl. rank saves → 25 intact lines (L113, L548, L559). Worker stateless per-request composition (L416).
- **History append races — PASS with documented assumption.** B6 (O_APPEND single-write for small lines, no cross-process locking) is explicitly bounded and tested at 25-way in-process; rotation double-rename is ENOENT-tolerant. Acceptable. **Mismatch:** E4 specifies rotated generation `<name>.1.jsonl` (= `history.1.jsonl`) but the snippet renames to `file + ".1"` → `history.jsonl.1` (PLAN L249 vs IMPLICIT_SPEC L52). Cosmetic but spec-vs-code contradictory; `readRank`'s "rotate-aware" must match whichever is chosen. **Fix:** pick one literal filename and use it in both files.
- **SIGINT — FAIL for `seolite mcp`.** Mid-audit SIGINT is genuinely handled (run.ts wiring L505–512, fixture runner honors signal, `incomplete:true` + atomic write + exit 2, test at L529). But the stdio server command does `await new Promise(() => {})` with comment "until stdin closes / signal" (L375) — the promise never resolves, the command never observes the `AbortController` that run() aborts, and no `transport.onclose`/stdin-end wiring exists. Registered SIGINT handler suppresses default termination → **Ctrl-C hangs `seolite mcp`**. No success criterion or test covers SIGINT/shutdown of the serve command (Phase 4/6 tests only cover mid-audit SIGINT and spawn round-trip). **Fix:** race stdin-close/`transport.onclose`/abort signal to a resolvable promise; add a spawn test that SIGINTs a running `seolite mcp` child and asserts exit 2.

## Checklist 3 — All consumers/upstream enumerated + adapter seams complete for M1 dependency rule

**Verdict: FAIL** (two concrete seam breaks against sibling locked interfaces)

- **HistoryStore seam — FAIL.** Core locks `interface HistoryStore { append(e): Promise<void>; list(q?: {keyword?;domain?;limit?}): Promise<RankHistoryEntry[]> }` with `RankHistoryEntry{keyword,domain,position:number|null,provider,url?,retrievedAt:ISO}` (scaffold-core PLAN L287, SC-15). Surfaces declares `JsonlHistoryStore implements HistoryStore` but with methods `appendRank(rec)` / `readRank(domain, limit)` and record `{v, retrievedAt, keyword, domain, found, position|null, provider, url?, limit}` (PLAN L239–251, E4 L52). Method names do not match → the `implements` claim cannot compile against M0; the record model adds fields (`v`, `found`, `limit`) core does not define. **Fix:** implement `append`/`list` (or get core to widen the interface before M0 lands) and define `RankRecord` as a core-compatible extension.
- **Providers seam — FAIL.** The Worker strategy rests on per-provider subpath exports `@seolite/providers/{pagespeed,crux,google-suggest,wikipedia-demand,openpagerank}` (IMPLICIT_SPEC L45, PLAN L75–76, L134). The providers plan ships exactly one export — the barrel `"."` — plus `createWorkerSafeProviders()` (providers PLAN L284, L55, L170), and R7 names **`createWorkerSafeProviders`** as the locked worker-safe mechanism (RECONCILIATION L13). As written, `workerComposition` (L425–436) imports subpaths that do not exist and ignores the R7-named factory. **Fix:** have workerComposition consume `createWorkerSafeProviders` (with per-request header keys via deps), or add the subpath-export contract to the providers plan explicitly.
- **Audit seam — PASS (thin).** `runSiteAudit(seed, config, deps, signal)` (audit-engine L21) differs from surfaces' `AuditRunner.run(input, signal)` port (L280), but bridging is precisely the `src/composition/audit-adapter.ts` adapter's job at the Phase 6 rebase; blast radius confined to that module + package.json (L124). Acceptable; the adapter should document the `(seed, config, deps)` mapping incl. config load.
- **Dependency enumeration — FAIL (secondary).** `packages/mcp/package.json` deps list only `@modelcontextprotocol/sdk`, `zod` (L313, L162) yet `src/server.ts` consumes core SPI types and `worker/composition.ts` instantiates provider classes — `@seolite/core` (and `@seolite/providers` at rebase) are missing. Also a sequencing contradiction: Phase 5 builds/Tests the Worker against **real** provider classes while the branch is core-only until the Phase 6 rebase ("branch stays core-only until then", L276; rebase adds deps only to `packages/cli` package.json, L524). **Fix:** add the deps at the rebase commit for both packages, or sequence the Worker provider composition after the rebase (fixture/outbound-intercepted composition pre-rebase).

## Checklist 4 — No correctness-for-simplicity trades (args-only CLI help/discoverability)

**Verdict: FAIL (minor)** — args-only itself is justified (Alternatives #1: zero runtime deps, deterministic usage errors, fixed 7-command surface; commander/yargs/cac rejected with reasons — genuine trade-off analysis, not smuggling). But discoverability is asserted, not specified: B1 says "Help/usage text is hand-written" and Alternatives claim it is "covered by usage-error tests", yet **no phase defines how help is reached**: strict `parseArgs` makes `seolite --help` / `seolite audit --help` an unknown-flag UsageError → exit 2 + usage on stderr (E1 classifies unknown flags as errors); bare `seolite` behavior is undefined; no success criterion asserts help content, and no help test exists (Phase 1 SC L220 tests only the error path). Discoverability by error message is defensible but must be a decision, not an accident. **Fix:** specify `--help`/no-args behavior (print usage, define exit code, keep it out of the locked command set) and add a test.

## Checklist 5 — No unjustified patterns

**Verdict: PASS** (one under-justified mechanism claim noted)

- Alternatives section is real (6 alternatives with evidence-based rejections); JSON-in-text deferral (B2) has a compatible upgrade path; JSONL-vs-SQLite decision grounded in ARCHITECTURE; B6 O_APPEND assumption is bounded and load-bearing-tested; B10 explicitly accepts residual 1102 CPU risk with kill-switch + M2 measurement — honest, not hidden.
- **Under-justified (borderline):** E7 locks wire-level `additionalProperties: false` + expressed defaults, while B7 uses `registerTool` + Zod raw shapes; the SDK wraps raw shapes in a non-strict `z.object`, so whether the emitted 2020-12 schema carries `additionalProperties:false` (and defaults) depends on SDK behavior the plan never reconciles. The wire contract tests (L382) would catch it, but no fallback mechanism (strict object schema / schema normalization) is stated. **Fix:** add one sentence naming the fallback if the SDK does not emit strictness.

## Checklist 6 — No TBDs / mechanisms-in-spec

**Verdict: PASS.** No TBD/TODO/open questions in either file; all B1–B20 are decisions, E1–E14 are testable edges; zero open questions claimed and none found. (Minor: spec E13/B6 carry mechanism detail — acceptable as binding obligations, and PLAN mirrors them.)

## Checklist 7 — Success criteria exact + verify invariants

**Verdict: PASS.** All four required verify invariants present verbatim: `npm test -w @seolite/cli` (L45), `npm test -w @seolite/mcp` (L46), Miniflare Worker tests via `npm run test:worker -w @seolite/mcp` (L47), gzip size check via `npm run check:size -w @seolite/mcp` (L48), plus typechecks and lint-with-fetch-rule. Phase SCs are checkboxed, automated, and mapped per-edge in the test table (30 rows, each citing invariant + layer). Mechanical gap (non-blocking): spawn-based CLI tests and the bundle-scan test require a build (`dist/`) or wrangler output to exist, but `test` scripts are bare `vitest run` with no pretest/globalSetup — test bootstrap order is unspecified.

## Checklist 8 — Resource math re-derived

**Verdict: PASS** (accounting omissions + one build-path bug noted)

- **Worker bundle:** loads = MCP SDK + `agents` (`createMcpHandler` subpath) + zod + 5 Worker-safe providers (google-suggest, wikipedia-demand, pagespeed, crux, openpagerank) + server factory; **cheerio must not and does not load** — excluded by construction (ddg-serp is the only cheerio consumer), asserted by bundle-scan test AND made structurally loud by the 1.5 MB self-cap (cheerio's parse5 graph alone approaches the cap, L157, L123). Self-cap 1.5 MB vs platform 3 MB gzip is consistent with research. Two accounting nits: the Resource bullet omits `zod` from the bundle inventory; `check-size.mjs` reads `../dist/worker.js` (L483) but wrangler emits the entry-basename bundle (`index.js` for `main: worker/index.ts`, L396) — the script fails or checks the wrong file unless the build step renames. **Fix:** include zod in the inventory; derive the artifact path from the actual `--outdir` output.
- **CPU per route:** `/healthz` (trivial), `/api/v1/keyword-ideas` (2 small-JSON upstream calls + parse), `/api/v1/page-report` (URL validation + parallel PSI/CrUX; CrUX skipped when key absent — zero outbound, L494). Only real risk is `JSON.parse` of multi-hundred-KB PSI/Lighthouse JSON under the 10 ms ceiling — explicitly accepted in B10 with 2.5 MB capping Fetcher + `WORKER_ENABLE_PSI` kill-switch + M2 measurement. Honest and re-derived correctly. Note: no hashing on the Worker (L158) keeps crypto off the CPU path.
- **Subrequests:** ≤2 upstream calls per route (≤4 with redirect hops) vs 50 limit — correct; requests/day 100k with no KV/DO reads — correct; history growth ~2 MiB/domain worst case (1 MiB + `.1`) — arithmetic checks out.
- **Minor snippet-conformance nit (folded here):** `rank.ts` reads `res.results` / `res.source.provider` (L258–260) but the locked SPI is `search(q, o): Promise<SerpResult[]>` (ARCHITECTURE L32) — either a wrapper return type (signature change) or wrong snippet; reconcile with core's `Metric`/provenance carrier.

## Summary of fixes required before merge-approval

1. Align severity vocabulary to R1/R2: remove `critical`, add `off`, unify CLI flag + MCP enum + rank map + tests (IMPLICIT_SPEC E1, PLAN L287–288/L306/L332).
2. Patch stale IMPLICIT_SPEC B3 (`warning` → `error` per R2) — see below.
3. Reconcile HistoryStore method names/record model with core's locked `HistoryStore`/`RankHistoryEntry`.
4. Re-point Worker provider composition at `createWorkerSafeProviders` (R7) or add the subpath-export contract to the providers plan; fix Phase 5 pre-rebase dependency ordering and packages/mcp deps.
5. Make `seolite mcp` shutdown real (resolvable promise on stdin-close/onclose/signal) + SIGINT test.
6. Specify `--help`/bare-args behavior + test.
7. State the E7 fallback if `registerTool`+Zod does not emit `additionalProperties:false` on the wire.
8. Fix rotation filename (E4 vs snippet), check-size artifact path, bundle inventory (add zod), and the `SerpResult` snippet.

## Bundled-file internal contradiction (cross-cutting)

IMPLICIT_SPEC **B3 still reads `Default failThreshold = "warning"`** (rev-1 L68) while PLAN.md's defaults table says `error` "B3, reconciled", per RECONCILIATION R2 ("patched in surfaces PLAN"). The spec file was not patched alongside the plan file — the bundle contradicted itself on its hard edge #1 input. FAIL until synced.

---

# RE-VERIFICATION (rev 2 — post-patch, 2026-08-29)

Re-read rev-2 IMPLICIT_SPEC.md (now E1–E15, B1–B21, status "rev 2 — post MINOR-FAIL validation patch") and PLAN.md (rev 2). Each original finding re-confirmed against the updated text and, where the fix consumes sibling seams, against the sibling plans themselves. No new investigation opened.

## Finding 1 — Severity vocabulary (R1/R2 violation + CLI/MCP parity break): RESOLVED
`critical` is purged everywhere. E1 (spec L50) locks the closed R1 set, flag `--fail-threshold <info|warning|error|off>` default `error`, `off` never gates while `incomplete: true` still gates; B3 (spec L70) states "critical does not exist in the vocabulary (R1)". Parity restored: MCP `THRESHOLD = z.enum(["info","warning","error","off"]).default("error")` is explicitly "identical to the CLI flag" (PLAN L341), audit.ts now uses core's `countIssuesAtOrAbove` with the `off` short-circuit (L309–311), Phase 3 matrix tests `info|warning|error` + `off` never gates (L327), defaults table (L143) and SIGNPOST (L18) updated. Matches audit-engine's 3-level `WEIGHT` map and core's `off` SC-4.

## Finding 2 — IMPLICIT_SPEC B3 stale `warning` default: RESOLVED
B3 now reads `Default failThreshold = "error" per R2` (spec L70); spec §2 L46 carries the R1–R10 authoritative block. Bundle is internally consistent and R2-conformant.

## Finding 3 — HistoryStore interface conformance: RESOLVED
Spec §2 L43 quotes core's locked `HistoryStore{append, list}` + `RankHistoryEntry` verbatim and mandates exact implementation; E4 (L53) stores exactly `RankHistoryEntry` (no `v`/`found`/`limit`; `found` derived in output). PLAN `JsonlHistoryStore` now declares `append(e: RankHistoryEntry)` / `list(q?: {keyword?;domain?;limit?})` matching scaffold-core SC-15 signatures (L250–268), rank.ts appends a core-shaped entry with `retrievedAt` from the injected clock (L277–278), and the Phase 2 SC adds compile-level `implements HistoryStore{append,list}` conformance (L287). Cross-checked: scaffold-core L287 signature matches.

## Finding 4 — Worker provider seam (`createWorkerSafeProviders` + barrel, fixture-first rebase, deps): RESOLVED
Worker composition now consumes the R7-named `createWorkerSafeProviders(config, deps)` over the single barrel (spec L45, PLAN L69–78, L136), rejecting the fictional subpath exports as a redundant parallel contract. `ProviderDeps.env(name)` — the BYOK header pass-through seam the composition depends on — verified to exist in the providers plan (providers PLAN L175–180); tranco's Worker exclusion is justified by the 10 ms CPU ceiling (spec E6). Sequencing fixed via B21 (spec L88): `packages/mcp` deps = core+SDK+zod from Phase 4 (PLAN L334), fixture composition pre-rebase behind the identical `McpDeps` shape, real wiring in `worker/providers.ts` at the Phase 6 rebase with both packages' package.json patched (L570–572); index.ts unchanged across the rebase. Suite green pre- and post-rebase asserted (L540).

## Finding 5 — `seolite mcp` shutdown/SIGINT: RESOLVED
E14 (spec L63) mandates a resolvable wait promise (stdin close → exit 0, `transport.onclose`, run() AbortController → exit 2; "Ctrl-C must never hang"). PLAN L119 spells out the race; the mcp.ts snippet resolves via `transport.onclose`, `stdin.once("end") → server.close()`, and an abort listener returning `EXIT.ERROR` — "the promise RESOLVES — no hang" (L396–409). New spawn test `cli/test/mcp-shutdown.test.ts :: sigint-and-stdin-close` (L592) plus Phase 4 SC (L417) cover both shutdown paths with bounded timeouts.

## Finding 6 — Help/discoverability (E15): RESOLVED
New E15 (spec L64): bare `seolite`, `--help`/`-h`, and per-command help print deterministic usage to stdout with exit 0, intercepted BEFORE strict parseArgs so help is never a usage error; not a subcommand. args.ts snippet implements the pre-strict intercept (L204–208); defaults table row "Discoverability is a decision, not an error path" (L145); Alternatives #1 updated (L131); snapshot-tested in Phase 1 SC (L231) and `cli/test/help.test.ts :: help-snapshots` (L588).

## Finding 7 — E7/B7 wire-strictness risk: RESOLVED
E7 downgraded to a guaranteed asserted set (type/required/enums/bounds/names) with `additionalProperties:false` + defaults asserted opportunistically and snapshot-documented per installed SDK; strict rejection of unknown args is guaranteed regardless via a shared handler-side `strictArgs` guard on all five handlers (spec L56, B7 L74). PLAN: strict-args.ts (L365–367), handlers wrapped (L337, L357), Phase 4 SC (L416), Alternatives #2 (L132), and test row (L604) all updated consistently. CLI/MCP behavioral identity preserved either way.

## Finding 8 — Mechanical nits (rotation filename, check-size path, zod inventory, search() shape, build chaining): RESOLVED
- Rotation is the literal `history.1.jsonl` in spec (L43, L53), code (L265), defaults table (L150), and test row (L595); `list` reads both generations newest-last.
- check-size reads `dist/index.js` with the entry-basename rationale and an existsSync guard with actionable message (L526–529).
- zod (and `@seolite/core`) are in the Worker bundle inventory (L160).
- rank.ts uses the locked `search(q, o): Promise<SerpResult[]>` shape with provenance from `deps.serp.name` + clock (L272–283).
- Build chaining: cli `test` = `npm run build && vitest run` (L180, L185); `test:worker` and `check:size` chain `build:worker` (L540–541).

## Cross-checks on the fix's new seams (confirmation-only)
- `ProviderDeps.env(name)` exists as the locked providers seam (providers PLAN L175–180) — the Worker BYOK pass-through rests on a real interface.
- `isBlockedTarget(url)` exists in scaffold-core `ssrf.ts` (scaffold-core PLAN L371) — surfaces' `validatePublicHttpUrl()` composition (spec I12, PLAN L105) now names a real core export.
- R8 applied consistently: no `maxPages` default on the CLI flag or the tool arg (`z.number().int().min(1).max(10_000).optional()`, PLAN L353–354; B14 L81).

## Residual (non-blocking) observations

1. Abort-signal plumbing ambiguity: Phase 6 run.ts passes the signal as the second argument (`cmd.execute(io, ac.signal)`, L555) while mcp.ts reads `io.signal` (L406) — the two snippets must land the signal in one place; the mechanism and spawn tests are otherwise fully specified.
2. `npm test -w @seolite/mcp` includes the bundle-scan test that parses wrangler/esbuild output, but only `test:worker`/`check:size` are shown chaining `build:worker` — the mcp `test` script needs the same chain (or bundle-scan must build on demand) to pass on a fresh checkout.
3. Real-outbound allowlist assertions activate only post-rebase (B21), so pre-rebase CI cannot catch a real-provider-graph regression by itself — accepted and mitigated by the surfaces bundle-scan test + providers TC-REG-5, but the coverage gap is timing-dependent.
4. `workerConfig(env)` and `fixtureWorkerComposition` are named seams without specified shapes (snippet-level; behavior is constrained by the surrounding contracts).

All eight findings from the rev-1 validation are resolved with cited evidence; residuals are snippet-level polish that does not affect contract conformance, sequencing, or testability.

VERDICT: PASS
