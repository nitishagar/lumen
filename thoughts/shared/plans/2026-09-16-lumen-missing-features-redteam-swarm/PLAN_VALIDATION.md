<!-- SIGNPOST | 3/5: PLAN_VALIDATION | adversarial review of PLAN.md against IMPLICIT_SPEC.md + code | Prev: PLAN.md | Next: implement+review -->
# PLAN_VALIDATION — lumen missing-features + red-team swarm plan (round 2)

Review posture: adversarial. Every item defaults to FAIL until the plan earns PASS with code evidence. "Looks reasonable" is not evidence. Scale for this plan: **medium** (full Design Analysis required).

## Round-1 history (preserved)

Round-1 validation returned **VERDICT: MAJOR-FAIL** with F-1 duplicate-content pipeline missing (structural), F-2 report-only holes (throw-vs-score + CI `continue-on-error`), F-3 scoreboard primitive wrong (temp-rename for append), F-4 history callers/admission + count-18 enumeration missing (structural), F-5 fault layers/judge gaps (wrong layer + closed allowlist + missing retry/BYOK-literal/canonicalization), F-6 TBD/prescription bundle (MINOR). This round-2 review re-derives everything against the tree and verifies each claimed fix is real, not prose. Where round-2 left localized gaps, this validator fixed `PLAN.md` directly (MINOR-FAIL procedure) — see Findings M-1–M-8 and the edit history of `PLAN.md`.

Inputs read fully, no offset: `IMPLICIT_SPEC.md` (52 lines), `PLAN.md` revision 2 as amended by this review (162 lines), research `2026-09-16-lumen-feature-inventory-missing.md` (221 lines), prior `PLAN_VALIDATION.md` round-1 (138 lines, for F-1–F-6 claims to check). Load-bearing code re-read: `packages/audit/src/crawl/crawler.ts` (326, full), `packages/audit/src/types.ts` (174, full), `packages/audit/src/crawl/body-reader.ts` (53, full), `packages/audit/src/rules/meta.ts` (158, full), `packages/audit/src/rules/links.ts` (84, full), `packages/audit/src/rules/rule-set.ts` (113, full), `packages/audit/src/rules/rule-set.test.ts` (198, full), `packages/audit/src/config.ts` (64, full), `packages/core/src/history.ts` (25, full), `packages/core/src/config.ts` (239, full), `packages/core/src/gate.ts` (36, full), `packages/core/src/index.ts` (95, full), `packages/cli/src/args.ts` (154, full), `packages/cli/src/cmd/rank.ts` (74, full), `packages/cli/src/validate.ts` (29, full), `packages/cli/src/cli-config.ts` (41, full), `packages/cli/src/history/jsonl-store.ts` (145, full), `packages/cli/src/write-atomic.ts` (20, full), `packages/cli/src/composition/node.ts` (105, full), `packages/providers/src/redact.ts` (19, full), `packages/mcp/src/server.ts` (442, full), `packages/mcp/src/testkit/index.ts` (146, full), `packages/mcp/src/testkit/providers.ts` (96, full), `packages/mcp/package.json` (43, full), `packages/mcp/scripts/check-size.mjs` (22, full), `docs/evals.md` (45, full), `.gitignore` (19, full), `.github/workflows/evals.yml` (23, full), `site/src/data/locked-names.json` (69, full). Plus grep-verified caller sets (history, domainDir, write-atomic, redactUrl), count-18 sites, and evalite 0.19.0 `dist/run-evalite.js`, `dist/evalite.js:181` (`it.concurrent`), `dist/reporter/EvaliteRunner.js` (`handleTestSummary`), `dist/command.js`, `dist/reporter.js`.

## 0. File:line claim verification (load-bearing, incl. NEW claims)

