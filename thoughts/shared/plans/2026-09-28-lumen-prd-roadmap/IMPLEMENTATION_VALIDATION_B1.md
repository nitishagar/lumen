<!-- SIGNPOST | 5/5: IMPLEMENTATION_VALIDATION | adversarial review of the B1 working-tree diff | Verdict below -->
# IMPLEMENTATION VALIDATION — Bundle 1 (v0.3 release train)

**VERDICT: PASS** (final, 2026-09-28 — after re-validation of the two Important-fix commits; initial verdict was MINOR-FAIL, see history below)

Both Important findings were fixed and re-verified; only documentation-level nits remain (capped below). Nothing is broken at runtime, no secret leaks, no test weakening, and the release-mechanics core is correct.

## Re-validation (2026-09-28, second pass)

1. **Anti-drift oracle — FIXED.** The payload↔file comparison now exists as a real, two-sided gate: `packages/mcp/src/onboard.test.ts:77-83` reads repo-root `server.json` via `node:fs` (path `../../..` from `packages/mcp/src` resolves to the repo root) and asserts `JSON.parse(onboardPayload('registry'))` deep-equals the parsed file — editing either the `REGISTRY_SERVER_JSON` constant or `server.json` alone fails. Located in the TS suite because the dependency-free ci-scripts project cannot import the payload constant; recorded as a factual plan amendment ("AMENDED 2026-09-28 Phase 3 [factual]" in PLAN_B1 Amendments). The mcpb/claude-plugin summaries remain intentionally summaries (amendment note (a)); their key-name consistency stays pinned by `test/onboard-artifacts.test.mjs` (`user_config` key set) plus the name-whitelist oracle in `onboard.test.ts:45-69`. Suite re-run: onboard.test.ts 18/18 green.
2. **HEAD→GET fallback — FIXED.** `scripts/ci/link-check.mjs:69` now pins `HEAD_ONLY_FALLBACK = [403, 405, 501]` exactly per the plan (PLAN_B1:45,107); `test/link-check.test.mjs:78-90` loops all three statuses asserting the `['HEAD', 'GET']` call sequence, and the adjacent test still proves 404 fails honestly without a GET. Suite re-run: link-check 8/8 green.
3. **CHANGELOG typo — FIXED.** `CHANGELOG.md:14` now reads "Not yet released on npm:".

Residual (capped, non-blocking) nits after the fixes:
- **Stale doc comments still make the old false claim**: `test/onboard-artifacts.test.mjs:2-9` still says "the registry payload is compared as parsed JSON against the file" (in *this* test — it now lives in `onboard.test.ts:77`), and `packages/mcp/src/onboard.ts:11-12` still says "`test/onboard-artifacts.test.mjs` fails when the files and these payloads drift apart" (should point at `onboard.test.ts:77`). One-line comment edits; the gates themselves are correct and tested.
- Plan "### Evidence" counts are now stale (onboard.test.ts is 18 tests, so the cited 4-file total is 45, not 44). Trivial bookkeeping.

---

## Initial review history (MINOR-FAIL, superseded)

Adversarial review of the uncommitted working-tree diff vs PLAN_B1 + IMPLICIT_SPEC_B1, incl. Amendments.

## Verified green (independently re-run, not trusted from the plan's evidence)

- `npx vitest run test/contract-counts.test.mjs test/onboard-artifacts.test.mjs test/link-check.test.mjs test/publish-workspaces.test.mjs` → 63 passed (6+7+8+42)
- `npx vitest run packages/mcp/src/onboard.test.ts packages/cli/src/mcp-print.test.ts` → 31 passed
- `npm run check -w @lumen-seo/site` → build + 193/193 gate tests green (byte-exact snippets incl. the 3 new ones, tool sweep, links, a11y)
- `npx eslint` on all new .mjs/.js files → clean
- Registry print payload vs `server.json`: parsed-equal today (byte-diff is trailing newline only) — the missing gate is a gap, not active drift.

## Findings

### Important

