# REASONING — seolite audit-engine implementation log

Append-only. One entry per non-obvious decision or confusion, newest last.

## 2026-08-29 — resume after mid-Phase-5 agent loss (Phases 1–4 committed)

- Resumed at commit 547696a (Phases 1–4 committed per ledger: crawl engine,
  robots/rate-limit/sitemap, redirects/body-caps/failure-isolation, abort).
  PLAN.md checkboxes for 1–4 were never ticked by the prior agents; the audit
  suite (97 passing) is the retroactive evidence their gates held, so they are
  ticked in the Phase 5 commit.
- The dead agent left uncommitted WIP: `src/rules/*` (Phase 5, mostly
  conforming), `src/testing/*` (test helpers colocated under `src/` because the
  repo's shared vitest config includes only `src/**/*.test.ts` — the plan's
  `test/helpers/` location does not exist in this scaffold), and a run.ts
  integration of `createRuleSet`. Reconciled item by item against plan Phase 5
  (kept conforming parts, fixed the three red tests, see below).

## Scope/command mapping (plan says @seolite/* and per-workspace lint/build)

- Repo-wide rename commit 0a267da renamed the scope `@seolite/*` → `@lumen-seo/*`
  (bin `lumen`, `.lumen` state dir) BEFORE plan execution began; every committed
  phase already codes against `@lumen-seo/core`. Plan references to
  `@seolite/audit` read as `@lumen-seo/audit` throughout.
- The M0 scaffold shipped NO per-workspace `lint`/`build` scripts (root
  `eslint .` covers all packages; typecheck is per-workspace `tsc --noEmit`).
  IMPLICIT_SPEC scaffold note ("if names differ, only the verify commands in
  PLAN.md change") applies: Phase 6's `npm run lint -w …` / `npm run build -w …`
  gates are executed as root `npm run lint` + root `npm run typecheck`.

## Plan deviations (recorded; flagged for orchestrator)

1. **`redirect-chain` fires at ≥1 hop, not ≥2 (plan rule 12 / PLAN.md:172).**
   The plan's Approach step 3 has AUDIT following redirects manually
   (`src/crawl/redirects.ts`), which would expose per-chain hop counts. The
   committed Phase 3 instead delegated the redirect loop to the core fetcher
   (`fetchWithRedirects` in packages/core/src/fetcher.ts: hop cap, seen-set
   loop detection, per-hop SSRF revalidation), exposing only the final
   `Response.url`. Audit therefore cannot distinguish 1 hop from ≥2; the
   crawler records `hops ∈ {0,1}` ("was redirected"). Plan-strict
   (fire only at hops ≥ 2) would make built-in rule 12 dead code that can
   NEVER fire — a materially worse outcome than the wording deviation. Rule
   fires when `finalUrl ≠ requestedUrl` with evidence naming both. The plan's
   named test "silent at 1 hop, warning at ≥2" is unimplementable as written;
   the implemented test is "silent without redirect, fires when the requested
   URL redirected". If the orchestrator disagrees, the alternatives are a
   types-only core addition exposing the hop chain, or reverting rule 12 to
   plan wording (dead rule).
2. **Plugin-rule issue severities are normalized to the rule's effective
   severity in `createRuleSet`.** Core's `createRuleRegistry` rewrites
   `rule.severity` from `severityOverrides` but a plugin's `check()` returns
   issues carrying whatever severity the plugin hardcoded — scoring would then
   ignore the user's override (I2 makes severity overrides meaningful only if
   they govern scoring). Built-ins are unaffected: their factories close over
   the effective severity, and `canonical-present`'s plan-mandated per-issue
   bump (multiple canonicals → warning) happens inside the factory, not via
   this path.
3. **`mixed-content` link-rel set trimmed to the stylesheet/icon family**
   (removed `preload`): plan scopes the rule to `script[src]`, stylesheet/icon
   `link[href]`, `img[src]`, `iframe[src]`. `shortcut`/`apple-touch-icon`/
   `mask-icon` stay (icon variants); `preload` is neither stylesheet nor icon.
4. **File placement:** plan's `src/rules/context.ts` (link extraction) landed
   in the committed Phase 1–3 as `src/crawl/links.ts` (extraction is crawl
   infrastructure — it feeds frontier growth — and rules merely consume
   `CrawlIndex`); plan's `src/rules/index.ts` is `src/rules/rule-set.ts`
   (repo avoids `index.ts` name collisions; `src/index.ts` is the only barrel).

## Confusions resolved during Phase 5

- The dead agent's `rules: evidence capped at 10 per rule per page` test set
  `maxPages: 3`, so the crawl budget stopped after the seed + 2 link targets —
  only 2 broken links could ever exist and the 10-cap could not trigger. Fixed
  by budgeting the full 26-page fixture (`maxPages: 30`).
- The dead agent's `rules: threshold override applied` test expected
  `response-latency` in a full run with `latencyMs: 1`, but the fake fetcher is
  instantaneous: `timingMs` is always 0, so the rule is (correctly) silent and
  the test's own comment admitted it. Latency-threshold override is now
  asserted deterministically at the rule level through `createRuleSet`
  (override → factory threshold) with `makePage({ timingMs })`, alongside the
  title/description overrides that DO exercise end-to-end.
- Why 429-retry latency can exceed the page deadline… (not needed: the
  deadline composes via core's fetch timeout; audit's raw-429 retry path adds
  at most the 5 s Retry-After cap — bounded, per plan resource table.)
