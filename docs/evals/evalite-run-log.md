# evalite trial run log — lumen (2026-09-06)

Branch: `evals/trial-evalite` · framework: evalite 0.19.0 (pinned, `@lumen-seo/mcp` devDep) · suite: `packages/mcp/src/evals/*.eval.ts` (7 evals, 11 data cases, + 1 skipped judge eval) · gate: `npm run test:evals -w @lumen-seo/mcp` = `evalite run --threshold 100` (any score < 1 fails).

## 1. First green run (all cases pass)

```
      Score  100%
  Threshold  100% (passed)
 Eval Files  2
      Evals  11
   Duration  154ms
```

Zero-network proof — same suite inside a network namespace with loopback only:

```
$ unshare -rn npm run test:evals
      Score  100%
  Threshold  100% (passed)
```

Existing gate unchanged: `npm test` = 880 passed (880) with evalite installed (hoisting guard passed: baseline byte-identical pass-set before/after install; no vitest peer conflict — evalite 0.19 targets `@vitest/runner ^4.0`).

## 2. Deliberate one-line regression (system under test)

Change: `packages/mcp/src/schemas.ts:58` — authoritySchema `domain: z.string().min(1).max(253)` → `max(200)` (input-schema drift invisible to behavior but a breaking wire-contract change).

```
$ git diff --stat packages/mcp/src/schemas.ts
 packages/mcp/src/schemas.ts | 2 +-
      Score  91%
  Threshold  100% (failed)
npm error command failed
```

Failing case (from exported JSON):

```
RED CASE: input-schemas-snapshot
  scorer: schemas-exactly-match-snapshot | score: 0
```

Failure-message quality: **good** — the failing eval is named, the scorer that failed is named, and the evalite export/viewer carries full expected-vs-actual JSON (the viewer shows the schema diff directly). The terminal table shows per-eval scores.

## 3. Revert + green again

```
$ git checkout packages/mcp/src/schemas.ts
      Score  100%
  Threshold  100% (passed)
```

## Notes captured during the run
- In-process `listTools()` and the wire `tools/list` emit the same schema with different key ORDER (`$schema` positioned differently) — the snapshot scorer compares with an order-insensitive canonical stringify; the raw-JSON-stringify version false-fails. This is exactly the kind of trap a snapshot eval should encode deliberately.
- The first regression attempt (a sed that touched BOTH `max(253)` occurrences) also went red; the logged cycle above is the clean single-line one.