| PLAN.md claim | Code truth | Verdict |
|---|---|---|
| `CrawledPage` no body/hash, `CrawlIndexEntry` `{url,status,depth,hops,finalUrl}` only (`crawler.ts:39-54`, `types.ts:49-57`) | `crawler.ts:39-54` is `CrawledPage` without body/hash (verified); `types.ts:49-57` is `CrawlIndexEntry` five fields (file has 174 lines; entry is 49-57, plan now says 49-57 — corrected from 48-58) | PASS |
| Bodies read capped (`crawler.ts:204` via `config.maxBodyBytes`, default `DEFAULT_MAX_BODY_BYTES` at `audit/config.ts:14`, wired `:61`) | `crawler.ts:204` is `readBodyCapped(res, config.maxBodyBytes)` exact; `audit/config.ts:14` is `DEFAULT_MAX_BODY_BYTES = 2_000_000`, `:61` wires `config.maxBodyBytes ?? DEFAULT` | PASS (plan corrected the old `:61`-only citation) |
| Skipped pages carry `{reason}` and never enter index (`crawler.ts:296-315`, `status === null` skip) | `markSkip` builds `{reason}` (`:115-129`); index build `:296-306` does `if (page.status === null) continue` — oversize/non-html/fetch_error/robots all `status:null`, absent by construction | PASS |
| History rank-only (`core/history.ts`; `RankHistoryEntry` + `HistoryListQuery{keyword,domain,limit}` + `HistoryStore{append,list}`) | `history.ts:6-25` exact rank-only contract | PASS |
| `server.ts:49-50,304-324` (optional store, rank append + `recentHistory:10`) | `:49-50` is `history?: HistoryStore` + comment; `:304-312` is rank append, `:324` is `list({domain, limit:10})` | PASS |
| `composition/node.ts:35,89` | `:35` is `history: HistoryStore` in `CommandDeps`; `:89` is `new JsonlHistoryStore(resolveHistoryDir())` | PASS (also `:13` imports `HistoryStore`, `:21` imports `resolveHistoryDir` — immaterial omissions, plan now notes `cli-config.ts` unchanged) |
| `args.ts:45,134-139`; `cmd/rank.ts:21` | `:45` is `rank: ['keyword']`; `:134-139` exact-count enforcement; `rank.ts:21` is `validateSeed(positionals[0] ?? '', 'keyword')` | PASS |
| `rule-set.test.ts:30-33` exact-18 | `:30-33` asserts `toHaveLength(18)` + set size 18 | PASS |
| `write-atomic.ts:9-20`, cleanup `:15-16` | File is 20 lines; `:9-13` whole-file temp-rename, `:15-16` `rm(tmp,{force:true})` + rethrow; `:20` is local `basename` helper | PASS (plan corrected old `:15-20` range) |
| `redact.ts:5-19` fixed predicate, exported; `mcp/package.json:27-28` depends on providers | `redact.ts` is 19 lines (`:5` `SECRET_PARAMS`, `:8-19` `redactUrl`); `mcp/package.json:27-28` is `core` + `providers` | PASS (plan corrected old `5-21`) |
| `byok` open (`core/config.ts:197-211`), `judge` key legal | `:197-211` is `case 'byok'` with only env-name regex, no provider-name validation — `byok.judge` legal | PASS |
| `.evalite/` gitignored (`.gitignore:18-19`); eval gate single job (`.github/workflows/evals.yml:8-23`) | `:18-19` is `# evalite local storage` + `.evalite/`; `evals.yml` is 23 lines, one `evals` job, no swarm leg | PASS |
| `canonicalPresent` in `meta.ts` (count, 0→info with selector, >1→bump) | `meta.ts:91-126`: `canonicalLinks` count, `:100-110` 0→info `link[rel="canonical"]`, `:111-123` >1→bump (`info`→`warning`) | PASS |
| Count-18 sites: `rule-set.test.ts:30-33`, `rules-reference.astro:57,62,68,100`, `index.astro:58,83,276`, `audit/package.json:24`, `audit/README:3,6`, root `README:16,47,59` | Verified: test `:30-33`; rules-reference `:57,62,68,100` all "18 rules" strings; index `:58,83,276` are the three rule-count strings (other "18" hits are SVG coords, correctly excluded); `audit/package.json:24` description "18 built-in rules"; `audit/README:3,6`; root `README:16,47,59` | PASS |
| `locked-names.json` has no rule-count field | File has no `rules`/`ruleCount` key (providers, tools, commands, routes only) — rules need registry+docs+test, not locked-names | PASS |
| `jsonl-store.ts:70-99` queue + O_APPEND; `check-size.mjs:17` 1.5 MiB | `:71-75` serialized queue, `:91-99` rotation-check + single `appendFile` O_APPEND; `check-size.mjs:17` `LIMIT = 1_572_864` = 1.5×2²⁰ | PASS |
| evalite file filter + threshold-omitted report-only for scored tasks; `it.concurrent` rows | `run-evalite.js:169` `filters = opts.path ? [opts.path] : undefined` → `vitest.start(filters)`; `command.js:16-19` threshold optional; `EvaliteRunner.js:27-45` `failedTasksCount>0 → exit 1`, threshold checked only `if typeof === "number"`; `evalite.js:181` `it.concurrent(...)`; `run-evalite.js:235` `sequence.concurrent ??= true` | PASS — re-verified this round (not trusted from round-1) |
| Fixture providers stateless (no pacers/shared state) | `testkit/providers.ts:25-96`: pure deterministic fixtures, `FIXED_CLOCK`, no pacers, no shared mutable state | PASS — supports concurrency safety claim |

