---
date: 2026-08-29
aspect: site-docs (P5)
branch: feat/lumen-site (from main 61aaa05)
protocol: implement_plan_v2_5
status: complete — all 6 phases implemented, G1–G9 green
---

# REASONING — site-docs implementation

Outcome first: `npm run check -w @lumen-seo/site` runs clean end-to-end
(astro build → pagefind → 187 gate tests over the built artifact, 9 pages +
404). Root `npm run lint`, `npm run typecheck`, and `npm test` remain green.
All naming follows RENAMES.md (lumen / @lumen-seo/cli / lumen_* / LUMEN_* /
lumen.config.json / base /lumen/).

## Phase log

- **P1 scaffold + contract.** Astro **7.2.9** pinned exact (latest stable
  major at install time; BA-2 "pinned exact" honored), pagefind 1.5.2,
  cheerio/jest-axe/jsdom/vitest for the gates. `build` =
  `astro build && pagefind --site dist`; contract recorded in `site/README.md`.
- **P2 design system.** `tokens.css` implements the derived vocabulary with
  AA-safe concrete values (dark accent #f97316 7.1:1 on bg; light accent
  #c2410c; ONE pinned link pair #65a0ff/#0066cc; badge 400/700-family pairs
  on precomputed tints). Auto/Light/Dark via pre-paint `is:inline` script +
  `data-theme` + `@media (prefers-color-scheme: light)` fallback (works with
  JS off — G2 asserts the media block is token-identical to the light
  block). Reduced-motion zeroes transitions. Original inline-SVG wordmark.
- **P3 landing.** Hero + tagline + npm/npx/claude install tabs (ARIA tabs,
  arrow/Home/End keys), four sections with mono labels and four original
  in-repo SVG figures with `Fig. NN |` captions, honest what-lumen-doesn't-do
  list. `locked-names.json` is the single source for every locked string.
- **P4 docs.** Sidebar layout + on-this-page; 7 pages (quickstart, MCP
  onboarding claude/cursor/vscode/universal, CLI reference, 18-rule
  reference, providers+BYOK with per-provider what-leaves-your-machine,
  configuration incl. budgets/failThreshold/error behavior, attributions).
- **P5 search.** Pagefind indexes the `data-pagefind-body` regions
  (nav/sidebar/on-this-page excluded via structure + `data-pagefind-exclude`);
  custom ⌘K modal on the Pagefind JS API, loaded lazily on first open.
- **P6 hardening.** Titles/descriptions uniqueness gate; clean-checkout
  `check` dry run; screenshots (below); README gate inventory.

## Deviations from PLAN.md (all deliberate, all recorded)

1. **No `@astrojs/sitemap`.** The artifact contract (and ci-deploy) requires
   `dist/sitemap.xml` literally; the integration emits `sitemap-index.xml` +
   chunked files. Shipped a hand-authored `public/sitemap.xml` instead and
   closed the drift risk with a gate asserting sitemap ⇄ built pages agree
   EXACTLY (both directions).
2. **G3 allowlist narrowed.** `pi.dev` may appear ONLY on
   `/docs/attributions/`; the footer carries no pi.dev line (the plan's
   optional footer inspiration line moved to the attributions page). Gate is
   stricter and simpler than the plan's variant. Banned-string list includes
   "agent harness" (task instruction) which subsumes the plan's
   "many agent harnesses".
3. **`site/test` requires a prior build** exactly per plan (fails with
   guidance, no silent rebuild). Consequence for ci-deploy (P6b handoff):
   today's branch-push scoped step `npm test --if-present -w @lumen-seo/site`
   would fail without a build; the workflow should run
   `npm run check -w @lumen-seo/site` for the site workspace (the plan's CI
   wiring already says exactly this). PR/main runs are unaffected (root
   vitest `projects` glob covers `packages/*` only).
4. **Pagefind URL base.** `pagefind --site dist` stores site-dir-relative
   URLs (`/docs/quickstart/`); the modal prefixes the `/lumen` base at render
   time (`data-base` attr) rather than post-processing binary index chunks.
5. **Markdown pipeline not used.** Docs pages are hand-authored `.astro` (the
   plan allowed markdown; plain astro gives guaranteed heading anchors for
   G6 and zero raw-HTML paths for G4). No `set:html`/`is:raw` anywhere.
6. **jest-axe scope.** axe runs over each page's `<body>` content with the
   `color-contrast` rule disabled (unmeasurable in jsdom — BA-9); contrast is
   guaranteed by G2 math. `lang`, single-h1, landmarks, skip link asserted
   structurally in the same spec.
