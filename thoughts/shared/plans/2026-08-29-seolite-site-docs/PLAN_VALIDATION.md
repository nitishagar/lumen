# PLAN VALIDATION — seolite site-docs (P5)

- date: 2026-08-29
- reviewer: adversarial plan reviewer (not the plan author); every item defaulted FAIL until earned with evidence
- under review: `IMPLICIT_SPEC.md` + `PLAN.md` in this bundle
- cross-referenced: `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` (Seam 2, I7/I8/I13, Seam 5), `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` (locked names), `thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` (R1–R10)

---

## 1. I7 mechanisms: automated trade-dress gate + theming/contrast mechanisms — PASS

Evidence:
- G3 is an automated Vitest gate, not prose: case-insensitive scan of all built HTML + `site/src/**` for the UNSAFE string set (`crooked`, `earendil`, `this one is yours`, `adapt pi to your workflows`, `many agent harnesses` — the last three are verbatim pi.dev hero copy per research Seam 2), plus a `pi.dev`-mention allowlist restricted to `/docs/attributions/` + the single footer inspiration line (PLAN L78, L101–105). `earendil` (case-insensitive) also covers the "Earendil Inc." item. Gate goes live in Phase 2 (L256) and is re-asserted in Phases 3 and 6.
- The inherently non-string-matchable residue (asset provenance, "trivially paraphrased" headlines, the pi wordmark/favicon as images) is explicitly declared a manual checklist recorded in the G3 docstring + Phase 6 PR walk (L78, L102, L363) — a stated blind spot with an owner, not silent prose enforcement.
- Auto/Light/Dark mechanisms are named concretely: `data-theme` attribute + `@media (prefers-color-scheme: light)` on `:root:not([data-theme="dark"])` + forced `[data-theme="light"]` + pre-paint `is:inline` script against `localStorage` (no FOUC) + pure-CSS no-JS fallback (L85, L240–254). The cascade logic is correct for all four OS-preference × JS-state combinations.
- `prefers-reduced-motion: reduce` mechanism named: `transition-duration: 0.01ms` + `animation: none` block in tokens.css (L243–245) plus disabled modal/smooth-scroll motion (L85).
- AA contrast is a deterministic math gate (G2): WCAG ratios computed from parsed `tokens.css` for every enumerated text/background pair in both themes, badges included, ≥ 4.5:1 (L256, L260). Ratios spot-recomputed independently: `#f97316` on `#09090b` = 7.10:1 (claimed 7.0, AA for normal text — accurate); `#c2410c` on `#ffffff` = 5.18:1 (claimed 5.2 — accurate); and the plan correctly identifies that raw `#f97316` fails AA on white, justifying the per-theme accent token (L111).
- Verdict: the automated gate carries the enforceable items; the unautomatable remainder is declared, bounded, and process-owned. Earned PASS.

## 2. I8 attribution rendering: named page + gate — PASS

Evidence:
- Dedicated attributions page at `/docs/attributions/` exists in the page-set minimum (IMPLICIT_SPEC L37), the docs sidebar TOC (L303), and Phase 4 content with the full required inventory: Apache-2.0, CrUX CC BY 4.0 + license link, Tranco attribution, Open PageRank factual reference, design-inspiration note, trademark factual-use note (L313) — matching research Seam 5 duties (`[V]` CrUX CC BY 4.0; Tranco attribution-required).
- Gate G9 is automated: license link asserted in every built page's footer + CC BY 4.0 and Tranco strings asserted on the attributions page (L79, L320, L369). Footer partial ships on every page via Layout (Phase 2).
- Minor observation (non-blocking): G9 does not enforce per-display CrUX attribution if a sample payload with `source.provider: "crux"` ever appears on a page other than attributions/providers-byok (IMPLICIT_SPEC I8 edge: "described or displayed anywhere"). Today's fixture content keeps CrUX displays on those two pages; the gate should grow a rule if that ever changes.

## 3. I13 escaping enforcement — PASS

Evidence:
- Enforcement is a gate, not prose: G4 scans `site/src/**` for `set:html` and `is:raw` — zero occurrences, allowlist file intentionally empty so any future use requires editing the gate loudly (L80, L262). Combined with Astro's escape-by-default interpolation and Shiki/markdown escaping-by-construction, banning the escape hatches enforces the invariant mechanically.
- Live crawled data is structurally excluded: "No rendering of live crawled data on the site — all examples are authored, escaped, static fixtures" (L59), with the example `Issue` JSON carrying an escaped `evidence.snippet` (L310). This matches ARCHITECTURE's allocation (site owns HTML escaping of rendered crawled data).
- The gate is live from Phase 2 onward, i.e., before any content pages exist.

## 4. Content completeness vs ARCHITECTURE locked names — PASS

