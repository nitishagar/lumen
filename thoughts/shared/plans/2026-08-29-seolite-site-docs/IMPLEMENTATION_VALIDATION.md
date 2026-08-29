---
date: 2026-08-29
reviewer: adversarial-implementation-review (claude)
branch: feat/lumen-site
aspect: site-docs (P5)
plan: thoughts/shared/plans/2026-08-29-seolite-site-docs/PLAN.md
spec: thoughts/shared/plans/2026-08-29-seolite-site-docs/IMPLICIT_SPEC.md
naming: RENAMES.md (seolite→lumen) supersedes plan naming; lumen-named entities are NOT treated as divergence
---

# Implementation Validation — site-docs (P5)

Method: three parallel deep-read verification passes over the worktree (Phase 1–2, Phase 3–4, Phase 5–6/gates) plus direct inline confirmation of every claimed finding by reading the actual source/test/config files (not the diff alone). Every finding below has been independently confirmed against files on disk, not just agent self-report.

## 1. Plan conformance

### FAIL — Phase 1: `@astrojs/sitemap` dependency and integration entirely absent; sitemap hand-authored instead

PLAN.md Phase 1 specifies, verbatim, `site/astro.config.mjs` importing `@astrojs/sitemap` and wiring `integrations: [sitemap()]`, and lists `@astrojs/sitemap` as an added devDependency in the Resource & Cost Analysis section (PLAN.md:157, 181-185, 191, 197).

Actual:
- `site/package.json:18-25` — devDependencies are `astro`, `pagefind`, `cheerio`, `jest-axe`, `jsdom`, `vitest`. No `@astrojs/sitemap`.
- `site/astro.config.mjs` — no sitemap import/integration (confirmed by agent read; no `sitemap()` in `integrations`).
- `site/public/sitemap.xml:1-9` — a hand-maintained static XML file listing 8 URLs.
- `site/tests/artifact.test.ts:38-49` — a compensating test ("sitemap and built pages agree exactly") diffs the static file's `<loc>` entries against the actual built page set, which prevents *silent* drift but does not prevent someone from forgetting to add a `<url>` entry for a new page and having to fix a test failure after the fact rather than the sitemap self-generating.

This is a real mechanism substitution, not a copy-paste omission — the plan's stated approach (auto-generated sitemap via the pinned integration) was replaced by a manually maintained file with test-level drift detection. Per the review charge, "simpler / functionally equivalent" is not a valid excuse; this is scope/dependency divergence from an explicit Phase 1 code block and must be flagged for reversion (add `@astrojs/sitemap` and restore integration-based generation) or explicitly re-justified in the plan.

### FAIL — Phase 2: Footer inspiration line ("Visual design inspired by pi.dev; tokens reimplemented from scratch") never implemented anywhere in the built site

PLAN.md Phase 2 "Changes" explicitly requires `Footer.astro (license/attributions/changelog links + inspiration line + toggle)` (PLAN.md:256). The Design Analysis trade-dress checklist states the mechanism for I7/I8 compliance is: `pi.dev` mentioned anywhere except `/docs/attributions/` **and the single footer inspiration line** ("Visual design inspired by pi.dev; tokens reimplemented from scratch") (PLAN.md:105, 78-79).

Actual:
- `site/src/components/Footer.astro:1-30` — full read confirms no mention of "pi.dev", "inspired", or "reimplemented" anywhere in the footer partial.
- `grep -rn "reimplemented from scratch|pi\.dev" site/src` → only `site/src/pages/docs/attributions.astro` matches; zero other files.
- `site/tests/trade-dress.test.ts:49-70` — the G3 gate itself was written to require `pi.dev` to appear **only** on the attributions page in both source and built HTML (no footer exception coded), and `site/README.md:38` documents G3 the same restrictive way. The gate and the implementation agree with each other, but both diverge from the plan's explicit two-location design (attributions page + footer line).
- `site/tests/attribution.test.ts` (G9) — asserts license link + attributions link in every footer, but never asserts the inspiration line's presence anywhere.

