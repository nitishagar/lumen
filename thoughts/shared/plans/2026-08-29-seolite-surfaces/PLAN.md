---
date: 2026-08-29
aspect: surfaces
bundle: thoughts/shared/plans/2026-08-29-seolite-surfaces/
protocol: create_plan_generic_v2_5
scale: large
status: complete (rev 2 — post MINOR-FAIL validation patch; RECONCILIATION R1–R10 authoritative)
owner_packages: packages/cli (@seolite/cli), packages/mcp (@seolite/mcp incl. worker/), JSONL HistoryStore
depends_on: scaffold-core (M0, packages/core) — branch deps limited to core per ARCHITECTURE M1
merge_order: P4 in ARCHITECTURE; merges after audit-engine (P2) and providers (P3); orchestrator rebases
spec: ./IMPLICIT_SPEC.md (E1–E15, B1–B21); reconciliation: ../2026-08-29-seolite/RECONCILIATION.md (R1–R10 authoritative)
---

# seolite surfaces — PLAN (v2.5)

## SIGNPOST

This bundle turns the locked architecture's **surface contract** into two packages: `packages/cli` (bin `seolite` — 7 commands, `--json` everywhere, exit codes 0/1/2 with `failThreshold` gating, JSONL HistoryStore under `.seolite/`, terminal output encoding per I13, stdio MCP launcher) and `packages/mcp` (one `buildMcpServer` factory for the five locked tools, served over `StdioServerTransport` locally and over Cloudflare `createMcpHandler` stateless HTTP remotely, plus the thin REST subset in `worker/`). Three hard edges define done: (1) **exit codes** — a CI gate that can only emit 0/1/2 and never lies, over the closed severity vocabulary `info|warning|error` with threshold `off` and default `error` (R1/R2); (2) **transport parity** — the identical tool set on stdio and HTTP from one codebase, with typed `LOCAL_ONLY_CAPABILITY` results where the Worker must stay thin (I6); (3) **budget** — Worker bundle self-capped at 1.5 MB gzip against the platform's 3 MB, CPU-safe routes only. Everything is TDD'd with fixture providers — zero live network in this aspect's suite (I9/I10); real-provider smoke is the M2 integration gate's job. Merge position: P4 of ARCHITECTURE's M1 wave, after P2 (audit-engine) and P3 (providers) land; this branch depends only on `packages/core` until the orchestrator's rebase, and the real audit/provider adapter lands in the rebase commit (Phase 6).

## Overview

Surfaces is the product's skin: a developer runs `npx @seolite/cli audit https://example.com` in CI and gets exit 0/1/2 they can gate on; an agent connects `seolite mcp` over stdio or `https://<worker>/mcp` over Streamable HTTP and sees the same five `seolite_*` tools; a lightweight REST subset (`/api/v1/page-report`, `/api/v1/keyword-ideas`, `/healthz`) serves the slice that fits the Workers free tier. One `buildMcpServer(deps)` factory is the single source of tool truth — stdio and HTTP are composition roots, not code paths. The CLI composes the full provider set + audit engine + JSONL history; the Worker composes Worker-safe providers through the locked `createWorkerSafeProviders(config, deps)` factory (R7 — no cheerio, no audit engine, no history) and answers `audit_site`/`rank_check` with a typed local-only error pointing at the CLI. Onboarding payloads (`mcpServers` JSON, `claude mcp add` one-liner, Cursor/VS Code deep links) are built and snapshot-tested here so the site/docs aspect consumes them, never re-invents them.

## Current State

- Greenfield: repo contains research (`thoughts/shared/research/2026-08-29-seolite-greenfield-research.md`), `ARCHITECTURE.md`, and this plan set. No `packages/cli` or `packages/mcp` code exists.
- M0 (scaffold-core) is planned/landing first: `packages/core` exports the Fetcher (SSRF/timeout/backoff per I12/I17), config loader incl. `failThreshold` (unknown-key validation per I15), provider SPI + registry validation, full payload models (`KeywordIdea`, `SerpResult`, `PageSpeedReport`, `CruxRecord`, `AuthoritySignal`, `SiteAuditReport`, …), and the `HistoryStore` interface. This branch codes against those shapes and fixture implementations of them.
- Sibling branches (audit-engine P2, providers P3) are parallel; merge order P2 → P3 → P4 guarantees they exist on main before this branch's final adapter commit.
- No Cloudflare credentials exist on this machine (research-verified); the Worker ships deployable-but-not-deployed, tested fully locally via Miniflare (`@cloudflare/vitest-plugin`).

## Desired End State

- `seolite audit <url> [--max-pages N] [--out report.json] [--fail-threshold S] [--json]` — runs the bounded audit engine, prints a summary (or one JSON document), writes `--out` atomically, exits 0/1/2 per E1, labels interrupted runs `incomplete: true`.
- `seolite report <url> [--strategy mobile|desktop] [--json]` — PSI + CrUX (BYOK, skip-with-"not-configured" per I1) + local page-meta fetch, provenance on every metric.
- `seolite keywords <seed> [--limit N] [--lang L] [--json]`, `seolite authority <domain> [--json]` — fixture-clean, provenance-labeled outputs.
- `seolite rank <keyword> --domain <domain> [--limit N] [--no-save] [--json]` — SERP position check (best-effort, labeled), appends one core `RankHistoryEntry` line to `.seolite/history/rank/<slug>-<hash8>/history.jsonl` (append-only, size-rotated to `history.1.jsonl`, path-safe per I13/E4/R9).
- `seolite config show [--json]` — resolved config with env-var NAMES + `set: boolean` only (never values).
- `seolite` (bare), `seolite --help`/`-h`, `seolite <command> --help` — usage on stdout, exit 0 (E15; intercepted before strict flag validation).
- `seolite mcp` — stdio MCP server (stdout = protocol only; notes on stderr; clean shutdown: stdin close → exit 0, SIGINT → exit 2); `seolite mcp --print json|claude|cursor|vscode [--url <remote>]` — deterministic onboarding payloads.
- `packages/mcp` — `buildMcpServer` registering the five locked tools with JSON-Schema-2020-12 inputSchemas (wire contract per E7: guaranteed set asserted; strict arg rejection enforced handler-side) and concise/detailed response formats; `worker/` serving `POST /mcp` via `createMcpHandler` (stateless, per-request server), the REST subset, typed error envelope, BYOK header pass-through via the `ProviderDeps.env(name)` seam, no telemetry, bundle ≤ 1.5 MB gzip.
- All tests deterministic and green (fixture providers), including Worker tests under Miniflare, exit-code tests, history append/rotate tests, and a no-telemetry outbound-call enumeration.

Verify commands (final state):

```
npm test -w @seolite/cli            # CLI unit + exit-code + history + spawn-stdio tests
npm test -w @seolite/mcp            # MCP schema/contract + stdio round-trip + onboarding payloads
npm run test:worker -w @seolite/mcp # @cloudflare/vitest-plugin (Miniflare): POST /mcp + REST + no-telemetry
npm run check:size -w @seolite/mcp  # worker bundle gzip <= 1.5 MB (builds via wrangler dry-run first)
npm run typecheck -w @seolite/cli && npm run typecheck -w @seolite/mcp
npm run lint                        # includes I16 fetch-restriction rule
```

## What We're NOT Doing

