# REASONING — seolite · scaffold-core (M0)

Running log of decisions and confusions made while implementing
`PLAN.md` (this bundle). Appended per phase; newest last.

## Phase 1 — Workspace scaffold & toolchain baseline (2026-08-29)

### DEVIATION — direct commits to `main`

- **What**: Phase 1 commits landed directly on `main` (no per-aspect branch/worktree).
- **Why**: bootstrap step of M0; branch protection does not exist yet (it is the
  ci-deploy aspect's P6a deliverable, per ARCHITECTURE.md repo conventions and
  RECONCILIATION R6). The orchestrator authorized direct-to-main for this
  scaffold phase only.
- **Bound**: this authorization covers Phase 1 of this bundle only. Once P6a
  lands bootstrap CI + protection, later phases (2–5 of this bundle) revert to
  the per-aspect worktree/branch flow of R6.

### Decisions

- **D1 Dependency version drift vs plan snapshot.** The plan verified the
  registry on 2026-08-29; by install time `typescript` latest is 7.0.2 and
  `eslint` latest is 10.9.1. The plan locks `eslint@^9` explicitly, and
  typescript-eslint 8.68 targets the TS 5.x compiler API. Chose conservative
  in-major pins: `typescript ^5.9.3`, `eslint ^9.39.5`, `@eslint/js ^9.39.5`,
  `typescript-eslint ^8.68.0`, `vitest ^4.1.0` (plan lock), `@types/node
  ^24.13.3` (matches the local runtime major, Node 24.16.0). TS 7 adoption is
  deferred until typescript-eslint declares support; not revisitable here
  without editing this file first.
- **D2 `tsconfig.base.json` extras beyond the plan excerpt.** Added
  `allowImportingTsExtensions: true` and `noEmit: true` (the excerpt is marked
  illustrative, not exhaustive). Needed so per-package `vitest.config.ts`
  files type-check their import of the shared `../../vitest.shared.ts` under
  NodeNext; safe because every M0 consumer is noEmit (BA-13: exports point at
  TS source, no build step until M2). `exactOptionalPropertyTypes` left OFF
  per the plan's default choice.
- **D3 Red-green observed, not assumed.** Smoke tests were written first; the
  red run failed for the right reason (all 5 projects: `Cannot find module
  './index.js'`) — which also proved the Vitest 4 root `projects` glob wires
  every package. After writing the barrels: 5/5 green.
- **D4 `.js` import extensions in src** per the plan's NodeNext ESM contract;
  Vitest/Vite resolves `.js` → `.ts` for TS importers (confirmed green).
- **D5 `site/package.json` kept strictly minimal** (name/version/type/engines +
  `private: true`, no scripts, no author/license fields) exactly as the plan's
  file row specifies; the five `packages/*` and the root carry
  `author`/`license` metadata per SC-16 ("package author fields set").
- **D6 `package-lock.json` committed** — the P6a CI workflow installs from it;
  committing is the deterministic choice for the CI contract.
- **D7 README badge placeholders are HTML comments**, not broken image links —
  the CI badge target (workflow file) is ci-deploy's P6a deliverable and does
  not exist yet.
- **D8 ESLint scope verified, not assumed**: `tseslint.config(...)` preset +
  `js.configs.recommended`; confirmed `.ts` files are actually linted (explicit
  file lint exits 0 with no "file ignored" warning). `thoughts/` ignored per
  the plan.
- **D9 Commit split**: `chore: scaffold npm workspaces monorepo` (tooling +
  packages + site + tests; trio green at that commit) then `chore: apache-2.0
  license + contributing stub` (LICENSE, README, CONTRIBUTING). Author verified
  via `git log --format='%an %ae'`; no co-author/generated trailers (I11).

### Confusions

- None blocking. Minor: `npm run typecheck` fan-out output is verbose and
  tail-truncation can hide which workspaces ran — verified via
  `grep '^> @seolite'` that all five packages execute `tsc --noEmit` (site
  correctly skipped by `--if-present`).
