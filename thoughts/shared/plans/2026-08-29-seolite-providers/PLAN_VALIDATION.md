# PLAN_VALIDATION — providers bundle (`IMPLICIT_SPEC.md` + `PLAN.md`)

Reviewer: adversarial plan reviewer (not the plan author). Date: 2026-08-29. Scale re-derived: large.
Method: default-FAIL until evidence. Cross-referenced `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` (source matrix + Evidence Ledger + I1–I17), `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` (locked SPI + payload fields), `thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` (R1–R10 override; per its header, RECONCILIATION + ARCHITECTURE win on conflict).

---

## Checklist 1 — Every relevant invariant → named mechanism: **FAIL**

Named and testable: I2 (BUILTIN_PROVIDER_NAMES + capability map + registerBuiltIns, TC-REG-1/2/5), I4 (deps.userAgent, per-source throttles, TC-SHARED-2/3, TC-WIKI-2), I9/I10 (injected fetcher/clock/sleep/env/cache, TC-SHARED-1..5), I12 (source-scan TC-SHARED-7), I15 (TC-SUG-4, TC-DDG-3/4, TC-TRC-2/3), I16 (README table + redactUrl, TC-SHARED-5/8), I17 (single retry owner = core Fetcher, TC-*-429). Three defects:

1. **I1 BYOK resolution binds the WRONG env-var names — contradicts R5 (MAJOR).** RECONCILIATION.md R5 locks `SEOLITE_PSI_KEY`, `SEOLITE_CRUX_KEY`, `SEOLITE_OPR_KEY` (scheme `SEOLITE_<PROVIDER>_KEY`) and states "providers implements the same scheme". The bundle instead uses `SEOLITE_PSI_API_KEY` / `SEOLITE_CRUX_API_KEY` / `SEOLITE_OPENPAGERANK_API_KEY` in IMPLICIT_SPEC.md:49–50 ("Locked BYOK env-var names"), PLAN.md:257, PLAN.md:336 (config snippet — which also has a syntax error: missing closing quote on the OPR literal), and hard-codes the wrong names into tests TC-PSI-2 (PLAN.md:449) and TC-OPR-1 (PLAN.md:494). Effect: users/surfaces/site-docs set the R5 names, providers never resolves a key → every BYOK provider permanently `not_configured`; TC-PSI-2/TC-OPR-1 would lock the wrong contract into the suite.
   **Fix:** replace all three names everywhere (spec §3, Defaults, config.ts `byProvider`, TC-PSI-2, TC-OPR-1, README plan) with the R5 names; fix the snippet syntax error.
2. **I3 estimateLabel verification is claimed but not delivered.** PLAN.md:195 asserts "`estimateLabel` on all heuristic/gray outputs" verified by TC-SHARED-6, TC-CRUX-4, TC-PSI-6, TC-WIKI-3 — but TC-PSI-6 does not exist (Phase 3 has TC-PSI-1..5), TC-CRUX-4 is the throttle test, and TC-SHARED-6 (PLAN.md:554) asserts only kind/attribution/retrievedAt. The google-suggest snippet (PLAN.md:380–382) emits no estimateLabel, yet research I3 (research.md:105) explicitly lists "autocomplete-derived ideas" as requiring one, and the locked `KeywordIdea` model has the field — no core change needed.
   **Fix:** add estimateLabel to google-suggest ideas; extend TC-SHARED-6 to assert estimateLabel on every `heuristic`/`gray` output; correct the phantom test refs.
3. **I8 CrUX string deviates from the spec's own "verbatim" binding.** IMPLICIT_SPEC.md:14 binds the verbatim ledger string "The CrUX datasets from Google are licensed under the Creative Commons Attribution 4.0 International license"; PLAN.md:291 ships a paraphrase ("Chrome UX Report (CrUX) data by Google — licensed under CC BY 4.0 …"). Fix: use the verbatim string (keep the methodology URL as an extra).

## Checklist 2 — Per-provider failure handling typed and complete: **FAIL**

Good bones (uniform error taxonomy, per-source 429/Retry-After, CAPTCHA→blocked, drift→parse_error, CrUX 404→null, stale ceiling), but gaps contradict the plan's own failure table (PLAN.md:207–218) and the uniform template (PLAN.md:88 "5xx→upstream_error"):