1. **FIXED (re-validation 1). Anti-drift oracle (plan Phase 2/3 centerpiece) was decorative — the payload↔file comparison did not exist.**
   Plan lines 74/99 require `test/onboard-artifacts.test.mjs` to assert "the `registry`/`mcpb`/`claude-plugin` print payloads match the files' content/shape" and "print payloads == files". The implemented test (`test/onboard-artifacts.test.mjs:22-103`) only shape-checks the artifact files (schema URL, name, env names, version lockstep) and never reads `packages/mcp/src/onboard.ts` nor the snapshots — so editing either side alone passes CI. Both doc comments claim otherwise: `test/onboard-artifacts.test.mjs:2-9` ("the registry payload is compared as parsed JSON against the file") and `packages/mcp/src/onboard.ts:12` ("test/onboard-artifacts.test.mjs fails when the files and these payloads drift apart"), plus `packages/mcp/src/onboard.ts:20` ("Must stay deep-equal to the repo-root `server.json` (anti-drift test)"). Today the two happen to agree (verified parsed-equal), so this is a missing guarantee, not live drift — hence MINOR not MAJOR. Fix: in the ci-scripts test, extract `REGISTRY_SERVER_JSON` from `onboard.ts` (e.g. parse the object literal via a scoped regex/eval-free transform) or read the committed snapshot block and compare parsed JSON against `server.json`; similarly pin the `mcpb`/`claude-plugin` summary key-name sets against `mcpb/manifest.json` `user_config`.

2. **FIXED (re-validation 2). HEAD→GET fallback dropped the plan-specified 403 case, unamended.**
   Plan Phase 4 (line 107) and Default choices (line 45): "HEAD → GET fallback on 405/403/501" / "HEAD with GET fallback on 405/403/501". `scripts/ci/link-check.mjs:69` pins `HEAD_ONLY_FALLBACK = [405, 501]`. Consequence: a server that 403s HEAD but serves GET (seen on some CDN/static hosts) now fails the weekly run with no specified retry. The narrowing is arguably defensible (403 usually means bot-blocking, and retrying burns quota) but it is an unrecorded divergence from the amended plan; amend the plan or add 403.

### Nit

1. **Site snippet naming/text diverges from plan wording.** Plan Phase 5 (line 124): snippets `mcpbInstall` and `claudePluginInstall`, "exact text mirroring print payloads". Implementation: `mcpbInstall`, `pluginMarketplaceAdd`, `pluginInstall` (`site/src/data/locked-names.json:68-70`); `mcpbInstall` is an adapted sentence, not the payload's "Install: …" line; the two plugin lines are exact payload substrings. No gate ties snippets to payloads. Site gates still satisfied (I8 green).
2. **mcp-publisher is not checksum-pinned** — `release.yml:95` pulls `releases/latest/download/mcp-publisher_linux_amd64.tar.gz` from the official modelcontextprotocol registry repo (plan-specified mechanism). Given the job holds `id-token: write` and can publish under the verified `io.github.nitishagar/*` namespace, pin a release tag + SHA256. Honest severity: low (official source, owner-gated job), but cheap to fix.
3. **CHANGELOG prose typo** — `CHANGELOG.md:14` "Unreleased on npm yet:" read as "Not released on npm yet". FIXED (re-validation 3: now "Not yet released on npm:").
4. **`--json` detection is an impure seam** — `scripts/ci/link-check.mjs:122` reads `process.argv[2]` inside `runCheck`; harmless under vitest (argv[2] is never `--json` there) but the flag belongs at the `isMain` call site.
5. **Plan arithmetic vs implementation** — plan says "8→14 snapshot cases"; actual: 11 snapshot cases (8 legacy + 3 new; 17 tests in onboard.test.ts). The implementation is the coherent reading; the plan number was miscounted. Plan evidence "44 passed" verified correct.

## Checklist conclusions

