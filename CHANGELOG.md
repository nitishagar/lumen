# Changelog

All notable changes to lumen are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [Unreleased]

- **Rule pack v2 (E1.6) — 16 new rules (24 → 36 built-in rules)**: integrity rules
  (structured-data, canonical targets, sitemaps, robots, hreflang reciprocity,
  orphans, meta-refresh, security headers, twitter cards, thin content,
  opt-in external-link check) plus a third rule kind `site` (runs once per
  audit against retained robots/sitemap evidence). The plugin SPI gains the
  same `site` kind additively.
- **AI-search readiness pack (E1.7)**: `ai-crawler-access` robots matrix for a
  vendored, dated AI user-agent list (never advises a training policy),
  `llms-txt` (unproven-impact disclaimer included), `content-in-raw-html`
  heuristic, and `lumen audit --only <category|ruleId,…>`.
- `--update-baseline` now exits 0 after the write (the adopt flow's first
  command no longer fails on existing findings).

- **Google Search Console provider (E2.1)**: first-party clicks/impressions/positions
  via `lumen performance <site>` (service-account JSON PATH in
  `LUMEN_GSC_CREDENTIALS`, contents never logged), `lumen audit --with-gsc`
  traffic annotations on rule groups, and GSC-preferred `rank` (labeled
  first-party; the SERP fallback stays labeled best-effort).
- **Bing Webmaster keywords (E2.2)**: exact volumes via `LUMEN_BING_KEY`,
  labeled `scope: bing-only` — the first real volume number lumen shows.
- **`lumen indexnow submit` (E2.2)**: lumen's first write action — dry run by
  default, `--yes` to send, key file verified at `/<key>.txt` on every host
  first. CLI-only (never an MCP tool).


## [0.3.0] — 2026-09-28

Not yet released on npm: this section records what ships when the `v0.3.0`
tag is pushed (see `docs/distribution.md` for the release runbook).

### Added

