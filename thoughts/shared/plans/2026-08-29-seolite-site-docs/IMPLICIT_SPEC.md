---
date: 2026-08-29
aspect: site-docs (P5)
bundle: thoughts/shared/plans/2026-08-29-seolite-site-docs/
inherits: thoughts/shared/research/2026-08-29-seolite-greenfield-research.md (I1–I17) + thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md (locked names/decisions)
scope: the site/ workspace — landing + docs, built to a static artifact consumed by the ci-deploy upload-pages-artifact flow
status: complete
---

# IMPLICIT SPEC — site-docs (P5)

Requirements only. Designs and tool choices live in PLAN.md. Everything here inherits the global invariants I1–I17 from the research doc and the locked decisions in ARCHITECTURE.md; this file states what they mean **for the site** plus site-local edges.

## 1. Inherited invariants and their site-docs edges

- **I1 Zero-cost defaults** — docs and site copy must accurately document BYOK-absent skip semantics ("not configured", never a crash) for every provider; no page may instruct a keyless call against an API whose docs require a key (CrUX, PSI-at-scale). No page may promise a capability that requires a paid service.
- **I2 Pluggability** — provider and AuditRule documentation must present data sources as swappable via the registry; the unknown-provider-name error (explicit message listing options) is documented behavior. The site itself is NOT a data boundary: it fetches nothing at runtime.
- **I3 Data honesty** — every example metric shown on the site carries its provenance label (`source.provider`, `source.kind`); heuristic/gray examples (autocomplete ideas, demand proxies, heuristic difficulty) are shown labeled as such. Site copy may not present a heuristic as an official number — this applies to marketing prose, not just code samples.
- **I4 Crawl etiquette** — the docs document robots.txt-respected-by-default (plus the documented override), the identifying User-Agent with contact URL, per-host rate limiting, bounded crawls, and sitemap discovery, on the configuration/rules pages.
- **I5 MCP-first parity** — the site presents every capability as MCP tool + CLI command; the REST routes are documented as an explicit subset of that surface. All tool names, command names, and route names shown are the locked ones from ARCHITECTURE.md, no others.
- **I6 Worker stays thin** — docs must state that `seolite_audit_site` / `seolite audit` are local-only capabilities (and what the remote gateway returns instead: the typed "local-only capability" error pointing at `npx @seolite/cli`). No page may imply remote crawling.
- **I7 Look derived, not copied** — the site implements its own generic dark-first theme derived from the documented pi.dev token VOCABULARY (dark zinc family, single warm accent, system font stacks, mono labels, figure captions, theme toggle, client-side static search) with ORIGINAL name, logo, and copy. No pi wordmark, favicon, taglines, section-title set, feature-toggle names, or assets. Auto/Light/Dark theming and `prefers-reduced-motion` respect are requirements, not nice-to-haves.
- **I8 License & attribution** — the site displays Apache-2.0 (license link in the footer of every page); CrUX-derived data described or displayed anywhere carries CC BY 4.0 attribution with a license link; Tranco use carries its attribution; third-party marks (Semrush, Google, Lighthouse, pi.dev, …) appear as factual references only. A dedicated attributions page exists and is linked from the footer.
- **I9 TDD gate** — every site gate and behavior named in this spec has an automated test before merge; a phase is not done until site build + site tests are green.
- **I10 Determinism** — site tests and gates run with zero live-network dependence: link checking is internal-only, accessibility checking is static-DOM based, contrast is verified mathematically from tokens. No gate may depend on wall-clock time or external service state.
- **I11 Repo hygiene** — the site deploys from `main` via Actions; site content carries the repo's public identity (license, author Nitish Agarwal); no AI co-author trailers on site commits.
- **I12 SSRF safety** — docs examples never show fetching private/loopback/link-local targets as legitimate use; the configuration page documents that user-supplied URLs pass through the guarded fetch layer (scheme allowlist + private-range refusal).
- **I13 Output safety** — any crawled/report data rendered on the Pages site (sample reports, evidence snippets, example issue JSON) must be escaped and inert; no crawled content may execute as markup on the site. The site owns escaping for what it renders, independently of the engine's own sanitization.
- **I14 Partial failure** — example reports shown in docs include an interrupted-run example labeled incomplete; docs describe the incomplete/resume semantics.
- **I15 Boundary inputs** — the configuration page documents behavior for config with unknown keys, and the boundary behaviors (non-http(s) schemes, oversized pages, malformed robots/sitemaps) are documented where users will meet them.
- **I16 Privacy / no telemetry** — the site itself sends no telemetry and loads no third-party analytics, fonts-from-third-parties, or tracking scripts; the providers page states per provider exactly what data leaves the user's machine.
- **I17 Retry & backoff** — docs describe provider timeout/backoff/typed-error-with-provider-name behavior on the configuration and providers pages.

