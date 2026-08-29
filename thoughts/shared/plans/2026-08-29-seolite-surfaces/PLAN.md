---
date: 2026-08-29
aspect: surfaces
bundle: thoughts/shared/plans/2026-08-29-seolite-surfaces/
protocol: create_plan_generic_v2_5
scale: large
status: complete
owner_packages: packages/cli (@seolite/cli), packages/mcp (@seolite/mcp incl. worker/), JSONL HistoryStore
depends_on: scaffold-core (M0, packages/core) — branch deps limited to core per ARCHITECTURE M1
merge_order: P4 in ARCHITECTURE; merges after audit-engine (P2) and providers (P3); orchestrator rebases
spec: ./IMPLICIT_SPEC.md (E1–E14, B1–B20)
---

# seolite surfaces — PLAN (v2.5)

## SIGNPOST

This bundle turns the locked architecture's **surface contract** into two packages: `packages/cli` (bin `seolite` — 7 commands, `--json` everywhere, exit codes 0/1/2 with `failThreshold` gating, JSONL HistoryStore under `.seolite/`, terminal output encoding per I13, stdio MCP launcher) and `packages/mcp` (one `buildMcpServer` factory for the five locked tools, served over `StdioServerTransport` locally and over Cloudflare `createMcpHandler` stateless HTTP remotely, plus the thin REST subset in `worker/`). Three hard edges define done: (1) **exit codes** — a CI gate that can only emit 0/1/2 and never lies; (2) **transport parity** — the identical tool set on stdio and HTTP from one codebase, with typed `LOCAL_ONLY_CAPABILITY` results where the Worker must stay thin (I6); (3) **budget** — Worker bundle self-capped at 1.5 MB gzip against the platform's 3 MB, CPU-safe routes only. Everything is TDD'd with fixture providers — zero live network in this aspect's suite (I9/I10); real-provider smoke is the M2 integration gate's job. Merge position: P4 of ARCHITECTURE's M1 wave, after P2 (audit-engine) and P3 (providers) land; this branch depends only on `packages/core` until the orchestrator's rebase, and the real audit/provider adapter lands in the rebase commit (Phase 6).

## Overview

Surfaces is the product's skin: a developer runs `npx @seolite/cli audit https://example.com` in CI and gets exit 0/1/2 they can gate on; an agent connects `seolite mcp` over stdio or `https://<worker>/mcp` over Streamable HTTP and sees the same five `seolite_*` tools; a lightweight REST subset (`/api/v1/page-report`, `/api/v1/keyword-ideas`, `/healthz`) serves the slice that fits the Workers free tier. One `buildMcpServer(deps)` factory is the single source of tool truth — stdio and HTTP are composition roots, not code paths. The CLI composes the full provider set + audit engine + JSONL history; the Worker composes only Worker-safe providers (no cheerio, no audit engine, no history) and answers `audit_site`/`rank_check` with a typed local-only error pointing at the CLI. Onboarding payloads (`mcpServers` JSON, `claude mcp add` one-liner, Cursor/VS Code deep links) are built and snapshot-tested here so the site/docs aspect consumes them, never re-invents them.

## Current State

- Greenfield: repo contains research (`thoughts/shared/research/2026-08-29-seolite-greenfield-research.md`), `ARCHITECTURE.md`, and this plan set. No `packages/cli` or `packages/mcp` code exists.
- M0 (scaffold-core) is planned/landing first: `packages/core` exports the Fetcher (SSRF/timeout/backoff per I12/I17), config loader incl. `failThreshold` (unknown-key validation per I15), provider SPI + registry validation, full payload models (`KeywordIdea`, `SerpResult`, `PageSpeedReport`, `CruxRecord`, `AuthoritySignal`, `SiteAuditReport`, …), and the `HistoryStore` interface. This branch codes against those shapes and fixture implementations of them.
- Sibling branches (audit-engine P2, providers P3) are parallel; merge order P2 → P3 → P4 guarantees they exist on main before this branch's final adapter commit.
- No Cloudflare credentials exist on this machine (research-verified); the Worker ships deployable-but-not-deployed, tested fully locally via Miniflare (`@cloudflare/vitest-plugin`).

## Desired End State

