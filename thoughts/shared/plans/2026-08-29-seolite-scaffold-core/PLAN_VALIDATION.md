# PLAN VALIDATION — scaffold-core (P1 of M0) · 2026-08-29

Adversarial review by a reviewer who did not author the bundle. Default stance: FAIL until the plan
earns PASS with evidence. Greenfield — internal consistency and evidence conformance only.
Cross-referenced (not re-reviewed): `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md`
(I1–I17), `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` (locked contracts),
`thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` (R1–R10, override conflicting bounding
assumptions). Line refs: PLAN.md and IMPLICIT_SPEC.md in this directory unless prefixed otherwise.

Repo-state spot check performed 2026-08-29: `~/repos/learn/seolite` HEAD is `dfcec53` (plan cites
`97d79a6` — one docs commit landed after authoring; benign), contains only `.gitignore` + `thoughts/`,
no `packages/` — PLAN.md:25-27 Current State claims verified accurate.

---

## Checklist 1 — Every spec invariant has a named mechanism

**Verdict: FAIL (1 mechanism contradicts the spec's own seam requirement; 1 validation edge unnamed; 1 stale wording item reconciled by R1).**

| Edge | Verdict | Evidence | Notes / fix |
|---|---|---|---|
| SC-1 workspace layout | PASS | PLAN.md:217-272 (Phase 1 table + SC); per-package `test`/`typecheck` scripts PLAN.md:230 | Exact package names; `site/` placeholder present (but see Checklist 3, F2: R4 workspace conflict) |
| SC-2 toolchain contract | PASS | PLAN.md:224-231 (`tsconfig.base.json` extended by all, root trio scripts 244-248) | strict+NodeNext+ESM; Vitest only runner |
| SC-3 config surface | PASS (with F4) | PLAN.md:320 (`config.ts` full behavior), tests PLAN.md:456-457 | Unknown keys per level, malformed/non-object JSON, missing→defaults, numeric range validation all named |
| SC-4 failThreshold | PASS (with F4) | PLAN.md:321 (`gate.ts`, EXIT 0/1/2), tests PLAN.md:458 | Equality-at-threshold, `off`, ordering all tested |
| SC-5 BYOK names | PASS | PLAN.md:320 (pattern `^[A-Z_][A-Z0-9_]*$`), tests PLAN.md:459; unknown byok key PLAN.md:460 | Loader never reads values (injected `read`); R5 scheme `SEOLITE_<P>_KEY` fits pattern |
| SC-6 provider SPI + registry | PASS | PLAN.md:285 (5 interfaces + opts with `signal?`), 322, 338-344; verbatim vs ARCHITECTURE.md:31-35 | `available`-relative validation is the only coherent M0 design (no providers exist until P3) |
| SC-7 AuditRule SPI + registry | PASS | PLAN.md:286, 322; verbatim vs ARCHITECTURE.md:36-37 | duplicate-id, unknown-override-id, `effectiveSeverity` all named (PLAN.md:461) |
| SC-8 plugins Node-only | PASS | PLAN.md:404, tests PLAN.md:462; quarantine PLAN.md:107-108 | Shape validation names the file; main entry stays Node-free |
| SC-9 payload models | PASS | PLAN.md:282-284, 288; model-contract test pins every ARCHITECTURE.md:41 field (Checklist 3 enumerates all) | Additions limited to P1-delegated gaps (PageReport, opts, HistoryEntry, ResolvedConfig) — SC-9's own rule |
| SC-10 SSRF guard | PASS | PLAN.md:358 (pure predicate, I12 ranges + BA-6 superset), 361 (per-hop re-check); tests PLAN.md:464-466 | DNS-rebinding ToCToU correctly out of scope (IMPLICIT_SPEC.md:112) |
| **SC-11 resilience** | **FAIL (F1)** | IMPLICIT_SPEC.md:118 "Clock/sleep/randomness/transport/hostname-resolution collaborators MUST be injectable"; PLAN.md:99 and PLAN.md:449-450 both claim clock is injectable — but `FetcherOptions` (PLAN.md:368-376) lists only `delegate?/resolve?/sleep?/rng?`, **no clock/now seam** | HTTP-date `Retry-After` (test PLAN.md:469) is impossible to test with zero wall-clock dependence without a controllable `now`. Fix: add `now?: () => number` to `FetcherOptions` and seed it in the Retry-After tests |
| SC-12 User-Agent | PASS (nit F6) | PLAN.md:360; tests PLAN.md:472 (present, caller UA overridden, headers merged) | `<version>` interpolation source unspecified (F6) |
| SC-13 redirect discipline | PASS | PLAN.md:361 (hop cap 5, seen-set loop detection, per-hop scheme+SSRF); tests PLAN.md:473 (6-hop→hop-cap at 5; A→B→A→loop) | Typed `RedirectError{reason}` distinguishes causes |
| SC-14 robots policy | PASS | PLAN.md:403 (BA-1 wrapper, full SC-14 matrix, guarded fetcher); tests PLAN.md:474 | Architecture explicitly delegates the checker choice (ARCHITECTURE.md:13); BA-1 is the sanctioned record |
| SC-15 HistoryStore | PASS | PLAN.md:287, test PLAN.md:475; no impl ships (interface only, compile-level assertion) | Fields match IMPLICIT_SPEC.md:136-139 exactly |
| SC-16 repo identity | PASS | PLAN.md:228 (LICENSE), 227 (.gitignore `.seolite/`), LICENSE grep SC PLAN.md:271; no-telemetry by construction (only deps: robots-parser + cheerio) | Verified LICENSE/README/.gitignore gaps exist in repo today |
| SC-17 provenance determinism | PASS | PLAN.md:281, 293-299 (`mkMetric`, injected `retrievedAt`); test PLAN.md:477 | `new Date()` ban is a review-gate grep, not a lint rule — nit, mechanism exists and is tested |
| I4 per-host rate limiting / I15 oversized bodies & sitemaps / I13 output safety | PASS (out of scope correctly) | `perHostMinDelayMs` typed PLAN.md:284, enforcement P2 per ARCHITECTURE.md:22 package split; R3 assigns body/sitemap caps to audit; I13 owned by audit/site (IMPLICIT_SPEC.md:118 context) | Aspect-scoped subsets match IMPLICIT_SPEC §1 relevance column and R3 ownership |

## Checklist 2 — Retry / partial failure / concurrency actually handled

**Verdict: FAIL (minor — F3: promised error classes not in the taxonomy).**

- Retry: PASS. Bounded retries (GET/HEAD; network/429/5xx per BA-5), exponential backoff + full jitter with seeded `rng` asserting `sleep ∈ [0, 2^attempt × base]`, attempt-count bound, invalid Retry-After → fallback backoff, `Retry-After: 3600` → typed error at 30 s cap (PLAN.md:361, tests PLAN.md:467-470). Concrete, not hand-waved.
- Cancellation: PASS. Caller signal composed with per-attempt deadline; abort consumes no retries and this is test-enforced (PLAN.md:135-137, 470).
- Partial failure: PASS for this aspect's scope. Core owns the honest shapes (`incomplete`, `score: number|null`, nullable `CruxRecord`/`position`) + pure counting helpers; aggregation/enforcement is P2's per ARCHITECTURE.md:22. Explicitly scoped, not silently dropped (PLAN.md:138-139).
- Concurrency: PASS. No shared mutable state; registries/configs frozen at construction after one-time validation (PLAN.md:140-141); global cap typed (`CrawlBudgets.maxConcurrency`), enforcement delegated to P2 with the type owned here per ARCHITECTURE.md:21.
- **F3 (FAIL):** PLAN.md:130-132 promises "every failure mode (… retries exhausted, **abort**) into a **distinct typed SeoliteError subclass**", and BA-4 (IMPLICIT_SPEC.md:161-162) makes Retry-After > 30 s "surface as a typed error" — but `errors.ts` (PLAN.md:359) names only `SsrfBlockedError`, `TimeoutError`, `RetryExhaustedError`, `RedirectError`. No abort class, no Retry-After-cap class. Fix: name them (e.g. `AbortedError`, and assign the cap error a class) and assert `instanceof` in the existing abort/cap tests.

## Checklist 3 — All downstream consumers enumerated; locked required fields covered

**Verdict: FAIL (F2: contradicts locked R4; F5: R3 clamp missing; F7: CONTRIBUTING unowned). Signature/field conformance itself is complete.**

- Consumers enumerated: PASS. P2, P3, P4, P6a each with their dependency list (PLAN.md:143-154). No consumer of the core contracts is missing from the list.
- **Payload field conformance — independently re-derived field-by-field against ARCHITECTURE.md:41-42: PASS.** `KeywordIdea{term,source,estimateLabel?,lang?}`, `SerpResult{position,url,title,snippet?}`, `PageSpeedReport{scores{performance,seo,accessibility,bestPractices},metrics{lcp,cls,tbt,fcn},source}` (including the architecture's literal `fcn`), `CruxRecord{metrics:{name:{p75,histogramBins}},source}` + `HistogramBin`, nullable per contract, `AuthoritySignal{domain,kind:'rank'|'score',value,provider,attribution}`, `PageContext{url,status,headers,dom,bytes,timingMs,robotsAllowed}` with `dom: CheerioAPI` type-only (BA-12), `Issue{ruleId,severity,message,evidence{selector?,snippet?},fixHint?}`, `SiteAuditReport{id,startedAt,completedAt,pages,summary{countsBySeverity,score},incomplete,configSnapshot}` (elided as `…` in PLAN.md:283 but pinned by the model-contract test, PLAN.md:288), Metric wrapper `{value,source{provider,kind,attribution?},retrievedAt}` with the exact five-kind closed enum (PLAN.md:293-299). All 8 models + PageReport present. No locked field missing.
- SPI conformance: PASS. `Fetcher`, five providers, `AuditRule` reproduced verbatim (PLAN.md:302-306, 337-344 vs ARCHITECTURE.md:30-38). `createProviderRegistry`/`createRuleRegistry` splitting the architecture's `createRegistry(config)` comment is a justified refinement, not a contract break (different validation rule sets; I2 edge preserved in both).
- Exit codes / budgets: PASS. EXIT 0/1/2 (PLAN.md:321) = ARCHITECTURE.md:49; budget numbers match R3 exactly (BA-3 IMPLICIT_SPEC.md:157-159 vs RECONCILIATION.md:9), and R3's audit-owned caps are correctly NOT absorbed here.
- **F2 (FAIL): R4 locks "npm workspace `@seolite/site` at path `site/`" with `-w @seolite/site` commands (RECONCILIATION.md:10), but the plan pins `workspaces: ["packages/*"]` (PLAN.md:223, 242) and `site/README.md` — "not an npm workspace" (PLAN.md:233).** The scaffold is exactly the artifact that freezes the workspace layout; as written, `npm run build -w @seolite/site` (P6b/P5 contract) cannot work without a later root-manifest edit this plan neither makes nor schedules. Fix: `workspaces: ["packages/*", "site"]` plus a private placeholder `site/package.json` (no scripts — root `test` projects glob and `--if-present` typecheck are unaffected), and correct the site/README line.
- **F5 (FAIL): R3 specifies `maxPages 100 (clamp 10k)` (RECONCILIATION.md:9); the plan's config work has only positive-integer range validation (PLAN.md:320, tests PLAN.md:456) — no clamp anywhere.** Core config is R3's single owner, so the clamp belongs here. Fix: clamp `maxPages` at 10 000 in `loadConfig` (or reject >10k — but then R3's word "clamp" must be honored or amended) and add a test case.
- **F7 (FAIL, minor): ARCHITECTURE.md:55 repo conventions include CONTRIBUTING; the plan creates LICENSE/README stub/.gitignore (PLAN.md:227-229) but neither delivers CONTRIBUTING nor defers it with a named owner in "What We're NOT Doing" (PLAN.md:72-87).** Fix: stub in Phase 1 or an explicit deferral line naming the owning aspect.

## Checklist 4 — No correctness traded for "simpler"

**Verdict: PASS.**

- Native `redirect: 'follow'` rejected *for* correctness (per-hop SSRF re-validation) — PLAN.md:178-180. Correct direction.
- `exactOptionalPropertyTypes` OFF is recorded as a deliberate default (PLAN.md:224); it is outside `strict`, is a type-ergonomics choice not a soundness hole, and is disclosed — acceptable.
- Hand-rolled config validation over zod justified by the I15 exact-message requirement and zero-dep posture (PLAN.md:167-169); schema is genuinely small and flat.
- robots-parser wrapper over vendored checker justified by RFC-9309 wildcard/longest-match risk, with the wrapper as the vendoring escape hatch (PLAN.md:160-165, BA-1). The staleness risk is acknowledged, not ignored.

## Checklist 5 — No new pattern where an existing one fits

**Verdict: PASS.**

npm workspaces (locked, ARCHITECTURE.md:9), ESLint 9 flat config (PLAN.md:169-171), Vitest 4 `projects` over the deprecated workspace file (PLAN.md:182-183 — correct for the locked Vitest ≥4.1), `exports`→TS source with M2 `publishConfig` deferral (BA-13, justified: no cross-package runtime consumer until M1). Every rejection carries a reason; no NIH.

## Checklist 6 — No TBDs; no mechanisms smuggled into the spec

**Verdict: PASS (with F6 and one doc-hygiene item F8).**

- Zero literal TBD/open-question markers in either file (verified by scan; PLAN.md:7 claims it and holds).
- Delegation points are legitimate: PageReport (ARCHITECTURE delegates to P1), robots checker choice (ARCHITECTURE.md:13 delegates to P1; recorded as BA-1 — the sanctioned §3 location), PageSpeed/Crux/Authority opts types (architecture leaves `o` unnamed; SC-6 requires the signal).
- **F6 (minor):** `USER_AGENT = 'seolite/<version> (+…)'` (PLAN.md:360) leaves `<version>` interpolation unsourced — in a Workers-safe ESM module this needs a stated mechanism (injected constant / package.json import at the Node boundary / build-time stamp). One line in the plan fixes it.
- **F8 (doc hygiene, R1-reconciled — not a plan defect):** IMPLICIT_SPEC.md:65 and :155 still say `notice` while R1 locked `error|warning|info` (RECONCILIATION.md:7) and the plan correctly implements `info` (PLAN.md:280, test row PLAN.md:458 "ordering info<warning<error"). R1 wins per the review charter; align the spec wording so the bundle is self-consistent.

## Checklist 7 — Success criteria verify the invariants with exact commands

**Verdict: PASS.**

- Exact commands throughout: `npm install`/`lint`/`typecheck`/`test` + LICENSE `grep` + `test -d` inventory (PLAN.md:267-272); per-phase `npm test -w @seolite/core -- <file>` (PLAN.md:309-311, 347-350, 391-394, 427-430); Phase 6 cumulative `npm run lint && npm run typecheck && npm test` + `npm test -w @seolite/core` + `git status --porcelain` (PLAN.md:441-443). Arg-passing syntax (`-- models.test` → vitest filename filter) is valid.
- Coverage: all 10 test files named in the Testing Strategy (PLAN.md:453-477) are invoked by a phase's Success Criteria; the model-contract test (PLAN.md:288) pins every locked required field against future drift; phase-gate discipline makes the suite cumulative (PLAN.md:479-480). Not just "it runs".

## Checklist 8 — Resource analysis re-derived (incl. R6 bootstrap contract)

**Verdict: PASS.**

- R6 bootstrap contract: RECONCILIATION.md:12 orders scaffold → ci-deploy P6a → core code. The plan makes the trio green at Phase 1 with placeholder smoke tests specifically so P6a can wire it before core code (PLAN.md:93-95, "trio is the CI gate P6a wires"; handoff note PLAN.md:438). Root `lint`/`typecheck`/`test` scripts exist from Phase 1 (PLAN.md:244-248); per-package scripts from Phase 1 (PLAN.md:230) make `--workspaces --if-present` resolvable. Contract satisfied.
- Deps: robots-parser ~10 KB zero-transitive and cheerio already needed Node-side by P2 (PLAN.md:196-199) — plausible; nothing paid, no accounts. CI < 2 min at M0 size on free public-repo Actions — consistent with research Seam 5.
- Workers budget: main-entry Node-free/cheerio-runtime-free/dynamic-import-free, enforced by an automated import-graph test, not prose (PLAN.md:205-207, 405, entry-isolation.test). Correct mechanism for the 3 MB ceiling concern.
- Nit: `cheerio` as a core **runtime** dependency (PLAN.md:402) for type-only usage is heavier than needed — `devDependencies` suffices for M0/M1 (unpublished, private) since P2 depends on cheerio itself; revisit at M2 `publishConfig`. Not a correctness issue.
- Current State claims verified against the live repo (see header): accurate.

---

## Fixes required (all localized)

1. **F1** PLAN.md:368-376 — add `now?: () => number` (clock) to `FetcherOptions`; seed it in Retry-After/HTTP-date tests (SC-11, IMPLICIT_SPEC.md:118).
2. **F2** PLAN.md:52, 223, 242, 233 — include `site` in root `workspaces` with a private placeholder `site/package.json`; correct "not an npm workspace" (R4, RECONCILIATION.md:10).
3. **F3** PLAN.md:359 — name the abort error class and the Retry-After-cap error class; assert them in the existing tests (PLAN.md:130-132, 469-470).
4. **F4** PLAN.md:456-458 — add config.test cases: `failThreshold` outside `error|warning|info|off` → ConfigError; invalid severity value in `severityOverrides` → ConfigError.
5. **F5** PLAN.md:320 — implement/test the R3 `maxPages` clamp at 10 000 (RECONCILIATION.md:9).
6. **F6** PLAN.md:360 — state the `<version>` sourcing mechanism for the UA constant.
7. **F7** PLAN.md:229/72-87 — CONTRIBUTING: Phase 1 stub or explicit deferral with named owner (ARCHITECTURE.md:55).
8. **F8** IMPLICIT_SPEC.md:65,155 — replace stale `notice` with `info` per R1 (doc hygiene only; plan already conforms).

None of these requires structural rework: the phase decomposition, TDD cycle, locked-signature conformance, and consumer enumeration all hold under re-derivation.

VERDICT: MINOR-FAIL