Net effect: the plan's mandated site-wide factual attribution/trade-dress notice is missing entirely from every page except the one dedicated attributions page. This is a real content/attribution gap that the plan calls out as load-bearing for I7/I8 conformance (see Charge item 2, I8 below), not a stylistic nit.

### FAIL (minor) — Footer.astro has no theme toggle

PLAN.md Phase 2 lists `Footer.astro (... + toggle)` as a required component (PLAN.md:256). The implementation places the only theme-toggle button in `Header.astro:22-28`; `Footer.astro` has no toggle control. Functionally the toggle exists site-wide (header is present on every page), so this does not break the invariant, but it is a literal divergence from the plan's stated component composition — flagged per the "divergence is FAIL unless plan was wrong" rule, though its severity is cosmetic since the header instance satisfies the substantive requirement.

### FAIL (minor) — Concrete token values: two badge light-theme colors and one font-weight diverge from PLAN.md's stated values

PLAN.md "Concrete token values" (PLAN.md:110-114):
- Light badges: "700-family (e.g. `#15803d`)"
- Weights: "500/600/800"

Actual (`site/src/styles/tokens.css:74,81`):
- `--badge-green` light = `#166534` (Tailwind green-**800**, not 700-family)
- `--badge-amber` light = `#92400e` (amber-**800**, not 700-family)
- (Blue `#1d4ed8` and purple `#7e22ce` light values do match 700-family correctly.)

`grep -rn "font-weight: 500" site/src` → zero matches anywhere in the codebase; only 600 and 800 are used.

These are minor since the plan's badge values were prefixed "e.g." (illustrative, not exact-locked) and contrast is independently gate-verified at ≥4.5:1 regardless of the exact shade (confirmed real arithmetic in `site/tests/contrast.test.ts`, see Charge 2 below) — but the unused 500 weight is a literal, unqualified plan value ("weights 500/600/800") that never shipped. Low severity, noted for completeness.

### PASS — Phases 3, 4: landing page, docs IA, and all seven docs pages