- No HTML report rendering in the CLI (`--out` writes JSON only; HTML presentation belongs to the site aspect).
- No crawl or HTML parsing in the Worker — `audit_site` and `rank_check` are typed local-only over HTTP; `page_report` over HTTP never fetches the target URL (I6, architecture REST note).
- No OAuth, auth tokens, rate limiting, KV, Durable Objects, sessions, or server-side key storage on the Worker (authless stateless v1; B9).
- No telemetry, analytics, crash reporting, or request logging anywhere (I16).
- No SQLite history — JSONL only (locked); no multi-file locking; no cross-machine sync.
- No interactive prompts, shell completions, config wizards, or `config set` command (config is a file; `config show` is read-only).
- No `--timeout`/budget flags beyond the locked set — budgets live in config/core (B14).
- No npm publish, Pages deploy, or Worker deploy in this aspect (M2 / ci-deploy owns those).
- No live-network tests, no MCP registry submission, no Claude Desktop deep link (none exists — research).
- No `structuredContent`/`outputSchema` adoption in v1 (B2); no tool output i18n; no Windows-specific path handling beyond Node defaults.

## Approach

Dependency direction (enforced by imports; the Worker consumes the providers aspect's locked `createWorkerSafeProviders` factory over the single barrel export — R7; providers TC-REG-5 guarantees the worker-safe factory never loads cheerio):

```
packages/cli  ──▶ @seolite/mcp (buildMcpServer, onboard payloads, testkit)
      │        ──▶ @seolite/audit (runSiteAudit adapter — rebase commit), @seolite/providers (barrel — rebase commit)
      │        ──▶ @seolite/core (config, SPI types, HistoryStore{append,list}, Fetcher)
packages/mcp  ──▶ @seolite/core (server factory knows SPI types, never vendors); + @seolite/providers at rebase
  mcp/worker  ──▶ @seolite/providers barrel → createWorkerSafeProviders(config, deps) (R7; ddg-serp/cheerio absent)
                 pre-rebase: testkit fixture providers behind the identical McpDeps shape (B21)
```

Three composition roots wire one factory:

1. **Node/stdio (CLI):** `seolite mcp` → `buildMcpServer(nodeComposition())` + `StdioServerTransport`. Deps: full provider registry (barrel), `AuditRunner` (from `@seolite/audit` via `src/ports.ts`), `PageMetaFetcher`, `JsonlHistoryStore`.
2. **Worker HTTP:** per request — `buildMcpServer(mcpComposition(headers, env))` → `createMcpHandler(server)(request, env, ctx)` (documented stateless pattern, B8). Deps: `createWorkerSafeProviders(workerConfig(env), workerDeps(headers))` (R7) with per-request header keys injected through the `ProviderDeps.env(name)` seam; no audit/serp/meta/history → `audit_site`/`rank_check` return `LOCAL_ONLY_CAPABILITY`. Pre-rebase the identical `McpDeps` shape is fed by testkit fixture providers (B21).
3. **Tests:** `buildMcpServer(testComposition())` with fixture providers from `@seolite/mcp/testkit` (deterministic, zero network).

CLI shape: `bin/seolite.js` (shebang, `process.exitCode = await run(argv.slice(2))` — never `process.exit()` on success paths, so stdout flushes) → `src/args.ts` dispatcher (`node:util parseArgs`, strict) → `src/cmd/*.ts` → `src/run.ts` exit envelope. Human output goes through `src/term.ts` sanitizer (I13); JSON output is a single `JSON.stringify` document.

History: `JsonlHistoryStore implements HistoryStore` — core's locked `{append, list}` methods over `RankHistoryEntry` (scaffold-core SC-15) — append-only JSONL, in-process promise-queue mutex, size-triggered single-generation rotation to the literal `history.1.jsonl`, crash-tolerant reads (skip malformed trailing line).

Worker: `worker/index.ts` routes (`/healthz`, `/api/v1/*`, `POST /mcp`, CORS preflight), `worker/composition.ts` (per-request instances), `worker/capping-fetcher.ts` (Content-Length pre-check + streaming abort at 2.5 MB wrapping the core Fetcher), error envelope `{error:{code,message,provider?}}`.

## Design Analysis

### Invariants → mechanism

| Invariant | Mechanism on this surface |
|---|---|
| I1 zero-cost | BYOK env NAMES in config, resolved at call time (`process.env[name]` inside handlers); header keys on Worker; absent key → provider contributes an `unconfigured`/`unavailable` marker, never a keyless call to CrUX/OPR (providers own endpoint rules; surfaces own the pass-through). |
| I2 pluggability | CLI/MCP tools consume SPI interfaces; composition roots inject. Unknown provider name → registry validation error (core) surfaced as exit 2 listing available names. Tool/CLI surface never changes when providers change. |
| I3 honesty | Locked concise output shapes (E8) include `source{provider,kind}`, `estimateLabel`, `attribution[]`, `limitations[]`; unavailable fields are omitted or `{"status":"unavailable","reason":…}` — never zero. |
| I5 parity | Single `buildMcpServer`; both transports register all five tools; `response_format` on all; REST is the locked subset only; per-transport capability reflected in tool descriptions. |
| I6 thin Worker | Worker composition consumes `createWorkerSafeProviders` (R7; TC-REG-5 guarantees no cheerio loads) + bundle-scan test (no `cheerio`/`@seolite/audit` in the Worker graph), per-request composition, capping Fetcher, `WORKER_ENABLE_PSI` kill-switch, size check script, no KV/DO. |
| I8 attribution | Providers carry `attribution` metadata; surfaces propagate it into `attribution[]` arrays in every output containing CrUX/Tranco/OPR-derived data. |
| I9/I10 determinism | Fixture providers; injected clock (`retrievedAt` from injected `now()` in tests, real clock in production); size-based rotation; snapshot tests for onboarding payloads. |
| I12 SSRF | core's exported `isBlockedTarget` predicate (scaffold-core `ssrf.ts`) + an http/https scheme whitelist, composed into the surfaces-local `validatePublicHttpUrl()`, applied to every CLI URL arg, tool `url` param, and REST `?url=`: private/loopback/link-local/ULA refused, IDN normalized — before any use or echo. |
| I13 output safety | `clean()` strips ANSI CSI/OSC + C0/C1 and caps lengths for terminal echo; JSON encoding for files; `slug+sha256:8` dirnames (B5); atomic temp+rename writes for `--out`. |
| I14 cancellation | SDK handler `extra.signal` → `AuditRunner.run(input, signal)`; CLI SIGINT → AbortController → partial report labeled `incomplete:true` + exit 2; history append only on successful provider result. |
| I15 boundaries | Every malformed input maps to a typed error + exit 2 (CLI) or typed error result/envelope (MCP/REST): non-http(s), overlong seed (≤120), invalid domain (≤253, `domainToASCII` null → error), unknown flags (parseArgs strict), unknown config keys (core). |
| I16 no telemetry | Outbound only via injected Fetcher; testkit recording Fetcher + Miniflare outbound recorder enumerate calls against an allowlist; ESLint bans direct `fetch` outside `packages/core/src/fetch.ts`; Worker logs nothing; sentinel-key grep test proves keys never reach stdout/outputs. |
| I17 errors | Typed provider errors carry provider name; CLI maps to exit 2 with actionable message; MCP maps to `isError` result; REST maps to `UPSTREAM_FAILED`/`PROVIDER_UNCONFIGURED` envelope; 429/Retry-After surfaces as a typed rate-limit error. |

### Failure & concurrency (incl. concurrent MCP requests)

- **Concurrent MCP requests (stdio):** the SDK can interleave tool executions on one connection. Handlers are pure functions of `(args, deps)`; no module-level mutable state after composition. `JsonlHistoryStore` serializes appends through an in-process promise queue; each record is one small `O_APPEND` write (B6) so cross-process CLI invocations cannot corrupt lines. Test: 25 concurrent `tools/call` (mix incl. rank saves) over the in-process transport → all resolve, history file has exactly 25 well-formed lines.
- **Concurrent requests (Worker):** stateless — every request constructs fresh server + provider instances; nothing is shared except read-only code. Concurrent appends cannot happen on the Worker (history is local-only). Subrequest budget: ≤ 4 per request (PSI + CrUX, or suggest + wikipedia) — far under the 50 limit.
- **Upstream failure:** typed errors with provider name; partial multi-provider results degrade per-field (unavailable markers), the command still exits 0 when the user-facing ask was answerable from surviving fields; exit 2 only when the primary ask failed.
- **Oversized upstream responses (Worker):** capping Fetcher rejects on Content-Length > 2.5 MB before reading and aborts mid-stream otherwise → `PAYLOAD_TOO_LARGE` typed error (I6 edge: rejected with guidance to use the CLI, not attempted until timeout).
- **Cancellation:** SIGINT (CLI) or client `notifications/cancelled` (stdio) → AbortSignal → prompt stop; partial audit labeled `incomplete:true`; no history entry written for an aborted rank check.
- **`seolite mcp` shutdown:** the serve command's wait promise is resolvable — it races stdin `end`, `transport.onclose`, and run()'s AbortController. stdin close → graceful `server.close()` → exit 0; SIGINT → abort → `server.close()` → exit 2. Ctrl-C can never hang the process (spawn-tested both ways).
- **Crash safety:** history reader skips a malformed trailing line; `--out` uses temp+rename so no partial report file ever exists under the target name.

### Blast radius

- `@seolite/mcp` depends only on `@seolite/core` — core shape changes fail typecheck here immediately (fast, contained).
- Worker isolation: cheerio is excluded from the Worker bundle by construction — `createWorkerSafeProviders` omits `ddg-serp` (the only cheerio consumer) and providers TC-REG-5 asserts the worker-safe factory never loads it; surfaces double-guards with a bundle-scan test (fails if `cheerio` or `@seolite/audit` appears in the emitted worker bundle) and the size check (cheerio would blow the 1.5 MB cap).
- CLI's audit/provider coupling is confined to one adapter module (`src/composition/audit-adapter.ts`) behind `ports.ts`; the merge/rebase touches exactly that module + `package.json` deps.
- Exit-code and output-shape contracts are consumed by CI users and the site docs — changes to E1/E8 are breaking and require an ARCHITECTURE bump first.

### Alternatives considered

1. **CLI framework — commander / yargs / cac vs args-only.** Chosen deliberately: **args-only** on Node 22 built-in `node:util parseArgs` (strict mode). Justification: zero runtime dependencies (npx cold-start stays minimal — the lightweight ethos), no hidden behaviors to fight for exit codes, deterministic usage errors, and the command set is fixed and tiny (7 commands, ≤5 flags each). Accepted costs: hand-written help text (specified, not accidental: bare/`--help`/`-h` intercept before strict validation prints usage to stdout with exit 0 — E15), no auto-completion, manual type coercion — all acceptable at this scale and snapshot-tested. commander rejected (+dep, still manual exit-code work); yargs rejected (heaviest); cac rejected (dep for marginal gain).
2. **MCP registration — low-level `Server` + hand-rolled JSON Schema validation vs `McpServer.registerTool` + Zod.** Chosen: `McpServer.registerTool` with Zod raw shapes, with schema truth asserted on the wire (`tools/list` structural + golden tests, E7/B7); if the SDK's raw-shape path omits wire strictness (`additionalProperties:false`/defaults), the locked fallback is the handler-side `strictArgs` guard + downgraded wire assertions. Rejected low-level: reimplements validation (bug surface), risks `createMcpHandler` compatibility (documented for `McpServer`), saves only ~60 lines. ajv rejected (bundle weight, no need).
3. **Remote MCP — `createMcpHandler` stateless (locked) vs deprecated `McpAgent` vs hand-rolled Streamable HTTP.** `McpAgent` forbidden by ARCHITECTURE (verbatim deprecated, feature-frozen); hand-rolled rejected (protocol surface: SSE, resumability, origin validation).
4. **Tool results — JSON-in-text vs `structuredContent`+`outputSchema`.** Chosen JSON-in-text for v1 (B2): no duplicated schema maintenance; upgrade path is compatible (names/schemas locked).
5. **History — JSONL vs SQLite vs single JSON file.** JSONL locked by ARCHITECTURE (append-only, no native deps, grep-able, rotation trivial). SQLite rejected for v1 (native/bundled dependency, migration weight); single-JSON rejected (rewrite races vs append).
6. **Worker provider imports — `createWorkerSafeProviders` over the barrel (R7, chosen) vs per-provider subpath exports.** The providers aspect ships exactly one export (the barrel) plus the R7-named factory whose TC-REG-5 test guarantees the worker-safe path never loads cheerio; subpath exports were rejected as a redundant parallel contract. Surfaces keeps its own bundle-scan test + 1.5 MB size cap as independent guards.
7. **Onboarding payload builders — here vs site/docs tooling.** Here: single source of truth, snapshot-tested, importable; site/docs consume the outputs (no drift).

### Defaults (locked by this plan)

| Default | Value | Rationale |
|---|---|---|
| `failThreshold` | `error` (R2; `off` disables) | Only error-severity issues gate by default; opt into warning-gating via config/flag (B3) |
| `maxPages` | core config default 100 (R3, clamp 10k) when flag/arg omitted; no MCP tool-level default (R8) | B14 |
| help / bare invocation | usage on stdout, exit 0 (E15) | Discoverability is a decision, not an error path |
| `response_format` | `concise` | Agent-first high signal |
| `strategy` (page report) | `mobile` | PSI default, SEO-relevant |
| keyword/ideas `limit` | 20 (max 50) | Small tool results |
| rank `limit` | 20 (max 50) | Bounded SERP fetch |
| history file rotation | 1 MiB → `history.1.jsonl`, 1 generation | Deterministic, bounded growth (B4/R9) |
| history root | `./.seolite/history` | E4/B13 |
| upstream body cap (Worker) | 2.5 MB | CPU headroom under 10 ms (B10) |
| Worker bundle self-cap | 1.5 MB gzip (platform 3 MB) | E10 |
| `WORKER_ENABLE_PSI` | `"true"` | Kill-switch available (B10) |
| SIGINT exit code | 2 (`cancelled`) | E1/E14 |
| not-found rank | exit 0, `found:false` | B11 |

## Resource & Cost Analysis

- **Worker script size (platform 3 MB gzip):** bundle = MCP SDK + `agents` (`createMcpHandler`) + zod + `@seolite/core` (types/helpers) + the Worker-safe provider subset wired via `createWorkerSafeProviders` (google-suggest, wikipedia-demand, pagespeed, crux, openpagerank — `ddg-serp`/cheerio absent) + server factory. No cheerio (its parse5 graph alone approaches the cap), no audit engine. Self-cap 1.5 MB gzip enforced by `npm run check:size -w @seolite/mcp` (wrangler dry-run build → gzip the emitted entry bundle `dist/index.js` → assert). Expected actual: well under 500 KB; the cap exists to fail loudly before platform 1102/limit errors.
- **CPU (10 ms ceiling):** per-request work = URL validation (µs), header reads, JSON parse/serialize of small payloads, provider I/O (not CPU-billed). Only risk: PSI responses (large Lighthouse JSON). Mitigations: capping Fetcher (2.5 MB pre-check + stream abort), `WORKER_ENABLE_PSI` kill-switch, measured at M2 deploy; `CrUX`/`suggest`/`wikipedia`/`OPR` responses are small (KB). No HTML parsing, no crawling, no crypto beyond sha256-free paths (no hashing on the Worker).
- **Subrequests:** ≤ 4/request typical (limit 50); **requests/day:** 100k free (thin gateway, stateless — no DO/KV reads); **KV writes:** zero (limit 1k/day avoided entirely by not using KV).
- **CLI cost:** no resident processes; history bounded by rotation (~2 MiB/domain worst case); `tsc` build only, no bundler.
- **CI:** Vitest + Miniflare run fully local/free on public-repo Actions; no secrets needed for this aspect's suite (deploy gating is ci-deploy's scope).
- **Deps added:** `@seolite/cli`: `@seolite/{core,mcp}` (+ `@seolite/{audit,providers}` at rebase commit); `@seolite/mcp`: `@seolite/core`, `@modelcontextprotocol/sdk`, `agents`, `zod` (shared with SDK) (+ `@seolite/providers` at rebase commit, consumed via `createWorkerSafeProviders`). Dev: `vitest`, `@cloudflare/vitest-plugin` (Vitest ≥ 4.1), `wrangler` (build/size check only). No CLI framework (B1).

