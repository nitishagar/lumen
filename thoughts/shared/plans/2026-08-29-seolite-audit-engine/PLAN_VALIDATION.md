# PLAN_VALIDATION — seolite audit-engine bundle (adversarial review)

Reviewed: PLAN.md + IMPLICIT_SPEC.md at `thoughts/shared/plans/2026-08-29-seolite-audit-engine/`, re-derived independently at scale=large against research Implicit Spec I1–I17 (owner of I4, I13, I14, I15), ARCHITECTURE.md (locked), RECONCILIATION.md R1–R10 (authoritative). Every item started FAIL; PASS granted only on concrete evidence (file:line). Key claims were re-executed where mechanically checkable.

## Checklist

### 1. Every relevant spec invariant has a named mechanism — PASS

- Binding set I1–I6, I9, I10, I12–I17 (I7/I8/I11 excluded, IMPLICIT_SPEC.md:16): the Invariants→mechanism table (PLAN.md:77-88) names a concrete mechanism for every row; I5/I6 are covered by the single-entry-point contract (PLAN.md:21,118) and Node-only scoping (PLAN.md:17,52).
- Aspect edges A1–A12 all land: A1 cross-origin recorded-not-crawled (PLAN.md:158, test PLAN.md:396); A2 full policy table (PLAN.md:139-147); A3 budget-before-dispatch + clamp + frontier cap (PLAN.md:135,269-270); A4 closed skip vocabulary (PLAN.md:207-210); A5 stop reasons + depth-complete semantics (PLAN.md:111, test PLAN.md:273); A6/A7 report + scoring (PLAN.md:189-202,351); A8 injected `now/delay/jitter/randomId` + no `Date.now`/`Math.random` in `src/` (PLAN.md:87,222-228); A9 imports core+cheerio only (PLAN.md:15,265); A10 `renderer:'static'` (PLAN.md:248); A11 GET-only, no conditional requests (PLAN.md:53, test PLAN.md:304); A12 additive types-only core PR with default action (PLAN.md:116; IMPLICIT_SPEC.md:53).
- Two named defects found elsewhere (items 6 and 8 below) do not remove a mechanism, but one spec-required behavior is under-defined (item 2 in Findings: hop-cap-without-repeat has no legal classification in the closed A4 vocabulary).

### 2. Concurrency / cancellation / partial-failure / robots-failure semantics — PASS (with two minor defects logged)

- Concurrency cap: fixed worker pool, in-flight max observable and tested ≤5 (PLAN.md:92, test PLAN.md:273/371).
- Cancellation: five-step abort chain (dispatch exit → sleep reject → in-flight AC fire → pool settle → partial report `incomplete:true`, resolve-not-reject) (PLAN.md:71,110,315); per-request deadline via injected `delay` so fake timers work (PLAN.md:95-107); tests for no-post-abort dispatch, in-flight signal delivery, prompt resolution, abort-during-sleep, no fabricated data, safe re-run (PLAN.md:318, edge map 32-34).
- Partial failure: fetch/parse throw → `fetch_error` skip, run continues (PLAN.md:112,302, test 401); robots refusal surfaces as typed errors with zero page fetches (PLAN.md:145-146, tests 382-387). Defect: rule-throw isolation is asserted in prose (PLAN.md:112) but has no named test anywhere in the edge→test map (edge 31 covers fetch errors only) — I9 gap, logged in Findings.
- Robots failure: conservative refuse-on-5xx/network with typed error, 429 one Retry-After-capped retry then refuse, 4xx→unrestricted, seed-disallowed typed error, lenient malformed parsing, `respectRobots:false` override that never bypasses rate limiter/budgets (PLAN.md:139-147; IMPLICIT_SPEC.md:36) — each row has a named test (PLAN.md:381-388).

### 3. Downstream consumers enumerated + contract-complete — PASS (one shape ambiguity logged)

- surfaces (P4): depends on `runSiteAudit`, built-in rule list (for `seolite config show`), typed robots errors (exit-code mapping), report shape; public API = `src/index.ts` only (PLAN.md:118,352). ARCHITECTURE.md:49 exit-code contract is satisfied by audit supplying typed errors + Issue severities; the mapping itself is P4's, correctly not duplicated here.
- ci-deploy: consumes exit codes via the CLI gate (ARCHITECTURE.md:49,56); audit's side of that contract is complete.
- providers (P3): zero interaction, merge-order independence holds (PLAN.md:117; A9, IMPLICIT_SPEC.md:43).
- site-docs (P5): report JSON is the data contract; audit ships inert stored strings, site still escapes at render (PLAN.md:119; IMPLICIT_SPEC.md:27).
- Contract-complete modulo one defect: the exact shape of `PageReport.skipped` (object vs string) is never pinned though P4 codes against it — Findings item 6.

