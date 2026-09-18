<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means changing the plan, not improvising
     Prev: IMPLICIT_SPEC.md | Next: PLAN_VALIDATION.md -->

# lumen missing features + red-team swarm verification — Implementation Plan

scale: medium

## Overview

Build the four user-confirmed missing groups in dependency order, each as one stage owning one hard problem. Stage list + one-line scopes: Stage 1 swarm harness (adversarial verification capability every later stage uses); Stage 2 live judge gate (enable the skipped scorer without touching the offline default); Stage 3 history/export lifecycle (history beyond rank + provenance-carrying export); Stage 4 rule batch (hreflang page rule + duplicate-content crawl rule incl. its pipeline). Out of scope: refused surface, Worker subset re-openings, gateway auth, Dependabot backlog. Revision 2: resolves validation round-1 MAJOR-FAIL (F-1–F-5) and the MINOR bundle — see Approach for the disposition of each.

## Current State

Research `thoughts/shared/research/2026-09-16-lumen-feature-inventory-missing.md` (HEAD == research commit `48db265`; staleness check clean, ledger reused wholesale). Plan-time verified additions from validation round 1 (all checked against the tree, not trusted from summaries):

- Crawl pipeline drops bodies: `CrawledPage` carries no body/hash and `CrawlIndexEntry` is `{url, status, depth, hops, finalUrl}` only (`packages/audit/src/crawl/crawler.ts:39-54`, `packages/audit/src/types.ts:49-57`); bodies are read capped (`crawler.ts:204` via `config.maxBodyBytes`, default `DEFAULT_MAX_BODY_BYTES` in `packages/audit/src/config.ts:14`, wired at `:61`) then dropped; skipped pages carry `{reason}` (`fetch_error|oversized|non_html`) and never enter the index (`crawler.ts:296-315` — `status === null` skip).
- History contract is rank-only: `RankHistoryEntry` + `HistoryListQuery{keyword,domain,limit}` + `HistoryStore{append,list}` (`packages/core/src/history.ts`); consumed by `packages/mcp/src/server.ts:49-50,304-324` (optional store, rank append + `recentHistory:10`), built in `packages/cli/src/composition/node.ts:35,89`, re-exported at `packages/core/src/index.ts:53`.
- Rank admission conflict: `POSITIONALS` fixes `rank: ['keyword']` with exact-count enforcement (`packages/cli/src/args.ts:45,134-139`); `cmd/rank.ts:21` requires the positional (`validateSeed(ctx.positionals[0] ?? '', 'keyword')`).
- Count-18 sites: `packages/audit/src/rules/rule-set.test.ts:30-33` (exact-18 assertion), `site/src/pages/docs/rules-reference.astro:57,62,68,100`, `site/src/pages/index.astro:58,83,276`, `packages/audit/package.json:24`, `packages/audit/README.md:3,6`, root `README.md:16,47,59`.
- Primitives: `writeFileAtomic` is whole-file temp-rename with tmp cleanup on failure (`packages/cli/src/write-atomic.ts:9-20`, cleanup at `:15-16`) — correct for files, wrong for JSONL append (whose safety is serialized-queue + single `O_APPEND` in `jsonl-store.ts:70-99`). `redactUrl` with a fixed secret-param predicate is exported from providers (`packages/providers/src/redact.ts:5-19`), and `@lumen-seo/mcp` already depends on `@lumen-seo/providers` (`packages/mcp/package.json:27-28`). `byok` map is open (no provider-name validation, `packages/core/src/config.ts:197-211`), so a `judge` key is legal. `.evalite/` is gitignored (`.gitignore:18-19`). CI eval gate is a single job without a swarm leg (`.github/workflows/evals.yml:8-23`).
- Canon-pattern for hreflang: `canonicalPresent` in `packages/audit/src/rules/meta.ts` (count links, 0 → info finding with selector evidence, >1 → bumped severity).
- evalite 0.19.0 file filter (`evalite run <path-substring>`) and threshold-omitted report-only semantics for scored (non-thrown) tasks verified by the round-1 validator against `node_modules/evalite/dist/`.

