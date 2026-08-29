# TEST_VALIDATION — site-docs (P5) test suite adversarial review

Reviewed: `site/tests/*.test.ts`, `site/tests/helpers.ts`, `site/tests/global-setup.ts`,
`site/tests/allowlists/escaping.json`, `site/scripts/check-links.mjs` against
`PLAN.md` (Testing Strategy, per-phase Success Criteria, Design Analysis gate table)
and `IMPLICIT_SPEC.md` (I1–I17, BA-1..13), with `RENAMES.md` as the authoritative
naming map (lumen / `@lumen-seo/*` / `lumen_*` / `LUMEN_*` / `/lumen/` are the
plan's real named entities, not a naming gap). Suite run over the built
`site/dist` artifact present in the worktree (9 built HTML pages).

## Charge 1 — Invariant / gate / success-criterion coverage

Covered and verified as real (non-tautological) tests:

- **G1** token conformance — `tokens.test.ts` — required CSS vars, light selector, no-JS media block, reduced-motion block, stylesheet link on every page. ✅
- **G2** contrast math — `contrast.test.ts` — WCAG ratios computed from real hex values parsed out of `tokens.css` for both themes, all 13 enumerated pairs, plus no-JS/light-block token identity and accent≠link. ✅
- **G3** trade-dress — `trade-dress.test.ts` — banned-string sweep over source + built HTML, `pi.dev` restricted to the attributions page (both source and built), inspiration-note content check. ✅
- **G4** escaping — `escaping.test.ts` + `allowlists/escaping.json` — `set:html`/`is:raw` banned, allowlist asserted empty. ✅
- **G5** a11y/structure — `a11y.test.ts` — jest-axe over all 9 built pages (contrast rule correctly disabled per BA-9), lang, skip link ordering, landmarks, single h1, theme-toggle/search-trigger as buttons, dialog semantics, viewport/description, ARIA tabs pattern + keyboard (ArrowLeft/Right) in bundle, theme persistence key, search Escape/ctrlKey/pagefind presence in bundle. ✅
- **G6** internal links — `links.test.ts` + `check-links.mjs` — full page-set coverage, broken-link assertion, external-link https assertion. Real link graph verified present (18–34 `<a href>` per sampled page), so not vacuous in the current artifact — see MINOR finding below for the missing defensive floor. ✅ (with caveat)
- **G7** locked names — `locked-names.test.ts` — byte-exact install snippets, `lumen_*` regex sweep = only locked tools (size-equality check catches under- *and* over-inclusion), all 5 tools/7 CLI commands/7 providers present, product/package/bin/config tokens present, **old codename `seolite` asserted absent** (a real regression guard), tagline, REST routes on MCP page. ✅ — but see FAIL findings below for gaps against the same gate's own named sub-criteria and fixture.
- **G8** Pagefind — `search.test.ts` — entry JSON + version field, loader present, index-chunk byte floor (8 KiB, real measured bytes), wasm bundle, per-page `data-pagefind-body` with nav-exclusion and sidebar-exclusion checked via real cheerio DOM queries (not string search), 404 deliberately unindexed, modal `data-base` attribute. ✅
- **G9** attribution — `attribution.test.ts` — footer license link + name + attributions link on every page, CrUX CC BY 4.0 verbatim sentence + both URLs, Tranco/Open PageRank/Wikimedia/license, providers page skip-semantics phrase + `never a crash` + all 3 env vars. ✅
- **Artifact contract** (Phase 1/6) — `artifact.test.ts` — required files, zero `.map` files, `/lumen/` base baked into asset/link URLs, robots→sitemap URL, **sitemap↔built-pages exact set equality** (a real cross-check, not a substring test). ✅
- **Meta pass** (Phase 6) — `meta.test.ts` — per-page title/description length floors, title uniqueness, description uniqueness, site-name-in-title, docs title suffix convention. ✅
- **Determinism (I9/I10)** — `global-setup.ts` fails fast with the exact required command when `dist` is missing, matching the PLAN's "fails with guidance, no silent rebuild" requirement verbatim. No network, no wall clock, no randomness anywhere in the suite. ✅

### FAIL — missing coverage

1. **G7(c) local-only capability language is untested**, despite being named explicitly in the PLAN's own Design Analysis table: *"(c) docs pages state local-only crawl semantics + the remote 'local-only capability' error behavior"* (PLAN.md I5/I6 row) and IMPLICIT_SPEC I6 (*"No page may imply remote crawling"*). The content exists in source (`src/pages/docs/mcp-onboarding.astro:106-120`: "local-only capability", "Worker … not deployed by default") but **no test in `locked-names.test.ts` or elsewhere asserts this text survives into the built HTML.** This content could be silently deleted or reworded to imply remote crawling and the full gate suite would stay green. Name: `site/tests/locked-names.test.ts` (no such test present).

2. **G7 fixture fields are defined but never checked against built output**: `locked-names.json`'s `exitCodes` (3 entries), `configKeys` (6 entries: `providers`, `severityOverrides`, `crawl`, `byok`, `plugins` — only `failThreshold` of the 6 is checked), and `responseFormatNote` are all present in the fixture (`site/src/data/locked-names.json:11-46`) and PLAN explicitly lists "exit codes, config keys" as part of the locked-names fixture G7 is meant to conform-check (PLAN.md line 81: *"Locked-names fixture … (CLI commands, MCP tools, REST routes, exit codes, config keys)"*). `locked-names.test.ts`'s "config + history + threshold tokens" test (line 102-111) only checks `configFile`, `'failThreshold'` (hardcoded string, not `locked.configKeys`), `historyDir`, `cliFlags` — it never iterates `locked.configKeys` or `locked.exitCodes`. A drift in exit-code text or a dropped config key (e.g. `byok`, `plugins`) in the docs would not fail the suite. File: `site/tests/locked-names.test.ts:102-111`.

3. **CHANGELOG link presence is untested.** IMPLICIT_SPEC (site-docs edges, line 37: *"A CHANGELOG link ships in nav/footer"*) and PLAN Overview (line 36) both name this as a requirement. The link does exist in the built footer (`href="https://github.com/nitishagar/lumen/blob/main/CHANGELOG.md"` verified in `dist/index.html`), but zero test in the suite asserts it. `attribution.test.ts` (G9) checks license + attributions links in the footer but not the changelog link; `locked-names.json` doesn't even carry a `changelogUrl`-consuming test despite the field being defined at `locked-names.json:6`. A regression here is invisible to CI.

### Design-Analysis-table items correctly left unautomated (not findings)

- I3 data honesty ("reviewed as content; G7 prevents tool-name drift"), I4/I12/I14/I15/I17 content coverage on configuration/rules pages, and BA-6 rule-ID drift are explicitly scoped by the PLAN as content-review items, not automated gates — consistent with the two unchecked Phase 6 boxes ("Trade-dress manual checklist," "Contract handoff note"). Not counted as suite gaps, per the task's explicit scope-out list and the PLAN's own language.

## Charge 2 — Real assertions vs. tautologies

- No assertions found that reduce to "no exception thrown" — every test asserts on parsed content (regex matches against real built bytes, cheerio DOM queries, computed contrast ratios, byte counts).
- `contrast.test.ts` computes actual WCAG relative luminance/ratio from token hex values rather than hardcoding pass/fail — a real math gate, not a lookup table.
- `search.test.ts`'s pagefind-exclusion test uses real cheerio parent/descendant queries (`$('aside').parents('[data-pagefind-body]').length` and per-nav `data-pagefind-exclude` check) — meaningfully verifies scoping, not just string presence.
- `locked-names.test.ts`'s `lumen_*` sweep uses `seen.size === locked.mcpTools.length`, which fails on **both** missing tools and stray/typo'd tokens — stronger than a simple "contains" check and specifically named in the PLAN as the anti-typo mechanism.
- **MINOR** — `links.test.ts` / `check-links.mjs`: `checkLinks()` returns `internalLinks: htmlFiles.length` (`scripts/check-links.mjs:120`), which is not the count of internal links checked — it's just the page count again, duplicating the `pages` field. This field is dead/misleading (unused in `links.test.ts`) but doesn't affect test correctness since nothing asserts on it. Low severity; a stale/wrong field.
- **MINOR (near-tautology)** — `links.test.ts`'s `'zero broken internal links/anchors'` test (`tests/links.test.ts:18-20`) would pass vacuously if a page shipped with zero `<a href>` elements — there is no assertion establishing a floor on the number of internal links actually walked. Verified against the current artifact this isn't currently vacuous (18–34 links per sampled page), but the test provides no structural guard against a future regression that strips all navigation from a page while leaving `broken` empty by construction. Recommend asserting e.g. `result.broken.length + <total attrs walked> > N` or exposing a real `internalLinks` counter and asserting it's non-trivial.

## Charge 3 — Over-mocking

None found. Every test operates on the real `site/dist` build output or real `site/src` source files via `readFileSync`/`readdirSync`/cheerio parsing — no subject under test is mocked, stubbed, or replaced with fixtures standing in for the artifact. `jest-axe`/`jsdom` inject real built HTML bodies (`bodyOf(html)`) rather than synthetic markup. The link checker (`check-links.mjs`) is imported and run as a pure function directly against `distDir`, not re-implemented or mocked in the test. ✅ Pass.

## Charge 4 — Determinism

- No network calls anywhere (`WebFetch`/`fetch`/`http` not used in tests or `check-links.mjs`; external links are recorded into an array and only string-checked for `https://` prefix, never dereferenced — matches BA-10).
- No wall-clock assertions (`Date.now`, `setTimeout`-based waits) found in any test file.
- No randomness sources found.
- `readdirSync(..., { recursive: true })` (artifact.test.ts) and directory walks are order-independent for the assertions made (set/array-equality after `.sort()` in `walk()`, or `.filter().toEqual([])` checks) — no flake risk from filesystem enumeration order.
- Suite depends only on files inside the worktree (`site/dist`, `site/src`); no machine-specific paths, environment variables, or absolute paths outside the repo. ✅ Pass.

## Charge 5 — Suite hygiene

- Failure messages consistently name the file and reason, matching PLAN's explicit requirement (*"the failing test names the file + reason"*): e.g. `` `${fg} (${f}) on ${bg} (${b}) = ${r.toFixed(2)}:1` `` (contrast.test.ts:93), `` `${file} contains banned string "${needle}"` `` (trade-dress.test.ts:36), `` `${page} footer lacks the license href` `` (attribution.test.ts:24), `` `command "${command}" missing from CLI reference` `` (locked-names.test.ts:79). ✅
- `global-setup.ts` gives the exact guidance command (`npm run build -w @lumen-seo/site`) when `dist` is missing and refuses to silently rebuild — matches PLAN Testing Strategy verbatim. ✅
- No `.skip`, `.todo`, `xdescribe`/`xtest`, or leftover `.only` found in any test file — no silent skips. ✅
- `escaping.test.ts` asserts the allowlist file itself is `[]`, so a future silent "just add it to the allowlist" bypass is itself gated (loud-edit-required, matching PLAN's *"any future use must edit the gate, loudly"*). ✅

## Coverage matrix (G1–G9 + meta/artifact)

| Gate | Test file | Verdict |
|---|---|---|
| G1 token conformance | tokens.test.ts | PASS |
| G2 contrast math | contrast.test.ts | PASS |
| G3 trade-dress | trade-dress.test.ts | PASS |
| G4 escaping | escaping.test.ts | PASS |
| G5 axe + structure | a11y.test.ts | PASS |
| G6 internal links | links.test.ts + check-links.mjs | PASS (minor: no link-count floor, dead `internalLinks` field) |
| G7 locked names | locked-names.test.ts | **FAIL** (local-only language untested; exitCodes/configKeys/responseFormatNote fixture fields unchecked) |
| G8 Pagefind index | search.test.ts | PASS |
| G9 attribution | attribution.test.ts | **FAIL** (CHANGELOG link untested) |
| Artifact contract | artifact.test.ts | PASS |
| Meta (titles/desc) | meta.test.ts | PASS |
| Determinism/hygiene | global-setup.ts | PASS |

## VERDICT

VERDICT: MINOR-FAIL
