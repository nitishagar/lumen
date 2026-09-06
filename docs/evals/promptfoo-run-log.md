# promptfoo trial run log — lumen (2026-09-06)

Branch: `evals/trial-promptfoo` · framework: promptfoo 0.122.2 (pinned) · suite: `evals/promptfoo.config.yaml` (9 wire-level cases) · runner: `evals/run-offline.mjs` (latency budget 15 s/case).

## 1. First green run (all cases pass)

```
Results:
  ✓ 9 passed (100%)
  0 failed (0%)
  0 errors (0%)
Duration: 1s (concurrency: 4)
[run-offline] 9 cases green; total measured latency 4250ms (budget 15000ms/case)
```

Zero-network proof — same suite inside a network namespace with loopback only:

```
$ unshare -rn npm run test:evals
Results:  ✓ 9 passed (100%) …
[run-offline] 9 cases green; total measured latency 4285ms (budget 15000ms/case)
```

Existing gate untouched: `npm test` = 880 passed (880) after building worker+site bundles exactly as CI does (the 2 baseline failures before building were `bundle-scan` requiring `dist/metafile.json` — pre-existing environment prerequisite, present on main as well).

## 2. Deliberate one-line regression (system under test)

Change: `packages/mcp/src/schemas.ts:42` — `z.strictObject({` → `z.object({` for `pageReportSchema` (weakens unknown-argument rejection at the schema layer).

```
Results:
  ✓ 8 passed (88.89%)
  ✗ 1 failed (11.11%)
  0 errors (0%)
[run-offline] promptfoo eval exited 100
```

Failure detail (from `evals/.last-run.json`):

```
FAILED CASE: strict-args-unknown-rejected: unknown argument key is rejected by name
REASON: Custom function returned false
String(output).includes("-32602") && String(output).includes("Unrecognized key") && String(output).includes("bogus_arg")
```

Failure-message quality: **good** — the case is named by its purpose; the assertion expression is shown verbatim; promptfoo's table marks the row red. The expected-vs-actual values live in the web viewer rather than the terminal line (the runner's JSON output carries the full grading result). Note: the SUT still rejected the unknown arg (handler-side `strictArgs` defense-in-depth caught it) but the wire error message changed — the eval asserts the observable contract, which is what regressed.

## 3. Revert + green again

```
$ git checkout packages/mcp/src/schemas.ts
Results:  ✓ 9 passed (100%) …
[run-offline] 9 cases green; total measured latency 4562ms (budget 15000ms/case)
```

## 4. Provider-level error probes (observed, not asserted in-config)

promptfoo records its own provider-level errors (`No tool name found in JSON payload…`, `Invalid JSON in prompt…`) with an empty `output` and the message only in the result error — an in-config assertion cannot match on it. Both behaviors were verified via probe configs and are documented here; they remain un-asserted in the offline gate (a promptfoo limitation, noted in the trial notes).
