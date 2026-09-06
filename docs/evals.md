# AI evals — lumen

The eval gate for lumen's MCP tool contract. Framework: **evalite** 0.19.0 (pinned), running in-process against the offline testkit fixtures. Chosen after trialing promptfoo and evalite — see `docs/evals/comparison.md`; per-trial evidence in `docs/evals/*-notes.md` and `docs/evals/*-run-log.md`.

## How to run offline

```bash
npm run test:evals                      # from the repo root (runs the @lumen-seo/mcp suite)
# or directly:
npm run test:evals -w @lumen-seo/mcp
```

The suite makes zero network calls by construction (it uses `@lumen-seo/mcp/testkit` fixture providers — no live fetch seam exists in-process). Rigorous proof:

```bash
unshare -rn npm run test:evals          # network namespace with loopback only
```

The gate exits non-zero if any eval scores below 1 (`evalite run --threshold 100`).

## How to run against a live model

The suite has one judge-scored case (`judge-quality`), committed **skipped** (`evalite.skip`) because it needs a judge credential. To enable it:

```bash
EVAL_LIVE=1 OPENAI_API_KEY=<key> npx evalite run judge.live   # from packages/mcp
```

Before enabling: pin the judge provider in `packages/mcp/src/evals/judge.live.eval.ts` (model + `temperature: 0` + fixed rubric — see the file's comments). The offline gate never needs a key and never calls a model.

## How to add a case

1. Add an `evalite('<case-name>', { data, task, scorers })` block to `packages/mcp/src/evals/tool-contract.eval.ts` (or a sibling `*.eval.ts` — evalite discovers that suffix automatically).
2. `data` entries are `{ input, expected }`; `task` runs the tool through `connectClient(fixtureDeps())`; scorers return `1` (pass) or `0` (fail) — never a raw boolean (evalite requires numbers).
3. If the case asserts the tool contract's surface (names, schemas), regenerate the committed snapshot from the wire and compare with the order-insensitive `canonical()` helper already in the file:
   `tools/list` over stdio (see `docs/evals/00-repo-survey.md` for the probe) → write `packages/mcp/src/evals/snapshots/tool-list.snapshot.json`.
4. Run `npm run test:evals`. Keep case names purpose-phrased (`strict-args-unknown-rejected`, not `test7`).

## How the judge model is pinned and cached

- **Pinning**: the judge is a per-scorer provider declaration (model id + `temperature: 0` + fixed rubric text) — never a floating default.
- **Caching**: evalite stores run history and scores in its local storage (`.evalite/`, gitignored); promptfoo-style verdict caching (keyed on input/output/rubric) applies to the judge's provider calls so unchanged cases do not re-call the judge. Both are offline-safe: no cache entry ever triggers a network call by itself.

## What CI does on failure

`.github/workflows/evals.yml` runs `npm run test:evals` on every push to main and every PR. A failing eval (score below threshold) fails the job with the eval name, failing scorer, and score in the log; the skipped judge case cannot fail the job (it does not run without `EVAL_LIVE`). The gate is additive to the existing `ci.yml` test job — `npm test` remains the primary gate.