- `seolite audit <url> [--max-pages N] [--out report.json] [--fail-threshold S] [--json]` — runs the bounded audit engine, prints a summary (or one JSON document), writes `--out` atomically, exits 0/1/2 per E1, labels interrupted runs `incomplete: true`.
- `seolite report <url> [--strategy mobile|desktop] [--json]` — PSI + CrUX (BYOK, skip-with-"not-configured" per I1) + local page-meta fetch, provenance on every metric.
- `seolite keywords <seed> [--limit N] [--lang L] [--json]`, `seolite authority <domain> [--json]` — fixture-clean, provenance-labeled outputs.
- `seolite rank <keyword> --domain <domain> [--limit N] [--no-save] [--json]` — SERP position check (best-effort, labeled), appends one JSONL record to `.seolite/history/rank/<slug>-<hash8>.jsonl` (append-only, size-rotated, path-safe per I13/E4).
- `seolite config show [--json]` — resolved config with env-var NAMES + `set: boolean` only (never values).
- `seolite mcp` — stdio MCP server (stdout = protocol only; notes on stderr); `seolite mcp --print json|claude|cursor|vscode [--url <remote>]` — deterministic onboarding payloads.
- `packages/mcp` — `buildMcpServer` registering the five locked tools with strict JSON-Schema-2020-12 inputSchemas (observed on the wire) and concise/detailed response formats; `worker/` serving `POST /mcp` via `createMcpHandler` (stateless, per-request server), the REST subset, typed error envelope, BYOK header pass-through, no telemetry, bundle ≤ 1.5 MB gzip.
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

