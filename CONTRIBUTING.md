# Contributing to lumen

## Requirements

- Node >= 22 (npm ships with Node; no other global tooling required)

## Setup

```bash
npm install
```

## Commands (the CI contract)

These run from the repo root; `validate` is the full local pre-push gate and
mirrors what CI enforces:

```bash
npm run validate    # typecheck && lint && test — run this before every push
npm run lint        # ESLint 9 flat config across the repo
npm run typecheck   # tsc --noEmit in every workspace that declares it
npm test            # Vitest 4 projects across all packages
```

Per-package variants (works for any `@lumen-seo/*` workspace):

```bash
npm test -w @lumen-seo/core
npm run typecheck -w @lumen-seo/core
```

## Commit & PR conventions

- **Conventional Commits**, plain messages: `feat:`, `fix:`, `chore:`,
  `docs:`, `test:` — imperative subject, optional body, no release tooling.
- **Author identity**: commits are authored as
  `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>`.
- **No AI attribution — repo policy**: do not add `Co-authored-by:` trailers
  for AI tools, `Generated with …` footers, or any other generated-by
  markers. Every commit is attributable to its human author, full stop.
- **License**: the repo root `LICENSE` must stay the canonical Apache-2.0
  text; it is checked on every push.

## CI — what runs on every push/PR (`.github/workflows/ci.yml`)

Five required checks gate every merge to `main`; the branch is protected
(pull requests required, checks must pass, branches must be up to date,
administrators included):

| Check          | What it does |
| -------------- | ------------ |
| `identity`     | Commit-identity + LICENSE gate: every **new** commit (`--base`..`--head`, never the pre-existing history) must be **authored** by `Nitish Agarwal <1592163+nitishagar@users.noreply.github.com>` (`dependabot[bot]` is the sole exception) and **committed** by Nitish, `GitHub <noreply@github.com>` (the web-flow signature GitHub stamps on squash/rebase merges it creates), or `dependabot[bot]` on dependabot-authored commits. Message bodies must contain no `Co-Authored-By:` / `Generated-*` trailers — **CI enforces the no-AI-attribution policy above**. Implemented in `scripts/ci/check-commits.mjs`. |
| `workflow-lint` | actionlint (pinned `1.7.12`) over all `.github/workflows/*` |
| `lint`         | `npm run lint` |
| `typecheck`    | `npm run typecheck` |
| `test`         | `npm test` — full suite on `main` and PRs; on branch pushes the scope is narrowed to the changed workspaces **plus their dependents** (reverse-dependency closure from `package-lock.json`, via `scripts/ci/select-workspaces.mjs`; any selection failure falls back to the full suite) |

Merges are **squash merges** with an explicit conventional subject
(`gh pr merge --squash --subject "feat: …"`). The squash commit is authored by
the merger and committed by GitHub (web-flow) — exactly the signature the
`identity` check accepts, so `main` stays green after every merge. Dependabot
(github-actions + npm ecosystems, weekly) rides the same required checks.

## License

By contributing you agree that your contributions are licensed under the
Apache-2.0 license ([LICENSE](./LICENSE), Copyright 2026 Nitish Agarwal).

Security issues: do not open a public issue — see [SECURITY.md](./SECURITY.md).