## Phases

### Phase 1 — CLI skeleton: dispatcher, exit envelope, `--json`, terminal sanitizer, `config show`

Changes (files + snippets only):

- `packages/cli/package.json` — name/bin/engines/scripts (B16, B20).

```json
{
  "name": "@seolite/cli", "type": "module", "version": "0.1.0",
  "engines": { "node": ">=22" },
  "bin": { "seolite": "./bin/seolite.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "npm run build && vitest run", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "dependencies": { "@seolite/core": "*", "@seolite/mcp": "*" }
}
```

- `bin/seolite.js`, `src/args.ts`, `src/run.ts`, `src/help.ts`, `src/term.ts`, `src/cmd/config-show.ts`. (`test` chains the build first so spawn-based tests always run against a fresh `dist/`.)

```ts
// src/run.ts — the only place exit codes are produced (E1)
export const EXIT = { OK: 0, THRESHOLD: 1, ERROR: 2 } as const;
export async function run(argv: string[], io = ioFromProcess()): Promise<number> {
  try {
    const cmd = parseCommand(argv);            // throws UsageError -> 2
    return await cmd.execute(io);
  } catch (err) {
    return reportError(err, io);               // UsageError|ConfigError|ProviderError|CancellationError -> 2
  }
}
// bin/seolite.js: #!/usr/bin/env node
// import { run } from "../dist/run.js";
// process.exitCode = await run(process.argv.slice(2));  // never process.exit() on success: stdout must flush
```

