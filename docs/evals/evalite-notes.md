# evalite trial notes — lumen (2026-09-06)

## Measured
- **Wall-clock setup time (install → first green run): ~40 min** (install was clean; time went to API discovery from installed types, TS-strict scorer narrowing, and the key-order snapshot trap).
- **Configuration lines added:** ~10 (two package.json scripts + .gitignore entry). No config file needed — evalite discovers `**/*.eval.ts` itself and overrides vitest's include, so the package's existing vitest.config.ts is untouched.
- **Eval code/data lines added:** 657 total, measured (tool-contract.eval.ts 395, 10 evals; judge.live.eval.ts 40, skipped; snapshots/tool-list.snapshot.json 179, generated from the wire; data/golden.json 43).
- **Suite runtime:** ~0.15 s (11 data cases, in-process). Wall-clock with node startup ~2–3 s.
- **Offline by default: YES** — green under `unshare -rn`; the suite only uses testkit fixtures (no network seams exist in-process).
- **Failure message quality: good** — eval name + scorer name + score; expected/actual in the export/viewer with a real JSON diff.
- **Surprises:** (1) evalite 0.19 targets vitest 4 (`@vitest/runner ^4`) — the survey's Node/vitest-4 compatibility worry is resolved positively; (2) scorers must return a number — boolean-returning scorers throw at runtime ("must return a number"), a TS-visible but runtime-surfaced contract; (3) `evalite.skip` is the clean "written-but-skipped" mechanism for the judge case; (4) key-order sensitivity between wire and in-process SDK JSON makes order-insensitive comparison mandatory for snapshots; (5) TS strict applies to eval files (repo typecheck covers them) — `expected` is optional in scorer types and needs narrowing.

## Survey open questions answered
5. **Does evalite still run on Node ≥22 + current vitest?** YES — evalite 0.19.0 (published ~2026-04) depends on `@vitest/runner ^4.0`/`@vitest/utils ^4.0.1`, hoists cleanly next to vitest ^4.1.0, and the full 880-test root gate is byte-identical before/after. (The survey flagged "repo silence since 2026-04-28" as a staleness risk; the package is compatible.)
6. (Jointly with the sober-ai trial) — answered there.
- Also settled: snapshot capability that promptfoo lacks (tools/list + per-tool inputSchema) is first-class here via `client.listTools()`.

## Rubric re-score from observation (0–3)
1. Setup 2 (API discovery + strict-TS scorer narrowing cost time; install trivial)
2. Runner 3 (vitest-native — runs as a workspace script; watch/filter/threshold/CI flags come free)
3. Offline 3 (in-process fixtures; nothing to mock; netns-proven)
4. Deterministic 3 (plain TS scorers — the strongest determinism story of the two trials)
5. Judge 2 (mechanism exists via scorers + cache; here only written-and-skipped — no live verification without a key)
6. Trajectory 1 (single-call tool surface; no multi-turn capture in this shape)
7. MCP 2 (in-process via the SDK client; no stdio/HTTP spawn support — the wire-level view is promptfoo's strength)
8. Providers 2 (n/a for lumen; judge-provider abstraction exists)
9. Dataset 3 (data + expected are code/JSON in git, diffable)
10. Baseline 3 (run history in sqlite storage + export; score thresholds gate regressions)
11. CI 3 (`--threshold` exit-code gating; zero config)
12. Cost 3 (MIT, free)
13. Health 2 (0.19.0, last publish ~5 months ago at survey time — low cadence risk noted)
14. Language 3 (TypeScript-first)

**Weighted total (observed): 135 / 159** = Σ(score × weight) over the 14 dimensions above (weights 4,5,5,5,4,4,3,3,4,4,5,3,2,2; scale 0–3, max 159). Docs-claimed 108 — the vitest-4 concern and runner integration turned out better than the survey feared, but judge/trajectory remain unverified-without-key.

## Biggest risk of picking it
Health/cadence (single-maintainer-ish project, months between releases) and zero MCP-wire coverage — it tests the contract in-process, never the actual stdio binary a real client spawns.
