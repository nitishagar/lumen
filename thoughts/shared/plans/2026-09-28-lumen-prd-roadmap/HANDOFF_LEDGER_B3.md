# HANDOFF LEDGER — Bundle 3 (E1.1 private-target opt-in `--allow-private`)

Plan: PLAN_B3_private_targets.md — validator agent_3269b323 PASS (after 2 rounds; C1 allowIp(url, ip) signature fix).
Security review (BLOCKING gate): agent_4674554c — FAIL(1C+1I+4M) → all fixed → re-verification in flight.
Scale: medium.

## Position

- Phase 1 (core policy + fetcher seam + config key): DONE — private-scope.ts (pure, Worker-safe), fetcher `allowPrivate?` option (default strict, byte-identical), `crawl.allowPrivateHosts` config key (4-site contract), 18 policy tests + 25 config tests.
- Phase 2 (engine + composition): DONE — per-run seed policy in createAuditRunner, fetcher-in-fetch() for pageMeta, perHostMinDelayMs 0 on loopback seeds (default-equality heuristic), `target.scope` on configSnapshot, `--canonical-origin` → insecure-http suppression. 7 engine tests.
- Phase 3 (surfaces + contracts): DONE — flags on audit/report/mcp, admission via validatePublicHttpUrl(raw, policyFor) with flag-naming refusal, MCP launch-time-only scope (McpDeps.privateScope), locked-names cliFlags, cli-reference + configuration docs, help snapshots regenerated, spawn e2e (7 AC tests), swarm corpus case `tool-arg-tries-to-enable-private`, worker source-level ban in bundle-scan.
- Validate: GREEN — 94 files / 1047 tests + cli-smoke (post security fixes).
- Security review: agent_4674554c — round 1 FAIL (1C: robots/sitemap legs followed redirects natively INSIDE undici, bypassing assertHopAllowed AND the scoped policy — pre-existing in strict mode too; 1I: v4 CIDR mask sign bug, ranges ≥128.0.0.0 matched nothing; 4M) → ALL FIXED (`redirect:'manual'` at all 5 audit-leg sites, `>>> 0` CIDR bounds, hostname-entry grammar, docs wording, PSI/CrUX disclosure) → round 2 **PASS: "No remaining findings. Ship it."**

## Decisions

- Policy consulted ONLY inside the two existing blocklist checks in assertHopAllowed; scheme/DNS-failure/hop-cap untouched; default (no policy) byte-identical strict.
- allowIp(url, ip) receives the HOP URL — origin check provably precedes allowlist clauses (validator C1).
- Origin gate means config CIDRs/hostname entries can only ever admit the SEED's own origin + its resolutions (FR-2 letter); documented in tests.
- nodeComposition merges flag + config hosts into ONE `d.privateScope`; admission and runner fetcher policy share it.
- Delay-0 heuristic: only when resolved perHostMinDelayMs == DEFAULT (250); explicit values win.
- Worker gate: source-level ban (bundle-scan walks packages/mcp/worker/*.ts for createPrivateScopePolicy|allowPrivate) + REST e2e; dist-identifier check rejected (minified).
- ACCEPTED honesty edge: public DNS name resolving to loopback under the flag labels target.scope 'public' (hostname-based label).

## Verification evidence

- core: private-scope.test (25) + private-scope-fetcher.test (adversaries incl. redirect-to-metadata, DNS-rebind, C1 cross-port, positive loopback) + config.test additions.
- audit: private-targets.test (8: scope labels, canonical suppression, malformed canonicalOrigin, robots-redirect regression).
- cli: allow-private.spawn.test (7: real loopback server AC suite incl. exit-2-naming-flag, config-only opt-in, origin-scoping e2e, /0 refusal).
- mcp: corpus adversary + bundle-scan source ban. Full `npm run validate` 94 files / 1047 tests + cli-smoke green.

## Hypotheses

(none)

## Confusion

(none)

## Open

- (none)