7. **Small root-file touches:** `.gitignore` += `.astro/`, eslint ignores +=
   `**/.astro/` (Astro's generated types dir), both additive and required for
   root lint to stay green. The ci-deploy workflow was NOT touched.

## Gate inventory (as shipped)

G1 tokens · G2 contrast math (26 pairs × 2 themes + media-block identity) ·
G3 trade-dress (5 banned strings + pi.dev page restriction, src + dist) ·
G4 escaping ban (empty allowlist by design) · G5 axe over 100% of built
pages + tabs/modal/keyboard structure · G6 internal links/anchors via
`site/scripts/check-links.mjs` (cheerio; externals recorded, never fetched) ·
G7 locked names (byte-exact snippets, `lumen_*` sweep, per-page coverage of
commands/tools/providers/env/routes) · G8 pagefind non-empty + scoping ·
G9 footer Apache-2.0 on every page + CrUX CC BY 4.0 (verbatim sentence +
license + methodology URLs) + Tranco on attributions. Plus artifact-contract
and meta (unique titles/descriptions) specs.

## Screenshots

Committed under `docs/screenshots/` (repo root) for a later vision review,
rendered headlessly with playwright-core driving the system Chrome (no
dependency added to the repo):

- `docs/screenshots/lumen-landing-dark.png` (full page, dark)
- `docs/screenshots/lumen-docs-quickstart-dark.png` (full page, dark)
- `docs/screenshots/lumen-landing-light.png` (full page, light)

Rendered from the final build; theme verified via computed styles
(dark: bg rgb(9,9,11)/text rgb(250,250,250); light: bg rgb(255,255,255)).
An intermediate vision pass on an earlier build caught a real bug —
literal `</code>, <code>` text leaking from an `envVars.join()` trick —
which was fixed (proper `<Fragment>` mapping in index + mcp-onboarding) and
re-verified by grep + full re-render. Not skipped.

## Manual trade-dress checklist (walked)

- Every SVG (wordmark, favicon, 4 figures, header icons) authored in-repo
  for lumen; no third-party assets, screenshots, or press-kit files.
- No third-party tagline/headline/section-title set reproduced; copy is
  original (plain, honest, lightly wry).
- `pi.dev` appears exactly once in source (attributions page) as a factual
  design-inspiration note.

## Contract handoff note to ci-deploy

```
command:  npm run build -w @lumen-seo/site     → site/dist/
gate:     npm run check -w @lumen-seo/site     (build + pagefind + G1–G9)
required: index.html, 404.html, sitemap.xml, robots.txt, pagefind/
```

---

# RESUME LOG — 2026-08-29 (second agent)

The first run died mid-Phase-6 with uncommitted WIP. This agent resumed at
commit b906085, reconciled the WIP against plan Phase 6, verified everything
from a clean build, and is landing Phase 6.

## Verification performed on resume (evidence for checkbox ticks)

- `rm -rf site/dist site/.astro` then `npm run check -w @lumen-seo/site`:
  green end-to-end — astro build → pagefind (8 pages indexed) → **187 tests /
  11 files passed** (G1–G9 + artifact + meta).
- Root gates with the Phase 6 changes in place: `npm run lint` clean,
  `npm run typecheck` clean, root `npm test` 179/179 (packages + ci-scripts;
  root vitest does not cover site, as designed).
- 404 hardening verified in the built artifact: `dist/404.html` carries
  `<meta name="robots" content="noindex">` and no canonical link.
- Env-var rendering verified in dist: zero `&lt;/code&gt;` escaped-entity
  leaks; both index and mcp-onboarding render
  `<code>LUMEN_PSI_KEY</code>, <code>LUMEN_CRUX_KEY</code>, <code>LUMEN_OPR_KEY</code>`
  as proper markup. The only remaining `.join(` in src is plain-text
  (`rule.categories.join(', ')`) — safe by inspection.

## WIP reconciliation (what the dead run left, now landed)

- `Base.astro` + `404.astro`: `noindex` prop → robots noindex meta on 404
  (and canonical suppressed there). Serves the Phase 6 meta pass: the 404 is
  not a real indexable page.
- `index.astro` + `mcp-onboarding.astro`: replaced the
  `envVars.join('</code>, <code>')` string trick (Astro escapes interpolated
  strings — it rendered literal escaped markup on the page) with proper
  `<Fragment>` mapping over `<code>` elements. This is the fix the first
  agent's screenshot vision pass caught; re-verified in the final build (see
  above).
- `site/tests/meta.test.ts` (new): unique titles/descriptions gate —
  Phase 6's "every built page has unique `<title>` + `meta[name=description]`".
- `site/tests/a11y.test.ts`: page-set assertion hardened to `>= 9` (landing +
  404 + 7 docs) so axe coverage can't silently shrink below the full set.

## Corrections to prior entries in this file