1. **Plan conformance** — Phase 1 PASS (contract-counts gate is real: parses 20 `{ id:` rows from `rule-set.ts`, asserts README/rules-reference/CHANGELOG prose and locked-names arrays; a count pattern stop-match fails loudly). Phase 2 PASS except the missing oracle half (Finding 1). Phase 3 PASS on artifacts (server.json, mcpb/manifest+launcher+README, marketplace+plugin, mcpName, runbook) but the anti-drift test is incomplete (Finding 1). Phase 4 PASS except 403 (Finding 2). Phase 5 PASS (release.yml jobs, skip propagation, drift assertion, site snippets, cli-reference 7 targets). Amendments verified: F1 mcpb at repo root (`.gitignore` has no mcpb/server.json exclusion); F2 adapted never-embeds oracle for the 3 new targets (`packages/mcp/src/onboard.test.ts:42-66`); F3 manifest/launcher/`${user_config.*}` env delivery (`mcpb/manifest.json:17-21`, `mcpb/server.js:9-13`); F4 runbook release-prep bumps server.json + mcpb + plugin.json + payload constant (`docs/distribution.md:6-15`); publish `outputs.skip` declared (`release.yml:44-45`). The publish-workspaces amendment is factually supported: doc comment says "registry/node_modules entries are excluded" (`scripts/ci/publish-workspaces.mjs:93-95`) while the baseline filter did not, and the committed nested entry exists (`package-lock.json:11837` `packages/mcp/node_modules/@cloudflare/workerd-darwin-64`); fix is the one-line path filter (`publish-workspaces.mjs:109`), pre-existing suite passes unmodified (42/42, ran).
2. **Spec invariants** — I1 PASS (union+PRINT_TARGETS+tests+snippets in one change; wire/schema/snapshot contracts untouched). I2 PASS (env-var names only everywhere; `isSecret`/`sensitive` on all three; grep for secret-shaped literals across all new artifacts clean). I3 PASS (`registry` gated on `needs.publish.outputs.skip` — `release.yml:87-88`; substitution runner-local via argv-passed version; no runner commits anywhere; mcpb upload `--clobber`). I4 PASS for counts (real gate); FR-5 payload↔file anti-drift FAIL → Finding 1. I5 PASS (schedule `0 3 * * 1` + dispatch + tag push only, `link-check.yml:8-15`; absent from ci.yml; polite: identifying UA, concurrency 5, 10 s timeout, HEAD→GET fallback present). I6 PASS (`mcpName` matches `server.json.name`, asserted by `test/onboard-artifacts.test.mjs:47-50`). I7 PASS (`[Unreleased]` maintained, `[0.3.0]` records PR #37 + bundle, PR checkbox added). I8 PASS (193/193 site gates).
3. **Failure edges** — PASS. Skip propagation correct (publish succeeds with `skip=true` when token absent → registry skipped; publish failure → registry skipped via needs). Link-check failures all collected and listed with URLs + referencing files, exit 1 (`link-check.mjs:109-137`). Idempotency preserved: duplicate-publish 403/409 semantics untouched (diff touches only the filter line), `gh release upload --clobber`, release-create guarded by `view`.
4. **Security** — PASS with notes. No script injection: `node -e` bodies take versions as argv (`release.yml:106,128`), all `${{ }}` values enter via quoted env vars, `"$GITHUB_REF_NAME"`/`"$TAG"` quoted in every `run:` block. Least privilege: registry job `permissions: { id-token: write, contents: read }` (`release.yml:90`); link-check workflow `contents: read`; release/upload jobs need the workflow-level `contents: write`. No secrets echoed. mcp-publisher sourcing → Nit 2. No untrusted input reaches eval-like sinks.
5. **Test integrity** — PASS. Legacy generic sentinel still covers exactly the 4 legacy targets in both suites (`packages/cli/src/mcp-print.test.ts:62-68`, `packages/mcp/src/onboard.test.ts:34-38` — loops unchanged, only renamed descriptions); new targets get the pinned name/value-pairing oracle; snapshots are additions only; `test/publish-workspaces.test.mjs` unmodified.
6. **Common defects** — link-checker: HEAD→GET fallback and retry-once-on-network-error-only logic correct (HTTP statuses never retried — `link-check.mjs:100-106`); concurrency bounded at 5 workers with race-free cursor; trailing punctuation stripped (`link-check.mjs:23`); locked-names JSON walker collects only string values that *start* with `http(s)` so snippet strings (e.g. `mcpbInstall` containing a URL mid-string) are never fetched (`link-check.mjs:53-58`), verified by test. The 403 omission → Finding 2.
7. **Convention fit** — PASS. Dependency-free `.mjs` with injectable seams and header docstrings matching `scripts/ci/` style; tests land in the root `ci-scripts` vitest project (`vitest.config.ts` include `test/**/*.test.mjs`); site page consumes locked snippets verbatim via `pre/code` like the existing sections; eslint scope extended minimally (`mcpb/*.js` node globals, link-check added to the sanctioned-fetcher carve-out with justification).

## Notes

- Untracked `evals/` exists in the worktree but is outside this bundle's declared diff (CHANGELOG attributes it to PR #37) — flagged for whoever reviews PR #37, not counted here.
- actionlint is not installed locally; both workflows' YAML reviewed manually (structure valid, expressions well-formed).