```ts
// src/args.ts — help intercepts BEFORE strict parseArgs (E15); strict mode would otherwise reject --help
const [name, ...rest] = argv;
if (argv.length === 0 || name === "--help" || name === "-h") return printHelp("root", io, EXIT.OK);   // bare -> usage, exit 0
if (rest.includes("--help") || rest.includes("-h")) return printHelp(name, io, EXIT.OK);              // per-command usage, exit 0
const spec = SPECS[name as CommandName];     // unknown command/flag -> UsageError (exit 2) with a help hint
```

```ts
// src/term.ts — I13 terminal encoding
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g, OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
export function clean(s: string, max = 200): string {
  const t = s.replace(CSI, "").replace(OSC, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
```

```ts
// src/cmd/config-show.ts — E5: names + set:boolean only
out.json({
  failThreshold: cfg.failThreshold, providers: cfg.providers,
  byok: Object.entries(cfg.byokEnvNames).map(([cap, envVar]) => ({ cap, envVar, set: !!process.env[envVar] })),
  historyDir: resolveHistoryDir(),
});
```

Success Criteria

- [ ] Automated: `npm test -w @seolite/cli` — dispatcher tests (unknown command/flag → exit 2 + usage on stderr), exit-envelope tests for all three codes, help contract (E15): bare `seolite`, `--help`, `-h`, and per-command `--help` print deterministic usage to stdout with exit 0 — snapshot-tested, intercepted before strict-flag validation, `help` is not a subcommand; `--json` single-document contract, sanitizer tests (CSI/OSC/C0 stripped, length cap), `config show` masking test (sentinel env value never in stdout), `--config`/`SEOLITE_CONFIG` resolution tests (B12).
- [ ] Automated: `npm run typecheck -w @seolite/cli` and `npm run lint`.

### Phase 2 — JSONL HistoryStore + `rank`, `keywords`, `authority`

Changes:

- `src/history/jsonl-store.ts`, `src/cmd/{rank,keywords,authority}.ts`, `src/composition/node.ts` (fixture injection for tests).

```ts
// src/history/jsonl-store.ts (E4, B4, B5, B6; implements core's LOCKED HistoryStore — scaffold-core SC-15)
import { domainToASCII } from "node:url"; import { createHash } from "node:crypto";
export function domainDir(root: string, domain: string): string {
  const ascii = domainToASCII(domain.toLowerCase()) ?? "";
  if (!ascii) throw new ConfigError(`invalid domain: ${domain}`);      // I15
  const slug = ascii.replace(/[^a-z0-9.-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "domain";
  const h = createHash("sha256").update(ascii).digest("hex").slice(0, 8);
  return path.join(root, "rank", `${slug}-${h}`);
}
export class JsonlHistoryStore implements HistoryStore {
  // core: append(e: RankHistoryEntry): Promise<void>; list(q?: {keyword?;domain?;limit?}): Promise<RankHistoryEntry[]>
  #queue = Promise.resolve();                                          // in-process mutex (E13)
  constructor(private root: string, private maxBytes = 1_048_576) {}
  append(e: RankHistoryEntry): Promise<void> {                         // one O_APPEND write per entry
    return (this.#queue = this.#queue.then(() => this.#append(e)));
  }
  async list(q?: { keyword?: string; domain?: string; limit?: number }): Promise<RankHistoryEntry[]> {
    // read history.1.jsonl then history.jsonl (newest-last), filter by q, tail(q.limit ?? all);
    // skip a truncated/malformed final line (crash safety, E4)
  }
  async #append(e: RankHistoryEntry) {
    const dir = domainDir(this.root, e.domain); await mkdir(dir, { recursive: true });
    const file = path.join(dir, "history.jsonl");
    if (await sizeOf(file) >= this.maxBytes)
      await rename(file, path.join(dir, "history.1.jsonl")).catch(() => {});   // literal name; .1 overwritten (R9)
    await appendFile(file, JSON.stringify(e) + "\n", "utf8");          // line == RankHistoryEntry exactly (no v/found/limit)
  }
}
```

```ts
// src/cmd/rank.ts — locked SPI: search(q, o): Promise<SerpResult[]> (ARCHITECTURE); B11: not-found is success;
// E14: append only after a successful search; stored line is exactly core's RankHistoryEntry
const at = clock();
const results: SerpResult[] = await deps.serp.search(keyword, { limit });   // deps.serp: SerpProvider { name, search }
const hit = results.find(r => sameDomain(r.url, domain)) ?? null;
if (!flags["no-save"]) await deps.history.append({ keyword, domain,         // RankHistoryEntry (SC-15)
  position: hit?.position ?? null, provider: deps.serp.name, url: hit?.url, retrievedAt: at });
const result = { keyword, domain, found: hit !== null, position: hit?.position ?? null,
  matchedUrl: hit?.url, provider: deps.serp.name, retrievedAt: at };        // found derived, never stored
if (args.response_format === "detailed") result.recentHistory = await deps.history.list({ domain, limit: 10 });
out.json(result); // human mode renders position + trend line via clean()
```

Success Criteria