- **Two new audit rules (part of the 36 built-in rules this release ships)**: `hreflang-present`
  (info) and `duplicate-content` (warning, sha256 body-hash grouping)
  ([#37](https://github.com/nitishagar/lumen/pull/37)).
- **Audit history**: kind-aware JSONL history store with
  `AuditHistoryEntry` (score, pages audited, `incomplete` + `stopReason`,
  severity counts) alongside the existing rank history
  ([#37](https://github.com/nitishagar/lumen/pull/37)).
- **`lumen rank --history` gains `--kind rank|audit` and
  `--format json|csv`** — CSV cells are formula-neutralized so spreadsheets
  never execute history rows ([#37](https://github.com/nitishagar/lumen/pull/37)).
- **Offline eval gate + red-team swarm** (dev-only, not shipped in runtime):
  14 evalite cases with a 100-score threshold, a 15-adversary swarm harness
  (report-only in CI), and a live LLM-judge gate that stays skipped unless
  deliberately enabled ([#37](https://github.com/nitishagar/lumen/pull/37)).
- **Distribution artifacts**: `server.json` for the MCP Registry
  (`io.github.nitishagar/lumen`), a `lumen.mcpb` desktop-extension bundle
  (built and attached to GitHub Releases by the release workflow), and a
  Claude Code plugin (`.claude-plugin/marketplace.json` + `plugin-lumen/`
  with the `seo-check` skill) — env-var *names* only, never key values.
- **`lumen mcp --print` gains three targets**: `mcpb`, `registry`, and
  `claude-plugin`, kept anti-drift-tested against the shipped artifact files.
- **Weekly link-integrity check** (`scripts/ci/link-check.mjs` +
  scheduled workflow): every absolute URL in the READMEs, `SECURITY.md`, and
  locked-names must resolve — scheduled/release-only, never in the per-PR
  offline gate.
- **Release-drift gate**: CI now fails when README/docs rule-count prose
  disagrees with the shipped rule registry; the release workflow asserts the
  published npm version equals the tag.

### Changed

- PR template gains a CHANGELOG `[Unreleased]` checkbox; this file keeps a
  maintained `[Unreleased]` section from now on.

## [0.2.1] — 2026-09-04

### Fixed

- **Published packages now ship compiled JavaScript** (`tsc` → `dist/` JS +
  `.d.ts`) instead of TypeScript sources. Node ≥ 22.18 refuses type-stripped
  `.ts` files under `node_modules` in every lane, which made the 0.2.0
  registry artifacts crash on install (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`)
  even though workspace/CI runs were green — they never cross the
  `node_modules` boundary. The release pipeline now compiles each workspace
  before publishing and repoints `exports` at `dist/`; the `lumen` bin runs
  the compiled entry with plain `node` (no flags), keeping the TypeScript
  lane for workspace/dev runs. 0.2.0 on npm is deprecated — use 0.2.1.
- **Publish script failure classification**: a bare 403 from `npm publish` is
  now a hard error instead of an "idempotent duplicate" — npm also answers
  403 for auth-policy failures (e.g. the 2FA/granular-token requirement),
  which previously masqueraded as success and masked the real publish blocker.

## [0.2.0] — 2026-09-03

First public, on-npm release.

### Fixed

- CI identity gate exempts the pinned dependabot co-author trailer
  ([#23](https://github.com/nitishagar/lumen/pull/23)); site terminal
  rendering, figure scale, and inline spacing corrections
  ([#24](https://github.com/nitishagar/lumen/pull/24)).
- **Packaging & launch readiness**: canonical Apache-2.0 LICENSE
  layout (fixes GitHub license detection), `SECURITY.md` now points at the
  `lumen` advisory URL and `@lumen-seo/*` package names (was the pre-rename
  `seolite` slug), root workspace renamed `seolite` → `lumen`.
- Per-package `files` allowlists and `engines` (`>=22.7`) on all published
  packages; per-package READMEs for `core`, `audit`, `cli`, `mcp`.
- README rewritten for the first public release: quickstart, MCP onboarding
  snippet, npm badge, TypeScript-source packaging note.
- `docs/screenshots/README.md` no longer lists the uncommitted
  `lumen-docs-quickstart-dark.png`.

### Added

- `CHANGELOG.md` (this file), issue templates (bug / feature), pull-request
  template, and `docs/release.md` (npm publish runbook).

### Changed

- Dependency bumps via Dependabot (`@types/node`, `actions/checkout`,
  `actions/setup-node`).

## [0.1.0] — 2026-08-30

First tagged cut. Monorepo scaffold through working end-to-end system.

### Added

- **CI gates** — commit-identity + Apache-LICENSE gate, workflow lint, ESLint,
  typecheck, scoped workspace tests ([#1](https://github.com/nitishagar/lumen/pull/1)).
- **Product renamed to lumen**; packages moved to the `@lumen-seo` scope with
  the `lumen` bin ([#9](https://github.com/nitishagar/lumen/pull/9),
  [#10](https://github.com/nitishagar/lumen/pull/10)).
- **`@lumen-seo/core`** — payload models, config loader (`failThreshold`),
  registries, hardened Fetcher (SSRF/timeout/backoff), robots, Node surface
  ([#11](https://github.com/nitishagar/lumen/pull/11)).
- **`@lumen-seo/providers`** — seven built-in data providers with GCRA pacing,
  BYOK env handling, provenance ([#13](https://github.com/nitishagar/lumen/pull/13)).
- **`@lumen-seo/audit`** — 18 built-in rules, severity scoring, report
  assembly ([#14](https://github.com/nitishagar/lumen/pull/14)).
- **`@lumen-seo/site`** — docs site with consolidated content gates
  ([#15](https://github.com/nitishagar/lumen/pull/15)).
- **CI deploys** — GitHub Pages, Cloudflare Worker, tag-driven release,
  `validate` meta-gate ([#18](https://github.com/nitishagar/lumen/pull/18)).
- **`@lumen-seo/cli` + `@lumen-seo/mcp`** — real audit + provider wiring at
  the ports seam; stdio MCP launcher ([#17](https://github.com/nitishagar/lumen/pull/17)).
- **Hardening** — integration fixes (site prerender, worker deploy config,
  scoped CI) and red-team round 1 (credential leaks, budget enforcement, gate
  activation) ([#20](https://github.com/nitishagar/lumen/pull/20),
  [#21](https://github.com/nitishagar/lumen/pull/21)).
- **Visual e2e screenshots** — live site vs design reference
  ([#22](https://github.com/nitishagar/lumen/pull/22)).

[Unreleased]: https://github.com/nitishagar/lumen/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/nitishagar/lumen/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/nitishagar/lumen/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nitishagar/lumen/releases/tag/v0.1.0