No load-bearing file:line claim is false in substance. Remaining nits were corrected in `PLAN.md` by this review (ranges above).

## 1. Checklist (1): every spec invariant has a named mechanism — PASS

All 17 re-checked (SSRF/robots/retry vacuous only because explicitly stated with reason):

- Offline-default → `fixtureDeps`/`fixtureRemoteDeps` only, caught→scored, no `--threshold`, `EVAL_LIVE=1`+key gate, `unshare -rn` proof. PASS.
- SSRF per-hop → vacuously preserved with reason: S4 hashes already-fetched bytes; judge calls user-chosen SDK single endpoint (or `baseUrl?` https), key in header/auth never URL, PSI pattern. PASS.
- Robots asymmetry → vacuously preserved with reason: crawl admission untouched. PASS (minimal but explicit, as required).
- Retry → judge deviation stated (POST/SDK-call, 30s/attempt, ≤2 on 429/5xx only, jitter base 500ms, Retry-After capped 30s, idempotent-body safety); fault wrapper maps closed vocabulary to taxonomy, never invents shapes. PASS.
- BYOK + no-key-no-call → `byok.judge` + module fallback `LUMEN_JUDGE_KEY`, call-time read, empty=absent → `unscored: key-absent`; writers `redactUrl`; loader rejects `redactUrl(url) !== url` loudly, no new predicate. PASS.
- Partial-failure + evidence honesty → `{pass|fail|unscored}` + `reason` + `retrievedAt`; dup only over hashed; hreflang mirrors `canonical-present`. PASS.
- Loud unknown-names → adversary ids vs locked corpus list; `--format`/`--kind`/fault vocabulary unknown fail listing valid; rule overrides via registry; judge model verbatim (nothing to reject — correct because user-supplied, not a closed vocabulary). PASS.
- Exit-gate → `createRuleRegistry` + `countIssuesAtOrAbove` untouched; scoreboard/export never feed exit codes (0/2 only). PASS.
- Clamp asymmetry → no user-tunable numeric knobs (only fixed constants, enumerated); corpus bounds are loud admission, not budgets. PASS (fixed-constants-vs-knobs distinction now explicit; see §8).
- Boundary admission → corpus admission (1MiB, slug regex, fault list, secret-free); `--history` redefined (Stage 3, incl. `--domain`/`--limit` filters + `--format` default `json` after this review's fix); `json`/`csv` + `concise`/`detailed` shape-only stated. PASS.
- Concurrency/politeness → evalite concurrent acknowledged (round-1 false sequential claim withdrawn); per-task fresh stateless `fixtureDeps`, ≤4KB O_APPEND + queue, content-addressed cache, zero live calls → GCRA vacuously safe, cancel writes nothing. PASS.
- History durability → rotation/O_APPEND/queue/truncation verbatim; rank legacy byte-identical via `domainDir(kind='rank')` default; single-gen loss per kind documented. PASS.
- Transport + worker-safe → node-side only, no new `node:`/cheerio, `check:size` re-run. PASS.
- Provenance/assessment → per-kind CSV headers now enumerated (rank `keyword,domain,position,provider,url,retrievedAt`; audit `url,score,pagesAudited,countsError,countsWarning,countsInfo,provider,retrievedAt`); audit rows `lumen-audit`; judge `{modelId, rubricVersion, retrievedAt, assessment:true}` outside measurements. PASS.

## 2. Checklist (2): retry / partial-failure / concurrency + no-leak — PASS

- Retry: judge deviation + fault mapping + new retry test in criteria (added by this review). PASS.
- Concurrency: concurrent execution owned (not hand-waved); fresh fixtures, queue+O_APPEND, idempotent cache. PASS.
- Partial-failure: first-class `unscored`, vacuous/unknown rules, crash→`fail` probe. PASS.
- No-leak: scoreboard has no temps (nothing to clean); cache temps use `write-atomic.ts:15-16` cleanup; history queue never wedges (`task.catch`); abort writes nothing partial; cross-process single-writer-per-job + O_APPEND. PASS. Locking: none new. PASS.

## 3. Checklist (3): ALL callers of changed interfaces enumerated + back-compat — PASS (after reviewer fixes)

Grep-verified history callers: `core/history.ts`, `core/index.ts:53`, `core/models.test.ts:27-28,32,339-362`, `mcp/server.ts:16,50,304-324`, `mcp/testkit/index.ts:86-96`, `mcp/concurrency.test.ts:10,18,36,64`, `cli/history/jsonl-store.ts`, `cli/history.test.ts`, `cli/rank.test.ts:5,9,65,94,129`, `cli/cancellation.test.ts:16,77,90`, `cli/keywords.test.ts:7,42`, `cli/no-telemetry.test.ts:20,56`, `cli/composition/node.ts:13,35,89`, `cli/index.ts:11`, `cli/cli-config.ts:24`, `cli/cmd/rank.ts`, `cli/cmd/config-show.ts:8,25`. Round-2 as submitted enumerated the seven test files + core/mcp/cli cores but left four localized definitions implicit; this review added them to `PLAN.md` (no design rethink, purely additive): `AuditHistoryEntry` shape + `HistoryEntry` union + kinded query, `domainDir(root, domain, kind='rank')` signature preserving every existing caller, `#listAllDomains` fan-out over `rank/`+`audit/`, `OPTIONS.rank` new flags, `--domain`/`--limit` as optional filters (default limit 20) + `--format` default `json`, `cli/index.ts:11`/`cli-config.ts` disposition, `server.ts:49-50` alongside `:304-324`. Migration rule (rank byte-identical, audit under `<root>/audit/`, rank-first resolution, kind filter default `rank`) is stated and coherent with `domainDir` default. Rank admission now defines all five behaviors (no positional + three UsageErrors + two filters + default). With these additions, enumeration is complete. PASS as amended.

## 4. Checklist (4): no correctness traded for "simpler" — PASS

O_APPEND for append vs temp-rename for whole-file is now correctly assigned; exact-hash v1 narrowing is documented with honest vacuous/unknown behavior (not a trade); single-gen loss per kind and report-only are spec-sanctioned. No trade found.

## 5. Checklist (5): no new pattern where existing fits — PASS

Scrubber reuses `redactUrl` + `redactUrl(url) !== url` loader check (no new predicate; sentinel `?key=__SENTINEL__` → `[redacted]`); corpus under `src/evals/data/` next to `golden.json`; fault wrapper mirrors `fixtureAuditRunner`; judge dynamic-import; kind-field over per-kind stores; CSV over SARIF; `node:crypto` sha256. No gratuitous pattern.

## 6. Checklist (6): no TBDs in plan, no mechanisms in spec — PASS (after reviewer fixes)

Spec has requirements only. PASS. Plan as submitted still carried localized TBDs (audit entry shape, `domainDir` signature, `--domain`/`--limit`/`--format` defaults, CSV columns, `baseUrl?`, fault vocabulary text, rubric fixed text, secret predicate); this review fixed each in `PLAN.md` (closed fault vocabulary with loud-unknown rule, `JudgeConfig.baseUrl?`, rubric v1 fixed sentence, `redactUrl`-inequality loader rule, audit union + headers + kinded `domainDir`, five `--history` behaviors). No "implementer picks" remains (verified by grep; only historical "no implementer picks" + rejected-alternative mentions). PASS as amended.

## 7. Checklist (7): success criteria verify invariants — PASS (after reviewer fix)

Stage 1 covers offline/`unshare`, fault matrix, sentinel-scrub, crash→`fail`, unknown-id, cancel-cleanliness. Stage 2 now covers key-absent matrix, cache-hit zero-calls, canonicalization, sentinel, **plus retry-deviation test** (added). Stage 3 covers kind/format admission, legacy-read, truncation/rotation per kind, provenance headers, 0/2-only exits, cross-kind ordering. Stage 4 covers fire/no-fire, override normalization, unknown-id, vacuous, oversize-exclusion, count-20, golden explicit-diff, threshold-flip manual. Testing Strategy spec-edge list now includes judge retry + five `--history` behaviors. PASS as amended.

## 8. Checklist (8): anti-pattern sweep — PASS

Needless DI: plain factories. PASS. Hand-rolled crypto: `node:crypto` sha256 over UTF-8 bytes of `body.text` (exact capped payload, no whitespace/case/tag canonicalizer) — FLAG closed. PASS. Retained state: 32B/page hashes + file cache + queue only. PASS. Dev-scale I/O: bounded corpus/rotation/append; domain-count + `.evalite/` growth named as non-failing notes in cost model. PASS. Locking: none new, primitives correct. PASS. Premature config: budget knob deleted, judge allowlist rejected; remaining numbers are fixed constants (judge 30s/≤2/500ms, corpus 1MiB/64-char, scoreboard 4KB, modelId ≤128, temperature 0), none user-tunable, no new config section (`byok.judge` is an open-map key + module fallback, `effectiveByok` untouched). The ZERO-knobs claim is therefore true under "knob = user-tunable config" and `PLAN.md` now says so explicitly. PASS.

## 9. Checklist (9): decomposition — PASS (with note)

One hard problem per stage, dependency order respected (S1 first; S2–S4 verify through S1). PASS. Phases still contain design alongside Design Analysis (file paths, schemas, `JudgeConfig`, headers, severities) — but Design Analysis is normative and Phases scope + point to it; residual duplication is a style note, not an implementability block, and does not restate spec invariants beyond behavior definitions. PASS with note (not failed).

## 10. Checklist (10): Scale Cost Model recompute — PASS

Recomputed from plan weights: fixture calls ~50ms + ≤250ms injected → 50 calls 2.5–15s (plan "3–15s" ✓), 400 calls 20–120s ("20s–2min" ✓), 1500 calls 75–450s ("2–7min", 450s = 7.5min ≈) — linear in corpus (30× cases → ~30× time). Live/quota 0/0/0 offline (judge separate, cache-bounded, `EVAL_LIVE`-gated) — flat vs quotas. Scoreboard ~300B/line → 15KB/120KB/450KB. Dup hashes 32B×≤10k = ≤320KB per audit, flat vs swarm rows. History ~2MiB/generation/kind/domain (1MiB rotation × 2 generations), linear in kinds (×2) × domains — plan states `~2MiB cap/kind/domain` correctly per kind. Weighted total seconds+KB → low-minutes+KB → minutes+<1MB: linear in workload, flat vs quotas, flat per-audit. No redesign signal. Non-failing notes named (first-live-judge cost, domain-count axis, `.evalite/` growth, `unshare -rn` as zero-network proof). PASS.

## Re-derived Design Analysis verdict (medium scale)

Medium requires invariants→mechanisms, failure/concurrency with no-leak, full caller enumeration, no simplicity-trades, no gratuitous patterns, no TBDs, invariant-verifying criteria, clean anti-pattern sweep, one-hard-problem-per-stage scoping, flat-vs-quotas cost model. As submitted, revision 2 earned PASS on 1 (after vacuity statements), 2, 4, 5, 8, 10, and near-PASS on 3/6/7 with only localized definitions missing. The missing definitions (M-1–M-8 below) required additions, not rethinking: no pipeline re-scope, no primitive swap, no layer re-split, no vendor-neutrality reversal, no knob reintroduction. Hence MINOR, not MAJOR.

## Findings (locations; each fixed in PLAN.md by this review)

- **M-1 [MINOR] `CrawledPage.bodyHash` hop missing.** Approach/Stage 4 named `CrawlIndexEntry.bodyHash?` + copy at `crawler.ts:296-315` but bodies are gone by then. Fix: compute sha256 over UTF-8 bytes of `body.text` in `processEntry` before DOM parse, store on `CrawledPage.bodyHash?` at `recordPage` (`crawler.ts:244-257`), copy at `:296-315` (`PLAN.md` Approach F-1, Design Analysis simplicity, Blast radius Stage 4, Phase 4). Given `BodyResult{text, bytes, oversized}` (`body-reader.ts:7-11`), UTF-8-bytes-of-`text` is the exact capped payload with no normalizer. No rethink.
- **M-2 [MINOR] Audit history entry shape undefined.** "Entry-kind union" without members blocks CSV/store implementation. Fix: `AuditHistoryEntry{url, score, pagesAudited, countsBySeverity, provider:'lumen-audit', retrievedAt}` + `HistoryEntry` union + kinded query (`PLAN.md` Blast radius Stage 3, Default choices, Phase 3).
- **M-3 [MINOR] `domainDir` kind signature + fan-out undefined.** Fix: `domainDir(root, domain, kind='rank')`, rank legacy default preserves callers, `#listAllDomains` over `rank/`+`audit/` sorted by `retrievedAt` (`PLAN.md` Stage 3).
- **M-4 [MINOR] `--history` `--domain`/`--limit`/`--format` defaults undefined.** Fix: `--domain`/`--limit` optional filters (`normalizeDomain`/`validateLimit`, default limit 20), `--format` default `json`, five behaviors enumerated (`PLAN.md` Approach F-4, Phase 3, Testing Strategy).
- **M-5 [MINOR] Judge endpoint + fault vocabulary + rubric/secret predicates implicit.** Fix: closed `providerFaults` vocabulary + loud-unknown rule, `JudgeConfig.baseUrl?` (SDK endpoint otherwise), rubric v1 fixed sentence, `redactUrl`-inequality loader rule + sentinel (`PLAN.md` Approach F-5/F-6, Design Analysis retry/BYOK/clamp, Phase 1/2).
- **M-6 [MINOR] Judge retry test missing from criteria.** Fix: Stage 2 criterion + Testing Strategy retry-deviation test (429/5xx ≤2, Retry-After cap, non-retryable 4xx, exhaustion shape).
- **M-7 [MINOR] File:line range precision.** Fixed: `types.ts:49-57`, `audit/config.ts:14` + `:61`, `redact.ts:5-19`, `write-atomic.ts:15-16`, `evals.yml:8-23`, `.gitignore:18-19`, `crawler.ts:244-257,296-315`, `server.ts:49-50,304-324`, `redact.ts:5-19` in References.
- **M-8 [MINOR] ZERO-knobs wording.** Fixed to "zero user-tunable numeric knobs (fixed constants only...)" wherever claimed (Approach, Design Analysis, guardrails).

Round-1 F-1–F-5 dispositions verified REAL (pipeline now present modulo M-1 hop; report-only both holes closed via caught→scored + `continue-on-error: true`; durability primitives correctly assigned; callers substantially enumerated modulo M-2–M-4; fault layers split + vendor-neutral string + `byok.judge` literal + canonicalization all present modulo M-5 wording). F-6 bundle verified REAL modulo M-5–M-8 wording. No new MAJOR introduced.

VERDICT: PASS
