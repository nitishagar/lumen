# TEST_VALIDATION — seolite audit-engine (Phase 5–6 test files)

Reviewer independence note: fresh headless `claude -p` session (read-only
allowlist, output contract), resumed by session id for MINOR-FAIL confirmation.

## Review — session 0e04d8de-4de4-4707-b14b-8d7c731dab8b

packages/audit/src/rules/rule-set.test.ts:85 — FAIL: "measured crawl timing" test doesn't advance any clock, so it never exercises the real timing path; only proves a trivial zero-delta negative.
packages/audit/src/rules/rules.test.ts:31 — MINOR FAIL: conjoined boolean assertion for title-length long case; not tautological but weakens failure diagnosis.

All other checked items PASS:
- 18/18 rule table-driven tests present with real severity/message/evidence assertions (rules.test.ts).
- Severity/threshold overrides, unknown-rule-id error (lists ids), evidence cap+overflow marker, throwing-rule isolation into `ruleErrors`, plugin RuleContext, plugin severity override, crawl-rule issue placement — all present with real value checks (rule-set.test.ts).
- Score bounds/monotone/zero-audited-pages (score.test.ts) — real values, correct WEIGHT table.
- sanitizeText/sanitizeIssue — real control-char and length-cap assertions, no-mutation check (sanitize.test.ts).
- reportIdFor — exact-string assertions across hostile host/rand combinations, truncation, fallbacks (id.test.ts).
- Assembly: summary counts vs recomputed counts, configSnapshot no-secrets (env var probe), C0/C1+length caps, path-safe id end-to-end, byte-identical JSON — all real (assemble.test.ts).
- e2e 5-page and e2e-abort — real stopReason/incomplete/score recomputation/robots ordering checks (e2e.test.ts).
- FakeFetcher/makeTestDeps model the core Fetcher contract faithfully (typed errors, defer/release, passStatus, step-clock) — not over-mocked.
- No real timers/Date.now/Math.random found in reviewed tests; determinism looks sound aside from the one gap noted above.

VERDICT: MINOR-FAIL

### Resume (MINOR-FAIL fix confirmation) — same session resumed

packages/audit/src/rules/rule-set.test.ts:85 — RESOLVED: now drives a real 429+Retry-After retry through fetch-page.ts's step-clock-timed window, producing a genuine measured timingMs (1000ms) that the crawler itself computes; asserts both the override threshold firing and the default threshold staying silent on the same real timing. No longer bypasses the crawler's timing code.

packages/audit/src/rules/rules.test.ts:28-32 — RESOLVED: conjoined boolean replaced with a fixture-sanity assertion (`long.length > 65`) plus a direct `toHaveLength(1)` check.

packages/audit/src/run.test.ts (new) — reviewed: `applyCrawlRuleIssues` unit tests give real coverage of url-carrying vs url-less issue placement, per-rule-invocation `ruleErrors` counting, and preservation of pre-existing counts. Meaningful assertions, no over-mocking, deterministic (no time/network/randomness involved).

VERDICT: PASS

## Verdict

MINOR-FAIL (weak latency-timing test; conjoined boolean assertion) -> both
strengthened in place -> resumed same reviewer -> PASS.
