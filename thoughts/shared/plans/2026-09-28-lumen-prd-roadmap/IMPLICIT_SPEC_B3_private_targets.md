# IMPLICIT SPEC — Bundle 3 (E1.1 audit local/preview targets: `--allow-private`)

Source: PRD §6 E1.1 + D3; research Seam 2 (SSRF/fetcher) + Seam 3 (CLI/composition/config); verified against tree @ e88d180.

## What exists (facts the plan builds on)

1. `packages/core/src/ssrf.ts` — pure blocklist only: `isBlockedHost` (localhost/`.localhost`, v4 ranges incl. 127/8 + 169.254/16, v6 ::/::1/ULA/fe80::/10, mapped re-check), `isBlockedIpAddress` (resolver results), `isIpLiteral`. **No allowlist/opt-in hook anywhere** (grep zero).
2. `createFetcher` (`core/src/fetcher.ts`): `assertHopAllowed` per hop — scheme check → `isBlockedHost(url.hostname)` → (when `resolve` wired and host not an IP literal) DNS resolve, EVERY resolved IP through `isBlockedIpAddress`, resolution failure refuses. Options are injectable; a policy hook slots into exactly these two checks. `createNodeFetcher` (`core/node.ts`) passes opts through incl. injectable `resolve`.
3. `validatePublicHttpUrl` (`mcp/src/url-guard.ts`) — admission for CLI positionals (audit `:25`, report `:30`), MCP tools (server `:104,131`), Worker REST (`rest.ts:63`). Returns `{ok:false,message}`; CLI converts to UsageError → exit 2.
4. Audit engine: `runSiteAudit(seed, config, deps, signal)`; `CrawlerDeps.fetcher` is THE transport (robots + sitemap + pages all flow through it). Composition: `createAuditRunner(config)` / `createPageMetaFetcher()` each build their own `createNodeFetcher()` per run/call (`cli/src/composition/audit-adapter.ts`); seed is known per `run(input)` call.
5. Config loader: `crawl` is an object case in `core/src/config.ts` with `CRAWL_KEYS` enumeration; unknown keys are loud errors. New key `crawl.allowPrivateHosts` needs: loader validation, CLI help/docs, locked-names `configKeys`, site configuration page (4 sites per research).
6. Rules: `insecure-http` (technical.ts) fires on `page.url.protocol === 'http:'` only; `mixed-content` fires on https pages only (already silent on http localhost); `canonical-present` is count-only — **no canonical-target-matching rule exists**, so FR-5's canonical aspect is only about scheme-context suppression.
7. Rules are closures built via `createRuleSet(config)` from `AuditConfig` — an optional `canonicalOrigin` threads as a config field, not a rule-context change.
8. `Report.configSnapshot { seed, crawl, respectRobots, renderer, thresholds, maxBodyBytes, rules, discoveryWarnings }` (assemble.ts) — additive `target.scope` field lands here.
9. MCP: tool schemas via `auditSiteSchema` etc.; `strictArgs` rejects unknown args; `tools/list` frozen at 5. Worker `rest.ts` calls `validatePublicHttpUrl` with no way to pass a policy (must stay that way).
10. `DEFAULT_BUDGETS.perHostMinDelayMs = 250` (core budgets.ts); audit-side `rate-limiter` takes `effectiveIntervalMs = max(minDelay, crawlDelay)`.

## Decisions inherited from PRD/research

- D3: **flag + config** (`crawl.allowPrivateHosts`), MCP launch-time-only (`lumen mcp --allow-private` in client config), NO tool argument, Worker never accepts.
- Research edge: `0.0.0.0/0` / `::/0` in config = allow-everything → loud ConfigError, never silently honored.
- Research edge: per-hop revalidation preserved; SSRF policy may only RELAX the host/resolved-IP checks for the SEED's origin — never scheme, never hop cap, never DNS-failure refusal.
- FR-2 scoping: private targets allowed ONLY at `url.origin === seedOrigin` (redirect to any other origin refused even when private and even when listed).
- Honest scoping of FR-5: `--canonical-origin` suppresses `insecure-http` for private-host pages (scheme context = canonical origin); no canonical-target rule exists to wire.

## Swarm adversaries the AC demands refused

1. **redirect-to-metadata**: seed (private, allowed) 30x → `http://169.254.169.254/` — different origin → SsrfBlockedError even with flag.
2. **DNS-rebind-to-private**: public hostname resolving to `10.x` — `allowIp` false (host not listed, IP not in CIDR, not loopback) → refused pre-connect.
3. **tool-arg-tries-to-enable-private**: MCP `lumen_audit_site {url, allow_private:true}` → strictArgs/schema rejection (schema unchanged).

## Success criteria (from PRD AC + invariants)

- `lumen audit http://localhost:PORT --allow-private` audits a real loopback server (spawn e2e) with exit 0/1; without the flag exit 2 with the message naming `--allow-private`.
- Redirect localhost → 169.254.169.254 refused with the flag; DNS-rebind refused; tool-arg adversary refused.
- Full `npm run validate` green; **security review PASS is a BLOCKING gate** before commit.