Dependency direction (enforced by imports and the providers aspect's subpath-export contract):

```
packages/cli  ──▶ @seolite/mcp (buildMcpServer, onboard payloads, testkit)
      │        ──▶ @seolite/audit (AuditRunner adapter — rebase commit), @seolite/providers (barrel)
      │        ──▶ @seolite/core (config, SPI types, HistoryStore interface, Fetcher)
packages/mcp  ──▶ @seolite/core only (server factory knows SPI types, never vendors)
  mcp/worker  ──▶ @seolite/providers/{pagespeed,crux,google-suggest,wikipedia-demand,openpagerank}
                 (subpath exports ONLY — never the barrel, which imports cheerio-dependent ddg-serp)
```

Three composition roots wire one factory:

1. **Node/stdio (CLI):** `seolite mcp` → `buildMcpServer(nodeComposition())` + `StdioServerTransport`. Deps: full provider registry (barrel), `AuditRunner` (from `@seolite/audit` via `src/ports.ts`), `PageMetaFetcher`, `JsonlHistoryStore`.
2. **Worker HTTP:** per request — `buildMcpServer(workerComposition(headers, env))` → `createMcpHandler(server)(request, env, ctx)` (documented stateless pattern, B8). Deps: Worker-safe provider subpaths with per-request header keys; no audit/serp/meta/history → `audit_site`/`rank_check` return `LOCAL_ONLY_CAPABILITY`.
3. **Tests:** `buildMcpServer(testComposition())` with fixture providers from `@seolite/mcp/testkit` (deterministic, zero network).

CLI shape: `bin/seolite.js` (shebang, `process.exitCode = await run(argv.slice(2))` — never `process.exit()` on success paths, so stdout flushes) → `src/args.ts` dispatcher (`node:util parseArgs`, strict) → `src/cmd/*.ts` → `src/run.ts` exit envelope. Human output goes through `src/term.ts` sanitizer (I13); JSON output is a single `JSON.stringify` document.

History: `JsonlHistoryStore implements HistoryStore` (core interface) — append-only JSONL, in-process promise-queue mutex, size-triggered single-generation rotation, crash-tolerant reads (skip malformed trailing line).

Worker: `worker/index.ts` routes (`/healthz`, `/api/v1/*`, `POST /mcp`, CORS preflight), `worker/composition.ts` (per-request instances), `worker/capping-fetcher.ts` (Content-Length pre-check + streaming abort at 2.5 MB wrapping the core Fetcher), error envelope `{error:{code,message,provider?}}`.

## Design Analysis

### Invariants → mechanism

| Invariant | Mechanism on this surface |
|---|---|
| I1 zero-cost | BYOK env NAMES in config, resolved at call time (`process.env[name]` inside handlers); header keys on Worker; absent key → provider contributes an `unconfigured`/`unavailable` marker, never a keyless call to CrUX/OPR (providers own endpoint rules; surfaces own the pass-through). |
| I2 pluggability | CLI/MCP tools consume SPI interfaces; composition roots inject. Unknown provider name → registry validation error (core) surfaced as exit 2 listing available names. Tool/CLI surface never changes when providers change. |
| I3 honesty | Locked concise output shapes (E8) include `source{provider,kind}`, `estimateLabel`, `attribution[]`, `limitations[]`; unavailable fields are omitted or `{"status":"unavailable","reason":…}` — never zero. |
| I5 parity | Single `buildMcpServer`; both transports register all five tools; `response_format` on all; REST is the locked subset only; per-transport capability reflected in tool descriptions. |
| I6 thin Worker | Export-map subpath imports (no barrel/cheerio/audit in Worker bundle — asserted by a bundle-scan test), per-request composition, capping Fetcher, `WORKER_ENABLE_PSI` kill-switch, size check script, no KV/DO. |
| I8 attribution | Providers carry `attribution` metadata; surfaces propagate it into `attribution[]` arrays in every output containing CrUX/Tranco/OPR-derived data. |
| I9/I10 determinism | Fixture providers; injected clock (`retrievedAt` from injected `now()` in tests, real clock in production); size-based rotation; snapshot tests for onboarding payloads. |
| I12 SSRF | `validatePublicHttpUrl()` applied to every CLI URL arg, tool `url` param, and REST `?url=`: http/https only, private/loopback/link-local/ULA refused, IDN normalized — before any use or echo. |
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
- **Cancellation:** SIGINT (CLI) or client `notifications/cancelled` (stdio) → AbortSignal → prompt stop; partial audit labeled `incomplete:true`; no history record written for an aborted rank check.
- **Crash safety:** history reader skips a malformed trailing line; `--out` uses temp+rename so no partial report file ever exists under the target name.

### Blast radius

- `@seolite/mcp` depends only on `@seolite/core` — core shape changes fail typecheck here immediately (fast, contained).
- Worker isolation: because the Worker imports only provider subpaths, a cheerio leak into the Worker bundle is impossible unless someone adds a barrel import — guarded by a bundle-scan test (fails if `cheerio` or `@seolite/audit` appears in the emitted worker bundle) and the size check (cheerio would blow the 1.5 MB cap).
- CLI's audit/provider coupling is confined to one adapter module (`src/composition/audit-adapter.ts`) behind `ports.ts`; the merge/rebase touches exactly that module + `package.json` deps.
- Exit-code and output-shape contracts are consumed by CI users and the site docs — changes to E1/E8 are breaking and require an ARCHITECTURE bump first.

### Alternatives considered

1. **CLI framework — commander / yargs / cac vs args-only.** Chosen deliberately: **args-only** on Node 22 built-in `node:util parseArgs` (strict mode). Justification: zero runtime dependencies (npx cold-start stays minimal — the lightweight ethos), no hidden behaviors to fight for exit codes, deterministic usage errors, and the command set is fixed and tiny (7 commands, ≤5 flags each). Accepted costs: hand-written help text, no auto-completion, manual type coercion — all acceptable at this scale and covered by usage-error tests. commander rejected (+dep, still manual exit-code work); yargs rejected (heaviest); cac rejected (dep for marginal gain).
2. **MCP registration — low-level `Server` + hand-rolled JSON Schema validation vs `McpServer.registerTool` + Zod.** Chosen: `McpServer.registerTool` with Zod strict shapes, with schema truth asserted on the wire (`tools/list` structural + golden tests, E7/B7). Rejected low-level: reimplements validation (bug surface), risks `createMcpHandler` compatibility (documented for `McpServer`), saves only ~60 lines. ajv rejected (bundle weight, no need).
3. **Remote MCP — `createMcpHandler` stateless (locked) vs deprecated `McpAgent` vs hand-rolled Streamable HTTP.** `McpAgent` forbidden by ARCHITECTURE (verbatim deprecated, feature-frozen); hand-rolled rejected (protocol surface: SSE, resumability, origin validation).
4. **Tool results — JSON-in-text vs `structuredContent`+`outputSchema`.** Chosen JSON-in-text for v1 (B2): no duplicated schema maintenance; upgrade path is compatible (names/schemas locked).
5. **History — JSONL vs SQLite vs single JSON file.** JSONL locked by ARCHITECTURE (append-only, no native deps, grep-able, rotation trivial). SQLite rejected for v1 (native/bundled dependency, migration weight); single-JSON rejected (rewrite races vs append).
6. **Worker provider imports — barrel vs subpath exports.** Subpath exports required from the providers aspect; barrel import would drag cheerio into the Worker. Enforced by bundle-scan test.
7. **Onboarding payload builders — here vs site/docs tooling.** Here: single source of truth, snapshot-tested, importable; site/docs consume the outputs (no drift).

### Defaults (locked by this plan)

| Default | Value | Rationale |
|---|---|---|
| `failThreshold` | `error` | Only error-severity issues gate by default; opt into warning-gating via config/flag (B3, reconciled) |
| `maxPages` (audit flag default) | core config default (100) applies when flag omitted | B14, reconciled |
| `response_format` | `concise` | Agent-first high signal |
| `strategy` (page report) | `mobile` | PSI default, SEO-relevant |
| keyword/ideas `limit` | 20 (max 50) | Small tool results |
| rank `limit` | 20 (max 50) | Bounded SERP fetch |
| history file rotation | 1 MiB, 1 generation | Deterministic, bounded growth (B4) |
| history root | `./.seolite/history` | E4/B13 |
| upstream body cap (Worker) | 2.5 MB | CPU headroom under 10 ms (B10) |
| Worker bundle self-cap | 1.5 MB gzip (platform 3 MB) | E10 |
| `WORKER_ENABLE_PSI` | `"true"` | Kill-switch available (B10) |
| SIGINT exit code | 2 (`cancelled`) | E1/E14 |
| not-found rank | exit 0, `found:false` | B11 |

## Resource & Cost Analysis

- **Worker script size (platform 3 MB gzip):** bundle = MCP SDK + `agents` (`createMcpHandler`) + 5 Worker-safe providers + server factory. No cheerio (its parse5 graph alone approaches the cap), no audit engine. Self-cap 1.5 MB gzip enforced by `npm run check:size -w @seolite/mcp` (wrangler dry-run build → gzip → assert). Expected actual: well under 500 KB; the cap exists to fail loudly before platform 1102/limit errors.
- **CPU (10 ms ceiling):** per-request work = URL validation (µs), header reads, JSON parse/serialize of small payloads, provider I/O (not CPU-billed). Only risk: PSI responses (large Lighthouse JSON). Mitigations: capping Fetcher (2.5 MB pre-check + stream abort), `WORKER_ENABLE_PSI` kill-switch, measured at M2 deploy; `CrUX`/`suggest`/`wikipedia`/`OPR` responses are small (KB). No HTML parsing, no crawling, no crypto beyond sha256-free paths (no hashing on the Worker).
- **Subrequests:** ≤ 4/request typical (limit 50); **requests/day:** 100k free (thin gateway, stateless — no DO/KV reads); **KV writes:** zero (limit 1k/day avoided entirely by not using KV).
- **CLI cost:** no resident processes; history bounded by rotation (~2 MiB/domain worst case); `tsc` build only, no bundler.
- **CI:** Vitest + Miniflare run fully local/free on public-repo Actions; no secrets needed for this aspect's suite (deploy gating is ci-deploy's scope).
- **Deps added:** `@seolite/cli`: `@seolite/{core,mcp}` (+ `@seolite/{audit,providers}` at rebase commit); `@seolite/mcp`: `@modelcontextprotocol/sdk`, `agents`, `zod` (shared with SDK). Dev: `vitest`, `@cloudflare/vitest-plugin` (Vitest ≥ 4.1), `wrangler` (build/size check only). No CLI framework (B1).

