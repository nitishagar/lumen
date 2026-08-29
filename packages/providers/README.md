# @lumen-seo/providers

The seven built-in data providers of lumen — every external data boundary of
the tool, implemented as pure, provenance-labeled, paced SPI
implementations over an injected `@lumen-seo/core` `Fetcher`. Free-only;
BYOK keys are resolved from environment variables at call time and never
stored in config, state, or logs.

| name | answers | core SPI | key | provenance | documented limit | client pacing (GCRA, worst rolling 60 s) | cache |
|---|---|---|---|---|---|---|---|
| `google-suggest` | what do people type after this seed? | `KeywordProvider` | none | gray | undocumented (429/CAPTCHA at scale) | 30/min + burst 5 → 35 | 24 h |
| `wikipedia-demand` | is there real demand for this term? | `KeywordProvider` | none | heuristic | 200 req/min (contact UA) | 60/min + burst 10 → 70 (0.35×) | 24 h |
| `pagespeed` | how fast/healthy is this URL (lab + field)? | `PageSpeedProvider` | trial-keyless / required when `automated` | lab (+ field) | ~25k/day, 240/min | keyed 60+10 → 70; keyless 6+1 → 7 | 6 h (mode in key) |
| `crux` | what do real users experience here? | `CruxProvider` | **required** | field | **150 qpm/project, not increasable** | 140/min + burst 10 → **150 = limit** | 24 h |
| `openpagerank` | how strong is this domain (proxy)? | `AuthorityProvider` | **required** | heuristic | 60 req/min + monthly quota | 50/min + burst 10 → **60 = limit** | 30 d/domain |
| `tranco` | is this domain top-N overall? | `AuthorityProvider` | none | community | daily list | 1 meta GET + 1 CSV per ≤7 d | 7 d refresh / 14 d ceiling |
| `ddg-serp` | where does this rank today (best-effort)? | `SerpProvider` | none | gray | undocumented (bot protection) | 6/min (10 s spacing) + burst 1 → 7 | 1 h |

GCRA pacing bounds the worst-case rolling 60-second window at
`rpm + burst`; `resolvePacing` clamps any config override so that sum can
never exceed a provider's documented limit.

## Bring your own key (R5 names, scheme `LUMEN_<PROVIDER>_KEY`)

| env var | provider | where to get it |
|---|---|---|
| `LUMEN_PSI_KEY` | pagespeed | Google Cloud Console → PageSpeed Insights API (key optional for single trial calls; required for automated/batch) |
| `LUMEN_CRUX_KEY` | crux | Google Cloud Console → Chrome UX Report API (required) |
| `LUMEN_OPR_KEY` | openpagerank | openpagerank.com free API key (required) |

Config may override the env-var **NAME** per provider (`envVar`) — never a
secret value; a config that embeds `apiKey`/`token`-like keys is rejected
with an error naming the env-var alternative. When a required key is
absent, providers throw `NotConfiguredError` (`code: 'not_configured'`)
and make **zero** network calls — surfaces render that as an explicit
"not configured" skip.

## What data leaves the machine (I16)

| provider | data sent | destination |
|---|---|---|
| google-suggest | the seed term, language code | suggestqueries.google.com |
| wikipedia-demand | the seed term (title lookup), the matched article title | en.wikipedia.org, wikimedia.org |
| pagespeed | the full URL (+ strategy) | googleapis.com (PageSpeed Insights) |
| crux | the origin or URL + form factor | chromeuxreport.googleapis.com |
| openpagerank | one domain per request | openpagerank.com |
| tranco | nothing user-specific — the public daily list is downloaded (~2–3 MB gzip, ≤ every 7 days) | tranco-list.eu |
| ddg-serp | the search query | html/lite.duckduckgo.com |

No telemetry. Keys are sent as request headers (PSI/CrUX:
`x-goog-api-key`; OPR: `Authorization: Bearer`), never in URLs;
`redactUrl()` strips `key`/`token` params from anything destined for logs.

## Honesty model (I3)

Every emitted value carries `source { provider, kind, attribution?,
retrievedAt }` (authority signals use the locked flat `provider`/
`attribution` fields). Kinds: `gray` (undocumented endpoints — suggest,
ddg), `heuristic` (wikipedia-demand, openpagerank), `community` (tranco),
`lab` (PSI Lighthouse), `field` (CrUX and PSI's embedded field data).
Every gray/heuristic value additionally carries an `estimateLabel` saying
what it actually is. Failures are honest: absent data is omitted, `[]`, or
`null` — never zero-filled, never `value: undefined`. CrUX records carry
the verbatim CC BY 4.0 attribution sentence
(`The CrUX datasets from Google are licensed under the Creative Commons
Attribution 4.0 International license` + methodology URL) — keep it
wherever that data is displayed.

## Gray providers are brittle (A5/A6)

- **google-suggest** uses an undocumented autocomplete endpoint. CAPTCHAs
  and 429s at scale are expected; results are cached 24 h and every failure
  maps to a typed error (`rate_limited` / `blocked` / `upstream_error` /
  `parse_error`).
- **ddg-serp** scrapes `html.duckduckgo.com` with cheerio (Node-only). A
  single `lite.duckduckgo.com` fallback fires per call — only on layout
  drift (`parse_error`) or a challenge page (`blocked`), never on 429/5xx.
  Zero anchors with no "no results" marker is treated as layout drift, not
  an empty SERP.

Both are replaceable without touching any surface: implement the SPI
(`KeywordProvider` / `SerpProvider`), register it against the same
boundary, and select it via config (I2).

## Worker safety (R7)

`createWorkerSafeProviders` (import from `@lumen-seo/providers/worker`)
wires every provider except `ddg-serp` — its import graph provably never
reaches cheerio. The main entry includes all seven for Node consumers.

## Attribution (I8)

`ATTRIBUTION` constants (CrUX verbatim CC BY 4.0, Tranco, Open PageRank,
…) are exported from this package for display wherever the data is shown.

## Notes

- Open PageRank is called **per domain** (the locked SPI is
  `authority(domain, o)`): 500 fresh domains ≈ 500 requests ≈ ~10 min at
  the 50/min pace. The documented 100-domain bulk call is a possible future
  caller-side coalescing optimization.
- Tranco indexes the top 100 000 rows by default (`maxRows`); domains
  outside the indexed range return `[]`. A cached list is served up to 14
  days with its age disclosed in the `estimateLabel`; past 14 days a failed
  refresh surfaces as `stale_cache`.