### 4. No correctness traded for "simpler" — PASS

- Honest-link verification: fresh HEAD/GET per link rejected; unverifiable links never judged (PLAN.md:127, test 408) — honesty strengthened, not weakened.
- Zero-audited-pages → score 0, never 100 (PLAN.md:197-200, test 409) — matches I3's "never zero-filled as clean".
- Manual redirect following kept despite `redirect:'follow'` being simpler, specifically to preserve per-hop I12 re-validation, loop detection, and chain evidence (PLAN.md:123-124).
- Streaming SAX sitemap parser rejected in favor of cheerio xmlMode **only because** hard caps (2 MiB/10k/10) bound memory first (PLAN.md:126) — the caps are implemented and tested (PLAN.md:286,392-393), so simplicity was not bought with unboundedness.
- DNS-rebinding exclusion is pre-bounded by research, not a plan-level shortcut (IMPLICIT_SPEC.md:56; research I12 bounding).

### 5. No unjustified new patterns — MINOR-FAIL

- Justified new patterns: `CrawlRule`/`CrawlIndex`/`RuleContext` (crawl-level rules need cross-page data the locked per-page `check(page, o)` SPI cannot see; core contract unchanged — PLAN.md:213-221, alternative 2 rejection at 124); hand-rolled AbortSignal composition instead of `AbortSignal.any` (needed for fake-timer determinism — PLAN.md:71); audit-level single 429 retry on top of core retries is mandated by A2 itself (IMPLICIT_SPEC.md:36).
- DEFECT: `maxRedirectHops 10` (PLAN.md:135) is a new audit-owned config knob that appears in NEITHER list of RECONCILIATION.md:9 (R3 core-owned includes `maxRedirects 5`; the audit-owned list is maxBodyBytes/latencyThreshold/evidence/sitemap caps). Audit's manual following makes core's `maxRedirects 5` dead in audit's path, so 10 silently overrides an R3-authoritative value with no reconciliation note and no rationale anywhere in the bundle. Fix: either follow ≤5 hops to match R3, or add an explicit R3 note justifying 10 (and patch RECONCILIATION).

### 6. No TBDs, no mechanisms in spec — MINOR-FAIL

