<!-- SIGNPOST | 1/5: SPEC | requirements only, no designs | Next: PLAN.md
     Pipeline: SPEC -> PLAN -> PLAN_VALIDATION -> implement+review -> tests+TEST_VALIDATION -> green -->

# Implicit Spec — lumen missing-features + red-team swarm verification

Seeded from `thoughts/shared/research/2026-09-16-lumen-feature-inventory-missing.md` at the same commit (`48db265`); staleness check passed (HEAD == research commit), so the research Evidence Ledger is reused wholesale and nothing below restates its verified findings beyond what a requirement needs to cite.

Scope this spec governs: adding the observed-missing product surface (live judge gate, history/export lifecycle, rule-coverage extension) and building the absent red-team swarm verification harness. It does NOT govern the refused surface (search-volume DB, backlink graph, clickstream fabrication — refusal remains correct behavior).

## Invariants

- **Exit gate equality + off.** `failThreshold` equality counts; `off` never gates but findings are still emitted; an `incomplete` audit alone fails the gate (exit 1). Any new rule, history-backed command, or swarm scoreboard that feeds an exit code must preserve this exact gate shape.
- **Unknown names fail loudly with the valid list.** New providers, rules, boundaries, config keys, CLI flags, or MCP args must extend every closed vocabulary together (code registry + `locked-names.json` + evalite snapshots), or the gates disagree. Never silent-default, never a bare stack trace.
- **Budget clamp asymmetry.** Config `maxPages` over ceiling clamps (never errors); CLI `--max-pages` out of range is a UsageError (exit 2). New budget-like knobs must state which side of this asymmetry they sit on; the two behaviors must not be unified by accident.
- **BYOK names-not-values, resolved at call time.** Any new keyed source (including a judge provider) stores env-var names only, reads values at call time, never persists/logs/prints them, treats empty as absent, and rejects secret-like literals. Sentinel values must never appear in any output, including swarm logs and scoreboards.
- **No key, no call.** A keyed capability without its key answers explicit not-configured/unavailable and is never invoked keyless; unconfigured legs never fail the whole report. The live judge and any new provider-backed check inherit this: absent credential degrades to a stated skip, never a silent pass or a keyless call.
- **Concurrency / politeness floor.** Global maxConcurrency 5, per-host delay 250ms, honoring crawl-delay and the unsuppressible identifying UA. Swarm runners that call tools concurrently must not multiply the effective provider concurrency past the GCRA worst-cases (suggest 35, wiki 70, psi-keyed 70 / keyless 7, crux 150, opr 60, ddg 7 per rolling 60s); cancellation must abort without side-effect writes.
- **Retry discipline.** GET/HEAD only, 429 + 5xx only, full-jitter backoff, Retry-After honored but capped at 30s (above → typed cap error, never a long sleep), pre-aborted means zero calls, exhaustion surfaces attempts/status/cause. New network-touching code (judge client, new providers, swarm fault-injection) follows the same discipline or states its deviation.
- **SSRF revalidated per hop.** Scheme whitelist, host blocklist, DNS-resolve check on the seed URL and every redirect hop; resolution failure refuses; cross-origin redirects strip to the safe-header allowlist; 5-hop cap with loop detection. Any new fetcher of arbitrary URLs (new rules fetching subresources, judge client excluded since it calls a fixed API) inherits this.
- **Robots conservative asymmetry.** Fetch/parse failure closes (disallow-all); only explicit allow opens. New crawl-affecting behavior must not widen access on malformed input.
- **Crawl-evidence honesty.** Rules fire only on evidence actually gathered; never-fetched is unknown, not invented and not a pass. New rules must declare their evidence source and its absence behavior.
- **Partial-failure taxonomy.** Typed failures carrying the source name; honest null/empty (`[]`, `{record:null}`, `unavailable+reason`); missing data reported missing, never zero-filled; interrupted work labeled `incomplete:true` with a stop reason and re-runnable without duplicated side effects. Swarm verdicts and judge scores follow the same taxonomy: an unscored case is reported unscored with a reason, never a zero passed off as a failure nor a silent pass.
- **Boundary admission.** Non-http(s) rejected; oversized inputs capped with reasons (page-meta 2 MiB, Worker 2.5 MiB); seed/keyword/q ≤ 120, domain ≤ 253, limit 1..50, strategy enum, lang regex; MCP `maxPages` has no default (core budget applies); unknown MCP args rejected on both wire and handler layers. New args/inputs need the same defined behavior; concise/detailed must not change admission, only shape.
- **History durability.** Serialized in-process appends, one O_APPEND write per entry, single-generation rotation (concurrent rotators may drop one `.1` generation — accepted), truncated-final-line tolerance, rotated-then-current read order, all-domains merge sorted by retrievedAt. Any history extension (new entry kinds, retention/prune) preserves these or states the change.
- **Transport separation.** stdio stdout is protocol-only; Worker never fetches/parses arbitrary target URLs, is GET-only on REST, composes per request, logs nothing. New Worker routes or MCP tools must not break this; new capabilities unavailable remotely answer typed LOCAL_ONLY, never silent less.
- **Worker-safe import graph.** No `node:` through `core/index`, no cheerio through `providers/worker`, MCP bundle ≤ 1.5 MiB gzip. New shared code must keep both graphs clean.
- **Provenance + attribution preservation.** Every external value carries `{provider, kind, retrievedAt}`; gray/heuristic/best-effort/proxy labels travel with values; CrUX CC BY 4.0 sentence, Tranco citation, Wikimedia UA/contact survive new surfaces and formats. New export formats must carry or reference provenance. Judge verdicts are assessments, not measurements: they must be labeled as judge-derived with model id, rubric version, and timestamp — never mixed into measurement provenance.
- **Offline default stays offline.** The default `npm test` and `test:evals` gates make zero network calls and need no credentials. Swarm and judge-live execution must live behind explicit opt-in gates (env + flag), never degrade the offline default, and skip with a stated reason when credentials are absent.

