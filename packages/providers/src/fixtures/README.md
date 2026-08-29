# Provider fixtures

Hand-written fixtures from the research-verified API shapes (IMPLICIT_SPEC
A1–A8; research §Seam 3 + Evidence Ledger). **No fixture was fetched live**;
each mirrors the documented response shape of its source. Tests NEVER touch
the network (I9/I10) — fixtures are served through an injected fake fetcher.

| fixture | source (documented shape) | notes |
|---|---|---|
| `googleSuggestJson` | `https://suggestqueries.google.com/complete/search?client=firefox` | `["seed", ["s1", …]]` |
| `wikiTitleHit` / `wikiTitleMiss` | `https://en.wikipedia.org/w/rest.php/v1/search/title?q=&limit=1` | `{pages:[{id,key,title}]}` / `{pages:[]}` |
| `wikiPageviews` | `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/.../daily/{start}/{end}` | `{items:[{timestamp:'YYYYMMDD00', views}]}` × 28 |
| `psiReport` | `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` (PSI v5 reference) | `lighthouseResult.categories/*.score`, `audits/*.numericValue`, `loadingExperience.metrics.*.percentile` |
| `cruxRecord` | `https://chromeuxreport.googleapis.com/v4/records:queryRecord` (CrUX API v4) | `record.metrics.<name>.{percentiles.p75, histogram:[{start,end,density}]}` |
| `oprSingle` | `https://openpagerank.com/api/v1.0/getPageRank?domains[0]=…` | `{domains:[{domain, rank, page_rank_integer, page_rank_decimal, status_code, error?}]}` |
| `trancoMeta` | `https://tranco-list.eu/api/lists/date/{yyyy-mm-dd}` | `{list_id, download_path}` |
| `trancoCsv` | Tranco list CSV | lines of `rank,domain` |
| `ddgHtml` / `ddgLite` / `ddgChallenge` / `ddgNoResults` / `ddgDrift` | `html.duckduckgo.com/html/`, `lite.duckduckgo.com/lite/` | `div.result > h2 > a.result__a` (+ `a.result__snippet`), `uddg=` redirect param, `.result--ad`, `a.result-link` on lite |

Retrieval date: n/a — shapes transcribed 2026-08-29 from the API references
cited in `thoughts/shared/research/2026-08-29-seolite-greenfield-research.md`.