## Phases

### Phase 1 — CLI skeleton: dispatcher, exit envelope, `--json`, terminal sanitizer, `config show`

Changes (files + snippets only):

- `packages/cli/package.json` — name/bin/engines/scripts (B16, B20).

```json
{
  "name": "@seolite/cli", "type": "module", "version": "0.1.0",
  "engines": { "node": ">=22" },
  "bin": { "seolite": "./bin/seolite.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "dependencies": { "@seolite/core": "*", "@seolite/mcp": "*" }
}
```

- `bin/seolite.js`, `src/args.ts`, `src/run.ts`, `src/term.ts`, `src/cmd/config-show.ts`.

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

- [ ] Automated: `npm test -w @seolite/cli` — dispatcher tests (unknown command/flag → exit 2 + usage on stderr), exit-envelope tests for all three codes, `--json` single-document contract, sanitizer tests (CSI/OSC/C0 stripped, length cap), `config show` masking test (sentinel env value never in stdout), `--config`/`SEOLITE_CONFIG` resolution tests (B12).
- [ ] Automated: `npm run typecheck -w @seolite/cli` and `npm run lint`.

### Phase 2 — JSONL HistoryStore + `rank`, `keywords`, `authority`

Changes:

- `src/history/jsonl-store.ts`, `src/cmd/{rank,keywords,authority}.ts`, `src/composition/node.ts` (fixture injection for tests).

```ts
// src/history/jsonl-store.ts (E4, B4, B5, B6)
import { domainToASCII } from "node:url"; import { createHash } from "node:crypto";
export function domainDir(root: string, domain: string): string {
  const ascii = domainToASCII(domain.toLowerCase()) ?? "";
  if (!ascii) throw new ConfigError(`invalid domain: ${domain}`);      // I15
  const slug = ascii.replace(/[^a-z0-9.-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "domain";
  const h = createHash("sha256").update(ascii).digest("hex").slice(0, 8);
  return path.join(root, "rank", `${slug}-${h}`);
}
export class JsonlHistoryStore implements HistoryStore {
  #queue = Promise.resolve();                                          // in-process mutex (E13)
  constructor(private root: string, private maxBytes = 1_048_576) {}
  appendRank(rec: RankRecord): Promise<void> {                         // one O_APPEND write per record
    return (this.#queue = this.#queue.then(() => this.#append(rec)));
  }
  readRank(domain: string, limit: number): Promise<RankRecord[]> { /* rotate-aware, skip malformed trailing line */ }
  async #append(rec: RankRecord) {
    const dir = domainDir(this.root, rec.domain); await mkdir(dir, { recursive: true });
    const file = path.join(dir, "history.jsonl");
    if (await sizeOf(file) >= this.maxBytes) await rename(file, file + ".1").catch(() => {}); // .1 overwritten
    await appendFile(file, JSON.stringify(rec) + "\n", "utf8");
  }
}
```