Evidence (all verified against ARCHITECTURE.md):
- All 5 MCP tools present: `seolite_audit_site`, `seolite_page_report`, `seolite_keyword_ideas`, `seolite_rank_check`, `seolite_authority` (PLAN L29; mcp-onboarding documents "the five locked tools" L308; G7 regex `/seolite_[a-z_]+/` over all built HTML must yield only locked tools — catches typo'd tools in prose, L81, L290).
- All 7 CLI commands present: `audit|report|keywords|rank|authority|mcp|config show` (L29, L309) with matching flags (`--max-pages`, `--out`, `--json`, `--domain`) and exit codes 0/1/2 — byte-identical to ARCHITECTURE's CLI section. G7(a) asserts every locked command appears in the built CLI reference.
- All 7 providers present: `google-suggest`, `wikipedia-demand`, `pagespeed`, `crux`, `openpagerank`, `tranco`, `ddg-serp` (L311) — exact match to ARCHITECTURE's `@seolite/providers` list.
- R5 BYOK env names present and exact: `SEOLITE_PSI_KEY`, `SEOLITE_CRUX_KEY`, `SEOLITE_OPR_KEY` (IMPLICIT_SPEC BA-4 L51; PLAN L311), with G9 asserting skip-semantics phrase + env var names (L82). No conflict with RECONCILIATION R5.
- Other locked names (`seolite.config.json`, `failThreshold`, `plugins` with Node-only note, REST routes as subset) all present via the locked-names fixture + configuration page (L38 IMPLICIT_SPEC, L312); `claude mcp add --transport stdio seolite -- npx -y @seolite/cli mcp` matches BA-5 and research Seam 4 verbatim.
- Severity vocabulary (R1) and `failThreshold` semantics (R2) are treated as contract content per BA-6; no contradiction found.

## 5. Build/deploy contract complete and consistent for ci-deploy — FAIL → **RESOLVED (re-verified 2026-08-29)**

The contract CONTENT is complete — output dir `site/dist/`, base `/seolite`, required files `index.html` / `404.html` / `sitemap.xml` / `robots.txt` / `pagefind/`, `@astrojs/sitemap` + `public/robots.txt`, workflow step ordering documented, handoff note + clean-checkout dry run in Phase 6 (L66, L201–210, L215, L355, L364). But the contract's COMMAND half contradicts itself and violates RECONCILIATION R4 ("Authoritative decision: npm workspace `@seolite/site` … commands `npm run build -w @seolite/site`, `npm run check -w @seolite/site` … patched in site-docs PLAN"):

- Phase 1 `site/package.json` snippet names the package `"seolite-site"` (L170) — NOT `@seolite/site`. Implemented literally, every `-w @seolite/site` form in this plan fails (`npm -w` resolves the package name; `-w site` would still work as a path, but the `@seolite/site` forms would not).
- Pre-patch `-w site` forms survive in: the Desired End State verify block (L45–47), the Phase 1 output-contract block `command: npm run build -w site` and `CI gate: npm run check -w site` (L204, L209), Phase 1 SC `npm run test -w site` (L216), and Testing Strategy `npm test -w site` (L368).
- Meanwhile the SIGNPOST single verify command (L18), Owns (L17), Approach (L70), Phase 1 SCs L215/L217, all Phase 2–6 SCs, and CI wiring (L372) use the R4-correct `-w @seolite/site`.

The file is split between the pre-reconciliation and post-reconciliation decisions in the exact snippets ci-deploy consumes "verbatim" (L202). Fix (mechanical, no design change): set `"name": "@seolite/site"` in the Phase 1 snippet and normalize every occurrence to `npm run build|check|test -w @seolite/site`; delete the `-w site` forms.

Re-verification: fix applied and mechanically confirmed. Phase 1 snippet now reads `"name": "@seolite/site"` (updated PLAN L170); grep over the updated PLAN.md finds **29 occurrences of `-w @seolite/site`, zero bare `-w site` remnants**, and the only remaining `seolite-site` substring is the thoughts bundle directory name (`2026-08-29-seolite-site-docs/`), not a package name. The author reported 27 forms; the independent recount finds 29 — all consistent with R4 either way. The contract is now single-sourced and ci-deploy-consumable as written.

## 6. No TBDs / no mechanisms smuggled into the spec — PASS

Evidence:
- Zero "TBD/TODO/decide later" markers in either file. SIGNPOST open questions: none (L19); all defaults are recorded as BA-1..BA-13 (IMPLICIT_SPEC §3).
- IMPLICIT_SPEC stays requirements-shaped; the only mechanism-ish lines are bounding assumptions (BA-3 Pagefind custom modal, BA-9 axe/jsdom) — permitted recorded defaults, with the design rationale correctly living in PLAN.md (SSG alternatives table, L136–147).
- `<pinned latest stable major>` / `^<compat>` (L181–182) are version placeholders governed by an explicit recorded pinning policy (BA-2, L151: pinned exact at Phase 1), not design TBDs. G8's "documented floor" (L342) is a gate parameter set-and-documented at implementation, with the gate itself fully specified.

## 7. Success criteria exact + verify invariants / gates enumerated — PASS

Evidence:
- Every phase ends in automated, exactly-commanded success criteria (L214–218, L258–264, L288–293, L317–323, L344–349, L357–364), each wired to the single CI verify `npm run check -w @seolite/site` (the R4 form) — build → pagefind → G1–G9.
- G1–G9 are individually enumerated with mechanisms (Testing Strategy L369) and each is birthed in a specific phase (G1–G5 P2, G6–G7 P3, G7-ext + G9 P4, G8 P5, 100%-coverage consolidation P6). Assertions are structural/deterministic (file existence, string/regex scans, parsed-token math, jsdom axe, cheerio link walk), with "no silent skips" for the build-dependent test path (L368).
- The `-w site`/`-w @seolite/site` mixture (item 5) bleeds into four SC/command lines and is counted there; the gate enumeration itself is complete and consistent.

## 8. Resource math vs Pages cap; gate determinism — PASS

Evidence:
- Re-derived: 25–35 pages × 15–40 KB ≈ 0.4–1.4 MB HTML + ~10–15 KB JS + Pagefind chunked index 0.1–0.3 MB (Pagefind ships per-page fragment chunks of a few KB; for ~30 pages this estimate is realistic-to-generous) + SVG-only figures ≈ 2–4 MB total → 0.2–0.4% of the 1 GB Pages site cap (research Seam 5 `[V]`). The plan's "under 0.5%" claim (L155) holds. Bandwidth (100 GB/mo soft) and build minutes (15–40 s build + 20–40 s vitest) are plausible for this artifact size.
- Determinism: G2 is WCAG math over parsed token values (no rendering); axe runs in jsdom over static built HTML (no browser, no network); external links are recorded-never-fetched (BA-10); Pagefind is a pinned local devDependency, no npx-fetch-at-build; no wall-clock assertions (I10 row L84, L370). The two genuinely non-deterministic areas (rendered contrast, live focus behavior) are explicitly declared blind spots and replaced with deterministic substitutes (G2 math, structural ARIA assertions) — no flaky visual assertions exist in the suite. CI gates contain zero manual steps; manual items (trade-dress walk, Pagefind ranking smoke) are review-time only (L371).

---

## Minor observations (non-blocking, folded into the above items) — ALL RESOLVED on re-verification

- M1 (item 2): **RESOLVED** — G9 now "grows a per-display rule if CrUX-derived sample data ever renders outside attributions/providers-byok" (updated PLAN L369).
- M2 (item 4/I4): **RESOLVED** — I4 mechanism row now names "crawl budgets, sitemap discovery, per-host rate limiting" (L88); configuration page adds "sitemap discovery + per-host rate limiting (I4)" (L312); providers page adds "gray-provider rate-limit/cache etiquette (I4: honor 429/Retry-After, cache aggressively)" (L311).
- M3 (item 1): **RESOLVED** — one pinned `--link` pair site-wide, "landing and docs surfaces alike — no per-surface wobble" (L113), accent explicitly excluded from links (L110). Ratios re-verified: `#65a0ff` on `#09090b` = 7.6:1, `#0066cc` on `#ffffff` = 5.57:1 (claimed 5.6) — both AA; both enumerated in G2.
- M4 (item 7): **RESOLVED** — Pagefind sketch corrected to the real JS API: `import * as pagefind from "/pagefind/pagefind.js"; pagefind.search(q)` (L338).

## Verdict

Original review (2026-08-29, first pass): one FAIL — item 5, the R4 workspace-name/command contradiction (`seolite-site` + `-w site` remnants vs `-w @seolite/site`) inside the contract ci-deploy consumes verbatim; mechanical fix; all other items earned PASS with evidence.

Re-verification (2026-08-29, second pass): all five claimed fixes confirmed against the updated PLAN.md — (1) package renamed `@seolite/site` with 29 consistent `-w @seolite/site` forms and zero `-w site` remnants (grep-verified); (2) I4 doc points (sitemap discovery, per-host rate limiting, gray-provider 429/Retry-After/cache etiquette) added to the named pages and the I4 mechanism row; (3) link token pinned to one pair site-wide with accurately recomputed AA ratios; (4) Pagefind pseudo-code replaced with the real JS API; (5) CrUX per-display attribution folded into G9 as a conditional growth rule. Items 1–4 and 6–8 remain PASS unchanged; the edits introduced no new contradictions.

VERDICT: PASS