- [ ] Automated: `npm test -w @seolite/cli` — history tests: append/rotate semantics (rotate at 1 MiB to the literal `history.1.jsonl`, `.1` overwritten on second rotation, newest-last read across both generations), compile-level `implements HistoryStore{append, list}` conformance with `RankHistoryEntry` lines (no extra stored fields), path-safety (IDN `münchen.de`, domains with `:`/unicode/spaces → safe deterministic dirnames, B5), malformed-trailing-line tolerance, 25-way concurrent append integrity, `--no-save` writes nothing; command tests via fixture SerpProvider/KeywordProvider/AuthorityProvider: provenance fields present (I3), not-found → exit 0 `found:false`, provider error → exit 2 with provider name (I17).
- [ ] Automated: `npm run typecheck -w @seolite/cli`.

### Phase 3 — `audit` + `report` commands and the ports seam

Changes:

- `src/ports.ts`, `src/cmd/{audit,report}.ts`, `src/write-atomic.ts`; `src/composition/audit-adapter.ts` lands with fixture runner in this phase and is swapped to `@seolite/audit` in Phase 6's rebase commit (merge order P2 → P3 → P4; branch stays core-only until then).

```ts
// src/ports.ts — the seam that keeps this branch core-only until rebase.
// Rebase adapter mapping (documented contract): AuditRunner.run(input, signal) loads config via the core loader
// (applying the --max-pages budget override onto core's R3 budgets), builds CrawlerDeps from core (fetcher, clock,
// delay, jitter, randomId), and calls @seolite/audit's runSiteAudit(seed: URL, config, deps, signal).
// Typed robots errors (SeoliteSeedDisallowedError, SeoliteRobotsUnreachableError) map to exit 2 with guidance.
export interface AuditRunner { run(input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport> }
export interface PageMetaFetcher { fetch(url: URL, signal?: AbortSignal): Promise<PageMeta | null> }
```

```ts
// src/cmd/audit.ts — E1 gate: issue at/above threshold OR incomplete -> 1 (R1/R2 vocabulary)
const report = await deps.auditRunner.run({ url, maxPages: flags["max-pages"], signal }); // undefined -> core config default (R3/R8)
const threshold = flags["fail-threshold"] ?? cfg.failThreshold ?? "error";   // R2; one of info|warning|error|off
const gateFailed = report.incomplete || (threshold !== "off" &&              // "off" never gates (R2); incomplete always gates (E1)
  countIssuesAtOrAbove(report.summary.countsBySeverity, threshold) > 0);     // core gate helper (scaffold-core SC-4)
if (flags.out) await writeFileAtomic(flags.out, JSON.stringify(report, null, 2) + "\n"); // I13/E14 atomic
if (flags.json) out.json(report); else out.human(summarize(report));   // summarize() runs through clean()
return gateFailed ? EXIT.THRESHOLD : EXIT.OK;
```

```ts
// src/write-atomic.ts
export async function writeFileAtomic(p: string, data: string) {
  const tmp = `${p}.tmp-${process.pid}`;
  await writeFile(tmp, data, "utf8"); await rename(tmp, p);
}
```

Success Criteria

- [ ] Automated: `npm test -w @seolite/cli` — exit-code matrix with fixture audit runner (0 clean / 1 at-threshold for each of `info`, `warning`, `error` + incomplete; `off` never gates / 2 config+provider+usage+typed-robots-refusal), `failThreshold` config-vs-flag precedence and default `error` (R2), `--out` atomic write (no temp leftovers, target never partially written), `incomplete:true` labeling on fixture cancellation (E14), `--max-pages` plumbing with no flag default (R8), `report` unavailable-field rendering (BYOK absent → `unavailable`, exit 0, I1/I3).
- [ ] Automated: `npm run typecheck -w @seolite/cli`.

### Phase 4 — MCP server factory: five tools, schemas, stdio transport, onboarding payloads

Changes:

- `packages/mcp/package.json` (deps: `@seolite/core`, `@modelcontextprotocol/sdk`, `zod`; dev: `vitest`), `src/server.ts`, `src/schemas.ts`, `src/local-only.ts`, `src/strict-args.ts`, `src/onboard.ts`, `src/testkit/*` (fixture providers, in-process transport harness, spawn helper), `packages/cli/src/cmd/mcp.ts`.

```ts
// packages/mcp/src/server.ts — one factory, both transports (I5/E6/E7); every handler wrapped in strictArgs()
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
const RF = z.enum(["concise", "detailed"]).default("concise");
const THRESHOLD = z.enum(["info", "warning", "error", "off"]).default("error"); // R1/R2 — identical to the CLI flag
export interface McpDeps {
  clock: () => string;
  keyword: KeywordProvider[]; authority: AuthorityProvider[];       // merged ideas/signals, per-item provenance
  serp?: SerpProvider; pageSpeed?: PageSpeedProvider; crux?: CruxProvider;
  auditRunner?: AuditRunner; pageMeta?: PageMetaFetcher;
}
export function buildMcpServer(deps: McpDeps): McpServer {
  const s = new McpServer({ name: "seolite", version: "0.1.0" });
  s.registerTool("seolite_audit_site", {
    title: "Bounded site audit",
    description: deps.auditRunner ? AUDIT_DESC : AUDIT_DESC + LOCAL_ONLY_NOTE,
    inputSchema: { url: z.string().min(1),                                   // no maxPages default — R8: core config applies
      maxPages: z.number().int().min(1).max(10_000).optional(),
      failThreshold: THRESHOLD, response_format: RF },
  }, async (args, extra) => deps.auditRunner
      ? ok(await runAuditSite(deps, strictArgs(args), extra.signal))
      : localOnly("seolite_audit_site", "npx @seolite/cli audit <url>"));
  // seolite_page_report (url, strategy mobile|desktop, includeCrux, response_format)
  // seolite_keyword_ideas (seed 1..120, lang, limit 1..50, response_format)
  // seolite_rank_check (keyword, domain, limit, response_format) — local-only when deps.serp absent
  // seolite_authority (domain, response_format)
  return s;
}
// src/strict-args.ts — E7/B7 fallback: unknown/extra params are rejected handler-side with a typed error
// regardless of what the wire inputSchema advertises; wire strictness (additionalProperties:false) is
// opportunistically asserted + snapshot-documented per installed SDK.
```

```ts
// packages/mcp/src/local-only.ts — typed local-only error (E6/I6)
export function localOnly(tool: string, cli: string) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({
    code: "LOCAL_ONLY_CAPABILITY", tool,
    message: `${tool} needs local compute (crawl/HTML parsing) and is unavailable over remote MCP. Run instead: ${cli}`,
  }) }] };
}
```

