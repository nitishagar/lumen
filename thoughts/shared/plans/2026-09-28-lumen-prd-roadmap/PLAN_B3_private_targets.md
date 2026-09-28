<!-- SIGNPOST | 2/5: PLAN | single source of truth; implementation must conform — divergence means amending this file in the same change, not improvising
     Prev: IMPLICIT_SPEC_B3_private_targets.md | Next: PLAN_B3_VALIDATION.md -->
# Bundle 3 — Private-target opt-in (`--allow-private`): Implementation Plan
scale: medium

## Overview

Give the SSRF guard a *scoped* relaxation: a pure, core-owned `SsrfPolicy` that permits private/loopback hosts **only at the seed's origin**, activated by CLI flag `--allow-private` (+ config `crawl.allowPrivateHosts` for non-loopback ranges) on audit/report, launch-time-only on `lumen mcp`, and structurally absent from the Worker. Plus FR-4 (loopback politeness default 0, `target.scope` on reports) and FR-5 (`--canonical-origin` suppresses `insecure-http` on private pages). Security review = BLOCKING gate.

## Current State

(all [V] from IMPLICIT_SPEC_B3; tree @ e88d180)

## Desired End State

`lumen audit http://localhost:4321 --allow-private` works end-to-end (real spawn against a loopback server); every other private target still refused; the three AC adversaries refused; `target.scope` rides on reports; loopback audits don't flood insecure-http with `--canonical-origin`; all contract gates green; Worker provably unchanged.

## What We're NOT Doing

