---
plan: seolite site-docs (P5)
protocol: create_plan_generic_v2_5
date: 2026-08-29
scale: large
---

# SIGNPOST

| Field | Value |
|---|---|
| Aspect | site-docs (P5) — the `site/` workspace: landing + docs + gates |
| Bundle | `thoughts/shared/plans/2026-08-29-seolite-site-docs/` |
| Scale | large |
| Inputs | `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` (Seam 2 tokens, I7/I8/I13, Pages + Pagefind evidence) · `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` (locked names; site/ not published; static via Actions) · this bundle's `IMPLICIT_SPEC.md` |
| Depends on | M0 scaffold-core merged (npm workspaces + bootstrap CI green). Branch depends ONLY on core/scaffold — zero runtime imports from `packages/*`. Merge order P2 → P3 → P4 → **P5** (last; docs reconcile final names at rebase). |
| Owns | `site/**` — content, design system, build gates, and the **build output contract** (`npm run build -w @seolite/site` → `site/dist/`) consumed by the ci-deploy upload-pages-artifact workflow. Does NOT own the workflow file. |
| Verify (one command) | `npm run check -w @seolite/site` |
| Open questions | none — all conservative defaults recorded as BA-1..BA-13 in IMPLICIT_SPEC.md |

## Overview (scale: large)

Build the seolite public face: a static landing + docs site under `site/`, designed from the pi.dev token VOCABULARY (dark zinc, one warm accent, system fonts, mono labels) with entirely original branding and copy, content written against the locked CLI/MCP names from ARCHITECTURE.md, client-side static search, and a battery of deterministic build gates (accessibility, contrast, trade-dress, escaping, locked-name conformance, internal links, index non-emptiness). The site is a leaf workspace: it ships a pure static directory that the ci-deploy aspect uploads via `actions/upload-pages-artifact`. Nothing on this site fetches anything at runtime — fitting, for a tool whose whole personality is "we tell you what leaves the machine."

## Current State

- Repository exists locally (`~/repos/learn/seolite`) with only `thoughts/`, `.git`, `.gitignore`. No `site/` directory, no packages, no CI yet.
- M0 (scaffold-core) is planned, not merged; per ARCHITECTURE sequencing this branch is cut from post-M0 `main` (workspaces + Node 22 + Vitest + bootstrap CI already green there).
- All content inputs are ready and stable: locked package names (`@seolite/cli`, `@seolite/mcp`), locked CLI commands (`seolite audit|report|keywords|rank|authority|mcp|config show`), locked MCP tools (`seolite_audit_site`, `seolite_page_report`, `seolite_keyword_ideas`, `seolite_rank_check`, `seolite_authority`), locked REST routes, config file shape (`seolite.config.json`, `failThreshold`, `plugins`), and the extracted design-token vocabulary with its trade-dress safe/unsafe lists.
- GitHub Pages has no site enabled yet; the deploy workflow belongs to ci-deploy (P6b, lands in M2) and will consume this aspect's build contract.

## Desired End State

`site/` is a workspace project that, given a checkout of post-M0 `main`, produces the complete public site with one command:

- Landing page: hero with accessible install-box tabs (`npm install -g @seolite/cli` / `npx -y @seolite/cli audit …` / `claude mcp add …`), four ethos sections (why seolite, pluggable providers, MCP-first, data honesty) with mono labels and original SVG figures with `Fig. NN | caption` captions, footer with Apache-2.0 + attributions + CHANGELOG link + theme toggle.
- Docs at `/docs/*`: quickstart, MCP onboarding (Claude Code / Cursor / VS Code / universal JSON), CLI reference, rules reference, providers + BYOK (env var names, skip-when-absent semantics, what-leaves-the-machine), configuration, attributions (CrUX CC BY 4.0, Tranco, license, design-inspiration note).
- Auto/Light/Dark theming (no FOUC, no-JS fallback to OS preference), `prefers-reduced-motion` respected, WCAG AA contrast in both themes, keyboard-navigable throughout.
- Cmd/Ctrl+K static search (Pagefind) shipping inside the artifact.
- Gates: `npm run check -w @seolite/site` green = build + Pagefind + token conformance + contrast math + trade-dress scan + escaping scan + axe-on-built-pages + internal link/anchor check + locked-names conformance + index non-empty.

**Verify commands** (exact, run from repo root):

