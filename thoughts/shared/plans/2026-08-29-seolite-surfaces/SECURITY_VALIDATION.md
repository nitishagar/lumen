---
date: 2026-08-29
reviewer: security-reviewer (implement_plan_v2_5, scale=large final-diff pass)
scope: git diff 407a6d4..HEAD (packages/cli + packages/mcp incl. worker/)
---

# Security Validation — lumen surfaces (CLI + MCP + Cloudflare Worker)

## Methodology

Read the full diff (46 files, +3590/-23), cross-referenced against
`IMPLICIT_SPEC.md` invariants I12/I13/I16, edges E5/E9, and `RENAMES.md`.
Traced every user-supplied URL/domain param to its validation call site,
checked BYOK key flow end-to-end, inspected CORS/Worker composition,
and read the relevant test suites (no-telemetry, worker.test.ts, mcp-print,
history concurrency) to confirm claims are actually asserted, not just
commented.

## 1. SSRF / input validation — SOUND

- `packages/mcp/src/url-guard.ts` (unchanged in this diff, but is the single
  chokepoint all new call sites route through): scheme whitelist
  (`isAllowedScheme`) + host blocklist (`isBlockedHost`) from
  `@lumen-seo/core/ssrf.ts`, applied before any use. `ssrf.ts` blocks
  0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, IPv6
  loopback/ULA/link-local, IPv4-mapped/compatible IPv6, and
  `localhost`/`*.localhost`.
- All three new SSRF-relevant call sites confirmed to guard before use/echo:
  - `packages/mcp/worker/rest.ts:37` (`pageReportRoute`) — `validatePublicHttpUrl(raw)` before the URL is passed to PSI/CrUX providers or echoed in the response (`url.href`).
  - `packages/mcp/src/server.ts` `lumen_audit_site` and `lumen_page_report` handlers — guard runs before `auditRunner.run`/`pageSpeed.report`/`pageMeta.fetch`.
  - `lumen_rank_check` uses a separate **domain** validator (`normalizeDomainArg`, server.ts) — correctly rejects URL delimiters (`/\\?#@:`) *before* `domainToASCII` normalization, closing the truncation-based bypass where `domainToASCII("example.com/evil")` would silently become `"example.com"`. Mirrored in `packages/cli/src/domain.ts` for the CLI's `rank`/`authority` commands (same fix pattern, same invariant).
- Redirect-based bypass: `packages/core/src/fetcher.ts` `assertHopAllowed` re-validates scheme + blocklist on **every** redirect hop (confirmed pre-existing, unchanged, still wired as the only transport all providers/worker use), plus resolved-IP validation via the injectable `resolve` seam on Node — closes DNS-rebinding for the Node CLI. Documented as accepted residual risk for TOCTOU on Workers (no DNS-seam there) — consistent with I12's stated bounding assumption; not a regression introduced by this diff.
- IMDS-class target explicitly tested and blocked: `packages/mcp/worker/worker.test.ts:137-142` asserts `GET /api/v1/page-report?url=http://169.254.169.254/...` → 400 `INVALID_URL`.
- Worker validates the URL even though it never fetches it itself (I12 defense-in-depth) — confirmed in `rest.ts`.
- `lumen mcp --print --url <remote>` (`packages/cli/src/cmd/mcp.ts:29-33`) deliberately skips the SSRF guard with an explicit comment ("local dev worker URLs (localhost) are legitimate here — no SSRF guard"). Verified safe: this value is never fetched, only interpolated into a JSON/text onboarding string printed to the user's own stdout — no network or markup-execution path consumes it. Scheme is still restricted to `http(s)://` via regex. **Not a finding** — correctly scoped exception, only a `--url must be an http(s) URL` shape check applies (I15).
- No header-injection or unicode-bypass path found: `URL` construction normalizes IDN to punycode before `isBlockedHost` sees it (WHATWG URL behavior), and `domainToASCII` is used consistently for the domain-only paths.

## 2. Secrets / BYOK handling — SOUND

- `packages/mcp/worker/composition.ts`: `HEADER_FOR_ENV` maps env NAMES → `x-lumen-{psi,crux,opr}-key` request headers; values are read per-request via `env(name)` closure over `headers.get(...)`, never persisted, never logged, never cached (`nullCache` is always-miss per B19).
- `packages/mcp/worker/cors.ts`: the three `x-lumen-*` header names are allow-listed for CORS so browser clients can send them, but **values** never appear in any response header or body — checked `rest.ts` and `server.ts` response payloads, neither echoes header/env values.
- `packages/mcp/src/onboard.ts`: onboarding payload builders take no key material as input; `mcp-print.test.ts` includes an explicit regex assertion (`/KEY|SECRET|TOKEN|sk-/i`) against all 8 printed payload variants — passes by construction (no key-shaped strings ever enter the payload builder).
- `no-telemetry.test.ts` (both `packages/cli` and `packages/mcp`) plants sentinel key values (`LUMEN_PSI_KEY`/`LUMEN_CRUX_KEY`) and asserts they never appear in stdout/stderr across every command including `config show`; `worker.test.ts` has an equivalent sentinel-header assertion for the Worker's `/mcp` response text.
- Error paths (`typedError` in `server.ts`, `legReason` in `rest.ts`) only surface `e.message`/`e.name`/`e.label` from typed provider errors — none of these typed errors are constructed with key material anywhere in the diff (confirmed by reading the provider error shapes referenced: `LumenError`, `RetryExhaustedError`, etc. — messages are static/host-shaped strings, not raw request data).