## 2. Aspect-local requirements (site-docs edges)

- **Static artifact contract** — the build emits a fully self-contained static directory (no server, no runtime compute) at a fixed, documented path with required entry files (`index.html`, `404.html`, sitemap, robots); the ci-deploy aspect consumes exactly this command + path contract. The workflow file itself is NOT owned here.
- **Page set (minimum)** — landing (hero with install-box tabs: npm / npx / `claude mcp add`; sections covering why seolite, pluggable providers, MCP-first, data honesty; footer with license + attributions) and docs: quickstart, MCP onboarding (Claude Code / Cursor / VS Code / universal `mcpServers` JSON snippets), CLI reference, audit-rules reference, providers + BYOK setup (including env var NAMES), configuration, attributions. A CHANGELOG link ships in nav/footer.
- **Locked names only** — every code snippet and tool/command/route reference on the site is generated from the locked names in ARCHITECTURE.md (`seolite` CLI commands, `seolite_*` MCP tools, `@seolite/cli` / `@seolite/mcp` package names, `seolite.config.json`, `failThreshold`, `plugins`, REST routes). Nothing else may be presented as the tool's contract.
- **Search** — client-side static search over the built HTML, triggered by keyboard (Cmd/Ctrl+K) and usable via mouse; index is built post-build and ships inside the artifact; no search service, no external requests at query time.
- **Accessibility (audit invariant)** — WCAG AA contrast (text pairs in both themes), full keyboard navigation (skip link, visible focus, reachable/operable tabs and modal), landmarks and document structure (lang, single h1, nav/main/footer), automated audit run against the built pages on every gate.
- **Theme behavior** — Auto/Light/Dark with Auto honoring the OS preference, no flash of wrong theme, and a readable site with JavaScript disabled (theming and all content degrade gracefully).
- **Trade-dress gate** — a build-gate checklist separating pi.dev-derived SAFE tokens from UNSAFE distinctive assets, enforced by an automated string/content scan plus a review checklist; the site must pass it before merge.
- **Honest copy tone** — plain, lightly wry, original; the site describes the tool it actually ships (free-tier boundaries, local-only audit, best-effort SERP) rather than the Semrush-class product it is not.
- **Not an npm package** — `site/` is a workspace project, never published; it has zero runtime imports from `packages/*`.

## 3. Bounding assumptions (recorded defaults; no open questions)

- BA-1: Site deploys as a GitHub Pages **project site** under `https://nitishagar.github.io/seolite/`; all URLs carry the `/seolite` base path. A custom domain later is a one-line config change.
- BA-2: SSG is Astro (latest stable major at Phase 1 scaffold time, pinned exact in `site/package.json`); the SSG decision rationale with rejected alternatives is in PLAN.md.
- BA-3: Search is Pagefind (pinned devDependency, hermetic build — no npx-fetch-at-build); the ⌘K modal is a small custom component on the Pagefind JS API, not the default UI.
- BA-4: BYOK env var names documented as `SEOLITE_PSI_KEY`, `SEOLITE_CRUX_KEY`, `SEOLITE_OPR_KEY` (scheme `SEOLITE_<PROVIDER>_KEY`), coordinated with the providers aspect at merge since docs merge last (P5 is final in the P2→P3→P4→P5 order).
- BA-5: MCP stdio onboarding uses the locked CLI command: `claude mcp add --transport stdio seolite -- npx -y @seolite/cli mcp` (no separate `@seolite/mcp` bin is documented in v1).
- BA-6: Audit-rule IDs documented on the rules reference page are those shipped by the audit-engine aspect at P5 merge time; only severity model, categories, and `failThreshold` semantics are treated as contract, and no automated cross-check against `packages/audit` exists in v1 (zero runtime deps rule).
- BA-7: The remote-MCP/Worker documentation ships as a short "remote gateway" section marked available-with-Worker-deploy (per research: Worker is deployable-but-not-deployed until credentials exist); stdio is documented as the primary path.
- BA-8: `CHANGELOG.md` lives at repo root (owned by scaffold/repo conventions); the site links to it on GitHub rather than rendering it.
- BA-9: Accessibility auditing runs axe-core in a static DOM (jsdom) against built HTML; the color-contrast rule is inherently incomplete there and is instead guaranteed by a deterministic contrast-math test over the final token pairs. Browser-rendered audits are out of scope for v1.
- BA-10: External (off-site) links are recorded but not fetched by any gate (determinism); only internal links and anchors are validated.
- BA-11: No analytics, no A/B anything, no client framework runtime, no web fonts, no MDX on the site — three small vanilla-JS behaviors maximum (theme toggle, install tabs, search modal).
- BA-12: Site content is English-only in v1 (no i18n infrastructure).
- BA-13: Figures on the site are original inline SVG diagrams authored in-repo; no screenshots of third-party products are used on v1 pages.
