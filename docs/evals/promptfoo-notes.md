# promptfoo trial notes — lumen (2026-09-06)

## Measured
- **Wall-clock setup time (install → first green run): ~35 min.** The bulk was config-shape discovery (the documented `- mcp:` inline shorthand does not reach `providerOptions.config`; the working shape is `id: mcp` + `config: {enabled: true, server: {command, args}}`) and probing which surfaces are offline-safe.
- **Configuration lines added:** ~95 (promptfoo.config.yaml 9 cases + live yaml + runner script ~60 lines + CI job 23 lines).
- **Eval code/data lines added:** ~130 (config assertions are data, not code).
- **Suite runtime:** ~1 s promptfoo + ~4.3 s aggregate case latency; runner total wall-clock ~8–10 s cold (node + server spawn). Well under the 2-minute budget.
- **Offline by default: YES.** Proof: suite green inside `unshare -rn` (loopback-only network namespace). Important methodological find: proxy-choke env (`HTTP(S)_PROXY`) does NOT constrain Node's undici fetch — a naive choke run would have "proved" nothing; lumen's `page_report` on a public URL really fetched example.com under choke (meta.title came back). Hence netns proof + excluding fetch-capable cases from the offline gate.
- **Failure message quality: good.** Case name (purpose-phrased) + verbatim assertion in terminal; full expected/actual in the JSON/web viewer. Not all three (case/expected/actual) in one terminal line — minor.
- **Surprises:** (1) the config-shape trap above (worth documenting — cost ~20 min); (2) `metadata.toolCalls` is only populated for chat providers with `mcp.enabled`, not the standalone mcp provider, so error-assertions match on output text; (3) provider-level errors (malformed JSON payload) surface only in the result error, unassertable in-config; (4) lumen's `rank_check` is LOCAL_ONLY-denied over this composition — a deterministic deny that makes an excellent eval; (5) lumen's defense-in-depth (zod strict + handler strictArgs) means breaking one layer still passes the other — the eval caught the *wire-contract* change, not the rejection itself.

## Survey open questions answered
1. **Does committed `PROMPTFOO_CACHE_PATH` give truly zero-network runs incl. judges?** Partially: with telemetry/update-notify env disabled and no fetch-capable cases, yes (netns-proven). Judge verdicts cache by (input, output, rubric) — replay works, but the *first* live run needs the key; the cache makes *later* runs offline for unchanged cases. Not exercised here (no key) — UNVERIFIED for judges, verified for the offline gate.
2. **Is a 9-case suite <2 min on CI?** Yes — ~10 s wall-clock; even ×10 growth fits.
3. **Do trajectory/JS assertions cover injection/denied-tool negative cases without flaky judges?** Yes for THIS server: denials are deterministic structured responses (`LOCAL_ONLY_CAPABILITY`, `INVALID_URL`, MCP `-32602`), assertable with plain JS on output. `trajectory:*` was unnecessary here (single-call deny cases), and `metadata.toolCalls` is unavailable on the standalone provider anyway.
4. **Does the mcp provider handle tools/list snapshot?** NO — the provider exposes no list-surface to assertions (its `tools:` key only *filters*, it does not verify). Tool-list + input-schema snapshots therefore moved to the evalite trial (in-process `client.listTools()`), where they are first-class.

## Rubric re-score from observation (0–3, vs docs-implied)
1. Setup 2 (config-shape trap + offline-surface discovery cost real time)
2. Runner 0 (own CLI; wired via a sibling script + CI job, as expected)
3. Offline 2 (good env gates + cache; record/replay not first-class; undici/proxy gotcha is on the user)
4. Deterministic 3 (excellent — rich no-model assertion set)
5. Judge 3 (pinned provider + temp 0 + rubricPrompt + cache; unverified live here)
6. Trajectory 1 (metadata.toolCalls unavailable on standalone mcp provider)
7. MCP 2 (drives stdio well; no list/snapshot surface)
8. Providers 3 (n/a here but provider-agnostic by design)
9. Dataset 3 (YAML in git, diffable)
10. Baseline 3 (first-party before/after Action; not exercised)
11. CI 3 (exit codes, JSON output, no account; job added)
12. Cost 3 (MIT, free)
13. Health 3 (release 2026-08-28, ~14 committers/90d)
14. Language 3 (TypeScript-first)

**Weighted total (observed): 128 / 159** (docs-claimed: 139).

## Biggest risk of picking it
Evals live outside the vitest gate — keeping the suite in CI as a separate job is manual wiring that must be maintained, and the standalone MCP provider lacks the list/snapshot surface that lumen's contract most wants.
