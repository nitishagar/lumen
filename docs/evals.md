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

The judge-scored case lives in `packages/mcp/src/evals/judge.live.eval.ts` and
runs only under `EVAL_LIVE=1` with a present judge key — otherwise it is
`evalite.skip`'d and the default gate is behavior-identical to a repo without
it. No vendor is pinned: the model id is user-supplied and recorded verbatim.

```bash
EVAL_LIVE=1 LUMEN_JUDGE_KEY=<key> LUMEN_JUDGE_BASE_URL=https://<host>/v1/chat/completions \
  LUMEN_JUDGE_MODEL=<model-id> npx evalite run judge.live   # from packages/mcp
```

- `EVAL_LIVE=1` without a key stays green and records
  `unscored: key-absent` to the swarm scoreboard.
- Verdicts cache content-addressed (canonical JSON, timestamps stripped) under
  `.evalite/judge-cache/` (gitignored) — unchanged cases never re-call the
  judge. Override with `JUDGE_CACHE_DIR`.
- The rubric is pinned in `packages/mcp/src/evals/judge.ts`
  (`judge-rubric-1`, temperature 0); verdicts are labeled assessments
  (model + rubric version), never measurement provenance.
- Retry deviation (stated, not Fetcher-default): 30s/attempt, ≤2 retries on
  429/5xx and transport failures (mirroring the core Fetcher's treatment of
  network errors), full-jitter base 500ms, Retry-After capped at 30s; timeouts
  never retry (surface immediately), non-retryable 4xx surfaces as a typed
  `UpstreamError`.
- The eval gate reads the module-default env-var name `LUMEN_JUDGE_KEY`; it
  loads no user config, so custom `byok.judge` names are not honored by the
  eval (config-aware runners would resolve them — none exist yet).

The offline gate never needs a key and never calls a model.

## How to add a case

1. Add an `evalite('<case-name>', { data, task, scorers })` block to `packages/mcp/src/evals/tool-contract.eval.ts` (or a sibling `*.eval.ts` — evalite discovers that suffix automatically).
2. `data` entries are `{ input, expected }`; `task` runs the tool through `connectClient(fixtureDeps())`; scorers return `1` (pass) or `0` (fail) — never a raw boolean (evalite requires numbers).
3. If the case asserts the tool contract's surface (names, schemas), regenerate the committed snapshot from the wire and compare with the order-insensitive `canonical()` helper already in the file:
   `tools/list` over stdio (see `docs/evals/00-repo-survey.md` for the probe) → write `packages/mcp/src/evals/snapshots/tool-list.snapshot.json`.
4. Run `npm run test:evals`. Keep case names purpose-phrased (`strict-args-unknown-rejected`, not `test7`).

## How the judge model is pinned and cached

- **Pinning**: the judge is a per-scorer provider declaration (model id + `temperature: 0` + fixed rubric text) — never a floating default.
- **Caching**: evalite stores run history and scores in its local storage (`.evalite/`, gitignored). A judge-verdict cache does NOT exist yet — it is part of the live scorer implementation (cache keyed on input/output/rubric so unchanged cases never re-call the judge); until that scorer is written there is no judge call to cache. Nothing in the offline gate makes a network call.

## What CI does on failure

`.github/workflows/evals.yml` runs `npm run test:evals` on every push to main and every PR. A failing eval (score below threshold) fails the job with the eval name, failing scorer, and score in the log; the skipped judge case cannot fail the job (it does not run without `EVAL_LIVE`), and the swarm is excluded from the gate (`SWARM_SKIP=1`) — it runs in its own report-only job below. The gate is additive to the existing `ci.yml` test job — `npm test` remains the primary gate.

## Red-team swarm (report-only)

The swarm adversary suite lives beside the contract suite and reuses its
shape (`*.eval.ts` data/task/scorers), but it asserts adversarial behavior,
not the contract: programmed taxonomy faults through fixture-backed tools.

```bash
npm run test:swarm                      # offline, zero network, no credentials
unshare -rn npm run test:swarm          # prove it: loopback-only network namespace
SWARM_ONLY=psi-timeout-degrades npm run test:swarm   # run one adversary
```

- Corpus: `packages/mcp/src/evals/data/adversaries.json` (next to
  `golden.json`). Entries are `{id, tool, args, deps, providerFaults[],
  expect}`; `deps` is `full` (five-tool fixtures) or `remote` (the Worker's
  local-only shape); `providerFaults` uses the closed vocabulary
  `rate-limited-429|upstream-5xx|parse-error|timeout|throw` (empty means a
  handler-layer case — adversarial args, no wrapper). Corpus admission is
  loud: oversize file, bad id, unknown tool/fault, or any secret-bearing arg
  URL fails the run before any case executes.
- Faults: `packages/mcp/src/swarm/faults.ts` wraps fixture providers with
  the same typed errors real providers throw; injected latency is bounded
  0..250ms. Scores: `packages/mcp/src/evals/swarm.eval.ts` catches every
  outcome into `{pass|fail|unscored, reason}` — a crashing provider becomes a
  `fail` score, never a failed run.
- Scoreboard: every completed case appends one secret-scrubbed JSONL line
  (single O_APPEND write, 4KB cap) to
  `packages/mcp/.evalite/swarm-scoreboard.jsonl` (gitignored).
- Report-only: `test:swarm` omits `--threshold`, and the CI swarm job sets
  `continue-on-error: true` and uploads the scoreboard artifact. Findings
  record; they never gate. A threshold gate arrives only when named.
- Gate exclusion: `swarm.eval.ts` matches the `*.eval.ts` discovery glob, so
  the default gate opts out explicitly — `test:evals` runs with
  `SWARM_SKIP=1` and the file registers as `evalite.skip` (loads no corpus,
  writes no scoreboard). The gated set stays exactly the pre-swarm 14 evals;
  adversarial findings surface only through the report-only job. Run the
  swarm directly any time: `npm run test:swarm`.
- Adding a case: append an entry to `adversaries.json` (id slug
  `^[a-z0-9-]{1,64}$`, secret-free args) and run `npm run test:swarm`.