- **5xx conflated with CAPTCHA:** google-suggest (PLAN.md:376) and ddg-serp (PLAN.md:513) throw `BlockedError` for all `status >= 400`, so a 500/502/503 becomes "likely CAPTCHA" instead of `UpstreamError(status)` per the table. Fix: 429→rate_limited; 5xx→upstream_error; non-5xx 4xx / HTML content-type→blocked.
- **Snippet vs own test mismatch:** TC-SUG-4 (PLAN.md:401) expects `parse_error` for non-JSON "other garbage", but the snippet throws `BlockedError` for ANY non-JSON content-type (incl. text/plain). Fix the mapping.
- **PSI malformed payload unhandled:** no malformed-JSON test for PSI (TC-PSI-1..5 cover happy/error-envelope/throttle only), and the generic `withProviderErrors` (PLAN.md:224–233) would map a JSON `SyntaxError` to `upstream_error`, not `parse_error` — violating the I15 mapping the plan promises. Fix: wrap `res.json()` per provider (as suggest does) + add TC-PSI malformed case.
- **OPR non-quota per-domain errors unhandled (I3 violation):** PLAN.md:471–475 only checks quota errors; for a domain OPR reports `status_code` 404 / "not found", the snippet emits `sig(d.domain, 'score', d.page_rank_decimal ?? d.page_rank_integer)` with both undefined → `AuthoritySignal{value: undefined}` — a fabricated-value hazard instead of honest omission. Fix: skip domains whose `error`/status is non-quota (omit per I3).
- **Undefined paths:** Tranco first run with all 4 dates 404 and empty cache has no defined outcome (table covers only ">14d stale AND refresh failed"); DDG lite-fallback trigger condition never specified (TC-DDG-5 tests the fallback parses, but nothing defines when fallback fires — on blocked? on drift? on 0 anchors?).
- **Fragile classification:** `withProviderErrors` sniffs `/timeout|abort/i` on message strings; an upstream body/abort wording containing "abort" is mislabeled `timeout`. Fix: have deps.fetcher reject with a typed marker or check `error.name === 'AbortError'`.

## Checklist 3 — Consumers enumerated + SPI-complete vs ARCHITECTURE: **FAIL (minor)**

- Payload/SPI field coverage is complete — verified against ARCHITECTURE.md:31–42: `KeywordIdea{term,source,estimateLabel?,lang?}` (wiki emits all; suggest term+source — see item 1), `SerpResult{position,url,title,snippet?}` + A9 source/retrievedAt, `PageSpeedReport{scores{4},metrics{lcp,cls,tbt,fcn},source}` with per-metric `{value,source,retrievedAt}` wrapping, `CruxRecord{metrics{name:{p75,histogramBins}},source}` + null semantics, `AuthoritySignal{domain,kind,value,provider,attribution}` + A9 additions. A9 deltas owned (Phase 0 compile gate + blast-radius).
- **Consumers under-enumerated:** PLAN.md:237 claims "`@seolite/providers` is imported first by P4 (surfaces) — until then nothing else references it". ARCHITECTURE.md:61 contradicts this: "P2 audit-engine (registry works with no-op providers until P3 merges)" — P2 consumes the registry for CWV enrichment (Seam 1 row 1: audit = crawl + PSI + CrUX), and site-docs consumes the exported ATTRIBUTION constants (I8 binding). The plan never enumerates P2/site-docs or the audit call pattern (25-page audit × PSI+CrUX per page → 50 calls/audit vs throttles — safe, but unstated). Fix: enumerate P2 (registry consumer, CWV enrichment), P4 (CLI/MCP/Worker), site-docs (attribution constants) in Blast radius.
- R7 worker-safety checked out: `createWorkerSafeProviders` excludes ddg-serp + TC-REG-5 module-graph assertion matches R7/BA9; the R7 "2.5 MB response cap" is owned by surfaces' capping Fetcher wrapper (surfaces/IMPLICIT_SPEC.md E10/B10: "Upstream response-body cap … enforced by a capping Fetcher wrapper"), which composes cleanly with providers' injected `deps.fetcher` — no missing mechanism here. Note: a capping-Fetcher stream abort contains "abort" and would be mislabeled `timeout` by withProviderErrors (see item 2 fix).

## Checklist 4 — No correctness-for-simplicity trades: **FAIL (minor)**