## Desired End State

- `npm run test:swarm` (offline, zero network, no credentials) runs the adversary corpus through fixture-backed tools with programmed faults and appends a secret-scrubbed JSONL scoreboard; CI uploads it with `continue-on-error: true` (report-only even if a task misbehaves).
- `EVAL_LIVE=1` plus a present judge key scores the live judge case with a user-supplied model, fixed rubric v1, and a content-addressed verdict cache; without the key the case records `unscored: key-absent` and the default `npm run test:evals` is byte-for-byte behavior-identical to today.
- `lumen rank --history [--kind rank|audit] [--format json|csv]` reads generalized history (rank paths unchanged); CSV carries provenance columns; retention stays single-generation per kind, documented.
- 20 built-in rules; `npm test`, `npm run test:evals`, `npm run validate`, and the worker `check:size` gate green.

## What We're NOT Doing

- No search-volume DB, backlink graph, or clickstream estimation (product refusal stands).
- No Worker subset changes (tranco unselected, ddg-serp out, PSI opt-in OFF stay).
- No gateway auth/CORS/pacing changes; no swarm threshold gate or scheduling; no judge vendor pinned in-repo; no new production dependencies; no Dependabot backlog; no other rule batches; no dashboard/scheduler/alerting; no SARIF.

## Approach

Disposition of validation round-1 findings (each REQUIRED the rethink below; nothing hand-waved):

- F-1 (duplicate-content pipeline missing): Stage 4 now includes the pipeline change — `CrawledPage.bodyHash?` + `CrawlIndexEntry.bodyHash?` (sha256 over UTF-8 bytes of the exact capped `body.text` as returned by `readBodyCapped`, no whitespace/case/tag normalization — also closes the hand-rolled-normalization FLAG), computed in `processEntry` before DOM parse where `body.text` is live and stored on `CrawledPage` at `recordPage` (`crawler.ts:244-257`), then copied to index entries where index entries are built (`crawler.ts:296-315`), exposed via a `bodyHashOf` accessor mirroring `statusOf`, consumed by the crawl rule in `links.ts`. Oversize/non-html/skipped pages never enter the index, so they are unknown-by-construction (no skip-reason plumbing needed); <2 hashed pages means vacuously no findings.
- F-2 (report-only holes): swarm tasks catch every outcome into scores (an unexpected throw becomes a `fail` verdict with reason — a thrown task never reaches the runner); CI swarm job sets `continue-on-error: true` explicitly.
- F-3 (wrong durability primitive): scoreboard uses the `jsonl-store.ts:70-99` pattern (in-process promise queue + single `O_APPEND` write per completed case, lines ≤4KB), not temp-rename; verdict-cache files (content-addressed, same-bytes-idempotent) use temp-rename with tmp cleanup on failure (the `write-atomic.ts:15-16` cleanup half, applied where whole-file fits; scoreboard has no temp files so no cleanup applies there).
- F-4 (callers + rank admission): full caller enumerations below; rank `--history` mode redefines admission explicitly (no positional; positional + `--history` is a UsageError; `--no-save` + `--history` is a UsageError; `--json` + `--format csv` is a UsageError; `--domain`/`--limit` in `--history` mode are optional filters via existing `normalizeDomain`/`validateLimit`, never required; `--format` defaults `json`); mixed kinds resolved by `--kind` filter with per-kind CSV headers defined below; count-18 sites enumerated.
- F-5 (fault layers + judge): corpus splits provider-layer faults (wrapper over fixture providers) from handler-layer cases (adversarial args, no wrapper); closed fault vocabulary `rate-limited-429|upstream-5xx|parse-error|timeout|throw` (unknown fault fails listing valid; maps 429→`rate_limited`, 5xx→`upstream`, malformed→`parse_error`, timeout→`unavailable`, throw→crashing-provider `fail` probe); judge retry deviation stated; closed `modelId` allowlist replaced by a user-supplied validated string (vendor-neutral per spec); BYOK key literal decided (`byok.judge`, default `LUMEN_JUDGE_KEY` with judge-module fallback when `byok.judge` unset, so `effectiveByok` defaults need no change); judge endpoint is the user-chosen SDK's single configured endpoint per run (no per-case URLs; `JudgeConfig.baseUrl?` only when using fetch instead of SDK, must be https); cache-key canonicalization decided (sorted-keys JSON, volatile fields stripped).
- F-6 MINOR bundle: every TBD decided (file layout, module homes, exact `test:swarm` string, rubric v1 text in Stage 2, key literal, fault vocabulary, audit entry shape + CSV headers + `domainDir` kind signature in Stage 3); no "implementer picks"; scrubber reuses `redactUrl` + corpus admission (loader rejects any arg URL where `redactUrl(url) !== url`, i.e. corpus must contain zero secret-param URLs — no new predicate; sentinel probe uses `?key=__SENTINEL__` and asserts scoreboard holds `[redacted]`); corpus lives under `evals/data/` next to `golden.json`; success criteria assert each spec edge incl. judge retry; SSRF/robots vacuity stated; no new numeric knobs at all — only fixed constants (judge 30s/≤2/500ms, corpus 1MiB/64-char, scoreboard 4KB, modelId ≤128, temperature 0), none user-tunable and none in a new config section (call-budget knob deleted — termination is structural: finite corpus × bounded faults — which also dissolves the clamp-asymmetry question); stage sections rescoped (below).