## Bounding assumptions

- Single-machine CLI remains the primary path; no distributed crawl coordination is required.
- Free-tier quotas are the ceiling; Worker free-tier CPU continues to shape the remote subset (tranco/ddg/PSI exclusions stand unless the user explicitly re-opens them — see over-constraint check).
- Refused surface stays refused (no volume/backlink/clickstream fabrication).
- Node ≥ 22.7; TypeScript sources are truth, `dist/` is build output.
- Judge provider, model id, and credential are user-supplied at enablement time; the harness must not pin a vendor in the default path.
- Swarm scale targets are declared by the user (adversaries × cases × tool calls); the plan states the envelope it sizes for.

## Confirmed assumptions (user-confirmed 2026-09-16)

- Plan scope (full): Stage 1 red-team swarm harness (report-only) → Stage 2 live judge gate → Stage 3 history/export lifecycle → Stage 4 rule batch (hreflang + duplicate-content).
- Swarm is report-only: scoreboard artifact, never fails CI; no threshold gate until the user names one.
- Worker tranco/ddg/PSI exclusions stand; history single-generation loss stays accepted (recorded per new history kind); judge interface is vendor-neutral, provider/credential user-supplied at enablement.
- Refused surface stays refused; Dependabot backlog and gateway-auth out of scope.

## Over-constraint check (resolved — see Confirmed assumptions above)

1. **Worker tranco/ddg/PSI exclusions stand?** The code treats them as consequences of CPU/cheerio constraints. Keeping them closed saves a Worker redesign; re-opening any one is its own hard problem. Proposed: keep closed.
2. **History single-generation loss stays accepted?** Two concurrent rotators may drop one `.1` generation. Keeping the accepted loss saves a retention redesign; new history kinds inherit it unless the user wants stronger retention. Proposed: keep accepted, record per-kind.
3. **Judge vendor neutral?** The stub names OpenAI-shaped env (`OPENAI_API_KEY`) in comments only. Proposed: harness defines a judge interface (model id + temperature 0 + fixed rubric + verdict cache) with no vendor pinned in the default path; the user supplies the provider at enablement.
4. **Swarm failure semantics:** does a swarm adversary finding fail CI (threshold gate like evalite `--threshold 100`), or report-only (scoreboard artifact)? Proposed: report-only scoreboard first, threshold gate only when the user names the threshold — avoids locking CI to a flaky adversarial signal nobody asked to gate on.
5. **Rule batch scope:** the absent list is long (hreflang, duplicate-content, structured-data, broken-external, OG-image fetch, deeper a11y/perf). Proposed: the plan covers a user-confirmed batch, not the whole list — each rule is small but each needs registry/docs/snapshot/test updates.