```ts
// packages/mcp/src/onboard.ts — E11 payload builders (deterministic; snapshot-tested; never embed keys)
const LOCAL = { command: "npx", args: ["-y", "@seolite/cli", "mcp"] } as const;
export function onboardPayload(target: "json" | "claude" | "cursor" | "vscode", remoteUrl?: string): string {
  const cfg = remoteUrl ? { type: "http", url: remoteUrl } : LOCAL;
  if (target === "json") return JSON.stringify({ mcpServers: { seolite: cfg } }, null, 2);
  if (target === "claude") return remoteUrl
    ? `claude mcp add --transport http seolite ${remoteUrl}`
    : "claude mcp add --transport stdio seolite -- npx -y @seolite/cli mcp";
  if (target === "cursor") return `cursor://anysphere.cursor-deeplink/mcp/install?name=seolite&config=${
    Buffer.from(JSON.stringify(cfg)).toString("base64")}`;
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "seolite", server: cfg }))}`;
}
```

```ts
// packages/cli/src/cmd/mcp.ts — stdio launcher + --print (E2: stdout is protocol only; E14: resolvable shutdown)
if (flags.print) { io.out(onboardPayload(flags.print, flags.url) + "\n"); return EXIT.OK; }
const server = buildMcpServer(nodeComposition());
const transport = new StdioServerTransport();
await server.connect(transport);
io.err("seolite mcp: stdio transport ready");                        // stderr ONLY
let exit = EXIT.OK;                                                  // stdin close -> 0, SIGINT via run() -> 2
const closed = new Promise<void>((r) => { transport.onclose = r; });
process.stdin.once("end", () => void server.close());                // client disconnect -> graceful stop
const onAbort = () => { exit = EXIT.ERROR; io.err("seolite mcp: cancelled"); void server.close(); };
io.signal?.addEventListener("abort", onAbort, { once: true });       // run()'s AbortController is honored
await closed;
io.signal?.removeEventListener("abort", onAbort);
return exit;                                                          // the promise RESOLVES — no hang
```

- `src/testkit/` — fixture providers implementing core SPI (deterministic `KeywordIdea[]`, `SerpResult[]`, `AuthoritySignal[]`, `PageSpeedReport`, `CruxRecord`), `InMemoryTransport` client harness, `spawnCli(args, env)` helper.

Success Criteria

- [ ] Automated: `npm test -w @seolite/mcp` — wire contract tests via `tools/list` (exactly the five locked names; guaranteed set: `inputSchema.type === "object"`, `required` exactly the no-default fields, enums `["info","warning","error","off"]` on `failThreshold` matching the CLI flag, bounds, no `maxPages` default (R8); `additionalProperties: false` + schema-level defaults asserted opportunistically with snapshot documentation of the installed SDK's behavior (E7/B7); unknown/extra tool args rejected handler-side via `strictArgs` regardless), invalid-args calls rejected with typed messages, `response_format` default concise present on all five, local-only typed errors for `audit_site`/`rank_check` in the no-deps composition (`code: "LOCAL_ONLY_CAPABILITY"`, message names the CLI), concise vs detailed shape diffs per E8, provenance present (I3).
- [ ] Automated: `npm test -w @seolite/cli` — stdio round-trip via `spawnCli(["mcp"])`: initialize → tools/list → tools/call over the real child-process stdio; stdout contains only JSON-RPC frames (startup note is on stderr); shutdown contract (E14): spawned `seolite mcp` receives SIGINT → exits 2 within a bounded timeout with `cancelled` on stderr; spawned `seolite mcp` with stdin closed → exits 0; snapshot tests for all 8 onboarding payloads (4 targets × local/remote) — deterministic strings, no key material.
- [ ] Automated: `npm run typecheck -w @seolite/mcp`.

### Phase 5 — Worker: `createMcpHandler` stateless HTTP + REST subset + size budget

Changes:

- `packages/mcp/worker/{index.ts,composition.ts,capping-fetcher.ts,rest.ts,cors.ts}`, `worker/providers.ts` (rebase commit: real `createWorkerSafeProviders` wiring), `worker/wrangler.jsonc`, `vitest.worker.config.ts`, `scripts/check-size.mjs`, `package.json` scripts (`test:worker`, `build:worker`, `check:size`), dev deps `@cloudflare/vitest-plugin` (Vitest ≥ 4.1), `wrangler`. Phase 5 builds and tests against the fixture composition (core-only branch rule, B21); the rebase commit swaps in the real provider registry and the identical suite re-runs green.

```jsonc
// packages/mcp/worker/wrangler.jsonc
{
  "name": "seolite-mcp",
  "main": "worker/index.ts",
  "compatibility_date": "2026-08-04",
  "compatibility_flags": ["nodejs_compat"],
  "vars": { "WORKER_ENABLE_PSI": "true" }
}
```

```ts
// packages/mcp/worker/index.ts — stateless pattern (B8); NOT McpAgent
import { createMcpHandler } from "agents/mcp/server";
import { buildMcpServer } from "../src/server.js";
import { mcpComposition } from "./composition.js";
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return corsPreflight(url.pathname);
    if (url.pathname === "/healthz") return json({ ok: true });
    if (url.pathname === "/api/v1/page-report") return pageReportRoute(request, env);
    if (url.pathname === "/api/v1/keyword-ideas") return keywordIdeasRoute(request, env);
    if (url.pathname === "/mcp" && request.method === "POST") {
      const server = buildMcpServer(mcpComposition(request.headers, env)); // fresh per request (E13)
      return withCors(await createMcpHandler(server)(request, env, ctx));
    }
    return errorJson("NOT_FOUND", 404, "unknown route");
  },
} satisfies ExportedHandler<Env>;
```

```ts
// packages/mcp/worker/composition.ts — E5 header pass-through via core's ProviderDeps.env(name) seam
// (values read at call time, never logged/stored/echoed); E6 capability map; E13 per-request instances
const HEADER_FOR_ENV: Record<string, string> = { SEOLITE_PSI_KEY: "x-seolite-psi-key",
  SEOLITE_CRUX_KEY: "x-seolite-crux-key", SEOLITE_OPR_KEY: "x-seolite-opr-key" };   // R5 scheme