```
npm run build -w @seolite/site   # astro build + pagefind index → site/dist/
npm run check -w @seolite/site   # build + full gate suite (vitest) — the CI gate
npm run test  -w @seolite/site   # vitest suite alone (requires a prior build; fails with guidance if site/dist missing)
```

## What We're NOT Doing

- No deploy workflow in this aspect — ci-deploy owns `.github/workflows/*`; we only define and document the artifact contract it consumes.
- No custom domain, no CDN in front of Pages, no analytics/telemetry/tracking pixels (the privacy ethos applies to our own site too), no A/B testing.
- No client framework (React/Vue/Svelte islands), no web fonts, no MDX, no WASM — three small vanilla-JS behaviors total: theme toggle, install tabs, search modal.
- No auto-generated API docs (TypeDoc et al.) — the CLI/MCP reference is hand-written and pinned to correctness by the locked-names gate instead.
- No blog/News/changelog-rendering section in v1; CHANGELOG is linked on GitHub (BA-8).
- No i18n, no comment system, no newsletter capture, no SEO-theater beyond the honest basics (titles, descriptions, sitemap, robots — it would be embarrassing for an SEO tool to fail those).
- No scraping or copying of pi.dev assets, screenshots, or copy — including "just temporarily, we'll replace it."
- No rendering of live crawled data on the site — all examples are authored, escaped, static fixtures (I13).
- No tests that touch the network or a real browser (BA-9, BA-10).

## Approach

One Astro workspace project at `site/` (SSG decision and rejections in Design Analysis), content-first:

1. **Build contract first.** Define `npm run build -w @seolite/site` → `site/dist/` (pure static: `index.html`, `404.html`, `sitemap.xml`, `robots.txt`, later `pagefind/`) so ci-deploy can consume a stable interface even before all pages exist.
2. **Design system before pages.** Tokens as CSS custom properties in one `tokens.css` derived from the VOCABULARY with our own concrete values (dark-first, light theme derived for AA contrast), base layout with header/footer/skip-link, Auto/Light/Dark via `data-theme` + OS media query + tiny pre-paint script.
3. **Pages from locked names.** Landing then docs; every snippet on the site is a string built from ARCHITECTURE's locked names; sample report JSON uses the payload model fields and carries provenance + an incomplete-labeled example.
4. **Search as post-build indexing.** Pagefind over `dist/` after `astro build`, custom ⌘K modal on the Pagefind JS API, index non-empty gate.
5. **Gates as Vitest tests over the built artifact.** One deterministic suite: token conformance, contrast math, trade-dress strings, `set:html` ban, jest-axe over every built page, internal link/anchor check, locked-names conformance, footer/attribution presence, Pagefind non-empty. `npm run check -w @seolite/site` chains build → suite and is the single CI gate.

## Design Analysis

### Invariants → mechanisms