- No TBDs/TODOs/open questions (grep clean; status line PLAN.md:13). IMPLICIT_SPEC mechanisms are data-contract/decision level (skip vocabulary, stop reasons, types-PR default action) — acceptable requirements, not design smuggling.
- DEFECT: PLAN.md:112 contains unresolved self-editing debris — "recorded in report `configSnapshot`? No: recorded as a warning entry..." — an unfinished design thought left in the load-bearing partial-failure paragraph, and the sentence it resolves into leaves rule-throw handling ("swallowed with a console-level warning and counted in `summary.byRule` absence") without a named test (edge map #31, PLAN.md:401, covers fetch errors only). I9 requires every edge to have a named test before merge. Fix: rewrite the paragraph (rule throws → per-rule per-page error entry, no console reliance), add test `rules: a throwing rule is isolated and recorded, run continues`.

### 7. Success criteria verify invariants with exact commands — PASS

- Every phase gate is `npm test -w @seolite/audit` + `npm run typecheck -w @seolite/audit` (PLAN.md:277-278,293-294,307-308,321-322,340-341,359-360); Phase 6 adds `lint`/`build` + CI gate (PLAN.md:361-363). Names match the scaffold convention guard (IMPLICIT_SPEC.md:57) and ARCHITECTURE.md:61 per-branch scope.
- The 44-row edge→test map (PLAN.md:369-414) binds every invariant edge to a named test with a phase; tests are network-free via one fake fetcher boundary and fake timers (PLAN.md:271,367).

### 8. Resource math re-derived — PASS on boundedness and headline math (worst-case nits logged)

- Re-derived politeness math CONFIRMED: v1 is single-host (A1), so the 250 ms per-host spacing serializes starts at 4 req/s regardless of concurrency 5; 100 pages ≥ 25 s (100 × 0.25 s); the R3-authoritative 300 s budget (RECONCILIATION.md:9, PLAN.md:135) accommodates it 12×; page budget (100) bites before time budget, and the plan correctly says whichever bites first sets `stopReason` honestly (PLAN.md:253). Robots 429 Retry-After capped at 5 s cannot starve the 300 s budget.
- Memory CONFIRMED bounded: body reads stop at 2 MiB (Content-Length pre-check + streamed abort, PLAN.md:301); peak ≈ concurrency × (2 MiB + DOM) — the ~10× DOM factor is optimistic (parse5 trees can exceed it) but the bound is structural, not estimate-dependent; frontier seen-set capped at 100 × maxPages with a named test (PLAN.md:135,269, test 379); DOMs parsed and released per page, never retained in reports (PLAN.md:254).
- NITS (do not break boundedness): (a) "≤112 requests / ≤11 sitemap fetches" (PLAN.md:252) undercounts worst case — robots may list multiple `Sitemap:` lines and the ≤10-children cap is per index (PLAN.md:162), so the true bound is higher though still finite; (b) "few MB" report at the 10k ceiling (PLAN.md:254) ignores the 18×10 evidence-cap worst case (~tens of MB); (c) the rate-limiter gloss `nextAllowedAt = max(now + minIntervalMs, robots crawl-delay)` (PLAN.md:79) compares an absolute timestamp to a bare delay — the Phase 2 statement (max of the two delays, PLAN.md:285) is correct, but the seconds→ms conversion of crawl-delay (RFC 9309) is stated nowhere and the test fixture must encode it (test 386).

## Findings (max 8, ordered by severity)

1. PLAN.md:112 — unresolved editorial debris ("...configSnapshot? No:...") in the partial-failure paragraph; rule-throw isolation claimed but has no named test in the edge→test map (PLAN.md:401) — I9 violation for that edge.
2. PLAN.md:157 — redirect chain hitting the 10-hop cap WITHOUT a repeated URL has no defined outcome; A4's skip vocabulary (IMPLICIT_SPEC.md:38) is closed and contains no legal reason for it ("chain truncated at 10 hops" is welded into the redirect_loop row).
3. PLAN.md:244-245 — worked example contradicts its own snippet (executed: `audit-b-cher.example-20260829T101500-a1b2c3`, not the claimed `xn--bcher-kva.example-...Z` form); also `randomId()` is concatenated unsanitized, so I13 "report ids are path-safe" (IMPLICIT_SPEC.md:27) is conditional, and test #40 (PLAN.md:410) only probes hostile hosts.
4. PLAN.md:135 — `maxRedirectHops 10` silently overrides RECONCILIATION.md:9 R3's core-owned `maxRedirects 5` (and is absent from R3's audit-owned list) with no reconciliation note.
5. IMPLICIT_SPEC.md:50 — bundle still carries superseded defaults (`maxDurationMs 120,000`, per-request timeout 15,000 ms) contradicting authoritative R3 (300_000 / 10_000, RECONCILIATION.md:9) and PLAN.md:135 — internal bundle conflict the reader must resolve externally.
6. PLAN.md:154-157 — `skipped` serialized three ways (`{reason:'non_html'}` object vs bare `'oversized'`/`'redirect_loop'` strings) and `PageReport.skipped`'s type is never pinned, though surfaces (P4) codes against this field (A12, PLAN.md:116).
7. PLAN.md:101,106 — deadline snippet registers a per-request `abort` listener on the run-level signal with no `removeEventListener` in `finally` (Node MaxListeners warnings + controller retention at the 10k-page ceiling) and never cancels the deadline timer (`void timer`).
8. PLAN.md:252-254 — worst-case resource claims undercount (≤11 sitemap fetches ignores multiple robots `Sitemap:` lines × 10 children; "few MB" report ignores the 18×10 evidence cap); PLAN.md:79's limiter gloss compares absolute `nextAllowedAt` to a bare crawl-delay with the seconds→ms conversion unstated.

## Verdict rationale

No binding invariant lacks a mechanism; the concurrency/cancellation/robots state machines, honesty rules, and headline resource math all survive independent re-derivation, and consumers are enumerated with a complete-enough contract. But the bundle ships with a self-contradicting worked example (machine-verified), an undefined classification inside a closed skip vocabulary, an unremarked override of an R3-authoritative value, stale superseded defaults in its own spec, and one I9 gap. All are fixable with sentence-level edits, none invalidates the architecture.

VERDICT: MINOR-FAIL