export function workerDeps(headers: Headers): ProviderDeps {
  return { fetcher: cappingFetcher, cache: nullCache,                 // always-miss cache (B19): no KV, no cross-request state
    clock: () => Date.now(), sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    env: (name) => { const h = HEADER_FOR_ENV[name]; return h ? (headers.get(h) ?? undefined) : undefined; },
    userAgent: WORKER_UA };
}
// Stable seam consumed by worker/index.ts in BOTH states (index.ts never changes at rebase):
//   export function mcpComposition(headers: Headers, env: Env): McpDeps
// Pre-rebase (core-only branch, B21): mcpComposition delegates to fixtureWorkerComposition(headers) —
// testkit providers behind the identical McpDeps shape; header mapping is unit-tested on workerDeps().env directly.
// Rebase commit -> worker/providers.ts (R7 locked mechanism):
//   import { createWorkerSafeProviders } from "@seolite/providers";
//   const p = createWorkerSafeProviders(workerConfig(env), workerDeps(headers));
//   return { clock: isoClock, keyword: [p["google-suggest"], p["wikipedia-demand"]],
//            pageSpeed: p.pagespeed, crux: p.crux, authority: [p.openpagerank] };
//   // workerConfig selects only the five Worker-appropriate providers — tranco unselected (bulk-CSV
//   // stream parsing cannot fit the 10 ms ceiling, I6); no serp/auditRunner/pageMeta/history in McpDeps
//   // -> audit_site/rank_check = LOCAL_ONLY_CAPABILITY
```

```ts
// packages/mcp/worker/rest.ts — page-report: PSI/CrUX only; target URL never fetched/parsed (I6/E9/I12)
async function pageReportRoute(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url); const raw = u.searchParams.get("url");
  const v = validatePublicHttpUrl(raw); if (!v.ok) return errorJson("INVALID_URL", 400, v.message);
  const [lab, field] = await Promise.all([
    env.WORKER_ENABLE_PSI === "false" ? unavailable("psi disabled") : callPsi(v.url, req.headers),
    callCrux(v.url, req.headers),
  ]);
  return json({ url: v.url.href, lab, field, limitations: [
    "page meta/HTML analysis is local-only: npx @seolite/cli report <url>"], attribution: collect(lab, field) });
}
```

```ts
// packages/mcp/worker/capping-fetcher.ts — I6 edge: reject oversize up-front, abort mid-stream otherwise
export const cappingFetcher: Fetcher = {
  async fetch(url, init) {
    const res = await realFetch(url, init);
    const cl = Number(res.headers.get("content-length") ?? 0);
    if (cl > MAX_BODY) { await res.body?.cancel(); throw new UpstreamTooLarge(url.host, cl); }
    return res; // streaming consumer aborts via signal if cumulative read exceeds MAX_BODY
  },
};
const MAX_BODY = 2_500_000;
```

```ts
// packages/mcp/vitest.worker.config.ts — locked stack: @cloudflare/vitest-plugin (Vitest >= 4.1, Miniflare)
import { defineWorkersConfig } from "@cloudflare/vitest-plugin/config";
export default defineWorkersConfig({
  test: {
    include: ["worker/**/*.test.ts"],
    poolOptions: { workers: {
      wrangler: { configPath: "./worker/wrangler.jsonc" },
      miniflare: { outboundService: (req: Request) => recordAndFixture(req) }, // I16 outbound recorder
    } },
  },
});
```

```js
// packages/mcp/scripts/check-size.mjs — E10: self-cap 1.5 MB gzip (platform 3 MB)
import { gzipSync } from "node:zlib"; import { readFileSync, existsSync } from "node:fs";
// wrangler --outdir emits the ENTRY-BASENAME bundle: main "worker/index.ts" -> dist/index.js (not worker.js)
const file = new URL("../dist/index.js", import.meta.url);
if (!existsSync(file)) { console.error("no dist/index.js — run: npm run build:worker -w @seolite/mcp"); process.exit(2); }
const gz = gzipSync(readFileSync(file)).length;
const LIMIT = 1_572_864;
console.log(`worker bundle ${(gz / 1024) | 0} KiB gzip / limit ${LIMIT / 1024 | 0} KiB`);
if (gz > LIMIT) { console.error("WORKER BUNDLE OVER SELF-CAP — remove a dependency or raise cap consciously"); process.exit(1); }
```

- Bundle-scan test (part of `npm test -w @seolite/mcp`): parses the esbuild metafile/wrangler output and fails if `cheerio` or `@seolite/audit` appears in the Worker module graph (guards the `createWorkerSafeProviders` barrel contract alongside providers TC-REG-5).

Success Criteria

- [ ] Automated: `npm run test:worker -w @seolite/mcp` — Miniflare (self-fetch; script chains `npm run build:worker` so the bundle under test always exists): `tools/list` over `POST /mcp` returns the identical five-tool set (parity assertion vs stdio fixture), `tools/call seolite_audit_site` and `seolite_rank_check` → `LOCAL_ONLY_CAPABILITY` typed error naming `npx @seolite/cli`; `seolite_page_report` serves PSI/CrUX fixtures only and includes the local-only limitation string; `/api/v1/page-report?url=` validates URLs (http/https only, private ranges → 400 `INVALID_URL` via core's `isBlockedTarget`) and never issues an outbound request to the target (outbound recorder proves it); `/api/v1/keyword-ideas?q=` serves fixture suggestions; `/healthz` → `{"ok":true}`; unknown route → 404 envelope; GET on `/mcp` without session → typed protocol error; `workerDeps().env` maps `SEOLITE_PSI_KEY`/`SEOLITE_CRUX_KEY`/`SEOLITE_OPR_KEY` to the `x-seolite-*` headers and nothing else; header values never appear in any response body (E5/I16); suite green pre-rebase (fixture composition) AND post-rebase (real `createWorkerSafeProviders`, when the outbound-host allowlist assertions activate — I1: zero PSI/CrUX outbound when no keys are sent).
- [ ] Automated: `npm run check:size -w @seolite/mcp` (chains `build:worker`, gzips the emitted `dist/index.js`) — bundle under self-cap; bundle-scan test green (no cheerio/@seolite/audit in Worker graph).
- [ ] Automated: `npm test -w @seolite/mcp` (bundle-scan + unit portion) and `npm run typecheck -w @seolite/mcp`.

### Phase 6 — Hardening: cancellation, concurrency, CORS/no-telemetry enforcement, rebase adapter

Changes:

- `src/server.ts`: pass `extra.signal` into `AuditRunner`/provider calls (E14). `packages/cli/src/run.ts`: SIGINT wiring.

```ts
// packages/cli/src/run.ts — E14: SIGINT -> prompt stop -> partial labeled report -> exit 2
const ac = new AbortController();
const onSigint = () => ac.abort(new CancellationError("interrupted"));
process.on("SIGINT", onSigint);
try { return await cmd.execute(io, ac.signal); }
catch (err) { if (err instanceof CancellationError) { io.err("cancelled"); return EXIT.ERROR; } throw err; }
finally { process.off("SIGINT", onSigint); }
```

- `packages/mcp/worker/cors.ts` — permissive CORS on `/mcp` + `/api/v1` including `x-seolite-*` request headers (E9).
- Root ESLint rule (delivered to bootstrap CI / ci-deploy aspect as a snippet): I16 fetch restriction.

```js
// eslint.config excerpt (root; enforced repo-wide)
rules: { "no-restricted-globals": ["error", { name: "fetch",
  message: "All HTTP must go through the @seolite/core Fetcher (packages/core/src/fetch.ts) — I16/I17" }] },