- No Worker changes (rest.ts untouched; no policy construction reachable from the worker bundle).
- No MCP tool-schema change (strictArgs already rejects unknown args — that IS the tool-arg adversary's refusal).
- No canonical-target-matching rule (does not exist; Bundle 6 territory).
- No DNS-rebinding ToCToU fix (documented out of scope v1; the policy does not change the resolve-then-check structure).

## Approach

Core owns the policy type + factory (pure, Worker-safe). The fetcher grows ONE optional option whose default preserves today's behavior bit-for-bit. Composition threads the policy to the two fetcher factories. Admission (`validatePublicHttpUrl`) gains an optional policy parameter — callers that don't pass one are unchanged (Worker, all providers).

## Design Analysis

- **Invariants → mechanism**: SSRF-per-hop → policy consulted INSIDE `assertHopAllowed` for both the host check and the resolved-IP check (same call sites, same typed errors); origin scoping → the policy factory closes over `seedOrigin` and every `allowHost/allowIp` decision first requires `url.origin === seedOrigin.origin`; launch-time-only MCP → flag parsed once in cmd/mcp.ts, baked into server deps at construction; Worker refusal → no code path constructs a policy in the worker bundle (asserted by a source-level worker ban + e2e REST refusal test (per the I2 amendment)); `0.0.0.0/0` → loud ConfigError at policy construction AND config load.
- **Failure edges**: policy construction throws ConfigError on malformed entries (bad CIDR syntax, prefix >32/>128, `/0` allow-everything) — surfaces as exit 2 before any fetch. `allowIp` is checked per resolved IP of the host being contacted; resolution failure still refuses (unchanged). Flag without loopback seed: harmless (policy allows nothing extra at a public seed origin).
- **Simplicity guardrails**: no new deps; CIDR math reuses ssrf.ts parsers (v4 int, v6 bigint) + prefix compare; policy is 2 pure functions; no abstraction beyond one type + one factory.
- **Blast radius**: `FetcherOptions` (+1 optional field, default undefined), `validatePublicHttpUrl` (+1 optional param), `createAuditRunner`/`createPageMetaFetcher` (+1 optional param), `buildDeps`/`nodeComposition` (+1 optional param), `AuditConfig` (+2 optional fields), report `configSnapshot` (+1 additive field), CLI args/help for audit+report+mcp, config loader `CRAWL_KEYS` (+1 key), locked-names, site docs. Every existing caller compiles unchanged (all additions optional).
- **Interrogation**: *What could break?* (a) the resolved-IP check must know WHICH host resolved — signature `allowIp(url: URL, ip: string)` (per the C1 amendment); (b) `configSnapshot` is compared in json-contract/schema tests — additive field with `target: { scope }` must not break strict shape tests (verify, adjust deliberately if they assert exact keys); (c) `--json` audit payload via MCP `auditPayload` must keep flowing (it maps a subset already); (d) loopback delay-0 heuristic: apply only when resolved `perHostMinDelayMs` equals the DEFAULT (250) — an explicit config value wins (documented honesty edge: explicit-250 is indistinguishable from default-250; acceptable, documented). *Riskiest*: the fetcher policy seam — earliest cheap check = fetcher unit tests with the 3 adversaries. *Options not taken*: env-var opt-in (rejected: invisible, not launch-time-auditable in client configs); per-tool MCP arg (rejected: D3); widening `isBlockedHost` itself with a global allowlist (rejected: pollutes every caller incl. Worker).
- **Verification design**: pure unit tests for the policy factory + CIDR parser (matrix: flag-only loopback, config hostnames, config CIDRs, /0 refusal, malformed refusal, origin scoping); fetcher-level adversary tests (redirect-to-metadata, DNS-rebind, resolution-failure, non-seed-origin private link); engine tests (target.scope, delay-0 heuristic, canonical-origin suppression via fake pages); spawn e2e (real `node:http` server on 127.0.0.1:0, exit 0/1 with flag, exit 2 without, message names flag); MCP tool-arg adversary test (wire outcome = SDK protocol rejection, per the I1 amendment); Worker REST loopback refusal test.
- **Default choices**: `--allow-private` on audit + report (PRD names audit; report would otherwise be a surprising cliff on the same URL); `--canonical-origin` on audit only (rules are audit-only).

## Phase 1: core — policy + fetcher seam + config key

### Changes
#### `packages/core/src/private-scope.ts` (new, pure, Worker-safe)
- `type SsrfPolicy = { allowHost(url: URL): boolean; allowIp(url: URL, ip: string): boolean }` (the resolved-IP decision receives the HOP URL so the origin check precedes every allowlist clause — validator C1).
- `createPrivateScopePolicy(opts: { seedOrigin: URL; loopback: boolean; allowHosts?: readonly string[] }): SsrfPolicy`:
  - pre-validates `allowHosts` entries: exact hostname (normalized like `normalizeHost`) or CIDR `a.b.c.d/n` (v4) / `x::/n` (v6, prefix ≤128) — malformed → `ConfigError` naming the entry; `0.0.0.0/0` and `::/0` → `ConfigError` ("would allow every private target").
  - `allowHost(url)`: `url.origin === seedOrigin.origin && (loopback && isLoopbackHostname(url.hostname) || allowlistMatchHostname(url.hostname))` where loopback = `localhost`/`*.localhost`/127/8/::1 literals; allowlist match = exact hostname or host-IP-within-CIDR.
  - `allowIp(url, ip)`: ORIGIN CHECK FIRST (`url.origin === seedOrigin.origin` — the hop URL carries the port), then: loopback IP allowed iff `loopback`; otherwise allowed iff IP falls in a configured CIDR OR the host is an exact allowlist hostname entry.
- Export from core index. Unit tests `private-scope.test.ts`: full matrix incl. `/0` refusals, malformed entries, origin scoping, `.localhost` suffix, IPv6 `::1`, zone-id hosts stay blocked.
#### `packages/core/src/fetcher.ts`
`FetcherOptions` += `allowPrivate?: SsrfPolicy`. In `assertHopAllowed`: `if (isBlockedHost(url.hostname) && !(allowPrivate?.allowHost(url) ?? false)) throw SsrfBlockedError` and per resolved IP: `if (isBlockedIpAddress(ip) && !(allowPrivate?.allowIp(url, ip) ?? false)) throw` (hop URL passed through). Scheme check, resolution-failure refusal, hop cap, header stripping: UNTOUCHED. Fetcher unit tests: 3 adversaries + positive loopback case with a delegate stub (zero live network).
#### `packages/core/src/config.ts`
`CRAWL_KEYS` += `allowPrivateHosts`; loader case validates `string[]`, each entry a valid hostname-or-CIDR (same validation as the factory, shared helper), refuses `/0`; invalid → ConfigError detail `crawl.allowPrivateHosts`. `ResolvedConfig.crawl` type += `allowPrivateHosts: string[]` (default `[]`). Loader test additions.

### Success Criteria
- [ ] `npx vitest run packages/core/src/private-scope.test.ts packages/core/src/fetcher.test.ts packages/core/src/config.test.ts` green; no existing test red.
- [ ] Adversaries 1+2 refused at fetcher level with a policy set; strict default behavior byte-identical when option absent.

## Phase 2: engine + composition threading

### Changes
#### `packages/audit/src/types.ts` + `run.ts`
`AuditConfig` += `canonicalOrigin?: string`; `resolveAuditConfig` validates it parses as http(s) URL (typed error otherwise) and carries it. `SiteAuditReport.configSnapshot` += `target: { scope: 'public' | 'private' }` where private = `isBlockedHost(seed.hostname)` OR (policy exists AND `allowHost(seed)`) — config-allowlisted DNS-name seeds must not be labeled public (I3).
#### `packages/audit/src/rules/technical.ts` + `rule-set.ts`
`insecureHttp(severity, canonicalOrigin?: URL)`: when `canonicalOrigin` is set AND `isBlockedHost(page.url.hostname)` → evaluate against `canonicalOrigin.protocol` instead (i.e., suppress when canonical origin is https). `createRuleSet` passes it through from resolved config. Rule tests updated.
#### `packages/audit/src/crawl/crawler.ts` / `rate-limiter.ts`
No change (delay-0 handled at composition, below).
#### `packages/cli/src/composition/audit-adapter.ts`
`createAuditRunner(config, privateScope?: { loopback: boolean; allowHosts: readonly string[] })`: per `run(input)` — when `privateScope` provided, build `createPrivateScopePolicy({ seedOrigin: input.url, ...privateScope })` and pass a policy-bearing fetcher into `crawlerDeps()`; ALSO: when `isLoopbackHost(input.url.hostname)` and `config.crawl.perHostMinDelayMs === DEFAULT_BUDGETS.perHostMinDelayMs` → run with `perHostMinDelayMs: 0` (FR-4). `createPageMetaFetcher(privateScope?)`: per-call policy with seed = the URL being fetched.
#### `packages/cli/src/composition/node.ts`
`nodeComposition(config, privateScope?)` / `buildDeps(configPathFlag, privateScope?)` thread the option to both factories.

### Success Criteria
- [ ] Engine tests: `target.scope: 'private'` for a loopback seed fixture report, `'public'` otherwise; insecure-http suppressed with canonicalOrigin on a private page, still fires on a public http page; delay heuristic unit test.
- [ ] No existing audit/mcp snapshot red except deliberately reviewed additive fields.

## Phase 3: surfaces — CLI, MCP, contracts

### Changes
#### `packages/cli/src/args.ts` + `help.ts`
`audit` options += `allow-private` (boolean), `canonical-origin` (string); `report` += `allow-private`; `mcp` += `allow-private`. USAGE entries + ROOT usage flag lines. Snapshots regenerated deliberately.
#### `packages/cli/src/cmd/audit.ts`
Build `privateScope` from flag + loaded config (`crawl.allowPrivateHosts`); pass to `buildDeps`; admission `validatePublicHttpUrl(positional, policyForSeed(positional))` — refusal message for a blocked host WITHOUT opt-in names the flag: append `— for local targets pass --allow-private` at the CLI conversion site (UsageError). `--canonical-origin` validated http(s) → UsageError otherwise; passed into `auditRunner` via AuditInput? — NO: via `createAuditRunner` config… concretely: extend the runner factory signature to accept `{ canonicalOrigin?: URL }` alongside privateScope and fold into `auditConfig`.
#### `packages/cli/src/cmd/report.ts`
Same admission + policy threading to `pageMeta` (pageSpeed/crux providers are keyed third-party APIs — unaffected; the legs degrade honestly because the upstream API cannot fetch a loopback URL (lumen still passes it — M3 correction)).
#### `packages/cli/src/cmd/mcp.ts` + `packages/mcp/src/server.ts`
`--allow-private` launch flag → server deps built with a policy factory (`loopback: true` + config allowHosts); the two `validatePublicHttpUrl` calls pass the per-URL policy. Tool schemas untouched. Worker `rest.ts` untouched.
#### Contract files (all in this change)
`locked-names.json`: `cliFlags` += `--allow-private`, `--canonical-origin`; `configKeys` += `crawl.allowPrivateHosts` (match existing key spelling convention). `site/src/pages/docs/cli-reference.astro` flag rows; `site/src/pages/docs/configuration.astro` (allowPrivateHosts + example); site check green. `docs/` no change needed.
#### Tests
- Spawn e2e (`audit-allow-private.spawn.test.ts` or extend existing): `node:http` server on `127.0.0.1:0` serving a fixture page → `spawnCli(['audit', url, '--allow-private', '--max-pages', '1', '--config', tmp])` exit 0/1; same without flag → exit 2 + stderr names `--allow-private`; `--config` with `crawl.allowPrivateHosts: ["127.0.0.0/8"]` also works without the flag; config `0.0.0.0/0` → exit 2.
- MCP adversary: `client.callTool({ name: 'lumen_audit_site', arguments: { url: 'https://example.com', allow_private: true } })` → error (strictArgs).
- Worker: REST loopback request still refused (existing worker test extended).
- No-telemetry suite unchanged (no new commands).

### Success Criteria
- [ ] AC spawn e2e green (exit 0/1 with flag; exit 2 naming flag without).
- [ ] `npm run validate` green.
- [ ] Security review (security-reviewer subagent) PASS — BLOCKING: no path from worker/REST/MCP-tool-arg to private targets; origin scoping sound; no new secret/echo surface.

## Testing Strategy

- Unit: policy matrix, CIDR parser (incl. v6, prefix bounds), config validation, rule suppression, delay heuristic.
- Fetcher-level adversaries with delegate/resolve stubs (zero network).
- Engine-level: fake-page fixtures for target.scope + canonical suppression.
- Spawn-level: real loopback server, real exit codes, message content.
- Contract gates: help snapshots, locked-names, cli-reference, site checks, json-contract (additive field).

## Amendments

See "Amendments (pre-implementation, from PLAN_B3_VALIDATION 2026-09-28 — validator agent_3269b323)" at the end of this file; the normative Phase specs reflect all of them (some Design-Analysis narrative retains pre-amendment wording where the amendments override it).

## References

- PRD §6 E1.1 (FR-1..FR-5, AC), §10 D3
- Research: Seam 2 (SSRF/fetcher/robots/crawler), Seam 3 (CLI/composition/config), HC1
- Conventions: `ssrf.ts` pure-guard style, `url-guard.ts` admission shape, `audit-adapter.ts` factory pattern

## Amendments (pre-implementation, from PLAN_B3_VALIDATION 2026-09-28 — validator agent_3269b323)

- AMENDED Phase 1 [C1, Critical]: `SsrfPolicy.allowIp` signature is `allowIp(url: URL, ip: string)` — NOT `(host, ip)`. The resolved-IP check in `assertHopAllowed` passes the HOP URL, so the origin check (`url.origin === seedOrigin.origin`) provably precedes every allowlist clause. A `(host, ip)` signature loses the port and would let a redirect to `staging.internal:9999` (same host, different origin) reach the allowlist-hostname clause. Origin check first, always.
- AMENDED Phase 3 [I1]: swarm corpus gains `tool-arg-tries-to-enable-private` (`lumen_audit_site {url, allow_private:true}` → expect `{isError: true, textContains: ['-32602', 'Unrecognized key', 'allow_private']}` — the SDK validates the z.strictObject schema BEFORE the handler, so the wire outcome is the protocol rejection, exactly as the existing `unknown-arg-rank` case scores). The other two AC adversaries (redirect-to-metadata, DNS-rebind-to-private) are exercised at fetcher/spawn level, NOT corpus level — the fixture-backed corpus harness cannot express transport-level redirects/rebinds; recorded here so the AC is traceable.
- AMENDED Phase 3 [I2]: "Worker provably unchanged" is asserted two ways: (a) SOURCE-level ban in the extended `packages/mcp/src/bundle-scan.test.ts` — no file under `packages/mcp/worker/` may reference `createPrivateScopePolicy` or `allowPrivate` (a dist-identifier check is vacuous under esbuild minification; an import-walk false-positives on the core barrel; `private-scope.ts` legitimately enters the graph via the barrel and that is fine — only WORKER sources may not use it); (b) the existing REST loopback-refusal e2e as the behavioral gate.
- AMENDED Phase 2 [I3]: `target.scope: 'private'` when `isBlockedHost(seed.hostname)` OR the run's policy exists and `allowHost(seed)` is true (config-allowlisted DNS-name seeds like `staging.internal` must not be labeled public).
- AMENDED Phase 1 [M1]: `isLoopbackHost` is a NEW export of `private-scope.ts` (not existing); `normalizeHost` is exported from `ssrf.ts` so the policy's hostname normalization cannot diverge from the blocklist's (zone-id, brackets, trailing dots).
- AMENDED Phase 2 [M2]: `createPageMetaFetcher(privateScope?)` constructs its fetcher INSIDE `fetch()` when a policy is configured (the factory currently builds one fetcher at factory time — a per-call seed must not be frozen at first call).
- CORRECTED Phase 3 [M3, factual]: a localhost page URL IS passed to the PSI/CrUX provider calls when keys are configured (`report.ts:47-66`); the legs degrade because the upstream API cannot fetch it — not because lumen withholds the URL. The providers' own fetchers still enforce the strict guard.
- AMENDED Phase 1 [M4, documented]: a HOSTNAME allowlist entry trusts whatever that name resolves to at call time (consistent with the documented v1 DNS-rebind bounding) — docs must say: prefer CIDR/literal entries; a hostname entry is a trust statement about the name.
- AMENDED Phase 1 [M5]: the "non-seed-origin private link" adversary is exercised via REDIRECT only (the crawler filters links to same-origin pre-enqueue — `links.ts:33` — so a link cannot reach the fetcher cross-origin).
- AMENDED Phase 2 [M6]: `insecureHttp` gains the canonical origin via its `BUILT_IN_RULES` row factory signature `(severity, thresholds, canonicalOrigin?)` — the row type and `createRuleSet` threading are part of the change.

## Amendments (implementation, 2026-09-28)

- AMENDED Phase 1 [factual]: the config-loader validation reuses `allowPrivateEntryError` (exported classifier) instead of duplicating the grammar; `ResolvedConfig.crawl.allowPrivateHosts` is an OPTIONAL `readonly string[]` on `CrawlBudgets` (absent = strict), avoiding breakage of every `DEFAULT_BUDGETS` spread.
- AMENDED Phase 3 [factual]: admission policies are built from the MERGED `d.privateScope` on `CommandDeps` (nodeComposition merges the launch flag with `config.crawl.allowPrivateHosts` once) — no second config read in the commands; `McpDeps` gained `privateScope?` mapped from `CommandDeps`, so the stdio server and the audit runner share one scope object.
- FIXED (security review, agent_4674554c — C1 Critical): the robots.txt and sitemap legs called the fetcher WITHOUT `redirect: 'manual'`, so undici followed redirects natively and every hop escaped `assertHopAllowed` (and the scoped policy) entirely — `redirect: 'manual'` is now explicit at all 5 audit-leg sites (robots-policy ×3, sitemap ×1, core robots ×1); page fetches and pageMeta already had it. Verified undici's manual mode exposes readable 302s. Regression test: loopback robots.txt → 302 → 169.254.169.254 is refused (delegate observes `redirect:'manual'`, iterator throws SsrfBlockedError, robotsGate → LumenRobotsUnreachableError). This hole also existed in STRICT mode (pre-existing); the fix closes it for both.
- FIXED (security review I2): v4 CIDR bounds were SIGNED ints — every range at/above 128.0.0.0 (172.16/12, 192.168/16, 169.254/16) matched nothing. `>>> 0` normalization + regression matrix.
- FIXED (security review M4): hostname entries now must match a hostname grammar (or bracketed v6 literal) — userinfo/port/zone-id furniture rejected loudly.
- FIXED (security review M3): configuration docs now state config entries opt-in by themselves; the flag additionally opens loopback.
- FIXED (security review M6): docs disclose that `lumen report` passes the local URL to PSI/CrUX as a query parameter when keys are configured.
- ACCEPTED (security review M5, honesty edge): a public DNS name resolving to loopback (e.g. localtest.me) under the flag is fetched but labeled `target.scope: 'public'` — the label is hostname-based by design; recorded in HANDOFF_LEDGER_B3.
- AMENDED [test infrastructure]: FakeFetcher `pageCalls()` keeps its "crawler page fetches" semantics by excluding infrastructure routes (`/robots.txt` paths, `.xml` paths, `application/xml` routes) since those legs now share the manual-redirect transport contract.
