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

## Findings — re-verification (2026-08-29, post-fix)

Re-read the updated bundle; each original finding re-checked against the revised text. Scope limited to confirming the 8 findings; no new investigation opened.

1. RESOLVED — Editorial debris removed: PLAN.md:112 rewritten with a defined rule-throw mechanism (isolated per rule per page, counted in additive `summary.ruleErrors: Record<ruleId, number>`, no fabricated issue, no console reliance). Named test added: `rules: a throwing rule is isolated and recorded in summary.ruleErrors, run continues` (PLAN.md:348) and edge map #33 (PLAN.md:414); `ruleErrors` propagated consistently through A12 (IMPLICIT_SPEC.md:46), Blast radius (PLAN.md:116), Phase 5 (PLAN.md:346), Phase 6 (PLAN.md:362).
2. RESOLVED — Hop-cap-without-repeat now defined: `redirect_cap` added to the audit-owned A4 vocabulary (IMPLICIT_SPEC.md:38; SkipReason union PLAN.md:214), boundary row "redirect cap (chain reaches `maxRedirects` 5 with no repeated URL) → `skipped: { reason: 'redirect_cap' }`" (PLAN.md:158), Approach step 3 (PLAN.md:66), redirects.ts (PLAN.md:311), named test `redirects: chain hitting maxRedirects (5) without a repeated URL skips redirect_cap` (PLAN.md:315, edge #26 PLAN.md:407). Vocabulary growth is legitimate — skip-reason unions are declared by audit per A12.
3. RESOLVED — Worked example now matches the snippet: example passes the punycode host explicitly (`new URL('https://Bücher.example').host` → `xn--bcher-kva.example`, PLAN.md:251-253) and the stamp regex keeps the `Z` (`.replace(/\.\d{3}Z$/, 'Z')`, PLAN.md:248) — re-derived: `20260829T101500Z` ✔. Hostile `rand` is sanitized through the same `safe()` filter with a worked traversal example (PLAN.md:254-256, re-derived `..-evil` ✔), `randomId` contract pinned to `[a-z0-9]{6}` + re-sanitization (PLAN.md:232), and test #42 extended to hostile randomId components (PLAN.md:366,423). I13 path-safety is now unconditional.
4. RESOLVED — `maxRedirectHops 10` withdrawn: PLAN.md:135 lists R3 core-owned `maxRedirects 5` with an explicit reconciliation note ("earlier draft's `maxRedirectHops 10` is withdrawn"); Approach step 3 (PLAN.md:66) and redirects.ts (PLAN.md:311) use `maxRedirects 5`; References now cite RECONCILIATION R3 conformance (PLAN.md:433). R3's audit-owned list is no longer exceeded.
5. RESOLVED — Stale defaults purged: IMPLICIT_SPEC.md:50 now declares core-owned values per R3 (`maxDurationMs 300,000`, `timeoutMs 10,000`, `maxConcurrency 5`, `maxRedirects 5` adopted) and an audit-owned list that matches R3 exactly (body cap, latency threshold, evidence cap, sitemap caps, plus Retry-After cap and seen-set cap); no 120,000/15,000 remains anywhere in the bundle. PLAN and SPEC now agree.
6. RESOLVED — `PageReport.skipped` pinned to one shape: object form `{ reason: SkipReason }` declared in A4 (IMPLICIT_SPEC.md:38), A12 (IMPLICIT_SPEC.md:46), Blast radius (PLAN.md:116), the SkipReason type comment (PLAN.md:215), an explicit all-skips assertion line (PLAN.md:168), and every boundary row now uses the object form (PLAN.md:154,155,157,158,165). No bare-string serialization remains; P4's contract is unambiguous.
7. RESOLVED — Listener leak and timer fixed: deadline snippet now uses a named `onAbort` handler removed in `finally` (PLAN.md:97,105) and a cancellable injected delay (`delay(...): Promise<void> & { cancel(): void }` in CrawlerDeps, PLAN.md:230) with `timer.cancel()` in `finally` (PLAN.md:106); no per-request listener retention at the 10k-page ceiling.
8. RESOLVED — Resource math corrected and RFC 9309 conversion pinned: sitemap worst case now stated structurally — ≤10 robots-declared sources × (1 + ≤10 children) = ≤110 sitemap fetches, ≤211 requests at defaults, finite at the clamp (PLAN.md:263) with a new boundary row capping robots-declared sources (PLAN.md:164) and named test (PLAN.md:300, edge #24 PLAN.md:405); report size recomputed with a structural per-page issue maximum, ~1 MB at defaults and ~110 MB at the 10,000-page clamp explicitly labeled an extreme-config bound (PLAN.md:265); limiter gloss is now dimensionally correct — `nextAllowedAt = now + max(perHostMinDelayMs, crawlDelaySeconds × 1000)` (PLAN.md:79) — restated in the rate-limiter (PLAN.md:296) and pinned by the renamed test (PLAN.md:300, edge #16 PLAN.md:397).

### Residual (non-blocking)

- PLAN.md:265 — the stated structural worst case of "37 issues" per page does not fall out of the stated multiplicity rule (16 single-emission rules + 2 rules × 10 capped = 36; 38 if per-rule overflow markers count) — a ±1 arithmetic nit inside an honestly-labeled extreme bound; magnitude (~110 MB at the clamp) is unaffected.

## Verdict rationale

All 8 findings verified fixed in the revised bundle: the I9 gap is closed with a named test and a defined `ruleErrors` mechanism; the skip vocabulary is closed and complete for every redirect outcome; the worked example is machine-reproducible from its own snippet with unconditional path-sanitization of the random component; R3 is conformed to and the divergence note added; the SPEC/PLAN defaults agree; the P4-facing `skipped` shape is pinned in three places; the cancellation snippet is leak-free; and the resource bounds are now structural, finite, and honestly labeled. No invariant lacks a mechanism; no correctness is traded for simplicity; contracts for all four downstream consumers are complete.

VERDICT: PASS