- **Screenshots are NOT committed.** The "Screenshots" section above says
  "Committed under docs/screenshots/" — that was written before the commit
  and is wrong. The plan (Phase 6) does not specify screenshots at all, so
  committing them would be unplanned scope; the three PNGs are left
  **untracked** at `docs/screenshots/` for the orchestrator to take or
  discard. They served their purpose as a verification aid (they caught the
  env-var leak fixed above). The `agent` entry in the section header is also
  corrected here: rendering used `playwright-core` driving the system Chrome,
  no dependency added.

## Bookkeeping notes

- PLAN.md: the 31 `Automated:` boxes across Phases 1–6 are ticked
  retroactively on the strength of the resume verification run above (every
  box maps to a gate test that ran green in the single `check` invocation).
  The two Phase 6 boxes marked "— reviewed" (trade-dress PR-description walk,
  ci-deploy handoff confirmation) are left UNticked: they are human-review
  gates owned by the orchestrator / ci-deploy implementer. The mechanical
  portion of the trade-dress walk was re-done here (no external asset refs in
  src/public; SVGs all in-repo; `pi.dev` confined to attributions — 2
  factual mentions) and is recorded above.
- "Clean checkout" dry-run approximation: clean build artifacts
  (`site/dist`, `site/.astro` removed) + full `check` from the preinstalled
  worktree (node_modules present per environment; no fresh `npm ci` — the
  suite is offline-deterministic by I10, so dependency provenance does not
  affect gate outcomes).
- Review mechanism: this harness exposes no Agent tool; the mandated fresh
  adversarial reviewers (impl + test + security) are spawned as headless
  one-shot `claude` CLI sessions in the worktree, each writing its bundle
  artifact and returning verdict + findings only.

---

# REVIEW ROUND 1 — 2026-08-29 (resume log continued)

Both adversarial reviews ran on the Phase 6 commit (c08f880) as fresh
headless sessions; artifacts:
`IMPLEMENTATION_VALIDATION.md` (VERDICT: MINOR-FAIL, 4 findings) and
`TEST_VALIDATION.md` (VERDICT: MINOR-FAIL, 5 findings). Dispositions:

## Fixed in code (all plan-aligned; check re-run green: 193 tests)

1. **Footer inspiration line added** (impl finding 2) — the Phase 2 footer
   composition and the I8 mechanism row name it; the earlier narrowing
   (deviation 2 above) is WITHDRAWN. `Footer.astro` now carries
   "Visual design inspired by pi.dev; tokens reimplemented from scratch",
   and the G3 gate implements the plan's exact two-location allowlist
   (attributions page + that single footer line), asserting the line on
   every built footer and banning pi.dev everywhere else outside footers.
   README's G3 row updated to match.
2. **Footer theme toggle added** (impl finding 3) — Phase 2 lists a footer
   toggle; the existing JS already binds all `[data-theme-toggle]` buttons.
3. **font-weight 500 now used** (impl finding 4b) — the footer inspiration
   line is set at 500, making the plan's 500/600/800 ramp fully shipped.
4. **check-links.mjs `internalLinks`** was a duplicate of the page count
   (test finding 5) — now the real count of internal targets classified
   (255 on the current artifact; 60 external recorded; 0 broken).
5. **links.test.ts vacuous-pass guard** (test finding 4) — new assertion
   that ≥ 40 internal targets were walked, so "zero broken" can never pass
   on a link-less artifact.
6. **G7(c) local-only semantics asserted** (test finding 1) — new test:
   mcp-onboarding built HTML states local-only crawl semantics, the typed
   "local-only capability" error pointing at `npx @lumen-seo/cli`, and the
   BA-7 "not deployed by default" Worker scoping.
7. **G7 fixture fields now checked** (test finding 2) — exit codes with
   their locked meanings in the CLI reference; all six `configKeys` on the
   configuration page; `response_format` note on the MCP page.
8. **CHANGELOG link asserted** (test finding 3) — G9 now requires
   `href="{changelogUrl}"` in every built page footer.

## Justified, not "fixed" (plan-vs-plan conflicts; evidence recorded)

- **Badge light-theme 800-family kept** (impl finding 4a): the plan's
  "700-family (e.g. #15803d)" is unsatisfiable together with its own other
  two constraints ("~10% tint" + "≥4.5:1"): computed ratios on the shipped
  tints are green-700 4.38:1 and amber-700 4.40:1 (both FAIL), vs shipped
  green-800 6.23:1 and amber-800 6.21:1 (PASS). The normative anchor is the
  G2 ≥4.5:1 floor (WCAG AA), so the "e.g." family yields to it. Blue/purple/
  red light values already are 700-family.
- **Sitemap mechanism** (impl finding 1): recorded as a formal plan fix in
  PLAN.md Phase 1 (see addendum) — `@astrojs/sitemap` cannot emit the
  contract's literal `sitemap.xml`; the hand-authored file + both-direction
  agreement gate satisfies the stronger, ci-deploy-locked contract.

Reviewer resume confirmations: both sessions resumed with the fix list;
verdicts recorded below (appended after confirmations).