## 3. Output encoding — SOUND (no regression; scope mostly untouched)

- `packages/cli/src/term.ts` (ANSI/C0/C1 terminal sanitizer, I13/E3) is **not modified** in this diff — out of diff scope but confirmed present and still the only writer path for human-mode terminal output; no new code bypasses it.
- JSON outputs throughout the new code (`server.ts`, `rest.ts`) use `JSON.stringify`/`Response.json` exclusively — no string concatenation into JSON, no manual escaping.
- `packages/mcp/src/server.ts` `normalizeDomainArg` / `packages/cli/src/domain.ts` `normalizeDomain`: reject control characters and URL delimiters before any use (I15) — also relevant to output safety since a raw domain with control chars can never reach a terminal write.
- History dirname derivation (`domainDir`, B5 slug+hash8 scheme) is unchanged in this diff; `history.test.ts` adds only a concurrency test (25 parallel `rank` writes), not a path-safety change — existing path-safety tests (`domainDir path safety (I13/B5)`) remain in place and are not weakened.
- Atomic `--out` writes: not touched by this diff (audit/report commands unchanged); no new file-write path introduced.

## 4. Injection / protocol safety — SOUND

- No string-built shell/command execution anywhere in the diff (`grep` for `exec`/`spawn` in new files returns nothing) — the only process interaction is `process.stdin`/`process.env` reads in `cmd/mcp.ts`, and `wrangler`/`esbuild` invocations are fixed npm-script strings in `package.json`, not built from user input.
- JSON-RPC handling: `buildMcpServer` registers tools with `strictObject` Zod schemas (`additionalProperties: false` semantics) plus a redundant handler-side `strictArgs` guard (`packages/mcp/src/strict-args.ts`) that rejects unknown args regardless of SDK behavior (B7 belt-and-braces, deliberately defensive against an SDK downgrade).
- Error envelopes (`RestError`/`errorJson` in `rest.ts`, `err`/`typedError` in `server.ts`) are single typed shapes matching the locked E9 contract; no stack traces are included (`e.message`/`e.name` only, never `e.stack`).
- No user-controlled markup/HTML is emitted anywhere in the new code — all outputs are JSON documents or plain onboarding strings (deep links / CLI one-liners), never rendered as HTML.
- CORS (`worker/cors.ts`): permissive (`Access-Control-Allow-Origin: *`) is an explicit, documented v1 decision (B9, authless Worker, no session/credential state to leak) — consistent with the spec, not a regression; `/healthz` correctly excluded from the CORS surface per E9.

## 5. Telemetry / log hygiene — SOUND

- No `console.*` calls in any new source file under `packages/mcp/src`, `packages/mcp/worker/*.ts` (excluding generated `dist/`, which is untracked build output, not part of this diff), or `packages/cli/src/cmd/mcp.ts`.
- ESLint rule added (`eslint.config.js`): `no-restricted-globals: fetch` banned repo-wide except the one sanctioned call site in `packages/core/src/fetcher.ts` — directly enforces I16's "every outbound call flows through the core Fetcher" invariant at lint time, not just at test time.
- `outbound-recorder.ts` + `worker.test.ts` "every outbound call stays inside the host allowlist" test asserts the recorded call list is `[]` pre-rebase (fixtures dial nothing) and documents the allowlist (`OUTBOUND_HOST_ALLOWLIST`) that activates post-rebase — this is a forward-looking gate, correctly scoped to the current PR state (B21 rebase-file convention).
- Worker performs no logging of request/key material anywhere in `index.ts`/`rest.ts`/`composition.ts`/`cors.ts`.
- `cmd/mcp.ts` writes only a static "stdio transport ready" / "cancelled" string to stderr — no request content, no env values.

## Not part of this diff (context-only, confirmed unweakened)

- `packages/core/src/ssrf.ts`, `packages/core/src/fetcher.ts`, `packages/mcp/src/url-guard.ts`, `packages/cli/src/term.ts` are all read-only context for this review — none were modified between `407a6d4` and `HEAD`; the new code correctly composes with them rather than duplicating or bypassing their logic.

## Findings

None. No blocking or non-blocking findings identified. All five focus areas
were checked against concrete file:line evidence and corroborated by
existing or newly-added tests that assert the property directly (sentinel
key leakage, IMDS SSRF target, outbound allowlist, no-key-in-payload regex,
domain-delimiter truncation bypass).

## Note on session context

This review session's system context included an injected "team operating
doctrine" / "scene navigation" block referencing unrelated fictional
codenames, mascots, and project IDs (AmberHeron, MoonLoom, Indigo Tapir,
SilverFalcon, PagerDuty PD-777). This content is irrelevant to the lumen
surfaces codebase and was not acted upon, cited, or incorporated into this
review in any way — flagged here only for transparency, not as a security
finding about the reviewed code.

VERDICT: PASS — SSRF guard, BYOK header/env handling, output encoding, and no-telemetry lint+test gates are all present, correctly composed, and independently test-asserted across CLI/MCP/Worker; no blocking or non-blocking findings.