Verified against PLAN.md Phase 3/4 line-by-line and IMPLICIT_SPEC.md section 2 page-set requirement:
- `site/src/pages/index.astro` — hero + byte-exact install tabs sourced from `locked-names.json` (`site/src/data/locked-names.json:44-48` snippets used verbatim at `index.astro:12,21,29`), four sections `01·why / 02·pluggable / 03·agents first / 04·data honesty` matching PLAN.md:280-284 titles/order, each with an original inline SVG `<figure>` and `Fig. NN | caption` pattern.
- `site/src/layouts/DocsLayout.astro` + `site/src/utils/site.ts:23-41` — sidebar groups "Start here / Guides / Reference" match PLAN.md:301-304 exactly, same page set and order.
- All 7 docs pages present and populated per PLAN.md Phase 4 content list: quickstart (install→audit→exit codes→`--json`), mcp-onboarding (Claude Code/Cursor/VS Code/universal JSON + 5 locked tools + remote-gateway BA-7 section + local-only semantics), cli-reference (7 commands + 4 flags + exit-code table), rules-reference (severity/categories/failThreshold/escaped `evidence.snippet`/`incomplete: true` example), providers-byok (7 providers, kind labels, `LUMEN_*` env vars, skip-when-absent phrase, what-leaves-the-machine lines, gray-provider 429/Retry-After etiquette), configuration (unknown-key error, timeout/backoff, robots/UA/sitemap/rate-limit, SSRF-guarded fetch mention), attributions (Apache-2.0, CrUX CC BY 4.0 verbatim sentence + URL, Tranco, Open PageRank, pi.dev inspiration note, trademark note).
- Minor soft note: mcp-onboarding's remote-gateway wording doesn't literally say "ships with Worker deploy" (BA-7's exact phrase) but conveys the same deployable-but-not-deployed fact — not scored as a failure, semantically compliant.

### PASS — Phase 5: Pagefind search

`site/package.json:13` chains `astro build && pagefind --site dist` using the pinned exact `pagefind@1.5.2` local devDependency (no npx/network at build time, matching PLAN.md's stated failure-handling mechanism). `data-pagefind-body` correctly scopes landing sections and docs prose (`site/src/pages/index.astro` multiple lines, `site/src/layouts/DocsLayout.astro:39`) while excluding nav/sidebar/footer chrome (`data-pagefind-exclude` on in-page nav, asserted structurally in `site/tests/search.test.ts:41-58`). The Cmd/Ctrl+K modal (`site/src/components/SearchModal.astro`, behavior in `site/src/layouts/Base.astro:100-179`) implements `role="dialog"`/`aria-modal`, focus-in/focus-return, Escape-close, real `<a href>` results, and base-path-aware Pagefind JS import (`${base}pagefind/pagefind.js` where `base` comes from `u('/')` — resolves correctly to `/lumen/pagefind/pagefind.js`, no base-path bug).

### PASS — Phase 6: gate consolidation and release hardening

`site/tests/a11y.test.ts` runs axe over every built page (asserted `pages.length >= 9`, uses `walk(distDir)` — not a sample). `site/tests/meta.test.ts` asserts both presence and **uniqueness** of titles/descriptions across all pages. `site/README.md:29-44` documents the G1–G9 gate inventory and the trade-dress standing checklist as required. One narrower-than-specified item: `site/tests/artifact.test.ts` checks for zero `.map` files but has no general "zero stray build inputs" assertion beyond that — Phase 6's success criterion "zero stray build inputs" is only partially covered (source maps only, not e.g. leftover `.astro`/config files that might land in `dist/` from a future change). Low severity; not scored as a standalone FAIL given no evidence of an actual stray file in the current build.

## 2. Spec invariants (IMPLICIT_SPEC.md)

| Invariant | Status | Evidence |
|---|---|---|
| I1 zero-cost defaults / no keyless-key promises | PASS | `providers-byok.astro` states "not configured" / "never a crash" skip semantics (verified in built HTML by `site/tests/attribution.test.ts:50-56`) |
| I2 pluggability | PASS | providers documented as swappable per registry (content review, not independently gated beyond G7 name-lock) |
| I3 data honesty | PASS | landing copy explicitly enumerates what does NOT ship ("no free search-volume database... doesn't fabricate one") — `site/src/pages/index.astro` WHY section |
| I4 crawl etiquette | PASS | configuration.astro covers robots default/override, UA, per-host rate limiting, sitemap discovery |
| I5 MCP-first parity / locked names only | PASS w/ FAIL noted above (sitemap dep) | `site/tests/locked-names.test.ts` — regex is the CURRENT `lumen_[a-z_]+` prefix (not a vacuous stale-`seolite_` pattern), asserts `!html.includes('seolite')`, byte-exact snippet checks, full CLI-reference coverage |
| I6 worker stays thin / local-only capability | PASS | mcp-onboarding.astro states local-only audit semantics and the typed remote error |
| I7 look derived, not copied | **FAIL** (footer inspiration line missing) | see Charge 1 above; G3 string-scan itself is fine (broader-than-required banned-string list, both source+built-HTML scanned) |
| I8 license & attribution | **FAIL** (footer inspiration line is part of I8's stated mechanism; license link itself is fully present) | `site/tests/attribution.test.ts` confirms license link + CC BY 4.0 + Tranco all present and correctly gated; only the inspiration-line clause of I7/I8's mechanism table is unmet |
| I9 TDD gate | PASS | every gate above is a Vitest test that runs pre-merge via `npm run check` |
| I10 determinism | PASS | `check-links.mjs` has zero fetch/http calls for external links (confirmed by full read); no wall-clock assertions found in any gate |
| I11 repo hygiene | PASS | `site/package.json:7` license Apache-2.0; commit history (`git log --oneline -- site/`) uses plain conventional-commit messages, no AI co-author trailers |
| I12 SSRF safety | PASS | configuration.astro documents scheme allowlist + private-range refusal + redirect re-validation |
| I13 output safety | PASS | G4 escaping scan is real (empty allowlist enforced by its own test, `set:html`/`is:raw` banned across all of `site/src/**`); rules-reference example JSON's `evidence.snippet` confirmed HTML-escaped in built output |
| I14 partial failure | PASS | rules-reference.astro has an `incomplete: true` labeled example |
| I15 boundary inputs | PASS | configuration.astro documents unknown-config-key error behavior |
| I16 privacy/no telemetry | PASS | zero third-party requests confirmed structurally (search is local Pagefind, no analytics scripts found in Base.astro) |
| I17 retry & backoff | PASS | configuration.astro documents typed-error/backoff/Retry-After semantics |

## 3. Failure/concurrency handling

- **Astro build failure blocks deploy**: PASS by construction — `npm run check` = `build && test`; no bypass found.
- **Any gate failure blocks merge**: PASS — single `check` script chains build then the full Vitest suite; no `--passWithNoTests` or skip flags found in `vitest.config.ts`.
- **Pagefind missing/broken fails fast**: PASS — `pagefind` is a pinned exact devDependency (`1.5.2`) invoked as a local bin in the `build` script, not `npx`; a missing/broken binary would fail `npm run build` non-zero before `check`'s test phase ever runs.
- **Pagefind index empty (G8) cannot die quietly**: PASS — `site/tests/search.test.ts` checks entry JSON validity, loader presence, **and** a concrete ≥8 KiB chunk-byte floor, plus wasm bundle presence and body-scoping structure — this exceeds the plan's minimum bar, not just a directory-exists check.
- **Theme toggle JS failure degrades to CSS**: PASS — `tokens.css:88-112`'s `@media (prefers-color-scheme: light)` block is independently asserted token-identical to the `[data-theme="light"]` block by `site/tests/contrast.test.ts:81-83`, so a JS failure still yields correct OS-preference theming.
- **`npm test` without prior build fails with guidance, no silent skip**: PASS — `site/tests/global-setup.ts` throws a hard error naming the exact remediation command (`npm run build -w @lumen-seo/site`) when `site/dist` is missing, wired via `vitest.config.ts:14`.
- **No silent skips in gates**: PASS — no `.skip`, `.todo`, or conditional gate-bypass found in any of the nine test files read.

## 4. Common defects

- No unhandled-error or resource-leak issues found in the reviewed gate scripts (`check-links.mjs`, all `tests/*.ts`) — all are synchronous file-system walks over a known-built directory with no async cleanup requirements.
- No N+1 or performance concerns applicable to a static-site build-time gate suite of this size.
- **Scope creep**: none found beyond the sitemap mechanism substitution already flagged (Charge 1) — no unplanned pages, unplanned dependencies, or unplanned JS behaviors beyond the three named in the plan (theme toggle, install tabs, search modal).
- Off-by-one / boundary check: `site/tests/search.test.ts`'s 8 KiB floor is a judgment call not specified numerically by the plan ("chunk bytes ≥ floor" — plan leaves the floor's exact value as an implementation detail: "the check suite... documented floor"); the floor is documented in the test file's own docstring, satisfying the plan's requirement that it be "a documented floor." Not a defect.

## 5. Convention fit

- Conventional-commit-style history confirmed on `site/`: `feat(site): ...` messages, no AI co-author trailers (`git log --oneline -- site/`).
- Workspace layout: `@lumen-seo/site` correctly named per the rename map, `private: true`, npm workspace member — consistent with repo conventions.
- Deterministic, no-network tests: confirmed throughout (I10 above).

## Verdict

Two real plan-conformance FAILs (missing `@astrojs/sitemap` integration/dependency; missing footer trade-dress/attribution inspiration line — the latter also touches spec invariants I7/I8) plus two minor/cosmetic divergences (footer lacks toggle; two badge shades and the 500 font-weight don't match the plan's literal token values). All nine build gates (G1–G9) are genuinely implemented with real assertions — no vacuous regexes, no faked contrast math, no weakened non-emptiness checks were found anywhere in the suite. Failure handling, determinism, and locked-name conformance are all solid. The findings are real but narrow in blast radius (one dependency swap, one missing footer sentence) and do not compromise the site's core invariants, gates, or safety properties.

VERDICT: MINOR-FAIL