```ts
// src/cmd/rank.ts — B11: not-found is success; E14: append only after successful search
const res = await deps.serp.search(keyword, { limit });
const hit = res.results.find(r => sameDomain(r.url, domain)) ?? null;
if (!flags["no-save"]) await deps.history.appendRank({ v: 1, retrievedAt: clock(), keyword, domain,
  found: !!hit, position: hit?.position ?? null, provider: res.source.provider, url: hit?.url, limit });
const result = { keyword, domain, found: !!hit, position: hit?.position ?? null,
  matchedUrl: hit?.url, provider: res.source.provider, retrievedAt: res.source.retrievedAt };
if (args.response_format === "detailed") result.recentHistory = await deps.history.readRank(domain, 10);
out.json(result); // human mode renders position + trend line via clean()
```

Success Criteria

- [ ] Automated: `npm test -w @seolite/cli` — history tests: append/rotate semantics (rotate at 1 MiB, `.1` overwritten on second rotation, newest-last read), path-safety (IDN `münchen.de`, domains with `:`/unicode/spaces → safe deterministic dirnames, B5), malformed-trailing-line tolerance, 25-way concurrent append integrity, `--no-save` writes nothing; command tests via fixture SerpProvider/KeywordProvider/AuthorityProvider: provenance fields present (I3), not-found → exit 0 `found:false`, provider error → exit 2 with provider name (I17).
- [ ] Automated: `npm run typecheck -w @seolite/cli`.

### Phase 3 — `audit` + `report` commands and the ports seam

Changes:

- `src/ports.ts`, `src/cmd/{audit,report}.ts`, `src/write-atomic.ts`; `src/composition/audit-adapter.ts` lands with fixture runner in this phase and is swapped to `@seolite/audit` in Phase 6's rebase commit (merge order P2 → P3 → P4; branch stays core-only until then).

```ts
// src/ports.ts — the seam that keeps this branch core-only until rebase
export interface AuditRunner { run(input: AuditInput, signal?: AbortSignal): Promise<SiteAuditReport> }
export interface PageMetaFetcher { fetch(url: URL, signal?: AbortSignal): Promise<PageMeta | null> }
```