| Invariant | Mechanism |
|---|---|
| **I7 look derived, not copied** | `site/src/styles/tokens.css` defines CSS custom properties implementing the VOCABULARY with our concrete choices (values below). Original inline-SVG wordmark; original copy throughout. **Trade-dress gate (G3)** = automated Vitest scan of all built HTML + site source (case-insensitive) for the UNSAFE strings below, plus `pi.dev` mention allowed only on `/docs/attributions` (+ one footer inspiration line); plus a manual review checklist recorded in the test's docstring (asset provenance can't be string-matched). |
| **I8 license & attribution** | Footer partial on every page: "Apache-2.0" → LICENSE, "Attributions" → `/docs/attributions/`, "Changelog" → GitHub CHANGELOG, GitHub/npm links. Attributions page: CrUX CC BY 4.0 notice with license link, Tranco attribution, Open PageRank factual reference, design-inspiration note, trademark factual-use note. **Gate (G9)** asserts license link in every built page's footer and the CC BY 4.0 + Tranco strings on the attributions page. |
| **I13 output safety** | Astro escapes interpolated content by default; markdown/Shiki pipelines escape code by construction. **Gate (G4)**: Vitest scan of `site/src/**` for `set:html` and `is:raw` — zero occurrences, allowlist file intentionally empty (any future use must edit the gate, loudly). All crawled-data examples are authored fixtures with escaped `evidence.snippet` fields. |
| **I5 / I6 parity & thin worker** | Locked-names fixture `site/src/data/locked-names.json` (CLI commands, MCP tools, REST routes, exit codes, config keys). **Gate (G7)**: (a) every locked CLI command appears in built CLI reference; (b) regex `/seolite_[a-z_]+/` over all built HTML yields only locked tool names (catches typo'd tools in prose); (c) docs pages state local-only crawl semantics + the remote "local-only capability" error behavior. |
| **I1 / I16 BYOK + privacy** | Providers page documents each provider with: kind label (official/community/gray/heuristic), env var NAME (value never persisted), skip-when-not-configured semantics, "what leaves your machine" line. Site itself ships zero third-party requests. Gate (G9) asserts the skip-semantics phrase and env var names are present. |
| **I3 data honesty** | Example report/idea JSON in docs wrapped in the locked `{ value, source: { provider, kind, … }, retrievedAt }` shape; heuristic/gray examples visibly labeled; landing copy claims only what ships (free tiers, local audit, best-effort SERP). Reviewed as content; G7 prevents tool-name drift. |
| **I9 / I10 TDD + determinism** | All gates are Vitest tests over files on disk — no network, no wall clock. External links recorded, never fetched (BA-10). Pagefind pinned as devDependency (hermetic build; no npx-at-build). |
| **I7 theming (Auto/Light/Dark, reduced-motion)** | Three-state toggle (auto → light → dark) persisting to `localStorage`; pre-paint inline script sets `data-theme` (no FOUC); CSS: dark tokens on `:root`, light tokens under `@media (prefers-color-scheme: light)` unless `[data-theme="dark"]`, forced light via `[data-theme="light"]` — no-JS visitors get correct auto theming for free. `prefers-reduced-motion: reduce` zeroes transitions/animations and disables modal/smooth-scroll motion. |
| **Accessibility audit invariant** | Skip link → `#main`; landmarks (`nav`/`main`/`footer`); single `h1`/page; `lang="en"`; install tabs = ARIA tabs pattern; search modal = `role="dialog"`, focus moved in, Escape closes, focus returned; visible `:focus-visible` styles from tokens. **Gate (G5)**: jest-axe (axe-core in jsdom) over every built HTML file — violations fail the build; contrast rule incomplete in jsdom by nature → covered deterministically by **Gate (G2)** contrast math. Structural keyboard assertions in G5: skip link present, tabs/modal ARIA present, all nav items real `<a href>`. |
| **I11 repo hygiene** | Site builds/deploy from `main` (ci-deploy wires it); site content carries author + license; conventional plain commits, no trailers (process). |
| **I4 / I12 / I14 / I15 / I17** | Content coverage on configuration + rules pages: robots default/override, UA identification, crawl budgets, sitemap discovery, per-host rate limiting, SSRF-guarded URL handling, incomplete-report example (labeled), unknown-config-key error, timeout/backoff/typed-error semantics. |

### Trade-dress safe/unsafe checklist (enforced as gate G3)

**SAFE to implement (generic, from the extracted VOCABULARY):**
- Dark zinc background family (`#09090b`-family) with near-white text and one warm orange accent.
- System font stacks only, zero web fonts (mono for terminal chrome/labels, sans for prose).
- Root ~18px; dense mono micro-labels; single-column minimal layout.
- 8px-family radii: 8px cards/terminal, 6px buttons/pre, 4px inline code, pill=999px.
- Figure captions in `Fig. NN | caption` form.
- Client-side static search with Cmd/Ctrl+K trigger; Auto/Light/Dark toggle; `prefers-reduced-motion` respected; 0.2s ease transitions (muted under reduced motion).
- Badge accent tints (green/blue/purple/amber family) for kind labels.

**UNSAFE (gate G3 fails the build on these; case-insensitive):**
- The "pi" name, logo, favicon, or any asset from the pi-website repo — our mark and figures are original in-repo SVG (manual provenance checklist in G3 docstring).
- The strings: `crooked`, `earendil`, `this one is yours`, `adapt pi to your workflows`, `many agent harnesses` — anywhere in site source or built HTML.
- Any pi.dev section-title set, tagline, or headline reproduced verbatim or trivially paraphrased (review checklist item; the distinctive-string scan catches the known ones).
- `pi.dev` mentioned anywhere except `/docs/attributions/` and the single footer inspiration line ("Visual design inspired by pi.dev; tokens reimplemented from scratch" — factual third-party reference per I8).
- "Earendil Inc." branding or press-kit assets in any form.

### Concrete token values (our choices within the vocabulary)

- Dark theme: bg `#09090b`, surface `#18181b`, border `#27272a`, hover `#3f3f46`, text `#fafafa`, dim `#a1a1aa`, accent `#f97316` (7.0:1 on bg — AA). Accent is for mono labels, badges, and buttons only — links use the pinned `--link` token below, never the accent.
- Light theme: bg `#fff`, surface `#fafafa`, border `#e4e4e7`, text `#18181b`, dim `#52525b`, accent `#c2410c` (5.2:1 on white — AA; the raw `#f97316` fails AA on white, which is exactly why accent is a per-theme token, not a constant).
- Badges: dark theme text = 400-family (e.g. `#4ade80`) on 10–14% tinted bg; light theme = 700-family (e.g. `#15803d`) on ~10% tint — each pair enumerated in the G2 contrast fixture at ≥4.5:1.
- Links: ONE pinned `--link` pair site-wide (landing and docs surfaces alike — no per-surface wobble): `#65a0ff` on dark (7.6:1), `#0066cc` on light (5.6:1), both AA and enumerated in the G2 fixture alongside the accent pairs.
- Type: root 18px; h1 1.875rem / h2 1.5rem / h3 1.25rem; line-height 1.5; weights 500/600/800; dense mono labels 0.75rem uppercase with letter-spacing.
- Spacing: 0.25–1rem micro, 2–3rem between sections; max content width ~72rem landing / ~48rem docs prose.

### Failure handling

- **Astro build fails** → `npm run build -w @seolite/site` exits non-zero → upload-pages-artifact never runs (ci-deploy orders steps build-then-upload) → no deploy. Bad pages cannot ship.
- **Any gate fails** (`check` red) → per-branch CI red → merge blocked per I9; the failing test names the file + reason (e.g. broken internal anchor, unlocked `seolite_*` token, unsafe string, axe violation).
- **Pagefind index empty** (e.g. a layout change silently unsets `data-pagefind-body`) → G8 fails: entry JSON missing or index bytes below floor. Search cannot die quietly.
- **Pagefind binary missing/broken** → build fails fast: `pagefind` is a pinned devDependency invoked as a local bin, not a network fetch at build time.
- **Content drift vs packages** (rule IDs, new providers) → G7 catches tool/command/route drift; rule-ID and provider-list drift is reconciled at the P5 rebase/merge (BA-6) and by content review — recorded limitation, not silence.
- **Theme toggle JS fails** → site degrades to pure-CSS OS-preference theming; all content readable without JS (progressive enhancement by construction).
- **External link rot** → not gated (determinism, BA-10); accepted trade-off, revisitable later as a scheduled non-blocking job.

### Blast radius

- `site/` is a leaf: zero runtime imports from `packages/*`; site CI failures block only site merge + Pages deploys, never package releases or CLI/MCP work.
- The deploy contract is two strings (command + output dir). If the SSG ever changes, only `site/` internals and those two strings change — ci-deploy's workflow is untouched as long as the contract holds.
- Base-path (`/seolite`) is localized to `astro.config.mjs` + one `<base>`-consistent link helper; a custom domain is a one-line change.
- Worst-case failure mode is honest: the site goes stale, not wrong-by-drift, because gates red before merge.

### Alternatives considered

**SSG decision (the one real fork):**

| Option | Verdict | Reasoning against the four criteria |
|---|---|---|
| **Astro (chosen)** | adopt | Zero-config static output to `dist/`; total markup/CSS control (the theme is ours, not an override of someone else's); component ergonomics (.astro scoped styles, TS) fit the tabs/modal/toggle chrome; built-in Shiki for code; content collections for docs; builds this site in seconds; Pagefind-compatible by construction (plain HTML). Zero client JS by default matches I16's spirit on our own site. |
| Eleventy | reject | Equally static and fast, full control — but the interactive chrome (accessible tabs, modal, toggle) is hand-rolled with weaker component/scoped-style ergonomics; nothing it does better here justifies the extra assembly. |
| VitePress | reject | Best out-of-box docs UX, but its design IS the default Vue theme — a pi.dev-derived custom design means overriding someone else's CSS variables, fragile across releases, and it ships a Vue runtime. Fails "theming control" hardest; its built-in search would fight Pagefind. |
| Next.js / Docusaurus / Hugo | reject | Next: runtime + overkill for static docs. Docusaurus: same theme-override problem as VitePress with React. Hugo: fast but Go templating + no component model for the chrome; team already TS-native. |

**Search:** Pagefind (chosen — research-verified static, chunked, any-HTML) vs Algolia Crawler (external service + cost + third-party requests — violates I16 ethos and zero-cost), vs lunr/fuse full-index-in-browser (single bloaty index vs Pagefind's per-query chunks), vs VitePress local search (bound to rejected SSG).

**Docs theme:** custom-from-tokens (chosen) vs Starlight/Docusaurus themes (rejected — same theme-control failure; Starlight would mean fighting its design system to look like anything else).

### Defaults (recorded; no open questions)

All BA-1..BA-13 in IMPLICIT_SPEC.md. Operationally: Astro latest stable major pinned exact at Phase 1; Pagefind `^1.5` pinned; dark-first design with `auto` default state; project-pages base `/seolite`; English-only; SVG-only figures; `@astrojs/sitemap` for the sitemap; Vitest as the single gate runner.

## Resource & Cost Analysis

- **GitHub Pages limits**: 1 GB site cap, 100 GB/mo soft bandwidth. Projected `site/dist/`: ~25–35 HTML pages (~15–40 KB each), SVG-only figures, no webfonts, ~10–15 KB total JS (theme toggle + tabs + search modal), Pagefind bundle ~0.1–0.3 MB (chunked, lazily fetched per query). Total ≈ 2–4 MB — under 0.5% of the cap; bandwidth trivial for a docs site.
- **Build minutes**: Actions is free for public repos. `astro build` + `pagefind` ≈ 15–40 s; the check suite (vitest over built files) ≈ 20–40 s; full deploy workflow ≪ 2 min. Per-PR cost negligible.
- **Dependencies added** (all OSS, zero cost): `astro` (pinned major), `@astrojs/sitemap`, `pagefind` (devDep, hermetic), `axe-core` + `jest-axe` + `jsdom` (gates), `cheerio` (link checker; already repo-standard), `vitest` (repo standard).
- **Human cost**: the bulk of effort is content (docs pages) and the gate suite; both are one-time with cheap incremental updates.
- **No recurring services**: no search SaaS, no analytics, no CMS. The site's only "backend" is GitHub's.

## Phases

### Phase 1 — SSG scaffold & Pages build contract

**Changes** (snippets of what lands; exact versions pinned at implementation):

`site/package.json` (workspace member):
```json
{
  "name": "@seolite/site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build && pagefind --site dist",
    "preview": "astro preview",
    "test": "vitest run",
    "check": "npm run build && npm run test"
  },
  "devDependencies": {
    "astro": "<pinned latest stable major>",
    "@astrojs/sitemap": "^<compat>",
    "pagefind": "^1.5"
  }
}
```

`site/astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://nitishagar.github.io',
  base: '/seolite',
  output: 'static',
  integrations: [sitemap()],
  build: { assets: 'assets' }
});
```

Output contract (recorded in `site/README.md`, consumed verbatim by ci-deploy):
```
command:  npm run build -w @seolite/site        (repo root, npm workspaces)
artifact: site/dist/  — pure static; MUST contain index.html, 404.html,
          sitemap.xml, robots.txt, pagefind/ (from Phase 5); no server output
workflow: configure-pages → npm ci → npm run build -w @seolite/site
          → upload-pages-artifact(path: site/dist) → deploy-pages
CI gate:  npm run check -w @seolite/site   (PRs + main; deploy workflow runs build only)
```

Plus: minimal `Layout.astro` shell, placeholder `index.astro`, `404.astro`, `public/robots.txt` (allow all + sitemap ref), a build-output Vitest test asserting required files exist post-build.

**Success Criteria**
- [ ] Automated: `npm run build -w @seolite/site` exits 0 and produces `site/dist/index.html`, `site/dist/404.html`, `site/dist/sitemap.xml`, `site/dist/robots.txt`
- [ ] Automated: `npm run test -w @seolite/site` passes (build-output test green; base path `/seolite/` present in built HTML asset URLs)
- [ ] Automated: `npm run check -w @seolite/site` exits 0 end-to-end
- [ ] Output contract documented in `site/README.md` (command, path, required files) — reviewed

### Phase 2 — Design tokens, theming & base chrome (I7)

**Changes**:

`site/src/styles/tokens.css` (excerpt — full file implements every pair in the G2 fixture):
```css
:root {
  --bg: #09090b; --surface: #18181b; --border: #27272a; --hover: #3f3f46;
  --text: #fafafa; --dim: #a1a1aa; --accent: #f97316;
  --link: #65a0ff;
  --badge-green: #4ade80; --badge-blue: #60a5fa;
  --badge-purple: #c084fc; --badge-amber: #fbbf24;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --radius-card: 8px; --radius-btn: 6px; --radius-code: 4px; --radius-pill: 999px;
  --root-size: 18px; --speed: 0.2s;
}
[data-theme="light"] { --bg: #ffffff; --surface: #fafafa; --border: #e4e4e7;
  --text: #18181b; --dim: #52525b; --accent: #c2410c; --link: #0066cc;
  --badge-green: #15803d; /* … 700-family set */ }
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) { /* same light token block */ }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation: none !important; }
}
```

Pre-paint theme script (inline in `Layout.astro` `<head>`):
```html
<script is:inline>
  const t = localStorage.getItem('seolite-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
</script>
```

Components: `Header.astro` (sticky nav: wordmark, Docs, Changelog, GitHub, theme toggle `<button aria-label="Theme">`), `Footer.astro` (license/attributions/changelog links + inspiration line + toggle), `SkipLink.astro` (`<a class="skip" href="#main">Skip to content</a>`), original inline-SVG wordmark. G2 contrast fixture enumerates every text pair (both themes + badges + links) and computes WCAG ratios from the parsed `tokens.css`; G1 token-conformance test asserts required variables exist in built CSS; G4 escaping scan; G3 trade-dress scan online from this phase onward.

**Success Criteria**
- [ ] Automated: `npm run test -w @seolite/site` — G1 token conformance (all required CSS variables present in built stylesheet)
- [ ] Automated: G2 contrast math — every enumerated text/background pair ≥ 4.5:1 in dark AND light themes
- [ ] Automated: G3 trade-dress scan — zero UNSAFE strings in src + built HTML; `pi.dev` only in allowlisted files
- [ ] Automated: G4 escaping scan — zero `set:html` / `is:raw` in `site/src/**`
- [ ] Automated: G5 (partial) — every built page has skip link, `lang`, single `h1`, `nav`/`main`/`footer` landmarks; jest-axe violations = 0 on built pages
- [ ] Automated: `npm run check -w @seolite/site` green

### Phase 3 — Landing page

**Changes**:

`site/src/pages/index.astro` — hero + tabs + four sections. Install tabs (ARIA tabs pattern; snippets are locked-name strings):
```
npm   : npm install -g @seolite/cli
       seolite audit https://example.com --max-pages 50
npx   : npx -y @seolite/cli audit https://example.com
mcp   : claude mcp add --transport stdio seolite -- npx -y @seolite/cli mcp
```

Sections (mono label → original title → prose → original SVG figure + `Fig. NN | caption`):
```
01 — WHY            The checks you need, none of the index you can't have
02 — PLUGGABLE      Every data source is a plugin
03 — AGENTS FIRST   Built for agents, usable by humans
04 — DATA HONESTY   If we don't know, we say so
```

Landing content test fixture `site/src/data/locked-names.json` created here (CLI commands, MCP tools, REST routes, exit codes, config keys) and G7 goes live: regex scan of built HTML for `seolite_[a-z_]+` must yield only locked tools. Copy rules: claims only what ships (free tiers, local-only audit, best-effort SERP labeled as such).

**Success Criteria**
- [ ] Automated: `npm run build -w @seolite/site` green; landing renders hero + 3 working tabs (G5 asserts ARIA tabs pattern + keyboard operability structure)
- [ ] Automated: G7 — every built `seolite_*` token ∈ locked MCP tools; install snippets match locked command strings byte-for-byte
- [ ] Automated: G5 — jest-axe 0 violations on `/`; G6 — internal links on landing resolve
- [ ] Automated: G3 still green (original copy confirmed by scan)
- [ ] Automated: `npm run check -w @seolite/site` green

### Phase 4 — Docs IA & content pages

**Changes**:

`site/src/layouts/DocsLayout.astro` — sidebar grouped TOC + "On this page" anchors + prose column:
```
Start here : Quickstart (/docs/quickstart/)
Guides     : MCP onboarding (/docs/mcp-onboarding/) · Providers & BYOK (/docs/providers-byok/) · Configuration (/docs/configuration/)
Reference  : CLI reference (/docs/cli-reference/) · Audit rules (/docs/rules-reference/) · Attributions (/docs/attributions/)
```

Content (markdown + `.astro` for chrome), all snippets from locked names:
- **quickstart** — install → first audit → exit codes (0 ok / 1 ≥ `failThreshold` / 2 config error) → `--json`.
- **mcp-onboarding** — Claude Code (`claude mcp add --transport stdio seolite -- npx -y @seolite/cli mcp`), Cursor (mcpServers JSON + deeplink format note), VS Code (`vscode:mcp/install` / `mcp.json`), universal `{"mcpServers":{"seolite":{"command":"npx","args":["-y","@seolite/cli","mcp"]}}}`; the five locked tools with `response_format` note; remote-gateway section marked "ships with Worker deploy" (BA-7); local-only audit semantics stated.
- **cli-reference** — table of the 7 locked commands + flags (`--max-pages`, `--out`, `--json`, `--domain`) + exit-code table.
- **rules-reference** — severity model, categories, `failThreshold`, rule table per audit-engine at merge (BA-6); example `Issue` JSON with escaped `evidence.snippet`; incomplete-report example labeled `incomplete: true` (I14).
- **providers-byok** — the 7 locked providers (`google-suggest`, `wikipedia-demand`, `pagespeed`, `crux`, `openpagerank`, `tranco`, `ddg-serp`) with kind labels, env var names `SEOLITE_PSI_KEY` / `SEOLITE_CRUX_KEY` / `SEOLITE_OPR_KEY`, skip-when-absent semantics, what-leaves-the-machine line each (I1/I16), gray-provider rate-limit/cache etiquette (I4: honor 429/Retry-After, cache aggressively), CrUX/Tranco attribution pointers.
- **configuration** — `seolite.config.json` example (provider selection, severity overrides, budgets, `failThreshold`, `plugins` with "Node-only" note), unknown-key error behavior (I15), timeout/backoff/typed errors (I17), robots default + override + UA + sitemap discovery + per-host rate limiting (I4), SSRF-guarded URLs (I12).
- **attributions** — Apache-2.0, CrUX CC BY 4.0 + license link, Tranco attribution, Open PageRank reference, design-inspiration note (the only page besides the footer allowed to say "pi.dev"), trademark factual-use note.

G7 extended: each locked CLI command must appear in the built CLI reference; G9 goes live (footer license link on every page + CC BY 4.0/Tranco strings on attributions).

**Success Criteria**
- [ ] Automated: all 7 docs routes build (`site/dist/docs/*/index.html` each present)
- [ ] Automated: G7 — all locked CLI commands present in CLI reference HTML; zero unlocked `seolite_*` tokens anywhere
- [ ] Automated: G9 — license link in every built page footer; attributions page contains CC BY 4.0 license URL + Tranco attribution + Apache-2.0
- [ ] Automated: G6 — every internal link + fragment across docs resolves to a built file/anchor id
- [ ] Automated: G5 — jest-axe 0 violations on all docs pages; sidebar nav = real `<a href>` list
- [ ] Automated: `npm run check -w @seolite/site` green

### Phase 5 — Static search (Pagefind + Cmd/Ctrl+K)

**Changes**:

`site/src/pages/index.astro` main content and `DocsLayout` prose column get `data-pagefind-body` (nav/sidebar chrome excluded from indexing). Build script already chains `pagefind --site dist` (Phase 1). Search component:

`site/src/components/SearchModal.astro` (vanilla JS, loaded on docs + landing):
```js
// trigger: <button aria-label="Search (Cmd+K)"> rendered in header; keydown listener:
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
});
// dialog: role="dialog" aria-modal="true", focus moved in, Escape closes + focus returns,
// input wired to the Pagefind JS API: import * as pagefind from "/pagefind/pagefind.js"; pagefind.search(q)
// results: real <a href> to page URLs; honors prefers-reduced-motion (no animation)
```

G8 goes live: `site/dist/pagefind/pagefind-entry.json` exists, `*.pf_index` chunks present, total index bytes above a documented floor.

**Success Criteria**
- [ ] Automated: `npm run build -w @seolite/site` emits `site/dist/pagefind/` with entry JSON + index chunks
- [ ] Automated: G8 — index non-empty (entry JSON present, chunk bytes ≥ floor)
- [ ] Automated: G5 — search trigger is a `<button>`; modal has `role="dialog"`/`aria-modal`; keydown handler present in built JS; Escape path exists
- [ ] Automated: docs pages carry `data-pagefind-body`; nav chrome excluded (asserted on built HTML)
- [ ] Automated: `npm run check -w @seolite/site` green

### Phase 6 — Quality gates consolidation & release hardening

**Changes**:

`site/scripts/check-links.mjs` (cheerio-based internal link/anchor checker over `site/dist/**` — used by G6 tests), final gate wiring in `site/vitest.config.ts` (jsdom environment for axe specs; node for artifact specs), `site/README.md` finalized (contract + gate inventory G1–G9 + trade-dress checklist as the standing review checklist), axe spec extended to **every** built HTML file (not sampled), meta/title/description pass across all pages (honest titles + descriptions), and a dry-run of the deploy contract: fresh `npm run build -w @seolite/site` from clean checkout, artifact shape verified against the README contract.

**Success Criteria**
- [ ] Automated: `npm run check -w @seolite/site` green from a clean checkout (build → pagefind → full G1–G9 suite)
- [ ] Automated: `npm run build -w @seolite/site` artifact matches contract: `index.html`, `404.html`, `sitemap.xml`, `robots.txt`, `pagefind/`, zero stray build inputs, no source maps shipped
- [ ] Automated: axe violations = 0 across 100% of built HTML files
- [ ] Automated: G6 — zero broken internal links/anchors across the full artifact
- [ ] Automated: every built page has unique `<title>` + `meta[name=description]`
- [ ] Trade-dress manual checklist (asset provenance, copy originality) walked and recorded in the PR description — reviewed
- [ ] Contract handoff note to ci-deploy confirmed (command + path + required files) — reviewed

## Testing Strategy

- **One runner, one gate.** Everything is Vitest: artifact specs (node) + DOM specs (jsdom). `npm run check -w @seolite/site` = build → pagefind → suite. `npm test -w @seolite/site` alone requires a prior build and fails with that exact guidance if `site/dist` is missing — no silent skips, no magic rebuilds.
- **Gate inventory**: G1 token conformance (variables exist) · G2 contrast math (WCAG ratios from parsed tokens, both themes, badges included) · G3 trade-dress strings (SAFE implemented / UNSAFE banned) · G4 escaping (`set:html`/`is:raw` ban) · G5 axe + keyboard structure (jest-axe in jsdom over all built pages; skip link, landmarks, ARIA patterns) · G6 internal links/anchors (cheerio walk of dist; external links recorded, never fetched) · G7 locked names (fixture conformance + `seolite_*` regex sweep + CLI-reference coverage) · G8 Pagefind non-empty (entry JSON + chunk floor) · G9 attribution presence (footer license link everywhere; CC BY 4.0 + Tranco on attributions; grows a per-display rule if CrUX-derived sample data ever renders outside attributions/providers-byok).
- **Determinism (I10)**: no network anywhere in the suite; no wall-clock assertions; Pagefind is a pinned local devDependency; fixtures are static files in-repo.
- **Known blind spots, stated honestly**: jsdom axe cannot measure rendered color-contrast (covered instead by G2 math) or real focus behavior in a live browser (covered by structural ARIA assertions + manual pass in Phase 6); Pagefind ranking quality is not asserted (manual smoke); rule-ID/provider-list drift vs packages is reconciled at merge, not machine-checked (BA-6).
- **CI wiring**: per-branch CI runs `npm run check -w @seolite/site` (site scope only, per ARCHITECTURE merge-order rule); deploy workflow runs `npm run build -w @seolite/site` only; full suite re-runs on `main` post-merge.

## References

- Research: `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — Seam 2 (pi.dev token VOCABULARY, trade-dress safe/unsafe `[V]`), I7/I8/I13, Seam 5 (Pages Actions flow `[V]`, 1 GB site cap `[V]`, Apache-2.0/CrUX/Tranco attribution duties `[V]`), Seam 6 (SSG + Pagefind evidence `[V]`), Implicit Spec I1–I17.
- Architecture: `thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — locked package/CLI/MCP/REST names, `site/` ownership (I13 escaping + I8 attribution display), merge order P2→P3→P4→P5.
- This bundle: `IMPLICIT_SPEC.md` (BA-1..BA-13).
- Tool docs: [Astro upgrade/docs](https://docs.astro.build/en/upgrade-astro/) (current stable major, verified 2026-08-29), [Pagefind docs](https://pagefind.app/docs/) (`pagefind --site dist` post-build indexing, static bundle, verified 2026-08-29), [pagefind on npm](https://www.npmjs.com/package/pagefind) (version pin), [jest-axe](https://github.com/nickcolley/jest-axe) (axe-core in static DOM), [GitHub Pages via Actions limits](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) (site cap), [WCAG 2.1 AA](https://www.w3.org/TR/WCAG21/) (contrast ratios used by G2).