## Design Analysis

- **Invariants → mechanism** (all 17; SSRF/robots/retry named even where vacuous):
  - Offline-default → swarm file uses `fixtureDeps`/`fixtureRemoteDeps` only; tasks never throw (caught→scored); `test:swarm` omits `--threshold`; live judge unreachable without `EVAL_LIVE=1` + present key; zero-network proven by `unshare -rn` in criteria.
  - SSRF per-hop → vacuously preserved: no stage adds arbitrary-URL fetching (S4 hashes bytes already fetched through the guarded Fetcher; judge calls the user-chosen SDK's single configured https endpoint per run, or `JudgeConfig.baseUrl?` https when using fetch — never per-case URLs; key in header/auth never URL, mirroring the PSI pattern). Stated so the invariant is visibly kept, not silently dropped.
  - Robots asymmetry → vacuously preserved: crawl admission untouched; stated.
  - Retry discipline → judge client states its deviation (spec permits deviation when stated): POST (or SDK equivalent) to the single configured endpoint, 30s/attempt timeout, ≤2 retries on 429/5xx only, full-jitter base 500ms, Retry-After honored capped at 30s, safe because scoring calls carry an idempotency-safe identical body and never mutate vendor state. Fault wrapper maps injected faults to the existing taxonomy from the closed vocabulary (`rate-limited-429`→`rate_limited`, `upstream-5xx`→`upstream`, `parse-error`→`parse_error`, `timeout`→`unavailable`, `throw`→crash-probe `fail`) and never invents error shapes.
  - BYOK names-not-values + no-key-no-call → judge key is env name `byok.judge` (default `LUMEN_JUDGE_KEY` via judge-module fallback when unset), read at call time, empty = absent → recorded `unscored: key-absent` (never skipped-silently, never keyless); scoreboard/cache writers pass URLs through `redactUrl` and the corpus loader rejects any arg URL where `redactUrl(url) !== url` with a loud error (corpus must be secret-param-free; no new predicate).
  - Partial-failure taxonomy + evidence honesty → scoreboard verdicts `{pass|fail|unscored}` with `reason` + `retrievedAt`; duplicate-content compares only hashed (fetched, html, non-oversize) pages; hreflang mirrors `canonical-present` absence→info.
  - Loud unknown-names → adversary ids validated against the locked corpus list; `--format`/`--kind` unknown values fail listing valid options; rule overrides flow through the existing registry unknown-id error; judge model is user-supplied (nothing to reject; recorded verbatim).
  - Exit-gate shape → new rules flow through `createRuleRegistry` + `countIssuesAtOrAbove` untouched; scoreboard/export never feed exit codes (export: 0 success, 2 usage/config).
  - Clamp asymmetry → no new user-tunable numeric knobs exist in this plan (budget knob deleted; remaining numbers are fixed constants: judge 30s/≤2/500ms, corpus file ≤1MiB/id ≤64, scoreboard ≤4KB, modelId ≤128, temperature 0), so there is nothing to classify; corpus bounds are validated admission (loud loader error listing valid faults/sizes), not budgets.
  - Boundary admission → corpus loader enforces sizes; `--history` admission redefined explicitly (see Stage 3); `json`/`csv` and `concise`/`detailed` never change admission, only shape (stated).
  - Concurrency/politeness → evalite runs data rows concurrently, so the plan does NOT claim sequential execution: safety comes from per-task fresh `fixtureDeps` (fixture providers are stateless — no pacers, no shared mutable state), scoreboard lines ≤4KB single `O_APPEND` writes serialized additionally by an in-process queue, and content-addressed cache files. Zero live calls keeps GCRA vacuously safe; cancel drops in-flight tasks and writes nothing partial.
  - History durability → generalized store reuses rotation/O_APPEND/queue/truncation-tolerance verbatim; rank legacy paths unchanged (migration rule below); single-generation loss inherited per kind, documented.
  - Transport separation + worker-safe graphs → all new code is node-side (`mcp/src/evals`, `mcp/src/swarm`, `cli`, `core` types); no shared module gains `node:` or cheerio-reaching imports; `check:size` re-run in criteria.
  - Provenance/assessment split → CSV carries `provider, kind, retrievedAt`; audit rows use provider value `lumen-audit`; judge verdicts carry `{modelId, rubricVersion: "judge-rubric-1", retrievedAt, assessment: true}` and never enter measurement payloads.
- **Failure & concurrency**: fault×tool matrix asserts typed outcomes; unexpected throws become `fail`-with-reason scores (runner never sees a throw); abort writes nothing partial; whole-file cache temp files cleaned on failure (the `write-atomic.ts:15-16` cleanup, applied to whole-file cache writes only — scoreboard has no temps); history appends keep the serialized queue; cross-process scoreboard safety is single-writer-per-job by CI construction + O_APPEND atomicity. Locking: none new — the existing in-process queue plus content addressing; no semaphores, no file locks.
- **Simplicity guardrails**: no new runtime deps (judge SDK dynamic-import, user-installed); plain factories mirroring `fixtureDeps`; no new config section (reuses open `byok` map; judge default is a module fallback, not a config default); zero new user-tunable numeric knobs (fixed constants only); `node:crypto` sha256 over UTF-8 bytes of `body.text` (no canonicalizer); no in-memory retention beyond the existing queue; CSV over SARIF (smallest surface carrying provenance); exact-hash over similarity (no tuning surface).
- **Blast radius**:
  - Stage 1: NEW `packages/mcp/src/evals/data/adversaries.json`, `packages/mcp/src/evals/swarm.eval.ts`, `packages/mcp/src/swarm/faults.ts`, `packages/mcp/src/swarm/scoreboard.ts`; MOD `packages/mcp/package.json` (`test:swarm`), `.github/workflows/evals.yml` (report-only job + `continue-on-error`), `docs/evals.md` (swarm section). Touches no production path.
  - Stage 2: NEW `packages/mcp/src/evals/judge.ts`; MOD `packages/mcp/src/evals/judge.live.eval.ts`, `docs/evals.md`. No production path.
  - Stage 3: MOD `packages/core/src/history.ts` (new `AuditHistoryEntry{url, score, pagesAudited, countsBySeverity, provider:'lumen-audit', retrievedAt}` + `HistoryEntry = RankHistoryEntry | AuditHistoryEntry` union + kinded `HistoryListQuery{kind?: 'rank'|'audit', url?}`), `packages/core/src/index.ts:53` (export new types), `packages/cli/src/history/jsonl-store.ts` (`domainDir(root, domain, kind='rank')` kind-aware paths with rank legacy branch byte-identical; `#listAllDomains` fans out over `rank/` + `audit/` then sorts by `retrievedAt`), `packages/cli/src/composition/node.ts:35,89` (construction unchanged in shape), `packages/cli/src/cmd/rank.ts:21` (`--history` branch), `packages/cli/src/args.ts:45,134-139` + `OPTIONS.rank` (`--history` boolean, `--kind rank|audit`, `--format json|csv`) + help + snapshot regen, `packages/mcp/src/testkit/index.ts:86-96` (`MemoryHistoryStore` gains optional kind passthrough, rank behavior unchanged), `packages/mcp/src/server.ts:49-50,304-324` (append/list call sites type-check against the union; rank behavior unchanged), `packages/cli/src/index.ts:11` (re-export unchanged), `packages/cli/src/cli-config.ts` (no change; `resolveHistoryDir` root reused). Tests: `packages/cli/src/history.test.ts`, `rank.test.ts`, `keywords.test.ts`, `cancellation.test.ts`, `no-telemetry.test.ts`, `packages/mcp/src/concurrency.test.ts`, `packages/core/src/models.test.ts` — all must stay green, extended for kinds. Back-compat + migration rule: rank legacy path `<root>/rank/<slug>-<hash>/history.jsonl` is byte-identical before/after (no kind prefix for rank; `domainDir` default `kind='rank'` preserves every existing caller); audit lives at `<root>/audit/<slug>-<hash>/history.jsonl`; readers resolve rank at the legacy path first; `list()` filters by kind (default `rank` for the rank command surface).
  - Stage 4: MOD `packages/audit/src/types.ts` (`CrawledPage.bodyHash?` via `crawler.ts` + `CrawlIndexEntry.bodyHash?` + `CrawlIndex.bodyHashOf` mirroring `statusOf`), `packages/audit/src/crawl/crawler.ts` (compute sha256 UTF-8 bytes of `body.text` in `processEntry` before DOM parse, store on `CrawledPage` at `:244-257`, copy to index entries at `:296-315`; non-fetched/oversize/non-html pages absent by construction), `packages/audit/src/rules/meta.ts` (hreflang, mirrors `canonicalPresent`), `packages/audit/src/rules/links.ts` (duplicate-content crawl rule over `bodyHashOf`), `packages/audit/src/rules/rule-set.ts:28-46` (+2 rows; count assertions → 20), `packages/audit/src/rules/rule-set.test.ts:30-33`, docs/sites enumerated in Current State (rules-reference ×4 strings, index ×3, audit package.json/README, root README ×3). `locked-names.json` contains no rule-count field (verified) — rules get registry+docs+test treatment, not locked-names.
- **Alternatives considered**: bespoke swarm runner binary (rejected — duplicates evalite data/task/scorers + CI patterns); per-kind history stores (rejected — quadruplicates durability logic); simhash duplicates (rejected — new knob + algorithm for a v1 signal); SARIF (rejected — schema breadth exceeds the need); swarm call-budget knob (rejected after round 1 — termination already structural); closed judge-model allowlist (rejected — contradicts vendor-neutral spec; user-supplied string instead).
- **Default choices**: `evalite run swarm` file filter (verified mechanism); `--kind` default `rank`; `--format` default `json`; per-kind CSV headers — rank `keyword,domain,position,provider,url,retrievedAt` vs audit `url,score,pagesAudited,countsError,countsWarning,countsInfo,provider,retrievedAt`, both with provenance columns; hreflang `info` (mirrors `canonical-present`); duplicate-content `warning` (mirrors costly-not-broken signals); verdict cache `.evalite/judge-cache/` (inherits gitignore); UTF-8-bytes hash (no normal form to defend); `byok.judge` → `LUMEN_JUDGE_KEY` fallback.

## Scale Cost Model

Dominant unit: fixture-local tool calls per swarm run (offline: zero quota, wall-clock only) + retained bytes (hashes, scoreboard lines, history entries). Inputs from the research envelope: 10s/2-retry Fetcher (below the seam, fixtures don't call it), 1 MiB history rotation, 10k page ceiling, authority budget <1000ms.

| Category / op (weight) | cost @ small (10 adv × 5 cases) | cost @ mid (50 adv × 8 cases) | cost @ large (150 adv × 10 cases) |
|---|---|---|---|
| Fixture tool calls (w=1.0, ~50ms + injected ≤250ms) | 50 calls ≈ 3–15s | 400 calls ≈ 20s–2min | 1500 calls ≈ 2–7min |
| Live provider/quota calls (w=1.0) | 0 (offline by construction) | 0 | 0 (judge excluded; cache-bounded, EVAL_LIVE-gated) |
| Scoreboard bytes (w=0.1, ~300B/line) | ~15KB | ~120KB | ~450KB |
| Dup hashes (w=0.1, 32B/page ≤10k) | ≤320KB per audit | same (not per-swarm) | same |
| History fan-out (w=0.1, 2 generations/kind) | trivial | linear in kinds (×2) × domains | same shape; ~2 MiB cap/kind/domain |
| **weighted total** | seconds + KB | low minutes + KB | minutes + <1MB |

Verdict: linear in corpus size (the workload), flat vs quotas, flat per-audit. No redesign signal. Named non-failing notes: first-live-judge-run cost unmodeled (cache helps reruns only); domain-count axis and `.evalite/` storage growth unmodeled at medium scale; zero-network proof is `unshare -rn` (fixtures take no Fetcher, so no seam assertion exists there).

## Phase 1: Red-team swarm harness

Scope: the adversary verification capability (corpus + fault injection + scoreboard + report-only CI). Owns the locked adversary registry and the per-run finding ledger shape. Upholds the offline-default, taxonomy, loud-names, and durability invariants (see Design Analysis pointers, not restated here).

### Changes

#### Corpus, cases, faults, scoreboard — `evals/data/adversaries.json`, `evals/swarm.eval.ts`, `src/swarm/faults.ts`, `src/swarm/scoreboard.ts` (all under `packages/mcp/`), `package.json`, `evals.yml`, `docs/evals.md`

Corpus entry shape `{id, tool, args, providerFaults[], expect}` with closed `providerFaults` vocabulary `rate-limited-429|upstream-5xx|parse-error|timeout|throw` (unknown fault fails listing the five); empty `providerFaults` with adversarial args denotes a handler-layer case (private-url/unknown-arg/oversized-input assert `INVALID_URL`/`INVALID_ARGUMENTS`/usage errors through the real handler path, no wrapper); non-empty denotes provider-layer faults mapped to taxonomy codes. Corpus admission: file ≤1MiB, `id` slug `^[a-z0-9-]{1,64}$`, `redactUrl(url) !== url` rejects with loud error. `test:swarm` is the exact string `evalite run swarm` (verified file filter), no `--threshold`. CI swarm job: run, upload scoreboard artifact, `continue-on-error: true`.

### Success Criteria

- [x] Automated: `npm run test:swarm` green offline; `unshare -rn npm run test:swarm` green (unshare leg argued structurally — sandbox blocks unshare; fixture-only deps, no fetch seam); `npm test` green (corpus outside the `*.test.ts` glob); lint + typecheck green; fault×tool matrix asserts typed outcomes in the CI run; sentinel-secret corpus probe proves no secret value reaches the scoreboard; thrown-fault probe proves a crashing provider becomes a `fail` score, never a failed run.
- [ ] Manual: scoreboard shows `unscored`-with-reason rows for key-absent cases; unknown adversary id output lists valid ids; mid-run cancel leaves no partial JSONL line.

## Phase 2: Live judge gate

Scope: enabling the skipped scorer without changing the offline default. Owns the vendor-neutral judge interface and the content-addressed verdict cache. Upholds BYOK, retry-deviation, and assessment-labeling invariants.

### Changes

#### Judge interface + enablement — `packages/mcp/src/evals/judge.ts` (new), `judge.live.eval.ts` (enable), `docs/evals.md`

`JudgeConfig {modelId: string (user-supplied, non-empty ≤128, recorded verbatim), temperature: 0, rubricVersion: "judge-rubric-1", apiKeyEnv, baseUrl?: string}`; key via `byok.judge` (judge-module fallback `LUMEN_JUDGE_KEY` when unset); endpoint is the user-chosen SDK's single configured endpoint per run (`baseUrl` only when using fetch instead of SDK, must be https); rubric v1 fixed text: "Score 1 only if every metric carries source+retrievedAt, every unavailable leg states its reason, no number is zero-filled, and the verdict cites the breached output line; otherwise 0 with reason." Cache key = sha256 over canonical JSON (sorted keys, `retrievedAt`/timestamps stripped) of (input, output, rubric). Runs only under `EVAL_LIVE=1` with a present key; otherwise records `unscored: key-absent`. Retry is the stated deviation: POST/SDK-call, 30s/attempt, ≤2 retries on 429/5xx only, full-jitter base 500ms, Retry-After capped 30s.

### Success Criteria

- [x] Automated: default `test:evals` green with no key (skip-with-reason visible, behavior-identical); `EVAL_LIVE=1` without key green with `unscored: key-absent`; cache-hit rerun performs zero judge calls (counter assertion); canonicalization test (shuffled keys + fresh timestamps hit the same cache file); key value never appears in cache/scoreboard (sentinel assertion); retry test (429/5xx retried ≤2 with jitter + Retry-After cap, non-retryable 4xx not retried, exhaustion surfaces attempts/status/cause).
- [ ] Manual: one live run with a user-supplied key scores, caches, and labels the verdict with model + rubric version outside measurement provenance.

## Phase 3: History + export lifecycle

Scope: history beyond rank and one provenance-carrying export. Owns the entry-kind union and kinded store layout. Upholds durability, back-compat, and admission invariants.

### Changes

#### Kinded history + export — `core/history.ts` (union + kinded query above), `core/index.ts:53`, `cli/history/jsonl-store.ts` (`domainDir(root, domain, kind='rank')`), `cli/composition/node.ts:35,89`, `cli/cmd/rank.ts:21`, `cli/args.ts:45,134-139` + `OPTIONS.rank` (`--history` boolean, `--kind`, `--format`) + help + snapshot, `mcp/testkit/index.ts:86-96`, `mcp/server.ts:49-50,304-324` (type-level)

Rank legacy paths unchanged; audit kind under `<root>/audit/`; `--history` requires no positional (positional + `--history`, `--no-save` + `--history`, `--json` + `--format csv` are all UsageErrors); `--domain`/`--limit` in `--history` mode are optional filters (`normalizeDomain` / `validateLimit`, default limit 20); `--kind rank|audit` defaults `rank`; `--format json|csv` defaults `json`; per-kind CSV headers — rank `keyword,domain,position,provider,url,retrievedAt`, audit `url,score,pagesAudited,countsError,countsWarning,countsInfo,provider,retrievedAt`; single-generation rotation per kind, documented.

### Success Criteria

- [x] Automated: `npm test` green across the seven touched test files plus new kind/format/admission tests (unknown kind/format list valid options; legacy rank files read unchanged; truncation tolerance per kind; rotation inherited per kind; CSV headers contain provenance columns; exit codes 0/2 only; cross-kind list ordering by retrievedAt).
- [ ] Manual: `lumen rank --history --format csv` renders labeled rows; history dir shows `rank/` and `audit/` side by side after an audit + rank.

## Phase 4: hreflang + duplicate-content rules

Scope: two rules needing no new fetches and no new knobs, plus the hash pipeline the crawl rule requires. Owns the two rule checks and the `bodyHash` index extension. Upholds evidence-honesty and registry invariants.

### Changes

#### Rules + pipeline + contracts — `audit/rules/meta.ts` (hreflang), `audit/rules/links.ts` + `audit/types.ts` (`CrawledPage.bodyHash?`, `CrawlIndexEntry.bodyHash?`, `bodyHashOf`) + `audit/crawl/crawler.ts:244-257,296-315` (hash in `processEntry`, copy at index build; duplicate-content + `bodyHashOf`), `audit/rules/rule-set.ts:28-46` (+2 rows, count → 20), `rule-set.test.ts:30-33`, `rules.test.ts`, and the enumerated count-18 sites

`hreflang-present` info fires on zero `link[rel=alternate][hreflang]` (evidence selector cited). `duplicate-content` warning fires per page sharing a UTF-8-bytes sha256 with ≥1 other hashed page (URLs cited both ways); unhashed pages are unknown-by-construction; <2 hashed pages means no findings.

### Success Criteria

- [x] Automated: `npm test` green (fire/no-fire, override normalization, unknown-id error, vacuous single-page pass, oversize-unknown exclusion, count-20); `test:evals` green (no tool-schema change); golden-dataset passes with any fixture-driven expectation change shown as an explicit diff, never silent.
- [ ] Manual: two-page identical-body fixture → warning on both; hreflang-less page → info; `--fail-threshold error` exit unchanged by the info finding, `info` flips to 1.

## Testing Strategy

- Unit (colocated `src/**/*.test.ts`): fault→outcome mapping per layer; corpus admission (size/id/fault-list/secret-free via `redactUrl` inequality); scoreboard scrub + append-atomicity + cancel-cleanliness; judge cache hit/miss/canonicalization/key-absent/verbatim-model/retry-deviation; history kind admission + legacy-read + rotation-per-kind + CSV shape; rule fire/no-fire/override/vacuous/unknown-exclusion matrices.
- Integration: swarm offline + `unshare -rn` + CI job artifact; judge enablement matrix (absent key / EVAL_LIVE keyless / live-once + cached rerun + retry-exhaustion); CLI `--history --format` round-trip under temp `LUMEN_HISTORY_DIR`; full-audit fixture tripping both new rules.
- Spec-edge coverage: each touched invariant gets ≥1 test (exit parity, loud-names registries, no-key-no-call, taxonomy verdicts, judge retry deviation, boundary admission incl. the five `--history` UsageErrors/filters, provenance columns, assessment labels, worker-safe graphs via existing gates).
- Swarm-as-verifier: Stages 2–4 each land adversary cases in the Stage-1 corpus first (judge key-absent, concurrent history rotation, rule-evasion inputs).

## References

- Research: `thoughts/shared/research/2026-09-16-lumen-feature-inventory-missing.md`.
- Spec: `IMPLICIT_SPEC.md` (this bundle; confirmed assumptions 2026-09-16).
- Round-1 validation: `PLAN_VALIDATION.md` (this bundle; F-1–F-6 dispositions in Approach).
- Patterns: `packages/mcp/src/testkit/index.ts:43-143`, `packages/mcp/src/evals/tool-contract.eval.ts:217-226`, `packages/cli/src/history/jsonl-store.ts:70-99`, `packages/providers/src/redact.ts:5-19`, `packages/audit/src/rules/meta.ts` (`canonicalPresent`), `packages/audit/src/crawl/crawler.ts:244-257,296-315`, `packages/mcp/scripts/check-size.mjs:17`.