// overrides: packages/core/src/fetch.ts -> "no-restricted-globals": "off"
```

- Rebase commit (executed on the post-P3 main the orchestrator creates; merge order P2 → P3 → P4 guarantees `@seolite/audit` + `@seolite/providers` exist):
  - `packages/cli/package.json` gains `@seolite/audit` + `@seolite/providers`; `packages/mcp/package.json` gains `@seolite/providers`; `src/composition/audit-adapter.ts` swaps the fixture `AuditRunner`/`PageMetaFetcher` for the real engine — `runSiteAudit(seed: URL, config, deps: CrawlerDeps, signal)` with config load + budget override (mapping documented at `src/ports.ts`).
  - `packages/mcp/worker/providers.ts` swaps the fixture composition for the real `createWorkerSafeProviders(workerConfig(env), workerDeps(headers))` wiring (R7); the unchanged Phase 5 worker suite re-runs green with real-outbound allowlist assertions active.
- M2 handoff checklist embedded in this phase's test suite: CLI smoke fixture HTTP server entry (`testkit/spawnCli` already used), MCP inspector smoke instructions (docs aspect references them).

Success Criteria

- [ ] Automated: `npm test -w @seolite/cli` — SIGINT mid-audit (fixture runner honors AbortSignal) → prompt stop, `incomplete:true` report written atomically when `--out`, exit 2; 25 concurrent `rank` invocations → 25 intact history lines; no-telemetry test: global `fetch` stubbed to throw, every command + tool run with fixture providers → zero direct fetch calls, recorded-Fetcher call list matches the allowlist exactly (I16); sentinel-key grep over all command outputs.
- [ ] Automated: `npm test -w @seolite/mcp` — client-cancelled tool call (InMemoryTransport `notifications/cancelled`) resolves promptly with partial/no side effects; strictArgs rejection re-verified; CORS preflight tests on worker config-level unit tests; bundle-scan + size still green post-rebase.
- [ ] Automated: `npm run test:worker -w @seolite/mcp` (post-rebase: real `createWorkerSafeProviders` composition; outbound-host allowlist assertions active), `npm run check:size -w @seolite/mcp`, `npm run lint` (fetch-restriction rule active), `npm run typecheck -w @seolite/cli && npm run typecheck -w @seolite/mcp`.

## Testing Strategy

All deterministic (I9/I10): fixture providers from `@seolite/mcp/testkit`, injected clock, no live network. Layers: unit (Vitest, Node), in-process transport (`InMemoryTransport`), real stdio (child-process spawn of the CLI bin), Worker (Miniflare self-fetch + outbound recorder).

| Edge / invariant | Test (file :: case) | Layer |
|---|---|---|
| Unknown command/flag, bad URL arg (I15) | `cli/test/args.test.ts` :: usage-error-maps-to-exit-2 | unit |
| Bare/`--help`/`-h`/per-command help → usage, exit 0, pre-strict intercept (E15) | `cli/test/help.test.ts` :: help-snapshots | spawn |
| Exit 0/1/2 matrix incl. `failThreshold` info/warning/error + `off` never gates (E1/R1/R2) | `cli/test/exit-codes.test.ts` :: threshold-gate-matrix | spawn |
| `incomplete:true` forces exit 1 (E1) | `cli/test/exit-codes.test.ts` :: incomplete-fails-gate | spawn |
| SIGINT → prompt stop, labeled partial, exit 2 (E14) | `cli/test/cancellation.test.ts` :: sigint-stops-and-labels | spawn |
| `seolite mcp` SIGINT → exit 2; stdin close → exit 0; no hang (E14) | `cli/test/mcp-shutdown.test.ts` :: sigint-and-stdin-close | spawn |
| `--json` = exactly one JSON doc, trailing newline (E2) | `cli/test/json-contract.test.ts` :: single-document | spawn |
| ANSI/C0–C1 sanitization + length cap (I13) | `cli/test/term.test.ts` :: strips-escape-sequences | unit |
| History append/rotate: 1 MiB → `history.1.jsonl`, `.1` overwritten, newest-last, RankHistoryEntry lines (E4/B4/R9) | `cli/test/history.test.ts` :: rotate-semantics | unit |
| Path-safe domain dirnames: IDN, unicode, `:`, spaces (I13/B5) | `cli/test/history.test.ts` :: domain-dirname-safety | unit |
| Malformed trailing line skipped on read (E4) | `cli/test/history.test.ts` :: crash-tolerant-read | unit |
| 25 concurrent appends → 25 intact lines (E13/B6) | `cli/test/history.test.ts` :: concurrent-append-integrity | unit |
| `--no-save` writes nothing; append only on success (E14) | `cli/test/rank.test.ts` :: no-save-and-failure-no-append | unit |
| BYOK absent → `unavailable`, exit 0, no keyless call (I1/I3) | `cli/test/report.test.ts` :: unconfigured-provider-degrades | unit |
| `config show` prints names + set:boolean, never values (E5) | `cli/test/config-show.test.ts` :: byok-masking | unit |
| Sentinel env key value never in any stdout (I16) | `cli/test/no-telemetry.test.ts` :: sentinel-key-grep | spawn |
| Zero outbound except enumerated Fetcher calls; global fetch throws (I16) | `mcp/test/no-telemetry.test.ts` :: outbound-allowlist | unit |
| Wire schemas: 5 names; guaranteed set (type/required/enum/bounds); strictness + defaults opportunistic snapshots; strictArgs always (E7/B7) | `mcp/test/schema-contract.test.ts` :: tools-list-wire-schema | in-process |
| Invalid tool args → typed validation error (E7/I15) | `mcp/test/schema-contract.test.ts` :: invalid-args-rejected | in-process |
| Local-only typed error, CLI pointer, description note (E6/I6) | `mcp/test/capabilities.test.ts` :: local-only-typed-error | in-process |
| concise vs detailed shapes per E8, provenance everywhere (I3) | `mcp/test/output-shapes.test.ts` :: response-format-diff | in-process |
| stdio round-trip via real spawned bin; stderr-only notes (E2) | `cli/test/stdio-roundtrip.test.ts` :: spawn-initialize-list-call | spawn |
| 25 interleaved tool calls incl. rank saves (E13) | `mcp/test/concurrency.test.ts` :: interleaved-calls | in-process |
| Client cancellation (`notifications/cancelled`) (E14) | `mcp/test/concurrency.test.ts` :: client-cancel | in-process |
| Onboarding payloads: 8 deterministic snapshots, no keys (E11/B15) | `mcp/test/onboard.test.ts` :: payload-snapshots | unit |
| Worker: `tools/list` parity, local-only over HTTP, REST subset, 404/405 (E6/E9; fixture composition pre-rebase, real `createWorkerSafeProviders` post-rebase) | `mcp/worker/worker.test.ts` :: parity-and-rest | Miniflare |
| Worker: `?url=` validation, target never fetched (I12/I6) | `mcp/worker/worker.test.ts` :: target-url-never-fetched | Miniflare |
| Worker: BYOK headers forwarded, never echoed; no keys → zero PSI/CrUX outbound (E5/I1) | `mcp/worker/worker.test.ts` :: header-passthrough | Miniflare |
| Worker: outbound host allowlist; nothing else (I16) | `mcp/worker/worker.test.ts` :: outbound-recorder-allowlist | Miniflare |
| Oversize upstream rejected before read (I6/B10) | `mcp/worker/capping-fetcher.test.ts` :: content-length-and-stream-cap | unit |
| Bundle excludes cheerio/@seolite/audit; ≤ 1.5 MB gzip (E10/I6; wrangler build chained into scripts) | `mcp/test/bundle-scan.test.ts` + `check:size` | build |

## References

- Research: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — Seam 4 (createMcpHandler stateless pattern; McpAgent deprecated; stdio/HTTP pairing; onboarding deep-links; tool-design guidance: namespacing, consolidation, concise/detailed, JSON Schema 2020-12); Workers free limits (10 ms CPU, 3 MB gzip, 50 subrequests); `@cloudflare/vitest-plugin` (Vitest ≥ 4.1, Miniflare); I5/I6/I13/I16 invariants.
- Architecture: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — locked tool/command names, exit codes, REST subset, Worker thin-gateway rule, package table, M1 merge order.
- Implicit spec (this bundle): `./IMPLICIT_SPEC.md` — E1–E15 edges, B1–B21 bounding assumptions.
- Reconciliation (authoritative): `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/RECONCILIATION.md` — R1 (severity `error|warning|info`), R2 (`failThreshold` default `error`, `off` disables), R3 (core-owned budgets), R5 (BYOK env scheme), R7 (`createWorkerSafeProviders`, 2.5 MB cap, `WORKER_ENABLE_PSI`), R8 (no MCP tool-level `maxPages` default), R9 (history root/rotate/dirname).
- Sibling bundles (locked seams consumed here): scaffold-core PLAN (`HistoryStore{append,list}` + `RankHistoryEntry` SC-15, `countIssuesAtOrAbove` SC-4, `isBlockedTarget` in `ssrf.ts`); providers PLAN (barrel-only export, `createWorkerSafeProviders(config, deps)`, TC-REG-5 no-cheerio guarantee, `ProviderDeps{fetcher,cache,clock,sleep,env,userAgent}`); audit-engine PLAN (`runSiteAudit(seed, config, deps, signal)`, typed robots errors).
- Cloudflare: developers.cloudflare.com/agents/model-context-protocol/ (createMcpHandler stateless recommended pattern); developers.cloudflare.com/workers/platform/limits/ (10 ms CPU, 3 MB gzip, 50 subrequests, KV 1k writes/day); developers.cloudflare.com/workers/testing/ (vitest plugin, fully local).
- MCP: modelcontextprotocol.io/specification (Streamable HTTP, tool inputSchema JSON Schema 2020-12, tool naming per SEP-986 as recorded in research); github.com/modelcontextprotocol/typescript-sdk (McpServer, registerTool, StdioServerTransport, InMemoryTransport).
- Anthropic tool-design guidance (high-signal output, response_format concise/detailed) — as captured in research Seam 4.
- Vendor onboarding: cursor.com/docs/mcp/install-links (`cursor://anysphere.cursor-deeplink/mcp/install?…` base64 config); code.visualstudio.com MCP docs (`vscode:mcp/install?{json}`); code.claude.com/docs/en/mcp (`claude mcp add --transport stdio … -- <cmd>`); `mcp-remote` bridge for stdio-only clients (documented, not depended on).
- Node: nodejs.org/api/util.html#utilparseargsargs-options (strict parseArgs — B1 foundation); nodejs.org/api/url.html#urldomaintoasciidomain (IDN normalization — B5).
- Zod: zod.dev (v4; shared with the MCP SDK dependency — B7).