```ts
// src/cmd/audit.ts — E1 gate: worst severity >= threshold OR incomplete -> 1
const report = await deps.auditRunner.run({ url, maxPages: flags["max-pages"] ?? undefined, signal });
const rank = { info: 0, warning: 1, error: 2, critical: 3 };
const threshold = flags["fail-threshold"] ?? cfg.failThreshold ?? "error";
const worst = Math.max(0, ...report.pages.flatMap(p => p.issues.map(i => rank[i.severity])));
const gateFailed = report.incomplete || worst >= rank[threshold];
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

- [ ] Automated: `npm test -w @seolite/cli` — exit-code matrix with fixture audit runner (0 clean / 1 at-threshold for each of the four severities + incomplete / 2 config+provider+usage), `failThreshold` config-vs-flag precedence, `--out` atomic write (no temp leftovers, target never partially written), `incomplete:true` labeling on fixture cancellation (E14), `--max-pages` plumbing, `report` unavailable-field rendering (BYOK absent → `unavailable`, exit 0, I1/I3).
- [ ] Automated: `npm run typecheck -w @seolite/cli`.

### Phase 4 — MCP server factory: five tools, schemas, stdio transport, onboarding payloads

Changes:

- `packages/mcp/package.json` (deps: `@modelcontextprotocol/sdk`, `zod`; dev: `vitest`), `src/server.ts`, `src/schemas.ts`, `src/local-only.ts`, `src/onboard.ts`, `src/testkit/*` (fixture providers, in-process transport harness, spawn helper), `packages/cli/src/cmd/mcp.ts`.

```ts
// packages/mcp/src/server.ts — one factory, both transports (I5/E6/E7)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
const RF = z.enum(["concise", "detailed"]).default("concise");
export interface McpDeps {
  clock: () => string;
  keyword: KeywordProvider; authority: AuthorityProvider[];
  serp?: SerpProvider; pageSpeed?: PageSpeedProvider; crux?: CruxProvider;
  auditRunner?: AuditRunner; pageMeta?: PageMetaFetcher;
}
export function buildMcpServer(deps: McpDeps): McpServer {
  const s = new McpServer({ name: "seolite", version: "0.1.0" });
  s.registerTool("seolite_audit_site", {
    title: "Bounded site audit",
    description: deps.auditRunner ? AUDIT_DESC : AUDIT_DESC + LOCAL_ONLY_NOTE,
    inputSchema: { url: z.string().min(1), maxPages: z.number().int().min(1).max(500),
      failThreshold: z.enum(["info", "warning", "error"]).default("error"), response_format: RF },
  }, async (args, extra) => deps.auditRunner
      ? ok(await runAuditSite(deps, args, extra.signal))
      : localOnly("seolite_audit_site", "npx @seolite/cli audit <url>"));
  // seolite_page_report (url, strategy mobile|desktop, includeCrux, response_format)
  // seolite_keyword_ideas (seed 1..120, lang, limit 1..50, response_format)
  // seolite_rank_check (keyword, domain, limit, response_format) — local-only when deps.serp absent
  // seolite_authority (domain, response_format)
  return s;
}
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
// packages/cli/src/cmd/mcp.ts — stdio launcher + --print (E2: stdout is protocol only)
if (flags.print) { io.out(onboardPayload(flags.print, flags.url) + "\n"); return EXIT.OK; }
const server = buildMcpServer(nodeComposition());
await server.connect(new StdioServerTransport());
io.err("seolite mcp: stdio transport ready");                        // stderr ONLY
await new Promise(() => {});                                        // until stdin closes / signal
```

- `src/testkit/` — fixture providers implementing core SPI (deterministic `KeywordIdea[]`, `SerpResult[]`, `AuthoritySignal[]`, `PageSpeedReport`, `CruxRecord`), `InMemoryTransport` client harness, `spawnCli(args, env)` helper.

Success Criteria

- [ ] Automated: `npm test -w @seolite/mcp` — wire contract tests via `tools/list` (exactly the five locked names; `inputSchema.type === "object"`, `additionalProperties: false`, `required` exactly as locked, enums/bounds/defaults present; E7), invalid-args calls rejected with typed messages, `response_format` default concise present on all five, local-only typed errors for `audit_site`/`rank_check` in the no-deps composition (`code: "LOCAL_ONLY_CAPABILITY"`, message names the CLI), concise vs detailed shape diffs per E8, provenance present (I3).
- [ ] Automated: `npm test -w @seolite/cli` — stdio round-trip via `spawnCli(["mcp"])`: initialize → tools/list → tools/call over the real child-process stdio; stdout contains only JSON-RPC frames (startup note is on stderr); snapshot tests for all 8 onboarding payloads (4 targets × local/remote) — deterministic strings, no key material.
- [ ] Automated: `npm run typecheck -w @seolite/mcp`.

### Phase 5 — Worker: `createMcpHandler` stateless HTTP + REST subset + size budget

Changes:

- `packages/mcp/worker/{index.ts,composition.ts,capping-fetcher.ts,rest.ts,cors.ts}`, `worker/wrangler.jsonc`, `vitest.worker.config.ts`, `scripts/check-size.mjs`, `package.json` scripts (`test:worker`, `build:worker`, `check:size`), dev deps `@cloudflare/vitest-plugin` (Vitest ≥ 4.1), `wrangler`.

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
import { workerComposition } from "./composition.js";
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return corsPreflight(url.pathname);
    if (url.pathname === "/healthz") return json({ ok: true });
    if (url.pathname === "/api/v1/page-report") return pageReportRoute(request, env);
    if (url.pathname === "/api/v1/keyword-ideas") return keywordIdeasRoute(request, env);
    if (url.pathname === "/mcp" && request.method === "POST") {
      const server = buildMcpServer(workerComposition(request.headers, env)); // fresh per request (E13)
      return withCors(await createMcpHandler(server)(request, env, ctx));
    }
    return errorJson("NOT_FOUND", 404, "unknown route");
  },
} satisfies ExportedHandler<Env>;
```

```ts
// packages/mcp/worker/composition.ts — E6 capability map; E5 header pass-through (never logged/stored)
export function workerComposition(headers: Headers, env: Env): McpDeps {
  const key = (h: string) => headers.get(h) ?? undefined;   // read-only peek; never persisted, never echoed
  return {
    clock: () => new Date().toISOString(),
    keyword: new GoogleSuggestProvider({ fetcher: cappingFetcher }),   // + wikipedia-demand: keyless, JSON
    pageSpeed: new PageSpeedProvider({ fetcher: cappingFetcher, apiKey: key("x-seolite-psi-key") }),
    crux: new CruxProvider({ fetcher: cappingFetcher, apiKey: key("x-seolite-crux-key") }),
    authority: [new OpenPageRankProvider({ fetcher: cappingFetcher, apiKey: key("x-seolite-opr-key") })],
    // no serp, no auditRunner, no pageMeta, no history -> audit_site/rank_check = LOCAL_ONLY_CAPABILITY
  };
}
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
import { gzipSync } from "node:zlib"; import { statSync, readFileSync } from "node:fs";
const file = new URL("../dist/worker.js", import.meta.url);
const gz = gzipSync(readFileSync(file)).length;
const LIMIT = 1_572_864;
console.log(`worker bundle ${(gz / 1024) | 0} KiB gzip / limit ${LIMIT / 1024 | 0} KiB`);
if (gz > LIMIT) { console.error("WORKER BUNDLE OVER SELF-CAP — remove a dependency or raise cap consciously"); process.exit(1); }
```

- Bundle-scan test (part of `npm test -w @seolite/mcp`): parses the esbuild metafile/wrangler output and fails if `cheerio` or `@seolite/audit` appears in the Worker module graph.

Success Criteria

- [ ] Automated: `npm run test:worker -w @seolite/mcp` — Miniflare (self-fetch): `tools/list` over `POST /mcp` returns the identical five-tool set (parity assertion vs stdio fixture), `tools/call seolite_audit_site` and `seolite_rank_check` → `LOCAL_ONLY_CAPABILITY` typed error naming `npx @seolite/cli`; `seolite_page_report` serves PSI/CrUX fixtures only and includes the local-only limitation string; `/api/v1/page-report?url=` validates URLs (http/https only, private ranges → 400 `INVALID_URL`) and never issues an outbound request to the target (outbound recorder proves it); `/api/v1/keyword-ideas?q=` serves fixture suggestions; `/healthz` → `{"ok":true}`; unknown route → 404 envelope; GET on `/mcp` without session → typed protocol error; BYOK headers reach provider fixtures and never appear in any response body (E5/I16); outbound recorder enumerates only allowlisted hosts and zero calls when no keys are sent (I1).
- [ ] Automated: `npm run check:size -w @seolite/mcp` — bundle under self-cap; bundle-scan test green (no cheerio/@seolite/audit in Worker graph).
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

- `packages/cli/package.json` + `src/composition/audit-adapter.ts`: the rebase commit — adds `@seolite/audit` + `@seolite/providers` workspace deps and swaps the fixture `AuditRunner`/`PageMetaFetcher` for the real engine implementations (guaranteed to exist by merge order P2 → P3 → P4).
- M2 handoff checklist embedded in this phase's test suite: CLI smoke fixture HTTP server entry (`testkit/spawnCli` already used), MCP inspector smoke instructions (docs aspect references them).

Success Criteria

- [ ] Automated: `npm test -w @seolite/cli` — SIGINT mid-audit (fixture runner honors AbortSignal) → prompt stop, `incomplete:true` report written atomically when `--out`, exit 2; 25 concurrent `rank` invocations → 25 intact history lines; no-telemetry test: global `fetch` stubbed to throw, every command + tool run with fixture providers → zero direct fetch calls, recorded-Fetcher call list matches the allowlist exactly (I16); sentinel-key grep over all command outputs.
- [ ] Automated: `npm test -w @seolite/mcp` — client-cancelled tool call (InMemoryTransport `notifications/cancelled`) resolves promptly with partial/no side effects; CORS preflight tests on worker config-level unit tests; bundle-scan + size still green.
- [ ] Automated: `npm run test:worker -w @seolite/mcp`, `npm run check:size -w @seolite/mcp`, `npm run lint` (fetch-restriction rule active), `npm run typecheck -w @seolite/cli && npm run typecheck -w @seolite/mcp`.

## Testing Strategy

All deterministic (I9/I10): fixture providers from `@seolite/mcp/testkit`, injected clock, no live network. Layers: unit (Vitest, Node), in-process transport (`InMemoryTransport`), real stdio (child-process spawn of the CLI bin), Worker (Miniflare self-fetch + outbound recorder).

| Edge / invariant | Test (file :: case) | Layer |
|---|---|---|
| Unknown command/flag, bad URL arg (I15) | `cli/test/args.test.ts` :: usage-error-maps-to-exit-2 | unit |
| Exit 0/1/2 matrix incl. `failThreshold` severities (E1) | `cli/test/exit-codes.test.ts` :: threshold-gate-matrix | spawn |
| `incomplete:true` forces exit 1 (E1) | `cli/test/exit-codes.test.ts` :: incomplete-fails-gate | spawn |
| SIGINT → prompt stop, labeled partial, exit 2 (E14) | `cli/test/cancellation.test.ts` :: sigint-stops-and-labels | spawn |
| `--json` = exactly one JSON doc, trailing newline (E2) | `cli/test/json-contract.test.ts` :: single-document | spawn |
| ANSI/C0–C1 sanitization + length cap (I13) | `cli/test/term.test.ts` :: strips-escape-sequences | unit |
| History append/rotate: 1 MiB, `.1` overwritten, newest-last (E4/B4) | `cli/test/history.test.ts` :: rotate-semantics | unit |
| Path-safe domain dirnames: IDN, unicode, `:`, spaces (I13/B5) | `cli/test/history.test.ts` :: domain-dirname-safety | unit |
| Malformed trailing line skipped on read (E4) | `cli/test/history.test.ts` :: crash-tolerant-read | unit |
| 25 concurrent appends → 25 intact lines (E13/B6) | `cli/test/history.test.ts` :: concurrent-append-integrity | unit |
| `--no-save` writes nothing; append only on success (E14) | `cli/test/rank.test.ts` :: no-save-and-failure-no-append | unit |
| BYOK absent → `unavailable`, exit 0, no keyless call (I1/I3) | `cli/test/report.test.ts` :: unconfigured-provider-degrades | unit |
| `config show` prints names + set:boolean, never values (E5) | `cli/test/config-show.test.ts` :: byok-masking | unit |
| Sentinel env key value never in any stdout (I16) | `cli/test/no-telemetry.test.ts` :: sentinel-key-grep | spawn |
| Zero outbound except enumerated Fetcher calls; global fetch throws (I16) | `mcp/test/no-telemetry.test.ts` :: outbound-allowlist | unit |
| Wire schemas: 5 names, additionalProperties:false, required/enums/bounds/defaults (E7) | `mcp/test/schema-contract.test.ts` :: tools-list-wire-schema | in-process |
| Invalid tool args → typed validation error (E7/I15) | `mcp/test/schema-contract.test.ts` :: invalid-args-rejected | in-process |
| Local-only typed error, CLI pointer, description note (E6/I6) | `mcp/test/capabilities.test.ts` :: local-only-typed-error | in-process |
| concise vs detailed shapes per E8, provenance everywhere (I3) | `mcp/test/output-shapes.test.ts` :: response-format-diff | in-process |
| stdio round-trip via real spawned bin; stderr-only notes (E2) | `cli/test/stdio-roundtrip.test.ts` :: spawn-initialize-list-call | spawn |
| 25 interleaved tool calls incl. rank saves (E13) | `mcp/test/concurrency.test.ts` :: interleaved-calls | in-process |
| Client cancellation (`notifications/cancelled`) (E14) | `mcp/test/concurrency.test.ts` :: client-cancel | in-process |
| Onboarding payloads: 8 deterministic snapshots, no keys (E11/B15) | `mcp/test/onboard.test.ts` :: payload-snapshots | unit |
| Worker: `tools/list` parity, local-only over HTTP, REST subset, 404/405 (E6/E9) | `mcp/worker/worker.test.ts` :: parity-and-rest | Miniflare |
| Worker: `?url=` validation, target never fetched (I12/I6) | `mcp/worker/worker.test.ts` :: target-url-never-fetched | Miniflare |
| Worker: BYOK headers forwarded, never echoed; no keys → zero PSI/CrUX outbound (E5/I1) | `mcp/worker/worker.test.ts` :: header-passthrough | Miniflare |
| Worker: outbound host allowlist; nothing else (I16) | `mcp/worker/worker.test.ts` :: outbound-recorder-allowlist | Miniflare |
| Oversize upstream rejected before read (I6/B10) | `mcp/worker/capping-fetcher.test.ts` :: content-length-and-stream-cap | unit |
| Bundle excludes cheerio/@seolite/audit; ≤ 1.5 MB gzip (E10/I6) | `mcp/test/bundle-scan.test.ts` + `check:size` | build |

## References

- Research: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/research/2026-08-29-seolite-greenfield-research.md` — Seam 4 (createMcpHandler stateless pattern; McpAgent deprecated; stdio/HTTP pairing; onboarding deep-links; tool-design guidance: namespacing, consolidation, concise/detailed, JSON Schema 2020-12); Workers free limits (10 ms CPU, 3 MB gzip, 50 subrequests); `@cloudflare/vitest-plugin` (Vitest ≥ 4.1, Miniflare); I5/I6/I13/I16 invariants.
- Architecture: `/Users/nagarwal/repos/learn/seolite/thoughts/shared/plans/2026-08-29-seolite/ARCHITECTURE.md` — locked tool/command names, exit codes, REST subset, Worker thin-gateway rule, package table, M1 merge order.
- Implicit spec (this bundle): `./IMPLICIT_SPEC.md` — E1–E14 edges, B1–B20 bounding assumptions.
- Cloudflare: developers.cloudflare.com/agents/model-context-protocol/ (createMcpHandler stateless recommended pattern); developers.cloudflare.com/workers/platform/limits/ (10 ms CPU, 3 MB gzip, 50 subrequests, KV 1k writes/day); developers.cloudflare.com/workers/testing/ (vitest plugin, fully local).
- MCP: modelcontextprotocol.io/specification (Streamable HTTP, tool inputSchema JSON Schema 2020-12, tool naming per SEP-986 as recorded in research); github.com/modelcontextprotocol/typescript-sdk (McpServer, registerTool, StdioServerTransport, InMemoryTransport).
- Anthropic tool-design guidance (high-signal output, response_format concise/detailed) — as captured in research Seam 4.
- Vendor onboarding: cursor.com/docs/mcp/install-links (`cursor://anysphere.cursor-deeplink/mcp/install?…` base64 config); code.visualstudio.com MCP docs (`vscode:mcp/install?{json}`); code.claude.com/docs/en/mcp (`claude mcp add --transport stdio … -- <cmd>`); `mcp-remote` bridge for stdio-only clients (documented, not depended on).
- Node: nodejs.org/api/util.html#utilparseargsargs-options (strict parseArgs — B1 foundation); nodejs.org/api/url.html#urldomaintoasciidomain (IDN normalization — B5).
- Zod: zod.dev (v4; shared with the MCP SDK dependency — B7).
