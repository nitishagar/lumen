# Eval framework comparison — lumen (2026-09-06)

Trials on branches `evals/trial-promptfoo` (promptfoo 0.122.2) and `evals/trial-evalite` (evalite 0.19.0), both from main @ 453ed43. All runs offline-proven (`unshare -rn`), all measurements in the per-trial notes.

## Measured table

| Dimension | promptfoo | evalite |
|---|---|---|
| Setup minutes (install → first green) | ~35 | ~40 |
| Config lines | ~95 (YAML + runner + CI) | ~10 (scripts + gitignore) |
| Eval code/data lines | ~130 | ~710 (incl. 430-line wire-generated snapshot) |
| Suite runtime (wall) | ~10 s | ~2–3 s (0.15 s suite) |
| Offline by default | yes (netns-proven) | yes (netns-proven) |
| Failure message quality | good | good |
| Rubric (observed) total | **128 / 159** | **131 / 159** |

Rubric per-dimension scores with reasons are in `promptfoo-notes.md` / `evalite-notes.md`. Key observed deltas: evalite runs **inside vitest** (weight-5 dimension promptfoo scores 0 by design — separate CLI); evalite provides the tool-list + input-schema **snapshots** the case contract requires (promptfoo's MCP provider has no list surface — its `tools:` key only filters, never verifies); promptfoo drives the **real stdio binary** (wire truth) where evalite is in-process only; promptfoo has richer no-model assertion families but `metadata.toolCalls` is unavailable on its standalone MCP provider.

## Pick

**evalite.** It behaves like the unit-test suite the design note specifies: cases are ordinary TypeScript inside the existing vitest workspace (watch/filter/threshold for free, no sibling runner to maintain), the offline story is structural rather than configured (testkit fixtures — nothing to gate), and it covers the two snapshot cases that lock lumen's tool contract, all at the best observed runtime (~0.2 s). Its suite caught the deliberately introduced schema drift (`max(253)` → `max(200)`) that no other case family would see.

**Runner-up:** promptfoo — switch to it (or run it alongside) the day the eval goal shifts to black-box verification of the shipped stdio binary itself (spawn smoke, wire error messages, cross-SDK wire behavior), which is exactly the surface its `mcp` provider drives and evalite cannot reach.

## Trials stopped early

None — both trials produced green + red runs inside the time-box.

## What the final branch carries

`evals/evalite`: the cleaned in-process suite (7 evals / 11 data cases + skipped judge case), the `test:evals` scripts, the evals CI job, `docs/evals.md`, and this folder (survey, per-trial notes and run logs, comparison).
