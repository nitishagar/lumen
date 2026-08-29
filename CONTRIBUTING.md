# Contributing to seolite

> Status: stub owned by the **scaffold-core** aspect (M0, P1). CI-enforcement
> content (required checks, branch protection, merge rules) is owned by the
> **ci-deploy** aspect (P6a) and extends this file when bootstrap CI lands.

## Requirements

- Node >= 22 (npm ships with Node; no other global tooling required)

## Setup

```bash
npm install
```

## Commands (the CI contract)

These run from the repo root and are exactly what CI invokes:

```bash
npm run lint        # ESLint 9 flat config across the repo
npm run typecheck   # tsc --noEmit in every workspace that declares it
npm test            # Vitest 4 projects across all packages
```

Per-package variants (works for any `@seolite/*` workspace):

```bash
npm test -w @seolite/core
npm run typecheck -w @seolite/core
```

## Commit & PR conventions

- **Conventional Commits**, plain messages: `feat:`, `fix:`, `chore:`,
  `docs:`, `test:` — imperative subject, optional body, no release tooling.
- **Author identity**: commits are authored as
  `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`.
- **No AI attribution — repo policy**: do not add `Co-authored-by:` trailers
  for AI tools, `Generated with …` footers, or any other generated-by
  markers. Every commit is attributable to its human author, full stop.
- Branching/merge enforcement (protected `main`, required checks) is
  documented by the ci-deploy aspect (P6a); placeholder until then.

## License

By contributing you agree that your contributions are licensed under the
Apache-2.0 license ([LICENSE](./LICENSE), Copyright 2026 Nitish Agarwal).