- 5xx→blocked conflation in suggest/ddg (diagnostic honesty traded for snippet brevity; also item 2).
- Timeout classification by message regex `/timeout|abort/i` instead of error type (item 2).
- PSI cache key is `(url, strategy)` only (PLAN.md:181): a keyless trial call caches the result, and a later keyed/`automated` call within 6 h silently receives trial-mode cached data (and vice versa) — mode/provenance wrinkle; include mode in the cache key or document it.
- BA11 (no IDNA punycode) is a documented, honest limitation with I3-compliant omission — acceptable, not a trade.

## Checklist 5 — No unjustified new patterns: **PASS**

Every new port carries recorded rationale in "Alternatives considered": providers-local CacheStore (BA2 — core defines no cache contract), per-provider TokenBucket (alt 3 — limits are provider knowledge), withProviderErrors, registry-wiring/opts-bridge single-file adaptation (blast-radius containment), `'gray'` literal (alt 9 — I3 honesty). Nit: `src/opts-bridge.ts` is named in BA12 (IMPLICIT_SPEC.md:67) but never appears in any phase's Changes list — schedule it or drop the filename.

## Checklist 6 — No TBDs / mechanisms-in-spec: **FAIL (minor)**

No literal TBDs and the front matter claims zero open questions, but four mechanisms are left undefined: DDG lite-fallback trigger; Tranco first-run total-refresh-failure outcome; OPR non-quota per-domain error handling; config `rpm` overrides "≤ documented limits" (IMPLICIT_SPEC.md:175) state a rule with no clamping mechanism or test (TC-CRUX-4 tests only the default 140). See items 2 and 8 for fixes.

## Checklist 7 — Success criteria exact + verify invariants: **PASS**

Every phase's first criterion is the exact `npm test -w @seolite/providers` (plus typecheck/lint at Phase 0/1/6), and "Done means" repeats it. Verify invariants present: provenance (TC-SHARED-6 sweep over all 7), throttle respected (TC-SHARED-2/3 + TC-CRUX-4/TC-OPR-4/TC-DDG-2/TC-SUG-5/TC-WIKI-2/TC-PSI-5), NotConfigured semantics (TC-REG-3, TC-CRUX-1, TC-OPR-1, TC-PSI-2 — 0 fetches asserted via fetcher spy). Nits: TC-SHARED-6 omits estimateLabel (item 1) and TC-REG-3 as written ("each BYOK provider with absent key rejects") contradicts BA5 for pagespeed, which must NOT reject when `automated !== true` — qualify the test with `automated: true` for PSI.

## Checklist 8 — Quota math re-derived vs researched limits: **FAIL**

Defaults individually chosen correctly: CrUX 140/150 = 0.93 ✓ (in BA1's 0.8–0.95 band), OPR 50/60 = 0.83 ✓, Wikimedia 60/200 and PSI 60/240 deliberately conservative ✓, suggest 30 and ddg 6 fixed constants ✓; CrUX "100 origins ≈ 43 s" checks out (100/140 min); cache-TTL-vs-quota interaction sound (CrUX 24h, OPR 30d/domain, PSI 6h keyed, ddg 1h). Three derivation failures:

1. **Throttle mechanism cannot satisfy its own invariant (MAJOR).** `TokenBucketThrottle(rpm)` (PLAN.md:136–139) has no capacity parameter; the implied classic bucket (capacity = rpm, refill rpm/60s) allows worst-case `capacity + refill·60s = 2×rpm` in a rolling 60 s window. Concretely: burst of 140 at t=0, tokens replenish and are drained → up to ~280 requests in (0, 60] — **above CrUX's documented hard 150 qpm (A1)**; for OPR, up to ~100/min in a window — **above the documented 60 req/min (A2)** → guaranteed 429s despite the "safe" 50/min default. The plan's own TC-SHARED-2 ("≤ rpm in every rolling 60 s window") and TC-CRUX-4 ("never >150 in any 60 s window") are unachievable by the described mechanism. Fix: specify leaky-bucket/GCRA pacing or bound burst capacity ≤ limit − rate (CrUX ≤ 10, OPR ≤ 10); TC-DDG-2's "1/10s spacing" shows pacing is already intended for ddg — make it uniform.
2. **OPR batching is impossible under the locked SPI (MAJOR).** ARCHITECTURE.md:35 locks `authority(domain: string, o): Promise<AuthoritySignal[]>` — ONE domain per call; BA12's opts (`lang?, limit?, strategy?, formFactor?, automated?, scope?`) carry no domain list. Yet the plan's mechanism, matrix, cost table ("500 fresh domains ≈ 5 req"), and TC-OPR-2 ("batches chunked ≤100") all depend on multi-domain batches. Real math: 500 domains = 500 requests ≈ 10 min at 50/min (monthly domain-quota % is unchanged at 1.7% since quota counts domains). Fix: either per-domain requests with corrected cost math, or an explicit micro-batch/coalescing buffer design added to the plan.
3. **Cost-table arithmetic nits:** Tranco "4–5 requests/month total" omits the metadata request (each refresh = meta GET + CSV download = 2 requests → 8–10/month); "12–17 MB/month" doesn't match 4.3 refreshes × 2–3 MB (8.6–12.9 MB). BA1 misdescribes its own policy: wikipedia (60/200 = 0.30) and PSI keyed (60/240 = 0.25) sit far below the stated 0.8–0.95 band (conservative direction — no risk, but the bounding assumption is false as written).

---

## Findings summary

| # | Severity | Finding |
|---|---|---|
| 1 | MAJOR | R5 env names violated throughout (`*_API_KEY` vs locked `SEOLITE_PSI_KEY`/`SEOLITE_CRUX_KEY`/`SEOLITE_OPR_KEY`), incl. TC-PSI-2/TC-OPR-1; snippet syntax error at PLAN.md:336 — end-to-end BYOK breakage |
| 2 | MAJOR | OPR ≤100-domain batching + "500 domains ≈ 5 req" impossible under locked `authority(domain: string, o)`; real cost 500 req ≈ 10 min |
| 3 | MAJOR | Token bucket (unspecified capacity=rpm) allows 2×rpm per rolling 60 s: CrUX ~280 > 150, OPR ~100 > 60 — TC-SHARED-2/TC-CRUX-4 unachievable as specified |
| 4 | MINOR | Failure handling: 5xx→Blocked in suggest/ddg contradicts own table; TC-SUG-4 vs snippet mismatch; PSI malformed-JSON untested (wrapper → upstream_error, not parse_error); OPR non-quota per-domain errors → `value: undefined` signals; Tranco first-run total-404 and DDG fallback trigger undefined |
| 5 | MINOR | I3/I8: google-suggest ideas lack estimateLabel; TC-SHARED-6 doesn't assert it; I3 row cites phantom TC-PSI-6; CrUX attribution string paraphrased vs spec's verbatim binding |
| 6 | MINOR | Consumers under-enumerated ("imported first by P4" contradicts ARCHITECTURE M1 — P2 audit consumes registry for CWV enrichment); TC-REG-3 contradicts BA5 for keyless PSI |
| 7 | MINOR | Correctness nits: timeout classification by message sniffing; PSI cache key omits keyed/keyless mode; `rpm` override clamp stated but unmechanized; opts-bridge.ts unscheduled |
| 8 | MINOR | Tranco cost table undercounts meta requests (8–10/month, not 4–5); BA1 band misdescribes wikipedia/PSI throttle policy |

Positive verifications: seven-provider set, provenance kinds, throttle defaults, cache TTLs, capabilities, error taxonomy, A9 deltas, and the matrix in IMPLICIT_SPEC §3 are internally consistent and trace to research evidence (CrUX 150 qpm verbatim + key-required refutation, OPR Bearer/60 rpm/monthly quota, Wikimedia 200/min + contact UA, PSI trial-vs-automated, Tranco attribution/daily list, gray labeling for suggest/DDG); A10 exclusions match the ledger; success criteria use the exact required command.

Round 1 verdict: MAJOR-FAIL (superseded by Round 2 below).

---

## Round 2 — re-review of the reworked bundle (fresh adversarial reviewer)

Date: 2026-08-29. Same method: default-FAIL until evidence. Re-verified against research (`2026-08-29-seolite-greenfield-research.md`), ARCHITECTURE.md (locked SPI), RECONCILIATION.md (R5/R7). All grep line numbers below refer to the reworked files.

### Round-1 MAJORs

1. **R5 env names — RESOLVED.** `grep -rn "_API_KEY"` over `IMPLICIT_SPEC.md` + `PLAN.md` returns **zero** hits (only PLAN_VALIDATION.md's own round-1 quotes contain them; `API-OPR` appears solely in "REFUTED"/"NOT used" context — IMPLICIT_SPEC.md:27, PLAN.md:268/692). R5 names present throughout: spec §3 locked list (IMPLICIT_SPEC.md:50), PLAN config.ts `byProvider` (227–233), I1 mechanism row (278), TC-REG-3 (414), TC-PSI-2 (509), TC-CRUX-1 (514), TC-OPR-1 (575), Defaults (332), Phase 6 README (642). Round-1 snippet syntax error gone (config snippet 219–234 is valid). RECONCILIATION R5 cross-checked: names match exactly.
2. **OPR per-domain under the locked SPI — RESOLVED.** Phase 4 signature `authority(domain: string, o): Promise<AuthoritySignal[]>` (PLAN.md:528) equals ARCHITECTURE.md:35 verbatim; request is single-element `domains[0]=<domain>` (535); TC-OPR-2 asserts the exact URL + Bearer header and "no batch loop exists in the module (source assertion)" (576). Cost math honest and re-derived: 500 domains ≈ 500 req ≈ ~10 min at 50/min (500/50 = 10 min; with burst 10 ≈ 9.8 min) — PLAN.md:344; monthly domain quota share 500/30k ≈ 1.7% ✓ (quota counts domains, so per-domain requests don't change it). Bulk call recorded as out-of-scope future caller-side optimization (A2, BA8, alt 4).
3. **Throttle cannot exceed documented limits — RESOLVED (proof re-derived).** Classic token bucket removed; PLAN.md:136–146 specifies GCRA: conform iff `now >= TAT − burst·(60_000/rpm)`, update `TAT = max(prevTAT, now) + 60_000/rpm`. Independent derivation: for consecutive conforming arrivals, `TAT_j ≥ t_j + L` (update rule) and `TAT_j ≥ TAT_{j−1} + L` give `t_{j+m} − t_j ≥ (m − burst)·L`; if n conforming requests fall in a half-open 60 s window, `(n−1−burst)·L < 60_000` ⇒ **n ≤ burst + rpm** — initialization-independent. Therefore: CrUX 140+10 = 150 = documented 150, never above; OPR 50+10 = 60 = documented 60, never above; wikipedia 70 ≤ 200; PSI keyed 70 ≤ 240, keyless 7; suggest 35 and ddg 7 (undocumented, conservative). The bound is tight — exactly 150 is reachable in the worst window (11-instant burst + 139 spaced for CrUX) — so "worst window exactly 150 = documented limit, never above" is accurate, not optimistic. `resolvePacing` (150–156) clamps `burst ≤ floor(limit/2)`, `rpm ≤ limit − burst` ⇒ `burst + rpm ≤ limit` by construction; TC-REG-6 examples re-verified ({rpm:500}→{140,10}; {rpm:150,burst:50}→burst ≤ 75, sum ≤ 150). Rolling-window bound also covers any fixed 60 s quota window (stronger guarantee).

### Round-1 minors (spot-checks)

4. **4xx/5xx split — RESOLVED.** suggest (PLAN.md:429–434): 429→rate_limited, ≥500→upstream_error, other 4xx/HTML→blocked, JSON garbage→parse_error; TC-SUG-4 (460) now matches the snippet exactly (500→upstream_error; 403/HTML→blocked; JSON-content-type garbage→parse_error). ddg identical (602–606, TC-DDG-2). PSI: 429/403-quota→rate_limited, 500→upstream_error (TC-PSI-3); OPR: 429/≥500 mapped (537–538, TC-OPR-3).
5. **estimateLabel + phantom test refs — RESOLVED.** suggest snippet emits `estimateLabel` (438); TC-SUG-1 asserts it (457); TC-SHARED-6 asserts "estimateLabel present on every heuristic/gray value" (647); I3 row now cites TC-SHARED-6/TC-SUG-1/TC-WIKI-1/TC-PSI-4/TC-CRUX-3/TC-OPR-3 — all exist. TC-PSI-6 (malformed JSON → parse_error) added (513). Traces to research I3 ("autocomplete-derived ideas" need a label, research.md:105).
6. **Consumers + TC-REG-3 — RESOLVED.** Blast radius (311) now enumerates P2 audit-engine (registry consumer, CWV enrichment: 25-page audit = 50 CrUX + 50 PSI calls), P4 surfaces, site-docs (ATTRIBUTION constants) — matches ARCHITECTURE M1 ("P2 … registry works with no-op providers until P3 merges"). TC-REG-3 (414) now qualifies PSI with `automated: true` for rejection and asserts keyless proceeds when `automated: false` (BA5-aligned).
7. **Typed timeout / PSI cache mode / clamp / opts-bridge — RESOLVED.** `isTimeoutLike` classifies by `error.name === 'AbortError' | 'TimeoutError'` (188–189); TC-SHARED-10 (392) explicitly asserts a message containing "abort"/"timeout" is NOT classified by text; covers R7 capping-Fetcher aborts. PSI cache key includes mode: `psi:${mode}:${strategy}:${url.href}` (477, TC-PSI-5). `opts-bridge.ts` scheduled in Phase 1 Changes (401).
8. **Tranco/DDG definitions + BA1/cost tables — RESOLVED.** Tranco first-run all-4-dates-404 → typed `upstream_error` with 0 CSV fetches (spec A7/BA3; PLAN 561–563; TC-TRC-3). DDG lite-fallback trigger defined: exactly once per call, only on primary `parse_error`/`blocked`, never on 429/5xx; lite failures propagate (594–598, TC-DDG-3/5, failure table 300–301). BA1 (58) now states true ratios (wikipedia 0.30×, PSI keyed 0.25×, worst windows 0.35×/0.29×) instead of the false band. Tranco cost: 8–10 requests/month (4–5 refreshes × [meta+CSV]) and 9–13 MB/month ✓ (4.3 × 2–3 MB = 8.6–12.9).

### Independent re-derivation of touched Design Analysis

- **Pacing:** GCRA bound proven above (n ≤ burst+rpm in any rolling 60 s window, init-independent); per-provider pacer instances prevent cross-provider leakage; override clamp proven for all limit-bearing providers.
- **Failure taxonomy:** closed over the I15/I17 stimulus list — every row of the failure table (291–307) maps to a typed outcome; 5xx≠blocked everywhere; OPR non-quota omission filters nulls (`value: undefined` impossible, 544–548); malformed JSON → parse_error via shared `json()` in every provider (TC-SHARED-9 + TC-PSI-6/TC-SUG-4/TC-CRUX-3/TC-OPR-3); timeout type-based.
- **Consumers:** P2 pattern re-checked against pacers — window bound holds by construction regardless of call count; merge order (P2 → P3 → P4, P3 depends only on core) consistent with front matter and ARCHITECTURE M1.

### New TBDs / spec-design smuggling introduced by the rework

**None.** `grep -rni "tbd|to be decided|open question|TODO|FIXME"` over both artifacts = 0 hits. New pins (BA7 `fcn`=FCP; BA8 per-domain request shape) are bounding assumptions required to make the reworked A2 testable, with the bulk form explicitly out of scope — consistent with the plan protocol ("Defaults … locked here, recorded as bounding assumptions"). A9 predates the rework (cited in round 1) and remains additive.

### Residual nits (non-blocking, for the implementer)

- TC-CRUX-4's "burst of 10 immediate tries succeeds, 11th waits" (517) matches TAT-init `now + L`; with init `now` the snippet's rule admits burst+1 = 11 immediate. The window bound is unaffected (proof is init-independent); Phase 0 should pin the initialization.
- Consumer-facing durations "≥22 s / ≥50 s / ≈43 s" (311, 343) use plain rate division and ignore burst acceleration — true minima ≈16.7 s / ≈39 s / ≈38 s. Overstates duration only; no limit impact. OPR's "≈10 min" is accurate.
- Snippets call `new ParseError(name, msg)` / `new BlockedError(name, msg)` without declaring subclass constructors over `ProviderError(code, provider, message, detail)` — arg misbinding as literally written; snippets are explicitly non-normative and TC-SHARED-1 would catch it in implementation.
- `PACING_DEFAULTS.tranco = {rpm:0, burst:0}` (243) is a dead value — TrancoProvider receives no pacer (256).

All three round-1 MAJORs are resolved with mechanism-level evidence; all round-1 minors verified fixed; no new gaps introduced.

VERDICT: PASS
